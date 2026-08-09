import { NextResponse } from "next/server";
import OpenAI from "openai";
import { DRAW_LECTURE_SYSTEM_PROMPT, PPTX_LECTURE_SYSTEM_PROMPT } from "@/lib/drawPrompt";
import { outlineGroundingInstruction, type PlanOutline } from "@/lib/planPrompt";
import { assertLectureDepth, lectureDepthStats, sanitizeDrawLecture, scriptWordCount } from "@/lib/drawSanitize";
import { fillImageOps, pauseImageOps, type ImageFillStats } from "@/lib/imageGen";
import { fillReactAnimationOps, type ReactAnimationFillStats } from "@/lib/reactAnimationGen";
import { fillBlackboardOps, type BlackboardFillStats } from "@/lib/blackboardGen";
import { fillManimSceneOps, type ManimSceneFillStats } from "@/lib/manimSceneGen";
import { fillStructureSceneOps } from "@/lib/structureSceneGen";
import { directBoards } from "@/lib/boardDirector";
import { fillSpecBoardOps } from "@/lib/specBoardGen";
import { rescueEmptyBoards } from "@/lib/boardFallback";
import { fillRealReferenceImage, type ReferenceImageStats } from "@/lib/referenceImageGen";
import { describeAssetsWithVision } from "@/lib/imageVision";
import { fillImageCalloutOpsIncremental } from "@/lib/imageCalloutGen";
import { lectureCacheKey, readCachedLecture, writeCachedLecture } from "@/lib/lectureCache";
import {
  applySuprnotesPaperSurface,
  applySuprnotesPaperLayout,
  applyPaperLayout,
  cleanProvidedImageBoards,
  composePromptedSuprnotesBoards,
  composeSuprnotesPaperBoards,
  compactSuprnotesForPrompt,
  ensureSuprnotesAssetUsage,
  enforcePlannedSuprnotesVisualModes,
  hydrateProvidedImageOps,
  isSuprnotesLessonInput,
  removeUnhydratedSuprnotesImageOps,
  repairMissingSuprnotesBoards,
  repairMissingSuprnotesSvgCode,
  shouldUseOnlyProvidedImages,
  suprnotesTitle,
  type SuprnotesLessonInput,
} from "@/lib/suprnotes";
import type { Beat } from "@/lib/lessonContent";

// Kill switch for generated image assets. The prompt can still plan image beats, but when this is
// off the server converts those placeholders into no-cost written boards instead of calling the
// image API.
const IMAGE_GENERATION_ENABLED = process.env.IMAGE_GENERATION_ENABLED === "1";

// Kill switch for the sandboxed React-animation pipeline (see components/sketch/ReactAnimationSandbox.tsx).
// Server-side mirror of NEXT_PUBLIC_REACT_ANIMATIONS_ENABLED — gating generation here (not just
// client rendering) means disabling the flag also saves the extra gpt-4o call, not just the render.
const REACT_ANIMATIONS_ENABLED = process.env.REACT_ANIMATIONS_ENABLED === "1";

// Kill switch for the dynamic model-authored chalk blackboard pipeline (see lib/blackboardGen.ts).
// When off, drawSanitize keeps synthesizing blackboards from templates (no extra model call) and
// no chalkBoard placeholders reach here to fill. Client mirror: NEXT_PUBLIC_BLACKBOARD_GEN_ENABLED.
const BLACKBOARD_GEN_ENABLED = process.env.BLACKBOARD_GEN_ENABLED === "1";
// TYPE D diagram boards are only worth generating when Manim can actually render them.
// Same switch the render API uses; client mirror: NEXT_PUBLIC_MANIM_RENDER_ENABLED.
const MANIM_RENDER_ENABLED = process.env.MANIM_RENDER_ENABLED === "1";

function disabledManimSceneStats(): ManimSceneFillStats {
  return { costUsd: 0, pending: 0, filled: 0, rejected: 0, issues: ["MANIM_RENDER_ENABLED is not 1"] };
}

const REAL_REFERENCE_IMAGES_ENABLED = process.env.REAL_REFERENCE_IMAGES_ENABLED !== "0";

/**
 * Generates a full lecture for ANY typed topic using the DrawScript pipeline:
 *   Step 1 — gpt-4o writes the complete script, beat structure, and marker-drawn board
 *             layouts (including "image" op placeholders with a descriptive prompt per beat).
 *   Step 2 — the configured image model fills each image op placeholder with a real, topic-specific
 *             AI-generated illustration matched to that beat's content.
 *
 * The client then plays the enriched beats through LessonPlayer / the accessibility players —
 * the same shape as the curated photosynthesis demo, now generatable for any topic with
 * real contextual images and semantic live motion instead of generic fixed-template shapes.
 *
 * Honesty: costs a real gpt-4o call + several medium-quality image calls per lecture. Image
 * generation adds latency. Needs OPENAI_API_KEY in frontend/web/.env.local.
 */
const MODEL = process.env.OPENAI_LECTURE_MODEL ?? "gpt-4o";
const TEXT_ATTEMPTS = Math.max(1, Math.min(5, Number(process.env.OPENAI_LECTURE_ATTEMPTS ?? 4)));
// NOT the depth lever: measured completions run ~2,800-3,000 tokens with finish_reason "stop",
// i.e. under 20% of this budget, so shallow lectures are the model choosing to write short rather
// than running out of room. Raising this changes nothing; depth is recovered by deepenLectureScripts.
const TEXT_MAX_TOKENS = Math.max(8_000, Math.min(16_000, Number(process.env.OPENAI_LECTURE_MAX_TOKENS ?? 14_000)));
// This IS the depth lever. First-pass generation measures ~79 words/teaching beat against a gate
// of 100; the deepen pass is what lifts it to ~102-110, so the shallow-lecture error the user sees
// is a deepen pass running out of attempts, not the first pass being bad. 3 is the clamp ceiling.
const DEEPEN_ATTEMPTS = Math.max(1, Math.min(3, Number(process.env.OPENAI_LECTURE_DEEPEN_ATTEMPTS ?? 3)));
const PDF_BEATS_PER_GENERATION = Math.max(1, Math.min(6, Number(process.env.PDF_BEATS_PER_GENERATION ?? 1)));
const PDF_GENERATION_CONCURRENCY = Math.max(1, Math.min(3, Number(process.env.PDF_GENERATION_CONCURRENCY ?? 2)));

// gpt-4o pricing for the text-generation step (as of 2025, source: openai.com/api/pricing).
const TEXT_INPUT_PRICE  = 2.50 / 1_000_000;  // $2.50 per M input tokens
const TEXT_OUTPUT_PRICE = 10.0 / 1_000_000;  // $10.00 per M output tokens

type LectureBuildInput = {
  topic: string;
  mood: string;
  slideContext: string;
  diagramHints: string;
  slideImages: Array<{ slide: number; descriptions: string[] }>;
  sourceDocument: SuprnotesLessonInput | null;
  outline: PlanOutline | null;
};

type BaseLecture = {
  beats: Beat[];
  textCost: number;
};

type BeatCountRepair = {
  beats: Beat[];
  costUsd: number;
};

type PlannedPdfBeat = {
  id?: string;
  title?: string;
  sourceBlockIds: string[];
  recommendedVisual?: { type?: string; assetId?: string; brief?: string };
};

function isPdfSource(sourceDocument: SuprnotesLessonInput | null): boolean {
  if (!sourceDocument?.source || typeof sourceDocument.source !== "object") return false;
  return (sourceDocument.source as Record<string, unknown>).adapter === "pdf-upload";
}

function plannedPdfBeats(sourceDocument: SuprnotesLessonInput | null): PlannedPdfBeat[] {
  if (!isPdfSource(sourceDocument)) return [];
  const plan = (sourceDocument?.lessonPlan ?? sourceDocument?.suggestedLecturePlan) as Record<string, unknown> | undefined;
  if (!plan || !Array.isArray(plan.beats)) return [];
  return plan.beats.flatMap((raw) => {
    if (!raw || typeof raw !== "object") return [];
    const record = raw as Record<string, unknown>;
    const recommended = record.recommendedVisual && typeof record.recommendedVisual === "object"
      ? record.recommendedVisual as Record<string, unknown>
      : null;
    return [{
      id: typeof record.id === "string" ? record.id : undefined,
      title: typeof record.title === "string" ? record.title : undefined,
      sourceBlockIds: Array.isArray(record.sourceBlockIds)
        ? record.sourceBlockIds.filter((id): id is string => typeof id === "string")
        : [],
      recommendedVisual: recommended
        ? {
            type: typeof recommended.type === "string" ? recommended.type : undefined,
            assetId: typeof recommended.assetId === "string" ? recommended.assetId : undefined,
            brief: typeof recommended.brief === "string" ? recommended.brief : undefined,
          }
        : undefined,
    }];
  });
}

function applyPdfPlanMetadata(beats: Beat[], sourceDocument: SuprnotesLessonInput | null): void {
  const planned = plannedPdfBeats(sourceDocument);
  if (!planned.length) return;
  if (beats.length !== planned.length) {
    throw new Error(`PDF plan requires exactly ${planned.length} beats in source order; model returned ${beats.length}.`);
  }
  const covered = new Set<string>();
  beats.forEach((beat, index) => {
    const planBeat = planned[index];
    if (planBeat.id) beat.id = planBeat.id;
    if (planBeat.title) beat.title = planBeat.title;
    beat.sourceBlockIds = [...planBeat.sourceBlockIds];
    planBeat.sourceBlockIds.forEach((id) => covered.add(id));
  });
  const expected = new Set((sourceDocument?.contentBlocks ?? []).map((block) => block.id));
  const missing = [...expected].filter((id) => !covered.has(id));
  if (missing.length) {
    throw new Error(`PDF lesson plan omitted ${missing.length} source blocks.`);
  }
}

function textCostUsd(usage: OpenAI.Chat.Completions.ChatCompletion["usage"] | undefined): number {
  return usage ? usage.prompt_tokens * TEXT_INPUT_PRICE + usage.completion_tokens * TEXT_OUTPUT_PRICE : 0;
}

async function addMissingPromptedBeat(
  client: OpenAI,
  topic: string,
  mood: string,
  beats: Beat[]
): Promise<BeatCountRepair> {
  const nextCount = beats.length + 1;
  const completion = await client.chat.completions.create({
    model: MODEL,
    messages: [
      {
        role: "system",
        content:
          `You repair an otherwise strong AI tutor lecture that has ${beats.length} beats. Return JSON only: ` +
          "{\"insertAfterId\":string,\"beat\":Beat}. Add exactly ONE substantive teaching beat at the weakest conceptual transition. " +
          "Preserve the existing lecture; do not rewrite or repeat an existing beat. The new beat needs a unique id, a precise title, " +
          "a teacherMove, 2-4 concise points, and a warm 110-140 word script that deeply explains one idea and connects the surrounding beats. " +
          "Use slideKind definition, mechanism, example, compare, application, misconception, or recap. Do not add a checkpoint. " +
          "Its draw must contain exactly one reactAnimation op with at:0, endAt:1, and a dense teachingPoint describing a content-driven " +
          "paper-whiteboard composition plus the natural order in which the teacher writes, draws, labels, connects, and annotates it. " +
          "Ground every fact in the supplied beats. No markdown and no commentary.",
      },
      {
        role: "user",
        content: JSON.stringify({
          topic,
          mood,
          instruction: `Add one missing beat so this becomes a coherent ${nextCount}-beat draft on the way to a full ten-beat lecture.`,
          existingBeats: beats.map((beat) => ({
            id: beat.id,
            title: beat.title,
            slideKind: beat.slideKind,
            teacherMove: beat.teacherMove,
            points: beat.points,
            script: beat.script,
          })),
        }),
      },
    ],
    temperature: 0.35,
    max_tokens: 2_000,
    response_format: { type: "json_object" },
  });

  const payload = JSON.parse(completion.choices[0]?.message?.content ?? "{}");
  const insertAfterId = typeof payload.insertAfterId === "string" ? payload.insertAfterId : "";
  const insertAfterIndex = beats.findIndex((beat) => beat.id === insertAfterId);
  const recapIndex = beats.findIndex((beat) => beat.slideKind === "recap");
  const fallbackIndex = recapIndex >= 0 ? recapIndex : Math.max(0, beats.length - 1);
  const insertionIndex = insertAfterIndex >= 0 ? insertAfterIndex + 1 : fallbackIndex;
  const combined = [...beats];
  combined.splice(insertionIndex, 0, payload.beat);
  const repaired = sanitizeDrawLecture({ beats: combined }, { enforceDepth: false, minUsableBeats: nextCount });
  if (repaired.length !== nextCount) {
    throw new Error(`Beat-count repair produced ${repaired.length} beats instead of ${nextCount}.`);
  }
  return { beats: repaired, costUsd: textCostUsd(completion.usage) };
}

async function repairPromptedBeatCount(client: OpenAI, topic: string, mood: string, beats: Beat[]): Promise<BeatCountRepair> {
  let repaired = beats;
  let costUsd = 0;
  while (repaired.length < 10) {
    const repair = await addMissingPromptedBeat(client, topic, mood, repaired);
    repaired = repair.beats;
    costUsd += repair.costUsd;
  }
  return { beats: repaired, costUsd };
}

function compactBeatsForDeepening(beats: Beat[]) {
  return beats.map((beat, index) => ({
    index,
    id: beat.id,
    title: beat.title,
    slideKind: beat.slideKind,
    points: beat.points,
    currentWords: scriptWordCount(beat.script),
    script: beat.script,
    checkpointPrompt: beat.checkpoint?.prompt,
  }));
}

function applyScriptPatchesToRawLecture(rawLecture: unknown, patches: unknown) {
  if (!rawLecture || typeof rawLecture !== "object") return;
  const rawBeats = (rawLecture as Record<string, unknown>).beats;
  if (!Array.isArray(rawBeats) || !Array.isArray(patches)) return;

  const byId = new Map<string, string>();
  for (const patch of patches) {
    if (!patch || typeof patch !== "object") continue;
    const p = patch as Record<string, unknown>;
    if (typeof p.id === "string" && typeof p.script === "string" && p.script.trim()) {
      byId.set(p.id, p.script.trim());
    }
  }

  for (const rawBeat of rawBeats) {
    if (!rawBeat || typeof rawBeat !== "object") continue;
    const beat = rawBeat as Record<string, unknown>;
    const id = typeof beat.id === "string" ? beat.id : "";
    const script = byId.get(id);
    if (script) beat.script = script;
  }
}

function assertInputLectureDepth(beats: Beat[], pdfSource: boolean): void {
  if (!pdfSource) {
    assertLectureDepth(beats);
    return;
  }
  const stats = lectureDepthStats(beats);
  const maxShortBeats = Math.max(1, Math.floor(stats.teachingBeatCount * 0.15));
  if (stats.avgTeachingWords < 100 || stats.shortTeachingBeatCount > maxShortBeats) {
    throw new Error(
      `Model returned shallow PDF teaching beats (${Math.round(stats.avgTeachingWords)} words per teaching beat).`
    );
  }
}

async function deepenLectureScripts(
  client: OpenAI,
  topic: string,
  mood: string,
  rawLecture: unknown,
  beats: Beat[],
  options: { minUsableBeats?: number; pdfSource?: boolean } = {},
): Promise<number> {
  let extraCostUsd = 0;
  let lastError = "Could not deepen the generated lecture.";

  for (let attempt = 0; attempt < DEEPEN_ATTEMPTS; attempt++) {
    try {
      const stats = lectureDepthStats(beats);
      const completion = await client.chat.completions.create({
        model: MODEL,
        messages: [
          {
            role: "system",
            content:
              "You deepen AI tutor lecture scripts. Return JSON only: {\"beats\":[{\"id\":string,\"script\":string}]}. " +
              "Preserve every id exactly. Do not change titles, visuals, checkpoints, or order. " +
              "Rewrite only the spoken script. Teaching beats need 110-140 words each. Intro needs 75-95 words. " +
              `Checkpoint scripts need 25-45 words. Recap needs 110-135 words. ${options.pdfSource ? "This is one ordered PDF section, so deepen every supplied beat without trying to reach a whole-lecture word total. " : "Total output should create 1050-1450 spoken words without changing the number of beats. "}` +
              "Use warm natural spoken language, concrete examples, misconception warnings, and smooth transitions. " +
              "Deepen each existing board in layers: claim, mechanism or reasoning, one concrete example, misconception contrast, and connection forward. Do not introduce facts absent from the existing scripts. " +
              "Do not request more visual elements or change board composition; the same concise board should be revisited and annotated while the deeper narration continues. " +
              "Preserve and strengthen any interactive teaching moments already present: Socratic question sequences, Mistake Ambush wording, Two Explanations Duel phrasing, Live Lesson Steering choices, and Doubt Button prerequisite-rewind language. " +
              "Do not convert these moments into ordinary exposition. No markdown, no bullets.",
          },
          {
            role: "user",
            content: JSON.stringify({
              topic,
              mood,
              failedDepthStats: stats,
              instruction:
                "Expand these scripts so every teaching board receives an unhurried, in-depth explanation. Keep the same beat ids, facts, and beat count, and return one script per beat.",
              beats: compactBeatsForDeepening(beats),
            }),
          },
        ],
        temperature: 0.5,
        max_tokens: TEXT_MAX_TOKENS,
        response_format: { type: "json_object" },
      });

      extraCostUsd += textCostUsd(completion.usage);
      const parsed = JSON.parse(completion.choices[0]?.message?.content ?? "{}") as Record<string, unknown>;
      applyScriptPatchesToRawLecture(rawLecture, parsed.beats);
      const deepenedBeats = sanitizeDrawLecture(rawLecture, {
        enforceDepth: false,
        minUsableBeats: options.minUsableBeats,
      });
      assertInputLectureDepth(deepenedBeats, options.pdfSource === true);
      return extraCostUsd;
    } catch (err) {
      lastError = err instanceof Error ? err.message : "Could not deepen the generated lecture.";
    }
  }

  throw new Error(lastError);
}

function buildUserMessage(input: LectureBuildInput, retryGuidance: string): string {
  const moodLine = input.mood ? `Lesson mode: ${input.mood}. ` : "";
  const base = `Teach this topic live: "${input.topic}". ${moodLine}`;
  const outlineLine = input.outline ? outlineGroundingInstruction(input.outline) : "";

  if (input.sourceDocument) {
    const pdfRules = isPdfSource(input.sourceDocument)
      ? `This is an uploaded PDF with a deterministic semantic plan. Return EXACTLY the number of beats in lessonPlan.beats, in that exact order. Copy each plan beat's sourceBlockIds onto the matching output beat exactly. Do not merge, split, omit, or reorder planned beats. Explain every assigned source block and preserve formulas, table values, examples, qualifications, and definitions exactly. Match the SAME premium visual grammar and quality as a normal prompted lesson: content-specific animated whiteboard SVGs for every svg_diagram beat, sentence-synchronized marker boards for paper_whiteboard beats, and natural progressive teaching sequences rather than static text slides. Preserve reactAnimation placeholders exactly so the premium animation generator can build them after planning. Use a PDF image ONLY when that plan beat's recommendedVisual explicitly supplies an assetId; never force every extracted asset into the lecture. On an image beat, show the clean complete crop in context and add labels/arrows only when the recommended brief and narration genuinely need them. Do not turn chapter banners, question boxes, decorative graphics, or unrelated photos into teaching boards. `
      : `Ten detailed beats are acceptable and preferred over many thin beats. `;
    return (
      `${base}\nThe student provided a structured Suprnotes-style source document. Treat this document as the primary lesson source:\n` +
      `${compactSuprnotesForPrompt(input.sourceDocument)}\n\n` +
      `STRICT LESSON CONTRACT RULES: If lessonPlan or suggestedLecturePlan is present, follow its beat order, targetBeatCount, titles, sourceBlockIds, objectives, and recommendedVisual choices as the required lecture plan. Do not reorder or merge beats unless the plan explicitly allows it. ` +
      `Every planned beat must be explained in depth: write a teacher script that fully teaches the sourceBlockIds assigned to that beat, not a one-line summary. ${pdfRules}` +
      `Use only facts from contentBlocks, assets, lessonPlan/suggestedLecturePlan, and webPreview items. Treat webPreview as optional enrichment: include a web claim only if it is explicitly present in webPreview.claims/summary and useful for the assigned beat; do not invent extra web facts. ` +
      `If contentGovernance says grounding or hallucination controls are strict, every concrete claim in the script must be traceable to a source block or webPreview item. If a detail is not in the source, either omit it or phrase it as a general teaching analogy, not as a fact. ` +
      `Use the contentBlocks as the factual backbone and use their source order only when no explicit lesson plan is provided. ` +
      `Use provided assets ONLY for beats where the asset itself is the evidence (a real photo/diagram the student uploaded) — emit an image op with the matching "assetId" from the assets list, plus a short prompt describing what the asset shows. ` +
      `Not every beat needs a provided image: for beats that explain a mechanism, process, comparison, or relationship, prefer a WHITEBOARD SVG DIAGRAM beat (exactly one "reactAnimation" op, see TYPE C) built from the source's own facts — the same as you would for a beat with no provided asset at all. Use provided images sparingly, only when they are genuinely the clearest way to teach that specific beat. ` +
      `Do not invent chemistry-specific layouts, exact coordinates, or examples outside the source; choose layout, callout text, and placement dynamically from the content and asset descriptions. ` +
      `Do not ask for AI-generated images for this source document. If an image beat is useful, it must use one of the provided assetId values. ` +
      `Make the visuals feel like a clean teaching whiteboard: generous whitespace, centered headings, readable gray/colored marker text, and callouts placed around the provided image without covering the key content. ` +
      `Build the complete lecture now from the plan: teacher script, board layouts, provided-image callouts, whiteboard SVG diagrams, and checkpoints.${retryGuidance}${outlineLine}`
    );
  }

  if (input.slideContext) {
    // Build a compact image reference block so GPT-4o knows what images were in which slides.
    let imageRefBlock = "";
    if (input.slideImages.length > 0) {
      const lines = input.slideImages
        .filter((s) => s.descriptions.length > 0)
        .map((s) => `  Slide ${s.slide}: ${s.descriptions.join(" / ")}`);
      if (lines.length > 0) {
        imageRefBlock =
          `\nSlide images extracted from the deck (use these when writing image beat prompts — recreate the same subject as a cleaner, sharper photorealistic scene, NOT a generic replacement):\n${lines.join("\n")}`;
      }
    }

    const diagramLine = input.diagramHints
      ? `\nSlides with visuals/charts: ${input.diagramHints}.`
      : "";

    return (
      `${base}\nThe student uploaded a presentation. Slide content:\n---\n${input.slideContext}\n---\n` +
      `Use the slide text and data as your factual source (do not invent content). Choose board types in the same Suprnotes-style paper-whiteboard grammar: mostly whiteboard SVG diagrams and blackboards, with slide images only when they are truly useful evidence.` +
      `${diagramLine}${imageRefBlock}` +
      `\nBuild the complete lecture now: teacher script, paper-whiteboard SVG/blackboard boards, one or two TYPE D diagram beats (a "manimScene" op) where the deck contains a curve or staged process, one TYPE E morph beat (a "morph" op) if anything in the deck literally turns into something else, selective image callouts only when needed, and checkpoints.${retryGuidance}${outlineLine}`
    );
  }

  // The closing enumeration is the last thing the model reads, so it must name every board type
  // that should appear. Omitting TYPE D here suppressed diagram beats entirely even when the
  // system prompt required one — the model built exactly the three board types this line listed.
  return `${base}Build the complete lecture now in the Suprnotes-style paper-whiteboard format: teacher script, clean handwritten whiteboard SVG diagrams, blackboard relationship boards, one or two TYPE D diagram beats (a "manimScene" op) for the curve or staged process at the heart of the topic, one TYPE E morph beat (a "morph" op) if anything in the topic literally turns into something else, selective image callouts only when truly needed, and checkpoints.${retryGuidance}${outlineLine}`;
}

async function generateBaseLecture(client: OpenAI, input: LectureBuildInput): Promise<BaseLecture> {
  // Step 1: generate script + beat structure + DrawScript op layouts (text only, fast).
  // Retry malformed/too-short JSON responses before image generation runs. These text-only
  // retries are cheap compared with generating images and prevent spending money on bad shapes.
  let lastError = "The model did not return a usable lecture.";
  for (let attempt = 0; attempt < TEXT_ATTEMPTS; attempt++) {
    try {
      const retryGuidance = attempt > 0 ? ` Previous attempt failed: ${lastError}. Fix that failure in this attempt.` : "";
      const systemPrompt = input.slideContext ? PPTX_LECTURE_SYSTEM_PROMPT : DRAW_LECTURE_SYSTEM_PROMPT;
      const completion = await client.chat.completions.create({
        model: MODEL,
        messages: [
          { role: "system", content: systemPrompt },
          {
            role: "user",
            content: buildUserMessage(input, retryGuidance),
          },
        ],
        temperature: 0.55,
        max_tokens: TEXT_MAX_TOKENS,
        response_format: { type: "json_object" },
      });
      const raw = completion.choices[0]?.message?.content ?? "";
      const rawLecture = JSON.parse(raw);
      const pdfPlanCount = plannedPdfBeats(input.sourceDocument).length;
      const minUsableBeats = pdfPlanCount || (input.sourceDocument ? 1 : 8);
      let beats = sanitizeDrawLecture(rawLecture, { enforceDepth: false, minUsableBeats });
      applyPdfPlanMetadata(beats, input.sourceDocument);

      // Eight or nine strong beats are recoverable. Add only the missing conceptual bridges instead of
      // discarding the entire lecture and paying for another full generation attempt.
      let textCost = textCostUsd(completion.usage);
      if (!input.sourceDocument && beats.length >= 8 && beats.length < 10) {
        const repair = await repairPromptedBeatCount(client, input.topic, input.mood, beats);
        beats = repair.beats;
        textCost += repair.costUsd;
        if (rawLecture && typeof rawLecture === "object") {
          (rawLecture as Record<string, unknown>).beats = beats;
        }
      }
      if (!input.sourceDocument && (beats.length < 10 || beats.length > 12)) {
        throw new Error(`Model returned ${beats.length} beats; prompted lessons must contain 10-12 complete beats.`);
      }

      // Tally the text-generation cost from actual token usage.
      try {
        assertInputLectureDepth(beats, isPdfSource(input.sourceDocument));
      } catch {
        textCost += await deepenLectureScripts(client, input.topic, input.mood, rawLecture, beats, {
          minUsableBeats,
          pdfSource: isPdfSource(input.sourceDocument),
        });
        beats = sanitizeDrawLecture(rawLecture, { enforceDepth: false, minUsableBeats });
        applyPdfPlanMetadata(beats, input.sourceDocument);
        if (!input.sourceDocument && (beats.length < 10 || beats.length > 12)) {
          throw new Error(`Model returned ${beats.length} beats after deepening; prompted lessons must contain 10-12 complete beats.`);
        }
        assertInputLectureDepth(beats, isPdfSource(input.sourceDocument));
      }

      return { beats, textCost };
    } catch (err) {
      lastError = err instanceof Error ? err.message : "Lecture generation failed";
    }
  }

  throw new Error(lastError);
}

function chunkPdfSourceDocument(
  sourceDocument: SuprnotesLessonInput,
  start: number,
  size: number,
): SuprnotesLessonInput {
  const rawPlan = (sourceDocument.lessonPlan ?? sourceDocument.suggestedLecturePlan) as Record<string, unknown>;
  const rawBeats = Array.isArray(rawPlan?.beats) ? rawPlan.beats : [];
  const chunkBeats = rawBeats.slice(start, start + size);
  const sourceBlockIds = new Set<string>();
  const recommendedAssetIds = new Set<string>();
  for (const raw of chunkBeats) {
    if (!raw || typeof raw !== "object") continue;
    const beat = raw as Record<string, unknown>;
    if (Array.isArray(beat.sourceBlockIds)) {
      beat.sourceBlockIds.forEach((id) => {
        if (typeof id === "string") sourceBlockIds.add(id);
      });
    }
    const visual = beat.recommendedVisual && typeof beat.recommendedVisual === "object"
      ? beat.recommendedVisual as Record<string, unknown>
      : null;
    if (typeof visual?.assetId === "string") recommendedAssetIds.add(visual.assetId);
  }
  const assets = (sourceDocument.assets ?? []).filter((asset) =>
    recommendedAssetIds.has(asset.id) ||
    asset.sourceBlockIds?.some((id) => sourceBlockIds.has(id))
  );
  const chunkPlan = {
    ...rawPlan,
    targetBeatCount: chunkBeats.length,
    contentBlockIds: [...sourceBlockIds],
    assetIds: assets.map((asset) => asset.id),
    beats: chunkBeats,
  };
  return {
    ...sourceDocument,
    contentBlocks: (sourceDocument.contentBlocks ?? []).filter((block) => sourceBlockIds.has(block.id)),
    assets,
    lessonPlan: chunkPlan,
    suggestedLecturePlan: chunkPlan,
  };
}

async function generatePdfLectureInChunks(client: OpenAI, input: LectureBuildInput): Promise<BaseLecture> {
  const sourceDocument = input.sourceDocument;
  const planned = plannedPdfBeats(sourceDocument);
  if (!sourceDocument || planned.length <= PDF_BEATS_PER_GENERATION) {
    return generateBaseLecture(client, input);
  }

  const chunks = Array.from(
    { length: Math.ceil(planned.length / PDF_BEATS_PER_GENERATION) },
    (_, index) => index * PDF_BEATS_PER_GENERATION,
  );
  const results = new Array<BaseLecture>(chunks.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(PDF_GENERATION_CONCURRENCY, chunks.length) }, async () => {
    while (cursor < chunks.length) {
      const chunkIndex = cursor++;
      const start = chunks[chunkIndex];
      const chunkSource = chunkPdfSourceDocument(sourceDocument, start, PDF_BEATS_PER_GENERATION);
      results[chunkIndex] = await generateBaseLecture(client, {
        ...input,
        topic: `${input.topic} (document section ${start + 1}-${Math.min(start + PDF_BEATS_PER_GENERATION, planned.length)} of ${planned.length})`,
        sourceDocument: chunkSource,
      });
    }
  }));

  const beats = results.flatMap((result) => result.beats);
  applyPdfPlanMetadata(beats, sourceDocument);
  return {
    beats,
    textCost: results.reduce((sum, result) => sum + result.textCost, 0),
  };
}

function disabledAnimationStats(): ReactAnimationFillStats {
  return { costUsd: 0, pending: 0, filled: 0, rejected: 0, issues: ["REACT_ANIMATIONS_ENABLED is not 1"] };
}

function disabledImageStats(beats: Beat[]): ImageFillStats {
  return pauseImageOps(beats);
}

function disabledBlackboardStats(): BlackboardFillStats {
  return { costUsd: 0, pending: 0, filled: 0, rejected: 0, issues: ["BLACKBOARD_GEN_ENABLED is not 1"] };
}

function disabledReferenceImageStats(): ReferenceImageStats {
  return { costUsd: 0, filled: 0, failed: 0 };
}

// Shared finalize pass for BOTH paths — re-applied every time new content lands (base generation,
// then again after each async asset fill), because ops that were still empty placeholders on an
// earlier call (e.g. a chalkBoard with no rows yet) need the paper re-layout applied once their
// real content exists. Suprnotes gets its full asset-aware pipeline; a free-typed/PPTX lecture
// (no sourceDocument) gets the same paper surface + re-layout via applyPaperLayout so its boards
// match the Suprnotes look instead of keeping dark-chalkboard-tuned spacing under a paper theme.
function finalizeSuprnotesBeats(beats: Beat[], sourceDocument: SuprnotesLessonInput | null): void {
  if (!sourceDocument) {
    composePromptedSuprnotesBoards(beats);
    applyPaperLayout(beats);
    return;
  }
  ensureSuprnotesAssetUsage(beats, sourceDocument);
  hydrateProvidedImageOps(beats, sourceDocument);
  removeUnhydratedSuprnotesImageOps(beats, sourceDocument);
  enforcePlannedSuprnotesVisualModes(beats, sourceDocument);
  composeSuprnotesPaperBoards(beats, sourceDocument);
  applySuprnotesPaperSurface(beats, sourceDocument);
  applySuprnotesPaperLayout(beats, sourceDocument);
}

export async function POST(req: Request) {
  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json(
      { error: "OPENAI_API_KEY not set — add it to frontend/web/.env.local to generate lectures." },
      { status: 503 }
    );
  }

  const body = await req.json().catch(() => ({}));
  const topic = typeof body.topic === "string" ? body.topic.trim() : "";
  const mood = typeof body.mood === "string" ? body.mood.trim().slice(0, 160) : "";
  // Optional slide context from a parsed PPTX — up to 4000 chars of structured slide text
  const slideContext = typeof body.context === "string" ? body.context.trim().slice(0, 4000) : "";
  const diagramHints = typeof body.diagramHints === "string" ? body.diagramHints.trim().slice(0, 600) : "";
  // Per-slide image descriptions extracted from the PPTX by the Vision step — keyed by slide number
  // Shape: Array<{ slide: number; descriptions: string[] }>
  const slideImages: Array<{ slide: number; descriptions: string[] }> =
    Array.isArray(body.slideImages) ? body.slideImages : [];
  const sourceDocument = isSuprnotesLessonInput(body.sourceDocument)
    ? body.sourceDocument
    : isSuprnotesLessonInput(body.suprnotes)
      ? body.suprnotes
      : null;
  const effectiveTopic = topic || (sourceDocument ? suprnotesTitle(sourceDocument) : "");
  if (!effectiveTopic) return NextResponse.json({ error: "topic is required" }, { status: 400 });
  if (effectiveTopic.length > 200) return NextResponse.json({ error: "topic is too long — keep it to a short phrase" }, { status: 400 });

  // Approved outline from the planning flow (LearnPage's clarify/outline screens) — optional,
  // additive grounding for the existing single-shot generation. Not used for Suprnotes source
  // documents, which already carry their own strict lessonPlan/suggestedLecturePlan structure.
  const outline: PlanOutline | null =
    body.outline && typeof body.outline === "object" && Array.isArray(body.outline.subtopics)
      ? {
          topic: typeof body.outline.topic === "string" ? body.outline.topic.slice(0, 200) : effectiveTopic,
          subtopics: (body.outline.subtopics as unknown[])
            .filter((s): s is Record<string, unknown> => !!s && typeof s === "object")
            .map((s) => ({
              title: typeof s.title === "string" ? s.title.slice(0, 80) : "",
              caption: typeof s.caption === "string" ? s.caption.slice(0, 160) : "",
              safetyNet: s.safetyNet && typeof s.safetyNet === "object"
                ? {
                    prerequisite: typeof (s.safetyNet as Record<string, unknown>).prerequisite === "string" ? ((s.safetyNet as Record<string, unknown>).prerequisite as string).slice(0, 80) : "",
                    diagnostic: typeof (s.safetyNet as Record<string, unknown>).diagnostic === "string" ? ((s.safetyNet as Record<string, unknown>).diagnostic as string).slice(0, 220) : "",
                    masterySignal: typeof (s.safetyNet as Record<string, unknown>).masterySignal === "string" ? ((s.safetyNet as Record<string, unknown>).masterySignal as string).slice(0, 120) : "",
                    rescueMove: typeof (s.safetyNet as Record<string, unknown>).rescueMove === "string" ? ((s.safetyNet as Record<string, unknown>).rescueMove as string).slice(0, 220) : "",
                    reinforceAfter: Math.max(1, Math.min(3, Math.round(Number((s.safetyNet as Record<string, unknown>).reinforceAfter) || 2))) as 1 | 2 | 3,
                    reinforcementPrompt: typeof (s.safetyNet as Record<string, unknown>).reinforcementPrompt === "string" ? ((s.safetyNet as Record<string, unknown>).reinforcementPrompt as string).slice(0, 180) : "",
                  }
                : undefined,
            }))
            .filter((s) => s.title.trim().length > 0)
            .slice(0, 10),
        }
      : null;

  const input: LectureBuildInput = { topic: effectiveTopic, mood, slideContext, diagramHints, slideImages, sourceDocument, outline };
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const refresh = body.refresh === true;

  // Lesson cache: replaying the SAME task folder/upload is instant and free instead of re-running
  // the whole pipeline. A miss (or any read error) never blocks generation — it just falls through.
  const cacheKey = lectureCacheKey({
    topic: input.topic,
    mood: input.mood,
    slideContext: input.slideContext,
    sourceDocument: input.sourceDocument,
    model: MODEL,
  });
  if (!refresh) {
    const cached = await readCachedLecture(cacheKey);
    if (cached) {
      return NextResponse.json({ topic: cached.topic || input.topic, beats: cached.beats, costUsd: 0, cached: true });
    }
  }

  try {
    const base = isPdfSource(input.sourceDocument)
      ? await generatePdfLectureInChunks(client, input)
      : await generateBaseLecture(client, input);
    finalizeSuprnotesBeats(base.beats, input.sourceDocument);
    const useOnlyProvidedImages = shouldUseOnlyProvidedImages(input.sourceDocument);

    // Vision pass FIRST (sourceDocument only): look at each provided image and rewrite its
    // description from the actual pixels, so the director's script and the image-explainer's
    // labels teach the real picture instead of the upstream relevant_images.json text.
    const visionCostUsd = input.sourceDocument ? await describeAssetsWithVision(client, input.sourceDocument) : 0;

    // Step 1.5: re-point each beat at the board its content actually calls for, BEFORE the fill
    // passes below — they complete whatever placeholder a beat carries, so the swap has to happen
    // first or the wrong generator does the work. Off unless BOARD_DIRECTOR=1; when off this is a
    // no-op and board selection stays exactly as the lecture prompt wrote it.
    const directorStats = await directBoards(client, base.beats);

    // Step 2: fill each "image" op placeholder with a real generated image, and (if enabled)
    // each "reactAnimation" op placeholder with generated component source — in parallel with
    // each other since they touch disjoint beats and are both I/O-bound. Individual failures
    // in either degrade gracefully (dropped image / explicit animation unavailable state).
    const [imageCostUsd, referenceImageStats, reactAnimationStats, boardStats, manimSceneStats, structureStats, specBoardStats] = await Promise.all([
      IMAGE_GENERATION_ENABLED && !useOnlyProvidedImages ? fillImageOps(client, base.beats) : Promise.resolve(disabledImageStats(base.beats).costUsd),
      // The director's per-beat findings ARE the photo gate: a beat may carry a real photograph
      // only when its visual specification says the subject is physical and the classifier called
      // it a labelled diagram. Without that context no beat qualifies, which is the safe default —
      // the previous gate guessed from keywords and put a stamp vending machine in a lecture on
      // Support Vector Machines.
      REAL_REFERENCE_IMAGES_ENABLED && !input.sourceDocument
        ? fillRealReferenceImage(client, base.beats, { specs: directorStats.specs, forms: directorStats.forms })
        : Promise.resolve(disabledReferenceImageStats()),
      REACT_ANIMATIONS_ENABLED ? fillReactAnimationOps(client, base.beats) : Promise.resolve(disabledAnimationStats()),
      BLACKBOARD_GEN_ENABLED ? fillBlackboardOps(client, base.beats, Boolean(input.sourceDocument)) : Promise.resolve(disabledBlackboardStats()),
      // TYPE D diagram boards. Gated on the same switch as rendering: with Manim off there is
      // nothing to render the spec, so paying for one would be pure waste — the beat falls
      // back to the live SVG board either way.
      MANIM_RENDER_ENABLED ? fillManimSceneOps(client, base.beats) : Promise.resolve(disabledManimSceneStats()),
      // TYPE F structural diagrams. Ungated: unlike Manim there is nothing to install and no video
      // to render — the layout is computed in-process, so the only cost is one small spec call.
      fillStructureSceneOps(client, base.beats),
      // Vega-Lite charts and KaTeX derivations. Ungated for the same reason as structure boards:
      // nothing to install and nothing rendered out of process, so the only cost is one spec call.
      fillSpecBoardOps(client, base.beats),
    ]);

    // Image-Explainer agent (sourceDocument only): label the real visible parts of each provided
    // image, sentence-synced to the narration. Runs after the fills above so it labels the
    // hydrated/finalized image, and before the final cleanup pass so its grounded callouts survive.
    const calloutStats = input.sourceDocument
      ? await fillImageCalloutOpsIncremental(client, base.beats, input.sourceDocument)
      : { costUsd: 0 };

    // Last line of defence, after every fill has had its turn: any teaching beat still without a
    // usable board drops down its engine chain until something lands. This is what makes the
    // "ANIMATION UNAVAILABLE" card unreachable rather than merely rare.
    const fallbackStats = await rescueEmptyBoards(client, base.beats, directorStats.specs, directorStats.forms);

    repairMissingSuprnotesSvgCode(base.beats, input.sourceDocument);
    repairMissingSuprnotesBoards(base.beats, input.sourceDocument);
    finalizeSuprnotesBeats(base.beats, input.sourceDocument);
    cleanProvidedImageBoards(base.beats, input.sourceDocument);
    const costUsd = base.textCost + visionCostUsd + imageCostUsd + referenceImageStats.costUsd + reactAnimationStats.costUsd + boardStats.costUsd + calloutStats.costUsd + manimSceneStats.costUsd + structureStats.costUsd + specBoardStats.costUsd + directorStats.costUsd + fallbackStats.costUsd;

    if (input.sourceDocument) {
      await writeCachedLecture(cacheKey, { beats: base.beats, costUsd, topic: input.topic });
    }

    return NextResponse.json({ topic: input.topic, beats: base.beats, costUsd, referenceImageStats, animationStats: reactAnimationStats, boardStats, manimSceneStats, structureStats });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Lecture generation failed" },
      { status: 502 }
    );
  }
}

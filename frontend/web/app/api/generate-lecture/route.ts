import { NextResponse } from "next/server";
import OpenAI from "openai";
import { DRAW_LECTURE_SYSTEM_PROMPT, PPTX_LECTURE_SYSTEM_PROMPT } from "@/lib/drawPrompt";
import { assertLectureDepth, lectureDepthStats, sanitizeDrawLecture, scriptWordCount, stripInlineMath } from "@/lib/drawSanitize";
import { fillImageOps, fillImageOpsIncremental, pauseImageOps, type ImageFillStats } from "@/lib/imageGen";
import { fillReactAnimationOps, fillReactAnimationOpsIncremental, type ReactAnimationFillStats } from "@/lib/reactAnimationGen";
import { fillBlackboardOps, fillBlackboardOpsIncremental, type BlackboardFillStats } from "@/lib/blackboardGen";
import { fillImageCalloutOpsIncremental } from "@/lib/imageCalloutGen";
import { describeAssetsWithVision } from "@/lib/imageVision";
import { lectureCacheKey, readCachedLecture, writeCachedLecture } from "@/lib/lectureCache";
import {
  applySuprnotesPaperSurface,
  applySuprnotesPaperLayout,
  cleanProvidedImageBoards,
  composeSuprnotesPaperBoards,
  compactSuprnotesForPrompt,
  ensureSuprnotesAssetUsage,
  enforcePlannedSuprnotesVisualModes,
  hydrateProvidedImageOps,
  isSuprnotesLessonInput,
  removeUnhydratedSuprnotesImageOps,
  repairMissingSuprnotesSvgCode,
  repairMissingSuprnotesBoards,
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
const REACT_ANIMATION_WARMUP_COUNT = Math.max(0, Math.min(8, Number(process.env.REACT_ANIMATION_WARMUP_COUNT ?? 2)));

// Kill switch for the dynamic model-authored chalk blackboard pipeline (see lib/blackboardGen.ts).
// When off, drawSanitize keeps synthesizing blackboards from templates (no extra model call) and
// no chalkBoard placeholders reach here to fill. Client mirror: NEXT_PUBLIC_BLACKBOARD_GEN_ENABLED.
const BLACKBOARD_GEN_ENABLED = process.env.BLACKBOARD_GEN_ENABLED === "1";
const BLACKBOARD_WARMUP_COUNT = Math.max(0, Math.min(8, Number(process.env.BLACKBOARD_WARMUP_COUNT ?? 2)));

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
const TEXT_MAX_TOKENS = Math.max(8_000, Math.min(16_000, Number(process.env.OPENAI_LECTURE_MAX_TOKENS ?? 14_000)));
const DEEPEN_ATTEMPTS = Math.max(1, Math.min(3, Number(process.env.OPENAI_LECTURE_DEEPEN_ATTEMPTS ?? 2)));

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
  /** Skip the lesson cache and force a full regeneration. */
  refresh?: boolean;
};

type BaseLecture = {
  beats: Beat[];
  textCost: number;
};

function textCostUsd(usage: OpenAI.Chat.Completions.ChatCompletion["usage"] | undefined): number {
  return usage ? usage.prompt_tokens * TEXT_INPUT_PRICE + usage.completion_tokens * TEXT_OUTPUT_PRICE : 0;
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

async function deepenLectureScripts(client: OpenAI, topic: string, mood: string, rawLecture: unknown, beats: Beat[]): Promise<number> {
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
              "Rewrite only the spoken script. Teaching beats need 75-95 words each. Intro needs 60-80 words. " +
              "Checkpoint scripts need 25-45 words. Recap needs 85-105 words. Total output should create 900-1100 spoken words. " +
              "Use warm natural spoken language, concrete examples, misconception warnings, and smooth transitions. No markdown, no bullets.",
          },
          {
            role: "user",
            content: JSON.stringify({
              topic,
              mood,
              failedDepthStats: stats,
              instruction:
                "Expand these scripts so the lecture feels like a real 5-minute explanation. Keep the same beat ids and return one script per beat.",
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
      const deepenedBeats = sanitizeDrawLecture(rawLecture, { enforceDepth: false });
      assertLectureDepth(deepenedBeats);
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

  if (input.sourceDocument) {
    return (
      `${base}\nThe student provided a structured Suprnotes-style source document. Treat this document as the primary lesson source:\n` +
      `${compactSuprnotesForPrompt(input.sourceDocument)}\n\n` +
      `STRICT LESSON CONTRACT RULES: If lessonPlan or suggestedLecturePlan is present, follow its beat order, targetBeatCount, titles, sourceBlockIds, objectives, and recommendedVisual choices as the required lecture plan. Do not reorder or merge beats unless the plan explicitly allows it. ` +
      `Every planned beat must be explained in depth: write a teacher script that fully teaches the sourceBlockIds assigned to that beat, not a one-line summary. Ten detailed beats are acceptable and preferred over many thin beats. ` +
      `Use only facts from contentBlocks, assets, lessonPlan/suggestedLecturePlan, and webPreview items. Treat webPreview as optional enrichment: include a web claim only if it is explicitly present in webPreview.claims/summary and useful for the assigned beat; do not invent extra web facts. ` +
      `If contentGovernance says grounding or hallucination controls are strict, every concrete claim in the script must be traceable to a source block or webPreview item. If a detail is not in the source, either omit it or phrase it as a general teaching analogy, not as a fact. ` +
      `Use the contentBlocks as the factual backbone and use their source order only when no explicit lesson plan is provided. ` +
      `Use provided assets when a visual helps: for an image beat, emit an image op with the matching "assetId" from the assets list, plus a short prompt describing what the asset shows. ` +
      `Do not invent chemistry-specific layouts, exact coordinates, or examples outside the source; choose layout, callout text, and placement dynamically from the content and asset descriptions. ` +
      `Do not ask for AI-generated images for this source document. If an image beat is useful, it must use one of the provided assetId values. ` +
      `Make the visuals feel like a clean teaching whiteboard: generous whitespace, centered headings, readable gray/colored marker text, and callouts placed around the provided image without covering the key content. ` +
      `WRITE-THEN-TELL: the board is written stroke-by-stroke as you speak, so pace each script so a thing is introduced in one sentence and explained in the next ("Let's write the recurrence… OPT(j) is the best value using the first j requests… it either includes request j or skips it"). Short, sequential sentences that each add ONE idea, so each board line lands with its sentence — not one dense run-on. ` +
      `EXPLAIN THE IMAGES: for every image beat, the script must actively WALK THE STUDENT THROUGH the provided image using its description — name what is visible, point out each labeled part, and say what it means — never just "as you can see here". Spend 2-4 sentences teaching from the picture. ` +
      `Build the complete lecture now from the plan: teacher script, board layouts, provided-image callouts, SVG/paper board choices, and checkpoints.${retryGuidance}`
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
      `Use the slide text and data as your factual source (do not invent content). Choose board types freely — blackboard / image / animation — based on what fits each idea best, following the same rhythm as a free-topic lecture.` +
      `${diagramLine}${imageRefBlock}` +
      `\nBuild the complete lecture now: teacher script, animated drawn boards with contextual image ops, and checkpoints.${retryGuidance}`
    );
  }

  return `${base}Build the complete lecture now: teacher script, animated drawn boards with contextual image ops, and checkpoints.${retryGuidance}`;
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
      let beats = sanitizeDrawLecture(rawLecture, { enforceDepth: false });

      // Tally the text-generation cost from actual token usage.
      let textCost = textCostUsd(completion.usage);

      try {
        assertLectureDepth(beats);
      } catch {
        textCost += await deepenLectureScripts(client, input.topic, input.mood, rawLecture, beats);
        beats = sanitizeDrawLecture(rawLecture, { enforceDepth: false });
        assertLectureDepth(beats);
      }

      return { beats, textCost };
    } catch (err) {
      lastError = err instanceof Error ? err.message : "Lecture generation failed";
    }
  }

  throw new Error(lastError);
}

function disabledAnimationStats(): ReactAnimationFillStats {
  return { costUsd: 0, pending: 0, filled: 0, rejected: 0, issues: ["REACT_ANIMATIONS_ENABLED is not 1"] };
}

function disabledImageStats(beats: Beat[]): ImageFillStats {
  return pauseImageOps(beats);
}

function noImageWorkStats(): ImageFillStats {
  return { costUsd: 0, pending: 0, filled: 0, failed: 0 };
}

function disabledBlackboardStats(): BlackboardFillStats {
  return { costUsd: 0, pending: 0, filled: 0, rejected: 0, issues: ["BLACKBOARD_GEN_ENABLED is not 1"] };
}

function mergeBlackboardStats(first: BlackboardFillStats, second: BlackboardFillStats): BlackboardFillStats {
  return {
    costUsd: first.costUsd + second.costUsd,
    pending: first.pending + second.pending,
    filled: first.filled + second.filled,
    rejected: first.rejected + second.rejected,
    issues: [...first.issues, ...second.issues].slice(0, 5),
  };
}

function mergeAnimationStats(first: ReactAnimationFillStats, second: ReactAnimationFillStats): ReactAnimationFillStats {
  return {
    costUsd: first.costUsd + second.costUsd,
    pending: first.pending + second.pending,
    filled: first.filled + second.filled,
    rejected: first.rejected + second.rejected,
    issues: [...first.issues, ...second.issues].slice(0, 5),
  };
}

function finalizeSuprnotesBeats(beats: Beat[], sourceDocument: SuprnotesLessonInput | null): void {
  if (!sourceDocument) return;
  // Render LaTeX math as readable text in the spoken script + title (so captions/TTS never show
  // raw `$P_x$`). Idempotent — safe across the repeated finalize calls. Preserves sentence
  // boundaries so the blackboard engine's sentence-sync stays aligned with the client.
  for (const beat of beats) {
    if (typeof beat.script === "string") beat.script = stripInlineMath(beat.script);
    // NOTE: beat.title is DISPLAYED (board caption), not spoken — keep its `$…$` for KaTeX.
  }
  ensureSuprnotesAssetUsage(beats, sourceDocument);
  hydrateProvidedImageOps(beats, sourceDocument);
  removeUnhydratedSuprnotesImageOps(beats, sourceDocument);
  cleanProvidedImageBoards(beats, sourceDocument);
  enforcePlannedSuprnotesVisualModes(beats, sourceDocument);
  composeSuprnotesPaperBoards(beats, sourceDocument);
  applySuprnotesPaperSurface(beats, sourceDocument);
  applySuprnotesPaperLayout(beats, sourceDocument);
}

function streamLecture(client: OpenAI, input: LectureBuildInput): Response {
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (payload: Record<string, unknown>) => {
        controller.enqueue(encoder.encode(`${JSON.stringify(payload)}\n`));
      };

      let streamedVisionCostUsd = 0;
      try {
        // Cache: replaying the SAME folder is instant and free. Key covers the source document,
        // topic/mood, model and CACHE_VERSION (see lib/lectureCache.ts). `refresh` forces a rebuild.
        const cacheKey = lectureCacheKey({
          topic: input.topic,
          mood: input.mood,
          slideContext: input.slideContext,
          sourceDocument: input.sourceDocument,
          model: MODEL,
        });
        if (!input.refresh) {
          const cached = await readCachedLecture(cacheKey);
          if (cached) {
            send({ type: "status", stage: "cache", message: "Loading this lesson from cache" });
            send({ type: "lecture", topic: cached.topic || input.topic, beats: cached.beats, costUsd: 0 });
            send({ type: "done", topic: cached.topic || input.topic, costUsd: 0, cached: true });
            return; // the outer `finally` closes the controller — closing here too aborts the stream
          }
        }

        // Vision pass FIRST: look at each provided image and rewrite its description from the actual
        // pixels, so the director's script and the image-explainer's labels teach the real picture.
        if (input.sourceDocument) {
          send({ type: "status", stage: "vision", message: "Looking at the images" });
          streamedVisionCostUsd = await describeAssetsWithVision(client, input.sourceDocument);
        }
        send({ type: "status", stage: "text", message: "Writing the lecture script and boards" });
        const base = await generateBaseLecture(client, input);
        finalizeSuprnotesBeats(base.beats, input.sourceDocument);
        const useOnlyProvidedImages = shouldUseOnlyProvidedImages(input.sourceDocument);
        const imageStatsWhenPaused = IMAGE_GENERATION_ENABLED && !useOnlyProvidedImages
          ? null
          : useOnlyProvidedImages
            ? noImageWorkStats()
            : disabledImageStats(base.beats);
        finalizeSuprnotesBeats(base.beats, input.sourceDocument);
        let streamedAssetCostUsd = (imageStatsWhenPaused?.costUsd ?? 0) + streamedVisionCostUsd;

        let warmedAnimationStats: ReactAnimationFillStats = { costUsd: 0, pending: 0, filled: 0, rejected: 0, issues: [] };
        if (input.sourceDocument) {
          // Full multi-agent pipeline for task-folder lessons: generate the real React animation
          // for every animation beat (rendered in the sandbox), grounded in the source. Any beat
          // that fails validation falls back to the deterministic whiteboard so it never renders
          // "Animation unavailable". Synchronous (before the lecture is sent) — quality over speed.
          send({ type: "status", stage: "svg-boards", message: "Animating the key ideas (sandboxed React)" });
          warmedAnimationStats = await fillReactAnimationOpsIncremental(client, base.beats);
          repairMissingSuprnotesSvgCode(base.beats, input.sourceDocument);
          finalizeSuprnotesBeats(base.beats, input.sourceDocument);
          streamedAssetCostUsd += warmedAnimationStats.costUsd;
        } else if (REACT_ANIMATIONS_ENABLED && REACT_ANIMATION_WARMUP_COUNT > 0) {
          send({
            type: "status",
            stage: "animation-warmup",
            message: "Preparing the first animation beats before playback",
          });
          warmedAnimationStats = await fillReactAnimationOpsIncremental(
            client,
            base.beats,
            undefined,
            { limit: REACT_ANIMATION_WARMUP_COUNT }
          );
          streamedAssetCostUsd += warmedAnimationStats.costUsd;
        }

        let warmedBoardStats: BlackboardFillStats = { costUsd: 0, pending: 0, filled: 0, rejected: 0, issues: [] };
        if (input.sourceDocument) {
          // Write the concept boards with the sentence-synced chalkboard engine so each row is
          // drawn as its sentence is spoken (write-then-tell). Failed boards fall back to the
          // deterministic notes board so a beat is never blank.
          send({ type: "status", stage: "board-warmup", message: "Writing the classroom boards, in sync with the voice" });
          warmedBoardStats = await fillBlackboardOpsIncremental(client, base.beats);
          finalizeSuprnotesBeats(base.beats, input.sourceDocument);
          streamedAssetCostUsd += warmedBoardStats.costUsd;
        } else if (BLACKBOARD_GEN_ENABLED && BLACKBOARD_WARMUP_COUNT > 0) {
          send({ type: "status", stage: "board-warmup", message: "Preparing the first blackboards before playback" });
          warmedBoardStats = await fillBlackboardOpsIncremental(client, base.beats, undefined, { limit: BLACKBOARD_WARMUP_COUNT });
          finalizeSuprnotesBeats(base.beats, input.sourceDocument);
          streamedAssetCostUsd += warmedBoardStats.costUsd;
        }

        // Image-Explainer agent: for beats showing a provided image, add a few accurate labels
        // grounded ONLY in the image's real description, revealed in sync as the teacher explains
        // each part. Runs after clean/hydrate (finalize above) so it labels the real image; the
        // grounded callouts survive the pre-send finalize (cleanProvidedImageBoards keeps them).
        if (input.sourceDocument) {
          send({ type: "status", stage: "image-explainer", message: "Labelling the images to explain them" });
          const calloutStats = await fillImageCalloutOpsIncremental(client, base.beats, input.sourceDocument);
          streamedAssetCostUsd += calloutStats.costUsd;
        }

        // Guarantee every Suprnotes SVG-board beat has renderable code before the client plays it.
        // When REACT_ANIMATIONS_ENABLED is off (the default), the block above is skipped and these
        // ops would otherwise reach the player with only a prompt brief and no code — rendering as
        // "Animation unavailable" with the raw brief text on the board. This deterministic fallback
        // is idempotent (only fills ops that still lack code), so it never clobbers a real animation.
        // Finalize FIRST, then apply the deterministic fallbacks LAST — a finalize after the board
        // fallback would re-compose the replaced board back into an empty chalk placeholder (the
        // "chalk-FAILED" bug). Nothing mutates beats after these repairs before the send.
        if (input.sourceDocument) {
          finalizeSuprnotesBeats(base.beats, input.sourceDocument);
          repairMissingSuprnotesSvgCode(base.beats, input.sourceDocument);
          repairMissingSuprnotesBoards(base.beats, input.sourceDocument);
        }

        send({ type: "lecture", topic: input.topic, beats: base.beats, costUsd: base.textCost + streamedAssetCostUsd });

        send({
          type: "status",
          stage: "assets",
          message: IMAGE_GENERATION_ENABLED
            ? "Generating images and sandboxed animations"
            : "Image generation paused; finishing sandboxed animations",
        });
        const imagePromise = IMAGE_GENERATION_ENABLED && !useOnlyProvidedImages
          ? fillImageOpsIncremental(client, base.beats, (update) => {
              finalizeSuprnotesBeats(base.beats, input.sourceDocument);
              streamedAssetCostUsd += update.costUsd;
              send({
                type: "beat",
                asset: update.phase === "image" ? "image" : "image-fallback",
                beatIndex: update.beatIndex,
                beat: update.beat,
                costUsd: base.textCost + streamedAssetCostUsd,
              });
            })
          : Promise.resolve(imageStatsWhenPaused ?? disabledImageStats(base.beats));
        const animationPromise = REACT_ANIMATIONS_ENABLED
          ? fillReactAnimationOpsIncremental(client, base.beats, (update) => {
              finalizeSuprnotesBeats(base.beats, input.sourceDocument);
              streamedAssetCostUsd += update.costUsd;
              send({
                type: "beat",
                asset: update.status === "ready" ? "animation" : "animation-failed",
                beatIndex: update.beatIndex,
                beat: update.beat,
                costUsd: base.textCost + streamedAssetCostUsd,
              });
            })
          : Promise.resolve(disabledAnimationStats());
        const boardPromise = BLACKBOARD_GEN_ENABLED
          ? fillBlackboardOpsIncremental(client, base.beats, (update) => {
              finalizeSuprnotesBeats(base.beats, input.sourceDocument);
              streamedAssetCostUsd += update.costUsd;
              send({
                type: "beat",
                asset: update.status === "ready" ? "board" : "board-failed",
                beatIndex: update.beatIndex,
                beat: update.beat,
                costUsd: base.textCost + streamedAssetCostUsd,
              });
            })
          : Promise.resolve(disabledBlackboardStats());

        const [imageStats, remainingAnimationStats, remainingBoardStats] = await Promise.all([
          imagePromise,
          animationPromise,
          boardPromise,
        ]);
        const animationStats = mergeAnimationStats(warmedAnimationStats, remainingAnimationStats);
        const boardStats = mergeBlackboardStats(warmedBoardStats, remainingBoardStats);
        const costUsd = base.textCost + streamedVisionCostUsd + imageStats.costUsd + animationStats.costUsd + boardStats.costUsd;
        finalizeSuprnotesBeats(base.beats, input.sourceDocument);
        // Cache the finished lecture so replaying this exact folder is instant and free next time.
        await writeCachedLecture(cacheKey, { beats: base.beats, costUsd, topic: input.topic });
        send({ type: "done", topic: input.topic, costUsd, imageStats, animationStats, boardStats });
      } catch (err) {
        send({
          type: "error",
          error: err instanceof Error ? err.message : "Lecture generation failed",
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
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

  const input: LectureBuildInput = {
    topic: effectiveTopic,
    mood,
    slideContext,
    diagramHints,
    slideImages,
    sourceDocument,
    refresh: body.refresh === true,
  };
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  if (body.stream === true || req.headers.get("accept")?.includes("application/x-ndjson")) {
    return streamLecture(client, input);
  }

  try {
    const base = await generateBaseLecture(client, input);
    finalizeSuprnotesBeats(base.beats, input.sourceDocument);
    const useOnlyProvidedImages = shouldUseOnlyProvidedImages(input.sourceDocument);

    // Step 2: fill each "image" op placeholder with a real generated image, and (if enabled)
    // each "reactAnimation" op placeholder with generated component source — in parallel with
    // each other since they touch disjoint beats and are both I/O-bound. Individual failures
    // in either degrade gracefully (dropped image / explicit animation unavailable state).
    const [imageCostUsd, reactAnimationStats, boardStats] = await Promise.all([
      IMAGE_GENERATION_ENABLED && !useOnlyProvidedImages ? fillImageOps(client, base.beats) : Promise.resolve(disabledImageStats(base.beats).costUsd),
      REACT_ANIMATIONS_ENABLED ? fillReactAnimationOps(client, base.beats) : Promise.resolve(disabledAnimationStats()),
      BLACKBOARD_GEN_ENABLED ? fillBlackboardOps(client, base.beats) : Promise.resolve(disabledBlackboardStats()),
    ]);

    repairMissingSuprnotesSvgCode(base.beats, input.sourceDocument);
    finalizeSuprnotesBeats(base.beats, input.sourceDocument);
    const costUsd = base.textCost + imageCostUsd + reactAnimationStats.costUsd + boardStats.costUsd;
    return NextResponse.json({ topic: input.topic, beats: base.beats, costUsd, animationStats: reactAnimationStats, boardStats });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Lecture generation failed" },
      { status: 502 }
    );
  }
}

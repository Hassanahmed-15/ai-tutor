import { NextResponse } from "next/server";
import OpenAI from "openai";
import {
  CLARIFY_TOPIC_SYSTEM_PROMPT,
  DOCUMENT_QUESTION_OUTLINE_SYSTEM_PROMPT,
  DOCUMENT_SCOPE_SYSTEM_PROMPT,
  OUTLINE_LESSON_SYSTEM_PROMPT,
  REVISE_OUTLINE_SYSTEM_PROMPT,
  PLANNING_ANGLES,
  type PlanOutline,
  type PlanningAngleId,
} from "@/lib/planPrompt";
import { isSuprnotesLessonInput, type SuprnotesLessonInput } from "@/lib/suprnotes";
import {
  MAX_DIAGNOSTIC_QUESTIONS,
  applyDiagnostic,
  sanitizeLearnerProfile,
  hasEnoughSignal,
  profileSummary,
  resolveDepth,
  type DepthLevel,
  type LearnerProfile,
} from "@/lib/learnerProfile";
import { DIAGNOSTIC_SYSTEM_PROMPT, buildDiagnosticUserMessage } from "@/lib/diagnosticPrompt";
import { learnerInstruction } from "@/lib/learnerProfile";
import { outlineLearnerInstruction } from "@/lib/planPrompt";
import { polishBeatPlan } from "@/lib/beatPresentation";
import { costFor } from "@/lib/modelPricing";
import { sanitizeDocumentPlanningQuestions } from "@/lib/documentLessonPlanning";
import { focusFromTranscript, focusPassages, focusPromptSection, subjectFromFocus } from "@/lib/pdfFocus";
import { sourceScopeInstruction, type SourceScope } from "@/lib/sourceScope";

/**
 * Compact, planning-sized summary of an uploaded source document (PDF/PPTX) — just enough for
 * the clarify/outline calls to ground their questions and subtopics in what the document ACTUALLY
 * contains, instead of free-associating from the bare topic string (which is often just a title
 * line and can drift the outline to an unrelated, more "famous" topic in the same general area).
 * Deliberately smaller than compactSuprnotesForPrompt (lib/suprnotes.ts) — that one feeds the full
 * lecture-generation call and needs the complete text/asset detail; this only needs enough of each
 * section's heading + gist for a cheap gpt-4o-mini call to sketch a structurally sound outline.
 */
function summarizeSourceDocumentForPlanning(doc: SuprnotesLessonInput): string {
  const blocks = (doc.contentBlocks ?? [])
    .slice()
    .sort((a, b) => (a.sourceOrder ?? 0) - (b.sourceOrder ?? 0))
    .slice(0, 40)
    .map((b) => {
      const heading = (b.heading ?? "").trim();
      const gist = (b.text ?? "").trim().slice(0, 220);
      const location = typeof b.pageNumber === "number" ? ` [page/slide ${b.pageNumber}]` : "";
      return `- ${heading || "(untitled section)"}${location}: ${gist}`;
    })
    .join("\n");
  return blocks || "(no readable content extracted)";
}

/**
 * Cheap, fast pre-generation planning calls: "clarify" checks whether a typed topic is
 * genuinely ambiguous and, if so, proposes quick-reply disambiguation questions. It no longer
 * decides pre-draft planning questions (prior knowledge, scope, emphasis) — that is now the
 * adaptive diagnostic conversation ("diagnose", driven by diagnosticPrompt.ts), which fires for
 * every non-ambiguous typed topic. "outline"/"revise" sketch or edit
 * subtopic titles/captions/reasons/confidence, and 2-3 individual subtopics ALSO carry their
 * own optional "scopingQuestion" — grounded in that specific subtopic, not the whole lecture.
 * Each question's options carry a ready-to-send revise instruction the client sends straight
 * back through "revise" when picked, reshaping the same outline live (a real planning
 * conversation, not a pre-plan gate). Outline and revise stream NDJSON — as each subtopic's
 * "reason" field completes in the raw token stream, the server emits a `{type:"thought"}`
 * event, and as each subtopic's OWN "scopingQuestion" object completes (nested, requires a
 * balanced-brace scan, not just a regex) the server emits `{type:"scoping-question"}` —
 * interleaved with thoughts as they land, so a question about an already-visible subtopic can
 * appear in chat while later subtopics are still being drafted. This is genuine token-stream
 * extraction (regex + brace-scanning over the growing raw JSON text), not a fake typing
 * animation over an already-complete response. The draft never pauses for an unanswered
 * question — it keeps streaming regardless.
 *
 * Honesty: gpt-4o-mini, small max_tokens — each call is a few hundredths of a cent and
 * returns in ~1-2s, versus the full lecture's gpt-4o call (~$0.10-0.15+ before image/animation
 * costs). Needs OPENAI_API_KEY in frontend/web/.env.local.
 */
const MODEL = process.env.OPENAI_PLAN_MODEL ?? "gpt-4o-mini";

/**
 * "What Aria thinks about this student", from their long-term memory (lib/learnerModel.ts
 * personaForPrompt), as a block for the planning prompts. The client sends it already framed:
 * earlier-lesson background, which what the student says now overrides. Capped here regardless.
 */
function personaLine(value: unknown): string {
  const text = typeof value === "string" ? value.trim().slice(0, 1_000) : "";
  return text ? `\n\n${text}` : "";
}
const OUTLINE_MAX_TOKENS = Math.max(1_700, Math.min(16_000, Number(process.env.OPENAI_PLAN_MAX_TOKENS ?? 8_000)));

// gpt-4o-mini pricing (source: openai.com/api/pricing).

function costUsd(usage: { prompt_tokens?: number; completion_tokens?: number } | undefined): number {
  return costFor(MODEL, usage);
}

type ClarifyQuestion = { question: string; options: string[] };

function sanitizeClarify(raw: unknown): { ambiguous: boolean; questions: ClarifyQuestion[] } {
  const obj = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const rawQuestions = Array.isArray(obj.questions) ? obj.questions : [];
  const questions: ClarifyQuestion[] = [];
  for (const q of rawQuestions) {
    if (!q || typeof q !== "object") continue;
    const question = typeof (q as Record<string, unknown>).question === "string" ? (q as Record<string, unknown>).question as string : "";
    const rawOptions = (q as Record<string, unknown>).options;
    const options = Array.isArray(rawOptions) ? rawOptions.filter((o): o is string => typeof o === "string" && o.trim().length > 0).slice(0, 4) : [];
    if (question.trim() && options.length >= 2) questions.push({ question: question.trim(), options });
    if (questions.length >= 3) break;
  }
  const ambiguous = obj.ambiguous === true && questions.length > 0;

  return { ambiguous, questions };
}

function sanitizeScopingQuestion(raw: unknown): { question: string; options: { label: string; instruction: string }[] } | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const rec = raw as Record<string, unknown>;
  const question = typeof rec.question === "string" ? rec.question.trim() : "";
  const rawOptions = Array.isArray(rec.options) ? rec.options : [];
  const options: { label: string; instruction: string }[] = [];
  for (const o of rawOptions) {
    if (!o || typeof o !== "object") continue;
    const orec = o as Record<string, unknown>;
    const label = typeof orec.label === "string" ? orec.label.trim() : "";
    const instruction = typeof orec.instruction === "string" ? orec.instruction.trim() : "";
    if (label && instruction) options.push({ label: label.slice(0, 40), instruction: instruction.slice(0, 300) });
    if (options.length >= 4) break;
  }
  return question && options.length >= 2 ? { question: question.slice(0, 200), options } : undefined;
}

function words(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().split(/\s+/).filter(Boolean).slice(0, max).join(" ") : "";
}

function sanitizeSafetyNet(raw: unknown): PlanOutline["subtopics"][number]["safetyNet"] {
  if (!raw || typeof raw !== "object") return undefined;
  const rec = raw as Record<string, unknown>;
  const prerequisite = words(rec.prerequisite, 8);
  const diagnostic = words(rec.diagnostic, 24);
  const masterySignal = words(rec.masterySignal, 12);
  const rescueMove = words(rec.rescueMove, 20);
  const reinforcementPrompt = words(rec.reinforcementPrompt, 16);
  const rawAfter = typeof rec.reinforceAfter === "number" ? Math.round(rec.reinforceAfter) : 2;
  const reinforceAfter = Math.max(1, Math.min(3, rawAfter)) as 1 | 2 | 3;
  if (!prerequisite || !diagnostic || !masterySignal || !rescueMove || !reinforcementPrompt) return undefined;
  return { prerequisite, diagnostic, masterySignal, rescueMove, reinforceAfter, reinforcementPrompt };
}


/**
 * Fold the model's assessment of this turn into the profile the client sent.
 *
 * MERGE, NEVER REPLACE. The model sees the conversation but the client holds the accumulated truth,
 * so overwriting would let one turn's omission erase a misconception found two turns earlier. Every
 * list is unioned, and the graded answer goes through `applyDiagnostic` so a concept cannot end up
 * in both mastered and weak.
 */
function mergeAssessment(
  profile: LearnerProfile,
  raw: unknown,
  exchanges: { question: string; answer: string }[],
): LearnerProfile {
  if (!raw || typeof raw !== "object") return profile;
  const assessed = sanitizeLearnerProfile(raw, profile.topic);
  const union = (a: string[], b: string[], cap: number) => {
    const seen = new Set(a.map((v) => v.toLowerCase()));
    return [...a, ...b.filter((v) => !seen.has(v.toLowerCase()))].slice(0, cap);
  };

  let next: LearnerProfile = {
    ...profile,
    // A later self-report supersedes an earlier one; everything else accumulates.
    claimedLevel: assessed.claimedLevel ?? profile.claimedLevel,
    confidence: assessed.confidence !== "unknown" ? assessed.confidence : profile.confidence,
    objective: assessed.objective !== "unknown" ? assessed.objective : profile.objective,
    masteredConcepts: union(profile.masteredConcepts, assessed.masteredConcepts, 8),
    weakConcepts: union(profile.weakConcepts, assessed.weakConcepts, 8),
    misconceptions: union(profile.misconceptions, assessed.misconceptions, 5),
    prerequisiteGaps: union(profile.prerequisiteGaps, assessed.prerequisiteGaps, 5),
    preferredStyle: assessed.preferredStyle ?? profile.preferredStyle,
    background: assessed.background ?? profile.background,
    // The hypothesis is a SYNTHESIS the model re-forms each turn from everything it now knows, so
    // (unlike the lists above, which accumulate) a fresh one supersedes the old one outright — the
    // whole point is that it is allowed to be revised, not merely appended to.
    teachingHypothesis: assessed.teachingHypothesis ?? profile.teachingHypothesis,
    // A redirect, once set, holds — the student is not going to un-redirect by the model simply
    // not mentioning it on a later turn where nothing about the redirect changed.
    redirectedFocus: assessed.redirectedFocus ?? profile.redirectedFocus,
    updatedAt: new Date().toISOString(),
  };

  const graded = (raw as Record<string, unknown>).gradedAnswer;
  const last = exchanges[exchanges.length - 1];
  if (graded && typeof graded === "object" && last) {
    const g = graded as Record<string, unknown>;
    const verdict = (["correct", "partial", "incorrect", "misconception", "skipped"] as const).includes(g.verdict as never)
      ? (g.verdict as LearnerProfile["diagnostics"][number]["verdict"])
      : "skipped";
    next = applyDiagnostic(next, {
      question: last.question,
      answer: last.answer,
      verdict,
      concept: typeof g.concept === "string" ? g.concept.trim().slice(0, 120) || undefined : undefined,
      misconception: typeof g.misconception === "string" ? g.misconception.trim().slice(0, 200) || undefined : undefined,
      // Carried through so a boast cannot count as its own verification — see hasEnoughSignal.
      selfReport: g.selfReport === true,
    });
  }
  return next;
}

/** Accept a source scope from the client without trusting any of it. Anything malformed degrades
 *  to null (treated as "no scope constraint" by the caller) rather than throwing. */
function sanitizeSourceScope(raw: unknown): SourceScope | null {
  if (!raw || typeof raw !== "object") return null;
  const rec = raw as Record<string, unknown>;
  const fidelity = rec.fidelity === "strict" ? "strict" : rec.fidelity === "reference" ? "reference" : null;
  if (!fidelity) return null;

  const rawBreadth = rec.breadth && typeof rec.breadth === "object" ? (rec.breadth as Record<string, unknown>) : null;
  const breadthKind = rawBreadth?.kind;
  const focus = typeof rawBreadth?.focus === "string" ? rawBreadth.focus.trim().slice(0, 240) : "";
  const breadth: SourceScope["breadth"] =
    (breadthKind === "section" || breadthKind === "question") && focus
      ? { kind: breadthKind, focus }
      : { kind: "whole" };

  const documentLabels = Array.isArray(rec.documentLabels)
    ? rec.documentLabels.filter((v): v is string => typeof v === "string" && v.trim().length > 0).map((v) => v.trim().slice(0, 120)).slice(0, 8)
    : [];

  return { breadth, fidelity, documentLabels };
}

/** One question, or none. Anything malformed becomes none — a bad question is worse than silence. */
function sanitizeDiagnosticQuestion(raw: unknown): { question: string; kind: string; options: string[] } | null {
  if (!raw || typeof raw !== "object") return null;
  const rec = raw as Record<string, unknown>;
  const question = typeof rec.question === "string" ? rec.question.trim() : "";
  if (!question) return null;
  const options = Array.isArray(rec.options)
    ? rec.options.filter((o): o is string => typeof o === "string" && o.trim().length > 0).map((o) => o.trim().slice(0, 40)).slice(0, 4)
    : [];
  const kind = typeof rec.kind === "string" && ["explain", "predict", "compare", "apply", "goal"].includes(rec.kind)
    ? rec.kind
    : "explain";
  // A single option is not a choice; either offer real quick replies or let them type.
  return { question: question.slice(0, 240), kind, options: options.length >= 2 ? options : [] };
}

/** How deep the SUBJECT can go, independent of the student. Caps depth so a simple topic cannot be
 *  taught at expert level — see resolveDepth. Defaults to 3 when the client has no estimate. */
function topicComplexity(raw: unknown): DepthLevel {
  const n = typeof raw === "number" ? Math.round(raw) : 3;
  return Math.max(1, Math.min(5, n)) as DepthLevel;
}

function sanitizeOutline(raw: unknown, fallbackTopic: string): PlanOutline {
  const obj = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const topic = typeof obj.topic === "string" && obj.topic.trim() ? obj.topic.trim() : fallbackTopic;
  const rawSubtopics = Array.isArray(obj.subtopics) ? obj.subtopics : [];
  const subtopics: PlanOutline["subtopics"] = [];
  let scopingQuestionCount = 0;
  let safetyNetCount = 0;
  for (const s of rawSubtopics) {
    if (!s || typeof s !== "object") continue;
    const rec = s as Record<string, unknown>;
    const title = typeof rec.title === "string" ? rec.title : "";
    const caption = typeof rec.caption === "string" ? rec.caption : "";
    const reason = typeof rec.reason === "string" ? rec.reason : "";
    const confidence = rec.confidence === "low" ? "low" as const : undefined;
    const safetyNet = safetyNetCount < 2 ? sanitizeSafetyNet(rec.safetyNet) : undefined;
    if (safetyNet) safetyNetCount++;
    // Cap total scoping questions across the whole outline at 3, same as before — just spread
    // across subtopics now instead of collected in one top-level array.
    const scopingQuestion = scopingQuestionCount < 3 ? sanitizeScopingQuestion(rec.scopingQuestion) : undefined;
    if (scopingQuestion) scopingQuestionCount++;
    if (title.trim()) subtopics.push({ title: title.trim().slice(0, 80), caption: caption.trim().slice(0, 160), reason: reason.trim().slice(0, 140), confidence, safetyNet, scopingQuestion });
  }
  const polished = polishBeatPlan(
    subtopics.map((subtopic) => ({ title: subtopic.title, objective: subtopic.caption })),
    topic,
  );
  return {
    topic,
    subtopics: subtopics.map((subtopic, index) => ({
      ...subtopic,
      title: polished[index]?.title ?? subtopic.title,
    })),
  };
}

function sanitizeSingleSubtopic(raw: unknown): PlanOutline["subtopics"][number] | undefined {
  const outline = sanitizeOutline({ topic: "partial", subtopics: [raw] }, "partial");
  return outline.subtopics[0];
}

function focusedSubtopic(subtopic: PlanOutline["subtopics"][number], index: number): PlanOutline["subtopics"][number] {
  const uncertain = /\b(?:clarif\w*|unsure|uncertain|need to (?:know|decide|ask)|what the student means)\b/i.test(subtopic.reason ?? "");
  return {
    title: subtopic.title,
    caption: subtopic.caption,
    reason: uncertain
      ? (index === 0
          ? "I will establish the exact source setup before tracing its steps."
          : "This source-grounded step is required to answer the student's question.")
      : subtopic.reason,
  };
}

async function ensureSafetyNets(client: OpenAI, outline: PlanOutline): Promise<{ outline: PlanOutline; costUsd: number }> {
  if (outline.subtopics.some((subtopic) => subtopic.safetyNet) || outline.subtopics.length < 4) {
    return { outline, costUsd: 0 };
  }

  try {
    const completion = await client.chat.completions.create({
      model: MODEL,
      messages: [
        {
          role: "system",
          content:
            "You are an expert teacher adding invisible Plan B routes to an already-approved lesson outline. " +
            "Return JSON only: {\"safetyNets\":[{\"subtopicIndex\":number,\"prerequisite\":string,\"diagnostic\":string,\"masterySignal\":string,\"rescueMove\":string,\"reinforceAfter\":1|2|3,\"reinforcementPrompt\":string}]}. " +
            "Choose exactly TWO genuine conceptual bottlenecks, never the introduction or recap. Use zero-based subtopicIndex. " +
            "The diagnostic must be a natural 10-second prediction/explanation question, not trivia. masterySignal is the key idea a ready answer contains. " +
            "rescueMove is a concrete micro-example, analogy, or visual rewind used only if that idea is absent. reinforcementPrompt retrieves the same idea 1-3 subtopics later where it helps with new learning. " +
            "Be specific to this lesson. Do not add topics, scripts, quizzes, or commentary.",
        },
        { role: "user", content: JSON.stringify(outline) },
      ],
      temperature: 0.35,
      max_tokens: 750,
      response_format: { type: "json_object" },
    });
    const raw = JSON.parse(completion.choices[0]?.message?.content ?? "{}");
    const entries = Array.isArray(raw.safetyNets) ? raw.safetyNets : [];
    const next = outline.subtopics.map((subtopic) => ({ ...subtopic }));
    let added = 0;
    for (const entry of entries) {
      if (!entry || typeof entry !== "object") continue;
      const rec = entry as Record<string, unknown>;
      const index = typeof rec.subtopicIndex === "number" ? Math.round(rec.subtopicIndex) : -1;
      if (index <= 0 || index >= next.length - 1 || next[index]?.safetyNet) continue;
      const safetyNet = sanitizeSafetyNet(rec);
      if (!safetyNet) continue;
      next[index] = { ...next[index], safetyNet };
      added++;
      if (added >= 2) break;
    }
    if (added > 0) return { outline: { ...outline, subtopics: next }, costUsd: costUsd(completion.usage) };
  } catch {
    // A planning outline is still useful if the enrichment call fails. The deterministic
    // fallback below keeps the adaptive route available without failing the whole planner.
  }

  const fallbackIndex = Math.min(outline.subtopics.length - 2, Math.max(1, Math.floor(outline.subtopics.length / 2)));
  const previous = outline.subtopics[fallbackIndex - 1];
  const target = outline.subtopics[fallbackIndex];
  const fallback = {
    prerequisite: previous.title,
    diagnostic: `How does ${previous.title} prepare us for ${target.title}?`,
    masterySignal: `connects ${previous.title} to ${target.title}`,
    rescueMove: `Revisit ${previous.title} through one concrete example, then reconnect it to ${target.title}.`,
    reinforceAfter: 2 as const,
    reinforcementPrompt: `Where is ${previous.title} doing work in this new idea?`,
  };
  return {
    outline: {
      ...outline,
      subtopics: outline.subtopics.map((subtopic, index) => index === fallbackIndex ? { ...subtopic, safetyNet: fallback } : subtopic),
    },
    costUsd: 0,
  };
}

const REASON_PATTERN = /"reason"\s*:\s*"((?:[^"\\]|\\.)*)"/g;

/** Finds every completed `"reason": "..."` match in the buffer so far — the single source of
 *  match objects both extractNewReasons (the text) and extractNewScopingQuestions (the anchor
 *  position to search after) derive from, keeping the two extractors in lockstep per subtopic. */
function findReasonMatches(buffer: string): RegExpMatchArray[] {
  return [...buffer.matchAll(REASON_PATTERN)];
}

/** Incrementally pulls completed `"reason": "..."` string values out of a growing raw JSON
 *  text buffer, returning any newly-completed ones since the last call (tracked by count). */
function extractNewReasons(reasonMatches: RegExpMatchArray[], alreadyEmitted: number): { reasons: string[]; total: number } {
  const reasons = reasonMatches.map((m) => m[1].replace(/\\"/g, '"'));
  return { reasons: reasons.slice(alreadyEmitted), total: reasons.length };
}

/** Pulls completed subtopic objects out of the in-flight JSON buffer. This lets the UI show the
 *  actual outline as Aria is drafting it, instead of waiting for the final complete JSON object.
 *  The scanner is string-aware and brace-balanced so nested scopingQuestion/options objects do
 *  not confuse it. */
function extractNewSubtopics(
  buffer: string,
  alreadyEmitted: number
): { subtopics: PlanOutline["subtopics"]; total: number } {
  const keyIndex = buffer.indexOf('"subtopics"');
  if (keyIndex < 0) return { subtopics: [], total: alreadyEmitted };
  const arrayStart = buffer.indexOf("[", keyIndex);
  if (arrayStart < 0) return { subtopics: [], total: alreadyEmitted };

  const objectTexts: string[] = [];
  let inString = false;
  let escaped = false;
  let depth = 0;
  let objectStart = -1;

  for (let i = arrayStart + 1; i < buffer.length; i++) {
    const ch = buffer[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') { inString = true; continue; }
    if (ch === "{") {
      if (depth === 0) objectStart = i;
      depth++;
      continue;
    }
    if (ch === "}") {
      depth--;
      if (depth === 0 && objectStart >= 0) {
        objectTexts.push(buffer.slice(objectStart, i + 1));
        objectStart = -1;
      }
      continue;
    }
    if (ch === "]" && depth === 0) break;
  }

  const parsed = objectTexts
    .slice(alreadyEmitted)
    .map((text) => {
      try {
        return sanitizeSingleSubtopic(JSON.parse(text));
      } catch {
        return undefined;
      }
    })
    .filter((subtopic): subtopic is PlanOutline["subtopics"][number] => Boolean(subtopic));

  return { subtopics: parsed, total: objectTexts.length };
}

/** Incrementally pulls completed per-subtopic `"scopingQuestion": {...}` objects out of the
 *  growing buffer — each is anchored to search from right after the Nth "reason" match (the
 *  prompt enforces reason-before-scopingQuestion key order within a subtopic), so a question is
 *  only ever emitted once its OWN subtopic's reason has also completed, matching the order the
 *  student sees subtopics stream in on screen. Returns newly-completed questions since the last
 *  call, each tagged with the subtopic index it belongs to (0-based, matches subtopics[]). */
function extractNewScopingQuestions(
  buffer: string,
  alreadyEmitted: number
): { questions: { subtopicIndex: number; question: string; options: { label: string; instruction: string }[] }[]; total: number } {
  const found: { subtopicIndex: number; question: string; options: { label: string; instruction: string }[] }[] = [];
  const completed = extractNewSubtopics(buffer, 0).subtopics;
  for (let i = 0; i < completed.length; i++) {
    const parsed = completed[i]?.scopingQuestion;
    if (parsed) found.push({ subtopicIndex: i, ...parsed });
  }
  return { questions: found.slice(alreadyEmitted), total: found.length };
}

function angleInstructionLine(angleId: string | undefined): string {
  if (!angleId || angleId === "standard") return "";
  const angle = PLANNING_ANGLES.find((a) => a.id === angleId);
  return angle ? `\nTeaching angle for this outline: ${angle.instruction}` : "";
}

/** Streams outline generation as NDJSON: {type:"thought", text} per completed subtopic reason
 *  and {type:"scoping-question", subtopicIndex, ...} per completed per-subtopic scopingQuestion
 *  (both as they land in the token stream, interleaved — a question about subtopic 2 can arrive
 *  while subtopic 4 is still being drafted, genuine mid-build engagement rather than a batch of
 *  questions tacked onto the finished outline), then a final {type:"outline", ...PlanOutline,
 *  costUsd}. The draft never pauses for a question — streaming continues regardless. */
function streamOutline(
  client: OpenAI,
  systemPrompt: string,
  userContent: string,
  fallbackTopic: string,
  focused = false,
): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (payload: Record<string, unknown>) => controller.enqueue(encoder.encode(`${JSON.stringify(payload)}\n`));
      try {
        const completion = await client.chat.completions.create({
          model: MODEL,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userContent },
          ],
          temperature: 0.6,
          max_tokens: OUTLINE_MAX_TOKENS,
          response_format: { type: "json_object" },
          stream: true,
          stream_options: { include_usage: true },
        });

        let buffer = "";
        let emittedSubtopics = 0;
        let emittedReasons = 0;
        let emittedScopingQuestions = 0;
        let usage: { prompt_tokens?: number; completion_tokens?: number } | undefined;
        for await (const chunk of completion) {
          const delta = chunk.choices[0]?.delta?.content ?? "";
          if (delta) buffer += delta;
          if (chunk.usage) usage = chunk.usage;

          const { subtopics, total: subtopicTotal } = extractNewSubtopics(buffer, emittedSubtopics);
          for (const subtopic of subtopics) {
            const index = emittedSubtopics++;
            send({ type: "subtopic", index, subtopic: focused ? focusedSubtopic(subtopic, index) : subtopic });
          }
          emittedSubtopics = Math.max(emittedSubtopics, subtopicTotal);

          const reasonMatches = findReasonMatches(buffer);
          const { reasons, total } = extractNewReasons(reasonMatches, emittedReasons);
          for (const [offset, reason] of reasons.entries()) {
            const text = focused
              ? focusedSubtopic({ title: "", caption: "", reason }, emittedReasons + offset).reason
              : reason;
            send({ type: "thought", text });
          }
          emittedReasons = total;

          const { questions, total: scopingTotal } = extractNewScopingQuestions(buffer, emittedScopingQuestions);
          for (const q of questions) send({ type: "scoping-question", ...q });
          emittedScopingQuestions = scopingTotal;
        }

        const rawOutline = sanitizeOutline(JSON.parse(buffer || "{}"), fallbackTopic);
        const outline = focused
          ? {
              topic: rawOutline.topic || fallbackTopic,
              subtopics: rawOutline.subtopics.map(focusedSubtopic),
            }
          : rawOutline;
        if (outline.subtopics.length === 0) {
          send({ type: "error", error: "Could not plan an outline for that topic." });
        } else {
          const enriched = focused ? { outline, costUsd: 0 } : await ensureSafetyNets(client, outline);
          send({ type: "outline", ...enriched.outline, costUsd: costUsd(usage) + enriched.costUsd });
        }
      } catch (err) {
        send({ type: "error", error: err instanceof Error ? err.message : "Planning failed" });
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no" },
  });
}

export async function POST(req: Request) {
  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json({ error: "OPENAI_API_KEY not set." }, { status: 503 });
  }

  const body = await req.json().catch(() => ({}));
  const mode = typeof body.mode === "string" ? body.mode : "";
  if (mode !== "clarify" && mode !== "diagnose" && mode !== "document-scope" && mode !== "document-question" && mode !== "outline" && mode !== "revise") {
    return NextResponse.json({ error: "mode must be clarify, diagnose, document-scope, document-question, outline, or revise" }, { status: 400 });
  }

  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  // Present whenever the student uploaded a PDF/PPTX and it's going through planning (unlike
  // Suprnotes JSON/task-folder uploads, which carry their own lessonPlan and skip planning
  // entirely) — grounds the outline in what the document actually says instead of just its title.
  const sourceDocument = isSuprnotesLessonInput(body.sourceDocument) ? (body.sourceDocument as SuprnotesLessonInput) : null;
  const sourceDocLine = sourceDocument
    ? `\n\nThe student uploaded a source document. Its actual content (ground the outline/questions in THIS, not just the topic string — do not drift to a different, more generic subject in the same general area):\n${summarizeSourceDocumentForPlanning(sourceDocument)}`
    : "";

  if (mode === "document-scope") {
    if (!sourceDocument) return NextResponse.json({ error: "sourceDocument is required" }, { status: 400 });
    try {
      const completion = await client.chat.completions.create({
        model: MODEL,
        messages: [
          { role: "system", content: DOCUMENT_SCOPE_SYSTEM_PROMPT },
          { role: "user", content: `Uploaded source topic: "${typeof body.topic === "string" ? body.topic.trim().slice(0, 200) : "Document lesson"}"${sourceDocLine}` },
        ],
        temperature: 0.2,
        max_tokens: 850,
        response_format: { type: "json_object" },
      });
      const parsed = JSON.parse(completion.choices[0]?.message?.content ?? "{}");
      return NextResponse.json({
        planningQuestions: sanitizeDocumentPlanningQuestions(parsed, sourceDocument),
        costUsd: costUsd(completion.usage),
      });
    } catch (err) {
      return NextResponse.json({ error: err instanceof Error ? err.message : "Document planning failed" }, { status: 502 });
    }
  }

  if (mode === "document-question") {
    if (!sourceDocument) return NextResponse.json({ error: "sourceDocument is required" }, { status: 400 });
    const question = typeof body.question === "string" ? body.question.trim().slice(0, 500) : "";
    const transcript = typeof body.transcript === "string" ? body.transcript.trim() : "";
    if (!question && !transcript) return NextResponse.json({ error: "question or selected-page transcript is required" }, { status: 400 });
    const focus = focusFromTranscript(question, transcript) ?? focusPassages(question, sourceDocument);

    /**
     * A LEXICAL MISS IS NOT AN UNANSWERABLE QUESTION.
     *
     * This used to refuse outright — "I could not locate that request in the selected pages" —
     * whenever `focusPassages` came back null. That gate assumed a miss meant the student had asked
     * about something absent from their document. Usually it meant the opposite: they named the one
     * distinctive thing in it.
     *
     * "What does lexquery do" reduces to a single term after stopwords, and `scoreBlock` awards one
     * point for a body match against a MIN_SCORE of two — so a question naming exactly one thing
     * scores below the floor unless that word happens to sit in a heading. The document was full of
     * the answer; the ranker simply had one term to work with and no way to clear its own bar.
     *
     * Refusing was never right, and it is now actively wrong: generation reads the WHOLE document,
     * text and page images together, so nothing needs locating in advance. Planning falls back to
     * the same footing — plan against everything, and let the model find what string matching could
     * not. Grounding is unaffected either way, because the document itself travels with the request.
     */
    const angle = typeof body.angle === "string" ? body.angle : undefined;
    const topicFromBody = typeof body.topic === "string" ? body.topic.trim().slice(0, 200) : "";
    const fallbackTopic = (focus ? subjectFromFocus(focus) : "") || topicFromBody || "Focused explanation";
    const userContent = focus
      ? `${focusPromptSection(focus)}${angleInstructionLine(angle)}\n\nPlan the answer now. The quoted passages above are the complete permitted planning scope.`
      : [
          "THE STUDENT ASKED ONE SPECIFIC QUESTION ABOUT THE DOCUMENT BELOW.",
          `Their question: "${question || "Explain what this document covers."}"`,
          "",
          // The planning-sized summary, not the generation-sized one: this is a cheap gpt-4o-mini
          // call that needs each section's heading and gist, not the complete text and assets.
          "Their document, section by section:",
          summarizeSourceDocumentForPlanning(sourceDocument),
          angleInstructionLine(angle),
          "",
          "Plan an answer to that exact question, using only this document.",
          "If the document genuinely does not address the question, plan the closest thing it DOES cover and make that the opening step, rather than inventing material.",
        ].join("\n");
    return streamOutline(client, DOCUMENT_QUESTION_OUTLINE_SYSTEM_PROMPT, userContent, fallbackTopic, true);
  }

  /**
   * ONE TURN of the pre-lesson conversation: grade what the student just said, update the learner
   * model, and decide whether a further question is genuinely worth asking.
   *
   * A turn rather than a questionnaire. The client holds the profile and sends it back each time,
   * so the model always sees what has already been established and is told never to ask it again —
   * which is what stops the repetitive questioning this feature is specified against.
   *
   * Cheap on purpose: the same gpt-4o-mini as the other planning calls, a few hundredths of a cent
   * per turn against the lecture's own gpt-4o call.
   */
  if (mode === "diagnose") {
    const topic = typeof body.topic === "string" ? body.topic.trim().slice(0, 200) : "";
    if (!topic) return NextResponse.json({ error: "topic is required" }, { status: 400 });

    const incoming = sanitizeLearnerProfile(body.profile, topic);
    const exchanges = Array.isArray(body.exchanges)
      ? (body.exchanges as unknown[])
          .filter((e): e is { question: string; answer: string } =>
            Boolean(e) && typeof e === "object"
            && typeof (e as Record<string, unknown>).question === "string"
            && typeof (e as Record<string, unknown>).answer === "string")
          .map((e) => ({ question: e.question.slice(0, 300), answer: e.answer.slice(0, 1000) }))
          .slice(-MAX_DIAGNOSTIC_QUESTIONS)
      : [];
    const accountContext = typeof body.accountContext === "string" ? body.accountContext.slice(0, 400) : "";
    const learnerPersona = personaLine(body.learnerPersona);

    try {
      const completion = await client.chat.completions.create({
        model: MODEL,
        messages: [
          { role: "system", content: DIAGNOSTIC_SYSTEM_PROMPT },
          {
            role: "user",
            content: buildDiagnosticUserMessage({ topic, profile: incoming, exchanges, accountContext })
              + learnerPersona
              + sourceDocLine,
          },
        ],
        temperature: 0.4,
        max_tokens: 700,
        response_format: { type: "json_object" },
      });
      const parsed = JSON.parse(completion.choices[0]?.message?.content ?? "{}") as Record<string, unknown>;
      const profile = mergeAssessment(incoming, parsed.assessment, exchanges);
      const depth = resolveDepth(profile, topicComplexity(body.topicComplexity));

      /*
       * The ceiling is enforced HERE, not only in the prompt. A model asked to be curious will
       * occasionally want one more question, and "do not ask ten questions before teaching" has to
       * hold even when it does.
       */
      const forced = exchanges.length >= MAX_DIAGNOSTIC_QUESTIONS || hasEnoughSignal(profile);
      const nextQuestion = forced ? null : sanitizeDiagnosticQuestion(parsed.nextQuestion);
      // "This is what I'm noticing" — occasional, model-chosen, never every turn (see the prompt's
      // own restraint rules). null far more often than not; the client only shows it when present.
      const remark = typeof parsed.remark === "string" ? parsed.remark.trim().slice(0, 240) || null : null;

      return NextResponse.json({
        profile,
        depth,
        nextQuestion,
        remark,
        summary: profileSummary(profile, depth),
        costUsd: costUsd(completion.usage),
      });
    } catch (err) {
      /*
       * A failed diagnostic must never block the lesson. The whole stage is an enhancement: if it
       * breaks, the student gets the lecture they would have got before this feature existed.
       */
      return NextResponse.json({
        profile: incoming,
        depth: resolveDepth(incoming, topicComplexity(body.topicComplexity)),
        nextQuestion: null,
        summary: "",
        costUsd: 0,
        degraded: err instanceof Error ? err.message : "diagnostic unavailable",
      });
    }
  }

  if (mode === "clarify") {
    const topic = typeof body.topic === "string" ? body.topic.trim().slice(0, 200) : "";
    if (!topic) return NextResponse.json({ error: "topic is required" }, { status: 400 });
    try {
      const completion = await client.chat.completions.create({
        model: MODEL,
        messages: [
          { role: "system", content: CLARIFY_TOPIC_SYSTEM_PROMPT },
          { role: "user", content: `Topic: "${topic}"${sourceDocLine}` },
        ],
        temperature: 0.3,
        max_tokens: 600,
        response_format: { type: "json_object" },
      });
      const parsed = sanitizeClarify(JSON.parse(completion.choices[0]?.message?.content ?? "{}"));
      return NextResponse.json({ ...parsed, costUsd: costUsd(completion.usage) });
    } catch (err) {
      return NextResponse.json({ error: err instanceof Error ? err.message : "Planning failed" }, { status: 502 });
    }
  }

  if (mode === "outline") {
    const topic = typeof body.topic === "string" ? body.topic.trim().slice(0, 200) : "";
    if (!topic) return NextResponse.json({ error: "topic is required" }, { status: 400 });
    const clarifications = Array.isArray(body.clarifications)
      ? body.clarifications.filter((c: unknown) => c && typeof c === "object" && typeof (c as Record<string, unknown>).question === "string" && typeof (c as Record<string, unknown>).answer === "string")
      : [];
    const angle: PlanningAngleId | undefined = typeof body.angle === "string" ? (body.angle as PlanningAngleId) : undefined;

    const clarifyLine = clarifications.length
      ? `\nClarification from the student:\n${clarifications.map((c: { question: string; answer: string }) => `Q: ${c.question}\nA: ${c.answer}`).join("\n")}`
      : "";

    /*
     * The learner profile reaches the PLANNER, not only the lecture writer.
     *
     * Adjusting depth after the outline is fixed cannot undo an outline that already spent its
     * first subtopics defining terms the student demonstrated they know — the structure has to be
     * planned for them in the first place.
     */
    const learnerLine = body.learnerProfile
      ? outlineLearnerInstruction(
          learnerInstruction(
            sanitizeLearnerProfile(body.learnerProfile, topic),
            topicComplexity(body.depth),
          ),
        )
      : "";

    /*
     * The chosen source scope reaches the PLANNER, not only the lecture writer — same reasoning
     * as the learner profile above. A "strictly from source" outline must not draft subtopics
     * that assume outside material the lecture will then be forbidden from using.
     */
    const scope = sanitizeSourceScope(body.sourceScope);
    const scopeLine = scope ? sourceScopeInstruction(scope) : "";

    const userContent = `Topic: "${topic}"${clarifyLine}${angleInstructionLine(angle)}${sourceDocLine}${learnerLine}${personaLine(body.learnerPersona)}${scopeLine}`;
    return streamOutline(client, OUTLINE_LESSON_SYSTEM_PROMPT, userContent, topic);
  }

  // mode === "revise"
  const rawOutline = body.outline;
  const instruction = typeof body.instruction === "string" ? body.instruction.trim().slice(0, 300) : "";
  if (!rawOutline || typeof rawOutline !== "object" || !instruction) {
    return NextResponse.json({ error: "outline and instruction are required" }, { status: 400 });
  }
  const currentOutline = sanitizeOutline(rawOutline, typeof (rawOutline as Record<string, unknown>).topic === "string" ? (rawOutline as Record<string, unknown>).topic as string : "");
  const revisionQuestion = typeof body.question === "string" ? body.question.trim().slice(0, 500) : "";
  const revisionTranscript = typeof body.transcript === "string" ? body.transcript.trim() : "";
  const revisionFocus = sourceDocument && (revisionQuestion || revisionTranscript)
    ? focusFromTranscript(revisionQuestion, revisionTranscript) ?? focusPassages(revisionQuestion, sourceDocument)
    : null;
  const focusedRevisionLine = revisionFocus
    ? `\n\nThis is a question-specific document outline. It must continue to answer ONLY this question and use ONLY these passages:\n${focusPromptSection(revisionFocus)}`
    : sourceDocLine;
  const userContent = `Current outline:\n${JSON.stringify(currentOutline)}\n\nRequested change: "${instruction}"${focusedRevisionLine}${personaLine(body.learnerPersona)}`;
  return streamOutline(client, REVISE_OUTLINE_SYSTEM_PROMPT, userContent, currentOutline.topic, Boolean(revisionFocus));
}

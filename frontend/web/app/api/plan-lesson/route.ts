import { NextResponse } from "next/server";
import OpenAI from "openai";
import {
  CLARIFY_TOPIC_SYSTEM_PROMPT,
  DOCUMENT_SCOPE_SYSTEM_PROMPT,
  OUTLINE_LESSON_SYSTEM_PROMPT,
  REVISE_OUTLINE_SYSTEM_PROMPT,
  PLANNING_ANGLES,
  type PlanOutline,
  type PlanningAngleId,
} from "@/lib/planPrompt";
import { isSuprnotesLessonInput, type SuprnotesLessonInput } from "@/lib/suprnotes";
import { costFor } from "@/lib/modelPricing";
import { sanitizeDocumentPlanningQuestions } from "@/lib/documentLessonPlanning";

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
 * genuinely ambiguous (proposes quick-reply disambiguation questions if so) AND, when NOT
 * ambiguous, whether it has genuine topic-specific pre-draft planning decisions worth asking
 * about ("planningQuestions" — shown as ONE panel in the main canvas before drafting starts,
 * replacing any old generic/hardcoded steering questions). "outline"/"revise" sketch or edit
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

// gpt-4o-mini pricing (source: openai.com/api/pricing).

function costUsd(usage: { prompt_tokens?: number; completion_tokens?: number } | undefined): number {
  return costFor(MODEL, usage);
}

type ClarifyQuestion = { question: string; options: string[] };

function sanitizeClarify(raw: unknown): { ambiguous: boolean; questions: ClarifyQuestion[]; planningQuestions: { question: string; options: { label: string; instruction: string }[] }[] } {
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

  // planningQuestions only apply when NOT ambiguous — resolve the subject first (see prompt).
  const planningQuestions: { question: string; options: { label: string; instruction: string }[] }[] = [];
  if (!ambiguous) {
    const rawPlanning = Array.isArray(obj.planningQuestions) ? obj.planningQuestions : [];
    for (const q of rawPlanning) {
      const sanitized = sanitizeScopingQuestion(q);
      if (sanitized) planningQuestions.push(sanitized);
      if (planningQuestions.length >= 3) break;
    }
  }

  return { ambiguous, questions, planningQuestions };
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
    if (subtopics.length >= 10) break;
  }
  return { topic, subtopics };
}

function sanitizeSingleSubtopic(raw: unknown): PlanOutline["subtopics"][number] | undefined {
  const outline = sanitizeOutline({ topic: "partial", subtopics: [raw] }, "partial");
  return outline.subtopics[0];
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
function streamOutline(client: OpenAI, systemPrompt: string, userContent: string, fallbackTopic: string): Response {
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
          max_tokens: 1700,
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
          for (const subtopic of subtopics) send({ type: "subtopic", index: emittedSubtopics++, subtopic });
          emittedSubtopics = Math.max(emittedSubtopics, subtopicTotal);

          const reasonMatches = findReasonMatches(buffer);
          const { reasons, total } = extractNewReasons(reasonMatches, emittedReasons);
          for (const reason of reasons) send({ type: "thought", text: reason });
          emittedReasons = total;

          const { questions, total: scopingTotal } = extractNewScopingQuestions(buffer, emittedScopingQuestions);
          for (const q of questions) send({ type: "scoping-question", ...q });
          emittedScopingQuestions = scopingTotal;
        }

        const outline = sanitizeOutline(JSON.parse(buffer || "{}"), fallbackTopic);
        if (outline.subtopics.length === 0) {
          send({ type: "error", error: "Could not plan an outline for that topic." });
        } else {
          const enriched = await ensureSafetyNets(client, outline);
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
  if (mode !== "clarify" && mode !== "document-scope" && mode !== "outline" && mode !== "revise") {
    return NextResponse.json({ error: "mode must be clarify, document-scope, outline, or revise" }, { status: 400 });
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

    const userContent = `Topic: "${topic}"${clarifyLine}${angleInstructionLine(angle)}${sourceDocLine}`;
    return streamOutline(client, OUTLINE_LESSON_SYSTEM_PROMPT, userContent, topic);
  }

  // mode === "revise"
  const rawOutline = body.outline;
  const instruction = typeof body.instruction === "string" ? body.instruction.trim().slice(0, 300) : "";
  if (!rawOutline || typeof rawOutline !== "object" || !instruction) {
    return NextResponse.json({ error: "outline and instruction are required" }, { status: 400 });
  }
  const currentOutline = sanitizeOutline(rawOutline, typeof (rawOutline as Record<string, unknown>).topic === "string" ? (rawOutline as Record<string, unknown>).topic as string : "");
  const userContent = `Current outline:\n${JSON.stringify(currentOutline)}\n\nRequested change: "${instruction}"${sourceDocLine}`;
  return streamOutline(client, REVISE_OUTLINE_SYSTEM_PROMPT, userContent, currentOutline.topic);
}

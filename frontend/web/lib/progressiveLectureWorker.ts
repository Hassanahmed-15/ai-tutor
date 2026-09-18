import "server-only";

import OpenAI from "openai";
import type { DrawScript } from "@/components/sketch/LiveSketch";
import { fillBlackboardOps } from "./blackboardGen";
import { planBeatVisual, specToBrief } from "./beatVisualSpec";
import { direct, type BoardKind } from "./director";
import { archiveLecture } from "./lectureArchive";
import type { Beat, CheckpointSpec, SlideKind } from "./lessonContent";
import { polishBeatPlan, topicKeywords, transitionSentence } from "./beatPresentation";
import { fillManimSceneOps } from "./manimSceneGen";
import { costFor, isModernModel } from "./modelPricing";
import { dispatchProgressiveTasks } from "./progressiveLectureQueue";
import {
  progressiveBeat,
  progressiveBeats,
  progressiveInput,
  progressiveSession,
  replaceProgressiveSession,
  setProgressivePlan,
  upsertProgressiveBeat,
} from "./progressiveLectureStore";
import type {
  ProgressiveBeatDoc,
  ProgressiveBeatPlan,
  ProgressiveLectureInput,
  ProgressiveLectureSessionDoc,
  ProgressiveLectureTask,
  ProgressiveVisualKind,
} from "./progressiveLectureTypes";
import { fillReactAnimationOps } from "./reactAnimationGen";
import { fillSpecBoardOps } from "./specBoardGen";
import { fillStructureSceneOps } from "./structureSceneGen";
import { compactSuprnotesForPrompt, isSuprnotesLessonInput, type SuprnotesLessonInput } from "./suprnotes";

const MODEL = process.env.OPENAI_PROGRESSIVE_MODEL ?? process.env.OPENAI_LECTURE_MODEL ?? "gpt-4o-mini";
type GeneratedBeatPayload = {
  title?: unknown;
  transitionIn?: unknown;
  teacherMove?: unknown;
  slideKind?: unknown;
  points?: unknown;
  definitionTerm?: unknown;
  definitionMeaning?: unknown;
  script?: unknown;
  checkpoint?: unknown;
};

/**
 * Per-task timing, logged in one parseable line.
 *
 * WHY THIS EXISTS. There was no instrumentation anywhere in this pipeline, so "the lecture takes
 * about a minute" could not be attributed to anything: plan, script generation, premium rendering
 * and queue hops were indistinguishable in the logs. Optimising without this is guessing.
 *
 * The shape is deliberately greppable — `[timing] kind=... ms=...` — so a build's critical path can
 * be reconstructed from `az containerapp logs` without adding a tracing dependency.
 */
function logTiming(kind: string, sessionId: string, startedAt: number, extra = ""): void {
  const ms = Math.round(performance.now() - startedAt);
  console.log(`[timing] kind=${kind} session=${sessionId} ms=${ms}${extra ? ` ${extra}` : ""}`);
}

export async function processProgressiveLectureTask(task: ProgressiveLectureTask): Promise<void> {
  const startedAt = performance.now();
  /*
   * Queue latency, measured rather than assumed.
   *
   * Every task carries the time it was enqueued, so the gap between dispatch and pickup is visible
   * on its own. That gap is pure overhead — the worker polls on a 1s idle sleep and waits for a
   * whole batch to finish before dequeuing again — and the critical path for the first beat
   * crosses it three times (plan → generate-beat → enrich-beat).
   */
  const queuedFor = typeof task.enqueuedAt === "number" ? Date.now() - task.enqueuedAt : null;
  const seq = "sequence" in task ? `seq=${task.sequence}` : "";
  if (queuedFor !== null) {
    console.log(`[timing] kind=queue-wait session=${task.sessionId} ms=${queuedFor} type=${task.type} ${seq}`);
  }
  try {
    if (task.type === "plan") await planLecture(task.userId, task.sessionId);
    else if (task.type === "generate-beat") await generateBeat(task.userId, task.sessionId, task.sequence, task.revision);
    else await enrichBeat(task.userId, task.sessionId, task.sequence, task.revision);
  } finally {
    logTiming(task.type, task.sessionId, startedAt, seq);
  }
}

async function planLecture(userId: string, sessionId: string): Promise<void> {
  const session = await requiredSession(userId, sessionId);
  if (session.plan.length > 0) return;
  try {
    const input = await progressiveInput(session);
    const plan = buildProgressivePlan(input);
    const next = await setProgressivePlan(session, plan);
    // Start one worker-width of script jobs. Each completion queues its premium enrichment before
    // releasing the next script in that lane, so animation work cannot sit behind the whole plan.
    await dispatchProgressiveTasks(plan.slice(0, next.starterBeatCount).map((beat) => ({
      version: 1 as const,
      type: "generate-beat" as const,
      sessionId,
      userId,
      sequence: beat.sequence,
      revision: next.planRevision,
    })));
  } catch (error) {
    await failSession(session, error);
    throw error;
  }
}

/** Builds the global map synchronously so no model round-trip delays the first beat. */
export function buildProgressivePlan(input: ProgressiveLectureInput): ProgressiveBeatPlan[] {
  const sourcePlan = sourceDocumentPlan(input);
  if (sourcePlan.length > 0) return sourcePlan;
  const subject = topicKeywords(input.topic);
  const requested = input.learnerProfile.depth === "deep" ? 10 : input.learnerProfile.depth === "concise" ? 6 : 8;
  const supplied = (input.outline?.subtopics ?? [])
    .map((item) => ({ title: clean(item.title), objective: clean(item.caption || item.reason || item.title) }))
    .filter((item) => item.title);
  const foundations = supplied.length > 0 ? supplied : defaultObjectives(subject, requested - 2);
  const middle = foundations.slice(0, Math.max(2, requested - 2));
  while (middle.length < requested - 2) {
    const index = middle.length + 1;
    middle.push({
      title: `${subject}: idea ${index}`,
      objective: `Explain a distinct, useful part of ${subject} with a concrete example.`,
    });
  }
  const entries = polishBeatPlan([
    { title: subject, objective: `Open with a concrete puzzle or use case that makes ${subject} worth learning.` },
    ...middle,
    { title: `${subject} Recap`, objective: `Connect the core ideas, correct the main misconception, and give the learner a usable recap.` },
  ].slice(0, requested), subject);

  const plan = entries.map((entry, sequence) => ({
    id: `beat-${sequence + 1}-${slug(entry.title)}`,
    sequence,
    title: entry.title,
    objective: entry.objective,
    visualKind: visualKindFor(sequence, entries.length, input, entry),
    estimatedDurationMs: input.learnerProfile.depth === "deep" ? 55_000 : input.learnerProfile.depth === "concise" ? 35_000 : 45_000,
  }));
  // A prompted lecture should exercise the live animation engine, not accidentally collapse into
  // blackboards/structure boards because every outline title matched a broad keyword. Prefer the
  // most process-like teaching beat, and keep specialised equation/plot choices intact.
  if (!plan.some((beat) => beat.visualKind === "react-animation")) {
    const candidate = plan.find((beat) =>
      beat.sequence < plan.length - 1 &&
      /how|work|apply|example|try|mechanism|process|change|step/i.test(`${beat.title} ${beat.objective}`) &&
      !["equation", "plot"].includes(beat.visualKind),
    ) ?? plan.find((beat) => beat.sequence < plan.length - 1 && !["equation", "plot"].includes(beat.visualKind));
    if (candidate) candidate.visualKind = "react-animation";
  }
  return plan;
}

function sourceDocumentPlan(input: ProgressiveLectureInput): ProgressiveBeatPlan[] {
  if (!isSuprnotesLessonInput(input.suprnotes)) return [];
  const document = input.suprnotes;
  const rawPlan = (document.lessonPlan ?? document.suggestedLecturePlan) as Record<string, unknown> | undefined;
  const rawBeats = Array.isArray(rawPlan?.beats) ? rawPlan.beats : [];
  const planned = rawBeats
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
    .map((item) => ({
      title: clean(item.title),
      objective: clean(item.objective) || clean(item.teachingGoal) || clean(item.title),
      sourceBlockIds: Array.isArray(item.sourceBlockIds)
        ? item.sourceBlockIds.filter((id): id is string => typeof id === "string")
        : [],
      visualKind: sourceVisualKind(item),
    }))
    .filter((item) => item.title);
  const fallback = planned.length > 0 ? planned : (document.contentBlocks ?? [])
    .slice()
    .sort((a, b) => (a.sourceOrder ?? 0) - (b.sourceOrder ?? 0))
    .slice(0, 12)
    .map((block) => ({
      title: clean(block.heading) || `Page ${block.pageNumber ?? "source"}`,
      objective: clean(block.text).slice(0, 260) || `Teach the source material in ${block.id}.`,
      sourceBlockIds: [block.id],
      visualKind: "react-animation" as ProgressiveVisualKind,
    }));
  return polishBeatPlan(fallback, input.topic).map((item, sequence) => ({
    id: `beat-${sequence + 1}-${slug(item.title)}`,
    sequence,
    title: item.title,
    objective: item.objective,
    sourceBlockIds: item.sourceBlockIds,
    visualKind: item.visualKind,
    estimatedDurationMs: input.learnerProfile.depth === "deep" ? 55_000 : input.learnerProfile.depth === "concise" ? 35_000 : 45_000,
  }));
}

function sourceVisualKind(item: Record<string, unknown>): ProgressiveVisualKind {
  const recommended = item.recommendedVisual && typeof item.recommendedVisual === "object"
    ? item.recommendedVisual as Record<string, unknown>
    : {};
  const value = `${String(recommended.type ?? "")} ${String(item.visualMode ?? "")}`.toLowerCase();
  if (value.includes("react") || value.includes("svg")) return "react-animation";
  if (value.includes("manim")) return "manim";
  if (value.includes("geometry")) return "manim";
  if (value.includes("transform")) return "react-animation";
  if (value.includes("structure") || value.includes("flow") || value.includes("cycle") || value.includes("tree")) return "structure";
  if (value.includes("plot") || value.includes("chart") || value.includes("graph")) return "plot";
  if (value.includes("equation") || value.includes("formula") || value.includes("derivation")) return "equation";
  if (value.includes("blackboard") || value.includes("text") || value.includes("notes")) return "blackboard";
  // A source planner often says only "diagram" or omits the engine. The full pipeline used the
  // sandbox for those visual teaching beats; defaulting them to blackboard caused uploaded-source
  // progressive lectures to lose animation entirely.
  return "react-animation";
}

function defaultObjectives(topic: string, count: number): Array<{ title: string; objective: string }> {
  const patterns = [
    ["Core idea", `Define ${topic} plainly and establish the mental model.`],
    ["How it works", `Explain the mechanism or sequence behind ${topic}.`],
    ["A worked example", `Apply ${topic} step by step to a concrete example.`],
    ["Common mistake", `Expose and repair a common misconception about ${topic}.`],
    ["Compare and connect", `Contrast ${topic} with a nearby idea and show when each applies.`],
    ["Try it", `Give the learner a small practical application of ${topic}.`],
    ["Deeper layer", `Add the next level of detail without repeating earlier ideas.`],
    ["Transfer", `Use ${topic} in a new setting so the learner can generalize it.`],
  ];
  return patterns.slice(0, count).map(([label, objective]) => ({ title: `${topic}: ${label}`, objective }));
}

function visualKindFor(
  sequence: number,
  total: number,
  input: ProgressiveLectureInput,
  entry: { title: string; objective: string },
): ProgressiveVisualKind {
  if (sequence === total - 1) return "blackboard";
  const title = entry.title.toLowerCase();
  const planText = `${entry.title} ${entry.objective}`.toLowerCase();
  if (/\b(?:equation|formula|derivation|solve|algebra|calculus)\b/.test(title)) return "equation";
  if (/\b(?:chart|graph|trend|probability distribution|data plot)\b/.test(title)) return "plot";
  if (/\b(?:cycle|pipeline|state machine|hierarchy|workflow|architecture)\b/.test(title)) return "structure";
  if (/\b(?:definition|recap|summary)\b/.test(title)) return "blackboard";
  if (/code|program|loop|algorithm|software/.test(planText) && input.learnerProfile.codeExamples) return "react-animation";
  // The sandbox is the normal teaching surface, matching the pre-progressive pipeline. Specialised
  // renderers above are opt-ins only when the title explicitly calls for their grammar.
  return "react-animation";
}

async function generateBeat(userId: string, sessionId: string, sequence: number, revision: number): Promise<void> {
  const session = await requiredSession(userId, sessionId);
  if (session.status === "failed") return;
  const planned = session.plan[sequence];
  if (!planned) return;
  const existing = await progressiveBeat(sessionId, sequence);
  if (existing && existing.revision > revision) return;
  if (existing?.beat && existing.revision === revision && ["playable", "ready"].includes(existing.state)) return;

  const now = new Date().toISOString();
  const baseDoc: ProgressiveBeatDoc = {
    id: `${sessionId}:${sequence}`,
    sessionId,
    userId,
    sequence,
    revision,
    state: "generating",
    enrichmentState: "pending",
    beat: existing?.beat ?? null,
    fallbackUsed: false,
    costUsd: existing?.costUsd ?? 0,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    error: null,
  };
  await upsertProgressiveBeat(baseDoc);

  let beat: Beat;
  let costUsd = 0;
  let error: string | null = null;
  try {
    const input = await progressiveInput(session);
    const generated = await generateOneBeat(input, session, planned);
    beat = generated.beat;
    costUsd = generated.costUsd;
  } catch (cause) {
    error = messageFor(cause);
    beat = deterministicFallbackBeat(planned, session, sequence);
  }

  const latest = await progressiveBeat(sessionId, sequence);
  if (latest && latest.revision > revision) return;
  await upsertProgressiveBeat({
    ...baseDoc,
    state: "playable",
    beat,
    fallbackUsed: Boolean(error),
    costUsd: baseDoc.costUsd + costUsd,
    error,
  });
  await dispatchProgressiveTasks([
    { version: 1, type: "enrich-beat", sessionId, userId, sequence, revision },
  ]);
}

async function generateOneBeat(
  input: ProgressiveLectureInput,
  session: ProgressiveLectureSessionDoc,
  planned: ProgressiveBeatPlan,
): Promise<{ beat: Beat; costUsd: number }> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is not set.");
  const client = new OpenAI({ apiKey });
  const wordRange = input.learnerProfile.depth === "deep" ? "125-165" : input.learnerProfile.depth === "concise" ? "70-100" : "95-130";
  const isCheckpoint = planned.sequence > 0 && planned.sequence < session.plan.length - 1 && planned.sequence % 3 === 0;
  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    {
      role: "system",
      content: `You write one beat of a spoken, adaptive tutor lecture. Return JSON only with title, transitionIn, teacherMove, slideKind, points, script, optional definitionTerm/definitionMeaning, and optional checkpoint. Keep the supplied beat title exactly; it is the canonical title already approved in the plan. For every beat after the first, transitionIn is one natural 8-18 word sentence that connects the previous beat's insight to this beat without saying a generic phrase such as "moving on". Omit transitionIn on the first beat. The script must be ${wordRange} words, accurate, warm, and complete on its own while connecting to adjacent plan items. Use language for a ${input.learnerProfile.expertise} learner seeking ${input.learnerProfile.depth} depth for a ${input.learnerProfile.goal} goal. ${input.learnerProfile.codeExamples ? "Include a code snippet only when it genuinely teaches the topic." : "Do not include code."} ${isCheckpoint ? "This is a checkpoint beat. Include checkpoint with prompt, acceptableKeywords as arrays of keywords, correctFeedback, hintFeedback, revealAnswer, three options, and correctOption." : "Do not create a checkpoint."}`,
    },
    {
      role: "user",
      content: JSON.stringify({
        topic: input.topic,
        beat: planned,
        previousBeat: planned.sequence > 0 ? session.plan[planned.sequence - 1] : null,
        fullPlan: session.plan.map(({ sequence, title, objective }) => ({ sequence, title, objective })),
        adaptation: session.adaptationNotes,
        preferredExamples: input.learnerProfile.preferredExamples,
        sourceContext: sourceContext(input, planned.sourceBlockIds),
      }),
    },
  ];
  const request: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming = {
    model: MODEL,
    messages,
    response_format: { type: "json_object" },
    ...(isModernModel(MODEL) ? { max_completion_tokens: 2_000 } : { max_tokens: 2_000, temperature: 0.35 }),
  };
  const scriptStartedAt = performance.now();
  const completion = await client.chat.completions.create(request);
  // The beat's script call. Separating this from the premium render above is the whole point of the
  // instrumentation: they are different models doing different work, and only one of them is worth
  // parallelising if it turns out to dominate.
  logTiming("beat-script", session.id, scriptStartedAt, `seq=${planned.sequence} model=${MODEL}`);
  const payload = JSON.parse(completion.choices[0]?.message?.content ?? "{}") as GeneratedBeatPayload;
  return {
    beat: sanitizeGeneratedBeat(payload, planned, session),
    costUsd: costFor(MODEL, completion.usage),
  };
}

function sanitizeGeneratedBeat(payload: GeneratedBeatPayload, planned: ProgressiveBeatPlan, session: ProgressiveLectureSessionDoc): Beat {
  const points = Array.isArray(payload.points)
    ? payload.points.filter((item): item is string => typeof item === "string").map(clean).filter(Boolean).slice(0, 4)
    : [];
  const script = typeof payload.script === "string" && payload.script.trim()
    ? payload.script.trim()
    : `${planned.objective} ${points.join(" ")}`;
  const rawKind = String(payload.slideKind ?? "");
  const slideKind: SlideKind = ["intro", "definition", "checkpoint", "compare", "recap"].includes(rawKind)
    ? rawKind as SlideKind
    : planned.sequence === session.plan.length - 1 ? "recap" : "intro";
  const checkpoint = slideKind === "checkpoint" ? sanitizeCheckpoint(payload.checkpoint, planned) : undefined;
  return {
    id: planned.id,
    title: planned.title,
    transitionIn: planned.sequence > 0
      ? transitionSentence(payload.transitionIn, session.plan[planned.sequence - 1]?.title ?? session.topic, planned.title)
      : undefined,
    teacherMove: clean(payload.teacherMove) || planned.objective,
    stepLabel: `${planned.sequence + 1} · ${planned.sequence === 0 ? "Start" : slideKind === "checkpoint" ? "Check" : "Learn"}`,
    slideKind,
    points: points.length > 0 ? points : [planned.objective],
    definitionTerm: clean(payload.definitionTerm) || undefined,
    definitionMeaning: clean(payload.definitionMeaning) || undefined,
    checkpoint,
    script,
    sourceBlockIds: planned.sourceBlockIds,
    draw: fallbackDraw(planned.title, points.length > 0 ? points : [planned.objective], planned.estimatedDurationMs),
  };
}

function sanitizeCheckpoint(value: unknown, planned: ProgressiveBeatPlan): CheckpointSpec {
  const raw = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const options = Array.isArray(raw.options) ? raw.options.filter((v): v is string => typeof v === "string").slice(0, 3) : [];
  const keywords = Array.isArray(raw.acceptableKeywords)
    ? raw.acceptableKeywords.filter(Array.isArray).map((set) => set.filter((v): v is string => typeof v === "string")).filter((set) => set.length > 0)
    : [];
  return {
    prompt: clean(raw.prompt) || `In your own words, what is the key idea in ${planned.title}?`,
    acceptableKeywords: keywords.length ? keywords : planned.title.split(/\s+/).slice(0, 2).map((word) => [word]),
    correctFeedback: clean(raw.correctFeedback) || "Yes — that captures the key idea.",
    hintFeedback: clean(raw.hintFeedback) || `Think about this objective: ${planned.objective}`,
    revealAnswer: clean(raw.revealAnswer) || planned.objective,
    options: options.length === 3 ? options : undefined,
    correctOption: Number.isInteger(raw.correctOption) ? Math.max(0, Math.min(2, Number(raw.correctOption))) : undefined,
  };
}

function deterministicFallbackBeat(planned: ProgressiveBeatPlan, session: ProgressiveLectureSessionDoc, sequence: number): Beat {
  const points = [planned.objective, `Connect this idea to the larger topic: ${session.topic}.`];
  return {
    id: planned.id,
    title: planned.title,
    transitionIn: sequence > 0
      ? transitionSentence(undefined, session.plan[sequence - 1]?.title ?? session.topic, planned.title)
      : undefined,
    teacherMove: "Keep the lesson moving with a clear, visual explanation.",
    stepLabel: `${sequence + 1} · Learn`,
    slideKind: sequence === session.plan.length - 1 ? "recap" : "intro",
    points,
    script: `${planned.objective} Let’s make that concrete. Focus on the relationship shown on the board, then connect it back to ${session.topic}. Notice what changes, what stays constant, and how this idea helps you reason about the larger topic.`,
    draw: fallbackDraw(planned.title, points, planned.estimatedDurationMs),
  };
}

function fallbackDraw(title: string, points: string[], durationMs: number): DrawScript {
  const selected = points.slice(0, 3);
  return {
    caption: title,
    durationMs: Math.max(8_000, Math.min(60_000, durationMs)),
    surface: "paper",
    ops: [
      { kind: "label", text: title.slice(0, 72), x: 50, y: 15, size: "lg", color: "#4c1d95", at: 0.03 },
      ...selected.flatMap((point, index) => {
        const y = 38 + index * 21;
        return [
          // A short rule mark is page furniture, not diagram geometry. Circular bullets caused the
          // renderer heuristic to see three shapes and route every fallback board through Manim.
          { kind: "shape" as const, shape: "line" as const, x: 13, y, w: 1, h: 6, color: "#7c3aed", at: 0.16 + index * 0.2 },
          { kind: "note" as const, text: point.slice(0, 110), x: 57, y, color: "#1e293b", at: 0.23 + index * 0.2 },
        ];
      }),
    ],
  };
}

async function enrichBeat(userId: string, sessionId: string, sequence: number, revision: number): Promise<void> {
  const session = await requiredSession(userId, sessionId);
  const planned = session.plan[sequence];
  const doc = await progressiveBeat(sessionId, sequence);
  if (!planned || !doc?.beat || doc.revision !== revision || doc.state === "ready") return;
  await upsertProgressiveBeat({ ...doc, enrichmentState: "running" });

  const fallback = JSON.parse(JSON.stringify(doc.beat)) as Beat;
  const candidate = JSON.parse(JSON.stringify(doc.beat)) as Beat;
  const client = process.env.OPENAI_API_KEY ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null;
  let visualKind = planned.visualKind;
  let costUsd = 0;
  if (client && session.sourceType === "prompt") {
    const selection = await chooseProgressiveVisual(client, candidate, planned.visualKind);
    visualKind = selection.kind;
    costUsd += selection.costUsd;
  }
  console.error(`[progressive-worker] beat=${candidate.id} renderer-plan=${visualKind} provisional=${planned.visualKind}`);
  candidate.draw = premiumPlaceholder(candidate, visualKind);
  let success = visualKind === "live-svg";
  let error: string | null = null;
  try {
    if (visualKind !== "live-svg" && client) {
      // The beat's position drives the model comparison's rotation (lib/animationModels.ts), so
      // neighbouring beats always get different models. Not the count of planned animation beats:
      // a prompted lecture plans few of those and picks the real board kind later (above), so that
      // count would hand nearly every animated beat to the same model.
      const premiumStartedAt = performance.now();
      const result = await fillPremium(client, candidate, visualKind, session.sourceType !== "prompt", sequence);
      // The single most expensive call in the pipeline — an animation generation plus its vision
      // critic and refine pass. Timed separately from the enclosing task so the rest of enrichment
      // (Cosmos reads/writes, the visual-kind choice) can be told apart from the model work.
      logTiming("premium", sessionId, premiumStartedAt, `seq=${sequence} kind=${visualKind}`);
      costUsd += result.costUsd;
      success = result.success;
      error = result.error;
    } else if (visualKind !== "live-svg") {
      error = "OPENAI_API_KEY is not set.";
    }
  } catch (cause) {
    error = messageFor(cause);
  }

  const latest = await progressiveBeat(sessionId, sequence);
  if (!latest || latest.revision !== revision) return;
  await upsertProgressiveBeat({
    ...latest,
    beat: success ? candidate : fallback,
    state: "ready",
    enrichmentState: "ready",
    fallbackUsed: !success || latest.fallbackUsed,
    costUsd: latest.costUsd + costUsd,
    error: error ?? latest.error,
  });
  // Advance this lane only after its premium render has finished (or definitively fallen back).
  // This keeps the three opening enrichments at the head of the queue instead of allowing later
  // text generation to consume every worker while the learner sees only provisional SVG boards.
  const nextSequence = sequence + session.starterBeatCount;
  if (nextSequence < session.plan.length) {
    await dispatchProgressiveTasks([{
      version: 1,
      type: "generate-beat",
      sessionId,
      userId,
      sequence: nextSequence,
      revision,
    }]);
  }
  await maybeFinalize(userId, sessionId);
}

const PROGRESSIVE_KIND_FOR_BOARD: Record<Exclude<BoardKind, "morph">, ProgressiveVisualKind> = {
  reactAnimation: "react-animation",
  manimScene: "manim",
  structureScene: "structure",
  chalkBoard: "blackboard",
  plotBoard: "plot",
  equationBoard: "equation",
};

/** Uses the same semantic visual director as the full lecture engine. The provisional plan remains
 * the safe fallback if either classification call is unavailable. */
async function chooseProgressiveVisual(
  client: OpenAI,
  beat: Beat,
  fallback: ProgressiveVisualKind,
): Promise<{ kind: ProgressiveVisualKind; costUsd: number }> {
  try {
    const visual = await planBeatVisual(client, beat);
    if (!visual.spec) return { kind: fallback, costUsd: visual.costUsd };
    const selected = await direct(client, specToBrief(visual.spec));
    const board = selected.plan?.board;
    if (!board) return { kind: fallback, costUsd: visual.costUsd + selected.costUsd };
    // The synchronous plan deliberately reserves some process/application beats for the sandbox.
    // A later broad classifier (especially "structure") must not erase that renderer diversity.
    // The provisional planner has already identified equation and plot beats. Once it reserves a
    // beat for the sandbox, preserve that decision so a broad semantic brief cannot silently turn
    // every animation into ELK or another static renderer.
    if (fallback === "react-animation") {
      return { kind: fallback, costUsd: visual.costUsd + selected.costUsd };
    }
    // A broad technical topic can make every visual specification mention "connections", causing
    // an independent per-beat classifier to turn definitions, benefits and recaps into the same ELK
    // network. Structure is accepted only when the beat title itself says relationships/stages are
    // the teaching object; otherwise the varied content-aware provisional plan wins.
    if (board === "structureScene" && !/\b(?:how .* works?|architecture|pipeline|cycle|state machine|workflow|flow|hierarchy|components?|stages?|sequence)\b/i.test(beat.title)) {
      return { kind: fallback, costUsd: visual.costUsd + selected.costUsd };
    }
    // Morph authoring needs inline before/after geometry, which this asynchronous filler does not
    // invent. The sandbox is the full engine's safe live-animation choice for transformations.
    const kind = board === "morph" ? "react-animation" : PROGRESSIVE_KIND_FOR_BOARD[board];
    return { kind, costUsd: visual.costUsd + selected.costUsd };
  } catch (cause) {
    console.error(`[progressive-worker] visual direction failed for ${beat.id}:`, cause);
    return { kind: fallback, costUsd: 0 };
  }
}

function premiumPlaceholder(beat: Beat, kind: ProgressiveVisualKind): DrawScript {
  const brief = `${beat.title}. ${beat.teacherMove} ${beat.points.join(" ")}`;
  const common = { caption: beat.title, durationMs: beat.draw?.durationMs ?? 45_000, surface: "paper" as const };
  if (kind === "react-animation") return { ...common, ops: [{ kind: "reactAnimation", teachingPoint: brief, at: 0, endAt: 1 }] };
  if (kind === "blackboard") return { ...common, ops: [{ kind: "chalkBoard", boardBrief: brief, at: 0, endAt: 1 }] };
  if (kind === "manim") return { ...common, ops: [{ kind: "manimScene", sceneBrief: brief, at: 0, endAt: 1 }] };
  if (kind === "structure") return { ...common, ops: [{ kind: "structureScene", structureBrief: brief, at: 0, endAt: 1 }] };
  if (kind === "plot") return { ...common, ops: [{ kind: "plotBoard", plotBrief: brief, at: 0, endAt: 1 }] };
  if (kind === "equation") return { ...common, ops: [{ kind: "equationBoard", equationBrief: brief, at: 0, endAt: 1 }] };
  return beat.draw ?? fallbackDraw(beat.title, beat.points, common.durationMs);
}

async function fillPremium(client: OpenAI, beat: Beat, kind: ProgressiveVisualKind, hasSource: boolean, animationIndex = 0) {
  if (!process.env.OPENAI_API_KEY) return { success: false, costUsd: 0, error: "OPENAI_API_KEY is not set." };
  if (kind === "react-animation" && process.env.REACT_ANIMATIONS_ENABLED !== "1") return disabled(kind);
  if (kind === "blackboard" && process.env.BLACKBOARD_GEN_ENABLED !== "1") return disabled(kind);
  if (kind === "manim" && process.env.MANIM_RENDER_ENABLED !== "1") return disabled(kind);
  const stats = kind === "react-animation"
    ? await fillReactAnimationOps(client, [beat], { animationIndexOffset: animationIndex })
    : kind === "blackboard"
      ? await fillBlackboardOps(client, [beat], hasSource)
      : kind === "manim"
        ? await fillManimSceneOps(client, [beat])
        : kind === "structure"
          ? await fillStructureSceneOps(client, [beat])
          : await fillSpecBoardOps(client, [beat]);
  return {
    success: stats.filled > 0,
    costUsd: stats.costUsd,
    error: stats.issues[0] ?? (stats.filled > 0 ? null : `${kind} enrichment was unavailable.`),
  };
}

function disabled(kind: ProgressiveVisualKind) {
  return { success: false, costUsd: 0, error: `${kind} generation is disabled; retained the live SVG fallback.` };
}

async function maybeFinalize(userId: string, sessionId: string): Promise<void> {
  const session = await requiredSession(userId, sessionId);
  if (session.status === "complete" || session.status === "failed" || session.plan.length === 0) return;
  const docs = await progressiveBeats(sessionId);
  const beatsBySequence = new Map(docs.filter((doc) => doc.beat && doc.enrichmentState === "ready").map((doc) => [doc.sequence, doc]));
  if (session.plan.some((_, sequence) => !beatsBySequence.has(sequence))) return;
  const finalizing = { ...session, status: "finalizing" as const, error: null };
  await replaceProgressiveSession(finalizing);
  try {
    const input = await progressiveInput(session);
    const ordered = session.plan.map((_, sequence) => beatsBySequence.get(sequence)?.beat).filter((beat): beat is Beat => Boolean(beat));
    const archived = await archiveLecture({
      lectureId: sessionId,
      userId,
      topic: session.topic,
      sourceType: session.sourceType,
      mode: session.mode,
      beats: ordered,
      learnerProfile: input.learnerProfile,
    });
    await replaceProgressiveSession({ ...finalizing, status: "complete", lectureId: archived.lectureId });
    // Playback/history are already available because archiveLecture durably wrote the JSON first.
    // Keep the queue message locked until every eligible Manim MP4 has nevertheless been attempted,
    // so a worker shutdown cannot silently abandon the video portion after acknowledging success.
    await archived.finishVideos().catch((error) => {
      console.error(`[progressive-worker] video archive failed for ${sessionId}:`, error);
    });
  } catch (error) {
    await failSession(finalizing, error);
    throw error;
  }
}

async function requiredSession(userId: string, sessionId: string): Promise<ProgressiveLectureSessionDoc> {
  const session = await progressiveSession(userId, sessionId);
  if (!session) throw new Error("Progressive lecture session was not found.");
  return session;
}

async function failSession(session: ProgressiveLectureSessionDoc, error: unknown): Promise<void> {
  await replaceProgressiveSession({ ...session, status: "failed", error: messageFor(error).slice(0, 500) }).catch(() => {});
}

function sourceContext(input: ProgressiveLectureInput, sourceBlockIds?: string[]): string {
  const parts = [input.context, input.diagramHints, input.transcript, input.focus];
  if (isSuprnotesLessonInput(input.suprnotes)) {
    const selected = new Set(sourceBlockIds ?? []);
    const scoped: SuprnotesLessonInput = selected.size > 0
      ? {
          ...input.suprnotes,
          contentBlocks: (input.suprnotes.contentBlocks ?? []).filter((block) => selected.has(block.id)),
          assets: (input.suprnotes.assets ?? []).filter((asset) => (asset.sourceBlockIds ?? []).some((id) => selected.has(id))),
        }
      : input.suprnotes;
    parts.push(compactSuprnotesForPrompt(scoped));
  } else if (input.suprnotes) parts.push(JSON.stringify(input.suprnotes));
  return parts.filter((part): part is string => typeof part === "string" && Boolean(part.trim())).join("\n\n").slice(0, 18_000);
}

function clean(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 42) || "lesson";
}

function messageFor(error: unknown): string {
  return error instanceof Error ? error.message : "Progressive lecture generation failed.";
}

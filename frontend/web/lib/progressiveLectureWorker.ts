import "server-only";

import OpenAI from "openai";
import type { DrawScript } from "@/components/sketch/LiveSketch";
import { fillBlackboardOps } from "./blackboardGen";
import { planBeatVisual, specToBrief, type BeatVisualSpec } from "./beatVisualSpec";
import { direct, type BoardKind, type VisualForm } from "./director";
import { archiveLecture } from "./lectureArchive";
import type { Beat, CheckpointSpec, SlideKind } from "./lessonContent";
import { isRecapTitle, openingSentence, polishBeatPlan, topicKeywords, transitionSentence } from "./beatPresentation";
import { boardBriefFor, pointsFromScript } from "./boardBrief";
import { hasUsableBoard, rescueEmptyBoards } from "./boardFallback";
import { expandConceptPasses, type ConceptPass } from "./board/conceptPasses";
import { fillManimSceneOps } from "./manimSceneGen";
import { costFor, isModernModel } from "./modelPricing";
import { dispatchProgressiveTasks } from "./progressiveLectureQueue";
import { dispatchDueBeats } from "./progressiveDispatch";
import { learnerBrief } from "./learnerBrief";
import { learnerInstruction, resolveDepth } from "./learnerProfile";
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
import { fillReactAnimationOps, type ReactAnimationFillStats } from "./reactAnimationGen";
import { animationModelLabel, type AnimationModel } from "./animationModels";
import { animationTierRoutingEnabled, classifyAnimationTier, modelForTier, type TierDecision } from "./animationTier";
import { fillSpecBoardOps } from "./specBoardGen";
import { fillStructureSceneOps } from "./structureSceneGen";
import { compactSuprnotesForPrompt, isSuprnotesLessonInput, type SuprnotesLessonInput } from "./suprnotes";
import { scopedBlockText } from "./beatSourceScope";
import { CODE_BEAT_PATTERN, asksForCode, looksLikeCode, mergeSplitCodeBeats, pickCodeBeats } from "./codeSpec";
import { getDocumentImages } from "./pageImageStore";
import { buildImageParts, type ContentPart } from "./fullDocumentContext";
import { boardCountFor, conceptOverlap, depthBudget, type DepthLevelName } from "./lectureDepth";

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
    else if (task.type === "generate-beat") await generateBeat(task.userId, task.sessionId, task.sequence, task.revision, queuedFor ?? undefined);
    else await enrichBeat(task.userId, task.sessionId, task.sequence, task.revision, queuedFor ?? undefined);
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
    /*
     * Start only the beats within reach of the student (lib/progressiveWindow.ts): the opening two
     * or three. Later beats are written as the student approaches them, so what they ask and answer
     * along the way shapes the beats they have not reached yet.
     */
    await dispatchDueBeats(next);
  } catch (error) {
    await failSession(session, error);
    throw error;
  }
}

/** The depth slider as the three names the budget and the pass-count both speak. */
function depthLevel(depth: string | undefined): DepthLevelName {
  return depth === "deep" ? "deep" : depth === "concise" ? "concise" : "balanced";
}

/**
 * What must be understood before this beat: the previous CONCEPT, not the previous beat.
 *
 * Keyed off concepts rather than sequence numbers, so a three-pass subtopic lists the subtopic
 * before it once, instead of naming its own earlier passes as prerequisites of itself.
 */
function prerequisitesFor(entries: ConceptPass[], sequence: number): string[] {
  const self = entries[sequence].conceptKey;
  for (let i = sequence - 1; i >= 0; i--) {
    if (entries[i].conceptKey !== self) return [entries[i].conceptKey];
  }
  return [];
}

/** Builds the global map synchronously so no model round-trip delays the first beat. */
export function buildProgressivePlan(input: ProgressiveLectureInput): ProgressiveBeatPlan[] {
  const sourcePlan = sourceDocumentPlan(input);
  if (sourcePlan.length > 0) return pickCodeBeats(sourcePlan, codeRequestText(input), requestedCode(input));
  const subject = topicKeywords(input.topic);
  const supplied = (input.outline?.subtopics ?? [])
    .map((item) => ({ title: clean(item.title), objective: clean(item.caption || item.reason || item.title) }))
    .filter((item) => item.title);
  /*
   * THE CONCEPTS DECIDE THE COUNT — see lib/lectureDepth.ts.
   *
   * This used to pad the plan up to `beatCountForDepth(depth)` with invented beats titled
   * "${subject}: idea 2/3/4", every one carrying the same objective string, and then truncate
   * anything longer. That is the whole shallow-and-repetitive complaint in two statements: the
   * padding manufactured duplicate teaching instructions, and the truncation threw away real
   * concepts the planner had reasoned about. `polishBeatPlan` then renamed the duplicates to
   * "Worked Example" / "Common Pitfalls", which hid the repetition behind distinct headings.
   *
   * A narrow topic now gets three boards taught thoroughly; a broad one gets eight. The depth
   * setting buys WORDS PER BOARD (depthBudget), never more boards.
   */
  /*
   * NO RECAP BEATS. A template recap used to close every lecture, and the outline often planned
   * its own as well — "Mathematics of Cryptography Recap" then "Cryptography Recap", two beats of
   * repetition at the end of a lesson the student asked to be strictly on their question. A lecture
   * now ends when its last concept is taught; the whole-lecture crux is the one-slide summary the
   * student can open once they finish (app/api/summarize-lecture).
   */
  const taught = supplied.filter((item) => !isRecapTitle(item.title));
  const middle = taught.length > 0 ? taught : defaultObjectives(subject, 3);
  const request = (input.focus || input.topic || subject).trim().slice(0, 160);
  /*
   * Titles are uniquified HERE, over the subtopics, and never again afterwards. `polishBeatPlan`
   * renames any duplicate title it sees, so running it after the concept expansion below would
   * rename the second and third pass over one subtopic into two unrelated-looking headings — which
   * is precisely the "separate slides for one subtopic" symptom being fixed.
   */
  const subtopics = polishBeatPlan([
    { title: subject, objective: `Open directly on what the student asked about: ${request}` },
    ...middle,
  ].slice(0, boardCountFor(middle.length + 1)), subject);

  /*
   * One subtopic becomes the one, two or three boards it actually needs. Every pass shares a
   * `conceptId`, which is what lets the board CONTINUE — slide down and keep writing — instead of
   * wiping and announcing a new title for each explanation of the same idea.
   */
  const entries = expandConceptPasses(subtopics, depthLevel(input.learnerProfile.depth), slug);

  const plan = entries.map((entry, sequence) => ({
    // The id stays per-beat and unique; the CONCEPT is what repeats.
    id: `beat-${sequence + 1}-${slug(entry.title)}${entry.passes > 1 ? `-p${entry.pass}` : ""}`,
    sequence,
    title: entry.title,
    objective: entry.objective,
    conceptId: entry.conceptKey,
    conceptPass: entry.pass,
    conceptPasses: entry.passes,
    prerequisiteConceptIds: prerequisitesFor(entries, sequence),
    visualKind: visualKindFor(sequence, entries.length, input, entry),
    estimatedDurationMs: depthBudget(input.learnerProfile.depth).boardMs,
  }));
  // A prompted lecture should exercise the live animation engine, not accidentally collapse into
  // blackboards/structure boards because every outline title matched a broad keyword. Prefer the
  // most process-like teaching beat, and keep specialised equation/plot choices intact.
  if (!plan.some((beat) => beat.visualKind === "react-animation")) {
    const candidate = plan.find((beat) =>
      /how|work|apply|example|try|mechanism|process|change|step/i.test(`${beat.title} ${beat.objective}`) &&
      !["equation", "plot", "code"].includes(beat.visualKind),
    ) ?? plan.find((beat) => !["equation", "plot", "code"].includes(beat.visualKind));
    if (candidate) candidate.visualKind = "react-animation";
  }
  // Asked for code → the lecture shows code, whether or not the plan titles happened to say so.
  return pickCodeBeats(plan, codeRequestText(input), requestedCode(input));
}

/**
 * What the student asked, in their own words: the topic they typed and the question they asked of
 * their document. Never `mood` — it carries the literal "code examples disabled".
 */
function codeRequestText(input: ProgressiveLectureInput): string {
  return `${input.topic ?? ""} ${input.focus ?? ""}`;
}

/** The student wants to see code: they said so, or their confirmed profile asks for code examples. */
function requestedCode(input: ProgressiveLectureInput): boolean {
  return input.learnerProfile.codeExamples || asksForCode(codeRequestText(input));
}

function sourceDocumentPlan(input: ProgressiveLectureInput): ProgressiveBeatPlan[] {
  if (!isSuprnotesLessonInput(input.suprnotes)) return [];
  const document = input.suprnotes;
  const rawPlan = (document.lessonPlan ?? document.suggestedLecturePlan) as Record<string, unknown> | undefined;
  const rawBeats = Array.isArray(rawPlan?.beats) ? rawPlan.beats : [];
  const plannedRaw = rawBeats
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
    .map((item) => {
      const sourceBlockIds = Array.isArray(item.sourceBlockIds)
        ? item.sourceBlockIds.filter((id): id is string => typeof id === "string")
        : [];
      return {
        title: clean(item.title),
        objective: clean(item.objective) || clean(item.teachingGoal) || clean(item.title),
        sourceBlockIds,
        visualKind: sourceCodeKind(document, sourceBlockIds) ?? sourceVisualKind(item),
      };
    })
    // A document section planned as a recap/summary is dropped too — no lecture ends on a recap.
    .filter((item) => item.title && !isRecapTitle(item.title));
  // A listing the planner cut across beats is re-joined, so the code board shows the whole function.
  const planned = mergeSplitCodeBeats(plannedRaw, (ids) => scopedBlockText(document.contentBlocks ?? [], ids));
  /*
   * DEPTH CAPS THE BEAT COUNT FOR A DOCUMENT TOO, not just for a typed topic.
   *
   * The prompt path has always honoured depth — 6 beats concise, 8 balanced, 10 deep. This path
   * ignored it and took a flat 12 blocks, so an uploaded PDF produced a longer lecture than the
   * same request typed as a sentence, and asking for "concise" changed only the words per beat
   * while the lecture still ran twelve sections. That is the regression: concise stopped meaning
   * concise on exactly the source type where documents are longest.
   *
   * Applied to the model's own plan as well as the block fallback, since a long PDF makes the
   * planner propose many beats and the cap is what makes the student's choice win.
   */
  /*
   * A document's board count follows the document's own structure, not the depth slider. Depth is
   * spent on WORDS PER BOARD instead (depthBudget), so "concise" on a long PDF now means each
   * section is taught briskly rather than the last two thirds of the document being dropped —
   * `planned.slice(0, beatCap)` silently discarded the tail of real material.
   */
  const beatCap = boardCountFor(planned.length > 0 ? planned.length : (document.contentBlocks ?? []).length);
  const fallback = planned.length > 0 ? planned.slice(0, beatCap) : (document.contentBlocks ?? [])
    .slice()
    .sort((a, b) => (a.sourceOrder ?? 0) - (b.sourceOrder ?? 0))
    .slice(0, beatCap)
    .map((block) => ({
      title: clean(block.heading) || `Page ${block.pageNumber ?? "source"}`,
      objective: clean(block.text).slice(0, 260) || `Teach the source material in ${block.id}.`,
      sourceBlockIds: [block.id],
      visualKind: (looksLikeCode(block.text) ? "code" : "react-animation") as ProgressiveVisualKind,
    }));
  /*
   * A DOCUMENT'S SECTIONS GET THE SAME CONTINUOUS BOARD as a typed topic's subtopics.
   *
   * This path previously emitted no `conceptId` at all, so every beat fell back to a `legacy:` id
   * and no two beats could ever share a concept — a PDF section explained over two boards produced
   * two unrelated titled slides, which is the reported behaviour. Expanding here keeps the source's
   * own structure (one section is still one concept) while letting a section that needs a worked
   * example take a second board underneath the first.
   *
   * Source provenance is carried onto every pass, so an extracted figure still attaches to each
   * board that teaches its page.
   */
  const polished = polishBeatPlan(fallback, input.topic);
  const provenance = new Map(polished.map((item) => [item.title, item]));
  const expanded = expandConceptPasses(
    polished.map((item) => ({ title: item.title, objective: item.objective })),
    depthLevel(input.learnerProfile.depth),
    slug,
  );
  return expanded.map((item, sequence) => {
    const source = provenance.get(item.title);
    return {
      id: `beat-${sequence + 1}-${slug(item.title)}${item.passes > 1 ? `-p${item.pass}` : ""}`,
      sequence,
      title: item.title,
      objective: item.objective,
      conceptId: item.conceptKey,
      conceptPass: item.pass,
      conceptPasses: item.passes,
      prerequisiteConceptIds: prerequisitesFor(expanded, sequence),
      sourceBlockIds: source?.sourceBlockIds,
      visualKind: source?.visualKind ?? ("react-animation" as ProgressiveVisualKind),
      estimatedDurationMs: depthBudget(input.learnerProfile.depth).boardMs,
    };
  });
}

/**
 * A beat planned from pages that contain program source teaches THAT code, so it gets the code
 * board whatever the planner recommended. Asked about a PDF's `remove()` function, the lecture drew
 * an animated tree and never showed the function the student was reading.
 */
function sourceCodeKind(document: SuprnotesLessonInput, sourceBlockIds: string[]): ProgressiveVisualKind | null {
  if (sourceBlockIds.length === 0) return null;
  return looksLikeCode(scopedBlockText(document.contentBlocks ?? [], sourceBlockIds)) ? "code" : null;
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
  const title = entry.title.toLowerCase();
  const planText = `${entry.title} ${entry.objective}`.toLowerCase();
  if (/\b(?:equation|formula|derivation|solve|algebra|calculus)\b/.test(title)) return "equation";
  if (/\b(?:chart|graph|trend|probability distribution|data plot)\b/.test(title)) return "plot";
  if (/\b(?:cycle|pipeline|state machine|hierarchy|workflow|architecture)\b/.test(title)) return "structure";
  if (/\b(?:definition)\b/.test(title)) return "blackboard";
  // A student who asked for code gets it on the beats that teach an implementation. This rule used
  // to exist and return "react-animation" — i.e. it did nothing, and no lecture ever showed code.
  if (requestedCode(input) && CODE_BEAT_PATTERN.test(planText)) return "code";
  // The sandbox is the normal teaching surface, matching the pre-progressive pipeline. Specialised
  // renderers above are opt-ins only when the title explicitly calls for their grammar.
  return "react-animation";
}

async function generateBeat(userId: string, sessionId: string, sequence: number, revision: number, queuedMs?: number): Promise<void> {
  const textStartedAt = performance.now();
  const textStartedIso = new Date().toISOString();
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
  let scriptMs = 0;
  try {
    const input = await progressiveInput(session);
    const generated = await generateOneBeat(input, session, planned);
    beat = generated.beat;
    costUsd = generated.costUsd;
    scriptMs = generated.scriptMs;
  } catch (cause) {
    error = messageFor(cause);
    beat = deterministicFallbackBeat(planned, session, sequence);
  }

  const latest = await progressiveBeat(sessionId, sequence);
  if (latest && latest.revision > revision) return;
  const textMs = Math.round(performance.now() - textStartedAt);
  await upsertProgressiveBeat({
    ...baseDoc,
    state: "playable",
    beat,
    fallbackUsed: Boolean(error),
    costUsd: baseDoc.costUsd + costUsd,
    error,
    timing: {
      queuedMs,
      textStartedAt: textStartedIso,
      textMs,
      scriptMs: Math.round(scriptMs),
      textOverheadMs: Math.max(0, textMs - Math.round(scriptMs)),
    },
  });
  await dispatchProgressiveTasks([
    { version: 1, type: "enrich-beat", sessionId, userId, sequence, revision },
  ]);
}

/** The "How to teach them" sentence of the portrait block, for the board brief. */
function teachingPlanFrom(persona: string | undefined): string {
  const line = persona?.split("\n").find((l) => l.startsWith("How to teach them: "));
  return line ? line.slice("How to teach them: ".length).trim().slice(0, 240) : "";
}

async function generateOneBeat(
  input: ProgressiveLectureInput,
  session: ProgressiveLectureSessionDoc,
  planned: ProgressiveBeatPlan,
): Promise<{ beat: Beat; costUsd: number; scriptMs: number }> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is not set.");
  const client = new OpenAI({ apiKey });
  /*
   * The word budget IS the board's dwell time: the player advances when narration ends and has no
   * other timer, so this number alone decides whether a concept stays up for forty seconds or two
   * minutes. The old 95-130 made the requested depth physically impossible — a worked example plus
   * its setup and interpretation does not fit in forty seconds of speech.
   */
  const budget = depthBudget(input.learnerProfile.depth);
  const wordRange = `${budget.wordRange[0]}-${budget.wordRange[1]}`;
  const isCheckpoint = planned.sequence > 0 && planned.sequence < session.plan.length - 1 && planned.sequence % 3 === 0;
  /*
   * WHO THIS IS FOR. The full planning profile (what they know, are shaky on, and believe wrongly)
   * plus a brief for THIS beat pitched by level (lib/learnerBrief.ts). This used to be one line —
   * "use language for a beginner learner" — and nothing the student said while planning reached here.
   */
  const learner = input.learner;
  const depth = learner ? resolveDepth(learner) : null;
  const learnerSection = learner && depth
    ? `${learnerInstruction(learner, depth)}\nTHIS BEAT, FOR THIS STUDENT: ${learnerBrief(learner, planned, "script", depth)}`
    : "";
  /*
   * WHO THEY ARE ACROSS LESSONS. The portrait Aria keeps of this student (lib/learnerModel.ts
   * personaForPrompt): interests to draw examples from, strengths not to re-teach, what is still
   * settling, and how to teach them. The planning profile above knows this topic; this knows the person.
   */
  const personaSection = input.learnerPersona?.trim() ? `\n${input.learnerPersona.trim()}` : "";
  if (personaSection && planned.sequence === 0) console.log(`[persona] script prompt for ${session.id} carries the student portrait (${personaSection.length} chars)`);
  /*
   * WHAT HAS ALREADY BEEN SAID. The last two beats' actual scripts, not just their plan titles, so
   * this beat builds on the explanation the student heard rather than repeating or contradicting it.
   * Beats are now written just ahead of the student, so these are normally the beats they just watched.
   */
  /*
   * EVERY earlier board, not a sliding window of two.
   *
   * With a 2-beat window, board 8 could not see boards 1-5 and happily re-taught them. Titles plus
   * an opening slice are enough to recognise "already covered" without spending the context that
   * full scripts would, and the most recent board is kept in full because that is the one this
   * board must actually continue from.
   */
  const priorDocs = (await progressiveBeats(session.id))
    .filter((doc) => doc.sequence < planned.sequence && doc.beat?.script)
    .sort((a, b) => a.sequence - b.sequence);
  const priorScripts = priorDocs.map((doc) => ({
    sequence: doc.sequence,
    title: doc.beat?.title,
    script: (doc.beat?.script ?? "").slice(0, doc.sequence === planned.sequence - 1 ? 1_600 : 420),
  }));
  /*
   * Boards the planner may have made too similar to one already taught. Named explicitly so the
   * model is told what NOT to repeat rather than left to infer it from a JSON field — the old
   * prompt supplied priorScripts and never once mentioned them.
   */
  const alreadyCovered = priorDocs.length > 0
    ? conceptOverlap(
        { title: planned.title, objective: planned.objective },
        priorDocs.map((doc) => ({ title: doc.beat?.title ?? "", objective: doc.beat?.teacherMove ?? "" })),
      )
    : { overlap: 0, with: -1 };
  /*
   * WHAT THIS BOARD IS, WITHIN ITS CONCEPT.
   *
   * The instruction here used to be flat: "Never split a single concept across boards to make the
   * lecture longer." That is right for a one-board concept and exactly wrong for a subtopic
   * deliberately taught over two or three — the model was told to pack everything into each board,
   * so every pass restated the whole idea in different words. That is the reported "it still
   * explains the same thing, just differently".
   *
   * A continuation pass is now told three things it previously had no way to know: that the board
   * ALREADY HAS the earlier passes' work on it, which specific job this pass has, and that it must
   * not re-establish what is already written above it.
   */
  const passIndex = planned.conceptPass ?? 1;
  const passTotal = planned.conceptPasses ?? 1;
  const passInstruction = passTotal <= 1
    ? " Never split a single concept across boards to make the lecture longer."
    : passIndex === 1
      ? ` This concept is taught across ${passTotal} boards and THIS IS BOARD 1 of ${passTotal}: establish the idea itself — what it is and why it is true — and STOP there. Do not work the example or cover the edge cases; later boards of this same concept do that. End at a natural pause, not a summary.`
      : ` This is BOARD ${passIndex} of ${passTotal} ON THE SAME CONCEPT, continuing directly underneath the work already on the board. The student can still SEE the earlier boards, so do NOT re-introduce, re-define or re-motivate the idea, and do not summarise it — open as a teacher continuing mid-explanation ("so let's put numbers on that", "now watch what happens when…"). Teach ONLY this pass's job: ${planned.objective}`;

  const pageImages = beatPageImages(input, planned.sourceBlockIds);
  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    {
      role: "system",
      content: `You write one beat of a spoken, adaptive tutor lecture. Return JSON only with title, transitionIn, teacherMove, slideKind, points, script, optional definitionTerm/definitionMeaning, and optional checkpoint. Keep the supplied beat title exactly; it is the canonical title already approved in the plan. For every beat after the first, transitionIn is one natural 8-18 word sentence that connects the previous beat's insight to this beat without saying a generic phrase such as "moving on". On the FIRST beat, transitionIn is instead one natural 8-16 word opening line that leads the student into the topic — it is the first thing they hear, so make it warm and specific to this lecture, never a greeting such as "hello" or "welcome back". The script must be ${wordRange} words: this is ONE FULL TEACHING UNIT on a board a real teacher would keep up for a minute or more, not a slide bullet. Develop the concept properly — ${budget.movements[0]}-${budget.movements[1]} movements such as the intuition, the mechanism step by step, a concrete worked example with real numbers, an equation or diagram reading, the mistake people make, and what it lets you do — ALL WITHIN THIS ONE BOARD.${passInstruction} DO NOT restate what earlier beats already taught: priorScripts below is what the student has already heard, so build on it and reference it briefly instead of re-explaining it. Accurate and warm throughout. Use language for a ${input.learnerProfile.expertise} learner seeking ${input.learnerProfile.depth} depth for a ${input.learnerProfile.goal} goal. ${codeInstruction(input, session, planned)} Never write a recap or summary: teach THIS beat's concept, even when it is the last beat — the lecture ends when its last concept is taught, and slideKind is never "recap".${learnerSection}${personaSection} ${isCheckpoint ? "This is a checkpoint beat. Include checkpoint with prompt, acceptableKeywords as arrays of keywords, correctFeedback, hintFeedback, revealAnswer, three options, and correctOption." : "Do not create a checkpoint."}`,
    },
    {
      role: "user",
      content: JSON.stringify({
        topic: input.topic,
        beat: planned,
        previousBeat: planned.sequence > 0 ? session.plan[planned.sequence - 1] : null,
        fullPlan: session.plan.map(({ sequence, title, objective }) => ({ sequence, title, objective })),
        adaptation: session.adaptationNotes,
        priorScripts,
        alreadyTaughtWarning: alreadyCovered.overlap > 0.55
          ? `This board's plan overlaps heavily with beat ${alreadyCovered.with} which the student has ALREADY heard. Teach the genuinely new part of it and refer back to the rest in a sentence — do not re-explain it.`
          : null,
        preferredExamples: input.learnerProfile.preferredExamples,
        sourceContext: sourceContext(input, planned.sourceBlockIds),
        ...(pageImages.length > 0
          ? { sourcePages: "The pages this beat is built from are attached as images. They ARE the source: teach what they actually show — their text, code, figures and worked examples — even where sourceContext is thin or empty (a scanned page has no extractable text)." }
          : {}),
      }),
    },
  ];
  if (pageImages.length > 0) {
    const last = messages[messages.length - 1];
    messages[messages.length - 1] = {
      role: "user",
      content: [{ type: "text", text: String(last.content) }, ...pageImages] as OpenAI.Chat.Completions.ChatCompletionContentPart[],
    };
  }
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
  const beat = sanitizeGeneratedBeat(payload, planned, session);
  // The board generators read this as AUDIENCE guidance, so the visual is pitched like the script.
  if (learner && depth) beat.learnerBrief = learnerBrief(learner, planned, "visual", depth);
  // The portrait's teaching plan reaches the boards too, through the same audience brief.
  const teachingPlan = teachingPlanFrom(input.learnerPersona);
  if (teachingPlan) beat.learnerBrief = `${beat.learnerBrief ? `${beat.learnerBrief} ` : ""}From earlier lessons with this student: ${teachingPlan}`;
  return {
    beat,
    scriptMs: performance.now() - scriptStartedAt,
    costUsd: costFor(MODEL, completion.usage),
  };
}

/**
 * The title of the last DIFFERENT concept, for the spoken bridge.
 *
 * Using `plan[sequence - 1]` would name the previous pass of the same subtopic — "that leads
 * directly into Chlorophyll" spoken while already teaching Chlorophyll.
 */
function previousConceptTitle(session: ProgressiveLectureSessionDoc, planned: ProgressiveBeatPlan): string | null {
  const self = planned.conceptId ?? planned.id;
  for (let i = planned.sequence - 1; i >= 0; i--) {
    const candidate = session.plan[i];
    if (candidate && (candidate.conceptId ?? candidate.id) !== self) return candidate.title;
  }
  return null;
}

/**
 * What the script may say about code. The listing itself is shown on the code board, never read
 * aloud — the script is speech, so it WALKS THROUGH the code ("first it searches left or right…")
 * rather than reciting symbols.
 */
function codeInstruction(input: ProgressiveLectureInput, session: ProgressiveLectureSessionDoc, planned: ProgressiveBeatPlan): string {
  if (planned.visualKind === "code") {
    return "This beat's board shows the actual code listing (quoted from the source when the source contains it), highlighted as you speak. Walk through that code in order — what each part does and why — in plain spoken sentences; never read symbols, brackets or syntax aloud, and never put code in the script.";
  }
  return requestedCode(input) || session.learnerProfile.codeExamples
    ? "Include a code snippet only when it genuinely teaches the topic."
    : "Do not include code.";
}

function sanitizeGeneratedBeat(payload: GeneratedBeatPayload, planned: ProgressiveBeatPlan, session: ProgressiveLectureSessionDoc): Beat {
  const points = Array.isArray(payload.points)
    ? payload.points.filter((item): item is string => typeof item === "string").map(clean).filter(Boolean).slice(0, 4)
    : [];
  // No script is a generation failure, not something to paper over: the fallback used to be the
  // planner's objective, so the tutor's own instruction was read aloud. The caller's catch takes the
  // deterministic fallback beat instead.
  if (typeof payload.script !== "string" || !payload.script.trim()) {
    throw new Error(`the model returned no script for beat ${planned.sequence + 1}`);
  }
  const script = payload.script.trim();
  // With no model points, the board shows the opening of what the student hears — never the plan
  // objective, which is an instruction to the tutor (lib/boardBrief.ts).
  const boardPoints = points.length > 0 ? points : pointsFromScript(script);
  const rawKind = String(payload.slideKind ?? "");
  const slideKind: SlideKind = ["intro", "definition", "checkpoint", "compare", "recap"].includes(rawKind)
    ? rawKind as SlideKind
    : "intro";
  const checkpoint = slideKind === "checkpoint" ? sanitizeCheckpoint(payload.checkpoint, planned) : undefined;
  return {
    id: planned.id,
    title: planned.title,
    conceptId: planned.conceptId ?? planned.id,
    conceptObjective: planned.objective,
    prerequisiteConceptIds: planned.prerequisiteConceptIds ?? [],
    conceptPass: planned.conceptPass,
    conceptPasses: planned.conceptPasses,
    /*
     * Beat one opens the lecture rather than bridging from anything; either way the player treats
     * this as the sentence to start speaking on the title slide (lib/beatPresentation.ts).
     *
     * A CONTINUATION PASS GETS NO BRIDGE. `transitionIn` is what announces a new section — the
     * player holds the title card while it is spoken — so emitting one for the second board of the
     * same subtopic would both re-announce an idea already in progress and stop the board from
     * simply sliding on. Continuing an explanation is not a transition.
     */
    transitionIn: (planned.conceptPass ?? 1) > 1
      ? undefined
      : planned.sequence > 0
      ? transitionSentence(payload.transitionIn, previousConceptTitle(session, planned) ?? session.topic, planned.title)
      : openingSentence(payload.transitionIn, session.topic),
    teacherMove: clean(payload.teacherMove) || planned.objective,
    stepLabel: `${planned.sequence + 1} · ${planned.sequence === 0 ? "Start" : slideKind === "checkpoint" ? "Check" : "Learn"}`,
    slideKind,
    points: boardPoints,
    definitionTerm: clean(payload.definitionTerm) || undefined,
    definitionMeaning: clean(payload.definitionMeaning) || undefined,
    checkpoint,
    script,
    sourceBlockIds: planned.sourceBlockIds,
    draw: fallbackDraw(planned.title, boardPoints, planned.estimatedDurationMs),
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
  /*
   * The model failed outright, so there is no written content — only the plan, whose objective is an
   * instruction to the tutor ("Open with a concrete puzzle…", "Define X plainly…"). That used to be
   * the board's first bullet AND the opening of what Aria said. Everything here is student-facing,
   * built from the beat's title and the topic: thin, but never the tutor's own notes read aloud.
   */
  const script = `Let's look at ${planned.title}, and where it fits in ${session.topic}. Watch the board as we build it up, notice what changes and what stays the same, and connect each piece back to the bigger picture.`;
  const points = [planned.title, `How it fits in ${session.topic}`];
  return {
    id: planned.id,
    title: planned.title,
    conceptId: planned.conceptId ?? planned.id,
    conceptObjective: planned.objective,
    prerequisiteConceptIds: planned.prerequisiteConceptIds ?? [],
    conceptPass: planned.conceptPass,
    conceptPasses: planned.conceptPasses,
    // As in sanitizeGeneratedBeat: a continuation pass is not a transition and gets no bridge.
    transitionIn: (planned.conceptPass ?? 1) > 1
      ? undefined
      : sequence > 0
      ? transitionSentence(undefined, previousConceptTitle(session, planned) ?? session.topic, planned.title)
      : openingSentence(undefined, session.topic),
    teacherMove: "Keep the lesson moving with a clear, visual explanation.",
    stepLabel: `${sequence + 1} · Learn`,
    slideKind: "intro",
    points,
    script,
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

async function enrichBeat(userId: string, sessionId: string, sequence: number, revision: number, queuedMs?: number): Promise<void> {
  const enrichStartedAt = performance.now();
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
  let visualChoiceMs = 0;
  let premiumMs = 0;
  let animation: import("./reactAnimationGen").AnimationTiming | undefined;
  let tier: TierDecision | undefined;
  // What the director made of this beat, when it was asked — reused to re-brief a refused board.
  let visualSpec: BeatVisualSpec | undefined;
  let visualForm: VisualForm | undefined;
  if (client && session.sourceType === "prompt") {
    const choiceStartedAt = performance.now();
    const selection = await chooseProgressiveVisual(client, candidate, planned.visualKind, sequence);
    visualChoiceMs = performance.now() - choiceStartedAt;
    visualKind = selection.kind;
    visualSpec = selection.spec;
    visualForm = selection.form;
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
      /*
       * Beats below the starter count are the ones holding up playback — see
       * STARTER_REFINE_BUDGET_MS. Read from the session rather than hardcoded so the two cannot
       * drift apart if starterBeatCount ever changes.
       */
      const blocksPlayback = sequence < session.starterBeatCount;
      /*
       * HOW HEAVY IS THIS ANIMATION, and so which model draws it (lib/animationTier.ts). A recap
       * slide and a traced algorithm used to get whichever model their position in the lecture
       * handed them. The opening beats are not asked: they hold up playback, so they stay on the
       * fast starter model whatever they show — that cap is what makes the lecture start quickly.
       */
      if (visualKind === "react-animation" && animationTierRoutingEnabled()) {
        if (blocksPlayback) {
          tier = { tier: "light", reason: "opening beat: drawn by the fast model so the lecture can start" };
        } else {
          const tierStartedAt = performance.now();
          const decided = await classifyAnimationTier(client, candidate);
          visualChoiceMs += performance.now() - tierStartedAt;
          costUsd += decided.costUsd;
          tier = { tier: decided.tier, reason: decided.reason };
        }
        console.log(`[animation-tier] session=${sessionId} seq=${sequence} tier=${tier.tier} model=${blocksPlayback ? STARTER_ANIMATION_MODEL : modelForTier(tier.tier).id} reason="${tier.reason}"`);
      }
      const result = await fillPremium(
        client,
        candidate,
        visualKind,
        session.sourceType !== "prompt",
        sequence,
        blocksPlayback,
        tier && !blocksPlayback ? modelForTier(tier.tier) : undefined,
        visualKind === "code" ? await codeBoardSource(session, candidate.sourceBlockIds) : undefined,
      );
      // The single most expensive call in the pipeline — an animation generation plus its vision
      // critic and refine pass. Timed separately from the enclosing task so the rest of enrichment
      // (Cosmos reads/writes, the visual-kind choice) can be told apart from the model work.
      logTiming("premium", sessionId, premiumStartedAt, `seq=${sequence} kind=${visualKind}`);
      premiumMs = performance.now() - premiumStartedAt;
      animation = result.animation;
      costUsd += result.costUsd;
      success = result.success;
      error = result.error;

      /*
       * A REFUSED BOARD DROPS TO A WRITTEN ONE — it does not leave the student a blank board.
       *
       * When a board fails (refused by the critic, or never produced) this published the
       * pre-enrichment placeholder: a white board with the title and one line, which is what the
       * student saw on "1857 War". The older pipeline already drops a failed board down a chain —
       * structure diagram, then a written chalk board, which cannot fail on content — in
       * lib/boardFallback.ts. This is the same chain, for one beat, re-briefed from what the director
       * made of the beat or, failing that, from what the student hears (never the plan).
       */
      if (!success && candidate.slideKind !== "checkpoint" && process.env.BLACKBOARD_GEN_ENABLED === "1") {
        const rescueStartedAt = performance.now();
        const spec: BeatVisualSpec = visualSpec ?? {
          subject: boardBriefFor(candidate),
          mustShow: candidate.points.slice(0, 4),
          mustNotShow: "",
          isPhysical: false,
        };
        try {
          const rescue = await rescueEmptyBoards(
            client,
            [candidate],
            new Map([[candidate.id, spec]]),
            new Map(visualForm ? [[candidate.id, visualForm]] : []),
          );
          costUsd += rescue.costUsd;
          if (hasUsableBoard(candidate)) {
            success = true;
            const board = candidate.draw?.ops.find((op) => ["structureScene", "chalkBoard", "plotBoard", "equationBoard", "codeBoard"].includes(op.kind))?.kind ?? "written";
            error = `${error ?? `${visualKind} board failed`} — rescued with a ${board} board`;
            console.error(`[progressive-worker] beat=${candidate.id} ${visualKind} failed; rescued with ${board}`);
          }
        } catch (cause) {
          console.error(`[progressive-worker] rescue failed for ${candidate.id}:`, cause);
        }
        premiumMs += performance.now() - rescueStartedAt;
      }
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
    timing: {
      ...latest.timing,
      enrichQueuedMs: queuedMs,
      visualChoiceMs: Math.round(visualChoiceMs),
      visualKind,
      premiumMs: Math.round(premiumMs),
      enrichMs: Math.round(performance.now() - enrichStartedAt),
      readyAt: new Date().toISOString(),
      animation,
      ...(tier ? { animationTier: tier.tier, animationTierReason: tier.reason } : {}),
    },
    fallbackUsed: !success || latest.fallbackUsed,
    costUsd: latest.costUsd + costUsd,
    error: error ?? latest.error,
  });
  // A beat finishing is one of the moments the window can move: queue whatever is now due. The
  // session is re-read because the student has likely moved on since this beat started.
  await dispatchDueBeats(await requiredSession(userId, sessionId));
  await maybeFinalize(userId, sessionId);
}

const PROGRESSIVE_KIND_FOR_BOARD: Record<Exclude<BoardKind, "morph">, ProgressiveVisualKind> = {
  reactAnimation: "react-animation",
  manimScene: "manim",
  structureScene: "structure",
  chalkBoard: "blackboard",
  plotBoard: "plot",
  equationBoard: "equation",
  codeBoard: "code",
};

/** Uses the same semantic visual director as the full lecture engine. The provisional plan remains
 * the safe fallback if either classification call is unavailable. */
async function chooseProgressiveVisual(
  client: OpenAI,
  beat: Beat,
  fallback: ProgressiveVisualKind,
  sequence: number,
): Promise<{ kind: ProgressiveVisualKind; costUsd: number; spec?: BeatVisualSpec; form?: VisualForm }> {
  /*
   * DO NOT PAY FOR A CLASSIFICATION WHOSE ANSWER IS ALREADY DECIDED.
   *
   * When the provisional plan reserved this beat for the sandbox, the branch below returns
   * `fallback` unchanged no matter what the classifier says — the comment there explains why, and
   * it is correct. But the two model calls still ran first: `planBeatVisual` then `direct`, both
   * sequential, both on the critical path to first play, and both discarded.
   *
   * `visualKindFor` makes "react-animation" the default for prompted lectures, so this was the
   * COMMON case, not an edge one. Returning early removes two round trips per animated beat while
   * changing no decision the pipeline would have made — the chosen kind is identical either way.
   */
  /*
   * EXCEPT THE FIRST BEAT. Its title is forced to the bare topic ("1857 War"), so the plan's keyword
   * rules can never match it and it always fell through to an animation — the board most likely to
   * be refused (a history topic drew a light bulb) and the one that sets the whole lecture's first
   * impression. It is worth the two calls (~1.5 s, ~$0.01) to let the director choose from what the
   * beat actually teaches: a diagram for history, an animation for an algorithm.
   */
  const opening = sequence === 0;
  if (fallback === "react-animation" && !opening) {
    return { kind: fallback, costUsd: 0 };
  }
  // A code beat was chosen because the student asked for code on an implementation beat; letting a
  // classifier redraw it as a diagram is exactly how the code never reached the board.
  if (fallback === "code") return { kind: fallback, costUsd: 0 };

  try {
    const visual = await planBeatVisual(client, beat);
    if (!visual.spec) return { kind: fallback, costUsd: visual.costUsd };
    const selected = await direct(client, specToBrief(visual.spec));
    const board = selected.plan?.board;
    const chosen = { spec: visual.spec, form: selected.plan?.form, costUsd: visual.costUsd + selected.costUsd };
    if (!board) return { kind: fallback, ...chosen };
    // (The "fallback is already react-animation" case is handled by the early return above, before
    // these two calls are made at all — it used to be checked here, after paying for both.)
    // A broad technical topic can make every visual specification mention "connections", causing
    // an independent per-beat classifier to turn definitions, benefits and recaps into the same ELK
    // network. Structure is accepted only when the beat title itself says relationships/stages are
    // the teaching object; otherwise the varied content-aware provisional plan wins.
    // The guard stops every beat of one lecture collapsing into the same diagram; with a single
    // opening beat there is nothing to collapse, and its title is the bare topic, which would
    // always fail the test.
    if (!opening && board === "structureScene" && !/\b(?:how .* works?|architecture|pipeline|cycle|state machine|workflow|flow|hierarchy|components?|stages?|sequence)\b/i.test(beat.title)) {
      return { kind: fallback, ...chosen };
    }
    // Morph authoring needs inline before/after geometry, which this asynchronous filler does not
    // invent. The sandbox is the full engine's safe live-animation choice for transformations.
    const kind = board === "morph" ? "react-animation" : PROGRESSIVE_KIND_FOR_BOARD[board];
    return { kind, ...chosen };
  } catch (cause) {
    console.error(`[progressive-worker] visual direction failed for ${beat.id}:`, cause);
    return { kind: fallback, costUsd: 0 };
  }
}

function premiumPlaceholder(beat: Beat, kind: ProgressiveVisualKind): DrawScript {
  // What the student hears and reads — never `teacherMove`, which is a stage direction. Briefed on
  // "spark curiosity", the generator drew a light bulb (lib/boardBrief.ts).
  const brief = boardBriefFor(beat);
  const common = { caption: beat.title, durationMs: beat.draw?.durationMs ?? 45_000, surface: "paper" as const };
  if (kind === "react-animation") return { ...common, ops: [{ kind: "reactAnimation", teachingPoint: brief, at: 0, endAt: 1 }] };
  if (kind === "blackboard") return { ...common, ops: [{ kind: "chalkBoard", boardBrief: brief, at: 0, endAt: 1 }] };
  if (kind === "manim") return { ...common, ops: [{ kind: "manimScene", sceneBrief: brief, at: 0, endAt: 1 }] };
  if (kind === "structure") return { ...common, ops: [{ kind: "structureScene", structureBrief: brief, at: 0, endAt: 1 }] };
  if (kind === "plot") return { ...common, ops: [{ kind: "plotBoard", plotBrief: brief, at: 0, endAt: 1 }] };
  if (kind === "equation") return { ...common, ops: [{ kind: "equationBoard", equationBrief: brief, at: 0, endAt: 1 }] };
  if (kind === "code") return { ...common, ops: [{ kind: "codeBoard", codeBrief: brief, at: 0, endAt: 1 }] };
  return beat.draw ?? fallbackDraw(beat.title, beat.points, common.durationMs);
}

/**
 * How long a board may spend being refined when NOTHING IS PLAYING YET.
 *
 * The opening beats are the whole of the student's wait: playback starts only once
 * `starterBeatCount` beats are enriched, and `[timing] kind=premium` has measured single boards at
 * 66-206 s inside the refine loop. Every later beat is built behind a beat that is already playing,
 * so it keeps the full budget and loses nothing.
 *
 * The loop keeps the best-scoring board it has when the clock stops, so this lowers the ceiling on
 * polish for the first boards rather than risking a blank one.
 */
/**
 * The model that draws the OPENING beats' boards, whatever else is configured.
 *
 * The start of a lecture waits on these boards alone, and per attempt the models measured Luna
 * ~14 s, Terra ~29 s, Sol ~44 s: the measured 114 s wait was beat 2 drawn by Terra. With model
 * rotation on for comparison, the opening beats are exempt; later beats, built while the student is
 * already watching, keep the rotation.
 */
const STARTER_ANIMATION_MODEL = process.env.PROGRESSIVE_STARTER_ANIMATION_MODEL ?? "gpt-5.6-luna";

const STARTER_REFINE_BUDGET_MS = Math.max(
  10_000,
  Number(process.env.PROGRESSIVE_STARTER_REFINE_BUDGET_MS ?? 20_000),
);

async function fillPremium(
  client: OpenAI,
  beat: Beat,
  kind: ProgressiveVisualKind,
  hasSource: boolean,
  animationIndex = 0,
  /** True while this beat is one the student is actively waiting on. */
  blocksPlayback = false,
  /** The model this beat's animation tier calls for (lib/animationTier.ts); absent → rotation or default. */
  tierModel?: AnimationModel,
  /** The beat's own document text and pages, so a code board can quote the student's code verbatim. */
  source?: { text: string; images: ContentPart[]; request: string },
) {
  if (!process.env.OPENAI_API_KEY) return { success: false, costUsd: 0, error: "OPENAI_API_KEY is not set." };
  if (kind === "react-animation" && process.env.REACT_ANIMATIONS_ENABLED !== "1") return disabled(kind);
  if (kind === "blackboard" && process.env.BLACKBOARD_GEN_ENABLED !== "1") return disabled(kind);
  if (kind === "manim" && process.env.MANIM_RENDER_ENABLED !== "1") return disabled(kind);
  const stats = kind === "react-animation"
    ? await fillReactAnimationOps(client, [beat], {
        animationIndexOffset: animationIndex,
        refineTimeBudgetMs: blocksPlayback ? STARTER_REFINE_BUDGET_MS : undefined,
        ...(blocksPlayback
          ? { model: { id: STARTER_ANIMATION_MODEL, label: animationModelLabel(STARTER_ANIMATION_MODEL) ?? STARTER_ANIMATION_MODEL } }
          : tierModel
            ? { model: tierModel }
            : {}),
      })
    : kind === "blackboard"
      ? await fillBlackboardOps(client, [beat], hasSource)
      : kind === "manim"
        ? await fillManimSceneOps(client, [beat])
        : kind === "structure"
          ? await fillStructureSceneOps(client, [beat])
          : await fillSpecBoardOps(client, [beat], source
            ? {
                sourceByBeatId: new Map([[beat.id, source.text]]),
                imagesByBeatId: new Map([[beat.id, source.images]]),
                requestByBeatId: new Map([[beat.id, source.request]]),
              }
            : undefined);
  return {
    success: stats.filled > 0,
    costUsd: stats.costUsd,
    error: stats.issues[0] ?? (stats.filled > 0 ? null : `${kind} enrichment was unavailable.`),
    animation: kind === "react-animation" ? (stats as ReactAnimationFillStats).timings?.[0] : undefined,
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

/**
 * The source material one beat is allowed to see.
 *
 * WHY SCOPING MATTERS MORE THAN IT LOOKS. Only the suprnotes branch below ever narrowed to the
 * beat's own blocks; `context`, `transcript` and `focus` were pushed whole for every beat and the
 * result truncated at 18 000 characters. Two things follow, and both were visible in the output:
 *
 *   1. Every beat was handed the ENTIRE document, so a beat about page 9 read pages 1-4 first and
 *      wrote about them — the lecture drifted back toward the opening pages instead of advancing.
 *   2. Truncation is positional, so on a long PDF the later pages were simply absent. A beat
 *      planned from page 15 could be written from material that never mentioned page 15.
 *
 * Scoping by the planner's own `sourceBlockIds` fixes both: the beat sees its pages, in full,
 * within budget. The unscoped text stays as the fallback for a topic-only lecture, which has no
 * blocks to scope to.
 */
function sourceContext(input: ProgressiveLectureInput, sourceBlockIds?: string[]): string {
  /*
   * The beat's own pages lead. `focus` (the student's question) is always included — it is short
   * and it is the one piece of context every beat needs — while the full-document text is used
   * only when there is nothing more specific, so it can no longer crowd out the beat's own pages.
   */
  const scopedDocument = scopedDocumentText(input, sourceBlockIds);
  const parts = scopedDocument
    ? [input.focus, scopedDocument, input.diagramHints]
    : [input.context, input.diagramHints, input.transcript, input.focus];
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

/**
 * The text of just the blocks this beat was planned from, or "" when there are none.
 *
 * Returning "" rather than the whole document is deliberate: a beat with no blocks is a topic-only
 * beat, and the caller falls back to the unscoped text for exactly that case. Silently widening to
 * the full document here would reintroduce the drift this function exists to stop.
 */
async function codeBoardSource(session: ProgressiveLectureSessionDoc, sourceBlockIds?: string[]) {
  const input = await progressiveInput(session);
  return {
    text: sourceContext(input, sourceBlockIds),
    images: beatPageImages(input, sourceBlockIds),
    request: codeRequestText(input).trim(),
  };
}

/**
 * The uploaded pages this beat is built from, as images for the model.
 *
 * `documentId` was accepted by the route and never read, so every beat of a PDF lecture was written
 * from extracted text alone — and a scanned PDF has none: "tree del.pdf" (0 characters of text)
 * produced a lecture that knew nothing of its pages. The page images parse-pdf already rendered are
 * attached instead: the beat's own pages when its blocks say which, otherwise every page.
 *
 * A miss is silent and ordinary — the store is in-process memory with a 45-minute life
 * (lib/pageImageStore.ts), so a restarted server, or a worker running in another process, writes
 * the beat from text as before.
 */
function beatPageImages(input: ProgressiveLectureInput, sourceBlockIds?: string[]): ContentPart[] {
  const stored = getDocumentImages(input.documentId);
  if (!stored || stored.pages.length === 0) return [];
  const wanted = new Set(sourceBlockIds ?? []);
  const blocks = isSuprnotesLessonInput(input.suprnotes) ? input.suprnotes.contentBlocks ?? [] : [];
  const pageNumbers = new Set(
    blocks.filter((block) => wanted.has(block.id) && typeof block.pageNumber === "number").map((block) => block.pageNumber as number),
  );
  const pages = pageNumbers.size > 0 ? stored.pages.filter((page) => pageNumbers.has(page.pageNumber)) : stored.pages;
  return buildImageParts(pages.length > 0 ? pages : stored.pages, [], stored.unit);
}

function scopedDocumentText(input: ProgressiveLectureInput, sourceBlockIds?: string[]): string {
  const document = input.suprnotes;
  if (!isSuprnotesLessonInput(document)) return "";
  return scopedBlockText(document.contentBlocks ?? [], sourceBlockIds);
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

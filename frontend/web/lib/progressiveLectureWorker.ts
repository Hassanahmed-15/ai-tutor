import "server-only";

import OpenAI from "openai";
import type { DrawScript } from "@/components/sketch/LiveSketch";
import { fillBlackboardOps } from "./blackboardGen";
import { planBeatVisual, specToBrief, type BeatVisualSpec } from "./beatVisualSpec";
import { direct, type BoardKind, type VisualForm } from "./director";
import { archiveLecture } from "./lectureArchive";
import type { Beat, CheckpointSpec, SlideKind } from "./lessonContent";
import { openingSentence, transitionSentence } from "./beatPresentation";
import { boardBriefFor, pointsFromScript } from "./boardBrief";
import { hasUsableBoard, rescueEmptyBoards } from "./boardFallback";
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
import { fillReactAnimationOps, type ReactAnimationFillOptions, type ReactAnimationFillStats } from "./reactAnimationGen";
import { animationModelLabel, type AnimationModel } from "./animationModels";
import { animationTierRoutingEnabled, classifyAnimationTier, modelForTier, type TierDecision } from "./animationTier";
import { fillSpecBoardOps, repeatsCode } from "./specBoardGen";
import { looksQuantitative } from "./quantitativeBeat";
import { fillStructureSceneOps } from "./structureSceneGen";
import { compactSuprnotesForPrompt, isSuprnotesLessonInput, type SuprnotesLessonInput } from "./suprnotes";
import { blocksForSelection, scopedBlockText } from "./beatSourceScope";
import { isStrictSource, sourceScopeInstruction } from "./sourceScope";
import { asksForCode, isProgrammingTopic } from "./codeSpec";
import { getDocumentImages } from "./pageImageStore";
import { buildImageParts, type ContentPart } from "./fullDocumentContext";
import { depthBudget, strictDepthBudget } from "./lectureDepth";
import { buildBeatScriptMessages, keyClaimsFrom, type GeneratedBeatPayload } from "./beatScriptPrompt";
import { auditBeat, claimsAllowedFor, describeFinding, repairScript, subjectTerms } from "./lessonRepetition";
import { buildProgressivePlan, clean, sourceRoleFor } from "./progressivePlan";
import { scriptRoleFor, type TeachingRole } from "./lessonLadder";
import type { BeatSourceGrounding } from "./sourceGrounding";
import {
  beatNeedsBoard,
  beatSourceGrounding,
  cleanSourceText,
  expandedCropRect,
  groundBeatToSource,
  isCheckpointBeat,
  questionAnswerBlockIds,
  sourceFigureRegion,
  sourceScriptFromBlocks,
  sourceWordCount,
  strictAdaptationNotes,
  strictRepetitionFindings,
  ungroundedScriptSentences,
} from "./strictSourceScript";

const MODEL = process.env.OPENAI_PROGRESSIVE_MODEL ?? process.env.OPENAI_LECTURE_MODEL ?? "gpt-4o-mini";


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

/** The blocks of the dragged area, or [] when the lecture is not from a selection. */
function selectionBlockIds(input: ProgressiveLectureInput): string[] {
  if (!input.selection || !isSuprnotesLessonInput(input.suprnotes)) return [];
  return blocksForSelection(input.suprnotes.contentBlocks ?? [], input.selection);
}

/** The selection, stated as the lecture's subject — for every beat's context and its board. */
function selectionSection(input: ProgressiveLectureInput): string {
  const selection = input.selection;
  if (!selection?.transcript.trim()) return "";
  const where = selection.pages.length > 0 ? ` OF PAGE ${selection.pages.join(", ")}` : "";
  return `THE STUDENT SELECTED THIS PART${where} — it is the subject of the whole lecture. Teach it; the rest of the document is background, used only to explain it:\n${selection.transcript.trim()}`;
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
  // A programming topic counts even when the student never typed "code" (see isProgrammingTopic).
  return input.learnerProfile.codeExamples || asksForCode(codeRequestText(input)) || isProgrammingTopic(codeRequestText(input));
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
  let source: BeatSource | null = null;
  try {
    const input = await progressiveInput(session);
    source = beatSourceFor(input, session, planned);
    const generated = await generateOneBeat(input, session, planned, source);
    beat = generated.beat;
    costUsd = generated.costUsd;
    scriptMs = generated.scriptMs;
  } catch (cause) {
    error = messageFor(cause);
    beat = deterministicFallbackBeat(planned, session, sequence, source);
  }

  const latest = await progressiveBeat(sessionId, sequence);
  if (latest && latest.revision > revision) return;
  const textMs = Math.round(performance.now() - textStartedAt);
  await upsertProgressiveBeat({
    ...baseDoc,
    state: "playable",
    beat,
    // The board step reads the beat's source from here rather than loading the input again.
    ...(source?.grounding ? { sourceGrounding: source.grounding } : {}),
    ...(source?.figure ? { sourceFigure: source.figure } : {}),
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

/**
 * EVERYTHING ONE BEAT MAY TEACH FROM, decided once, for its script and for its board.
 *
 * Before this, the script was scoped to the beat's blocks and the board to nothing at all: the
 * board generator was handed a title, a script and "draw the actual subject", and drew the textbook
 * page's "Energy transfer" section as an invented leaf with its own labels. Script and board now
 * answer to the same record (lib/strictSourceScript.ts beatSourceGrounding), and it is stored on
 * the beat's document so the board step needs no second read of the input.
 */
type BeatSource = {
  /** "Strictly from the source" — the student's choice, on a lesson that has a source to be strict about. */
  strict: boolean;
  /** The beat's own source, handed to its board: own blocks, printed labels, caption. */
  grounding: BeatSourceGrounding | null;
  /**
   * What the SCRIPT may draw on, and what its grounding gate checks against: the beat's own source,
   * plus — for a board that reads the source's Questions box — the earlier sections on the same page,
   * where the answers are. Null when there is nothing to check against (a typed topic, or a scanned
   * page with no text layer, whose images are its only source).
   */
  scriptGrounding: BeatSourceGrounding | null;
  /** The Questions board's answer sections, as text for the prompt. */
  answerText: string;
  /** How many words the beat's own source says, which sizes a strict script. */
  words: number;
  /** The beat's source as speakable text: a strict lesson's floor when generation fails. */
  spoken: string;
  /** The rung the script is written to (the source rungs, in strict mode). */
  role: TeachingRole | undefined;
  figure?: ProgressiveBeatDoc["sourceFigure"];
};

/** Below this, a text layer is too thin to police a script against: a scanned page is its images. */
const MIN_GROUNDING_WORDS = 20;

function beatSourceFor(input: ProgressiveLectureInput, session: ProgressiveLectureSessionDoc, planned: ProgressiveBeatPlan): BeatSource {
  const document = isSuprnotesLessonInput(input.suprnotes) ? input.suprnotes : null;
  const blocks = document?.contentBlocks ?? [];
  const wholeText = [
    document ? scopedBlockText(blocks, blocks.map((block) => block.id)) : "",
    input.context,
    input.transcript,
  ].filter((part): part is string => Boolean(part?.trim())).join("\n\n");
  // Strict needs something to be strict ABOUT. A typed topic has no source, so it is never strict.
  const strict = isStrictSource(input.sourceScope) && Boolean(document || wholeText.trim());
  const grounding = document ? beatSourceGrounding(blocks, planned.sourceBlockIds, strict, document.assets ?? []) : null;
  // A beat planned without blocks of its own is still fenced by the lesson's whole source.
  const fence = grounding ?? (strict && wholeText.trim() ? { text: cleanSourceText(wholeText), labels: [], strict: true } : null);
  const role: TeachingRole | undefined = strict
    ? planned.role === "questions" || planned.role === "source"
      ? planned.role
      : document ? sourceRoleFor(document, planned.title, planned.sourceBlockIds) : scriptRoleFor(planned.role, true)
    : planned.role;
  const answerIds = strict && role === "questions" ? questionAnswerBlockIds(session.plan, planned.sequence, blocks) : [];
  const answerText = answerIds.length ? cleanSourceText(scopedBlockText(blocks, answerIds)) : "";
  const scriptSource = fence && answerText ? { ...fence, text: `${fence.text}\n\n${answerText}` } : fence;
  const checkable = scriptSource && scriptSource.text.split(/\s+/).filter(Boolean).length >= MIN_GROUNDING_WORDS ? scriptSource : null;
  const figure = document && input.documentId ? sourceFigureRegion(blocks, planned.sourceBlockIds) : null;
  return {
    strict,
    grounding,
    scriptGrounding: strict ? checkable : null,
    answerText,
    words: grounding ? sourceWordCount(blocks, planned.sourceBlockIds) : 0,
    spoken: grounding ? sourceScriptFromBlocks(blocks, planned.sourceBlockIds) : "",
    role,
    ...(figure && input.documentId ? { figure: { documentId: input.documentId, ...figure } } : {}),
  };
}

async function generateOneBeat(
  input: ProgressiveLectureInput,
  session: ProgressiveLectureSessionDoc,
  planned: ProgressiveBeatPlan,
  source: BeatSource,
): Promise<{ beat: Beat; costUsd: number; scriptMs: number }> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is not set.");
  const client = new OpenAI({ apiKey });
  const strict = source.strict;
  /*
   * The word budget IS the board's dwell time: the player advances when narration ends and has no
   * other timer, so this number alone decides whether a concept stays up for forty seconds or two
   * minutes. The old 95-130 made the requested depth physically impossible — a worked example plus
   * its setup and interpretation does not fit in forty seconds of speech.
   *
   * A strict board is sized to its SOURCE instead (lib/lectureDepth.ts strictDepthBudget): asked
   * for 300 words about a 75-word section, the only way to comply is to invent the other 225.
   */
  const budget = strict && source.words > 0
    ? strictDepthBudget(source.words, depthBudget(input.learnerProfile.depth))
    : depthBudget(input.learnerProfile.depth);
  const wordRange = `${budget.wordRange[0]}-${budget.wordRange[1]}`;
  const isCheckpoint = isCheckpointBeat(planned.sequence, session.plan.length, session.sourceType);
  // The rung the script is written to, and the one its repetition audit judges it by.
  const role = strict ? scriptRoleFor(source.role, true) : planned.role;
  /*
   * WHO THIS IS FOR. The full planning profile (what they know, are shaky on, and believe wrongly)
   * plus a brief for THIS beat pitched by level (lib/learnerBrief.ts). This used to be one line —
   * "use language for a beginner learner" — and nothing the student said while planning reached here.
   *
   * Strict keeps the pitch and drops the rest: the profile's prerequisite gaps, misconceptions to
   * correct and background "to use for examples" each ask the script to teach something the source
   * does not contain.
   */
  const learner = input.learner;
  const depth = learner ? resolveDepth(learner) : null;
  const learnerSection = learner && depth
    ? strict
      ? `THIS BEAT, FOR THIS STUDENT: ${learnerBrief(learner, planned, "script", depth, { strict: true })}`
      : `${learnerInstruction(learner, depth)}\nTHIS BEAT, FOR THIS STUDENT: ${learnerBrief(learner, planned, "script", depth)}`
    : "";
  /*
   * WHO THEY ARE ACROSS LESSONS. The portrait Aria keeps of this student (lib/learnerModel.ts
   * personaForPrompt): interests to draw examples from, strengths not to re-teach, what is still
   * settling, and how to teach them. The planning profile above knows this topic; this knows the person.
   *
   * Not in a strict lesson. Every line of the portrait steers content — interests become examples,
   * "strong on" skips source material the student chose to be taught, "how to teach them" asks for
   * analogies — and a strict lesson's content is its source.
   */
  const personaSection = !strict && input.learnerPersona?.trim() ? `\n${input.learnerPersona.trim()}` : "";
  if (personaSection && planned.sequence === 0) console.log(`[persona] script prompt for ${session.id} carries the student portrait (${personaSection.length} chars)`);

  /*
   * WHAT THE STUDENT ALREADY KNOWS, as the claims each earlier board established, plus the full
   * script of the board immediately before this one (the one it must continue from). Every earlier
   * board is included — a window of two let board 8 re-teach boards 1-5.
   */
  const priorDocs = (await progressiveBeats(session.id))
    .filter((doc) => doc.sequence < planned.sequence && doc.beat?.script)
    .sort((a, b) => a.sequence - b.sequence);
  const taught = priorDocs.map((doc) => ({
    sequence: doc.sequence,
    title: doc.beat?.title ?? session.plan[doc.sequence]?.title ?? "",
    keyClaims: doc.beat?.keyClaims?.length ? doc.beat.keyClaims : keyClaimsFrom({}, doc.beat?.script ?? ""),
    previousScript: doc.sequence === planned.sequence - 1 ? doc.beat?.script : undefined,
  }));
  const priorForAudit = priorDocs.map((doc) => ({
    title: doc.beat?.title ?? session.plan[doc.sequence]?.title ?? "",
    script: doc.beat?.script ?? "",
    role: strict ? scriptRoleFor(session.plan[doc.sequence]?.role, true) : session.plan[doc.sequence]?.role,
  }));
  const subject = subjectTerms(input.topic);

  /*
   * The page images this beat is built from. A scanned page has no extractable text, so these ARE
   * the source; the dragged crop travels with them, labelled as the subject.
   *
   * A STRICT beat with a real text layer is written from that text alone. A page carries several
   * sections, and with the whole page in view the "Energy transfer" script taught the
   * "Photosynthesis" paragraph and the Questions box printed beside it — content from other boards,
   * which the repetition gate then flagged, and whose regeneration asked for NEW material. The text
   * layer, with the figure's printed labels, is also the only reading of the page that is not a
   * model's interpretation. Dropping the page images also removes ~765 input tokens per page from
   * the call. A dragged selection keeps its images: its crop is the subject.
   */
  const textOnly = strict && source.words >= MIN_GROUNDING_WORDS && !input.selection?.transcript.trim();
  const pageImages = textOnly ? [] : beatPageImages(input, planned.sourceBlockIds);
  // A Questions board is shown where the answers are, so it can name them without answering past them.
  const context = [
    sourceContext(input, planned.sourceBlockIds, strict),
    source.answerText
      ? `EARLIER SOURCE SECTIONS ON THIS PAGE — only for saying WHERE a question's answer is (quote them if they state it); never re-teach them:\n${source.answerText}`
      : "",
  ].filter(Boolean).join("\n\n");
  const adaptation = strict ? strictAdaptationNotes(session.adaptationNotes) : session.adaptationNotes;
  type ScriptFeedback = {
    repetition?: Parameters<typeof buildBeatScriptMessages>[0]["repetitionFeedback"];
    grounding?: Parameters<typeof buildBeatScriptMessages>[0]["groundingFeedback"];
  };
  const messagesFor = (feedback: ScriptFeedback = {}): OpenAI.Chat.Completions.ChatCompletionMessageParam[] => {
    const { system, user } = buildBeatScriptMessages({
      topic: input.topic,
      planned: { ...planned, role },
      plan: session.plan.map(({ sequence, title, objective, role }) => ({ sequence, title, objective, role })),
      taught,
      wordRange,
      movements: budget.movements,
      learnerProfile: input.learnerProfile,
      learnerSection,
      personaSection,
      isCheckpoint,
      adaptation,
      sourceContext: context,
      sourceInstruction: strict && input.sourceScope ? sourceScopeInstruction(input.sourceScope) : "",
      strict,
      codeInstruction: codeInstruction(input, session, planned, strict),
      selectionScoped: Boolean(input.selection?.transcript.trim()),
      hasPageImages: pageImages.length > 0,
      repetitionFeedback: feedback.repetition,
      groundingFeedback: feedback.grounding,
    });
    if (pageImages.length === 0) return [{ role: "system", content: system }, { role: "user", content: user }];
    // Multimodal: the pages ride with the user message so the beat writer can read them.
    return [
      { role: "system", content: system },
      { role: "user", content: [{ type: "text", text: user }, ...pageImages] as OpenAI.Chat.Completions.ChatCompletionContentPart[] },
    ];
  };
  const scriptStartedAt = performance.now();
  let costAccum = 0;
  const writeScript = async (feedback?: ScriptFeedback): Promise<GeneratedBeatPayload> => {
    const completion = await client.chat.completions.create({
      model: MODEL,
      messages: messagesFor(feedback),
      response_format: { type: "json_object" },
      ...(isModernModel(MODEL) ? { max_completion_tokens: 2_000 } : { max_tokens: 2_000, temperature: 0.35 }),
    });
    costAccum += costFor(MODEL, completion.usage);
    return JSON.parse(completion.choices[0]?.message?.content ?? "{}") as GeneratedBeatPayload;
  };

  /*
   * THE REPETITION GATE. A board is audited against every board before it (lib/lessonRepetition.ts):
   * restated sentences, a second definition or analogy of the subject, a return to basics, or a
   * whole-board overlap. A board that repeats is written again with the offending sentences quoted
   * back; if it still repeats, the repeated sentences are removed. Prompting asks the model not to
   * repeat; this is what makes sure it did not.
   *
   * In a strict lesson the source's own sentences are exempt (a Questions board and a "(part 2)"
   * board re-read the page by design, and deleting them would drop required source content), and
   * the fix asked for is deletion only (lib/strictSourceScript.ts strictRepetitionFindings).
   *
   * THE GROUNDING GATE (strict only). Every sentence is checked against the beat's source: one with
   * two or more content words the source never uses is saying something the source does not. The
   * opening beats hold up playback, so for them this never costs a model call — flagged sentences are
   * deleted (they ride along only on a regeneration the repetition gate was paying for anyway).
   * Later beats are written ahead of the student, so they get ONE regeneration with the flagged
   * sentences quoted back; whatever is still flagged after that is deleted. Nothing ungrounded ships.
   */
  const gate = source.scriptGrounding;
  const blocksPlayback = planned.sequence < session.starterBeatCount;
  const audit = (candidate: Beat) => {
    const findings = auditBeat({ title: candidate.title, script: candidate.script, role }, priorForAudit, subject, planned.sequence);
    return gate ? strictRepetitionFindings(findings, gate.text) : findings;
  };
  const ungrounded = (candidate: Beat) => (gate ? ungroundedScriptSentences(candidate.script, gate) : []);
  let payload = await writeScript();
  let beat = sanitizeGeneratedBeat(payload, planned, session, isCheckpoint, role);
  let findings = audit(beat);
  const flagged = ungrounded(beat);
  if (findings.length > 0 || (flagged.length > 0 && !blocksPlayback)) {
    if (findings.length > 0) {
      console.log(`[repetition] session=${session.id} seq=${planned.sequence} attempt=1 findings=${findings.length} :: ${findings.map((f) => describeFinding(f, [...priorForAudit, beat])).join(" | ")}`);
    }
    if (flagged.length > 0) {
      console.log(`[grounding] session=${session.id} seq=${planned.sequence} attempt=1 ungrounded=${flagged.length} :: ${flagged.map((f) => `"${f.sentence.slice(0, 80)}" [${f.missing.slice(0, 4).join(",")}]`).join(" | ")}`);
    }
    payload = await writeScript({
      repetition: findings.map((finding) => ({
        finding,
        matchedTitle: finding.matchBeatIndex !== undefined ? priorForAudit[finding.matchBeatIndex]?.title : undefined,
      })),
      grounding: flagged,
    });
    beat = sanitizeGeneratedBeat(payload, planned, session, isCheckpoint, role);
    findings = audit(beat);
    if (findings.length > 0) {
      const fixed = repairScript(beat.script, findings);
      if (fixed.repaired) beat = { ...beat, script: fixed.script };
      console.log(`[repetition] session=${session.id} seq=${planned.sequence} attempt=2 findings=${findings.length} repaired=${fixed.repaired} removed=${fixed.removed.length}`);
    }
  }
  if (gate) {
    const grounded = groundBeatToSource(beat, gate, {
      sourceScript: source.spoken,
      // A neutral bridge: the ordinary fallback promises "a concrete example" whenever a title says
      // "try" or "practice", which a strict source may not have.
      fallbackTransition: continuationPass(planned)
        ? undefined
        : planned.sequence > 0
          ? `Next, the source turns to ${planned.title}.`
          : openingSentence(undefined, session.topic),
    });
    if (grounded.removed.length > 0) {
      console.log(`[grounding] session=${session.id} seq=${planned.sequence} deleted=${grounded.removed.length} starter=${blocksPlayback} :: ${grounded.removed.map((s) => `"${s.slice(0, 80)}"`).join(" | ")}`);
    }
    beat = grounded.beat;
  }
  logTiming("beat-script", session.id, scriptStartedAt, `seq=${planned.sequence} model=${MODEL}${strict ? ` strict=1 words=${wordRange}` : ""}`);
  // The board generators read this as AUDIENCE guidance, so the visual is pitched like the script.
  if (learner && depth) beat.learnerBrief = learnerBrief(learner, planned, "visual", depth, { strict });
  // The portrait's teaching plan reaches the boards too, through the same audience brief — except
  // in a strict lesson, where "how to teach them" is not the source.
  const teachingPlan = strict ? "" : teachingPlanFrom(input.learnerPersona);
  if (teachingPlan) beat.learnerBrief = `${beat.learnerBrief ? `${beat.learnerBrief} ` : ""}From earlier lessons with this student: ${teachingPlan}`;
  return {
    beat,
    scriptMs: performance.now() - scriptStartedAt,
    costUsd: costAccum,
  };
}

/** A second or later board over one concept: it continues the explanation and gets no spoken bridge. */
function continuationPass(planned: ProgressiveBeatPlan): boolean {
  return (planned.conceptPass ?? 1) > 1;
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
function codeInstruction(input: ProgressiveLectureInput, session: ProgressiveLectureSessionDoc, planned: ProgressiveBeatPlan, strict = false): string {
  if (planned.visualKind === "code") {
    return "This beat's board shows the actual code listing (quoted from the source when the source contains it), highlighted as you speak. Walk through that code in order — what each part does and why — in plain spoken sentences; never read symbols, brackets or syntax aloud, and never put code in the script.";
  }
  // A strict lesson shows code only where its source prints code; a snippet written "because it
  // teaches the topic" is content from outside the source.
  if (strict) return "Do not include code unless this board's own source contains it; then quote it exactly and never write code of your own.";
  return requestedCode(input) || session.learnerProfile.codeExamples
    ? "Include a code snippet only when it genuinely teaches the topic."
    : "Do not include code.";
}

function sanitizeGeneratedBeat(
  payload: GeneratedBeatPayload,
  planned: ProgressiveBeatPlan,
  session: ProgressiveLectureSessionDoc,
  isCheckpoint: boolean,
  /** The rung the script was written to, which decides which keyClaims it may establish. */
  role: TeachingRole | undefined = planned.role,
): Beat {
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
  const declaredKind: SlideKind = ["intro", "definition", "checkpoint", "compare", "recap"].includes(rawKind)
    ? rawKind as SlideKind
    : "intro";
  /*
   * An uploaded source never gets a model-written quiz slide, even when the model sets one on its
   * own: the source's own Questions boxes are its questions (lib/strictSourceScript.ts isCheckpointBeat).
   */
  const slideKind: SlideKind = declaredKind === "checkpoint" && !isCheckpoint && session.sourceType !== "prompt" ? "intro" : declaredKind;
  const keyClaims = claimsAllowedFor(keyClaimsFrom(payload, script), subjectTerms(session.topic), role);
  const checkpoint = slideKind === "checkpoint" ? sanitizeCheckpoint(payload.checkpoint, planned, script, keyClaims) : undefined;
  return {
    id: planned.id,
    title: planned.title,
    conceptId: planned.conceptId ?? planned.id,
    conceptObjective: planned.objective,
    prerequisiteConceptIds: planned.prerequisiteConceptIds ?? [],
    conceptPass: planned.conceptPass,
    conceptPasses: planned.conceptPasses,
    keyClaims,
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

function sanitizeCheckpoint(value: unknown, planned: ProgressiveBeatPlan, script: string, keyClaims: string[]): CheckpointSpec {
  const raw = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const options = Array.isArray(raw.options) ? raw.options.filter((v): v is string => typeof v === "string").slice(0, 3) : [];
  const keywords = Array.isArray(raw.acceptableKeywords)
    ? raw.acceptableKeywords.filter(Array.isArray).map((set) => set.filter((v): v is string => typeof v === "string")).filter((set) => set.length > 0)
    : [];
  /*
   * The fallbacks are what this board SAID, never the plan's objective. The objective is an
   * instruction to the tutor — for a document, "Teach these source blocks completely and in order…"
   * — and it was printed as the hint and revealed as "the answer" whenever the model left them out.
   */
  const said = keyClaims[0] || pointsFromScript(script, 1)[0] || planned.title;
  return {
    prompt: clean(raw.prompt) || `In your own words, what is the key idea in ${planned.title}?`,
    acceptableKeywords: keywords.length ? keywords : planned.title.split(/\s+/).slice(0, 2).map((word) => [word]),
    correctFeedback: clean(raw.correctFeedback) || "Yes — that captures the key idea.",
    hintFeedback: clean(raw.hintFeedback) || `Look back at what this board said about ${planned.title}.`,
    revealAnswer: clean(raw.revealAnswer) || said,
    options: options.length === 3 ? options : undefined,
    correctOption: Number.isInteger(raw.correctOption) ? Math.max(0, Math.min(2, Number(raw.correctOption))) : undefined,
  };
}

function deterministicFallbackBeat(planned: ProgressiveBeatPlan, session: ProgressiveLectureSessionDoc, sequence: number, source?: BeatSource | null): Beat {
  /*
   * The model failed outright, so there is no written content — only the plan, whose objective is an
   * instruction to the tutor ("Open with a concrete puzzle…", "Define X plainly…"). That used to be
   * the board's first bullet AND the opening of what Aria said. Everything here is student-facing,
   * built from the beat's title and the topic: thin, but never the tutor's own notes read aloud.
   *
   * In a strict lesson the fallback is the source itself, read in order: "where it fits in the
   * bigger picture" is a claim about the subject the source never made, and it was also the only
   * brief the board got — so a failed script produced a board drawn from nothing at all.
   */
  const spoken = source?.strict ? source.spoken : "";
  const script = spoken || `Let's look at ${planned.title}, and where it fits in ${session.topic}. Watch the board as we build it up, notice what changes and what stays the same, and connect each piece back to the bigger picture.`;
  const points = spoken ? pointsFromScript(spoken) : [planned.title, `How it fits in ${session.topic}`];
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
    ...(spoken ? { keyClaims: keyClaimsFrom({}, spoken) } : {}),
    // Provenance survives a failed script: the source highlight, and the board's own source, key off it.
    sourceBlockIds: planned.sourceBlockIds,
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
  /*
   * A CHECKPOINT SLIDE HAS NO BOARD. The player shows the question slide in its place, so the board
   * this used to generate — an animation with its critic and refine loop, 20-55 s — was never seen,
   * and held the dispatch window back while it ran. The slide keeps its written placeholder draw.
   */
  const boardless = !beatNeedsBoard(candidate);
  if (client && session.sourceType === "prompt" && !boardless) {
    const choiceStartedAt = performance.now();
    const selection = await chooseProgressiveVisual(client, candidate, planned.visualKind, sequence);
    visualChoiceMs = performance.now() - choiceStartedAt;
    visualKind = selection.kind;
    visualSpec = selection.spec;
    visualForm = selection.form;
    costUsd += selection.costUsd;
  }
  if (boardless) visualKind = "live-svg";
  console.error(`[progressive-worker] beat=${candidate.id} renderer-plan=${visualKind} provisional=${planned.visualKind}${boardless ? " (checkpoint slide: no board)" : ""}`);
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
      const boardSource = visualKind === "react-animation" ? await boardSourceFor(session, planned, doc) : undefined;
      const result = await fillPremium(
        client,
        candidate,
        visualKind,
        session.sourceType !== "prompt",
        sequence,
        blocksPlayback,
        tier && !blocksPlayback ? modelForTier(tier.tier) : undefined,
        visualKind === "code" ? await codeBoardSource(session, candidate.sourceBlockIds) : undefined,
        boardSource,
        visualKind === "code" ? await otherCodeFor(sessionId, sequence) : undefined,
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
       * NO CODE IS EVER SHOWN TWICE. Boards ahead of the student are generated in parallel, so two
       * code boards can be written at the same moment without seeing each other. Re-checked here,
       * against every other board's code as it stands NOW: a repeat gets one regeneration that sees
       * all of it, and a board that still repeats is dropped — the rescue below gives the slide a
       * different board rather than the same listing again.
       */
      if (visualKind === "code" && success) {
        const code = codeOnBoard(candidate);
        const others = await otherCodeFor(sessionId, sequence);
        if (code && repeatsCode(code, others)) {
          clearCodeBoard(candidate);
          const retry = await fillPremium(client, candidate, visualKind, session.sourceType !== "prompt", sequence, blocksPlayback,
            tier && !blocksPlayback ? modelForTier(tier.tier) : undefined, await codeBoardSource(session, candidate.sourceBlockIds), boardSource, others);
          costUsd += retry.costUsd;
          const second = codeOnBoard(candidate);
          if (!retry.success || !second || repeatsCode(second, await otherCodeFor(sessionId, sequence))) {
            clearCodeBoard(candidate, true);
            success = false;
            error = "code board repeated another board's code";
            console.error(`[progressive-worker] beat=${candidate.id} code repeated an earlier board; dropped`);
          }
        }
      }

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
          // The beat's own source rides along (persisted on the doc by generateBeat): a strict
          // rescue must stay inside it too, and an opening beat's rescue adds no critic call.
          const rescueSource = boardSource ?? doc.sourceGrounding;
          const rescue = await rescueEmptyBoards(
            client,
            [candidate],
            new Map([[candidate.id, spec]]),
            new Map(visualForm ? [[candidate.id, visualForm]] : []),
            { sources: rescueSource ? new Map([[candidate.id, rescueSource]]) : undefined, blocksPlayback },
          );
          costUsd += rescue.costUsd;
          // The rescue may itself write a code board; it is held to the same rule.
          const rescuedCode = codeOnBoard(candidate);
          if (rescuedCode && repeatsCode(rescuedCode, await otherCodeFor(sessionId, sequence))) clearCodeBoard(candidate, true);
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

/**
 * Beats whose visual is a RELATIONSHIP BETWEEN TWO QUANTITIES, and therefore a chart.
 *
 * Deliberately narrow: it must name plotting, axes, a correlation, a trend, or one quantity
 * against another ("study hours vs test score", "price against demand"). A beat that merely
 * mentions a number is not a chart, and routing it to one would be worse than the sandbox.
 */
const QUANTITATIVE_BEAT = /\b(?:scatter|scatterplot|plot|graph|chart|histogram|curve|axes|axis)\b/i;

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
  /*
   * AND EXCEPT A BEAT THAT IS PLAINLY A CHART.
   *
   * The sandbox has no axes primitive — its shape vocabulary is circle/rect/hexagon/line/chain/
   * leaf/droplet — so a beat about two quantities has to FAKE a coordinate system out of `line`
   * shapes and arrow glyphs. That is what produced the reported board: a corner bracket where the
   * axes should be, a stray ">" floating mid-canvas, a rotated y-label written over the subtitle,
   * an arrow pointing into blank space, and no fitted line at all on a board titled "Linear
   * Regression".
   *
   * `plotBoard` exists precisely for this and derives its axes, ticks and scales from the data
   * (lib/plotSpec.ts) — LiveSketch's own comment says a plot beat should never be hand-drawn SVG.
   * Letting the director see these beats costs two calls on the few beats that look quantitative,
   * and nothing on the rest, which keeps the latency win for ordinary animated beats.
   */
  const opening = sequence === 0;
  // Title, on-screen points and the narration's opening — the title alone often only names the topic
  // (lib/quantitativeBeat.ts has the board that proved it). QUANTITATIVE_BEAT is kept as the floor.
  const quantitative = QUANTITATIVE_BEAT.test(beat.title) || looksQuantitative(beat);
  if (fallback === "react-animation" && !opening && !quantitative) {
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
    // A planned animation was only offered to the director because its title names a chart. Only a
    // PLOT answer may take the animation away; any other answer keeps the sandbox the plan chose.
    // Without this, "regression", "slope" and "vs" were enough to turn most of a lecture into charts.
    if (fallback === "react-animation" && quantitative && board !== "plotBoard") return { kind: fallback, ...chosen };
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
  /**
   * The beat's own source for an animated board — text, printed figure labels, caption, the
   * figure's crop, and whether the lesson is strict. Before this the animation generator was given
   * no source at all and drew the subject from general knowledge.
   */
  grounding?: BeatSourceGrounding,
  /** Listings earlier code boards already showed — a new code board must not repeat them. */
  priorCode?: string[],
) {
  if (!process.env.OPENAI_API_KEY) return { success: false, costUsd: 0, error: "OPENAI_API_KEY is not set." };
  if (kind === "react-animation" && process.env.REACT_ANIMATIONS_ENABLED !== "1") return disabled(kind);
  if (kind === "blackboard" && process.env.BLACKBOARD_GEN_ENABLED !== "1") return disabled(kind);
  if (kind === "manim" && process.env.MANIM_RENDER_ENABLED !== "1") return disabled(kind);
  // The source travels under the shared contract (lib/sourceGrounding.ts), keyed by beat id.
  const animationOptions: ReactAnimationFillOptions = {
    animationIndexOffset: animationIndex,
    refineTimeBudgetMs: blocksPlayback ? STARTER_REFINE_BUDGET_MS : undefined,
    // An opening board gets every free gate but no refine call: the student is waiting on it.
    ...(blocksPlayback ? { blocksPlayback: true } : {}),
    ...(blocksPlayback
      ? { model: { id: STARTER_ANIMATION_MODEL, label: animationModelLabel(STARTER_ANIMATION_MODEL) ?? STARTER_ANIMATION_MODEL } }
      : tierModel
        ? { model: tierModel }
        : {}),
    ...(grounding ? { sourceByBeatId: { [beat.id]: grounding } } : {}),
  };
  const stats = kind === "react-animation"
    ? await fillReactAnimationOps(client, [beat], animationOptions)
    : kind === "blackboard"
      ? await fillBlackboardOps(client, [beat], hasSource)
      : kind === "manim"
        ? await fillManimSceneOps(client, [beat])
        : kind === "structure"
          ? await fillStructureSceneOps(client, [beat])
          : await fillSpecBoardOps(client, [beat], {
              ...(source
                ? {
                    sourceByBeatId: new Map([[beat.id, source.text]]),
                    imagesByBeatId: new Map([[beat.id, source.images]]),
                    requestByBeatId: new Map([[beat.id, source.request]]),
                  }
                : {}),
              ...(priorCode?.length ? { priorCodeByBeatId: new Map([[beat.id, priorCode]]) } : {}),
            });
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
function sourceContext(input: ProgressiveLectureInput, sourceBlockIds?: string[], strict = isStrictSource(input.sourceScope)): string {
  /*
   * The beat's own pages lead. `focus` (the student's question) is always included — it is short
   * and it is the one piece of context every beat needs — while the full-document text is used
   * only when there is nothing more specific, so it can no longer crowd out the beat's own pages.
   */
  const scopedDocument = cleanSourceText(scopedDocumentText(input, sourceBlockIds));
  // The dragged area leads every beat's context: it is what the lecture is ABOUT. (It used to be
  // dropped as soon as a beat had blocks of its own, since it travels as `transcript`.)
  const selected = selectionSection(input);
  const parts = scopedDocument
    ? [selected, input.focus, scopedDocument, input.diagramHints]
    : [selected, input.context, input.diagramHints, selected ? undefined : input.transcript, input.focus];
  if (isSuprnotesLessonInput(input.suprnotes)) {
    const selected = new Set(sourceBlockIds ?? []);
    const scoped: SuprnotesLessonInput = selected.size > 0
      ? {
          ...input.suprnotes,
          contentBlocks: (input.suprnotes.contentBlocks ?? []).filter((block) => selected.has(block.id)),
          assets: (input.suprnotes.assets ?? []).filter((asset) => (asset.sourceBlockIds ?? []).some((id) => selected.has(id))),
        }
      : input.suprnotes;
    /*
     * A beat with blocks of its own gets ITS source only: its blocks (with their roles) and its
     * figures' captions — not the whole-document plan twice over, the generation directives or the
     * vision model's descriptions presented as source (lib/suprnotes.ts compactBeatSource).
     */
    parts.push(compactSuprnotesForPrompt(scoped, { scope: selected.size > 0 ? "beat" : "document", strict }));
  } else if (input.suprnotes) parts.push(JSON.stringify(input.suprnotes));
  return parts.filter((part): part is string => typeof part === "string" && Boolean(part.trim())).join("\n\n").slice(0, 18_000);
}

/**
 * The beat's source for its animated board, with the figure cropped from its page when the page
 * image is in reach.
 *
 * Read from the beat's own document, where the script step stored it — no second load of the input
 * on the path to the first board. A beat written before that field existed rebuilds it once from
 * the input (one blob read, only for those beats).
 */
async function boardSourceFor(session: ProgressiveLectureSessionDoc, planned: ProgressiveBeatPlan, doc: ProgressiveBeatDoc): Promise<BeatSourceGrounding | undefined> {
  let grounding = doc.sourceGrounding;
  let figure = doc.sourceFigure;
  if (!grounding && session.sourceType !== "prompt" && planned.sourceBlockIds?.length) {
    try {
      const rebuilt = beatSourceFor(await progressiveInput(session), session, planned);
      grounding = rebuilt.grounding ?? undefined;
      figure = rebuilt.figure;
    } catch (cause) {
      console.error(`[progressive-worker] beat=${doc.beat?.id} could not rebuild its source:`, cause);
    }
  }
  if (!grounding) return undefined;
  const figureImage = figure ? await cropSourceFigure(figure) : undefined;
  return figureImage ? { ...grounding, figureImage } : grounding;
}

/** Longest side of a figure crop handed to the board model: legible labels, bounded payload. */
const FIGURE_CROP_MAX_PX = 1024;

/**
 * THE SOURCE'S OWN FIGURE, as an image the board can redraw.
 *
 * Cropped from the page image parse-pdf already rendered (the in-process page store — a miss is
 * ordinary and silent, exactly as for the script's page images) to the figure's box grown by 8%,
 * with @napi-rs/canvas, which parse-pdf already uses for the same job. No model call and no new
 * dependency; a decode, a crop and a JPEG encode take milliseconds.
 */
async function cropSourceFigure(figure: NonNullable<ProgressiveBeatDoc["sourceFigure"]>): Promise<string | undefined> {
  const page = getDocumentImages(figure.documentId)?.pages.find((candidate) => candidate.pageNumber === figure.pageNumber);
  const base64 = page?.dataUrl.match(/^data:image\/[a-z+.-]+;base64,(.+)$/i)?.[1];
  if (!base64) return undefined;
  try {
    const { createCanvas, loadImage } = await import("@napi-rs/canvas");
    const image = await loadImage(Buffer.from(base64, "base64"));
    const rect = expandedCropRect(figure.bbox, image.width, image.height, 0.08);
    if (rect.width < 24 || rect.height < 24) return undefined;
    const scale = Math.min(1, FIGURE_CROP_MAX_PX / Math.max(rect.width, rect.height));
    const width = Math.max(1, Math.round(rect.width * scale));
    const height = Math.max(1, Math.round(rect.height * scale));
    const canvas = createCanvas(width, height);
    const context = canvas.getContext("2d");
    // White under the crop, so a transparent page render does not turn into a black JPEG.
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, width, height);
    context.drawImage(image, rect.x, rect.y, rect.width, rect.height, 0, 0, width, height);
    // Quality is 0-100 in @napi-rs/canvas (see the note in app/api/parse-pdf/route.ts).
    return `data:image/jpeg;base64,${canvas.toBuffer("image/jpeg", 85).toString("base64")}`;
  } catch (cause) {
    console.error(`[progressive-worker] figure crop failed for page ${figure.pageNumber}: ${cause instanceof Error ? cause.message : "unknown error"}`);
    return undefined;
  }
}

/**
 * The text of just the blocks this beat was planned from, or "" when there are none.
 *
 * Returning "" rather than the whole document is deliberate: a beat with no blocks is a topic-only
 * beat, and the caller falls back to the unscoped text for exactly that case. Silently widening to
 * the full document here would reintroduce the drift this function exists to stop.
 */
/**
 * The code every OTHER board of this lesson has put on screen — earlier and later, since boards
 * ahead of the student are generated in parallel. Without it each code board was written alone and
 * a "while loop" lesson showed the same count-to-five listing on three or four boards.
 */
async function otherCodeFor(sessionId: string, sequence: number): Promise<string[]> {
  const docs = await progressiveBeats(sessionId);
  return docs
    .filter((doc) => doc.sequence !== sequence)
    .sort((a, b) => a.sequence - b.sequence)
    .flatMap((doc) => doc.beat?.draw?.ops ?? [])
    .map((op) => (op.kind === "codeBoard" ? (op.spec as { code?: unknown } | undefined)?.code : undefined))
    .filter((code): code is string => typeof code === "string" && code.trim().length > 0);
}

async function codeBoardSource(session: ProgressiveLectureSessionDoc, sourceBlockIds?: string[]) {
  const input = await progressiveInput(session);
  return {
    text: sourceContext(input, sourceBlockIds, isStrictSource(input.sourceScope)),
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
  const shown = pages.length > 0 ? pages : stored.pages;
  // The crop the student dragged goes in after its page, labelled as the subject by
  // buildImageParts. It used to be passed as [] — the beat writer saw whole pages only.
  const shownPages = new Set(shown.map((page) => page.pageNumber));
  const regions = stored.regions.filter((region) => shownPages.has(region.pageNumber));
  return buildImageParts(shown, regions, stored.unit);
}

function scopedDocumentText(input: ProgressiveLectureInput, sourceBlockIds?: string[]): string {
  const document = input.suprnotes;
  if (!isSuprnotesLessonInput(document)) return "";
  return scopedBlockText(document.contentBlocks ?? [], sourceBlockIds);
}


function messageFor(error: unknown): string {
  return error instanceof Error ? error.message : "Progressive lecture generation failed.";
}

/** The listing on a beat's code board, if it has one. */
function codeOnBoard(beat: Beat): string | null {
  const op = beat.draw?.ops.find((item) => item.kind === "codeBoard");
  const code = (op?.spec as { code?: unknown } | undefined)?.code;
  return typeof code === "string" && code.trim() ? code : null;
}

/** Empty a beat's code board so it can be regenerated, or (`failed`) so it is never shown. */
function clearCodeBoard(beat: Beat, failed = false): void {
  for (const op of beat.draw?.ops ?? []) {
    if (op.kind !== "codeBoard") continue;
    const board = op as { spec?: unknown; status?: string; error?: string };
    delete board.spec;
    if (failed) {
      board.status = "failed";
      board.error = "repeated another board's code";
    } else {
      delete board.status;
      delete board.error;
    }
  }
}


/**
 * THE PROMPT THAT WRITES ONE BOARD'S SCRIPT — in one place, with no server dependency.
 *
 * It lived inline in the progressive worker, behind `import "server-only"`, which meant the only
 * way to see what the model was actually asked was to run a lecture in production. The repetition
 * problem was diagnosed by reading it there: every board got the same "intuition, mechanism,
 * example, mistake and use — ALL WITHIN THIS ONE BOARD" instruction, and the full plan was passed
 * as a bare array the model was never told how to use.
 *
 * Extracted so the worker and the generation harness (scripts/audit-lesson-generation.mjs) build
 * the IDENTICAL messages: what the harness measures is what students get.
 */

import { lessonMapBlock, roleBriefing, type LessonMapBeat, type TaughtBeatSummary, type TeachingRole } from "./lessonLadder";
import type { RepetitionFinding } from "./lessonRepetition";

export interface BeatScriptPromptInput {
  topic: string;
  planned: {
    sequence: number;
    title: string;
    objective: string;
    role?: TeachingRole;
    conceptPass?: number;
    conceptPasses?: number;
  };
  plan: LessonMapBeat[];
  /** Boards already taught: their claims, plus the full script of the one immediately before. */
  taught: Array<TaughtBeatSummary & { title: string; previousScript?: string }>;
  wordRange: string;
  movements: [number, number];
  learnerProfile: { expertise: string; depth: string; goal: string; codeExamples: boolean; preferredExamples?: unknown };
  learnerSection?: string;
  personaSection?: string;
  isCheckpoint: boolean;
  adaptation?: unknown;
  sourceContext?: string;
  /**
   * How this beat must treat code. A `code` board shows an actual listing and is walked through;
   * otherwise code is included only when it genuinely teaches, or not at all. Supplied by the
   * worker, which is the only place that knows the board kind and the student's request.
   */
  codeInstruction?: string;
  /**
   * The lecture is about a region the student DRAGGED a box over: that selection is the subject and
   * the rest of the document is background. The crop travels with the page images.
   */
  selectionScoped?: boolean;
  /** Page images are attached to the user message, so the beat can teach what a scan actually shows. */
  hasPageImages?: boolean;
  /** Set on a regeneration: exactly what the previous attempt repeated, so the model can fix it. */
  repetitionFeedback?: Array<{ finding: RepetitionFinding; matchedTitle?: string }>;
}

/** What the model must return. `keyClaims` is new: the board's own summary of what it established. */
export type GeneratedBeatPayload = {
  title?: unknown;
  transitionIn?: unknown;
  teacherMove?: unknown;
  slideKind?: unknown;
  points?: unknown;
  definitionTerm?: unknown;
  definitionMeaning?: unknown;
  script?: unknown;
  checkpoint?: unknown;
  keyClaims?: unknown;
};

/** The instruction for a board that is one of several passes over the same concept. */
export function passInstruction(planned: BeatScriptPromptInput["planned"]): string {
  const pass = planned.conceptPass ?? 1;
  const total = planned.conceptPasses ?? 1;
  if (total <= 1) return " Never split a single concept across boards to make the lecture longer.";
  if (pass === 1) {
    return ` This concept is taught across ${total} boards and THIS IS BOARD 1 of ${total}: establish the idea itself and STOP there. Do not work the example or cover the edge cases; later boards of this same concept do that. End at a natural pause, not a summary.`;
  }
  return ` This is BOARD ${pass} of ${total} ON THE SAME CONCEPT, continuing directly underneath the work already on the board. The student can still SEE the earlier boards, so do NOT re-introduce, re-define or re-motivate the idea, and do not summarise it — open as a teacher continuing mid-explanation. Teach ONLY this pass's job: ${planned.objective}`;
}

export function buildBeatScriptMessages(input: BeatScriptPromptInput): { system: string; user: string } {
  const role = input.planned.role ?? "mechanism";
  const feedback = input.repetitionFeedback?.length
    ? `\n\nYOUR PREVIOUS ATTEMPT AT THIS BOARD REPEATED THE LESSON. Rewrite the board from scratch with a different structure: open on a concrete step, quantity or case that no earlier board mentioned, and never circle back to what the subject is. These sentences must not appear in any form — replace each with NEW information or delete it:\n${input.repetitionFeedback
        .map(({ finding, matchedTitle }) => {
          const already = matchedTitle ? ` — already taught in "${matchedTitle}"${finding.matchSentence ? ` as "${finding.matchSentence}"` : ""}` : "";
          return `- [${finding.kind}] "${finding.sentence}"${already}`;
        })
        .join("\n")}`
    : "";

  const system = [
    `You write one board of a spoken, adaptive tutor lecture. Return JSON only with title, transitionIn, teacherMove, slideKind, points, script, keyClaims, optional definitionTerm/definitionMeaning, and optional checkpoint. Keep the supplied board title exactly; it is the canonical title already approved in the plan.`,
    `transitionIn: for every board after the first, one natural 8-18 word sentence that connects the previous board's insight to this one without a generic phrase such as "moving on". On the FIRST board it is instead one warm, specific 8-16 word opening line — never a greeting.`,
    `The script must be ${input.wordRange} words: ONE FULL TEACHING UNIT a real teacher would keep on the board for a minute or more, not a slide bullet.`,
    roleBriefing(role, input.movements),
    passInstruction(input.planned).trim(),
    `OPENING AND CLOSING. Begin with this board's first NEW claim — never by restating what the subject is or summarising earlier boards. End on content — never with a sentence about why the topic matters, how important understanding it is, or what the next board will cover. Sentences like "understanding X is crucial" or "as we delve deeper" carry no information and are removed before the board is shown.`,
    `keyClaims: 2-4 short declarative sentences stating exactly what this board ESTABLISHED, written so a later board can build on them without repeating them. They are shown to every later board as "already established". On the HOOK board they describe the puzzle or situation raised, never what the subject is — the definition is the next board\'s claim to make.`,
    `Accurate and warm throughout. Use language for a ${input.learnerProfile.expertise} learner seeking ${input.learnerProfile.depth} depth for a ${input.learnerProfile.goal} goal. ${input.codeInstruction ?? (input.learnerProfile.codeExamples ? "Include a code snippet only when it genuinely teaches the topic." : "Do not include code.")}`,
    /*
     * A LECTURE FROM A SELECTED AREA teaches that area. The student dragged a box over part of a
     * page; the rest of the document exists to explain it, never as a subject of its own.
     */
    input.selectionScoped
      ? "This lecture is about the part of the document the student SELECTED (sourceContext opens with it, and its crop is attached after its page). Every board teaches that selection; use the rest of the page and document only to explain it, never as a topic of its own."
      : "",
    /*
     * A scanned page has no extractable text, so the attached images ARE the source. Without this
     * the beat writer had the pages in front of it and no instruction to read them.
     */
    input.hasPageImages
      ? "The pages this board is built from are attached as images. They ARE the source: teach what they actually show — their text, code, figures and worked examples — even where sourceContext is thin or empty."
      : "",
    /*
     * NO RECAP BEATS. The lecture ends when its last concept is taught. A recap board was being
     * planned and then re-teaching everything, which is the repetition problem in its largest form.
     * The ladder's recap rung still exists for lessons that genuinely close with a synthesis; what
     * is banned is a beat whose whole content is a summary of the others.
     */
    "Never write a recap or summary board: teach THIS board's concept, even when it is the last one, and never set slideKind to \"recap\".",
    input.learnerSection ?? "",
    input.personaSection ?? "",
    input.isCheckpoint
      ? "This is a checkpoint board. Include checkpoint with prompt, acceptableKeywords as arrays of keywords, correctFeedback, hintFeedback, revealAnswer, three options, and correctOption."
      : "Do not create a checkpoint.",
    feedback,
  ]
    .filter((part) => part && part.trim())
    .join("\n\n");

  const previous = input.taught.find((t) => t.sequence === input.planned.sequence - 1);
  const user = JSON.stringify({
    topic: input.topic,
    board: {
      sequence: input.planned.sequence,
      title: input.planned.title,
      objective: input.planned.objective,
      role,
      conceptPass: input.planned.conceptPass,
      conceptPasses: input.planned.conceptPasses,
    },
    lessonMap: lessonMapBlock(input.plan, input.planned.sequence, input.taught),
    previousBoardScript: previous?.previousScript ?? null,
    adaptation: input.adaptation ?? null,
    preferredExamples: input.learnerProfile.preferredExamples ?? null,
    sourceContext: input.sourceContext ?? "",
  });

  return { system, user };
}

/** The model's keyClaims, cleaned; falls back to the script's first sentences so old beats still summarise. */
export function keyClaimsFrom(payload: GeneratedBeatPayload, script: string): string[] {
  const claims = Array.isArray(payload.keyClaims)
    ? payload.keyClaims.filter((c): c is string => typeof c === "string").map((c) => c.replace(/\s+/g, " ").trim()).filter(Boolean).slice(0, 4)
    : [];
  if (claims.length > 0) return claims;
  return script
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+/)
    .slice(0, 2)
    .map((s) => s.trim())
    .filter(Boolean);
}

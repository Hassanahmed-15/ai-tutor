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

import { lessonMapBlock, roleBriefing, scriptRoleFor, type LessonMapBeat, type TaughtBeatSummary, type TeachingRole } from "./lessonLadder";
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
    /** The first sentence of this concept's first board — a later pass must not open the same way. */
    conceptOpening?: string;
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
  /** Hard source contract selected by the student; empty for ordinary/reference lessons. */
  sourceInstruction?: string;
  /**
   * "Strictly from the source". Not just a sentence appended to the prompt: every part of the prompt
   * that asked for material beyond the source (the rung, the lesson map's "NEW information", the
   * opening line, the example preferences, the repetition feedback) switches to its source-only form.
   * With only the appended sentence, the strict rule was outvoted by the rest of the prompt.
   */
  strict?: boolean;
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
  /**
   * The document is a REFERENCE: its figures and facts are for drawing on, not a text to walk
   * through. Only ever set with a document present and strict off.
   */
  referenceSource?: boolean;
  /** Set on a regeneration: exactly what the previous attempt repeated, so the model can fix it. */
  repetitionFeedback?: Array<{ finding: RepetitionFinding; matchedTitle?: string }>;
  /**
   * Set on a strict regeneration: the sentences of the previous attempt that said things the source
   * does not, with the words that gave them away (lib/strictSourceScript.ts).
   */
  groundingFeedback?: Array<{ sentence: string; missing: string[] }>;
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
  /*
   * THE OPENING LINE IS WHERE THE REPEAT SHOWED. Three boards of one concept each began with the
   * concept's own sentence ("Chlorophyll captures light energy…"), and read as the same slide three
   * times. A later pass opens inside the work — the example's first step, the subtle case, a
   * question — never by naming the topic, and never the way board 1 began.
   */
  const opening = planned.conceptOpening?.trim();
  return ` This is BOARD ${pass} of ${total} ON THE SAME CONCEPT, continuing directly underneath the work already on the board. The student can still SEE the earlier boards, so do NOT re-introduce, re-define or re-motivate the idea, and do not summarise it — open as a teacher continuing mid-explanation. YOUR FIRST SENTENCE must not name or restate the topic and must not begin the way board 1 began${opening ? ` (board 1 opened: "${opening}")` : ""}: start inside the work — the example's first step, the subtle case, a question, or "Now…". Teach ONLY this pass's job: ${planned.objective}`;
}

/*
 * THE STRICT VERSIONS OF EACH PART OF THE PROMPT.
 *
 * Every line below replaces one that, in a strict lesson, asked for material the source does not
 * contain. Kept side by side with the originals (in buildBeatScriptMessages) so a change to one is
 * visibly a change to both.
 */
const STRICT_LINES = {
  transition: `transitionIn: one sentence of 8-18 words, spoken over this board's title card, that states this board's main idea plainly, in the source's own words. On the FIRST board it is the source's opening idea said plainly — never a greeting. It asserts nothing the source does not state, and it never refers to the document itself: no "this section", "this board", "this part", "the source", "the paper", "the text", "on page 3" or "next it turns to".`,
  length: (range: string) => `The script must be ${range} words — sized to this board's source, not to a lecture slot: explain every source sentence once, clearly, and stop. Never pad it to length with anything the source does not say.`,
  opening: `OPENING AND CLOSING. Begin with the first statement of this board's own source; end on its last. Never add a sentence about why the topic matters, how important understanding it is, or what the next board will cover — they carry no information and are removed before the board is shown.`,
  keyClaims: `keyClaims: 2-4 short sentences, each a statement THIS board's source makes, in the source's own words. They are shown to every later board as "already established", so a claim the source does not make here would spread through the rest of the lecture.`,
  fields: `points: 4-6 short phrases taken from the source's own wording, one per idea, in the order the script says them — they are written on the board as she speaks. definitionTerm/definitionMeaning: ONLY when the source itself defines a term — the term as printed and the source's own definition, near-verbatim; otherwise omit both.`,
  recap: `If this board's source is itself a summary, teach its statements as written. Otherwise never turn the board into a recap of earlier boards, and never set slideKind to "recap".`,
  pages: `The pages this board's source sits on are attached as images. Only the part of them that matches THIS board's source text (sourceContext) is this board's material: other sections printed on the same page belong to other boards and must not be taught here. If sourceContext is empty, the pages are the source: teach only what they actually show.`,
  checkpoint: `This is a checkpoint board. Include checkpoint with prompt, acceptableKeywords as arrays of keywords, correctFeedback, hintFeedback, revealAnswer, three options, and correctOption — the question, the correct option and revealAnswer must each be a statement the source makes.`,
} as const;

/**
 * What the regeneration is told when the previous attempt repeated an earlier board.
 *
 * The ordinary wording — "open on a concrete step, quantity or case no earlier board mentioned …
 * replace each with NEW information" — is a demand for new material, which a strict lesson may only
 * meet by inventing it. There the only correct fix is subtraction.
 */
function repetitionFeedbackBlock(feedback: NonNullable<BeatScriptPromptInput["repetitionFeedback"]>, strict: boolean): string {
  const lines = feedback
    .map(({ finding, matchedTitle }) => {
      const already = matchedTitle ? ` — already taught in "${matchedTitle}"${finding.matchSentence ? ` as "${finding.matchSentence}"` : ""}` : "";
      return `- [${finding.kind}] "${finding.sentence}"${already}`;
    })
    .join("\n");
  return strict
    ? `\n\nYOUR PREVIOUS ATTEMPT AT THIS BOARD REPEATED WHAT AN EARLIER BOARD ALREADY SAID. Write the board again with each of these sentences DELETED (or cut to a short clause that refers back to it). Do NOT replace them with anything new: this lesson may say only what its source says, and a shorter board is correct.\n${lines}`
    : `\n\nYOUR PREVIOUS ATTEMPT AT THIS BOARD REPEATED THE LESSON. Rewrite the board from scratch with a different structure: open on a concrete step, quantity or case that no earlier board mentioned, and never circle back to what the subject is. These sentences must not appear in any form — replace each with NEW information or delete it:\n${lines}`;
}

/** What the strict regeneration is told when the previous attempt said things the source does not. */
function groundingFeedbackBlock(feedback: NonNullable<BeatScriptPromptInput["groundingFeedback"]>): string {
  return `\n\nYOUR PREVIOUS ATTEMPT SAID THINGS THIS BOARD'S SOURCE DOES NOT SAY. Write the board again without these sentences, and do not replace them with other material of your own: every sentence must restate, explain or connect the source's own statements. The words in brackets are the ones the source never uses:\n${feedback
    .map(({ sentence, missing }) => `- "${sentence}" [${missing.slice(0, 6).join(", ")}]`)
    .join("\n")}`;
}

export function buildBeatScriptMessages(input: BeatScriptPromptInput): { system: string; user: string } {
  const strict = Boolean(input.strict);
  const role = scriptRoleFor(input.planned.role, strict);
  const feedback = [
    input.repetitionFeedback?.length ? repetitionFeedbackBlock(input.repetitionFeedback, strict) : "",
    strict && input.groundingFeedback?.length ? groundingFeedbackBlock(input.groundingFeedback) : "",
  ].join("");

  const system = [
    `You write one board of a spoken, adaptive tutor lecture. Return JSON only with title, transitionIn, teacherMove, slideKind, points, script, keyClaims, optional definitionTerm/definitionMeaning, and optional checkpoint. Keep the supplied board title exactly; it is the canonical title already approved in the plan.`,
    `points: 4-6 short board notes (at most 12 words each), one for each idea the script covers, in the order the script says them. They are written on the board one by one as the narration reaches them, so each must match what is being said at that moment.`,
    strict
      ? STRICT_LINES.transition
      : `transitionIn: for every board after the first, one natural 8-18 word sentence that connects the previous board's insight to this one without a generic phrase such as "moving on". On the FIRST board it is instead one warm, specific 8-16 word opening line — never a greeting.`,
    strict
      ? STRICT_LINES.length(input.wordRange)
      /*
       * A CEILING, NOT A TARGET. "The script must be 260-360 words" gave a board with one idea's
       * worth to say exactly one way to comply: say it again in other words. That — plus boards
       * that existed only to hit a plan — is the "same concept, slightly different wording" lecture
       * students reported. The board teaches its one new piece of understanding and stops.
       */
      : `LENGTH: at most ${maxWords(input.wordRange)} words, and only as many as this board's ONE new piece of understanding needs — a direct answer often needs far fewer. Never pad toward the limit. Before writing, name to yourself the understanding this board adds that no earlier board (the lesson map and "already established" claims) gave; teach exactly that. Never restate an earlier board's point, re-define an earlier term, re-word the same idea twice within this board, or give a second example of the same kind — a second example is allowed only when it shows something the first cannot (e.g. intuition, then a real case).`,
    roleBriefing(role, input.movements),
    passInstruction(input.planned).trim(),
    strict
      ? STRICT_LINES.opening
      : `OPENING AND CLOSING. Begin with this board's first NEW claim — never by restating what the subject is or summarising earlier boards. End on content — never with a sentence about why the topic matters, how important understanding it is, or what the next board will cover. Sentences like "understanding X is crucial" or "as we delve deeper" carry no information and are removed before the board is shown.`,
    strict
      ? STRICT_LINES.keyClaims
      : `keyClaims: 2-4 short declarative sentences stating exactly what this board ESTABLISHED, written so a later board can build on them without repeating them. They are shown to every later board as "already established". On the HOOK board they describe the puzzle or situation raised, never what the subject is — the definition is the next board\'s claim to make.`,
    strict ? STRICT_LINES.fields : "",
    `Accurate and warm throughout, for a ${input.learnerProfile.goal} goal. ${levelContract(input.learnerProfile.expertise)} ${input.codeInstruction ?? (input.learnerProfile.codeExamples ? "This is a programming topic: show the idea in a short, correct code snippet on the board wherever code states it more clearly than words, and explain what the code does in the narration (never read symbols aloud). Every board uses a NEW example: never reuse the code, variables or scenario an earlier board used (the previous board's script is above) — the next board's example must show something the earlier ones could not, not the same loop again with different numbers." : "Do not include code.")}`,
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
    /*
     * In a strict lesson the pages are evidence for THIS board's blocks only. A page usually carries
     * several sections, and "they ARE the source: teach what they actually show" let the Energy
     * transfer board teach the Photosynthesis paragraph and the question box printed beside it —
     * cross-section repetition, which the repetition gate then answered by asking for new material.
     */
    input.hasPageImages
      ? strict
        ? STRICT_LINES.pages
        : input.referenceSource
          // A reference lesson takes the idea, not the page — "They ARE the source" bound it to the PDF.
          ? "The student's document pages are attached for reference. Draw on their figures, facts and examples where they help, but teach the idea — you are not bound to the page, its order or its wording."
          : "The pages this board is built from are attached as images. They ARE the source: teach what they actually show — their text, code, figures and worked examples — even where sourceContext is thin or empty."
      : "",
    input.sourceInstruction ?? "",
    /*
     * NO RECAP BEATS. The lecture ends when its last concept is taught. A recap board was being
     * planned and then re-teaching everything, which is the repetition problem in its largest form.
     * The ladder's recap rung still exists for lessons that genuinely close with a synthesis; what
     * is banned is a beat whose whole content is a summary of the others. (A strict source's own
     * printed summary is source content, and is taught like any other block.)
     */
    strict
      ? STRICT_LINES.recap
      : "Never write a recap or summary board: teach THIS board's concept, even when it is the last one, and never set slideKind to \"recap\".",
    input.learnerSection ?? "",
    input.personaSection ?? "",
    input.isCheckpoint
      ? strict
        ? STRICT_LINES.checkpoint
        : "This is a checkpoint board. Include checkpoint with prompt, acceptableKeywords as arrays of keywords, correctFeedback, hintFeedback, revealAnswer, three options, and correctOption."
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
    lessonMap: lessonMapBlock(input.plan, input.planned.sequence, input.taught, { strict }),
    previousBoardScript: previous?.previousScript ?? null,
    adaptation: input.adaptation ?? null,
    // "real-world" examples are, by definition, not in the source.
    preferredExamples: strict ? null : input.learnerProfile.preferredExamples ?? null,
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

/** The upper bound of a "min-max" word range: the script's ceiling, never its target. */
function maxWords(range: string): string {
  const numbers = range.match(/\d+/g);
  return numbers && numbers.length ? numbers[numbers.length - 1] : range;
}

/**
 * WHAT A LEVEL MEANS, in terms a writer can act on. "Use language for an intermediate learner" was
 * the whole instruction, so the level a student chose barely changed the lesson. Each level now
 * says what to assume, what to skip and where the words go — and never changes how many boards
 * there are or how long they run.
 */
function levelContract(expertise: string): string {
  const shared = "The level changes HOW this board teaches, never how many boards there are or how long this one runs.";
  if (expertise === "advanced") {
    return `LEVEL: ADVANCED. The student is comfortable with the fundamentals. Skip introductions and basic definitions entirely; go straight to the non-obvious: the precise mechanism, edge cases, trade-offs, what experts get wrong, and the maths or code where it is the clearest statement. ${shared}`;
  }
  if (expertise === "intermediate") {
    return `LEVEL: INTERMEDIATE. The student knows the basics of this area. Do not define basic terms or re-explain fundamentals; use correct technical vocabulary without apology. Spend the words on the mechanism and the WHY, with one realistic technical example; include the key formula or code where it is the clearest statement. ${shared}`;
  }
  return `LEVEL: BEGINNER. Assume no prior knowledge of this topic. Define each technical term in plain words the first time it appears, build from one concrete everyday picture to the mechanism, and use notation only when it is essential. ${shared}`;
}


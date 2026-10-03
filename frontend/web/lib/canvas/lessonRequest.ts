import type { ProgressiveLectureInput } from "../progressiveLectureTypes";
import type { PlanningKnowledge } from "../knowledge/graph";
import { isDirectQuestion, isTopicRequest } from "../planPrompt";

/**
 * WHICH LECTURES ARE TAUGHT ON THE LESSON CANVAS, and what its planner is told about them.
 *
 * Pure, so it is unit-tested (lib/anim/lessonCanvas.test.ts). lib/progressiveLectureStore.ts reads
 * `canvasEngineFor` when a lecture is created; lib/canvas/progressive.ts sends `canvasPlanRequest`.
 */

/**
 * EVERY lecture from a typed prompt is taught on the canvas — programming included, now that the
 * canvas has a code stage (a listing walked through line by line, with its trace and output). One
 * engine means one way of deciding what a board needs; programming topics used to fall to the
 * ordinary boards, whose keyword rules made every board that named a construct a code board.
 * Lectures made from a document keep the ordinary boards (they quote and picture the pages).
 * CANVAS_LECTURES=0 puts every lecture back on the ordinary boards.
 */
export function canvasEngineFor(input: ProgressiveLectureInput, env: Record<string, string | undefined> = process.env): boolean {
  if (env.CANVAS_LECTURES === "0") return false;
  if (input.sourceType !== "prompt") return false;
  return !(input.suprnotes || input.context || input.transcript || input.documentId || input.selection || input.slideImages?.length);
}

/**
 * The planner's request: the topic, the student, and — what makes it THIS lecture rather than a
 * generic one — the outline the student approved in the planning conversation, at the depth they
 * chose. The system prompt's "6 to 8 boards" is the default these lines override.
 */
export function canvasPlanRequest(input: ProgressiveLectureInput, knowledge?: PlanningKnowledge): string {
  const lines = [`Topic: ${input.topic}`];
  const asked = input.focus?.replace(/\s+/g, " ").trim();
  if (asked && asked.toLowerCase() !== input.topic.toLowerCase()) lines.push(`The student asked: "${asked.slice(0, 400)}"`);

  const p = input.learnerProfile;
  lines.push(
    "",
    `THE STUDENT: ${p.expertise}, learning for ${p.goal === "curiosity" ? "curiosity" : `${p.goal} reasons`}, who learns best from ${p.preferredExamples === "mixed" ? "a mix of" : p.preferredExamples} examples. Pitch every script — its words, its examples, how much it assumes — for this student.`,
  );
  const persona = input.learnerPersona?.trim();
  if (persona) lines.push(persona.slice(0, 1200));

  const parts = input.outline?.subtopics.filter((s) => s.title.trim()) ?? [];
  const request = `${input.topic} ${input.focus ?? ""}`;
  // The planner's own reading of the request (lib/planPrompt.ts) when there is no approved outline.
  const question = input.outline ? input.outline.scope === "question" : isDirectQuestion(input.focus || input.topic) && !isTopicRequest(input.focus || input.topic);
  const boards = canvasBoardCount(input);

  // How much to teach is the PLANNER'S decision (the outline the student approved). The canvas
  // renders it — one board per part — and never pads it into a lesson-shaped template.
  if (parts.length > 0) {
    lines.push(
      "",
      `THE APPROVED OUTLINE — exactly ${boards} board${boards === 1 ? "" : "s"}, one per part, in this order (ids b1 to b${boards}). Each board teaches its part — what its line below says — and nothing that belongs to another part:`,
      ...parts.slice(0, boards).map((s, i) => `b${i + 1}. ${s.title}${s.caption ? ` — ${s.caption}` : ""}`),
    );
  } else {
    lines.push(
      "",
      question
        ? "HOW MANY BOARDS: this is one focused question. Answer it on ONE board; use a second only if one genuinely cannot answer it completely."
        : `HOW MANY BOARDS: as many as "${request.trim()}" genuinely contains — one per distinct idea, in teaching order, no padding and no maximum. A narrow topic may need two or three; a broad one more.`,
    );
  }
  // What the knowledge graph says about this student and topic (lib/knowledge/planning.ts).
  const refresher = canvasRefresherAllowed(input, knowledge);
  if (knowledge && (knowledge.mastered.length || knowledge.shaky.length || knowledge.earlier.length)) {
    lines.push("", "WHAT THIS STUDENT ALREADY KNOWS (from their earlier lessons):");
    if (knowledge.mastered.length) lines.push(`- Already solid: ${knowledge.mastered.join(", ")}. Do not teach these again — mention them in passing as things they know.`);
    if (knowledge.earlier.length) lines.push(`- Learned in earlier lessons: ${knowledge.earlier.map((e) => `${e.label} (in "${e.topic}")`).join(", ")}. Build on these instead of re-explaining them, and say so out loud at least once, naming the earlier lesson ("remember electron shells from your lesson on atoms?").`);
    if (refresher) lines.push(`- Shaky on what this builds on: ${knowledge.shaky.map((s) => `${s.label} (needed for ${s.for})`).join(", ")}. Put ONE short extra board FIRST that refreshes ${knowledge.shaky[0].label} — 3 sentences, "refresher": true — then the lesson's own boards. It is the only board you may add.`);
  }
  if (question) lines.push(`This lesson ANSWERS ONE QUESTION: "${(input.focus || input.topic).trim()}". The first board answers it directly; anything after only completes the answer. No interaction unless the student asked to practise.`);

  // Depth buys WORDS PER BOARD, never boards (the rule the ordinary lecture planner follows too).
  const depth = p.depth;
  const length = boards === 1
    ? "5 to 8 sentences (80 to 140 words) — the whole answer, complete on this one board"
    : depth === "concise" ? "3 or 4 sentences (45 to 70 words)"
    : depth === "deep" ? "6 to 8 sentences (90 to 140 words), going further than a first introduction would"
    : "4 to 6 sentences (60 to 100 words)";
  lines.push("", `SCRIPT LENGTH: each board's script is ${length}.`);
  return lines.join("\n");
}

/**
 * How many boards the plan is told to write: the approved outline's parts, one each (the planner
 * already sized it — a question is 1-2, a topic as many as it contains); with no outline, a ceiling
 * the model plans under. Never a floor: one board is a complete lesson when one board answers it.
 */
/** A refresher board is for a LESSON whose topic builds on something the student is shaky on — never for a question. */
export function canvasRefresherAllowed(input: ProgressiveLectureInput, knowledge?: PlanningKnowledge): boolean {
  return Boolean(knowledge?.shaky.length) && input.outline?.scope !== "question" && (input.outline?.subtopics.length ?? 2) >= 2;
}

export function canvasBoardCount(input: ProgressiveLectureInput): number {
  const parts = input.outline?.subtopics.filter((s) => s.title.trim()).length ?? 0;
  if (parts > 0) return Math.min(14, parts);
  return 0;
}

/** How long a board's narration runs, at a teacher's ~150 words a minute, plus the pauses. */
export function canvasBoardDurationMs(script: string): number {
  const words = script.split(/\s+/).filter(Boolean).length;
  return Math.round(words * 400 + 3000);
}

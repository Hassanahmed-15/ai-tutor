import { asksForCode, isProgrammingTopic } from "../codeSpec";
import type { ProgressiveLectureInput } from "../progressiveLectureTypes";
import type { PlanningKnowledge } from "../knowledge/graph";

/**
 * WHICH LECTURES ARE TAUGHT ON THE LESSON CANVAS, and what its planner is told about them.
 *
 * Pure, so it is unit-tested (lib/anim/lessonCanvas.test.ts). lib/progressiveLectureStore.ts reads
 * `canvasEngineFor` when a lecture is created; lib/canvas/progressive.ts sends `canvasPlanRequest`.
 */

/**
 * A lecture from a typed prompt is taught on the canvas. Not one made from a document (its boards
 * quote and picture the pages, which the canvas does not), and not a programming lesson (the canvas
 * has no code board). CANVAS_LECTURES=0 puts every lecture back on the ordinary boards.
 */
export function canvasEngineFor(input: ProgressiveLectureInput, env: Record<string, string | undefined> = process.env): boolean {
  if (env.CANVAS_LECTURES === "0") return false;
  if (input.sourceType !== "prompt") return false;
  if (input.suprnotes || input.context || input.transcript || input.documentId || input.selection || input.slideImages?.length) return false;
  const asked = `${input.topic} ${input.focus ?? ""}`;
  return !isProgrammingTopic(asked) && !asksForCode(asked);
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
  const question = input.outline?.scope === "question";
  if (parts.length > 0) {
    lines.push(
      "",
      "THE OUTLINE THE STUDENT APPROVED — teach these parts, in this order:",
      ...parts.slice(0, 9).map((s, i) => `${i + 1}. ${s.title}${s.caption ? ` — ${s.caption}` : ""}`),
      question
        ? "Every part serves the one question; do not add parts the outline does not have."
        : "One board per part. A short hook may open the lesson if the first part is not one, and the recap closes it; merge two neighbouring parts only if the lesson would otherwise pass 9 boards.",
    );
  }

  // What the knowledge graph says about this student and topic (lib/knowledge/planning.ts).
  if (knowledge && (knowledge.mastered.length || knowledge.shaky.length || knowledge.earlier.length)) {
    lines.push("", "WHAT THIS STUDENT ALREADY KNOWS (from their earlier lessons):");
    if (knowledge.mastered.length) lines.push(`- Already solid: ${knowledge.mastered.join(", ")}. Do not teach these again — mention them in passing as things they know.`);
    if (knowledge.earlier.length) lines.push(`- Learned in earlier lessons: ${knowledge.earlier.map((e) => `${e.label} (in "${e.topic}")`).join(", ")}. Build on these instead of re-explaining them, and say so out loud at least once, naming the earlier lesson ("remember electron shells from your lesson on atoms?").`);
    if (knowledge.shaky.length) lines.push(`- Shaky on what this builds on: ${knowledge.shaky.map((s) => `${s.label} (needed for ${s.for})`).join(", ")}. Open with ONE short board that refreshes ${knowledge.shaky[0].label} — 3 sentences, set "refresher": true on it — then teach the topic. This board is extra: it does not replace a part of the outline.`);
  }

  lines.push("", "LENGTH (this overrides the board count in your instructions):");
  if (question) {
    lines.push("This lecture ANSWERS ONE QUESTION: 3 or 4 boards. The first board gives the answer, the next show only what is needed to understand it, the last is the recap. One \"quiz\" board at most; no \"try\" and no \"draw\".");
  } else if (p.depth === "concise") {
    lines.push("A quick lesson: 4 or 5 boards, scripts of 3 or 4 sentences (45 to 70 words). Keep the quiz; \"try\" and \"draw\" only if a board is made for them.");
  } else if (p.depth === "deep") {
    lines.push("An in-depth lesson: 8 or 9 boards, scripts of 5 or 6 sentences, going further than a first introduction would.");
  } else {
    lines.push(`${parts.length > 0 ? Math.min(9, Math.max(5, parts.length + 1)) : "6 to 8"} boards.`);
  }
  return lines.join("\n");
}

/** How long a board's narration runs, at a teacher's ~150 words a minute, plus the pauses. */
export function canvasBoardDurationMs(script: string): number {
  const words = script.split(/\s+/).filter(Boolean).length;
  return Math.round(words * 400 + 3000);
}

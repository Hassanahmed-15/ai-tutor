/**
 * What a board is told to show, built ONLY from what the student hears and reads.
 *
 * WHY THIS EXISTS. Every board generator was briefed with `${title}. ${teacherMove} ${points}`, and
 * `teacherMove` is an instruction to the tutor, not content. For the opening beat of "1857 war" the
 * brief read "1857 War. Engage the student with a vivid example to spark curiosity. Open with a
 * concrete puzzle or use case that makes 1857 War worth learning." The generator illustrated "spark
 * curiosity" — a light bulb — the critic rightly refused it, and the student got a blank board. The
 * same stage directions were in the brief of every beat, so every board was partly drawing them.
 *
 * And when the model returned no bullet points, `points` fell back to the planner's objective, so
 * the tutor's own instruction was printed on the board ("Open with a concrete puzzle…") and, when
 * the script was missing, spoken aloud.
 *
 * So: the brief is the title, the definition, the points and the opening of the script — all of it
 * written FOR the student. Nothing here ever reads `teacherMove` or a plan objective.
 */

export type BriefSource = {
  title: string;
  script?: string;
  points?: string[];
  definitionTerm?: string;
  definitionMeaning?: string;
};

export const BOARD_BRIEF_MAX_CHARS = 700;
const POINT_MAX_CHARS = 110;

/** The first `count` sentences, whitespace collapsed. */
export function firstSentences(text: string, count: number): string[] {
  const clean = String(text ?? "").replace(/\s+/g, " ").trim();
  if (!clean || count <= 0) return [];
  const sentences = clean.match(/[^.!?]+[.!?]+["'”’)\]]*|[^.!?]+$/g) ?? [clean];
  return sentences.map((sentence) => sentence.trim()).filter(Boolean).slice(0, count);
}

/** Shortens to a word boundary, so a board never shows half a word. */
function shorten(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > max * 0.5 ? cut.slice(0, space) : cut).replace(/[\s,;:]+$/, "")}…`;
}

/**
 * The board's bullet points when the model gave none: the opening of what the student will hear,
 * never the plan. Empty when there is no script either — an empty board is better than the tutor's
 * instructions printed on it.
 */
export function pointsFromScript(script: string | undefined, count = 3): string[] {
  return firstSentences(script ?? "", count).map((sentence) => shorten(sentence, POINT_MAX_CHARS));
}

/** The brief every board generator works from. */
export function boardBriefFor(beat: BriefSource, maxChars = BOARD_BRIEF_MAX_CHARS): string {
  const parts: string[] = [beat.title.trim().replace(/[.!?]*$/, ".")];
  const term = beat.definitionTerm?.trim();
  const meaning = beat.definitionMeaning?.trim();
  if (term && meaning) parts.push(`${term}: ${meaning.replace(/[.!?]*$/, ".")}`);
  const points = (beat.points ?? []).map((point) => point.trim()).filter(Boolean);
  if (points.length > 0) parts.push(points.map((point) => point.replace(/[.!?]*$/, ".")).join(" "));
  const opening = firstSentences(beat.script ?? "", 3).join(" ");
  if (opening) parts.push(opening);
  return shorten(parts.join(" "), maxChars);
}

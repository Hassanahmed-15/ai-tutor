import { classifyStudentTurn } from "./useGeminiLiveTutor";

/**
 * Should this thing the student said change the lecture they have not heard yet?
 *
 * WHY THIS EXISTS. Every final utterance was posted to the server as a `question`, and every
 * question re-plans the upcoming beats. So "okay okay, carry on" and "hello hello" — the student
 * reacting to a lecture that had gone quiet — each re-wrote the rest of it: one real lecture went
 * from plan revision 1 to 4 in seconds, from filler alone. A question is the learner telling Aria
 * something about what they know; "carry on" is not that, and neither is a greeting.
 *
 * Built on the existing live-voice classifier (`classifyStudentTurn`), which already separates
 * commands and backchannel from questions; this only adds the case it lets through — an utterance
 * made entirely of greetings and filler.
 */

const GREETING_OR_FILLER = new Set([
  "hello", "hi", "hey", "hiya", "hola", "que", "qué", "yo",
  "aria", "arya", "aarya", "teacher", "miss", "maam", "ma'am",
  "ok", "okay", "alright", "yeah", "yes", "yep", "no", "nope", "right", "sure", "fine",
  "um", "uh", "umm", "uhh", "hmm", "mm", "ah", "oh", "so", "well", "please",
  "thanks", "thank", "you", "cool", "nice", "great", "good",
]);

export function isAdaptiveQuestion(raw: string): boolean {
  const text = raw.trim();
  if (!text) return false;
  if (classifyStudentTurn(text) !== "question") return false;
  const words = text
    .toLowerCase()
    .replace(/[^\p{L}'\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
  if (words.length > 0 && words.every((word) => GREETING_OR_FILLER.has(word))) return false;
  return true;
}

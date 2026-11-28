import { canvasSentences } from "./plan";

/**
 * A PDF LECTURE ENDS, IT DOES NOT STOP (owner, 2026-11-25: "Aria ends the lecture very abruptly … there should
 * be some decent way to end it"; chosen: closing words only, PDF lectures only). The last board's script gets
 * two closing sentences: what the student now knows from their document, then a warm sign-off. They are part
 * of the board's script, so they are spoken in Aria's own voice and made ahead like every other sentence;
 * nothing is drawn for them and the end screen follows as before.
 *
 * Added after the board is written, checked and covered: strict grounding and board coverage never see them.
 * Pure except `writeClosing`, which takes the model call as an argument.
 */

export const CLOSING_PROMPT = `You write the last two sentences a warm teacher says to end a short lesson taught from the student's own document. Sentence 1 sums up, in plain words, what the student can now do or understand — only what the lesson's boards taught, nothing new. Sentence 2 closes the lesson warmly in a way that fits THIS lesson — the one idea worth carrying away, where it shows up in everyday life, or what it lets them do next — in your own fresh words. Never mention a check, quiz, test or question coming next, and never use stock lines ("you did well", "great job", "that's all for today"). No greeting, no question, no new facts, no numbers, no list. Each sentence at most 22 words. Return JSON only: {"closing": [string, string]}.`;

/**
 * Stock endings the closing may not use (owner, 2026-11-27: "it always says a short check will come … don't just
 * stick to this ending line"): the old prompt's own example made every lecture end on it.
 */
const STOCK = /\b(?:check|quiz|test|questions? (?:comes?|is|are) (?:next|ready))\b|\byou did (?:well|great)\b|\bgreat job\b|\bthat'?s all for today\b/i;

/** The closing used when no good one comes back: plain, warm, true of any lesson, and not the same every time. */
export function closingFallback(topic: string): string[] {
  const subject = topic.replace(/\s+/g, " ").trim().replace(/[.!?]+$/, "");
  const named = subject && subject.length <= 70 ? subject : "this lesson";
  const endings = [
    `Hold on to the main idea of ${named}, and you will spot it again in what you study next.`,
    "Take a moment with the boards you found hardest; that is where the understanding grows.",
    `Next time ${named} comes up, you will already know how the pieces fit together.`,
  ];
  // Picked by the topic, so the same lesson always ends the same way and different lessons do not.
  const pick = [...named].reduce((n, c) => (n * 31 + c.charCodeAt(0)) >>> 0, 7) % endings.length;
  return [subject ? `That brings us to the end of ${named}.` : "That brings us to the end of this lesson.", endings[pick]];
}

/** Two good closing sentences, or null: each one sentence, short, no question, no number the lesson did not say. */
export function validClosing(raw: unknown, lessonText: string): string[] | null {
  const list = Array.isArray((raw as { closing?: unknown })?.closing) ? ((raw as { closing: unknown[] }).closing) : null;
  if (!list || list.length < 2) return null;
  const said = new Set(lessonText.match(/\d+(?:\.\d+)?/g) ?? []);
  const out = list.slice(0, 2).map((s) => (typeof s === "string" ? s.replace(/\s+/g, " ").trim() : ""));
  const ok = out.every((s) => s && /[.!]$/.test(s) && canvasSentences(s).length === 1 && s.split(" ").length <= 26 && !STOCK.test(s) && (s.match(/\d+(?:\.\d+)?/g) ?? []).every((n) => said.has(n)));
  return ok ? out : null;
}

/** The script with its closing at the end, once: a board written again is not closed twice. */
export function withClosing(script: string, closing: string[]): string {
  const body = script.replace(/\s+$/, "");
  if (!closing.length || body.endsWith(closing[closing.length - 1])) return body;
  return `${body} ${closing.join(" ")}`;
}

/** Asks for the closing once (a few hundred tokens); the plain one on any failure. */
export async function writeClosing(
  call: (system: string, user: string, maxTokens: number) => Promise<{ json: unknown; costUsd: number }>,
  args: { topic: string; question?: string; boards: Array<{ title: string; script: string }>; strict: boolean },
): Promise<{ closing: string[]; costUsd: number; fallback: boolean }> {
  const lessonText = args.boards.map((b) => `${b.title}. ${b.script}`).join(" ");
  const user = [
    `Lesson: ${args.topic}`,
    args.question ? `The student asked: "${args.question.slice(0, 300)}"` : "",
    args.strict ? "Taught STRICTLY from the student's document: sentence 1 may only restate what the boards below say." : "",
    "The boards, in order:",
    ...args.boards.map((b, i) => `${i + 1}. ${b.title} — ${b.script.slice(0, 400)}`),
  ].filter(Boolean).join("\n");
  try {
    const answer = await call(CLOSING_PROMPT, user, 400);
    const closing = validClosing(answer.json, lessonText);
    return closing ? { closing, costUsd: answer.costUsd, fallback: false } : { closing: closingFallback(args.topic), costUsd: answer.costUsd, fallback: true };
  } catch {
    return { closing: closingFallback(args.topic), costUsd: 0, fallback: true };
  }
}

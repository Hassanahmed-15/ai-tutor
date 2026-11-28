import { boardItems, type BoardItem } from "./boardCoverage";
import { canvasSentences } from "./plan";
import type { CanvasBoardSpec } from "./types";

/**
 * WHAT IS WRITTEN IS SAID, ON ITS SENTENCE (owner QA brief, 2026-11-28, section 2: spoken-vs-board
 * coverage measured 95–97%, keep it at 90% or more). Every note, table cell, node, label and line of
 * working on a board is checked against the narration: how many of the board's words Aria says at all,
 * and which items are not said on (or next to) the sentence they appear on — an item written on sentence
 * 2 that Aria only names on sentence 6 is on the board four sentences before she says it.
 *
 * Measured and logged at generation time (lib/canvas/progressive.ts writeCanvasBoard); it changes nothing.
 * The repair for PDF lessons is lib/canvas/boardCoverage.ts coverBoard. Pure.
 */

export const SPOKEN_BOARD_TARGET = 0.9;

const STOP = new Set("the a an and or of to in on for with by as at from is are be that this which what will would does do if when it its you your they their them can more less than into only also so because then there here have has was were been being not but all any each how why about these those such very just like".split(" "));
const stem = (w: string) => w.replace(/(ies|es|s|ed|ing)$/, "").slice(0, 6);
const stems = (text: string) => [...new Set((text.toLowerCase().match(/[a-z]{3,}/g) ?? []).filter((w) => !STOP.has(w)).map(stem))];
/** Numbers count as words a student reads: "98%" on the board must be said. */
const numbers = (text: string) => [...new Set(text.match(/\d+(?:[.,]\d+)?/g) ?? [])];

export type SpokenBoardCheck = {
  /** Of the board's distinct words and numbers, how many the narration says anywhere. */
  wordShare: number;
  words: number;
  /** Items not said on their own sentence or the one either side (or pointing past the last sentence). */
  offSentence: Array<BoardItem & { why: string }>;
  /** The board's words the narration never says. */
  unsaid: string[];
};

export function spokenBoardCheck(spec: CanvasBoardSpec, script: string): SpokenBoardCheck {
  const items = boardItems(spec);
  const sentences = canvasSentences(script);
  const said = new Set([...stems(script), ...numbers(script)]);
  const board = new Set(items.flatMap((i) => [...stems(i.text), ...numbers(i.text)]));
  const unsaid = [...board].filter((w) => !said.has(w));
  const perSentence = sentences.map((s) => new Set([...stems(s), ...numbers(s)]));
  const offSentence: SpokenBoardCheck["offSentence"] = [];
  for (const item of items) {
    if (item.s >= sentences.length) { offSentence.push({ ...item, why: `it is shown on sentence ${item.s + 1} of ${sentences.length}` }); continue; }
    const want = [...stems(item.text), ...numbers(item.text)];
    if (!want.length) continue;
    const near = new Set([item.s - 1, item.s, item.s + 1].flatMap((k) => [...(perSentence[k] ?? [])]));
    const got = want.filter((w) => near.has(w)).length;
    if (got / want.length < 0.5) offSentence.push({ ...item, why: want.some((w) => said.has(w)) ? "Aria says it on another sentence" : "Aria never says it" });
  }
  return { wordShare: board.size ? (board.size - unsaid.length) / board.size : 1, words: board.size, offSentence, unsaid };
}

/** One log line for a board under the target, or null when it meets it. */
export function spokenBoardLog(id: string, check: SpokenBoardCheck, target = SPOKEN_BOARD_TARGET): string | null {
  if (check.wordShare >= target && !check.offSentence.length) return null;
  const parts = [`${Math.round(check.wordShare * 100)}% of the board's ${check.words} words said`];
  if (check.wordShare < target) parts.push(`under ${Math.round(target * 100)}% — never said: ${check.unsaid.slice(0, 8).join(", ")}`);
  if (check.offSentence.length) parts.push(`${check.offSentence.length} item(s) off their sentence: ${check.offSentence.slice(0, 4).map((i) => `"${i.text.slice(0, 40)}" (${i.why})`).join("; ")}`);
  return `${id}: ${parts.join("; ")}`;
}

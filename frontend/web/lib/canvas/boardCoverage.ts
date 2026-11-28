import { layoutPanel } from "./layout";
import { canvasSentences } from "./plan";
import type { CanvasBoardSpec } from "./types";

/**
 * WHATEVER IS ON THE BOARD, ARIA SAYS (owner, 2026-11-25, PDF lessons: "whatever is on the board the user
 * should hear — 80 to 90 percent board coverage … strictly in sync, no compromise").
 *
 * Every item on the board that carries words — a note, a node, an arrow's label, a picture's part, a table
 * cell, a callout, a caption — counts. An item is SAID when the narration says its words (all of a short
 * name; two thirds of a longer one). A board under the target has the sentences its unsaid items appear on
 * rewritten to say them (same sentence count, so its timing holds), and a note still unsaid after that is
 * taken off the board: nothing stays up that Aria never says. Then every item is re-timed to the sentence
 * that names it (lib/canvas/narrationSync.ts alignToNarration), so it appears exactly as it is said.
 *
 * The heading is the board's title, and code, exam and full-text boards are writing walked line by line:
 * none of those count. Pure except `coverBoard`, which takes the model call as an argument.
 */

// 80%, not 85: words spliced in to hit a higher target read badly — "and this part here is the trough",
// "Electric impulses form as this creates electric impulses" (tester, 2026-11-25). A note Aria does not say
// comes off the board instead (notes are written from her words); only a diagram's labels are said by a rewrite.
export const COVERAGE_TARGET = 0.8;

export type BoardItem = { id: string; text: string; s: number; kind: "note" | "label" };

const STOP = new Set("the a an and or of to in on for with by as at from is are be that this which what will would does do if when it its you your they their them can more less than into only also so because then there here have has was were been being not but all any each how why about these those such very just like".split(" "));
const stem = (w: string) => w.replace(/(ies|es|s|ed|ing)$/, "").slice(0, 6);
function stems(text: string): string[] {
  return [...new Set((text.toLowerCase().match(/[a-z]{3,}/g) ?? []).filter((w) => !STOP.has(w)).map(stem))];
}

/** Every item on the board with words in it, and the sentence it appears on. */
export function boardItems(spec: CanvasBoardSpec): BoardItem[] {
  if (spec.stage.kind === "code" || spec.stage.kind === "exam") return spec.notes.map((n, i) => ({ id: `note-${i}`, text: n.text, s: n.s, kind: "note" as const }));
  const out: BoardItem[] = [];
  const seen = new Set<string>();
  const add = (id: string, text: string | undefined, s: number, kind: BoardItem["kind"]) => {
    const t = text?.replace(/\s+/g, " ").trim();
    if (!t || !stems(t).length || seen.has(t.toLowerCase())) return;
    seen.add(t.toLowerCase());
    out.push({ id, text: t, s: Math.max(0, s), kind });
  };
  for (const m of layoutPanel(spec).marks) {
    if (m.type === "note") add(m.id, m.lines.join(" "), m.s, "note");
    else if (m.type === "figure-label") add(m.id, m.lines.join(" "), m.s, "label");
    else if (m.type === "part") add(m.id, m.name, m.s, "label");
    else if (m.type === "callout") add(m.id, m.text, m.s, "label");
    else if (m.type === "node") add(m.id, m.label, m.s, "label");
    else if (m.type === "arrow") add(m.id, m.label, m.s, "label");
    else if (m.type === "box") add(m.id, m.label, m.s, "label");
    else if (m.type === "column") add(m.id, m.title, m.s, "label");
    else if (m.type === "item" || m.type === "text") add(m.id, m.text, m.s, "label");
    else if (m.type === "structure") m.captions.forEach((c, i) => add(`${m.id}-caption-${i}`, c.text, c.s, "label"));
    else if (m.type === "sketch") for (const p of m.items) {
      const it = p.item;
      if (it.type === "text") add(`${m.id}-${it.id ?? out.length}`, it.text, it.s, "label");
      else if (it.type === "box") add(`${m.id}-${it.id ?? out.length}`, it.title ?? it.text, it.s, "label");
    }
  }
  return out;
}

/** Said: a short name in full, a longer item by two thirds of its words (anywhere in the narration). */
export function isSaid(item: Pick<BoardItem, "text">, said: Set<string>): boolean {
  const want = stems(item.text);
  if (!want.length) return true;
  const got = want.filter((w) => said.has(w)).length;
  return want.length <= 2 ? got === want.length : got >= Math.ceil(want.length * 0.67);
}

export type Coverage = { items: number; said: number; share: number; unsaid: BoardItem[] };

/** How much of the board the narration says. A board with nothing to count is fully covered. */
export function spokenCoverage(spec: CanvasBoardSpec, script: string): Coverage {
  const items = boardItems(spec);
  const said = new Set(stems(script));
  const unsaid = items.filter((item) => !isSaid(item, said));
  return { items: items.length, said: items.length - unsaid.length, share: items.length ? (items.length - unsaid.length) / items.length : 1, unsaid };
}

export const COVER_PROMPT = `A teacher's sentences are spoken while a diagram is drawn. Some parts of the diagram are never named, so the student sees labels the teacher never speaks. Rewrite each sentence given so it names each listed part AS PART OF WHAT IT ALREADY SAYS — woven into the sentence's own idea, the way a teacher naturally mentions a part while explaining. Never tack a clause on ("…, and this part here is the X", "…; on the diagram this is labelled X"), never repeat a word or an idea the sentence already has, and never add a fact. Keep every fact, number and term the sentence has. One sentence each, at most a few words longer. If a part cannot be named naturally in that sentence, leave it out of your answer. Return JSON only: {"sentences": [{"i": number, "text": string}]}.`;

/** A rewrite that reads as spliced: a tacked-on pointing clause, or a content word said twice that the original said once. */
export function splicedRewrite(original: string, text: string): boolean {
  if (/\bthis part (?:here )?is\b|\bon the (?:diagram|board|picture) (?:this )?is label+ed\b|\blabel+ed here as\b/i.test(text)) return true;
  const count = (t: string) => {
    const m = new Map<string, number>();
    for (const w of (t.toLowerCase().match(/[a-z]{4,}/g) ?? []).filter((w) => !STOP.has(w)).map(stem)) m.set(w, (m.get(w) ?? 0) + 1);
    return m;
  };
  const before = count(original);
  for (const [w, n] of count(text)) if (n >= 2 && (before.get(w) ?? 0) < n) return true;
  return false;
}

const numbersOf = (t: string) => (t.match(/-?\d+(?:\.\d+)?/g) ?? []).sort().join(",");

/**
 * A rewrite that says again what the sentence next to it says: it shares a run of `n` words with a neighbour that
 * the original did not (QA report 2026-11-27: "For an ohmic conductor at constant temperature" said twice in a row
 * after a rewrite borrowed the sentence before it). Pure; also used by lib/canvas/labelMentions.ts.
 */
export function echoesNeighbour(original: string, text: string, neighbours: Array<string | undefined>, n = 5): boolean {
  const runs = (t: string) => {
    const w = t.toLowerCase().match(/[a-z0-9]+/g) ?? [];
    const out = new Set<string>();
    for (let i = 0; i + n <= w.length; i++) out.add(w.slice(i, i + n).join(" "));
    return out;
  };
  const had = runs(original);
  const now = [...runs(text)].filter((r) => !had.has(r));
  return neighbours.some((other) => {
    if (!other) return false;
    const theirs = runs(other);
    return now.some((r) => theirs.has(r));
  });
}

/** The unsaid items grouped by the sentence they appear on (at most four a sentence). */
export function coverageRequests(unsaid: BoardItem[], sentenceCount: number): Array<{ s: number; items: string[] }> {
  const by = new Map<number, string[]>();
  for (const item of unsaid) {
    const s = Math.min(item.s, Math.max(0, sentenceCount - 1));
    const list = by.get(s) ?? [];
    if (list.length < 4) list.push(item.text.slice(0, 120));
    by.set(s, list);
  }
  return [...by.entries()].map(([s, items]) => ({ s, items })).sort((a, b) => a.s - b.s);
}

/** A rewrite is used only when it stays one sentence, keeps its numbers and now says every item. */
export function applyCoverage(script: string, asked: Array<{ s: number; items: string[] }>, rewrites: Array<{ i?: unknown; text?: unknown }>): { script: string; rewritten: number } {
  const sentences = canvasSentences(script);
  let rewritten = 0;
  for (const need of asked) {
    const original = sentences[need.s];
    if (!original) continue;
    const r = rewrites.find((x) => Number(x.i) === need.s);
    const text = typeof r?.text === "string" ? r.text.replace(/\s+/g, " ").trim() : "";
    if (!text || !/[.!?]$/.test(text) || canvasSentences(text).length !== 1 || numbersOf(text) !== numbersOf(original) || text.length > original.length + 60 || splicedRewrite(original, text)) continue;
    if (echoesNeighbour(original, text, [sentences[need.s - 1], sentences[need.s + 1]])) continue;
    const said = new Set(stems(text));
    if (!need.items.every((item) => isSaid({ text: item }, said))) continue;
    sentences[need.s] = text;
    rewritten++;
  }
  return { script: sentences.join(" "), rewritten };
}

/**
 * Brings a board to the target: sentences rewritten to say what is on the board, then any note still
 * unsaid taken off it. Returns the new script, the spec (notes removed in place on a copy), and the
 * coverage before and after.
 */
export async function coverBoard(
  call: (system: string, user: string, maxTokens: number) => Promise<{ json: unknown; costUsd: number }>,
  spec: CanvasBoardSpec,
  script: string,
  target = COVERAGE_TARGET,
): Promise<{ script: string; spec: CanvasBoardSpec; before: Coverage; after: Coverage; rewritten: number; removed: string[]; costUsd: number }> {
  const before = spokenCoverage(spec, script);
  if (before.share >= target || !before.unsaid.length) return { script, spec, before, after: before, rewritten: 0, removed: [], costUsd: 0 };
  // 1. A NOTE ARIA DOES NOT SAY COMES OFF THE BOARD: notes are written from her words, never her words from notes.
  const said0 = new Set(stems(script));
  const removed: string[] = [];
  const notes = spec.notes.filter((n) => {
    if (isSaid({ text: n.text }, said0)) return true;
    removed.push(n.text);
    return false;
  });
  const trimmed = removed.length ? { ...spec, notes } : spec;
  const mid = spokenCoverage(trimmed, script);
  if (mid.share >= target || !mid.unsaid.length) return { script, spec: trimmed, before, after: mid, rewritten: 0, removed, costUsd: 0 };
  // 2. A diagram label still unsaid: its sentence is asked to name it, naturally — a spliced rewrite is refused,
  // and a board left a little under the target is accepted rather than forced.
  const sentences = canvasSentences(script);
  const asked = coverageRequests(mid.unsaid.filter((u) => u.kind === "label"), sentences.length).map((a) => ({ ...a, items: a.items.slice(0, 2) }));
  if (!asked.length) return { script, spec: trimmed, before, after: mid, rewritten: 0, removed, costUsd: 0 };
  let costUsd = 0;
  let rewrites: Array<{ i?: unknown; text?: unknown }> = [];
  try {
    const user = asked.map((a) => `[${a.s}] "${sentences[a.s]}" — name: ${a.items.map((t) => `"${t}"`).join(", ")}`).join("\n");
    const answer = await call(COVER_PROMPT, user, 2000);
    costUsd = answer.costUsd;
    const list = (answer.json as { sentences?: unknown })?.sentences;
    if (Array.isArray(list)) rewrites = list as typeof rewrites;
  } catch {
    /* nothing rewritten: the board keeps its words */
  }
  const applied = applyCoverage(script, asked, rewrites);
  return { script: applied.script, spec: trimmed, before, after: spokenCoverage(trimmed, applied.script), rewritten: applied.rewritten, removed, costUsd };
}

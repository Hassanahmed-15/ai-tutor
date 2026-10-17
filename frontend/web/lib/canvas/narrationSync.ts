import { canvasSentences } from "./plan";
import type { CanvasBoardSpec, CanvasPlanBeat } from "./types";

/**
 * THE BOARD SHOWS WHAT ARIA SAYS, WHEN SHE SAYS IT.
 *
 * The voice is timed exactly — one audio clip per sentence (lib/narrationClock.ts) — but WHEN each
 * thing appears was the board writer's guess, and it guessed wrong a third of the time: measured on
 * 1,769 items of 50 audited lectures (2026-10-17), 49% appeared on the sentence that first names
 * them, 16% before it and 19% after it, and 20% of spoken sentences had nothing on the board at all.
 *
 * This puts every named item on the sentence that first names it, keeps arrows from appearing before
 * what they join, and keeps the pen from pointing at something not yet drawn. Pure.
 */

const STOP = new Set("the a an and or of to in on for with by as at from is are be that this which what will would does do if when it its you your they their them can more less than into only also so because then there here have has was were been being not but all any each how why about these those such very just like".split(" "));
const norm = (t: string) => t.toLowerCase().replace(/(\d),(\d{3})(?!\d)/g, "$1$2").replace(/[₀-₉]/g, (c) => String(c.charCodeAt(0) - 0x2080));
const stem = (w: string) => w.replace(/(ies|es|s|ed|ing)$/, "").slice(0, 6);
function stems(text: string): string[] {
  return [...new Set((norm(text).match(/[a-z]{3,}|\d+(?:\.\d+)?/g) ?? []).filter((w) => !STOP.has(w)).map((w) => (/\d/.test(w) ? w : stem(w))))];
}

/** The sentence that first says most of this text's words; -1 when no sentence does. */
export function firstSentenceNaming(text: string, sentenceStems: Array<Set<string>>, from = 0): number {
  const want = stems(text);
  if (!want.length) return -1;
  // A short name is named only when all of it is said ("sperm duct" is not named by "sperm cells");
  // a longer label or note when two thirds of its words are.
  const find = (need: number) => {
    const at = sentenceStems.slice(from).findIndex((said) => want.filter((w) => said.has(w)).length >= need);
    return at < 0 ? -1 : at + from;
  };
  const strict = find(want.length <= 2 ? want.length : Math.ceil(want.length * 0.67));
  // A longer label Aria paraphrases ("Imposed, unrealistic target" said as "an imposed or unrealistic
  // target") still lands on the sentence that says most of it.
  return strict >= 0 || want.length < 3 ? strict : find(Math.ceil(want.length * 0.5));
}

type Timed = { holder: Record<string, unknown>; text: string };

/** Every element that carries its own sentence and some visible text. */
function timedElements(spec: CanvasBoardSpec): Timed[] {
  const out: Timed[] = [];
  const walk = (value: unknown) => {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) { value.forEach(walk); return; }
    const record = value as Record<string, unknown>;
    const text = ["label", "name", "text", "sub", "detail", "title"].map((k) => (typeof record[k] === "string" ? record[k] : "")).join(" ").trim();
    if (typeof record.s === "number" && text) out.push({ holder: record, text });
    for (const [key, child] of Object.entries(record)) if (key !== "becomes" && child && typeof child === "object") walk(child);
  };
  walk(spec.notes);
  // Code steps follow the execution order the writer gave; an exam board is timed by its own builder.
  if (spec.stage.kind !== "code" && spec.stage.kind !== "exam") walk(spec.stage);
  return out;
}

/**
 * Re-times the board to its narration. Returns how many elements moved. An element is only moved
 * when a sentence clearly names it; anything Aria never names keeps the writer's timing.
 */
export function alignToNarration(spec: CanvasBoardSpec, beat: Pick<CanvasPlanBeat, "script">): number {
  const sentences = canvasSentences(beat.script);
  if (sentences.length < 2) return 0;
  const said = sentences.map((s) => new Set(stems(s)));
  let moved = 0;
  for (const { holder, text } of timedElements(spec)) {
    const at = firstSentenceNaming(text, said);
    if (at >= 0 && holder.s !== at) { holder.s = at; moved++; }
  }
  // An equation builds step by step as Aria works it: each step appears on the sentence that says
  // what it adds (its new terms or numbers), never before the step it follows.
  if (spec.stage.kind === "equation") {
    const text = new Map(spec.stage.tokens.map((t) => [t.id, t.text]));
    const seen = new Set<string>();
    let floor = 0;
    for (const step of [...spec.stage.steps].sort((a, b) => a.s - b.s)) {
      const added = step.order.filter((id) => !seen.has(id)).map((id) => text.get(id) ?? "").join(" ");
      step.order.forEach((id) => seen.add(id));
      const at = firstSentenceNaming(`${added} ${step.caption ?? ""}`, said, floor);
      if (at >= 0 && at !== step.s) { step.s = at; moved++; }
      if (step.s < floor) { step.s = floor; moved++; }
      floor = step.s;
    }
  }
  // An arrow appears with — never before — the later of the two things it joins.
  if (spec.stage.kind === "flow" || spec.stage.kind === "scene") {
    const nodes = (spec.stage.kind === "flow" ? spec.stage.nodes : spec.stage.items) as Array<{ id: string; s: number }>;
    const at = new Map(nodes.map((n) => [n.id, n.s]));
    for (const arrow of spec.stage.arrows) {
      const s = Math.max(arrow.s, at.get(arrow.from) ?? 0, at.get(arrow.to) ?? 0);
      if (s !== arrow.s) { arrow.s = s; moved++; }
    }
  }
  // Something is on the board while the first sentence is spoken.
  const all = timedElements(spec);
  if (all.length && !all.some((e) => (e.holder.s as number) === 0)) {
    const first = all.reduce((a, b) => ((a.holder.s as number) <= (b.holder.s as number) ? a : b));
    first.holder.s = 0;
  }
  // The pen never points at something that is not drawn yet.
  const shownAt = new Map(timedElements(spec).map((e) => [String(e.holder.id ?? ""), e.holder.s as number]));
  for (const cue of spec.cues) {
    const s = cue.target ? shownAt.get(cue.target) : undefined;
    if (s !== undefined && cue.s < s) { cue.s = s; moved++; }
  }
  return moved;
}

/** Spoken teaching sentences with nothing about them on the board (not questions, not the reveal's working). */
export function unshownSentences(spec: CanvasBoardSpec, beat: Pick<CanvasPlanBeat, "script">): number[] {
  const sentences = canvasSentences(beat.script);
  const board = timedElements(spec).map((e) => new Set(stems(e.text)));
  if (spec.stage.kind === "code") board.push(new Set(stems(spec.stage.lines.join(" "))));
  if (spec.stage.kind === "equation") board.push(new Set(stems(spec.stage.tokens.map((t) => t.text).join(" "))));
  if (spec.stage.kind === "illustration") board.push(new Set(stems(spec.stage.subject)));
  board.push(new Set(stems(spec.heading)));
  return sentences
    .map((s, i) => ({ i, w: stems(s), q: /[?؟]\s*$/.test(s) }))
    .filter(({ w, q }) => !q && w.length >= 4)
    // Shown when an element shares two of its words, or the sentence says a whole label ("anode").
    .filter(({ w }) => !board.some((b) => { const shared = w.filter((x) => b.has(x)); return shared.length >= Math.min(2, w.length) || (b.size > 0 && b.size <= 3 && [...b].every((x) => w.includes(x)) && [...b].some((x) => x.length >= 5)); }))
    .map(({ i }) => i);
}

/**
 * Each spoken note on the sentence that says it. The planner numbers its notes by position, and its
 * count drifts when a sentence carries two ideas: half the boards of a round ran a sentence late
 * (audit 2026-10-17). A note goes to the sentence sharing most of its words (the planner's sentence
 * breaks a tie), and notes keep their written order.
 */
export function anchorNotes<T extends { text: string; s: number }>(notes: T[], script: string): T[] {
  const said = canvasSentences(script).map((x) => new Set(stems(x)));
  let floor = 0;
  return notes.map((note) => {
    const want = stems(note.text);
    let best = note.s, bestScore = 0;
    said.forEach((words, i) => {
      if (i < floor) return;
      const score = want.filter((w) => words.has(w)).length;
      if (score > bestScore || (score === bestScore && score > 0 && Math.abs(i - note.s) < Math.abs(best - note.s))) { best = i; bestScore = score; }
    });
    const s = Math.max(floor, bestScore > 0 ? best : note.s);
    floor = s;
    return { ...note, s };
  });
}

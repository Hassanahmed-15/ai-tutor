import { layoutPanel } from "./layout";
import { canvasSentences } from "./plan";
import type { CanvasBoardSpec } from "./types";

/**
 * EVERY PART ARIA DRAWS, SHE NAMES (owner, 2026-10-23: "if Aria draws a diagram make sure it draws and
 * explains that thing" — a part she never mentions is kept, and the narration is made to mention it).
 * Up to half the labels on some boards were drawn and never said.
 *
 * After a board is written, code finds each label on its diagram whose words the narration never says;
 * one small call rewrites only the sentence the label appears on, so it names the part in a teacher's
 * words, keeping every fact and number and adding nothing else. A rewrite that breaks those rules is not
 * used: the sentence gets a plain clause naming the part instead. Headings, notes, working, code and a
 * data structure's values are writing, not diagram labels, and are left alone.
 */
export type LabelMention = { s: number; labels: string[] };

const STOP = new Set("this that with from into have their there these those which where what when your about each other than then them they over under also only just more most some such very".split(" "));
const words = (t: string) => (t.toLowerCase().match(/[a-z][a-z'-]{3,}/g) ?? []).filter((w) => !STOP.has(w));
const stem = (w: string) => w.replace(/(?:ies|es|s|ed|ing)$/, "").slice(0, 6);

/** The diagram's labels with the sentence each appears on (code: what the layout draws). */
function diagramLabels(spec: CanvasBoardSpec): Array<{ text: string; s: number }> {
  const out: Array<{ text: string; s: number }> = [];
  const add = (text: string | undefined, s: number) => { const t = text?.replace(/\s+/g, " ").trim(); if (t) out.push({ text: t, s: Math.max(0, s) }); };
  for (const m of layoutPanel(spec).marks) {
    if (m.type === "figure-label") add(m.lines.join(" "), m.s);
    else if (m.type === "part") add(m.name, m.s);
    else if (m.type === "callout") add(m.text, m.s);
    else if (m.type === "node") add(m.label, m.s);
    else if (m.type === "arrow") add(m.label, m.s);
    else if (m.type === "box") add(m.label, m.s);
    else if (m.type === "column") add(m.title, m.s);
    else if (m.type === "sketch") for (const p of m.items) {
      const it = p.item;
      if (it.type === "text") add(it.text, it.s);
      else if (it.type === "box") add(it.title ?? it.text, it.s);
      else if (it.type === "shapes") for (const sh of it.shapes) { const shape = sh as { label?: string; s?: number }; add(shape.label, shape.s ?? it.s); }
    }
  }
  return out;
}

/** Labels whose words the narration never says, grouped by the sentence they appear on. */
export function unsaidLabels(spec: CanvasBoardSpec, script: string): LabelMention[] {
  if (spec.stage.kind === "exam" || spec.stage.kind === "code") return [];
  const said = new Set(words(script).map(stem));
  const sentences = canvasSentences(script).length;
  const bySentence = new Map<number, string[]>();
  const seen = new Set<string>();
  for (const l of diagramLabels(spec)) {
    const w = words(l.text);
    // A symbol, a number or a one-letter name is not something to say ("H₂", "x", "12 cm").
    if (!w.length || w.some((x) => said.has(stem(x))) || seen.has(l.text.toLowerCase())) continue;
    seen.add(l.text.toLowerCase());
    const s = Math.min(l.s, Math.max(0, sentences - 1));
    (bySentence.get(s) ?? bySentence.set(s, []).get(s)!).push(l.text);
  }
  return [...bySentence.entries()].map(([s, labels]) => ({ s, labels: labels.slice(0, 4) })).sort((a, b) => a.s - b.s);
}

export const MENTION_PROMPT = `A teacher's sentences are spoken while a diagram is drawn. Some parts of the diagram are drawn on a sentence that never names them. Rewrite each sentence given so it ALSO names each of its listed labels, in the words a teacher would use while pointing at it ("…, and this part here is the <label>."). Keep everything the sentence already says — every fact, number, term and its meaning — and add nothing else: no new facts. One sentence each, natural and short. Return JSON only: {"sentences": [{"i": number, "text": string}]}.`;

const numbersOf = (t: string) => (t.match(/-?\d+(?:\.\d+)?/g) ?? []).sort().join(",");

/** A plain clause naming the labels, when no good rewrite came back. */
function plainMention(sentence: string, labels: string[]): string {
  const base = sentence.replace(/[.!?]+\s*$/, "");
  const names = labels.map((l) => `"${l}"`);
  const list = names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  return `${base}; on the diagram this is labelled ${list}.`;
}

/**
 * The narration with every unsaid label named on its sentence: the model's rewrite when it keeps the
 * sentence's numbers, stays one sentence and names each label; else the plain clause.
 */
export function applyMentions(script: string, needed: LabelMention[], rewrites: Array<{ i?: unknown; text?: unknown }>): { script: string; mentioned: number } {
  const sentences = canvasSentences(script);
  let mentioned = 0;
  for (const need of needed) {
    const original = sentences[need.s];
    if (!original) continue;
    const r = rewrites.find((x) => Number(x.i) === need.s);
    const text = typeof r?.text === "string" ? r.text.replace(/\s+/g, " ").trim() : "";
    const namesAll = need.labels.every((l) => { const w = words(l); return !w.length || w.some((x) => words(text).map(stem).includes(stem(x))); });
    const good = text && /[.!?]$/.test(text) && canvasSentences(text).length === 1 && numbersOf(text) === numbersOf(original) && namesAll && text.length <= original.length + 160;
    sentences[need.s] = good ? text : plainMention(original, need.labels);
    mentioned += need.labels.length;
  }
  return { script: sentences.join(" "), mentioned };
}

/** Find, ask once, apply. The narration keeps its sentence count, so the board's timing is untouched. */
export async function mentionLabels(
  call: (system: string, user: string, maxTokens: number) => Promise<{ json: unknown; costUsd: number }>,
  spec: CanvasBoardSpec,
  script: string,
): Promise<{ script: string; mentioned: number; costUsd: number }> {
  const needed = unsaidLabels(spec, script);
  if (!needed.length) return { script, mentioned: 0, costUsd: 0 };
  const sentences = canvasSentences(script);
  const user = needed.map((n) => `[${n.s}] "${sentences[n.s]}" — labels to name: ${n.labels.map((l) => `"${l}"`).join(", ")}`).join("\n");
  let rewrites: Array<{ i?: unknown; text?: unknown }> = [];
  let costUsd = 0;
  try {
    const answer = await call(MENTION_PROMPT, user, 1500);
    costUsd = answer.costUsd;
    const list = (answer.json as { sentences?: unknown })?.sentences;
    if (Array.isArray(list)) rewrites = list as typeof rewrites;
  } catch {
    /* the plain clause names them */
  }
  const out = applyMentions(script, needed, rewrites);
  return { ...out, costUsd };
}

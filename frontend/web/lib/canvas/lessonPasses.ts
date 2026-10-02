import { PALETTE } from "./layout";
import type { CanvasBoardSpec } from "./types";

/**
 * Whole-lesson passes over generated boards — pure, so they are unit-tested directly
 * (lib/anim/lessonCanvas.test.ts). lib/canvas/generate.ts runs them after every board is written.
 */

/** What the recap tour needs to know about a planned board. */
export type TourBeat = { id: string; title: string; script: string; objects: string[]; brief: string };

/** Mirrors splitNarrationSentences in lib/voice.ts. */
const sentencesOf = (script: string) => script.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean);

/**
 * THE RECAP'S TOUR, when the model wrote none: each recap sentence visits the earlier board whose
 * title and objects it shares the most words with — at most once per board, in the lesson's order,
 * and never on the last sentence, which belongs to the recap board itself.
 */
export function recapTour(recap: TourBeat, earlier: TourBeat[]): CanvasBoardSpec["cues"] {
  const words = (text: string) => new Set(text.toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter((w) => w.length > 3));
  const sentences = sentencesOf(recap.script);
  const cues: CanvasBoardSpec["cues"] = [];
  let after = -1;
  for (let s = 0; s < sentences.length - 1; s++) {
    const said = words(sentences[s]);
    let best = -1;
    let bestScore = 0;
    earlier.forEach((b, k) => {
      if (k <= after) return;
      const score = [...words(`${b.title} ${b.objects.join(" ")} ${b.brief}`)].filter((w) => said.has(w)).length;
      if (score > bestScore) {
        bestScore = score;
        best = k;
      }
    });
    if (best < 0) continue;
    cues.push({ s, at: 0.05, action: "visit", beat: earlier[best].id });
    after = best;
  }
  return cues;
}

/**
 * ONE COLOUR PER CONCEPT, ACROSS THE WHOLE LESSON. The same thing (same id — "glucose", "water") is
 * drawn in the same colour on every board: a node, an equation token, a scene item. Colour that
 * means the same thing everywhere is signalling (g ≈ 0.53 on retention, Schneider et al. 2018); the
 * same thing in three colours is noise. The first colour a board gave it wins; a concept on two or
 * more boards with no colour gets one from the palette.
 */
export function unifyConceptColours(specs: CanvasBoardSpec[]): void {
  const colour = new Map<string, string>();
  const seen = new Map<string, number>();
  for (const spec of specs) {
    for (const el of colouredElements(spec)) {
      seen.set(el.id, (seen.get(el.id) ?? 0) + 1);
      if (el.color && !colour.has(el.id)) colour.set(el.id, el.color);
    }
  }
  let next = 0;
  for (const [id, count] of seen) if (count > 1 && !colour.has(id)) colour.set(id, PALETTE[next++ % PALETTE.length]);
  for (const spec of specs) applyConceptColours(spec, colour);
}

type Coloured = { id: string; color?: string };

/** The elements of a board that stand for a concept and so carry its colour. */
function colouredElements(spec: CanvasBoardSpec): Coloured[] {
  const st = spec.stage;
  if (st.kind === "flow") return st.nodes;
  if (st.kind === "scene") return st.items;
  if (st.kind === "equation") return st.tokens.filter((t) => !/^[+=→←⇌−-]$/.test(t.text.trim()));
  return [];
}

/**
 * The same rule when boards are written ONE AT A TIME (a progressive lecture, lib/canvas/progressive.ts):
 * no board can wait for the others, so the colours are decided from the plan instead. Every object
 * the plan puts on two or more boards gets a palette colour up front, in order of first appearance.
 */
export function planConceptColours(plan: Array<{ objects: string[] }>): Record<string, string> {
  const count = new Map<string, number>();
  for (const beat of plan) for (const id of new Set(beat.objects)) count.set(id, (count.get(id) ?? 0) + 1);
  const out: Record<string, string> = {};
  const free = PALETTE.filter((c) => !Object.values(CONVENTIONS).includes(c));
  let next = 0;
  for (const [id, n] of count) {
    if (n < 2) continue;
    const convention = Object.entries(CONVENTIONS).find(([word]) => new RegExp(`(^|-)${word}`).test(id));
    out[id] = convention ? convention[1] : free[next++ % free.length];
  }
  return out;
}

/** The colours students already know these things by (the spec prompt asks for the same ones). */
const CONVENTIONS: Record<string, string> = {
  sun: "#d97706",
  light: "#d97706",
  water: "#2563eb",
  "carbon-dioxide": "#475569",
  oxygen: "#0284c7",
  glucose: "#c2410c",
  sugar: "#c2410c",
  plant: "#15803d",
  leaf: "#15803d",
};

/** Paints every element whose id has a lesson colour in that colour. */
export function applyConceptColours(spec: CanvasBoardSpec, colours: Map<string, string> | Record<string, string>): void {
  const get = (id: string) => (colours instanceof Map ? colours.get(id) : colours[id]);
  for (const el of colouredElements(spec)) {
    const c = get(el.id);
    if (c) el.color = c;
  }
}

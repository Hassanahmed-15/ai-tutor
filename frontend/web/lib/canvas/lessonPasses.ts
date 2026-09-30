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
  type Coloured = { id: string; color?: string };
  const elements = (spec: CanvasBoardSpec): Coloured[] => {
    const st = spec.stage;
    if (st.kind === "flow") return st.nodes;
    if (st.kind === "scene") return st.items;
    if (st.kind === "equation") return st.tokens.filter((t) => !/^[+=→←⇌−-]$/.test(t.text.trim()));
    return [];
  };
  const colour = new Map<string, string>();
  const seen = new Map<string, number>();
  for (const spec of specs) {
    for (const el of elements(spec)) {
      seen.set(el.id, (seen.get(el.id) ?? 0) + 1);
      if (el.color && !colour.has(el.id)) colour.set(el.id, el.color);
    }
  }
  let next = 0;
  for (const [id, count] of seen) if (count > 1 && !colour.has(id)) colour.set(id, PALETTE[next++ % PALETTE.length]);
  for (const spec of specs) for (const el of elements(spec)) if (colour.has(el.id)) el.color = colour.get(el.id);
}

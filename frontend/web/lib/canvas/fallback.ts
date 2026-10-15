import { canvasSentences } from "./plan";
import { figureComponent } from "../figures/registry";
import { slug } from "./validate";
import type { CanvasBoardSpec, CanvasPlanBeat } from "./types";

/**
 * The board shown when every attempt failed: still READABLE. The plan's objects (slugged ids, e.g.
 * "central-atom") become plain words ("Central atom") on a chain of steps the narration walks
 * through, revealed one per sentence — never boxes labelled with ids (audit 2026-10-15). A board
 * with one object or none shows the title and its words as notes.
 */
export function fallbackSpec(beat: CanvasPlanBeat): CanvasBoardSpec {
  const sentences = canvasSentences(beat.script);
  const last = Math.max(0, sentences.length - 1);
  const words = (name: string) => {
    const t = name.replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim();
    return (t.charAt(0).toUpperCase() + t.slice(1)).slice(0, 24);
  };
  // A library diagram needs no model: the parts the narration names, in the order it names them
  // (then the parts named in the plan's objects, to make three), labelled one per sentence.
  if (beat.figure === "library" && beat.figureAsset) {
    const asset = beat.figureAsset;
    const script = beat.script.toLowerCase();
    const at = (name: string) => { const i = script.indexOf(name.toLowerCase().replace(/\s*\(.*\)$/, "")); return i < 0 ? Infinity : i; };
    const said = asset.parts.map((p) => ({ p, at: at(p.name) })).filter((x) => x.at < Infinity).sort((a, b) => a.at - b.at).map((x) => x.p);
    const extra = beat.objects.map((id) => asset.parts.find((p) => p.id === id)).filter((p): p is NonNullable<typeof p> => Boolean(p));
    const chosen = [...new Set([...said, ...(said.length >= 3 ? [] : extra), ...(said.length + extra.length >= 3 ? [] : asset.parts)])].slice(0, 5);
    const parts = chosen.map((p, i, all) => ({ id: p.id, name: p.name.slice(0, 34), s: Math.min(last, Math.round((i * last) / Math.max(1, all.length - 1))) }));
    return { v: 1, heading: beat.title.slice(0, 40), notes: [], stage: { kind: "figure", component: "library", params: {}, parts, asset }, cues: [], ...(beat.overview ? { overview: true } : {}) };
  }
  // A code-drawn figure needs no model either: its parts, labelled one per sentence.
  const component = beat.figure ? figureComponent(beat.figure) : undefined;
  if (component) {
    // The parts the narration names, in the order it names them (then the rest, to fill five).
    const said = (name: string) => { const word = name.toLowerCase().split(/[\s(]/)[0].replace(/[^a-z-]/g, ""); const at = word ? beat.script.toLowerCase().search(new RegExp(`\\b${word}`)) : -1; return at < 0 ? Infinity : at; };
    const chosen = [...component.parts].map((p) => ({ p, at: said(p.name) })).sort((a, b) => a.at - b.at).slice(0, 5).map((x) => x.p);
    const parts = chosen.map((p, i, all) => ({ id: p.id, name: p.name, s: Math.min(last, Math.round((i * last) / Math.max(1, all.length - 1))) }));
    return { v: 1, heading: beat.title.slice(0, 40), notes: [], stage: { kind: "figure", component: component.name, params: {}, parts }, cues: [], ...(beat.overview ? { overview: true } : {}) };
  }
  // The wired electrolytic cell (lib/canvas/visualPolicy.ts) needs no model: its four parts are the board.
  if (["power-supply", "electrolyte", "anode", "cathode"].every((id) => beat.objects.includes(id))) {
    const at = (i: number) => Math.min(last, Math.round((i * last) / 3));
    const items = [
      { id: "power-supply", kind: "box" as const, label: "Power supply", cell: "C1", span: "2x1", s: at(0) },
      { id: "electrolyte", kind: "box" as const, label: "Electrolyte", cell: "C3", span: "2x2", s: at(1) },
      { id: "anode", kind: "box" as const, label: "Anode (+)", cell: "B3", s: at(2) },
      { id: "cathode", kind: "box" as const, label: "Cathode (−)", cell: "E3", s: at(3) },
    ];
    return { v: 1, heading: beat.title.slice(0, 40), notes: [], stage: { kind: "scene", items, arrows: [] }, cues: [], ...(beat.overview ? { overview: true } : {}) };
  }
  const names = [...new Set(beat.objects.map(words).filter(Boolean))].slice(0, 5);
  if (names.length >= 2) {
    const nodes = names.map((label, i) => ({ id: slug(label, `step-${i + 1}`), label, s: Math.min(last, Math.round((i * last) / Math.max(1, names.length - 1))) }));
    const arrows = nodes.slice(1).map((n, i) => ({ id: `${nodes[i].id}-to-${n.id}`, from: nodes[i].id, to: n.id, s: n.s }));
    return { v: 1, heading: beat.title.slice(0, 40), notes: [], stage: { kind: "flow", arrangement: "chain", nodes, arrows }, cues: [], ...(beat.overview ? { overview: true } : {}) };
  }
  const items = [{ id: "title", kind: "text" as const, label: words(names[0] ?? beat.title), cell: "B2", span: "4x1", s: 0 }];
  return { v: 1, heading: beat.title.slice(0, 40), notes: [], stage: { kind: "scene", items, arrows: [] }, cues: [], ...(beat.overview ? { overview: true } : {}) };
}

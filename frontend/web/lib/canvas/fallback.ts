import { canvasSentences } from "./plan";
import { alignToNarration } from "./narrationSync";
import { GRAPH_LIKE, HUMANITIES } from "./visualPolicy";
import { classifyInstructionalTask } from "./instructionalTask";
import { figureComponent } from "../figures/registry";
import { foreignFigureWords } from "../figures/foreignText";
import { slug } from "./validate";
import type { CanvasBoardSpec, CanvasPlanBeat } from "./types";

/**
 * The board shown when every attempt failed: still READABLE. The plan's objects (slugged ids, e.g.
 * "central-atom") become plain words ("Central atom") on a chain of steps the narration walks
 * through, revealed one per sentence — never boxes labelled with ids (audit 2026-10-15). A board
 * with one object or none shows the title and its words as notes.
 */
export function fallbackSpec(beat: CanvasPlanBeat): CanvasBoardSpec {
  // The backup is timed to the narration like any board (lib/canvas/narrationSync.ts).
  const spec = fallbackBoard(beat);
  alignToNarration(spec, beat);
  return spec;
}

function fallbackBoard(beat: CanvasPlanBeat): CanvasBoardSpec {
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
  const backupParams = component ? fallbackParams(component.name, `${beat.title} ${beat.brief} ${beat.script}`) : {};
  // A content figure built with no data draws its own example lesson ("Was the Treaty of Versailles
  // fair?" on a psychology board, audit 2026-10-17): that backup is never used — the board is built
  // from what Aria says instead.
  // A data diagram (a number line, graph, chart, timeline, balance) is only its data: with none, it
  // draws its built-in example — a −2…3 number line on a bounds lesson's exam board (audit
  // 2026-10-17). Only a structure (a heart, a leaf, apparatus) is drawn by the backup.
  // A board whose task requires that diagram (a significance test's distribution) keeps it when it
  // shows nothing foreign — its numbers, evenly spaced or not, counted as data.
  const dataDriven = component ? GRAPH_LIKE.has(component.name) || HUMANITIES.has(component.name) : false;
  const required = component ? classifyInstructionalTask(beat).figure === component.name : false;
  if (component && (!dataDriven || required) && !foreignFigureWords(component.name, backupParams, `${beat.title} ${beat.brief} ${beat.script}`, [], { ticksAreData: dataDriven }).length) {
    // Required ids first (aorta on a heart board), then the parts the narration names, then the rest.
    const said = (name: string) => { const word = name.toLowerCase().split(/[\s(]/)[0].replace(/[^a-z-]/g, ""); const at = word ? beat.script.toLowerCase().search(new RegExp(`\\b${word}`)) : -1; return at < 0 ? Infinity : at; };
    const required = new Set((beat.requiredVisual?.mustShow ?? []).filter((id) => component.parts.some((p) => p.id === id)));
    const chosen = [...component.parts]
      .map((p) => ({ p, at: required.has(p.id) ? -1 : said(p.name) }))
      .sort((a, b) => a.at - b.at)
      .slice(0, 6)
      .map((x) => x.p);
    const parts = chosen.map((p, i, all) => ({ id: p.id, name: p.name, s: Math.min(last, Math.round((i * last) / Math.max(1, all.length - 1))) }));
    return { v: 1, heading: beat.title.slice(0, 40), notes: [], stage: { kind: "figure", component: component.name, params: backupParams, parts }, cues: [], ...(beat.overview ? { overview: true } : {}) };
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
  // The backup is built from what Aria SAYS, not from bare ids: it once read "Dna → Rna polymerase →
  // Mrna", three empty circles (audit 2026-10-17). Names keep the narration's own spelling ("mRNA"),
  // each box carries the detail its sentence gives, and the key points are written as notes.
  // A figure skipped above leaves its part ids ("for", "against") as the objects: only names Aria
  // actually says are kept then.
  const names = [...new Set(beat.objects.map((o) => asSaid(o, beat.script) ?? (component ? undefined : words(o))).filter((n): n is string => Boolean(n)))].slice(0, 5);
  const notes = keyPoints(sentences, 3).map((text, i) => ({ id: `point-${i + 1}`, text, s: Math.min(last, i + 1) }));
  if (names.length >= 2) {
    const nodes = names.map((label, i) => {
      const sub = detailFor(label, sentences);
      return { id: slug(label, `step-${i + 1}`), label: atWord(label, 18), ...(sub ? { sub } : {}), s: Math.min(last, Math.round((i * last) / Math.max(1, names.length - 1))) };
    });
    const arrows = nodes.slice(1).map((n, i) => ({ id: `${nodes[i].id}-to-${n.id}`, from: nodes[i].id, to: n.id, s: n.s }));
    return { v: 1, heading: beat.title.slice(0, 40), notes, stage: { kind: "flow", arrangement: "chain", nodes, arrows }, cues: [], ...(beat.overview ? { overview: true } : {}) };
  }
  // No named objects: the board is its key points.
  // A box's detail line holds up to 80 characters: the point is written whole where it fits.
  const points = keyPoints(sentences, 4, 80);
  // A box's title is cut at a word, never inside one ("Employment structure m", audit 2026-10-17);
  // the whole point is its detail line.
  const items = (points.length ? points : [beat.title]).map((label, i) => ({ id: `point-${i + 1}`, kind: "box" as const, label: atWord(label.split(/[:—–]/)[0], 22), ...(label.length > 22 ? { detail: label } : {}), cell: `${"BD"[i % 2]}${1 + Math.floor(i / 2) * 2}`, span: "2x1", s: Math.min(last, i) }));
  return { v: 1, heading: beat.title.slice(0, 40), notes: [], stage: { kind: "scene", items, arrows: [] }, cues: [], ...(beat.overview ? { overview: true } : {}) };
}

/** The few parameters a backup figure can read off the board's words without a model. */
function fallbackParams(name: string, text: string): Record<string, string | number | boolean> {
  const params: Record<string, string | number | boolean> = {};
  if (name === "electromagnetism" && /\btransformers?\b|\bturns ratio\b|\bstep[- ](up|down)\b/i.test(text)) params.device = "transformer";
  if (name === "sequences" && /\bgeom/i.test(text)) params.type = "geometric";
  if (name === "geneticTech" && /\bPCR|polymerase chain/i.test(text)) params.view = "pcr";
  return params;
}

/** An object id ("mrna", "rna-polymerase") as the narration writes it ("mRNA", "RNA polymerase"). */
export function asSaid(id: string, script: string): string | undefined {
  const parts = id.split(/[-_\s]+/).filter(Boolean).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  if (!parts.length) return undefined;
  const found = new RegExp(`\\b${parts.join("[\\s-]+")}\\b`, "i").exec(script)?.[0];
  if (!found) return undefined;
  // Keep a spelling that carries its own capitals ("mRNA", "ATP"); otherwise capitalise the first letter.
  return /[A-Z]/.test(found.slice(1)) ? found : found.charAt(0).toUpperCase() + found.slice(1);
}

/** The words that fit in max characters, whole words only and no ellipsis (a box title). */
function atWord(text: string, max: number): string {
  const t = text.replace(/\s+/g, " ").trim().replace(/[.!?,;]+$/, "");
  if (t.length <= max) return t;
  const words = t.split(" ");
  let out = "";
  for (const w of words) {
    if ((out ? out.length + 1 : 0) + w.length > max) break;
    out = out ? `${out} ${w}` : w;
  }
  return (out || t.slice(0, max)).replace(/\s+(and|or|of|the|a|an|to|in|on|for|with|by)$/i, "");
}

/** Shortens at a word, never mid-word. */
function shorten(text: string, max: number): string {
  const t = text.replace(/\s+/g, " ").trim().replace(/[.!?]+$/, "");
  if (t.length <= max) return t;
  const cut = t.slice(0, max - 1);
  const at = cut.lastIndexOf(" ");
  return `${(at > max * 0.5 ? cut.slice(0, at) : cut).replace(/[\s,;:(–-]+$/, "")}…`;
}

/** What the narration says about a named thing: the rest of the first sentence that names it. */
function detailFor(name: string, sentences: string[]): string | undefined {
  const at = sentences.find((s) => s.toLowerCase().includes(name.toLowerCase()) && !/\?\s*$/.test(s));
  if (!at) return undefined;
  const rest = at.slice(at.toLowerCase().indexOf(name.toLowerCase()) + name.length).replace(/^[\s,:;–—-]+(is|are|was|were|then|which|that)?\s*/i, "");
  return rest.length >= 6 ? shorten(rest, 22) : undefined;
}

/** The board's teaching statements — not its prediction question, not the closing transfer prompt. */
function keyPoints(sentences: string[], n: number, max = 44): string[] {
  const body = sentences.slice(0, Math.max(1, sentences.length - 1)).filter((s) => !/\?\s*$/.test(s) && !/^\s*(predict|now try|now apply|as an exam)/i.test(s));
  return body.slice(0, n).map((s) => shorten(s, max));
}

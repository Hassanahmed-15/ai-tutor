import { canvasSentences } from "./plan";
import { alignToNarration, anchorNotes } from "./narrationSync";
import { slug, trimToFit } from "./validate";
import { GRAPH_LIKE, HUMANITIES } from "./visualPolicy";
import { classifyInstructionalTask } from "./instructionalTask";
import { isRealProcess } from "../diagrams/visualForm";
import { figureComponent } from "../figures/registry";
import { foreignFigureWords } from "../figures/foreignText";
import type { CanvasBoardSpec, CanvasPlanBeat } from "./types";
import { courseCodeDiagramsOff } from "./courseFigures";
import { chemSubscripts } from "./chemText";

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
    // Whole: the layout fits a name to its box (a 24-character cap cut names mid-word).
    return t.charAt(0).toUpperCase() + t.slice(1);
  };
  // A COURSE LESSON'S BOARD IS NEVER CODE-DRAWN (owner, 2026-10-24: "no code diagrams … gpt-image-2 for
  // everything"): when it cannot be made, it is WRITTEN — what Aria writes as she speaks, each line on the
  // sentence that says it — never boxes, arrows or a ready-made figure.
  if (beat.course && courseCodeDiagramsOff()) {
    // In the order she says them (a note planned for sentence 0 was written fifth), formulas in print
    // ("CH₄", not "CH4"), a line that repeats an earlier one left out ("Metaphase plate" after "Equatorial
    // plane; metaphase plate"), and at most eight lines — a written board, not a wall of text.
    const stems = (t: string) => (t.toLowerCase().match(/[a-z0-9]{3,}/g) ?? []).map((w) => w.slice(0, 5));
    const kept: Array<{ text: string; s: number }> = [];
    for (const n of (beat.boardNotes ?? []).filter((n) => n.text.trim()).map((n) => ({ text: chemSubscripts(n.text.trim()), s: Math.min(last, Math.max(0, n.s)) })).sort((a, b) => a.s - b.s)) {
      const mine = stems(n.text);
      const repeats = kept.some((k) => { const theirs = new Set(stems(k.text)); return mine.length > 0 && mine.filter((w) => theirs.has(w)).length / mine.length >= 0.6; });
      if (!repeats) kept.push(n);
    }
    const planned = kept.slice(0, 8);
    const lines = planned.length ? planned : keyPoints(sentences, 4, 60).map((text, i, all) => ({ text, s: Math.min(last, Math.round((i * last) / Math.max(1, all.length - 1))) }));
    const items = lines.map((l, i) => ({ id: `line-${i + 1}`, type: "text" as const, text: l.text, s: l.s, col: "full" as const }));
    return { v: 1, heading: beat.title.trim(), notes: [], stage: { kind: "sketch", items }, cues: [], ...(beat.overview ? { overview: true } : {}) };
  }
  // A maths/CS sketch that could not be drawn is still WRITTEN on the board, line by line as Aria says
  // it — never swapped for cards the lecture's look does not use (lib/canvas/sketch.ts).
  if (beat.stage === "sketch") {
    // Drawing first (owner, 2026-10-21: "too much text"): at most two short lines.
    const points = keyPoints(sentences, 2, 50);
    const items = points.map((text, i) => ({ id: `line-${i + 1}`, type: "text" as const, text, s: Math.min(last, i * 2), col: "full" as const, ...(i === 0 ? { size: "big" as const } : {}) }));
    return { v: 1, heading: beat.title.trim(), notes: [], stage: { kind: "sketch", items }, cues: [], ...(beat.overview ? { overview: true } : {}) };
  }
  // A library diagram needs no model: the parts the narration names, in the order it names them
  // (then the parts named in the plan's objects, to make three), labelled one per sentence.
  if (beat.figure === "library" && beat.figureAsset) {
    const asset = beat.figureAsset;
    const script = beat.script.toLowerCase();
    const at = (name: string) => { const i = script.indexOf(name.toLowerCase().replace(/\s*\(.*\)$/, "")); return i < 0 ? Infinity : i; };
    const said = asset.parts.map((p) => ({ p, at: at(p.name) })).filter((x) => x.at < Infinity).sort((a, b) => a.at - b.at).map((x) => x.p);
    const extra = beat.objects.map((id) => asset.parts.find((p) => p.id === id)).filter((p): p is NonNullable<typeof p> => Boolean(p));
    const chosen = [...new Set([...said, ...(said.length >= 3 ? [] : extra), ...(said.length + extra.length >= 3 ? [] : asset.parts)])].slice(0, 5);
    const parts = chosen.map((p, i, all) => ({ id: p.id, name: p.name, s: Math.min(last, Math.round((i * last) / Math.max(1, all.length - 1))) }));
    return { v: 1, heading: beat.title.trim(), notes: [], stage: { kind: "figure", component: "library", params: {}, parts, asset }, cues: [], ...(beat.overview ? { overview: true } : {}) };
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
    return { v: 1, heading: beat.title.trim(), notes: [], stage: { kind: "figure", component: component.name, params: backupParams, parts }, cues: [], ...(beat.overview ? { overview: true } : {}) };
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
    return { v: 1, heading: beat.title.trim(), notes: [], stage: { kind: "scene", items, arrows: [] }, cues: [], ...(beat.overview ? { overview: true } : {}) };
  }
  // The backup is built from what Aria SAYS, not from bare ids: it once read "Dna → Rna polymerase →
  // Mrna", three empty circles (audit 2026-10-17). Names keep the narration's own spelling ("mRNA"),
  // each box carries the detail its sentence gives, and the key points are written as notes.
  // A figure skipped above leaves its part ids ("for", "against") as the objects: only names Aria
  // actually says are kept then.
  const names = [...new Set(beat.objects.map((o) => asSaid(o, beat.script) ?? (component ? undefined : words(o))).filter((n): n is string => Boolean(n)))].slice(0, 5);
  // What Aria writes as she speaks, when the plan has it; otherwise the narration's key points.
  const notes = beat.boardNotes?.length
    ? anchorNotes(beat.boardNotes.map((n, i) => ({ id: `say-${i + 1}`, text: trimToFit(n.text, 34), s: n.s })), beat.script)
    : keyPoints(sentences, 3).map((text, i) => ({ id: `point-${i + 1}`, text, s: Math.min(last, i + 1) }));
  if (names.length >= 2 && (isRealProcess(`${beat.title} ${beat.brief} ${beat.script}`) || beat.stage === "flow" || beat.visualType === "diagram" || beat.visualType === "sequence")) {
    const nodes = names.map((label, i) => {
      const sub = detailFor(label, sentences);
      return { id: slug(label, `step-${i + 1}`), label: atWord(label, 18), ...(sub ? { sub } : {}), s: Math.min(last, Math.round((i * last) / Math.max(1, names.length - 1))) };
    });
    const arrows = nodes.slice(1).map((n, i) => ({ id: `${nodes[i].id}-to-${n.id}`, from: nodes[i].id, to: n.id, s: n.s }));
    const loop = /\bcycle\b/i.test(`${beat.title} ${beat.brief}`) && nodes.length >= 3;
    if (loop) arrows.push({ id: `${nodes[nodes.length - 1].id}-to-${nodes[0].id}`, from: nodes[nodes.length - 1].id, to: nodes[0].id, s: nodes[nodes.length - 1].s });
    return { v: 1, heading: beat.title.trim(), notes, stage: { kind: "flow", arrangement: loop ? "cycle" : "chain", nodes, arrows }, cues: [], ...(beat.overview ? { overview: true } : {}) };
  }
  if (names.length >= 2) {
    const items = names.map((label, i) => {
      const sub = detailFor(label, sentences);
      return { id: slug(label, `box-${i + 1}`), kind: "box" as const, label: atWord(label, 22), ...(sub ? { detail: sub } : {}), cell: `${"BD"[i % 2]}${1 + Math.floor(i / 2) * 2}`, span: "2x1", s: Math.min(last, Math.round((i * last) / Math.max(1, names.length - 1))) };
    });
    return { v: 1, heading: beat.title.trim(), notes, stage: { kind: "scene", items, arrows: [] }, cues: [], ...(beat.overview ? { overview: true } : {}) };
  }
  // No named objects: the board is its key points.
  // A box's detail line holds up to 80 characters: the point is written whole where it fits.
  const points = keyPoints(sentences, 4, 130);
  // A process, a cycle or a board the visual choice called a diagram is drawn as one: its cards
  // joined by arrows in reading order (round the board, back to the start for a cycle), never four
  // loose cards (the Krebs cycle shipped as four static text boxes — bench, 2026-10-18).
  const text = `${beat.title} ${beat.brief} ${beat.script}`;
  const cycle = /\bcycle\b/i.test(`${beat.title} ${beat.brief}`);
  const linked = points.length >= 2 && (cycle || beat.visualType === "diagram" || beat.visualType === "sequence" || beat.stage === "flow" || isRealProcess(text));
  // Clockwise round the board (A1 → E1 → E3 → A3), so the arrows never cross and a cycle closes; the
  // two empty columns between are the room the side arrows are drawn in (boxes side by side at B and
  // D touched, and their arrows were never drawn).
  const cells = linked ? ["A1", "E1", "E3", "A3"] : ["B1", "D1", "B3", "D3"];
  // A box's title is what the point is ABOUT ("Direct impact" from "A direct impact is a collision…"),
  // never the point's first words cut short ("A direct impact is", "For an isolated" — audit
  // 2026-10-17); a point with no clear subject is written as the card's text alone.
  // Each card arrives with the sentence that says it, spread over the whole narration: four cards
  // on sentences 1–4 of a seven-sentence board left Aria talking over a finished board.
  const list = points.length ? points : [beat.title];
  const at = (i: number) => sentenceOf(list[i], sentences) ?? Math.min(last, Math.round((i * last) / Math.max(1, list.length - 1)));
  const items = list.map((label, i) => {
    const title = pointTitle(label);
    return { id: `point-${i + 1}`, kind: "box" as const, label: title ?? (label.length <= 22 ? label : ""), ...(title || label.length > 22 ? { detail: label } : {}), cell: cells[i], span: "2x1", s: at(i) };
  });
  const arrows = linked
    ? [...items.slice(1).map((it, i) => ({ id: `${items[i].id}-to-${it.id}`, from: items[i].id, to: it.id, s: it.s })),
      ...(cycle && items.length >= 3 ? [{ id: `${items[items.length - 1].id}-to-${items[0].id}`, from: items[items.length - 1].id, to: items[0].id, s: items[items.length - 1].s }] : [])]
    : [];
  return { v: 1, heading: beat.title.trim(), notes: [], stage: { kind: "scene", items, arrows }, cues: [], ...(beat.overview ? { overview: true } : {}) };
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

/**
 * The subject a key point is about, as a card title: "A direct impact is a collision…" → "Direct
 * impact"; "Momentum: mass × velocity" → "Momentum". Undefined when the point has no short subject.
 */
export function pointTitle(point: string): string | undefined {
  const t = point.replace(/\s+/g, " ").trim();
  const head = /^(.{3,26}?)\s*(?::|—|–| - )\s*\S/.exec(t)?.[1] ?? /^(.{3,26}?)\s+(?:is|are|was|were|means|measures|equals|=)\s/i.exec(t)?.[1];
  if (!head) return undefined;
  const subject = head.replace(/^(?:the|a|an|for|in|so|this|that|these|those|each|every|both)\s+/i, "").replace(/[,;.]+$/, "").trim();
  // A clause, not a subject ("when it is heated", "if you take"): no title.
  if (subject.length < 3 || /^(?:when|if|because|so|then|it|they|we|you|this|there)\b/i.test(subject) || subject.split(" ").length > 4) return undefined;
  return subject.charAt(0).toUpperCase() + subject.slice(1);
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
  // A complete phrase, never "…" (owner, 2026-10-17).
  return trimToFit(text.replace(/\s+/g, " ").trim().replace(/[.!?]+$/, ""), max);
}

/** What the narration says about a named thing: the rest of the first sentence that names it. */
function detailFor(name: string, sentences: string[]): string | undefined {
  const at = sentences.find((s) => s.toLowerCase().includes(name.toLowerCase()) && !/\?\s*$/.test(s));
  if (!at) return undefined;
  const rest = at.slice(at.toLowerCase().indexOf(name.toLowerCase()) + name.length).replace(/^[\s,:;–—-]+(is|are|was|were|then|which|that)?\s*/i, "");
  // The card's detail shrinks to fit whole (layout fitDetail); 22 characters cut most of them short.
  return rest.length >= 6 ? shorten(rest, 70) : undefined;
}

/**
 * The board's teaching statements — not its prediction question, not the closing transfer prompt —
 * spread over the narration (the first, the last and evenly between), each a whole clause.
 */
function keyPoints(sentences: string[], n: number, max = 60): string[] {
  const body = sentences.slice(0, Math.max(1, sentences.length - 1)).filter((s) => !/\?\s*$/.test(s) && !/^\s*(predict|now try|now apply|as an exam)/i.test(s));
  const picked = body.length <= n ? body : Array.from({ length: n }, (_, i) => body[Math.round((i * (body.length - 1)) / (n - 1))]);
  return [...new Set(picked)].map((s) => wholeClause(s, max));
}

/**
 * A sentence that fits, cut where a clause ends — "One carbon dioxide molecule leaves" — never in the
 * middle of one: "…so the six-carbon intermediate becomes" shipped on a Krebs board (2026-10-18).
 */
export function wholeClause(sentence: string, max: number): string {
  const t = sentence.replace(/\s+/g, " ").trim().replace(/[.!?]+$/, "");
  if (t.length <= max) return t;
  const head = t.slice(0, max + 1);
  const cut = Math.max(head.lastIndexOf(", "), head.lastIndexOf("; "), head.lastIndexOf(" — "), head.lastIndexOf(": "));
  if (cut >= 20) return t.slice(0, cut).trim();
  // No clause ends in time: the words that fit, never ending on a word that needs one after it.
  return shorten(t, max).replace(/(\s+(and|or|but|so|of|the|a|an|to|in|on|for|with|by|during|from|into|as|at|that|which))+$/i, "");
}

/** The sentence a key point was taken from. */
function sentenceOf(point: string, sentences: string[]): number | undefined {
  const i = sentences.findIndex((s) => s.replace(/\s+/g, " ").trim().startsWith(point.slice(0, Math.min(point.length, 30))));
  return i < 0 ? undefined : i;
}

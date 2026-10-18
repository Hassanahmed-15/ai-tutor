import type { FigureComponent, FigureParams, Ink, Pt } from "../types";
import { fitText } from "../cuts";
import { Sketch } from "./mathsKit";
import { INK, firstNumber, show } from "./physicsKit2";

/**
 * SANKEY (ENERGY TRANSFER) DIAGRAM. The model names the input store and the output stores with
 * their values; code checks conservation of energy — the outputs must add up to the input: one
 * output given without a value gets the remainder, outputs that fall short get an "other wasted"
 * band, outputs that exceed the input raise the input to their total (and say so) — then draws every
 * arrow with a width exactly proportional to its energy (useful straight on, wasted turning down)
 * and computes efficiency = useful output ÷ total input.
 */

export type Flow = { name: string; value: number; useful: boolean };
export type SankeyResult = { input: { name: string; value: number }; outputs: Flow[]; unit: string; efficiency: number; adjusted: boolean; note: string };

const UNIT = /\b(kJ|MJ|J|kW|MW|W|kWh|%)\b/;
function item(s: string): { name: string; value: number | undefined; unit?: string; useful?: boolean } {
  const t = s.replace(/−/g, "-").trim();
  const value = firstNumber(t);
  const unit = t.match(UNIT)?.[1];
  const useful = /\buseful\b/i.test(t) ? true : /\b(wasted?|lost|dissipated)\b/i.test(t) ? false : undefined;
  const name = t
    .replace(/-?\d+(?:\.\d+)?(?:e-?\d+)?/gi, " ")
    .replace(UNIT, " ")
    .replace(/\b(useful|wasted?|lost|dissipated|energy|store|output|input|of)\b/gi, " ")
    .replace(/[()=:]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return { name: fitText(name, 28), value: value !== undefined && Number.isFinite(value) ? Math.abs(value) : undefined, unit, useful };
}

export function sankeyFlow(params: FigureParams): SankeyResult {
  let inText = typeof params.input === "string" || typeof params.input === "number" ? String(params.input) : "";
  let outText = typeof params.outputs === "string" ? params.outputs : "";
  if (typeof params.flow === "string" && params.flow.trim()) {
    const [a, b = ""] = params.flow.split(/→|->|=>|\bto\b(?=\s*[a-z]*\s*useful|\s)/i);
    if (!inText) inText = a;
    if (!outText) outText = b;
  }
  if (!inText && !outText) { inText = "chemical 100 J"; outText = "useful kinetic 30 J, thermal 60 J, sound 10 J"; }
  const inp = item(inText || "input");
  const raw = outText.split(/[,;+]|\band\b/).map((s) => s.trim()).filter(Boolean).slice(0, 6).map(item);
  const unit = inp.unit ?? raw.find((r) => r.unit)?.unit ?? "J";
  const outs: Array<{ name: string; value: number | undefined; useful?: boolean }> = raw.length ? raw : [{ name: "useful", value: undefined, useful: true }];
  // Useful: the outputs marked useful, else the first.
  const anyUseful = outs.some((o) => o.useful === true);
  const flows = outs.map((o, i) => ({ name: o.name || (anyUseful ? (o.useful ? "useful" : "wasted") : i === 0 ? "useful" : "wasted"), value: o.value, useful: anyUseful ? o.useful === true : i === 0 }));
  let input = inp.value ?? NaN;
  let adjusted = false, note = "";
  const missing = flows.filter((f) => f.value === undefined);
  const knownSum = flows.reduce((s, f) => s + (f.value ?? 0), 0);
  if (!Number.isFinite(input)) { input = missing.length ? Math.max(knownSum, 100) : knownSum; if (missing.length === 0) adjusted = false; }
  if (missing.length) {
    // Share the remainder among the unvalued outputs (normally just one).
    const rest = Math.max(0, input - knownSum);
    for (const f of missing) f.value = rest / missing.length;
    if (input - knownSum < 0) { input = knownSum; adjusted = true; note = "outputs exceeded the input: input set to their total"; }
  }
  let outputs: Flow[] = flows.map((f) => ({ name: f.name, value: f.value as number, useful: f.useful }));
  const sum = outputs.reduce((s, f) => s + f.value, 0);
  const tol = 1e-9 * Math.max(1, input);
  if (sum < input - tol) { outputs.push({ name: "other", value: input - sum, useful: false }); adjusted = true; note = "outputs fell short of the input: the rest shown as other wasted energy"; }
  else if (sum > input + tol) { input = sum; adjusted = true; note = "outputs exceeded the input: input set to their total"; }
  outputs = outputs.filter((f) => f.value > 0);
  if (!outputs.length || input <= 0) { input = 100; outputs = [{ name: "useful", value: 100, useful: true }]; adjusted = true; note = "no values given"; }
  if (!outputs.some((f) => f.useful)) outputs[0].useful = true;
  const useful = outputs.filter((f) => f.useful).reduce((s, f) => s + f.value, 0);
  return { input: { name: inp.name || "input", value: input, }, outputs, unit, efficiency: useful / input, adjusted, note };
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export const sankey: FigureComponent = {
  name: "sankey",
  title: "Sankey diagram: energy transfer from an input store to useful and wasted outputs, arrow widths proportional to the energy, with the efficiency",
  params: `input (the input store and its energy, e.g. "chemical 100 J"), outputs (comma-separated output stores with their values; mark the useful one(s) with "useful", e.g. "useful kinetic 30 J, thermal 60 J, sound 10 J"; unmarked: the first is useful, the rest wasted) — or both in one: flow "electrical 200 J → useful light 40 J, thermal 160 J". Units J, kJ, W, kW or %. The outputs must add up to the input (energy is conserved): one output given without a value gets the remainder; if they fall short, an "other" wasted arrow is added; if they exceed the input, the input is raised to their total. Arrow widths are proportional to the energy; efficiency = useful ÷ input is computed and written.`,
  match: /\b(sankey|energy (flow|transfer) diagrams?|useful (energy|output)|wasted energy|energy (wasted|dissipated))\b|\befficiency of (a |an |the )?\w+\b(?=[\s\S]*\benergy\b)/i,
  parts: [
    { id: "input", name: "Energy input" },
    { id: "useful-output", name: "Useful energy output" },
    { id: "useful-output-2", name: "Second useful output" },
    { id: "wasted-output", name: "Wasted energy output" },
    { id: "wasted-output-2", name: "Second wasted output" },
    { id: "wasted-output-3", name: "Third wasted output" },
    { id: "wasted-output-4", name: "Fourth wasted output" },
    { id: "wasted-output-5", name: "Fifth wasted output" },
    { id: "efficiency", name: "Efficiency" },
  ],
  build(params: FigureParams) {
    const r = sankeyFlow(params);
    const u = r.unit;
    const v = (n: number) => `${show(n, 2)} ${u}`;
    const sk = new Sketch();
    const WIN = 170; // input band width (px) — every band is value × k
    const k = WIN / r.input.value;
    const splitX = 190, endX = 470, gap = 30;
    const useful = r.outputs.filter((f) => f.useful), wasted = r.outputs.filter((f) => !f.useful);
    const main = useful[0], extra = useful.slice(1);
    // Stack at the split, top → bottom: extra useful, main useful, wasted.
    const order = [...extra, main, ...wasted];
    let y = 0;
    const slot = new Map<Flow, { a: number; b: number }>();
    for (const f of order) { slot.set(f, { a: y, b: y + f.value * k }); y += f.value * k; }
    const head = (w: number) => ({ half: w / 2 + Math.max(7, w * 0.22), len: Math.max(16, Math.min(46, w * 0.45)) });
    const wastedInks: Ink[] = [INK.red, INK.amber, INK.violet, "#be185d", "#0f766e"];
    // Input band with a notched tail.
    sk.polygon([{ x: 0, y: 0 }, { x: splitX, y: 0 }, { x: splitX, y: WIN }, { x: 0, y: WIN }, { x: 18, y: WIN / 2 }], { fill: INK.blue, stroke: "ink", width: 1.4, opacity: 0.85, part: "input" });
    sk.placeText(v(r.input.value), 16, { x: 10, y: WIN / 2 }, { x: 1, y: 0 }, { min: 30, max: 120, fill: "paper", part: "input" });
    sk.part("input", `${cap(r.input.name)} energy in (${v(r.input.value)})`, { x: 40, y: WIN * 0.22 });

    // Main useful band: straight on, arrowhead to the right.
    {
      const s = slot.get(main)!, w = s.b - s.a, h = head(w), cy = (s.a + s.b) / 2;
      sk.polygon([{ x: splitX, y: s.a }, { x: endX, y: s.a }, { x: endX, y: cy - h.half }, { x: endX + h.len, y: cy }, { x: endX, y: cy + h.half }, { x: endX, y: s.b }, { x: splitX, y: s.b }], { fill: INK.green, stroke: "ink", width: 1.4, opacity: 0.85, part: "useful-output" });
      sk.placeText(v(main.value), 16, { x: endX + h.len + 8, y: cy }, { x: 1, y: 0 }, { min: 26, max: 90, fill: INK.green, part: "useful-output" });
      sk.part("useful-output", `Useful ${main.name} energy (${v(main.value)})`, { x: (splitX + endX) / 2 + 40, y: s.a + Math.min(w / 2, 10) });
      const effText = `efficiency = ${show(r.efficiency * 100, 1)}%`;
      const at = sk.placeText(effText, 16, { x: (splitX + endX) / 2 + (extra.length ? 70 : 0), y: s.a - 18 }, { x: 0, y: -1 }, { min: 0, max: 60, fill: INK.green, part: "efficiency" });
      sk.part("efficiency", `Efficiency = ${show(useful.reduce((t, f) => t + f.value, 0), 2)} ÷ ${show(r.input.value, 2)} = ${show(r.efficiency * 100, 1)}%`, { x: at.x + effText.length * 4.6, y: at.y });
    }

    // Bands that turn: wasted ones down (innermost = lowest), extra useful ones up.
    const turn = (f: Flow, i: number, down: boolean, ink: Ink, part: string, name: string, groupEdge: number) => {
      const s = slot.get(f)!, w = s.b - s.a;
      const near = down ? s.b : s.a, far = down ? s.a : s.b; // inner and outer edges at the split
      const yc = groupEdge + (down ? 26 : -26); // the common turning height, just beyond the group
      const cx = splitX + 30 + i * gap;
      const rIn = Math.abs(yc - near), rOut = Math.abs(yc - far);
      const sgn = down ? 1 : -1;
      const runTo = yc + sgn * (down ? 150 : 90);
      const h = head(w);
      const xIn = cx + rIn, xOut = cx + rOut, xMid = (xIn + xOut) / 2;
      const P = (x: number, yy: number): Pt => ({ x, y: yy });
      sk.path([
        { k: "M", p: P(splitX, far) }, { k: "L", p: P(cx, far) },
        { k: "A", c: P(cx, yc), r: rOut, to: P(xOut, yc), large: false, sweep: down },
        { k: "L", p: P(xOut, runTo) }, { k: "L", p: P(xMid + h.half, runTo) }, { k: "L", p: P(xMid, runTo + sgn * h.len) }, { k: "L", p: P(xMid - h.half, runTo) },
        { k: "L", p: P(xIn, runTo) }, { k: "L", p: P(xIn, yc) },
        { k: "A", c: P(cx, yc), r: rIn, to: P(cx, near), large: false, sweep: !down },
        { k: "L", p: P(splitX, near) },
      ], true, { fill: ink, stroke: "ink", width: 1.4, opacity: 0.85, part }, true);
      sk.placeText(v(f.value), 15, P(xMid, runTo + sgn * (h.len + 10)), { x: 0, y: sgn }, { min: 0, max: 60, fill: ink, part, slide: { x: 1, y: 0 } });
      if (!sk.parts.some((pt) => pt.id === part)) sk.part(part, name, P(xOut, runTo - sgn * 30));
    };
    const wastedBottom = WIN;
    // Innermost (lowest) wasted band turns first.
    [...wasted].reverse().forEach((f, i) => {
      const idx = wasted.indexOf(f);
      turn(f, i, true, wastedInks[idx % wastedInks.length], idx === 0 ? "wasted-output" : `wasted-output-${idx + 1}`, f.name === "other" ? `Other wasted energy (${v(f.value)})` : `Wasted ${f.name} energy (${v(f.value)})`, wastedBottom);
    });
    extra.forEach((f, i) => turn(f, extra.length - 1 - i, false, "#15803d", "useful-output-2", `Useful ${f.name} energy (${v(f.value)})`, 0));
    return sk.finish(16);
  },
};

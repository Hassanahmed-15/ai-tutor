import type { FigureComponent, FigureParams, Ink, Pt } from "../types";
import { fitText } from "../cuts";
import { PALETTE, Sketch, arrow, frac, fracAdd, fracMul, fracStr, list, num, polar, textW, type Frac } from "./mathsKit";

/**
 * FRACTION MODELS: bars, area squares, circles (pies) and number lines. The board gives the
 * fractions and the operation; the code cuts every whole into equal parts, finds the common
 * denominator, and works out the result — so 3/4 + 2/3 is drawn as 9 twelfths and 8 twelfths
 * making 17/12, and 3/4 × 2/3 as the 6 of 12 cells where the two shadings overlap.
 */

export type Op = "none" | "compare" | "add" | "subtract" | "multiply" | "equivalent";
type Model = "bar" | "area" | "circle" | "number-line";

const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : Math.abs(a) || 1);
export const lcm = (a: number, b: number) => Math.abs(a * b) / gcd(a, b);

/** "3/4", "1 1/2", "2", "5/4" → a fraction (denominator 1-24, value 0-6), or undefined. Not reduced: 2/4 stays 2/4. */
export function parseFraction(s: string): Frac | undefined {
  const t = s.trim().replace(/[⁄∕÷]/g, "/");
  let m = /^(\d+)\s+(\d+)\s*\/\s*(\d+)$/.exec(t);
  if (m) {
    const w = Number(m[1]), n = Number(m[2]), d = Number(m[3]);
    return ok({ n: w * d + n, d });
  }
  m = /^(\d+)\s*\/\s*(\d+)$/.exec(t);
  if (m) return ok({ n: Number(m[1]), d: Number(m[2]) });
  m = /^(\d+)$/.exec(t);
  if (m) return ok({ n: Number(m[1]), d: 1 });
  return undefined;
}
const ok = (f: Frac): Frac | undefined => (f.d >= 1 && f.d <= 24 && f.n >= 0 && f.n <= 6 * f.d ? f : undefined);

/** The worked arithmetic: the common denominator, each fraction over it, and the result (reduced). */
export function fractionMaths(a: Frac, b: Frac, op: Op): { lcd: number; aOver: number; bOver: number; result?: Frac; relation?: "<" | ">" | "=" } {
  const L = lcm(a.d, b.d);
  const aOver = (a.n * L) / a.d, bOver = (b.n * L) / b.d;
  const relation = aOver > bOver ? ">" : aOver < bOver ? "<" : "=";
  if (op === "add") return { lcd: L, aOver, bOver, result: fracAdd(a, b), relation };
  if (op === "subtract") return { lcd: L, aOver, bOver, result: frac(aOver - bOver, L), relation };
  if (op === "multiply") return { lcd: L, aOver, bOver, result: fracMul(a, b), relation };
  return { lcd: L, aOver, bOver, relation };
}

const PARTS = [
  { id: "whole", name: "One whole" },
  { id: "shaded-part", name: "Shaded part" },
  { id: "unit-fraction", name: "Unit fraction" },
  { id: "common-denominator", name: "Common denominator" },
  { id: "result", name: "Result" },
];

const BLUE = PALETTE.blue, RED = PALETTE.red, GREEN = PALETTE.green, VIOLET = PALETTE.violet;

/* ── writing fractions the textbook way: stacked ──────────────────────────────────────────── */

type Tok = { f: Frac; mixed?: boolean } | { t: string };
/** Write tokens left to right from `x`, centred on `y`; stacked fractions. Returns the end x. */
function writeEq(sk: Sketch, x: number, y: number, toks: Tok[], size: number, colour: Ink | Ink[], part?: string): number {
  let at = x;
  toks.forEach((tok, i) => {
    const c = Array.isArray(colour) ? colour[i] ?? colour[colour.length - 1] : colour;
    if ("t" in tok) {
      const w = textW(tok.t, size);
      sk.text({ x: at + w / 2 + 3, y }, tok.t, size, c, part);
      at += w + 6;
      return;
    }
    let { n } = tok.f;
    const { d } = tok.f;
    if (tok.mixed && n >= d && d > 1 && n % d) {
      const whole = String(Math.floor(n / d));
      const w = textW(whole, size * 1.05);
      sk.text({ x: at + w / 2 + 2, y }, whole, size * 1.05, c, part);
      at += w + 3;
      n = n % d;
    }
    if (d === 1) {
      const w = textW(String(n), size * 1.05);
      sk.text({ x: at + w / 2 + 3, y }, String(n), size * 1.05, c, part);
      at += w + 6;
      return;
    }
    const s = size * 0.86;
    const w = Math.max(textW(String(n), s), textW(String(d), s)) + 6;
    sk.text({ x: at + w / 2 + 2, y: y - s * 0.62 }, String(n), s, c, part);
    sk.line([{ x: at + 2, y }, { x: at + w + 2, y }], { stroke: c, width: 2, part }, false);
    sk.text({ x: at + w / 2 + 2, y: y + s * 0.66 }, String(d), s, c, part);
    at += w + 8;
  });
  return at;
}

/* ── one row of wholes ───────────────────────────────────────────────────────────────────── */

type Cell = { c: Pt; whole: number };
type RowOut = { cells: Cell[]; wholeAnchor: Pt; right: number; mid: number; subAnchor?: Pt; xAt: (v: number) => number };

/**
 * `wholes` wholes in a row at y, each cut into `d` parts, the first cells coloured by `fills`
 * (fills[i] colours cell i, counting across wholes). `sub` cuts each part again (dashed) into
 * `sub` pieces — the common-denominator cut.
 */
function drawRow(sk: Sketch, model: "bar" | "area" | "circle", y: number, wholes: number, d: number, fills: Ink[], dims: { w: number; h: number; gap: number }, sub = 1, part?: string): RowOut {
  const cells: Cell[] = [];
  let wholeAnchor: Pt = { x: 0, y };
  let subAnchor: Pt | undefined;
  const totalW = wholes * dims.w + (wholes - 1) * dims.gap;
  for (let k = 0; k < wholes; k++) {
    const x0 = k * (dims.w + dims.gap);
    if (model === "circle") {
      const r = dims.w / 2, c = { x: x0 + r, y: y + r };
      for (let i = 0; i < d; i++) {
        const idx = k * d + i;
        const a0 = -Math.PI / 2 + (i / d) * 2 * Math.PI, a1 = -Math.PI / 2 + ((i + 1) / d) * 2 * Math.PI;
        const pts: Pt[] = [c];
        const steps = Math.max(2, Math.ceil(((a1 - a0) / (2 * Math.PI)) * 64));
        for (let s = 0; s <= steps; s++) pts.push(polar(c, r, a0 + ((a1 - a0) * s) / steps));
        if (fills[idx]) sk.polygon(pts, { fill: fills[idx], opacity: 0.55, stroke: "none", part: "shaded-part" }, false);
        cells.push({ c: polar(c, d === 1 ? 0 : r * 0.6, (a0 + a1) / 2), whole: k });
      }
      if (sub > 1) for (let i = 0; i < d * sub; i++) if (i % sub) sk.line([c, polar(c, r, -Math.PI / 2 + (i / (d * sub)) * 2 * Math.PI)], { stroke: "ink", width: 1.2, dash: "4 4", opacity: 0.8, part: "common-denominator" });
      if (d > 1) for (let i = 0; i < d; i++) sk.line([c, polar(c, r, -Math.PI / 2 + (i / d) * 2 * Math.PI)], { stroke: "ink", width: 2 });
      sk.circle(c, r, { fill: "none", stroke: "ink", width: 2.6, part: k === 0 ? part : undefined });
      if (k === 0) wholeAnchor = polar(c, r, (-3 * Math.PI) / 4);
      if (k === 0 && sub > 1) subAnchor = polar(c, r * 0.8, -Math.PI / 2 + (1 / (d * sub)) * 2 * Math.PI);
    } else {
      const cw = dims.w / d;
      for (let i = 0; i < d; i++) {
        const idx = k * d + i;
        const cx0 = x0 + i * cw;
        if (fills[idx]) sk.polygon([{ x: cx0, y }, { x: cx0 + cw, y }, { x: cx0 + cw, y: y + dims.h }, { x: cx0, y: y + dims.h }], { fill: fills[idx], opacity: 0.55, stroke: "none", part: "shaded-part" }, false);
        cells.push({ c: { x: cx0 + cw / 2, y: y + dims.h / 2 }, whole: k });
      }
      if (sub > 1) {
        if (model === "area") for (let j = 1; j < sub; j++) sk.line([{ x: x0, y: y + (dims.h * j) / sub }, { x: x0 + dims.w, y: y + (dims.h * j) / sub }], { stroke: "ink", width: 1.2, dash: "4 4", opacity: 0.8, part: "common-denominator" });
        else for (let i = 0; i < d * sub; i++) if (i % sub) { const x = x0 + (dims.w * i) / (d * sub); sk.line([{ x, y }, { x, y: y + dims.h }], { stroke: "ink", width: 1.2, dash: "4 4", opacity: 0.8, part: "common-denominator" }); }
        if (k === 0) subAnchor = model === "area" ? { x: x0 + dims.w * 0.5, y: y + dims.h / sub } : { x: x0 + dims.w / (d * sub), y: y + dims.h * 0.82 };
      }
      for (let i = 1; i < d; i++) sk.line([{ x: x0 + i * cw, y }, { x: x0 + i * cw, y: y + dims.h }], { stroke: "ink", width: 2 });
      sk.polygon([{ x: x0, y }, { x: x0 + dims.w, y }, { x: x0 + dims.w, y: y + dims.h }, { x: x0, y: y + dims.h }], { fill: "none", stroke: "ink", width: 2.6, part: k === 0 ? part : undefined });
      if (k === 0) wholeAnchor = { x: x0, y: y + dims.h * 0.5 };
    }
  }
  const xAt = (v: number) => {
    const k = Math.min(wholes - 1, Math.floor(v));
    return k * (dims.w + dims.gap) + (v - k) * dims.w;
  };
  return { cells, wholeAnchor, right: totalW, mid: y + dims.h / 2, subAnchor, xAt };
}

function parseOp(v: unknown, count: number): Op {
  const s = String(v ?? "").toLowerCase();
  if (/mult|times|×|\*|product|of\b/.test(s)) return "multiply";
  if (/sub|minus|−|-|difference|take/.test(s)) return "subtract";
  if (/add|plus|\+|sum/.test(s)) return "add";
  if (/comp|order|greater|less|bigger|>|</.test(s)) return "compare";
  if (/equiv/.test(s)) return "equivalent";
  return count >= 2 ? "compare" : "none";
}
function parseModel(v: unknown): Model {
  const s = String(v ?? "").toLowerCase();
  return /number|line/.test(s) ? "number-line" : /circ|pie/.test(s) ? "circle" : /area|square|grid|rect/.test(s) ? "area" : "bar";
}

export const fractionModel: FigureComponent = {
  name: "fractionModel",
  title: "Fraction models (bar, area square, circle or number line): wholes cut into equal parts and shaded, with equivalent fractions, a common denominator, and comparing, adding, subtracting or multiplying fractions worked and written",
  params: `fractions (one to three fractions, e.g. "3/4", "3/4; 2/3", "1 1/2; 3/4"; denominators 1-24; default "3/4"); model ("bar" default | "area" | "circle" | "number-line"); operation ("compare" default for two fractions | "add" | "subtract" | "multiply" (always drawn as an area model: the overlap of the two shadings) | "equivalent" | "none"); equivalent (a whole number 2-6: also draw the first fraction cut k times finer, e.g. 2 shows 3/4 = 6/8). The code finds the common denominator and the result — never give them.`,
  match: /\bfractions?\b.*\b(bar|model|strip|wall|pie|circle|number line|shad\w+|diagram|area model)\b|\b(fraction (bars?|strips?|walls?|circles?|models?))\b|\bequivalent fractions?\b|\b(common|lowest common|least common) denominators?\b|\b(add|adding|subtract\w*|multiply\w*|compar\w*) (two |the )?fractions\b|\bunit fractions?\b/i,
  parts: PARTS,
  build(params: FigureParams) {
    const fracs = list(params.fractions ?? params.fraction, /[;,]|\band\b|\bvs\.?\b/).map(parseFraction).filter((f): f is Frac => Boolean(f)).slice(0, 3);
    if (!fracs.length) fracs.push({ n: 3, d: 4 });
    let op = parseOp(params.operation, fracs.length);
    if (fracs.length < 2 && op !== "none" && op !== "equivalent") op = "none";
    let model = parseModel(params.model);
    const k = Math.round(num(params.equivalent, op === "equivalent" ? 2 : 0, 0, 6));
    if (op === "multiply") return multiplyArea(fracs[0], fracs[1]);
    if (model === "number-line") return numberLine(fracs, op, k);
    if (model === "area" && fracs.some((f) => f.n > f.d)) model = "bar";
    const a = fracs[0], b = fracs[1];
    const sk = new Sketch();
    const M = b ? fractionMaths(a, b, op) : undefined;
    const L = M && M.lcd <= 48 ? M.lcd : undefined;
    const resultF = M?.result;
    const wholesOf = (f: Frac) => Math.max(1, Math.ceil(f.n / f.d));
    const resWholes = resultF && op === "add" ? wholesOf(resultF) : 1;
    const maxW = Math.max(...fracs.map(wholesOf), resWholes);
    const gap = 16;
    const dims = model === "circle"
      ? { w: Math.min(124, (440 - (maxW - 1) * gap) / maxW), h: 0, gap }
      : model === "area" ? { w: Math.min(150, (440 - (maxW - 1) * gap) / maxW), h: 0, gap } : { w: Math.min(340, (440 - (maxW - 1) * gap) / maxW), h: 46, gap };
    if (model !== "bar") dims.h = dims.w;
    const rowH = dims.h + (model === "bar" ? 34 : 30);
    const colours = [BLUE, RED, VIOLET];
    const fillsFor = (f: Frac, c: Ink) => Array.from({ length: f.n }, () => c);
    const rows: RowOut[] = [];
    let y = 0;
    let labelX = 0;
    const subFor = (f: Frac) => (L && (op === "compare" || op === "add" || op === "subtract") && L !== f.d ? L / f.d : 1);
    // One row per fraction.
    fracs.forEach((f, i) => {
      const r = drawRow(sk, model, y, wholesOf(f), f.d, fillsFor(f, colours[i]), dims, subFor(f), i === 0 ? "whole" : undefined);
      rows.push(r);
      labelX = Math.max(labelX, r.right);
      y += rowH;
    });
    // Equivalent fraction row.
    let eqRow: RowOut | undefined;
    if (k >= 2 && fracs.length === 1) {
      const e = { n: a.n * k, d: a.d * k };
      if (e.d <= 48) {
        eqRow = drawRow(sk, model, y, wholesOf(e), e.d, fillsFor(e, GREEN), dims, 1);
        y += rowH;
      }
    }
    // Result row for add / subtract, counted in common-denominator parts.
    let resRow: RowOut | undefined;
    if (M && L && (op === "add" || op === "subtract") && M.result && M.result.n >= 0) {
      const fills: Ink[] = op === "add" ? [...Array.from({ length: M.aOver }, () => BLUE as Ink), ...Array.from({ length: M.bOver }, () => RED as Ink)] : Array.from({ length: Math.max(0, M.aOver - M.bOver) }, () => GREEN as Ink);
      y += 10;
      resRow = drawRow(sk, model, y, op === "add" ? resWholes : 1, L, fills, dims, 1);
      y += rowH;
    }

    // The fraction beside each row (with its common-denominator form), then the worked line.
    const lx = labelX + 26;
    fracs.forEach((f, i) => {
      const toks: Tok[] = [{ f }];
      if (subFor(f) > 1 && L) toks.push({ t: "=" }, { f: { n: (f.n * L) / f.d, d: L } });
      writeEq(sk, lx, rows[i].mid, toks, 26, colours[i]);
    });
    if (eqRow) writeEq(sk, lx, eqRow.mid, [{ t: "=" }, { f: { n: a.n * k, d: a.d * k } }], 26, GREEN, "result");
    let resultAnchor: Pt | undefined, resultName = "";
    if (M && b) {
      const eqY = y + 16;
      if (op === "compare") {
        const eqEnd = writeEq(sk, 0, eqY, [{ f: a }, { t: M.relation! }, { f: b }], 28, [BLUE, "ink", RED], "result");
        // Guides at each shaded end: the gap between them is the difference.
        const xa = rows[0].xAt(a.n / a.d), xb = rows[1].xAt(b.n / b.d);
        if (model !== "circle") for (const x of [xa, xb]) sk.line([{ x, y: rows[0].mid - dims.h / 2 - 8 }, { x, y: rows[1].mid + dims.h / 2 + 8 }], { stroke: x === xa ? BLUE : RED, width: 1.6, dash: "5 4", opacity: 0.9, part: "result" }, false);
        const diff = frac(Math.abs(M.aOver - M.bOver), M.lcd);
        resultAnchor = { x: (xa + xb) / 2, y: M.relation === ">" ? rows[0].mid : rows[1].mid };
        if (M.relation === "=") resultAnchor = { x: xa, y: (rows[0].mid + rows[1].mid) / 2 };
        if (model === "circle") resultAnchor = { x: eqEnd + 6, y: eqY };
        resultName = M.relation === "=" ? `${fracStr(a)} = ${fracStr(b)}` : `${fracStr(a)} ${M.relation} ${fracStr(b)} (by ${fracStr(diff)})`;
      } else if ((op === "add" || op === "subtract") && M.result) {
        const sign = op === "add" ? "+" : "−";
        const toks: Tok[] = L && (L !== a.d || L !== b.d) ? [{ f: { n: M.aOver, d: M.lcd } }, { t: sign }, { f: { n: M.bOver, d: M.lcd } }, { t: "=" }] : [];
        const raw = { n: op === "add" ? M.aOver + M.bOver : M.aOver - M.bOver, d: M.lcd };
        if (raw.n < 0) toks.push({ t: "−" }, { f: { n: -raw.n, d: raw.d } });
        else {
          toks.push({ f: raw });
          const red = frac(raw.n, raw.d);
          if (red.d !== raw.d) toks.push({ t: "=" }, { f: red });
          if (red.n > red.d && red.d > 1 && red.n % red.d) toks.push({ t: "=" }, { f: red, mixed: true });
        }
        writeEq(sk, 0, eqY, toks, 26, "ink", "result");
        if (resRow) {
          const cnt = op === "add" ? M.aOver + M.bOver : M.aOver - M.bOver;
          const cell = resRow.cells[Math.max(0, Math.min(resRow.cells.length - 1, cnt - 1))];
          resultAnchor = cell?.c;
        }
        resultName = `${op === "add" ? "Sum" : "Difference"} ${fracStr(frac(raw.n, raw.d))}`;
      }
    }

    // Anchors.
    const r0 = rows[0];
    sk.part("whole", "One whole", r0.wholeAnchor);
    if (a.n > 0) sk.part("shaded-part", `Shaded part ${fracStr(a)}`.replace(/(\d+)\/1\b/, "$1"), r0.cells[Math.min(a.n, r0.cells.length) - 1].c);
    if (a.d > 1) {
      const unshaded = a.n < a.d ? r0.cells[a.d - 1] : r0.cells[0];
      sk.part("unit-fraction", `Unit fraction 1/${a.d}`, unshaded.c);
    }
    const subRow = rows.find((r) => r.subAnchor);
    if (subRow?.subAnchor && L) sk.part("common-denominator", `Common denominator ${L}`, subRow.subAnchor);
    if (eqRow) sk.part("result", `Equivalent ${fracStr({ n: a.n * k, d: a.d * k })}`, eqRow.cells[Math.max(0, a.n * k - 1)].c);
    else if (resultAnchor) sk.part("result", fitText(resultName, 34), resultAnchor);
    return sk.finish(14);
  },
};

/* ── multiplication: the area model ─────────────────────────────────────────────────────── */

function multiplyArea(aIn: Frac, bIn: Frac): ReturnType<FigureComponent["build"]> {
  const a = { n: Math.min(aIn.n, aIn.d), d: aIn.d }, b = { n: Math.min(bIn.n, bIn.d), d: bIn.d };
  const S = 260;
  const sk = new Sketch();
  const cw = S / a.d, ch = S / b.d;
  // a: columns shaded blue; b: rows shaded red (from the bottom); the overlap violet.
  sk.polygon([{ x: 0, y: 0 }, { x: a.n * cw, y: 0 }, { x: a.n * cw, y: S }, { x: 0, y: S }], { fill: BLUE, opacity: 0.3, stroke: "none", part: "shaded-part" }, false);
  sk.polygon([{ x: 0, y: S - b.n * ch }, { x: S, y: S - b.n * ch }, { x: S, y: S }, { x: 0, y: S }], { fill: RED, opacity: 0.25, stroke: "none", part: "shaded-part" }, false);
  sk.polygon([{ x: 0, y: S - b.n * ch }, { x: a.n * cw, y: S - b.n * ch }, { x: a.n * cw, y: S }, { x: 0, y: S }], { fill: VIOLET, opacity: 0.5, stroke: VIOLET, width: 3, part: "result" });
  for (let i = 1; i < a.d; i++) sk.line([{ x: i * cw, y: 0 }, { x: i * cw, y: S }], { stroke: "ink", width: 1.6, part: "common-denominator" });
  for (let j = 1; j < b.d; j++) sk.line([{ x: 0, y: j * ch }, { x: S, y: j * ch }], { stroke: "ink", width: 1.6, part: "common-denominator" });
  sk.polygon([{ x: 0, y: 0 }, { x: S, y: 0 }, { x: S, y: S }, { x: 0, y: S }], { fill: "none", stroke: "ink", width: 2.8, part: "whole" });
  // The two factors along the edges: a across the top, b up the left side.
  if (a.n > 0) arrowSpan(sk, { x: 0, y: -16 }, { x: a.n * cw, y: -16 }, BLUE);
  writeEq(sk, (a.n * cw) / 2 - 18, -42, [{ f: a }], 24, BLUE);
  if (b.n > 0) arrowSpan(sk, { x: -16, y: S }, { x: -16, y: S - b.n * ch }, RED);
  writeEq(sk, -78, S - (b.n * ch) / 2, [{ f: b }], 24, RED);
  const p = fracMul(a, b), raw = { n: a.n * b.n, d: a.d * b.d };
  const toks: Tok[] = [{ f: a }, { t: "×" }, { f: b }, { t: "=" }, { f: raw }];
  if (p.d !== raw.d) toks.push({ t: "=" }, { f: p });
  writeEq(sk, 0, S + 40, toks, 26, ["#2563eb", "ink", "#dc2626", "ink", "#7c3aed", "ink", "#7c3aed"], undefined);
  sk.part("whole", "One whole (unit square)", { x: S, y: S * 0.15 });
  if (a.n > 0) sk.part("shaded-part", `Shaded ${fracStr(a)} (columns)`, { x: (a.n * cw) / 2, y: b.n < b.d ? (S - b.n * ch) / 2 : S / 2 });
  sk.part("unit-fraction", `One cell = 1/${raw.d}`, { x: S - cw / 2, y: ch / 2 });
  if (a.d > 1 || b.d > 1) sk.part("common-denominator", `${a.d} × ${b.d} = ${raw.d} equal parts`, { x: a.d > 1 ? cw * Math.max(1, a.n) : S / 2, y: b.d > 1 ? ch * 0.5 : S / 2 });
  if (raw.n > 0) sk.part("result", `Product ${fracStr(p)}`, { x: (a.n * cw) / 2, y: S - (b.n * ch) / 2 });
  return sk.finish(14);
}
function arrowSpan(sk: Sketch, p: Pt, q: Pt, c: Ink) {
  arrow(sk, p, q, c, 2, undefined, 9);
  arrow(sk, q, p, c, 2, undefined, 9);
}

/* ── the number line ────────────────────────────────────────────────────────────────────── */

function numberLine(fracs: Frac[], op: Op, k: number): ReturnType<FigureComponent["build"]> {
  const a = fracs[0], b = fracs[1];
  const M = b ? fractionMaths(a, b, op) : undefined;
  const L = M ? (M.lcd <= 48 ? M.lcd : Math.max(a.d, b.d)) : k >= 2 ? a.d * k : a.d;
  const sum = M && op === "add" ? (M.aOver + M.bOver) / M.lcd : 0;
  const top = Math.max(1, Math.ceil(Math.max(...fracs.map((f) => f.n / f.d), sum) - 1e-9));
  const W = Math.min(520, 220 * top + 80);
  const X = (v: number) => (v / top) * W;
  const sk = new Sketch();
  const y = 0;
  sk.line([{ x: -12, y }, { x: W + 16, y }], { stroke: "ink", width: 2.4, part: "whole" });
  // Ticks: every 1/L (minor, the common denominator), every 1/d of the first fraction, and the wholes.
  for (let i = 0; i <= top * L; i++) {
    const v = i / L, x = X(v);
    const whole = i % L === 0;
    const main = (i * a.d) % L === 0;
    const h = whole ? 13 : main ? 9 : 6;
    sk.line([{ x, y: y - h }, { x, y: y + h }], { stroke: "ink", width: whole ? 2.4 : main ? 1.8 : 1.2, part: !main ? "common-denominator" : undefined }, false);
    if (whole) sk.text({ x, y: y + 30 }, String(i / L), 22, "ink");
  }
  const jumps: Array<{ from: number; to: number; c: Ink; f: Frac; above: boolean }> = [];
  if (!b) jumps.push({ from: 0, to: a.n / a.d, c: BLUE, f: a, above: true });
  else if (op === "add") jumps.push({ from: 0, to: a.n / a.d, c: BLUE, f: a, above: true }, { from: a.n / a.d, to: a.n / a.d + b.n / b.d, c: RED, f: b, above: true });
  else if (op === "subtract") jumps.push({ from: 0, to: a.n / a.d, c: BLUE, f: a, above: true }, { from: a.n / a.d, to: Math.max(0, a.n / a.d - b.n / b.d), c: RED, f: b, above: false });
  else jumps.push({ from: 0, to: a.n / a.d, c: BLUE, f: a, above: true }, { from: 0, to: b.n / b.d, c: RED, f: b, above: false });
  const tips: Pt[] = [];
  for (const j of jumps) {
    const x0 = X(j.from), x1 = X(j.to), h = Math.min(70, 26 + Math.abs(x1 - x0) * 0.22) * (j.above ? -1 : 1);
    const pts: Pt[] = [];
    for (let i = 0; i <= 30; i++) {
      const t = i / 30;
      pts.push({ x: x0 + (x1 - x0) * t, y: y + h * 4 * t * (1 - t) + (j.above ? -3 : 3) });
    }
    sk.line(pts.slice(0, -2), { stroke: j.c, width: 2.6, part: "shaded-part" });
    arrow(sk, pts[pts.length - 4], pts[pts.length - 1], j.c, 2.6, "shaded-part", 10);
    sk.circle({ x: x1, y }, 6, { fill: j.c, stroke: j.c, width: 1, part: "shaded-part" }, false);
    writeEq(sk, (x0 + x1) / 2 - 14, y + h * 1.0 + (j.above ? -22 : 26), [{ f: j.f }], 22, j.c);
    tips.push({ x: x1, y });
  }
  let resultAnchor: Pt | undefined, resultName = "";
  if (M && b) {
    const eqY = 120;
    if (op === "compare") {
      writeEq(sk, 0, eqY, [{ f: a }, { t: "=" }, { f: { n: M.aOver, d: M.lcd } }, { t: M.relation! }, { f: { n: M.bOver, d: M.lcd } }, { t: "=" }, { f: b }], 24, [BLUE, "ink", BLUE, "ink", RED, "ink", RED], "result");
      resultAnchor = { x: X(Math.max(a.n / a.d, b.n / b.d)), y };
      resultName = `${fracStr(a)} ${M.relation} ${fracStr(b)}`;
    } else if (M.result) {
      const raw = { n: op === "add" ? M.aOver + M.bOver : M.aOver - M.bOver, d: M.lcd };
      const toks: Tok[] = [{ f: { n: M.aOver, d: M.lcd } }, { t: op === "add" ? "+" : "−" }, { f: { n: M.bOver, d: M.lcd } }, { t: "=" }];
      if (raw.n < 0) toks.push({ t: "−" }, { f: { n: -raw.n, d: raw.d } });
      else {
        toks.push({ f: raw });
        const red = frac(raw.n, raw.d);
        if (red.d !== raw.d) toks.push({ t: "=" }, { f: red });
      }
      writeEq(sk, 0, eqY, toks, 24, "ink", "result");
      const v = Math.max(0, raw.n / raw.d);
      sk.circle({ x: X(v), y }, 8, { fill: "none", stroke: GREEN, width: 3, part: "result" }, false);
      resultAnchor = { x: X(v), y };
      resultName = `${op === "add" ? "Sum" : "Difference"} ${fracStr(frac(raw.n, raw.d))}`;
    }
  } else if (k >= 2) {
    writeEq(sk, 0, 110, [{ f: a }, { t: "=" }, { f: { n: a.n * k, d: a.d * k } }], 24, [BLUE, "ink", GREEN], "result");
    resultAnchor = { x: X(a.n / a.d), y: y + 8 };
    resultName = `Equivalent ${fracStr({ n: a.n * k, d: a.d * k })}`;
  }
  sk.part("whole", "One whole (0 to 1)", { x: X(1), y });
  if (a.n > 0) sk.part("shaded-part", `${fracStr(a)} along the line`, tips[0]);
  if (a.d > 1) sk.part("unit-fraction", `Unit fraction 1/${a.d}`, { x: X(1 / a.d / 2), y });
  if (L !== a.d) sk.part("common-denominator", `Common denominator ${L}`, { x: X((L / a.d > 1 ? 1 : 0.5) / L), y: y + 6 });
  if (resultAnchor) sk.part("result", fitText(resultName, 34), resultAnchor);
  return sk.finish(14);
}

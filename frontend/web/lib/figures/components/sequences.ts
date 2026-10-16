import type { FigureComponent, FigureParams, Ink, Pt } from "../types";
import { PALETTE, Sketch, fmt, num, optNum, str, textW } from "./mathsKit";
import { ON_FILL } from "./statsKit";

/**
 * AN ARITHMETIC OR GEOMETRIC SEQUENCE, COMPUTED. The terms stand in a row of boxes, each with its
 * position (u₁, u₂, …) written small above it; a curved jump arrow from each term to the next carries
 * the common difference (+4) or ratio (×3); the nth-term formula — worked out from a and d (or r),
 * with the simplified linear form for an arithmetic sequence — sits in a card underneath. Every
 * value is computed here; the board writer only gives a and d or r.
 */

type Kind = "arithmetic" | "geometric";

function kindOf(v: unknown, params: FigureParams): Kind {
  const s = String(v ?? "").toLowerCase();
  if (/geom|multipl|ratio|\br\b/.test(s)) return "geometric";
  if (/arith|differ|linear|\bd\b/.test(s)) return "arithmetic";
  // No type given: a ratio and no difference means geometric.
  if (optNum(params.r ?? params.ratio) !== undefined && optNum(params.d ?? params.difference) === undefined) return "geometric";
  return "arithmetic";
}

export function sequenceTerms(kind: Kind, a: number, step: number, n: number): number[] {
  return Array.from({ length: n }, (_, i) => (kind === "arithmetic" ? a + i * step : a * step ** i));
}

const SUP: Record<string, string> = { "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴", "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹", "-": "⁻" };

/** A term as a textbook writes it: 19, −5, 0.25, 1.46 × 10⁷ (very large or very small values). */
export function termText(v: number): string {
  if (!Number.isFinite(v)) return "?";
  if (v === 0) return "0";
  const abs = Math.abs(v);
  if (abs >= 1e6 || abs < 1e-3) {
    let e = Math.floor(Math.log10(abs));
    let m = v / 10 ** e;
    if (Math.abs(Number(m.toFixed(2))) >= 10) (m /= 10), (e += 1);
    return `${fmt(m, 2)}×10${String(e).split("").map((c) => SUP[c] ?? c).join("")}`;
  }
  const t = fmt(v, 3);
  return t.length > 8 ? fmt(Number(v.toPrecision(4)), 6) : t;
}

export function nthTerm(kind: Kind, a: number, step: number): string {
  const f = (n: number) => fmt(n, 4);
  if (kind === "arithmetic") {
    if (step === 0) return `uₙ = ${f(a)}`;
    const coeff = Math.abs(step) === 1 ? "" : f(Math.abs(step));
    const general = a === 0 ? `${step < 0 ? "−" : ""}${coeff}(n − 1)` : `${f(a)} ${step < 0 ? "−" : "+"} ${coeff}(n − 1)`;
    const c = Number((a - step).toFixed(6));
    const dn = step === 1 ? "n" : step === -1 ? "−n" : `${f(step)}n`;
    const simple = `${dn}${c > 0 ? ` + ${f(c)}` : c < 0 ? ` − ${f(-c)}` : ""}`;
    return general === simple ? `uₙ = ${simple}` : `uₙ = ${general} = ${simple}`;
  }
  if (step === 1) return `uₙ = ${f(a)}`;
  const r = step < 0 ? `(${f(step)})` : f(step);
  return a === 1 ? `uₙ = ${r}ⁿ⁻¹` : `uₙ = ${f(a)} × ${r}ⁿ⁻¹`;
}

/**
 * A formula as runs of normal, subscript and superscript text ("uₙ = 2 × 3ⁿ⁻¹" → u, n↓, " = 2 × 3",
 * n−1↑): the board font has no sub/superscript glyphs, and the fallback ones are too small to read.
 */
const SUB_CH: Record<string, string> = { "ₙ": "n", "₀": "0", "₁": "1", "₂": "2", "₃": "3", "₄": "4", "₅": "5", "₆": "6", "₇": "7", "₈": "8", "₉": "9" };
const SUP_CH: Record<string, string> = { "ⁿ": "n", "⁻": "−", "⁺": "+", "⁰": "0", "¹": "1", "²": "2", "³": "3", "⁴": "4", "⁵": "5", "⁶": "6", "⁷": "7", "⁸": "8", "⁹": "9" };
export function mathRuns(text: string, size: number): Array<{ text: string; size: number; dy: number; w: number }> {
  const small = Math.max(14, Math.round(size * 0.66));
  const out: Array<{ text: string; size: number; dy: number; w: number; kind: number }> = [];
  for (const ch of text) {
    const kind = SUB_CH[ch] ? 1 : SUP_CH[ch] ? 2 : 0;
    const c = kind === 1 ? SUB_CH[ch] : kind === 2 ? SUP_CH[ch] : ch;
    const last = out[out.length - 1];
    if (last && last.kind === kind) last.text += c;
    else out.push({ text: c, size: kind ? small : size, dy: kind === 1 ? size * 0.28 : kind === 2 ? -size * 0.36 : 0, w: 0, kind });
  }
  return out.map((r) => ({ text: r.text, size: r.size, dy: r.dy, w: textW(r.text, r.size) + (r.kind ? 1 : 0) }));
}

const SUB_DIGIT = ["₀", "₁", "₂", "₃", "₄", "₅", "₆", "₇", "₈", "₉"];

/**
 * Write runs centred on `c`. Widths are estimates, so each junction where a sub/superscript meets
 * normal text is pinned exactly: the normal run before it ends there ("end"), the small run starts
 * there ("start"), and a normal run after one starts where the small run was estimated to end
 * (usually at a space, where an error does not show). `pinned` records the op index → anchor.
 */
function writeRuns(sk: Sketch, runs: ReturnType<typeof mathRuns>, c: Pt, fill: Ink, part: string | undefined, pinned: Map<number, "start" | "end">) {
  const total = runs.reduce((t, r) => t + r.w, 0);
  let x = c.x - total / 2;
  runs.forEach((r, i) => {
    const small = r.size < (runs.find((q) => q.dy === 0)?.size ?? r.size);
    const nextSmall = i + 1 < runs.length && runs[i + 1].size < r.size;
    const anchor: "start" | "end" | "middle" = small ? "start" : nextSmall ? "end" : i > 0 ? "start" : "middle";
    const at = anchor === "start" ? x : anchor === "end" ? x + r.w : x + r.w / 2;
    if (anchor !== "middle") pinned.set(sk.ops.length, anchor);
    sk.text({ x: at, y: c.y + r.dy }, r.text, r.size, fill, part);
    x += r.w;
  });
}

const ORDINAL = ["First", "Second", "Third", "Fourth", "Fifth", "Sixth", "Seventh"];
const BOX: `#${string}` = PALETTE.blue;
const STEP: `#${string}` = PALETTE.amber;
const VALUE = 22, POS = 18, STEP_SIZE = 17, FORMULA = 22;

export const sequences: FigureComponent = {
  name: "sequences",
  title: "A sequence of terms in boxes, the common difference or ratio between them, and the nth-term formula computed from a and d (or r)",
  params: `type ("arithmetic" default | "geometric"); a (first term, default 3); d (common difference, arithmetic, default 4); r (common ratio, geometric, default 2); terms (how many to draw, 3–7, default 5); formula (optional override of the nth-term line).`,
  match: /\b(arithmetic|geometric) sequences?\b|\bnth[- ]terms?\b|\b(common (difference|ratio)|first term)\b|\bu\s*ₙ\b|\bu_n\b|\bsequences?\b(?=[\s\S]{0,160}\b(term|nth|common difference|common ratio|position-to-term)\b)|\bposition[- ]to[- ]term\b|\bterm[- ]to[- ]term\b/i,
  parts: [
    { id: "first-term", name: "First term (a)" },
    { id: "second-term", name: "Second term" },
    { id: "third-term", name: "Third term" },
    { id: "last-shown", name: "Last term shown" },
    { id: "step", name: "Common difference or ratio" },
    { id: "nth-term", name: "nth term formula" },
  ],
  build(params: FigureParams) {
    const kind = kindOf(params.type ?? params.kind ?? params.sequence, params);
    const a = num(params.a ?? params.first, 3, -1e6, 1e6);
    const step = kind === "geometric" ? num(params.r ?? params.ratio ?? params.d, 2, -1e6, 1e6) || 2 : num(params.d ?? params.difference ?? params.r, 4, -1e6, 1e6);
    const asked = Math.round(num(params.terms ?? params.n, 5, 3, 7));
    const all = sequenceTerms(kind, a, step, asked).map(termText);
    const stepText = kind === "arithmetic" ? (step < 0 ? `−${fmt(-step, 4)}` : `+${fmt(step, 4)}`) : step < 0 ? `×(${fmt(step, 4)})` : `×${fmt(step, 4)}`;
    const formula = str(params.formula, nthTerm(kind, a, step), 40);

    // Box and gap sizes from the widest term and the step's text; fewer terms (never under 3) when
    // the row would not fit the figure's width.
    const boxH = 56;
    const gap = Math.max(38, textW(stepText, STEP_SIZE) + 10);
    const widthFor = (k: number, size: number) => {
      const bw = Math.max(68, Math.max(...all.slice(0, k).map((t) => textW(t, size))) + 22);
      return { bw, total: k * bw + (k - 1) * gap };
    };
    let n = asked;
    const valueSize = widthFor(n, VALUE).total > 712 ? 20 : VALUE;
    while (n > 3 && widthFor(n, valueSize).total > 712) n--;
    const { bw: boxW, total } = widthFor(n, valueSize);
    const values = all.slice(0, n);

    const sk = new Sketch();
    const pinned = new Map<number, "start" | "end">();
    const top = 0, bottom = boxH;
    const ids = (i: number) => (i === 0 ? "first-term" : i === 1 ? "second-term" : i === 2 && n > 3 ? "third-term" : i === n - 1 ? "last-shown" : undefined);
    // With three terms the third is also the last shown: its box is "last-shown", its number "third-term".
    const textId = (i: number) => (i === 2 ? "third-term" : ids(i));
    const left = (i: number) => i * (boxW + gap);
    for (let i = 0; i < n; i++) {
      const x = left(i), id = ids(i);
      const part = id ? { part: id } : {};
      sk.polygon([{ x, y: top }, { x: x + boxW, y: top }, { x: x + boxW, y: bottom }, { x, y: bottom }], { fill: "none", stroke: BOX, width: 2.4, ...part });
      sk.text({ x: x + boxW / 2, y: (top + bottom) / 2 }, values[i], valueSize, "ink", textId(i));
      // Its position, small, above the box.
      // (A real subscript: the digit smaller and lower, as the board font has no subscript digits.)
      writeRuns(sk, mathRuns(`u${String(i + 1).split("").map((d) => SUB_DIGIT[Number(d)]).join("")}`, POS), { x: x + boxW / 2, y: top - 16 }, "muted", textId(i), pinned);
    }

    // Jump arrows from each term to the next, the step written over each.
    const rise = 30, inset = 12;
    let firstPeak: Pt = { x: 0, y: 0 };
    for (let i = 0; i < n - 1; i++) {
      const x0 = left(i) + boxW - inset, x1 = left(i + 1) + inset, yb = top - 3;
      const pts: Pt[] = [];
      for (let k = 0; k <= 24; k++) {
        const s = k / 24;
        pts.push({ x: x0 + (x1 - x0) * s, y: yb - rise * Math.sin(Math.PI * s) });
      }
      sk.line(pts, { stroke: STEP, width: 2.2, part: "step" });
      // Arrowhead along the curve's end tangent.
      const tip = pts[pts.length - 1];
      const tx = x1 - x0, ty = rise * Math.PI;
      const L = Math.hypot(tx, ty), ux = tx / L, uy = ty / L, hd = 10;
      const base = { x: tip.x - ux * hd, y: tip.y - uy * hd };
      sk.polygon([tip, { x: base.x - uy * hd * 0.45, y: base.y + ux * hd * 0.45 }, { x: base.x + uy * hd * 0.45, y: base.y - ux * hd * 0.45 }], { fill: STEP, stroke: STEP, width: 1, part: "step" });
      const peak = { x: (x0 + x1) / 2, y: yb - rise };
      if (i === 0) firstPeak = peak;
      sk.text({ x: peak.x, y: peak.y - 17 }, stepText, STEP_SIZE, STEP, "step");
    }

    // The nth-term formula in a card under the row, room left between them for leaders.
    const runs = mathRuns(formula, FORMULA);
    const runsW = runs.reduce((t, r) => t + r.w, 0);
    const fw = Math.max(240, runsW + 52), fh = 50;
    const fx = (total - fw) / 2, fy = bottom + 74;
    sk.polygon([{ x: fx, y: fy }, { x: fx + fw, y: fy }, { x: fx + fw, y: fy + fh }, { x: fx, y: fy + fh }], { fill: "#eff6ff", stroke: BOX, width: 2, part: "nth-term" });
    writeRuns(sk, runs, { x: fx + fw / 2, y: fy + fh / 2 }, ON_FILL, "nth-term", pinned);

    // Anchors on box edges (never on a number), the arrow's crest and the card's edge.
    const mid = (top + bottom) / 2;
    sk.part("first-term", "First term (a)", { x: left(0), y: mid });
    sk.part("second-term", "Second term", { x: left(1) + boxW / 2, y: bottom });
    sk.part("third-term", "Third term", { x: left(2) + boxW / 2, y: bottom });
    sk.part("last-shown", n === 3 ? "Last term shown" : `${ORDINAL[n - 1]} term`, { x: left(n - 1) + boxW, y: mid });
    sk.part("step", kind === "arithmetic" ? "Common difference (d)" : "Common ratio (r)", firstPeak);
    sk.part("nth-term", "nth term formula", { x: fx + fw, y: fy + fh / 2 });
    const drawing = sk.finish(16, { w: 560, h: 260 });
    // Texts pinned to a sub/superscript junction keep their exact edge there (Sketch writes centred text).
    for (const [i, anchor] of pinned) {
      const sh = drawing.shapes[i];
      if (sh && sh.t === "text") sh.anchor = anchor;
    }
    return drawing;
  },
};

import type { FigureComponent, FigureParams, Pt } from "../types";
import { PALETTE, Sketch, fmt, num, str } from "./mathsKit";

/**
 * An arithmetic or geometric sequence as a row of terms, the common difference or ratio marked
 * between them, and the nth-term formula the code computes from a, d/r.
 */

type Kind = "arithmetic" | "geometric";

function kindOf(v: unknown): Kind {
  const s = String(v ?? "").toLowerCase();
  if (/geom|multipl|ratio|\br\b/.test(s)) return "geometric";
  return "arithmetic";
}

export function sequenceTerms(kind: Kind, a: number, step: number, n: number): number[] {
  return Array.from({ length: n }, (_, i) => (kind === "arithmetic" ? a + i * step : a * step ** i));
}

export function nthTerm(kind: Kind, a: number, step: number): string {
  if (kind === "arithmetic") {
    const d = fmt(step, 4).replace("-", "−");
    if (step === 0) return `uₙ = ${fmt(a, 4)}`;
    const first = a === 0 ? "" : `${fmt(a, 4)} ${step < 0 ? "−" : "+"} `;
    const coeff = Math.abs(step) === 1 ? "" : fmt(Math.abs(step), 4);
    return `uₙ = ${first}${step < 0 && a === 0 ? "−" : ""}${coeff}(n − 1)`.replace(/\+ −/g, "− ");
  }
  if (step === 1) return `uₙ = ${fmt(a, 4)}`;
  return `uₙ = ${fmt(a, 4)} × ${fmt(step, 4)}ⁿ⁻¹`;
}

export const sequences: FigureComponent = {
  name: "sequences",
  title: "A sequence of terms in boxes, the common difference or ratio between them, and the nth-term formula computed from a and d (or r)",
  params: `type ("arithmetic" default | "geometric"); a (first term, default 3); d (common difference, arithmetic, default 4); r (common ratio, geometric, default 2); terms (how many to draw, 3–7, default 5); formula (optional override of the nth-term line).`,
  match: /\b(arithmetic|geometric) sequences?\b|\bnth[- ]terms?\b|\b(common (difference|ratio)|first term)\b|\bu\s*ₙ\b|\bu_n\b|\bsequences?\b(?=[\s\S]{0,160}\b(term|nth|common difference|common ratio|position-to-term)\b)|\bposition[- ]to[- ]term\b|\bterm[- ]to[- ]term\b/i,
  parts: [
    { id: "first-term", name: "First term u₁" },
    { id: "second-term", name: "Second term u₂" },
    { id: "third-term", name: "Third term u₃" },
    { id: "last-shown", name: "Last shown term" },
    { id: "step", name: "Common difference or ratio" },
    { id: "nth-term", name: "nth term formula" },
  ],
  build(params: FigureParams) {
    const kind = kindOf(params.type ?? params.kind ?? params.sequence);
    const a = num(params.a ?? params.first, 3, -1e6, 1e6);
    const step = kind === "geometric" ? num(params.r ?? params.ratio ?? params.d, 2, -1e6, 1e6) || 2 : num(params.d ?? params.difference ?? params.r, 4, -1e6, 1e6);
    const n = Math.round(num(params.terms ?? params.n, 5, 3, 7));
    const values = sequenceTerms(kind, a, step, n);
    const formula = str(params.formula, nthTerm(kind, a, step), 40);
    const sk = new Sketch();
    const boxW = 86, boxH = 56, gap = 38, y = 70;
    const total = n * boxW + (n - 1) * gap;
    const x0 = 20;
    const boxes: Pt[] = [];
    for (let i = 0; i < n; i++) {
      const x = x0 + i * (boxW + gap);
      const id = i === 0 ? "first-term" : i === 1 ? "second-term" : i === 2 ? "third-term" : i === n - 1 ? "last-shown" : undefined;
      sk.polygon([{ x, y }, { x: x + boxW, y }, { x: x + boxW, y: y + boxH }, { x, y: y + boxH }], { fill: "paper", stroke: PALETTE.blue, width: 2.4, ...(id ? { part: id } : {}) });
      sk.text({ x: x + boxW / 2, y: y + 24 }, `u${i + 1}`, 13, "muted", id);
      sk.text({ x: x + boxW / 2, y: y + 44 }, fmt(values[i], 4), 20, "ink", id);
      boxes.push({ x: x + boxW / 2, y: y + boxH / 2 });
    }
    for (let i = 0; i < n - 1; i++) {
      const mid = (boxes[i].x + boxes[i + 1].x) / 2;
      sk.line([{ x: boxes[i].x + boxW / 2 - 4, y: y + boxH / 2 }, { x: boxes[i + 1].x - boxW / 2 + 4, y: y + boxH / 2 }], { stroke: PALETTE.amber, width: 2, part: "step" }, false);
      const label = kind === "arithmetic" ? (step >= 0 ? `+ ${fmt(step, 4)}` : `− ${fmt(Math.abs(step), 4)}`) : `× ${fmt(step, 4)}`;
      sk.text({ x: mid, y: y - 8 }, label, 14, PALETTE.amber, "step");
    }
    sk.polygon([{ x: x0, y: y + 92 }, { x: x0 + Math.max(total, 280), y: y + 92 }, { x: x0 + Math.max(total, 280), y: y + 148 }, { x: x0, y: y + 148 }], { fill: "#eff6ff", stroke: PALETTE.blue, width: 2, part: "nth-term" });
    sk.text({ x: x0 + Math.max(total, 280) / 2, y: y + 126 }, formula, 22, PALETTE.blue, "nth-term");
    sk.part("first-term", "First term u₁", boxes[0]);
    sk.part("second-term", "Second term u₂", boxes[1] ?? boxes[0]);
    sk.part("third-term", "Third term u₃", boxes[2] ?? boxes[Math.min(1, boxes.length - 1)]);
    sk.part("last-shown", `Term u${n}`, boxes[n - 1]);
    sk.part("step", kind === "arithmetic" ? `Common difference ${fmt(step, 4)}` : `Common ratio ${fmt(step, 4)}`, { x: (boxes[0].x + boxes[1].x) / 2, y: y - 8 });
    sk.part("nth-term", formula.slice(0, 34), { x: x0 + Math.max(total, 280) / 2, y: y + 120 });
    return sk.finish(16);
  },
};

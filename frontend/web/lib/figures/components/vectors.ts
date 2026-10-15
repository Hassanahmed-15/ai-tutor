import type { FigureComponent, FigureParams, Ink, Pt } from "../types";
import { PALETTE, Sketch, add, arrow, bool, clamp, fmt, lerp, list, mul, optNum, perp, str, sub, unit } from "./mathsKit";

/**
 * VECTORS ON A SQUARE GRID. The board gives vectors as components; the code draws them to the grid
 * exactly, adds them tip-to-tail (or as a parallelogram), and computes the resultant's components —
 * so a + b always lands on the right grid point. Optional dashed components and a scalar multiple.
 */

const PARTS = [
  { id: "origin", name: "Origin O" },
  { id: "vector-a", name: "Vector a" },
  { id: "vector-b", name: "Vector b" },
  { id: "resultant", name: "Resultant a + b" },
];

/** "3,1" / "(3, 1)" / "3 1" → {x:3, y:1}; components limited to ±10. */
export function parseVector(v: unknown): Pt | undefined {
  const parts = list(v, /[,;\s]+/).map((s) => optNum(s.replace("−", "-")));
  if (parts.length !== 2 || parts.some((n) => n === undefined)) return undefined;
  return { x: clamp(parts[0]!, -10, 10), y: clamp(parts[1]!, -10, 10) };
}
/** "2a", "-1.5b", "½a" → {k, of}. */
export function parseMultiple(v: unknown): { k: number; of: 0 | 1 } | undefined {
  const m = /^\s*([−-]?\s*\d*\.?\d*)\s*([ab])\s*$/i.exec(String(v ?? "").replace("½", "0.5"));
  if (!m) return undefined;
  const raw = m[1].replace(/\s|−/g, (c) => (c === "−" ? "-" : ""));
  const k = raw === "" ? 1 : raw === "-" ? -1 : Number(raw);
  return Number.isFinite(k) && k !== 0 ? { k: clamp(k, -5, 5), of: m[2].toLowerCase() === "a" ? 0 : 1 } : undefined;
}

export const vectors: FigureComponent = {
  name: "vectors",
  title: "Vectors drawn to a square grid with origin O: arrows from components, the resultant added tip-to-tail (or as a parallelogram), optional dashed components and a scalar multiple",
  params: `a, b (components "x,y", e.g. a "3,1", b "1,2"; each -10..10; default a "3,1", b "1,2"; omit b for one vector); names (vector letters, default "a,b"); operation ("a+b" default | "a-b": the resultant is a + (−b), drawn tip-to-tail with −b); resultant (true default: draw the resultant and write its components); layout ("tip-to-tail" default: b starts at a's tip | "parallelogram": both from O, resultant the diagonal | "origin": both from O, no resultant); components (true: dashed horizontal and vertical components with their values; default false); multiple (a scalar multiple drawn separately, e.g. "2a", "-b", "0.5b"; default none); ticks (axis numbers; default true, false when components are shown). The resultant part exists only when it is drawn.`,
  match: /\bvectors?\b(?![- ]valued)|\bresultant\b|\btip[- ]to[- ]tail\b|\bcolumn vectors?\b|\bscalar multiples?\b|\bparallelogram (law|rule) of\b/i,
  parts: PARTS,
  build(params: FigureParams) {
    const names = list(params.names);
    const na = str(names[0], "a", 3), nb = str(names[1], "b", 3);
    const a = parseVector(params.a) ?? { x: 3, y: 1 };
    const bGiven = params.b === undefined ? { x: 1, y: 2 } : parseVector(params.b);
    const subtract = /-|−|minus|subtract/i.test(String(params.operation ?? ""));
    const layoutRaw = String(params.layout ?? "").toLowerCase();
    const layout = /parallel/.test(layoutRaw) ? "parallelogram" : /origin|separate/.test(layoutRaw) ? "origin" : "tip-to-tail";
    const b = bGiven ? (subtract ? mul(bGiven, -1) : bGiven) : undefined;
    const showResultant = Boolean(b) && layout !== "origin" && bool(params.resultant, true);
    const showComponents = bool(params.components, false);
    const ticks = bool(params.ticks, !bool(params.components, false));
    const multiple = parseMultiple(params.multiple);
    const r = b ? add(a, b) : a;
    const bName = subtract ? `−${nb}` : nb;

    // Where each arrow runs, in grid units (y up).
    const O = { x: 0, y: 0 };
    const arrows: Array<{ from: Pt; to: Pt; colour: Ink; part: string; name: string; w: number }> = [];
    arrows.push({ from: O, to: a, colour: PALETTE.blue, part: "vector-a", name: na, w: 3 });
    if (b) arrows.push({ from: layout === "tip-to-tail" ? a : O, to: layout === "tip-to-tail" ? r : b, colour: PALETTE.red, part: "vector-b", name: bName, w: 3 });
    if (showResultant) arrows.push({ from: O, to: r, colour: PALETTE.green, part: "resultant", name: subtract ? `${na} − ${nb}` : `${na} + ${nb}`, w: 3.4 });
    const all = [O, a, ...(b ? [b, r] : [])];
    if (multiple && (multiple.of === 0 || bGiven)) {
      const base = multiple.of === 0 ? a : bGiven!;
      const v = mul(base, multiple.k);
      const maxX = Math.max(...all.map((p) => p.x)), minY = Math.min(...all.map((p) => p.y)), maxY = Math.max(...all.map((p) => p.y));
      const start = { x: Math.ceil(maxX) + 1 + Math.max(0, -v.x), y: v.y >= 0 ? Math.floor(minY) : Math.ceil(maxY) };
      arrows.push({ from: start, to: add(start, v), colour: PALETTE.violet, part: multiple.of === 0 ? "vector-a" : "vector-b", name: `${fmt(multiple.k, 2).replace(/^1$/, "").replace(/^−1$/, "−")}${multiple.of === 0 ? na : nb}`, w: 3 });
    }
    const pts = arrows.flatMap((ar) => [ar.from, ar.to]).concat(O);
    const gx0 = Math.floor(Math.min(...pts.map((p) => p.x))) - 1, gx1 = Math.ceil(Math.max(...pts.map((p) => p.x))) + 1;
    const gy0 = Math.floor(Math.min(...pts.map((p) => p.y))) - 1, gy1 = Math.ceil(Math.max(...pts.map((p) => p.y))) + 1;
    const cell = clamp(Math.min(400 / (gx1 - gx0), 330 / (gy1 - gy0)), 22, 56);
    const S = (p: Pt): Pt => ({ x: p.x * cell, y: -p.y * cell });

    const sk = new Sketch();
    for (let x = gx0; x <= gx1; x++) sk.line([S({ x, y: gy0 }), S({ x, y: gy1 })], { stroke: "muted", width: 1, opacity: 0.35 }, false);
    for (let y = gy0; y <= gy1; y++) sk.line([S({ x: gx0, y }), S({ x: gx1, y })], { stroke: "muted", width: 1, opacity: 0.35 }, false);
    // Axes through O (when O is on the grid, which it always is).
    sk.line([S({ x: gx0, y: 0 }), S({ x: gx1, y: 0 })], { stroke: "ink", width: 1.6, opacity: 0.75 });
    sk.line([S({ x: 0, y: gy0 }), S({ x: 0, y: gy1 })], { stroke: "ink", width: 1.6, opacity: 0.75 });
    sk.circle(S(O), 4, { fill: "ink", stroke: "ink", width: 1, part: "origin" }, false);

    // Components first (dashed, under the arrows), then the arrows.
    if (showComponents) {
      for (const ar of arrows.filter((x) => x.part !== "resultant")) {
        const corner = { x: ar.to.x, y: ar.from.y };
        const dx = ar.to.x - ar.from.x, dy = ar.to.y - ar.from.y;
        if (dx && dy) sk.line([S(ar.from), S(corner), S(ar.to)], { stroke: ar.colour, width: 1.8, dash: "6 5", opacity: 0.85, part: ar.part });
      }
    }
    // The parallelogram's other two sides: copies of a and b, dashed.
    if (layout === "parallelogram" && b) {
      sk.line([S(a), S(r)], { stroke: PALETTE.red, width: 1.8, dash: "7 6", opacity: 0.7, part: "vector-b" });
      sk.line([S(b), S(r)], { stroke: PALETTE.blue, width: 1.8, dash: "7 6", opacity: 0.7, part: "vector-a" });
    }
    for (const ar of arrows) arrow(sk, S(ar.from), S(ar.to), ar.colour, ar.w, ar.part, 15);

    // Names beside each arrow, on the side away from the others; component values beside the legs.
    const centre = S(mul(pts.reduce((t, p) => add(t, p), { x: 0, y: 0 }), 1 / pts.length));
    for (const ar of arrows) {
      const p = S(ar.from), q = S(ar.to), m = lerp(p, q, 0.5);
      let n = perp(unit(sub(q, p)));
      if ((m.x - centre.x) * n.x + (m.y - centre.y) * n.y < 0) n = mul(n, -1);
      if (ar.part === "resultant") n = mul(n, -1); // the resultant's name sits inside the triangle's far side
      const spot = sk.findText(ar.name, 24, m, n, { min: 6, max: 50, slide: unit(sub(q, p)) });
      const other = spot.ok ? spot : sk.findText(ar.name, 24, m, mul(n, -1), { min: 6, max: 50, slide: unit(sub(q, p)) });
      sk.text(other.c, ar.name, 24, ar.colour, ar.part);
    }
    if (showComponents) {
      for (const ar of arrows.filter((x) => x.part !== "resultant")) {
        const dx = ar.to.x - ar.from.x, dy = ar.to.y - ar.from.y;
        if (!dx || !dy) continue;
        const corner = S({ x: ar.to.x, y: ar.from.y });
        sk.placeText(fmt(dx, 2), 19, lerp(S(ar.from), corner, 0.5), { x: 0, y: dy > 0 ? 1 : -1 }, { min: 4, max: 40, fill: ar.colour, part: ar.part, slide: { x: 1, y: 0 } });
        sk.placeText(fmt(dy, 2), 19, lerp(corner, S(ar.to), 0.5), { x: dx > 0 ? 1 : -1, y: 0 }, { min: 4, max: 40, fill: ar.colour, part: ar.part, slide: { x: 0, y: 1 } });
      }
    }
    // The resultant's components, written as a column-vector-like pair at its tip.
    if (showResultant) sk.placeText(`(${fmt(r.x, 2)}, ${fmt(r.y, 2)})`, 19, S(r), unit({ x: r.x >= 0 ? 1 : -1, y: r.y >= 0 ? -1 : 1 }), { min: 12, max: 70, fill: PALETTE.green, part: "resultant" });

    // Origin letter, then axis numbers wherever they are clear.
    sk.placeLetter("O", 20, S(O), [{ x: -0.7, y: 0.7 }, { x: 0.7, y: 0.7 }, { x: -0.7, y: -0.7 }, { x: 0.7, y: -0.7 }], { part: "origin" });
    if (ticks) {
      const every = cell < 30 ? 2 : 1;
      for (let x = gx0 + 1; x < gx1; x++) if (x && x % every === 0) {
        const t = fmt(x, 0), at = add(S({ x, y: 0 }), { x: 0, y: 14 });
        const box = { x: at.x - 8, y: at.y - 7, w: 16, h: 14 };
        if (!sk.blocked(box, 1)) sk.text(at, t, 15, "muted");
      }
      for (let y = gy0 + 1; y < gy1; y++) if (y && y % every === 0) {
        const t = fmt(y, 0), at = add(S({ x: 0, y }), { x: -14, y: 0 });
        const box = { x: at.x - 9, y: at.y - 7, w: 18, h: 14 };
        if (!sk.blocked(box, 1)) sk.text(at, t, 15, "muted");
      }
    }

    sk.part("origin", "Origin O", S(O));
    for (const ar of arrows.slice(0, showResultant ? 3 : 2)) {
      const name = ar.part === "resultant" ? `Resultant ${ar.name}` : `Vector ${ar.name}`;
      if (!sk.parts.some((p) => p.id === ar.part)) sk.part(ar.part, name, sk.clearAnchor([0.5, 0.65, 0.4, 0.75].map((t) => lerp(S(ar.from), S(ar.to), t))));
    }
    return sk.finish(10);
  },
};

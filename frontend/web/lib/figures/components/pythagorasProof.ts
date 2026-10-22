import type { FigureComponent, FigureParams, FigureShape } from "../types";
import { PALETTE, clamp, num } from "./mathsKit";

/**
 * PYTHAGORAS' THEOREM, PROVED BY REARRANGEMENT (2026-10-20, from the Visuals Lab). Four copies of a
 * right triangle (legs a, b; hypotenuse c) inside a square of side a + b leave a tilted square c² in
 * the middle. The SAME four triangles then slide, one at a time, inside the SAME square, and the gaps
 * become a² and b². Same square, same triangles, so c² = a² + b². The motion is the proof: nothing is
 * redrawn (research: animation helps when the motion is the change being learned — Höffler & Leutner).
 *
 * Code computes every vertex; three triangles slide by pure translations. Colour by quantity, one
 * colour each everywhere: a blue, b amber, c green, the triangles violet.
 *
 * Timing (lib/figures/types.ts ShapeTiming), each on the sentence that names it:
 *   triangles   — the four triangles appear;
 *   c-square    — the tilted c² gap is shaded and named;
 *   step-slide  — the triangles slide (the c² square fades);
 *   a-square, b-square — the new gaps are shaded and named.
 */

const PARTS = [
  { id: "square", name: "Square of side a + b" },
  { id: "triangles", name: "Four copies of the right triangle" },
  { id: "c-square", name: "Square on the hypotenuse, c²" },
  { id: "step-slide", name: "The triangles slide (same square)" },
  { id: "a-square", name: "Square a²" },
  { id: "b-square", name: "Square b²" },
];

const SIDE = 300;
const PAD = 34;

export const pythagorasProof: FigureComponent = {
  name: "pythagorasProof",
  title: "Pythagoras' theorem proved by rearrangement: four right triangles in a square of side a + b leave c², then slide (animated) to leave a² + b²",
  params: `a, b (the triangle's two shorter sides, relative sizes 1..9; default a 3, b 4 — a and b only set the shape, the proof is general); letters ("a,b,c" default). Reveal the parts in teaching order: triangles, then c-square, then step-slide (the sentence where the triangles move), then a-square and b-square.`,
  // A proof board, recognised by what it says: a proof or rearrangement word AND Pythagoras by name,
  // four triangles in a square, or "a squared plus b squared" (a live board titled "Proof by
  // rearrangement" never said "Pythagoras", 2026-10-20). Every matching word counts, so it outranks
  // the general triangle on a proof board.
  match: /(?<=^(?=[\s\S]*\b(?:proofs?|prov(?:e|es|ed|ing)|rearrang\w*\s+(?:the\s+(?:same\s+)?|these\s+|those\s+|all\s+|four\s+)?(?:triangles|pieces|shapes|them)|dissection)\b)(?=[\s\S]*(?:\bpythagora|\bfour (?:identical |congruent |copies of (?:the |a )?)?(?:right[- ]angled |right )?triangles?\b|\ba squared plus b squared\b|\ba\s*(?:²|\^\s*2)\s*\+\s*b\s*(?:²|\^\s*2)))[\s\S]*)\b(?:pythagora\w*|proofs?|prov(?:e|es|ed|ing)|dissection|hypotenuses?|right[- ]angled|triangles?|squares?)\b/i,
  parts: PARTS,
  selfLabelled: true,
  timeFromScript(sentences) {
    const find = (re: RegExp, from = 0) => {
      for (let i = Math.max(0, from); i < sentences.length; i++) if (re.test(sentences[i])) return i;
      return -1;
    };
    const out: Record<string, number> = {};
    const tri = Math.max(0, find(/\btriangles?\b/i));
    out.square = tri;
    out.triangles = tri;
    let c = find(/\bc\s*(?:squared|²|\^\s*2)|\b(?:central|tilted|middle|inner) square\b|\bsquare on the hypotenuse\b|\bgap\b/i, tri);
    let slide = find(/\b(?:re-?arrang\w*|slid(?:e|es|ing)|mov(?:e|es|ed|ing)|shift\w*|swap\w*)\b/i, Math.max(tri, c >= 0 ? c + 1 : tri + 1));
    // Never told to slide: the slide closes the board, so the student still sees both arrangements.
    if (slide < 0) slide = Math.max(tri + 1, sentences.length - 1);
    if (c < 0 || c >= slide) c = Math.max(tri, slide - 1);
    out["c-square"] = c;
    out["step-slide"] = slide;
    const a = find(/\ba\s*(?:squared|²|\^\s*2)/i, slide);
    const b = find(/\bb\s*(?:squared|²|\^\s*2)/i, slide);
    out["a-square"] = a >= 0 ? a : slide;
    out["b-square"] = b >= 0 ? b : out["a-square"];
    return out;
  },
  build(params: FigureParams) {
    const a0 = clamp(num(params.a, 3, 1, 9), 1, 9);
    const b0 = clamp(num(params.b, 4, 1, 9), 1, 9);
    const letters = String(params.letters ?? "a,b,c").split(/[,\s]+/).map((l) => l.trim().slice(0, 2)).filter(Boolean);
    const [la, lb, lc] = [letters[0] ?? "a", letters[1] ?? "b", letters[2] ?? "c"];
    const u = SIDE / (a0 + b0);
    const a = a0 * u;
    const b = b0 * u;
    const X0 = PAD;
    const Y0 = PAD;
    const X1 = X0 + SIDE;
    const Y1 = Y0 + SIDE;
    const w = X1 + 14;
    const h = Y1 + 14;
    const shapes: FigureShape[] = [];
    const poly = (pts: Array<[number, number]>) => `M${pts.map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join(" L")} Z`;
    const text = (x: number, y: number, t: string, size: number, fill: string, extra: Partial<FigureShape> = {}) => shapes.push({ t: "text", x, y, text: t, size, anchor: "middle", fill: fill as `#${string}`, ...extra } as FigureShape);

    // The gaps after the slide, under the triangles: a² top-left, b² bottom-right.
    shapes.push({ t: "path", d: poly([[X0, Y0], [X0 + a, Y0], [X0 + a, Y0 + a], [X0, Y0 + a]]), fill: PALETTE.blue, opacity: 0.28, stroke: PALETTE.blue, width: 2.5, part: "a-square", show: ["step-slide", "a-square"] });
    text(X0 + a / 2, Y0 + a / 2 + 9, `${la}²`, 26, PALETTE.blue, { part: "a-square", show: ["step-slide", "a-square"] });
    shapes.push({ t: "path", d: poly([[X0 + a, Y0 + a], [X1, Y0 + a], [X1, Y1], [X0 + a, Y1]]), fill: PALETTE.amber, opacity: 0.28, stroke: PALETTE.amber, width: 2.5, part: "b-square", show: ["step-slide", "b-square"] });
    text(X0 + a + b / 2, Y0 + a + b / 2 + 10, `${lb}²`, 30, PALETTE.amber, { part: "b-square", show: ["step-slide", "b-square"] });

    // The tilted c² gap, before the slide.
    const inner: Array<[number, number]> = [[X0 + a, Y0], [X1, Y0 + a], [X1 - a, Y1], [X0, Y1 - a]];
    shapes.push({ t: "path", d: poly(inner), fill: PALETTE.green, opacity: 0.25, stroke: PALETTE.green, width: 2.5, part: "c-square", show: "c-square", hide: "step-slide" });
    text(X0 + SIDE / 2, Y0 + SIDE / 2 + 10, `${lc}²`, 32, PALETTE.green, { part: "c-square", show: "c-square", hide: "step-slide" });

    // The four triangles; three slide (pure translations), one stays. Staggered: one moving thing at a time.
    const tris: Array<{ pts: Array<[number, number]>; dx: number; dy: number; delay: number }> = [
      { pts: [[X0, Y0], [X0 + a, Y0], [X0, Y0 + b]], dx: 0, dy: a, delay: 0 },
      { pts: [[X1, Y0], [X1 - b, Y0], [X1, Y0 + a]], dx: 0, dy: 0, delay: 0 },
      { pts: [[X1, Y1], [X1 - a, Y1], [X1, Y1 - b]], dx: -b, dy: 0, delay: 1150 },
      { pts: [[X0, Y1], [X0 + b, Y1], [X0, Y1 - a]], dx: a, dy: -b, delay: 2300 },
    ];
    for (const t of tris) {
      shapes.push({ t: "path", d: poly(t.pts), fill: PALETTE.violet, opacity: 0.32, stroke: PALETTE.violet, width: 2.5, part: "triangles", show: "triangles", ...(t.dx || t.dy ? { move: { on: "step-slide", dx: t.dx, dy: t.dy, delay: t.delay } } : {}) });
    }

    // The square and its sides: a then b along the top; the left edge reads b, a before the slide
    // and a, b after it.
    shapes.push({ t: "path", d: poly([[X0, Y0], [X1, Y0], [X1, Y1], [X0, Y1]]), fill: "none", stroke: "ink", width: 3, part: "square" });
    shapes.push({ t: "path", d: `M${(X0 + a).toFixed(1)} ${Y0 - 9} V ${Y0 + 9}`, stroke: "ink", width: 2.5 });
    text(X0 + a / 2, Y0 - 12, la, 22, PALETTE.blue);
    text(X0 + a + b / 2, Y0 - 12, lb, 22, PALETTE.amber);
    shapes.push({ t: "path", d: `M${X0 - 9} ${(Y0 + b).toFixed(1)} H ${X0 + 9}`, stroke: "ink", width: 2.5, hide: "step-slide" });
    text(X0 - 16, Y0 + b / 2 + 8, lb, 22, PALETTE.amber, { hide: "step-slide" });
    text(X0 - 16, Y0 + b + a / 2 + 8, la, 22, PALETTE.blue, { hide: "step-slide" });
    shapes.push({ t: "path", d: `M${X0 - 9} ${(Y0 + a).toFixed(1)} H ${X0 + 9}`, stroke: "ink", width: 2.5, show: "step-slide" });
    text(X0 - 16, Y0 + a / 2 + 8, la, 22, PALETTE.blue, { show: "step-slide" });
    text(X0 - 16, Y0 + a + b / 2 + 8, lb, 22, PALETTE.amber, { show: "step-slide" });

    return {
      w,
      h,
      shapes,
      parts: [
        { id: "square", name: PARTS[0].name, anchor: { x: X1 - 4, y: Y1 - 4 } },
        { id: "triangles", name: PARTS[1].name, anchor: { x: X0 + a / 3, y: Y0 + b / 3 } },
        { id: "c-square", name: PARTS[2].name, anchor: { x: X0 + SIDE / 2, y: Y0 + SIDE / 2 } },
        { id: "step-slide", name: PARTS[3].name, anchor: { x: X0 + SIDE / 2, y: Y0 + SIDE / 2 } },
        { id: "a-square", name: PARTS[4].name, anchor: { x: X0 + a / 2, y: Y0 + a / 2 } },
        { id: "b-square", name: PARTS[5].name, anchor: { x: X0 + a + b / 2, y: Y0 + a + b / 2 } },
      ],
    };
  },
};

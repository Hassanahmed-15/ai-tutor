import type { FigureComponent, FigureParams, FigureShape } from "../types";
import { PALETTE, num } from "./mathsKit";

/**
 * ALGEBRA AS AREA (2026-10-20, from the Visuals Lab). Two modes, both computed by code:
 *
 *   expand          — (x + p)(x + q) as a rectangle cut into x², px, qx and pq, each piece shaded
 *                     and named on the sentence that names it; the pieces add up to the expansion.
 *   complete-square — x² + bx as a square and a strip; the strip is cut in half (step-split), one
 *                     half swings under the square (step-move, animated), and the missing corner
 *                     (b/2)² completes the square (x + b/2)² — "completing the square" literally.
 *
 * Concrete first, then symbols (concreteness fading, Fyfe et al. 2014). One colour per quantity
 * everywhere: x² blue, the x-terms amber, the number term green.
 */

const PARTS = [
  { id: "x-squared", name: "x² (an x by x square)" },
  { id: "x-term", name: "The x-term as a strip" },
  { id: "x-term-2", name: "The second x-term" },
  { id: "number", name: "The number term" },
  { id: "step-split", name: "Cut the strip in half" },
  { id: "step-move", name: "Move one half under the square" },
  { id: "corner", name: "The missing corner" },
  { id: "complete", name: "The completed square" },
];

/** "3" → 3; "1/2" → 0.5; formatted back as the board writes it. */
const fmt = (v: number): string => (Number.isInteger(v) ? String(v) : Number.isInteger(v * 2) ? `${v * 2}/2` : Number.isInteger(v * 4) ? `${v * 4}/4` : String(Math.round(v * 100) / 100));
const rect = (x: number, y: number, w: number, h: number) => `M${x.toFixed(1)} ${y.toFixed(1)} L${(x + w).toFixed(1)} ${y.toFixed(1)} L${(x + w).toFixed(1)} ${(y + h).toFixed(1)} L${x.toFixed(1)} ${(y + h).toFixed(1)} Z`;
const term = (k: number, v: string) => (k === 1 ? v : `${fmt(k)}${v}`);

export const areaModel: FigureComponent = {
  name: "areaModel",
  title: "Algebra as area: (x + p)(x + q) as a rectangle of x², px, qx and pq; or completing the square, x² + bx with the strip cut and moved (animated) to leave the missing corner (b/2)²",
  params: `mode ("expand" default | "complete-square"); variable (default "x"); for expand: p, q (positive numbers 1..12, the brackets (x + p)(x + q); default 3 and 2); for complete-square: b (the x-coefficient in x² + bx, positive 1..20; default 6). Reveal parts on the sentences that name them: expand — x-squared, x-term, x-term-2, number; complete-square — x-squared, x-term, step-split, step-move, corner, complete.`,
  // Never on a fractions board, wherever the word "fraction" sits (the fraction model draws those).
  match: /(?<=^(?![\s\S]*\bfractions?\b)[\s\S]*)(?:\balgebra tiles?\b|\barea models?\b|\bcomplet\w* the square\b(?=[\s\S]*\b(area|picture|visual\w*|geometric\w*|diagram|literally|tiles?|strips?)\b)|\b(expand\w*|multiply\w*) (the |double |two )?brackets?\b(?=[\s\S]*\b(area|rectangle|grid|picture|diagram)\b)|\bgrid method\b(?=[\s\S]*\bbrackets?\b))/i,
  parts: PARTS,
  selfLabelled: true,
  timeFromScript(sentences, params) {
    if (!/complet|square/i.test(String(params.mode ?? ""))) return {};
    const find = (re: RegExp, from = 0) => {
      for (let i = Math.max(0, from); i < sentences.length; i++) if (re.test(sentences[i])) return i;
      return -1;
    };
    const out: Record<string, number> = {};
    const sq = Math.max(0, find(/\b[a-z]\s*(?:squared|²|\^\s*2)|\bsquare\b/i));
    out["x-squared"] = sq;
    out["x-term"] = Math.max(sq, find(/\bstrip\b|\b\d+\s*[a-z]\b(?!\s*(?:squared|²))/i, sq));
    let split = find(/\b(?:half|halve[sd]?|halves|split\w*|cut\w*|divid\w*)\b/i, out["x-term"]);
    if (split < 0) split = Math.min(sentences.length - 1, out["x-term"] + 1);
    let move = find(/\b(?:mov(?:e|es|ed|ing)|slid\w*|swing\w*|put|plac\w*|re-?arrang\w*|under(?:neath)?|below)\b/i, split);
    if (move < 0) move = Math.min(sentences.length - 1, split + 1);
    out["step-split"] = split;
    out["step-move"] = Math.max(split, move);
    const corner = find(/\b(?:corner|missing|gap)\b/i, out["step-move"]);
    out.corner = corner >= 0 ? corner : out["step-move"];
    const done = find(/\b(?:complete\w*|perfect square|whole square|all squared)\b|\(\s*[a-z]\s*\+/i, out.corner);
    out.complete = done >= 0 ? done : out.corner;
    return out;
  },
  build(params: FigureParams) {
    const v = String(params.variable ?? "x").trim().slice(0, 2) || "x";
    const mode = /complet|square/i.test(String(params.mode ?? "")) ? "complete-square" : "expand";
    return mode === "complete-square" ? completeSquare(num(params.b, 6, 1, 20), v) : expand(num(params.p, 3, 1, 12), num(params.q, 2, 1, 12), v);
  },
};

function expand(p: number, q: number, v: string) {
  const X = 170; // x has no value: a fixed length
  const unit = Math.min(26, 140 / Math.max(p, q));
  const P = Math.max(26, p * unit);
  const Q = Math.max(26, q * unit);
  const O = { x: 40, y: 40 };
  const shapes: FigureShape[] = [];
  const block = (x: number, y: number, w: number, h: number, colour: string, part: string, label: string, size: number) => {
    shapes.push({ t: "path", d: rect(x, y, w, h), fill: colour as `#${string}`, opacity: 0.28, stroke: colour as `#${string}`, width: 2.5, part, show: part });
    shapes.push({ t: "text", x: x + w / 2, y: y + h / 2 + size / 3, text: label, size, anchor: "middle", fill: colour as `#${string}`, part, show: part });
  };
  block(O.x, O.y, X, X, PALETTE.blue, "x-squared", `${v}²`, 30);
  block(O.x + X, O.y, P, X, PALETTE.amber, "x-term", term(p, v), 22);
  block(O.x, O.y + X, X, Q, PALETTE.amber, "x-term-2", term(q, v), 22);
  block(O.x + X, O.y + X, P, Q, PALETTE.green, "number", fmt(p * q), 22);
  // Side lengths: x and p along the top, x and q down the left.
  const side = (x: number, y: number, t: string, colour: string) => shapes.push({ t: "text", x, y, text: t, size: 20, anchor: "middle", fill: colour as `#${string}` });
  side(O.x + X / 2, O.y - 12, v, "ink");
  side(O.x + X + P / 2, O.y - 12, fmt(p), PALETTE.amber);
  side(O.x - 16, O.y + X / 2 + 7, v, "ink");
  side(O.x - 16, O.y + X + Q / 2 + 7, fmt(q), PALETTE.amber);
  return {
    w: O.x + X + P + 16,
    h: O.y + X + Q + 16,
    shapes,
    parts: [
      { id: "x-squared", name: `${v}² (a ${v} by ${v} square)`, anchor: { x: O.x + X / 2, y: O.y + X / 2 } },
      { id: "x-term", name: `${term(p, v)} (${v} by ${fmt(p)})`, anchor: { x: O.x + X + P / 2, y: O.y + X / 2 } },
      { id: "x-term-2", name: `${term(q, v)} (${fmt(q)} by ${v})`, anchor: { x: O.x + X / 2, y: O.y + X + Q / 2 } },
      { id: "number", name: `${fmt(p * q)} (${fmt(p)} by ${fmt(q)})`, anchor: { x: O.x + X + P / 2, y: O.y + X + Q / 2 } },
    ],
  };
}

function completeSquare(b: number, v: string) {
  const X = 170;
  const half = b / 2;
  const k = Math.max(32, Math.min(84, half * 20));
  const O = { x: 46, y: 46 };
  const shapes: FigureShape[] = [];
  const fillBox = (d: string, colour: string, extra: Partial<FigureShape>) => shapes.push({ t: "path", d, fill: colour as `#${string}`, opacity: 0.28, stroke: colour as `#${string}`, width: 2.5, ...extra } as FigureShape);
  const label = (x: number, y: number, t: string, size: number, colour: string, extra: Partial<FigureShape> = {}) => shapes.push({ t: "text", x, y, text: t, size, anchor: "middle", fill: colour as `#${string}`, ...extra } as FigureShape);

  // x² and the whole strip bx.
  fillBox(rect(O.x, O.y, X, X), PALETTE.blue, { part: "x-squared", show: "x-squared" });
  label(O.x + X / 2, O.y + X / 2 + 10, `${v}²`, 30, PALETTE.blue, { part: "x-squared", show: "x-squared" });
  fillBox(rect(O.x + X, O.y, 2 * k, X), PALETTE.amber, { part: "x-term", show: "x-term", hide: "step-split" });
  label(O.x + X + k, O.y + X / 2 + 8, term(b, v), 22, PALETTE.amber, { part: "x-term", show: "x-term", hide: "step-split" });
  label(O.x + X + k, O.y - 12, fmt(b), 20, PALETTE.amber, { show: "x-term", hide: "step-split" });

  // Cut in half: two strips b/2 wide; the second swings under the square (turns a quarter and slides).
  fillBox(rect(O.x + X, O.y, k, X), PALETTE.amber, { part: "x-term", show: "step-split" });
  label(O.x + X + k / 2, O.y + X / 2 + 8, term(half, v), 20, PALETTE.amber, { part: "x-term", show: "step-split" });
  label(O.x + X + k / 2, O.y - 12, fmt(half), 20, PALETTE.amber, { show: "step-split" });
  const from = { x: O.x + X + 1.5 * k, y: O.y + X / 2 };
  const to = { x: O.x + X / 2, y: O.y + X + k / 2 };
  const move = { on: "step-move", dx: to.x - from.x, dy: to.y - from.y };
  fillBox(rect(O.x + X + k, O.y, k, X), PALETTE.amber, { part: "x-term", show: "step-split", move: { ...move, rotate: 90 } });
  label(from.x, from.y + 8, term(half, v), 20, PALETTE.amber, { part: "x-term", show: "step-split", move });
  label(O.x + X + 1.5 * k, O.y - 12, fmt(half), 20, PALETTE.amber, { show: "step-split", hide: "step-move" });
  label(O.x - 16, O.y + X + k / 2 + 7, fmt(half), 20, PALETTE.amber, { show: "step-move" });

  // The missing corner: dashed when the gap appears, filled (b/2)² when it is named.
  shapes.push({ t: "path", d: rect(O.x + X, O.y + X, k, k), fill: "none", stroke: PALETTE.green, width: 2.5, dash: "6 6", show: "step-move", part: "corner" });
  fillBox(rect(O.x + X, O.y + X, k, k), PALETTE.green, { part: "corner", show: ["step-move", "corner"] });
  label(O.x + X + k / 2, O.y + X + k / 2 + 7, fmt(half * half), 20, PALETTE.green, { part: "corner", show: ["step-move", "corner"] });

  // Sides of the square: x always; x + b/2 once it is complete.
  label(O.x + X / 2, O.y - 12, v, 20, "ink");
  label(O.x - 16, O.y + X / 2 + 7, v, 20, "ink");
  shapes.push({ t: "path", d: `M${O.x} ${O.y + X + k + 16} L${O.x + X + k} ${O.y + X + k + 16}`, stroke: "ink", width: 2, part: "complete", show: ["step-move", "complete"] });
  label(O.x + (X + k) / 2, O.y + X + k + 40, `${v} + ${fmt(half)}`, 22, "ink", { part: "complete", show: ["step-move", "complete"] });

  return {
    w: O.x + X + 2 * k + 16,
    h: O.y + X + k + 52,
    shapes,
    parts: [
      { id: "x-squared", name: `${v}² (a ${v} by ${v} square)`, anchor: { x: O.x + X / 2, y: O.y + X / 2 } },
      { id: "x-term", name: `${term(b, v)} as a strip`, anchor: { x: O.x + X + k / 2, y: O.y + X / 2 } },
      { id: "step-split", name: `Cut ${term(b, v)} into two ${term(half, v)} strips`, anchor: { x: O.x + X + k, y: O.y + X / 2 } },
      { id: "step-move", name: "Move one strip under the square", anchor: { x: O.x + X / 2, y: O.y + X + k / 2 } },
      { id: "corner", name: `The missing corner, ${fmt(half)}² = ${fmt(half * half)}`, anchor: { x: O.x + X + k / 2, y: O.y + X + k / 2 } },
      { id: "complete", name: `The square (${v} + ${fmt(half)})²`, anchor: { x: O.x + (X + k) / 2, y: O.y + X + k + 16 } },
    ],
  };
}

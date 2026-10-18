import type { FigureComponent, FigureParams, Pt } from "../types";
import { fitWithin } from "../cuts";
import { PALETTE, Sketch, add, angleMark, bool, fmt, mul, num, rad, str } from "./mathsKit";

/**
 * ANGLES IN PARALLEL LINES, DRAWN TO SCALE. Two parallel lines (with arrow marks) cut by a
 * transversal at exactly the given angle; the code picks where the given and unknown angles sit for
 * the pair the board asks about (corresponding, alternate, co-interior, vertically opposite, angles
 * on a straight line) and computes the unknown — equal, or 180° minus the given one.
 */

export const PAIRS = ["corresponding", "alternate", "co-interior", "vertically-opposite", "straight-line"] as const;
export type AnglePair = (typeof PAIRS)[number];
type Pos = "TR" | "TL" | "BL" | "BR";
type At = { at: "P" | "Q"; pos: Pos };

/** The unknown angle the pair gives from the given one (degrees). */
export function relatedAngle(pair: AnglePair, given: number): number {
  return pair === "co-interior" || pair === "straight-line" ? 180 - given : given;
}

/** Where the given and unknown angles sit (for an acute given angle; mirrored for an obtuse one). */
const PLACES: Record<AnglePair, [At, At]> = {
  corresponding: [{ at: "P", pos: "TR" }, { at: "Q", pos: "TR" }],
  alternate: [{ at: "P", pos: "BL" }, { at: "Q", pos: "TR" }],
  "co-interior": [{ at: "P", pos: "BL" }, { at: "Q", pos: "TL" }],
  "vertically-opposite": [{ at: "P", pos: "TR" }, { at: "P", pos: "BL" }],
  "straight-line": [{ at: "P", pos: "TR" }, { at: "P", pos: "TL" }],
};
const MIRROR: Record<Pos, Pos> = { TR: "TL", TL: "TR", BL: "BR", BR: "BL" };

export function parsePair(v: unknown): AnglePair {
  const s = String(v ?? "").toLowerCase();
  if (/co-?\s?interior|allied|same[- ]side|consecutive|supplementary|\bc[- ]angle/.test(s)) return "co-interior";
  if (/alternate|\bz[- ]angle/.test(s)) return "alternate";
  if (/vertical|opposite|\bx[- ]angle/.test(s)) return "vertically-opposite";
  if (/straight|adjacent|linear pair/.test(s)) return "straight-line";
  return "corresponding";
}

const NAMES: Record<AnglePair, string> = {
  corresponding: "corresponding",
  alternate: "alternate",
  "co-interior": "co-interior",
  "vertically-opposite": "vertically opposite",
  "straight-line": "on a straight line",
};

const PARTS = [
  { id: "parallel-lines", name: "Parallel lines (arrow marks)" },
  { id: "transversal", name: "Transversal" },
  { id: "given-angle", name: "Given angle" },
  { id: "unknown-angle", name: "Unknown angle" },
];

export const parallelLines: FigureComponent = {
  name: "parallelLines",
  title: "Two parallel lines (arrow marks) cut by a transversal drawn at the exact angle, with a given angle and the related unknown angle for a chosen pair: corresponding, alternate, co-interior, vertically opposite or on a straight line",
  params: `angle (the given angle in degrees, 15-165; default 65); pair ("corresponding" default | "alternate" | "co-interior" (allied) | "vertically-opposite" | "straight-line"); unknown (the unknown's symbol, default "x"); solve (true: write the unknown's value, e.g. "x = 115°"; default false: just the symbol). The transversal really meets the lines at the given angle; the code places both angles and computes the unknown (equal for corresponding/alternate/vertically opposite, 180° − given for co-interior and a straight line).`,
  match: /\bparallel lines?\b|\btransversals?\b|\b(corresponding|alternate|co-?interior|allied|vertically[- ]opposite) angles?\b|\b[FZC][- ]angles?\b|\bangles (in|on|between) parallel\b/i,
  parts: PARTS,
  build(params: FigureParams) {
    const given = Math.round(num(params.angle ?? params.given, 65, 15, 165) * 10) / 10;
    const pair = parsePair(params.pair ?? params.type ?? params.rule);
    const sym = str(params.unknown, "x", 4);
    const solve = bool(params.solve ?? params.showAnswer, false);
    const found = relatedAngle(pair, given);

    // The transversal leans so the angle at the top-right of each crossing is acute (t ≤ 90°).
    const acute = given <= 90;
    const t = acute ? given : 180 - given;
    const [g0, u0] = PLACES[pair];
    const gAt: At = acute ? g0 : { at: g0.at, pos: MIRROR[g0.pos] };
    const uAt: At = acute ? u0 : { at: u0.at, pos: MIRROR[u0.pos] };

    const G = 150; // the gap between the lines
    const u = { x: Math.cos(rad(t)), y: -Math.sin(rad(t)) }; // up the transversal (screen y is down)
    const dx = G / Math.tan(rad(t));
    const P = { x: dx / 2, y: 0 }, Q = { x: -dx / 2, y: G };
    const along = 90;
    const T0 = add(Q, mul(u, -along)), T1 = add(P, mul(u, along));
    const xL = Math.min(T0.x, T1.x, -170) - 50, xR = Math.max(T0.x, T1.x, 170) + 60;

    const sk = new Sketch();
    for (const y of [0, G]) sk.line([{ x: xL, y }, { x: xR, y }], { stroke: "ink", width: 2.8, part: "parallel-lines" });
    sk.line([T0, T1], { stroke: "ink", width: 2.8, part: "transversal" });
    // Arrow marks (">") on both lines, the same place on each, clear of the transversal.
    const markX = xR - 45;
    for (const y of [0, G]) sk.line([{ x: markX - 6, y: y - 7 }, { x: markX + 5, y }, { x: markX - 6, y: y + 7 }], { stroke: "ink", width: 2.6, part: "parallel-lines" }, false);

    const ray = (pos: Pos): [Pt, Pt] => {
      const h = { x: pos === "TR" || pos === "BR" ? 1 : -1, y: 0 };
      const v = pos === "TR" || pos === "TL" ? u : mul(u, -1);
      return [h, v];
    };
    const mark = (a: At, text: string, colour: `#${string}`, part: string) => {
      const V = a.at === "P" ? P : Q;
      const [h, v] = ray(a.pos);
      return angleMark(sk, V, add(V, mul(h, 60)), add(V, mul(v, 60)), { r: 38, text, size: 24, colour, part });
    };
    const gA = mark(gAt, `${fmt(given)}°`, PALETTE.blue, "given-angle");
    const uA = mark(uAt, solve ? `${sym} = ${fmt(found)}°` : sym, PALETTE.red, "unknown-angle");

    // Anchored at the line's end, so the leader never runs along the line.
    sk.part("parallel-lines", "Parallel lines (arrow marks)", { x: xR, y: 0 });
    sk.part("transversal", "Transversal", sk.clearAnchor([add(P, mul(u, along * 0.75)), add(Q, mul(u, -along * 0.75))]));
    sk.part("given-angle", `Given angle ${fmt(given)}°`, gA);
    sk.part("unknown-angle", fitWithin("", sym, ` (${NAMES[pair]})${solve ? ` = ${fmt(found)}°` : ""}`, 34), uA);
    return sk.finish(14);
  },
};

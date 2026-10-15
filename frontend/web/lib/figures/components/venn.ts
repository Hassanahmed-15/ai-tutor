import type { FigureComponent, FigureParams, Pt } from "../types";
import { PALETTE, Sketch, type Box, add, boxesOverlap, dist, list, mul, optNum, polar, str, sub, textBox, unit } from "./mathsKit";

/**
 * VENN DIAGRAM. Two or three sets in a universal set. The board gives each region's count, or each
 * set's elements (the code works out which region every element belongs in), and optionally a
 * region to shade written in set notation ("A∩B", "A∪B", "A'", "(A∪B)'", "A∩B'", …). The code
 * places the circles, writes each region's count or elements where it has the most room, and draws
 * the shaded region exactly — its outline is built from the circles' arcs.
 */

/** Region masks: bit 0 = in A, bit 1 = in B, bit 2 = in C. */
const ORDER2 = [1, 3, 2, 0];
const ORDER3 = [1, 2, 4, 3, 5, 6, 7, 0];

export type VennRegions = { sets: 2 | 3; regions: Map<number, string[] | number> };

function elements(v: unknown): string[] | undefined {
  if (v === undefined || v === null || String(v).trim() === "") return undefined;
  const s = String(v).trim();
  const range = /^(-?\d+)\s*(?:-|–|\.\.|to)\s*(-?\d+)$/.exec(s.replace(/^[{(]|[})]$/g, ""));
  if (range) {
    const [a, b] = [Number(range[1]), Number(range[2])];
    if (b >= a && b - a <= 40) return Array.from({ length: b - a + 1 }, (_, i) => String(a + i));
  }
  return [...new Set(list(s, /[,;]/).map((e) => e.slice(0, 10)))].slice(0, 40);
}

/** What goes in each region, from counts or from element lists. */
export function vennRegions(params: FigureParams): VennRegions {
  const names = list(params.names, /,/);
  const counts = list(params.counts, /[,;]/).map((c) => optNum(c));
  const setEls = [elements(params.setA), elements(params.setB), elements(params.setC)];
  const n = optNum(params.sets);
  const sets: 2 | 3 = n === 2 || n === 3 ? n : names.length === 2 || counts.length === 4 || (setEls[0] && setEls[1] && !setEls[2]) ? 2 : names.length >= 3 || counts.length === 8 || setEls[2] ? 3 : 3;
  const order = sets === 2 ? ORDER2 : ORDER3;
  const regions = new Map<number, string[] | number>();
  if (setEls.slice(0, sets).some(Boolean)) {
    const universe = elements(params.universal) ?? [];
    const all = [...new Set([...setEls.slice(0, sets).flatMap((e) => e ?? []), ...universe])];
    for (const m of order) regions.set(m, []);
    for (const e of all) {
      const mask = setEls.slice(0, sets).reduce((t, els, i) => t | (els?.includes(e) ? 1 << i : 0), 0);
      (regions.get(mask) as string[]).push(e);
    }
  } else if (counts.some((c) => c !== undefined)) {
    order.forEach((m, i) => {
      const c = counts[i];
      if (c !== undefined && c >= 0) regions.set(m, Math.round(c * 100) / 100);
    });
  }
  return { sets, regions };
}

/** Parse a shading expression into a test on region masks. Unknown input → null (no shading). */
export function parseShade(expr: string, letters: string[]): ((mask: number) => boolean) | null {
  const src = expr.trim();
  if (!src || /^(none|no|false)$/i.test(src)) return null;
  const toks: string[] = [];
  const re = /\s*(\(|\)|'|′|ᶜ|∩|∪|&|\||\^c|\bn\b|\bu\b|\band\b|\bor\b|[A-Za-z]+)/gy;
  let m: RegExpExecArray | null;
  let pos = 0;
  while (pos < src.length && (m = re.exec(src))) {
    toks.push(m[1]);
    pos = re.lastIndex;
  }
  if (src.slice(pos).trim()) return null;
  const isInter = (t: string) => /^(∩|&|n|and)$/i.test(t), isUnion = (t: string) => /^(∪|\||u|or)$/i.test(t);
  const isComp = (t: string) => /^('|′|ᶜ|\^c)$/.test(t);
  let i = 0;
  type F = (mask: number) => boolean;
  const atom = (): F | null => {
    const t = toks[i++];
    if (t === undefined) return null;
    let f: F | null;
    if (t === "(") {
      f = union();
      if (toks[i++] !== ")") return null;
    } else {
      const k = letters.findIndex((l) => l.toLowerCase() === t.toLowerCase());
      const idx = k >= 0 ? k : "ABC".indexOf(t.toUpperCase());
      if (idx < 0 || t.length > 3) return null;
      f = (mask) => Boolean(mask & (1 << idx));
    }
    while (f && toks[i] !== undefined && isComp(toks[i])) {
      const g = f;
      f = (mask) => !g(mask);
      i++;
    }
    return f;
  };
  const inter = (): F | null => {
    let f = atom();
    while (f && toks[i] !== undefined && isInter(toks[i])) {
      i++;
      const g = atom(), h = f;
      if (!g) return null;
      f = (mask) => h(mask) && g(mask);
    }
    return f;
  };
  const union = (): F | null => {
    let f = inter();
    while (f && toks[i] !== undefined && isUnion(toks[i])) {
      i++;
      const g = inter(), h = f;
      if (!g) return null;
      f = (mask) => h(mask) || g(mask);
    }
    return f;
  };
  const f = union();
  return f && i === toks.length ? f : null;
}

const PARTS = [
  { id: "set-a", name: "Set A" },
  { id: "set-b", name: "Set B" },
  { id: "set-c", name: "Set C" },
  { id: "intersection", name: "Intersection" },
  { id: "universal", name: "Universal set ξ" },
  { id: "shaded", name: "Shaded region" },
];

export const venn: FigureComponent = {
  name: "venn",
  title: "Venn diagram: 2 or 3 overlapping sets in a universal set, with the count or the elements in every region and an exactly shaded region given in set notation",
  params: `names (what each set is, e.g. "Tea,Coffee" — used for the set labels; 2 names → 2 sets); letters (circle letters, default "A,B,C"); sets (2 or 3; default from names/counts/elements, else 3); counts (numbers per region, in this order — 2 sets: "only A, A∩B, only B, outside", e.g. "12,5,8,3"; 3 sets: "only A, only B, only C, A∩B only, A∩C only, B∩C only, A∩B∩C, outside"); or setA, setB, setC (element lists, e.g. setA "1,2,3,4,6", setB "2,4,6,8"; the code places each element in its region) with universal (all elements, list or range "1-12"); symbol (universal-set symbol, default "ξ"); shade (region to shade in set notation with the letters: "A∩B", "A∪B", "A'", "(A∪B)'", "A∩B'", "A∩B∩C"…; ∩/n/and, ∪/u/or, ' for complement; default "none"; give a region to shade it). The shaded part exists only when something is shaded; set-c only with 3 sets.`,
  match: /\bvenn\b|\bset notation\b|\bunion of\b.*\bsets?\b|\bintersection of\b.*\bsets?\b|\buniversal set\b|\b(complement|subset)s? of (a )?set\b|[∩∪]/i,
  parts: PARTS,
  build(params: FigureParams) {
    const { sets, regions } = vennRegions(params);
    const custom = list(params.letters, /,/);
    const letters = ["A", "B", "C"].slice(0, sets).map((d, i) => str(custom[i], d, 3));
    const names = list(params.names, /,/);
    const symbol = str(params.symbol, "ξ", 3);
    // Nothing is shaded unless the board asks: an unrequested shaded region would teach something.
    const shadeExpr = params.shade === undefined ? "none" : String(params.shade);
    const shade = parseShade(shadeExpr, letters);

    const R = 112;
    const centres: Pt[] = sets === 2 ? [{ x: -64, y: 0 }, { x: 64, y: 0 }] : [{ x: -64, y: -37 }, { x: 64, y: -37 }, { x: 0, y: 74 }];
    const mid = mul(centres.reduce((t, c) => add(t, c), { x: 0, y: 0 }), 1 / sets);
    const rect: Box = { x: -64 - R - 46, y: Math.min(...centres.map((c) => c.y)) - R - 44, w: 2 * (64 + R + 46), h: 0 };
    rect.h = Math.max(...centres.map((c) => c.y)) + R + 40 - rect.y;
    const maskAt = (p: Pt) => centres.reduce((t, c, i) => t | (dist(p, c) < R ? 1 << i : 0), 0);
    const inRect = (p: Pt) => p.x > rect.x && p.x < rect.x + rect.w && p.y > rect.y && p.y < rect.y + rect.h;

    const sk = new Sketch();
    // Shading first, under the lines.
    if (shade) {
      const cmds = shadedOutline(centres, R, rect, (p) => inRect(p) && shade(maskAt(p)));
      if (cmds.length) sk.path(cmds, false, { fill: PALETTE.blue, stroke: "none", opacity: 0.2, part: "shaded" });
    }
    const R4 = { x: rect.x, y: rect.y }, R2 = { x: rect.x + rect.w, y: rect.y + rect.h };
    sk.polygon([R4, { x: R2.x, y: R4.y }, R2, { x: R4.x, y: R2.y }], { stroke: "ink", width: 2.2, fill: "none", part: "universal" });
    const ids = ["set-a", "set-b", "set-c"];
    centres.forEach((c, i) => sk.circle(c, R, { stroke: "ink", width: 2.4, fill: "none", part: ids[i] }));
    const symbolBox = textBox({ x: rect.x + 20, y: rect.y + 22 }, symbol, 26);
    sk.text({ x: rect.x + 20, y: rect.y + 22 }, symbol, 26, "ink", "universal");

    // Circle letters, outside each circle on the side away from the others.
    centres.forEach((c, i) => {
      const out = unit(sub(c, mid));
      const dir = sets === 2 ? unit({ x: out.x, y: -1.1 }) : i < 2 ? unit({ x: out.x, y: -1 }) : unit({ x: 0.9, y: 0.6 });
      sk.placeText(letters[i], 30, add(c, mul(dir, R)), dir, { min: 10, max: 40, part: ids[i] });
    });

    // The best spot in each region: the sample farthest from every circle and the frame.
    const clearance = (p: Pt) => Math.min(...centres.map((c) => Math.abs(dist(p, c) - R)), p.x - rect.x, rect.x + rect.w - p.x, p.y - rect.y, rect.y + rect.h - p.y);
    const samples: Array<{ p: Pt; mask: number; clear: number }> = [];
    for (let x = rect.x + 4; x < rect.x + rect.w; x += 4) for (let y = rect.y + 4; y < rect.y + rect.h; y += 4) {
      const p = { x, y };
      if (boxesOverlap(symbolBox, { x: x - 22, y: y - 14, w: 44, h: 28 })) continue;
      samples.push({ p, mask: maskAt(p), clear: clearance(p) });
    }
    const best = (ok: (s: (typeof samples)[number]) => boolean) => samples.filter(ok).sort((a, b) => b.clear - a.clear)[0]?.p;
    /** Like best, but prefers a point whose label leader can arrive without crossing region text. */
    const bestReachable = (ok: (s: (typeof samples)[number]) => boolean) => {
      const sorted = samples.filter(ok).sort((a, b) => b.clear - a.clear);
      return sorted.slice(0, 300).find((s) => s.clear > 6 && sk.approachClear(s.p, 8))?.p ?? sorted[0]?.p;
    };
    const order = sets === 2 ? ORDER2 : ORDER3;
    const textBoxes: Box[] = [];
    for (const m of order) {
      const v = regions.get(m);
      if (v === undefined) continue;
      const at = best((s) => s.mask === m && (m !== 0 || s.p.y > rect.y + rect.h * 0.55));
      if (!at) continue;
      const lines = typeof v === "number" ? [String(v)] : chunk(v);
      const size = typeof v === "number" ? 28 : 21;
      const lh = size * 1.15;
      lines.forEach((line, k) => {
        const c = { x: at.x, y: at.y + (k - (lines.length - 1) / 2) * lh };
        sk.text(c, line, size, "ink");
        textBoxes.push(textBox(c, line, size));
      });
    }

    // Anchors: each set on its outline (outer side); the intersection and the shaded region at
    // roomy points clear of the region text.
    const clearOfText = (p: Pt, gap: number) => textBoxes.every((b) => p.x < b.x - gap || p.x > b.x + b.w + gap || p.y < b.y - gap || p.y > b.y + b.h + gap);
    const setName = (i: number) => (names[i] ? `${names[i].slice(0, 26)} (${letters[i]})` : `Set ${letters[i]}`);
    centres.forEach((c, i) => {
      const out = unit(sub(c, mid));
      sk.part(ids[i], setName(i), add(c, mul(sets === 3 && i === 2 ? unit({ x: -0.6, y: 1 }) : unit({ x: out.x, y: 0.25 }), R)));
    });
    const all = sets === 2 ? 3 : 7;
    const interAt = bestReachable((s) => s.mask === all && clearOfText(s.p, 8)) ?? best((s) => s.mask === all)!;
    sk.part("intersection", letters.join(" ∩ "), interAt);
    sk.part("universal", `Universal set ${symbol}`, { x: rect.x, y: rect.y + rect.h * 0.78 });
    if (shade) {
      const taken = sk.parts.map((p) => p.anchor);
      const shadedAt = bestReachable((s) => inRect(s.p) && shade(s.mask) && clearOfText(s.p, 8) && taken.every((t) => dist(t, s.p) > 30)) ?? best((s) => inRect(s.p) && shade(s.mask));
      if (shadedAt) sk.part("shaded", `Shaded: ${shadeExpr.replace(/\s+/g, "").replace(/\bn\b/g, "∩").replace(/\bu\b/g, "∪").slice(0, 24)}`, shadedAt);
    }
    return sk.finish(10);
  },
};

function chunk(items: string[]): string[] {
  if (!items.length) return [];
  const per = Math.max(1, Math.min(4, Math.ceil(Math.sqrt(items.length))));
  const out: string[] = [];
  for (let i = 0; i < items.length; i += per) out.push(items.slice(i, i + per).join(", "));
  return out;
}

type Cmd = Parameters<Sketch["path"]>[0][number];

/**
 * The exact outline of the shaded region: every arc piece of every circle (split where circles
 * cross) whose two sides differ in shading, and the frame when the outside region is shaded. Each
 * piece runs with the shaded side on its right, so the loops chain end to start and holes wind the
 * other way (a nonzero fill then shades A' correctly).
 */
function shadedOutline(centres: Pt[], R: number, rect: Box, shaded: (p: Pt) => boolean): Cmd[] {
  type Piece = { c: Pt; a0: number; a1: number; from: Pt; to: Pt; sweep: boolean };
  const pieces: Piece[] = [];
  centres.forEach((c, i) => {
    const cuts: number[] = [];
    centres.forEach((o, j) => {
      if (i === j) return;
      const d = dist(c, o);
      if (d >= 2 * R || d === 0) return;
      const base = Math.atan2(o.y - c.y, o.x - c.x), half = Math.acos(d / (2 * R));
      cuts.push(norm(base - half), norm(base + half));
    });
    cuts.sort((a, b) => a - b);
    const bounds = cuts.length ? cuts : [0, Math.PI];
    for (let k = 0; k < bounds.length; k++) {
      const a0 = bounds[k], a1 = k + 1 < bounds.length ? bounds[k + 1] : bounds[0] + 2 * Math.PI;
      if (a1 - a0 < 1e-6) continue;
      const am = (a0 + a1) / 2;
      const inside = shaded(polar(c, R - 1.5, am)), outside = shaded(polar(c, R + 1.5, am));
      if (inside === outside) continue;
      // Increasing screen angle keeps the circle's inside on the right.
      pieces.push(inside ? { c, a0, a1, from: polar(c, R, a0), to: polar(c, R, a1), sweep: true } : { c, a0: a1, a1: a0, from: polar(c, R, a1), to: polar(c, R, a0), sweep: false });
    }
  });
  const cmds: Cmd[] = [];
  const used = new Set<number>();
  for (let s = 0; s < pieces.length; s++) {
    if (used.has(s)) continue;
    let cur = s;
    cmds.push({ k: "M", p: pieces[s].from });
    for (let guard = 0; guard < pieces.length + 1; guard++) {
      used.add(cur);
      const p = pieces[cur];
      cmds.push({ k: "A", c: p.c, r: R, to: p.to, large: Math.abs(p.a1 - p.a0) > Math.PI, sweep: p.sweep });
      const next = pieces.findIndex((q, j) => !used.has(j) && dist(q.from, p.to) < 0.5);
      if (next < 0) break;
      cur = next;
    }
  }
  // The frame, clockwise (inside on the right), when the region outside every circle is shaded.
  const corner = { x: rect.x + 3, y: rect.y + 3 };
  if (shaded(corner)) {
    const a = { x: rect.x, y: rect.y }, b = { x: rect.x + rect.w, y: rect.y }, c = { x: rect.x + rect.w, y: rect.y + rect.h }, d = { x: rect.x, y: rect.y + rect.h };
    cmds.push({ k: "M", p: a }, { k: "L", p: b }, { k: "L", p: c }, { k: "L", p: d }, { k: "L", p: a });
  }
  return cmds;
}
const norm = (a: number) => ((a % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);

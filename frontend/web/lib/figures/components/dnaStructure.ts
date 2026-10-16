import type { FigureComponent, FigureParams, FigurePart, FigureShape, Ink, Pt } from "../types";

type Base = "A" | "T" | "G" | "C";
const PAIR: Record<Base, Base> = { A: "T", T: "A", G: "C", C: "G" };
const NAME: Record<Base, string> = { A: "Adenine (A)", T: "Thymine (T)", G: "Guanine (G)", C: "Cytosine (C)" };
const INK: Record<Base, Ink> = { A: "#16a34a", T: "#dc2626", G: "#d97706", C: "#2563eb" };
const PURINE: Record<Base, boolean> = { A: true, G: true, T: false, C: false };

/** The complementary strand, base by base (A–T, C–G), read in the same left-to-right order. */
export function complement(seq: string): string {
  return [...seq.toUpperCase()].map((b) => PAIR[b as Base] ?? "").join("");
}
/** Hydrogen bonds in a base pair: A–T two, C–G three. */
export function hydrogenBonds(base: string): 2 | 3 {
  return /^[GC]$/i.test(base) ? 3 : 2;
}
export function cleanSequence(v: unknown, fallback = "ATGCAT"): string {
  const s = String(v ?? "").toUpperCase().replace(/[^ATGC]/g, "").slice(0, 10);
  return s.length ? s : fallback;
}

const fmt = (n: number) => Number(n.toFixed(2));

/**
 * DNA as a flat ladder: two antiparallel sugar–phosphate backbones (5′→3′ along the top, 3′→5′ along
 * the bottom), each rung a base pair the code completes from the given strand (A–T, C–G), a purine
 * (A, G: the longer piece) always opposite a pyrimidine (T, C), joined by two hydrogen bonds (A–T) or
 * three (C–G), drawn as dashes. One nucleotide and one base pair are outlined so a label can name them.
 */
export const dnaStructure: FigureComponent = {
  name: "dnaStructure",
  title: "DNA structure: two antiparallel sugar–phosphate backbones, complementary base pairs (A–T, C–G) joined by hydrogen bonds",
  params: `sequence (one strand, 5′→3′, letters A T G C only, 2-10 bases, default "ATGCAT"); the code writes the complementary strand (A–T, C–G), with 2 hydrogen bonds per A–T pair and 3 per C–G pair.`,
  match: /\bDNA (structure|double helix|molecule|base pairing|replication|strands?)\b|\bstructure of DNA\b|\bdouble helix\b|(?<!\d[\s,-]*)\bbase pair(s|ing)\b|\bcomplementary (base|strand)s?\b|\bsugar[- ]phosphate\b|\b(adenine|thymine|guanine|cytosine)\b(?=[\s\S]{0,120}\b(pairs?|bonds?|strand|helix)\b)|\bnucleotides?\b(?=[\s\S]{0,80}\b(sugar|phosphate|deoxyribose|strand|helix|bonded)\b)/i,
  parts: [
    { id: "backbone", name: "Sugar–phosphate backbone" },
    { id: "phosphate", name: "Phosphate" },
    { id: "sugar", name: "Deoxyribose sugar" },
    { id: "base", name: "Base" },
    { id: "base-pair", name: "Base pair" },
    { id: "hydrogen-bonds", name: "Hydrogen bonds" },
    { id: "nucleotide", name: "Nucleotide" },
    { id: "adenine", name: NAME.A },
    { id: "thymine", name: NAME.T },
    { id: "guanine", name: NAME.G },
    { id: "cytosine", name: NAME.C },
  ],
  build(params: FigureParams) {
    const top = cleanSequence(params.sequence) as string;
    const bottom = complement(top);
    const n = top.length;
    const P = 86, left = 76;
    const W = left * 2 + n * P, H = 384;
    const Ts = 104, Bs = 280; // sugar centres, top and bottom strands
    const X = (i: number) => left + (i + 0.5) * P;
    const SUGAR = 15, GAP = 22, BW = 32;
    const LONG = (Bs - Ts - 2 * SUGAR - GAP) * 0.6, SHORT = Bs - Ts - 2 * SUGAR - GAP - LONG;
    const shapes: FigureShape[] = [];

    // Backbones: a ribbon each, phosphates between the sugars. Top 5′→3′ left to right, so each top
    // nucleotide's phosphate is on its left; the bottom strand runs the other way (phosphate on its right).
    const ribbon = (y: number, x0: number, x1: number) => shapes.push({ t: "path", part: "backbone", d: `M${fmt(x0)} ${y - 6} H${fmt(x1)} V${y + 6} H${fmt(x0)} Z`, fill: "#c4b5fd", stroke: "ink", width: 1.4 });
    ribbon(Ts, X(0) - P / 2 - 14, X(n - 1) + 22);
    ribbon(Bs, X(0) - 22, X(n - 1) + P / 2 + 14);
    const pentagon = (c: Pt, flip: boolean) => {
      const pts = [0, 1, 2, 3, 4].map((k) => { const a = -Math.PI / 2 + (k * 2 * Math.PI) / 5; return { x: c.x + SUGAR * Math.cos(a), y: c.y + (flip ? -1 : 1) * SUGAR * Math.sin(a) }; });
      return pts.map((p, k) => `${k ? "L" : "M"}${fmt(p.x)} ${fmt(p.y)}`).join(" ") + " Z";
    };
    const phosphate = (c: Pt) => {
      shapes.push({ t: "circle", part: "phosphate", cx: fmt(c.x), cy: c.y, r: 12, fill: "#7c3aed", stroke: "ink", width: 1.6 });
      shapes.push({ t: "text", part: "phosphate", x: fmt(c.x), y: c.y + 5, text: "P", size: 14, anchor: "middle", fill: "#ffffff" });
    };
    for (let i = 0; i < n; i++) {
      phosphate({ x: X(i) - P / 2, y: Ts });
      phosphate({ x: X(i) + P / 2, y: Bs });
    }
    // Bases (purines long, pyrimidines short, so every rung is the same length) and their hydrogen bonds.
    const baseRect = (b: Base, x: number, y0: number, y1: number, part: string) => {
      shapes.push({ t: "path", part, d: `M${fmt(x - BW / 2)} ${fmt(y0)} H${fmt(x + BW / 2)} V${fmt(y1)} H${fmt(x - BW / 2)} Z`, fill: INK[b], stroke: "ink", width: 1.6 });
      shapes.push({ t: "text", part, x: fmt(x), y: fmt((y0 + y1) / 2 + 7), text: b, size: 20, anchor: "middle", fill: "#ffffff" });
    };
    const partOf: Record<Base, string> = { A: "adenine", T: "thymine", G: "guanine", C: "cytosine" };
    const lastAt: Partial<Record<Base, Pt>> = {};
    let bondY = 0;
    for (let i = 0; i < n; i++) {
      const x = X(i);
      const t = top[i] as Base, b = bottom[i] as Base;
      const tLen = PURINE[t] ? LONG : SHORT, bLen = PURINE[b] ? LONG : SHORT;
      const tEnd = Ts + SUGAR + tLen, bStart = Bs - SUGAR - bLen;
      baseRect(t, x, Ts + SUGAR - 2, tEnd, i === 0 ? "base" : partOf[t]);
      baseRect(b, x, bStart, Bs - SUGAR + 2, partOf[b]);
      // A letter's own label points at its rightmost base (a short leader from the right margin), never
      // at the first top base, which "base" names.
      if (i > 0) lastAt[t] = { x: x + BW / 2 - 6, y: (Ts + SUGAR + tEnd) / 2 - 12 };
      lastAt[b] = { x: x + BW / 2 - 6, y: (bStart + Bs - SUGAR) / 2 - 12 };
      const k = hydrogenBonds(t);
      const offs = k === 3 ? [-10, 0, 10] : [-6, 6];
      bondY = (tEnd + bStart) / 2;
      for (const o of offs) shapes.push({ t: "path", part: "hydrogen-bonds", d: `M${fmt(x + o)} ${fmt(tEnd + 3)} V${fmt(bStart - 3)}`, stroke: "ink", width: 2.2, dash: "3 3", fill: "none" });
    }
    for (let i = 0; i < n; i++) {
      shapes.push({ t: "path", part: "sugar", d: pentagon({ x: X(i), y: Ts }, false), fill: "#fde68a", stroke: "ink", width: 1.6 });
      shapes.push({ t: "path", part: "sugar", d: pentagon({ x: X(i), y: Bs }, true), fill: "#fde68a", stroke: "ink", width: 1.6 });
    }
    // Strand ends: 5′ and 3′, antiparallel.
    const end = (x: number, y: number, text: string, anchor: "start" | "end") => shapes.push({ t: "text", part: "backbone", x: fmt(x), y: y + 7, text, size: 20, anchor, fill: "ink" });
    // Above and below the strands' ends, so the labels' leaders reach the ends unobstructed.
    end(X(0) - P / 2 - 14, Ts - 30, "5′", "start");
    end(X(n - 1) + 22, Ts - 30, "3′", "end");
    end(X(0) - 22, Bs + 30, "3′", "start");
    end(X(n - 1) + P / 2 + 14, Bs + 30, "5′", "end");

    // Outlines: the first top nucleotide (phosphate + sugar + base) and the last base pair.
    const t0 = top[0] as Base;
    const nucBottom = Ts + SUGAR + (PURINE[t0] ? LONG : SHORT) + 4;
    const nx0 = X(0) - P / 2 - 17, nx1 = X(0) + SUGAR + 6;
    shapes.push({ t: "path", part: "nucleotide", d: `M${fmt(nx0)} ${Ts - 22} H${fmt(nx1)} V${fmt(nucBottom)} H${fmt(nx0)} Z`, stroke: "#16a34a", width: 2, dash: "6 4", fill: "none" });
    const xl = X(n - 1);
    const px0 = xl - BW / 2 - 7, px1 = xl + BW / 2 + 7;
    shapes.push({ t: "path", part: "base-pair", d: `M${fmt(px0)} ${Ts + SUGAR - 6} H${fmt(px1)} V${Bs - SUGAR + 6} H${fmt(px0)} Z`, stroke: "#dc2626", width: 2, dash: "6 4", fill: "none" });

    const parts: FigurePart[] = [
      // Anchors at the strands' ends, where a leader arrives level with the strand without running along it.
      { id: "backbone", name: "Sugar–phosphate backbone", anchor: { x: X(n - 1) + 19, y: Ts } },
      { id: "phosphate", name: "Phosphate", anchor: { x: X(0) - P / 2, y: Ts } },
      { id: "sugar", name: "Deoxyribose sugar", anchor: { x: X(0), y: Bs - 2 } },
      { id: "base", name: NAME[t0], anchor: { x: X(0), y: (Ts + SUGAR + nucBottom - 4) / 2 + 12 } },
      { id: "hydrogen-bonds", name: `Hydrogen bonds (${hydrogenBonds(top[n - 1])})`, anchor: { x: xl, y: bondY } },
      { id: "base-pair", name: `Base pair (${top[n - 1]}–${bottom[n - 1]})`, anchor: { x: px1, y: Ts + SUGAR + 8 } },
      { id: "nucleotide", name: "Nucleotide", anchor: { x: nx0, y: (Ts + nucBottom) / 2 } },
    ];
    const absent: FigurePart[] = [];
    for (const b of ["A", "T", "G", "C"] as Base[]) {
      const at = lastAt[b];
      if (at) parts.push({ id: partOf[b], name: NAME[b], anchor: at });
      else absent.push({ id: partOf[b], name: NAME[b], anchor: { x: X(0), y: (Ts + Bs) / 2 } });
    }
    return { w: W, h: H, shapes, parts: parts.concat(absent) };
  },
};

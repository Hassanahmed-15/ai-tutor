import type { FigureComponent, FigureParams, Ink, Pt } from "../types";
import { Sketch, textW, polar, rad } from "./mathsKit";
import { CHEM, atomText, bond, chemArrow, pick, softBox } from "./glucoseRings";

/**
 * A NUCLEOTIDE AND ATP, DRAWN AS IN THE TEXTBOOK. The pentose is the five-membered ring (ring O at
 * the back, carbons 1′–5′ numbered, front edge bold); the phosphate joins carbon 5′ through CH₂–O,
 * the base joins carbon 1′. A purine (A, G) is drawn as its two fused rings, a pyrimidine (C, T, U)
 * as one ring. Carbon 2′ carries OH in ribose (RNA, ATP) and only H in deoxyribose (DNA) — the
 * difference is highlighted. "atp": adenine + ribose + three phosphates, and its hydrolysis — water
 * breaks the bond to the last phosphate, giving ADP + Pᵢ and releasing energy.
 */

type Show = "nucleotide" | "atp";
type Base = "A" | "G" | "C" | "T" | "U";

const F = 18;
const R = 9.5;
const BASES: Record<Base, { name: string; purine: boolean; fill: Ink; stroke: Ink }> = {
  A: { name: "adenine", purine: true, fill: "#bbf7d0", stroke: "#16a34a" },
  G: { name: "guanine", purine: true, fill: "#fde68a", stroke: "#d97706" },
  C: { name: "cytosine", purine: false, fill: "#bfdbfe", stroke: "#2563eb" },
  T: { name: "thymine", purine: false, fill: "#fecaca", stroke: "#be123c" },
  U: { name: "uracil", purine: false, fill: "#ddd6fe", stroke: "#6d28d9" },
};
const P_FILL: Ink = "#fed7aa", P_STROKE: Ink = "#ea580c", NUM: Ink = "#2563eb";

export function parseBase(v: unknown): Base | undefined {
  const s = typeof v === "string" ? v.trim().toLowerCase() : "";
  if (!s) return undefined;
  for (const [k, b] of Object.entries(BASES) as Array<[Base, (typeof BASES)[Base]]>) if (s === k.toLowerCase() || s.startsWith(b.name.slice(0, 5))) return k;
  return undefined;
}

/** A nitrogenous base joined at `at` (its bonding N), extending right; returns its centre and right edge. */
function baseRings(sk: Sketch, at: Pt, base: Base, k: number, part: string) {
  const b = BASES[base];
  const r = 28 * k;
  const style = { fill: b.fill, stroke: b.stroke, width: 2.2, part };
  if (!b.purine) {
    const c = { x: at.x + r, y: at.y };
    sk.polygon(Array.from({ length: 6 }, (_, i) => polar(c, r, rad(180 + i * 60))), style);
    sk.text(c, base, 24, "#111827", part);
    return { c, right: c.x + r, top: c.y - r * 0.87, bottom: c.y + r * 0.87 };
  }
  // Purine: the five-membered ring (bonded to the sugar) fused to the six-membered ring on its right.
  const s = r; // shared edge = hexagon side
  const Rp = s / (2 * Math.sin(rad(36))), ap = s / (2 * Math.tan(rad(36)));
  const pc = { x: at.x + Rp, y: at.y };
  const pent = [180, 252, 324, 36, 108].map((a) => polar(pc, Rp, rad(a)));
  const edgeX = pc.x + ap;
  const hc = { x: edgeX + r * Math.cos(rad(30)), y: at.y };
  const hex = Array.from({ length: 6 }, (_, i) => polar(hc, r, rad(150 + i * 60)));
  sk.polygon(hex, style);
  sk.polygon(pent, style);
  sk.text(hc, base, 24, "#111827", part);
  return { c: hc, right: hc.x + r, top: hc.y - r, bottom: hc.y + r };
}

type NucOpts = { sugar: "ribose" | "deoxyribose"; base: Base; phosphates: number; k: number; parts: { sugar: string; base: string; phosphate: string; c2: string; c1?: string; c5?: string }; cutBond?: number };

/** One nucleotide (or ATP/ADP) with the sugar ring centred on c. */
function nucleotide(sk: Sketch, c: Pt, o: NucOpts) {
  const k = o.k;
  const P = (x: number, y: number): Pt => ({ x: c.x + x * k, y: c.y + y * k });
  const O4 = P(0, -40), C1 = P(44, -12), C2 = P(27, 34), C3 = P(-27, 34), C4 = P(-44, -12);
  const sp = o.parts.sugar;
  // The C2′ group (OH for ribose, H for deoxyribose): highlighted, the DNA/RNA difference.
  const c2End = P(27, 74);
  const c2Text = o.sugar === "ribose" ? "OH" : "H";
  softBox(sk, { x: c2End.x + (c2Text === "OH" ? textW("OH", F) / 2 - 6 : 0), y: c2End.y }, textW(c2Text, F) + 18, F + 12, CHEM.soft, o.parts.c2, { stroke: CHEM.hi });
  // Ring bonds: back edges thin, front edges bold.
  const ring: Array<[Pt, Pt, number, boolean, boolean]> = [[C4, O4, 2.4, false, true], [O4, C1, 2.4, true, false], [C1, C2, 4.2, false, false], [C2, C3, 6, false, false], [C3, C4, 4.2, false, false]];
  for (const [a, b, w, ra, rb] of ring) bond(sk, a, b, { ra: ra ? R : 0, rb: rb ? R : 0, width: w, part: sp });
  atomText(sk, O4, "O", F, CHEM.O, sp, "center");
  // Carbon numbers just outside each ring carbon.
  for (const [t, p, dx, dy] of [["1′", C1, 14, 10], ["2′", C2, 17, -8], ["3′", C3, -16, 6], ["4′", C4, -14, 10]] as Array<[string, Pt, number, number]>) sk.text({ x: p.x + dx, y: p.y + dy }, t, 14, NUM, sp);
  // C2′ and C3′ groups below the ring.
  bond(sk, C2, c2End, { rb: R, part: o.parts.c2 });
  atomText(sk, c2End, c2Text, F, c2Text === "OH" ? CHEM.O : "ink", o.parts.c2, "first");
  const c3End = P(-27, 74);
  bond(sk, C3, c3End, { rb: R, part: sp });
  atomText(sk, c3End, "HO", F, CHEM.O, sp, "last");
  // C5′: CH₂ up-left of C4′, then O, then the phosphate(s) in a row to the left.
  const C5 = P(-64, -54);
  bond(sk, C4, C5, { rb: R, part: o.parts.c5 ?? sp });
  const c5c = atomText(sk, C5, "CH₂", F, "ink", o.parts.c5 ?? sp, "first");
  sk.text({ x: C5.x - 6, y: C5.y + 18 }, "5′", 14, NUM, o.parts.c5 ?? sp);
  const O5 = { x: C5.x - 46, y: C5.y };
  bond(sk, C5, O5, { ra: R, rb: R, part: o.parts.phosphate });
  atomText(sk, O5, "O", F, CHEM.O, o.parts.phosphate, "center");
  const pr = 19;
  const ps: Pt[] = [];
  let prev = O5, prevR = R;
  for (let i = 0; i < o.phosphates; i++) {
    const pc = { x: prev.x - (i === 0 ? 46 : 62), y: C5.y };
    const part = o.parts.phosphate;
    bond(sk, prev, pc, { ra: prevR, rb: pr, part: o.cutBond === i ? "hydrolysed-bond" : part, width: 2.4, ...(o.cutBond === i ? { stroke: CHEM.hi, width: 3.2 } : {}) });
    sk.circle(pc, pr, { fill: P_FILL, stroke: P_STROKE, width: 2.2, part });
    sk.text(pc, "P", 19, "#111827", part);
    ps.push(pc);
    prev = pc;
    prevR = pr;
  }
  // Base on C1′.
  const N = { x: C1.x + 30 * k, y: C1.y };
  bond(sk, C1, N, { width: 2.4, part: o.parts.base });
  const b = baseRings(sk, N, o.base, k, o.parts.base);
  void c5c;
  return { O4, C1, C2, C3, C4, C5, O5, c2End, c3End, ps, base: b, N };
}

export const atpNucleotide: FigureComponent = {
  name: "atpNucleotide",
  title: "Nucleotide and ATP: phosphate, pentose sugar (ribose or deoxyribose, carbons 1′–5′) and nitrogenous base; or ATP (adenine, ribose, three phosphates) and its hydrolysis to ADP + Pᵢ releasing energy",
  params: `show ("nucleotide" default: phosphate + pentose + base | "atp": adenine + ribose + three phosphate groups, hydrolysed to ADP + Pᵢ); sugar (nucleotide: "deoxyribose" default — DNA, H on carbon 2′ | "ribose" — RNA, OH on carbon 2′; uracil implies ribose, thymine deoxyribose); base (nucleotide: "A" default, "G", "C", "T", "U" or the base's name — purines drawn as two rings, pyrimidines as one); hydrolysis (atp: true default — also draws ATP + H₂O → ADP + Pᵢ with the energy released; false: ATP alone). The atoms on each carbon follow from the sugar — never give them.`,
  match: /\b(ATP|adenosine triphosphate)\b(?=[\s\S]{0,100}\b(structure|ADP|hydroly\w*|phosphate groups?|ribose|adenine|bonds? between)\b)|\b(structure|hydrolysis) of (an? )?(ATP|adenosine triphosphate)\b|\badenosine (tri|di)phosphate\b|\bATP hydrolase\b|\bATP\s*(\+|and)\s*(H₂O|water)\b|\b(structure of (an? )?|a single |DNA |RNA )nucleotides?\b|\bnucleotides?\b(?=[\s\S]{0,80}\b(phosphate|pentose|deoxyribose|ribose|nitrogenous base|sugar)\b)|\bpentose sugars?\b|\bdeoxyribose\b(?=[\s\S]{0,80}\bribose\b)|\b(ribose|deoxyribose) (sugar|vs|versus|and|or)\b|\bpurines? (and|or|vs) pyrimidines?\b/i,
  parts: [
    { id: "phosphate-group", name: "Phosphate group" },
    { id: "pentose-sugar", name: "Pentose sugar" },
    { id: "nitrogenous-base", name: "Nitrogenous base" },
    { id: "c2-group", name: "Carbon 2′ group" },
    { id: "carbon-1", name: "Carbon 1′ (base attached)" },
    { id: "carbon-5", name: "Carbon 5′ (CH₂)" },
    { id: "adenine", name: "Adenine (base)" },
    { id: "ribose", name: "Ribose (pentose sugar)" },
    { id: "phosphate-groups", name: "Three phosphate groups" },
    { id: "hydrolysed-bond", name: "Bond broken by hydrolysis" },
    { id: "water", name: "Water (H₂O) added" },
    { id: "energy", name: "Energy released" },
    { id: "adp", name: "ADP (two phosphates)" },
    { id: "inorganic-phosphate", name: "Inorganic phosphate (Pᵢ)" },
    { id: "hydrolysis", name: "Hydrolysis (ATP hydrolase)" },
  ],
  build(params: FigureParams) {
    const show = pick<Show>(params.show ?? params.view ?? params.molecule, [["atp", /atp|adp|adenosine|triphos|energy/], ["nucleotide", /nucleo|dna|rna|mono/]], "nucleotide");
    const sk = new Sketch();
    if (show === "nucleotide") {
      const asked = parseBase(params.base);
      const sugarWord = String(params.sugar ?? params.type ?? "").toLowerCase();
      const sugar: "ribose" | "deoxyribose" = /deoxy|dna/.test(sugarWord) ? "deoxyribose" : /ribo|rna/.test(sugarWord) ? "ribose" : asked === "U" ? "ribose" : "deoxyribose";
      // Thymine is DNA-only and uracil RNA-only: the base follows the sugar if they disagree.
      const base: Base = asked === "T" && sugar === "ribose" ? "U" : asked === "U" && sugar === "deoxyribose" ? "T" : asked ?? "A";
      const n = nucleotide(sk, { x: 0, y: 0 }, { sugar, base, phosphates: 1, k: 1.45, parts: { sugar: "pentose-sugar", base: "nitrogenous-base", phosphate: "phosphate-group", c2: "c2-group", c1: "carbon-1", c5: "carbon-5" } });
      const b = BASES[base];
      sk.part("phosphate-group", "Phosphate group", { x: n.ps[0].x - 19, y: n.ps[0].y });
      sk.part("pentose-sugar", sugar === "ribose" ? "Ribose (pentose sugar)" : "Deoxyribose (pentose sugar)", { x: (n.C3.x + n.C4.x) / 2 - 1, y: (n.C3.y + n.C4.y) / 2 });
      sk.part("nitrogenous-base", `Base: ${b.name} (${b.purine ? "purine" : "pyrimidine"})`, { x: n.base.right - 2, y: n.base.c.y });
      sk.part("c2-group", sugar === "ribose" ? "OH on carbon 2′: ribose (RNA)" : "H on carbon 2′: deoxyribose (DNA)", { x: n.c2End.x + (sugar === "ribose" ? textW("OH", F) + 3 : 13), y: n.c2End.y });
      sk.part("carbon-5", "Carbon 5′ (CH₂)", { x: n.C5.x + 2, y: n.C5.y - 12 });
      return sk.finish(16, { w: 560, h: 260 });
    }
    const hydrolysis = !/^(false|no|0|off|none)$/i.test(String(params.hydrolysis ?? "true"));
    const k = 1.1;
    const top = nucleotide(sk, { x: 0, y: 0 }, {
      sugar: "ribose", base: "A", phosphates: 3, k,
      parts: { sugar: "ribose", base: "adenine", phosphate: "phosphate-groups", c2: "ribose" },
      cutBond: hydrolysis ? 2 : undefined,
    });
    sk.part("adenine", "Adenine (base)", { x: top.base.right - 2, y: top.base.c.y });
    sk.part("ribose", "Ribose (pentose sugar)", { x: top.C2.x - 7, y: top.C2.y });
    const pLeft = top.ps[top.ps.length - 1];
    if (!hydrolysis) {
      sk.part("phosphate-groups", "Three phosphate groups", { x: pLeft.x - 19, y: pLeft.y });
      return sk.finish(16, { w: 560, h: 260 });
    }
    sk.part("phosphate-groups", "Three phosphate groups", { x: pLeft.x - 19, y: pLeft.y + 3 });
    // The bond to the last phosphate is the one water breaks: marked with a cut.
    const cut = { x: (top.ps[1].x + top.ps[2].x) / 2, y: top.ps[1].y };
    sk.line([{ x: cut.x - 7, y: cut.y - 25 }, { x: cut.x + 4, y: cut.y - 5 }, { x: cut.x - 4, y: cut.y + 5 }, { x: cut.x + 7, y: cut.y + 25 }], { stroke: CHEM.hi, width: 2.6, part: "hydrolysed-bond" });
    // Hydrolysis arrow down from the phosphates, water joining from the left.
    const ax = top.ps[1].x, bot = 210;
    const a0 = { x: ax, y: top.ps[1].y + 32 }, a1 = { x: ax, y: bot + top.ps[1].y - 34 };
    chemArrow(sk, a0, a1, { part: "hydrolysis", width: 2.6 });
    const mid = (a0.y + a1.y) / 2;
    const wText = atomText(sk, { x: ax - 92, y: mid - 26 }, "H₂O", F, CHEM.water, "water", "first");
    sk.path([{ k: "M", p: { x: ax - 44, y: mid - 26 } }, { k: "A", c: { x: ax - 44, y: mid + 8 }, r: 34, to: { x: ax - 10, y: mid + 8 }, large: false, sweep: true }], false, { stroke: CHEM.water, width: 2.2, fill: "none", part: "water" });
    sk.polygon([{ x: ax - 4, y: mid + 18 }, { x: ax - 16, y: mid + 8 }, { x: ax - 4, y: mid + 4 }], { fill: CHEM.water, stroke: CHEM.water, width: 1, part: "water" });
    // ADP + Pᵢ, with the energy released where the bond broke.
    const adp = nucleotide(sk, { x: 0, y: bot }, { sugar: "ribose", base: "A", phosphates: 2, k, parts: { sugar: "adp", base: "adp", phosphate: "adp", c2: "adp" } });
    const piC = { x: adp.ps[1].x - 104, y: adp.ps[1].y };
    sk.text({ x: (piC.x + adp.ps[1].x) / 2 + 4, y: piC.y }, "+", 22, "ink");
    sk.circle(piC, 19, { fill: P_FILL, stroke: P_STROKE, width: 2.2, part: "inorganic-phosphate" });
    sk.text(piC, "Pᵢ", 18, "#111827", "inorganic-phosphate");
    // Energy: a burst above the gap between ADP and Pᵢ.
    const ec = { x: (piC.x + adp.ps[1].x) / 2 + 4, y: piC.y - 52 };
    const star: Pt[] = [];
    for (let i = 0; i < 16; i++) star.push(polar(ec, i % 2 ? 9 : 21, rad(-90 + i * 22.5)));
    sk.polygon(star, { fill: "#fde047", stroke: "#ca8a04", width: 2, part: "energy" });
    sk.part("water", "Water (H₂O) added", { x: wText.x - textW("H₂O", F) / 2 - 4, y: wText.y });
    sk.part("hydrolysed-bond", "Bond broken by hydrolysis", { x: cut.x - 7, y: cut.y - 25 });
    sk.part("energy", "Energy released", { x: ec.x - 20, y: ec.y - 4 });
    sk.part("inorganic-phosphate", "Inorganic phosphate (Pᵢ)", { x: piC.x - 19, y: piC.y });
    sk.part("adp", "ADP (two phosphates)", { x: adp.base.right - 2, y: adp.base.c.y });
    sk.part("hydrolysis", "Hydrolysis (ATP hydrolase)", { x: ax + 1, y: a0.y + 18 });
    return sk.finish(16, { w: 560, h: 260 });
  },
};

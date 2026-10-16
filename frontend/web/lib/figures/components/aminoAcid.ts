import { fitText } from "../cuts";
import type { FigureComponent, FigureParams, Ink, Pt } from "../types";
import { Sketch, textW } from "./mathsKit";
import { CHEM, atomText, bond, chemArrow, pick, softBox } from "./glucoseRings";

/**
 * AMINO ACIDS AND THE PEPTIDE BOND, DRAWN AS IN THE TEXTBOOK. The general structure: the central
 * (α) carbon carrying a hydrogen, the amine group (–NH₂), the carboxyl group (–COOH) and the R group,
 * each group shaded. "peptide": two amino acids condense — the OH of one carboxyl group and an H of
 * the next amine group leave as water — and the C–N peptide bond joins them into a dipeptide.
 * "hydrolysis" is the reverse: water is added and the peptide bond breaks. R groups are the board's
 * (glycine, alanine… or a formula such as CH₃); the default is the general R / R₁, R₂.
 */

type Show = "general" | "peptide" | "hydrolysis";

const F = 18, F0 = 18;
const R = 9.5, R0 = 9.5;
const SHADE = { amine: "#bfdbfe" as Ink, carboxyl: "#fecdd3" as Ink, r: "#bbf7d0" as Ink };
const EDGE = { amine: "#2563eb" as Ink, carboxyl: "#be123c" as Ink, r: "#16a34a" as Ink };

/** Side chains of common amino acids (as drawn on an α-carbon: the first atom bonds). */
const R_GROUPS: Record<string, string> = {
  glycine: "H", gly: "H", alanine: "CH₃", ala: "CH₃", serine: "CH₂OH", ser: "CH₂OH", cysteine: "CH₂SH", cys: "CH₂SH",
  valine: "CH(CH₃)₂", val: "CH(CH₃)₂", "aspartic acid": "CH₂COOH", aspartate: "CH₂COOH", asp: "CH₂COOH", lysine: "(CH₂)₄NH₂", lys: "(CH₂)₄NH₂",
  phenylalanine: "CH₂C₆H₅", phe: "CH₂C₆H₅", threonine: "CH(OH)CH₃", thr: "CH(OH)CH₃", methionine: "(CH₂)₂SCH₃", met: "(CH₂)₂SCH₃",
};
const SUB: Record<string, string> = { "0": "₀", "1": "₁", "2": "₂", "3": "₃", "4": "₄", "5": "₅", "6": "₆" };

/** The R group text and the amino acid's name (when the board named one). */
export function rGroup(v: unknown, fallback: string): { text: string; name?: string } {
  const s = typeof v === "string" ? v.trim() : "";
  if (!s) return { text: fallback };
  const key = s.toLowerCase().replace(/\s*\(.*\)$/, "");
  if (R_GROUPS[key]) return { text: R_GROUPS[key], name: key.length > 3 ? key : undefined };
  // A formula the board wrote (CH3 → CH₃); anything else is not trusted as chemistry.
  if (/^[A-Za-z0-9()₀-₉]{1,10}$/.test(s) && /^(R\d?|[A-Z][a-z]?[A-Za-z0-9()₀-₉]*)$/.test(s)) return { text: fitText(s.replace(/(?<=[A-Za-z)])(\d)/g, (d) => SUB[d] ?? d), 10) };
  return { text: fallback };
}

type AA = { N: Pt; Ca: Pt; C: Pt; hUp: Pt; hDn: Pt; oUp: Pt; oh: Pt; rAt: Pt; hA: Pt };

/** One amino acid centred on its α-carbon. `leave` marks atoms that leave as water (or arrive from it). */
function drawAminoAcid(sk: Sketch, c: Pt, r: string, o: { shade?: boolean; part?: string; rPart?: string; leaveOH?: boolean; leaveH?: boolean; tag?: Ink; k?: number; f?: number }): AA {
  const k = o.k ?? 1, F = o.f ?? F0, R = R0 * (F / F0);
  const N = { x: c.x - 80 * k, y: c.y }, C = { x: c.x + 80 * k, y: c.y };
  const hUp = { x: N.x - 30 * k, y: c.y - 36 * k }, hDn = { x: N.x - 30 * k, y: c.y + 36 * k };
  const hA = { x: c.x, y: c.y - 48 * k }, rAt = { x: c.x, y: c.y + 50 * k };
  const oUp = { x: C.x + 30 * k, y: c.y - 36 * k }, oh = { x: C.x + 30 * k, y: c.y + 36 * k };
  const part = o.part;
  if (o.shade) {
    softBox(sk, { x: N.x - 15 * k, y: c.y }, 30 * k + 2.2 * F, 72 * k + 1.9 * F, SHADE.amine, "amine-group", { opacity: 0.38 });
    softBox(sk, { x: C.x + 15 * k + 0.25 * F, y: c.y }, 30 * k + 2.6 * F, 72 * k + 1.9 * F, SHADE.carboxyl, "carboxyl-group", { opacity: 0.38 });
    softBox(sk, { x: rAt.x + textW(r, F) / 2 - F * 0.33, y: rAt.y }, Math.max(1.9 * F, textW(r, F) + F), 1.7 * F, SHADE.r, o.rPart ?? "r-group", { opacity: 0.45 });
  }
  bond(sk, N, c, { ra: R, rb: R, part });
  bond(sk, c, C, { ra: R, rb: R, part });
  bond(sk, N, hUp, { ra: R, rb: 8, part: o.shade ? "amine-group" : part });
  bond(sk, N, hDn, { ra: R, rb: 8, part: o.shade ? "amine-group" : part });
  bond(sk, c, hA, { ra: R, rb: 8, part: o.shade ? "hydrogen" : part });
  bond(sk, c, rAt, { ra: R, rb: R, part: o.rPart ?? (o.shade ? "r-group" : part) });
  bond(sk, C, oUp, { ra: R, rb: 8, part: o.shade ? "carboxyl-group" : part, double: "center", gap: 5 });
  bond(sk, C, oh, { ra: R, rb: 8, part: o.shade ? "carboxyl-group" : part });
  atomText(sk, N, "N", F, EDGE.amine, o.shade ? "amine-group" : part, "center");
  atomText(sk, c, "C", F, "ink", o.shade ? "alpha-carbon" : part, "center");
  atomText(sk, C, "C", F, "ink", o.shade ? "carboxyl-group" : part, "center");
  atomText(sk, hUp, "H", F, "ink", o.shade ? "amine-group" : part, "center");
  atomText(sk, hDn, "H", F, o.leaveH ? o.tag ?? CHEM.water : "ink", o.leaveH ? "water" : o.shade ? "amine-group" : part, "center");
  atomText(sk, hA, "H", F, "ink", o.shade ? "hydrogen" : part, "center");
  atomText(sk, rAt, r, F, EDGE.r, o.rPart ?? (o.shade ? "r-group" : part), "first");
  atomText(sk, oUp, "O", F, CHEM.O, o.shade ? "carboxyl-group" : part, "center");
  atomText(sk, oh, "OH", F, o.leaveOH ? o.tag ?? CHEM.water : CHEM.O, o.leaveOH ? "water" : o.shade ? "carboxyl-group" : part, "first");
  return { N, Ca: c, C, hUp, hDn, oUp, oh, rAt, hA };
}

/** A dipeptide centred on its peptide bond; returns the bond's ends. */
function dipeptide(sk: Sketch, c: Pt, r1: string, r2: string, o: { part: string; bondPart: string; broken?: boolean }) {
  const N1 = { x: c.x - 200, y: c.y }, A1 = { x: c.x - 120, y: c.y }, C1 = { x: c.x - 40, y: c.y };
  const N2 = { x: c.x + 40, y: c.y }, A2 = { x: c.x + 120, y: c.y }, C2 = { x: c.x + 200, y: c.y };
  const O1 = { x: C1.x, y: c.y - 46 }, H2 = { x: N2.x, y: c.y + 46 };
  // The peptide bond's group (C=O and N–H) is shaded; the C–N bond itself is drawn bold.
  softBox(sk, { x: c.x, y: c.y }, 112, 124, CHEM.soft, o.bondPart, { stroke: CHEM.hi });
  const p = o.part;
  bond(sk, N1, A1, { ra: R, rb: R, part: p });
  bond(sk, A1, C1, { ra: R, rb: R, part: p });
  bond(sk, C1, N2, { ra: R, rb: R, part: o.bondPart, width: 4.5, stroke: CHEM.hi, dash: o.broken ? "6 5" : undefined });
  bond(sk, N2, A2, { ra: R, rb: R, part: p });
  bond(sk, A2, C2, { ra: R, rb: R, part: p });
  bond(sk, C1, O1, { ra: R, rb: 8, part: o.bondPart, double: "center", gap: 5 });
  bond(sk, N2, H2, { ra: R, rb: 8, part: o.bondPart });
  for (const [from, to] of [[N1, { x: N1.x - 30, y: c.y - 36 }], [N1, { x: N1.x - 30, y: c.y + 36 }]] as Array<[Pt, Pt]>) {
    bond(sk, from, to, { ra: R, rb: 8, part: p });
    atomText(sk, to, "H", F, "ink", p, "center");
  }
  for (const A of [A1, A2]) {
    bond(sk, A, { x: A.x, y: c.y - 48 }, { ra: R, rb: 8, part: p });
    atomText(sk, { x: A.x, y: c.y - 48 }, "H", F, "ink", p, "center");
    bond(sk, A, { x: A.x, y: c.y + 50 }, { ra: R, rb: R, part: "r-group" });
  }
  const oUp = { x: C2.x + 30, y: c.y - 36 }, oh = { x: C2.x + 30, y: c.y + 36 };
  bond(sk, C2, oUp, { ra: R, rb: 8, part: p, double: "center", gap: 5 });
  bond(sk, C2, oh, { ra: R, rb: 8, part: p });
  atomText(sk, N1, "N", F, EDGE.amine, p, "center");
  atomText(sk, A1, "C", F, "ink", p, "center");
  atomText(sk, C1, "C", F, "ink", o.bondPart, "center");
  atomText(sk, N2, "N", F, EDGE.amine, o.bondPart, "center");
  atomText(sk, A2, "C", F, "ink", p, "center");
  atomText(sk, C2, "C", F, "ink", p, "center");
  atomText(sk, O1, "O", F, CHEM.O, o.bondPart, "center");
  atomText(sk, H2, "H", F, "ink", o.bondPart, "center");
  atomText(sk, { x: A1.x, y: c.y + 50 }, r1, F, EDGE.r, "r-group", "first");
  atomText(sk, { x: A2.x, y: c.y + 50 }, r2, F, EDGE.r, "r-group", "first");
  atomText(sk, oUp, "O", F, CHEM.O, p, "center");
  atomText(sk, oh, "OH", F, CHEM.O, p, "first");
  return { C1, N2, O1, H2, N1, A1, A2, C2, oh };
}

export const aminoAcid: FigureComponent = {
  name: "aminoAcid",
  title: "Amino acid structure: the general formula (amine group, carboxyl group, R group on the central carbon), or two amino acids joined by condensation into a dipeptide with a peptide bond (and its hydrolysis)",
  params: `show ("general" default: one amino acid, groups shaded | "peptide": two amino acids → dipeptide + H₂O, condensation forming the peptide bond | "hydrolysis": dipeptide + H₂O → two amino acids); r (general: the R group or amino acid name, e.g. "glycine", "alanine", "CH3"; default "R"); r1, r2 (peptide/hydrolysis: the two R groups or amino acid names; default "R₁", "R₂"). Atoms and bonds are fixed by the chemistry — never give them.`,
  match: /\b(general|basic) (structure|formula) of (an? )?amino acids?\b|\bamino acids?\b(?=[\s\S]{0,80}\b(R[- ]groups?|amine groups?|amino groups?|carboxyl(ic)? groups?|general (structure|formula)|structure of|peptide bonds?|condensation|dipeptides?)\b)|\bstructure of (an? )?amino acids?\b|\bpeptide bonds?\b|\bdipeptides?\b|\bR[- ]groups?\b(?=[\s\S]{0,60}\bamino\b)|\b(carboxyl|amine) groups?\b(?=[\s\S]{0,60}\bamino acids?\b)/i,
  parts: [
    { id: "amine-group", name: "Amine group (–NH₂)" },
    { id: "carboxyl-group", name: "Carboxyl group (–COOH)" },
    { id: "r-group", name: "R group (side chain)" },
    { id: "alpha-carbon", name: "Central (α) carbon" },
    { id: "hydrogen", name: "Hydrogen atom" },
    { id: "amino-acid", name: "Amino acid" },
    { id: "peptide-bond", name: "Peptide bond" },
    { id: "dipeptide", name: "Dipeptide" },
    { id: "water", name: "Water released (H₂O)" },
    { id: "condensation", name: "Condensation reaction" },
    { id: "hydrolysis", name: "Hydrolysis reaction" },
  ],
  build(params: FigureParams) {
    const show = pick<Show>(params.show ?? params.view ?? params.reaction, [["hydrolysis", /hydroly|break|digest/], ["peptide", /peptide|condens|dipep|join|bond/], ["general", /general|single|one|structure/]], "general");
    const sk = new Sketch();
    if (show === "general") {
      const r = rGroup(params.r ?? params.rGroup ?? params.aminoAcid ?? params.name, "R");
      // One molecule fills the frame: drawn half as large again, with larger letters.
      const FG = 26;
      const a = drawAminoAcid(sk, { x: 0, y: 0 }, r.text, { shade: true, k: 1.55, f: FG });
      // Anchors just beside the letters (a dot on a letter would hide it).
      const off = FG * 0.62;
      sk.part("amine-group", "Amine group (–NH₂)", { x: a.hUp.x - off, y: a.hUp.y + 2 });
      sk.part("carboxyl-group", "Carboxyl group (–COOH)", { x: a.oUp.x + off, y: a.oUp.y + 2 });
      const rw = textW(r.text, FG);
      const rName = r.text === "R" ? "R group (side chain)" : r.name ? fitName(`R group: ${r.name} (${r.text})`) : fitName(`R group (${r.text})`);
      sk.part("r-group", rName.length <= 34 ? rName : `R group (${r.text})`, { x: a.rAt.x + rw - FG * 0.1, y: a.rAt.y + 4 });
      sk.part("alpha-carbon", "Central (α) carbon", { x: a.Ca.x - FG * 0.45, y: a.Ca.y + FG * 0.45 });
      sk.part("hydrogen", "Hydrogen atom", { x: a.hA.x + FG * 0.54, y: a.hA.y });
      return sk.finish(16, { w: 560, h: 260 });
    }
    const r1 = rGroup(params.r1 ?? params.first, "R₁").text, r2 = rGroup(params.r2 ?? params.second, "R₂").text;
    const condensing = show === "peptide";
    const top = 0, bot = 250;
    // Reactants on top, products below; the arrow and the water between.
    let waterAt: Pt, aaAnchor: Pt, dipAnchor: Pt, bondAnchor: Pt, rAnchor: Pt;
    if (condensing) {
      const a1 = drawAminoAcid(sk, { x: -170, y: top }, r1, { part: "amino-acid", rPart: "r-group", leaveOH: true });
      const a2 = drawAminoAcid(sk, { x: 170, y: top }, r2, { part: "amino-acid", rPart: "r-group", leaveH: true });
      // The atoms that leave as water: the carboxyl OH of the first, an amine H of the second.
      const x0 = a1.oh.x - 13, x1 = a2.hDn.x + 13;
      softBox(sk, { x: (x0 + x1) / 2, y: a1.oh.y }, x1 - x0, F + 12, "none", "water", { stroke: CHEM.water, dash: "5 4" });
      const d = dipeptide(sk, { x: 0, y: bot }, r1, r2, { part: "dipeptide", bondPart: "peptide-bond" });
      aaAnchor = { x: a1.hUp.x - 11, y: a1.hUp.y };
      rAnchor = { x: a1.rAt.x - 11, y: a1.rAt.y };
      dipAnchor = { x: d.N1.x - 30 - 11, y: bot - 36 };
      bondAnchor = { x: d.N2.x + 16, y: bot - 60 };
      waterAt = arrowWithWater(sk, { x: 0, y: a1.oh.y + 22 }, { x: 0, y: bot - 72 }, "condensation", "out");
    } else {
      const d = dipeptide(sk, { x: 0, y: top }, r1, r2, { part: "dipeptide", bondPart: "peptide-bond", broken: true });
      const a1 = drawAminoAcid(sk, { x: -170, y: bot }, r1, { part: "amino-acid", rPart: "r-group", leaveOH: true });
      const a2 = drawAminoAcid(sk, { x: 170, y: bot }, r2, { part: "amino-acid", rPart: "r-group", leaveH: true });
      // The atoms water adds: OH to the first's carbon, H to the second's nitrogen.
      const x0 = a1.oh.x - 13, x1 = a2.hDn.x + 13;
      softBox(sk, { x: (x0 + x1) / 2, y: a1.oh.y }, x1 - x0, F + 12, "none", "water", { stroke: CHEM.water, dash: "5 4" });
      dipAnchor = { x: d.N1.x - 30 - 9, y: top - 36 };
      aaAnchor = { x: a1.hUp.x - 11, y: a1.hUp.y };
      rAnchor = { x: a1.rAt.x - 11, y: a1.rAt.y };
      bondAnchor = { x: d.N2.x + 16, y: top - 60 };
      waterAt = arrowWithWater(sk, { x: 0, y: top + 72 }, { x: 0, y: bot - 70 }, "hydrolysis", "in");
    }
    sk.part("amino-acid", "Amino acid", aaAnchor);
    sk.part("dipeptide", "Dipeptide", dipAnchor);
    sk.part("r-group", "R group (side chain)", rAnchor);
    sk.part("peptide-bond", "Peptide bond", bondAnchor);
    sk.part("water", condensing ? "Water released (H₂O)" : "Water added (H₂O)", waterAt);
    sk.part(condensing ? "condensation" : "hydrolysis", condensing ? "Condensation reaction" : "Hydrolysis reaction", { x: 0, y: condensing ? 92 : 112 });
    return sk.finish(16, { w: 560, h: 260 });
  },
};

const fitName = (s: string) => (s.length <= 34 ? s : fitText(s, 34));

/** The reaction arrow down the middle, with water leaving (condensation) or joining (hydrolysis) from the side. */
function arrowWithWater(sk: Sketch, a0: Pt, a1: Pt, part: string, way: "out" | "in"): Pt {
  chemArrow(sk, a0, a1, { part, width: 2.6 });
  const mid = { x: a0.x, y: (a0.y + a1.y) / 2 };
  const w = { x: a0.x + 58, y: way === "out" ? mid.y + 24 : mid.y - 24 };
  if (way === "out") {
    sk.path([{ k: "M", p: { x: a0.x, y: mid.y - 10 } }, { k: "A", c: { x: a0.x + 34, y: mid.y - 10 }, r: 34, to: { x: a0.x + 34, y: mid.y + 24 }, large: false, sweep: false }], false, { stroke: CHEM.water, width: 2.2, fill: "none", part: "water" });
    sk.polygon([{ x: a0.x + 46, y: mid.y + 24 }, { x: a0.x + 34, y: mid.y + 18 }, { x: a0.x + 34, y: mid.y + 30 }], { fill: CHEM.water, stroke: CHEM.water, width: 1, part: "water" });
  } else {
    // From the water, curving in to join the arrow.
    sk.path([{ k: "M", p: { x: a0.x + 36, y: mid.y - 24 } }, { k: "A", c: { x: a0.x + 36, y: mid.y + 10 }, r: 34, to: { x: a0.x + 2, y: mid.y + 10 }, large: false, sweep: false }], false, { stroke: CHEM.water, width: 2.2, fill: "none", part: "water" });
    sk.polygon([{ x: a0.x + 2, y: mid.y + 20 }, { x: a0.x - 4, y: mid.y + 8 }, { x: a0.x + 8, y: mid.y + 8 }], { fill: CHEM.water, stroke: CHEM.water, width: 1, part: "water" });
  }
  const c = atomText(sk, { x: w.x, y: w.y }, "H₂O", F, CHEM.water, "water", "first");
  return { x: c.x + textW("H₂O", F) / 2 + 4, y: c.y };
}

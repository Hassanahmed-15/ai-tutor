import type { FigureComponent, FigureParams, FigurePart, FigureShape, Ink, Pt } from "../types";
import { arrowShapes, r2, roundedPoly } from "./bioDraw";

/**
 * A Level genetic technology as textbooks draw it.
 *  - "plasmid": making recombinant DNA. A plasmid (circular, double-stranded DNA with a marker gene)
 *    is cut at its restriction site; the gene, cut from its DNA by the SAME restriction enzyme, has
 *    complementary sticky ends (the overhang bases are written when the enzyme is a known one); the
 *    gene goes into the plasmid and DNA ligase seals the sugar-phosphate backbones — a recombinant
 *    plasmid.
 *  - "pcr": one cycle of the polymerase chain reaction, a step to a row: denaturation (strands
 *    separate), annealing (primers bind at each strand's 3′ end), extension (Taq polymerase builds the
 *    new strands from the primers).
 * Ids are shared by the two views (a board asking for "plasmid", "restriction-site" and "insert"
 * always gets them): in the PCR view they name the template strand, the primers and the copies.
 */

type View = "plasmid" | "pcr";

function viewOf(v: unknown): View {
  const s = String(v ?? "").toLowerCase();
  if (/pcr|polymerase|denatur|anneal|extend|amplif/.test(s)) return "pcr";
  return "plasmid";
}

/** Overhangs (5′→3′ on the top strand of the right-hand end) for the enzymes a syllabus names. */
const OVERHANG: Record<string, string> = { ecori: "AATT", bamhi: "GATC", hindiii: "AGCT", noti: "GGCC", xbai: "CTAG", pst1: "", psti: "" };
const PAIR: Record<string, string> = { A: "T", T: "A", G: "C", C: "G" };

const C = {
  plasmid: "#2563eb" as Ink,
  rung: "#93c5fd" as Ink,
  gene: "#16a34a" as Ink,
  geneRung: "#86efac" as Ink,
  marker: "#d97706" as Ink,
  site: "#dc2626" as Ink,
  ligase: "#7c3aed" as Ink,
  strandA: "#2563eb" as Ink,
  strandB: "#be123c" as Ink,
  primer: "#d97706" as Ink,
  newStrand: "#16a34a" as Ink,
  taq: "#ddd6fe" as Ink,
  base: "#94a3b8" as Ink,
};

const pt = (x: number, y: number): Pt => ({ x, y });
const polar = (c: Pt, r: number, deg: number): Pt => ({ x: c.x + r * Math.cos((deg * Math.PI) / 180), y: c.y + r * Math.sin((deg * Math.PI) / 180) });
/** An arc (degrees, y down) as a path, drawn clockwise from a0 to a1. */
function arcD(c: Pt, r: number, a0: number, a1: number): string {
  const p0 = polar(c, r, a0), p1 = polar(c, r, a1);
  const large = ((a1 - a0 + 360) % 360) > 180 ? 1 : 0;
  return `M${r2(p0.x)} ${r2(p0.y)} A${r2(r)} ${r2(r)} 0 ${large} 1 ${r2(p1.x)} ${r2(p1.y)}`;
}

/** Double-stranded circular DNA: two backbones with base-pair rungs, coloured by segment. */
function ring(shapes: FigureShape[], c: Pt, R: number, segs: Array<{ a0: number; a1: number; colour: Ink; rung: Ink; part?: string }>) {
  const r = R - 13;
  for (const s of segs) {
    const p = s.part ? { part: s.part } : {};
    for (let a = s.a0 + 4; a < s.a1 - 1; a += 9) {
      const q0 = polar(c, r + 2, a), q1 = polar(c, R - 2, a);
      shapes.push({ t: "path", d: `M${r2(q0.x)} ${r2(q0.y)} L${r2(q1.x)} ${r2(q1.y)}`, stroke: s.rung, width: 1.8, fill: "none", ...p });
    }
    shapes.push({ t: "path", d: arcD(c, R, s.a0, s.a1), stroke: s.colour, width: 3.6, fill: "none", ...p });
    shapes.push({ t: "path", d: arcD(c, r, s.a0, s.a1), stroke: s.colour, width: 3.6, fill: "none", ...p });
  }
}

export const geneticTech: FigureComponent = {
  name: "geneticTech",
  title: "Genetic technology: making a recombinant plasmid (plasmid with a marker gene cut at a restriction site, a gene with matching sticky ends, joined by DNA ligase), or one PCR cycle (denature, anneal primers, extend with Taq polymerase)",
  params: `view ("plasmid" default | "pcr"); enzyme (restriction enzyme name, default EcoRI — EcoRI, BamHI, HindIII, NotI and XbaI show their sticky-end bases); gene (inserted gene label, default "insulin gene").`,
  match: /\b(genetic technolog\w*|recombinant DNA|restriction (enzymes?|endonucleases?|sites?)|sticky ends?|plasmids?|gene (cloning|insertion|transfer)|PCR|polymerase chain reaction|denatur(e|ation)[^.]{0,40}(anneal|primer)|DNA ligase|vectors? (in|for) (gene|cloning))\b/i,
  parts: [
    { id: "plasmid", name: "Plasmid" },
    { id: "restriction-site", name: "Restriction site" },
    { id: "sticky-ends", name: "Sticky ends" },
    { id: "insert", name: "Inserted gene" },
    { id: "ligase", name: "DNA ligase" },
    { id: "denature", name: "Denature" },
    { id: "anneal", name: "Anneal primers" },
    { id: "extend", name: "Extend" },
    { id: "marker-gene", name: "Marker gene" },
    { id: "recombinant-plasmid", name: "Recombinant plasmid" },
  ],
  build(params: FigureParams) {
    const p = params ?? {};
    const view = viewOf(p.view ?? p.stage ?? p.kind);
    const enzyme = String(p.enzyme ?? "EcoRI").replace(/[^A-Za-z0-9]/g, "").slice(0, 10) || "EcoRI";
    const gene = String(p.gene ?? p.insert ?? "insulin gene").replace(/[^\p{L}\p{N} '\-()]/gu, "").trim().slice(0, 20) || "insulin gene";
    const geneName = gene[0].toUpperCase() + gene.slice(1);
    return view === "pcr" ? pcr() : recombinant(enzyme, geneName);
  },
};

function recombinant(enzyme: string, gene: string) {
  const W = 620, H = 440;
  const shapes: FigureShape[] = [];
  const over: FigureShape[] = [];
  const parts: FigurePart[] = [];
  const R = 76;

  // 1. The plasmid: a marker gene and one restriction site (at the top).
  const A = pt(110, 110);
  ring(shapes, A, R, [
    { a0: -84, a1: 110, colour: C.plasmid, rung: C.rung, part: "plasmid" },
    { a0: 110, a1: 170, colour: C.marker, rung: "#fde68a", part: "marker-gene" },
    { a0: 170, a1: 276, colour: C.plasmid, rung: C.rung, part: "plasmid" },
  ]);
  const siteTop = polar(A, R + 9, -90), siteBottom = polar(A, R - 22, -90);
  over.push({ t: "path", part: "restriction-site", d: roundedPoly([pt(siteTop.x - 5, siteTop.y), pt(siteTop.x + 5, siteTop.y), pt(siteBottom.x + 5, siteBottom.y), pt(siteBottom.x - 5, siteBottom.y)], 2), fill: C.site, stroke: C.site, width: 1.6 });
  parts.push({ id: "plasmid", name: "Plasmid", anchor: polar(A, R, 200) });
  parts.push({ id: "marker-gene", name: "Marker gene", anchor: polar(A, R, 145) });
  parts.push({ id: "restriction-site", name: `Restriction site (${enzyme})`, anchor: pt(r2(siteTop.x), r2(siteTop.y + 6)) });

  // 2. The gene, cut from its DNA by the same enzyme: staggered cuts leave complementary sticky ends.
  const y1 = 96, y2 = 126, x0 = 410, x1 = 560, oh = 36;
  const over4 = OVERHANG[enzyme.toLowerCase()] ?? "";
  for (let x = x0 + 6; x < x1 - 2; x += 10) shapes.push({ t: "path", part: "insert", d: `M${x} ${y1 + 2} V${y2 - 2}`, stroke: C.geneRung, width: 2, fill: "none" });
  shapes.push({ t: "path", part: "insert", d: `M${x0} ${y1} H${x1}`, stroke: C.gene, width: 3.6, fill: "none" });
  shapes.push({ t: "path", part: "insert", d: `M${x0} ${y2} H${x1}`, stroke: C.gene, width: 3.6, fill: "none" });
  // The enzyme's staggered cuts leave 5′ overhangs: the top strand runs on past the left-hand end, the
  // bottom strand past the right-hand end, their unpaired bases sticking out.
  const stub = (xa: number, y: number, dir: 1 | -1) => {
    shapes.push({ t: "path", part: "sticky-ends", d: `M${xa} ${y} H${xa + dir * oh}`, stroke: C.gene, width: 3.6, fill: "none" });
    for (let k = 0; k < 4; k++) {
      const x = xa + dir * (5 + k * 8.5);
      shapes.push({ t: "path", part: "sticky-ends", d: `M${r2(x)} ${y + (y === y1 ? 2 : -2)} V${y + (y === y1 ? 10 : -10)}`, stroke: C.gene, width: 2, fill: "none" });
    }
  };
  stub(x0, y1, -1);
  stub(x1, y2, 1);
  if (over4) {
    // Top strand read 5′→3′ (left to right); the bottom strand's overhang is its complement.
    const comp = over4.split("").map((b) => PAIR[b] ?? b).join("");
    over.push({ t: "text", x: x0 - oh / 2, y: y1 - 10, text: over4, size: 14, anchor: "middle", fill: C.gene, part: "sticky-ends" });
    over.push({ t: "text", x: x1 + oh / 2, y: y2 + 24, text: comp, size: 14, anchor: "middle", fill: C.gene, part: "sticky-ends" });
  }
  parts.push({ id: "insert", name: gene, anchor: pt(x1 - 30, y1) });
  parts.push({ id: "sticky-ends", name: "Sticky ends (complementary)", anchor: pt(x1 + oh - 4, y2) });

  // 3. The recombinant plasmid: the gene in the cut site, ligase sealing both joins.
  const B = pt(300, 340);
  const g0 = -130, g1 = -50;
  ring(shapes, B, R, [
    { a0: g1, a1: 110, colour: C.plasmid, rung: C.rung, part: "recombinant-plasmid" },
    { a0: 110, a1: 170, colour: C.marker, rung: "#fde68a", part: "marker-gene" },
    { a0: 170, a1: g0 + 360, colour: C.plasmid, rung: C.rung, part: "recombinant-plasmid" },
    { a0: g0, a1: g1, colour: C.gene, rung: C.geneRung, part: "insert" },
  ]);
  for (const a of [g0, g1]) {
    const q0 = polar(B, R + 10, a), q1 = polar(B, R - 23, a);
    over.push({ t: "path", part: "ligase", d: `M${r2(q0.x)} ${r2(q0.y)} L${r2(q1.x)} ${r2(q1.y)}`, stroke: C.ligase, width: 4, fill: "none", dash: "5 4" });
  }
  parts.push({ id: "recombinant-plasmid", name: "Recombinant plasmid", anchor: polar(B, R, 200) });
  const lig = polar(B, R + 4, g1);
  parts.push({ id: "ligase", name: "DNA ligase seals the joins", anchor: pt(r2(lig.x), r2(lig.y)) });

  // The two routes into the recombinant plasmid.
  over.push(...arrowShapes(pt(176, 186), pt(232, 262), "muted", 2.4, undefined, { head: 12, bend: -12 }));
  over.push(...arrowShapes(pt(470, 168), pt(376, 262), "muted", 2.4, undefined, { head: 12, bend: 12 }));
  const order = geneticTech.parts.map((q) => q.id);
  parts.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
  return { w: W, h: H, shapes: [...shapes, ...over], parts };
}

function pcr() {
  const W = 580, H = 420;
  const shapes: FigureShape[] = [];
  const parts: FigurePart[] = [];
  const X0 = 30, X1 = 550, PRIMER = 64;
  const rows = [82, 222, 362];
  const temps = ["95 °C", "55 °C", "72 °C"];
  const gap = 20, pairGap = 18;
  /** A template strand; its unpaired bases point towards where a partner strand would pair. */
  const template = (y: number, colour: Ink, part: string | undefined, toward: 1 | -1) => {
    const p = part ? { part } : {};
    for (let x = X0 + 8; x < X1 - 4; x += 12) shapes.push({ t: "path", d: `M${x} ${y + toward * 2} V${y + toward * 8}`, stroke: C.base, width: 1.8, fill: "none", ...p });
    shapes.push({ t: "path", d: `M${X0} ${y} H${X1}`, stroke: colour, width: 3.6, fill: "none", ...p });
  };
  /** A strand paired with the template `toward` it (−1 above, +1 below): base pairs drawn across. */
  const paired = (y: number, xa: number, xb: number, colour: Ink, part: string, toward: 1 | -1) => {
    for (let x = xa + 6; x < xb - 2; x += 12) shapes.push({ t: "path", d: `M${x} ${y + toward * 2} V${y + toward * (pairGap - 2)}`, stroke: C.base, width: 1.8, fill: "none", part });
    shapes.push({ t: "path", d: `M${xa} ${y} H${xb}`, stroke: colour, width: 3.6, fill: "none", part });
  };
  rows.forEach((yc, i) => {
    // Each step's number and temperature above its strands (the margins stay clear for the leaders).
    const hy = yc - gap - 30;
    shapes.push({ t: "circle", cx: X0 + 13, cy: hy, r: 13, fill: "#d97706", stroke: "none" });
    shapes.push({ t: "text", x: X0 + 13, y: hy + 5.5, text: String(i + 1), size: 16, anchor: "middle", fill: "paper" });
    shapes.push({ t: "text", x: X0 + 34, y: hy + 6, text: temps[i], size: 18, anchor: "start", fill: "ink" });
  });
  const [r1, r2y, r3] = rows;
  // 1. Denaturation: hydrogen bonds break and the two strands separate.
  template(r1 - gap, C.strandA, "plasmid", 1);
  template(r1 + gap, C.strandB, "denature", -1);
  parts.push({ id: "plasmid", name: "Template strand", anchor: pt(X0 + 3, r1 - gap) });
  parts.push({ id: "denature", name: "Denature: strands separate", anchor: pt(X1 - 3, r1 + gap) });
  // 2. Annealing: a primer binds at the 3′ end of each strand.
  template(r2y - gap, C.strandA, undefined, 1);
  template(r2y + gap, C.strandB, undefined, -1);
  paired(r2y - gap + pairGap, X1 - PRIMER, X1, C.primer, "anneal", -1);
  paired(r2y + gap - pairGap, X0, X0 + PRIMER, C.primer, "restriction-site", 1);
  parts.push({ id: "anneal", name: "Anneal: primers bind", anchor: pt(X1 - 3, r2y - gap + pairGap) });
  parts.push({ id: "restriction-site", name: "Primer", anchor: pt(X0 + 3, r2y + gap - pairGap) });
  // 3. Extension: Taq polymerase adds nucleotides to each primer, along its template.
  template(r3 - gap, C.strandA, "insert", 1);
  template(r3 + gap, C.strandB, "insert", -1);
  const grow = 0.7;
  const n1 = X1 - (X1 - X0) * grow, n2 = X0 + (X1 - X0) * grow;
  const yTop = r3 - gap + pairGap, yBottom = r3 + gap - pairGap;
  paired(yTop, n1, X1 - PRIMER, C.newStrand, "extend", -1);
  paired(yTop, X1 - PRIMER, X1, C.primer, "extend", -1);
  paired(yBottom, X0 + PRIMER, n2, C.newStrand, "sticky-ends", 1);
  paired(yBottom, X0, X0 + PRIMER, C.primer, "sticky-ends", 1);
  for (const [x, y] of [[n1, yTop], [n2, yBottom]] as const) {
    shapes.push({ t: "path", part: "ligase", d: roundedPoly([pt(x - 16, y - 12), pt(x + 16, y - 12), pt(x + 16, y + 12), pt(x - 16, y + 12)], 11), fill: C.taq, stroke: "#374151", width: 1.8 });
  }
  // The direction each new strand grows, beside its template.
  const tailTop = pt(n1 + 96, r3 - gap - 14), tailBottom = pt(n2 - 96, r3 + gap + 14);
  shapes.push(...arrowShapes(tailTop, pt(n1 + 18, tailTop.y), "#16a34a", 2.4, "extend", { head: 11 }));
  shapes.push(...arrowShapes(tailBottom, pt(n2 - 18, tailBottom.y), "#16a34a", 2.4, "extend", { head: 11 }));
  parts.push({ id: "extend", name: "Extend: new strands built", anchor: tailTop });
  parts.push({ id: "sticky-ends", name: "New strand (from primer)", anchor: pt(X0 + 3, yBottom) });
  parts.push({ id: "ligase", name: "Taq polymerase", anchor: pt(r2(n2), yBottom) });
  parts.push({ id: "insert", name: "Template strand (copied)", anchor: pt(X0 + 3, r3 - gap) });
  const order = ["denature", "anneal", "extend", "plasmid", "restriction-site", "sticky-ends", "ligase", "insert"];
  parts.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
  return { w: W, h: H, shapes, parts };
}

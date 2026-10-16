import type { FigureComponent, FigureParams, FigurePart, FigureShape, Pt } from "../types";
import { r2 } from "./bioDraw";
import { bool } from "./mathsKit";

/**
 * A CHROMOSOME, WITH ITS DNA PACKING. A duplicated chromosome as in prophase/metaphase: two
 * identical sister chromatids bowed apart and held at the centromere (a constriction), each end
 * capped by a telomere. A zoom from one arm opens an inset of the chromatin inside it: the DNA double
 * helix wound about one and three-quarter times round each bead of histone proteins (a nucleosome),
 * beads joined by linker DNA. `duplicated: false` draws the single-chromatid chromosome of G1 or of
 * a daughter cell after anaphase.
 */

const C = { chromatid: "#c4b5fd", telomere: "#6d28d9", centromere: "#334155", dna: "#2563eb", histone: "#fde68a", histoneEdge: "#d97706" } as const;

/** A rounded rod round a centreline, narrower at the centromere; points go down one side and back up the other. */
function rodOutline(centre: (t: number) => Pt, width: (t: number) => number, t0 = 0, t1 = 1, n = 48): Pt[] {
  const side = (t: number, s: 1 | -1): Pt => {
    const p = centre(t), a = centre(Math.max(0, t - 0.005)), b = centre(Math.min(1, t + 0.005));
    const dx = b.x - a.x, dy = b.y - a.y, L = Math.hypot(dx, dy) || 1;
    const w = width(t) / 2;
    return { x: p.x + (s * -dy / L) * w, y: p.y + (s * dx / L) * w };
  };
  const ts = Array.from({ length: n + 1 }, (_, i) => t0 + ((t1 - t0) * i) / n);
  const cap = (t: number): Pt[] => {
    // A half-round cap at a rod end: from the side the outline arrives on, round the end, to the other.
    const p = centre(t), a = centre(Math.max(0, t - 0.005)), b = centre(Math.min(1, t + 0.005));
    const dir = Math.atan2(b.y - a.y, b.x - a.x) + (t >= 1 ? 0 : Math.PI);
    const w = width(t) / 2;
    return Array.from({ length: 9 }, (_, i) => {
      const ang = dir + Math.PI / 2 - (Math.PI * (i + 1)) / 10;
      return { x: p.x + Math.cos(ang) * w, y: p.y + Math.sin(ang) * w };
    });
  };
  const right = ts.map((t) => side(t, 1));
  const left = ts.map((t) => side(t, -1)).reverse();
  return [...right, ...(t1 >= 1 ? cap(1) : []), ...left, ...(t0 <= 0 ? cap(0) : [])];
}

const poly = (pts: Pt[]) => `M${pts.map((p) => `${r2(p.x)} ${r2(p.y)}`).join(" L")} Z`;

export const chromosome: FigureComponent = {
  name: "chromosome",
  title: "A chromosome: two sister chromatids joined at the centromere with telomeres at the ends, and an inset of its DNA wound round histone proteins",
  params: `duplicated (true default: an X-shaped chromosome of two sister chromatids after DNA replication | false: a single chromatid, as in G1 or after anaphase); inset (true default: the zoom showing DNA wound round histones as nucleosomes).`,
  match: /\bchromosome (structure|diagram)\b|\bstructure of (a |the )?chromosomes?\b|\bsister chromatids?\b|\bchromatids?\b(?=[\s\S]{0,140}\b(centromere|telomere|histone|joined|identical|chromosome)\b)|\bcentromeres?\b|\btelomeres?\b|\bhistones?\b|\bnucleosomes?\b|\bchromatin\b(?=[\s\S]{0,120}\b(DNA|histone|condens\w*|wound|coil\w*)\b)|\bDNA (is )?(wound|wrapped|coiled) (a)?round\b/i,
  parts: [
    { id: "chromatid", name: "Sister chromatid" },
    { id: "centromere", name: "Centromere" },
    { id: "telomere", name: "Telomere" },
    { id: "dna", name: "DNA (double helix)" },
    { id: "histone", name: "Histone proteins" },
    { id: "nucleosome", name: "Nucleosome" },
  ],
  build(params: FigureParams) {
    const duplicated = bool(params.duplicated ?? params.replicated, true);
    const inset = bool(params.inset ?? params.showHistones, true);
    const shapes: FigureShape[] = [];
    const parts: FigurePart[] = [];
    const cx = inset ? 168 : 300, top = 34, len = 372, tc = 0.44; // the centromere a little above the middle
    const yc = top + len * tc;
    const armW = 42;
    const width = (t: number) => armW * (1 - 0.5 * Math.exp(-(((t - tc) / 0.06) ** 2)));

    // Each chromatid: bowed away from its sister except at the centromere, where they touch.
    const centreOf = (s: 1 | -1) => (t: number): Pt => ({ x: cx + s * (duplicated ? 13 + 120 * (t - tc) ** 2 : 0), y: top + len * t });
    const sisters: Array<1 | -1> = duplicated ? [-1, 1] : [1];
    for (const s of sisters) {
      const centre = centreOf(s);
      shapes.push({ t: "path", d: poly(rodOutline(centre, width)), fill: C.chromatid, stroke: "ink", width: 2.2, part: "chromatid" });
      // Telomeres: the repeated sequences capping each end.
      for (const [a, b] of [[0, 0.045], [0.955, 1]] as const) shapes.push({ t: "path", d: poly(rodOutline(centre, width, a, b, 8)), fill: C.telomere, stroke: "ink", width: 1.8, part: "telomere" });
    }
    // The centromere: the constriction holding the sisters, wider than their waist so it shows.
    const crx = duplicated ? 32 : 20;
    shapes.push({ t: "path", d: `M${cx - crx} ${yc} a${crx} 10 0 1 0 ${2 * crx} 0 a${crx} 10 0 1 0 ${-2 * crx} 0 Z`, fill: C.centromere, stroke: "ink", width: 1.8, part: "centromere" });

    const left = centreOf(-1 as 1 | -1), one = duplicated ? left : centreOf(1);
    const edge = (t: number) => ({ x: r2(one(t).x - width(t) / 2 + 3), y: r2(one(t).y) });
    parts.push({ id: "telomere", name: "Telomere", anchor: { x: r2(one(0.02).x - width(0.02) / 2 + 6), y: r2(top + len * 0.02) } });
    parts.push({ id: "centromere", name: "Centromere", anchor: { x: cx - crx + 3, y: r2(yc) } });
    // With no inset on the right, the chromatid is labelled on the right sister so the labels balance.
    const rightSister = duplicated && !inset ? centreOf(1) : undefined;
    parts.push({ id: "chromatid", name: duplicated ? "Sister chromatid" : "Chromosome (one chromatid)", anchor: rightSister ? { x: r2(rightSister(0.74).x + width(0.74) / 2 - 3), y: r2(rightSister(0.74).y) } : edge(0.74) });

    if (inset) {
      // The zoom: a small box on the upper arm opening into a round inset of the chromatin.
      const arm = centreOf(duplicated ? 1 : 1)(0.2);
      const bx = arm.x - 12, by = arm.y - 12, bs = 24;
      const I = { x: 452, y: 218 }, IR = 150;
      shapes.push({ t: "path", d: `M${r2(bx)} ${r2(by)} h${bs} v${bs} h${-bs} Z`, stroke: "muted", width: 1.8, fill: "none" });
      const tan = (corner: Pt, sign: 1 | -1): Pt => {
        // Tangent point on the inset circle seen from the box corner (upper and lower).
        const dx = I.x - corner.x, dy = I.y - corner.y, d = Math.hypot(dx, dy);
        const a = Math.atan2(dy, dx) + Math.PI + sign * Math.acos(Math.min(1, IR / d));
        return { x: I.x + IR * Math.cos(a), y: I.y + IR * Math.sin(a) };
      };
      const t1 = tan({ x: bx + bs, y: by }, 1), t2 = tan({ x: bx + bs, y: by + bs }, -1);
      const [hi, lo] = t1.y < t2.y ? [t1, t2] : [t2, t1];
      shapes.push({ t: "path", d: `M${r2(bx + bs)} ${r2(by)} L${r2(hi.x)} ${r2(hi.y)} M${r2(bx + bs)} ${r2(by + bs)} L${r2(lo.x)} ${r2(lo.y)}`, stroke: "muted", width: 1.4, dash: "5 5", fill: "none" });
      shapes.push({ t: "circle", cx: I.x, cy: I.y, r: IR, fill: "glass", stroke: "muted", width: 2 });

      // Beads on a string: each histone bead with the DNA wound round it (back of each turn behind the
      // bead, front over it), joined by linker DNA.
      const beads: Pt[] = [{ x: 360, y: 186 }, { x: 432, y: 250 }, { x: 504, y: 186 }, { x: 568, y: 250 }];
      const hr = 27, rx = hr + 7, ry = 10, tilt = -0.3;
      const ringPt = (b: Pt, k: number, ang: number): Pt => {
        const ex = rx * Math.cos(ang), ey = ry * Math.sin(ang) + (k ? 6 : -6);
        return { x: b.x + ex * Math.cos(tilt) - ey * Math.sin(tilt), y: b.y + ex * Math.sin(tilt) + ey * Math.cos(tilt) };
      };
      const arc = (b: Pt, k: number, a0: number, a1: number) => {
        const pts = Array.from({ length: 17 }, (_, i) => ringPt(b, k, a0 + ((a1 - a0) * i) / 16));
        return `M${pts.map((p) => `${r2(p.x)} ${r2(p.y)}`).join(" L")}`;
      };
      // Linker DNA from bead to bead (and in and out of the inset).
      const ins = ringPt(beads[0], 0, Math.PI), outs = ringPt(beads[beads.length - 1], 1, 0);
      // Each linker leaves a bead and enters the next along the ring's own direction (smooth joins).
      let linker = `M${r2(ins.x - 42)} ${r2(ins.y + 30)} C${r2(ins.x - 22)} ${r2(ins.y + 26)} ${r2(ins.x - 10)} ${r2(ins.y + 6)} ${r2(ins.x)} ${r2(ins.y)}`;
      for (let i = 0; i < beads.length - 1; i++) {
        const a = ringPt(beads[i], 1, 0), b = ringPt(beads[i + 1], 0, Math.PI);
        // A ring's ends run vertically, so the linker leaves and arrives vertically: an S between beads.
        const dir = b.y >= a.y ? 1 : -1;
        linker += ` M${r2(a.x)} ${r2(a.y)} C${r2(a.x + 6)} ${r2(a.y + dir * 26)} ${r2(b.x - 6)} ${r2(b.y - dir * 26)} ${r2(b.x)} ${r2(b.y)}`;
      }
      linker += ` M${r2(outs.x)} ${r2(outs.y)} C${r2(outs.x + 6)} ${r2(outs.y + 18)} ${r2(outs.x + 14)} ${r2(outs.y + 28)} ${r2(outs.x + 22)} ${r2(outs.y + 44)}`;
      shapes.push({ t: "path", d: linker, stroke: C.dna, width: 2.6, fill: "none", part: "dna" });
      beads.forEach((b, i) => {
        const part = i === 1 ? "nucleosome" : "histone";
        for (const k of [0, 1]) shapes.push({ t: "path", d: arc(b, k, Math.PI, 2 * Math.PI), stroke: C.dna, width: 2.4, fill: "none", opacity: 0.55, part: i === 1 ? "nucleosome" : "dna" });
        shapes.push({ t: "circle", cx: b.x, cy: b.y, r: hr, fill: C.histone, stroke: C.histoneEdge, width: 2, part });
        for (const k of [0, 1]) shapes.push({ t: "path", d: arc(b, k, 0, Math.PI), stroke: C.dna, width: 2.6, fill: "none", part: i === 1 ? "nucleosome" : "dna" });
      });
      const last = beads[beads.length - 1];
      parts.push({ id: "dna", name: "DNA (double helix)", anchor: { x: r2((ringPt(beads[2], 1, 0).x + ringPt(beads[3], 0, Math.PI).x) / 2 + 4), y: r2((ringPt(beads[2], 1, 0).y + ringPt(beads[3], 0, Math.PI).y) / 2 - 12) } });
      parts.push({ id: "histone", name: "Histone proteins", anchor: { x: r2(last.x + hr * 0.6), y: r2(last.y - hr * 0.55) } });
      parts.push({ id: "nucleosome", name: "Nucleosome", anchor: { x: beads[1].x, y: r2(beads[1].y + hr - 2) } });
    }
    return { w: inset ? 640 : 600, h: top + len + 34, shapes, parts };
  },
};

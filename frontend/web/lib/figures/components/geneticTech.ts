import type { FigureComponent, FigureParams } from "../types";
import { BIO, r2, roundedPoly } from "./bioDraw";
import type { FigureShape } from "../types";

/**
 * A Level genetic technology as textbooks draw it: either a plasmid cut at a restriction site with
 * a gene inserted (recombinant DNA), or a three-step PCR cycle (denature, anneal, extend).
 */

type View = "plasmid" | "pcr";

function viewOf(v: unknown): View {
  const s = String(v ?? "").toLowerCase();
  if (/pcr|polymerase|denatur|anneal|extend|amplif/.test(s)) return "pcr";
  return "plasmid";
}

export const geneticTech: FigureComponent = {
  name: "geneticTech",
  title: "Genetic technology: a plasmid cut at a restriction site with an inserted gene, or a three-step PCR cycle (denature, anneal, extend)",
  params: `view ("plasmid" default | "pcr"); enzyme (restriction enzyme name, default EcoRI); gene (inserted gene label, default "insulin gene").`,
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
  ],
  build(params: FigureParams) {
    const view = viewOf(params.view ?? params.stage ?? params.kind);
    const enzyme = String(params.enzyme ?? "EcoRI").slice(0, 12);
    const gene = String(params.gene ?? params.insert ?? "insulin gene").slice(0, 18);
    if (view === "pcr") {
      const shapes: FigureShape[] = [];
      const panels: Array<{ id: string; title: string; x: number; strands: "single" | "primed" | "double" }> = [
        { id: "denature", title: "1. Denature (~95 °C)", x: 40, strands: "single" },
        { id: "anneal", title: "2. Anneal primers (~60 °C)", x: 250, strands: "primed" },
        { id: "extend", title: "3. Extend (~72 °C)", x: 460, strands: "double" },
      ];
      for (const p of panels) {
        shapes.push({ t: "path", part: p.id, d: roundedPoly([{ x: p.x, y: 48 }, { x: p.x + 190, y: 48 }, { x: p.x + 190, y: 260 }, { x: p.x, y: 260 }], 16), fill: "#f8fafc", stroke: "ink", width: 2 });
        shapes.push({ t: "text", part: p.id, x: p.x + 95, y: 78, text: p.title, size: 14, anchor: "middle", fill: "ink" });
        const y1 = 130, y2 = 190;
        shapes.push({ t: "path", part: p.id, d: `M${p.x + 36} ${y1} H${p.x + 154}`, stroke: BIO.blue, width: 4, fill: "none" });
        if (p.strands === "single") {
          shapes.push({ t: "path", part: p.id, d: `M${p.x + 36} ${y2} H${p.x + 154}`, stroke: BIO.red, width: 4, fill: "none" });
        } else if (p.strands === "primed") {
          shapes.push({ t: "path", part: p.id, d: `M${p.x + 36} ${y2} H${p.x + 154}`, stroke: BIO.red, width: 4, fill: "none" });
          shapes.push({ t: "path", part: p.id, d: `M${p.x + 36} ${y1 + 10} H${p.x + 70}`, stroke: BIO.amber, width: 6, fill: "none" });
          shapes.push({ t: "path", part: p.id, d: `M${p.x + 120} ${y2 - 10} H${p.x + 154}`, stroke: BIO.amber, width: 6, fill: "none" });
        } else {
          shapes.push({ t: "path", part: p.id, d: `M${p.x + 36} ${y1 + 12} H${p.x + 154}`, stroke: BIO.green, width: 4, fill: "none" });
          shapes.push({ t: "path", part: p.id, d: `M${p.x + 36} ${y2} H${p.x + 154}`, stroke: BIO.red, width: 4, fill: "none" });
          shapes.push({ t: "path", part: p.id, d: `M${p.x + 36} ${y2 - 12} H${p.x + 154}`, stroke: BIO.green, width: 4, fill: "none" });
        }
      }
      shapes.push({ t: "path", d: "M230 154 H250 M440 154 H460", stroke: "ink", width: 2, fill: "none" });
      return {
        w: 690,
        h: 300,
        shapes,
        parts: [
          { id: "denature", name: "Denature", anchor: { x: 135, y: 154 } },
          { id: "anneal", name: "Anneal primers", anchor: { x: 345, y: 154 } },
          { id: "extend", name: "Extend", anchor: { x: 555, y: 154 } },
          { id: "plasmid", name: "Template DNA", anchor: { x: 135, y: 130 } },
          { id: "restriction-site", name: "Primers", anchor: { x: 345, y: 200 } },
          { id: "sticky-ends", name: "New strand", anchor: { x: 555, y: 142 } },
          { id: "insert", name: "Amplified copies", anchor: { x: 555, y: 230 } },
          { id: "ligase", name: "Taq polymerase", anchor: { x: 555, y: 78 } },
        ],
      };
    }
    const shapes: FigureShape[] = [];
    const ring = (cx: number, cy: number, rx: number, ry: number, part: string, stroke: string, width = 8) => {
      shapes.push({ t: "path", part, d: `M${r2(cx - rx)} ${r2(cy)} A${r2(rx)} ${r2(ry)} 0 1 0 ${r2(cx + rx)} ${r2(cy)} A${r2(rx)} ${r2(ry)} 0 1 0 ${r2(cx - rx)} ${r2(cy)}`, fill: "none", stroke: stroke as never, width });
    };
    ring(180, 170, 110, 80, "plasmid", BIO.blue, 10);
    shapes.push({ t: "path", part: "restriction-site", d: "M180 90 L196 78 L180 66 L164 78 Z", fill: BIO.amber, stroke: "ink", width: 1.6 });
    shapes.push({ t: "text", part: "restriction-site", x: 180, y: 52, text: enzyme, size: 16, anchor: "middle", fill: "ink" });
    shapes.push({ t: "path", part: "sticky-ends", d: "M250 150 H310 M250 162 H290", stroke: BIO.red, width: 3, fill: "none" });
    shapes.push({ t: "path", part: "insert", d: roundedPoly([{ x: 400, y: 120 }, { x: 560, y: 120 }, { x: 560, y: 200 }, { x: 400, y: 200 }], 10), fill: "#dcfce7", stroke: BIO.green, width: 2.4 });
    shapes.push({ t: "text", part: "insert", x: 480, y: 166, text: gene, size: 16, anchor: "middle", fill: BIO.green });
    shapes.push({ t: "path", part: "ligase", d: "M330 160 H400", stroke: BIO.violet, width: 3, fill: "none" });
    shapes.push({ t: "text", part: "ligase", x: 365, y: 148, text: "ligase", size: 14, anchor: "middle", fill: BIO.violet });
    return {
      w: 600,
      h: 300,
      shapes,
      parts: [
        { id: "plasmid", name: "Plasmid", anchor: { x: 180, y: 170 } },
        { id: "restriction-site", name: `Restriction site (${enzyme})`, anchor: { x: 180, y: 78 } },
        { id: "sticky-ends", name: "Sticky ends", anchor: { x: 280, y: 156 } },
        { id: "insert", name: gene.slice(0, 34), anchor: { x: 480, y: 160 } },
        { id: "ligase", name: "DNA ligase", anchor: { x: 365, y: 160 } },
        { id: "denature", name: "Cut plasmid", anchor: { x: 180, y: 250 } },
        { id: "anneal", name: "Complementary ends", anchor: { x: 280, y: 180 } },
        { id: "extend", name: "Recombinant DNA", anchor: { x: 480, y: 210 } },
      ],
    };
  },
};

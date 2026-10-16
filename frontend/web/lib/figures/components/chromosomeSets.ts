import type { FigureComponent, FigureParams, FigurePart, FigureShape } from "../types";
import { r2 } from "./bioDraw";

/**
 * CHROMOSOME SETS: HAPLOID AND DIPLOID. A nucleus with ONE set of chromosomes (n) — one of each type,
 * each type its own colour and length — beside a nucleus with TWO sets (2n): the same types in
 * matched pairs (homologous pairs), one from each parent. A band on one chromosome marks a gene.
 *
 * Counting sets and pairs is exactly what a generated picture cannot draw (two attempts at "a diploid
 * nucleus with 23 pairs" were rejected by the textbook check, and the board fell back to icons —
 * audit 2026-10-17). Code draws it exactly: the counts, the pairs and the labels always agree.
 */

const COLOURS = ["#2563eb", "#dc2626", "#16a34a", "#d97706", "#7c3aed", "#0891b2"];
const DARKER = ["#1e40af", "#991b1b", "#166534", "#92400e", "#5b21b6", "#155e75"];
const LENGTHS = [74, 58, 46, 66, 38, 52];

const int = (v: unknown, d: number, lo: number, hi: number) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : d;
};

/** One unduplicated chromosome: a rounded rod with its centromere, optionally a gene band. */
function rod(x: number, y: number, length: number, colour: string, part: string, gene = false): FigureShape[] {
  const w = 11;
  const top = y - length / 2;
  const d = `M${r2(x - w / 2)} ${r2(top + w / 2)} A${w / 2} ${w / 2} 0 0 1 ${r2(x + w / 2)} ${r2(top + w / 2)} L${r2(x + w / 2)} ${r2(top + length - w / 2)} A${w / 2} ${w / 2} 0 0 1 ${r2(x - w / 2)} ${r2(top + length - w / 2)} Z`;
  const shapes: FigureShape[] = [
    { t: "path", d, fill: colour as `#${string}`, stroke: "ink", width: 1.2, part },
    { t: "circle", cx: x, cy: top + length * 0.38, r: 3.2, fill: "ink", stroke: "none", part },
  ];
  if (gene) shapes.push({ t: "path", d: `M${r2(x - w / 2)} ${r2(top + length * 0.68)} H${r2(x + w / 2)} V${r2(top + length * 0.76)} H${r2(x - w / 2)} Z`, fill: "paper", stroke: "ink", width: 1, part: "gene" });
  return shapes;
}

export const chromosomeSets: FigureComponent = {
  name: "chromosomeSets",
  title: "Chromosome sets: a haploid nucleus (one set, n) beside a diploid nucleus (two sets in homologous pairs, 2n), each chromosome type its own colour and length, a gene marked as a band",
  params: `view ("both" — default — "haploid" or "diploid"); zoom (true: beside a haploid nucleus, a magnified inset of one chromosome's DNA double helix with a gene section highlighted — for a board on what chromosomes, DNA and genes are); types (the number of chromosome types drawn, 2 to 6, default 3 — the board's own example, e.g. A, B, C → 3); caption (optional, a short line under the figure such as "Humans: n = 23, 2n = 46"). Code draws one of each type for haploid and matched pairs for diploid, and writes n and 2n from the count.`,
  // Counted against the cell-division figure word by word (lib/figures/registry.ts figureFor): a board
  // about sets and pairs uses these words more; a board about the stages of division uses its own.
  match: /\b(haploid|diploid|chromosome sets?|sets? of chromosomes|homologous (pairs?|chromosomes)|pairs? of chromosomes|chromosome pairs?|karyotype|2n\b|genes? (is|are) (a )?(short )?sections? of DNA)/i,
  parts: [
    { id: "haploid-nucleus", name: "Haploid nucleus (n)" },
    { id: "diploid-nucleus", name: "Diploid nucleus (2n)" },
    { id: "chromosome", name: "Chromosome" },
    { id: "homologous-pair", name: "Homologous pair" },
    { id: "gene", name: "Gene" },
    { id: "one-set", name: "One set" },
    { id: "dna", name: "DNA (double helix)" },
    { id: "gene-section", name: "Gene: a section of DNA" },
  ],
  build(params: FigureParams) {
    const zoom = params.zoom === true || params.zoom === "true";
    const view = zoom ? "haploid" : params.view === "haploid" || params.view === "diploid" ? params.view : "both";
    const types = int(params.types, 3, 2, 6);
    const caption = typeof params.caption === "string" ? params.caption.slice(0, 48) : "";
    const shapes: FigureShape[] = [];
    const parts: FigurePart[] = [];
    const W = view === "both" || zoom ? 660 : 360;
    const H = caption ? 330 : 300;
    const cy = 140;

    const nucleus = (cx: number, r: number, id: string, label: string) => {
      shapes.push({ t: "circle", cx, cy, r, fill: "#f8fafc", stroke: "ink", width: 2, part: id });
      shapes.push({ t: "text", x: cx, y: cy + r + 30, text: label, size: 20, anchor: "middle", fill: "ink", part: id });
      parts.push({ id, name: id === "haploid-nucleus" ? "Haploid nucleus (n)" : "Diploid nucleus (2n)", anchor: { x: cx + r * 0.72, y: cy - r * 0.72 } });
    };

    if (view !== "diploid") {
      const cx = view === "both" || zoom ? 170 : W / 2;
      const r = 104;
      nucleus(cx, r, "haploid-nucleus", `n = ${types}`);
      const gap = Math.min(30, (r * 1.4) / types);
      const x0 = cx - ((types - 1) * gap) / 2;
      for (let i = 0; i < types; i++) shapes.push(...rod(x0 + i * gap, cy, LENGTHS[i], COLOURS[i], i === 0 ? "chromosome" : "one-set", i === 0));
      parts.push({ id: "chromosome", name: "Chromosome", anchor: { x: x0, y: cy - LENGTHS[0] * 0.2 } });
      parts.push({ id: "gene", name: "Gene", anchor: { x: x0, y: cy - LENGTHS[0] / 2 + LENGTHS[0] * 0.72 } });
      parts.push({ id: "one-set", name: "One set", anchor: { x: x0 + (types - 1) * gap, y: cy + LENGTHS[types - 1] / 2 - 4 } });
    }
    if (view !== "haploid") {
      const cx = view === "both" ? 480 : W / 2;
      const r = 128;
      nucleus(cx, r, "diploid-nucleus", `2n = ${types * 2}`);
      const pairGap = Math.min(42, (r * 1.5) / types);
      const x0 = cx - ((types - 1) * pairGap) / 2;
      for (let i = 0; i < types; i++) {
        const x = x0 + i * pairGap;
        shapes.push(...rod(x - 7, cy, LENGTHS[i], COLOURS[i], i === 0 ? "homologous-pair" : "diploid-nucleus", view === "diploid" && i === 0));
        shapes.push(...rod(x + 7, cy, LENGTHS[i], DARKER[i], i === 0 ? "homologous-pair" : "diploid-nucleus"));
      }
      parts.push({ id: "homologous-pair", name: "Homologous pair", anchor: { x: x0, y: cy + LENGTHS[0] / 2 + 2 } });
      if (view === "diploid") {
        parts.push({ id: "chromosome", name: "Chromosome", anchor: { x: x0 + 7, y: cy - LENGTHS[0] * 0.2 } });
        parts.push({ id: "gene", name: "Gene", anchor: { x: x0 - 7, y: cy - LENGTHS[0] / 2 + LENGTHS[0] * 0.72 } });
      }
    }
    if (view === "both") {
      shapes.push({ t: "path", d: `M300 ${cy} H344`, stroke: "muted", width: 2.5, fill: "none" });
      shapes.push({ t: "path", d: `M344 ${cy} l-10 -6 v12 z`, fill: "muted", stroke: "none" });
      shapes.push({ t: "text", x: 322, y: cy - 12, text: "× 2", size: 15, anchor: "middle", fill: "muted" });
    }
    if (zoom) {
      // The inset: the first chromosome's DNA, magnified — two strands twisted round each other, the
      // gene a highlighted stretch of it.
      const gap = Math.min(30, (104 * 1.4) / types);
      const bandX = 170 - ((types - 1) * gap) / 2;
      const bandY = cy - LENGTHS[0] / 2 + LENGTHS[0] * 0.72;
      const box = { x: 360, y: 46, w: 280, h: 190 };
      shapes.push({ t: "path", d: `M${r2(box.x)} ${r2(box.y)} H${r2(box.x + box.w)} V${r2(box.y + box.h)} H${r2(box.x)} Z`, fill: "#f8fafc", stroke: "muted", width: 1.5 });
      shapes.push({ t: "path", d: `M${r2(bandX + 6)} ${r2(bandY - 4)} L${r2(box.x)} ${r2(box.y)} M${r2(bandX + 6)} ${r2(bandY + 4)} L${r2(box.x)} ${r2(box.y + box.h)}`, fill: "none", stroke: "muted", width: 1, dash: "4 4" });
      const mid = box.y + box.h / 2, amp = 34, x0 = box.x + 18, x1 = box.x + box.w - 18;
      const strand = (phase: number) => Array.from({ length: 61 }, (_, i) => { const x = x0 + ((x1 - x0) * i) / 60; return `${i ? "L" : "M"}${r2(x)} ${r2(mid + amp * Math.sin((i / 60) * Math.PI * 4 + phase))}`; }).join(" ");
      const g0 = x0 + (x1 - x0) * 0.38, g1 = x0 + (x1 - x0) * 0.66;
      shapes.push({ t: "path", d: `M${r2(g0)} ${r2(mid - amp - 10)} H${r2(g1)} V${r2(mid + amp + 10)} H${r2(g0)} Z`, fill: "#fde68a", stroke: "#d97706", width: 1.5, part: "gene-section" });
      for (let i = 0; i <= 24; i++) { const x = x0 + ((x1 - x0) * i) / 24; const a = mid + amp * Math.sin((i / 24) * Math.PI * 4), b = mid + amp * Math.sin((i / 24) * Math.PI * 4 + Math.PI); shapes.push({ t: "path", d: `M${r2(x)} ${r2(a)} L${r2(x)} ${r2(b)}`, stroke: "muted", width: 1.2, fill: "none", part: "dna" }); }
      shapes.push({ t: "path", d: strand(0), stroke: COLOURS[0] as `#${string}`, width: 3.5, fill: "none", part: "dna" });
      shapes.push({ t: "path", d: strand(Math.PI), stroke: DARKER[0] as `#${string}`, width: 3.5, fill: "none", part: "dna" });
      parts.push({ id: "dna", name: "DNA (double helix)", anchor: { x: x0 + (x1 - x0) * 0.16, y: mid + amp * Math.sin(0.16 * Math.PI * 4) } });
      parts.push({ id: "gene-section", name: "Gene: a section of DNA", anchor: { x: (g0 + g1) / 2, y: mid + amp + 8 } });
    }
    if (caption) shapes.push({ t: "text", x: W / 2, y: H - 8, text: caption, size: 17, anchor: "middle", fill: "ink" });
    return { w: W, h: H, shapes, parts };
  },
};

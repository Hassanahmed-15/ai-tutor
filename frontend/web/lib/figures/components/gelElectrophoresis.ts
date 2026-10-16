import { fitText } from "../cuts";
import type { FigureComponent, FigureParams, FigurePart, FigureShape } from "../types";
import { arrowShapes, r2 } from "./bioDraw";

/**
 * GEL ELECTROPHORESIS, DRAWN FROM THE FRAGMENT SIZES. The board gives the DNA ladder and each
 * sample's fragment sizes (base pairs); the code places every band by its size: DNA is negatively
 * charged, so it runs from the wells at the negative electrode towards the positive one, and the
 * distance a fragment travels falls with the logarithm of its length — shorter fragments travel
 * farther. Ladder sizes are printed beside the ladder so a sample's fragments can be read off it.
 */

export type GelLane = { name: string; sizes: number[] };
export type GelData = { ladder: number[]; samples: GelLane[]; hi: number; lo: number };

const DEFAULT_LADDER = [1000, 800, 600, 400, 200];
const DEFAULT_SAMPLES: GelLane[] = [
  { name: "Sample 1", sizes: [800, 200] },
  { name: "Sample 2", sizes: [600, 400] },
  { name: "Sample 3", sizes: [1000, 600, 200] },
];

/** "600", "600 bp", "1.5 kb" → base pairs; anything else (or outside 10 bp–100 kb) is dropped. */
export function parseSizes(v: unknown): number[] {
  const text = typeof v === "number" ? String(v) : typeof v === "string" ? v : "";
  const out: number[] = [];
  for (const m of text.matchAll(/(\d+(?:\.\d+)?)\s*(kbp|kb|bp)?/gi)) {
    const n = Number(m[1]) * (/^kb/i.test(m[2] ?? "") ? 1000 : 1);
    if (Number.isFinite(n) && n >= 10 && n <= 100000) out.push(Math.round(n));
  }
  return [...new Set(out)].sort((a, b) => b - a).slice(0, 8);
}

/** "Sample X: 600, 200; Sample Y: 800" → lanes (at most 6); a lane without a name is numbered. */
export function parseSamples(v: unknown): GelLane[] {
  if (typeof v !== "string" || !v.trim()) return [];
  return v
    .split(/[;\n|]/)
    .map((chunk, i) => {
      const at = chunk.indexOf(":");
      const rawName = at >= 0 ? chunk.slice(0, at) : "";
      const name = rawName.replace(/[^\p{L}\p{N} '’()\-#.]/gu, "").replace(/\s+/g, " ").trim() || `Sample ${i + 1}`;
      return { name, sizes: parseSizes(at >= 0 ? chunk.slice(at + 1) : chunk) };
    })
    .filter((l) => l.sizes.length)
    .slice(0, 6);
}

export function gelData(params: FigureParams): GelData {
  const ladder = parseSizes(params.ladder);
  const samples = parseSamples(params.samples);
  const lad = ladder.length >= 2 ? ladder : DEFAULT_LADDER;
  const smp = samples.length ? samples : params.samples === undefined ? DEFAULT_SAMPLES : [];
  const all = [...lad, ...smp.flatMap((l) => l.sizes)];
  let hi = Math.max(...all) * 1.25, lo = Math.min(...all) / 1.25;
  // At least a four-fold range, so a narrow set of sizes is not stretched across the whole gel.
  if (hi / lo < 4) { const mid = Math.sqrt(hi * lo); hi = mid * 2; lo = mid / 2; }
  return { ladder: lad, samples: smp, hi, lo };
}

/** How far (0 = at the wells, 1 = the end of the run) a fragment travels: linear in log(size), shorter goes farther. */
export function migration(size: number, hi: number, lo: number): number {
  const f = (Math.log10(hi) - Math.log10(size)) / (Math.log10(hi) - Math.log10(lo));
  return Math.max(0, Math.min(1, f));
}

const C = { gel: "#dbeafe", lane: "#a5b4fc", band: "#6d28d9", neg: "#334155", pos: "#dc2626", well: "#94a3b8" } as const;

export const gelElectrophoresis: FigureComponent = {
  name: "gelElectrophoresis",
  title: "Gel electrophoresis: wells at the negative electrode, a DNA ladder and sample lanes, bands placed by fragment size (shorter fragments travel farther towards the positive electrode)",
  params: `ladder (fragment sizes in bp, default "1000; 800; 600; 400; 200"); samples (";"-separated lanes, each "name: sizes", e.g. "Sample X: 600, 200; Sample Y: 800, 400"; up to 6 lanes, 8 bands each; sizes may be written "1.5 kb"); direction ("down" default: wells at the top, positive electrode at the bottom | "up": wells at the bottom). Band positions are computed from the sizes on a log scale — never give positions.`,
  match: /\bgel electrophoresis\b|\belectrophoresis gel\b|\bagarose gel\b|\bDNA (ladder|fingerprint(ing)?|profil(e|ing))\b|\b(DNA )?fragments?\b(?=[\s\S]{0,100}\b(separated|separate|gel|migrat\w*)\b)(?=[\s\S]{0,140}\bgel\b)|\bbands? on (a|the) gel\b|\bgenetic fingerprint(ing)?\b/i,
  parts: [
    { id: "wells", name: "Wells" },
    { id: "ladder", name: "DNA ladder (size marker)" },
    { id: "sample-lane", name: "Sample lane" },
    { id: "band", name: "Band (DNA fragments)" },
    { id: "negative-electrode", name: "Negative electrode (cathode)" },
    { id: "positive-electrode", name: "Positive electrode (anode)" },
    { id: "migration", name: "Direction of DNA migration" },
  ],
  build(params: FigureParams) {
    const data = gelData(params);
    const flip = /\bup\b|reverse|bottom/i.test(String(params.direction ?? ""));
    const lanes: GelLane[] = [{ name: "", sizes: data.ladder }, ...data.samples];
    const n = lanes.length;
    const gx = 112; // gel's left edge: the migration arrow and the ladder sizes stand to its left
    const pad = 12;
    // Lane pitch: roomy for a few lanes, never wider than the 760-unit drawing allows for many.
    const P = Math.min(Math.max(80, (560 - gx - 70 - 2 * pad) / n), (760 - gx - 70 - 2 * pad) / n, 112);
    const gelW = n * P + 2 * pad;
    const W = Math.max(560, gx + gelW + 70);
    const laneX = (i: number) => gx + pad + (i + 0.5) * P;
    const bandW = P - 28;

    // Logical heights (direction "down"); "up" mirrors them top to bottom, text kept upright.
    const H = 428;
    const Y = (y: number) => (flip ? H - y : y);
    const span = (y0: number, y1: number) => [Math.min(Y(y0), Y(y1)), Math.max(Y(y0), Y(y1))] as const;
    const rect = (x0: number, x1: number, y0: number, y1: number) => { const [a, b] = span(y0, y1); return `M${r2(x0)} ${r2(a)} H${r2(x1)} V${r2(b)} H${r2(x0)} Z`; };
    const textY = (y: number, size: number) => r2(Y(y) + size * 0.35); // baseline that centres the text on y

    const barTop = 12, nameY = 60, gelTop = 76, wellTop = 86, wellBot = 98, runTop = 110, runLen = 266, gelBot = runTop + runLen + 14, barBot = gelBot + 12;
    const shapes: FigureShape[] = [];
    const parts: FigurePart[] = [];

    // The gel slab and a faint track for each lane.
    shapes.push({ t: "path", d: rect(gx, gx + gelW, gelTop, gelBot), fill: C.gel, stroke: "ink", width: 2, opacity: 0.6 });
    lanes.forEach((_, i) => shapes.push({ t: "path", d: rect(laneX(i) - bandW / 2 - 4, laneX(i) + bandW / 2 + 4, wellBot + 2, gelBot - 6), fill: C.lane, stroke: "none", opacity: 0.22, part: i === 0 ? "ladder" : "sample-lane" }));

    // Electrodes: negative at the wells' end, positive at the far end, each marked with its sign.
    const bar = (y0: number, colour: string, sign: string, part: string) => {
      shapes.push({ t: "path", d: rect(gx - 6, gx + gelW + 6, y0, y0 + 10), fill: colour as `#${string}`, stroke: colour as `#${string}`, width: 1.6, part });
      const cx = gx + gelW + 30, cy = Y(y0 + 5);
      shapes.push({ t: "path", d: `M${r2(gx + gelW + 6)} ${r2(cy)} H${r2(cx - 15)}`, stroke: colour as `#${string}`, width: 2, fill: "none", part });
      shapes.push({ t: "circle", cx: r2(cx), cy: r2(cy), r: 15, fill: "paper", stroke: colour as `#${string}`, width: 2.2, part });
      shapes.push({ t: "text", x: r2(cx), y: r2(cy + 8), text: sign, size: 24, anchor: "middle", fill: colour as `#${string}`, part });
    };
    bar(barTop, C.neg, "−", "negative-electrode");
    bar(barBot, C.pos, "+", "positive-electrode");

    // Wells, the sample names above them, and the bands.
    // A name wraps onto two lines over its lane ("Crime scene"), never into the next lane's.
    const maxChars = Math.max(5, Math.floor(P / 8.4));
    const nameLines = (name: string): string[] => {
      const lines: string[] = [];
      for (const word of name.split(" ")) {
        const lastLine = lines[lines.length - 1];
        if (lastLine !== undefined && (lastLine + " " + word).length <= maxChars) lines[lines.length - 1] = lastLine + " " + word;
        else lines.push(word);
      }
      return lines.length > 2 ? [lines[0], fitText(lines.slice(1).join(" "), maxChars)] : lines.map((l) => fitText(l, maxChars));
    };
    lanes.forEach((lane, i) => {
      const x = laneX(i);
      shapes.push({ t: "path", d: rect(x - bandW / 2, x + bandW / 2, wellTop, wellBot), fill: C.well, stroke: "ink", width: 1.8, opacity: 1, part: "wells" });
      const lines = lane.name ? nameLines(lane.name) : [];
      // Upright text: the lines stack downwards whichever way the gel runs, centred on the name slot.
      lines.forEach((line, k) => shapes.push({ t: "text", x: r2(x), y: r2(textY(nameY, 15) + (k - (lines.length - 1)) * 18 + (flip ? (lines.length - 1) * 18 : 0)), text: line, size: 15, anchor: "middle", fill: "ink" }));
      for (const s of lane.sizes) {
        const y = runTop + migration(s, data.hi, data.lo) * runLen;
        shapes.push({ t: "path", d: rect(x - bandW / 2, x + bandW / 2, y - 4, y + 4), fill: C.band, stroke: C.band, width: 1.6, opacity: 0.9, part: i === 0 ? "ladder" : "band" });
        if (i === 0) shapes.push({ t: "text", x: gx - 8, y: textY(y, 15), text: `${s} bp`, size: 15, anchor: "end", fill: "muted" });
      }
    });

    // Direction of migration: beside the gel, from the negative end towards the positive end.
    const ax = 22;
    const [from, to] = [{ x: ax, y: Y(runTop + 20) }, { x: ax, y: Y(runTop + runLen - 10) }];
    shapes.push(...arrowShapes(from, to, "ink", 2.4, "migration", { head: 13 }));

    // Anchors. The ladder's is on its track in the widest gap between its bands, so a leader from the
    // left margin passes between the printed sizes; the sample lane's likewise on the last lane.
    const gapIn = (sizes: number[]) => {
      const ys = [runTop - 4, ...sizes.map((s) => runTop + migration(s, data.hi, data.lo) * runLen), gelBot - 8].sort((a, b) => a - b);
      let best = { y: (ys[0] + ys[1]) / 2, g: -1 };
      for (let k = 0; k < ys.length - 1; k++) if (ys[k + 1] - ys[k] > best.g) best = { y: (ys[k] + ys[k + 1]) / 2, g: ys[k + 1] - ys[k] };
      return best.y;
    };
    const last = lanes[n - 1];
    parts.push({ id: "negative-electrode", name: "Negative electrode (cathode)", anchor: { x: gx - 4, y: r2(Y(barTop + 5)) } });
    parts.push({ id: "wells", name: "Wells", anchor: { x: r2(laneX(0) - bandW / 2 + 3), y: r2(Y((wellTop + wellBot) / 2)) } });
    parts.push({ id: "ladder", name: "DNA ladder (size marker)", anchor: { x: r2(laneX(0) - bandW / 2 - 2), y: r2(Y(gapIn(data.ladder))) } });
    if (n > 1) {
      const lastBand = Math.min(...last.sizes);
      parts.push({ id: "band", name: "Band (DNA fragments)", anchor: { x: r2(laneX(n - 1) + bandW / 2 - 3), y: r2(Y(runTop + migration(lastBand, data.hi, data.lo) * runLen)) } });
      parts.push({ id: "sample-lane", name: "Sample lane", anchor: { x: r2(laneX(n - 1) + bandW / 2 + 2), y: r2(Y(gapIn(last.sizes))) } });
    }
    parts.push({ id: "positive-electrode", name: "Positive electrode (anode)", anchor: { x: gx - 4, y: r2(Y(barBot + 5)) } });
    parts.push({ id: "migration", name: "Direction of DNA migration", anchor: { x: ax, y: r2((from.y + to.y) / 2) } });
    return { w: r2(W), h: H, shapes, parts };
  },
};

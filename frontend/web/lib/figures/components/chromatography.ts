import { solutionColour } from "../colours";
import type { FigureComponent, FigureParams, FigurePart, FigureShape } from "../types";
import { GLASS_W, flag, num, r1, solidColour, surface, text } from "./apparatusKit";

export type Dye = { colour: `#${string}`; colourName: string; distance: number; rf: number };
export type Chromatogram = { front: number; dyes: Dye[]; references: Array<{ name: string; dyes: Dye[] }> };

const list = (v: unknown) => (typeof v === "string" ? v.split(/[,;]/).map((s) => s.trim()).filter(Boolean) : typeof v === "number" ? [String(v)] : []);
const rf = (d: number, front: number) => Math.round((d / front) * 100) / 100;

/**
 * The chemistry of the chromatogram, separate from the drawing so it can be checked: each dye's
 * distance from the baseline (clamped below the solvent front) and its Rf = distance moved by the
 * dye ÷ distance moved by the solvent. A reference with no distance of its own takes the distance of
 * the sample dye of the same colour (the same substance travels the same distance).
 */
export function chromatogram(params: FigureParams): Chromatogram {
  const front = num(params.front, 8, 2, 20);
  const colours = list(params.dyes).slice(0, 5);
  const given = list(params.distances).map((d) => parseFloat(d));
  const names = colours.length ? colours : ["blue", "red", "yellow"];
  const fallback = names.map((_, i) => (front * (i + 1)) / (names.length + 1));
  const dyes: Dye[] = names.map((c, i) => {
    const d = Number.isFinite(given[i]) ? Math.max(0, Math.min(front - 0.3, given[i])) : fallback[i];
    return { colour: solidColour(c, "blue"), colourName: c.toLowerCase(), distance: Math.round(d * 10) / 10, rf: rf(d, front) };
  });
  const references = list(params.references).slice(0, 4).map((entry, i) => {
    const m = /^([^:]+):\s*(.+)$/.exec(entry);
    const name = (m ? m[1] : String.fromCharCode(65 + i)).trim().slice(0, 5);
    const spec = (m ? m[2] : entry).trim();
    const dist = /(-?\d+(\.\d+)?)\s*(cm)?$/.exec(spec);
    const colourName = spec.replace(/(-?\d+(\.\d+)?)\s*(cm)?$/, "").trim().toLowerCase() || "blue";
    const same = dyes.find((d) => d.colourName === colourName);
    const d = dist ? Math.max(0, Math.min(front - 0.3, parseFloat(dist[1]))) : same ? same.distance : front / 2;
    return { name, dyes: [{ colour: solidColour(colourName, "blue"), colourName, distance: Math.round(d * 10) / 10, rf: rf(d, front) }] };
  });
  return { front, dyes, references };
}

/**
 * Paper chromatography, drawn as in O Level / IGCSE books: a beaker with a lid, the paper hanging
 * from a glass rod across the rim, its bottom edge in the solvent, the pencil baseline ABOVE the
 * solvent level, the separated dye spots of the sample (rightmost column) beside any known reference
 * dyes, and the dashed solvent front. Optionally writes each sample dye's Rf beside the paper.
 */
export const chromatography: FigureComponent = {
  name: "chromatography",
  title: "Paper chromatography: beaker with lid, chromatography paper, pencil baseline above the solvent, separated dye spots, solvent front (Rf values optional)",
  params: `sample (what was spotted, e.g. "black ink"), dyes (comma list of the sample's dye colours, bottom to top or any order, e.g. "blue, red, yellow"; up to 5), distances (comma list, cm each dye moved from the baseline, same order, e.g. "1.8, 4.2, 6.0"; 0 = insoluble, stays on the baseline), front (cm the solvent moved, default 8), references (known dyes beside the sample, e.g. "A: blue, B: red, C: green 3.1" — a colour alone takes the sample dye's distance), solvent (e.g. "water", "ethanol"), solventColour (default colourless), showRf (true writes Rf = distance ÷ front beside each sample dye)`,
  match: /\bchromatogra(m|phy|phic)\b|\bsolvent front\b|\bR\s?f\b(?=.*\b(values?|dyes?|spots?|solvent)\b)|\bretention factor\b/i,
  parts: [
    { id: "beaker", name: "Beaker" },
    { id: "lid", name: "Lid" },
    { id: "paper", name: "Chromatography paper" },
    { id: "baseline", name: "Pencil baseline" },
    { id: "solvent", name: "Solvent" },
    { id: "solvent-front", name: "Solvent front" },
    { id: "sample", name: "Sample spot (start)" },
    { id: "spots", name: "Separated dyes" },
  ],
  build(params: FigureParams) {
    const chem = chromatogram(params);
    const sampleName = text(params.sample, "Sample");
    const solventName = text(params.solvent, "Solvent");
    const solventColour = solutionColour(params.solventColour, "colourless");
    const showRf = flag(params.showRf, false);
    const shapes: FigureShape[] = [];

    const columns = [...chem.references.map((r) => ({ name: r.name, dyes: r.dyes, sample: false })), { name: "", dyes: chem.dyes, sample: true }];
    const colGap = 44;
    const paperW = Math.max(96, columns.length * colGap + 28);
    const leftRoom = showRf ? 78 : 26, rightRoom = 26;
    const bx = 12, bw = leftRoom + paperW + rightRoom;
    const rimY = 48, base = 424;
    const px = bx + leftRoom, pr = px + paperW;
    const paperTop = 40, paperBottom = 412, solventY = 390, baseY = 362, frontY = 84;
    const k = (baseY - frontY) / chem.front;
    const colX = (i: number) => px + 14 + colGap / 2 + i * colGap + (paperW - 28 - columns.length * colGap) / 2;
    const W = bx * 2 + bw, H = base + 10;

    // ---- Paper (with the part the solvent has wetted tinted), baseline, front.
    shapes.push({ t: "path", part: "paper", d: `M${px} ${paperTop} H${pr} V${paperBottom} H${px} Z`, fill: "paper", stroke: "ink", width: 1.6 });
    shapes.push({ t: "path", part: "paper", d: `M${px} ${paperTop + 14} H${pr}`, stroke: "ink", width: 1, fill: "none", opacity: 0.5 });
    shapes.push({ t: "path", part: "solvent-front", d: `M${px + 1} ${frontY} H${pr - 1} V${paperBottom - 1} H${px + 1} Z`, fill: "glass", stroke: "none" });
    shapes.push({ t: "path", part: "solvent-front", d: `M${px} ${frontY} H${pr}`, stroke: "ink", width: 1.6, dash: "6 4", fill: "none" });
    shapes.push({ t: "path", part: "baseline", d: `M${px} ${baseY} H${pr}`, stroke: "muted", width: 1.4, fill: "none" });

    // ---- Spots: a pencil mark where each was put on, the dyes where they travelled to.
    let topSpot = { x: colX(columns.length - 1), y: baseY };
    columns.forEach((col, i) => {
      const x = colX(i);
      shapes.push({ t: "circle", part: col.sample ? "sample" : "baseline", cx: r1(x), cy: baseY, r: 2.2, fill: "muted", stroke: "none" });
      for (const dye of col.dyes) {
        const y = baseY - dye.distance * k;
        const ry = dye.distance === 0 ? 5 : 6.5;
        shapes.push({ t: "path", part: col.sample ? (dye.distance === 0 ? "sample" : "spots") : "baseline", d: `M${r1(x - 7.5)} ${r1(y)} a7.5 ${ry} 0 1 0 15 0 a7.5 ${ry} 0 1 0 -15 0 Z`, fill: dye.colour, stroke: "ink", width: 1, opacity: 0.9 });
        if (col.sample && dye.distance > 0 && y < topSpot.y) topSpot = { x: x + 7.5, y };
      }
      if (!col.sample) shapes.push({ t: "text", part: "baseline", x: r1(x), y: baseY + 18, text: col.name, size: 12, anchor: "middle", fill: "muted" });
      else if (columns.length > 1) shapes.push({ t: "text", part: "sample", x: r1(x), y: baseY + 18, text: "S", size: 12, anchor: "middle", fill: "muted" });
    });
    if (showRf) {
      for (const dye of chem.dyes) {
        if (dye.distance <= 0) continue;
        shapes.push({ t: "text", part: "spots", x: px - 8, y: r1(baseY - dye.distance * k + 4), text: `Rf ${dye.rf.toFixed(2)}`, size: 12, anchor: "end", fill: "muted" });
      }
    }

    // ---- Solvent (in front of the paper's foot), beaker, rod across the rim, lid.
    shapes.push({ t: "path", part: "solvent", d: `M${bx + 1.5} ${solventY} H${bx + bw - 1.5} V${base - 6} Q${bx + bw - 1.5} ${base - 1.5} ${bx + bw - 6} ${base - 1.5} H${bx + 6} Q${bx + 1.5} ${base - 1.5} ${bx + 1.5} ${base - 6} Z`, fill: solventColour, stroke: "none", opacity: 0.6 });
    shapes.push({ t: "path", part: "solvent", d: surface(bx + 1.5, bx + bw - 1.5, solventY), stroke: "ink", width: 1.4, fill: "none" });
    shapes.push({ t: "path", part: "beaker", d: `M${bx} ${rimY} V${base - 6} Q${bx} ${base} ${bx + 6} ${base} H${bx + bw - 6} Q${bx + bw} ${base} ${bx + bw} ${base - 6} V${rimY}`, stroke: "ink", width: GLASS_W, fill: "none" });
    shapes.push({ t: "path", part: "paper", d: `M${px - 14} ${rimY - 8} h${paperW + 28} v7 h${-paperW - 28} z`, fill: "glass", stroke: "ink", width: 1.4 });
    shapes.push({ t: "path", part: "lid", d: `M${bx - 8} ${rimY - 18} H${bx + bw + 8} V${rimY - 9} H${bx - 8} Z`, fill: "glass", stroke: "ink", width: 2 });

    const parts: FigurePart[] = [
      { id: "lid", name: "Lid", anchor: { x: bx + 4, y: rimY - 13.5 } },
      { id: "beaker", name: "Beaker", anchor: { x: bx, y: (rimY + baseY) / 2 + 14 } },
      { id: "baseline", name: "Pencil baseline", anchor: { x: px + 6, y: baseY } },
      { id: "solvent", name: solventName, anchor: { x: bx + Math.min(30, leftRoom - 6), y: (solventY + base) / 2 } },
      { id: "paper", name: "Chromatography paper", anchor: { x: pr, y: (paperTop + frontY) / 2 + 8 } },
      { id: "solvent-front", name: "Solvent front", anchor: { x: pr - 6, y: frontY } },
      { id: "spots", name: "Separated dyes", anchor: topSpot },
      { id: "sample", name: `${sampleName} (start)`, anchor: { x: colX(columns.length - 1) + 3, y: baseY } },
    ];
    for (const p of parts) p.anchor = { x: r1(p.anchor.x), y: r1(p.anchor.y) };
    return { w: W, h: H, shapes, parts };
  },
};

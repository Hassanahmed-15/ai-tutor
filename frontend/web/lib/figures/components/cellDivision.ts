import type { FigureComponent, FigureParams, FigurePart, FigureShape, Pt } from "../types";
import { BIO, arrowShapes, r2, smoothClosed } from "./bioDraw";

type Division = "mitosis" | "meiosis";
export type StageId =
  | "prophase" | "metaphase" | "anaphase" | "telophase" | "daughter"
  | "prophase-1" | "metaphase-1" | "anaphase-1" | "telophase-1" | "metaphase-2" | "anaphase-2" | "telophase-2" | "gametes";
/** One chromosome: which homologous pair, which homologue (0 maternal, 1 paternal), and whether it is duplicated (two chromatids). */
export type Chrom = { pair: number; hom: 0 | 1; dup: boolean };
export type StagePlan = { id: StageId; caption: string; groups: Chrom[][] };

const MITOSIS: StageId[] = ["prophase", "metaphase", "anaphase", "telophase", "daughter"];
const MEIOSIS: StageId[] = ["prophase-1", "metaphase-1", "anaphase-1", "telophase-1", "metaphase-2", "anaphase-2", "telophase-2", "gametes"];
/** The overview drawn for "all": meiosis leaves out telophase II (the four cells say it). */
const MEIOSIS_ALL: StageId[] = ["prophase-1", "metaphase-1", "anaphase-1", "telophase-1", "metaphase-2", "anaphase-2", "gametes"];
const CAPTION: Record<StageId, string> = {
  prophase: "Prophase", metaphase: "Metaphase", anaphase: "Anaphase", telophase: "Telophase", daughter: "Daughter cells",
  "prophase-1": "Prophase I", "metaphase-1": "Metaphase I", "anaphase-1": "Anaphase I", "telophase-1": "Telophase I",
  "metaphase-2": "Metaphase II", "anaphase-2": "Anaphase II", "telophase-2": "Telophase II", gametes: "4 daughter cells",
};
const HOM = [BIO.red, BIO.blue] as const;

/** Stage words → the stages, in the order the division goes through them. */
export function parseStages(v: unknown, type: Division): StageId[] {
  const s = String(v ?? "all").toLowerCase();
  if (!s.trim() || /\b(all|sequence|every|whole|full|overview|stages)\b/.test(s)) return type === "mitosis" ? [...MITOSIS] : [...MEIOSIS_ALL];
  const out = new Set<StageId>();
  for (const tok of s.split(/[,;>→]+|\band\b|\bthen\b/)) {
    const m = /(pro|meta|ana|telo)\s*-?phase\s*(ii|2|i|1)?\b/.exec(tok.trim());
    if (m) {
      const base = ({ pro: "prophase", meta: "metaphase", ana: "anaphase", telo: "telophase" } as const)[m[1] as "pro"];
      if (type === "mitosis") out.add(base);
      else {
        const two = m[2] === "ii" || m[2] === "2";
        out.add(base === "prophase" ? "prophase-1" : (`${base}-${two ? 2 : 1}` as StageId));
      }
    } else if (/daughter|cytokinesis|result|gamete|product|end/.test(tok)) out.add(type === "mitosis" ? "daughter" : "gametes");
  }
  const order = type === "mitosis" ? MITOSIS : MEIOSIS;
  const list = order.filter((id) => out.has(id));
  return list.length ? list : type === "mitosis" ? [...MITOSIS] : [...MEIOSIS_ALL];
}

/**
 * The chromosomes at each stage, from 2n: mitosis keeps every chromosome in each of 2 daughter cells
 * (2n each); meiosis I separates the homologous pairs (n duplicated chromosomes per cell, one of each
 * pair, independent assortment), meiosis II the sister chromatids, giving 4 cells of n.
 */
export function divisionPlan(params: FigureParams): { type: Division; twoN: number; n: number; stages: StagePlan[] } {
  const type: Division = /meio|gamete|reduction/i.test(String(params.type ?? params.division ?? "")) ? "meiosis" : "mitosis";
  const raw = Number(typeof params.chromosomes === "string" ? params.chromosomes.replace(/^\s*2n\s*=\s*/i, "") : params.chromosomes ?? params.diploid ?? params.twoN ?? 4);
  const twoN = Number.isFinite(raw) ? Math.max(2, Math.min(8, 2 * Math.round(raw / 2))) : 4;
  const n = twoN / 2;
  const pairs = Array.from({ length: n }, (_, k) => k);
  const all = (dup: boolean): Chrom[] => pairs.flatMap((pair) => [{ pair, hom: 0 as const, dup }, { pair, hom: 1 as const, dup }]);
  // Independent assortment: which homologue of each pair goes to the first (left) cell.
  const first = (k: number): 0 | 1 => ((k % 2) as 0 | 1);
  const half = (side: 0 | 1, dup: boolean): Chrom[] => pairs.map((pair) => ({ pair, hom: (side === 0 ? first(pair) : 1 - first(pair)) as 0 | 1, dup }));
  const groups: Record<StageId, () => Chrom[][]> = {
    prophase: () => [all(true)], metaphase: () => [all(true)], anaphase: () => [all(false), all(false)],
    telophase: () => [all(false), all(false)], daughter: () => [all(false), all(false)],
    "prophase-1": () => [all(true)], "metaphase-1": () => [all(true)], "anaphase-1": () => [half(0, true), half(1, true)],
    "telophase-1": () => [half(0, true), half(1, true)], "metaphase-2": () => [half(0, true), half(1, true)],
    "anaphase-2": () => [half(0, false), half(0, false), half(1, false), half(1, false)],
    "telophase-2": () => [half(0, false), half(0, false), half(1, false), half(1, false)],
    gametes: () => [half(0, false), half(0, false), half(1, false), half(1, false)],
  };
  const ids = parseStages(params.stage ?? params.stages, type);
  return { type, twoN, n, stages: ids.map((id) => ({ id, caption: CAPTION[id], groups: groups[id]() })) };
}

const R = 64; // a whole cell's radius
const CAP = 30; // room for a stage's caption

/**
 * Mitosis or meiosis, drawn stage by stage the way textbooks draw it: homologous chromosomes the same
 * size in two colours (one from each parent), duplicated chromosomes as two sister chromatids joined at
 * a centromere, spindle fibres from the poles to the centromeres, and the daughter cells with exactly
 * the chromosomes the division gives them — 2n in each of two cells (mitosis), n in each of four (meiosis).
 */
export const cellDivision: FigureComponent = {
  name: "cellDivision",
  title: "Cell division (mitosis or meiosis) stage by stage: chromosomes, spindle fibres, centromeres, daughter cells with correct chromosome numbers",
  params: `type ("mitosis" — default — or "meiosis"); stage ("all" — default: every stage in order — or one or more of "prophase", "metaphase", "anaphase", "telophase", "daughter cells"; for meiosis add I or II, e.g. "metaphase I", "anaphase II"); chromosomes (the diploid number 2n: 2, 4 — default —, 6 or 8). Code draws each stage consistently and gives the daughter cells the right number of chromosomes (2n each for mitosis, n each in four cells for meiosis).`,
  match: /\b(mitosis|mitotic|meiosis|meiotic|cell division|cell cycle|(pro|meta|ana|telo)phase|sister chromatids?|spindle fibres?|homologous (pairs?|chromosomes)|crossing over|haploid|diploid)\b/i,
  parts: [
    { id: "chromosome", name: "Chromosome (two chromatids)" },
    { id: "chromatid", name: "Chromatid" },
    { id: "centromere", name: "Centromere" },
    { id: "spindle", name: "Spindle fibres" },
    { id: "nuclear-membrane", name: "Nuclear membrane" },
    { id: "homologous-pair", name: "Homologous pair" },
    { id: "daughter-cells", name: "Daughter cells" },
  ],
  build(params: FigureParams) {
    const plan = divisionPlan(params);
    const { twoN } = plan;
    const Lmax = R * (twoN <= 4 ? 0.42 : twoN <= 6 ? 0.24 : 0.18);
    const len = (c: Chrom) => Lmax * Math.max(0.42, 1 - 0.2 * c.pair);
    const thick = Math.max(3.4, Lmax * 0.2);
    const shapes: FigureShape[] = [];
    const anchors = new Map<string, Pt>();

    /* ── primitives ─────────────────────────────────────────────────────────────────────── */
    const chromatidPath = (a: Pt, ctl: Pt, b: Pt) => `M${r2(a.x)} ${r2(a.y)} Q${r2(ctl.x)} ${r2(ctl.y)} ${r2(b.x)} ${r2(b.y)}`;
    /** A duplicated chromosome: two sister chromatids bowed apart, joined at the centromere. Axis angle a. */
    const xChrom = (c: Pt, ch: Chrom, a: number, tag?: string, cenTag?: string) => {
      const L = len(ch), u = { x: Math.cos(a), y: Math.sin(a) }, p = { x: -u.y, y: u.x };
      const sp = L * 0.24;
      const ends: Pt[][] = [];
      for (const s of [-1, 1]) {
        const e1 = { x: c.x + (u.x * L) / 2 + p.x * s * sp, y: c.y + (u.y * L) / 2 + p.y * s * sp };
        const e2 = { x: c.x - (u.x * L) / 2 + p.x * s * sp, y: c.y - (u.y * L) / 2 + p.y * s * sp };
        // The curve passes the centromere just off the axis, so the two chromatids touch there.
        const mid = { x: c.x + p.x * s * thick * 0.45, y: c.y + p.y * s * thick * 0.45 };
        const ctl = { x: 2 * mid.x - (e1.x + e2.x) / 2, y: 2 * mid.y - (e1.y + e2.y) / 2 };
        shapes.push({ t: "path", ...(tag ? { part: tag } : {}), d: chromatidPath(e1, ctl, e2), stroke: HOM[ch.hom], width: thick, fill: "none" });
        ends.push([e1, e2]);
      }
      shapes.push({ t: "circle", ...(cenTag ? { part: cenTag } : {}), cx: r2(c.x), cy: r2(c.y), r: r2(thick * 0.62), fill: "ink", stroke: "none" });
      return ends;
    };
    /** One chromatid pulled towards a pole: a V with the centromere leading. */
    const vChrom = (c: Pt, ch: Chrom, towards: Pt, tag?: string) => {
      const L = len(ch);
      const d = Math.hypot(towards.x - c.x, towards.y - c.y) || 1;
      const f = { x: (towards.x - c.x) / d, y: (towards.y - c.y) / d }, side = { x: -f.y, y: f.x };
      const a1 = { x: c.x - f.x * L * 0.42 + side.x * L * 0.3, y: c.y - f.y * L * 0.42 + side.y * L * 0.3 };
      const a2 = { x: c.x - f.x * L * 0.42 - side.x * L * 0.3, y: c.y - f.y * L * 0.42 - side.y * L * 0.3 };
      const ctl = { x: 2 * c.x - (a1.x + a2.x) / 2, y: 2 * c.y - (a1.y + a2.y) / 2 };
      shapes.push({ t: "path", ...(tag ? { part: tag } : {}), d: chromatidPath(a1, ctl, a2), stroke: HOM[ch.hom], width: thick, fill: "none" });
      shapes.push({ t: "circle", cx: r2(c.x), cy: r2(c.y), r: r2(thick * 0.55), fill: "ink", stroke: "none" });
      return a1;
    };
    /** An unduplicated chromosome (one chromatid) lying in a new nucleus. */
    const rod = (c: Pt, ch: Chrom, a: number, scale = 0.8) => {
      const L = len(ch) * scale, u = { x: Math.cos(a), y: Math.sin(a) }, p = { x: -u.y, y: u.x };
      const e1 = { x: c.x + (u.x * L) / 2, y: c.y + (u.y * L) / 2 }, e2 = { x: c.x - (u.x * L) / 2, y: c.y - (u.y * L) / 2 };
      shapes.push({ t: "path", d: chromatidPath(e1, { x: c.x + p.x * L * 0.18, y: c.y + p.y * L * 0.18 }, e2), stroke: HOM[ch.hom], width: thick * 0.9, fill: "none" });
    };
    const cell = (pts: Pt[], tag?: string) => {
      const d = smoothClosed(pts);
      shapes.push({ t: "path", ...(tag ? { part: tag } : {}), d, fill: BIO.amber, stroke: "none", opacity: 0.09 });
      shapes.push({ t: "path", ...(tag ? { part: tag } : {}), d, fill: "none", stroke: "ink", width: 2.2 });
    };
    const ellipse = (c: Pt, rx: number, ry: number, pinch = 0) => Array.from({ length: 28 }, (_, i) => {
      const t = (i / 28) * Math.PI * 2, x = Math.cos(t), y = Math.sin(t);
      // A cleavage furrow: the outline drawn in towards the middle.
      const k = 1 - pinch * Math.exp(-((x / 0.32) ** 2));
      return { x: c.x + rx * x, y: c.y + ry * y * k };
    });
    const nucleus = (c: Pt, r: number, dashed: boolean, tag?: string) => {
      shapes.push({ t: "circle", ...(tag ? { part: tag } : {}), cx: r2(c.x), cy: r2(c.y), r: r2(r), fill: BIO.violet, stroke: "none", opacity: 0.08 });
      shapes.push({ t: "circle", ...(tag ? { part: tag } : {}), cx: r2(c.x), cy: r2(c.y), r: r2(r), fill: "none", stroke: BIO.violet, width: 2, ...(dashed ? { dash: "7 6" } : {}) });
    };
    const pole = (p: Pt) => {
      let d = "";
      for (let i = 0; i < 6; i++) { const a = (i * Math.PI) / 3 + 0.3; d += `M${r2(p.x + 4 * Math.cos(a))} ${r2(p.y + 4 * Math.sin(a))} L${r2(p.x + 10 * Math.cos(a))} ${r2(p.y + 10 * Math.sin(a))} `; }
      shapes.push({ t: "path", d: d.trim(), stroke: "muted", width: 1.4, fill: "none" });
      shapes.push({ t: "circle", cx: r2(p.x), cy: r2(p.y), r: 3.2, fill: "muted", stroke: "none" });
    };
    const fibre = (from: Pt, to: Pt, tag?: string) => {
      const mid = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 + (to.y - from.y) * 0.08 };
      shapes.push({ t: "path", ...(tag ? { part: tag } : {}), d: `M${r2(from.x)} ${r2(from.y)} Q${r2(mid.x)} ${r2(mid.y)} ${r2(to.x)} ${r2(to.y)}`, stroke: "muted", width: 1.3, fill: "none", opacity: 0.9 });
      return { x: (from.x + 2 * mid.x + to.x) / 4, y: (from.y + 2 * mid.y + to.y) / 4 };
    };
    /** Vertical positions for a stack of items of the given heights, centred on cy. */
    const stack = (hs: number[], cy: number, gap: number) => {
      const total = hs.reduce((a, b) => a + b, 0) + gap * (hs.length - 1);
      let y = cy - total / 2;
      return hs.map((h) => { const c = y + h / 2; y += h + gap; return c; });
    };
    const ring = (count: number, c: Pt, rad: number, phase = -Math.PI / 2): Pt[] =>
      count === 1 ? [c] : Array.from({ length: count }, (_, i) => ({ x: c.x + rad * Math.cos(phase + (i * 2 * Math.PI) / count), y: c.y + rad * Math.sin(phase + (i * 2 * Math.PI) / count) }));

    /** Rods in a nucleus (telophase, daughter cells): every chromosome its group has. */
    const nucleusWith = (c: Pt, r: number, group: Chrom[], tag?: string) => {
      nucleus(c, r, false, tag);
      ring(group.length, c, group.length > 2 ? r * 0.5 : r * 0.34, -Math.PI / 2 + 0.4).forEach((p, i) => rod(p, group[i], 0.5 + i * 1.1));
    };

    /* ── one stage, centred at c, in a panel of the size panelSize gives ─────────────── */
    type Box = { w: number; h: number };
    const sub = R * 0.7; // a cell's radius in meiosis II
    const panelSize = (id: StageId): Box => {
      if (id === "telophase" || id === "telophase-1") return { w: 2.9 * R + 12, h: 2 * R + 12 };
      if (id === "daughter") return { w: 4 * 0.68 * R + 30, h: 2 * R + 12 };
      if (id === "metaphase-2" || id === "anaphase-2") return { w: 4 * 1.12 * sub + 30, h: 2 * R + 12 };
      if (id === "telophase-2") return { w: 4 * 1.42 * sub + 30, h: 2 * R + 12 };
      if (id === "gametes") return { w: 4 * 0.5 * R + 26, h: 2 * R + 12 };
      if (id === "anaphase" || id === "anaphase-1") return { w: 2.3 * R + 12, h: 2 * R + 12 };
      return { w: 2.1 * R + 12, h: 2 * R + 12 };
    };

    /* ── which panel each label points into: a panel at the end of its row (so the leader comes
       straight in from the margin), spreading the labels over the panels ─────────────────────── */
    const stages = plan.stages;
    const perRow = stages.length <= 3 ? stages.length : Math.ceil(stages.length / 2);
    const rows: StagePlan[][] = [];
    for (let i = 0; i < stages.length; i += perRow) rows.push(stages.slice(i, i + perRow));
    const FEATURES: Record<string, StageId[]> = {
      "daughter-cells": ["daughter", "gametes", "telophase-2"],
      "homologous-pair": ["prophase-1", "metaphase-1"],
      spindle: ["metaphase", "metaphase-1", "metaphase-2", "anaphase", "anaphase-1", "anaphase-2"],
      chromatid: ["anaphase", "anaphase-2"],
      centromere: ["metaphase", "metaphase-2", "metaphase-1", "prophase", "anaphase-1", "telophase-1"],
      chromosome: ["prophase", "metaphase", "prophase-1", "metaphase-1", "anaphase-1", "telophase-1", "metaphase-2"],
      "nuclear-membrane": ["prophase", "prophase-1", "telophase", "telophase-1", "telophase-2", "daughter", "gametes"],
    };
    /** For a lone panel, the margin each part's label stands in, so the labels balance. */
    const LONE_SIDE: Record<string, -1 | 1> = { "daughter-cells": 1, "homologous-pair": -1, "nuclear-membrane": -1, spindle: -1, centromere: 1, chromosome: 1, chromatid: 1 };
    const owner = new Map<string, number>(), sideOf = new Map<string, -1 | 1>();
    const load = stages.map(() => 0);
    const edge = (i: number): -1 | 1 | 0 => {
      const ri = Math.floor(i / perRow), row = rows[ri], j = i - ri * perRow;
      return row.length === 1 ? 0 : j === 0 ? -1 : j === row.length - 1 ? 1 : 0;
    };
    for (const id of Object.keys(FEATURES)) {
      // Telophase II's cells are the daughter cells only when it is the last stage drawn.
      if (id === "daughter-cells" && !stages.some((s) => s.id === "daughter" || s.id === "gametes") && stages[stages.length - 1].id !== "telophase-2") continue;
      let best = -1, bestScore = Infinity;
      stages.forEach((st, i) => {
        const rank = FEATURES[id].indexOf(st.id);
        if (rank < 0) return;
        const lone = stages.length === 1;
        const score = (lone || edge(i) !== 0 ? 0 : 20) + load[i] * 4 + rank;
        if (score < bestScore) { bestScore = score; best = i; }
      });
      // A panel inside a row cannot be reached without a leader crossing its neighbours: no label there.
      if (best < 0 || bestScore >= 20) continue;
      owner.set(id, best);
      load[best]++;
      sideOf.set(id, edge(best) || LONE_SIDE[id]);
    }
    let panel = -1;
    const mine = (id: string) => owner.get(id) === panel && !anchors.has(id);
    const side = (id: string) => sideOf.get(id) ?? 1;
    const tagIf = (id: string, cond = true) => (cond && mine(id) ? id : undefined);
    const once = (id: string, p: Pt) => { if (mine(id)) anchors.set(id, { x: r2(p.x), y: r2(p.y) }); };
    /** The index of the item furthest towards a side (by x). */
    const extreme = (pts: Pt[], s: number) => pts.reduce((b, p, i) => (s * p.x > s * pts[b].x ? i : b), 0);

    const drawStage = (st: StagePlan, c: Pt) => {
      const id = st.id;
      const [g0, g1 = [], g2 = [], g3 = []] = st.groups;
      if (id === "prophase" || id === "prophase-1") {
        cell(ellipse(c, R, R));
        const rn = R * 0.68;
        nucleus(c, rn, true, tagIf("nuclear-membrane"));
        once("nuclear-membrane", { x: c.x + side("nuclear-membrane") * rn, y: c.y + 8 });
        if (id === "prophase") {
          const pts = ring(g0.length, c, g0.length > 2 ? rn * 0.5 : rn * 0.3, -Math.PI / 2 + 0.3);
          const iChrom = extreme(pts, side("chromosome")), iCen = extreme(pts, side("centromere"));
          pts.forEach((p, i) => {
            const ends = xChrom(p, g0[i], 0.6 + i * 1.05, tagIf("chromosome", i === iChrom), tagIf("centromere", i === iCen));
            if (i === iChrom) once("chromosome", side("chromosome") * ends[0][0].x > side("chromosome") * ends[1][1].x ? ends[0][0] : ends[1][1]);
            if (i === iCen) once("centromere", p);
          });
        } else {
          // Homologous chromosomes paired up (bivalents), side by side.
          const pairs = Array.from({ length: plan.n }, (_, k) => g0.filter((ch) => ch.pair === k));
          const pts = ring(pairs.length, c, pairs.length > 1 ? rn * 0.45 : 0, Math.PI);
          const iPair = extreme(pts, side("homologous-pair"));
          // The chromosome a label names is in another pair than the one "homologous pair" names.
          let iChrom = extreme(pts, side("chromosome"));
          if (iChrom === iPair && pts.length > 1 && owner.get("homologous-pair") === panel) iChrom = extreme(pts, -side("chromosome"));
          pts.forEach((p, k) => {
            const a = Math.PI / 2 + 0.5 * k, o = { x: Math.cos(a + Math.PI / 2) * len(pairs[k][0]) * 0.3, y: Math.sin(a + Math.PI / 2) * len(pairs[k][0]) * 0.3 };
            const tag = tagIf("homologous-pair", k === iPair);
            const both = [{ x: p.x - o.x, y: p.y - o.y }, { x: p.x + o.x, y: p.y + o.y }];
            const lonePair = pts.length === 1 && k === iChrom;
            const e = both.map((q, h) => xChrom(q, pairs[k][h], a, lonePair && h === 1 ? tagIf("chromosome") : tag ?? tagIf("chromosome", k === iChrom && h === 1)));
            if (tag) once("homologous-pair", { x: p.x, y: p.y - len(pairs[k][0]) * 0.3 });
            if (k === iChrom) once("chromosome", e[1][1][0]);
          });
        }
        return;
      }
      if (id === "metaphase" || id === "metaphase-1" || id === "metaphase-2") {
        const cells = id === "metaphase-2" ? [{ c: { x: c.x - 1.12 * sub - 7, y: c.y }, r: sub, g: g0 }, { c: { x: c.x + 1.12 * sub + 7, y: c.y }, r: sub, g: g1 }] : [{ c, r: R, g: g0 }];
        const pick = (id2: string) => (cells.length === 1 ? 0 : side(id2) < 0 ? 0 : 1);
        cells.forEach(({ c: cc, r, g }, ci) => {
          cell(ellipse(cc, r * 1.05, r));
          const P = [{ x: cc.x - r * 0.92, y: cc.y }, { x: cc.x + r * 0.92, y: cc.y }];
          P.forEach(pole);
          // Metaphase I: pairs side by side across the equator; otherwise single chromosomes on it.
          const rows2: Chrom[][] = id === "metaphase-1" ? Array.from({ length: plan.n }, (_, k) => {
            const pr = g.filter((ch) => ch.pair === k);
            return pr[0].hom === (k % 2) ? pr : [pr[1], pr[0]];
          }) : g.map((ch) => [ch]);
          const ys = stack(rows2.map((row) => len(row[0]) + thick), cc.y, twoN >= 6 ? 2 : 3);
          rows2.forEach((row, k) => {
            row.forEach((ch, j) => {
              const x = row.length === 2 ? cc.x + (j ? 1 : -1) * len(ch) * 0.32 : cc.x;
              const cen = { x, y: ys[k] };
              const sj = row.length === 2 ? (j ? 1 : -1) : 0;
              // In metaphase I the top pair is "homologous pair", so the centromere is the bottom row's, and
              // the chromosome (when also here) is the other homologue of that row.
              const cenRow = id === "metaphase-1" ? rows2.length - 1 : 0;
              const isCen = ci === pick("centromere") && k === cenRow && (sj === 0 || sj === side("centromere"));
              const chromSide = id === "metaphase-1" && owner.get("centromere") === panel && side("centromere") === side("chromosome") ? -side("chromosome") : side("chromosome");
              const isPair = ci === 0 && k === 0;
              const isChrom = ci === pick("chromosome") && k === rows2.length - 1 && (sj === 0 || sj === chromSide) && !(isCen && sj !== 0);
              const tag = tagIf("homologous-pair", isPair) ?? tagIf("chromosome", isChrom);
              xChrom(cen, ch, Math.PI / 2, tag, tagIf("centromere", isCen));
              if (isPair && j === 0) once("homologous-pair", { x: cc.x, y: cen.y - len(ch) * 0.3 });
              if (isChrom && !tagIf("homologous-pair", isPair)) once("chromosome", { x: cen.x + (side("chromosome") * len(ch) * 0.24), y: cen.y + len(ch) * 0.45 });
              if (isCen) once("centromere", cen);
              // Fibres to the centromere: from both poles (sister chromatids face opposite poles),
              // or, in metaphase I, each homologue from its own side's pole.
              const from = row.length === 2 ? [P[j]] : P;
              for (const q of from) {
                const qs = q === P[0] ? -1 : 1;
                const isSp = ci === pick("spindle") && k === rows2.length - 1 && qs === side("spindle");
                const m = fibre(q, cen, tagIf("spindle", isSp));
                if (isSp) once("spindle", m);
              }
            });
          });
        });
        return;
      }
      if (id === "anaphase" || id === "anaphase-1" || id === "anaphase-2") {
        const cells = id === "anaphase-2"
          ? [{ c: { x: c.x - 1.12 * sub - 7, y: c.y }, r: sub, l: g0, rgt: g1 }, { c: { x: c.x + 1.12 * sub + 7, y: c.y }, r: sub, l: g2, rgt: g3 }]
          : [{ c, r: R, l: g0, rgt: g1 }];
        const pick = (id2: string) => (cells.length === 1 ? 0 : side(id2) < 0 ? 0 : 1);
        cells.forEach(({ c: cc, r, l, rgt }, ci) => {
          const rx = id === "anaphase-2" ? r * 1.08 : r * 1.12;
          cell(ellipse(cc, rx, r * 0.96));
          const P = [{ x: cc.x - rx * 0.86, y: cc.y }, { x: cc.x + rx * 0.86, y: cc.y }];
          P.forEach(pole);
          [l, rgt].forEach((g, sIdx) => {
            const s = sIdx ? 1 : -1;
            const ys = stack(g.map((ch) => (g[0].dup ? len(ch) + thick : len(ch) * 0.62)), cc.y, 4);
            g.forEach((ch, k) => {
              const cen = { x: cc.x + s * rx * 0.36, y: ys[k] };
              const toward = P[sIdx];
              const last = k === g.length - 1;
              if (ch.dup) {
                // Anaphase I: whole homologues (still two chromatids) pulled apart.
                const isChrom = ci === pick("chromosome") && last && s === side("chromosome");
                const isCen = ci === pick("centromere") && k === 0 && s === side("centromere");
                xChrom(cen, ch, Math.PI / 2, tagIf("chromosome", isChrom), tagIf("centromere", isCen));
                if (isChrom) once("chromosome", { x: cen.x + s * len(ch) * 0.24, y: cen.y + len(ch) * 0.45 });
                if (isCen) once("centromere", cen);
              } else {
                const isCt = ci === pick("chromatid") && last && s === side("chromatid");
                const tip = vChrom(cen, ch, toward, tagIf("chromatid", isCt));
                if (isCt) once("chromatid", tip);
              }
              const isSp = ci === pick("spindle") && k === 0 && s === side("spindle");
              const m = fibre(toward, cen, tagIf("spindle", isSp));
              if (isSp) once("spindle", m);
            });
          });
        });
        return;
      }
      if (id === "telophase" || id === "telophase-1" || id === "telophase-2") {
        const cells = id === "telophase-2"
          ? [{ c: { x: c.x - 1.42 * sub - 7, y: c.y }, r: sub, a: g0, b: g1 }, { c: { x: c.x + 1.42 * sub + 7, y: c.y }, r: sub, a: g2, b: g3 }]
          : [{ c, r: R, a: g0, b: g1 }];
        cells.forEach(({ c: cc, r, a, b }, ci) => {
          const dTag = id === "telophase-2" ? tagIf("daughter-cells") : undefined;
          cell(ellipse(cc, r * 1.4, r * 0.92, 0.42), dTag);
          [a, b].forEach((g, sIdx) => {
            const s = sIdx ? 1 : -1;
            const nc = { x: cc.x + s * r * 0.7, y: cc.y };
            const rn = r * 0.46;
            const outer = cells.length === 1 || (ci === 0 ? s < 0 : s > 0);
            const isNm = outer && s === side("nuclear-membrane");
            if (g[0]?.dup) {
              nucleus(nc, rn, false, tagIf("nuclear-membrane", isNm));
              const pts = ring(g.length, nc, g.length > 1 ? rn * 0.45 : 0, 0);
              const iC = extreme(pts, s);
              pts.forEach((p, i) => {
                const isChrom = outer && s === side("chromosome") && i === iC;
                const isCen = outer && s === side("centromere") && i === iC;
                xChrom(p, g[i], Math.PI / 2 + i * 0.7, tagIf("chromosome", isChrom), tagIf("centromere", isCen));
                if (isChrom) once("chromosome", { x: p.x, y: p.y - len(g[i]) * 0.4 });
                if (isCen) once("centromere", p);
              });
            } else nucleusWith(nc, rn, g, tagIf("nuclear-membrane", isNm));
            if (isNm) once("nuclear-membrane", { x: nc.x + s * rn, y: nc.y + 4 });
          });
        });
        if (id === "telophase-2") once("daughter-cells", { x: c.x + side("daughter-cells") * (2 * 1.42 * sub + 7), y: c.y });
        return;
      }
      // Daughter cells: two (mitosis, 2n each) or four (meiosis, n each), each with its nucleus.
      const four = id === "gametes";
      const r = four ? R * 0.5 : R * 0.68;
      const centres = four
        ? [{ x: c.x - r - 6, y: c.y - r - 3 }, { x: c.x + r + 6, y: c.y - r - 3 }, { x: c.x - r - 6, y: c.y + r + 3 }, { x: c.x + r + 6, y: c.y + r + 3 }]
        : [{ x: c.x - r - 8, y: c.y }, { x: c.x + r + 8, y: c.y }];
      const sD = side("daughter-cells"), sN = side("nuclear-membrane");
      const iN = four ? (sN < 0 ? 2 : 3) : sN < 0 ? 0 : 1;
      centres.forEach((cc, i) => {
        cell(ellipse(cc, r * 0.98, r * 0.94), tagIf("daughter-cells"));
        nucleusWith(cc, r * 0.6, st.groups[i], tagIf("nuclear-membrane", i === iN));
        if (i === iN) once("nuclear-membrane", { x: cc.x + sN * r * 0.6, y: cc.y + 4 });
      });
      const iD = four ? (sD < 0 ? 0 : 1) : sD < 0 ? 0 : 1;
      once("daughter-cells", { x: centres[iD].x + sD * r * 0.97, y: centres[iD].y + (four ? -r * 0.25 : -r * 0.25) });
    };

    /* ── panels in rows: up to 3 in one row, otherwise two rows ───────────────────────── */
    const ARROW = stages.length > 1 ? 40 : 0;
    const rowW = (row: StagePlan[]) => row.reduce((a, st) => a + panelSize(st.id).w, 0) + ARROW * (row.length - 1);
    const W = Math.max(...rows.map(rowW)) + 8;
    const rowH = 2 * R + 12 + (stages.length > 1 ? CAP : 0);
    const H = rows.length * rowH + (rows.length - 1) * 14;
    rows.forEach((row, ri) => {
      let x = (W - rowW(row)) / 2;
      const top = ri * (rowH + 14);
      row.forEach((st, i) => {
        panel = ri * perRow + i;
        const b = panelSize(st.id);
        const c = { x: x + b.w / 2, y: top + 6 + R };
        drawStage(st, c);
        if (stages.length > 1) shapes.push({ t: "text", x: r2(c.x), y: r2(top + 2 * R + 12 + CAP - 6), text: st.caption, size: 17, anchor: "middle", fill: "muted" });
        x += b.w;
        if (i < row.length - 1) shapes.push(...arrowShapes({ x: x + 6, y: c.y }, { x: x + ARROW - 6, y: c.y }, "ink", 2.2, undefined, { head: 10 }));
        x += ARROW;
      });
    });

    const daughterName = plan.type === "mitosis" ? `Daughter cells (2n = ${twoN})` : `Daughter cells (n = ${plan.n})`;
    const ids = ["chromosome", "chromatid", "centromere", "spindle", "nuclear-membrane", "homologous-pair", "daughter-cells"];
    const names: Record<string, string> = {
      chromosome: "Chromosome (two chromatids)",
      chromatid: "Chromatid",
      centromere: "Centromere",
      spindle: "Spindle fibres",
      "nuclear-membrane": /^prophase/.test(stages[owner.get("nuclear-membrane") ?? 0].id) ? "Nuclear membrane (breaking down)" : "Nuclear membrane",
      "homologous-pair": "Homologous pair",
      "daughter-cells": daughterName,
    };
    const parts: FigurePart[] = ids.filter((id) => anchors.has(id)).map((id) => ({ id, name: names[id], anchor: anchors.get(id)! }));
    for (const sh of shapes) if (sh.part && !anchors.has(sh.part)) delete sh.part;
    return { w: r2(W), h: r2(H), shapes, parts };
  },
};

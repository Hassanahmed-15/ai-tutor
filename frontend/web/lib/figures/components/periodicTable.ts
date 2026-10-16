import type { FigureComponent, FigureParams, Ink, Pt } from "../types";
import { Sketch, PALETTE, num, bool } from "./mathsKit";

/**
 * THE PERIODIC TABLE, first 36 elements, from data: every symbol in its group and period, atomic
 * numbers (and optionally relative atomic masses) correct, the stepped metal/non-metal line in its
 * place. Highlights (groups, periods, blocks, named families, single elements) are resolved by code
 * to exact sets of elements, so "halogens" always means F, Cl, Br.
 */

// [symbol, name, group 1-18, period, Ar]
const DATA: Array<[string, string, number, number, number]> = [
  ["H", "hydrogen", 1, 1, 1], ["He", "helium", 18, 1, 4],
  ["Li", "lithium", 1, 2, 7], ["Be", "beryllium", 2, 2, 9], ["B", "boron", 13, 2, 11], ["C", "carbon", 14, 2, 12], ["N", "nitrogen", 15, 2, 14], ["O", "oxygen", 16, 2, 16], ["F", "fluorine", 17, 2, 19], ["Ne", "neon", 18, 2, 20],
  ["Na", "sodium", 1, 3, 23], ["Mg", "magnesium", 2, 3, 24], ["Al", "aluminium", 13, 3, 27], ["Si", "silicon", 14, 3, 28], ["P", "phosphorus", 15, 3, 31], ["S", "sulfur", 16, 3, 32], ["Cl", "chlorine", 17, 3, 35.5], ["Ar", "argon", 18, 3, 40],
  ["K", "potassium", 1, 4, 39], ["Ca", "calcium", 2, 4, 40], ["Sc", "scandium", 3, 4, 45], ["Ti", "titanium", 4, 4, 48], ["V", "vanadium", 5, 4, 51], ["Cr", "chromium", 6, 4, 52], ["Mn", "manganese", 7, 4, 55], ["Fe", "iron", 8, 4, 56],
  ["Co", "cobalt", 9, 4, 59], ["Ni", "nickel", 10, 4, 59], ["Cu", "copper", 11, 4, 64], ["Zn", "zinc", 12, 4, 65], ["Ga", "gallium", 13, 4, 70], ["Ge", "germanium", 14, 4, 73], ["As", "arsenic", 15, 4, 75], ["Se", "selenium", 16, 4, 79], ["Br", "bromine", 17, 4, 80], ["Kr", "krypton", 18, 4, 84],
];
export type Element = { z: number; symbol: string; name: string; group: number; period: number; mass: number; metal: boolean };
export const ELEMENTS: Element[] = DATA.map(([symbol, name, group, period, mass], i) => ({ z: i + 1, symbol, name, group, period, mass, metal: isMetal(group, period, symbol) }));

/** Left of the staircase (B|Al, Si|Ge, As) is metal; hydrogen is a non-metal. */
function isMetal(group: number, period: number, symbol: string): boolean {
  if (symbol === "H") return false;
  if (group <= 12) return true;
  // The line steps down: below B (period 2 non-metal from group 13), Al metal / Si non-metal, Ge metal / As non-metal.
  const firstNonMetal = period === 2 ? 13 : period === 3 ? 14 : 15;
  return group < firstNonMetal;
}

/** IGCSE group number (1–7, 0) of a main-group column; null for the transition block. */
const mainGroup = (g: number): number | null => (g <= 2 ? g : g >= 13 ? (g === 18 ? 0 : g - 10) : null);

export type Highlight = { label: string; zs: number[]; kind: "group" | "period" | "block" | "elements" | "class" };

/** Resolve highlight words to exact element sets. "group 3" is group III (B, Al) unless numbering is 1-18. */
export function resolveHighlights(v: unknown, upTo: number, iupac: boolean): Highlight[] {
  const text = typeof v === "string" ? v.slice(0, 400) : "";
  const tokens = text.split(/[;,\n]|\band\b/i).map((t) => t.trim()).filter(Boolean);
  const inTable = (e: Element) => e.z <= upTo;
  const out: Highlight[] = [];
  const singles: number[] = [];
  const toCol = (n: number) => (iupac || n > 8 ? (n >= 1 && n <= 18 ? n : null) : n === 0 || n === 8 ? 18 : n <= 2 ? n : n + 10);
  const roman: Record<string, number> = { i: 1, ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7, viii: 8, "0": 0 };
  for (const tok of tokens) {
    const t = tok.toLowerCase();
    let m: RegExpMatchArray | null;
    const add = (label: string, kind: Highlight["kind"], pred: (e: Element) => boolean) => {
      const zs = ELEMENTS.filter((e) => inTable(e) && pred(e)).map((e) => e.z);
      if (zs.length) out.push({ label, zs, kind });
    };
    if (/halogen/.test(t)) add("Group 7 (halogens)", "group", (e) => e.group === 17);
    else if (/noble/.test(t)) add("Group 0 (noble gases)", "group", (e) => e.group === 18);
    else if (/alkali(ne)? earth/.test(t)) add("Group 2 (alkaline earth metals)", "group", (e) => e.group === 2);
    else if (/alkali/.test(t)) add("Group 1 (alkali metals)", "group", (e) => e.group === 1 && e.symbol !== "H");
    else if (/transition/.test(t)) add("Transition metals", "block", (e) => e.group >= 3 && e.group <= 12);
    else if ((m = t.match(/\b([spd])[- ]?block/))) {
      const b = m[1];
      add(`${b}-block`, "block", (e) => (b === "s" ? e.group <= 2 || e.symbol === "He" : b === "d" ? e.group >= 3 && e.group <= 12 : e.group >= 13 && e.symbol !== "He"));
    } else if (/non-?metal/.test(t)) add("Non-metals", "class", (e) => !e.metal);
    else if (/\bmetals?\b/.test(t)) add("Metals", "class", (e) => e.metal);
    else if ((m = t.match(/period\s*(\d)/))) {
      const p = Number(m[1]);
      add(`Period ${p}`, "period", (e) => e.period === p);
    } else if ((m = t.match(/group\s*(\d{1,2}|[ivx]+)\b/))) {
      const n = /^\d+$/.test(m[1]) ? Number(m[1]) : roman[m[1]] ?? -1;
      const col = n >= 0 ? toCol(n) : null;
      if (col) {
        const mg = mainGroup(col);
        add(iupac || mg === null ? `Group ${col}` : `Group ${mg}`, "group", (e) => e.group === col && !(col === 1 && e.symbol === "H"));
      }
    } else {
      const e = ELEMENTS.find((x) => x.symbol.toLowerCase() === t && inTable(x)) ?? ELEMENTS.find((x) => x.name === t.replace("sulphur", "sulfur").replace("aluminum", "aluminium") && inTable(x));
      if (e && !singles.includes(e.z)) singles.push(e.z);
    }
  }
  if (singles.length) out.push({ label: singles.map((z) => ELEMENTS[z - 1].symbol).join(", "), zs: singles, kind: "elements" });
  return out.slice(0, 5);
}

const COLOURS: Ink[] = [PALETTE.blue, PALETTE.red, PALETTE.green, PALETTE.amber, PALETTE.violet];
const ROMAN = ["", "I", "II", "III", "IV", "V", "VI", "VII"];

export const periodicTable: FigureComponent = {
  name: "periodicTable",
  title: "Periodic table (first 36 elements): symbols, atomic numbers, groups and periods, metal/non-metal line, highlighted groups, periods, blocks or elements",
  params: `highlight (comma-separated: "group 1", "group 7", "halogens", "noble gases", "alkali metals", "transition metals", "period 3", "s-block", "metals", "non-metals", or element symbols/names, e.g. "Na, Mg, Cl"; up to 5 highlights, each in its own colour), upTo (last element shown, 2-36, default 36; 20 or fewer → compact 8-column table of main groups), numbering ("0" — groups 1–7 and 0, default; "8" — 1–8; "roman" — I–VII and 0; "18" — IUPAC 1–18, which also makes "group 3" mean scandium's group), masses (true: relative atomic masses in each cell), shading (true: metals and non-metals tinted). The metal/non-metal stepped line is always drawn.`,
  match: /\b(periodic table|groups? (1|2|7|0|i|ii|vii) (elements|metals)|alkali metals|halogens|noble gases|transition (metals|elements)|periods? (of|in) the periodic|across a period|down a group|metals and non-?metals (in|on) the (periodic )?table)\b/i,
  parts: [
    { id: "group-1", name: "Group 1 (alkali metals)" },
    { id: "group-2", name: "Group 2" },
    { id: "group-7", name: "Group 7 (halogens)" },
    { id: "noble-gases", name: "Group 0 (noble gases)" },
    { id: "transition-metals", name: "Transition metals" },
    { id: "period", name: "Period" },
    { id: "highlighted-element", name: "Highlighted element" },
    { id: "divider", name: "Metal / non-metal dividing line" },
    { id: "metals", name: "Metals" },
    { id: "non-metals", name: "Non-metals" },
  ],
  build(params: FigureParams) {
    const upTo = Math.round(num(params.upTo ?? params.elements ?? params.count, 36, 2, 36));
    const numbering = String(params.numbering ?? params.groupNumbers ?? "0").toLowerCase();
    const iupac = /18|iupac/.test(numbering);
    const compact = upTo <= 20 && !iupac && !/18|full|long/.test(String(params.columns ?? params.layout ?? ""));
    const masses = bool(params.masses ?? params.mass ?? params.showMasses, false);
    const shading = bool(params.shading ?? params.shade, false);
    const highlights = resolveHighlights(params.highlight ?? params.highlights, upTo, iupac);
    const shown = ELEMENTS.filter((e) => e.z <= upTo);
    const periods = Math.max(...shown.map((e) => e.period));
    const CW = compact ? 64 : 46, CH = compact ? 62 : 54;
    const colOf = (g: number) => (compact ? (g <= 2 ? g - 1 : g - 11) : g - 1);
    const cell = (e: { group: number; period: number }) => ({ x: colOf(e.group) * CW, y: (e.period - 1) * CH, w: CW, h: CH });
    const sk = new Sketch();
    const hl = new Map<number, Ink>();
    highlights.forEach((h, i) => h.zs.forEach((z) => hl.has(z) || hl.set(z, COLOURS[i])));

    const periodH = highlights.find((h) => h.kind === "period");
    const periodN = periodH ? ELEMENTS[periodH.zs[0] - 1].period : Math.min(3, periods);
    // Cells.
    for (const e of shown) {
      const c = cell(e);
      const rect = (pad: number) => [{ x: c.x + pad, y: c.y + pad }, { x: c.x + c.w - pad, y: c.y + pad }, { x: c.x + c.w - pad, y: c.y + c.h - pad }, { x: c.x + pad, y: c.y + c.h - pad }];
      const colour = hl.get(e.z);
      // Noble gases are tagged below the second row only, so the group 7 leader can reach F past He/Ne.
      const part = e.group === 1 && e.symbol !== "H" ? "group-1" : e.group === 2 ? "group-2" : e.group === 17 ? "group-7" : e.group === 18 && (e.period >= 3 || periods < 3) ? "noble-gases" : e.group >= 3 && e.group <= 12 ? "transition-metals" : e.period === periodN ? "period" : undefined;
      if (shading) sk.polygon(rect(0), { fill: e.metal ? PALETTE.blue : PALETTE.amber, stroke: "none", opacity: 0.1, part: e.metal ? "metals" : "non-metals" }, false);
      if (colour) sk.polygon(rect(0), { fill: colour, stroke: "none", opacity: 0.26, part }, false);
      sk.polygon(rect(0), { fill: "none", stroke: "ink", width: 1.2, part }, false);
      sk.text({ x: c.x + 5 + String(e.z).length * 3.2, y: c.y + 9 }, String(e.z), 12, "ink", part);
      sk.text({ x: c.x + c.w / 2, y: c.y + c.h / 2 + (masses ? 1 : 4) }, e.symbol, compact ? 22 : 20, "ink", part);
      if (masses) sk.text({ x: c.x + c.w / 2, y: c.y + c.h - 9 }, String(e.mass), compact ? 12 : 10, "muted", part);
    }
    // Highlight outlines: a heavy border round each highlighted element.
    // Drawn in order, so named elements (the last highlight) show their own colour on top.
    highlights.forEach((h, i) => h.zs.forEach((z) => {
      const c = cell(ELEMENTS[z - 1]);
      sk.polygon([{ x: c.x + 1.5, y: c.y + 1.5 }, { x: c.x + c.w - 1.5, y: c.y + 1.5 }, { x: c.x + c.w - 1.5, y: c.y + c.h - 1.5 }, { x: c.x + 1.5, y: c.y + c.h - 1.5 }], { fill: "none", stroke: COLOURS[i], width: 3, part: h.kind === "elements" ? "highlighted-element" : undefined }, false);
    }));

    // Group numbers above the columns, period numbers to the left.
    const groupLabel = (g: number): string | null => {
      if (iupac) return String(g);
      const mg = mainGroup(g);
      if (mg === null) return null;
      if (/roman/.test(numbering)) return mg === 0 ? "0" : ROMAN[mg];
      if (/8/.test(numbering)) return String(mg === 0 ? 8 : mg);
      return String(mg);
    };
    const groups = compact ? [1, 2, 13, 14, 15, 16, 17, 18] : Array.from({ length: 18 }, (_, i) => i + 1);
    for (const g of groups) {
      const label = groupLabel(g);
      if (label) sk.text({ x: colOf(g) * CW + CW / 2, y: -16 }, label, compact ? 17 : 15, "ink");
    }
    for (let p = 1; p <= periods; p++) sk.text({ x: -16, y: (p - 1) * CH + CH / 2 }, String(p), 14, "muted");

    // The stepped metal / non-metal line (thick red): left of B, under B, left of Si, under Si, left of As…
    const steps: Pt[] = [];
    const xAt = (g: number) => colOf(g) * CW;
    // Each step only where that period's p-block is on the table.
    const pBlock = (p: number) => shown.some((e) => e.period === p && e.group >= 13 && e.group <= 17);
    steps.push({ x: xAt(13), y: CH }); // top of B
    steps.push({ x: xAt(13), y: 2 * CH });
    if (pBlock(3)) steps.push({ x: xAt(14), y: 2 * CH }, { x: xAt(14), y: 3 * CH });
    if (pBlock(4)) steps.push({ x: xAt(15), y: 3 * CH }, { x: xAt(15), y: 4 * CH });
    if (upTo >= 5) sk.line(steps, { stroke: PALETTE.red, width: 4.5, part: "divider" }, false);

    // Anchors.
    const byZ = (sym: string) => shown.find((e) => e.symbol === sym);
    const anchors: Record<string, Pt> = {};
    const names: Record<string, string> = {};
    const g1 = (periodN === 2 ? byZ("K") ?? byZ("Na") : byZ("Li")) ?? byZ("Li");
    if (g1) anchors["group-1"] = { x: cell(g1).x + 4, y: cell(g1).y + CH * 0.5 };
    const be = byZ("Be");
    if (be) anchors["group-2"] = { x: cell(be).x + CW / 2, y: cell(be).y + 3 };
    const f = byZ("F");
    if (f) anchors["group-7"] = { x: cell(f).x + CW / 2, y: cell(f).y + 3 };
    const ng = byZ(periods >= 3 ? "Ar" : "Ne") ?? byZ("He");
    if (ng) anchors["noble-gases"] = { x: cell(ng).x + CW - 4, y: cell(ng).y + CH * 0.5 };
    const fe = byZ("Fe") ?? byZ("Sc");
    if (fe && !compact) anchors["transition-metals"] = { x: cell(fe).x + CW / 2, y: cell(fe).y + 3 };
    const pFirst = shown.find((e) => e.period === periodN);
    if (pFirst) anchors.period = { x: cell(pFirst).x + 4, y: cell(pFirst).y + CH * 0.72 };
    names.period = `Period ${periodN}`;
    const elH = highlights.find((h) => h.kind === "elements");
    if (elH) {
      const e = ELEMENTS[elH.zs[0] - 1];
      const c = cell(e);
      anchors["highlighted-element"] = { x: c.x + (c.x + CW / 2 < (groups.length * CW) / 2 ? 5 : CW - 5), y: c.y + CH * 0.3 };
      names["highlighted-element"] = elH.zs.length === 1 ? `${e.name[0].toUpperCase()}${e.name.slice(1)} (${e.symbol}), Z = ${e.z}` : `Highlighted: ${elH.label}`;
    }
    if (upTo >= 5) {
      const midStep = pBlock(3) ? { x: xAt(14), y: 2.5 * CH } : { x: xAt(13), y: 1.5 * CH };
      anchors.divider = midStep;
    }
    if (shading) {
      const ca = byZ("Ca") ?? byZ("Mg") ?? byZ("Li");
      if (ca) anchors.metals = { x: cell(ca).x + CW / 2, y: cell(ca).y + CH - 3 };
      const nm = byZ("Se") ?? byZ("S") ?? byZ("O");
      if (nm) anchors["non-metals"] = { x: cell(nm).x + CW / 2, y: cell(nm).y + CH - 3 };
    }
    const declared = Object.fromEntries(periodicTable.parts.map((p) => [p.id, p.name]));
    for (const [id, p] of Object.entries(anchors)) sk.part(id, names[id] ?? declared[id], p);
    return sk.finish(12);
  },
};

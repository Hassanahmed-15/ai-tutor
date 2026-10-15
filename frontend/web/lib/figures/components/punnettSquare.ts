import type { FigureComponent, FigureParams, FigureShape } from "../types";

const name = (v: unknown, fallback: string) => (typeof v === "string" && v.trim() ? v.trim().slice(0, 24) : fallback);
const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);
/** Dominant (capital) allele first: "bB" → "Bb". */
const pair = (a: string, b: string) => (a === a.toUpperCase() && b !== b.toUpperCase() ? a + b : b === b.toUpperCase() && a !== a.toUpperCase() ? b + a : a + b);

/** A genotype as its genes (allele pairs), or null when it is not one: "AaBb" → ["Aa", "Bb"]. */
function genes(v: unknown): string[] | null {
  const s = String(v ?? "").replace(/[^A-Za-z]/g, "");
  if (s.length !== 2 && s.length !== 4) return null;
  const out: string[] = [];
  for (let i = 0; i < s.length; i += 2) {
    if (s[i].toLowerCase() !== s[i + 1].toLowerCase()) return null;
    out.push(pair(s[i], s[i + 1]));
  }
  if (out.length === 2 && out[0][0].toLowerCase() === out[1][0].toLowerCase()) return null;
  return out;
}

export type Cross = {
  p1: string[]; p2: string[];
  gametes1: string[]; gametes2: string[];
  /** cells[row][col]: row = parent 2's gamete, col = parent 1's. */
  cells: string[][];
  /** Phenotype class of each cell: per gene, true when it shows the dominant trait. */
  classes: boolean[][][];
  genotypeRatio: Array<{ genotype: string; count: number }>;
  phenotypeRatio: Array<{ dominant: boolean[]; count: number }>;
};

const gametesOf = (g: string[]) => (g.length === 1 ? [g[0][0], g[0][1]] : [g[0][0] + g[1][0], g[0][0] + g[1][1], g[0][1] + g[1][0], g[0][1] + g[1][1]]);

/** The cross: gametes by segregation (and independent assortment), offspring by fertilisation, ratios by counting. */
export function cross(params: FigureParams): Cross {
  const fromCross = String(params.cross ?? "").split(/\s*[x×*]\s*/i);
  let p1 = genes(params.parent1 ?? fromCross[0]);
  let p2 = genes(params.parent2 ?? fromCross[1]);
  if (!p1) p1 = p2 ?? ["Bb"];
  const same = (a: string[], b: string[]) => a.length === b.length && a.every((g, i) => g[0].toLowerCase() === b[i][0].toLowerCase());
  if (!p2 || !same(p1, p2)) {
    // The same genes in the other order ("BbAa" × "AaBb") are put in parent 1's order; otherwise parent 1 is selfed.
    const reordered = p2 && p2.length === 2 && p1.length === 2 ? [p2[1], p2[0]] : null;
    p2 = reordered && same(p1, reordered) ? reordered : [...p1];
  }
  const gametes1 = gametesOf(p1), gametes2 = gametesOf(p2);
  const cells = gametes2.map((g2) => gametes1.map((g1) => [...g1].map((a, i) => pair(a, g2[i])).join("")));
  const classes = cells.map((row) => row.map((c) => Array.from({ length: c.length / 2 }, (_, i) => c[2 * i] === c[2 * i].toUpperCase())));
  const counts = new Map<string, number>();
  for (const c of cells.flat()) counts.set(c, (counts.get(c) ?? 0) + 1);
  // Genotypes most dominant first (BB, Bb, bb; AABB … aabb).
  const caps = (s: string) => [...s].filter((ch) => ch === ch.toUpperCase()).length;
  const genotypeRatio = [...counts].map(([genotype, count]) => ({ genotype, count })).sort((a, b) => caps(b.genotype) - caps(a.genotype) || a.genotype.localeCompare(b.genotype));
  const ph = new Map<string, { dominant: boolean[]; count: number }>();
  for (const k of classes.flat()) {
    const key = k.map((d) => (d ? 1 : 0)).join("");
    ph.set(key, { dominant: k, count: (ph.get(key)?.count ?? 0) + 1 });
  }
  const phenotypeRatio = [...ph].sort((a, b) => b[0].localeCompare(a[0])).map(([, v]) => v);
  const g1 = genotypeRatio.reduce((g, r) => gcd(g, r.count), 0);
  const g2 = phenotypeRatio.reduce((g, r) => gcd(g, r.count), 0);
  genotypeRatio.forEach((r) => (r.count /= g1));
  phenotypeRatio.forEach((r) => (r.count /= g2));
  return { p1, p2, gametes1, gametes2, cells, classes, genotypeRatio, phenotypeRatio };
}

/** "Offspring bb (blue eyes)", or just the genotype when the phenotype would make the label too long. */
const offspringName = (g: string, ph: string) => (`Offspring ${g} (${ph})`.length <= 34 ? `Offspring ${g} (${ph})` : `Offspring ${g}`);

/** Width of a line of text, roughly (Nunito semibold). */
const textW = (s: string, size: number) => s.length * size * 0.56;

/** Lines of "a : b : c", broken at the colons to fit. */
function wrapRatio(head: string, items: string[], size: number, maxW: number): string[] {
  const lines: string[] = [];
  let line = head;
  items.forEach((item, i) => {
    const piece = (i ? " : " : "") + item;
    if (i && textW(line + piece, size) > maxW) {
      lines.push(line + " :");
      line = "   " + item;
    } else line += piece;
  });
  lines.push(line);
  return lines;
}

/**
 * Punnett square for a monohybrid (2×2) or dihybrid (4×4) cross: each parent's gametes along the top
 * and down the side (circled, as gametes are), every offspring genotype in its cell, cells shaded by
 * phenotype, and the genotype and phenotype ratios written beneath — all computed from the parents.
 */
export const punnettSquare: FigureComponent = {
  name: "punnettSquare",
  title: "Punnett square genetic cross: parents' gametes, offspring genotypes, genotype and phenotype ratios",
  params: `parent1 and parent2 (genotypes, one letter per gene, capital = dominant: "Bb" and "bb"; dihybrid "AaBb" and "AaBb" draws a 4×4), or cross ("Bb x bb"); dominant and recessive (the gene's phenotypes, e.g. "brown eyes", "blue eyes"); for a dihybrid also dominant2 and recessive2 (the second gene's). Code works out the gametes, every offspring and both ratios.`,
  match: /\b(punnett|genetic (cross|diagram)s?|monohybrid|dihybrid|9\s*:\s*3\s*:\s*3\s*:\s*1|3\s*:\s*1 ratio)\b|\b(genotypes?|alleles?|(homo|hetero)zygous)\b.*\b(cross(es|ed)?|offspring|gametes?|ratio|probability)\b/i,
  parts: [
    { id: "parent1-gametes", name: "Gametes from parent 1" },
    { id: "parent2-gametes", name: "Gametes from parent 2" },
    { id: "offspring", name: "Offspring genotype" },
    { id: "ratio", name: "Ratio of offspring" },
  ],
  build(params: FigureParams) {
    const x = cross(params);
    const di = x.p1.length === 2;
    const n = x.gametes1.length;
    const C = di ? 78 : 96;
    const traits = [
      [name(params.dominant, "dominant"), name(params.recessive, "recessive")],
      [name(params.dominant2, "dominant"), name(params.recessive2, "recessive")],
    ];
    if (di && !params.dominant2 && !params.dominant) { traits[0] = [`dominant ${x.p1[0][0]}`, `recessive ${x.p1[0][1]}`]; traits[1] = [`dominant ${x.p1[1][0]}`, `recessive ${x.p1[1][1]}`]; }
    const phenoName = (d: boolean[]) => d.map((dom, i) => traits[i][dom ? 0 : 1]).join(", ");
    const gx = 96, gy = 112;
    const gridW = n * C;
    const shapes: FigureShape[] = [];
    // The cross, as written: "Bb × bb".
    shapes.push({ t: "text", x: gx + gridW / 2, y: 32, text: `${x.p1.join("")}  ×  ${x.p2.join("")}`, size: 26, anchor: "middle" });
    // Cells shaded by phenotype class; then the grid; then the genotypes.
    const shade: Record<string, `#${string}` | null> = di ? { "11": null, "10": "#2563eb", "01": "#16a34a", "00": "#d97706" } : { "1": null, "0": "#d97706" };
    x.classes.forEach((row, r) => row.forEach((k, c) => {
      const fill = shade[k.map((d) => (d ? 1 : 0)).join("")];
      if (fill) shapes.push({ t: "path", part: "offspring", d: `M${gx + c * C} ${gy + r * C} h${C} v${C} h${-C} Z`, fill, stroke: "none", opacity: 0.16 });
    }));
    let grid = `M${gx} ${gy} h${gridW} v${gridW} h${-gridW} Z`;
    for (let i = 1; i < n; i++) grid += ` M${gx + i * C} ${gy} v${gridW} M${gx} ${gy + i * C} h${gridW}`;
    shapes.push({ t: "path", d: grid, stroke: "ink", width: 2.2, fill: "none" });
    const cellSize = di ? 23 : 32;
    x.cells.forEach((row, r) => row.forEach((g, c) => shapes.push({ t: "text", part: "offspring", x: gx + c * C + C / 2, y: gy + r * C + C / 2 + cellSize * 0.36, text: g, size: cellSize, anchor: "middle" })));
    // Gametes, circled: parent 1's across the top (blue), parent 2's down the side (red).
    const gr = di ? 23 : 24, gSize = di ? 19 : 26;
    x.gametes1.forEach((g, i) => {
      const cx = gx + i * C + C / 2, cy = gy - 34;
      shapes.push({ t: "circle", part: "parent1-gametes", cx, cy, r: gr, fill: "none", stroke: "#2563eb", width: 2 });
      shapes.push({ t: "text", part: "parent1-gametes", x: cx, y: cy + gSize * 0.36, text: g, size: gSize, anchor: "middle", fill: "#2563eb" });
    });
    x.gametes2.forEach((g, i) => {
      const cx = gx - 38, cy = gy + i * C + C / 2;
      shapes.push({ t: "circle", part: "parent2-gametes", cx, cy, r: gr, fill: "none", stroke: "#dc2626", width: 2 });
      shapes.push({ t: "text", part: "parent2-gametes", x: cx, y: cy + gSize * 0.36, text: g, size: gSize, anchor: "middle", fill: "#dc2626" });
    });
    // The ratios beneath: genotypes (monohybrid), phenotypes, then a key — each phenotype with the shade
    // its cells carry and its share. Every line is one text, so nothing depends on measured widths.
    const rs = 19, lineH = 30, x0 = 24, valueX = x0 + 120;
    const maxX = Math.max(gx + gridW, 420) - 4;
    const ratioTop = gy + gridW + 38;
    let row = 0;
    const line = (head: string, value: string) => {
      const y = ratioTop + row++ * lineH;
      shapes.push({ t: "text", part: "ratio", x: x0, y, text: head, size: rs, anchor: "start", fill: "muted" });
      shapes.push({ t: "text", part: "ratio", x: valueX, y, text: value, size: rs, anchor: "start" });
    };
    if (!di) line("Genotypes", x.genotypeRatio.map((g) => `${g.count} ${g.genotype}`).join(" : "));
    line("Phenotypes", x.phenotypeRatio.map((p) => p.count).join(" : "));
    const entries = x.phenotypeRatio.map((p) => ({ fill: shade[p.dominant.map((d) => (d ? 1 : 0)).join("")], label: `${p.count} ${phenoName(p.dominant)}` }));
    const colW = Math.max(...entries.map((e) => 26 + textW(e.label, rs))) + 24;
    const perRow = valueX + 2 * colW - 24 <= maxX ? 2 : 1;
    entries.forEach((e, i) => {
      const ex = valueX + (i % perRow) * colW, y = ratioTop + (row + Math.floor(i / perRow)) * lineH;
      shapes.push({ t: "path", part: "ratio", d: `M${ex} ${y - 15} h16 v16 h-16 Z`, fill: e.fill ?? "none", stroke: "ink", width: 1.2, opacity: e.fill ? 0.6 : 1 });
      shapes.push({ t: "text", part: "ratio", x: ex + 24, y, text: e.label, size: rs, anchor: "start" });
    });
    row += Math.ceil(entries.length / perRow) - 1;
    const rows = row + 1;
    // A rule beside the ratios: the point a label's leader ends on, clear of the words.
    shapes.push({ t: "path", part: "ratio", d: `M10 ${ratioTop - 20} V${ratioTop + (rows - 1) * lineH + 6}`, stroke: "muted", width: 3, fill: "none" });
    const w = Math.max(gx + gridW + 16, valueX + perRow * colW);
    const h = ratioTop + (rows - 1) * lineH + 16;
    // The offspring anchor: the last cell (the most recessive offspring), below its letters.
    const lastG = x.cells[n - 1][n - 1];
    return {
      w,
      h,
      shapes,
      parts: [
        { id: "parent1-gametes", name: `Gametes from parent 1 (${x.p1.join("")})`, anchor: { x: gx + (n - 1) * C + C / 2 + gr * 0.7, y: gy - 34 - gr * 0.7 } },
        { id: "parent2-gametes", name: `Gametes from parent 2 (${x.p2.join("")})`, anchor: { x: gx - 38 - gr, y: gy + C / 2 } },
        { id: "offspring", name: offspringName(lastG, phenoName(x.classes[n - 1][n - 1])), anchor: { x: gx + gridW - C * 0.18, y: gy + gridW - C * 0.18 } },
        { id: "ratio", name: di ? "Phenotype ratio" : "Offspring ratios", anchor: { x: 10, y: ratioTop - 7 + ((rows - 1) * lineH) / 2 } },
      ],
    };
  },
};

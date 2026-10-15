import type { FigureComponent, FigureParams, FigurePart, FigureShape, Pt } from "../types";

type Person = { sex: "M" | "F"; affected: boolean; carrier: boolean; deceased: boolean; proband: boolean; gen: number; x: number; parents?: Couple; spouseOf?: Person };
type Couple = { a: Person; b: Person; children: Person[] };
type Row = { people: Person[]; couples: Couple[]; groups: Array<{ couple?: Couple; members: Person[]; siblings: Person[] }> };

const NUMERALS = ["I", "II", "III", "IV", "V"];
const S = 74, SYM = 34, ROW = 116, LEFT = 74, TOP = 44;

function person(token: string, gen: number): Person | null {
  const m = token.trim().match(/^([MFmf])([acdpACDP]*)$/);
  if (!m) return null;
  const f = m[2].toLowerCase();
  return { sex: m[1].toUpperCase() as "M" | "F", affected: f.includes("a"), carrier: f.includes("c") && !f.includes("a"), deceased: f.includes("d"), proband: f.includes("p"), gen, x: 0 };
}

/**
 * The family, from one short string per generation. In g2 onwards each "|"-separated group is the
 * children of the previous generation's couples in order; "X=Y" marries X to Y (Y joins the family).
 */
export function parsePedigree(params: FigureParams): Row[] {
  const rows: Row[] = [];
  for (let g = 0; g < 5; g++) {
    const raw = params[`g${g + 1}`] ?? params[`gen${g + 1}`] ?? params[`generation${g + 1}`];
    if (typeof raw !== "string" || !raw.trim()) break;
    const row: Row = { people: [], couples: [], groups: [] };
    const prev = rows[g - 1];
    const groups = g === 0 ? [raw.replace(/\|/g, " ")] : raw.split("|");
    groups.forEach((groupText, k) => {
      const couple = g === 0 ? undefined : prev.couples[k];
      if (g > 0 && !couple) return;
      const group = { couple, members: [] as Person[], siblings: [] as Person[] };
      for (const token of groupText.trim().split(/\s+/).filter((t) => t && t !== "-")) {
        const [first, second] = token.split("=");
        const p = person(first, g);
        if (!p) continue;
        if (couple) { p.parents = couple; couple.children.push(p); }
        group.members.push(p);
        if (g > 0 || !second) group.siblings.push(p);
        const q = second !== undefined ? person(second, g) : null;
        if (q) {
          q.spouseOf = p;
          group.members.push(q);
          if (g === 0) group.siblings.push(q);
          // Partners stand male on the left by convention when the board did not order them.
          row.couples.push({ a: p, b: q, children: [] });
        }
      }
      if (group.members.length) row.groups.push(group);
      row.people.push(...group.members);
    });
    if (!row.people.length) break;
    rows.push(row);
  }
  return rows;
}

const DEFAULT = { g1: "Mc=Fc", g2: "Fa Mc=F M", g3: "Ma Fc F" };

/** Positions: each sibship centred under its parents, pushed right to clear its neighbours; parents re-centred over children. */
function layout(rows: Row[]) {
  const place = (list: Person[], start: number, prevEnd: number) => {
    let x = Math.max(start, prevEnd + S);
    for (const p of list) { p.x = x; x += S; }
    return x - S;
  };
  rows[0].people.forEach((p, i) => (p.x = i * S));
  for (let pass = 0; pass < 4; pass++) {
    for (let g = 1; g < rows.length; g++) {
      let end = -Infinity;
      for (const grp of rows[g].groups) {
        const mid = (grp.couple!.a.x + grp.couple!.b.x) / 2;
        // Centre the siblings (not the married-in partners) under the parents.
        const sibs = grp.siblings;
        const firstSib = grp.members.indexOf(sibs[0]);
        const sibSpan = sibs.length ? grp.members.indexOf(sibs[sibs.length - 1]) - firstSib : 0;
        const start = mid - (sibSpan * S) / 2 - firstSib * S;
        end = place(grp.members, start, end);
      }
    }
    for (let g = rows.length - 2; g >= 0; g--) {
      for (const c of rows[g].couples) {
        if (!c.children.length) continue;
        const kids = (Math.min(...c.children.map((p) => p.x)) + Math.max(...c.children.map((p) => p.x))) / 2;
        const delta = kids - (c.a.x + c.b.x) / 2;
        if (delta > 0.5) {
          const row = rows[g].people;
          const from = row.indexOf(c.a);
          for (let i = from; i < row.length; i++) row[i].x += delta;
        }
      }
      // Keep the row's spacing after any shift.
      const row = rows[g].people;
      for (let i = 1; i < row.length; i++) row[i].x = Math.max(row[i].x, row[i - 1].x + S);
    }
  }
  const minX = Math.min(...rows.flatMap((r) => r.people.map((p) => p.x)));
  for (const r of rows) for (const p of r.people) p.x += LEFT + SYM - minX;
}

/**
 * A family pedigree chart: males as squares, females as circles, affected individuals shaded,
 * carriers with a dot (or half-shaded); partners joined by a marriage line, children hanging from a
 * sibship line under their parents; generations numbered I, II, III down the side and individuals
 * 1, 2, 3 along each generation.
 */
export const pedigree: FigureComponent = {
  name: "pedigree",
  title: "Pedigree chart (family tree) of an inherited trait: squares = males, circles = females, shaded = affected",
  params: `g1, g2, g3 (and g4, g5): one string per generation. Each person is M or F plus flags: a = affected, c = carrier, d = deceased, p = proband (e.g. "Ma", "Fc", "M"). "X=Y" joins X to a partner Y (Y married into the family). In g2 onwards, "|" separates the children of each couple of the generation above, in order. Example: g1 "Mc=Fc", g2 "Fa Mc=F M", g3 "Ma Fc F". carrierStyle ("dot" — default — or "half"), trait (optional, e.g. "cystic fibrosis").`,
  match: /\bpedigree (charts?|diagrams?|analysis)\b|\bpedigrees?\b(?=.*\b(inherit|allele|gene|disorder|affected|carrier))|\b(autosomal|x-linked|sex-linked) (recessive|dominant)\b|\binheritance (chart|diagram)\b|\bfamily tree\b(?=.*\b(inherit|allele|gene|disorder|affected|carrier))/i,
  parts: [
    { id: "affected-male", name: "Affected male" },
    { id: "affected-female", name: "Affected female" },
    { id: "unaffected-male", name: "Unaffected male" },
    { id: "unaffected-female", name: "Unaffected female" },
    { id: "carrier", name: "Carrier" },
    { id: "marriage-line", name: "Partners (marriage line)" },
    { id: "offspring-line", name: "Children (sibship line)" },
    { id: "generation", name: "Generation" },
  ],
  build(params: FigureParams) {
    let rows = parsePedigree(params);
    if (!rows.length) rows = parsePedigree(DEFAULT);
    layout(rows);
    const half = /half|shad/i.test(String(params.carrierStyle ?? ""));
    const trait = typeof params.trait === "string" && params.trait.trim() ? params.trait.trim() : "";
    const shapes: FigureShape[] = [];
    const parts: FigurePart[] = [];
    const yOf = (g: number) => TOP + SYM / 2 + g * ROW;
    const maxX = Math.max(...rows.flatMap((r) => r.people.map((p) => p.x)));
    const w = maxX + SYM / 2 + 30, h = yOf(rows.length - 1) + SYM / 2 + 34;
    const centre = (LEFT + maxX) / 2;
    const r = SYM / 2;

    // Lines first, so the symbols sit on top of them.
    let firstMarriage: Pt | null = null, firstSibship: Pt | null = null;
    rows.forEach((row, g) => {
      const y = yOf(g);
      for (const c of row.couples) {
        const [l, rr] = c.a.x < c.b.x ? [c.a, c.b] : [c.b, c.a];
        shapes.push({ t: "path", part: "marriage-line", d: `M${l.x + r} ${y} H${rr.x - r}`, stroke: "ink", width: 2.2, fill: "none" });
        firstMarriage ??= { x: l.x + r + (rr.x - l.x - 2 * r) * 0.28, y };
        if (!c.children.length) continue;
        const mid = (l.x + rr.x) / 2, sibY = y + ROW / 2 + 4;
        const xs = c.children.map((p) => p.x);
        const lo = Math.min(...xs, mid), hi = Math.max(...xs, mid);
        let d = `M${mid} ${y} V${sibY}`;
        if (hi - lo > 0.5) d += ` M${lo} ${sibY} H${hi}`;
        for (const x of xs) d += ` M${x} ${sibY} V${yOf(g + 1) - r}`;
        shapes.push({ t: "path", part: "offspring-line", d, stroke: "ink", width: 2.2, fill: "none" });
        if (!firstSibship && hi - lo > 0.5) firstSibship = { x: lo + Math.min(14, (hi - lo) / 3), y: sibY };
      }
    });

    // Symbols, numbers, and the generation numerals.
    const pick = new Map<string, { p: Person; g: number; score: number; side: number }>();
    rows.forEach((row, g) => {
      const y = yOf(g);
      shapes.push({ t: "text", part: "generation", x: 10, y: y - 9, text: NUMERALS[g], size: 24, anchor: "start" }); // baseline just above the leaders that run along the row
      const ordered = [...row.people].sort((a, b) => a.x - b.x);
      ordered.forEach((p, i) => {
        const id = p.affected ? (p.sex === "M" ? "affected-male" : "affected-female") : p.carrier ? "carrier" : p.sex === "M" ? "unaffected-male" : "unaffected-female";
        const fill = p.affected ? "ink" : "none";
        if (p.sex === "M") shapes.push({ t: "path", part: id, d: `M${p.x - r} ${y - r} h${SYM} v${SYM} h${-SYM} Z`, fill, stroke: "ink", width: 2.2 });
        else shapes.push({ t: "circle", part: id, cx: p.x, cy: y, r, fill, stroke: "ink", width: 2.2 });
        if (p.carrier && !half) shapes.push({ t: "circle", part: id, cx: p.x, cy: y, r: 5.5, fill: "ink", stroke: "none" });
        if (p.carrier && half) {
          const d = p.sex === "M" ? `M${p.x} ${y - r} h${-r} v${SYM} h${r} Z` : `M${p.x} ${y - r} A${r} ${r} 0 0 0 ${p.x} ${y + r} Z`;
          shapes.push({ t: "path", part: id, d, fill: "ink", stroke: "ink", width: 1.2 });
        }
        if (p.deceased) shapes.push({ t: "path", part: id, d: `M${p.x - r - 6} ${y + r + 6} L${p.x + r + 6} ${y - r - 6}`, stroke: "ink", width: 2.2, fill: "none" });
        if (p.proband) shapes.push({ t: "path", part: id, d: `M${p.x - r - 22} ${y + r + 16} L${p.x - r - 4} ${y + r - 2} M${p.x - r - 4} ${y + r - 2} l-2 9 M${p.x - r - 4} ${y + r - 2} l-9 2`, stroke: "ink", width: 2.2, fill: "none" });
        shapes.push({ t: "text", x: p.x, y: y + r + 21, text: String(i + 1), size: 16, anchor: "middle", fill: "muted" });
        // Each kind is labelled at its individual nearest a margin (the shortest leader).
        // First or last in its generation, nobody stands between it and the margin.
        const end = i === 0 ? -1 : i === ordered.length - 1 ? 1 : 0;
        const side = end || (p.x < centre ? -1 : 1);
        const score = (end ? 1000 : 0) + Math.abs(p.x - centre) - g * 2;
        if (!pick.has(id) || score > pick.get(id)!.score) pick.set(id, { p, g, score, side });
      });
    });

    const names: Record<string, string> = {
      "affected-male": trait && `Male with ${trait}`.length <= 34 ? `Male with ${trait}` : "Affected male",
      "affected-female": trait && `Female with ${trait}`.length <= 34 ? `Female with ${trait}` : "Affected female",
      "unaffected-male": "Unaffected male",
      "unaffected-female": "Unaffected female",
      carrier: "Carrier (unaffected)",
    };
    for (const id of ["affected-male", "affected-female", "unaffected-male", "unaffected-female", "carrier"]) {
      const hit = pick.get(id);
      if (!hit) continue;
      const side = hit.side;
      parts.push({ id, name: names[id], anchor: { x: hit.p.x + side * (hit.p.sex === "M" ? r : Math.sqrt(r * r - 81)), y: yOf(hit.g) + 9 } });
    }
    if (firstMarriage) parts.push({ id: "marriage-line", name: "Partners (marriage line)", anchor: firstMarriage });
    if (firstSibship) parts.push({ id: "offspring-line", name: "Children (sibship line)", anchor: firstSibship });
    parts.push({ id: "generation", name: rows.length > 1 ? "Generation II" : "Generation I", anchor: { x: 6, y: yOf(rows.length > 1 ? 1 : 0) - 18 } });
    return { w, h, shapes, parts };
  },
};

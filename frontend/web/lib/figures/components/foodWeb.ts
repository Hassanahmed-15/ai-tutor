import type { FigureComponent, FigureParams, FigurePart, FigureShape, Pt } from "../types";
import { BIO, arrowShapes, arrowMid, capital, cleanName, r2, roundedPoly, softShape } from "./bioDraw";
import { textW } from "./mathsKit";

/** Trophic levels: 0 producer … 4 quaternary consumer; decomposers stand apart (-1). */
const ROLE_WORDS: Array<[number, RegExp]> = [
  [-1, /decompos|detritiv|saprotroph|fung|bacteri/],
  [0, /produc|plant|autotroph|^0$|algae|phytoplankton/],
  [4, /quaternary|fourth|^4$/],
  [3, /tertiary|third|^3$/],
  [2, /secondary|second|^2$/],
  [1, /primary|first|herbivor|^1$/],
];
const LEVEL_PART = ["producer", "primary", "secondary", "tertiary", "quaternary"];
const LEVEL_NAME = ["Producer", "Primary consumer", "Secondary consumer", "Tertiary consumer", "Quaternary consumer"];
const LEVEL_INK = [BIO.green, BIO.blue, BIO.violet, BIO.red, BIO.amber] as const;

export type Organism = { name: string; level: number };
export type FoodWeb = { organisms: Organism[]; links: Array<{ prey: number; predator: number }>; chain: Set<string> };

const DEFAULT_ORGANISMS = "grass:producer; rabbit:primary; grasshopper:primary; frog:secondary; fox:secondary; hawk:tertiary";
const DEFAULT_LINKS = "grass>rabbit, grass>grasshopper, grasshopper>frog, rabbit>fox, frog>hawk, rabbit>hawk";

const key = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * Organisms, their trophic levels and who eats whom. A role the board gives decides the level; one it
 * leaves out is worked out from the links (a producer eats nothing; a consumer is one level above the
 * highest level it eats). Arrows always run from the food to the feeder: the direction energy flows.
 */
export function parseFoodWeb(params: FigureParams): FoodWeb {
  const orgText = typeof params.organisms === "string" && params.organisms.trim() ? params.organisms : typeof params.links === "string" && params.links.trim() ? "" : DEFAULT_ORGANISMS;
  const linkText = typeof params.links === "string" && params.links.trim() ? params.links : orgText === DEFAULT_ORGANISMS ? DEFAULT_LINKS : "";
  const organisms: Array<{ name: string; level: number | null }> = [];
  const index = new Map<string, number>();
  const add = (raw: string, level: number | null) => {
    const name = cleanName(raw, 16);
    const k = key(name);
    if (!k) return -1;
    if (index.has(k)) {
      const i = index.get(k)!;
      if (level !== null && organisms[i].level === null) organisms[i].level = level;
      return i;
    }
    if (organisms.length >= 16) return -1;
    index.set(k, organisms.length);
    organisms.push({ name: capital(name), level });
    return organisms.length - 1;
  };
  for (const item of orgText.split(/[;,\n]+/)) {
    const [n, role = ""] = item.split(/[:=]/);
    if (!n?.trim()) continue;
    const r = role.trim().toLowerCase();
    const hit = r ? ROLE_WORDS.find(([, re]) => re.test(r)) : undefined;
    add(n, hit ? hit[0] : null);
  }
  const links: FoodWeb["links"] = [];
  const seen = new Set<string>();
  for (const item of linkText.split(/[;,\n]+/)) {
    const chain = item.split(/\s*(?:->|→|>|\beaten by\b)\s*/i).map((s) => s.trim()).filter(Boolean);
    for (let i = 0; i + 1 < chain.length; i++) {
      const a = add(chain[i], null), b = add(chain[i + 1], null);
      if (a < 0 || b < 0 || a === b || seen.has(`${a}>${b}`)) continue;
      seen.add(`${a}>${b}`);
      links.push({ prey: a, predator: b });
    }
  }
  // Levels the board left out: from the links, a few passes (food webs are shallow).
  const level = organisms.map((o) => o.level);
  for (let pass = 0; pass < 6; pass++) {
    organisms.forEach((_, i) => {
      if (organisms[i].level !== null) return;
      const prey = links.filter((l) => l.predator === i).map((l) => level[l.prey]);
      if (!prey.length) { level[i] = 0; return; }
      const known = prey.filter((v): v is number => v !== null && v >= 0);
      if (known.length) level[i] = Math.min(4, Math.max(...known) + 1);
    });
  }
  const out = organisms.map((o, i) => ({ name: o.name, level: level[i] ?? 1 }));
  const chain = new Set<string>();
  const hl = String(params.highlight ?? params.chain ?? "").split(/\s*(?:->|→|>)\s*/).map((s) => index.get(key(cleanName(s, 16))));
  for (let i = 0; i + 1 < hl.length; i++) if (hl[i] !== undefined && hl[i + 1] !== undefined) chain.add(`${hl[i]}>${hl[i + 1]}`);
  return { organisms: out, links, chain };
}

const NODE_H = 38, FONT = 17;

/**
 * A food web: organisms in rows by trophic level (producers at the bottom), every arrow from the food
 * to the organism that eats it — the direction of energy flow — and, if asked, one food chain through
 * it picked out in red. Decomposers stand at the side, fed by dashed arrows.
 */
export const foodWeb: FigureComponent = {
  name: "foodWeb",
  title: "Food web: organisms by trophic level, arrows from food to feeder (direction of energy flow), optional highlighted food chain",
  params: `organisms (each "name:role", separated by ";" — roles producer, primary, secondary, tertiary, quaternary, decomposer — e.g. "grass:producer; rabbit:primary; fox:secondary"; a role left out is worked out from the links); links (who is eaten by whom, food first: "grass>rabbit, rabbit>fox" — chains allowed: "grass>rabbit>fox"); highlight (one food chain to pick out, e.g. "grass>rabbit>fox"). Arrows always point from the food to the feeder (the direction energy flows).`,
  match: /\b(food (web|chain)s?|trophic levels?|(primary|secondary|tertiary|quaternary) consumers?|who eats whom|feeding relationships?|predator[- ]prey (relationship|link)s?)\b|\bproducers? and consumers\b(?=[\s\S]*\b(ecosystems?|organisms?|prey|predators?|habitats?|species|food|energy flow)\b)/i,
  parts: [
    { id: "producer", name: "Producer" },
    { id: "primary", name: "Primary consumer" },
    { id: "secondary", name: "Secondary consumer" },
    { id: "tertiary", name: "Tertiary consumer" },
    { id: "quaternary", name: "Quaternary consumer" },
    { id: "decomposer", name: "Decomposer" },
    { id: "energy-flow", name: "Arrow: direction of energy flow" },
  ],
  build(params: FigureParams) {
    const web = parseFoodWeb(params);
    const { organisms, links, chain } = web;
    const levels = [...new Set(organisms.filter((o) => o.level >= 0).map((o) => o.level))].sort((a, b) => a - b);
    const maxLevel = levels.length ? levels[levels.length - 1] : 0;
    const rowOf = (lv: number) => maxLevel - lv; // row 0 at the top
    const ROW_GAP = maxLevel >= 4 ? 62 : maxLevel === 3 ? 80 : 100;
    const width = (i: number) => textW(organisms[i].name, FONT) + 30;

    // Rows, ordered to keep arrows short and uncrossed: a few barycentre sweeps (down, then up).
    const rows: number[][] = Array.from({ length: maxLevel + 1 }, () => []);
    organisms.forEach((o, i) => { if (o.level >= 0) rows[o.level].push(i); });
    const decomposers = organisms.map((o, i) => (o.level < 0 ? i : -1)).filter((i) => i >= 0);
    const pos = new Map<number, number>();
    const setPos = () => rows.forEach((row) => row.forEach((i, j) => pos.set(i, (j + 0.5) / row.length)));
    setPos();
    for (let sweep = 0; sweep < 4; sweep++) {
      const order = sweep % 2 === 0 ? rows.map((_, k) => k) : rows.map((_, k) => rows.length - 1 - k);
      for (const lv of order) {
        const bary = (i: number) => {
          const ns = links.filter((l) => l.prey === i || l.predator === i).map((l) => (l.prey === i ? l.predator : l.prey)).filter((j) => organisms[j].level >= 0 && organisms[j].level !== lv);
          return ns.length ? ns.reduce((a, j) => a + pos.get(j)!, 0) / ns.length : pos.get(i)!;
        };
        const b = new Map(rows[lv].map((i) => [i, bary(i)]));
        rows[lv].sort((x, y) => b.get(x)! - b.get(y)! || x - y);
        setPos();
      }
    }

    // Positions: each row spread evenly across the width; decomposers in a column at the right.
    const rowWidth = (row: number[]) => row.reduce((a, i) => a + width(i), 0) + 46 * Math.max(0, row.length - 1);
    const mainW = Math.max(420, ...rows.map(rowWidth)) + 20;
    const decoW = decomposers.length ? Math.max(...decomposers.map(width)) + 70 : 0;
    const W = mainW + decoW;
    const H = (maxLevel + 1) * NODE_H + maxLevel * ROW_GAP + 16;
    const centre = new Map<number, Pt>();
    rows.forEach((row, lv) => {
      const total = rowWidth(row);
      const gap = row.length > 1 ? Math.min(46 + (mainW - 20 - total) / (row.length - 1), 160) : 0;
      let x = (mainW - (row.reduce((a, i) => a + width(i), 0) + gap * Math.max(0, row.length - 1))) / 2;
      const y = 8 + rowOf(lv) * (NODE_H + ROW_GAP) + NODE_H / 2;
      for (const i of row) { centre.set(i, { x: x + width(i) / 2, y }); x += width(i) + gap; }
    });
    decomposers.forEach((i, k) => centre.set(i, { x: mainW + decoW / 2 + 10, y: H / 2 + (k - (decomposers.length - 1) / 2) * (NODE_H + 30) }));

    const shapes: FigureShape[] = [];
    const parts: FigurePart[] = [];
    const partOf = (i: number) => (organisms[i].level < 0 ? "decomposer" : LEVEL_PART[organisms[i].level]);

    // Arrows first (under the nodes): prey → predator, spread along each node's edge.
    const outs = new Map<number, number[]>(), ins = new Map<number, number[]>();
    links.forEach((l, k) => { outs.set(l.prey, [...(outs.get(l.prey) ?? []), k]); ins.set(l.predator, [...(ins.get(l.predator) ?? []), k]); });
    const spread = (list: number[] | undefined, k: number, i: number, other: (k: number) => number) => {
      if (!list || list.length < 2) return 0;
      const sorted = [...list].sort((a, b) => centre.get(other(a))!.x - centre.get(other(b))!.x);
      const w = Math.min(width(i) - 20, 22 * (list.length - 1));
      return -w / 2 + (w * sorted.indexOf(k)) / (list.length - 1);
    };
    let flowAnchor: { p: Pt; score: number } | null = null;
    links.forEach((l, k) => {
      const a = centre.get(l.prey)!, b = centre.get(l.predator)!;
      const toDeco = organisms[l.predator].level < 0;
      let from: Pt, to: Pt;
      if (toDeco) {
        from = { x: a.x + width(l.prey) / 2, y: a.y };
        to = { x: b.x - width(l.predator) / 2, y: b.y + spread(ins.get(l.predator), k, l.predator, (m) => links[m].prey) * 0.5 };
      } else if (Math.abs(a.y - b.y) < 1) {
        const dir = b.x > a.x ? 1 : -1;
        from = { x: a.x + (dir * width(l.prey)) / 2, y: a.y };
        to = { x: b.x - (dir * width(l.predator)) / 2, y: b.y };
      } else {
        const up = b.y < a.y ? 1 : -1;
        from = { x: a.x + spread(outs.get(l.prey), k, l.prey, (m) => links[m].predator), y: a.y - (up * NODE_H) / 2 };
        to = { x: b.x + spread(ins.get(l.predator), k, l.predator, (m) => links[m].prey), y: b.y + (up * NODE_H) / 2 + up * 1 };
      }
      // A link that skips a level bows out round the row it passes.
      const skip = Math.abs(organisms[l.prey].level - organisms[l.predator].level) > 1 && !toDeco;
      // It bows to whichever side keeps it further from the organisms in the rows it passes.
      const between = organisms.map((o, j) => ({ o, j })).filter(({ o }) => o.level >= 0 && o.level > Math.min(organisms[l.prey].level, organisms[l.predator].level) && o.level < Math.max(organisms[l.prey].level, organisms[l.predator].level)).map(({ j }) => centre.get(j)!);
      const clearance = (bd: number) => { const m = arrowMid(from, to, bd); return Math.min(...between.map((c) => Math.hypot(c.x - m.x, c.y - m.y))); };
      const bend = skip ? (clearance(52) >= clearance(-52) ? 52 : -52) : 0;
      const hot = chain.has(`${l.prey}>${l.predator}`);
      const colour = hot ? BIO.red : toDeco ? "muted" : "ink";
      shapes.push(...arrowShapes(from, to, colour, hot ? 3.6 : 2.2, "energy-flow", { head: hot ? 14 : 12, bend, ...(toDeco ? { dash: "6 5" } : {}), ...(chain.size && !hot ? { opacity: 0.55 } : {}) }));
      // The energy-flow anchor: on an arrow near the figure's edge (on the highlighted chain if there is one).
      const m = arrowMid(from, to, bend);
      const score = (hot ? -1000 : 0) + Math.min(m.x, W - m.x) + (toDeco ? 400 : 0);
      if (!flowAnchor || score < flowAnchor.score) flowAnchor = { p: m, score };
    });

    // Nodes: a rounded card per organism, tinted by trophic level.
    const anchorFor = new Map<string, { p: Pt; d: number }>();
    organisms.forEach((o, i) => {
      const c = centre.get(i)!, w = width(i), part = partOf(i);
      const ink = o.level < 0 ? BIO.amber : LEVEL_INK[o.level];
      const d = roundedPoly([{ x: c.x - w / 2, y: c.y - NODE_H / 2 }, { x: c.x + w / 2, y: c.y - NODE_H / 2 }, { x: c.x + w / 2, y: c.y + NODE_H / 2 }, { x: c.x - w / 2, y: c.y + NODE_H / 2 }], 14);
      const inChain = [...chain].some((s) => s.split(">").map(Number).includes(i));
      shapes.push(...softShape(d, ink, part, { fillOpacity: 0.2, width: inChain ? 3.2 : 2, stroke: inChain ? BIO.red : "ink" }));
      shapes.push({ t: "text", part, x: r2(c.x), y: r2(c.y + FONT * 0.36), text: o.name, size: FONT, anchor: "middle" });
      // Each level's label points at an organism's outer end (the end facing the margin its label will
      // stand in, so the leader never crosses the card); the nearer a side, the better, with levels
      // alternating sides (producers left) when there is a choice.
      const left = c.x < W / 2;
      const p = { x: r2(left ? c.x - w / 2 + 6 : c.x + w / 2 - 6), y: r2(c.y) };
      const preferLeft = o.level >= 0 && o.level % 2 === 0;
      const dist = (left ? c.x - w / 2 : W - (c.x + w / 2)) + (left === preferLeft ? 0 : 60);
      const prev = anchorFor.get(part);
      if (!prev || dist < prev.d) anchorFor.set(part, { p, d: dist });
    });
    const firstOf = (part: string) => organisms.find((o, i) => partOf(i) === part && Math.abs(centre.get(i)!.x - anchorFor.get(part)!.p.x) <= width(i) / 2)?.name;
    for (const part of [...LEVEL_PART, "decomposer"]) {
      const a = anchorFor.get(part);
      if (!a) continue;
      const base = part === "decomposer" ? "Decomposer" : LEVEL_NAME[LEVEL_PART.indexOf(part)];
      const who = firstOf(part);
      parts.push({ id: part, name: who && `${base} (${who.toLowerCase()})`.length <= 34 ? `${base} (${who.toLowerCase()})` : base, anchor: a.p });
    }
    const fa = flowAnchor as { p: Pt; score: number } | null;
    if (fa) parts.push({ id: "energy-flow", name: chain.size ? "Food chain (energy flow)" : "Arrow: direction of energy flow", anchor: { x: r2(fa.p.x), y: r2(fa.p.y) } });
    return { w: r2(W), h: r2(H), shapes, parts };
  },
};

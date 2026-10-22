import type { FigureComponent, FigureParams, Ink, Pt } from "../types";
import { fitText } from "../cuts";
import { PALETTE, Sketch, type Frac, bool, clamp, fmt, frac, fracAdd, fracMul, fracStr, lerp, list, num, parseProb, perp, str, sub, textW, unit } from "./mathsKit";

/**
 * PROBABILITY TREE. The board gives each stage's outcomes and probabilities (fractions or decimals;
 * a stage can depend on the branch before it, as in "without replacement"). The code checks every
 * set of branches sums to 1 — a single missing value is filled with the complement; a set with more
 * gaps, or none given, leaves them blank (never an invented even split) — multiplies along each path, and writes each outcome's probability at its
 * leaf, exactly (as a fraction) whenever every branch was given as a fraction.
 */

type Prob = { value: number; frac?: Frac; text: string };
export type TreeLeaf = { path: string[]; p: number; frac?: Frac; text: string; working: string };
type Node = { label: string; prob?: Prob; depth: number; children: Node[]; path: string[]; pos?: Pt; leafIndex?: number; p: number; f?: Frac };

/** One set of branches: n probabilities that sum to 1 (complement for one gap; else normalised). */
export function branchProbs(raw: string[], n: number): Prob[] {
  let parsed = Array.from({ length: n }, (_, i) => (raw[i] && raw[i] !== "?" ? parseProb(raw[i]) : null));
  // Every branch given as a count ("3,2": 3 red, 2 blue) is a share of the total.
  const counts = parsed.every((p) => p && p.value >= 0) && parsed.some((p) => p!.value > 1);
  if (counts) {
    const total = parsed.reduce((t, p) => t + p!.value, 0);
    const whole = parsed.every((p) => Number.isInteger(p!.value));
    parsed = parsed.map((p) => ({ value: p!.value / total, frac: whole ? frac(p!.value, total) : undefined }));
    raw = parsed.map((p) => (p!.frac ? fracStr(p!.frac) : fmt(p!.value, 3)));
  }
  const valid = parsed.map((p) => (p && p.value >= 0 && p.value <= 1 ? p : null));
  const known = valid.filter((p): p is NonNullable<typeof p> => Boolean(p));
  const allFrac = known.every((p) => p.frac);
  const sum = known.reduce((t, p) => t + p.value, 0);
  const missing = valid.map((p, i) => (p ? -1 : i)).filter((i) => i >= 0);
  let out: Array<{ value: number; frac?: Frac }>;
  // A branch the board gave no probability for stays blank: an even "1/2" in its place was invented
  // data the board review rightly rejected (maths benchmark, 2026-10-21 — "P(art | not music)" was
  // never said). With two or more gaps the given ones are kept as given and the rest stay blank.
  if (!known.length) out = valid.map(() => ({ value: NaN }));
  else if (missing.length > 1 && sum <= 1 + 1e-9) out = valid.map((p) => p ?? { value: NaN });
  else if (missing.length === 1 && sum <= 1 + 1e-9) {
    const restFrac = allFrac ? known.reduce((t, p) => fracAdd(t, p.frac!), frac(0, 1)) : undefined;
    out = valid.map((p) => p ?? { value: 1 - sum, frac: restFrac ? frac(restFrac.d - restFrac.n, restFrac.d) : undefined });
  } else if (missing.length === 0 && Math.abs(sum - 1) < 1e-6) out = valid.map((p) => p!);
  else {
    // Does not sum to 1: share what is missing equally, then normalise the whole set.
    const share = missing.length ? Math.max(0, 1 - sum) / missing.length : 0;
    const filled = valid.map((p) => p ?? { value: share });
    const total = filled.reduce((t, p) => t + p.value, 0) || 1;
    const fracTotal = !missing.length && allFrac ? known.reduce((t, p) => fracAdd(t, p.frac!), frac(0, 1)) : undefined;
    out = filled.map((p) => ({ value: p.value / total, frac: fracTotal && p.frac ? frac(p.frac.n * fracTotal.d, p.frac.d * fracTotal.n) : undefined }));
  }
  return out.map((p, i) => {
    if (Number.isNaN(p.value)) return { value: NaN, text: "" };
    const asGiven = valid[i] && Math.abs(valid[i]!.value - p.value) < 1e-9 ? raw[i].replace(/\s+/g, "") : undefined;
    return { ...p, text: asGiven ?? (p.frac ? fracStr(p.frac) : fmt(p.value, 3)) };
  });
}

function stageParams(params: FigureParams) {
  const labels = (k: string, fb: string[]) => {
    const l = list(params[k], /,/).slice(0, 3).map((s) => fitText(s, 12));
    return l.length >= 2 ? l : fb;
  };
  const first = labels("first", ["H", "T"]);
  const second = labels("second", first);
  const third = labels("third", second);
  const given = (k: string) => params[k] !== undefined && String(params[k]).trim() !== "";
  const stages = clamp(Math.round(num(params.stages, given("third") || given("thirdP") ? 3 : 2, 1, 3)), 1, 3);
  return { stages, labels: [first, second, third].slice(0, stages), probs: ["firstP", "secondP", "thirdP"].map((k) => String(params[k] ?? "")) };
}

/** Build the tree (and its leaves, in order top to bottom). */
export function buildTree(params: FigureParams): { root: Node; leaves: TreeLeaf[]; stages: number } {
  const { stages, labels, probs } = stageParams(params);
  const root: Node = { label: "", depth: 0, children: [], path: [], p: 1, f: frac(1, 1) };
  const counters = [0, 0, 0];
  const grow = (node: Node) => {
    const d = node.depth;
    if (d >= stages) return;
    // Groups separated by "|": one per branch of the stage before (in order), else the one group repeats.
    const groups = probs[d].split("|");
    const g = groups.length > 1 ? groups[Math.min(counters[d], groups.length - 1)] : groups[0];
    counters[d]++;
    const ps = branchProbs(list(g, /,/), labels[d].length);
    labels[d].forEach((label, i) => {
      const pr = ps[i];
      const child: Node = { label, prob: pr, depth: d + 1, children: [], path: [...node.path, label], p: node.p * pr.value, f: node.f && pr.frac ? fracMul(node.f, pr.frac) : undefined };
      node.children.push(child);
      grow(child);
    });
  };
  grow(root);
  const leaves: TreeLeaf[] = [];
  const walk = (n: Node, chain: Prob[]) => {
    if (!n.children.length) {
      n.leafIndex = leaves.length;
      // An outcome along a blank branch has no probability to write.
      const blank = Number.isNaN(n.p);
      leaves.push({ path: n.path, p: n.p, frac: blank ? undefined : n.f, text: blank ? "" : n.f ? fracStr(n.f) : fmt(n.p, 4), working: blank ? "" : chain.map((c) => c.text).join(" × ") });
      return;
    }
    n.children.forEach((c) => walk(c, [...chain, c.prob!]));
  };
  walk(root, []);
  return { root, leaves, stages };
}

const PARTS = [
  { id: "first-stage", name: "1st stage" },
  { id: "second-stage", name: "2nd stage" },
  { id: "outcomes", name: "Outcomes" },
];

export const probabilityTree: FigureComponent = {
  name: "probabilityTree",
  title: "Probability tree diagram: 1-3 stages of branches with their probabilities, each outcome's probability (the product along its path) written at the leaves",
  params: `first, second, third (branch labels per stage, 2-3 each, comma-separated, e.g. first "Red,Blue"; later stages default to the first's labels; default "H,T"); firstP, secondP, thirdP (probabilities in the same order, fractions "3/5,2/5" or decimals "0.6,0.4"; leave one blank or "?" and it is the complement; with more gaps, or a group left empty, those branches and their outcomes are left blank — never invent a probability the lesson does not give; complete sets that do not sum to 1 are normalised; for dependent events give one group per earlier branch separated by "|", e.g. secondP "2/4,2/4|3/4,1/4" — without replacement); stages (1-3; default 2, or 3 when third/thirdP is given); outcomes (true default: write each outcome and its probability at the leaves); working (true: write the multiplication, e.g. "1/2 × 1/3 = 1/6"; default false); highlight (one path to colour, e.g. "Red,Blue"). Outcome probabilities are computed (exact fractions when every branch is a fraction). A 1-stage tree has no second-stage part; third-stage branches are not separately labelled.`,
  match: /\bprobability trees?\b|\btree diagrams?\b|^(?![\s\S]*\bsampl)[\s\S]*\b(with|without) replacement\b|\bindependent events?\b.*\btree\b|\bconditional probabilit\w*.*\btree\b/i,
  parts: PARTS,
  build(params: FigureParams) {
    const { root, leaves, stages } = buildTree(params);
    const showOutcomes = bool(params.outcomes, true);
    const working = bool(params.working, false);
    const highlight = list(params.highlight, /,/);
    const onPath = (path: string[]) => highlight.length > 0 && path.every((l, i) => highlight[i] === l);

    const colW = 124, labelSize = 22, probSize = 19;
    const rowH = clamp(440 / leaves.length, 32, 92);
    const nodes: Node[] = [];
    const place = (n: Node) => {
      n.children.forEach(place);
      const y = n.children.length ? n.children.reduce((t, c) => t + c.pos!.y, 0) / n.children.length : n.leafIndex! * rowH;
      n.pos = { x: n.depth * colW, y };
      nodes.push(n);
    };
    place(root);

    const sk = new Sketch();
    sk.circle(root.pos!, 4, { fill: "ink", stroke: "ink", width: 1 }, false);
    const partOf = (depth: number) => (depth === 1 ? "first-stage" : depth === 2 ? "second-stage" : undefined);
    const branches: Array<{ p: Pt; q: Pt; node: Node }> = [];
    for (const n of nodes) for (const c of n.children) {
      const out = n.depth === 0 ? 4 : textW(n.label, labelSize) / 2 + 8;
      const inn = textW(c.label, labelSize) / 2 + 8;
      const p = { x: n.pos!.x + out, y: n.pos!.y }, q = { x: c.pos!.x - inn, y: c.pos!.y };
      const hot = onPath(c.path);
      sk.line([p, q], { stroke: hot ? PALETTE.blue : "ink", width: hot ? 3.2 : 2.2, part: partOf(c.depth) });
      sk.text(c.pos!, c.label, labelSize, hot ? PALETTE.blue : "ink", partOf(c.depth));
      branches.push({ p, q, node: c });
    }
    // Probabilities on the branches: above a rising branch, below a falling one (above a level one).
    for (const { p, q, node } of branches) {
      if (!node.prob!.text) continue;
      let n = perp(unit(sub(q, p)));
      const up = q.y <= p.y + 0.5;
      if ((up && n.y > 0) || (!up && n.y < 0)) n = { x: -n.x, y: -n.y };
      sk.placeText(node.prob!.text, probSize, lerp(p, q, 0.5), n, { min: 2, max: 50, fill: onPath(node.path) ? PALETTE.blue : "ink", part: partOf(node.depth), slide: unit(sub(q, p)) });
    }

    // Leaves: outcome, then its probability, in two aligned columns.
    let outcomeAnchor: Pt = { x: stages * colW, y: 0 };
    if (showOutcomes) {
      const leafNodes = nodes.filter((n) => !n.children.length).sort((a, b) => a.leafIndex! - b.leafIndex!);
      const maxLabel = Math.max(...leafNodes.map((n) => textW(n.label, labelSize)));
      const names = leaves.map((l) => l.path.join(", "));
      const probs = leaves.map((l) => (!l.text ? "" : working ? `${l.working} = ${l.text}` : l.text));
      const x1 = stages * colW + maxLabel / 2 + 30;
      const w1 = Math.max(...names.map((t) => textW(t, probSize)));
      const x2 = x1 + w1 + 22;
      const w2 = Math.max(...probs.map((t) => textW(t, probSize)));
      // A light rule separates the tree from its outcome table.
      sk.line([{ x: x1 - 14, y: -rowH * 0.4 }, { x: x1 - 14, y: (leaves.length - 0.6) * rowH }], { stroke: "muted", width: 1.2, opacity: 0.5, part: "outcomes" });
      leaves.forEach((l, i) => {
        const y = leafNodes[i].pos!.y;
        const fill: Ink = onPath(l.path) ? PALETTE.blue : "ink";
        sk.text({ x: x1 + textW(names[i], probSize) / 2, y }, names[i], probSize, fill, "outcomes");
        if (probs[i]) sk.text({ x: x2 + textW(probs[i], probSize) / 2, y }, probs[i], probSize, onPath(l.path) ? PALETTE.blue : PALETTE.green, "outcomes");
      });
      outcomeAnchor = { x: x2 + w2 + 9, y: leafNodes[0].pos!.y - 3 };
    } else {
      const top = nodes.filter((n) => !n.children.length).sort((a, b) => a.leafIndex! - b.leafIndex!)[0];
      outcomeAnchor = { x: top.pos!.x + textW(top.label, labelSize) / 2 + 2, y: top.pos!.y };
    }

    const firstBranch = branches.find((b) => b.node.depth === 1)!;
    sk.part("first-stage", "1st stage", sk.clearAnchor([0.3, 0.7, 0.2, 0.8].map((t) => lerp(firstBranch.p, firstBranch.q, t))));
    const secondBranch = branches.find((b) => b.node.depth === 2);
    if (secondBranch) sk.part("second-stage", "2nd stage", sk.clearAnchor([0.3, 0.7, 0.2, 0.8].map((t) => lerp(secondBranch.p, secondBranch.q, t))));
    sk.part("outcomes", "Outcomes", outcomeAnchor);
    return sk.finish(12);
  },
};

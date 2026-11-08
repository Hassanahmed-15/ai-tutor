// Machine learning: kmeans_3d (Lloyd's iterations to convergence, seeded), embeddings_cloud
// (labelled points in 3D; nearest neighbours as facts) and cnn_convolution (a 3×3 filter sliding
// over a small input; the feature map values are computed).
import { z } from "zod/v4";
import { defineTemplate, VisualError, type Result, type Step } from "../../contract";
import type { Board, Vec3 } from "../../board3d/board";
import { fmt } from "../../expr";
import { mulberry32 } from "./nnLogic";
import type { ColorToken } from "../../theme";

const PALETTE: ColorToken[] = ["accent", "active", "done", "warn", "x", "z"];
const d2 = (a: Vec3, b: Vec3) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;

// ── kmeans_3d ───────────────────────────────────────────────────────────────────────────────────
const KArgs = z.object({ k: z.number().int().min(2).max(6).default(3), points: z.array(z.tuple([z.number(), z.number(), z.number()])).max(2000).optional(), seed: z.number().int().default(4) });
export function blobs(k: number, n: number, seed: number): Vec3[] {
  const r = mulberry32(seed), centres = Array.from({ length: k }, (_, i) => [Math.cos((2 * Math.PI * i) / k) * 3, Math.sin((2 * Math.PI * i) / k) * 3, (i % 2) * 2 - 1]);
  return Array.from({ length: n }, (_, i) => { const c = centres[i % k], g = () => (r() + r() + r() - 1.5) * 1.1; return [c[0] + g(), c[1] + g(), c[2] + g()] as Vec3; });
}
export function kmeans(P: Vec3[], k: number, seed: number) {
  const r = mulberry32(seed + 1);
  let C: Vec3[] = Array.from({ length: k }, () => P[Math.floor(r() * P.length)]);
  const iters: { C: Vec3[]; assign: number[] }[] = [];
  for (let it = 0; it < 20; it++) {
    const assign = P.map((p) => C.reduce((best, c, j) => (d2(p, c) < d2(p, C[best]) ? j : best), 0));
    const next = C.map((c, j) => { const m = P.filter((_, i) => assign[i] === j); return m.length ? (m.reduce((s, p) => [s[0] + p[0], s[1] + p[1], s[2] + p[2]], [0, 0, 0]).map((v) => v / m.length) as Vec3) : c; });
    iters.push({ C, assign });
    if (next.every((c, j) => d2(c, C[j]) < 1e-12)) break;
    C = next;
  }
  const last = iters[iters.length - 1];
  const inertia = P.reduce((s, p, i) => s + d2(p, last.C[last.assign[i]]), 0);
  return { iters, inertia };
}
export const kmeansTemplate = defineTemplate({
  id: "kmeans_3d", domain: "cs", family: "machine_learning", title: "k-means clustering",
  topics: ["k-means", "kmeans", "clustering", "centroid", "clusters"], schema: KArgs, defaults: { k: 3, seed: 4 },
  narrationHints: ["Each point joins its nearest centroid.", "Each centroid moves to the middle of its points.", "Repeat until nothing changes."],
  run(b, a): Result {
    const P = (a.points as Vec3[] | undefined) ?? blobs(a.k, 120, a.seed);
    if (P.length < a.k) throw new VisualError(`Need at least ${a.k} points for k = ${a.k}.`);
    const r = kmeans(P, a.k, a.seed);
    b.clear();
    b.axes("axes", { size: 5, negative: true });
    b.points("all", { points: P, color: "muted", size: 0.07 });
    b.fit(P, "iso");
    const steps: Step[] = r.iters.map((it, n) => ({ caption: n === 0 ? `Start with ${a.k} random centroids; colour each point by its nearest one` : `Iteration ${n + 1}: move each centroid to its cluster's mean, then re-assign`, apply: (bb) => {
      bb.remove("all");
      for (let j = 0; j < a.k; j++) { bb.points(`p${j}`, { points: P.filter((_, i) => it.assign[i] === j), color: PALETTE[j], size: 0.07 }); bb.node(`c${j}`, { at: it.C[j], color: PALETTE[j], shape: "box", size: 0.2, label: `centroid ${j + 1}` }); }
    } }));
    steps.push({ caption: `Converged after ${r.iters.length} iteration(s): nothing changes any more`, apply: () => {} });
    return { facts: { k: a.k, points: P.length, iterations: r.iters.length, inertia: fmt(r.inertia), cluster_sizes: Array.from({ length: a.k }, (_, j) => r.iters[r.iters.length - 1].assign.filter((x) => x === j).length) }, steps, summary: `k-means with k = ${a.k} converges in ${r.iters.length} iterations.` };
  },
  actions: {},
});

// ── embeddings_cloud ────────────────────────────────────────────────────────────────────────────
const EmArgs = z.object({ items: z.array(z.object({ label: z.string().max(16), at: z.tuple([z.number(), z.number(), z.number()]), group: z.string().max(16).optional() })).min(2).max(60) });
export const embeddingsTemplate = defineTemplate({
  id: "embeddings_cloud", domain: "cs", family: "machine_learning", title: "Embeddings in 3D",
  topics: ["embedding", "embeddings", "word vectors", "latent space", "similar words"], schema: EmArgs,
  defaults: { items: [["cat", [2.6, 1.4, 1.6], "animal"], ["dog", [2.4, 2.6, 0.8], "animal"], ["horse", [1.2, 2.8, 2], "animal"], ["car", [-2.4, -0.8, 0.4], "vehicle"], ["bus", [-2.8, -2, 1.6], "vehicle"], ["bike", [-1.4, -2.4, 0], "vehicle"], ["apple", [0.4, -2.2, 3], "food"], ["bread", [1.6, -2.6, 2.2], "food"]].map(([label, at, group]) => ({ label: label as string, at: at as [number, number, number], group: group as string })) },
  narrationHints: ["Similar things end up close together.", "Distance in this space stands for difference in meaning."],
  run(b, a): Result {
    b.clear();
    b.axes("axes", { size: 4, negative: true });
    const groups = [...new Set(a.items.map((i) => i.group ?? "items"))];
    a.items.forEach((it, k) => b.node(`e${k}`, { at: it.at as Vec3, color: PALETTE[groups.indexOf(it.group ?? "items") % PALETTE.length], size: 0.12, label: it.label }));
    b.fit(a.items.map((i) => i.at as Vec3), "iso");
    const nearest = a.items.map((it) => { const o = a.items.filter((x) => x !== it).sort((p, q) => d2(p.at as Vec3, it.at as Vec3) - d2(q.at as Vec3, it.at as Vec3))[0]; return `${it.label} → ${o.label}`; });
    return { facts: { items: a.items.length, groups, nearest_neighbour: nearest.slice(0, 8) }, steps: [], summary: `${a.items.length} items in ${groups.length} groups; similar items sit together.` };
  },
  actions: {},
});

// ── cnn_convolution ─────────────────────────────────────────────────────────────────────────────
const CArgs = z.object({ input: z.array(z.array(z.number().min(-9).max(9)).min(3).max(6)).min(3).max(6).optional(), kernel: z.array(z.array(z.number().min(-9).max(9)).length(3)).length(3).default([[1, 0, -1], [1, 0, -1], [1, 0, -1]]) });
export function convolve(I: number[][], K: number[][]): number[][] {
  const out: number[][] = [];
  for (let i = 0; i + 3 <= I.length; i++) { const row: number[] = []; for (let j = 0; j + 3 <= I[0].length; j++) { let s = 0; for (let a = 0; a < 3; a++) for (let c = 0; c < 3; c++) s += I[i + a][j + c] * K[a][c]; row.push(s); } out.push(row); }
  return out;
}
export const cnnTemplate = defineTemplate({
  id: "cnn_convolution", domain: "cs", family: "machine_learning", title: "Convolution: a filter sliding over an input",
  topics: ["convolution", "cnn", "filter", "kernel", "feature map", "edge detection"], schema: CArgs,
  defaults: { input: [[9, 9, 9, 0, 0], [9, 9, 9, 0, 0], [9, 9, 9, 0, 0], [9, 9, 9, 0, 0], [9, 9, 9, 0, 0]], kernel: [[1, 0, -1], [1, 0, -1], [1, 0, -1]] },
  narrationHints: ["The filter multiplies the 9 numbers under it and adds them up.", "A big output means the filter's pattern (here a vertical edge) is there."],
  run(b, a): Result {
    const I = a.input ?? [[9, 9, 9, 0, 0], [9, 9, 9, 0, 0], [9, 9, 9, 0, 0], [9, 9, 9, 0, 0], [9, 9, 9, 0, 0]];
    if (!I.every((r) => r.length === I[0].length)) throw new VisualError("Every row of the input must be the same length.");
    const O = convolve(I, a.kernel), H = I.length, W = I[0].length;
    b.clear();
    const at = (i: number, j: number, x0: number): Vec3 => [x0 + j * 0.72, 0, 1.6 - i * 0.72];
    I.forEach((row, i) => row.forEach((v, j) => b.box(`i${i}_${j}`, { at: at(i, j, -4.4), size: [0.66, 0.4, 0.66], color: v > 0 ? "idle" : "muted", label: String(v), inside: true })));
    O.forEach((row, i) => row.forEach((_, j) => b.box(`o${i}_${j}`, { at: at(i, j, 1.4), size: [0.66, 0.4, 0.66], color: "muted", label: "", inside: true })));
    b.label("li", { at: [-4.4 + ((W - 1) * 0.72) / 2, 0, 2.3], text: "input", color: "muted", small: true });
    b.label("lo", { at: [1.4 + ((O[0].length - 1) * 0.72) / 2, 0, 2.3], text: "feature map", color: "muted", small: true });
    b.fit([[-4.8, 0, 2.6], [1.4 + O[0].length * 0.72, 0, 1.6 - H * 0.72]], "front");
    const steps: Step[] = O.flatMap((row, i) => row.map((v, j) => ({ caption: `Filter at row ${i + 1}, column ${j + 1}: sum of products = ${v}`, apply: async (bb: Board, o: { animate: boolean }) => {
      for (let p = 0; p < H; p++) for (let q = 0; q < W; q++) if (bb.has(`i${p}_${q}`)) await bb.setColor(`i${p}_${q}`, p >= i && p < i + 3 && q >= j && q < j + 3 ? "active" : I[p][q] > 0 ? "idle" : "muted", { animate: false });
      bb.setLabel(`o${i}_${j}`, String(v));
      await bb.setColor(`o${i}_${j}`, v > 0 ? "done" : v < 0 ? "warn" : "idle", o);
    } })));
    return { facts: { input_size: `${H}×${W}`, kernel: a.kernel, output_size: `${O.length}×${O[0].length}`, feature_map: O }, steps, summary: `A 3×3 filter over a ${H}×${W} input gives a ${O.length}×${O[0].length} feature map.` };
  },
  actions: {},
});

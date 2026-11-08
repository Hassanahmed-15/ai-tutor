// avl_tree (insert with LL / RR / LR / RL rotations recorded) and trie (insert and search words).
import { z } from "zod/v4";
import { defineTemplate, VisualError, type Result, type Step } from "../../contract";
import type { Board, Vec3 } from "../../board3d/board";
import { IntKey } from "../shared";

interface N { v: number; l: N | null; r: N | null; h: number }
const h = (n: N | null) => (n ? n.h : 0);
const upd = (n: N) => ((n.h = 1 + Math.max(h(n.l), h(n.r))), n);
const rotR = (y: N) => { const x = y.l!; y.l = x.r; x.r = y; upd(y); return upd(x); };
const rotL = (x: N) => { const y = x.r!; x.r = y.l; y.l = x; upd(x); return upd(y); };
export function avlInsert(root: N | null, v: number, log: string[]): N {
  if (!root) return { v, l: null, r: null, h: 1 };
  if (v === root.v) throw new VisualError(`${v} is already in the tree.`);
  if (v < root.v) root.l = avlInsert(root.l, v, log); else root.r = avlInsert(root.r, v, log);
  upd(root);
  const bal = h(root.l) - h(root.r);
  if (bal > 1 && v < root.l!.v) return log.push(`LL at ${root.v}: rotate right`), rotR(root);
  if (bal < -1 && v > root.r!.v) return log.push(`RR at ${root.v}: rotate left`), rotL(root);
  if (bal > 1) return log.push(`LR at ${root.v}: rotate left at ${root.l!.v}, then right`), (root.l = rotL(root.l!)), rotR(root);
  if (bal < -1) return log.push(`RL at ${root.v}: rotate right at ${root.r!.v}, then left`), (root.r = rotR(root.r!)), rotL(root);
  return root;
}
export const avlValid = (n: N | null, lo = -Infinity, hi = Infinity): boolean => !n || (n.v > lo && n.v < hi && Math.abs(h(n.l) - h(n.r)) <= 1 && avlValid(n.l, lo, n.v) && avlValid(n.r, n.v, hi));
const inorder = (n: N | null, out: number[] = []): number[] => (n ? (inorder(n.l, out), out.push(n.v), inorder(n.r, out)) : out);

function drawAvl(b: Board, root: N | null) {
  for (const id of (b.state.ids as string[] | undefined) ?? []) b.remove(id);
  const ids: string[] = [], order = inorder(root), pos = new Map<number, Vec3>();
  const place = (n: N | null, d: number) => { if (!n) return; place(n.l, d + 1); pos.set(n.v, [(order.indexOf(n.v) - (order.length - 1) / 2) * 1.1, 0, 2.5 - d * 1.3]); place(n.r, d + 1); };
  place(root, 0);
  const walk = (n: N | null) => { if (!n) return; for (const c of [n.l, n.r]) if (c) { b.line(`e${n.v}_${c.v}`, { points: [pos.get(n.v)!, pos.get(c.v)!], color: "muted" }); ids.push(`e${n.v}_${c.v}`); } b.node(`n${n.v}`, { at: pos.get(n.v)!, label: `${n.v}`, color: "idle", size: 0.3 }); ids.push(`n${n.v}`); walk(n.l); walk(n.r); };
  walk(root);
  b.state.ids = ids;
  const xs = [...pos.values()].map((p) => p[0]), zs = [...pos.values()].map((p) => p[2]);
  b.fit([[Math.min(...xs, -2) - 0.6, 0, Math.min(...zs, -0.5) - 0.6], [Math.max(...xs, 2) + 0.6, 0, 3]], "front");
}
export const avlTemplate = defineTemplate({
  id: "avl_tree", domain: "cs", family: "trees", title: "AVL tree rotations",
  topics: ["avl", "avl tree", "tree rotation", "balanced tree", "balance factor"], schema: z.object({ values: z.array(IntKey).max(15) }), defaults: { values: [30, 20, 10] },
  narrationHints: ["Each node's two subtrees differ in height by at most 1.", "An insert that breaks the balance is fixed by a rotation."],
  run(b, a): Result {
    b.clear();
    const log: string[] = [];
    let root: N | null = null;
    const steps: Step[] = [];
    for (const v of a.values) {
      const before = log.length;
      root = avlInsert(root, v, log);
      const snap = JSON.parse(JSON.stringify(root));
      steps.push({ caption: log.length > before ? `Insert ${v}: unbalanced, so ${log.slice(before).join("; ")}` : `Insert ${v}: still balanced`, apply: (bb) => drawAvl(bb, snap) });
    }
    b.state.root = root;
    return { facts: { values: a.values, rotations: log, height: h(root), inorder: inorder(root), balanced: avlValid(root) }, steps, summary: `Inserting ${a.values.join(", ")} needs ${log.length} rotation(s); the height is ${h(root)}.` };
  },
  actions: { insert: { description: "Insert a key (rotating if needed).", schema: z.object({ value: IntKey }), run(b, { value }) {
    const log: string[] = [], root = avlInsert(JSON.parse(JSON.stringify(b.state.root ?? null)), value, log), snap = JSON.parse(JSON.stringify(root));
    b.state.root = root;
    return { facts: { inserted: value, rotations: log, height: h(root), balanced: avlValid(root) }, steps: [{ caption: log.length ? `Insert ${value}: ${log.join("; ")}` : `Insert ${value}: still balanced`, apply: (bb) => drawAvl(bb, snap) }], summary: log.length ? `Insert ${value}: ${log.join("; ")}.` : `Insert ${value}: no rotation needed.` };
  } } },
});

// ── trie ────────────────────────────────────────────────────────────────────────────────────────
const Word = z.string().regex(/^[a-z]{1,10}$/, "lower-case letters only, up to 10");
interface T { kids: Map<string, T>; end: boolean; id: string }
export function buildTrie(words: string[]): T {
  const root: T = { kids: new Map(), end: false, id: "root" };
  for (const w of words) { let n = root; for (const ch of w) { if (!n.kids.has(ch)) n.kids.set(ch, { kids: new Map(), end: false, id: `${n.id}_${ch}` }); n = n.kids.get(ch)!; } n.end = true; }
  return root;
}
function drawTrie(b: Board, root: T) {
  b.clear();
  let slot = 0;
  const pos = new Map<string, Vec3>();
  const place = (n: T, d: number): number => { const ch = [...n.kids.values()]; const x = ch.length ? ch.map((c) => place(c, d + 1)).reduce((a, c) => a + c, 0) / ch.length : slot++ * 1.1; pos.set(n.id, [x, 0, -d * 1.2]); return x; };
  place(root, 0);
  const mid = (Math.min(...[...pos.values()].map((p) => p[0])) + Math.max(...[...pos.values()].map((p) => p[0]))) / 2;
  for (const [k, p] of pos) pos.set(k, [p[0] - mid, 0, p[2] + 2.5]);
  const walk = (n: T) => { for (const [ch, c] of n.kids) { b.line(`e${c.id}`, { points: [pos.get(n.id)!, pos.get(c.id)!], color: "muted" }); b.node(c.id, { at: pos.get(c.id)!, label: c.end ? `${ch} ●` : ch, color: c.end ? "done" : "idle", size: 0.26 }); walk(c); } };
  b.node("root", { at: pos.get("root")!, label: "root", color: "muted", size: 0.2 });
  walk(root);
  b.fit([...pos.values()], "front");
}
export const trieTemplate = defineTemplate({
  id: "trie", domain: "cs", family: "trees", title: "Trie (prefix tree)",
  topics: ["trie", "prefix tree", "autocomplete", "prefix search"], schema: z.object({ words: z.array(Word).min(1).max(10) }), defaults: { words: ["cat", "car", "cart", "dog"] },
  narrationHints: ["Words with the same start share a path.", "A dot marks where a word ends."],
  run(b, a) { const t = buildTrie(a.words); drawTrie(b, t); b.state.words = a.words; return { facts: { words: a.words, nodes: countNodes(t) }, steps: [], summary: `A trie holding ${a.words.join(", ")}.` }; },
  actions: { search: { description: "Follow a word or prefix letter by letter.", schema: z.object({ word: Word }), run(b, { word }) {
    const t = buildTrie(b.state.words as string[]);
    let n: T | undefined = t;
    const path: string[] = [];
    for (const ch of word) { n = n?.kids.get(ch); if (!n) break; path.push(n.id); }
    const found = !!n && n.end, prefix = !!n;
    const steps: Step[] = path.map((id, k) => ({ caption: `Letter ${word[k]}: follow the branch`, apply: async (bb, o) => { await bb.setColor(id, "active", o); } }));
    steps.push({ caption: found ? `"${word}" is a word in the trie` : prefix ? `"${word}" is only a prefix (no word ends here)` : `No branch for "${word[path.length]}": "${word}" is not here`, apply: () => {} });
    return { facts: { word, found, is_prefix: prefix && !found, letters_matched: path.length }, steps, summary: found ? `"${word}" is in the trie.` : `"${word}" is not a stored word.` };
  } } },
});
const countNodes = (n: T): number => 1 + [...n.kids.values()].reduce((s, c) => s + countNodes(c), 0);

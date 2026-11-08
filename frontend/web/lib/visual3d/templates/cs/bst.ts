// BST template: the tree stands in a vertical plane (in-order left to right, root at the top), with
// insert, search, delete (all three cases) and traversals as step-by-step follow-ups.
import { z } from "zod/v4";
import { defineTemplate, VisualError, type Result, type Step } from "../../contract.ts";
import type { Board, Vec3 } from "../../board3d/board.ts";
import { BST, type Order } from "./bstLogic.ts";

const Value = z.number().int().min(-999).max(999).describe("An integer key, -999 to 999.");
const Args = z.object({
  values: z.array(Value).min(1).max(BST.MAX).describe(`Keys inserted in this order to build the tree (at most ${BST.MAX}).`),
});

const tree = (b: Board) => b.state.bst as BST;
const nid = (v: number) => `n${v}`;

function at(t: BST, v: number): Vec3 {
  const { pos } = t.layout();
  const p = pos.get(v)!;
  const n = t.size();
  return [(p.rank - (n - 1) / 2) * 1.15, p.depth * 0.25, 2.6 - p.depth * 1.35];
}

/** Draw (or re-arrange) the whole tree to match the logic: nodes glide to their new places. */
async function redraw(b: Board, animate: boolean) {
  const t = tree(b);
  const { pos, edges } = t.layout();
  for (const id of (b.state.edges as string[] | undefined) ?? []) b.remove(id);
  const keep = new Set([...pos.keys()].map(nid));
  for (const id of (b.state.nodes as string[] | undefined) ?? []) if (!keep.has(id)) b.remove(id);
  const moves: Promise<void>[] = [];
  for (const v of pos.keys()) {
    if (b.has(nid(v))) moves.push(b.move(nid(v), at(t, v), { animate }));
    else b.node(nid(v), { at: at(t, v), label: String(v), color: "idle" });
  }
  await Promise.all(moves);
  b.state.edges = edges.map(([p, c]) => {
    const id = `e${p}-${c}`;
    b.line(id, { points: [at(t, p), at(t, c)], color: "muted", width: 0.025 });
    return id;
  });
  b.state.nodes = [...keep];
  const pts = [...pos.keys()].map((v) => at(t, v));
  if (!animate) b.fit(pts.length ? pts : [[0, 0, 0]], "front");
}

/** Steps that walk a path: each compared node lights up with the comparison as its caption. */
function walkSteps(path: number[], target: number): Step[] {
  return path.map((v) => ({
    caption: target === v ? `${target} = ${v}: found it` : target < v ? `${target} < ${v}, so go left` : `${target} > ${v}, so go right`,
    apply: async (b, o) => {
      await b.setColor(nid(v), "active", o);
      if (o.animate) await b.pulse(nid(v), o);
    },
  }));
}

/** Back to plain nodes (no highlights, no visit numbers) before the next operation. */
const settle = (b: Board) => {
  for (const id of (b.state.nodes as string[]) ?? []) {
    void b.setColor(id, "idle", { animate: false });
    b.setLabel(id, id.slice(1));
  }
};

const facts = (t: BST, extra: Record<string, unknown> = {}) => ({ size: t.size(), height: t.height(), inorder: t.traverse("inorder"), valid_bst: t.isValid(), ...extra });

export const bstTemplate = defineTemplate({
  id: "bst",
  domain: "cs",
  family: "trees",
  title: "Binary search tree",
  topics: ["binary search tree", "bst", "tree insert", "tree search", "tree delete", "in-order traversal", "inorder", "preorder", "postorder", "successor"],
  schema: Args,
  defaults: { values: [50, 30, 70, 20, 40, 60, 80] },
  narrationHints: ["Smaller keys go left, bigger keys go right.", "Search follows one path down, so it takes about height steps.", "In-order traversal reads the keys in sorted order."],
  async run(b, args): Promise<Result> {
    b.clear();
    b.state.bst = BST.from(args.values);
    await redraw(b, false);
    const t = tree(b);
    return { facts: facts(t), steps: [], summary: `A binary search tree with ${t.size()} keys and height ${t.height()}.` };
  },
  actions: {
    insert: {
      description: "Insert a key, walking down from the root.",
      schema: z.object({ value: Value }),
      run(b, { value }): Result {
        const t = tree(b);
        settle(b);
        if (t.has(value)) throw new VisualError(`${value} is already in the tree; a BST keeps each key once.`);
        if (t.size() >= BST.MAX) throw new VisualError(`The tree is full (${BST.MAX} keys); start a new tree to add more.`);
        const path = t.search(value).path;
        const r = t.insert(value);
        const steps: Step[] = [...walkSteps(path, value), {
          caption: r.parent === null ? `The tree was empty, so ${value} becomes the root` : `Empty spot found: ${value} becomes the ${r.side} child of ${r.parent}`,
          apply: async (bb, o) => { settle(bb); await redraw(bb, o.animate); await bb.setColor(nid(value), "done", o); },
        }];
        return { facts: facts(t, { inserted: value, compared: path, parent: r.parent, side: r.side }), steps, summary: `Insert ${value}: compare with ${path.join(", ") || "nothing"}, then place it.` };
      },
    },
    search: {
      description: "Search for a key and show the path taken.",
      schema: z.object({ target: Value }),
      run(b, { target }): Result {
        const t = tree(b);
        settle(b);
        const r = t.search(target);
        const steps = walkSteps(r.path, target);
        if (!r.found) steps.push({ caption: `Reached an empty spot: ${target} is not in the tree`, apply: async (bb, o) => { await bb.setColor(nid(r.path[r.path.length - 1]), "warn", o); } });
        else steps.push({ caption: `Found ${target} after ${r.path.length} comparison${r.path.length === 1 ? "" : "s"}`, apply: async (bb, o) => { await bb.setColor(nid(target), "done", o); } });
        return { facts: facts(t, { target, found: r.found, comparisons: r.path.length, path: r.path }), steps, summary: `Search for ${target}: ${r.found ? "found" : "not found"} after ${r.path.length} comparisons.` };
      },
    },
    delete: {
      description: "Delete a key (leaf, one child, or two children: replaced by its in-order successor).",
      schema: z.object({ value: Value }),
      run(b, { value }): Result {
        const t = tree(b);
        settle(b);
        if (!t.has(value)) throw new VisualError(`${value} is not in the tree, so there is nothing to delete.`);
        const path = t.search(value).path;
        const r = t.delete(value);
        const explain = r.case === "leaf" ? `${value} is a leaf, so just remove it` : r.case === "one_child" ? `${value} has one child, which moves up into its place` : `${value} has two children: replace it with its in-order successor ${r.successor}`;
        const steps: Step[] = [...walkSteps(path, value)];
        for (const s of r.successorPath) steps.push({ caption: `Successor search: ${s}`, apply: async (bb, o) => { if (bb.has(nid(s))) await bb.setColor(nid(s), "accent", o); } });
        steps.push({ caption: explain, apply: async (bb, o) => { settle(bb); await redraw(bb, o.animate); } });
        return { facts: facts(t, { deleted: value, case: r.case, successor: r.successor }), steps, summary: `Delete ${value} (${r.case?.replace("_", " ")}).` };
      },
    },
    traverse: {
      description: "Visit every node in in-order, pre-order or post-order.",
      schema: z.object({ order: z.enum(["inorder", "preorder", "postorder"]).default("inorder") }),
      run(b, { order }): Result {
        const t = tree(b);
        settle(b);
        const seq = t.traverse(order as Order);
        const steps: Step[] = seq.map((v, k) => ({ caption: `${k + 1}: visit ${v}`, apply: async (bb, o) => { await bb.setColor(nid(v), "done", o); bb.setLabel(nid(v), `${v} (${k + 1})`); } }));
        return { facts: facts(t, { order, sequence: seq }), steps, summary: `${order}: ${seq.join(", ")}.` };
      },
    },
  },
});

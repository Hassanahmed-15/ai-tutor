/**
 * DATA STRUCTURES ON THE CANVAS — the tree, list, array, stack, queue or graph a DSA lesson is about,
 * drawn as itself and changed step by step while Aria walks the code (owner's direction, 2026-10-15:
 * "code on one side and the tree on the other, and with the code how the change occurs on the tree").
 *
 * The model never writes positions or whole snapshots. It writes the STARTING structure and, per
 * step, small operations ("link 3 → 1 as the left child", "remove 2"). This file applies them in
 * order — so every frame follows from the one before and cannot contradict it — checks each frame is
 * still a valid structure (a BST stays ordered, a tree has no cycles, nothing points at a missing
 * node), and lays every frame out. Pure, so it is unit-tested directly; a problem is returned as a
 * sentence the board's model is shown when it is asked to try again.
 */

import type { CanvasBoardSpec, DsEdge, DsEdgeMark, DsKind, DsMark, DsNode, DsOp, DsPointer, DsStart } from "./types";

export const DS_KINDS: DsKind[] = ["tree", "list", "array", "stack", "queue", "graph"];
export const DS_MAX_NODES = 12;
export const DS_MAX_STEPS = 16;
/** A pointer's name as the code writes it: "next_node" was cut to "next_nod" at 8 (2026-10-23). */
const POINTER_NAME_MAX = 12;
const DS_MARKS: DsMark[] = ["visit", "compare", "found", "remove", "done", "none"];
const VARIANTS = ["bst", "avl", "heap", "binary", "directed"] as const;

type Raw = Record<string, unknown>;
const obj = (v: unknown): Raw => (v && typeof v === "object" && !Array.isArray(v) ? (v as Raw) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const text = (v: unknown, max: number): string => (typeof v === "number" || typeof v === "boolean" ? String(v) : typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "").slice(0, max);
/** A node id as written: lowercase letters, digits and hyphens ("n3", "5", "head"). */
const nodeId = (v: unknown): string => text(v, 24).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
const side = (v: unknown): "left" | "right" | undefined => (v === "left" || v === "right" ? v : undefined);

/* ── parsing the model's JSON ─────────────────────────────────────────────────────────────── */

export function parseStructure(raw: unknown): DsStart | null {
  const r = obj(raw);
  const kind = text(r.kind, 8).toLowerCase() as DsKind;
  if (!DS_KINDS.includes(kind)) return null;
  const variantRaw = text(r.variant, 10).toLowerCase();
  const variant = (VARIANTS as readonly string[]).includes(variantRaw) ? (variantRaw as DsStart["variant"]) : undefined;
  const seen = new Set<string>();
  const nodes: DsNode[] = [];
  for (const n of arr(r.nodes)) {
    const o = typeof n === "string" || typeof n === "number" ? { id: n, value: n } : obj(n);
    const id = nodeId(o.id ?? o.value);
    const value = text(o.value ?? o.label ?? o.id, 6);
    if (!id || !value || seen.has(id)) continue;
    seen.add(id);
    nodes.push({ id, value });
  }
  if (nodes.length === 0 || nodes.length > DS_MAX_NODES) return null;
  const edges: DsEdge[] = arr(r.edges)
    .map((e) => obj(e))
    .map((e) => ({ from: nodeId(e.from), to: nodeId(e.to), side: side(e.side), label: text(e.label, 8) || undefined }))
    .filter((e) => seen.has(e.from) && seen.has(e.to) && e.from !== e.to)
    .map((e) => ({ from: e.from, to: e.to, ...(e.side ? { side: e.side } : {}), ...(e.label ? { label: e.label } : {}) }))
    .slice(0, 24);
  const pointers: DsPointer[] = arr(r.pointers)
    .map((p) => obj(p))
    .map((p) => ({ name: text(p.name, POINTER_NAME_MAX), to: p.to === null ? null : nodeId(p.to) }))
    .filter((p) => p.name && (p.to === null || seen.has(p.to)))
    .slice(0, 4);
  return { kind, ...(variant ? { variant } : {}), nodes, edges, ...(pointers.length ? { pointers } : {}) };
}

const OP_NAMES = ["add", "remove", "link", "unlink", "set", "swap", "point", "mark", "group", "edge"] as const;

/** A set number from what the model writes: 0/1, "A"/"B", "0"/"1" (also 1/2 as the first and second set). */
function setOf(v: unknown): 0 | 1 | null {
  const t = text(v, 6).toLowerCase();
  if (t === "0" || t === "a" || t === "set a" || t === "red" || t === "blue") return 0;
  if (t === "1" || t === "b" || t === "set b" || t === "orange" || t === "green") return 1;
  if (t === "2") return 1;
  return null;
}

/** One step's operations: {"op": "link", "from": "3", "to": "1", "side": "left"} (or {"link": {...}}). */
export function parseOps(raw: unknown): DsOp[] {
  const out: DsOp[] = [];
  for (const item of arr(raw).slice(0, 10)) {
    let o = obj(item);
    let name = text(o.op, 8).toLowerCase();
    if (!name) {
      const key = OP_NAMES.find((k) => k in o);
      if (!key) continue;
      name = key;
      o = typeof o[key] === "string" ? { id: o[key] } : obj(o[key]);
    }
    if (name === "add" || name === "insert" || name === "push" || name === "enqueue") {
      const id = nodeId(o.id ?? o.value);
      const value = text(o.value ?? o.id, 6);
      if (id && value) out.push({ op: "add", id, value, ...(o.parent ? { parent: nodeId(o.parent) } : {}), ...(side(o.side) ? { side: side(o.side) } : {}), ...(Number.isInteger(o.at) ? { at: o.at as number } : {}) });
    } else if (name === "remove" || name === "delete" || name === "pop" || name === "dequeue") {
      const id = nodeId(o.id);
      if (id) out.push({ op: "remove", id });
    } else if (name === "link" || name === "unlink") {
      const from = nodeId(o.from);
      const to = nodeId(o.to);
      if (!from || !to) continue;
      out.push(name === "link" ? { op: "link", from, to, ...(side(o.side) ? { side: side(o.side) } : {}), ...(text(o.label, 8) ? { label: text(o.label, 8) } : {}) } : { op: "unlink", from, to });
    } else if (name === "set") {
      const id = nodeId(o.id);
      const value = text(o.value, 6);
      if (id && value) out.push({ op: "set", id, value });
    } else if (name === "swap") {
      const pair = Array.isArray(o.ids) ? o.ids : [o.a, o.b];
      const a = nodeId(pair[0]);
      const b = nodeId(pair[1]);
      if (a && b && a !== b) out.push({ op: "swap", a, b });
    } else if (name === "point") {
      const pname = text(o.name, POINTER_NAME_MAX);
      if (pname) out.push({ op: "point", name: pname, to: o.to === null || o.to === undefined || o.to === "" ? null : nodeId(o.to) });
    } else if (name === "mark") {
      const id = nodeId(o.id);
      const as = text(o.as, 8).toLowerCase() as DsMark;
      if (id && DS_MARKS.includes(as)) out.push({ op: "mark", id, as });
    } else if (name === "group" || name === "color" || name === "colour") {
      const id = nodeId(o.id);
      const group = setOf(o.group ?? o.set ?? o.color ?? o.colour ?? o.value);
      if (id && group !== null) out.push({ op: "group", id, group });
    } else if (name === "edge") {
      const from = nodeId(o.from);
      const to = nodeId(o.to);
      const as = text(o.as, 9).toLowerCase();
      if (from && to && (as === "tree" || as === "conflict" || as === "none")) out.push({ op: "edge", from, to, as });
    }
  }
  return out;
}

/* ── running the operations ───────────────────────────────────────────────────────────────── */

export type DsFrame = {
  s: number;
  /** In order: for a list, array, stack or queue, the order IS the structure's order. */
  nodes: DsNode[];
  edges: DsEdge[];
  pointers: Array<{ name: string; to: string }>;
  marks: Record<string, DsMark>;
  /** Nodes whose value changed on this frame (they flash). */
  changed: string[];
  /** The set each two-coloured node is in (0 = Set A, 1 = Set B). */
  groups: Record<string, 0 | 1>;
  /** Marked edges by `edgeKey`: a BFS tree edge, or a conflict (both ends in one set). */
  edgeMarks: Record<string, DsEdgeMark>;
  /** Pointers that hold null right now (prev = None): drawn as a tag pointing at "null". */
  nulls: string[];
};

/** An edge's key for its mark: direction kept only in a directed graph or a list. */
export function edgeKey(kind: DsKind, variant: DsStart["variant"] | undefined, from: string, to: string): string {
  const directed = kind === "list" || variant === "directed";
  return directed || from < to ? `${from}>${to}` : `${to}>${from}`;
}

const isTree = (kind: DsKind) => kind === "tree";
const ordered = (variant?: DsStart["variant"]) => variant === "bst" || variant === "avl";
const numeric = (values: string[]) => values.every((v) => /^-?\d+(\.\d+)?$/.test(v));
const less = (a: string, b: string, nums: boolean) => (nums ? Number(a) < Number(b) : a < b);

/** The children of a binary-tree node, by side. */
function childOn(edges: DsEdge[], parent: string, s: "left" | "right"): string | undefined {
  return edges.find((e) => e.from === parent && e.side === s)?.to;
}

function roots(frame: Pick<DsFrame, "nodes" | "edges">): string[] {
  const hasParent = new Set(frame.edges.map((e) => e.to));
  return frame.nodes.map((n) => n.id).filter((id) => !hasParent.has(id));
}

function inOrder(frame: Pick<DsFrame, "nodes" | "edges">, root: string): string[] {
  const out: string[] = [];
  const walk = (id: string | undefined, depth: number) => {
    if (!id || depth > DS_MAX_NODES) return;
    walk(childOn(frame.edges, id, "left"), depth + 1);
    out.push(id);
    walk(childOn(frame.edges, id, "right"), depth + 1);
  };
  walk(root, 0);
  return out;
}

function height(frame: Pick<DsFrame, "edges">, id: string | undefined, depth = 0): number {
  if (!id || depth > DS_MAX_NODES) return 0;
  return 1 + Math.max(height(frame, childOn(frame.edges, id, "left"), depth + 1), height(frame, childOn(frame.edges, id, "right"), depth + 1));
}

/** Why this frame is not a valid structure, or null. `final`: the operation has finished. */
export function structureProblem(start: Pick<DsStart, "kind" | "variant">, frame: Pick<DsFrame, "nodes" | "edges" | "pointers">, final: boolean): string | null {
  const ids = new Set(frame.nodes.map((n) => n.id));
  for (const e of frame.edges) if (!ids.has(e.from) || !ids.has(e.to)) return `an edge ${e.from} → ${e.to} points at a node that is not there`;
  for (const p of frame.pointers) if (!ids.has(p.to)) return `pointer "${p.name}" points at "${p.to}", which is not there`;
  if (!isTree(start.kind)) return null;
  const value = new Map(frame.nodes.map((n) => [n.id, n.value]));
  for (const id of ids) if (frame.edges.filter((e) => e.to === id).length > 1) return `node ${value.get(id)} has two parents`;
  // Every node is reachable from a root exactly once — anything else is a cycle.
  const reached = new Set<string>();
  const visit = (id: string): boolean => {
    if (reached.has(id)) return false;
    reached.add(id);
    return frame.edges.filter((e) => e.from === id).every((e) => visit(e.to));
  };
  if (!roots(frame).every(visit) || reached.size !== ids.size) return "the tree has a cycle";
  const nums = numeric(frame.nodes.map((n) => n.value));
  if (ordered(start.variant)) {
    for (const root of roots(frame)) {
      const seq = inOrder(frame, root).map((id) => value.get(id)!);
      for (let i = 1; i < seq.length; i++) {
        // Equal is allowed: deleting a node with two children copies its successor up before the
        // successor itself is removed.
        if (less(seq[i], seq[i - 1], nums)) return `the binary search tree is out of order (${seq[i]} sits after ${seq[i - 1]} in order)`;
      }
    }
  }
  if (final && start.variant === "avl") {
    for (const id of ids) {
      const diff = height(frame, childOn(frame.edges, id, "left")) - height(frame, childOn(frame.edges, id, "right"));
      if (Math.abs(diff) > 1) return `the AVL tree is unbalanced at ${value.get(id)} when the operation ends`;
    }
  }
  if (final && start.variant === "heap" && nums && frame.edges.length) {
    const up = frame.edges.every((e) => Number(value.get(e.from)) <= Number(value.get(e.to)));
    const down = frame.edges.every((e) => Number(value.get(e.from)) >= Number(value.get(e.to)));
    if (!up && !down) return "the heap is out of order when the operation ends (a parent must be ≤ its children in a min-heap, ≥ in a max-heap)";
  }
  return null;
}

/**
 * The structure after each step: frame 0 is the start, then one frame per step with its operations
 * applied. Stops at the first operation that cannot be done or leaves an invalid structure, and says
 * which step and why.
 */
export function runStructure(start: DsStart, steps: Array<{ s: number; ops?: DsOp[] }>): { frames: DsFrame[]; problem: string | null } {
  const first: DsFrame = {
    s: Math.min(0, steps[0]?.s ?? 0),
    nodes: start.nodes.map((n) => ({ ...n })),
    edges: start.edges.map((e) => ({ ...e })),
    pointers: (start.pointers ?? []).filter((p): p is { name: string; to: string } => p.to !== null),
    marks: {},
    changed: [],
    groups: {},
    edgeMarks: {},
    // A "null" tag belongs to a linked list (prev = None): on a graph or tree it read "set → null" for nothing (2026-10-25).
    nulls: start.kind === "list" ? (start.pointers ?? []).filter((p) => p.to === null).map((p) => p.name) : [],
  };
  if (isTree(start.kind)) first.edges = withSides(start, first);
  const frames: DsFrame[] = [first];
  const startProblem = structureProblem(start, first, false);
  if (startProblem) return { frames, problem: `the starting structure is wrong: ${startProblem}` };

  for (let i = 0; i < steps.length; i++) {
    const prev = frames[frames.length - 1];
    const f: DsFrame = {
      s: steps[i].s,
      nodes: prev.nodes.map((n) => ({ ...n })),
      edges: prev.edges.map((e) => ({ ...e })),
      pointers: prev.pointers.map((p) => ({ ...p })),
      // A comparison lasts one step; what has been visited, found or finished stays marked.
      marks: Object.fromEntries(Object.entries(prev.marks).filter(([, m]) => m !== "compare")),
      changed: [],
      // A node's set, a marked edge and a null pointer stay until a later step changes them.
      groups: { ...prev.groups },
      edgeMarks: { ...prev.edgeMarks },
      nulls: [...prev.nulls],
    };
    const where = `step ${i + 1} (sentence ${steps[i].s})`;
    for (const op of steps[i].ops ?? []) {
      const problem = applyOp(start, f, op);
      if (problem) return { frames, problem: `${where}: ${problem}` };
    }
    if (f.nodes.length > DS_MAX_NODES) return { frames, problem: `${where}: more than ${DS_MAX_NODES} nodes` };
    const problem = structureProblem(start, f, i === steps.length - 1);
    if (problem) return { frames, problem: `${where}: ${problem}` };
    frames.push(f);
  }
  return { frames, problem: null };
}

/** A binary tree's edges with every side known: from the edge, else by value in a BST, else the free side. */
function withSides(start: DsStart, frame: DsFrame): DsEdge[] {
  const out: DsEdge[] = [];
  const nums = numeric(frame.nodes.map((n) => n.value));
  const value = new Map(frame.nodes.map((n) => [n.id, n.value]));
  for (const e of frame.edges) {
    const taken = (s: "left" | "right") => out.some((x) => x.from === e.from && x.side === s);
    let s = e.side;
    if (!s && ordered(start.variant)) s = less(value.get(e.to)!, value.get(e.from)!, nums) ? "left" : "right";
    if (!s || taken(s)) s = !taken("left") ? "left" : "right";
    out.push({ ...e, side: s });
  }
  return out;
}

function applyOp(start: DsStart, f: DsFrame, op: DsOp): string | null {
  const has = (id: string) => f.nodes.some((n) => n.id === id);
  const valueOf = (id: string) => f.nodes.find((n) => n.id === id)?.value ?? id;
  const missing = (id: string) => `"${id}" is not on the board`;
  const tree = isTree(start.kind);
  const nums = () => numeric(f.nodes.map((n) => n.value));
  const pickSide = (parent: string, child: string, given?: "left" | "right"): "left" | "right" | null => {
    if (given) return given;
    if (ordered(start.variant)) return less(valueOf(child), valueOf(parent), nums()) ? "left" : "right";
    if (!childOn(f.edges, parent, "left")) return "left";
    if (!childOn(f.edges, parent, "right")) return "right";
    return null;
  };
  const treeLink = (from: string, to: string, s: "left" | "right", label?: string): string | null => {
    const parentOf = (id: string) => f.edges.find((e) => e.to === id);
    // A ROTATION: the child becomes its parent's parent ("20 takes 30's place"). It moves up into
    // the parent's place under the grandparent (or becomes the root), and the parent hangs below it.
    const above = parentOf(from);
    if (above && above.from === to) {
      const grand = parentOf(to);
      f.edges = f.edges.filter((e) => e !== above && e !== grand);
      if (grand) f.edges.push({ from: grand.from, to: from, side: grand.side });
    }
    // Any other descendant of `to` cannot become its parent: that would be a cycle.
    for (let up: string | undefined = from, n = 0; up && n <= DS_MAX_NODES; up = f.edges.find((e) => e.to === up)?.from, n++) {
      if (up === to) return `linking ${valueOf(from)} → ${valueOf(to)} would make a cycle`;
    }
    f.edges = f.edges.filter((e) => !(e.from === from && e.side === s) && e.to !== to);
    f.edges.push({ from, to, side: s, ...(label ? { label } : {}) });
    return null;
  };
  switch (op.op) {
    case "add": {
      if (has(op.id)) return `"${op.id}" is already on the board`;
      const node = { id: op.id, value: op.value };
      if (op.at !== undefined && op.at >= 0 && op.at < f.nodes.length) f.nodes.splice(op.at, 0, node);
      else f.nodes.push(node);
      if (op.parent) {
        if (!has(op.parent)) return missing(op.parent);
        if (tree) {
          const s = pickSide(op.parent, op.id, op.side);
          if (!s) return `${valueOf(op.parent)} already has two children`;
          if (childOn(f.edges, op.parent, s)) return `${valueOf(op.parent)} already has a ${s} child`;
          return treeLink(op.parent, op.id, s);
        }
        if (start.kind === "list" || start.kind === "graph") f.edges.push({ from: op.parent, to: op.id });
      }
      return null;
    }
    case "remove": {
      if (!has(op.id)) return missing(op.id);
      f.nodes = f.nodes.filter((n) => n.id !== op.id);
      f.edges = f.edges.filter((e) => e.from !== op.id && e.to !== op.id);
      f.pointers = f.pointers.filter((p) => p.to !== op.id);
      delete f.marks[op.id];
      delete f.groups[op.id];
      for (const key of Object.keys(f.edgeMarks)) if (key.split(">").includes(op.id)) delete f.edgeMarks[key];
      return null;
    }
    case "link": {
      if (!has(op.from)) return missing(op.from);
      if (!has(op.to)) return missing(op.to);
      if (op.from === op.to) return "a node cannot link to itself";
      if (tree) {
        const s = pickSide(op.from, op.to, op.side);
        if (!s) return `${valueOf(op.from)} already has two children`;
        return treeLink(op.from, op.to, s, op.label);
      }
      if (start.kind === "list") {
        f.edges = f.edges.filter((e) => e.from !== op.from);
        f.edges.push({ from: op.from, to: op.to });
        return null;
      }
      if (start.kind === "graph") {
        // A second message the same way with a new name is its own arrow (it is drawn on its own bend).
        if (!f.edges.some((e) => e.from === op.from && e.to === op.to && (e.label ?? "") === (op.label ?? ""))) f.edges.push({ from: op.from, to: op.to, ...(op.label ? { label: op.label } : {}) });
        return null;
      }
      return `a ${start.kind} has no links between its cells`;
    }
    case "unlink": {
      // A tree's link has one direction, so naming it backwards ("child → parent") still means it;
      // unlinking what is not linked changes nothing (the frame checks still guard the result).
      const either = tree || (start.kind === "graph" && start.variant !== "directed");
      f.edges = f.edges.filter((e) => !(e.from === op.from && e.to === op.to) && !(either && e.from === op.to && e.to === op.from));
      return null;
    }
    case "set": {
      if (!has(op.id)) return missing(op.id);
      f.nodes = f.nodes.map((n) => (n.id === op.id ? { ...n, value: op.value } : n));
      f.changed.push(op.id);
      return null;
    }
    case "swap": {
      if (!has(op.a)) return missing(op.a);
      if (!has(op.b)) return missing(op.b);
      const ia = f.nodes.findIndex((n) => n.id === op.a);
      const ib = f.nodes.findIndex((n) => n.id === op.b);
      if (tree || start.kind === "graph") {
        // In a tree (a heap's sift) the values trade places; the nodes stay where they are.
        const va = f.nodes[ia].value;
        f.nodes[ia] = { ...f.nodes[ia], value: f.nodes[ib].value };
        f.nodes[ib] = { ...f.nodes[ib], value: va };
        f.changed.push(op.a, op.b);
      } else {
        // In an array the cells themselves trade places, and glide there.
        [f.nodes[ia], f.nodes[ib]] = [f.nodes[ib], f.nodes[ia]];
      }
      return null;
    }
    case "point": {
      f.pointers = f.pointers.filter((p) => p.name !== op.name);
      f.nulls = f.nulls.filter((n) => n !== op.name);
      // A pointer set to null is DRAWN, pointing at "null": list reversal starts with prev = None and
      // ends with curr = None, and both vanished from the board (owner, 2026-10-23).
      if (op.to === null) {
        if (start.kind === "list") f.nulls.push(op.name);
        return null;
      }
      if (!has(op.to)) return missing(op.to);
      f.pointers.push({ name: op.name, to: op.to });
      return null;
    }
    case "mark": {
      if (!has(op.id)) return missing(op.id);
      if (op.as === "none") delete f.marks[op.id];
      else f.marks[op.id] = op.as;
      return null;
    }
    case "group": {
      if (!has(op.id)) return missing(op.id);
      f.groups[op.id] = op.group;
      return null;
    }
    case "edge": {
      if (!has(op.from)) return missing(op.from);
      if (!has(op.to)) return missing(op.to);
      const undirected = !(start.kind === "list" || start.variant === "directed");
      const joined = f.edges.some((e) => (e.from === op.from && e.to === op.to) || (undirected && e.from === op.to && e.to === op.from));
      if (!joined) return `there is no edge ${valueOf(op.from)} – ${valueOf(op.to)} to mark`;
      const key = edgeKey(start.kind, start.variant, op.from, op.to);
      if (op.as === "none") delete f.edgeMarks[key];
      else f.edgeMarks[key] = op.as;
      return null;
    }
  }
}

/* ── layout ───────────────────────────────────────────────────────────────────────────────── */

export type DsBox = { x: number; y: number; w: number; h: number };
export type DsPt = { x: number; y: number };

export type DsLayout = {
  /** Trees and graphs are circles; lists are boxes with a pointer; arrays, stacks and queues are cells. */
  shape: "circle" | "box" | "cell";
  /** Circle radius, or the cell/box size. */
  r: number;
  w: number;
  h: number;
  size: number;
  frames: Array<{
    s: number;
    place: Record<string, DsPt>;
    /** A pointer's name tag and the node it points at. */
    pointers: Array<{ name: string; to: string; at: DsPt; tip: DsPt; arrow: boolean }>;
    /** Array indices under the cells. */
    indices: Array<{ text: string; at: DsPt }>;
    /**
     * Pointers holding null: on a list, tags under the null slot (`tip` is where their arrow ends);
     * elsewhere, tags in the corner reading "name → null".
     */
    nulls?: Array<{ name: string; at: DsPt; tip?: DsPt; arrow?: boolean }>;
  }>;
  /** A list's "null" slot, left of its first node, when any of its pointers holds None. */
  nullMark?: DsPt;
};

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/**
 * Where every node of every frame sits inside `area`. Spacing is decided once for the whole board
 * (from the largest frame), so the structure never rescales between steps — nodes only glide.
 */
export function layoutStructure(start: Pick<DsStart, "kind">, frames: DsFrame[], area: DsBox): DsLayout {
  const longest = Math.max(1, ...frames.flatMap((f) => f.nodes.map((n) => n.value.length)));
  const layout = placeStructure(start.kind, frames, area, longest);
  // The value fits where it is written: a list node's value part, a cell, a circle — so "1000" never
  // runs into the box beside it. Digits in the bold board font are about 0.62 em wide.
  const room = layout.shape === "box" ? layout.w * 0.62 - 8 : layout.shape === "cell" ? layout.w - 8 : layout.r * 2 - 6;
  return { ...placeNulls(layout, frames, area), size: clamp(Math.min(layout.size, room / (longest * 0.62)), 11, 22) };
}

/**
 * Where the pointers holding null are drawn: on a row (a list), in the free space right of its last
 * box — "→ null", as textbooks draw it — or left of the first when the right has no room; on a tree or
 * a graph, in the area's top-right corner. Several stack downwards.
 */
function placeNulls(layout: DsLayout, frames: DsFrame[], area: DsBox): DsLayout {
  // A list placed its null slot itself (placeStructure). Anything else: tags in the top-right corner.
  if (layout.nullMark) return layout;
  return {
    ...layout,
    frames: layout.frames.map((lf, i) => {
      const names = frames[i]?.nulls ?? [];
      if (!names.length) return { ...lf, nulls: [] };
      return { ...lf, nulls: names.map((name, k) => ({ name, at: { x: area.x + area.w - 70, y: area.y + 14 + k * 30 } })) };
    }),
  };
}

function placeStructure(kind: DsKind, frames: DsFrame[], area: DsBox, longest: number): DsLayout {
  const most = Math.max(1, ...frames.map((f) => f.nodes.length));
  if (kind === "tree") return layoutTree(frames, area);
  if (kind === "graph") return layoutGraph(frames, area, most);
  if (kind === "stack") {
    const h = clamp((area.h - 70) / most, 34, 50);
    const w = clamp(area.w * 0.36, 110, 170);
    const x = area.x + area.w / 2;
    const bottom = area.y + area.h - 24 - h / 2;
    return {
      shape: "cell", r: h / 2, w, h, size: clamp(h * 0.46, 15, 22),
      frames: frames.map((f) => {
        const place = Object.fromEntries(f.nodes.map((n, i) => [n.id, { x, y: bottom - i * h }]));
        return { s: f.s, place, pointers: f.pointers.map((p, k) => ({ name: p.name, to: p.to, at: { x: x + w / 2 + 58, y: place[p.to].y - k * 4 }, tip: { x: x + w / 2 + 6, y: place[p.to].y }, arrow: true })), indices: [] };
      }),
    };
  }
  // A row: list boxes with room for their next-arrows; array and queue cells side by side.
  const list = kind === "list";
  // A list whose pointers ever hold None keeps a slot left of its first node for "null" — drawn as
  // textbooks do (null ← A ← B), with those pointers' tags under it like any other pointer.
  const nullSlot = list && frames.some((f) => f.nulls.length > 0) ? 1 : 0;
  const slots = most + nullSlot;
  const gap = list ? clamp(area.w / slots * 0.34, 26, 46) : 0;
  // Long values ("1000") get a wider list box, so they stay readable rather than tiny.
  const w = clamp((area.w - 20 - gap * (slots - 1)) / slots, 40, list ? (longest >= 4 ? 96 : 84) : 72);
  const h = clamp(w * 0.72, 36, 52);
  const rowW = slots * w + gap * (slots - 1);
  const x0 = area.x + (area.w - rowW) / 2 + w / 2 + nullSlot * (w + gap);
  const y = area.y + area.h * 0.42;
  const nullAt = { x: x0 - (w + gap), y };
  return {
    shape: list ? "box" : "cell", r: h / 2, w, h, size: clamp(h * 0.44, 15, 22),
    ...(nullSlot ? { nullMark: nullAt } : {}),
    frames: frames.map((f) => {
      const place = Object.fromEntries(f.nodes.map((n, i) => [n.id, { x: x0 + i * (w + gap), y }]));
      const below = y + h / 2 + (list ? 18 : 40);
      const stacked: Record<string, number> = {};
      const pointers = f.pointers.map((p) => {
        const k = (stacked[p.to] = (stacked[p.to] ?? -1) + 1);
        return { name: p.name, to: p.to, at: { x: place[p.to].x, y: below + 30 + k * 24 }, tip: { x: place[p.to].x, y: y + h / 2 + (list ? 4 : 26) }, arrow: k === 0 };
      });
      const indices = list ? [] : f.nodes.map((n, i) => ({ text: String(i), at: { x: x0 + i * w, y: y + h / 2 + 20 } }));
      const nulls = nullSlot ? f.nulls.map((name, k) => ({ name, at: { x: nullAt.x, y: below + 30 + k * 24 }, tip: { x: nullAt.x, y: y + 12 }, arrow: k === 0 })) : undefined;
      return { s: f.s, place, pointers, indices, ...(nulls ? { nulls } : {}) };
    }),
  };
}

function layoutTree(frames: DsFrame[], area: DsBox): DsLayout {
  // Slots: in-order position across the forest (a detached subtree sits beside the tree, one slot apart).
  const slotted = frames.map((f) => {
    const slot: Record<string, number> = {};
    const depth: Record<string, number> = {};
    let next = 0;
    roots(f).forEach((root, k) => {
      if (k > 0) next += 1;
      const walk = (id: string | undefined, d: number) => {
        if (!id || d > DS_MAX_NODES || id in slot) return;
        walk(childOn(f.edges, id, "left"), d + 1);
        slot[id] = next++;
        depth[id] = d;
        walk(childOn(f.edges, id, "right"), d + 1);
      };
      walk(root, 0);
    });
    return { slot, depth, slots: Math.max(1, next) };
  });
  const slots = Math.max(...slotted.map((t) => t.slots));
  const depths = Math.max(1, ...slotted.flatMap((t) => Object.values(t.depth).map((d) => d + 1)));
  const dx = Math.min(104, area.w / slots);
  const top = 40;
  const dy = Math.min(96, (area.h - top - 30) / Math.max(1, depths - 1 || 1));
  const r = clamp(Math.min(dx * 0.36, dy * 0.32), 15, 27);
  return {
    shape: "circle", r, w: r * 2, h: r * 2, size: clamp(r * 0.8, 13, 20),
    frames: frames.map((f, i) => {
      const t = slotted[i];
      const x0 = area.x + (area.w - t.slots * dx) / 2 + dx / 2;
      const place = Object.fromEntries(Object.keys(t.slot).map((id) => [id, { x: x0 + t.slot[id] * dx, y: area.y + top + t.depth[id] * dy }]));
      return { s: f.s, place, pointers: tagPointers(f, place, r), indices: [] };
    }),
  };
}

/** Graph nodes stay put for the whole board: columns by distance from the first node. */
function layoutGraph(frames: DsFrame[], area: DsBox, most: number): DsLayout {
  const all: string[] = [];
  for (const f of frames) for (const n of f.nodes) if (!all.includes(n.id)) all.push(n.id);
  const edges = frames.flatMap((f) => f.edges);
  const level: Record<string, number> = {};
  const queue = all.length ? [all[0]] : [];
  if (all.length) level[all[0]] = 0;
  while (queue.length) {
    const id = queue.shift()!;
    for (const e of edges) {
      const other = e.from === id ? e.to : e.to === id ? e.from : null;
      if (other && !(other in level)) {
        level[other] = level[id] + 1;
        queue.push(other);
      }
    }
  }
  const deepest = Math.max(0, ...Object.values(level));
  for (const id of all) if (!(id in level)) level[id] = deepest + 1;
  const columns = Math.max(...Object.values(level)) + 1;
  const byCol = Array.from({ length: columns }, (_, c) => all.filter((id) => level[id] === c));
  const tallest = Math.max(1, ...byCol.map((c) => c.length));
  const dx = area.w / columns;
  const dy = (area.h - 40) / tallest;
  const r = clamp(Math.min(dx * 0.22, dy * 0.3, 160 / Math.sqrt(most)), 16, 28);
  const fixed: Record<string, DsPt> = {};
  byCol.forEach((col, c) => col.forEach((id, k) => {
    // Alternate columns sit half a row lower, so edges between neighbours never run flat through a node.
    fixed[id] = { x: area.x + dx * (c + 0.5), y: area.y + 20 + (area.h - 40) * ((k + 0.5) / col.length) + (c % 2 && col.length > 1 ? dy * 0.18 : 0) };
  }));
  return {
    shape: "circle", r, w: r * 2, h: r * 2, size: clamp(r * 0.8, 13, 20),
    frames: frames.map((f) => {
      const place = Object.fromEntries(f.nodes.map((n) => [n.id, fixed[n.id]]));
      return { s: f.s, place, pointers: tagPointers(f, place, r), indices: [] };
    }),
  };
}

/** A pointer tag's width as the board draws it (CanvasPanel: 8.6 px a character and its padding). */
const pointerTagWidth = (name: string) => Math.max(30, name.length * 8.6 + 14);

/**
 * Pointer tags above circle nodes; several on one node sit side by side, spaced by their own widths —
 * a fixed 52 px printed "leader", "follower" and "candidate" over each other (CS test, 2026-10-23).
 */
function tagPointers(f: DsFrame, place: Record<string, DsPt>, r: number): DsLayout["frames"][number]["pointers"] {
  const onNode: Record<string, string[]> = {};
  for (const p of f.pointers) (onNode[p.to] ??= []).push(p.name);
  const gap = 6;
  return f.pointers.filter((p) => place[p.to]).map((p) => {
    const names = onNode[p.to];
    const k = names.indexOf(p.name);
    const widths = names.map(pointerTagWidth);
    const total = widths.reduce((a, b) => a + b, 0) + gap * (names.length - 1);
    const offset = -total / 2 + widths.slice(0, k).reduce((a, b) => a + b + gap, 0) + widths[k] / 2;
    const at = place[p.to];
    return { name: p.name, to: p.to, at: { x: at.x + offset, y: at.y - r - 26 }, tip: { x: at.x + offset * 0.4, y: at.y - r - 4 }, arrow: true };
  });
}

/**
 * The line of an edge between two placed nodes, as a quadratic curve (p0 → c → p1): straight between
 * circles; for a list, between the facing sides of neighbouring boxes, or arched over the row when
 * the link skips a box or runs backwards past one.
 */
/**
 * How far each edge bends off the straight line, signed in one direction per pair of nodes: an edge
 * alone between its two nodes is straight; A→B and B→A (and a repeated A→B) bend apart, so their
 * arrows and labels never lie on each other (TCP lecture, 2026-10-24: SYN, SYN-ACK and ACK on one line).
 */
export function edgeBends(edges: Array<{ from: string; to: string }>, gap = 36): number[] {
  const pair = (e: { from: string; to: string }) => (e.from < e.to ? `${e.from}|${e.to}` : `${e.to}|${e.from}`);
  const count = new Map<string, number>();
  for (const e of edges) count.set(pair(e), (count.get(pair(e)) ?? 0) + 1);
  const seen = new Map<string, number>();
  return edges.map((e) => {
    const n = count.get(pair(e)) ?? 1;
    const i = seen.get(pair(e)) ?? 0;
    seen.set(pair(e), i + 1);
    return n === 1 ? 0 : (i - (n - 1) / 2) * gap;
  });
}

/**
 * How far an edge's control point must move so its line clears every other node it would run through,
 * signed along the normal of lo → hi (0 when nothing is in the way). A triangle B–C–D laid out in one
 * column drew B–D straight through C, so the odd cycle Aria named was invisible (bipartite lecture,
 * 2026-10-25). The curve bends away from the node in the way.
 */
export function edgeDetour(lo: DsPt, hi: DsPt, others: DsPt[], r: number): number {
  const dx = hi.x - lo.x, dy = hi.y - lo.y;
  const L2 = dx * dx + dy * dy || 1;
  const L = Math.sqrt(L2);
  const nx = -dy / L, ny = dx / L;
  let off = 0;
  for (const o of others) {
    const t = ((o.x - lo.x) * dx + (o.y - lo.y) * dy) / L2;
    if (t <= 0.06 || t >= 0.94) continue;
    const d = (o.x - lo.x) * nx + (o.y - lo.y) * ny;
    if (Math.abs(d) >= r * 1.4) continue;
    // A quadratic's curve sits 2t(1-t) of the control's offset from the line at t: enough to clear the node.
    const need = ((Math.abs(d) + r * 1.7) / (2 * t * (1 - t))) * (d > 0.5 ? -1 : 1);
    if (Math.abs(need) > Math.abs(off)) off = need;
  }
  return off;
}

export function edgeCurve(layout: Pick<DsLayout, "shape" | "r" | "w" | "h">, from: DsPt, to: DsPt): { p0: DsPt; c: DsPt; p1: DsPt } {
  if (layout.shape === "circle") {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const d = Math.hypot(dx, dy) || 1;
    const p0 = { x: from.x + (dx / d) * (layout.r + 3), y: from.y + (dy / d) * (layout.r + 3) };
    const p1 = { x: to.x - (dx / d) * (layout.r + 5), y: to.y - (dy / d) * (layout.r + 5) };
    return { p0, c: { x: (p0.x + p1.x) / 2, y: (p0.y + p1.y) / 2 }, p1 };
  }
  const half = layout.w / 2;
  const halfH = layout.h / 2;
  const step = Math.abs(to.x - from.x);
  // A list node's link leaves from its "next" box (the right part of the node), as textbooks draw it.
  const next = layout.shape === "box" ? from.x + layout.w * 0.34 : from.x;
  const neighbours = Math.abs(to.y - from.y) < 2 && step < layout.w * 2.2;
  if (neighbours && to.x > from.x) {
    // Forward to the next box: straight across the gap, into its left side.
    const p0 = { x: next, y: from.y };
    const p1 = { x: to.x - half - 4, y: to.y };
    return { p0, c: { x: (p0.x + p1.x) / 2, y: p0.y }, p1 };
  }
  // Back to the box before it (a reversed link), or skipping boxes: arched over the row, into the
  // top of the target — the space under the row is the pointer tags'.
  const p0 = { x: next, y: from.y - halfH - 2 };
  const p1 = { x: to.x, y: to.y - halfH - 5 };
  return { p0, c: { x: (p0.x + p1.x) / 2, y: Math.min(p0.y, p1.y) - 26 - step * 0.12 }, p1 };
}

/* ── in words ─────────────────────────────────────────────────────────────────────────────── */

const KIND_NAME: Record<DsKind, string> = { tree: "tree", list: "linked list", array: "array", stack: "stack (bottom to top)", queue: "queue (front to rear)", graph: "graph" };

function shapeInWords(kind: DsKind, f: DsFrame): string {
  const value = new Map(f.nodes.map((n) => [n.id, n.value]));
  if (kind === "array" || kind === "stack" || kind === "queue") return `[${f.nodes.map((n) => n.value).join(", ")}]`;
  if (kind === "tree") {
    const parts = f.nodes.map((n) => {
      const kids = (["left", "right"] as const).map((s) => (childOn(f.edges, n.id, s) ? `${s} ${value.get(childOn(f.edges, n.id, s)!)}` : "")).filter(Boolean);
      return kids.length ? `${n.value} (${kids.join(", ")})` : "";
    }).filter(Boolean);
    return parts.length ? parts.join("; ") : f.nodes.map((n) => n.value).join(", ");
  }
  return f.edges.length ? f.edges.map((e) => `${value.get(e.from)} → ${value.get(e.to)}`).join(", ") : f.nodes.map((n) => n.value).join(", ");
}

/** The structure in words, for Aria's live context: what it starts as and what it ends as. */
export function describeStructure(start: DsStart, steps: Array<{ s: number; ops?: DsOp[] }>): string {
  const { frames } = runStructure(start, steps);
  const name = start.variant === "bst" ? "binary search tree" : start.variant === "avl" ? "AVL tree" : start.variant === "heap" ? "heap" : KIND_NAME[start.kind];
  const first = shapeInWords(start.kind, frames[0]);
  const last = frames.length > 1 ? shapeInWords(start.kind, frames[frames.length - 1]) : first;
  return `Data structure — a ${name}, drawn as nodes and links: ${first}${last !== first ? `; after the steps: ${last}` : ""}.`;
}

/**
 * GRAPH ALGORITHMS THE LIST ABOVE MISSES — for typed-prompt lessons only (the document, video and course
 * paths keep isDataStructureTopic as it is). "BFT in Bipartite Graphs" matched nothing, so its boards
 * were written as code with the colours as a dictionary and no graph drawn (owner, 2026-10-23).
 */
export function isGraphAlgorithmTopic(text: string | null | undefined): boolean {
  return /\b(?:bipartite|bft|breadth[- ]first traversal|graph colou?ring|two[- ]colou?r(?:ing|able)?|shortest paths?|minimum spanning trees?|mst|cycle detection|detect(?:ing)? (?:a )?cycles?|adjacency (?:lists?|matri(?:x|ces))|bellman[- ]ford|floyd[- ]warshall|connected components?|strongly connected|spanning trees?|graph search|a\*(?: search)?|flood fill)\b/i.test(text ?? "");
}

/**
 * WHAT A DSA BOARD SAYS MUST BE WHAT IT DRAWS (typed-prompt lessons; owner, 2026-10-23).
 *   - Aria says which colour or set a vertex gets, and the graph never shows it: every two-colouring
 *     sentence needs a "group" op (a bipartite lecture showed four grey nodes while saying "A gets
 *     color 1, B and C get color 2").
 *   - Aria flips a link of a list ("curr.next = prev"), and no step links or unlinks anything: the
 *     reversal happened only in words.
 * Returns the problem to send back to the writer, or null.
 */
export function dsaTeachingProblem(start: DsStart, steps: Array<{ s: number; ops?: DsOp[] }>, sentences: string[]): string | null {
  const ops = steps.flatMap((st) => st.ops ?? []);
  const colourTalk = /\b(?:colou?r(?:s|ed|ing)?\s*(?:[01]|zero|one|red|blue|white|black)|colou?r [AB]\b|set [AB]\b|two (?:colou?rs|sets|groups|sides)|opposite colou?r|same colou?r|alternat\w* colou?rs?|group [AB]\b|side [AB]\b|partition)/i;
  if ((start.kind === "graph" || start.kind === "tree") && sentences.some((s) => colourTalk.test(s)) && !ops.some((o) => o.op === "group")) {
    return 'Aria says which colour or set the vertices get, but the graph never shows it. Put each vertex in its set with {"op": "group", "id", "group": 0 or 1} on the sentence that colours it (the board draws Set A blue and Set B orange, with a legend), and mark a same-set edge with {"op": "edge", "from", "to", "as": "conflict"} when one is found.';
  }
  const linkTalk = /\.next\s*=|\bnext\s*(?:pointer|link)s?\b.*\b(?:back|reverse|previous|prev)\b|\brevers\w*\b.*\b(?:link|pointer|next)\b|\b(?:link|pointer)\w*\b.*\brevers\w*|\bpoint\w* (?:it )?back\b|\bflip\w*\b/i;
  if (start.kind === "list" && sentences.some((s) => linkTalk.test(s)) && !ops.some((o) => o.op === "link" || o.op === "unlink")) {
    return 'Aria changes a node\'s next link, but the list on the board never changes. On the sentence that runs that line, give the step {"op": "link", "from", "to"} (it replaces the node\'s old next link), so the student watches the arrow turn; a pointer set to None is {"op": "point", "name", "to": null}.';
  }
  return null;
}

/**
 * A data-structures or algorithms topic: its boards show the structure itself (a "structure" board,
 * or a "code" board with the structure beside it). A bare "graph" is left out on purpose — graphs of
 * functions are maths; graph ALGORITHMS are named by BFS, DFS, Dijkstra and the like.
 */
export function isDataStructureTopic(text: string | null | undefined): boolean {
  return /\b(?:binary (?:search )?trees?|bsts?|avl(?: trees?)?|red[- ]black trees?|b[- ]trees?|heaps?|heap ?sort|priority queues?|tries|trie|linked lists?|doubly linked|singly linked|stacks?|queues?|deques?|arrays?|hash (?:tables?|maps?)|graph (?:traversal|algorithms?|data structures?)|bfs|dfs|breadth[- ]first|depth[- ]first|dijkstra|kruskal|prim'?s algorithm|topological sort|union[- ]find|disjoint sets?|(?:in|pre|post|level)[- ]?order traversal|tree traversals?|binary search|bubble sort|insertion sort|selection sort|merge sort|quick ?sort|counting sort|radix sort|sorting algorithms?|data structures?|dsa)\b/i.test(text ?? "");
}

/**
 * Why a board's structure cannot be shown, or null: missing where the board runs an operation on a
 * data structure (`required`), or an operation that goes wrong. Said to the board's model on a retry.
 */
export function boardStructureProblem(spec: CanvasBoardSpec, required: boolean): string | null {
  const st = spec.stage;
  const ds = st.kind === "code" || st.kind === "structure" ? st.structure : undefined;
  if (!ds) return required ? `this board runs an operation on a data structure, so "structure" (with "ops" on its steps) is REQUIRED` : null;
  const steps = st.kind === "code" || st.kind === "structure" ? st.steps : [];
  const { problem } = runStructure(ds, steps);
  if (problem) return `the data structure goes wrong at ${problem}`;
  // A structure that never changes is a picture beside the code, not the code at work on it.
  const changing = steps.filter((p) => p.ops?.length).length;
  if (st.kind === "code" && changing < 2) return `the structure never changes: walk the code one step per sentence, and give each step the "ops" its lines perform (mark the node compared, move a pointer, link, remove) — at least 2 steps must change it`;
  if (st.kind === "structure" && changing < 1) return `the structure never changes: give the steps "ops" (mark the nodes the sentence talks about, in order)`;
  return null;
}

/** The code board without its structure — kept when the structure could not be made right: never wrong, only plainer. */
export function withoutStructure(spec: CanvasBoardSpec): CanvasBoardSpec | null {
  if (spec.stage.kind !== "code") return null;
  const { structure: _drop, ...code } = spec.stage;
  void _drop;
  return { ...spec, stage: { ...code, steps: code.steps.map(({ ops: _ops, ...step }) => (void _ops, step)) } };
}

/**
 * The picture and the Variables panel must agree (QA batch 5, 2026-10-21: a bubble sort's array
 * ended as [2, 3, 1] while its Variables panel said A = [1, 2, 3]). For an array, list, stack or
 * queue drawn beside code: at each step that gives a list value with the same items, the drawing must
 * hold them in the same order. Null when they agree, or when nothing comparable is stated.
 */
export function structureStateMismatch(start: DsStart, steps: Array<{ s: number; ops?: DsOp[]; state?: Array<{ name: string; value: string }> }>): string | null {
  if (!["array", "list", "stack", "queue"].includes(start.kind)) return null;
  const { frames } = runStructure(start, steps);
  const items = (v: string) => (/^\s*\[(.*)\]\s*$/.exec(v)?.[1] ?? "").split(",").map((x) => x.trim().replace(/^["']|["']$/g, "")).filter(Boolean);
  const sorted = (a: string[]) => [...a].sort().join("|");
  for (const st of steps) {
    const frame = [...frames].reverse().find((f) => f.s <= st.s);
    if (!frame || !st.state) continue;
    const drawn = frame.nodes.map((n) => String(n.value).trim());
    for (const v of st.state) {
      const said = items(v.value);
      if (said.length !== drawn.length || sorted(said) !== sorted(drawn)) continue;
      if (said.join("|") !== drawn.join("|")) return `on sentence ${st.s} the Variables panel says ${v.name} = [${said.join(", ")}] but the ${start.kind} drawn beside the code is [${drawn.join(", ")}]: make the ops move the cells so the drawing matches the variable at every step`;
    }
  }
  return null;
}

/**
 * WHAT ARIA SAYS IS WHAT IS DRAWN. A bubble-sort board said "we have fixed 5 … swap to get [1, 2, 4,
 * 5] … so the list is sorted" over an array drawn as [5, 1, 2, 4] (QA 2026-10-21): it restarted from
 * the original list instead of continuing from the last board. On each sentence, the structure as
 * drawn when the sentence ends must be the last whole list the sentence reads out (same values, so
 * a partial list like "[1, 4]" is not compared), and in order when the sentence says it is sorted.
 * `sentences` are the board's narration sentences, s = 0, 1, ….
 */
export function narratedStructureMismatch(start: DsStart, steps: Array<{ s: number; ops?: DsOp[] }>, sentences: string[]): string | null {
  if (!["array", "list", "stack", "queue"].includes(start.kind)) return null;
  const { frames } = runStructure(start, steps);
  if (!frames.length) return null;
  const key = (a: string[]) => [...a].sort().join("|");
  for (const [s, sentence] of sentences.entries()) {
    const frame = [...frames].reverse().find((f) => f.s <= s) ?? frames[0];
    const drawn = frame.nodes.map((n) => String(n.value).trim());
    const lists = [...sentence.matchAll(/\[([^[\]]+)\]/g)].map((m) => m[1].split(",").map((x) => x.trim().replace(/^["']|["']$/g, "")).filter(Boolean));
    const whole = lists.filter((l) => l.length === drawn.length && key(l) === key(drawn));
    const said = whole[whole.length - 1];
    if (said && said.join("|") !== drawn.join("|")) return `sentence ${s} says the ${start.kind} is [${said.join(", ")}] but it is drawn as [${drawn.join(", ")}] when that sentence ends: start from the state the lesson has reached (continue from the previous board) and give ops that make the drawing match what each sentence says`;
    const nums = drawn.map(Number);
    const claimsSorted = /\b(?:is|are|now|fully|completely)\s+(?:all\s+)?sorted\b|\bsorted (?:list|array)\b/i.test(sentence) && !/\b(?:not|unsorted|until|unless|if|whether)\b/i.test(sentence);
    if (claimsSorted && nums.every(Number.isFinite) && !nums.every((v, i) => i === 0 || v >= nums[i - 1]) && !nums.every((v, i) => i === 0 || v <= nums[i - 1])) return `sentence ${s} says it is sorted but the ${start.kind} is drawn as [${drawn.join(", ")}]: the drawing must be in order by then`;
  }
  return null;
}

/**
 * POSITIONAL IDS. The board writer names an array's cells by position ("n0" … "n3") and keeps using
 * "n1" for "the second cell" after a swap, while the drawing follows each value by its id — so after
 * the first swap every later step compared and swapped the wrong cells (5 of 9 sort boards, QA
 * 2026-10-21). When the ids are positions and reading them as positions makes the drawing agree with
 * the narration (where reading them as values does not), the ops are rewritten to the ids of the
 * cells at those positions. Arrays with swaps, marks, pointers and set only. Returns true when it rewrote.
 */
export function repairPositionalIds(start: DsStart, steps: Array<{ s: number; ops?: DsOp[] }>, sentences: string[]): boolean {
  if (start.kind !== "array" || !steps.some((st) => st.ops?.some((o) => o.op === "swap"))) return false;
  if (steps.some((st) => st.ops?.some((o) => !["swap", "mark", "point", "set"].includes(o.op)))) return false;
  const pattern = /^([a-z_-]*?)(\d+)$/i;
  const nums = start.nodes.map((n) => pattern.exec(n.id));
  if (nums.some((m) => !m) || new Set(nums.map((m) => m![1])).size !== 1) return false;
  const base = Number(nums[0]![2]);
  if (!nums.every((m, k) => Number(m![2]) === base + k)) return false;
  if (!narratedStructureMismatch(start, steps, sentences)) return false;
  const order = start.nodes.map((n) => n.id);
  const at = (id: string) => {
    const m = pattern.exec(id);
    return m && m[1] === nums[0]![1] ? order[Number(m[2]) - base] ?? id : id;
  };
  const rewritten = steps.map((st) => ({
    ...st,
    ops: st.ops?.map((o): DsOp => {
      if (o.op === "swap") {
        const a = at(o.a), b = at(o.b);
        const i = order.indexOf(a), j = order.indexOf(b);
        if (i >= 0 && j >= 0) [order[i], order[j]] = [order[j], order[i]];
        return { ...o, a, b };
      }
      if (o.op === "point") return { ...o, to: o.to === null ? null : at(o.to) };
      if (o.op === "mark" || o.op === "set") return { ...o, id: at(o.id) };
      return o;
    }),
  }));
  if (narratedStructureMismatch(start, rewritten, sentences)) return false;
  steps.forEach((st, i) => (st.ops = rewritten[i].ops));
  return true;
}

/**
 * A SEARCH NEVER DELETES CELLS. A binary-search board removed the discarded half, so the array
 * re-numbered itself 0–2 under code that said left = 0, right = 6 (QA 2026-10-21). On an array that
 * is being searched (it has a "mid", "low" or "high" pointer), a removal is drawn as a crossed-out
 * cell instead, and every index stays where the code says it is. Returns how many ops it changed.
 */
export function keepSearchedCells(start: DsStart, steps: Array<{ s: number; ops?: DsOp[] }>): number {
  if (start.kind !== "array") return 0;
  const names = new Set([...(start.pointers ?? []).map((p) => p.name.toLowerCase()), ...steps.flatMap((st) => (st.ops ?? []).flatMap((o) => (o.op === "point" ? [o.name.toLowerCase()] : [])))]);
  if (!["mid", "low", "high", "lo", "hi"].some((n) => names.has(n))) return 0;
  let changed = 0;
  for (const st of steps) {
    st.ops = st.ops?.map((o): DsOp => {
      if (o.op !== "remove") return o;
      changed++;
      return { op: "mark", id: o.id, as: "remove" };
    });
  }
  return changed;
}

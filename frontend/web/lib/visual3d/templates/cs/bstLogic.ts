// A real binary search tree. Every operation returns the path it walked and what it did, so the
// visual (and the facts the tutor says) come from the algorithm itself, never from the model.

export interface BNode { value: number; left: BNode | null; right: BNode | null }
export type Order = "inorder" | "preorder" | "postorder";

export interface Walk {
  path: number[];             // values compared, in order
  dirs: ("left" | "right" | "here")[];
}

export class BST {
  root: BNode | null = null;
  static readonly MAX = 15;

  static from(values: number[]): BST {
    const t = new BST();
    for (const v of values) t.insert(v);
    return t;
  }

  size(n = this.root): number { return n ? 1 + this.size(n.left) + this.size(n.right) : 0; }
  height(n = this.root): number { return n ? 1 + Math.max(this.height(n.left), this.height(n.right)) : 0; }
  has(v: number): boolean { return this.search(v).found; }

  private walk(v: number): Walk & { last: BNode | null; found: BNode | null } {
    const path: number[] = [], dirs: Walk["dirs"] = [];
    let cur = this.root, last: BNode | null = null;
    while (cur) {
      path.push(cur.value);
      if (v === cur.value) return dirs.push("here"), { path, dirs, last, found: cur };
      last = cur;
      const d = v < cur.value ? "left" : "right";
      dirs.push(d);
      cur = cur[d];
    }
    return { path, dirs, last, found: null };
  }

  insert(v: number): Walk & { inserted: boolean; parent: number | null; side: "left" | "right" | null } {
    const w = this.walk(v);
    if (w.found) return { path: w.path, dirs: w.dirs, inserted: false, parent: null, side: null };
    const node: BNode = { value: v, left: null, right: null };
    if (!w.last) {
      this.root = node;
      return { path: w.path, dirs: w.dirs, inserted: true, parent: null, side: null };
    }
    const side = v < w.last.value ? "left" : "right";
    w.last[side] = node;
    return { path: w.path, dirs: w.dirs, inserted: true, parent: w.last.value, side };
  }

  search(v: number): Walk & { found: boolean } {
    const w = this.walk(v);
    return { path: w.path, dirs: w.dirs, found: !!w.found };
  }

  /** Delete with the three textbook cases; a node with two children takes its in-order successor's value. */
  delete(v: number): { found: boolean; case: "leaf" | "one_child" | "two_children" | null; successor: number | null; path: number[]; successorPath: number[] } {
    const w = this.walk(v);
    if (!w.found) return { found: false, case: null, successor: null, path: w.path, successorPath: [] };
    const target = w.found;
    if (target.left && target.right) {
      const successorPath: number[] = [];
      let parent = target, s = target.right;
      successorPath.push(s.value);
      while (s.left) {
        parent = s;
        s = s.left;
        successorPath.push(s.value);
      }
      target.value = s.value;
      if (parent === target) parent.right = s.right;
      else parent.left = s.right;
      return { found: true, case: "two_children", successor: s.value, path: w.path, successorPath };
    }
    const child = target.left ?? target.right;
    const kind = child ? "one_child" : "leaf";
    if (!w.last) this.root = child;
    else if (w.last.left === target) w.last.left = child;
    else w.last.right = child;
    return { found: true, case: kind, successor: null, path: w.path, successorPath: [] };
  }

  traverse(order: Order, n = this.root, out: number[] = []): number[] {
    if (!n) return out;
    if (order === "preorder") out.push(n.value);
    this.traverse(order, n.left, out);
    if (order === "inorder") out.push(n.value);
    this.traverse(order, n.right, out);
    if (order === "postorder") out.push(n.value);
    return out;
  }

  /** Every node is bigger than everything on its left and smaller than everything on its right. */
  isValid(n = this.root, lo = -Infinity, hi = Infinity): boolean {
    if (!n) return true;
    if (!(n.value > lo && n.value < hi)) return false;
    return this.isValid(n.left, lo, n.value) && this.isValid(n.right, n.value, hi);
  }

  /** Position of every node: x by in-order rank, depth by level; and the parent → child edges. */
  layout(): { pos: Map<number, { rank: number; depth: number }>; edges: [number, number][] } {
    const pos = new Map<number, { rank: number; depth: number }>(), edges: [number, number][] = [];
    let rank = 0;
    const visit = (n: BNode | null, depth: number) => {
      if (!n) return;
      visit(n.left, depth + 1);
      pos.set(n.value, { rank: rank++, depth });
      visit(n.right, depth + 1);
      if (n.left) edges.push([n.value, n.left.value]);
      if (n.right) edges.push([n.value, n.right.value]);
    };
    visit(this.root, 0);
    return { pos, edges };
  }
}

// Six real sorting algorithms that record what they do. Each item keeps an id, so the visual moves
// the same bar wherever it goes; each operation carries the order after it, so drawing is trivial.

export const ALGORITHMS = ["bubble", "insertion", "selection", "merge", "quick", "heap"] as const;
export type Algorithm = (typeof ALGORITHMS)[number];

export interface Item { id: number; value: number }
export type Op =
  | { t: "compare"; a: number; b: number; order: number[] }
  | { t: "swap"; a: number; b: number; order: number[] }
  | { t: "place"; ids: number[]; order: number[] }
  | { t: "pivot"; a: number; order: number[] }
  | { t: "done"; ids: number[]; order: number[] };

export interface Trace { ops: Op[]; sorted: number[]; comparisons: number; swaps: number; writes: number }

export function trace(values: number[], algorithm: Algorithm): Trace {
  const a: Item[] = values.map((value, id) => ({ id, value }));
  const ops: Op[] = [];
  let comparisons = 0, swaps = 0, writes = 0;
  const order = () => a.map((x) => x.id);
  const less = (i: number, j: number) => {
    comparisons++;
    ops.push({ t: "compare", a: a[i].id, b: a[j].id, order: order() });
    return a[i].value < a[j].value;
  };
  const swap = (i: number, j: number) => {
    if (i === j) return;
    [a[i], a[j]] = [a[j], a[i]];
    swaps++;
    ops.push({ t: "swap", a: a[i].id, b: a[j].id, order: order() });
  };
  const done = (...idx: number[]) => ops.push({ t: "done", ids: idx.map((k) => a[k].id), order: order() });
  const n = a.length;

  if (algorithm === "bubble") {
    for (let i = 0; i < n - 1; i++) {
      let swapped = false;
      for (let j = 0; j < n - 1 - i; j++) if (less(j + 1, j)) (swap(j, j + 1), (swapped = true));
      done(n - 1 - i);
      if (!swapped) break;
    }
  } else if (algorithm === "insertion") {
    for (let i = 1; i < n; i++) for (let j = i; j > 0 && less(j, j - 1); j--) swap(j, j - 1);
  } else if (algorithm === "selection") {
    for (let i = 0; i < n - 1; i++) {
      let m = i;
      for (let j = i + 1; j < n; j++) if (less(j, m)) m = j;
      swap(i, m);
      done(i);
    }
  } else if (algorithm === "merge") {
    const sort = (lo: number, hi: number) => {
      if (hi - lo < 1) return;
      const mid = (lo + hi) >> 1;
      sort(lo, mid);
      sort(mid + 1, hi);
      const left = a.slice(lo, mid + 1), right = a.slice(mid + 1, hi + 1), out: Item[] = [];
      let i = 0, j = 0;
      while (i < left.length && j < right.length) {
        comparisons++;
        ops.push({ t: "compare", a: left[i].id, b: right[j].id, order: order() });
        out.push(right[j].value < left[i].value ? right[j++] : left[i++]);
      }
      out.push(...left.slice(i), ...right.slice(j));
      out.forEach((x, k) => (a[lo + k] = x));
      writes += out.length;
      ops.push({ t: "place", ids: out.map((x) => x.id), order: order() });
    };
    sort(0, n - 1);
  } else if (algorithm === "quick") {
    const sort = (lo: number, hi: number) => {
      if (lo >= hi) {
        if (lo === hi) done(lo);
        return;
      }
      ops.push({ t: "pivot", a: a[hi].id, order: order() });
      let i = lo;
      for (let j = lo; j < hi; j++) if (less(j, hi)) swap(i++, j);
      swap(i, hi);
      done(i);
      sort(lo, i - 1);
      sort(i + 1, hi);
    };
    sort(0, n - 1);
  } else {
    const siftDown = (start: number, end: number) => {
      let root = start;
      for (;;) {
        let child = 2 * root + 1;
        if (child > end) return;
        if (child + 1 <= end && less(child, child + 1)) child++;
        if (!less(root, child)) return;
        swap(root, child);
        root = child;
      }
    };
    for (let s = (n >> 1) - 1; s >= 0; s--) siftDown(s, n - 1);
    for (let end = n - 1; end > 0; end--) {
      swap(0, end);
      done(end);
      siftDown(0, end - 1);
    }
  }
  if (n) ops.push({ t: "done", ids: order(), order: order() });
  return { ops, sorted: a.map((x) => x.value), comparisons, swaps, writes };
}

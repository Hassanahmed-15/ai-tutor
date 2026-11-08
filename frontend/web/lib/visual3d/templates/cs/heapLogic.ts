// A real binary heap (min or max) stored as an array, recording every comparison and swap.
export type HeapKind = "min" | "max";
export type HOp = { t: "compare" | "swap"; i: number; j: number; arr: number[] };

const better = (kind: HeapKind, a: number, b: number) => (kind === "min" ? a < b : a > b);

export function siftUp(arr: number[], i: number, kind: HeapKind, ops: HOp[]) {
  while (i > 0) {
    const p = (i - 1) >> 1;
    ops.push({ t: "compare", i, j: p, arr: [...arr] });
    if (!better(kind, arr[i], arr[p])) return;
    [arr[i], arr[p]] = [arr[p], arr[i]];
    ops.push({ t: "swap", i, j: p, arr: [...arr] });
    i = p;
  }
}

export function siftDown(arr: number[], i: number, kind: HeapKind, ops: HOp[], n = arr.length) {
  for (;;) {
    const l = 2 * i + 1, r = l + 1;
    let m = i;
    if (l < n) (ops.push({ t: "compare", i: l, j: m, arr: [...arr] }), better(kind, arr[l], arr[m]) && (m = l));
    if (r < n) (ops.push({ t: "compare", i: r, j: m, arr: [...arr] }), better(kind, arr[r], arr[m]) && (m = r));
    if (m === i) return;
    [arr[i], arr[m]] = [arr[m], arr[i]];
    ops.push({ t: "swap", i, j: m, arr: [...arr] });
    i = m;
  }
}

/** Floyd's build-heap: sift down from the last parent to the root. */
export function heapify(values: number[], kind: HeapKind) {
  const arr = [...values], ops: HOp[] = [];
  for (let i = (arr.length >> 1) - 1; i >= 0; i--) siftDown(arr, i, kind, ops);
  return { arr, ops };
}

export const isHeap = (a: number[], kind: HeapKind) => a.every((v, i) => i === 0 || !better(kind, v, a[(i - 1) >> 1]));

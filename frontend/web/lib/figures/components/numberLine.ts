import type { FigureComponent, FigureParams, Pt } from "../types";
import { PALETTE, Sketch, arrow, bool, clamp, fmt, list, str } from "./mathsKit";
import { parseNum } from "./coordinateGrid";

/**
 * INEQUALITIES ON A NUMBER LINE. The board gives the inequality as written ("−2 < x ≤ 3",
 * "x ≥ 1 or x < −3", even unsolved "3x − 2 > x + 4"); the code solves and parses it into intervals
 * and draws them the textbook way: an open circle where the end is excluded, a filled circle where
 * it is included, the solution set as a bar between them (an arrow for a ray), integer solutions
 * marked on request.
 */

export type Interval = { lo: number; hi: number; loClosed: boolean; hiClosed: boolean };

const OPS: Record<string, "<" | ">" | "≤" | "≥" | "="> = { "<": "<", ">": ">", "≤": "≤", "≥": "≥", "<=": "≤", ">=": "≥", "=<": "≤", "=>": "≥", "⩽": "≤", "⩾": "≥", "=": "=" };

/** "3x − 2", "−5", "x/2"... as k·x + m (null if it is not linear in the variable). */
function linear(raw: string, v: string): { k: number; m: number } | null {
  let s = raw.replace(/\s+/g, "").replace(/−/g, "-").replace(/[*×·]/g, "");
  if (!s) return null;
  if (!/^[+-]/.test(s)) s = "+" + s;
  const re = new RegExp(String.raw`([+-])(\d*\.?\d*(?:\/\d*\.?\d+)?)(${v}(?:\/(\d+(?:\.\d+)?))?)?`, "y");
  let k = 0, m = 0, at = 0;
  while (at < s.length) {
    re.lastIndex = at;
    const t = re.exec(s);
    if (!t || (t[0].length <= 1 && !t[3])) return null;
    let c = t[2] === "" ? (t[3] ? 1 : NaN) : parseNum(t[2]) ?? NaN;
    if (t[4]) c /= Number(t[4]) || NaN;
    if (!Number.isFinite(c)) return null;
    if (t[3]) k += (t[1] === "-" ? -1 : 1) * c;
    else m += (t[1] === "-" ? -1 : 1) * c;
    at = re.lastIndex;
  }
  return { k, m };
}

const ALL: Interval = { lo: -Infinity, hi: Infinity, loClosed: false, hiClosed: false };

export function intersect(a: Interval[], b: Interval[]): Interval[] {
  const out: Interval[] = [];
  for (const p of a) for (const q of b) {
    const lo = Math.max(p.lo, q.lo), hi = Math.min(p.hi, q.hi);
    const loClosed = (p.lo === lo ? p.loClosed : true) && (q.lo === lo ? q.loClosed : true);
    const hiClosed = (p.hi === hi ? p.hiClosed : true) && (q.hi === hi ? q.hiClosed : true);
    if (lo < hi || (lo === hi && loClosed && hiClosed)) out.push({ lo, hi, loClosed, hiClosed });
  }
  return union(out);
}
export function union(xs: Interval[]): Interval[] {
  const s = [...xs].sort((a, b) => a.lo - b.lo || Number(b.loClosed) - Number(a.loClosed));
  const out: Interval[] = [];
  for (const i of s) {
    const last = out[out.length - 1];
    if (last && (i.lo < last.hi || (i.lo === last.hi && (i.loClosed || last.hiClosed)))) {
      if (i.hi > last.hi || (i.hi === last.hi && i.hiClosed)) (last.hi = i.hi), (last.hiClosed = i.hiClosed || (i.hi === last.hi && last.hiClosed));
    } else out.push({ ...i });
  }
  return out;
}

/**
 * Parse (and solve) an inequality into intervals. Clauses join with "or"/"∪" (union) and
 * "and"/","/"∩" (intersection); each clause is a chain like "a < 2x + 1 ≤ b". Null if unreadable.
 */
export function parseInequality(raw: unknown, variable = "x"): Interval[] | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  const v = (/[a-z]/i.exec(raw.replace(/\b(or|and)\b/gi, ""))?.[0] ?? variable).replace(/[^a-z]/i, "x");
  const s = raw.slice(0, 200).replace(/−/g, "-");
  const result: Interval[] = [];
  for (const orPart of s.split(/\bor\b|∪|\|\|/i)) {
    let acc: Interval[] = [ALL];
    for (const clause of orPart.split(/\band\b|∩|&&|,|;/i)) {
      if (!clause.trim()) continue;
      const pieces = clause.split(/(<=|>=|=<|=>|≤|≥|⩽|⩾|<|>|=)/).map((t) => t.trim());
      if (pieces.length < 3 || pieces.length % 2 === 0) return null;
      for (let i = 0; i + 2 < pieces.length; i += 2) {
        const L = linear(pieces[i], v), R = linear(pieces[i + 2], v), op = OPS[pieces[i + 1]];
        if (!L || !R || !op) return null;
        // (kL − kR)·x  op  mR − mL
        const K = L.k - R.k, M = R.m - L.m;
        let c: Interval[];
        if (Math.abs(K) < 1e-12) {
          const holds = op === "<" ? 0 < M : op === ">" ? 0 > M : op === "≤" ? 0 <= M : op === "≥" ? 0 >= M : M === 0;
          c = holds ? [ALL] : [];
        } else {
          const b = M / K;
          const flip = K < 0;
          const o = flip ? ({ "<": ">", ">": "<", "≤": "≥", "≥": "≤", "=": "=" } as const)[op] : op;
          c = o === "<" ? [{ lo: -Infinity, hi: b, loClosed: false, hiClosed: false }]
            : o === "≤" ? [{ lo: -Infinity, hi: b, loClosed: false, hiClosed: true }]
            : o === ">" ? [{ lo: b, hi: Infinity, loClosed: false, hiClosed: false }]
            : o === "≥" ? [{ lo: b, hi: Infinity, loClosed: true, hiClosed: false }]
            : [{ lo: b, hi: b, loClosed: true, hiClosed: true }];
        }
        acc = intersect(acc, c);
      }
    }
    result.push(...acc);
  }
  return union(result);
}

/** 2.5 → "2.5", 7/3 → "7/3" (exact fractions with small denominators), −3 → "−3". */
export function valueText(n: number): string {
  if (Math.abs(n - Math.round(n)) < 1e-9) return fmt(n, 0);
  if (Math.abs(n - Number(n.toFixed(3))) < 1e-9) return fmt(n, 3);
  for (let d = 3; d <= 12; d++) if (Math.abs(n * d - Math.round(n * d)) < 1e-9) return `${fmt(Math.round(n * d), 0)}/${d}`;
  return fmt(n, 2);
}

/** The intervals written back as inequalities: "−2 < x ≤ 3", "x ≥ 1 or x < −3". */
export function intervalsText(xs: Interval[], v = "x"): string {
  return xs.map((i) => {
    if (i.lo === i.hi) return `${v} = ${valueText(i.lo)}`;
    if (i.lo === -Infinity && i.hi === Infinity) return `all ${v}`;
    if (i.lo === -Infinity) return `${v} ${i.hiClosed ? "≤" : "<"} ${valueText(i.hi)}`;
    if (i.hi === Infinity) return `${v} ${i.loClosed ? "≥" : ">"} ${valueText(i.lo)}`;
    return `${valueText(i.lo)} ${i.loClosed ? "≤" : "<"} ${v} ${i.hiClosed ? "≤" : "<"} ${valueText(i.hi)}`;
  }).join(" or ");
}

/** The integers in the solution set (within lo..hi for unbounded sets). */
export function integerSolutions(xs: Interval[], lo: number, hi: number): number[] {
  const out: number[] = [];
  for (let n = Math.ceil(lo); n <= Math.floor(hi); n++) {
    if (xs.some((i) => (n > i.lo || (n === i.lo && i.loClosed)) && (n < i.hi || (n === i.hi && i.hiClosed)))) out.push(n);
  }
  return out;
}

const PARTS = [
  { id: "number-line", name: "Number line" },
  { id: "zero", name: "Zero" },
  { id: "open-circle", name: "Open circle (not included)" },
  { id: "closed-circle", name: "Closed circle (included)" },
  { id: "solution-set", name: "Solution set" },
  { id: "integers", name: "Integer solutions" },
  { id: "point", name: "Marked point" },
];

const cap = (s: string, n = 34) => (s.length <= n ? s : s.slice(0, n - 1) + "…");

export const numberLine: FigureComponent = {
  name: "numberLine",
  title: "A number line with an inequality's solution set: open circles (end not included), filled circles (included), the set shaded as a bar or an arrow for a ray, integer marks, optional integer solutions and marked points",
  params: `inequality (as written: "-2 < x <= 3", "x ≥ 1", "x < -1 or x ≥ 2", "x > -3 and x < 4", or unsolved like "3x - 2 > x + 4" — the code solves it; default "-2 < x ≤ 3"); range (the visible numbers, e.g. "-5,5"; widened to fit every endpoint; default 2 beyond the endpoints); integers (true: mark the integer solutions with dots and list them in the part name; default false); points (marked numbers, e.g. "A:-3; B:1.5" or "-3, 1.5"; dots on the line with their letters); variable (the letter, default from the inequality, else "x"). Parts exist only for what is drawn (open-circle only when an end is excluded, zero only when 0 is on the line).`,
  match: /\bnumber lines?\b|\b(solv\w*|represent\w*|show\w*|draw\w*|linear|double|compound|combined|two[- ]sided)\s+(the\s+)?inequalit(y|ies)\b|\binequalit(y|ies)\s+(on|with) (a|the) number line\b|\binteger (values|solutions)\b[^.]{0,30}\bsatisf|\b(open|closed|filled|hollow) (dot|circle)s?\b[^.]{0,40}\binequalit|\bsolution set of (an|the) inequality\b|[−-]?\d+(\.\d+)?\s*(<|≤|<=|⩽)\s*[a-z]\s*(<|≤|<=|⩽)\s*[−-]?\d/i,
  parts: PARTS,
  build(params: FigureParams) {
    const variable = str(params.variable, "x", 2);
    const given = parseInequality(params.inequality ?? params.inequalities, variable);
    const sets = given ?? parseInequality("-2 < x <= 3")!;
    const v = typeof params.variable === "string" && params.variable.trim() ? variable : (/[a-z]/i.exec(String(params.inequality ?? "").replace(/\b(or|and)\b/gi, ""))?.[0] ?? "x");
    const marked: Array<{ name: string; x: number }> = [];
    let letter = 65;
    for (const item of list(params.points, /[;,]/)) {
      const m = /^\s*(?:([A-Za-z]{1,2})\s*[:=]\s*)?([-−]?\s*[\d./]+)\s*$/.exec(item);
      const x = m ? parseNum(m[2]) : undefined;
      if (x === undefined) continue;
      marked.push({ name: m![1] ?? String.fromCharCode(letter++), x: clamp(x, -1000, 1000) });
      if (marked.length >= 6) break;
    }

    // The visible numbers: every finite endpoint and point, 0 when it is close, a margin beyond.
    const ends = sets.flatMap((i) => [i.lo, i.hi]).filter(Number.isFinite).map((n) => clamp(n, -1000, 1000));
    const xs = [...ends, ...marked.map((p) => p.x)];
    if (!xs.length) xs.push(0);
    const rangeIn = list(params.range, /[,;]|\bto\b|\.\./).map((s) => parseNum(s)).filter((n): n is number => n !== undefined);
    let lo = Math.floor(Math.min(...xs)) - 2, hi = Math.ceil(Math.max(...xs)) + 2;
    if (rangeIn.length >= 2) (lo = Math.min(lo + 1, Math.floor(Math.min(rangeIn[0], rangeIn[1]))), hi = Math.max(hi - 1, Math.ceil(Math.max(rangeIn[0], rangeIn[1]))));
    if (lo > 0 && lo <= 3) lo = 0;
    else if (hi < 0 && hi >= -3) hi = 0;
    while (hi - lo < 6) (lo -= 1), (hi += hi - lo < 6 ? 1 : 0);
    const span = hi - lo;
    const step = span <= 16 ? 1 : span <= 34 ? 2 : span <= 80 ? 5 : span <= 160 ? 10 : 50;
    lo = Math.floor(lo / step) * step;
    hi = Math.ceil(hi / step) * step;
    const unitPx = 470 / (hi - lo);
    const X = (n: number) => (n - lo) * unitPx;
    const Y = 0, BAR = -32, R = 8.5;

    const sk = new Sketch();
    // The number line, running on past both ends.
    arrow(sk, { x: X(lo) - 6, y: Y }, { x: X(lo) - 30, y: Y }, "ink", 2.2, "number-line", 12);
    arrow(sk, { x: X(lo) - 8, y: Y }, { x: X(hi) + 30, y: Y }, "ink", 2.2, "number-line", 12);
    for (let n = lo; n <= hi + 1e-9; n += step) sk.line([{ x: X(n), y: Y - 7 }, { x: X(n), y: Y + 7 }], { stroke: "ink", width: n === 0 ? 2.6 : 1.8, ...(n === 0 ? { part: "zero" } : { part: "number-line" }) });
    if (step > 1) for (let n = lo; n <= hi; n++) if (n % step) sk.line([{ x: X(n), y: Y - 3.5 }, { x: X(n), y: Y + 3.5 }], { stroke: "muted", width: 1.2, part: "number-line" }, false);

    // The solution set: a bar above the line; rays run off the end as arrows.
    const blue = PALETTE.blue;
    let firstOpen: Pt | undefined, firstClosed: Pt | undefined, setAnchor: Pt | undefined;
    const nonInteger: number[] = [];
    for (const i of sets) {
      const a = Number.isFinite(i.lo) ? X(clamp(i.lo, lo, hi)) : X(lo) - 22;
      const b = Number.isFinite(i.hi) ? X(clamp(i.hi, lo, hi)) : X(hi) + 22;
      if (i.lo === i.hi) {
        // A single value: just its filled circle.
      } else {
        const from = Number.isFinite(i.lo) ? a + R : a, to = Number.isFinite(i.hi) ? b - R : b;
        if (!Number.isFinite(i.lo)) arrow(sk, { x: to, y: BAR }, { x: from - 6, y: BAR }, blue, 3.4, "solution-set", 13);
        else if (!Number.isFinite(i.hi)) arrow(sk, { x: from, y: BAR }, { x: to + 6, y: BAR }, blue, 3.4, "solution-set", 13);
        else if (to > from) sk.line([{ x: from, y: BAR }, { x: to, y: BAR }], { stroke: blue, width: 3.4, part: "solution-set" });
        setAnchor ??= { x: Number.isFinite(i.lo) && Number.isFinite(i.hi) ? (a + b) / 2 : Number.isFinite(i.lo) ? Math.min(a + 70, (a + b) / 2) : Math.max(b - 70, (a + b) / 2), y: BAR };
      }
      const endpoints: Array<[number, boolean]> = i.lo === i.hi ? [[i.lo, true]] : [[i.lo, i.loClosed], [i.hi, i.hiClosed]];
      for (const [end, closed] of endpoints) {
        if (!Number.isFinite(end)) continue;
        const c = { x: X(clamp(end, lo, hi)), y: BAR };
        // A thin drop line ties the circle to its number.
        sk.line([{ x: c.x, y: BAR + R }, { x: c.x, y: Y - 8 }], { stroke: blue, width: 1.2, dash: "3 3", opacity: 0.7, part: closed ? "closed-circle" : "open-circle" }, false);
        sk.circle(c, R, { fill: closed ? blue : "paper", stroke: blue, width: 2.6, part: closed ? "closed-circle" : "open-circle" });
        // The leader ends on the ring, so its dot never fills an open circle.
        if (closed) firstClosed ??= { x: c.x, y: c.y - R };
        else firstOpen ??= { x: c.x, y: c.y - R };
        if (Math.abs(end - Math.round(end)) > 1e-9 || Math.round(end) % step) nonInteger.push(end);
      }
    }
    if (!setAnchor && sets.length) setAnchor = firstClosed ?? firstOpen;

    // Integer solutions as red dots on the line.
    const showInts = bool(params.integers ?? params.integerSolutions, false);
    const ints = showInts ? integerSolutions(sets, lo, hi) : [];
    for (const n of ints) sk.circle({ x: X(n), y: Y }, 5, { fill: PALETTE.red, stroke: PALETTE.red, width: 1, part: "integers" }, false);
    for (const p of marked) sk.circle({ x: X(clamp(p.x, lo, hi)), y: Y }, 5.5, { fill: PALETTE.violet, stroke: PALETTE.violet, width: 1, part: "point" }, false);

    // Numbers: endpoints that fall between ticks are written in blue; then the tick numbers.
    for (const n of nonInteger) sk.placeText(valueText(n), 16, { x: X(clamp(n, lo, hi)), y: Y }, { x: 0, y: 1 }, { min: 42, max: 70, fill: blue, part: sets.some((i) => (i.lo === n && i.loClosed) || (i.hi === n && i.hiClosed)) ? "closed-circle" : "open-circle", slide: { x: 1, y: 0 } });
    for (const p of marked) sk.placeLetter(p.name, 18, { x: X(clamp(p.x, lo, hi)), y: Y }, [{ x: 0, y: 1 }, { x: 0.5, y: 1 }, { x: -0.5, y: 1 }], { fill: PALETTE.violet, part: "point", min: 30, max: 60 });
    for (let n = lo; n <= hi + 1e-9; n += step) {
      const at = { x: X(n), y: Y + 22 };
      const t = fmt(n, 0);
      if (!sk.blocked({ x: at.x - t.length * 4.6, y: at.y - 7, w: t.length * 9.2, h: 14 }, 1)) sk.text(at, t, 17, n === 0 ? "ink" : "muted", n === 0 ? "zero" : "number-line");
    }

    sk.part("number-line", "Number line", { x: X(hi) + 26, y: Y });
    if (lo <= 0 && hi >= 0) sk.part("zero", "Zero", { x: X(0), y: Y });
    if (firstOpen) sk.part("open-circle", "Open circle (not included)", firstOpen);
    if (firstClosed) sk.part("closed-circle", "Closed circle (included)", firstClosed);
    if (setAnchor) sk.part("solution-set", cap(sets.length ? intervalsText(sets, v) : "Solution set"), setAnchor);
    if (ints.length) sk.part("integers", cap(`Integers ${ints.length > 8 ? ints.slice(0, 7).map((n) => fmt(n, 0)).join(", ") + "…" : ints.map((n) => fmt(n, 0)).join(", ")}`), { x: X(ints[0]), y: Y });
    if (marked.length) sk.part("point", cap(`Point ${marked[0].name} = ${valueText(marked[0].x)}`), { x: X(clamp(marked[0].x, lo, hi)), y: Y });
    return sk.finish(14, { h: 220 });
  },
};

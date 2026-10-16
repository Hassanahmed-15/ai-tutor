import type { Ink, Pt } from "../types";
import { Sketch, arrow, fmt, optNum } from "./mathsKit";
import { compileExpr } from "../../canvas/expr";

/**
 * Shared kit for the code-drawn GRAPH figures (riemannSum, slopeField, functionGraph): the model
 * writes a formula as text; this turns it into a safe function (lib/canvas/expr.ts — never eval),
 * finds the numbers a textbook marks (zeros, turning points, asymptotes, integrals) numerically, and
 * draws axes, ticks and clipped curves onto a Sketch in screen units (y down).
 */

/* ── formulas ─────────────────────────────────────────────────────────────────────────────── */

const FN_NAMES = "sin|cos|tan|ln|log|log10|exp|sqrt|abs";

/** "y = 2x^2 − 3x", "f(x) = 3sin x", "(x-1)(x+2)", "|x|", "e^x" → text lib/canvas/expr.ts parses. */
export function normalizeExpr(src: unknown): string {
  let s = String(src ?? "").trim().slice(0, 300);
  s = s.replace(/^\s*(?:[a-z]\s*\(\s*[a-z]\s*\)|y|dy\s*\/\s*dx|y')\s*=\s*/i, "");
  s = s
    .replace(/π/g, "pi").replace(/[−–]/g, "-").replace(/[×·]/g, "*").replace(/÷/g, "/")
    .replace(/²/g, "^2").replace(/³/g, "^3").replace(/√\s*\(/g, "sqrt(").replace(/√\s*([a-z0-9.]+)/gi, "sqrt($1)")
    .replace(/\|([^|]+)\|/g, "abs($1)");
  // "sin x" → sin(x); "sinx" → sin(x)
  s = s.replace(new RegExp(`(?<![A-Za-z])(${FN_NAMES})\\s+([a-z0-9.]+(?:\\^[a-z0-9.]+)?)`, "gi"), "$1($2)");
  s = s.replace(/(?<![A-Za-z])(sin|cos|tan|ln|exp|sqrt|abs)(x|y|t)\b/g, "$1($2)");
  // Implicit multiplication: 2x, 3sin(x), 2(x+1), (x-1)(x+2), x(x-1), xy.
  s = s.replace(/(^|[^A-Za-z_\d.])(\d+(?:\.\d+)?)\s*(?=[A-Za-z(])/g, "$1$2*");
  s = s.replace(/\)\s*(?=[A-Za-z\d(])/g, ")*");
  s = s.replace(/\b(x|y|t|pi|e)\s*\(/g, "$1*(");
  s = s.replace(/\b(x|y)\s+(?=[xy(]\b|\()/g, "$1*");
  s = s.replace(/\bxy\b/g, "x*y").replace(/\byx\b/g, "y*x");
  s = s.replace(/\b(x|y)(pi|e)\b/g, "$1*$2").replace(/\b(pi)(x|y)\b/g, "$1*$2");
  return s;
}

/** A formula in x as a function (NaN wherever it is undefined), or null when it does not parse. */
export function fn1(src: unknown, v = "x"): ((x: number) => number) | null {
  if (typeof src !== "string" && typeof src !== "number") return null;
  const c = compileExpr(normalizeExpr(src));
  if (!c || !c.vars.every((n) => n === v)) return null;
  const f = (x: number) => {
    try {
      const r = c.eval({ [v]: x });
      return Number.isFinite(r) ? r : NaN;
    } catch {
      return NaN;
    }
  };
  for (const x of [0.37, 1.3, -1.1, 2.7, -2.3, 5.1, 0.5, 10.2, -7.7, 0.01]) if (Number.isFinite(f(x))) return f;
  return null;
}

/** A formula in x and y (for dy/dx), or null. */
export function fn2(src: unknown): ((x: number, y: number) => number) | null {
  if (typeof src !== "string" && typeof src !== "number") return null;
  const c = compileExpr(normalizeExpr(src));
  if (!c || !c.vars.every((n) => n === "x" || n === "y")) return null;
  const f = (x: number, y: number) => {
    try {
      const r = c.eval({ x, y });
      return Number.isFinite(r) ? r : NaN;
    } catch {
      return NaN;
    }
  };
  for (const [x, y] of [[0.37, 0.61], [1.3, -0.7], [-1.1, 2.2], [2.7, 1.9]]) if (Number.isFinite(f(x, y))) return f;
  return null;
}

const SUP: Record<string, string> = { "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴", "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹", "-": "⁻", n: "ⁿ", x: "ˣ" };
const SUB: Record<string, string> = { "0": "₀", "1": "₁", "2": "₂", "3": "₃", "4": "₄", "5": "₅", "6": "₆", "7": "₇", "8": "₈", "9": "₉" };
export const subscript = (s: string) => [...s].map((c) => SUB[c] ?? c).join("");

/** The formula as a textbook writes it: x^2 → x², 2*x → 2x, pi → π, sqrt → √, - → −. */
export function prettyExpr(src: string): string {
  let s = normalizeExpr(src);
  s = s.replace(/\^\(?(-?\d|n|x)\)?(?![\d.])/g, (_, p: string) => [...p].map((c) => SUP[c] ?? c).join(""));
  s = s.replace(/(\d)\*(?=[A-Za-z(])/g, "$1").replace(/\)\*\(/g, ")(").replace(/\*/g, "·");
  s = s.replace(/\bpi\b/g, "π").replace(/sqrt/g, "√").replace(/-/g, "−").replace(/\s+/g, "");
  s = s.replace(/([^(,])([+−])/g, "$1 $2 ");
  return s.replace(/\(\s+/g, "(").trim();
}

/* ── numbers ──────────────────────────────────────────────────────────────────────────────── */

export function snap(v: number): number {
  if (!Number.isFinite(v)) return v;
  const r = Math.round(v);
  if (Math.abs(v - r) < 1e-6) return r === 0 ? 0 : r;
  return Math.round(v * 1e6) / 1e6;
}

/** 2.6666… → "8/3" when it is a fraction with a small denominator, else null. */
export function exactFraction(v: number, maxDen = 12): string | null {
  if (!Number.isFinite(v)) return null;
  for (let d = 1; d <= maxDen; d++) {
    const n = Math.round(v * d);
    if (Math.abs(v - n / d) < 1e-7 * Math.max(1, Math.abs(v))) {
      const g = gcd(Math.abs(n), d);
      const nn = n / g, dd = d / g;
      return (dd === 1 ? String(nn) : `${nn}/${dd}`).replace("-", "−");
    }
  }
  return null;
}
const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a || 1);

/** "8/3 ≈ 2.667", "4", "2.718". */
export function valueText(v: number, dp = 3): string {
  if (!Number.isFinite(v)) return "undefined";
  const ex = exactFraction(v);
  const dec = fmt(v, dp);
  if (ex && ex !== dec) return /\//.test(ex) ? `${ex} ≈ ${dec}` : ex;
  return dec;
}

/** A coordinate pair as written on a graph: (2, 0), (−1.41, 3). */
export const coordText = (x: number, y: number, dp = 2) => `(${fmt(snap(x), dp)}, ${fmt(snap(y), dp)})`;

/** π/2, −3π/4, 2π for multiples of π/12 (else the decimal). */
export function piFmt(x: number, dp = 2): string {
  const k = x / (Math.PI / 12);
  if (Math.abs(k - Math.round(k)) > 1e-4) return fmt(x, dp);
  let n = Math.round(k), d = 12;
  if (n === 0) return "0";
  const g = gcd(Math.abs(n), d);
  n /= g;
  d /= g;
  const a = Math.abs(n);
  return `${n < 0 ? "−" : ""}${a === 1 ? "" : a}π${d === 1 ? "" : `/${d}`}`;
}

export function niceStep(range: number, target = 8): number {
  const raw = Math.abs(range) / Math.max(1, target);
  if (!(raw > 0) || !Number.isFinite(raw)) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  const m = raw / p;
  return (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * p;
}

/** Composite Simpson's rule; NaN when the function is undefined anywhere it is sampled. */
export function integrate(f: (x: number) => number, a: number, b: number, n = 2000): number {
  if (a === b) return 0;
  const m = n % 2 ? n + 1 : n;
  const h = (b - a) / m;
  let s = f(a) + f(b);
  for (let i = 1; i < m; i++) s += (i % 2 ? 4 : 2) * f(a + i * h);
  return (s * h) / 3;
}

export function derivative(f: (x: number) => number, x: number, span = 1): number {
  const h = 1e-5 * Math.max(1, span);
  const a = f(x + h), b = f(x - h);
  if (Number.isFinite(a) && Number.isFinite(b)) return (a - b) / (2 * h);
  return NaN;
}

/**
 * Zeros of f on [a, b]: sign changes refined by bisection (rejected when the value blows up — that
 * is an asymptote, not a root) plus touching zeros (local minima of |f| that reach 0).
 */
export function zeros(f: (x: number) => number, a: number, b: number, n = 1200, tol = 1e-7, touching = true): number[] {
  const xs = Array.from({ length: n + 1 }, (_, i) => a + ((b - a) * i) / n);
  const ys = xs.map(f);
  const out: number[] = [];
  const push = (x: number) => {
    if (!out.some((r) => Math.abs(r - x) < (b - a) * 2e-4)) out.push(snap(x));
  };
  const scale = Math.max(1e-9, ...ys.filter(Number.isFinite).map(Math.abs).sort((p, q) => p - q).slice(0, Math.max(1, Math.floor(ys.length * 0.9))));
  for (let i = 0; i < n; i++) {
    const y0 = ys[i], y1 = ys[i + 1];
    if (!Number.isFinite(y0) || !Number.isFinite(y1)) continue;
    if (y0 === 0) { push(xs[i]); continue; }
    if (y0 * y1 < 0) {
      let lo = xs[i], hi = xs[i + 1], flo = y0;
      for (let k = 0; k < 80; k++) {
        const mid = (lo + hi) / 2, fm = f(mid);
        if (!Number.isFinite(fm)) break;
        if (fm === 0) { lo = hi = mid; break; }
        if (fm * flo < 0) hi = mid;
        else (lo = mid), (flo = fm);
      }
      const r = (lo + hi) / 2;
      if (Math.abs(f(r)) < tol * 10 * Math.max(1, scale)) push(r);
    }
  }
  if (ys[n] === 0) push(xs[n]);
  if (touching) {
    for (let i = 1; i < n; i++) {
      const v = Math.abs(ys[i]);
      if (!(v <= Math.abs(ys[i - 1]) && v <= Math.abs(ys[i + 1])) || !Number.isFinite(v)) continue;
      if (ys[i - 1] * ys[i + 1] < 0) continue;
      // Golden-section minimise |f| on the bracket.
      let lo = xs[i - 1], hi = xs[i + 1];
      for (let k = 0; k < 80; k++) {
        const m1 = lo + (hi - lo) * 0.382, m2 = lo + (hi - lo) * 0.618;
        if (Math.abs(f(m1)) < Math.abs(f(m2))) hi = m2;
        else lo = m1;
      }
      const r = (lo + hi) / 2;
      if (Math.abs(f(r)) < 1e-9 * Math.max(1, scale)) push(r);
    }
  }
  return out.sort((p, q) => p - q);
}

/** Vertical asymptotes on [a, b]: where |f| grows without bound (sign-change poles, even poles, domain edges). */
export function verticalAsymptotes(f: (x: number) => number, a: number, b: number, n = 1200): number[] {
  const xs = Array.from({ length: n + 1 }, (_, i) => a + ((b - a) * i) / n);
  const ys = xs.map(f);
  const out: number[] = [];
  const push = (x: number) => {
    const s = snapAsym(x);
    if (s > a && s < b && !out.some((r) => Math.abs(r - s) < (b - a) * 1e-3)) out.push(s);
  };
  const big = (x: number) => Math.abs(f(x));
  for (let i = 0; i < n; i++) {
    const y0 = ys[i], y1 = ys[i + 1];
    const f0 = Number.isFinite(y0), f1 = Number.isFinite(y1);
    if (f0 && f1 && y0 * y1 < 0) {
      let lo = xs[i], hi = xs[i + 1], flo = y0;
      for (let k = 0; k < 80; k++) {
        const mid = (lo + hi) / 2, fm = f(mid);
        if (!Number.isFinite(fm)) { lo = hi = mid; break; }
        if (fm * flo < 0) hi = mid;
        else (lo = mid), (flo = fm);
      }
      const r = (lo + hi) / 2;
      const near = Math.max(big(r - 1e-9 * (b - a)), big(r + 1e-9 * (b - a)));
      if (!Number.isFinite(f(r)) || near > 1e6) push(r);
    } else if (f0 !== f1) {
      // A domain edge (ln x at 0, 1/x exactly at a sample): find it, then ask whether f blows up there.
      let lo = xs[i], hi = xs[i + 1];
      const finiteAtLo = f0;
      for (let k = 0; k < 80; k++) {
        const mid = (lo + hi) / 2;
        if (Number.isFinite(f(mid)) === finiteAtLo) lo = mid;
        else hi = mid;
      }
      const edge = finiteAtLo ? lo : hi;
      const inward = finiteAtLo ? -1 : 1;
      if (big(edge) > 1e5 || big(edge) > 8 * Math.max(1, big(edge + inward * (b - a) * 0.02))) push((lo + hi) / 2);
    }
  }
  // Even poles (1/x²): a local maximum of |f| that keeps growing as it is refined.
  for (let i = 1; i < n; i++) {
    const v = Math.abs(ys[i]);
    if (!Number.isFinite(v) || v < Math.abs(ys[i - 1]) || v < Math.abs(ys[i + 1])) continue;
    let lo = xs[i - 1], hi = xs[i + 1];
    for (let k = 0; k < 90; k++) {
      const m1 = lo + (hi - lo) * 0.382, m2 = lo + (hi - lo) * 0.618;
      const v1 = big(m1), v2 = big(m2);
      if (!Number.isFinite(v1)) { hi = m1; lo = m1; break; }
      if (!Number.isFinite(v2)) { hi = m2; lo = m2; break; }
      if (v1 > v2) hi = m2;
      else lo = m1;
    }
    const r = (lo + hi) / 2;
    if (!Number.isFinite(f(r)) || big(r) > 1e7) push(r);
  }
  return out.sort((p, q) => p - q);
}
function snapAsym(x: number): number {
  for (const k of [1, 2, 4]) if (Math.abs(x * k - Math.round(x * k)) < 1e-5) return Math.round(x * k) / k;
  for (const k of [1, 2, 3, 4, 6]) if (Math.abs((x * k) / Math.PI - Math.round((x * k) / Math.PI)) < 1e-5) return (Math.round((x * k) / Math.PI) * Math.PI) / k;
  return snap(x);
}

/** y = L as x → ±∞ (when f settles), else undefined. */
export function horizontalAsymptote(f: (x: number) => number, dir: 1 | -1): number | undefined {
  const v = [3, 4, 5, 6].map((k) => f(dir * Math.pow(10, k)));
  if (!v.every(Number.isFinite)) return undefined;
  if (Math.abs(v[3] - v[2]) < 1e-4 && Math.abs(v[2] - v[1]) < 1e-3 && Math.abs(v[3]) < 1e6) {
    const L = Math.round(v[3] * 1000) / 1000;
    return Object.is(L, -0) ? 0 : L;
  }
  return undefined;
}

/* ── the plot ─────────────────────────────────────────────────────────────────────────────── */

export type Win = { x0: number; x1: number; y0: number; y1: number };
export type Plot = Win & { W: number; H: number; X: (x: number) => number; Y: (y: number) => number; S: (x: number, y: number) => Pt };

export function makePlot(win: Win, W: number, H: number): Plot {
  const X = (x: number) => ((x - win.x0) / (win.x1 - win.x0)) * W;
  const Y = (y: number) => ((win.y1 - y) / (win.y1 - win.y0)) * H;
  return { ...win, W, H, X, Y, S: (x, y) => ({ x: X(x), y: Y(y) }) };
}

/** A window from the board's params, falling back to defaults; always x0 < x1, y0 < y1, finite. */
export function windowFrom(params: Record<string, unknown>, def: Win): Win & { given: { x: boolean; y: boolean } } {
  const g = (k: string) => {
    const v = optNum(params[k]);
    return v !== undefined && Math.abs(v) <= 1e4 ? v : undefined;
  };
  let x0 = g("xmin") ?? def.x0, x1 = g("xmax") ?? def.x1, y0 = g("ymin") ?? def.y0, y1 = g("ymax") ?? def.y1;
  if (!(x1 > x0)) [x0, x1] = x1 < x0 ? [x1, x0] : [x0 - 1, x0 + 1];
  if (!(y1 > y0)) [y0, y1] = y1 < y0 ? [y1, y0] : [y0 - 1, y0 + 1];
  return { x0, x1, y0, y1, given: { x: g("xmin") !== undefined || g("xmax") !== undefined, y: g("ymin") !== undefined || g("ymax") !== undefined } };
}

/** The y-range a set of curves needs over [x0, x1]: their extent (trimmed when they shoot off near an asymptote), plus `must` values, with y = 0 when it is near. */
export function autoY(fs: Array<(x: number) => number>, x0: number, x1: number, must: number[] = [], trim = false): { y0: number; y1: number } {
  const ys: number[] = [];
  for (const f of fs) for (let i = 0; i <= 400; i++) {
    const y = f(x0 + ((x1 - x0) * i) / 400);
    if (Number.isFinite(y)) ys.push(y);
  }
  ys.sort((p, q) => p - q);
  if (!ys.length) return { y0: -5, y1: 5 };
  let lo = trim ? ys[Math.floor(ys.length * 0.08)] : ys[0];
  let hi = trim ? ys[Math.ceil(ys.length * 0.92) - 1] : ys[ys.length - 1];
  for (const m of must) if (Number.isFinite(m)) (lo = Math.min(lo, m)), (hi = Math.max(hi, m));
  const span = Math.max(hi - lo, 1e-6);
  if (lo > 0 && lo < span * 0.8) lo = 0;
  if (hi < 0 && -hi < span * 0.8) hi = 0;
  if (hi - lo < 1e-6) (lo -= 1), (hi += 1);
  const pad = (hi - lo) * 0.1;
  return { y0: lo - pad, y1: hi + pad };
}

/** Tick values on [lo, hi] at multiples of `step`, not too close to the ends. */
export function ticks(lo: number, hi: number, step: number): number[] {
  const out: number[] = [];
  for (let t = Math.ceil(lo / step - 1e-9) * step; t <= hi + 1e-9; t += step) {
    const v = snap(Math.round(t / step) * step);
    if (v - lo > step * 0.25 && hi - v > step * 0.25) out.push(v);
  }
  return out.slice(0, 40);
}

function piLabel(k: number): string {
  // k = multiples of π/2
  const sign = k < 0 ? "−" : "";
  const a = Math.abs(k);
  if (a % 2 === 0) return `${sign}${a / 2 === 1 ? "" : a / 2}π`;
  return `${sign}${a === 1 ? "" : a}π/2`;
}

/**
 * Light grid, axes with arrowheads (through the origin when it is in view, else along the edge),
 * tick marks and numbers, x / y letters and O. Returns where the axes sit (screen units).
 */
export function drawAxes(sk: Sketch, P: Plot, opts: { grid?: boolean; pi?: boolean; xName?: string; yName?: string; tickSize?: number; xTarget?: number; yTarget?: number } = {}) {
  const ts = opts.tickSize ?? 16;
  const axY = P.Y(clampTo(0, P.y0, P.y1));
  const axX = P.X(clampTo(0, P.x0, P.x1));
  const piStep = opts.pi && P.x1 - P.x0 > 2.5 ? (P.x1 - P.x0 > 9 * Math.PI ? 2 * Math.PI : P.x1 - P.x0 > 4.5 * Math.PI ? Math.PI : Math.PI / 2) : 0;
  const xs = piStep ? ticks(P.x0, P.x1, piStep) : ticks(P.x0, P.x1, niceStep(P.x1 - P.x0, opts.xTarget ?? 6));
  const yStep = niceStep(P.y1 - P.y0, opts.yTarget ?? 6);
  const ys = ticks(P.y0, P.y1, yStep);
  if (opts.grid !== false) {
    for (const x of xs) sk.line([{ x: P.X(x), y: 0 }, { x: P.X(x), y: P.H }], { stroke: "muted", width: 1, opacity: 0.22 }, false);
    for (const y of ys) sk.line([{ x: 0, y: P.Y(y) }, { x: P.W, y: P.Y(y) }], { stroke: "muted", width: 1, opacity: 0.22 }, false);
  }
  arrow(sk, { x: 0, y: axY }, { x: P.W + 16, y: axY }, "ink", 1.8, undefined, 11);
  arrow(sk, { x: axX, y: P.H }, { x: axX, y: -16 }, "ink", 1.8, undefined, 11);
  sk.text({ x: P.W + 24, y: axY + 15 }, opts.xName ?? "x", 19, "ink");
  sk.text({ x: axX + 15, y: -18 }, opts.yName ?? "y", 19, "ink");
  const dec = (step: number) => Math.max(0, Math.min(3, -Math.floor(Math.log10(step) + 1e-9) + (/[^0.]5|25/.test(String(step)) ? 1 : 0)));
  for (const x of xs) {
    if (Math.abs(x) < 1e-12 && axX > 0 && axX < P.W && axY > 0 && axY < P.H) continue;
    const at = { x: P.X(x), y: axY };
    sk.line([{ x: at.x, y: at.y - 4 }, { x: at.x, y: at.y + 4 }], { stroke: "ink", width: 1.5 }, false);
    const text = piStep ? piLabel(Math.round(x / (Math.PI / 2))) : fmt(x, dec(niceStep(P.x1 - P.x0, opts.xTarget ?? 6)));
    sk.text({ x: at.x, y: at.y + (axY > P.H - 22 ? 14 : 14) }, text, ts, "muted");
  }
  for (const y of ys) {
    if (Math.abs(y) < 1e-12 && axY > 0 && axY < P.H) continue;
    const at = { x: axX, y: P.Y(y) };
    sk.line([{ x: at.x - 4, y: at.y }, { x: at.x + 4, y: at.y }], { stroke: "ink", width: 1.5 }, false);
    const text = fmt(y, dec(yStep));
    sk.text({ x: at.x - 8 - (text.length * ts * 0.29), y: at.y }, text, ts, "muted");
  }
  if (P.x0 < 0 && P.x1 > 0 && P.y0 < 0 && P.y1 > 0) sk.text({ x: axX - 11, y: axY + 13 }, "O", ts, "muted");
  return { axX, axY };
}
const clampTo = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/**
 * A curve sampled across [from, to], broken at asymptotes and clipped to the window. Returns the
 * visible polylines in screen units (each drawn as its own stroke).
 */
export function curvePolylines(P: Plot, f: (x: number) => number, from = P.x0, to = P.x1, n = 360): Pt[][] {
  const lines: Pt[][] = [];
  let cur: Pt[] = [];
  const flush = () => {
    if (cur.length > 1) lines.push(cur);
    cur = [];
  };
  const H = P.y1 - P.y0;
  const xs = Array.from({ length: n + 1 }, (_, i) => from + ((to - from) * i) / n);
  const ys = xs.map(f);
  for (let i = 0; i < n; i++) {
    const xa = xs[i], xb = xs[i + 1];
    const ya = ys[i], yb = ys[i + 1];
    if (!Number.isFinite(ya) || !Number.isFinite(yb)) { flush(); continue; }
    if (Math.abs(yb - ya) > 1.5 * H) {
      const ym = f((xa + xb) / 2);
      if (!Number.isFinite(ym) || ym > Math.max(ya, yb) || ym < Math.min(ya, yb) || ya * yb < 0) { flush(); continue; }
    }
    // Clip the segment to y0..y1.
    let ta = 0, tb = 1;
    const dy = yb - ya;
    if (dy === 0) {
      if (ya < P.y0 || ya > P.y1) { flush(); continue; }
    } else {
      const t0 = (P.y0 - ya) / dy, t1 = (P.y1 - ya) / dy;
      ta = Math.max(0, Math.min(t0, t1));
      tb = Math.min(1, Math.max(t0, t1));
      if (ta > tb) { flush(); continue; }
    }
    const pa = P.S(xa + (xb - xa) * ta, ya + dy * ta), pb = P.S(xa + (xb - xa) * tb, ya + dy * tb);
    if (ta > 0) flush();
    if (!cur.length) cur.push(pa);
    cur.push(pb);
    if (tb < 1) flush();
  }
  flush();
  return lines.map(simplify);
}
/** Drop nearly collinear points (fewer segments for text placement; the line looks the same). */
function simplify(pts: Pt[]): Pt[] {
  if (pts.length < 3) return pts;
  const out = [pts[0]];
  for (let i = 1; i < pts.length - 1; i++) {
    const a = out[out.length - 1], b = pts[i], c = pts[i + 1];
    const cr = Math.abs((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x));
    if (cr > 0.6 || Math.hypot(b.x - a.x, b.y - a.y) > 30) out.push(b);
  }
  out.push(pts[pts.length - 1]);
  return out;
}

export function drawCurve(sk: Sketch, P: Plot, f: (x: number) => number, style: { stroke: Ink; width?: number; part?: string; dash?: string }, from = P.x0, to = P.x1): Pt[][] {
  const lines = curvePolylines(P, f, from, to);
  for (const l of lines) sk.line(l, { stroke: style.stroke, width: style.width ?? 2.8, part: style.part, dash: style.dash });
  return lines;
}

export const inWindow = (P: Plot, x: number, y: number, inset = 0) =>
  Number.isFinite(x) && Number.isFinite(y) && x >= P.x0 && x <= P.x1 && y >= P.y0 + inset * (P.y1 - P.y0) && y <= P.y1 - inset * (P.y1 - P.y0);

/** A point marker. */
export function dot(sk: Sketch, p: Pt, colour: Ink, part?: string, r = 5) {
  sk.circle(p, r, { fill: colour, stroke: colour, width: 1, part }, false);
}

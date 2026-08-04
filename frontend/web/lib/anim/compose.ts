/**
 * Animation composition — turning one clock into many.
 *
 * Manim gets this from AnimationGroup / Succession / LaggedStart. This codebase reinvented
 * the same three ideas in four separate places, each slightly differently:
 *
 *   - `stagger()` in LiveSketch (fixed 0.42 window, magic 1.4 fudge factor)
 *   - `transitionDelay: ${i * 40}ms` in AnimatedScene's BuildScene
 *   - the weight-cursor loop inside applyTeachingTimeline in ReactAnimationSandbox
 *   - `animationDelay` on the second chalk pass in LiveSketch's OpRenderer
 *
 * Everything here is pure alpha math: `progress in, alpha out`, no timers and no state, so
 * it works identically in a React render, inside the sandboxed iframe, and in a generated
 * animation component that is only allowed to read `progress`.
 */

import { clamp01, smooth, type RateFunc } from "./rate";

/**
 * The `clamp01((progress - start) / (end - start))` idiom, which appears roughly fifteen
 * times across LiveSketch — now with easing applied, which it never was.
 *
 * Named `phase` rather than `window` to stay clear of the DOM global, and because the
 * generated-animation prompts already talk about motion in terms of phases.
 */
export function phase(progress: number, start: number, end: number, rateFunc: RateFunc = smooth): number {
  if (end <= start) return progress >= end ? 1 : 0;
  return rateFunc(clamp01((progress - start) / (end - start)));
}

export interface LaggedOptions {
  /**
   * Fraction of one element's runtime after which the next element starts, matching Manim's
   * `lag_ratio` exactly: 0 means everything moves at once, 1 means strictly one-after-another,
   * and the useful teaching range is roughly 0.15-0.4.
   *
   * The old `stagger()` had no equivalent knob — its spacing fell out of a hardcoded window
   * divided by element count, so adding a fifth item silently sped up the other four.
   */
  lagRatio?: number;
  rateFunc?: RateFunc;
  /** Fraction of total progress to wait before the first element starts. */
  delay?: number;
}

/**
 * Manim's LaggedStart: element `i` of `n` gets its own eased 0->1 alpha, offset from its
 * neighbour by `lagRatio`. Returns 0 before the element's slot and 1 once it has landed.
 *
 * Unlike `stagger()`, the per-element duration is constant regardless of `n` — a list of
 * twelve nodes builds in at the same pace per node as a list of three, it just takes longer
 * overall. That is what makes staggered reveals read as deliberate instead of frantic.
 */
export function lagged(progress: number, i: number, n: number, options: LaggedOptions = {}): number {
  const { rateFunc = smooth } = options;
  const { start, end } = laggedRange(i, n, options);
  return phase(progress, start, end, rateFunc);
}

/**
 * The 0-1 slice of the timeline element `i` occupies under the same lag schedule.
 *
 * Needed wherever the easing is handed to something else rather than computed per frame —
 * a CSS `transition-delay`, or a SMIL `begin`. Those want a start time, not an alpha.
 */
export function laggedRange(i: number, n: number, options: LaggedOptions = {}): SuccessionRange {
  const { lagRatio = 0.25, delay = 0 } = options;
  const count = Math.max(1, n);
  const span = 1 + (count - 1) * lagRatio;
  const usable = Math.max(0.001, 1 - delay);
  return {
    start: delay + ((i * lagRatio) / span) * usable,
    end: delay + ((i * lagRatio + 1) / span) * usable,
  };
}

export interface SuccessionRange {
  start: number;
  end: number;
}

/**
 * Splits 0-1 into consecutive, non-overlapping ranges sized by `weights` — Manim's
 * Succession, where each animation owns a share of the timeline proportional to its
 * run_time.
 */
export function successionRanges(weights: number[]): SuccessionRange[] {
  const safe = weights.map((w) => Math.max(0.001, w));
  const total = safe.reduce((sum, w) => sum + w, 0) || 1;
  let cursor = 0;
  return safe.map((w) => {
    const start = cursor / total;
    cursor += w;
    return { start, end: cursor / total };
  });
}

export interface SuccessionState {
  /** Index of the step currently running (the last one started). */
  index: number;
  /** Eased 0-1 alpha within the active step. */
  local: number;
  /** Eased alpha for every step: 1 for finished steps, 0 for steps not yet reached. */
  locals: number[];
}

/**
 * Runs `weights.length` steps back to back across a single 0-1 progress value.
 *
 * This is exactly what applyTeachingTimeline computes by hand, except that version feeds a
 * raw linear alpha straight into strokeDashoffset. Manim's Create defaults to `smooth`, and
 * routing the teaching timeline through it is what makes generated boards stop looking like
 * a progress bar dragging a line across the screen.
 */
export function succession(progress: number, weights: number[], rateFunc: RateFunc = smooth): SuccessionState {
  const ranges = successionRanges(weights);
  const locals = ranges.map((r) => phase(progress, r.start, r.end, rateFunc));
  let index = 0;
  for (let i = 0; i < ranges.length; i++) {
    if (progress >= ranges[i].start) index = i;
  }
  return { index, local: locals[index] ?? 0, locals };
}

/**
 * Manim's AnimationGroup: every member runs over the same span, so one alpha drives them all.
 * Trivial, but having a name for it stops the "should this be staggered?" question being
 * re-answered ad hoc at each call site.
 */
export function group(progress: number, rateFunc: RateFunc = smooth): number {
  return rateFunc(clamp01(progress));
}

/**
 * Backwards-compatible shim for the old `stagger(progress, i, n, window)` signature.
 *
 * The original spread all elements inside the first `window` fraction of progress and eased
 * nothing. This keeps that overall shape — so existing scene templates keep their timing —
 * while routing through `smooth`. Prefer `lagged` in new code.
 */
export function stagger(progress: number, i: number, n: number, window = 0.42): number {
  const slot = window / Math.max(1, n);
  const start = 0.08 + i * slot;
  return phase(progress, start, start + slot * 1.4);
}

/**
 * Rate functions — the easing library the board engine never had.
 *
 * Every timed value in LiveSketch, ReactAnimationSandbox and the generated animations is
 * currently a raw `clamp01((t - start) / window)`: dead linear. Linear motion is the single
 * clearest "this was animated by code, not by a person" tell — real drawing accelerates out
 * of rest and decelerates into place.
 *
 * These are ports of Manim's `manim.utils.rate_functions`, which is where the equivalent
 * problem was already solved well. `smooth` is Manim's default on EVERY animation, and it is
 * the one to reach for unless there's a reason not to.
 *
 * All functions are pure `number -> number` over the unit interval, with no clock of their
 * own. That is deliberate: the generated-animation contract in drawPrompt.ts forbids timers,
 * rAF and CSS keyframes inside sandboxed components, so these can be injected into that scope
 * and called by name without breaking it.
 */

export function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Inverse of lerp: where does `value` sit between a and b, clamped to 0-1. */
export function inverseLerp(a: number, b: number, value: number): number {
  return a === b ? 1 : clamp01((value - a) / (b - a));
}

export type RateFunc = (t: number) => number;

export const linear: RateFunc = (t) => clamp01(t);

function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

/**
 * Manim's default. A sigmoid normalised so it genuinely reaches 0 and 1 at the endpoints
 * (a bare sigmoid does not), giving zero velocity at both ends — the object eases out of
 * rest and settles rather than stopping dead.
 *
 * `inflection` controls how sharp the middle is; 10 is Manim's default and reads as a
 * confident, unhurried move.
 */
export function smooth(t: number, inflection = 10): number {
  const c = clamp01(t);
  const error = sigmoid(-inflection / 2);
  return clamp01((sigmoid(inflection * (c - 0.5)) - error) / (1 - 2 * error));
}

/** Starts at full speed, decelerates into place. For things arriving from off-screen. */
export const rushInto: RateFunc = (t) => 2 * smooth(clamp01(t) / 2);

/** Accelerates from rest, ends at full speed. For things leaving. */
export const rushFrom: RateFunc = (t) => 2 * smooth(clamp01(t) / 2 + 0.5) - 1;

/** Decelerating square-root curve — quick off the mark, long gentle settle. */
export const slowInto: RateFunc = (t) => Math.sqrt(1 - (1 - clamp01(t)) ** 2);

/** Two smooths back to back; a distinct pause in the middle of the move. */
export const doubleSmooth: RateFunc = (t) => {
  const c = clamp01(t);
  return c < 0.5 ? 0.5 * smooth(2 * c) : 0.5 * (1 + smooth(2 * c - 1));
};

/**
 * Out and back again: 0 -> 1 -> 0. This is the shape behind every *emphasis* animation —
 * Manim's Indicate, Circumscribe and Flash all ride it. The board previously had no way to
 * draw attention to something and then release it; emphasis ops just drew once and stayed.
 */
export function thereAndBack(t: number, inflection = 10): number {
  const c = clamp01(t);
  return smooth(c < 0.5 ? 2 * c : 2 * (1 - c), inflection);
}

/**
 * Out, HOLD, back. `pauseRatio` is the fraction of the window spent held at full value —
 * the difference between a flicker and a beat the eye can actually land on. Use this for
 * circumscribe/indicate on anything a student needs to read.
 */
export function thereAndBackWithPause(t: number, pauseRatio = 1 / 3): number {
  const c = clamp01(t);
  const a = 1 / pauseRatio;
  if (c < 0.5 - pauseRatio / 2) return smooth(a * c);
  if (c < 0.5 + pauseRatio / 2) return 1;
  return smooth(a - a * c);
}

/** Standard CSS-style cubic ease-in-out, for parity with existing transition-based motion. */
export const easeInOutCubic: RateFunc = (t) => {
  const c = clamp01(t);
  return c < 0.5 ? 4 * c * c * c : 1 - (-2 * c + 2) ** 3 / 2;
};

/**
 * Overshoots slightly past 1, then settles back. The "pop" in pop-in.
 *
 * Endpoints are returned exactly rather than computed: the polynomial evaluates to 2.2e-16
 * at t=0 instead of 0. Visually that is nothing, but "every rate function is exactly 0 at 0
 * and exactly 1 at 1" is a property worth being able to rely on when these get composed.
 */
export const easeOutBack: RateFunc = (t) => {
  const c = clamp01(t);
  if (c <= 0) return 0;
  if (c >= 1) return 1;
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * (c - 1) ** 3 + c1 * (c - 1) ** 2;
};

/**
 * Spring-ish ease with a small overshoot (~4%) that settles.
 *
 * Moved here from LiveSketch so there is exactly one home for easing; behaviour is
 * unchanged, PopGroup and the scene-card entrance still get the same curve.
 */
export function springPop(t: number): number {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  return 1 - Math.exp(-5.2 * t) * Math.cos(9 * t);
}

/** Oscillates while going out and back — a shake. Manim's `wiggle`, for "look at THIS". */
export function wiggle(t: number, wiggles = 2): number {
  return thereAndBack(t) * Math.sin(wiggles * Math.PI * clamp01(t));
}

/**
 * The cubic-bezier control points that most closely match `smooth`, for the places that must
 * hand easing to the browser instead of computing it per frame: SVG SMIL `keySplines` and CSS
 * `transition-timing-function`. Keeping one constant here means SMIL-driven motion (the comet
 * trails in MotionRenderer) and JS-driven motion agree on how a move should feel.
 */
export const SMOOTH_SPLINE = "0.42 0 0.58 1";
export const SMOOTH_CUBIC_BEZIER = "cubic-bezier(0.42, 0, 0.58, 1)";

/**
 * Collapses any rate function to a hard step at the end state.
 *
 * Used by the reduced-motion path: a student who has asked their OS for less motion should
 * get the finished board, not a slower version of the animation.
 */
export const stepEnd: RateFunc = (t) => (t <= 0 ? 0 : 1);

/** Picks the real curve or the reduced-motion step, so callers branch in one place. */
export function withReducedMotion(rateFunc: RateFunc, reduced: boolean): RateFunc {
  return reduced ? stepEnd : rateFunc;
}

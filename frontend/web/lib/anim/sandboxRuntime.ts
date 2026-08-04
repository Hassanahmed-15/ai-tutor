/**
 * The animation helpers, as ES5 source text for injection into the sandboxed iframe.
 *
 * WHY THIS IS A SECOND COPY. ReactAnimationSandbox builds an opaque-origin iframe from a
 * `srcdoc` string with React attached as a bare global — there is no module loader in there,
 * so `import { smooth } from "./rate"` cannot work. Serialising the real functions with
 * `Function.prototype.toString()` was the obvious alternative and is a trap: the bundler
 * mangles cross-function references, so `smooth` would ship calling a `sigmoid` that does not
 * exist in the iframe scope.
 *
 * So: keep this in sync with rate.ts and compose.ts by hand. It is deliberately the minimum
 * subset — if a helper is not needed by the teaching timeline or by generated components,
 * it does not belong here.
 *
 * These names are also what generated animation code is told it may call (see drawPrompt.ts),
 * which is the point: the model gets to say `lagged(progress, i, n)` instead of receiving a
 * paragraph of English about spreading motion across the timeline.
 */
export const ANIM_SANDBOX_RUNTIME = `
  function clamp01(n) { return Math.max(0, Math.min(1, n)); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function sigmoid(x) { return 1 / (1 + Math.exp(-x)); }

  // Manim's default easing — zero velocity at both ends, so strokes ease out of rest and
  // settle instead of starting and stopping dead.
  function smooth(t, inflection) {
    var k = typeof inflection === "number" ? inflection : 10;
    var c = clamp01(t);
    var error = sigmoid(-k / 2);
    return clamp01((sigmoid(k * (c - 0.5)) - error) / (1 - 2 * error));
  }

  function rushInto(t) { return 2 * smooth(clamp01(t) / 2); }
  function rushFrom(t) { return 2 * smooth(clamp01(t) / 2 + 0.5) - 1; }

  // Out and back: the shape behind every emphasis animation.
  function thereAndBack(t, inflection) {
    var c = clamp01(t);
    return smooth(c < 0.5 ? 2 * c : 2 * (1 - c), inflection);
  }

  // Out, hold, back — the pause is what makes an emphasis readable rather than a flicker.
  function thereAndBackWithPause(t, pauseRatio) {
    var p = typeof pauseRatio === "number" ? pauseRatio : 1 / 3;
    var c = clamp01(t);
    var a = 1 / p;
    if (c < 0.5 - p / 2) return smooth(a * c);
    if (c < 0.5 + p / 2) return 1;
    return smooth(a - a * c);
  }

  // The clamp01((progress - start) / (end - start)) idiom, eased.
  function phase(progress, start, end, rateFunc) {
    var ease = rateFunc || smooth;
    if (end <= start) return progress >= end ? 1 : 0;
    return ease(clamp01((progress - start) / (end - start)));
  }

  // Manim's LaggedStart. lagRatio 0 = simultaneous, 1 = strictly sequential.
  function lagged(progress, i, n, options) {
    var opts = options || {};
    var lagRatio = typeof opts.lagRatio === "number" ? opts.lagRatio : 0.25;
    var rateFunc = opts.rateFunc || smooth;
    var delay = typeof opts.delay === "number" ? opts.delay : 0;
    var count = Math.max(1, n);
    var span = 1 + (count - 1) * lagRatio;
    var usable = Math.max(0.001, 1 - delay);
    var start = delay + (i * lagRatio) / span * usable;
    var end = delay + ((i * lagRatio + 1) / span) * usable;
    return phase(progress, start, end, rateFunc);
  }

  // Manim's Succession: consecutive non-overlapping ranges sized by weight.
  function successionRanges(weights) {
    var safe = weights.map(function (w) { return Math.max(0.001, w); });
    var total = safe.reduce(function (sum, w) { return sum + w; }, 0) || 1;
    var cursor = 0;
    return safe.map(function (w) {
      var start = cursor / total;
      cursor += w;
      return { start: start, end: cursor / total };
    });
  }
`;

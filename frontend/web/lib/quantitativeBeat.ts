/**
 * DOES THIS BEAT LOOK LIKE A CHART?
 *
 * The sandbox that draws animated boards has no axes primitive, so a beat about one quantity against
 * another has to fake a coordinate system out of loose lines — the source of a corner bracket for
 * axes, a stray tick on the x-axis, arrowheads pointing into blank space, and no axis labels. The
 * plot board (Vega-Lite) derives axes, ticks, scales and a legend from data, so none of that can
 * happen there.
 *
 * The progressive worker asks the visual director about a beat only when it looks quantitative, and
 * the director must then actually answer "plotBoard" before the animation is replaced
 * (lib/progressiveLectureWorker.ts). This is therefore a gate on ASKING, not on routing: a false
 * positive costs one director round trip, a false negative ships a hand-faked graph.
 *
 * It used to test the title alone against nine chart words. "Types of Regularization" — whose board
 * was two penalty curves, L1's V and L2's parabola — matched none of them, so the director was never
 * asked and the curves were drawn freehand. The on-screen points and the opening of the narration say
 * what the board shows; the title often only names the topic.
 */

/** Words that name a chart or its parts outright. */
const CHART_WORDS =
  /\b(?:scatter(?:\s*plot)?|plot(?:ted|ting)?|graph(?:ed|s)?|charts?|histograms?|curves?|axes|axis|x-axis|y-axis|trend\s*line|line\s+of\s+best\s+fit)\b/i;

/** The shape of a function — what a board would have to DRAW as a curve. */
const FUNCTION_SHAPES =
  /\b(?:parabol(?:a|ic)|quadratic|v-shaped?|linear(?:ly)?\s+(?:with|in|increas|decreas|grow)|exponential(?:ly)?|logarithmic|asymptot(?:e|ic)|squared\s+(?:penalt|term|error|loss|weight)|absolute[- ]value\s+(?:penalt|term|of)|sigmoid|bell[- ]shaped|normal\s+distribution|decays?\s+(?:over|with|as)|grows?\s+(?:with|as|faster|slower))\w*/i;

/** One quantity set against another. */
const AGAINST =
  /\b\w+(?:\s+\w+)?\s+(?:vs\.?|versus|against|as\s+a\s+function\s+of|plotted\s+against)\s+\w+/i;

/** A rate of change or a comparison of magnitudes over a range. */
const CHANGE =
  /\b(?:as\s+(?:\w+\s+){0,3}(?:increases|decreases|grows|shrinks|rises|falls)|(?:rises|falls|increases|decreases)\s+(?:sharply|steeply|slowly|linearly|quadratically)|slope\s+of|rate\s+of\s+change)\b/i;

/** Enough of the narration to say what the board shows, not the whole script. */
function opening(script: string | undefined, sentences = 2): string {
  const parts = (script ?? "").split(/(?<=[.!?])\s+/).filter(Boolean);
  return parts.slice(0, sentences).join(" ");
}

/**
 * Title, on-screen points and the first two sentences of narration, tested together.
 *
 * A match on any one signal is enough to ask; the director makes the real decision.
 */
export function looksQuantitative(beat: { title?: string; points?: string[]; script?: string }): boolean {
  const text = [beat.title ?? "", ...(beat.points ?? []), opening(beat.script)].join(" \n ");
  if (!text.trim()) return false;
  return CHART_WORDS.test(text) || FUNCTION_SHAPES.test(text) || AGAINST.test(text) || CHANGE.test(text);
}

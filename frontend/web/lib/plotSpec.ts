/**
 * The `plot` spec: a Vega-Lite chart.
 *
 * WHY VEGA-LITE OWNS PLOTS. It is a declarative grammar of graphics — the chart is described as
 * data plus encodings, and axes, ticks, binning and legends are derived rather than drawn. Two
 * consequences matter here: a model writes it reliably because the JSON shape is small and
 * regular, and the result is exact, because nothing about the geometry came from the model. Manim
 * produces a handsome curve but spends seconds of Python rendering a fixed video of what is
 * usually a static chart; that cost is worth paying only when the maths must MOVE, which is what
 * the `animated-maths` form is for.
 *
 * TWO-STAGE VALIDATION, deliberately:
 *  1. `validatePlotSpec` here is STRUCTURAL and dependency-free, so it can run in the CommonJS
 *     test build. vega-lite is ESM-only with a top-level await and cannot be `require()`d.
 *  2. `compilesAsVegaLite` below does the real check by compiling the spec, and runs server-side
 *     in the engine filler. That is what makes "validated" mean "renderable", the same guarantee
 *     KaTeX gives the equation board.
 */

export type PlotSpec = Record<string, unknown>;

/** Marks worth teaching with. Deliberately narrow — an LLM reaching for `arc` or `geoshape` is
 *  usually solving the wrong problem, and every one of these reads clearly at board size. */
const MARKS = new Set(["bar", "line", "point", "area", "circle", "square", "tick", "rule"]);

function markOf(spec: Record<string, unknown>): string | null {
  const mark = spec.mark;
  if (typeof mark === "string") return mark;
  if (mark && typeof mark === "object") {
    const type = (mark as Record<string, unknown>).type;
    return typeof type === "string" ? type : null;
  }
  return null;
}

/**
 * Structural check. Returns the spec with a fixed size and a sane default theme, or null.
 *
 * Requires INLINE data: `data.values`. A spec pointing at a URL would render an empty chart here
 * (the sandboxed page cannot fetch it), which is the silent-blank-board failure this lab exists to
 * stamp out.
 */
export function validatePlotSpec(raw: unknown): PlotSpec | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const spec = raw as Record<string, unknown>;

  const mark = markOf(spec);
  if (!mark || !MARKS.has(mark)) return null;

  const data = spec.data as Record<string, unknown> | undefined;
  const values = data?.values;
  if (!Array.isArray(values) || values.length === 0) return null;

  const encoding = spec.encoding;
  if (!encoding || typeof encoding !== "object") return null;
  // A chart with no positional channel is not a chart.
  const enc = encoding as Record<string, unknown>;
  if (!enc.x && !enc.y && !enc.theta) return null;

  return {
    background: "#ffffff",
    ...spec,
    // AFTER the spread, all of it. The model reliably writes `$schema: …/v5.json` from memory while
    // the installed vega-lite is v6, which vega-embed warns about on every render; and sizing is
    // the board's business, not the spec's.
    $schema: "https://vega.github.io/schema/vega-lite/v6.json",
    width: "container",
    height: 260,
    autosize: { type: "fit", contains: "padding" },
  };
}

type VegaLite = { compile: (spec: object) => unknown };

/**
 * The real guarantee: does Vega-Lite actually compile it?
 *
 * Dynamic import because vega-lite is ESM-only with a top-level await; this runs on the server
 * inside the engine filler, so a spec that would explode in the browser never reaches a panel.
 *
 * `load` is injectable for one reason: the CommonJS test build cannot `require()` an async module,
 * so the default loader throws there and every spec would look invalid. The ESM half of the suite
 * (`lib/plotCompile.test.mjs`) hands in the real module and exercises this for real.
 */
export async function compilesAsVegaLite(
  spec: PlotSpec,
  load: () => Promise<VegaLite> = () => import("vega-lite") as unknown as Promise<VegaLite>,
): Promise<boolean> {
  try {
    const vl = await load();
    // A container width cannot be compiled headlessly, so check a fixed-size copy.
    vl.compile({ ...spec, width: 400 });
    return true;
  } catch {
    return false;
  }
}

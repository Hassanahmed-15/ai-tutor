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

  const repaired = repairPlotFields(spec);
  return {
    background: "#ffffff",
    ...repaired,
    // AFTER the spread, all of it. The model reliably writes `$schema: …/v5.json` from memory while
    // the installed vega-lite is v6, which vega-embed warns about on every render; and sizing is
    // the board's business, not the spec's.
    $schema: "https://vega.github.io/schema/vega-lite/v6.json",
    width: widthFor(spec),
    /*
     * BOTH DIMENSIONS RESPONSIVE. This was a hardcoded 260.
     *
     * Width was already `"container"` while height was a pixel constant, so the chart could never
     * grow with the board it was given. On a tall lesson board that produced a short chart pinned
     * to the top with several hundred pixels of empty white beneath it — the layout bug that looks
     * like the chart failed to load. Vega only honours a container height when the parent element
     * has a definite one, which `PlotBoard` now guarantees.
     */
    height: "container",
    autosize: { type: "fit", contains: "padding" },
    /*
     * Interior margin, so edge marks and their labels are not clipped by the card.
     *
     * `autosize: fit` sizes the PLOT to the container but does not reserve room for a label that
     * overhangs the plot's own edge — the first category's tick label ("Jan") sits centred under a
     * bar that starts at x=0, so half of it fell outside the SVG. A few pixels of padding on each
     * side is all that is needed, and it costs nothing at any board size.
     */
    padding: { left: 8, right: 8, top: 8, bottom: 8 },
    /*
     * Theme. Placed after the spread so the board owns presentation, exactly as it owns sizing —
     * but note `config` is MERGED with any model-supplied config rather than replacing it, below.
     *
     * The chart is a white card on a dark lesson board and is read from across a room, so this
     * leans on the two things that survive distance: generous whitespace and a recessive grid. The
     * palette is the validated categorical set (see `PLOT_SERIES_COLORS`), not Vega's stock hues.
     */
    config: mergeConfig(repaired.config, PLOT_THEME),
  };
}

/*
 * THE EMPTY-CHART BUG. A student asked "why does overfitting happen?" and got a board with axes, a
 * 2-10 x range and a Training/Test legend — and no lines. That is what Vega draws when an encoding
 * names a field the rows do not have ("accuracy" against rows keyed "Accuracy (%)"), or when a
 * quantitative field holds strings ("85%"): the scales and legend still come from the fields that
 * DO match, the marks come from the one that does not, and nothing fails. The structural check only
 * asked that some data exist, and the compiler is happy with any field name — so the empty chart
 * was "valid" twice over. These two functions close that: repair what can be repaired for free, and
 * name what cannot so the existing retry asks the model to fix it.
 */

const CHANNELS = ["x", "y", "x2", "y2", "theta", "color", "size", "shape", "strokeDash", "opacity", "detail", "text"] as const;

function normalizeKey(value: string): string {
  return value.toLowerCase().replace(/\(.*?\)/g, "").replace(/[^a-z0-9]/g, "");
}

function rowsOf(spec: Record<string, unknown>): Array<Record<string, unknown>> {
  const values = (spec.data as { values?: unknown[] } | undefined)?.values;
  return Array.isArray(values)
    ? values.filter((row): row is Record<string, unknown> => !!row && typeof row === "object" && !Array.isArray(row))
    : [];
}

/** Fields a transform creates, so an encoding that uses one is not mistaken for a typo. */
function transformFields(spec: Record<string, unknown>): { fields: Set<string>; unknowable: boolean } {
  const fields = new Set<string>();
  let unknowable = false;
  const transforms = Array.isArray(spec.transform) ? spec.transform : [];
  for (const raw of transforms) {
    if (!raw || typeof raw !== "object") continue;
    const t = raw as Record<string, unknown>;
    const as = t.as;
    if (typeof as === "string") fields.add(as);
    if (Array.isArray(as)) as.forEach((name) => typeof name === "string" && fields.add(name));
    if (t.fold && !as) ["key", "value"].forEach((name) => fields.add(name));
    if (t.density && !as) ["value", "density"].forEach((name) => fields.add(name));
    for (const listKey of ["aggregate", "window", "joinaggregate"]) {
      const list = t[listKey];
      if (Array.isArray(list)) list.forEach((item) => item && typeof item === "object" && typeof (item as Record<string, unknown>).as === "string" && fields.add((item as Record<string, unknown>).as as string));
    }
    // A pivot's output columns are the DATA's values; they cannot be known from the spec.
    if (t.pivot) unknowable = true;
  }
  return { fields, unknowable };
}

function toNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  const match = value.trim().match(/^[-+]?\d*\.?\d+(?:e[-+]?\d+)?\s*%?$/i);
  return match ? Number.parseFloat(value) : null;
}

/**
 * Free repairs, applied before anything is judged: an encoding field that differs from a real column
 * only by case, spacing, punctuation or a "(%)" suffix is pointed at that column, and a quantitative
 * column of number strings ("85%", "0.9") becomes numbers. Returns a new spec; never mutates.
 */
export function repairPlotFields(spec: Record<string, unknown>): Record<string, unknown> {
  const rows = rowsOf(spec);
  if (rows.length === 0 || !spec.encoding || typeof spec.encoding !== "object") return spec;
  const keys = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  const { fields: derived } = transformFields(spec);
  const encoding = { ...(spec.encoding as Record<string, unknown>) };
  const numericFields = new Set<string>();

  for (const channel of CHANNELS) {
    const def = encoding[channel];
    if (!def || typeof def !== "object" || Array.isArray(def)) continue;
    const d = { ...(def as Record<string, unknown>) };
    const field = typeof d.field === "string" ? d.field : null;
    if (field && !keys.includes(field) && !derived.has(field)) {
      const wanted = normalizeKey(field);
      const title = typeof d.title === "string" ? normalizeKey(d.title) : "";
      const match = keys.find((key) => normalizeKey(key) === wanted) ?? (title ? keys.find((key) => normalizeKey(key) === title) : undefined);
      if (match) d.field = match;
    }
    if (d.type === "quantitative" && typeof d.field === "string") numericFields.add(d.field);
    encoding[channel] = d;
  }

  /*
   * FRACTIONS ON A PERCENT AXIS. "Accuracy (%)" with a fixed 0-100 domain and values 0.62-0.99:
   * both lines sit on the x-axis, under the axis line — the chart looks empty. When a quantitative
   * position's own domain or title says percent and every value is a fraction, the values are
   * percents written as fractions, and are scaled.
   */
  const percentFields = new Set<string>();
  for (const channel of ["x", "y"] as const) {
    const d = encoding[channel] as Record<string, unknown> | undefined;
    if (!d || d.type !== "quantitative" || typeof d.field !== "string") continue;
    const domain = (d.scale as { domain?: unknown } | undefined)?.domain;
    const percentAxis =
      (Array.isArray(domain) && Number(domain[1]) === 100) ||
      /%|percent/i.test(`${d.field} ${typeof d.title === "string" ? d.title : ""}`);
    const numbers = rows.map((row) => toNumber(row[d.field as string])).filter((n): n is number => n !== null);
    if (percentAxis && numbers.length >= 2 && numbers.every((n) => n >= 0 && n <= 1) && numbers.some((n) => n > 0)) {
      percentFields.add(d.field);
    }
  }

  const values = rows.map((row) => {
    let changed = false;
    const next = { ...row };
    for (const field of numericFields) {
      if (typeof next[field] === "string") {
        const n = toNumber(next[field]);
        if (n !== null) {
          next[field] = n;
          changed = true;
        }
      }
    }
    for (const field of percentFields) {
      const n = toNumber(next[field]);
      if (n !== null) {
        next[field] = Math.round(n * 1000) / 10;
        changed = true;
      }
    }
    return changed ? next : row;
  });

  return { ...spec, encoding, data: { ...(spec.data as Record<string, unknown>), values } };
}

/**
 * Why this chart would draw no marks, or null when every mark has data.
 *
 * A positional or colour encoding must name a column the rows (or a transform) actually have, and a
 * quantitative position must hold at least two numbers. Anything else is an empty chart that the
 * compiler would accept.
 */
export function plotFieldIssue(spec: Record<string, unknown>): string | null {
  const rows = rowsOf(spec);
  if (rows.length === 0) return "data.values has no rows";
  const keys = new Set(rows.flatMap((row) => Object.keys(row)));
  const { fields: derived, unknowable } = transformFields(spec);
  if (unknowable) return null;
  const encoding = (spec.encoding ?? {}) as Record<string, unknown>;
  for (const channel of CHANNELS) {
    const def = encoding[channel];
    if (!def || typeof def !== "object" || Array.isArray(def)) continue;
    const d = def as Record<string, unknown>;
    const field = typeof d.field === "string" ? d.field.split(".")[0] : null;
    if (!field) continue;
    if (!keys.has(field) && !derived.has(field)) {
      return `encoding.${channel}.field is "${field}" but the data rows have no such column (they have: ${[...keys].join(", ")}) — the marks would draw nothing`;
    }
    if ((channel === "x" || channel === "y") && d.type === "quantitative" && !derived.has(field) && !d.aggregate) {
      const numbers = rows.map((row) => toNumber(row[field])).filter((n): n is number => n !== null);
      if (numbers.length < 2) return `encoding.${channel} is quantitative but column "${field}" holds fewer than two numbers — the marks would draw nothing`;
      // Data squeezed into a sliver of a fixed domain draws on top of the axis and reads as empty.
      const domain = (d.scale as { domain?: unknown } | undefined)?.domain;
      if (Array.isArray(domain) && domain.length === 2 && typeof domain[0] === "number" && typeof domain[1] === "number" && domain[1] > domain[0]) {
        const span = (Math.max(...numbers) - Math.min(...numbers)) / (domain[1] - domain[0]);
        const inside = numbers.filter((n) => n >= (domain[0] as number) && n <= (domain[1] as number)).length / numbers.length;
        if (inside < 0.5 || (span < 0.03 && Math.max(...numbers) < (domain[0] as number) + 0.03 * (domain[1] - domain[0]))) {
          return `encoding.${channel}.scale.domain is [${domain[0]}, ${domain[1]}] but column "${field}" runs ${Math.min(...numbers)}-${Math.max(...numbers)}, so the marks sit flat on the axis — make the values and the domain use the same units`;
        }
      }
    }
  }
  return null;
}

/**
 * Categorical series colors, in fixed assignment order.
 *
 * Validated as a set rather than chosen by eye — `scripts/validate_palette.js` in the dataviz
 * skill, light mode against the card's white surface, under the strict `--pairs all` rule so the
 * same three are safe for scatter and point marks where any pair can end up adjacent:
 *
 *     CVD separation        worst pair ΔE 9.2 (deutan)   — target ≥ 8
 *     Normal-vision floor   worst pair ΔE 24.0           — floor ≥ 15
 *
 * Fixed order matters: a series keeps its color when a filter changes how many series are on
 * screen, so colour follows the entity and never its rank. Beyond three the categorical set stops
 * clearing the all-pairs floors, which is why the prompt asks for one clear series and at most
 * three — a cap that is a legibility rule, not a style preference.
 */
export const PLOT_SERIES_COLORS = ["#2a78d6", "#eb6834", "#1baf7a"] as const;

/**
 * How wide the plot should be: fill the board, or size itself from the data?
 *
 * WHY THIS IS NOT ALWAYS `"container"`. A discrete axis divides whatever width it is given among
 * its categories, so the FEWER the categories the WIDER each bar — a two-bar comparison stretched
 * across a full board produced 249px slabs that read as background panels rather than quantities.
 * Padding alone cannot fix it: the value that tames two bars (0.55) starves twelve of them down to
 * 30px, so one global number is a compromise between two charts instead of a fix for either.
 *
 * Vega's `{step}` sizing inverts the relationship — width is DERIVED from the category count, so
 * each bar gets a fixed slot and the plot is as wide as it needs to be. Above the threshold there
 * are enough categories that filling the board is the right answer again, and `"container"`
 * returns. The chart stays centred either way because `PlotBoard` centres its host.
 *
 * Only discrete-x charts are affected. A line or scatter over a quantitative axis has no band to
 * divide and should always fill the frame.
 */
function widthFor(spec: Record<string, unknown>): string | { step: number } {
  const encoding = spec.encoding as Record<string, unknown> | undefined;
  const x = encoding?.x as Record<string, unknown> | undefined;
  const type = typeof x?.type === "string" ? x.type : null;
  if (type !== "nominal" && type !== "ordinal") return "container";

  const values = (spec.data as { values?: unknown[] } | undefined)?.values;
  if (!Array.isArray(values)) return "container";
  const field = typeof x?.field === "string" ? x.field : null;
  if (!field) return "container";

  const categories = new Set(
    values
      .filter((row): row is Record<string, unknown> => !!row && typeof row === "object")
      .map((row) => String(row[field])),
  ).size;

  // Past this many, the bars are thin enough that filling the board is right again.
  if (categories === 0 || categories > 7) return "container";
  // Each category gets this much room; at 0.3 inner padding that lands a bar near 100px.
  return { step: 140 };
}

/**
 * Presentation defaults for every chart.
 *
 * Aimed at the anti-patterns the stock theme walks into on a teaching board: thick saturated
 * blocks, a grid as loud as the data, and labels rotated vertical because the bars are too wide.
 */
const PLOT_THEME = {
  // No outer frame: the white card already is the frame, and a second border around the plot is
  // two boxes saying one thing.
  view: { stroke: null as string | null, continuousWidth: 400, continuousHeight: 260 },
  font: "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif",
  axis: {
    // A hairline grid that the marks sit on top of rather than compete with.
    gridColor: "#e8e8e6",
    gridWidth: 1,
    domainColor: "#c9c9c6",
    tickColor: "#c9c9c6",
    labelColor: "#52514e",
    titleColor: "#0b0b0b",
    labelFontSize: 13,
    titleFontSize: 14,
    titleFontWeight: 600,
    titlePadding: 10,
    labelPadding: 6,
    // Never rotate labels. Vega rotates to 90° when labels collide, which is what turned the axis
    // into unreadable vertical text; letting it drop labels instead keeps the survivors horizontal.
    labelAngle: 0,
    labelOverlap: "greedy",
    labelSeparation: 6,
    /*
     * A GRIDLINE BUDGET. Vega sizes tick count from the axis's pixel length, so a chart that now
     * fills a tall board asked for a line every 5 units — 21 of them behind two bars. The grid
     * exists to let a reader estimate a value, and past about six lines each additional one adds
     * noise rather than precision.
     */
    tickCount: 6,
  },
  legend: {
    labelColor: "#52514e",
    titleColor: "#0b0b0b",
    labelFontSize: 13,
    titleFontSize: 13,
    titleFontWeight: 600,
    symbolType: "square",
    symbolSize: 110,
    offset: 14,
    // The legend is always present for two or more series, so identity is never colour alone.
    orient: "right",
  },
  title: { color: "#0b0b0b", fontSize: 16, fontWeight: 700, anchor: "start", offset: 12 },
  range: { category: PLOT_SERIES_COLORS as unknown as string[] },
  /*
   * The gap between categories, as a share of the step.
   *
   * 0.3 is a compromise between the two shapes this board actually draws, chosen by measuring both
   * rather than by taste:
   *
   *     padding   2 categories        12 categories
   *     0.55      160px (good)        30px (too thin to read)
   *     0.30      ~225px (acceptable) ~47px (comfortable)
   *
   * One global number cannot be ideal for both — a 2-bar chart wants a lot of padding and a 12-bar
   * chart wants little — and the cost of erring toward the wide end is cosmetic, while the cost of
   * erring thin is a bar the student cannot see. So this leans to the safe side of that trade.
   */
  scale: { bandPaddingInner: 0.3 },
  /*
   * Thin marks with breathing room, and a HARD PIXEL CAP on bar width.
   *
   * A band ratio alone does not solve this: `{band: 0.62}` of a 400px category step is still a
   * 250px bar. With only two or three categories — the common case for a teaching comparison —
   * Vega spreads them across the whole board and each bar reads as a background panel rather than
   * a quantity. `maxBandSize` bounds the mark in pixels regardless of how few categories there
   * are, which is the only control that holds at both 2 bars and 12.
   */
  bar: {
    /*
     * Bar width is controlled on the SCALE, not here. Two things were tried first and neither
     * works, both verified by measuring the rendered marks rather than reading the docs:
     *
     *   discreteBandSize: {band: 0.62}   a share of the step — a 320px step still gives a 198px bar
     *   maxBandSize: 96                  ignored for discrete bands; the 2-bar case grew to 320px
     *
     * `scale.paddingInner` (below) is the one that holds, because it widens the GAP between
     * categories rather than describing the mark, so the fewer the categories the more space it
     * reclaims — which is exactly the case that was broken.
     */
    cornerRadiusEnd: 4,
    color: PLOT_SERIES_COLORS[0],
  },
  line: { strokeWidth: 2.5, color: PLOT_SERIES_COLORS[0] },
  point: { size: 70, filled: true, color: PLOT_SERIES_COLORS[0] },
  area: { line: true, opacity: 0.22, color: PLOT_SERIES_COLORS[0] },
  tick: { thickness: 2, color: PLOT_SERIES_COLORS[0] },
  rule: { strokeWidth: 2, color: PLOT_SERIES_COLORS[0] },
} as const;

/**
 * Merge the board's theme under anything the model deliberately set.
 *
 * A plain override would discard a model `config` wholesale; a plain spread would let a model that
 * echoes Vega's defaults silently undo the whole theme. Merging one level deep keeps the board's
 * defaults for every key the model did not mention, which is almost all of them.
 */
function mergeConfig(modelConfig: unknown, theme: Record<string, unknown>): Record<string, unknown> {
  if (!modelConfig || typeof modelConfig !== "object" || Array.isArray(modelConfig)) {
    return theme;
  }
  const merged: Record<string, unknown> = { ...theme };
  for (const [key, value] of Object.entries(modelConfig as Record<string, unknown>)) {
    const base = theme[key];
    merged[key] =
      base && typeof base === "object" && !Array.isArray(base) &&
      value && typeof value === "object" && !Array.isArray(value)
        ? { ...(base as object), ...(value as object) }
        : value;
  }
  return merged;
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
    // Neither container dimension can be compiled headlessly (there is no container), so check a
    // fixed-size copy. Height is overridden here too now that it is `"container"` as well —
    // without it every spec would fail to compile and the whole board would be reported invalid.
    vl.compile({ ...spec, width: 400, height: 260 });
    return true;
  } catch {
    return false;
  }
}

/**
 * The `manimScene` spec: what the model is allowed to ask Manim to draw, and the validator
 * that enforces it.
 *
 * WHY A SPEC AND NOT CODE. The model never writes Python. It picks one of four scene kinds
 * and fills in numbers, and this rejects anything that is not exactly that. The renderer
 * therefore has no path from model output to execution — no `eval`, no expression parser, no
 * sandbox to get right.
 *
 * Curves are the place that pressure shows up: a model naturally wants to write
 * `"y = 1000 * 1.08^x"`. It cannot. It names a shape from a fixed family and supplies
 * coefficients, and `_curve_fn` in scripts/manim/scenes.py turns that into a Python lambda
 * chosen by us. An expression string is not "sanitised" here, it is simply not representable.
 *
 * Plain module (no "server-only"): the validator runs on the server, but the types are shared
 * with the client renderer path.
 */

export type CurveFn =
  | "linear"
  | "quadratic"
  | "exponentialGrowth"
  | "exponentialDecay"
  | "sine"
  | "logistic"
  | "inverse"
  | "sqrt";

export const CURVE_FNS: ReadonlySet<string> = new Set<CurveFn>([
  "linear",
  "quadratic",
  "exponentialGrowth",
  "exponentialDecay",
  "sine",
  "logistic",
  "inverse",
  "sqrt",
]);

export type ManimSceneKind = "graph" | "transform" | "flow" | "geometry";
export const SCENE_KINDS: ReadonlySet<string> = new Set<ManimSceneKind>([
  "graph",
  "transform",
  "flow",
  "geometry",
]);

const SHAPES: ReadonlySet<string> = new Set(["square", "circle", "triangle", "rect"]);
const GEOMETRY_MODES: ReadonlySet<string> = new Set(["vector", "angle", "brace"]);

export type ManimSceneSpec = Record<string, unknown> & { kind: ManimSceneKind };

/* ----------------------------------------------------------------- helpers */

function num(value: unknown, fallback: number, min: number, max: number): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function text(value: unknown, maxLen: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, maxLen) : undefined;
}

/** Only real hex colours survive; a colour name or CSS expression is dropped, not guessed at. */
function colour(value: unknown): string | undefined {
  return typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value.trim()) ? value.trim() : undefined;
}

function compact<T extends object>(obj: T): T {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as T;
}

/* --------------------------------------------------------------- validation */

/**
 * Returns a clean spec, or null if it cannot be made safe and renderable.
 *
 * Null is the right answer for junk rather than a repaired guess: the caller falls back to the
 * live SVG board, which always works. A wrong-but-rendered graph teaches the wrong thing.
 */
export function validateManimSceneSpec(raw: unknown): ManimSceneSpec | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const kind = typeof o.kind === "string" ? o.kind.trim() : "";
  if (!SCENE_KINDS.has(kind)) return null;

  const title = text(o.title, 60);

  if (kind === "graph") {
    const xMin = num(o.xMin, 0, -1e6, 1e6);
    const xMax = num(o.xMax, xMin + 10, -1e6, 1e6);
    const yMin = num(o.yMin, 0, -1e9, 1e9);
    const yMax = num(o.yMax, yMin + 10, -1e9, 1e9);
    // A zero or inverted range renders as a division by zero or an empty plot.
    if (!(xMax > xMin) || !(yMax > yMin)) return null;

    const curves = (Array.isArray(o.curves) ? o.curves : [])
      .slice(0, 2)
      .map((c) => {
        if (!c || typeof c !== "object") return null;
        const cs = c as Record<string, unknown>;
        const fn = typeof cs.fn === "string" ? cs.fn.trim() : "";
        // The whole safety story: an unrecognised function name is dropped. There is no
        // fallback to "evaluate whatever they wrote".
        if (!CURVE_FNS.has(fn)) return null;

        const area =
          cs.area && typeof cs.area === "object"
            ? (() => {
                const a = cs.area as Record<string, unknown>;
                const from = num(a.from, xMin, xMin, xMax);
                const to = num(a.to, xMax, xMin, xMax);
                return to > from ? { from, to } : undefined;
              })()
            : undefined;

        return compact({
          fn,
          a: num(cs.a, 1, -1e6, 1e6),
          b: num(cs.b, 0, -1e6, 1e6),
          c: num(cs.c, 0, -1e6, 1e6),
          label: text(cs.label, 24),
          color: colour(cs.color),
          area,
          trackPoint: cs.trackPoint === true || undefined,
        });
      })
      .filter((c): c is NonNullable<typeof c> => c !== null);

    if (curves.length === 0) return null; // a graph with no curve is just axes

    return compact({
      kind: "graph",
      title,
      xLabel: text(o.xLabel, 24),
      yLabel: text(o.yLabel, 24),
      xMin,
      xMax,
      yMin,
      yMax,
      curves,
    }) as ManimSceneSpec;
  }

  if (kind === "transform") {
    const stages = (Array.isArray(o.stages) ? o.stages : [])
      .slice(0, 4)
      .map((s) => {
        if (!s || typeof s !== "object") return null;
        const st = s as Record<string, unknown>;
        const shape = typeof st.shape === "string" ? st.shape.trim() : "";
        if (!SHAPES.has(shape)) return null;
        return compact({ shape, caption: text(st.caption, 40), color: colour(st.color) });
      })
      .filter((s): s is NonNullable<typeof s> => s !== null);

    // One shape is not a transformation — there is nothing to become.
    if (stages.length < 2) return null;
    return compact({ kind: "transform", title, stages }) as ManimSceneSpec;
  }

  if (kind === "flow") {
    const stages = (Array.isArray(o.stages) ? o.stages : [])
      .slice(0, 4)
      .map((s) => text(s, 18))
      .filter((s): s is string => !!s);
    if (stages.length < 2) return null;
    return compact({ kind: "flow", title, stages }) as ManimSceneSpec;
  }

  // geometry
  const mode = typeof o.mode === "string" && GEOMETRY_MODES.has(o.mode.trim()) ? o.mode.trim() : "vector";
  if (mode === "angle") {
    return compact({ kind: "geometry", title, mode, degrees: num(o.degrees, 45, 5, 175), color: colour(o.color) }) as ManimSceneSpec;
  }
  if (mode === "brace") {
    return compact({ kind: "geometry", title, mode, measure: text(o.measure, 22), color: colour(o.color) }) as ManimSceneSpec;
  }

  const vectors = (Array.isArray(o.vectors) ? o.vectors : [])
    .slice(0, 2)
    .map((v) => {
      if (!v || typeof v !== "object") return null;
      const vs = v as Record<string, unknown>;
      const dx = num(vs.dx, 0, -6, 6);
      const dy = num(vs.dy, 0, -3.5, 3.5);
      if (dx === 0 && dy === 0) return null; // a zero vector draws nothing
      return compact({ dx, dy, label: text(vs.label, 12), color: colour(vs.color) });
    })
    .filter((v): v is NonNullable<typeof v> => v !== null);

  if (vectors.length === 0) return null;
  return compact({
    kind: "geometry",
    title,
    mode: "vector",
    vectors,
    showResultant: (o.showResultant === true && vectors.length === 2) || undefined,
    color: colour(o.color),
  }) as ManimSceneSpec;
}

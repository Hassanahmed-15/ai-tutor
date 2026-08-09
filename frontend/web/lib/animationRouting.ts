import { isManimWorthy } from "./manimRouting";

/**
 * One capability-based policy for the lesson's visual renderers.
 *
 * Generated React/SVG owns its sandboxed board. Explicit Manim specs own quantitative or
 * geometric video scenes. GSAP takes only structured SVG scripts it can reproduce completely,
 * and LiveSketch remains the lossless handwriting/fallback renderer.
 */

type DrawOpLike = {
  kind?: string;
  shape?: string;
  toShape?: string;
  spec?: unknown;
};

type DrawScriptLike = { ops?: DrawOpLike[] };

export type AnimationRenderer = "react-svg" | "manim" | "gsap" | "structure" | "plot" | "equation" | "live-svg";

export type RendererSelection = {
  renderer: AnimationRenderer;
  reason:
    | "generated-react-svg"
    | "explicit-manim-scene"
    | "scrubbable-svg-morph"
    | "structural-diagram"
    | "data-chart"
    | "worked-derivation"
    | "diagram-or-motion"
    | "handwriting-or-unsupported";
};

export type RendererAvailability = {
  gsapEnabled?: boolean;
  manimEnabled?: boolean;
};

/** GsapSketch's deliberately narrow, fully-rendered vocabulary. */
const GSAP_KINDS = new Set([
  "shape",
  "label",
  "note",
  "arrow",
  "morph",
  "indicate",
  "circumscribe",
  "flash",
]);

const GSAP_SHAPES = new Set(["circle", "rect", "hexagon", "line", "chain", "leaf", "droplet"]);

function opsOf(script: unknown): DrawOpLike[] {
  const ops = (script as DrawScriptLike)?.ops;
  return Array.isArray(ops) ? ops.filter((op): op is DrawOpLike => !!op && typeof op === "object") : [];
}

function gsapSupportsOp(op: DrawOpLike): boolean {
  if (!op.kind || !GSAP_KINDS.has(op.kind)) return false;
  if (op.kind !== "shape" && op.kind !== "morph") return true;
  const shape = op.shape ?? "circle";
  if (!GSAP_SHAPES.has(shape)) return false;
  return !op.toShape || GSAP_SHAPES.has(op.toShape);
}

/**
 * GSAP is selected for its actual advantage here: a live, reversible path morph. Plain
 * writing stays on LiveSketch; quantitative/geometry scenes remain Manim's job.
 */
export function isGsapWorthy(script: unknown): boolean {
  const ops = opsOf(script);
  if (ops.length === 0 || !ops.every(gsapSupportsOp)) return false;
  return ops.some((op) => op.kind === "morph");
}

/** Select by renderer capability, never by beat position or a topic-keyword guess. */
export function selectAnimationRenderer(
  script: unknown,
  availability: RendererAvailability = {},
): RendererSelection {
  const ops = opsOf(script);
  const gsapEnabled = availability.gsapEnabled !== false;
  const manimEnabled = availability.manimEnabled === true;

  // FIRST, deliberately ahead of the reactAnimation rule below. A structural beat carries a
  // validated spec whose geometry is computed by a layout engine, so it is the one board type
  // guaranteed not to overlap or clip — it should never lose to a generated-code board that
  // merely happens to also be present.
  if (ops.some((op) => op.kind === "structureScene" && op.spec)) {
    return { renderer: "structure", reason: "structural-diagram" };
  }

  // The two spec-driven boards sit at the same precedence and for the same reason: their geometry
  // is computed by the renderer (Vega-Lite derives every axis and tick, KaTeX does the typesetting),
  // so neither can overlap or clip, and neither should lose to a generated-code board that merely
  // happens to also be present on the beat.
  if (ops.some((op) => op.kind === "plotBoard" && op.spec)) {
    return { renderer: "plot", reason: "data-chart" };
  }
  if (ops.some((op) => op.kind === "equationBoard" && op.spec)) {
    return { renderer: "equation", reason: "worked-derivation" };
  }

  // A generated-code board cannot be translated safely or faithfully by another renderer.
  if (ops.some((op) => op.kind === "reactAnimation")) {
    return { renderer: "react-svg", reason: "generated-react-svg" };
  }

  if (manimEnabled && ops.some((op) => op.kind === "manimScene" && op.spec)) {
    return { renderer: "manim", reason: "explicit-manim-scene" };
  }

  // Prefer a live GSAP morph over spending CPU to turn the same simple vector script into MP4.
  if (gsapEnabled && isGsapWorthy(script)) {
    return { renderer: "gsap", reason: "scrubbable-svg-morph" };
  }

  if (manimEnabled && isManimWorthy(script)) {
    return { renderer: "manim", reason: "diagram-or-motion" };
  }

  return { renderer: "live-svg", reason: "handwriting-or-unsupported" };
}


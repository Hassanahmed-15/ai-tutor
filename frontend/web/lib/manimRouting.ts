/**
 * Decides whether a DrawScript is worth rendering with Manim.
 *
 * Manim costs seconds of CPU per beat and produces a fixed video. It earns that on diagrams
 * and motion — a mechanism moving, a relationship being drawn, something being circled. It
 * earns nothing on a page of notes, and actively LOSES something: LiveSketch writes text
 * word-by-word with a marker following the nib, which a pre-rendered video cannot reproduce.
 *
 * This matters more than it sounds. Every generated lecture beat inspected in the render
 * cache was exactly this shape: two or three text lines plus three vertical rule marks, no
 * motion at all. Sending those to Manim spent the CPU, dropped the handwriting effect, and
 * gave nothing back.
 *
 * Plain module (no "server-only"): both the client-side prefetch filter and VisualDirector
 * need the same answer, and they must agree or a beat gets rendered but never shown.
 */

type DrawOpLike = { kind?: string; shape?: string; spec?: unknown };
type DrawScriptLike = { ops?: DrawOpLike[] };

/** Ops whose whole point is movement — any one of these justifies a render on its own. */
const ANIMATED_KINDS = new Set(["motion", "morph", "indicate", "circumscribe", "flash"]);

/**
 * `line` and `chain` shapes are rule marks, underlines and connectors — page furniture, not
 * diagram geometry. This distinction is the whole predicate: every real beat carries exactly
 * three `shape: "line"` ops, so counting bare `shape` ops would call them all diagrams and
 * change nothing.
 */
function isRuleMark(op: DrawOpLike): boolean {
  return op.kind === "shape" && (op.shape === "line" || op.shape === "chain");
}

export function isManimWorthy(script: unknown): boolean {
  const ops = (script as DrawScriptLike)?.ops;
  if (!Array.isArray(ops) || ops.length === 0) return false;

  // An explicit request from the model: it chose the diagram board because the content is a
  // curve, a transformation or a measured construction. Trust that over any heuristic — but
  // only once the spec has actually been filled in, since an unfilled op renders nothing.
  if (ops.some((op) => op?.kind === "manimScene" && op?.spec)) return true;

  // Ops Manim cannot draw at all. A beat built around one has nothing to gain here.
  if (ops.some((op) => op?.kind === "reactAnimation" || op?.kind === "chalkBoard")) return false;

  if (ops.some((op) => op?.kind && ANIMATED_KINDS.has(op.kind))) return true;

  const realShapes = ops.filter((op) => op?.kind === "shape" && !isRuleMark(op)).length;
  if (realShapes >= 2) return true;

  // One drawn object plus an arrow is a relationship — a diagram, if a minimal one.
  return realShapes >= 1 && ops.some((op) => op?.kind === "arrow");
}

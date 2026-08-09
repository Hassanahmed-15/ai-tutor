"use client";

/**
 * A small corner label naming which engine drew the board you are looking at.
 *
 * A lesson deliberately mixes renderers — a `reactAnimation` beat runs LLM-authored React in
 * a sandboxed iframe, a plain DrawScript beat can be pre-rendered by Manim, and everything
 * else is the live SVG board. They are close enough in style that it is otherwise impossible
 * to tell which one you are watching, which makes comparing their quality (or debugging one
 * of them) guesswork.
 *
 * Sits top-LEFT deliberately: LiveSketch already owns the top-right corner with its op
 * counter, and ManimBoard owns bottom-left with its unsupported-ops notice.
 */

export type RendererKind = "manim" | "gsap" | "structure" | "plot" | "equation" | "sandbox" | "svg";

// Colour has to do the work at a glance: at this size the label text is what the eye reads,
// so the tint sits at the -300 shade rather than a near-white -100. A pale label plus a 6px
// dot is not a distinction anyone can make from across a screen.
const LABELS: Record<RendererKind, { text: string; dot: string; tint: string; title: string }> = {
  manim: {
    text: "Manim",
    dot: "bg-emerald-300 shadow-[0_0_6px_rgba(110,231,183,0.9)]",
    tint: "text-emerald-300 ring-emerald-400/40",
    title: "Pre-rendered video from Python Manim, scrubbed by narration progress",
  },
  structure: {
    text: "Diagram · ELK",
    dot: "bg-teal-300 shadow-[0_0_6px_rgba(94,234,212,0.9)]",
    tint: "text-teal-300 ring-teal-400/40",
    title: "Nodes and edges from the model, every position computed by the ELK layout engine",
  },
  plot: {
    text: "Chart · Vega-Lite",
    dot: "bg-lime-300 shadow-[0_0_6px_rgba(190,242,100,0.9)]",
    tint: "text-lime-300 ring-lime-400/40",
    title: "Data and encodings from the model, every axis and tick derived by Vega-Lite",
  },
  equation: {
    text: "Derivation · KaTeX",
    dot: "bg-sky-300 shadow-[0_0_6px_rgba(125,211,252,0.9)]",
    tint: "text-sky-300 ring-sky-400/40",
    title: "A worked derivation typeset by KaTeX, each step revealed with its justification",
  },
  // Key stays `gsap` (it is the renderer id threaded through animationRouting/LessonPlayer and
  // asserted in lib/anim/anim.test.ts); only the engine underneath changed. The LABEL must name
  // what actually runs, or the badge lies about which engine drew the board.
  gsap: {
    text: "Anime.js · SVG",
    dot: "bg-amber-300 shadow-[0_0_6px_rgba(252,211,77,0.9)]",
    tint: "text-amber-300 ring-amber-400/40",
    title: "Live structured SVG timeline, scrubbed by narration progress with anime.js",
  },
  sandbox: {
    text: "React · sandbox",
    dot: "bg-fuchsia-300 shadow-[0_0_6px_rgba(240,171,252,0.9)]",
    tint: "text-fuchsia-300 ring-fuchsia-400/40",
    title: "Model-authored React/SVG running live in a sandboxed iframe",
  },
  svg: {
    text: "React · SVG",
    dot: "bg-sky-300 shadow-[0_0_6px_rgba(125,211,252,0.9)]",
    tint: "text-sky-300 ring-sky-400/40",
    title: "Live hand-drawn SVG board (LiveSketch), drawn as the narration speaks",
  },
};

export function RendererBadge({ kind }: { kind: RendererKind }) {
  const { text, dot, tint, title } = LABELS[kind];
  return (
    <span
      title={title}
      className={`pointer-events-none absolute left-3 top-3 z-20 inline-flex items-center gap-1.5 rounded-full bg-slate-950/85 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.14em] shadow-lg ring-1 backdrop-blur-md sm:left-4 sm:top-4 sm:px-3 sm:py-1.5 sm:text-xs ${tint}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${dot}`} aria-hidden="true" />
      {text}
    </span>
  );
}

"use client";

import { useSyncExternalStore } from "react";
import type { Beat } from "@/lib/lessonContent";
import { boardSummary, incomingSummary, type IncomingState } from "@/lib/anim/boardTagline";
import { modelCostBreakdown } from "@/lib/anim/modelCosts";
import { EMPTY_COST_LEDGER, getCostLedger, subscribeCostLedger } from "@/lib/costLedger";

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

export type RendererKind = "manim" | "gsap" | "structure" | "plot" | "equation" | "code" | "sandbox" | "svg";

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
  code: {
    text: "Code · walkthrough",
    dot: "bg-violet-300 shadow-[0_0_6px_rgba(196,181,253,0.9)]",
    tint: "text-violet-300 ring-violet-400/40",
    title: "A real code listing, highlighted line by line as the narration walks through it",
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
    text: "Motion",
    dot: "bg-fuchsia-300 shadow-[0_0_6px_rgba(240,171,252,0.9)]",
    tint: "text-fuchsia-300 ring-fuchsia-400/40",
    title: "A Motion board: model-authored (or illustrated) board animated with the Motion library, run in an isolated iframe",
  },
  svg: {
    text: "React · SVG",
    dot: "bg-sky-300 shadow-[0_0_6px_rgba(125,211,252,0.9)]",
    tint: "text-sky-300 ring-sky-400/40",
    title: "Live hand-drawn SVG board (LiveSketch), drawn as the narration speaks",
  },
};

/**
 * `detail` names who made the board — for a sandbox board, the model that drew it — so boards from
 * different models can be told apart while watching (see lib/animationModels.ts). Absent on boards
 * generated before models were recorded, which then show the chip exactly as before.
 */
export function RendererBadge({ kind, detail }: { kind: RendererKind; detail?: string | null }) {
  /*
   * DEVELOPER TELEMETRY, HIDDEN FROM STUDENTS BY DEFAULT.
   *
   * This pill named the RENDERING ENGINE — "React · sandbox", "Chart · Vega-Lite", "Diagram · ELK"
   * — in the board's top-left corner, optionally with the model name and the dollar cost of the
   * board. Its own docstring says it exists for comparing and debugging renderers, which is a
   * question no learner has, in vocabulary no learner knows, occupying the space where the diagram
   * starts. It also told a student nothing useful about PROVENANCE: the hand-authored scenes
   * render the same badge as a model-generated one.
   *
   * Kept for renderer work, behind NEXT_PUBLIC_SHOW_RENDERER_BADGE=engines. (=1 shows the
   * BoardTagline below instead, which says the same and more on one line.)
   */
  if (process.env.NEXT_PUBLIC_SHOW_RENDERER_BADGE !== "engines") return null;
  const { text, dot, tint, title } = LABELS[kind];
  return (
    <span
      title={detail ? `${title} — drawn by ${detail}` : title}
      className={`pointer-events-none absolute left-3 top-3 z-20 inline-flex items-center gap-1.5 rounded-full bg-slate-950/85 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.14em] shadow-lg ring-1 backdrop-blur-md sm:left-4 sm:top-4 sm:px-3 sm:py-1.5 sm:text-xs ${tint}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${dot}`} aria-hidden="true" />
      {text}
      {detail && <span className="opacity-80">· {detail}</span>}
    </span>
  );
}

const INCOMING_TINT: Record<IncomingState, string> = {
  ready: "text-emerald-300",
  drawing: "text-amber-300",
  writing: "text-sky-300",
  last: "text-slate-400",
};

/**
 * The lecture's cost and board status, as ONE small chip in the player's header — never over the
 * board (two full-width bars across the top of the picture were too much, 2026-09-29). The chip
 * shows the total and whether the next board is ready; hovering (or focusing) it opens the cost by
 * model (lib/anim/modelCosts.ts) and what drew this board (lib/anim/boardTagline.ts). Developer
 * telemetry, shown only with NEXT_PUBLIC_SHOW_RENDERER_BADGE=1 — students never see it.
 */
const NEXT_SHORT: Record<IncomingState, string> = {
  ready: "next ready",
  drawing: "next drawing…",
  writing: "next writing…",
  last: "last board",
};

export function BoardTelemetry({ beats, index, planned }: { beats: Beat[]; index: number; planned: number }) {
  const ledger = useSyncExternalStore(subscribeCostLedger, getCostLedger, () => EMPTY_COST_LEDGER);
  if (process.env.NEXT_PUBLIC_SHOW_RENDERER_BADGE !== "1") return null;
  const { totalUsd, parts } = modelCostBreakdown(beats, ledger.lines);
  const beat = beats[index];
  const incoming = incomingSummary(beats, index, planned);
  return (
    <div className="group relative shrink-0">
      <button
        type="button"
        aria-label="Lecture cost by model and board status"
        className="flex h-7 items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-2.5 text-[10px] font-semibold text-slate-300 transition hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300"
      >
        <span className="tabular-nums text-cyan-300">${totalUsd.toFixed(3)}</span>
        <span className="opacity-40">·</span>
        <span className={INCOMING_TINT[incoming.state]}>{NEXT_SHORT[incoming.state]}</span>
      </button>
      <div className="invisible absolute right-0 top-full z-[80] mt-2 w-72 rounded-xl border border-white/10 bg-slate-950/95 p-3 text-[11px] leading-snug text-slate-200 opacity-0 shadow-2xl backdrop-blur-md transition group-focus-within:visible group-focus-within:opacity-100 group-hover:visible group-hover:opacity-100">
        <p className="font-bold text-cyan-300">All models ${totalUsd.toFixed(4)}</p>
        {parts.length > 0 ? (
          <ul className="mt-1.5 space-y-0.5">
            {parts.map((part) => (
              <li key={part.label} className="flex justify-between gap-3">
                <span className="truncate text-slate-300">{part.label}</span>
                <span className="tabular-nums">${part.usd.toFixed(3)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-1 text-slate-400">No spend measured yet.</p>
        )}
        {ledger.unpriced > 0 && <p className="mt-1 text-amber-300/80">+{ledger.unpriced} unpriced call{ledger.unpriced === 1 ? "" : "s"}</p>}
        <div className="mt-2 space-y-0.5 border-t border-white/10 pt-2">
          {beat && <p className="text-fuchsia-200">This board: {boardSummary(beat)}</p>}
          <p className={INCOMING_TINT[incoming.state]}>{incoming.text}</p>
        </div>
      </div>
    </div>
  );
}

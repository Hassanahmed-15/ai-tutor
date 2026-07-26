"use client";

import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import {
  sketchHexagon,
  sketchCircle,
  sketchRect,
  sketchLine,
  sketchPolyline,
  sketchConnector,
  sketchScribbleRing,
  sketchLeaf,
  sketchSunburst,
  sketchDroplet,
  sketchStove,
} from "../whiteboard/sketch";

/* Mirror of the lesson-graph DrawScript types (kept local so the client component is
   self-contained; the server passes plain JSON matching this shape). */
type DrawShape = "circle" | "rect" | "hexagon" | "line" | "chain" | "leaf" | "sun" | "droplet" | "stove";
type DrawScene = "spotlight" | "process" | "compare" | "cycle" | "system" | "timeline" | "graph";
/** Shapes that are drawn as several sub-paths (outline + veins/rays/burners), not one path. */
const COMPOUND_SHAPES: ReadonlySet<DrawShape> = new Set(["leaf", "sun", "stove"]);
interface Pt {
  x: number;
  y: number;
}
type DrawOp =
  | { kind: "shape"; shape: DrawShape; x: number; y: number; w?: number; h?: number; points?: Pt[]; color?: string; at: number }
  | { kind: "label"; text: string; x: number; y: number; size?: "sm" | "md" | "lg"; color?: string; at: number }
  | {
      kind: "callout";
      text: string;
      x: number;
      y: number;
      labelX?: number;
      labelY?: number;
      color?: string;
      at: number;
      /** Sentence index this callout is revealed on (Image-Explainer agent sync). */
      group?: number;
      /** True when this callout's label is grounded in a real image description (image-explainer
       *  agent output) — survives the provided-image board cleanup pass that otherwise strips
       *  ungrounded/legacy keyword-matched callouts. */
      grounded?: boolean;
    }
  | { kind: "arrow"; x1: number; y1: number; x2: number; y2: number; curved?: boolean; color?: string; at: number }
  | { kind: "note"; text: string; x: number; y: number; color?: string; at: number }
  | {
      kind: "scene";
      scene: DrawScene;
      title?: string;
      items?: string[];
      left?: string;
      right?: string;
      color?: string;
      at: number;
      endAt?: number;
    }
  | {
      kind: "motion";
      motion: "flow" | "beam" | "orbit" | "collapse" | "pulse" | "reveal";
      x1?: number;
      y1?: number;
      x2?: number;
      y2?: number;
      cx?: number;
      cy?: number;
      r?: number;
      text?: string;
      color?: string;
      at: number;
      endAt: number;
    }
  | { kind: "underline" | "circleHighlight"; x: number; y: number; w?: number; h?: number; color?: string; at: number }
  | {
      kind: "morph";
      shape: DrawShape;
      text?: string;
      /** Start state: where the piece appears and what it's labeled/colored. */
      x: number;
      y: number;
      w?: number;
      h?: number;
      color?: string;
      /** End state: where it travels to and relabels/recolors to, over `morphAt`. */
      toX: number;
      toY: number;
      toText?: string;
      toColor?: string;
      at: number;
      /** 0..1 fraction of the WHOLE script timeline when the travel finishes (must be > at). */
      morphAt: number;
    }
  | {
      /** A real AI-generated photographic/illustrative image, "developing in" over ~500ms.
       *  `prompt` is the generation description (always present, written by the text model).
       *  `src` is a data URI (`data:image/png;base64,...`) populated server-side. During
       *  streaming generation the client may briefly receive this op before `src` arrives. */
      kind: "image";
      prompt: string;
      /** Optional reference to a provided source asset (for Suprnotes/PPTX imports). When present,
       *  the API hydrates `src` from the supplied asset instead of generating a new image. */
      assetId?: string;
      credit?: { title: string; creator: string; license: string; sourceUrl: string; provider?: string };
      src?: string;
      x: number;
      y: number;
      w?: number;
      h?: number;
      color?: string;
      at: number;
    }
  | {
      /** A topic-specific React component (plain SVG/CSS), authored by the text model and filled
       *  in server-side by fillReactAnimationOps before the response is sent, then rendered live
       *  in a sandboxed iframe by ReactAnimationSandbox. `teachingPoint` is the grounding sent to
       *  the code-generation call. `fallback` is legacy/reference data only; LessonPlayer does
       *  not render it for animation failures. */
      kind: "reactAnimation";
      teachingPoint?: string;
      code?: string;
      status?: "ready" | "failed";
      error?: string;
      fallback?: DrawOp[];
      at: 0;
      endAt: 1;
    }
  | {
      /** A model-authored chalk blackboard. `boardBrief` is the step-1 one-liner describing what
       *  the board must teach; `ops` is filled server-side by fillBlackboardOps with the real
       *  chalk ops (label/arrow/note/shape), each carrying an `at` fraction aligned to a spoken
       *  sentence for narration-synced reveal. VisualDirector unwraps `ops` into LiveSketch. */
      kind: "chalkBoard";
      boardBrief?: string;
      ops?: DrawOp[];
      status?: "ready" | "failed";
      error?: string;
      at: 0;
      endAt: 1;
    };

export interface DrawScript {
  caption?: string;
  durationMs?: number;
  /** Visual surface for imported note-style lessons. `paper` matches Suprnotes-style white boards. */
  surface?: "dark" | "paper";
  ops: DrawOp[];
}

// The board's internal coordinate space. Ops use a 0..100 grid; we scale to this.
const VB_W = 1000;
const VB_H = 560;
const DEFAULT_DURATION = 11000;
const INK = "#1e293b";
const STROKE_WINDOW = 700; // how long an op takes to draw in
const TEXT_PAD_X = 48;
const TEXT_PAD_Y = 18;
const INITIAL_SYNC_PROGRESS = 0.001;

const gx = (x: number) => (x / 100) * VB_W;
const gy = (y: number) => (y / 100) * VB_H;

/**
 * The live-sketch engine: executes a DrawScript's ops in timed order, drawing each one in
 * (stroke animation), with a visible pen that moves to whatever is currently being drawn.
 * Feels like a teacher filling a whiteboard while talking. Topic-agnostic — chemistry,
 * history, biology, math all script into the same primitives.
 */
export function LiveSketch({ script, progress }: { script: DrawScript; progress?: number }) {
  // Re-mount (restart the clock) when the script identity changes between beats.
  const key = useMemo(() => `${script.caption ?? ""}:${script.ops.length}:${script.ops.map((o) => o.at).join(",")}`, [script]);
  return <LiveSketchClock key={key} script={script} progress={progress} />;
}

function LiveSketchClock({ script, progress }: { script: DrawScript; progress?: number }) {
  const duration = script.durationMs ?? DEFAULT_DURATION;
  const paperSurface = script.surface === "paper";
  // Per-instance prefix so clipPath/id attributes never collide when two boards are on screen
  // at once (e.g. the main board + an ExplainOverlay board).
  const instanceId = useId().replace(/[:]/g, "");
  const [elapsed, setElapsed] = useState(0);
  const startRef = useRef<number | null>(null);
  const externalElapsed = typeof progress === "number" ? Math.max(INITIAL_SYNC_PROGRESS, clamp01(progress)) * duration : null;
  const visibleElapsed = externalElapsed ?? elapsed;

  // Ops sorted by their start time, each with an absolute start in ms. `windowMs` is how long
  // this op "owns" before the next op begins — used to spread a text op's word-by-word reveal
  // across the exact span the narration spends on it, so words appear as they're spoken.
  const timed = useMemo(() => {
    const sorted = script.ops
      .map((op, i) => ({ op, i, startMs: Math.max(0, Math.min(1, op.at)) * duration }))
      .sort((a, b) => a.startMs - b.startMs);
    return sorted.map((entry, idx) => {
      const next = sorted[idx + 1];
      const gap = next ? next.startMs - entry.startMs : duration - entry.startMs;
      // Clamp: never faster than ~500ms (unreadable) or slower than ~2.6s (feels stalled).
      const windowMs = Math.max(500, Math.min(2600, gap));
      return { ...entry, windowMs };
    });
  }, [script, duration]);

  useEffect(() => {
    let raf = 0;
    startRef.current = null;
    const loop = (now: number) => {
      if (startRef.current === null) startRef.current = now;
      const t = Math.min(duration, now - startRef.current);
      setElapsed(t);
      if (t < duration) raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [duration]);

  const visible = timed.filter((t) => visibleElapsed >= t.startMs);
  const visibleImages = visible.filter((t) => t.op.kind === "image");
  const visibleDrawing = visible.filter((t) => t.op.kind !== "image");
  const hasBackdropImage = script.ops.some((op) => op.kind === "image" && (op.w ?? 100) >= 92);
  // The op currently mid-draw (for the pen cursor position) — morphs stay "active" for the
  // pen across their whole travel window, everything else only while its stroke draws in.
  const drawingNow = [...visibleDrawing]
    .reverse()
    .find((t) =>
      t.op.kind === "morph"
        ? visibleElapsed < t.op.morphAt * duration + 300
        : t.op.kind === "motion"
          ? visibleElapsed < t.op.endAt * duration + 300
          : t.op.kind === "scene" && typeof t.op.endAt === "number"
            ? visibleElapsed < t.op.endAt * duration + 300
          : t.op.kind === "label" || t.op.kind === "note" || t.op.kind === "callout"
            ? visibleElapsed - t.startMs < t.windowMs
            : visibleElapsed - t.startMs < STROKE_WINDOW
    );
  const penAnchor = drawingNow
    ? anchorOf(drawingNow.op, visibleElapsed, drawingNow.startMs, drawingNow.windowMs, duration, paperSurface)
    : null;
  const progressValue = Math.min(1, visibleElapsed / duration);

  return (
    <section
      className={`relative h-full min-h-0 overflow-hidden rounded-xl border shadow-[0_18px_70px_rgba(0,0,0,0.22)] ${
        paperSurface ? "border-slate-200 bg-white text-slate-700" : "border-slate-800 bg-black text-white"
      }`}
    >
      <Paper surface={script.surface} />
      <svg viewBox={`0 0 ${VB_W} ${VB_H}`} preserveAspectRatio="xMidYMid meet" className="absolute inset-0 h-full min-h-0 w-full" aria-hidden="true">
        <defs>
          <marker id="live-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="context-stroke" />
          </marker>
          {/* Holographic ink: a soft cyan-tinted blur sits behind the original crisp stroke
              (SourceGraphic last in the merge), so existing op colors are preserved and only
              gain a glowing halo — "light drawn in 3D space," not a flat marker line. */}
          <filter id="live-glow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur in="SourceGraphic" stdDeviation="1.6" result="blur" />
            <feColorMatrix
              in="blur"
              type="matrix"
              values="0 0 0 0 0.35  0 0 0 0 0.85  0 0 0 0 0.95  0 0 0 0.6 0"
              result="tint"
            />
            <feMerge>
              <feMergeNode in="tint" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <linearGradient id="live-photo-shade" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#020617" stopOpacity="0.42" />
            <stop offset="46%" stopColor="#020617" stopOpacity="0.08" />
            <stop offset="100%" stopColor="#020617" stopOpacity="0.54" />
          </linearGradient>
          <linearGradient id="live-photo-caption-shade" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#020617" stopOpacity="0.5" />
            <stop offset="34%" stopColor="#020617" stopOpacity="0" />
            <stop offset="100%" stopColor="#020617" stopOpacity="0.62" />
          </linearGradient>
          <filter id="live-photo-soft-cover" x="-8%" y="-8%" width="116%" height="116%">
            <feGaussianBlur stdDeviation="16" />
          </filter>
        </defs>
        {visibleImages.map((t) => (
          <OpRenderer key={t.i} op={t.op} seed={`${instanceId}-op-${t.i}`} startMs={t.startMs} windowMs={t.windowMs} elapsed={visibleElapsed} duration={duration} contextTitle={script.caption} hasBackdropImage={hasBackdropImage} surface={script.surface} />
        ))}
        {visibleDrawing.map((t) => (
          <OpRenderer key={t.i} op={t.op} seed={`${instanceId}-op-${t.i}`} startMs={t.startMs} windowMs={t.windowMs} elapsed={visibleElapsed} duration={duration} contextTitle={script.caption} hasBackdropImage={hasBackdropImage} surface={script.surface} />
        ))}
        {penAnchor && <Pen x={penAnchor.x} y={penAnchor.y} />}
      </svg>

      <span className={`hud-eyebrow pointer-events-none absolute right-3 top-3 z-20 rounded-full px-3 py-1.5 text-xs shadow-2xl backdrop-blur-md sm:right-4 sm:top-4 sm:px-4 sm:py-2 sm:text-sm ${
        paperSurface ? "bg-white/82 text-slate-400" : "bg-slate-950/78 text-[var(--hud-cyan-bright)]"
      }`}>
        {visible.length}/{timed.length}
      </span>

      <div className={`absolute inset-x-3 bottom-3 z-20 h-1.5 overflow-hidden rounded-full sm:inset-x-4 ${paperSurface ? "bg-slate-200" : "bg-white/15"}`}>
        <div
          className={`h-full ${paperSurface ? "bg-teal-400" : "bg-[var(--hud-cyan)]"}`}
          style={{ width: `${progressValue * 100}%`, boxShadow: paperSurface ? "none" : "0 0 8px var(--hud-cyan-glow)" }}
        />
      </div>
    </section>
  );
}

/** Where the pen should sit while an op draws (its "starting nib" point, or its current
 *  travel position for a morph in progress). */
function anchorOf(op: DrawOp, elapsed: number, startMs: number, windowMs: number, duration: number, paperSurface: boolean): Pt {
  switch (op.kind) {
    case "label":
    case "note":
      return textPenAnchor(op, elapsed - startMs, windowMs, paperSurface);
    case "arrow":
      return { x: op.x1, y: op.y1 };
    case "callout":
      return calloutPenAnchor(op, elapsed - startMs, windowMs, paperSurface);
    case "shape":
      if (op.points && op.points.length) return op.points[0];
      return { x: op.x, y: op.y };
    case "morph": {
      const travelStart = startMs;
      const travelEnd = op.morphAt * duration;
      const t = travelEnd > travelStart ? clamp01((elapsed - travelStart) / (travelEnd - travelStart)) : 1;
      return { x: lerp(op.x, op.toX, t), y: lerp(op.y, op.toY, t) };
    }
    case "motion": {
      const travelStart = startMs;
      const travelEnd = op.endAt * duration;
      const t = travelEnd > travelStart ? clamp01((elapsed - travelStart) / (travelEnd - travelStart)) : 1;
      return { x: lerp(op.x1 ?? op.cx ?? 50, op.x2 ?? op.cx ?? 50, t), y: lerp(op.y1 ?? op.cy ?? 50, op.y2 ?? op.cy ?? 50, t) };
    }
    case "scene":
      return { x: 50, y: op.scene === "timeline" ? 72 : 50 };
    case "image":
      // Images develop in photographically — pen never tracks them (filtered in drawingNow).
      // Returning a valid anchor anyway so the type is safe.
      return { x: op.x, y: op.y };
    case "reactAnimation":
      // Never actually reaches LiveSketch — intercepted upstream in the sanitizer and routed to
      // ReactAnimationSandbox instead. Anchor is unused; kept only for exhaustive type safety.
      return { x: 50, y: 50 };
    case "chalkBoard":
      // Never reaches the renderer — VisualDirector unwraps its inner ops into LiveSketch.
      // Kept only for exhaustive type safety.
      return { x: 50, y: 50 };
    default:
      return { x: op.x, y: op.y };
  }
}

function clamp01(n: number) {
  return Math.max(0, Math.min(1, n));
}
function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

/** Greedily wraps text into lines of at most `maxChars`, so note sentences fit the board. */
function wrapText(text: string, maxChars: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length > maxChars && current) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines.slice(0, 3);
}

type WordBox = { text: string; lineIndex: number; xLeft: number; width: number };
type TimedWordBox = WordBox & { startMs: number; writeMs: number; endMs: number };

function layoutWords(lines: string[], cx: number, anchor: "start" | "middle" | "end", fontSize: number): WordBox[] {
  // Chalkboard/Marker Felt glyphs are substantially narrower than a monospace estimate. The
  // old 0.72 multiplier made separately written words look artificially scattered.
  const charW = fontSize * 0.62;
  const spaceW = charW * 0.48;
  const boxes: WordBox[] = [];
  lines.forEach((line, lineIndex) => {
    const words = line.split(" ").filter(Boolean);
    const lineWidth = words.reduce((sum, word) => sum + word.length * charW, 0) + Math.max(0, words.length - 1) * spaceW;
    let penX = anchor === "start" ? cx : anchor === "end" ? cx - lineWidth : cx - lineWidth / 2;
    for (const word of words) {
      const width = word.length * charW;
      boxes.push({ text: word, lineIndex, xLeft: penX, width });
      penX += width + spaceW;
    }
  });
  return boxes;
}

function timeWords(boxes: WordBox[], windowMs: number): TimedWordBox[] {
  if (!boxes.length) return [];
  const weights = boxes.map((box, index) => {
    const writing = Math.max(0.8, Math.min(2.8, box.text.length * 0.28));
    const naturalVariation = 0.92 + ((box.text.length * 17 + index * 11) % 19) / 100;
    const pause = /[.!?]$/.test(box.text) ? 0.7 : /[,;:]$/.test(box.text) ? 0.3 : 0.1;
    return writing * naturalVariation + pause;
  });
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  let cursor = 0;
  return boxes.map((box, index) => {
    const slotMs = (weights[index] / totalWeight) * windowMs;
    const pauseRatio = /[.!?]$/.test(box.text) ? 0.24 : /[,;:]$/.test(box.text) ? 0.13 : 0.06;
    // A short word slot must still finish before the next word starts. Previously the 105ms
    // minimum could exceed `slotMs`, leaving the final glyph permanently inside its wipe mask.
    const writeMs = Math.min(slotMs * 0.94, Math.max(42, slotMs * (1 - pauseRatio)));
    const timed = { ...box, startMs: cursor, writeMs, endMs: cursor + slotMs };
    cursor += slotMs;
    return timed;
  });
}

function textPenAnchor(op: Extract<DrawOp, { kind: "label" | "note" }>, localElapsed: number, windowMs: number, paperSurface: boolean): Pt {
  const isNote = op.kind === "note";
  const fontSize = paperSurface
    ? isNote ? 18 : op.size === "lg" ? 34 : op.size === "sm" ? 20 : 27
    : isNote ? 20 : op.size === "lg" ? 34 : op.size === "sm" ? 22 : 28;
  const lines = isNote
    ? wrapText(op.text, paperSurface ? 50 : 44)
    : wrapText(op.text, op.size === "lg" ? 14 : paperSurface ? 24 : 20);
  const anchor = textAnchorFor(op.x);
  const cx = safeTextX(op.x, anchor);
  const cy = safeTextY(gy(op.y), fontSize, lines.length);
  const words = timeWords(layoutWords(lines, cx, anchor, fontSize), windowMs);
  const active = words.find((word) => localElapsed >= word.startMs && localElapsed < word.endMs) ?? words.at(-1);
  if (!active) return { x: op.x, y: op.y };
  const strokeProgress = clamp01((localElapsed - active.startMs) / active.writeMs);
  return {
    x: ((active.xLeft + active.width * strokeProgress) / VB_W) * 100,
    y: ((cy + active.lineIndex * fontSize * 1.15 - fontSize * 0.08) / VB_H) * 100,
  };
}

function calloutPenAnchor(
  op: Extract<DrawOp, { kind: "callout" }>,
  localElapsed: number,
  windowMs: number,
  paperSurface: boolean
): Pt {
  if (!paperSurface) return { x: op.x, y: op.y };
  const labelX = op.labelX ?? (op.x < 50 ? Math.min(86, op.x + 14) : Math.max(14, op.x - 14));
  const labelY = op.labelY ?? Math.max(12, op.y - 10);
  const fontSize = 18;
  const lines = wrapText(op.text, 18);
  const anchor = textAnchorFor(labelX);
  const cx = safeTextX(labelX, anchor);
  const cy = safeTextY(gy(labelY), fontSize, lines.length);
  const writingWindow = windowMs * 0.62;
  if (localElapsed <= writingWindow) {
    const words = timeWords(layoutWords(lines, cx, anchor, fontSize), writingWindow);
    const active = words.find((word) => localElapsed >= word.startMs && localElapsed < word.endMs) ?? words.at(-1);
    if (!active) return { x: labelX, y: labelY };
    const strokeProgress = clamp01((localElapsed - active.startMs) / active.writeMs);
    return {
      x: ((active.xLeft + active.width * strokeProgress) / VB_W) * 100,
      y: ((cy + active.lineIndex * fontSize * 1.15 - fontSize * 0.08) / VB_H) * 100,
    };
  }
  const connectorProgress = clamp01((localElapsed - writingWindow) / Math.max(1, windowMs - writingWindow));
  return { x: lerp(labelX, op.x, connectorProgress), y: lerp(labelY, op.y, connectorProgress) };
}

/**
 * Renders text word-by-word, each word "written" with a left-to-right stroke wipe as the
 * narration reaches it — the teacher-at-the-board feel. Words are timed across `windowMs`
 * (the span the voice spends on this op), so the written word lands with the spoken word.
 *
 * SVG can't measure text before layout, so word widths are estimated from character count.
 * Each word is a separate <text> whose horizontal reveal is done with a per-word clipPath
 * rectangle that grows from the word's left edge to its right edge over ~140ms.
 */
function WordByWordText({
  lines,
  cx,
  cy,
  anchor,
  fontSize,
  fontFamily,
  fontWeight,
  fill,
  stroke,
  strokeWidth,
  glow,
  localElapsed,
  windowMs,
  seed,
}: {
  lines: string[];
  cx: number;
  cy: number;
  anchor: "start" | "middle" | "end";
  fontSize: number;
  fontFamily: string;
  fontWeight: number;
  fill: string;
  stroke: string;
  strokeWidth: number;
  glow: boolean;
  localElapsed: number;
  windowMs: number;
  seed: string;
}) {
  const lineH = fontSize * 1.15;
  const wordBoxes = timeWords(layoutWords(lines, cx, anchor, fontSize), windowMs);

  // Which words are still mid-wipe (need a clip) vs. fully written (render with NO clip so the
  // width estimate can never chop a finished word).
  const wiping = wordBoxes.filter((word) => localElapsed >= word.startMs && localElapsed - word.startMs < word.writeMs);

  return (
    <g style={{ filter: glow ? "drop-shadow(0 0 4px rgba(148,163,184,0.28))" : "none" }}>
      <defs>
        {wiping.map((wb) => {
          const k = wordBoxes.indexOf(wb);
          const wipe = clamp01((localElapsed - wb.startMs) / wb.writeMs);
          const revealW = wb.width * wipe;
          const y = cy + wb.lineIndex * lineH;
          return (
            <clipPath key={`${seed}-clip-${k}`} id={`${seed}-clip-${k}`}>
              <rect x={wb.xLeft - 2} y={y - fontSize} width={revealW + 2} height={fontSize * 1.6} />
            </clipPath>
          );
        })}
      </defs>
      {wordBoxes.map((wb, k) => {
        const wordStart = wb.startMs;
        if (localElapsed < wordStart) return null; // not started yet
        const isWiping = localElapsed - wordStart < wb.writeMs;
        const y = cy + wb.lineIndex * lineH;
        return (
          <text
            key={`${seed}-w-${k}`}
            x={wb.xLeft}
            y={y}
            textAnchor="start"
            clipPath={isWiping ? `url(#${seed}-clip-${k})` : undefined}
            style={{
              fontSize,
              fontFamily,
              fontWeight,
              fill,
              paintOrder: "stroke",
              stroke,
              strokeLinejoin: "round",
              strokeWidth,
            }}
          >
            {wb.text}
          </text>
        );
      })}
    </g>
  );
}

function textAnchorFor(x: number): "start" | "middle" | "end" {
  if (x <= 24) return "start";
  if (x >= 76) return "end";
  return "middle";
}

function safeTextX(x: number, anchor: "start" | "middle" | "end") {
  const px = gx(x);
  if (anchor === "start") return Math.max(TEXT_PAD_X, px);
  if (anchor === "end") return Math.min(VB_W - TEXT_PAD_X, px);
  return Math.max(TEXT_PAD_X * 2, Math.min(VB_W - TEXT_PAD_X * 2, px));
}

function safeTextY(y: number, fontSize: number, lineCount: number) {
  const lineHeight = fontSize * 1.15;
  const minBaseline = TEXT_PAD_Y + fontSize;
  const maxBaseline = VB_H - TEXT_PAD_Y - (lineCount - 1) * lineHeight;
  return Math.max(minBaseline, Math.min(maxBaseline, y));
}

function shapeFillOpacity(shape?: DrawShape) {
  if (!shape || shape === "line" || shape === "chain") return 0;
  if (shape === "sun") return 0.16;
  return 0.1;
}

function OpRenderer({
  op,
  seed,
  startMs,
  windowMs,
  elapsed,
  duration,
  contextTitle,
  hasBackdropImage,
  surface,
}: {
  op: DrawOp;
  seed: string;
  startMs: number;
  windowMs?: number;
  elapsed: number;
  duration: number;
  contextTitle?: string;
  hasBackdropImage?: boolean;
  surface?: DrawScript["surface"];
}) {
  // Never actually reaches LiveSketch — intercepted upstream in the sanitizer and routed to
  // ReactAnimationSandbox instead. Guard kept only for exhaustive type safety.
  if (op.kind === "reactAnimation") return null;
  // chalkBoard is unwrapped by VisualDirector before LiveSketch; guard for type safety.
  if (op.kind === "chalkBoard") return null;

  const paperSurface = surface === "paper";
  const color = op.color ?? (paperSurface ? "#6b7280" : INK);
  const localElapsed = elapsed - startMs;

  if (op.kind === "morph") {
    return <MorphRenderer op={op} startMs={startMs} elapsed={elapsed} duration={duration} seed={seed} />;
  }

  if (op.kind === "motion") {
    return <MotionRenderer op={op} startMs={startMs} elapsed={elapsed} duration={duration} seed={seed} />;
  }

  if (op.kind === "scene") {
    return <SceneRenderer op={op} startMs={startMs} elapsed={elapsed} duration={duration} seed={seed} contextTitle={contextTitle} />;
  }

  if (op.kind === "callout") {
    return <CalloutRenderer op={op} localElapsed={localElapsed} windowMs={windowMs ?? 1400} seed={seed} surface={surface} />;
  }

  if (op.kind === "label" || op.kind === "note") {
    const reveal = Math.min(1, localElapsed / 420);
    const isNote = op.kind === "note";

    // Notes on a photo backdrop render as clean bottom-anchored cinematic subtitles —
    // large, centered, with a dark pill behind them so they're always readable.
    if (isNote && hasBackdropImage) {
      const lines = wrapText(op.text, 42);
      const fontSize = 26;
      const lineH = fontSize * 1.3;
      const totalH = lines.length * lineH + 20;
      const boxW = VB_W * 0.74;
      const boxX = (VB_W - boxW) / 2;
      const boxY = VB_H - totalH - 28;
      return (
        <g opacity={reveal}>
          <rect x={boxX} y={boxY} width={boxW} height={totalH} rx="10" fill="#020617" fillOpacity="0.72" />
          <text
            x={VB_W / 2}
            y={boxY + 20 + fontSize * 0.85}
            textAnchor="middle"
            style={{
              fontSize,
              fontFamily: "var(--font-body, Lexend, sans-serif)",
              fontWeight: 500,
              fill: "#f8fafc",
              paintOrder: "stroke",
              stroke: "#020617",
              strokeWidth: 4,
              strokeLinejoin: "round",
            }}
          >
            {lines.map((line, i) => (
              <tspan key={i} x={VB_W / 2} dy={i === 0 ? 0 : lineH}>
                {line}
              </tspan>
            ))}
          </text>
        </g>
      );
    }

    // Standard label/note: WRITTEN one word at a time, left to right, like a teacher at the
    // board — each word strokes on with a horizontal wipe as the narration reaches it. Words
    // are spread across this op's `windowMs` (the span the voice spends here) so writing and
    // speaking land together.
    const fontSize = paperSurface
      ? isNote ? 18 : op.size === "lg" ? 34 : op.size === "sm" ? 20 : 27
      : isNote ? 20 : op.size === "lg" ? 34 : op.size === "sm" ? 22 : 28;
    const lines = isNote ? wrapText(op.text, paperSurface ? 50 : 44) : wrapText(op.text, op.size === "lg" ? 14 : paperSurface ? 24 : 20);
    const anchor = textAnchorFor(op.x);
    const cx = safeTextX(op.x, anchor);
    const cy = safeTextY(gy(op.y), fontSize, lines.length);
    const darkInk = color === INK || color.toLowerCase() === "#1e293b";
    const textFill = paperSurface
      ? (darkInk ? "#6b7280" : color)
      : isNote
        ? (darkInk ? "#fff7ed" : color || "#fff7ed")
        : darkInk ? "#f8fafc" : color;
    const textStroke = paperSurface ? "#ffffff" : "#020617";
    const fontFamily = paperSurface
      ? "'Chalkboard SE', 'Marker Felt', 'Bradley Hand', 'Comic Sans MS', 'Trebuchet MS', var(--font-body, Lexend, sans-serif)"
      : isNote ? "var(--font-body, Lexend, sans-serif)" : "var(--font-display, 'Space Grotesk', sans-serif)";
    const fontWeight = paperSurface ? (isNote ? 560 : 680) : isNote ? 500 : 800;
    const strokeWidth = paperSurface ? (isNote ? 2.2 : 2.8) : isNote ? 4.5 : 5.5;

    return (
      <WordByWordText
        lines={lines}
        cx={cx}
        cy={cy}
        anchor={anchor}
        fontSize={fontSize}
        fontFamily={fontFamily}
        fontWeight={fontWeight}
        fill={textFill}
        stroke={textStroke}
        strokeWidth={strokeWidth}
        glow={!paperSurface}
        localElapsed={Math.max(0, localElapsed - 55)}
        windowMs={windowMs ?? 1400}
        seed={seed}
      />
    );
  }

  if (op.kind === "image") {
    if (!op.src) return null;
    const reveal = Math.min(1, localElapsed / 900);
    const W = gx(op.w ?? 100);
    const H = gy(op.h ?? 100);
    const ix = gx(op.x) - W / 2;
    const iy = gy(op.y) - H / 2;
    const isBackdrop = (op.w ?? 100) >= 92 && (op.h ?? 100) >= 92;
    return (
      <g opacity={reveal}>
        {isBackdrop ? (
          <>
            {paperSurface ? (
              <>
                <rect x="0" y="0" width={VB_W} height={VB_H} fill="#ffffff" />
                <image href={op.src} x="0" y="0" width={VB_W} height={VB_H} preserveAspectRatio="xMidYMid meet" />
              </>
            ) : (
              <>
                <image href={op.src} x="0" y="0" width={VB_W} height={VB_H} preserveAspectRatio="xMidYMid slice" opacity="0.72" filter="url(#live-photo-soft-cover)" />
                <image href={op.src} x="0" y="0" width={VB_W} height={VB_H} preserveAspectRatio="xMidYMid meet" />
                <rect x="0" y="0" width={VB_W} height={VB_H} fill="url(#live-photo-shade)" />
                <rect x="0" y="0" width={VB_W} height={VB_H} fill="url(#live-photo-caption-shade)" />
              </>
            )}
          </>
        ) : (
          <>
            <rect
              x={ix - 6}
              y={iy - 6}
              width={W + 12}
              height={H + 12}
              rx={14}
              fill={paperSurface ? "#ffffff" : "#020617"}
              fillOpacity={paperSurface ? 1 : 0.74}
              stroke={paperSurface ? "#e5e7eb" : "var(--hud-cyan-bright)"}
              strokeWidth={2}
              opacity={0.92}
              filter="url(#live-glow)"
            />
            <image href={op.src} x={ix} y={iy} width={W} height={H} preserveAspectRatio="xMidYMid meet" />
            {op.credit && (
              <text
                x={ix + W}
                y={iy + H + 19}
                textAnchor="end"
                fill={paperSurface ? "#94a3b8" : "#cbd5e1"}
                fontSize="10"
                fontFamily="var(--font-body, Lexend, sans-serif)"
                fontWeight="500"
              >
                {`${op.credit.provider ?? "Wikimedia Commons"} · ${op.credit.license}`}
              </text>
            )}
          </>
        )}
      </g>
    );
  }

  if (op.kind === "shape" && COMPOUND_SHAPES.has(op.shape)) {
    return <CompoundShapeRenderer op={op} seed={seed} color={color} localElapsed={localElapsed} />;
  }

  // Everything else is a stroked path that draws in.
  const d = pathFor(op, seed);
  if (!d) return null;
  const isArrow = op.kind === "arrow";
  const isEmphasis = op.kind === "underline" || op.kind === "circleHighlight";
  const fillOpacity = op.kind === "shape" ? shapeFillOpacity(op.shape) : 0;
  return (
    <g>
      <path
        d={d}
        pathLength={1}
        fill={fillOpacity ? color : "none"}
        fillOpacity={fillOpacity || undefined}
        stroke={isEmphasis ? op.color ?? "#dc2626" : color}
        strokeWidth={isArrow ? 3.2 : isEmphasis ? 3.6 : 4}
        strokeLinecap="round"
        strokeLinejoin="round"
        markerEnd={isArrow ? "url(#live-arrow)" : undefined}
        filter={paperSurface ? undefined : "url(#live-glow)"}
        className="sketch-draw-in"
        style={{ animationDuration: `${STROKE_WINDOW}ms` }}
      />
      {/* Second lighter chalk pass, slightly offset and delayed — real chalk strokes are never
          a single clean line, and the double pass reads as hand-drawn without extra ops. */}
      {!isEmphasis && (
        <path
          d={d}
          pathLength={1}
          fill="none"
          stroke={color}
          strokeWidth={1.4}
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity={0.35}
          transform="translate(1.4 -1)"
          className="sketch-draw-in"
          style={{ animationDuration: `${STROKE_WINDOW * 0.8}ms`, animationDelay: `${STROKE_WINDOW * 0.55}ms` }}
        />
      )}
    </g>
  );
}

function MotionRenderer({
  op,
  startMs,
  elapsed,
  duration,
  seed,
}: {
  op: Extract<DrawOp, { kind: "motion" }>;
  startMs: number;
  elapsed: number;
  duration: number;
  seed: string;
}) {
  const color = op.color ?? "#5eead4";
  const endMs = op.endAt * duration;
  const travel = endMs > startMs ? clamp01((elapsed - startMs) / (endMs - startMs)) : 1;
  const x1 = gx(op.x1 ?? op.cx ?? 18);
  const y1 = gy(op.y1 ?? op.cy ?? 50);
  const x2 = gx(op.x2 ?? op.cx ?? 82);
  const y2 = gy(op.y2 ?? op.cy ?? 50);
  const cx = gx(op.cx ?? (op.x1 ?? 50));
  const cy = gy(op.cy ?? (op.y1 ?? 50));
  const r = gx(op.r ?? 14);
  const curve = motionPath(seed, x1, y1, x2, y2, op.motion);
  const labelX = lerp(x1, x2, Math.min(0.78, Math.max(0.35, travel)));
  const labelY = lerp(y1, y2, Math.min(0.78, Math.max(0.35, travel))) - 18;

  // Shared spline so traveling orbs accelerate out and decelerate in instead of moving at
  // constant speed — the single cheapest "this looks hand-animated" upgrade.
  const EASE = { calcMode: "spline", keyPoints: "0;1", keyTimes: "0;1", keySplines: "0.42 0 0.24 1" } as const;

  if (op.motion === "orbit") {
    const orbitPath = `M ${cx - r} ${cy} A ${r} ${r * 0.58} 0 1 0 ${cx + r} ${cy} A ${r} ${r * 0.58} 0 1 0 ${cx - r} ${cy}`;
    return (
      // Slight tilt makes the orbit read as a 3D ring instead of a flat oval.
      <g filter="url(#live-glow)" opacity={0.96} transform={`rotate(-7 ${cx} ${cy})`}>
        <ellipse cx={cx} cy={cy} rx={r} ry={r * 0.58} fill="none" stroke={color} strokeWidth={5} strokeDasharray="22 18" opacity="0.78">
          <animate attributeName="stroke-dashoffset" from="0" to="-160" dur="3s" repeatCount="indefinite" />
        </ellipse>
        {/* Lead orb + fading comet trail behind it */}
        {[0, 1, 2, 3].map((i) => (
          <circle key={i} r={7 - i * 1.6} fill={i === 0 ? color : "#fff7ed"} opacity={0.95 - i * 0.26}>
            <animateMotion dur="3.4s" begin={`${-i * 0.12}s`} repeatCount="indefinite" path={orbitPath} />
          </circle>
        ))}
        {op.text && <MotionText x={cx} y={cy - r * 0.72} text={op.text} color={color} />}
      </g>
    );
  }

  if (op.motion === "pulse" || op.motion === "reveal") {
    return (
      <g filter="url(#live-glow)" opacity={0.95}>
        {/* Glowing core that blooms with each ring release */}
        <circle cx={cx} cy={cy} r={r * 0.16} fill={color} opacity="0.8">
          <animate attributeName="r" values={`${r * 0.12};${r * 0.2};${r * 0.12}`} dur="2.6s" repeatCount="indefinite" />
          <animate attributeName="opacity" values="0.55;0.95;0.55" dur="2.6s" repeatCount="indefinite" />
        </circle>
        {[0, 1, 2].map((i) => (
          <circle key={i} cx={cx} cy={cy} r={r * 0.35} fill="none" stroke={i === 2 ? "#fff7ed" : color} strokeWidth={i === 2 ? 2.5 : 4} opacity={0.7}>
            <animate attributeName="r" values={`${r * 0.25};${r * 1.05}`} dur="2.6s" begin={`${i * 0.42}s`} repeatCount="indefinite" calcMode="spline" keyTimes="0;1" keySplines="0.2 0.6 0.4 1" />
            <animate attributeName="opacity" values="0.72;0" dur="2.6s" begin={`${i * 0.42}s`} repeatCount="indefinite" />
          </circle>
        ))}
        {op.motion === "reveal" && (
          <>
            <path d={`M ${cx - r * 1.2} ${cy} L ${cx + r * 1.2} ${cy}`} stroke={color} strokeWidth={8} strokeLinecap="round" opacity="0.65" className="photon-stream" />
            {/* Soft light sweep gliding across the revealed span */}
            <circle cy={cy} r={11} fill="#fff7ed" opacity="0.5">
              <animateMotion dur="2.2s" repeatCount="indefinite" path={`M ${cx - r * 1.2} ${cy} L ${cx + r * 1.2} ${cy}`} {...EASE} />
              <animate attributeName="opacity" values="0;0.55;0" dur="2.2s" repeatCount="indefinite" />
            </circle>
          </>
        )}
        {op.text && <MotionText x={cx} y={cy - r * 1.16} text={op.text} color={color} />}
      </g>
    );
  }

  return (
    <g filter="url(#live-glow)" opacity={0.96}>
      {/* Soft under-glow beneath the dashes gives the path body without extra clutter */}
      <path d={curve} fill="none" stroke={color} strokeWidth={op.motion === "beam" ? 16 : 12} strokeLinecap="round" opacity="0.14" />
      <path d={curve} fill="none" stroke={color} strokeWidth={op.motion === "beam" ? 9 : 6} strokeLinecap="round" strokeDasharray={op.motion === "beam" ? "34 14" : "18 16"} opacity="0.78">
        <animate attributeName="stroke-dashoffset" from="0" to="-180" dur={op.motion === "collapse" ? "2.1s" : "2.8s"} repeatCount="indefinite" />
      </path>
      <path d={curve} fill="none" stroke="#ffffff" strokeWidth="2" strokeLinecap="round" strokeDasharray="3 22" opacity="0.72">
        <animate attributeName="stroke-dashoffset" from="0" to="-140" dur="1.9s" repeatCount="indefinite" />
      </path>
      {/* Two eased lead orbs, each dragging a fading comet tail */}
      {[0, 1].map((lead) => (
        <g key={lead}>
          {[0, 1, 2].map((i) => (
            <circle
              key={i}
              r={(op.motion === "beam" ? 5.5 : 4.5) - i * 1.3}
              fill={i === 0 ? (lead % 2 ? "#fff7ed" : color) : "#fff7ed"}
              opacity={0.9 - i * 0.28}
            >
              <animateMotion dur={`${2.3 + lead * 0.25}s`} begin={`${lead * 0.55 - i * 0.09}s`} repeatCount="indefinite" path={curve} {...EASE} />
              <animate attributeName="opacity" values={`0;${0.95 - i * 0.28};0`} dur={`${2.3 + lead * 0.25}s`} begin={`${lead * 0.55 - i * 0.09}s`} repeatCount="indefinite" />
            </circle>
          ))}
        </g>
      ))}
      {op.text && <MotionText x={labelX} y={labelY} text={op.text} color={color} />}
    </g>
  );
}

function motionPath(seed: string, x1: number, y1: number, x2: number, y2: number, motion: Extract<DrawOp, { kind: "motion" }>["motion"]) {
  if (motion === "collapse") {
    const loops = 2 + (seed.length % 2);
    const dx = x2 - x1;
    const dy = y2 - y1;
    const c1x = x1 + dx * 0.35 - dy * 0.32;
    const c1y = y1 + dy * 0.35 + dx * 0.32;
    const c2x = x1 + dx * 0.72 + dy * 0.24;
    const c2y = y1 + dy * 0.72 - dx * 0.24;
    return `M ${x1} ${y1} C ${c1x} ${c1y} ${c2x} ${c2y} ${x2} ${y2} m ${loops} ${-loops}`;
  }
  const bend = motion === "beam" ? 0.12 : 0.22;
  const mx = (x1 + x2) / 2;
  const my = (y1 + y2) / 2;
  const nx = y1 - y2;
  const ny = x2 - x1;
  return `M ${x1} ${y1} Q ${mx + nx * bend} ${my + ny * bend} ${x2} ${y2}`;
}

function MotionText({ x, y, text, color }: { x: number; y: number; text: string; color: string }) {
  return (
    <text
      x={x}
      y={Math.max(28, Math.min(VB_H - 24, y))}
      textAnchor="middle"
      style={{ fontSize: 17, fontWeight: 900, fill: color, paintOrder: "stroke", stroke: "#020617", strokeWidth: 5, strokeLinejoin: "round" }}
    >
      {text}
    </text>
  );
}

function CalloutRenderer({
  op,
  localElapsed,
  windowMs,
  seed,
  surface,
}: {
  op: Extract<DrawOp, { kind: "callout" }>;
  localElapsed: number;
  windowMs: number;
  seed: string;
  surface?: DrawScript["surface"];
}) {
  const paperSurface = surface === "paper";
  const color = op.color ?? (paperSurface ? "#6b7280" : "#5eead4");
  const reveal = clamp01(localElapsed / 520);
  const px = gx(op.x);
  const py = gy(op.y);
  // Label sits close to the pin: offset 14 units horizontally away from center, 10 units up.
  // If model gave explicit labelX/labelY, use those instead.
  const defaultLabelX = op.x < 50 ? Math.min(86, op.x + 14) : Math.max(14, op.x - 14);
  const defaultLabelY = Math.max(12, op.y - 10);
  const lx = gx(op.labelX ?? defaultLabelX);
  const ly = gy(op.labelY ?? defaultLabelY);
  const { path } = sketchConnector(seed, lx, ly, px, py);
  const anchor = textAnchorFor(op.labelX ?? op.x);
  const textX = safeTextX(op.labelX ?? op.x, anchor);
  const textY = safeTextY(ly, 20, 1);
  const chipW = Math.min(260, Math.max(118, op.text.length * 12 + 34));
  const chipX = anchor === "end" ? textX - chipW + 16 : anchor === "middle" ? textX - chipW / 2 : textX - 16;

  if (paperSurface) {
    const fontSize = 18;
    const lines = wrapText(op.text, 18);
    const writingWindow = windowMs * 0.62;
    const connectorProgress = clamp01((localElapsed - writingWindow) / Math.max(1, windowMs - writingWindow));
    return (
      <g>
        <WordByWordText
          lines={lines}
          cx={textX}
          cy={safeTextY(ly, fontSize, lines.length)}
          anchor={anchor}
          fontSize={fontSize}
          fontFamily="'Chalkboard SE', 'Marker Felt', 'Bradley Hand', 'Comic Sans MS', 'Trebuchet MS', sans-serif"
          fontWeight={680}
          fill={color}
          stroke="#ffffff"
          strokeWidth={2.2}
          glow={false}
          localElapsed={Math.max(0, localElapsed - 45)}
          windowMs={writingWindow}
          seed={`${seed}-label`}
        />
        <path
          d={path}
          pathLength={1}
          fill="none"
          stroke={color}
          strokeWidth="2.8"
          strokeLinecap="round"
          strokeDasharray="1"
          strokeDashoffset={1 - connectorProgress}
        />
        <circle cx={px} cy={py} r="5" fill={color} stroke="#ffffff" strokeWidth="2" opacity={connectorProgress > 0.82 ? 0.95 : 0} />
        <circle cx={px} cy={py} r="11" fill={color} opacity={connectorProgress > 0.82 ? 0.15 : 0} />
      </g>
    );
  }

  return (
    <g opacity={reveal} filter={paperSurface ? undefined : "url(#live-glow)"}>
      {/* Dashed line from label to pin */}
      <path d={path} fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeDasharray="6 5" opacity="0.85" />
      {/* Pin dot — small precise circle on the subject */}
      <circle cx={px} cy={py} r="5" fill={color} stroke={paperSurface ? "#ffffff" : "#020617"} strokeWidth="2" opacity="0.95" />
      <circle cx={px} cy={py} r="11" fill={color} opacity="0.15" />
      {/* Label chip */}
      <rect x={chipX} y={textY - 24} width={chipW} height="36" rx="6" fill={paperSurface ? "#ffffff" : "#0a0f1a"} opacity={paperSurface ? 0.94 : 0.88} />
      <rect x={chipX} y={textY - 24} width={chipW} height="36" rx="6" fill="none" stroke={paperSurface ? "#d1d5db" : color} strokeWidth="1.5" opacity="0.9" />
      <text
        x={textX}
        y={textY}
        textAnchor={anchor}
        style={{
          fontSize: 17,
          fontFamily: "var(--font-display, 'Space Grotesk', sans-serif)",
          fontWeight: 700,
          fill: paperSurface ? color : "#f8fafc",
          paintOrder: "stroke",
          stroke: paperSurface ? "#ffffff" : "#0a0f1a",
          strokeWidth: paperSurface ? 2 : 3,
          strokeLinejoin: "round",
          letterSpacing: "0.02em",
        }}
      >
        {op.text}
      </text>
    </g>
  );
}

/**
 * Staggered build-in: element i of n gets its own 0→1 entrance curve inside the first
 * `window` fraction of scene progress, so nodes/tags pop in one-by-one instead of all
 * appearing with the card. Returns 0 before the element's slot, 1 once it has landed.
 */
function stagger(progress: number, i: number, n: number, window = 0.42): number {
  const slot = window / Math.max(1, n);
  const start = 0.08 + i * slot;
  return clamp01((progress - start) / Math.max(0.001, slot * 1.4));
}

/** Spring-ish ease with a small overshoot (~4%) that settles — the "pop" in pop-in. */
function springPop(t: number): number {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  return 1 - Math.exp(-5.2 * t) * Math.cos(9 * t);
}

/** Wraps children in a scale-about-point transform driven by a spring entrance. */
function PopGroup({ t, cx, cy, children }: { t: number; cx: number; cy: number; children: ReactNode }) {
  const s = 0.6 + 0.4 * springPop(t);
  return (
    <g opacity={Math.min(1, t * 2.2)} transform={`translate(${cx} ${cy}) scale(${s}) translate(${-cx} ${-cy})`}>
      {children}
    </g>
  );
}

function SceneRenderer({
  op,
  startMs,
  elapsed,
  duration,
  seed,
  contextTitle,
}: {
  op: Extract<DrawOp, { kind: "scene" }>;
  startMs: number;
  elapsed: number;
  duration: number;
  seed: string;
  contextTitle?: string;
}) {
  const localElapsed = Math.max(0, elapsed - startMs);
  const endMs = (op.endAt ?? Math.min(0.96, op.at + 0.58)) * duration;
  const progress = endMs > startMs ? clamp01((elapsed - startMs) / (endMs - startMs)) : 1;
  const reveal = clamp01(localElapsed / 650);
  const color = op.color ?? "#5eead4";
  const items = sceneItems(op, contextTitle).slice(0, 4);
  const cleanTitle = op.title && !isFillerSceneText(op.title) ? op.title : undefined;
  const title = cleanTitle || sceneTitle(op.scene, items, contextTitle);
  const gradientId = `${seed}-scene-grad`;
  const glowId = `${seed}-scene-glow`;

  // Spring scale-in entrance about the card center, then a very slow breathing scale via the
  // nested animateTransform — gentle camera life without touching any child coordinates.
  const cardT = clamp01(localElapsed / 480);
  const cardScale = 0.92 + 0.08 * springPop(cardT);

  return (
    <g opacity={reveal} transform={`translate(500 300) scale(${cardScale}) translate(-500 -300)`}>
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.32" />
          <stop offset="100%" stopColor="#38bdf8" stopOpacity="0.14" />
        </linearGradient>
        <filter id={glowId} x="-35%" y="-35%" width="170%" height="170%">
          <feGaussianBlur stdDeviation="6" result="blur" />
          <feColorMatrix in="blur" type="matrix" values="0 0 0 0 0.35 0 0 0 0 0.9 0 0 0 0 0.86 0 0 0 0.58 0" />
          <feMerge>
            <feMergeNode />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      {/* A genuinely opaque backing card behind every scene type — diagrams must stay legible
          regardless of how bright/busy the photo underneath is. Previously each scene drew its
          shapes/text directly over the photo with at most a translucent (≤0.5 opacity)
          gradient, which is why axes/labels collided with faces and other busy photo detail.
          Sized to the standard scene canvas (x:140-860, y:84-516) every scene draws within. */}
      <rect x="140" y="84" width="720" height="432" rx="36" fill="#020617" opacity="1" />
      <rect x="140" y="84" width="720" height="432" rx="36" fill="none" stroke={color} strokeOpacity="0.5" strokeWidth="2.5" />
      {op.scene === "spotlight" && <SpotlightScene title={title} items={items} color={color} gradientId={gradientId} glowId={glowId} progress={progress} />}
      {op.scene === "process" && <ProcessScene title={title} items={items} color={color} glowId={glowId} progress={progress} />}
      {op.scene === "compare" && <CompareScene title={title} items={items} left={op.left} right={op.right} color={color} gradientId={gradientId} glowId={glowId} progress={progress} />}
      {op.scene === "cycle" && <CycleScene title={title} items={items} color={color} gradientId={gradientId} glowId={glowId} progress={progress} />}
      {op.scene === "system" && <SystemScene title={title} items={items} color={color} gradientId={gradientId} glowId={glowId} progress={progress} />}
      {op.scene === "timeline" && <TimelineScene title={title} items={items} color={color} glowId={glowId} progress={progress} />}
      {op.scene === "graph" && <GraphScene title={title} items={items} color={color} gradientId={gradientId} glowId={glowId} progress={progress} />}
    </g>
  );
}

function sceneItems(op: Extract<DrawOp, { kind: "scene" }>, contextTitle?: string) {
  const cleanItems = (op.items ?? []).filter((item) => !isFillerSceneText(item));
  if (cleanItems.length >= 2) return cleanItems;
  const titleWords = (contextTitle || op.title || "")
    .split(/\s+/)
    .map((word) => word.replace(/[^a-zA-Z0-9-]/g, ""))
    .filter((word) => word.length > 3 && !isFillerSceneText(word))
    .slice(0, 4);
  if (titleWords.length >= 2) return titleWords;
  if (op.scene === "compare") return [op.left || "first side", op.right || "other side", "shared outcome"];
  if (op.scene === "cycle") return ["input", "turning point", "return"];
  if (op.scene === "graph") return ["supply", "demand", "equilibrium"];
  if (op.scene === "system") return ["cause", "response", "outcome"];
  return [op.title || "concept", "detail", "why it matters"];
}

function sceneTitle(scene: DrawScene, items: string[], contextTitle?: string) {
  if (contextTitle && !isFillerSceneText(contextTitle)) return contextTitle;
  if (scene === "compare") return `${items[0]} vs ${items[1] ?? "other side"}`;
  if (scene === "cycle") return `${items[0]} loop`;
  if (scene === "graph") return `${items[0]} and ${items[1] ?? "demand"}`;
  if (scene === "timeline") return `${items[0]} over time`;
  if (scene === "system") return `How ${items[0]} connects`;
  if (scene === "spotlight") return `${items[0]} up close`;
  return items.slice(0, 3).join(" -> ");
}

function isFillerSceneText(text: string) {
  return /^(watch the idea change|start|change|result|energy|focus|main idea|key detail|outcome|step\s*\d*)$/i.test(text.trim());
}

function SpotlightScene({
  title,
  items,
  color,
  gradientId,
  glowId,
  progress,
}: {
  title?: string;
  items: string[];
  color: string;
  gradientId: string;
  glowId: string;
  progress: number;
}) {
  const focusX = lerp(410, 610, progress);
  return (
    <g filter={`url(#${glowId})`}>
      <path d="M 92 120 C 280 70 720 74 908 132 L 908 468 C 718 520 280 516 92 456 Z" fill="#022c22" opacity="0.34" stroke={color} strokeWidth="3" />
      <path d={`M ${focusX - 60} 96 L ${focusX + 54} 96 L ${focusX + 116} 470 L ${focusX - 2} 470 Z`} fill="#fde68a" opacity="0.36">
        <animate attributeName="opacity" values="0.18;0.42;0.18" dur="3.4s" repeatCount="indefinite" />
      </path>
      <ellipse cx={focusX} cy="300" rx="185" ry="118" fill={`url(#${gradientId})`} stroke="#d9f99d" strokeWidth="5" opacity="0.78">
        <animate attributeName="rx" values="170;194;170" dur="3.2s" repeatCount="indefinite" />
      </ellipse>
      <SceneText x={500} y={142} text={title || "zoom into the important part"} size={31} maxChars={28} fill="#f8fafc" />
      {items.slice(0, 3).map((item, i) => (
        <g key={item} opacity={progress > i * 0.22 ? 1 : 0.24}>
          <path
            d={`M ${240 + i * 220} ${390 - i * 76} C ${320 + i * 110} ${342 - i * 28} ${focusX - 80 + i * 48} ${306 - i * 22} ${focusX - 18 + i * 28} ${292 - i * 18}`}
            fill="none"
            stroke={i === 0 ? color : "#fde68a"}
            strokeWidth="7"
            strokeLinecap="round"
            strokeDasharray="20 18"
          >
            <animate attributeName="stroke-dashoffset" from="0" to="-180" dur={`${2.4 + i * 0.25}s`} repeatCount="indefinite" />
          </path>
          <PopGroup t={stagger(progress, i, 3, 0.36)} cx={230 + i * 240} cy={420 - i * 90}>
            <SceneTag x={230 + i * 240} y={420 - i * 90} text={item} color={i === 0 ? color : "#facc15"} />
          </PopGroup>
        </g>
      ))}
    </g>
  );
}

function ProcessScene({
  title,
  items,
  color,
  glowId,
  progress,
}: {
  title?: string;
  items: string[];
  color: string;
  glowId: string;
  progress: number;
}) {
  const joined = `${title ?? ""} ${items.join(" ")}`.toLowerCase();
  if (/\b(photosynthesis|chlorophyll|chloroplast|glucose|sunlight|photons?|light absorption|electron|atp|nadph)\b/.test(joined)) {
    return <PhotosynthesisFlowScene title={title} items={items} color={color} glowId={glowId} progress={progress} />;
  }
  const points = scenePoints(items.length, 140, 820, 320, 42);
  const path = pathFromPoints(points);
  return (
    <g filter={`url(#${glowId})`}>
      <path d="M 110 130 C 300 82 698 84 890 138 L 890 430 C 694 484 300 482 110 430 Z" fill="#020617" opacity="0.44" stroke={color} strokeWidth="3" />
      <SceneText x={500} y={146} text={title || items.slice(0, 3).join(" -> ")} size={34} maxChars={30} fill="#f8fafc" />
      <path d={path} fill="none" stroke="#e0f2fe" strokeWidth="18" strokeLinecap="round" opacity="0.18" />
      <path d={path} fill="none" stroke={color} strokeWidth="9" strokeLinecap="round" strokeDasharray="28 20" opacity="0.9">
        <animate attributeName="stroke-dashoffset" from="0" to="-220" dur="2.8s" repeatCount="indefinite" />
      </path>
      {[0, 1, 2].map((i) => (
        <circle key={i} r="9" fill="#ffffff">
          <animateMotion dur={`${3 + i * 0.22}s`} begin={`${i * 0.32}s`} repeatCount="indefinite" path={path} />
          <animate attributeName="opacity" values="0;1;0" dur={`${3 + i * 0.22}s`} begin={`${i * 0.32}s`} repeatCount="indefinite" />
        </circle>
      ))}
      {points.map((point, i) => {
        const active = progress >= i / Math.max(1, points.length - 1) - 0.04;
        return (
          <PopGroup key={`${items[i]}-${i}`} t={stagger(progress, i, points.length)} cx={point.x} cy={point.y}>
            <g opacity={active ? 1 : 0.28}>
              <circle cx={point.x} cy={point.y} r="48" fill="#020617" opacity="0.72" stroke={active ? color : "#94a3b8"} strokeWidth={active ? 7 : 3}>
                {active && <animate attributeName="r" values="54;61;54" dur="2.6s" repeatCount="indefinite" />}
              </circle>
              <circle cx={point.x} cy={point.y} r="24" fill={color} opacity="0.2" />
              <SceneText x={point.x} y={point.y - 4} text={`${i + 1}`} size={21} maxChars={3} fill="#f8fafc" />
              <SceneText x={point.x} y={point.y + 70} text={items[i]} size={20} maxChars={15} fill="#f8fafc" />
            </g>
          </PopGroup>
        );
      })}
    </g>
  );
}

function PhotosynthesisFlowScene({
  title,
  color,
  glowId,
  progress,
}: {
  title?: string;
  items: string[];
  color: string;
  glowId: string;
  progress: number;
}) {
  const path = "M 156 294 C 268 220 360 220 446 288 C 536 358 628 358 752 286";
  const active = (threshold: number) => progress > threshold;
  return (
    <g filter={`url(#${glowId})`}>
      <SceneText x={500} y={118} text={title || "Light becomes stored energy"} size={34} maxChars={34} fill="#f8fafc" />
      <circle cx="178" cy="196" r="48" fill="#facc15" opacity="0.95">
        <animate attributeName="r" values="43;52;43" dur="2.4s" repeatCount="indefinite" />
      </circle>
      {[0, 1, 2, 3].map((i) => (
        <path key={i} d={`M ${204 + i * 10} ${218 + i * 18} C ${278 + i * 22} ${236 + i * 10} ${338 + i * 30} ${262 + i * 2} ${414 + i * 18} ${286 - i * 8}`} stroke="#fde68a" strokeWidth="7" strokeLinecap="round" strokeDasharray="20 18" opacity="0.88" fill="none">
          <animate attributeName="stroke-dashoffset" from="0" to="-190" dur={`${2.1 + i * 0.22}s`} repeatCount="indefinite" />
        </path>
      ))}
      <ellipse cx="450" cy="306" rx="124" ry="86" fill="#14532d" opacity="0.72" stroke="#86efac" strokeWidth="6" />
      <path d="M 378 310 C 414 252 490 248 526 306 C 486 366 414 368 378 310 Z" fill="#22c55e" opacity="0.64" />
      <SceneText x={450} y={314} text="chlorophyll" size={24} maxChars={14} fill="#ecfdf5" />
      <circle cx="450" cy="306" r={active(0.42) ? 20 : 10} fill="#fef08a" opacity="0.92" stroke="#fff7ed" strokeWidth="4">
        <animate attributeName="opacity" values="0.55;1;0.55" dur="1.6s" repeatCount="indefinite" />
      </circle>
      <path d={path} fill="none" stroke="#e0f2fe" strokeWidth="18" strokeLinecap="round" opacity="0.14" />
      <path d={path} fill="none" stroke={color} strokeWidth="8" strokeLinecap="round" strokeDasharray="28 18" opacity="0.9">
        <animate attributeName="stroke-dashoffset" from="0" to="-230" dur="2.6s" repeatCount="indefinite" />
      </path>
      {[0, 1, 2].map((i) => (
        <circle key={i} r={i === 0 ? 10 : 7} fill={i === 0 ? "#fff7ed" : "#bfdbfe"} opacity="0.95">
          <animateMotion dur={`${2.7 + i * 0.18}s`} begin={`${i * 0.34}s`} repeatCount="indefinite" path={path} />
          <animate attributeName="opacity" values="0;1;0" dur={`${2.7 + i * 0.18}s`} begin={`${i * 0.34}s`} repeatCount="indefinite" />
        </circle>
      ))}
      <PopGroup t={stagger(progress, 0, 3, 0.48)} cx={178} cy={388}>
        <SceneTag x={178} y={388} text="photons arrive" color="#f59e0b" />
      </PopGroup>
      <PopGroup t={stagger(progress, 1, 3, 0.48)} cx={450} cy={424}>
        <SceneTag x={450} y={424} text="electron jumps" color="#22c55e" />
      </PopGroup>
      <PopGroup t={stagger(progress, 2, 3, 0.48)} cx={744} cy={388}>
        <SceneTag x={744} y={388} text="ATP/NADPH carry energy" color="#38bdf8" />
      </PopGroup>
    </g>
  );
}

function CompareScene({
  title,
  items,
  left,
  right,
  color,
  gradientId,
  glowId,
  progress,
}: {
  title?: string;
  items: string[];
  left?: string;
  right?: string;
  color: string;
  gradientId: string;
  glowId: string;
  progress: number;
}) {
  const leftItems = items.slice(0, Math.ceil(items.length / 2));
  const rightItems = items.slice(Math.ceil(items.length / 2));
  // Panels glide in from their own side with a spring, left first then right — a staged
  // "here's one side… now the other" reveal instead of both simply fading in.
  const leftIn = springPop(stagger(progress, 0, 2, 0.3));
  const rightIn = springPop(stagger(progress, 1, 2, 0.3));
  return (
    <g filter={`url(#${glowId})`}>
      <SceneText x={500} y={100} text={title || "compare the two sides"} size={36} maxChars={34} fill="#f8fafc" />
      <g opacity={Math.min(1, leftIn * 1.6)} transform={`translate(${(1 - leftIn) * -46} 0)`}>
        <path d="M 82 148 L 472 122 L 472 470 L 112 444 Z" fill="#064e3b" opacity={progress < 0.55 ? 0.72 : 0.42} stroke={color} strokeWidth="4" />
        <SceneText x={277} y={198} text={left || "first side"} size={34} maxChars={18} fill="#ffffff" />
        <SceneList x={277} y={270} items={leftItems.length ? leftItems : ["input", "change"]} color={color} />
      </g>
      <g opacity={Math.min(1, rightIn * 1.6)} transform={`translate(${(1 - rightIn) * 46} 0)`}>
        <path d="M 528 122 L 918 148 L 888 444 L 528 470 Z" fill="#0f3b57" opacity={progress >= 0.45 ? 0.72 : 0.42} stroke="#38bdf8" strokeWidth="4" />
        <SceneText x={723} y={198} text={right || "other side"} size={34} maxChars={18} fill="#ffffff" opacity={progress >= 0.35 ? 1 : 0.38} />
        <SceneList x={723} y={270} items={rightItems.length ? rightItems : ["output", "result"]} color="#38bdf8" dim={progress < 0.42} />
      </g>
      <path d="M 476 296 C 508 276 514 276 546 296" stroke="#f8fafc" strokeWidth="8" strokeLinecap="round" fill="none" strokeDasharray="18 14">
        <animate attributeName="stroke-dashoffset" from="0" to="-160" dur="2.2s" repeatCount="indefinite" />
      </path>
      <SceneText x={500} y={486} text="two forces, one outcome" size={22} maxChars={36} fill="#dbeafe" opacity={0.86} />
      <rect x="454" y="244" width="92" height="92" rx="46" fill={`url(#${gradientId})`} opacity="0.58">
        <animate attributeName="opacity" values="0.28;0.7;0.28" dur="2.8s" repeatCount="indefinite" />
      </rect>
    </g>
  );
}

function CycleScene({
  title,
  items,
  color,
  gradientId,
  glowId,
  progress,
}: {
  title?: string;
  items: string[];
  color: string;
  gradientId: string;
  glowId: string;
  progress: number;
}) {
  const cx = 500;
  const cy = 302;
  const r = 168;
  const nodes = items.map((item, i) => {
    const angle = -Math.PI / 2 + (i / items.length) * Math.PI * 2;
    return { item, x: cx + Math.cos(angle) * r, y: cy + Math.sin(angle) * r };
  });
  return (
    <g filter={`url(#${glowId})`}>
      <SceneText x={500} y={116} text={title || "the loop keeps going"} size={35} maxChars={32} fill="#f8fafc" />
      <circle cx={cx} cy={cy} r={r + 34} fill={`url(#${gradientId})`} opacity="0.34" />
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="#dbeafe" strokeWidth="6" strokeDasharray="24 18" opacity="0.82">
        <animate attributeName="stroke-dashoffset" from="0" to="-220" dur="3.4s" repeatCount="indefinite" />
      </circle>
      <circle r="11" fill={color}>
        <animateMotion dur="4s" repeatCount="indefinite" path={`M ${cx} ${cy - r} A ${r} ${r} 0 1 1 ${cx - 1} ${cy - r}`} />
      </circle>
      <circle cx={cx} cy={cy} r="82" fill="#ffffff" opacity="0.92" />
      <SceneText x={cx} y={cy + 8} text="cycle" size={28} maxChars={10} fill="#0f172a" />
      {nodes.map((node, i) => {
        const active = progress >= i / Math.max(1, nodes.length);
        return (
          <PopGroup key={`${node.item}-${i}`} t={stagger(progress, i, nodes.length)} cx={node.x} cy={node.y}>
            <g opacity={active ? 1 : 0.32}>
              <circle cx={node.x} cy={node.y} r="44" fill="#020617" opacity="0.74" stroke={active ? color : "#94a3b8"} strokeWidth={active ? 7 : 4} />
              <SceneText x={node.x} y={node.y + 6} text={node.item} size={18} maxChars={13} fill="#f8fafc" />
            </g>
          </PopGroup>
        );
      })}
    </g>
  );
}

function SystemScene({
  title,
  items,
  color,
  gradientId,
  glowId,
  progress,
}: {
  title?: string;
  items: string[];
  color: string;
  gradientId: string;
  glowId: string;
  progress: number;
}) {
  const joined = `${title} ${items.join(" ")}`.toLowerCase();
  if (/\b(collapse|gravity|core|fuel|black hole|event horizon)\b/.test(joined)) {
    return <CollapseSystemScene title={title} items={items} color={color} gradientId={gradientId} glowId={glowId} progress={progress} />;
  }
  const left = items.slice(0, 2);
  const right = items.slice(2, 4);
  const center = shortSceneText(items[1] || items[0] || title || "system", 20);
  return (
    <g filter={`url(#${glowId})`}>
      <SceneText x={500} y={120} text={title || "how the system connects"} size={34} maxChars={34} fill="#f8fafc" />
      <circle cx="500" cy="306" r="130" fill={`url(#${gradientId})`} opacity="0.5" />
      <circle cx="500" cy="306" r="164" fill="none" stroke="#93c5fd" strokeWidth="4" opacity="0.36" />
      <SceneText x={500} y={314} text={center} size={28} maxChars={16} fill="#ffffff" />
      <PopGroup t={stagger(progress, 0, 2, 0.3)} cx={220} cy={290}>
        <SceneList x={220} y={250} items={left.length ? left : ["cause", "input"]} color={color} />
      </PopGroup>
      <PopGroup t={stagger(progress, 1, 2, 0.3)} cx={780} cy={290}>
        <SceneList x={780} y={250} items={right.length ? right : ["effect", "output"]} color="#38bdf8" dim={progress < 0.42} />
      </PopGroup>
      {[230, 770].map((x, i) => (
        <path key={x} d={i === 0 ? "M 320 296 C 376 260 418 260 458 292" : "M 542 292 C 596 258 652 258 704 296"} fill="none" stroke={i === 0 ? color : "#38bdf8"} strokeWidth="8" strokeLinecap="round" strokeDasharray="18 14" opacity={i === 0 || progress > 0.35 ? 0.92 : 0.28}>
          <animate attributeName="stroke-dashoffset" from="0" to="-170" dur={`${2.4 + i * 0.2}s`} repeatCount="indefinite" />
        </path>
      ))}
    </g>
  );
}

function TimelineScene({
  title,
  items,
  color,
  glowId,
  progress,
}: {
  title?: string;
  items: string[];
  color: string;
  glowId: string;
  progress: number;
}) {
  const points = scenePoints(items.length, 130, 870, 324, 0);
  const cursorX = lerp(points[0]?.x ?? 130, points[points.length - 1]?.x ?? 870, progress);
  return (
    <g filter={`url(#${glowId})`}>
      <SceneText x={500} y={150} text={title || "build it over time"} size={36} maxChars={32} fill="#f8fafc" />
      <line x1="130" y1="324" x2="870" y2="324" stroke="#e0f2fe" strokeWidth="10" strokeLinecap="round" opacity="0.24" />
      <line x1="130" y1="324" x2={cursorX} y2="324" stroke={color} strokeWidth="11" strokeLinecap="round" />
      <circle cx={cursorX} cy="324" r="18" fill="#ffffff" stroke={color} strokeWidth="8">
        <animate attributeName="r" values="14;22;14" dur="2s" repeatCount="indefinite" />
      </circle>
      {points.map((point, i) => {
        const active = progress >= i / Math.max(1, points.length - 1) - 0.04;
        return (
          <PopGroup key={`${items[i]}-${i}`} t={stagger(progress, i, points.length)} cx={point.x} cy={324}>
            <g opacity={active ? 1 : 0.34}>
              <line x1={point.x} y1="300" x2={point.x} y2="348" stroke={active ? color : "#64748b"} strokeWidth="5" strokeLinecap="round" />
              <SceneTag x={point.x} y={i % 2 === 0 ? 236 : 404} text={items[i]} color={active ? color : "#64748b"} />
            </g>
          </PopGroup>
        );
      })}
    </g>
  );
}

function GraphScene({
  title,
  items,
  color,
  gradientId,
  glowId,
  progress,
}: {
  title?: string;
  items: string[];
  color: string;
  gradientId: string;
  glowId: string;
  progress: number;
}) {
  const joined = `${title ?? ""} ${items.join(" ")}`.toLowerCase();
  const supplyOnly = /\bsupply\b/.test(joined) && !/\bdemand|equilibrium\b/.test(joined);
  const demandOnly = /\bdemand\b/.test(joined) && !/\bsupply|equilibrium\b/.test(joined);
  if (supplyOnly || demandOnly) {
    return <SingleCurveGraphScene title={title} kind={supplyOnly ? "supply" : "demand"} color={color} gradientId={gradientId} glowId={glowId} progress={progress} />;
  }
  const demand = items.find((item) => /demand|buyer|want/i.test(item)) ?? "Demand";
  const supply = items.find((item) => /supply|seller|offer/i.test(item)) ?? "Supply";
  const equilibrium = items.find((item) => /equilibrium|balance|price/i.test(item)) ?? "Equilibrium";
  const left = 200;
  const bottom = 432;
  const right = 820;
  const top = 132;
  const eqX = 510;
  const eqY = 282;
  const supplyPath = `M ${left + 42} ${bottom - 28} C 350 380 450 310 ${eqX} ${eqY} C 610 238 720 184 ${right - 42} ${top + 34}`;
  const demandPath = `M ${left + 42} ${top + 34} C 340 178 450 236 ${eqX} ${eqY} C 610 338 718 386 ${right - 42} ${bottom - 28}`;
  return (
    <g filter={`url(#${glowId})`}>
      <SceneText x={500} y={104} text={title || "Where supply meets demand"} size={34} maxChars={34} fill="#f8fafc" />
      {/* The shared opaque backing card in SceneRenderer now handles legibility — this stays
          as a thin accent frame plus a faint inner wash, not a second translucent panel. */}
      <rect x="146" y="114" width="708" height="366" rx="34" fill={`url(#${gradientId})`} opacity="0.22" stroke={color} strokeWidth="3" />
      <path d={`M ${left} ${top} L ${left} ${bottom} L ${right} ${bottom}`} fill="none" stroke="#e0f2fe" strokeWidth="7" strokeLinecap="round" opacity="0.82" />
      <text x={right - 26} y={bottom + 36} textAnchor="end" style={{ fontSize: 22, fontWeight: 900, fill: "#e0f2fe" }}>quantity</text>
      <text x={left - 22} y={top - 18} textAnchor="middle" style={{ fontSize: 22, fontWeight: 900, fill: "#e0f2fe" }}>price</text>
      <path d={`M ${left + 16} ${eqY} L ${eqX} ${eqY} L ${eqX} ${bottom - 16}`} fill="none" stroke="#fde68a" strokeWidth="4" strokeDasharray="10 10" opacity={progress > 0.45 ? 0.86 : 0.28} />
      <path d={supplyPath} fill="none" stroke="#38bdf8" strokeWidth="10" strokeLinecap="round" opacity="0.94" strokeDasharray="700" strokeDashoffset={progress < 0.2 ? 700 : 0} style={{ transition: "stroke-dashoffset 900ms ease" }} />
      <path d={demandPath} fill="none" stroke="#fb7185" strokeWidth="10" strokeLinecap="round" opacity="0.94" strokeDasharray="700" strokeDashoffset={progress < 0.34 ? 700 : 0} style={{ transition: "stroke-dashoffset 900ms ease" }} />
      <path d={`M ${left + 62} ${top + 70} C 376 226 452 262 ${eqX} ${eqY} C 436 336 350 374 ${left + 70} ${bottom - 64} Z`} fill="#fb7185" opacity="0.16" />
      <path d={`M ${right - 70} ${top + 70} C 626 218 558 258 ${eqX} ${eqY} C 582 338 674 374 ${right - 70} ${bottom - 64} Z`} fill="#38bdf8" opacity="0.14" />
      <circle cx={eqX} cy={eqY} r={progress > 0.5 ? 19 : 8} fill="#facc15" stroke="#fff7ed" strokeWidth="5" style={{ transition: "r 500ms ease" }}>
        <animate attributeName="opacity" values="0.85;1;0.85" dur="1.8s" repeatCount="indefinite" />
      </circle>
      <SceneTag x={672} y={196} text={supply} color="#38bdf8" />
      <SceneTag x={340} y={196} text={demand} color="#fb7185" />
      <SceneTag x={eqX + 168} y={eqY + 32} text={equilibrium} color="#f59e0b" />
      <path d={`M ${eqX + 82} ${eqY + 22} C ${eqX + 44} ${eqY + 10} ${eqX + 28} ${eqY + 6} ${eqX + 8} ${eqY + 2}`} fill="none" stroke="#f59e0b" strokeWidth="5" strokeLinecap="round" markerEnd="url(#live-arrow)" />
      <circle r="7" fill="#fff7ed">
        <animateMotion dur="3s" repeatCount="indefinite" path={supplyPath} />
      </circle>
      <circle r="7" fill="#fff7ed">
        <animateMotion dur="3.2s" repeatCount="indefinite" path={demandPath} />
      </circle>
    </g>
  );
}

function SingleCurveGraphScene({
  title,
  kind,
  color,
  gradientId,
  glowId,
  progress,
}: {
  title?: string;
  kind: "supply" | "demand";
  color: string;
  gradientId: string;
  glowId: string;
  progress: number;
}) {
  const left = 210;
  const bottom = 430;
  const right = 820;
  const top = 136;
  const curveColor = kind === "supply" ? "#38bdf8" : "#fb7185";
  const startY = kind === "supply" ? bottom - 34 : top + 34;
  const endY = kind === "supply" ? top + 34 : bottom - 34;
  const curve = `M ${left + 46} ${startY} C 376 ${kind === "supply" ? 370 : 190} 536 ${kind === "supply" ? 250 : 316} ${right - 46} ${endY}`;
  const p1 = { x: 388, y: kind === "supply" ? 346 : 222 };
  const p2 = { x: 650, y: kind === "supply" ? 224 : 350 };
  const dotX = lerp(p1.x, p2.x, progress);
  const dotY = lerp(p1.y, p2.y, progress);
  const lowerTag = kind === "supply" ? "higher price makes output worthwhile" : "higher price pushes buyers out";
  return (
    <g filter={`url(#${glowId})`}>
      <SceneText x={500} y={104} text={title || (kind === "supply" ? "Law of Supply" : "Law of Demand")} size={34} maxChars={34} fill="#f8fafc" />
      <rect x="146" y="114" width="708" height="366" rx="34" fill={`url(#${gradientId})`} opacity="0.2" stroke={color} strokeWidth="3" />
      <path d={`M ${left} ${top} L ${left} ${bottom} L ${right} ${bottom}`} fill="none" stroke="#e0f2fe" strokeWidth="7" strokeLinecap="round" opacity="0.82" />
      <text x={right - 26} y={bottom + 36} textAnchor="end" style={{ fontSize: 22, fontWeight: 900, fill: "#e0f2fe" }}>quantity</text>
      <text x={left - 22} y={top - 18} textAnchor="middle" style={{ fontSize: 22, fontWeight: 900, fill: "#e0f2fe" }}>price</text>
      <path d={curve} fill="none" stroke={curveColor} strokeWidth="12" strokeLinecap="round" opacity="0.95" strokeDasharray="760" strokeDashoffset={progress < 0.18 ? 760 : 0} style={{ transition: "stroke-dashoffset 900ms ease" }} />
      <path d={`M ${left + 12} ${dotY} L ${dotX} ${dotY} L ${dotX} ${bottom - 10}`} fill="none" stroke="#fde68a" strokeWidth="4" strokeDasharray="10 10" opacity="0.9" />
      <circle cx={dotX} cy={dotY} r="18" fill="#facc15" stroke="#fff7ed" strokeWidth="5">
        <animate attributeName="r" values="14;22;14" dur="1.8s" repeatCount="indefinite" />
      </circle>
      <circle cx={p1.x} cy={p1.y} r="9" fill="#94a3b8" opacity="0.7" />
      <circle cx={p2.x} cy={p2.y} r="11" fill="#fff7ed" opacity={progress > 0.55 ? 0.95 : 0.35} />
      <SceneTag x={p1.x - 80} y={p1.y + (kind === "supply" ? 46 : -46)} text={kind === "supply" ? "low price" : "high price"} color="#64748b" />
      <SceneTag x={p2.x + 88} y={p2.y + (kind === "supply" ? -46 : 46)} text={kind === "supply" ? "more supplied" : "less demanded"} color={curveColor} />
      <SceneText x={500} y={488} text={lowerTag} size={22} maxChars={44} fill="#dbeafe" opacity={0.9} />
      <circle r="7" fill="#fff7ed">
        <animateMotion dur="3s" repeatCount="indefinite" path={curve} />
      </circle>
    </g>
  );
}

function scenePoints(count: number, startX: number, endX: number, baseY: number, wave: number) {
  const total = Math.max(1, count);
  return Array.from({ length: total }, (_, i) => {
    const t = total === 1 ? 0.5 : i / (total - 1);
    return { x: lerp(startX, endX, t), y: baseY + Math.sin(t * Math.PI * 2) * wave };
  });
}

function pathFromPoints(points: { x: number; y: number }[]) {
  if (points.length === 0) return "";
  return points.map((point, i) => `${i === 0 ? "M" : "L"} ${point.x} ${point.y}`).join(" ");
}

function SceneList({ x, y, items, color, dim = false }: { x: number; y: number; items: string[]; color: string; dim?: boolean }) {
  return (
    <g opacity={dim ? 0.42 : 1}>
      {items.slice(0, 2).map((item, i) => (
        <SceneTag key={`${item}-${i}`} x={x} y={y + i * 70} text={item} color={color} />
      ))}
    </g>
  );
}

function SceneTag({ x, y, text, color }: { x: number; y: number; text: string; color: string }) {
  const width = Math.min(230, Math.max(104, text.length * 11 + 34));
  return (
    <g filter="url(#live-glow)">
      <rect x={x - width / 2} y={y - 27} width={width} height="45" rx="23" fill={color} opacity="0.84" />
      <path d={`M ${x - width * 0.36} ${y + 18} C ${x - width * 0.12} ${y + 25} ${x + width * 0.12} ${y + 25} ${x + width * 0.36} ${y + 18}`} fill="none" stroke="#fff7ed" strokeWidth="3" strokeLinecap="round" opacity="0.72" />
      <SceneText x={x} y={y + 4} text={text} size={20} maxChars={18} fill="#fff7ed" />
    </g>
  );
}

function CollapseSystemScene({
  title,
  items,
  color,
  gradientId,
  glowId,
  progress,
}: {
  title?: string;
  items: string[];
  color: string;
  gradientId: string;
  glowId: string;
  progress: number;
}) {
  const core = items.find((item) => /core/i.test(item)) ?? items[0] ?? "core";
  const gravity = items.find((item) => /gravity|pull/i.test(item)) ?? items[1] ?? "gravity pulls";
  const fuel = items.find((item) => /fuel|pressure|balance/i.test(item)) ?? items[2] ?? "fuel pressure";
  const result = items.find((item) => /horizon|collapse|black/i.test(item)) ?? items[3] ?? "collapse";
  const cx = 500;
  const cy = 312;
  const squeeze = 1 - progress * 0.34;
  return (
    <g filter={`url(#${glowId})`}>
      <SceneText x={500} y={112} text={title || "Collapse: forces lose balance"} size={34} maxChars={34} fill="#f8fafc" />
      <circle cx={cx} cy={cy} r="214" fill={`url(#${gradientId})`} opacity="0.18" />
      <circle cx={cx} cy={cy} r="188" fill="none" stroke="#fca5a5" strokeWidth="5" strokeDasharray="24 18" opacity="0.48">
        <animate attributeName="stroke-dashoffset" from="0" to="220" dur="3.2s" repeatCount="indefinite" />
      </circle>
      <g transform={`translate(${cx} ${cy}) scale(${squeeze}) translate(${-cx} ${-cy})`}>
        <circle cx={cx} cy={cy} r="118" fill="#7f1d1d" opacity="0.58" />
        <circle cx={cx} cy={cy} r="72" fill="#f97316" opacity="0.74">
          <animate attributeName="r" values="76;62;76" dur="2.4s" repeatCount="indefinite" />
        </circle>
        <circle cx={cx} cy={cy} r="28" fill="#fff7ed" opacity="0.86" />
      </g>
      {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => {
        const angle = (Math.PI * 2 * i) / 8;
        const x1 = cx + Math.cos(angle) * 248;
        const y1 = cy + Math.sin(angle) * 178;
        const x2 = cx + Math.cos(angle) * 118;
        const y2 = cy + Math.sin(angle) * 86;
        return (
          <path key={i} d={`M ${x1} ${y1} L ${x2} ${y2}`} stroke={color} strokeWidth="7" strokeLinecap="round" opacity="0.72" markerEnd="url(#live-arrow)">
            <animate attributeName="opacity" values="0.22;0.86;0.22" dur={`${2 + i * 0.08}s`} begin={`${i * 0.12}s`} repeatCount="indefinite" />
          </path>
        );
      })}
      <path d="M 318 314 C 392 242 608 242 682 314" fill="none" stroke="#38bdf8" strokeWidth="8" strokeLinecap="round" strokeDasharray="26 18" opacity={progress < 0.55 ? 0.86 : 0.28}>
        <animate attributeName="stroke-dashoffset" from="0" to="-180" dur="2.7s" repeatCount="indefinite" />
      </path>
      <path d="M 360 388 C 432 456 568 456 640 388" fill="none" stroke="#fb7185" strokeWidth="8" strokeLinecap="round" strokeDasharray="18 20" opacity={progress > 0.38 ? 0.86 : 0.28}>
        <animate attributeName="stroke-dashoffset" from="0" to="180" dur="2.2s" repeatCount="indefinite" />
      </path>
      <SceneText x={500} y={318} text={core} size={28} maxChars={14} fill="#ffffff" />
      <SceneTag x={214} y={260} text={gravity} color={color} />
      <SceneTag x={786} y={260} text={fuel} color="#38bdf8" />
      <SceneTag x={500} y={480} text={result} color="#fb7185" />
    </g>
  );
}

function shortSceneText(text: string, max: number) {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  const clipped = clean.slice(0, max - 3);
  const lastSpace = clipped.lastIndexOf(" ");
  return `${clipped.slice(0, lastSpace > 8 ? lastSpace : clipped.length)}...`;
}

function SceneText({
  x,
  y,
  text,
  size,
  maxChars,
  fill,
  opacity = 1,
}: {
  x: number;
  y: number;
  text: string;
  size: number;
  maxChars: number;
  fill: string;
  opacity?: number;
}) {
  const lines = wrapText(text, maxChars).slice(0, 2);
  return (
    <text x={x} y={y} textAnchor="middle" opacity={opacity} style={{ fontSize: size, fontWeight: 900, fill, paintOrder: "stroke", stroke: fill === "#0f172a" ? "rgba(255,255,255,0.34)" : "rgba(2,6,23,0.72)", strokeWidth: 4, strokeLinejoin: "round" }}>
      {lines.map((line, i) => (
        <tspan key={i} x={x} dy={i === 0 ? 0 : size * 1.05}>
          {line}
        </tspan>
      ))}
    </text>
  );
}

/**
 * A piece that visibly travels across the board and relabels/recolors partway through —
 * this is what makes "water splits, pieces recombine into sugar" an animation instead of
 * a static reveal. Position interpolates linearly; label/color swap at the travel midpoint
 * (so it reads as "this became that" rather than two unrelated objects).
 */
function MorphRenderer({
  op,
  startMs,
  elapsed,
  duration,
  seed,
}: {
  op: Extract<DrawOp, { kind: "morph" }>;
  startMs: number;
  elapsed: number;
  duration: number;
  seed: string;
}) {
  const travelEnd = op.morphAt * duration;
  const t = travelEnd > startMs ? clamp01((elapsed - startMs) / (travelEnd - startMs)) : 1;
  const motion: Extract<DrawOp, { kind: "motion" }> = {
    kind: "motion",
    motion: "flow",
    x1: op.x,
    y1: op.y,
    x2: op.toX,
    y2: op.toY,
    text: t < 0.5 ? op.text : op.toText ?? op.text,
    color: t < 0.5 ? op.color ?? "#5eead4" : op.toColor ?? op.color ?? "#5eead4",
    at: op.at,
    endAt: op.morphAt,
  };
  return <MotionRenderer op={motion} startMs={startMs} elapsed={elapsed} duration={duration} seed={seed} />;
}

/**
 * Renders the new realistic compound shapes (leaf, sun, stove): a primary outline stroke,
 * then 1-3 secondary strokes (veins / rays / burners) that draw in slightly after, so a
 * leaf's veins or a sun's rays feel like a second pass of the pen rather than appearing
 * with the outline all at once.
 */
function CompoundShapeRenderer({
  op,
  seed,
  color,
  localElapsed,
}: {
  op: Extract<DrawOp, { kind: "shape" }>;
  seed: string;
  color: string;
  localElapsed: number;
}) {
  const cx = gx(op.x);
  const cy = gy(op.y);
  const w = gx(op.w ?? 14);
  const h = gy(op.h ?? 14);

  let primary = "";
  let secondary: string[] = [];
  if (op.shape === "leaf") {
    const { outline, veins } = sketchLeaf(seed, cx, cy, w, h);
    primary = outline;
    secondary = veins;
  } else if (op.shape === "sun") {
    const { disc, rays } = sketchSunburst(seed, cx, cy, w / 2);
    primary = disc;
    secondary = rays;
  } else if (op.shape === "stove") {
    const { body, burners } = sketchStove(seed, cx, cy, w, h);
    primary = body;
    secondary = burners;
  }
  if (!primary) return null;

  // Secondary strokes start once the primary outline has mostly drawn in.
  const secondaryDelay = STROKE_WINDOW * 0.7;
  const secondaryVisible = localElapsed >= secondaryDelay;

  return (
    <g>
      <path
        d={primary}
        pathLength={1}
        fill={color}
        fillOpacity={shapeFillOpacity(op.shape) || undefined}
        stroke={color}
        strokeWidth={4}
        strokeLinecap="round"
        strokeLinejoin="round"
        filter="url(#live-glow)"
        className="sketch-draw-in"
        style={{ animationDuration: `${STROKE_WINDOW}ms` }}
      />
      {secondaryVisible &&
        secondary.map((d, i) => (
          <path
            key={i}
            d={d}
            pathLength={1}
            fill="none"
            stroke={color}
            strokeWidth={1.6}
            strokeLinecap="round"
            filter="url(#live-glow)"
            className="sketch-draw-in"
            style={{ animationDuration: `${STROKE_WINDOW * 0.5}ms`, animationDelay: `${i * 90}ms` }}
          />
        ))}
    </g>
  );
}

function pathFor(op: DrawOp, seed: string): string {
  switch (op.kind) {
    case "shape": {
      const w = gx(op.w ?? 14);
      const h = gy(op.h ?? 14);
      const cx = gx(op.x);
      const cy = gy(op.y);
      if (op.shape === "hexagon") return sketchHexagon(seed, cx, cy, w, h);
      if (op.shape === "circle") return sketchCircle(seed, cx, cy, w / 2, (op.h ? h : w) / 2);
      if (op.shape === "rect") return sketchRect(seed, cx, cy, w, h);
      if (op.shape === "droplet") return sketchDroplet(seed, cx, cy, w, h);
      if ((op.shape === "line" || op.shape === "chain") && op.points?.length) {
        return sketchPolyline(seed, op.points.map((p) => ({ x: gx(p.x), y: gy(p.y) })));
      }
      return "";
    }
    case "arrow": {
      if (op.curved) {
        const { path } = sketchConnector(seed, gx(op.x1), gy(op.y1), gx(op.x2), gy(op.y2));
        return path;
      }
      return sketchLine(seed, gx(op.x1), gy(op.y1), gx(op.x2), gy(op.y2));
    }
    case "underline":
      return sketchLine(seed, gx(op.x - (op.w ?? 12) / 2), gy(op.y), gx(op.x + (op.w ?? 12) / 2), gy(op.y));
    case "circleHighlight":
      return sketchScribbleRing(seed, gx(op.x), gy(op.y), gx(op.w ?? 14) / 2, gy(op.h ?? 12) / 2);
    default:
      return "";
  }
}

/** A little marker/pen nib that hovers at whatever is currently being drawn — recolored to
 *  read as a glowing holographic stylus rather than a flat marker. */
function Pen({ x, y }: { x: number; y: number }) {
  const px = gx(x);
  const py = gy(y);
  return (
    <g style={{ transform: `translate(${px}px, ${py}px)`, transition: "transform 32ms linear" }} filter="url(#live-glow)">
      {/* nib tip sits at 0,0; body angles up-right like a held marker */}
      <path d="M 0 0 L 10 -22 L 22 -16 L 6 4 Z" fill="var(--hud-cyan-deep)" />
      <path d="M 10 -22 L 22 -16 L 30 -30 L 18 -36 Z" fill="var(--hud-cyan-bright)" />
      <circle cx="0" cy="0" r="3" fill="var(--hud-cyan-deep)" />
    </g>
  );
}

function Paper({ surface }: { surface?: DrawScript["surface"] }) {
  if (surface === "paper") {
    return (
      <>
        <div className="pointer-events-none absolute inset-0 bg-white" />
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.025]"
          style={{ backgroundImage: "radial-gradient(circle at 1px 1px, #6b7280 1px, transparent 0)", backgroundSize: "30px 30px" }}
        />
      </>
    );
  }
  return (
    <>
      {/* Faint chalk-grid on the black board — light lines, barely visible, like a real chalkboard. */}
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.035]"
        style={{ backgroundImage: "radial-gradient(circle at 1px 1px, #fff 1px, transparent 0)", backgroundSize: "26px 26px" }}
      />
      {/* Subtle top-lit vignette for depth on the black surface. */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{ background: "radial-gradient(circle at 50% 32%, rgba(255,255,255,0.03) 0%, rgba(0,0,0,0) 55%)" }}
      />
    </>
  );
}

"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Highlighter tool — the student drags a translucent marker over anything on the board (a term, a
 * line of the chalk board, a bit of the caption) and asks Aria to explain THAT in detail.
 *
 * Unlike the freehand sketch tool (DrawOverlay), this doesn't hand Aria a picture. It reads the
 * actual DOM text sitting UNDER the marker via document.elementsFromPoint — so she knows exactly what
 * was highlighted, word for word, with no vision guesswork. The extracted text is (a) reported up so
 * the parent can drop it into the live tutor's context (ask by voice), and (b) sent to /api/explain
 * when the student taps "Explain this" (a fresh drawn board + spoken breakdown).
 */

type Props = {
  /** Fires as the highlighted text changes, so the parent can feed it into Aria's live context. */
  onHighlight: (text: string) => void;
  /** Fires when the student asks for the detailed explanation of what they've highlighted. */
  onExplain: (text: string) => void;
  onClose: () => void;
  /** True while the explanation is being generated. */
  busy?: boolean;
};

// Deliberately light + no darkening blend, so the marker TINTS the text without ever obscuring it —
// the highlighted words must stay fully readable underneath.
const MARKER = "rgba(250, 204, 21, 0.28)";
const MARKER_WIDTH = 22;

/** The most specific text-bearing DOM element sitting under a screen point (skipping our own canvas). */
function textUnderPoint(clientX: number, clientY: number, canvas: HTMLCanvasElement): string | null {
  const stack = typeof document.elementsFromPoint === "function" ? document.elementsFromPoint(clientX, clientY) : [];
  // First pass: prefer a leaf text element (an SVG <text>/<tspan>, or a childless HTML node).
  for (const el of stack) {
    if (el === canvas || el.closest("[data-highlight-ui]")) continue;
    const tag = el.tagName.toLowerCase();
    const leaf = el.childElementCount === 0 || tag === "text" || tag === "tspan";
    const txt = (el.textContent || "").replace(/\s+/g, " ").trim();
    if (leaf && txt && txt.length <= 240) return txt;
  }
  // Fallback: the first element under the point that carries any reasonable amount of text.
  for (const el of stack) {
    if (el === canvas || el.closest("[data-highlight-ui]")) continue;
    const txt = (el.textContent || "").replace(/\s+/g, " ").trim();
    if (txt && txt.length <= 240) return txt;
  }
  return null;
}

export function HighlightOverlay({ onHighlight, onExplain, onClose, busy }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawing = useRef(false);
  // Ordered-unique set of highlighted text fragments, so "photosynthesis" + "equation" reads back in
  // the order the student swept the marker.
  const fragmentsRef = useRef<string[]>([]);
  const [highlighted, setHighlighted] = useState("");

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.max(1, Math.round(rect.width * dpr));
      canvas.height = Math.max(1, Math.round(rect.height * dpr));
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.scale(dpr, dpr);
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
    };
    resize();
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);

  const capture = useCallback((clientX: number, clientY: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const txt = textUnderPoint(clientX, clientY, canvas);
    if (!txt) return;
    if (fragmentsRef.current.includes(txt)) return;
    fragmentsRef.current.push(txt);
    const joined = fragmentsRef.current.join(" ").slice(0, 600);
    setHighlighted(joined);
    onHighlight(joined);
  }, [onHighlight]);

  const start = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drawing.current = true;
    const rect = e.currentTarget.getBoundingClientRect();
    ctx.beginPath();
    ctx.moveTo(e.clientX - rect.left, e.clientY - rect.top);
    capture(e.clientX, e.clientY);
  };

  const move = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return;
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    const rect = e.currentTarget.getBoundingClientRect();
    ctx.strokeStyle = MARKER;
    ctx.lineWidth = MARKER_WIDTH;
    ctx.lineTo(e.clientX - rect.left, e.clientY - rect.top);
    ctx.stroke();
    capture(e.clientX, e.clientY);
  };

  const end = () => { drawing.current = false; };

  const clear = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.restore();
    fragmentsRef.current = [];
    setHighlighted("");
    onHighlight("");
  }, [onHighlight]);

  return (
    <div className="absolute inset-0 z-20">
      <canvas
        ref={canvasRef}
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={end}
        onPointerLeave={end}
        className="h-full w-full touch-none"
        style={{ cursor: "crosshair" }}
      />
      <div
        data-highlight-ui
        className="absolute left-1/2 top-3 flex max-w-[min(94%,44rem)] -translate-x-1/2 flex-wrap items-center gap-2 rounded-2xl border border-amber-300/30 bg-slate-950/90 px-3 py-2 backdrop-blur"
      >
        <span className="text-[11px] font-black uppercase tracking-wider text-amber-200">Highlight</span>
        <span className="max-w-[22rem] truncate text-xs font-semibold text-white/70">
          {highlighted ? `“${highlighted}”` : "Drag over anything on the board"}
        </span>
        <button
          onClick={() => highlighted && onExplain(highlighted)}
          disabled={!highlighted || busy}
          className="rounded-full bg-amber-300/25 px-3 py-1 text-[11px] font-black text-amber-50 transition hover:bg-amber-300/40 disabled:opacity-40"
        >
          {busy ? "Explaining…" : "Explain this in detail"}
        </button>
        <button onClick={clear} className="rounded-full border border-white/20 px-2 py-1 text-[11px] font-bold text-white/80">
          Clear
        </button>
        <button
          onClick={onClose}
          className="rounded-full bg-white/10 px-3 py-1 text-[11px] font-black text-white/85 transition hover:bg-white/20"
        >
          Done
        </button>
      </div>
    </div>
  );
}

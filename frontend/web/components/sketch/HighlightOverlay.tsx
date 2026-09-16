"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, MessageCircleQuestion, Trash2 } from "lucide-react";

/**
 * Highlighter tool — the student drags a translucent marker over anything on the board (a term, a
 * line of the chalk board, a bit of the caption) and asks Aria to explain THAT in detail.
 *
 * The marks are PERSISTENT: strokes are owned by the parent in normalized 0..1 board coordinates, so
 * they stay on the board after the tool is closed, survive a resize, and only clear on the next
 * section (or via Clear). This layer is mounted whenever there are strokes to show; it only captures
 * pointer events while `active`, so the board underneath stays usable the rest of the time.
 *
 * Unlike the freehand sketch tool, this reads the actual DOM text UNDER the marker via
 * document.elementsFromPoint — so Aria knows exactly what was highlighted, word for word.
 */

export type HlPoint = { x: number; y: number };
export type HlStroke = HlPoint[];

type Props = {
  /** Persistent committed strokes, in normalized 0..1 board coords. */
  strokes: HlStroke[];
  /** True while the tool is active (captures pointer input + shows the toolbar). */
  active: boolean;
  /** A finished stroke, normalized. */
  onCommitStroke: (stroke: HlStroke) => void;
  /** Fires as the highlighted text changes, so the parent can feed it into Aria's context. */
  onHighlight: (text: string) => void;
  /** Fires when the student asks for the detailed explanation of what they've highlighted. */
  onExplain: (text: string) => void;
  /** Wipe all strokes. */
  onClear: () => void;
  /** Close the tool (leaves the marks on the board). */
  onClose: () => void;
  /** True while the explanation is being generated. */
  busy?: boolean;
};

// Deliberately light + no darkening blend, so the marker TINTS the text without ever obscuring it.
const MARKER = "rgba(250, 204, 21, 0.45)";
const MARKER_WIDTH = 22;

/** The most specific text-bearing DOM element sitting under a screen point (skipping our own canvas). */
function textUnderPoint(clientX: number, clientY: number, canvas: HTMLCanvasElement): string | null {
  const stack = typeof document.elementsFromPoint === "function" ? document.elementsFromPoint(clientX, clientY) : [];
  for (const el of stack) {
    if (el === canvas || el.closest("[data-highlight-ui]")) continue;
    const tag = el.tagName.toLowerCase();
    const leaf = el.childElementCount === 0 || tag === "text" || tag === "tspan";
    const txt = (el.textContent || "").replace(/\s+/g, " ").trim();
    if (leaf && txt && txt.length <= 240) return txt;
  }
  for (const el of stack) {
    if (el === canvas || el.closest("[data-highlight-ui]")) continue;
    const txt = (el.textContent || "").replace(/\s+/g, " ").trim();
    if (txt && txt.length <= 240) return txt;
  }
  return null;
}

export function HighlightOverlay({ strokes, active, onCommitStroke, onHighlight, onExplain, onClear, onClose, busy }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawing = useRef(false);
  const currentStroke = useRef<HlStroke>([]);
  const fragmentsRef = useRef<string[]>([]);
  const [highlighted, setHighlighted] = useState("");

  // Repaint every committed stroke (normalized -> pixel). Called on mount, on strokes change, and on
  // resize — so marks are never lost when the tool closes or the window resizes.
  const repaint = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const rect = canvas.getBoundingClientRect();
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.restore();
    /**
     * `multiply` is what makes this a HIGHLIGHTER rather than paint.
     *
     * With the default source-over, every overlapping segment of a sweep composites its own alpha
     * on top of the last — and a highlighter sweep overlaps itself constantly, so the marks
     * compounded to near-opaque and buried the text underneath. Multiply darkens toward the marker
     * colour instead of accumulating coverage, so the words stay readable no matter how many times
     * a stroke crosses itself.
     *
     * The alpha is also raised (0.28 -> 0.45): under multiply a lighter value barely registers, and
     * a highlight that cannot be seen is not a highlight.
     */
    ctx.globalCompositeOperation = "multiply";
    ctx.strokeStyle = MARKER;
    ctx.lineWidth = MARKER_WIDTH;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    for (const stroke of strokes) {
      if (stroke.length === 0) continue;
      ctx.beginPath();
      stroke.forEach((p, i) => {
        const x = p.x * rect.width;
        const y = p.y * rect.height;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      // A single-point tap still leaves a dot.
      if (stroke.length === 1) ctx.lineTo(stroke[0].x * rect.width + 0.01, stroke[0].y * rect.height);
      ctx.stroke();
    }
  }, [strokes]);

  // Size the backing store to the element, preserving DPR, then repaint. Re-runs on window resize.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.max(1, Math.round(rect.width * dpr));
      canvas.height = Math.max(1, Math.round(rect.height * dpr));
      const ctx = canvas.getContext("2d");
      if (ctx) ctx.scale(dpr, dpr);
      repaint();
    };
    resize();
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, [repaint]);

  // Repaint whenever the committed strokes change (e.g. Clear, or a new stroke landed).
  useEffect(() => { repaint(); }, [repaint]);

  const norm = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return { x: (e.clientX - rect.left) / rect.width, y: (e.clientY - rect.top) / rect.height };
  };

  const capture = useCallback((clientX: number, clientY: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const txt = textUnderPoint(clientX, clientY, canvas);
    if (!txt || fragmentsRef.current.includes(txt)) return;
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
    currentStroke.current = [norm(e)];
    const rect = e.currentTarget.getBoundingClientRect();
    // Match the repaint path — without this the stroke being drawn looks opaque and only
    // becomes translucent once the pointer lifts and repaint() runs.
    ctx.globalCompositeOperation = "multiply";
    ctx.strokeStyle = MARKER;
    ctx.lineWidth = MARKER_WIDTH;
    ctx.beginPath();
    ctx.moveTo(e.clientX - rect.left, e.clientY - rect.top);
    capture(e.clientX, e.clientY);
  };

  const move = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return;
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    const rect = e.currentTarget.getBoundingClientRect();
    currentStroke.current.push(norm(e));
    ctx.lineTo(e.clientX - rect.left, e.clientY - rect.top);
    ctx.stroke();
    capture(e.clientX, e.clientY);
  };

  const end = () => {
    if (!drawing.current) return;
    drawing.current = false;
    if (currentStroke.current.length > 0) onCommitStroke(currentStroke.current);
    currentStroke.current = [];
  };

  const clear = () => {
    fragmentsRef.current = [];
    setHighlighted("");
    onHighlight("");
    onClear();
  };

  return (
    <div className={`absolute inset-0 z-20 ${active ? "" : "pointer-events-none"}`}>
      <canvas
        ref={canvasRef}
        onPointerDown={active ? start : undefined}
        onPointerMove={active ? move : undefined}
        onPointerUp={active ? end : undefined}
        onPointerLeave={active ? end : undefined}
        className={`h-full w-full touch-none ${active ? "" : "pointer-events-none"}`}
        style={{ cursor: active ? "crosshair" : "default" }}
      />
      {active && (
        /*
         * COMPACT AND CORNER-ANCHORED, ON PURPOSE.
         *
         * The previous toolbar spanned up to 44rem (704px) at top-3, centred — on the board's
         * typical narrower widths (mobile, or before the xl breakpoint adds the side chat panel)
         * that is most or all of the board's own width, sitting exactly where a beat's heading
         * usually lives. A highlighter's control chrome should never compete with the board for
         * space; it only needs to be reachable, not prominent.
         *
         * Bottom-right rather than top-center: the top is where board content most often starts
         * (a title, an opening label), so the toolbar claims the one corner nothing else uses.
         * Icon-first with a title attribute for the label — the FULL highlighted-text preview is
         * still shown, but truncated much tighter, because confirming what was captured matters
         * more than reading it back in full; the student can see the actual highlight on the board.
         */
        <div
          data-highlight-ui
          className="absolute bottom-3 right-3 flex max-w-[min(88%,20rem)] items-center gap-1 rounded-full border border-amber-300/30 bg-slate-950/90 px-2 py-1.5 shadow-lg backdrop-blur"
        >
          <span className="max-w-[8rem] truncate px-1 text-[11px] font-semibold text-white/70" title={highlighted || undefined}>
            {highlighted ? `“${highlighted}”` : "Drag to highlight"}
          </span>
          <button
            onClick={() => highlighted && onExplain(highlighted)}
            disabled={!highlighted || busy}
            title={busy ? "Explaining…" : "Explain this in detail"}
            aria-label={busy ? "Explaining…" : "Explain this in detail"}
            className="grid size-7 shrink-0 place-items-center rounded-full bg-amber-300/25 text-amber-50 transition hover:bg-amber-300/40 disabled:opacity-40"
          >
            <MessageCircleQuestion className="size-3.5" />
          </button>
          <button
            onClick={clear}
            title="Clear highlights"
            aria-label="Clear highlights"
            className="grid size-7 shrink-0 place-items-center rounded-full border border-white/20 text-white/80 transition hover:bg-white/10"
          >
            <Trash2 className="size-3.5" />
          </button>
          <button
            onClick={onClose}
            title="Done highlighting"
            aria-label="Done highlighting"
            className="grid size-7 shrink-0 place-items-center rounded-full bg-white/10 text-white/85 transition hover:bg-white/20"
          >
            <Check className="size-3.5" />
          </button>
        </div>
      )}
    </div>
  );
}

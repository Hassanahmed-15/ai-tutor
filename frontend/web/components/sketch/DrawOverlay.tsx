"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Eraser, MessageCircleQuestion, Trash2 } from "lucide-react";

/**
 * Student drawing surface — the board becomes two-way. A transparent canvas sits over the lesson
 * board; the student sketches on it (circle the confusing bit, draw their own attempt) and the
 * sketch is shared with Aria AUTOMATICALLY a moment after the pen lifts. There is no "send" step:
 * she simply has it in context, so the student just asks her about it out loud.
 *
 * The exported PNG is flattened onto an opaque background so the vision model sees the strokes on
 * white rather than transparency (which renders black and hides the ink).
 */

type Props = {
  /**
   * Fired a moment after the student stops drawing, with a PNG data URI. The parent reads the
   * sketch and feeds it into Aria's context — so the student can just ASK her about it out loud,
   * with no "send" step.
   */
  onDrawingChange: (imageDataUrl: string) => void;
  onClose: () => void;
  /** True while the sketch is being read, so the toolbar can show it. */
  busy?: boolean;
  /** Short confirmation that Aria has seen the drawing. */
  seenLabel?: string;
  /**
   * Explicit "Explain this in detail" trigger — reliable regardless of whether the realtime
   * tutor's mic happens to be unmuted (unlike "just ask out loud"). Only shown once there's ink
   * to explain.
   */
  onExplain?: () => void;
};

const COLORS = ["#e11d48", "#2563eb", "#16a34a", "#f59e0b", "#111827"];

export function DrawOverlay({ onDrawingChange, onClose, busy, seenLabel, onExplain }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawing = useRef(false);
  const [color, setColor] = useState(COLORS[0]);
  const [width, setWidth] = useState(4);
  const [erasing, setErasing] = useState(false);
  const [hasInk, setHasInk] = useState(false);
  const shareTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (shareTimer.current) clearTimeout(shareTimer.current); }, []);

  // Size the backing store to the element so strokes land under the cursor on any display.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      // Preserve existing ink across a resize.
      const prev = canvas.toDataURL();
      canvas.width = Math.max(1, Math.round(rect.width * dpr));
      canvas.height = Math.max(1, Math.round(rect.height * dpr));
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.scale(dpr, dpr);
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      if (hasInk) {
        const img = new Image();
        img.onload = () => ctx.drawImage(img, 0, 0, rect.width, rect.height);
        img.src = prev;
      }
    };
    resize();
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pos = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const start = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drawing.current = true;
    const { x, y } = pos(e);
    ctx.beginPath();
    ctx.moveTo(x, y);
  };

  const move = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return;
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    const { x, y } = pos(e);
    ctx.globalCompositeOperation = erasing ? "destination-out" : "source-over";
    ctx.strokeStyle = color;
    ctx.lineWidth = erasing ? 18 : width;
    ctx.lineTo(x, y);
    ctx.stroke();
    if (!hasInk) setHasInk(true);
  };

  const end = () => {
    if (!drawing.current) return;
    drawing.current = false;
    // Auto-share the sketch shortly after the pen lifts, so Aria always has it in context and the
    // student can simply ask her about it — no "send" button.
    if (shareTimer.current) clearTimeout(shareTimer.current);
    shareTimer.current = setTimeout(share, 900);
  };

  const clear = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.restore();
    setHasInk(false);
  }, []);

  /** Flatten onto white so the vision model sees ink on paper, not ink on transparency. */
  const share = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const flat = document.createElement("canvas");
    flat.width = canvas.width;
    flat.height = canvas.height;
    const ctx = flat.getContext("2d");
    if (!ctx) return;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, flat.width, flat.height);
    ctx.drawImage(canvas, 0, 0);
    onDrawingChange(flat.toDataURL("image/png"));
  }, [onDrawingChange]);

  return (
    <div className="absolute inset-0 z-20">
      <canvas
        ref={canvasRef}
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={end}
        onPointerLeave={end}
        className="h-full w-full cursor-crosshair touch-none"
      />
      {/*
        COMPACT AND CORNER-ANCHORED, ON PURPOSE.
        The previous toolbar had no width cap at all — `flex flex-wrap` at top-3, centred — so on a
        narrower board it wrapped to two or three rows and became a genuinely large block of chrome
        sitting where a beat's own heading usually lives. This version fits five colour dots, four
        icon actions and a status dot into one row that never exceeds a small fixed width, anchored
        to a bottom corner nothing else on the board uses. The status text collapses to a single
        coloured dot with the full sentence as a title/tooltip — the student does not need to read
        "draw, then ask Aria out loud" in full every time the tool is open.
      */}
      <div className="absolute bottom-3 right-3 flex max-w-[min(92%,22rem)] flex-wrap items-center gap-1 rounded-full border border-white/15 bg-slate-950/90 px-2 py-1.5 shadow-lg backdrop-blur">
        <div className="flex items-center gap-1 px-0.5">
          {COLORS.map((c) => (
            <button
              key={c}
              onClick={() => {
                setColor(c);
                setErasing(false);
              }}
              aria-label={`Pen colour ${c}`}
              className={`size-4 rounded-full border-2 transition ${color === c && !erasing ? "scale-110 border-white" : "border-white/30"}`}
              style={{ background: c }}
            />
          ))}
        </div>
        <button
          onClick={() => setWidth((w) => (w === 4 ? 8 : 4))}
          title={width === 4 ? "Thin stroke — tap for thick" : "Thick stroke — tap for thin"}
          aria-label="Toggle stroke width"
          className="grid size-7 shrink-0 place-items-center rounded-full border border-white/20 text-white/80 transition hover:bg-white/10"
        >
          <span className="rounded-full bg-current" style={{ width: width === 4 ? 5 : 9, height: width === 4 ? 5 : 9 }} />
        </button>
        <button
          onClick={() => setErasing((e) => !e)}
          title="Eraser"
          aria-label="Eraser"
          aria-pressed={erasing}
          className={`grid size-7 shrink-0 place-items-center rounded-full border transition ${erasing ? "border-cyan-300/50 bg-cyan-300/15 text-cyan-100" : "border-white/20 text-white/80 hover:bg-white/10"}`}
        >
          <Eraser className="size-3.5" />
        </button>
        <button
          onClick={clear}
          title="Clear drawing"
          aria-label="Clear drawing"
          className="grid size-7 shrink-0 place-items-center rounded-full border border-white/20 text-white/80 transition hover:bg-white/10"
        >
          <Trash2 className="size-3.5" />
        </button>
        <span
          title={busy ? "Aria is looking…" : seenLabel ? "Aria can see this — just ask" : "Draw, then ask Aria out loud"}
          aria-label={busy ? "Aria is looking" : seenLabel ? "Aria can see this" : "Not yet shared"}
          className={`size-2 shrink-0 rounded-full ${busy ? "animate-pulse bg-cyan-300" : seenLabel ? "bg-cyan-300/70" : "bg-white/25"}`}
        />
        {onExplain && (
          <button
            onClick={onExplain}
            disabled={!hasInk || busy}
            title="Explain this in detail"
            aria-label="Explain this in detail"
            className="grid size-7 shrink-0 place-items-center rounded-full border border-cyan-300/40 bg-cyan-300/10 text-cyan-100 transition hover:bg-cyan-300/20 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <MessageCircleQuestion className="size-3.5" />
          </button>
        )}
        <button
          onClick={onClose}
          title="Done drawing"
          aria-label="Done drawing"
          className="grid size-7 shrink-0 place-items-center rounded-full bg-white/10 text-white/85 transition hover:bg-white/20"
        >
          <Check className="size-3.5" />
        </button>
      </div>
    </div>
  );
}

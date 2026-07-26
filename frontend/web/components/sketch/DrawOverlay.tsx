"use client";

import { useCallback, useEffect, useRef, useState } from "react";

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
      <div className="absolute left-1/2 top-3 flex -translate-x-1/2 flex-wrap items-center gap-2 rounded-full border border-white/15 bg-slate-950/85 px-3 py-2 backdrop-blur">
        {COLORS.map((c) => (
          <button
            key={c}
            onClick={() => {
              setColor(c);
              setErasing(false);
            }}
            aria-label={`Pen colour ${c}`}
            className={`size-5 rounded-full border-2 transition ${color === c && !erasing ? "border-white scale-110" : "border-white/30"}`}
            style={{ background: c }}
          />
        ))}
        <button
          onClick={() => setWidth((w) => (w === 4 ? 8 : 4))}
          className="rounded-full border border-white/20 px-2 py-1 text-[11px] font-bold text-white/80"
        >
          {width === 4 ? "Thin" : "Thick"}
        </button>
        <button
          onClick={() => setErasing((e) => !e)}
          className={`rounded-full border px-2 py-1 text-[11px] font-bold ${erasing ? "border-cyan-300/50 bg-cyan-300/15 text-cyan-100" : "border-white/20 text-white/80"}`}
        >
          Eraser
        </button>
        <button onClick={clear} className="rounded-full border border-white/20 px-2 py-1 text-[11px] font-bold text-white/80">
          Clear
        </button>
        <span className={`rounded-full px-2 py-1 text-[11px] font-bold ${busy ? "text-cyan-200" : "text-white/50"}`}>
          {busy ? "Aria is looking…" : seenLabel ? "Aria can see this — just ask" : hasInk ? "…" : "Draw, then ask Aria out loud"}
        </span>
        {onExplain && (
          <button
            onClick={onExplain}
            disabled={!hasInk || busy}
            className="rounded-full border border-cyan-300/40 bg-cyan-300/10 px-3 py-1 text-[11px] font-black text-cyan-100 transition hover:bg-cyan-300/20 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Explain this in detail
          </button>
        )}
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

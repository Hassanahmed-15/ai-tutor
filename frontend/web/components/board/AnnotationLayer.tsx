"use client";

import { useCallback, useEffect, useRef } from "react";

import {
  type AnnotationKind,
  type AnnotationState,
  type AnnotationStroke,
  addStroke,
  eraseAt,
  strokesFor,
} from "@/lib/board/annotations";
import { contentBox, toBoardSpace, withinBoard } from "@/lib/board/geometry";

/**
 * ONE LAYER FOR EVERY MARK THE STUDENT MAKES.
 *
 * It replaces two separate overlays — DrawOverlay and HighlightOverlay — that were mutually
 * exclusive: turning on the pen force-disabled the highlighter and vice versa, so you could not
 * highlight a term and circle it. They also disagreed about coordinates (one screen-pixel, one
 * element-relative), kept their ink in raster canvases that could not be undone or exported, and
 * were wiped on every beat change.
 *
 * Here there is one canvas, one coordinate space (board space, see lib/board/geometry.ts), and one
 * store (lib/board/annotations.ts) that owns undo, persistence per concept, and the export. The
 * tool decides how a stroke LOOKS, not where it lives.
 *
 * WHY A CANVAS AND NOT SVG. A stroke in progress needs to follow the pointer at 60fps; appending
 * hundreds of SVG nodes per stroke is how you get a board that stutters while someone is trying to
 * underline a word. Committed strokes are re-rendered from the store on every change, which also
 * means a resize redraws them in the right place rather than leaving stale pixels behind.
 */

export type BoardTool = "none" | "pen" | "highlighter" | "eraser";

const INK: Record<Exclude<BoardTool, "none" | "eraser">, { color: string; width: number; alpha: number }> = {
  /*
   * Warm amber for the student, deliberately unlike anything Aria draws. The old pen offered five
   * saturated colours, which on a board already drawn in bright strokes made "my marks" and "her
   * diagram" indistinguishable — the provenance problem. One ink, always the same, always the
   * student's: that is the signal.
   */
  pen: { color: "#fbbf24", width: 0.0038, alpha: 1 },
  highlighter: { color: "#facc15", width: 0.022, alpha: 0.32 },
};

/** Eraser radius in board space — generous, because precision erasing is a frustrating game. */
const ERASER_RADIUS = 0.035;

export function AnnotationLayer({
  boardId,
  tool,
  state,
  onChange,
  visible,
  onStrokeFinished,
}: {
  boardId: string;
  tool: BoardTool;
  state: AnnotationState;
  onChange: (next: AnnotationState) => void;
  /** Marks can be hidden without being deleted — the "Your marks" toggle. */
  visible: boolean;
  /** Fires after a stroke settles, with any board text it covered, so Aria can be asked about it. */
  onStrokeFinished?: (stroke: AnnotationStroke) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const drawingRef = useRef<AnnotationStroke | null>(null);
  const stateRef = useRef(state);
  stateRef.current = state;

  /** Redraw everything the store holds for this board. Cheap: these are tens of strokes, not thousands. */
  const repaint = useCallback(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const rect = wrap.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (canvas.width !== Math.round(rect.width * dpr) || canvas.height !== Math.round(rect.height * dpr)) {
      canvas.width = Math.round(rect.width * dpr);
      canvas.height = Math.round(rect.height * dpr);
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, rect.width, rect.height);
    if (!visible) return;

    const box = contentBox(rect.width, rect.height);
    const strokes = [...strokesFor(stateRef.current, boardId)];
    if (drawingRef.current) strokes.push(drawingRef.current);

    for (const stroke of strokes) {
      if (stroke.points.length === 0) continue;
      const ink = INK[stroke.kind === "highlight" ? "highlighter" : "pen"];
      ctx.save();
      ctx.globalAlpha = ink.alpha;
      // `multiply` keeps repeated highlighter sweeps from stacking into an opaque block.
      ctx.globalCompositeOperation = stroke.kind === "highlight" ? "multiply" : "source-over";
      ctx.strokeStyle = stroke.color;
      ctx.lineWidth = Math.max(1, stroke.width * box.width);
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.beginPath();
      stroke.points.forEach((point, i) => {
        const x = box.x + point.x * box.width;
        const y = box.y + point.y * box.height;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      // A single tap should leave a dot, not nothing.
      if (stroke.points.length === 1) ctx.lineTo(box.x + stroke.points[0].x * box.width + 0.01, box.y + stroke.points[0].y * box.height);
      ctx.stroke();
      ctx.restore();
    }
  }, [boardId, visible]);

  useEffect(() => {
    repaint();
  }, [repaint, state]);

  // Marks are stored in board space, so a resize is a pure repaint — no drift, nothing lost.
  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const observer = new ResizeObserver(() => repaint());
    observer.observe(wrap);
    return () => observer.disconnect();
  }, [repaint]);

  /** The board text under a point, so a highlight can be described in words rather than guessed at. */
  const textUnder = useCallback((clientX: number, clientY: number): string => {
    try {
      const found = document.elementsFromPoint(clientX, clientY);
      for (const element of found) {
        const tag = element.tagName.toLowerCase();
        if (tag === "text" || tag === "tspan" || tag === "p" || tag === "span" || tag === "h3") {
          const text = (element.textContent ?? "").trim();
          if (text && text.length <= 200) return text;
        }
      }
    } catch {
      // elementsFromPoint can throw in exotic embedding cases; a missing label is not worth failing on.
    }
    return "";
  }, []);

  const pointFrom = useCallback((event: React.PointerEvent) => {
    const wrap = wrapRef.current;
    if (!wrap) return null;
    const rect = wrap.getBoundingClientRect();
    const point = toBoardSpace(event.clientX, event.clientY, {
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height,
    });
    return withinBoard(point) ? point : null;
  }, []);

  const onPointerDown = useCallback(
    (event: React.PointerEvent) => {
      if (tool === "none") return;
      const point = pointFrom(event);
      if (!point) return;
      event.currentTarget.setPointerCapture(event.pointerId);
      if (tool === "eraser") {
        onChange(eraseAt(stateRef.current, boardId, point, ERASER_RADIUS));
        return;
      }
      const kind: AnnotationKind = tool === "highlighter" ? "highlight" : "pen";
      const ink = INK[tool === "highlighter" ? "highlighter" : "pen"];
      drawingRef.current = {
        id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
        kind,
        color: ink.color,
        width: ink.width,
        points: [point],
        coveredText: textUnder(event.clientX, event.clientY) || undefined,
      };
      repaint();
    },
    [boardId, onChange, pointFrom, repaint, textUnder, tool],
  );

  const onPointerMove = useCallback(
    (event: React.PointerEvent) => {
      if (tool === "none") return;
      const point = pointFrom(event);
      if (!point) return;
      if (tool === "eraser") {
        if (event.buttons === 1) onChange(eraseAt(stateRef.current, boardId, point, ERASER_RADIUS));
        return;
      }
      const stroke = drawingRef.current;
      if (!stroke) return;
      stroke.points.push(point);
      if (!stroke.coveredText) {
        const text = textUnder(event.clientX, event.clientY);
        if (text) stroke.coveredText = text;
      }
      repaint();
    },
    [boardId, onChange, pointFrom, repaint, textUnder, tool],
  );

  const finish = useCallback(() => {
    const stroke = drawingRef.current;
    drawingRef.current = null;
    if (!stroke || stroke.points.length === 0) return;
    onChange(addStroke(stateRef.current, boardId, stroke));
    onStrokeFinished?.(stroke);
  }, [boardId, onChange, onStrokeFinished]);

  return (
    <div
      ref={wrapRef}
      className="absolute inset-0"
      // The layer is inert until a tool is chosen, so the board underneath stays fully interactive.
      style={{ pointerEvents: tool === "none" ? "none" : "auto", cursor: tool === "eraser" ? "cell" : "crosshair" }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={finish}
      onPointerLeave={finish}
      onPointerCancel={finish}
    >
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" aria-hidden="true" />
    </div>
  );
}

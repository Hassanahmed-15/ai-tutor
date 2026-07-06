"use client";

import { useEffect, useMemo, useState } from "react";
import { layoutBoard, type DrawCommands, type LaidOutNode } from "@/lib/layout";
import { sketchCircle, sketchConnector, sketchPill, sketchRect, sketchScribbleRing, colorForLayer } from "./sketch";

const STAGGER_MS = 260;
const STROKE_MS = 650;

export interface BoardAnnotation {
  /** Element ids on the existing board this annotation points at. */
  targetIds: string[];
  note: string;
}

interface SketchBoardProps {
  drawCommands: DrawCommands | undefined;
  title?: string;
  annotation?: BoardAnnotation | null;
}

export function SketchBoard({ drawCommands, title, annotation }: SketchBoardProps) {
  if (!drawCommands || drawCommands.elements.length === 0) {
    return <EmptyBoard />;
  }
  // Re-mount (and replay the draw-in animation) only when the beat's element set changes.
  const boardKey = drawCommands.elements.map((e) => `${e.id}:${e.emphasis ?? false}`).join("|");
  return <AnimatedSketch key={boardKey} drawCommands={drawCommands} title={title} annotation={annotation} />;
}

interface AnimatedSketchProps {
  drawCommands: DrawCommands;
  title?: string;
  annotation?: BoardAnnotation | null;
}

function AnimatedSketch({ drawCommands, title, annotation }: AnimatedSketchProps) {
  const layout = useMemo(() => layoutBoard(drawCommands), [drawCommands]);
  const [revealCount, setRevealCount] = useState(0);

  useEffect(() => {
    let i = 0;
    const interval = setInterval(() => {
      i += 1;
      setRevealCount(i);
      if (i >= layout.nodes.length) clearInterval(interval);
    }, STAGGER_MS);
    return () => clearInterval(interval);
  }, [layout]);

  const visibleNodes = layout.nodes.slice(0, revealCount);
  const visibleIds = new Set(visibleNodes.map((n) => n.id));
  const visibleEdges = layout.edges.filter((e) => visibleIds.has(e.from.id) && visibleIds.has(e.to.id));
  const allDrawn = revealCount >= layout.nodes.length;

  const annotationTargets = annotation
    ? layout.nodes.filter((n) => annotation.targetIds.includes(n.id))
    : [];

  return (
    <section className="relative flex h-full min-h-0 flex-col overflow-hidden rounded-[1.75rem] border border-slate-200 bg-[#fbfbf9] p-6 text-slate-950">
      <PaperTexture />
      <div className="relative flex items-center justify-between">
        <div>
          <p className="text-sm font-bold uppercase tracking-[0.18em] text-slate-500">Teacher board</p>
          {title && <h2 className="mt-1 text-3xl font-black tracking-tight">{title}</h2>}
        </div>
        <span className="rounded-full bg-slate-900 px-4 py-2 text-sm font-black text-white">
          {revealCount}/{layout.nodes.length}
        </span>
      </div>

      <svg
        viewBox={`0 0 ${layout.width} ${layout.height}`}
        className="relative mt-4 min-h-0 flex-1 w-full"
        aria-hidden="true"
      >
        <defs>
          <marker id="sketch-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="#475569" />
          </marker>
        </defs>
        {visibleEdges.map((edge, i) => {
          const centerGap = Math.hypot(edge.to.x - edge.from.x, edge.to.y - edge.from.y);
          const gapWidth = centerGap - edge.from.w / 2 - edge.to.w / 2;
          return (
            <SketchEdge
              key={`${edge.from.id}-${edge.to.id}`}
              edge={edge}
              delayMs={i * 80}
              gapWidth={gapWidth}
              labelBelowRow={layout.labelsBelowRow}
            />
          );
        })}
        {visibleNodes.map((node, i) => (
          <SketchNode key={node.id} node={node} orderIndex={i} />
        ))}
        {allDrawn &&
          annotationTargets.map((node) => <AnnotationRing key={`ann-${node.id}`} node={node} />)}
      </svg>

      {annotation && allDrawn && (
        <div className="pointer-events-none absolute bottom-6 right-6 max-w-xs rotate-1 rounded-xl bg-amber-200 p-4 shadow-lg ring-1 ring-amber-300">
          <p className="text-xs font-black uppercase tracking-wide text-amber-800">Side note</p>
          <p className="mt-1 text-sm font-bold leading-snug text-amber-950">{annotation.note}</p>
        </div>
      )}
    </section>
  );
}

function SketchNode({ node, orderIndex }: { node: LaidOutNode; orderIndex: number }) {
  const color = colorForLayer(node.layer);
  const path =
    node.shape === "circle"
      ? sketchCircle(node.id, node.x, node.y, node.w / 2, node.h / 2)
      : node.shape === "pill"
        ? sketchPill(node.id, node.x, node.y, node.w, node.h)
        : sketchRect(node.id, node.x, node.y, node.w, node.h);

  const delay = orderIndex * 40;

  return (
    <g>
      <path
        d={path}
        pathLength={1}
        fill={color.fill}
        stroke={color.stroke}
        strokeWidth={node.emphasis ? 3.5 : 2.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        className="sketch-draw-in"
        style={{ animationDelay: `${delay}ms`, animationDuration: `${STROKE_MS}ms` }}
      />
      <text
        x={node.x}
        y={node.y + 5}
        textAnchor="middle"
        className="select-none font-black"
        style={{
          fontSize: 17,
          fill: "#0f172a",
          opacity: 0,
          animation: `sketch-fade-in 320ms ease-out forwards`,
          animationDelay: `${delay + STROKE_MS * 0.55}ms`,
        }}
      >
        {node.label}
      </text>
      {node.emphasis && (
        <path
          d={sketchScribbleRing(node.id, node.x, node.y, node.w / 2 + 14, node.h / 2 + 16)}
          pathLength={1}
          fill="none"
          stroke="#dc2626"
          strokeWidth={3}
          strokeLinecap="round"
          className="sketch-draw-in"
          style={{ animationDelay: `${delay + STROKE_MS}ms`, animationDuration: "500ms" }}
        />
      )}
    </g>
  );
}

/** Where a straight line from a node's center toward a target point crosses that node's box boundary. */
function boxEdgePoint(node: LaidOutNode, towardX: number, towardY: number) {
  const dx = towardX - node.x;
  const dy = towardY - node.y;
  if (dx === 0 && dy === 0) return { x: node.x, y: node.y };
  const halfW = node.w / 2;
  const halfH = node.h / 2;
  const scale = 1 / Math.max(Math.abs(dx) / halfW, Math.abs(dy) / halfH);
  return { x: node.x + dx * scale, y: node.y + dy * scale };
}

/** Greedily wraps a label into lines that fit maxWidth, using a rough average-char-width estimate (fine for short hand-drawn captions). */
function wrapLabel(label: string, maxWidth: number, fontSize: number): string[] {
  const charWidth = fontSize * 0.56;
  const maxChars = Math.max(8, Math.floor(maxWidth / charWidth));
  const words = label.split(" ");
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
  return lines.slice(0, 2);
}

function SketchEdge({
  edge,
  delayMs,
  gapWidth,
  labelBelowRow,
}: {
  edge: { from: LaidOutNode; to: LaidOutNode; kind: string; label?: string };
  delayMs: number;
  gapWidth: number;
  labelBelowRow: boolean;
}) {
  const seed = `${edge.from.id}->${edge.to.id}`;
  const start = boxEdgePoint(edge.from, edge.to.x, edge.to.y);
  const end = boxEdgePoint(edge.to, edge.from.x, edge.from.y);
  const { path, midX, midY } = sketchConnector(seed, start.x, start.y, end.x, end.y);
  const fontSize = 11;
  // When boxes are packed tight (e.g. array cells) or the layout always routes labels
  // below the row, there's no room for a label at the midpoint — drop it into open
  // space below instead of squeezing it into (or drawing it over) the gap.
  const tightGap = labelBelowRow || gapWidth < 60;
  const labelY = tightGap ? edge.from.y + Math.max(edge.from.h, edge.to.h) / 2 + 22 : midY - 10;
  const lines = edge.label ? wrapLabel(edge.label, tightGap ? 220 : Math.max(70, gapWidth), fontSize) : [];
  return (
    <g>
      <path
        d={path}
        pathLength={1}
        fill="none"
        stroke="#475569"
        strokeWidth={2}
        strokeLinecap="round"
        markerEnd="url(#sketch-arrow)"
        className="sketch-draw-in"
        style={{ animationDelay: `${delayMs}ms`, animationDuration: "550ms" }}
      />
      {lines.length > 0 && (
        <text
          x={midX}
          textAnchor="middle"
          style={{
            fontSize,
            fontWeight: 700,
            fill: "#334155",
            opacity: 0,
            animation: "sketch-fade-in 300ms ease-out forwards",
            animationDelay: `${delayMs + 400}ms`,
          }}
        >
          {lines.map((line, i) => (
            <tspan key={line} x={midX} y={tightGap ? labelY + i * (fontSize + 2) : labelY - (lines.length - 1 - i) * (fontSize + 2)}>
              {line}
            </tspan>
          ))}
        </text>
      )}
    </g>
  );
}

function AnnotationRing({ node }: { node: LaidOutNode }) {
  return (
    <path
      d={sketchScribbleRing(`${node.id}-annotation`, node.x, node.y, node.w / 2 + 22, node.h / 2 + 24)}
      fill="none"
      stroke="#dc2626"
      strokeWidth={3.5}
      strokeDasharray="2 6"
      strokeLinecap="round"
      style={{ opacity: 0, animation: "sketch-fade-in 400ms ease-out forwards" }}
    />
  );
}

function PaperTexture() {
  return (
    <div
      className="pointer-events-none absolute inset-0 opacity-[0.035]"
      style={{
        backgroundImage:
          "radial-gradient(circle at 1px 1px, #000 1px, transparent 0)",
        backgroundSize: "18px 18px",
      }}
    />
  );
}

function EmptyBoard() {
  return (
    <section className="grid h-full min-h-0 place-items-center rounded-[1.75rem] border border-slate-200 bg-[#fbfbf9] p-8 text-slate-950">
      <div className="max-w-xl text-center">
        <p className="text-sm font-bold uppercase tracking-[0.18em] text-slate-500">Teacher board</p>
        <p className="mt-4 text-4xl font-black tracking-tight">Nothing drawn yet.</p>
        <p className="mt-3 text-lg font-semibold text-slate-600">
          The teacher is setting the scene before picking up the marker.
        </p>
      </div>
    </section>
  );
}

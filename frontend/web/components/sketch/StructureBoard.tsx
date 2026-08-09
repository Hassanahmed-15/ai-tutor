"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import katex from "katex";
import { useDrawTimeline, type TimelineOp } from "../../lib/anim/timeline";
import { useReducedMotion } from "../../lib/anim/useReducedMotion";
import { BOARD_H, BOARD_W, layoutStructure, type StructureLayout } from "../../lib/structureLayout";
import type { StructureSpec } from "../../lib/structureSpec";

/**
 * The structural board: a process, cycle, tree or state machine drawn from MEANING.
 *
 * Every other board asks the model where to put things. This one does not: the spec carries only
 * nodes and edges, ELK computes the geometry (lib/structureLayout.ts), and this component draws
 * the result. That division is the entire point — the model contributes the part it is good at
 * (which stages exist, what turns into what) and contributes nothing to the part it is bad at
 * (where things go), so overlapping labels and off-canvas text are not outcomes it can produce.
 *
 * Animation reuses the same anime.js timeline as every other board (useDrawTimeline), so it scrubs
 * with narration identically: boxes stroke themselves on, labels arrive, and each arrow draws only
 * once both of the nodes it connects are already on the board.
 */

// Node label size now comes from the layout (`n.fontSize`), which measured the text against the
// final box — see structureLayout.fittedFontSize. A constant here is exactly what let labels
// overflow: the geometry was scaled to fit the frame and the type was not.
const EDGE_FONT = 15;

/** Math-ish labels get typeset. A plain domain term like "Magma" must NOT go through KaTeX — it
 *  would render identically but inside a foreignObject for no reason. */
function looksLikeMath(s: string): boolean {
  return /[\^_\\]|\d\s*[+\-*/=]\s*\d|=\s*[a-z0-9]/i.test(s);
}

/** Midpoint of the route's longest segment, offset perpendicular to it so the label sits beside
 *  the arrow rather than on it. */
function labelAnchor(points: Array<{ x: number; y: number }>): { x: number; y: number } {
  if (points.length < 2) return points[0] ?? { x: 0, y: 0 };
  let best = 0;
  let bestLen = -1;
  for (let i = 0; i < points.length - 1; i++) {
    const len = Math.hypot(points[i + 1].x - points[i].x, points[i + 1].y - points[i].y);
    if (len > bestLen) {
      bestLen = len;
      best = i;
    }
  }
  const a = points[best];
  const b = points[best + 1];
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2;
  const len = Math.max(1, Math.hypot(b.x - a.x, b.y - a.y));
  // Perpendicular unit vector, biased upward so labels prefer sitting above a horizontal arrow.
  const nx = -(b.y - a.y) / len;
  const ny = (b.x - a.x) / len;
  const dir = ny > 0 ? -1 : 1;
  return { x: mx + nx * 14 * dir, y: my + ny * 14 * dir - 2 };
}

function MathOrText({
  text,
  lines,
  x,
  y,
  size,
  boxW,
  fill,
}: {
  text: string;
  lines: string[];
  x: number;
  y: number;
  size: number;
  boxW: number;
  fill: string;
}) {
  if (!looksLikeMath(text)) {
    // `lines` and `size` both come from the layout, which measured this exact string at this exact
    // size against this exact box. Drawing anything else here — a constant font, the unwrapped
    // label — is what put "Right Left Grandchild" outside its own rectangle.
    const leading = size * 1.25;
    const top = y - ((lines.length - 1) * leading) / 2;
    return (
      <text x={x} y={top} textAnchor="middle" dominantBaseline="middle" style={{ fontSize: size, fontWeight: 700, fill }}>
        {lines.map((line, i) => (
          <tspan key={i} x={x} dy={i === 0 ? 0 : leading}>
            {line}
          </tspan>
        ))}
      </text>
    );
  }
  // KaTeX emits HTML, so it needs a foreignObject host. This board only ever renders in the
  // browser (never through the resvg rasteriser the critics use), so that is safe here.
  let html = "";
  try {
    html = katex.renderToString(text, { throwOnError: false, displayMode: false });
  } catch {
    html = "";
  }
  if (!html) {
    return (
      <text x={x} y={y} textAnchor="middle" dominantBaseline="middle" style={{ fontSize: size, fontWeight: 700, fill }}>
        {text}
      </text>
    );
  }
  // Sized to the node, not to a constant. A fixed 260px host overflowed every box narrower than
  // that, which is most of them.
  const w = boxW;
  const h = size * 2.2;
  return (
    <foreignObject x={x - w / 2} y={y - h / 2} width={w} height={h}>
      <div
        style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", fontSize: size, color: fill }}
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </foreignObject>
  );
}

export function StructureBoard({ spec, progress = 0 }: { spec: StructureSpec; progress?: number }) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const reducedMotion = useReducedMotion();
  const [layout, setLayout] = useState<StructureLayout | null>(null);

  // ELK is async. Guard with `alive` so a beat change mid-layout cannot apply stale geometry.
  useEffect(() => {
    let alive = true;
    layoutStructure(spec).then((l) => {
      if (alive) setLayout(l);
    });
    return () => {
      alive = false;
    };
  }, [spec]);

  /**
   * Reveal order is the teaching order: each node's box, then its label, and an edge only once
   * BOTH of its endpoints exist — an arrow pointing at nothing reads as a mistake rather than as
   * a relationship being drawn.
   */
  const { ops, edgeAt } = useMemo(() => {
    if (!layout) return { ops: [] as TimelineOp[], nodeAt: new Map<string, number>(), edgeAt: [] as number[] };
    const order = new Map<string, number>();
    layout.nodes.forEach((n, i) => order.set(n.id, i));
    const steps = layout.nodes.length + layout.edges.length;
    const slot = (k: number) => 0.04 + (0.9 * k) / Math.max(1, steps);

    const nAt = new Map<string, number>();
    layout.nodes.forEach((n, i) => nAt.set(n.id, slot(i)));
    const eAt = layout.edges.map((e) => {
      const after = Math.max(order.get(e.from) ?? 0, order.get(e.to) ?? 0);
      return slot(after + 1);
    });

    const list: TimelineOp[] = [];
    let index = 0;
    layout.nodes.forEach((n) => {
      list.push({ kind: "shape", at: nAt.get(n.id) ?? 0, index: index++ });
      list.push({ kind: "label", at: (nAt.get(n.id) ?? 0) + 0.02, index: index++ });
    });
    layout.edges.forEach((_, i) => {
      list.push({ kind: "arrow", at: eAt[i], index: index++ });
    });
    return { ops: list, nodeAt: nAt, edgeAt: eAt };
  }, [layout]);

  useDrawTimeline(svgRef, ops, 11000, reducedMotion ? 1 : progress);

  if (!layout) {
    return <section className="relative h-full min-h-0 w-full rounded-xl border border-slate-200 bg-white" />;
  }

  // Indices must match the order the ops were pushed in above.
  const nodeBoxIndex = (i: number) => i * 2;
  const nodeLabelIndex = (i: number) => i * 2 + 1;
  const edgeIndex = (i: number) => layout.nodes.length * 2 + i;

  return (
    <section className="relative h-full min-h-0 w-full overflow-hidden rounded-xl border border-slate-200 bg-white">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${BOARD_W} ${BOARD_H}`}
        preserveAspectRatio="xMidYMid meet"
        className="absolute inset-0 h-full w-full"
      >
        <defs>
          <marker id="structure-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="#64748b" />
          </marker>
        </defs>

        {layout.edges.map((e, i) => (
          <g key={`e-${i}`}>
            <path
              data-op={edgeIndex(i)}
              d={e.points.map((p, k) => `${k === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ")}
              fill="none"
              stroke="#64748b"
              strokeWidth={2.6}
              strokeLinecap="round"
              strokeLinejoin="round"
              markerEnd="url(#structure-arrow)"
            />
            {e.label ? (
              (() => {
                // Sit the label on the LONGEST segment of the route, nudged perpendicular to it.
                // Using the raw polyline midpoint put short labels straight on top of the boxes,
                // because on a two-point edge the midpoint is the gap between two adjacent nodes.
                const p = labelAnchor(e.points);
                return (
                  <text
                    x={p.x}
                    y={p.y}
                    textAnchor="middle"
                    opacity={progress >= (edgeAt[i] ?? 1) ? 1 : 0}
                    style={{ fontSize: EDGE_FONT, fontWeight: 600, fill: "#475569", paintOrder: "stroke", stroke: "#ffffff", strokeWidth: 4 }}
                  >
                    {e.label}
                  </text>
                );
              })()
            ) : null}
          </g>
        ))}

        {layout.nodes.map((n, i) => (
          <g key={n.id}>
            <rect
              data-op={nodeBoxIndex(i)}
              x={n.x}
              y={n.y}
              width={n.w}
              height={n.h}
              rx={12}
              fill="#eff6ff"
              fillOpacity={0.9}
              stroke="#2563eb"
              strokeWidth={2.6}
            />
            <g data-op={nodeLabelIndex(i)}>
              <MathOrText
                text={n.label}
                lines={n.lines}
                x={n.x + n.w / 2}
                y={n.y + n.h / 2}
                size={n.fontSize}
                boxW={n.w}
                fill="#1e293b"
              />
            </g>
          </g>
        ))}
      </svg>
    </section>
  );
}

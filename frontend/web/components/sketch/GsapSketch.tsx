"use client";

import { useMemo, useRef } from "react";
import { sketchCircle, sketchDroplet, sketchHexagon, sketchLeaf, sketchLine, sketchRect } from "../whiteboard/sketch";
import { useDrawTimeline, type TimelineOp } from "../../lib/anim/timeline";
import { useReducedMotion } from "../../lib/anim/useReducedMotion";
import type { DrawScript } from "./LiveSketch";

/**
 * A DrawScript board driven by a GSAP timeline instead of per-frame React state.
 *
 * THE DIFFERENCE FROM LiveSketch. LiveSketch calls `setElapsed(t)` in a rAF loop, so React
 * re-renders ~60x/second and re-filters which ops exist; the stroke-in is a CSS keyframe,
 * which can only run forward. Here React renders every op ONCE as static structure and GSAP
 * owns all animation, so:
 *
 *   - nothing re-renders during playback
 *   - the board scrubs BACKWARDS (drag narration progress down and marks un-draw)
 *   - `morph` genuinely interpolates the shape, which LiveSketch cannot do at all
 *
 * Deliberately flag-gated and separate rather than a rewrite of LiveSketch's ~2000 lines: the
 * point of this stage is to find out whether the timeline model holds up on a real beat before
 * anything is deleted.
 */

const VB_W = 1000;
const VB_H = 560;
const gx = (x: number) => (x / 100) * VB_W;
const gy = (y: number) => (y / 100) * VB_H;

type AnyOp = Record<string, unknown> & { kind?: string; at?: number };

/** The `d` for a shape op, so a morph has a real path to interpolate towards. */
function pathForShape(op: AnyOp, seed: string): string {
  const shape = String(op.shape ?? "circle");
  const x = gx(Number(op.x ?? 50));
  const y = gy(Number(op.y ?? 50));
  const w = gx(Number(op.w ?? 16));
  const h = gy(Number(op.h ?? 12));
  if (shape === "circle") return sketchCircle(seed, x, y, w / 2, h / 2);
  if (shape === "hexagon") return sketchHexagon(seed, x, y, w, h);
  if (shape === "droplet") return sketchDroplet(seed, x, y, w, h);
  if (shape === "leaf") return sketchLeaf(seed, x, y, w, h).outline;
  if (shape === "line" || shape === "chain") return sketchLine(seed, x - w / 2, y, x + w / 2, y);
  // sketchRect takes the CENTRE and offsets by w/2/h/2 itself. Passing an already-offset
  // top-left subtracted it twice, drawing every rect half a box left and up of where the op
  // asked — which is why rects clipped off the canvas edge and why an `indicate`/`circumscribe`
  // aimed at the same coordinates never lined up with the shape it was meant to ring.
  return sketchRect(seed, x, y, w, h);
}

export function GsapSketch({
  script,
  progress = 0,
}: {
  script: DrawScript;
  progress?: number;
}) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const paper = script.surface === "paper";
  const ink = paper ? "#334155" : "#e2e8f0";
  const reducedMotion = useReducedMotion();

  const ops = useMemo(
    () => (script.ops as unknown as AnyOp[]).filter((o) => o && typeof o === "object").sort((a, b) => Number(a.at ?? 0) - Number(b.at ?? 0)),
    [script],
  );

  // Timeline descriptors: what each op does and, for a morph, the path it becomes.
  const timelineOps: TimelineOp[] = useMemo(
    () =>
      ops.map((op, index) => {
        const descriptor: TimelineOp = { kind: String(op.kind ?? ""), at: Number(op.at ?? 0), index };
        if (op.kind === "morph") {
          descriptor.endAt = Number(op.morphAt ?? Number(op.at ?? 0) + 0.2);
          // The end state is the same shape at its destination — MorphSVG interpolates
          // between the two `d` strings, which is what makes it a transformation rather
          // than a translation.
          descriptor.morphTo = pathForShape(
            { ...op, x: op.toX, y: op.toY, shape: op.toShape ?? op.shape },
            `morph-${index}-to`,
          );
        }
        if (typeof op.endAt === "number") descriptor.endAt = Number(op.endAt);
        return descriptor;
      }),
    [ops],
  );

  useDrawTimeline(svgRef, timelineOps, script.durationMs ?? 11000, reducedMotion ? 1 : progress);

  return (
    <section
      className={`relative h-full min-h-0 w-full overflow-hidden rounded-xl border ${
        paper ? "border-slate-200 bg-white" : "border-slate-800 bg-[#020617]"
      }`}
    >
      <svg ref={svgRef} viewBox={`0 0 ${VB_W} ${VB_H}`} preserveAspectRatio="xMidYMid meet" className="absolute inset-0 h-full w-full">
        {ops.map((op, index) => {
          const color = (op.color as string) ?? ink;
          const kind = String(op.kind ?? "");

          if (kind === "label" || kind === "note") {
            const words = String(op.text ?? "").split(/\s+/).filter(Boolean);
            const size = op.size === "lg" ? 34 : op.size === "sm" ? 20 : 26;
            return (
              // Each word is its own element so the reveal is word-by-word — text arriving at
              // the pace it is spoken, rather than a block appearing.
              <text
                key={index}
                data-op={index}
                x={gx(Number(op.x ?? 50))}
                y={gy(Number(op.y ?? 50))}
                textAnchor="middle"
                style={{ fontSize: size, fontWeight: kind === "label" ? 800 : 500, fill: color }}
              >
                {words.map((word, w) => (
                  <tspan key={w} data-word="" opacity={0}>
                    {w > 0 ? " " : ""}
                    {word}
                  </tspan>
                ))}
              </text>
            );
          }

          if (kind === "arrow") {
            return (
              <path
                key={index}
                data-op={index}
                d={sketchLine(`arrow-${index}`, gx(Number(op.x1 ?? 0)), gy(Number(op.y1 ?? 0)), gx(Number(op.x2 ?? 0)), gy(Number(op.y2 ?? 0)))}
                fill="none"
                stroke={color}
                strokeWidth={3.2}
                strokeLinecap="round"
                markerEnd="url(#gsap-arrow)"
              />
            );
          }

          if (kind === "shape" || kind === "morph") {
            const shapePath = (
              <path
                key={index}
                data-op={index}
                d={pathForShape(op, `op-${index}`)}
                fill={color}
                fillOpacity={kind === "morph" ? 0.22 : 0.14}
                stroke={color}
                strokeWidth={4}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            );
            if (kind !== "morph") return shapePath;

            // THE MORPH'S MEANING LIVES IN ITS TEXT. A `morph` op carries `text` (the before
            // state) and `toText` (the after state) — "NOT(A OR B)" becoming "NOT A AND NOT B".
            // Rendering only the path drew a silhouette that changed shape while saying nothing,
            // which on a real generated beat is an unlabelled grey box: the animation was
            // technically correct and pedagogically empty. LiveSketch has always drawn this text,
            // so its absence here was a straight regression against the board it replaces.
            const half = gy(Number(op.h ?? 12)) / 2 + 22; // clearance so the label clears an emphasis ring drawn around the shape
            const before = String(op.text ?? "");
            const after = String(op.toText ?? "");
            return (
              <g key={index}>
                {shapePath}
                {before ? (
                  <text
                    data-morph-text-from={index}
                    x={gx(Number(op.x ?? 50))}
                    y={gy(Number(op.y ?? 50)) + half + 30}
                    textAnchor="middle"
                    opacity={0}
                    style={{ fontSize: 24, fontWeight: 700, fill: color }}
                  >
                    {before}
                  </text>
                ) : null}
                {after ? (
                  <text
                    data-morph-text-to={index}
                    x={gx(Number(op.toX ?? op.x ?? 50))}
                    y={gy(Number(op.toY ?? op.y ?? 50)) + half + 30}
                    textAnchor="middle"
                    opacity={0}
                    style={{ fontSize: 24, fontWeight: 800, fill: String(op.toColor ?? color) }}
                  >
                    {after}
                  </text>
                ) : null}
              </g>
            );
          }

          if (kind === "indicate" || kind === "circumscribe" || kind === "flash") {
            const w = gx(Number(op.w ?? 16));
            const h = gy(Number(op.h ?? 12));
            return (
              <rect
                key={index}
                data-op={index}
                x={gx(Number(op.x ?? 50)) - w / 2}
                y={gy(Number(op.y ?? 50)) - h / 2}
                width={w}
                height={h}
                rx={12}
                fill="none"
                stroke={color}
                strokeWidth={4}
                opacity={0}
              />
            );
          }

          return null;
        })}
        <defs>
          <marker id="gsap-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="context-stroke" />
          </marker>
          {/*
            Morph destinations. anime.js `svg.morphTo()` interpolates towards a DOM NODE, not a
            path `d` string (GSAP's morphSVG took the string, which is why these did not exist
            before). They live in <defs> so they are never painted — only their `d` is read —
            and are keyed by op index so lib/anim/timeline.ts can find each one.
          */}
          {timelineOps.map((op) =>
            op.morphTo ? <path key={`morph-${op.index}`} data-morph-to={op.index} d={op.morphTo} /> : null,
          )}
        </defs>
      </svg>
    </section>
  );
}

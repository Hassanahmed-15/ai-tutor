"use client";
import { useEffect, useState } from "react";

/**
 * A composed diagram: labeled boxes/shapes connected by lines, with optional flowing
 * particles along a path (for "electrons flow" style motion). This is the primitive
 * system's answer to a beat that currently needs either an AI cutaway image+callouts
 * OR a full custom React animation — built from typed shapes only, no LLM-written code,
 * no image generation call.
 */

export interface DiagramShape {
  id: string;
  kind: "rect" | "circle";
  x: number; // 0-100 (% of viewBox)
  y: number;
  w?: number;
  h?: number;
  r?: number;
  color: string;
  label: string;
  labelPos?: "inside" | "above" | "below";
}

export interface DiagramConnector {
  from: string; // shape id
  to: string;
  style?: "solid" | "dashed";
  flow?: boolean; // animate a particle traveling along this path
  flowColor?: string;
  flowLabel?: string;
}

/**
 * An outline-only container that visually groups other shapes inside it — e.g. the
 * battery's own casing around its anode/cathode terminals. Drawn as a bounding box/circle
 * with NO fill (so it doesn't hide what's inside), just a sketchy outline + external label.
 * This is what was missing from the electron-flow diagram: anode/cathode floated with
 * nothing showing they're both PART OF a battery.
 */
export interface DiagramEnclosure {
  id: string;
  kind: "battery" | "box" | "circle";
  x: number; // 0-100, center
  y: number;
  w: number; // 0-100, spans enough to contain its child shapes
  h: number;
  label?: string;
  labelPos?: "above" | "below";
}

export interface DiagramSpec {
  shapes: DiagramShape[];
  connectors: DiagramConnector[];
  enclosures?: DiagramEnclosure[];
  viewBoxW?: number;
  viewBoxH?: number;
}

function shapeCenter(s: DiagramShape) {
  if (s.kind === "circle") return { x: s.x, y: s.y };
  return { x: s.x + (s.w ?? 20) / 2, y: s.y + (s.h ?? 14) / 2 };
}

export function Diagram({ spec, wobble = true }: { spec: DiagramSpec; wobble?: boolean }) {
  const vbW = spec.viewBoxW ?? 400;
  const vbH = spec.viewBoxH ?? 220;
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let raf: number;
    const start = performance.now();
    const loop = (t: number) => {
      setTick(((t - start) / 1000) % 3); // 3s loop
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  const byId = Object.fromEntries(spec.shapes.map((s) => [s.id, s]));

  return (
    <svg
      viewBox={`0 0 ${vbW} ${vbH}`}
      width="100%"
      style={{ filter: wobble ? "url(#sketchWobble)" : undefined, maxWidth: 560 }}
    >
      {/* connectors drawn first, under the shapes */}
      {spec.connectors.map((c, i) => {
        const a = byId[c.from];
        const b = byId[c.to];
        if (!a || !b) return null;
        const pa = shapeCenter(a);
        const pb = shapeCenter(b);
        const ax = (pa.x / 100) * vbW;
        const ay = (pa.y / 100) * vbH;
        const bx = (pb.x / 100) * vbW;
        const by = (pb.y / 100) * vbH;
        const progress = c.flow ? tick / 3 : 0;
        const px = ax + (bx - ax) * progress;
        const py = ay + (by - ay) * progress;
        return (
          <g key={i}>
            <line
              x1={ax} y1={ay} x2={bx} y2={by}
              stroke="#5c5548" strokeWidth={2}
              strokeDasharray={c.style === "dashed" ? "6 5" : undefined}
            />
            {c.flow && (
              <>
                <circle cx={px} cy={py} r={6} fill={c.flowColor ?? "#5b9bd5"} />
                {c.flowLabel && (
                  <text x={px} y={py - 12} fontSize="11" textAnchor="middle" fill={c.flowColor ?? "#5b9bd5"} fontFamily="var(--font-sketch)">
                    {c.flowLabel}
                  </text>
                )}
              </>
            )}
          </g>
        );
      })}

      {/* shapes */}
      {spec.shapes.map((s) => {
        const cx = (s.x / 100) * vbW;
        const cy = (s.y / 100) * vbH;
        const labelY =
          s.labelPos === "above" ? cy - (s.h ? (s.h / 100) * vbH : 20) / 2 - 10 :
          s.labelPos === "below" ? cy + (s.h ? (s.h / 100) * vbH : 20) / 2 + 18 :
          cy + 5;
        return (
          <g key={s.id}>
            {s.kind === "rect" ? (
              <rect
                x={cx - ((s.w ?? 20) / 100) * vbW / 2}
                y={cy - ((s.h ?? 14) / 100) * vbH / 2}
                width={((s.w ?? 20) / 100) * vbW}
                height={((s.h ?? 14) / 100) * vbH}
                rx={10}
                fill={s.color}
                fillOpacity={0.85}
                stroke="#5c5548"
                strokeWidth={1.5}
              />
            ) : (
              <circle cx={cx} cy={cy} r={((s.r ?? 8) / 100) * vbW} fill={s.color} stroke="#5c5548" strokeWidth={1.5} />
            )}
            {s.labelPos === "inside" || !s.labelPos ? (
              <text x={cx} y={labelY} fontSize="13" textAnchor="middle" fill="#20180a" fontFamily="var(--font-sketch)">
                {s.label}
              </text>
            ) : (
              <text x={cx} y={labelY} fontSize="13" textAnchor="middle" fill="#20180a" fontFamily="var(--font-sketch)">
                {s.label}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

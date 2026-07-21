"use client";
import { useEffect, useRef, useState } from "react";
import rough from "roughjs";
import type { DiagramShape, DiagramConnector, DiagramEnclosure, DiagramSpec } from "./Diagram";

/**
 * SECOND VERSION of the diagram renderer — draws with Rough.js instead of raw SVG
 * primitives. Rough.js simulates real pen strokes (multiple slightly-offset passes,
 * natural overshoot, variable line weight) rather than a filter applied after the fact.
 * This is the fix for "doesn't look hand-drawn" — a different rendering primitive, not
 * a CSS tweak on the same rectangles.
 */
export function DiagramRough({ spec }: { spec: DiagramSpec }) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [tick, setTick] = useState(0);
  const vbW = spec.viewBoxW ?? 400;
  const vbH = spec.viewBoxH ?? 220;

  useEffect(() => {
    let raf: number;
    const start = performance.now();
    const loop = (t: number) => {
      setTick(((t - start) / 1000) % 3);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    // Clear previous frame's rough-drawn nodes (keep only nodes we explicitly re-add).
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    const rc = rough.svg(svg);
    const byId = Object.fromEntries(spec.shapes.map((s) => [s.id, s]));

    const center = (s: DiagramShape) => {
      if (s.kind === "circle") return { x: (s.x / 100) * vbW, y: (s.y / 100) * vbH };
      const w = ((s.w ?? 20) / 100) * vbW;
      const h = ((s.h ?? 14) / 100) * vbH;
      return { x: (s.x / 100) * vbW, y: (s.y / 100) * vbH, w, h };
    };

    // Track occupied label rectangles so later labels can be nudged away from earlier
    // ones instead of silently overlapping — the "Cathode label collided with the wire
    // and the box edge" bug.
    const occupiedLabelRects: Array<{ x0: number; y0: number; x1: number; y1: number }> = [];
    const placeLabelText = (cx: number, cyPreferred: number, text: string, fontSize: number, color: string) => {
      const approxW = text.length * fontSize * 0.62;
      const approxH = fontSize * 1.3;
      let cy = cyPreferred;
      for (let attempt = 0; attempt < 6; attempt++) {
        const rect = { x0: cx - approxW / 2, y0: cy - approxH / 2, x1: cx + approxW / 2, y1: cy + approxH / 2 };
        const collides = occupiedLabelRects.some(
          (o) => rect.x0 < o.x1 && rect.x1 > o.x0 && rect.y0 < o.y1 && rect.y1 > o.y0
        );
        if (!collides) {
          occupiedLabelRects.push(rect);
          break;
        }
        cy += approxH + 3; // push down and try again
      }
      // Small solid backing pill behind the text so it stays legible over a hachure fill.
      const pad = 3;
      const backing = document.createElementNS("http://www.w3.org/2000/svg", "rect");
      backing.setAttribute("x", String(cx - approxW / 2 - pad));
      backing.setAttribute("y", String(cy - approxH / 2 - pad));
      backing.setAttribute("width", String(approxW + pad * 2));
      backing.setAttribute("height", String(approxH + pad * 2));
      backing.setAttribute("fill", "#fdfbf6");
      backing.setAttribute("opacity", "0.85");
      svg.appendChild(backing);

      const label = document.createElementNS("http://www.w3.org/2000/svg", "text");
      label.setAttribute("x", String(cx));
      label.setAttribute("y", String(cy + fontSize * 0.32));
      label.setAttribute("font-size", String(fontSize));
      label.setAttribute("text-anchor", "middle");
      label.setAttribute("fill", color);
      label.setAttribute("font-family", "var(--font-sketch)");
      label.textContent = text;
      svg.appendChild(label);
    };

    // Where a wire should actually leave a shape — its TOP EDGE midpoint, not its center,
    // so connectors route over/around a box instead of slicing diagonally through its fill.
    const exitPoint = (s: DiagramShape) => {
      const c = center(s);
      if (s.kind === "circle") return { x: c.x, y: c.y - ((s.r ?? 8) / 100) * vbW };
      return { x: c.x, y: c.y - (c.h ?? 20) / 2 };
    };

    // Enclosures FIRST, under everything — the battery casing, a grouping box, etc.
    // Outline only (no fill) so the shapes inside it stay fully visible.
    (spec.enclosures ?? []).forEach((e: DiagramEnclosure) => {
      const cx = (e.x / 100) * vbW;
      const cy = (e.y / 100) * vbH;
      const w = (e.w / 100) * vbW;
      const h = (e.h / 100) * vbH;

      if (e.kind === "battery") {
        // Real battery silhouette: a rounded body + a small terminal "bump" on the right
        // end — the universally recognized battery icon shape, not a generic box.
        const bodyW = w * 0.88;
        const bumpW = w * 0.12;
        const bumpH = h * 0.34;
        const body = rc.rectangle(cx - w / 2, cy - h / 2, bodyW, h, {
          stroke: "#3a362c",
          strokeWidth: 2.4,
          roughness: 1.5,
          fill: "none",
        });
        svg.appendChild(body);
        const bump = rc.rectangle(cx - w / 2 + bodyW, cy - bumpH / 2, bumpW, bumpH, {
          stroke: "#3a362c",
          strokeWidth: 2.4,
          roughness: 1.5,
          fill: "none",
        });
        svg.appendChild(bump);
      } else if (e.kind === "circle") {
        const node = rc.ellipse(cx, cy, w, h, { stroke: "#3a362c", strokeWidth: 2, roughness: 1.5, fill: "none" });
        svg.appendChild(node);
      } else {
        const node = rc.rectangle(cx - w / 2, cy - h / 2, w, h, { stroke: "#3a362c", strokeWidth: 2, roughness: 1.5, fill: "none" });
        svg.appendChild(node);
      }

      if (e.label) {
        const labelY = e.labelPos === "below" ? cy + h / 2 + 22 : cy - h / 2 - 12;
        placeLabelText(cx, labelY, e.label, 14, "#20180a");
      }
    });

    // Connectors next (under shapes) — routed via each shape's TOP EDGE (exitPoint), as a
    // two-segment elbow (up, then across) so wires clear the boxes instead of cutting
    // through their fill diagonally.
    spec.connectors.forEach((c: DiagramConnector) => {
      const a = byId[c.from];
      const b = byId[c.to];
      if (!a || !b) return;
      const pa = exitPoint(a);
      const pb = exitPoint(b);
      const midY = Math.min(pa.y, pb.y) - 24; // a shared routing height above both shapes
      const path = [
        [pa.x, pa.y],
        [pa.x, midY],
        [pb.x, midY],
        [pb.x, pb.y],
      ] as [number, number][];
      const line = rc.curve(path, {
        stroke: "#5c5548",
        strokeWidth: 2,
        roughness: 1.4,
        bowing: 1,
      });
      svg.appendChild(line);

      if (c.flow) {
        // Animate along the same elbow path, not a straight diagonal, so the dot follows
        // the visible wire.
        const segLens = [
          Math.hypot(path[1][0] - path[0][0], path[1][1] - path[0][1]),
          Math.hypot(path[2][0] - path[1][0], path[2][1] - path[1][1]),
          Math.hypot(path[3][0] - path[2][0], path[3][1] - path[2][1]),
        ];
        const total = segLens[0] + segLens[1] + segLens[2];
        const dist = (tick / 3) * total;
        let seg = 0;
        let remaining = dist;
        while (seg < 2 && remaining > segLens[seg]) {
          remaining -= segLens[seg];
          seg++;
        }
        const [sx, sy] = path[seg];
        const [ex, ey] = path[seg + 1];
        const segLen = segLens[seg] || 1;
        const t = remaining / segLen;
        const px = sx + (ex - sx) * t;
        const py = sy + (ey - sy) * t;

        const dot = rc.circle(px, py, 12, {
          fill: c.flowColor ?? "#5b9bd5",
          fillStyle: "solid",
          stroke: c.flowColor ?? "#5b9bd5",
          roughness: 1.4,
        });
        svg.appendChild(dot);
        if (c.flowLabel) {
          placeLabelText(px, py - 16, c.flowLabel, 12, c.flowColor ?? "#5b9bd5");
        }
      }
    });

    // Shapes, sketch-drawn.
    spec.shapes.forEach((s) => {
      const c = center(s);
      let node: SVGGElement;
      if (s.kind === "rect") {
        const w = c.w ?? 60;
        const h = c.h ?? 40;
        node = rc.rectangle(c.x - w / 2, c.y - h / 2, w, h, {
          fill: s.color,
          fillStyle: "hachure",
          fillWeight: 2.5,
          hachureGap: 5,
          stroke: "#3a362c",
          strokeWidth: 2,
          roughness: 1.6,
        });
      } else {
        const r = ((s.r ?? 8) / 100) * vbW;
        node = rc.circle(c.x, c.y, r * 2, {
          fill: s.color,
          fillStyle: "hachure",
          fillWeight: 2.5,
          stroke: "#3a362c",
          strokeWidth: 2,
          roughness: 1.6,
        });
      }
      svg.appendChild(node);

      const labelY =
        s.labelPos === "above" ? c.y - (c.h ?? 20) / 2 - 12 :
        s.labelPos === "below" ? c.y + (c.h ?? 20) / 2 + 20 :
        c.y + 5;
      placeLabelText(c.x, labelY, s.label, 15, "#20180a");
    });
  }, [spec, tick, vbW, vbH]);

  return <svg ref={svgRef} viewBox={`0 0 ${vbW} ${vbH}`} width="100%" style={{ maxWidth: 560 }} />;
}

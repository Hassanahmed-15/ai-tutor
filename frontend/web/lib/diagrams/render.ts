import { baseShapes, WORLD_MAP_BOX } from "./bases";
import { project } from "./project";
import type { DiagramAnchor, DiagramElement, DiagramSpec, RegionEl } from "./spec";
import { flattenElements } from "./spec";
import type { FigureDrawing, FigurePart, FigureShape, Ink } from "../figures/types";

/**
 * Compile a DiagramSpec into a FigureDrawing. Positions, colours, counts and text are decided here
 * so labels are real text and a "repeat 23" really draws 23 marks.
 */

const NAMED: Record<string, string> = {
  warm: "#dc2626",
  cold: "#2563eb",
  oxygenated: "#dc2626",
  deoxygenated: "#1d4ed8",
  red: "#fecaca",
  blue: "#bfdbfe",
  green: "#bbf7d0",
  yellow: "#fef08a",
  orange: "#fed7aa",
  purple: "#ddd6fe",
  pink: "#fbcfe8",
  cyan: "#a5f3fc",
  brown: "#e7c9a5",
  grey: "#e5e7eb",
  sand: "#fde68a",
  sky: "#e0f2fe",
  ink: "ink",
  muted: "muted",
  paper: "paper",
  none: "none",
};

function ink(v?: string, fallback: Ink | "none" = "ink"): Ink | "none" {
  if (!v) return fallback;
  const key = v.toLowerCase();
  if (NAMED[key]) return NAMED[key] as Ink | "none";
  if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(v)) return v as Ink;
  return fallback;
}

function dash(on?: boolean): { dash?: string } {
  return on ? { dash: "6 5" } : {};
}

function resolve(at: DiagramAnchor, lookup: Map<string, { x: number; y: number }>, mapBox: { x: number; y: number; w: number; h: number }): { x: number; y: number } | null {
  if ("id" in at) return lookup.get(at.id) ?? null;
  if ("lon" in at) return project(at.lon, at.lat, mapBox);
  return { x: at.x, y: at.y };
}

function regionAnchor(el: RegionEl): { x: number; y: number } {
  if (el.shape === "ellipse" || el.shape === "rod") return { x: el.cx ?? (el.x ?? 0) + (el.w ?? 0) / 2, y: el.cy ?? (el.y ?? 0) + (el.h ?? 0) / 2 };
  if (el.shape === "polygon" && el.points?.length) {
    const x = el.points.reduce((s, p) => s + p.x, 0) / el.points.length;
    const y = el.points.reduce((s, p) => s + p.y, 0) / el.points.length;
    return { x, y };
  }
  return { x: (el.x ?? 0) + (el.w ?? 0) / 2, y: (el.y ?? 0) + (el.h ?? 0) / 2 };
}

function regionPath(el: RegionEl): FigureShape[] {
  const fill = ink(el.fill, "none");
  const stroke = ink(el.stroke, "ink");
  const width = el.width ?? 1.6;
  const part = el.id;
  const style = { fill, stroke, width, ...dash(el.dash), part };
  if (el.shape === "ellipse") {
    const cx = el.cx ?? 0, cy = el.cy ?? 0, rx = el.rx ?? el.r ?? 10, ry = el.ry ?? el.r ?? 10;
    return [{ t: "path", d: `M${cx - rx} ${cy} A${rx} ${ry} 0 1 0 ${cx + rx} ${cy} A${rx} ${ry} 0 1 0 ${cx - rx} ${cy} Z`, ...style }];
  }
  if (el.shape === "rod") {
    const x = el.x ?? 0, y = el.y ?? 0, w = el.w ?? 8, h = el.h ?? 28;
    const r = Math.min(w, h) / 2;
    // Capsule: rounded caps on the short ends, straight sides on the long ones.
    return [{ t: "path", d: `M${x + r} ${y} H${x + w - r} A${r} ${r} 0 0 1 ${x + w} ${y + r} V${y + h - r} A${r} ${r} 0 0 1 ${x + w - r} ${y + h} H${x + r} A${r} ${r} 0 0 1 ${x} ${y + h - r} V${y + r} A${r} ${r} 0 0 1 ${x + r} ${y} Z`, ...style }];
  }
  if (el.shape === "polygon" && el.points && el.points.length >= 3) {
    return [{ t: "path", d: `M${el.points.map((p) => `${p.x} ${p.y}`).join(" L")} Z`, ...style }];
  }
  const x = el.x ?? 0, y = el.y ?? 0, w = el.w ?? 20, h = el.h ?? 20;
  return [{ t: "path", d: `M${x} ${y} h${w} v${h} h${-w} Z`, ...style }];
}

function catmull(points: Array<{ x: number; y: number }>, closed = false): string {
  if (points.length < 2) return "";
  if (points.length === 2) return `M${points[0].x} ${points[0].y} L${points[1].x} ${points[1].y}`;
  const p = points;
  const P = closed ? [p[p.length - 1], ...p, p[0], p[1]] : [p[0], ...p, p[p.length - 1]];
  let d = `M${p[0].x} ${p[0].y}`;
  for (let i = 1; i < P.length - 2; i++) {
    const [p0, p1, p2, p3] = [P[i - 1], P[i], P[i + 1], P[i + 2]];
    d += ` C${p1.x + (p2.x - p0.x) / 6} ${p1.y + (p2.y - p0.y) / 6} ${p2.x - (p3.x - p1.x) / 6} ${p2.y - (p3.y - p1.y) / 6} ${p2.x} ${p2.y}`;
  }
  return closed ? `${d} Z` : d;
}

function arrowHead(x1: number, y1: number, x2: number, y2: number, stroke: Ink | "none"): FigureShape[] {
  const a = Math.atan2(y2 - y1, x2 - x1);
  const L = 10;
  const hx = (k: number) => x2 - L * Math.cos(a + k);
  const hy = (k: number) => y2 - L * Math.sin(a + k);
  const fill = stroke === "none" ? "ink" : stroke;
  return [{ t: "path", d: `M${hx(0.45)} ${hy(0.45)} L${x2} ${y2} L${hx(-0.45)} ${hy(-0.45)} Z`, fill, stroke, width: 1 }];
}

function repeatPlacements(n: number, layout: "row" | "grid" | "ring", box: { x: number; y: number; w: number; h: number }): Array<{ x: number; y: number }> {
  const out: Array<{ x: number; y: number }> = [];
  if (layout === "row") {
    for (let i = 0; i < n; i++) out.push({ x: box.x + (n === 1 ? box.w / 2 : (i * box.w) / (n - 1)), y: box.y + box.h / 2 });
    return out;
  }
  if (layout === "ring") {
    const cx = box.x + box.w / 2, cy = box.y + box.h / 2, rx = box.w / 2.4, ry = box.h / 2.4;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 - Math.PI / 2;
      out.push({ x: cx + rx * Math.cos(a), y: cy + ry * Math.sin(a) });
    }
    return out;
  }
  const cols = Math.ceil(Math.sqrt(n));
  const rows = Math.ceil(n / cols);
  for (let i = 0; i < n; i++) {
    const c = i % cols, r = Math.floor(i / cols);
    out.push({
      x: box.x + ((c + 0.5) * box.w) / cols,
      y: box.y + ((r + 0.5) * box.h) / rows,
    });
  }
  return out;
}

function addPart(parts: FigurePart[], id: string, name: string, anchor: { x: number; y: number }) {
  if (!id || parts.some((p) => p.id === id)) return;
  parts.push({ id, name: name.slice(0, 34), anchor });
}

export function compileDiagram(spec: DiagramSpec): FigureDrawing {
  const shapes: FigureShape[] = [...baseShapes(spec.base, spec.w, spec.h)];
  const parts: FigurePart[] = [];
  const lookup = new Map<string, { x: number; y: number }>();
  const mapBox = spec.base === "world-map" ? WORLD_MAP_BOX : { x: 0, y: 0, w: spec.w, h: spec.h };
  const axes = new Map<string, Extract<DiagramElement, { t: "axis" }>>();

  const remember = (id: string, at: { x: number; y: number }, part?: string) => {
    lookup.set(id, at);
    if (part) addPart(parts, id, part, at);
  };

  const draw = (el: DiagramElement) => {
    if (el.t === "group") {
      el.elements.forEach(draw);
      return;
    }
    if (el.t === "region") {
      shapes.push(...regionPath(el));
      remember(el.id, regionAnchor(el), el.part);
      return;
    }
    if (el.t === "line") {
      const d = el.curve ? catmull(el.points, el.closed) : `M${el.points.map((p) => `${p.x} ${p.y}`).join(" L")}${el.closed ? " Z" : ""}`;
      shapes.push({ t: "path", d, fill: el.closed ? ink(el.fill, "none") : "none", stroke: ink(el.stroke, "ink"), width: el.width ?? 1.6, ...dash(el.dash), part: el.id });
      remember(el.id, el.points[Math.floor(el.points.length / 2)], el.part);
      return;
    }
    if (el.t === "arrow") {
      const a = resolve(el.from, lookup, mapBox);
      const b = resolve(el.to, lookup, mapBox);
      if (!a || !b) return;
      const mx = (a.x + b.x) / 2;
      const my = (a.y + b.y) / 2 + (el.curved ? -18 : 0);
      const d = el.curved ? `M${a.x} ${a.y} Q${mx} ${my} ${b.x} ${b.y}` : `M${a.x} ${a.y} L${b.x} ${b.y}`;
      const stroke = ink(el.stroke ?? el.fill, "ink");
      shapes.push({ t: "path", d, fill: "none", stroke, width: el.width ?? 2, ...dash(el.dash), part: el.id });
      shapes.push(...arrowHead(el.curved ? mx : a.x, el.curved ? my : a.y, b.x, b.y, stroke));
      if (el.label && !el.part) {
        shapes.push({ t: "text", x: mx, y: my - (el.curved ? 6 : 8), text: el.label, size: 12, anchor: "middle", fill: "ink", part: el.id });
      }
      remember(el.id, { x: mx, y: my }, el.part);
      return;
    }
    if (el.t === "label") {
      const at = resolve(el.at, lookup, mapBox);
      if (!at) return;
      remember(el.id, at, el.part ?? (el.leader === false ? undefined : el.text));
      // Margin labels are placed by layoutFigure from parts. On-diagram labels (no leader) are drawn here.
      if (el.leader === false) {
        shapes.push({ t: "text", x: at.x, y: at.y, text: el.text, size: 13, anchor: "middle", fill: "ink", part: el.id });
      }
      return;
    }
    if (el.t === "repeat") {
      const box = { x: el.x ?? 0, y: el.y ?? 0, w: el.w ?? 120, h: el.h ?? 80 };
      const spots = repeatPlacements(el.n, el.layout, box);
      const tw = el.of.w ?? 8, th = el.of.h ?? 22;
      spots.forEach((spot, i) => {
        const item: RegionEl = {
          ...el.of,
          id: `${el.id}-${i + 1}`,
          x: spot.x - tw / 2,
          y: spot.y - th / 2,
          cx: spot.x,
          cy: spot.y,
          fill: el.of.fill ?? el.fill,
          stroke: el.of.stroke ?? el.stroke ?? "ink",
        };
        shapes.push(...regionPath(item));
      });
      remember(el.id, { x: box.x + box.w / 2, y: box.y + box.h / 2 }, el.part);
      return;
    }
    if (el.t === "axis") {
      axes.set(el.id, el);
      const { x, y, w, h } = el;
      const numberLine = !el.yLabel.trim() || h < 70;
      const axisY = numberLine ? y + h / 2 : y + h;
      shapes.push({ t: "path", d: numberLine ? `M${x} ${axisY} H${x + w}` : `M${x} ${y} V${y + h} H${x + w}`, fill: "none", stroke: "ink", width: 1.6, part: el.id });
      shapes.push({ t: "text", x: x + w / 2, y: axisY + 28, text: el.xLabel, size: 13, anchor: "middle", fill: "ink" });
      if (!numberLine && el.yLabel) shapes.push({ t: "text", x: x - 10, y: y - 8, text: el.yLabel, size: 13, anchor: "end", fill: "ink" });
      const ticks = 4;
      for (let i = 0; i <= ticks; i++) {
        const tx = x + (i * w) / ticks;
        const xv = el.xMin + ((el.xMax - el.xMin) * i) / ticks;
        shapes.push({ t: "path", d: `M${tx} ${axisY} v6`, fill: "none", stroke: "ink", width: 1 });
        shapes.push({ t: "text", x: tx, y: axisY + 18, text: String(Number(xv.toPrecision(3))), size: 11, anchor: "middle", fill: "muted" });
        if (numberLine) continue;
        const ty = y + h - (i * h) / ticks;
        const yv = el.yMin + ((el.yMax - el.yMin) * i) / ticks;
        shapes.push({ t: "path", d: `M${x} ${ty} h-6`, fill: "none", stroke: "ink", width: 1 });
        shapes.push({ t: "text", x: x - 10, y: ty + 4, text: String(Number(yv.toPrecision(3))), size: 11, anchor: "end", fill: "muted" });
      }
      remember(el.id, { x: x + w / 2, y: numberLine ? axisY : y + h / 2 }, el.part);
      return;
    }
    if (el.t === "series") {
      const axis = axes.get(el.axis) ?? [...axes.values()][0];
      if (!axis) return;
      const numberLine = !axis.yLabel.trim() || axis.h < 70;
      const to = (p: { x: number; y: number }) => ({
        x: axis.x + ((p.x - axis.xMin) / (axis.xMax - axis.xMin || 1)) * axis.w,
        y: numberLine ? axis.y + axis.h / 2 : axis.y + axis.h - ((p.y - axis.yMin) / (axis.yMax - axis.yMin || 1)) * axis.h,
      });
      const pts = el.points.map(to);
      const stroke = ink(el.stroke ?? el.fill, "ink");
      if (el.style !== "points") {
        const d = el.style === "line" ? `M${pts.map((p) => `${p.x} ${p.y}`).join(" L")}` : catmull(pts);
        shapes.push({ t: "path", d, fill: "none", stroke, width: el.width ?? 2.2, part: el.id, ...dash(el.dash) });
      }
      if (el.style !== "line") {
        for (const p of pts) shapes.push({ t: "circle", cx: p.x, cy: p.y, r: 3.2, fill: stroke === "none" ? "ink" : stroke, stroke: "ink", width: 0.8, part: el.id });
      }
      for (let i = 0; i < el.points.length; i++) {
        const lab = el.points[i].label;
        if (!lab) continue;
        const left = pts[i].x < axis.x + 40;
        const low = pts[i].y > axis.y + axis.h - 28;
        const lx = left ? pts[i].x + 28 : pts[i].x + 6;
        const ly = low ? pts[i].y - 20 : pts[i].y - 10;
        shapes.push({ t: "text", x: lx, y: ly, text: lab.replace(/[−–]/g, "-"), size: 12, anchor: "start", fill: "ink", part: el.id });
      }
      remember(el.id, pts[Math.floor(pts.length / 2)] ?? { x: axis.x, y: axis.y }, el.part);
      return;
    }
    if (el.t === "bands") {
      const span = el.orientation === "h" ? el.h : el.w;
      const min = Math.min(...el.bands.map((b) => Math.min(b.from, b.to)));
      const max = Math.max(...el.bands.map((b) => Math.max(b.from, b.to)));
      const range = max - min || 1;
      for (const b of el.bands) {
        const a = (Math.min(b.from, b.to) - min) / range;
        const z = (Math.max(b.from, b.to) - min) / range;
        const box = el.orientation === "h"
          ? { x: el.x, y: el.y + (1 - z) * span, w: el.w, h: (z - a) * span }
          : { x: el.x + a * span, y: el.y, w: (z - a) * span, h: el.h };
        shapes.push({ t: "path", d: `M${box.x} ${box.y} h${box.w} v${box.h} h${-box.w} Z`, fill: ink(b.fill, "#e0f2fe"), stroke: "ink", width: 1, part: b.id });
        if (b.name && !b.part) shapes.push({ t: "text", x: box.x + box.w / 2, y: box.y + box.h / 2 + 4, text: b.name, size: 12, anchor: "middle", fill: "ink", part: b.id });
        remember(b.id, { x: box.x + box.w / 2, y: box.y + box.h / 2 }, b.part);
      }
      remember(el.id, { x: el.x + el.w / 2, y: el.y + el.h / 2 }, el.part);
      return;
    }
    if (el.t === "inset") {
      shapes.push({ t: "path", d: `M${el.x} ${el.y} h${el.w} v${el.h} h${-el.w} Z`, fill: "paper", stroke: "ink", width: 1.4, dash: "5 4", part: el.id });
      if (el.label) shapes.push({ t: "text", x: el.x + 6, y: el.y + 14, text: el.label, size: 11, anchor: "start", fill: "ink", part: el.id });
      remember(el.id, { x: el.x + el.w / 2, y: el.y + el.h / 2 }, el.part ?? el.label);
      return;
    }
    if (el.t === "map-mark") {
      const a = project(el.lon, el.lat, mapBox);
      const stroke = ink(el.stroke ?? el.fill, "ink");
      if (el.kind === "arrow" && el.toLon != null && el.toLat != null) {
        const b = project(el.toLon, el.toLat, mapBox);
        const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2 - 10;
        shapes.push({ t: "path", d: `M${a.x} ${a.y} Q${mx} ${my} ${b.x} ${b.y}`, fill: "none", stroke, width: el.width ?? 2.4, part: el.id });
        shapes.push(...arrowHead(mx, my, b.x, b.y, stroke));
        remember(el.id, { x: mx, y: my }, el.part);
      } else {
        shapes.push({ t: "circle", cx: a.x, cy: a.y, r: 4, fill: stroke === "none" ? "ink" : stroke, stroke: "ink", width: 1, part: el.id });
        remember(el.id, a, el.part);
      }
    }
  };

  spec.elements.forEach(draw);
  if (!parts.length) {
    const named = flattenElements(spec.elements).filter((el) => el.part);
    for (const el of named) {
      const at = lookup.get(el.id) ?? { x: spec.w / 2, y: spec.h / 2 };
      addPart(parts, el.id, el.part!, at);
    }
  }
  if (!parts.length) addPart(parts, "diagram", "Diagram", { x: spec.w / 2, y: spec.h / 2 });
  return { w: spec.w, h: spec.h, shapes, parts: parts.slice(0, 12) };
}

export { repeatPlacements };

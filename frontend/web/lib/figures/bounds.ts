import type { FigureDrawing, FigureShape } from "./types";

type Box = { x: number; y: number; w: number; h: number };

/**
 * The box each part's shapes cover, in figure units — the obstacles a label's leader must not cross.
 * Path data is walked command by command (absolute and relative M/L/H/V/C/S/Q/T/A/Z); curves count
 * their control points, which over-covers a little and never under-covers.
 */
export function partBounds(drawing: FigureDrawing): Map<string, Box> {
  const boxes = new Map<string, { x0: number; y0: number; x1: number; y1: number }>();
  const grow = (part: string, x: number, y: number, pad = 0) => {
    const b = boxes.get(part) ?? { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
    b.x0 = Math.min(b.x0, x - pad); b.y0 = Math.min(b.y0, y - pad); b.x1 = Math.max(b.x1, x + pad); b.y1 = Math.max(b.y1, y + pad);
    boxes.set(part, b);
  };
  for (const sh of drawing.shapes) {
    if (!sh.part) continue;
    if (sh.t === "circle") { grow(sh.part, sh.cx, sh.cy, sh.r); continue; }
    if (sh.t === "text") { const w = sh.text.length * sh.size * 0.55; const x = sh.anchor === "middle" ? sh.x - w / 2 : sh.anchor === "end" ? sh.x - w : sh.x; grow(sh.part, x, sh.y - sh.size); grow(sh.part, x + w, sh.y); continue; }
    for (const [x, y] of pathPoints(sh)) grow(sh.part, x, y);
  }
  const out = new Map<string, Box>();
  for (const [k, b] of boxes) if (Number.isFinite(b.x0)) out.set(k, { x: b.x0, y: b.y0, w: b.x1 - b.x0, h: b.y1 - b.y0 });
  return out;
}

/**
 * WHAT A PART LOOKS LIKE — its words and its closed shapes (a card, a body, a ring), not the arrows
 * that leave it or their heads. Aria's pen frames this (lib/canvas/layout.ts): framing the part's
 * leader anchor instead put her box beside the words it named (2026-10-16), and framing every shape
 * the part owns would stretch a card's box along its arrows to whatever they point at.
 */
export function partBodies(drawing: FigureDrawing, measure?: (text: string, size: number) => number): Map<string, Box> {
  const out = new Map<string, Box>();
  for (const sh of drawing.shapes) {
    if (!sh.part) continue;
    // Words are framed by their real width when the board's own measure is given (the generic
    // estimate runs wide), from cap height to just under the baseline.
    const box = sh.t === "text" && measure
      ? (() => {
          const w = measure(sh.text, sh.size);
          const x = sh.anchor === "middle" ? sh.x - w / 2 : sh.anchor === "end" ? sh.x - w : sh.x;
          return { x, y: sh.y - sh.size * 0.8, w, h: sh.size * 1.05 };
        })()
      : partBounds({ ...drawing, shapes: [{ ...sh, part: "x" }] }).get("x");
    if (!box || box.w * box.h <= 0) continue;
    // An arrow's line is an open path; its head is a closed one, but tiny.
    const body = sh.t !== "path" || (/z\s*$/i.test(sh.d.trim()) && box.w * box.h >= 400);
    if (!body) continue;
    const prev = out.get(sh.part);
    out.set(sh.part, prev ? { x: Math.min(prev.x, box.x), y: Math.min(prev.y, box.y), w: Math.max(prev.x + prev.w, box.x + box.w) - Math.min(prev.x, box.x), h: Math.max(prev.y + prev.h, box.y + box.h) - Math.min(prev.y, box.y) } : box);
  }
  return out;
}

function pathPoints(sh: Extract<FigureShape, { t: "path" }>): Array<[number, number]> {
  const pts: Array<[number, number]> = [];
  const tokens = sh.d.match(/[MLHVCSQTAZmlhvcsqtaz]|-?\d*\.?\d+(?:e-?\d+)?/g) ?? [];
  let cmd = "M", x = 0, y = 0, sx = 0, sy = 0, i = 0;
  const num = () => Number(tokens[i++]);
  const isNum = () => i < tokens.length && !/^[A-Za-z]$/.test(tokens[i]);
  while (i < tokens.length) {
    if (/^[A-Za-z]$/.test(tokens[i])) cmd = tokens[i++];
    const rel = cmd === cmd.toLowerCase();
    const C = cmd.toUpperCase();
    if (C === "Z") { x = sx; y = sy; continue; }
    if (!isNum()) { i++; continue; }
    const pair = (): [number, number] => { const a = num(), b = num(); return rel ? [x + a, y + b] : [a, b]; };
    if (C === "M" || C === "L" || C === "T") { [x, y] = pair(); if (C === "M") { sx = x; sy = y; cmd = rel ? "l" : "L"; } pts.push([x, y]); }
    else if (C === "H") { const a = num(); x = rel ? x + a : a; pts.push([x, y]); }
    else if (C === "V") { const a = num(); y = rel ? y + a : a; pts.push([x, y]); }
    else if (C === "C") { const p1 = pair(), p2 = pair(), p3 = pair(); pts.push(p1, p2, p3); [x, y] = p3; }
    else if (C === "S" || C === "Q") { const p1 = pair(), p2 = pair(); pts.push(p1, p2); [x, y] = p2; }
    else if (C === "A") { const rx = num(), ry = num(); num(); num(); num(); const p = pair(); pts.push([p[0] - rx, p[1] - ry], [p[0] + rx, p[1] + ry], [x - rx, y - ry], [x + rx, y + ry]); [x, y] = p; }
    else i++;
  }
  return pts;
}

/**
 * Every shape's own box (with its part, or "" when unlabelled): the obstacles a leader must avoid.
 * Per shape, not per part — a part drawn twice (both atoms' shells) is two obstacles, not one box
 * spanning the whole figure, and unlabelled art (an atom's core) counts too.
 */
export function shapeBoxes(drawing: FigureDrawing): Array<{ part: string; box: Box; circle?: { cx: number; cy: number; r: number } }> {
  const out: Array<{ part: string; box: Box; circle?: { cx: number; cy: number; r: number } }> = [];
  for (const sh of drawing.shapes) {
    const one = partBounds({ ...drawing, shapes: [{ ...sh, part: "x" }] }).get("x");
    if (!one || one.w * one.h <= 0) continue;
    // A circle is tested as a circle: its box's empty corners are not in the way of a leader.
    // A path drawn as a circle (arcs whose radius is half its square box) counts as one too.
    const arc = sh.t === "path" ? /[Aa]\s*([\d.]+)[\s,]+([\d.]+)/.exec(sh.d) : null;
    const round = arc && Math.abs(one.w - one.h) < 2 && Math.abs(Number(arc[1]) - one.w / 2) < 2 && Math.abs(Number(arc[2]) - one.h / 2) < 2;
    const circle = sh.t === "circle" ? { cx: sh.cx, cy: sh.cy, r: sh.r } : round ? { cx: one.x + one.w / 2, cy: one.y + one.h / 2, r: one.w / 2 } : undefined;
    out.push({ part: sh.part ?? "", box: one, ...(circle ? { circle } : {}) });
  }
  return out;
}

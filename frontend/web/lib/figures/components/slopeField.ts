import type { FigureComponent, FigureParams, Pt } from "../types";
import { PALETTE, Sketch, bool, dist, fmt, optNum, segHitsBox, str } from "./mathsKit";
import { coordText, drawAxes, fn2, makePlot, niceStep, prettyExpr, snap, windowFrom, zeros, type Plot } from "./calculusKit";

/**
 * A SLOPE FIELD for dy/dx = f(x, y). The board gives the differential equation; the code draws a
 * short segment of slope f(x, y) at every grid point, finds the equilibrium solutions (horizontal
 * lines where dy/dx = 0 for every x), and integrates the particular solution through (x0, y0) by
 * fourth-order Runge–Kutta — so dy/dx = y through (0, 1) really passes (1, e).
 */

/** RK4 from (x0, y0) to xEnd in `steps` steps; stops early (returning what it has) when y leaves ±limit or is undefined. */
export function rk4(f: (x: number, y: number) => number, x0: number, y0: number, xEnd: number, steps = 400, limit = Infinity): Pt[] {
  const h = (xEnd - x0) / steps;
  const pts: Pt[] = [{ x: x0, y: y0 }];
  let x = x0, y = y0;
  for (let i = 0; i < steps; i++) {
    const k1 = f(x, y), k2 = f(x + h / 2, y + (h * k1) / 2), k3 = f(x + h / 2, y + (h * k2) / 2), k4 = f(x + h, y + h * k3);
    const ny = y + (h / 6) * (k1 + 2 * k2 + 2 * k3 + k4);
    if (!Number.isFinite(ny)) break;
    x += h;
    y = ny;
    pts.push({ x, y });
    if (Math.abs(y) > limit) break;
  }
  return pts;
}

/** Horizontal lines y = c in [y0, y1] where dy/dx = 0 for every x in [x0, x1]. */
export function equilibria(f: (x: number, y: number) => number, x0: number, x1: number, y0: number, y1: number): number[] {
  const xs = Array.from({ length: 13 }, (_, i) => x0 + ((x1 - x0) * (i + 0.37)) / 13);
  const cands = new Set<number>();
  for (const x of xs.slice(0, 5)) for (const c of zeros((y) => f(x, y), y0, y1, 600)) cands.add(snap(c));
  const out: number[] = [];
  for (const c of cands) {
    const vals = xs.map((x) => f(x, c));
    const scale = Math.max(1, ...xs.map((x) => Math.abs(f(x, c + (y1 - y0) * 0.1))));
    if (vals.every((v) => Number.isFinite(v) && Math.abs(v) < 1e-6 * scale) && !out.some((o) => Math.abs(o - c) < (y1 - y0) * 1e-3)) out.push(c);
  }
  return out.sort((a, b) => a - b);
}

const PARTS = [
  { id: "slope-segment", name: "Slope segment" },
  { id: "solution-curve", name: "Particular solution" },
  { id: "initial-condition", name: "Initial condition" },
  { id: "equilibrium", name: "Equilibrium solution" },
];

export const slopeField: FigureComponent = {
  name: "slopeField",
  title: "A slope field for dy/dx = f(x, y): the direction field of a differential equation, a segment of the computed slope at each grid point, equilibrium solutions dashed, and the particular solution through an initial condition traced by Runge–Kutta",
  params: `dydx (dy/dx in x and y, e.g. "y", "x - y", "x*y", "y*(2 - y)", "-x/y"; default "x - y"); xmin, xmax, ymin, ymax (window, default -3..3 each); x0, y0 (the initial condition the particular solution passes through; default 0, 1); solution (true default: draw the particular solution; false: the field alone); equilibrium (true default: draw y = c where dy/dx is 0 for all x, when there is one). Slopes, equilibria and the solution are all computed — never give values.`,
  match: /\bslope fields?\b|\bdirection fields?\b|\bdifferential equations?\b.*\b(sketch|graph|field|solution curves?)\b|\bdy\s*\/\s*dx\s*=.*\b(field|sketch)\b|\bequilibrium solutions?\b|\bparticular solution\b.*\bslope\b/i,
  parts: PARTS,
  build(params: FigureParams) {
    const src = str(params.dydx ?? params.f, "x - y", 200);
    const parsed = fn2(src);
    const f = parsed ?? ((x: number, y: number) => x - y);
    const shown = parsed ? src : "x - y";
    const win = windowFrom(params, { x0: -3, x1: 3, y0: -3, y1: 3 });
    const xr = win.x1 - win.x0, yr = win.y1 - win.y0;
    // Equal units on both axes where the window allows, so a slope of 1 looks like 45°.
    const W = 420;
    const H = Math.max(240, Math.min(400, (W * yr) / xr));
    const P = makePlot(win, W, H);
    const kx = W / xr, ky = H / yr;
    const sk = new Sketch();
    const { axY } = drawAxes(sk, P, { grid: false });
    const fieldAt = sk.ops.length;

    // The field: a grid of short segments, each centred on its point.
    const stepX = niceStep(xr, 12), stepY = niceStep(yr, Math.max(6, Math.round((12 * H) / W)));
    const half = 0.36 * Math.min(stepX * kx, stepY * ky);
    const segs: Array<{ c: Pt; p: Pt; q: Pt }> = [];
    for (let gx = Math.ceil(win.x0 / stepX) * stepX; gx <= win.x1 + 1e-9; gx += stepX) {
      for (let gy = Math.ceil(win.y0 / stepY) * stepY; gy <= win.y1 + 1e-9; gy += stepY) {
        const x = snap(gx), y = snap(gy);
        const m = f(x, y);
        const c = P.S(x, y);
        if (c.x < 4 || c.x > W - 4 || c.y < 4 || c.y > H - 4) continue;
        let d: Pt;
        if (Number.isFinite(m)) {
          const v = { x: kx, y: -m * ky };
          const l = Math.hypot(v.x, v.y);
          d = { x: v.x / l, y: v.y / l };
        } else {
          // Undefined slope (e.g. -x/y on y = 0): vertical when the slope grows without bound beside it.
          const near = f(x, y + stepY * 1e-3);
          if (!Number.isFinite(near) || Math.abs(near) < 1e3) continue;
          d = { x: 0, y: 1 };
        }
        const p = { x: c.x - d.x * half, y: c.y - d.y * half }, q = { x: c.x + d.x * half, y: c.y + d.y * half };
        segs.push({ c, p, q });
      }
    }

    // Equilibrium solutions: dashed green lines, value at the right end.
    const eq = bool(params.equilibrium, true) ? equilibria(f, win.x0, win.x1, win.y0, win.y1).slice(0, 4) : [];
    for (const c of eq) {
      const y = P.Y(c);
      sk.line([{ x: 0, y }, { x: W, y }], { stroke: PALETTE.green, width: 2.6, dash: "9 6", part: "equilibrium" });
      sk.placeText(`y = ${fmt(c, 3)}`, 17, { x: W * 0.14, y }, { x: 0, y: -1 }, { min: 11, max: 40, fill: PALETTE.green, part: "equilibrium" });
    }

    // The particular solution through (x0, y0), forwards and backwards.
    const showSol = bool(params.solution, true);
    const x0 = Math.min(win.x1, Math.max(win.x0, optNum(params.x0) ?? 0));
    const y0 = Math.min(win.y1, Math.max(win.y0, optNum(params.y0) ?? 1));
    let solPts: Pt[] = [];
    if (showSol && Number.isFinite(f(x0, y0))) {
      const lim = Math.max(Math.abs(win.y0), Math.abs(win.y1)) + 3 * yr;
      const fwd = rk4(f, x0, y0, win.x1, 600, lim), back = rk4(f, x0, y0, win.x0, 600, lim);
      const data = [...back.reverse(), ...fwd.slice(1)];
      const polylines = clipPolyline(P, data);
      for (const l of polylines) sk.line(l, { stroke: PALETTE.red, width: 3, part: "solution-curve" });
      solPts = polylines.flat();
      const ic = P.S(x0, y0);
      sk.circle(ic, 6, { fill: PALETTE.red, stroke: "ink", width: 1.6, part: "initial-condition" }, false);
      sk.placeText(coordText(x0, y0), 18, ic, { x: -0.8, y: -0.6 }, { min: 14, max: 70, fill: PALETTE.red, part: "initial-condition" });
    }
    const label = `dy/dx = ${prettyExpr(shown)}`;
    sk.text({ x: W / 2, y: -44 }, label.length <= 40 ? label : "dy/dx = f(x, y)", 20, "ink");

    // The field goes under everything else; a segment that would run through written text is left out.
    const texts = sk.textBoxes();
    const field = new Sketch();
    const kept = segs.filter(({ p, q }) => !texts.some((t) => segHitsBox(p, q, { x: t.x - 6, y: t.y - 4, w: t.w + 12, h: t.h + 8 })));
    for (const { p, q } of kept) field.line([p, q], { stroke: "ink", width: 1.7, opacity: 0.75, part: "slope-segment" }, false);
    sk.ops.splice(fieldAt, 0, ...field.ops);
    segs.length = 0;
    segs.push(...kept);

    // Anchors: a segment well away from the solution and the equilibria; the curve where it is clear.
    if (segs.length) {
      const far = (c: Pt) => Math.min(80, ...solPts.map((p) => dist(p, c)), ...eq.map((e) => Math.abs(P.Y(e) - c.y)), Math.abs(c.y - axY) + 20);
      const edge = (c: Pt) => Math.min(c.x, W - c.x);
      const best = segs.reduce((b, s) => (far(s.c) * 2 - edge(s.c) * 0.4 > far(b.c) * 2 - edge(b.c) * 0.4 ? s : b));
      sk.part("slope-segment", `Slope segment`, best.c);
    }
    if (solPts.length > 1) {
      const ic = P.S(x0, y0);
      const cands = [0.8, 0.2, 0.7, 0.3, 0.9, 0.1, 0.6, 0.4].map((t) => solPts[Math.floor(t * (solPts.length - 1))]).filter((p) => dist(p, ic) > 40 && eq.every((e) => Math.abs(P.Y(e) - p.y) > 16));
      sk.part("solution-curve", "Particular solution", sk.clearAnchor(cands.length ? cands : [solPts[0]]));
      sk.part("initial-condition", `Initial condition ${coordText(x0, y0)}`, ic);
    }
    if (eq.length) {
      const c = eq.find((e) => Math.abs(P.Y(e) - axY) > 4) ?? eq[0];
      sk.part("equilibrium", `Equilibrium solution y = ${fmt(c, 3)}`, { x: W * 0.88, y: P.Y(c) });
    }
    return sk.finish(12);
  },
};

/** Data points → screen polylines inside the window (cut where the curve leaves it). */
function clipPolyline(P: Plot, data: Pt[]): Pt[][] {
  const lines: Pt[][] = [];
  let cur: Pt[] = [];
  const inside = (p: Pt) => p.y >= P.y0 && p.y <= P.y1 && p.x >= P.x0 - 1e-9 && p.x <= P.x1 + 1e-9;
  for (let i = 0; i < data.length; i++) {
    const p = data[i];
    if (inside(p)) {
      if (!cur.length && i > 0) cur.push(P.S(...edgePoint(P, data[i - 1], p)));
      cur.push(P.S(p.x, p.y));
    } else if (cur.length) {
      cur.push(P.S(...edgePoint(P, data[i - 1], p)));
      lines.push(cur);
      cur = [];
    }
  }
  if (cur.length > 1) lines.push(cur);
  return lines.filter((l) => l.length > 1);
}
function edgePoint(P: Plot, a: Pt, b: Pt): [number, number] {
  const yc = Math.max(P.y0, Math.min(P.y1, b.y));
  const t = b.y === a.y ? 0 : (yc - a.y) / (b.y - a.y);
  const tt = Math.max(0, Math.min(1, t));
  return [a.x + (b.x - a.x) * tt, a.y + (b.y - a.y) * tt];
}

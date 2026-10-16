import { test } from "node:test";
import assert from "node:assert/strict";
import { heart } from "../figures/components/heart";
import type { FigureDrawing, FigureParams, FigureShape, Pt } from "../figures/types";

/**
 * The code-drawn heart must be a textbook heart (a student board showed four floating blobs, the
 * colours reversed and no aorta, 2026-10-16): every label's dot on its own part, the right side blue
 * and the left red, each great vessel joined to its own chamber, and the left ventricle's wall
 * thicker than the right's.
 */

type Path = Extract<FigureShape, { t: "path" }>;

/** The path's subpaths as polylines (absolute M/L/H/V/C/Q/Z, which is all the kit writes). */
function flatten(d: string): Pt[][] {
  const tokens = d.match(/[MLHVCQZ]|-?\d*\.?\d+(?:e-?\d+)?/gi) ?? [];
  const subs: Pt[][] = [];
  let cur: Pt[] = [];
  let at: Pt = { x: 0, y: 0 };
  let cmd = "M";
  let i = 0;
  const n = () => Number(tokens[i++]);
  while (i < tokens.length) {
    if (/^[A-Za-z]$/.test(tokens[i])) cmd = tokens[i++].toUpperCase();
    if (cmd === "Z") { if (cur.length) subs.push(cur); cur = []; continue; }
    if (cmd === "M") { if (cur.length) subs.push(cur); at = { x: n(), y: n() }; cur = [at]; cmd = "L"; continue; }
    if (cmd === "L") { at = { x: n(), y: n() }; cur.push(at); continue; }
    if (cmd === "H") { at = { x: n(), y: at.y }; cur.push(at); continue; }
    if (cmd === "V") { at = { x: at.x, y: n() }; cur.push(at); continue; }
    if (cmd === "C") {
      const p0 = at, c1 = { x: n(), y: n() }, c2 = { x: n(), y: n() }, p3 = { x: n(), y: n() };
      for (let k = 1; k <= 12; k++) {
        const t = k / 12, u = 1 - t;
        cur.push({ x: u * u * u * p0.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * p3.x, y: u * u * u * p0.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * p3.y });
      }
      at = p3;
      continue;
    }
    if (cmd === "Q") {
      const p0 = at, c = { x: n(), y: n() }, p2 = { x: n(), y: n() };
      for (let k = 1; k <= 12; k++) {
        const t = k / 12, u = 1 - t;
        cur.push({ x: u * u * p0.x + 2 * u * t * c.x + t * t * p2.x, y: u * u * p0.y + 2 * u * t * c.y + t * t * p2.y });
      }
      at = p2;
      continue;
    }
    throw new Error(`unexpected path command ${cmd} in ${d.slice(0, 40)}`);
  }
  if (cur.length) subs.push(cur);
  return subs;
}

function inside(p: Pt, subs: Pt[][]): boolean {
  let hit = false;
  for (const poly of subs) {
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const a = poly[i], b = poly[j];
      if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) hit = !hit;
    }
  }
  return hit;
}

function distToPolyline(p: Pt, pts: Pt[]): number {
  let best = Infinity;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    const dx = b.x - a.x, dy = b.y - a.y, L = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / L));
    best = Math.min(best, Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy)));
  }
  return best;
}

/** Does this shape cover the point (its fill, or its stroke for an open line)? */
function covers(sh: FigureShape, p: Pt): boolean {
  if (sh.t === "circle") return Math.hypot(p.x - sh.cx, p.y - sh.cy) <= sh.r;
  if (sh.t !== "path") return false;
  const subs = flatten(sh.d);
  if (sh.fill && sh.fill !== "none" && inside(p, subs)) return true;
  return Boolean(sh.stroke && sh.stroke !== "none") && subs.some((s) => distToPolyline(p, s) <= (sh.width ?? 1) / 2 + 1.5);
}

const shapesOf = (fig: FigureDrawing, part: string) => fig.shapes.filter((s): s is Path => s.t === "path" && s.part === part);
const outline = (fig: FigureDrawing, part: string) => flatten(shapesOf(fig, part)[0].d);
const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

test("heart: every part's dot sits on that part, uppermost where it is drawn", () => {
  for (const params of [{}, { arrows: true }, { side: "left" }, { side: "right", arrows: true }] as FigureParams[]) {
    const fig = heart.build(params);
    for (const part of fig.parts) {
      const top = [...fig.shapes].reverse().find((sh) => covers(sh, part.anchor));
      assert.ok(top, `${part.id} anchor covers nothing (${JSON.stringify(params)})`);
      // An outline-free patch that opens a vessel into its chamber is the same lumen, the same colour.
      const own = shapesOf(fig, part.id)[0] ?? fig.shapes.find((s) => s.part === part.id);
      const sameLumen = !top!.part && top!.fill === own?.fill && (top!.stroke ?? "none") === "none";
      assert.ok(top!.part === part.id || sameLumen, `${part.id} anchor is covered by ${top!.part ?? "unlabelled art"} (${JSON.stringify(params)})`);
    }
  }
});

test("heart: the right side and its vessels are blue (deoxygenated), the left side and its vessels red", () => {
  const fig = heart.build({});
  const blue = ["right-atrium", "right-ventricle", "vena-cava", "inferior-vena-cava", "pulmonary-artery"];
  const red = ["left-atrium", "left-ventricle", "aorta", "pulmonary-vein"];
  for (const id of blue) for (const sh of shapesOf(fig, id)) {
    const [r, , b] = rgb(String(sh.fill));
    assert.ok(b > r + 60, `${id} is blue (${sh.fill})`);
  }
  for (const id of red) for (const sh of shapesOf(fig, id)) {
    const [r, , b] = rgb(String(sh.fill));
    assert.ok(r > b + 60, `${id} is red (${sh.fill})`);
  }
  // Drawn as the student sees it: the heart's right side on the student's left.
  const cx = (id: string) => { const pts = outline(fig, id).flat(); return pts.reduce((s, p) => s + p.x, 0) / pts.length; };
  assert.ok(cx("right-atrium") < cx("left-atrium") && cx("right-ventricle") < cx("left-ventricle"));
});

test("heart: each great vessel joins its own chamber and not the other side's", () => {
  const fig = heart.build({});
  const joins = (vessel: string, chamber: string) => shapesOf(fig, vessel).some((sh) => flatten(sh.d).flat().some((p) => inside(p, outline(fig, chamber))));
  assert.ok(joins("aorta", "left-ventricle"), "aorta leaves the left ventricle");
  assert.ok(!joins("aorta", "right-ventricle"), "aorta does not touch the right ventricle");
  assert.ok(joins("pulmonary-artery", "right-ventricle"), "pulmonary artery leaves the right ventricle");
  assert.ok(!joins("pulmonary-artery", "left-ventricle"));
  assert.ok(joins("vena-cava", "right-atrium"), "vena cava enters the right atrium");
  assert.ok(joins("inferior-vena-cava", "right-atrium"), "inferior vena cava enters the right atrium");
  assert.ok(!joins("vena-cava", "left-atrium"));
  assert.ok(joins("pulmonary-vein", "left-atrium"), "pulmonary veins enter the left atrium");
  assert.ok(!joins("pulmonary-vein", "right-atrium"));
  // The chambers are inside one muscular wall (one organ, not four blobs).
  const wall = outline(fig, "muscular-wall");
  for (const id of ["right-atrium", "right-ventricle", "left-atrium", "left-ventricle", "septum"]) {
    assert.ok(outline(fig, id).flat().every((p) => inside(p, wall) || distToPolyline(p, wall.flat()) < 2), `${id} inside the heart wall`);
  }
});

test("heart: the left ventricle's wall is thicker than the right ventricle's", () => {
  const fig = heart.build({});
  const crossings = (subs: Pt[][], y: number) => {
    const xs: number[] = [];
    for (const poly of subs) for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const a = poly[i], b = poly[j];
      if (a.y > y !== b.y > y) xs.push(a.x + ((y - a.y) * (b.x - a.x)) / (b.y - a.y));
    }
    return xs.sort((a, b) => a - b);
  };
  for (const y of [290, 310, 330]) {
    const wall = crossings(outline(fig, "muscular-wall"), y);
    const rv = crossings(outline(fig, "right-ventricle"), y), lv = crossings(outline(fig, "left-ventricle"), y);
    const rightWall = rv[0] - wall[0];
    const leftWall = wall[wall.length - 1] - lv[lv.length - 1];
    assert.ok(rightWall > 6, `right wall drawn at y=${y}`);
    assert.ok(leftWall > rightWall * 1.8, `left wall ${leftWall.toFixed(1)} vs right ${rightWall.toFixed(1)} at y=${y}`);
  }
});

test("heart: valves, tendons and the coronary artery are drawn; odd params never throw", () => {
  const fig = heart.build({});
  for (const id of ["tricuspid", "bicuspid", "semilunar", "aortic-valve", "chordae-tendineae", "coronary-artery", "septum"]) {
    assert.ok(fig.shapes.some((s) => s.part === id), `${id} drawn`);
  }
  assert.equal(heart.build({ coronary: false }).parts.some((p) => p.id === "coronary-artery"), false);
  assert.ok(!heart.build({ coronary: false }).shapes.some((s) => s.part === "coronary-artery"));
  for (const params of [{ side: 7 }, { highlight: "nonsense" }, { arrows: "maybe" }, { side: "LEFT side", highlight: "Left ventricle" }, null as never] as FigureParams[]) {
    const f = heart.build(params);
    assert.ok(f.w >= 560 && f.w <= 760 && f.h >= 260 && f.h <= 460);
    for (const sh of f.shapes) if (sh.t === "path") assert.ok(!/NaN|Infinity|undefined/.test(sh.d));
  }
  // The faded side is washed out but stays opaque (hidden vessel ends must not show through).
  const faded = heart.build({ side: "right" });
  const la = shapesOf(faded, "left-atrium")[0];
  assert.equal(la.opacity, undefined);
  assert.ok(rgb(String(la.fill)).reduce((a, b) => a + b) > rgb(String(shapesOf(fig, "left-atrium")[0].fill)).reduce((a, b) => a + b));
  // A highlighted part is outlined in amber.
  assert.ok(shapesOf(heart.build({ highlight: "aorta" }), "aorta").every((s) => s.stroke === "#d97706"));
});

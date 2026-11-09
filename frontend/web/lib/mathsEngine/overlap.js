// A geometry check the structural linter cannot make: filled pieces of a figure (the triangles round a
// square, the parts of a composite shape) must not cover each other, unless one sits wholly inside
// another (a shaded part of a shape). Two pieces that overlap mean their corners were written wrong.
// Only polygons whose corners can be worked out here (numbers, params, values, points given by "at").
import { compile } from "./expr.js";

function scope(spec) {
  const vars = {};
  for (const [k, v] of Object.entries(spec.params ?? {})) if (typeof v === "number") vars[k] = v;
  for (const [k, v] of Object.entries(spec.values ?? {})) {
    try {
      const x = compile(String(v))({ vars });
      if (Number.isFinite(x)) vars[k] = x;
    } catch {
      // A value that needs the board (X(A), slope…) is left out.
    }
  }
  return vars;
}

const num = (v, vars) => (typeof v === "number" ? v : compile(String(v))({ vars }));

function corners(obj, points, vars) {
  try {
    const out = obj.points.map((p) => (typeof p === "string" ? points.get(p) : [num(p[0], vars), num(p[1], vars)]));
    return out.every((p) => p && Number.isFinite(p[0]) && Number.isFinite(p[1])) ? out : null;
  } catch {
    return null;
  }
}

const area = (P) => Math.abs(P.reduce((s, p, i) => { const q = P[(i + 1) % P.length]; return s + p[0] * q[1] - q[0] * p[1]; }, 0)) / 2;
const orient = (P) => Math.sign(P.reduce((s, p, i) => { const q = P[(i + 1) % P.length]; return s + p[0] * q[1] - q[0] * p[1]; }, 0)) || 1;

/** The part of P inside convex Q (Sutherland–Hodgman). */
function clip(P, Q) {
  let out = P;
  const o = orient(Q);
  for (let i = 0; i < Q.length && out.length; i++) {
    const a = Q[i], b = Q[(i + 1) % Q.length];
    const side = (p) => o * ((b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]));
    const next = [];
    for (let j = 0; j < out.length; j++) {
      const p = out[j], q = out[(j + 1) % out.length], sp = side(p), sq = side(q);
      if (sp >= 0) next.push(p);
      if ((sp >= 0) !== (sq >= 0)) { const t = sp / (sp - sq); next.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]); }
    }
    out = next;
  }
  return out;
}

const inside = (p, P) => {
  let hit = false;
  for (let i = 0, j = P.length - 1; i < P.length; j = i++) {
    const [xi, yi] = P[i], [xj, yj] = P[j];
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
};

/**
 * A shape's own label is written in its middle. When a smaller filled shape covers that middle (the big
 * square of a proof round its tilted square), the label reads as the smaller shape's: it must go on a side
 * or beside the shape instead.
 */
export function coveredLabels(spec) {
  const { polys } = filledPolygons(spec, true);
  const problems = [];
  for (const a of polys) {
    if (typeof a.label !== "string" || !a.label.trim()) continue;
    const c = a.P.reduce((m, p) => [m[0] + p[0] / a.P.length, m[1] + p[1] / a.P.length], [0, 0]);
    const cover = polys.find((b) => b !== a && b.filled && area(b.P) < area(a.P) && inside(c, b.P));
    if (cover) problems.push(`object ${a.id}'s label "${a.label}" would be written in its middle, which ${cover.id} covers, so it would read as ${cover.id}'s: label ${a.id} on one of its sides (a segment's label) or with a text object beside it, and drop its own label`);
  }
  return problems;
}

function filledPolygons(spec, all = false) {
  const vars = scope(spec);
  const points = new Map();
  for (const o of spec.objects ?? []) {
    if (o.type === "point" && Array.isArray(o.at)) {
      try {
        const p = [num(o.at[0], vars), num(o.at[1], vars)];
        if (p.every(Number.isFinite)) points.set(o.id, p);
      } catch {
        // Not a plain point.
      }
    }
  }
  const polys = (spec.objects ?? []).filter((o) => o.type === "polygon" && Array.isArray(o.points) && (all || (o.fill && o.fill !== "none" && (o.fillOpacity ?? 1) > 0)))
    .map((o) => ({ id: o.id, label: o.label, filled: Boolean(o.fill && o.fill !== "none" && (o.fillOpacity ?? 1) > 0), P: corners(o, points, vars) }))
    .filter((x) => x.P && x.P.length >= 3 && area(x.P) > 1e-9);
  return { polys };
}

export function overlappingFills(spec) {
  const vars = scope(spec);
  const points = new Map();
  for (const o of spec.objects ?? []) {
    if (o.type === "point" && Array.isArray(o.at)) {
      try {
        const p = [num(o.at[0], vars), num(o.at[1], vars)];
        if (p.every(Number.isFinite)) points.set(o.id, p);
      } catch {
        // Not a plain point.
      }
    }
  }
  const filled = (spec.objects ?? []).filter((o) => o.type === "polygon" && Array.isArray(o.points) && o.fill && o.fill !== "none" && (o.fillOpacity ?? 1) > 0)
    .map((o) => ({ id: o.id, P: corners(o, points, vars) }))
    .filter((x) => x.P && x.P.length >= 3 && area(x.P) > 1e-9);
  const problems = [];
  for (let i = 0; i < filled.length; i++) for (let j = i + 1; j < filled.length; j++) {
    const a = filled[i], b = filled[j];
    const common = clip(a.P, b.P);
    const shared = common.length >= 3 ? area(common) : 0;
    const smaller = Math.min(area(a.P), area(b.P));
    if (shared > 0.02 * smaller && shared < 0.98 * smaller) problems.push(`objects ${a.id} and ${b.id} are filled pieces that overlap (${Math.round((100 * shared) / smaller)}% of the smaller): check their corners — pieces that fit together share edges, never area`);
  }
  return problems;
}

/**
 * An angle marked at a vertex needs both of its arms on the board: "∠ACB" drawn as an arc at C with no
 * lines CA and CB marks an angle that is not there. An arm is a segment, line, ray or vector through the
 * two points, or a side of a polygon. Only angles given by named points are checked.
 */
export function armlessAngles(spec) {
  const objs = spec.objects ?? [];
  const pts = new Set(objs.filter((o) => o.type === "point").map((o) => o.id));
  // A point that only gives an arm its direction is hidden: that arm is drawn some other way (a vector, a slope).
  const hidden = new Set(objs.filter((o) => o.type === "point" && o.hidden).map((o) => o.id));
  // A point placed on a polygon's corner ("at": "T.2") is that corner: the polygon's sides join it to its neighbours.
  const corner = new Map(objs.filter((o) => o.type === "point" && typeof o.at === "string" && /^[A-Za-z]\w*\.\d+$/.test(o.at)).map((o) => [o.id, o.at]));
  const edges = new Set();
  const join = (a, b) => { if (typeof a === "string" && typeof b === "string") { edges.add(`${a}|${b}`); edges.add(`${b}|${a}`); } };
  const lines = [];
  for (const o of objs) {
    if (["segment", "line", "ray", "vector"].includes(o.type)) {
      join(o.from, o.to);
      if (o.type !== "segment" && o.type !== "vector") lines.push([o.from, o.to]);
      if (Array.isArray(o.through)) lines.push(o.through);
    }
    if (o.type === "polygon" && Array.isArray(o.points)) {
      o.points.forEach((p, i) => join(p, o.points[(i + 1) % o.points.length]));
      const n = o.points.length;
      for (let i = 1; i <= n; i++) join(`${o.id}.${i}`, `${o.id}.${(i % n) + 1}`);
    }
    if (o.type === "circle" && typeof o.center === "string" && typeof o.through === "string") join(o.center, o.through);
  }
  // A point on a drawn line through the vertex counts too (a diameter through the centre and an end).
  const onLine = (v, p) => lines.some((l) => l.includes(v) && l.includes(p));
  const problems = [];
  for (const o of objs) {
    if (o.type !== "angle" || !Array.isArray(o.points) || o.points.length !== 3 || !o.points.every((p) => typeof p === "string" && pts.has(p))) continue;
    const [p, v, q] = o.points;
    const as = (x) => corner.get(x) ?? x;
    const missing = [p, q].filter((x) => !hidden.has(x) && !edges.has(`${v}|${x}`) && !edges.has(`${as(v)}|${as(x)}`) && !onLine(v, x));
    if (missing.length) problems.push(`object ${o.id} marks the angle ${p}${v}${q}, but its arm${missing.length > 1 ? "s" : ""} ${missing.map((x) => `${v}${x}`).join(" and ")} ${missing.length > 1 ? "are" : "is"} not drawn: add the segment${missing.length > 1 ? "s" : ""} (or mark the angle the board really shows)`);
  }
  return problems;
}


/**
 * A table as it was meant: `header: { cols: true }` (the model's shorthand for "my first row is the header",
 * which crashed the table), and a header repeated as the first row, which was written twice.
 */
export function normalizeTable(d) {
  const head = d.header;
  if (!head || !Array.isArray(d.rows) || !d.rows.length) return d;
  let rows = d.rows;
  const header = { ...head };
  if (header.cols === true) { header.cols = rows[0].map(String); rows = rows.slice(1); }
  else if (!Array.isArray(header.cols)) delete header.cols;
  else if (rows[0].map(String).join("|") === header.cols.map(String).join("|")) rows = rows.slice(1);
  if (header.rows === true) { header.rows = rows.map((r) => String(r[0])); rows = rows.map((r) => r.slice(1)); }
  else if (!Array.isArray(header.rows)) delete header.rows;
  return { ...d, header, rows };
}

/** "A      B      C" or "0   2   4": short labels spaced apart by hand. A readout ("θ = 30°    sin θ = 0.5") is fine. */
const gluedLabels = (text) => {
  const bits = text.trim().split(/ {2,}/);
  return bits.length >= 2 && bits.every((b) => b.length <= 12 && !/[={≈]/.test(b));
};
const onlySymbol = (t) => t.length <= 4 && !/[\p{L}\p{N}]/u.test(t);

/** The size a board's drawing area gives one unit, about: a little under the width beside the text column. */
function unitPx(spec) {
  const b = spec.board ?? {};
  if (!b.x || !b.y) return 40;
  return Math.min(500 / (b.x[1] - b.x[0]), 410 / (b.y[1] - b.y[0]));
}

/**
 * Charts built the wrong way, and writing on writing. The engine has real bars, tables, pies and
 * pictograms that compute and place everything; scenes that drew them by hand from rectangles and
 * strings ("A        B        C") were the worst boards in the first audit of real maths courses (2026-11-09).
 */
export function chartProblems(spec) {
  const out = [];
  const vars = scope(spec);
  const objects = spec.objects ?? [];
  const texts = objects.filter((o) => o.type === "text" && typeof o.text === "string");
  for (const t of texts) if (gluedLabels(t.text)) out.push(`text "${t.text.trim().slice(0, 30)}" packs several labels into one string with spaces: give each thing its own label (a chart's categories and scale come from "bars" or the axes)`);
  const has = (type) => objects.some((o) => o.type === type);
  const rects = objects.filter((o) => o.type === "polygon" && Array.isArray(o.points) && o.points.length === 4).map((o) => corners(o, new Map(), vars)).filter(Boolean).filter((P) => new Set(P.map((p) => p[0])).size === 2 && new Set(P.map((p) => p[1])).size === 2);
  // Three or more of one width and different heights: two rectangles side by side are usually an area model.
  const floors = new Map();
  for (const P of rects) { const y = Math.min(...P.map((p) => p[1])); floors.set(y, [...(floors.get(y) ?? []), P]); }
  const span = (P, k) => Math.round((Math.max(...P.map((p) => p[k])) - Math.min(...P.map((p) => p[k]))) * 100);
  const isChart = (group) => group.length >= 3 && new Set(group.map((P) => span(P, 0))).size === 1 && new Set(group.map((P) => span(P, 1))).size >= 2;
  if (!has("bars") && !has("histogram") && [...floors.values()].some(isChart)) out.push('rectangles on one baseline are a bar chart: use type "bars" (categories, values) so the bars, axis and labels are computed');
  if (!has("pictogram") && texts.filter((t) => onlySymbol(t.text.trim())).length >= 3) out.push('rows of symbols are a pictogram: use type "pictogram" (categories, values, unit, symbol, key)');
  for (const o of objects) {
    if (o.type !== "pictogram" || !Array.isArray(o.values)) continue;
    const unit = Number(o.unit ?? 1);
    const whole = o.symbol && o.symbol !== "●";
    for (const v of o.values) if (typeof v === "number" && !Number.isInteger((v / unit) * (whole ? 1 : 2))) out.push(`pictogram ${o.id}: ${v} is not a ${whole ? "whole" : "whole or half"} number of symbols of ${unit}: choose a unit that fits`);
  }
  const leaves = objects.filter((o) => o.type === "stemleaf");
  for (let i = 0; i < leaves.length; i++) for (let j = i + 1; j < leaves.length; j++) if (JSON.stringify(leaves[i].data) === JSON.stringify(leaves[j].data) && (leaves[i].ordered === false) === (leaves[j].ordered === false)) out.push(`stemleaf ${leaves[i].id} and ${leaves[j].id} show the same thing: to show unsorted data give the first "ordered": false`);
  // Writing placed on writing, at the size the board will draw it.
  const u = unitPx(spec);
  const boxes = texts.filter((t) => Array.isArray(t.at) && t.at.every((v) => typeof v === "number")).map((t) => {
    const size = t.size ?? 24, hw = (t.text.length * 0.5 * size) / 2 / u, hh = (size * 0.6) / u;
    return { t, x0: t.at[0] - hw, x1: t.at[0] + hw, y0: t.at[1] - hh, y1: t.at[1] + hh };
  });
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
    const a = boxes[i], b = boxes[j];
    const w = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0), h = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
    if (w > 0 && h > 0 && (w * h) / Math.min((a.x1 - a.x0) * (a.y1 - a.y0), (b.x1 - b.x0) * (b.y1 - b.y0)) > 0.2) out.push(`text "${a.t.text.slice(0, 24)}" and text "${b.t.text.slice(0, 24)}" would sit on each other at this size: move one or shorten it`);
  }
  // A table beside a chart, measured the way the table will be drawn: columns widen to hold their longest entry.
  const tableBox = (o) => {
    if (!Array.isArray(o.at) || !o.at.every((v) => typeof v === "number") || !Array.isArray(o.rows)) return null;
    const t = normalizeTable(o), cell = Array.isArray(t.cell) ? t.cell : [1, 1];
    const all = [...(t.header?.cols ? [t.header.cols] : []), ...t.rows];
    const cols = Math.max(...all.map((r) => r.length));
    let w = 0;
    for (let c = 0; c < cols; c++) w += Math.max(Number(cell[0]) || 1, ...all.map((r) => (String(r[c] ?? "").length * 0.56 * (t.textSize ?? 24) + 14) / u));
    return { x0: o.at[0], x1: o.at[0] + w, y0: o.at[1] - all.length * (Number(cell[1]) || 1), y1: o.at[1] };
  };
  const barsBox = (o) => {
    const v = Array.isArray(o.values) ? o.values.filter((n) => typeof n === "number") : [];
    const x = Array.isArray(o.x) ? o.x.filter((n) => typeof n === "number") : Array.isArray(o.categories) ? o.categories.map((_, i) => i) : [];
    if (!v.length || !x.length) return null;
    const hw = (typeof o.width === "number" ? o.width : 0.7) / 2;
    return { x0: Math.min(...x) - hw, x1: Math.max(...x) + hw, y0: 0, y1: Math.max(...v) };
  };
  const pieBox = (o) => {
    const c = o.center ?? o.at ?? [0, 0], r = o.radius ?? 3;
    return Array.isArray(c) && c.every((v) => typeof v === "number") && typeof r === "number" ? { x0: c[0] - r, x1: c[0] + r, y0: c[1] - r, y1: c[1] + r } : null;
  };
  const charts = [...objects.filter((o) => o.type === "bars").map((o) => [o, barsBox(o)]), ...objects.filter((o) => o.type === "pie").map((o) => [o, pieBox(o)])].filter(([, b]) => b);
  for (const table of objects.filter((o) => o.type === "table")) {
    const a = tableBox(table);
    if (!a) continue;
    for (const [c, b] of charts) if (a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1) out.push(`table ${table.id} and ${c.type} ${c.id} would sit on each other (the table's columns widen to hold their entries): move the table clear of it`);
  }
  for (const o of objects.filter((x) => x.type === "pie")) {
    const c = o.center ?? o.at ?? [0, 0];
    if (!Array.isArray(c) || !c.every((v) => typeof v === "number") || typeof (o.radius ?? 3) !== "number") continue;
    const r = o.radius ?? 3;
    for (const a of boxes) {
      const dx = Math.max(a.x0 - c[0], 0, c[0] - a.x1), dy = Math.max(a.y0 - c[1], 0, c[1] - a.y1);
      if (dx * dx + dy * dy < r * r) out.push(`text "${a.t.text.slice(0, 24)}" sits on pie ${o.id}: move it clear of the circle`);
    }
  }
  return out;
}

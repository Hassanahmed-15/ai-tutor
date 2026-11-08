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

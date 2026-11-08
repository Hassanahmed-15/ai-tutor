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

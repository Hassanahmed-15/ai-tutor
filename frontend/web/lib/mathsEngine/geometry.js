// Exact or numerically solved geometry for the scene engine. Every position on a board comes from
// here or from an expression: nothing is placed by eye.

export const EPS = 1e-9;

/** Numeric derivative (central difference), accurate to ~1e-8 for smooth school functions. */
export function slope(f, x) {
  const h = 1e-5 * Math.max(1, Math.abs(x));
  return (f(x + h) - f(x - h)) / (2 * h);
}

/** Composite Simpson's rule; 400 panels is far below any rounding a student sees. */
export function integral(f, a, b, n = 400) {
  if (a === b) return 0;
  const h = (b - a) / n;
  let s = f(a) + f(b);
  for (let i = 1; i < n; i++) s += f(a + i * h) * (i % 2 ? 4 : 2);
  return (s * h) / 3;
}

/** A root of f near x0: scan outward for a sign change, then bisect; Newton polish. */
export function rootNear(f, x0, span = 4, depth = 0) {
  const step = span / 400;
  let best = null;
  for (let k = 0; k <= 400 && best === null; k++) {
    for (const dir of [1, -1]) {
      const a = x0 + dir * k * step, b = x0 + dir * (k + 1) * step;
      const fa = f(a), fb = f(b);
      if (!Number.isFinite(fa) || !Number.isFinite(fb)) continue;
      if (Math.abs(fa) < EPS) { best = a; break; }
      if (fa * fb < 0) {
        let lo = a, hi = b;
        for (let it = 0; it < 80; it++) {
          const mid = (lo + hi) / 2;
          if (f(lo) * f(mid) <= 0) hi = mid;
          else lo = mid;
        }
        best = (lo + hi) / 2;
        break;
      }
    }
  }
  if (best === null) {
    // A double root (touching the axis): fall back to the turning point of f, if f is ~0 there.
    if (depth > 0) return NaN;
    const t = rootNear((x) => slope(f, x), x0, span, depth + 1);
    if (Number.isFinite(t) && Math.abs(f(t)) < 1e-6) return t;
    return NaN;
  }
  // Snap to a whole or simple fraction when the solver lands within rounding of it.
  return tidy(best);
}

/** Stationary point of f near x0 (root of the derivative). */
export function turningNear(f, x0, span = 4) {
  return rootNear((x) => slope(f, x), x0, span);
}

/** Within 1e-9 of a value with ≤3 decimals? Use that value (stops "1.9999999998" in labels). */
export function tidy(v) {
  const r = Math.round(v * 1000) / 1000;
  return Math.abs(r - v) < 1e-7 ? r : v;
}

export const dist = (p, q) => Math.hypot(q[0] - p[0], q[1] - p[1]);
export const mid = (p, q) => [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
export const sub = (p, q) => [p[0] - q[0], p[1] - q[1]];
export const add = (p, q) => [p[0] + q[0], p[1] + q[1]];
export const scale = (p, k) => [p[0] * k, p[1] * k];
export const dot = (p, q) => p[0] * q[0] + p[1] * q[1];
export const cross = (p, q) => p[0] * q[1] - p[1] * q[0];

/** Angle at V between rays V→A and V→B, in degrees (0–180). */
export function angleAt(A, V, B) {
  const u = sub(A, V), w = sub(B, V);
  const c = dot(u, w) / (Math.hypot(...u) * Math.hypot(...w));
  return (Math.acos(Math.max(-1, Math.min(1, c))) * 180) / Math.PI;
}

/** Foot of the perpendicular from P to the line through L1, L2. */
export function foot(P, L1, L2) {
  const d = sub(L2, L1);
  const t = dot(sub(P, L1), d) / dot(d, d);
  return add(L1, scale(d, t));
}

// ── Intersections. Each returns all solutions; the caller picks one by a rule, never by index ──
export function lineLine(p1, p2, q1, q2) {
  const r = sub(p2, p1), s = sub(q2, q1);
  const den = cross(r, s);
  if (Math.abs(den) < EPS) return [];
  const t = cross(sub(q1, p1), s) / den;
  return [add(p1, scale(r, t))];
}

export function lineCircle(p1, p2, c, R) {
  const d = sub(p2, p1), f = sub(p1, c);
  const A = dot(d, d), B = 2 * dot(f, d), C = dot(f, f) - R * R;
  const disc = B * B - 4 * A * C;
  if (disc < -EPS) return [];
  const sq = Math.sqrt(Math.max(0, disc));
  return [(-B - sq) / (2 * A), (-B + sq) / (2 * A)].map((t) => add(p1, scale(d, t)));
}

export function circleCircle(c1, r1, c2, r2) {
  const d = dist(c1, c2);
  if (d < EPS || d > r1 + r2 + EPS || d < Math.abs(r1 - r2) - EPS) return [];
  const a = (r1 * r1 - r2 * r2 + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, r1 * r1 - a * a));
  const m = add(c1, scale(sub(c2, c1), a / d));
  const perp = [-(c2[1] - c1[1]) / d, (c2[0] - c1[0]) / d];
  return [add(m, scale(perp, h)), sub(m, scale(perp, h))];
}

/** Where y = f(x) meets y = g(x) on [a, b] (all sign changes of f − g). */
export function curveCurve(f, g, a, b) {
  const h = (x) => f(x) - g(x);
  const out = [];
  const n = 800;
  for (let i = 0; i < n; i++) {
    const x0 = a + ((b - a) * i) / n, x1 = a + ((b - a) * (i + 1)) / n;
    const y0 = h(x0), y1 = h(x1);
    if (!Number.isFinite(y0) || !Number.isFinite(y1)) continue;
    if (Math.abs(y0) < 1e-12) out.push(x0);
    else if (y0 * y1 < 0) {
      let lo = x0, hi = x1;
      for (let it = 0; it < 60; it++) {
        const m2 = (lo + hi) / 2;
        if (h(lo) * h(m2) <= 0) hi = m2;
        else lo = m2;
      }
      out.push(tidy((lo + hi) / 2));
    }
  }
  return out.map((x) => [x, f(x)]);
}

/** Picks one solution by a rule a person would say: "left", "right", "top", "bottom", or "near:[x,y]". */
export function pick(solutions, rule = "left") {
  if (!solutions.length) return [NaN, NaN];
  if (solutions.length === 1) return solutions[0];
  const s = [...solutions];
  if (Array.isArray(rule)) return s.sort((a, b) => dist(a, rule) - dist(b, rule))[0];
  switch (rule) {
    case "right": return s.sort((a, b) => b[0] - a[0])[0];
    case "top": return s.sort((a, b) => b[1] - a[1])[0];
    case "bottom": return s.sort((a, b) => a[1] - b[1])[0];
    default: return s.sort((a, b) => a[0] - b[0])[0];
  }
}

// ── Transformations, each with a progress s in [0, 1] so it can be animated ────────────────────
export function transformPoint(p, tf, s = 1) {
  switch (tf.kind) {
    case "rotate": {
      const a = ((tf.angle * Math.PI) / 180) * s;
      const d = sub(p, tf.center);
      return add(tf.center, [d[0] * Math.cos(a) - d[1] * Math.sin(a), d[0] * Math.sin(a) + d[1] * Math.cos(a)]);
    }
    case "translate":
      return add(p, scale(tf.vector, s));
    case "enlarge":
      return add(tf.center, scale(sub(p, tf.center), 1 + (tf.factor - 1) * s));
    case "reflect": {
      // A fold: each point moves straight across the mirror, reaching its image at s = 1.
      const q = foot(p, tf.line[0], tf.line[1]);
      return add(p, scale(sub(q, p), 2 * s));
    }
  }
  return p;
}

/** Sutherland–Hodgman: keep the part of a convex polygon where keep(x, y) is true. */
export function clipPolygon(poly, keep, val) {
  let out = poly;
  const inside = (p) => keep(p[0], p[1]);
  const res = [];
  for (let i = 0; i < out.length; i++) {
    const a = out[i], b = out[(i + 1) % out.length];
    const ia = inside(a), ib = inside(b);
    if (ia) res.push(a);
    if (ia !== ib) {
      // Crossing point on the boundary val(x, y) = 0 (linear along the edge).
      const va = val(a[0], a[1]), vb = val(b[0], b[1]);
      const t = va / (va - vb);
      res.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
    }
  }
  return res;
}

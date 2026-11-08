// 3-D for the scene engine: a camera ("board.view"), 3-D points, segments, vectors, lines and
// planes, angle marks in space, solids drawn the textbook way (visible edges solid, hidden edges
// dashed, curved solids with their true outlines), liquid levels, nets that fold up into their
// solid, and solids of revolution. Everything is computed from the spec's numbers and the
// camera: when a param moves the camera or a fold, every edge, outline and dash follows.
import { INK, colour, HIDDEN } from "./style.js";

const DEG = Math.PI / 180;
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const unit = (a) => mul(a, 1 / (len(a) || 1));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/** Rotate p about the line through a with unit direction u, by th radians (right-hand rule). */
function rotateAbout(p, a, u, th) {
  const v = sub(p, a), c = Math.cos(th), s = Math.sin(th);
  return add(a, add(add(mul(v, c), mul(cross(u, v), s)), mul(u, dot(u, v) * (1 - c))));
}

/** Faces of the convex hull of a few points: each face is a list of point indices, anticlockwise seen from outside. */
export function hull3(P) {
  const n = P.length, faces = [], seen = new Set();
  const size = Math.max(1, ...P.flat().map(Math.abs));
  const tol = 1e-7 * size;
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) for (let k = j + 1; k < n; k++) {
    let nr = cross(sub(P[j], P[i]), sub(P[k], P[i]));
    const L = len(nr);
    if (L < tol) continue;
    nr = mul(nr, 1 / L);
    let dd = dot(nr, P[i]), pos = 0, neg = 0;
    for (let m = 0; m < n; m++) {
      const s = dot(nr, P[m]) - dd;
      if (s > tol) pos++;
      else if (s < -tol) neg++;
    }
    if (pos && neg) continue;
    if (pos) (nr = mul(nr, -1)), (dd = -dd);
    const on = [];
    for (let m = 0; m < n; m++) if (Math.abs(dot(nr, P[m]) - dd) <= tol) on.push(m);
    const key = on.join(",");
    if (seen.has(key)) continue;
    seen.add(key);
    const c = mul(on.reduce((s, m) => add(s, P[m]), [0, 0, 0]), 1 / on.length);
    const b1 = unit(sub(P[on[0]], c)), b2 = cross(nr, b1);
    const ang = (m) => Math.atan2(dot(sub(P[m], c), b2), dot(sub(P[m], c), b1));
    faces.push(on.sort((a, b) => ang(a) - ang(b)));
  }
  return faces;
}

/** Convex hull of 2-D points (monotone chain). */
function hull2(pts) {
  const p = pts.filter((q) => q.every(Number.isFinite)).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return p;
  const crossZ = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [], upper = [];
  for (const q of p) {
    while (lower.length >= 2 && crossZ(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop();
    lower.push(q);
  }
  for (let i = p.length - 1; i >= 0; i--) {
    const q = p[i];
    while (upper.length >= 2 && crossZ(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop();
    upper.push(q);
  }
  upper.pop();
  lower.pop();
  return [...lower, ...upper];
}

/** Splits a closed loop of samples into runs where keep(i) is true (wrapping round the end). */
function runs(n, keep, at) {
  const flags = Array.from({ length: n }, (_, i) => keep(i));
  if (flags.every(Boolean)) return [Array.from({ length: n + 1 }, (_, i) => at(i % n))];
  if (!flags.some(Boolean)) return [];
  let start = flags.findIndex((f, i) => f && !flags[(i - 1 + n) % n]);
  const out = [];
  for (let k = 0; k < n; k++) {
    const i = (start + k) % n;
    if (flags[i] && !flags[(i - 1 + n) % n]) out.push([]);
    if (flags[i]) out[out.length - 1].push(at(i));
    // Close each run onto the next sample so arcs meet their neighbours.
    if (flags[i] && !flags[(i + 1) % n]) out[out.length - 1].push(at(i + 1));
  }
  return out;
}

export const TYPES_3D = {
  // ── Camera ──────────────────────────────────────────────────────────────────────────────────
  /**
   * "view": { "azimuth": -60, "elevation": 20 } (degrees; expressions, so a param can turn the
   * camera), or { "kind": "cabinet", "depth": 0.5, "recede": 45 } for the textbook oblique look
   * (front face true shape). "scale" and "origin" place the drawing on the board.
   */
  buildView(v = {}) {
    const kind = v.kind ?? "ortho";
    const basis = () => {
      if (kind === "cabinet" || kind === "oblique") {
        const k = this.ev(v.depth ?? 0.5), al = this.ev(v.recede ?? 45) * DEG;
        return { kind: "cabinet", k, ca: Math.cos(al), sa: Math.sin(al), V: unit([k * Math.cos(al), -1, k * Math.sin(al)]) };
      }
      const th = this.ev(v.azimuth ?? -60) * DEG, el = this.ev(v.elevation ?? 20) * DEG;
      return {
        kind: "ortho",
        R: [-Math.sin(th), Math.cos(th), 0],
        U: [-Math.sin(el) * Math.cos(th), -Math.sin(el) * Math.sin(th), Math.cos(el)],
        V: [Math.cos(el) * Math.cos(th), Math.cos(el) * Math.sin(th), Math.sin(el)],
      };
    };
    const view = {
      get: this.memo(() => ({ b: basis(), s: this.ev(v.scale ?? 1), o: v.origin ? [this.ev(v.origin[0]), this.ev(v.origin[1])] : [0, 0] })),
      proj(p, g = view.get()) {
        const { b, s, o } = g;
        if (b.kind === "ortho") return [o[0] + s * dot(p, b.R), o[1] + s * dot(p, b.U)];
        return [o[0] + s * (p[0] + b.k * b.ca * p[1]), o[1] + s * (p[2] + b.k * b.sa * p[1])];
      },
      /** The direction towards the viewer: a face whose outward normal has a positive dot with it is seen. */
      viewer: () => view.get().b.V,
    };
    this.view = view;
  },
  ensureView() {
    if (!this.view) this.buildView({});
    return this.view;
  },
  proj(p) {
    return this.ensureView().proj(p);
  },
  projAll(list) {
    const v = this.ensureView(), g = v.get();
    return list.map((p) => v.proj(p, g));
  },

  point3Ref(ref) {
    if (typeof ref === "string") {
      const o = this.objs.get(ref);
      if (!o?.pos3) throw new Error(`"${ref}" is not a 3-D point`);
      return () => o.pos3();
    }
    if (Array.isArray(ref) && ref.length === 3) return () => ref.map((v) => this.ev(v));
    throw new Error(`can't read 3-D point ${JSON.stringify(ref)}`);
  },
  /** A direction: [a, b, c], or the id of a 3-D point (its position vector) or of a 3-D line/segment (its direction). */
  vec3(ref) {
    if (typeof ref === "string") {
      const o = this.objs.get(ref);
      if (o?.line3) return () => o.line3().u;
      if (o?.pos3) return () => o.pos3();
      throw new Error(`"${ref}" is not a direction`);
    }
    return () => ref.map((v) => this.ev(v));
  },
  line3Of(id) {
    const o = this.objs.get(id);
    if (!o?.line3) throw new Error(`"${id}" is not a 3-D line or segment`);
    return () => o.line3();
  },
  registerPoint3(id, pos3, extra = {}) {
    return this.register({ id, type: "point3", pos3, pos: () => this.proj(pos3()), parts: {}, order: [], ...extra });
  },
  /** Which way a label should sit to be outside a figure: the compass point from its centre to the anchor. */
  outward(anchor2, centre2) {
    const dx = (anchor2[0] - centre2[0]) * this.b.unitX, dy = (anchor2[1] - centre2[1]) * this.b.unitY;
    if (Math.hypot(dx, dy) < 1) return "ne";
    const a = Math.atan2(dy, dx) / DEG;
    return ["e", "ne", "n", "nw", "w", "sw", "s", "se"][((Math.round(a / 45) % 8) + 8) % 8];
  },

  // ── Points, segments, lines, planes ─────────────────────────────────────────────────────────
  /** at: [x, y, z] · on: line, t · midpoint: [A, B] · along: [A, B, k] (A + k·AB) · foot: [P, line] · intersect: [l1, l2]. */
  make_point3(d) {
    let pos3;
    if (d.at) pos3 = this.point3Ref(d.at);
    else if (d.on) {
      const l = this.line3Of(d.on);
      pos3 = () => { const { p, u } = l(); return add(p, mul(u, this.ev(d.t ?? 0))); };
    } else if (d.midpoint) {
      const a = this.point3Ref(d.midpoint[0]), b = this.point3Ref(d.midpoint[1]);
      pos3 = () => mul(add(a(), b()), 0.5);
    } else if (d.along) {
      const a = this.point3Ref(d.along[0]), b = this.point3Ref(d.along[1]);
      pos3 = () => add(a(), mul(sub(b(), a()), this.ev(d.along[2])));
    } else if (d.foot) {
      const P = this.point3Ref(d.foot[0]), l = this.line3Of(d.foot[1]);
      pos3 = () => { const { p, u } = l(); return add(p, mul(u, dot(sub(P(), p), u) / dot(u, u))); };
    } else if (d.intersect) {
      const l1 = this.line3Of(d.intersect[0]), l2 = this.line3Of(d.intersect[1]);
      pos3 = () => {
        // The closest points of the two lines (they meet if the lines intersect); their midpoint.
        const { p: p1, u: u1 } = l1(), { p: p2, u: u2 } = l2();
        const w = sub(p1, p2), a = dot(u1, u1), b = dot(u1, u2), c = dot(u2, u2), e = dot(u1, w), f = dot(u2, w);
        const den = a * c - b * b;
        if (Math.abs(den) < 1e-12) return [NaN, NaN, NaN];
        const s = (b * f - c * e) / den, t = (a * f - b * e) / den;
        return mul(add(add(p1, mul(u1, s)), add(p2, mul(u2, t))), 0.5);
      };
    } else throw new Error("a 3-D point needs at, on, midpoint, along, foot or intersect");
    const o = this.registerPoint3(d.id, pos3, { color: colour(d.color) });
    const el = this.pointMark(o.pos, d);
    o.parts = { point: [el], label: [this.label(o, d.label, o.pos, "point", d)].filter(Boolean) };
    o.order = ["point", "label"];
  },

  seg3(d, arrow) {
    const p = this.point3Ref(d.from), q = this.point3Ref(d.to);
    const ends = () => [this.proj(p()), this.proj(q())];
    const o = this.register({ id: d.id, type: arrow ? "vector3" : "segment3", color: colour(d.color), line: ends, line3: () => ({ p: p(), u: sub(q(), p()) }) });
    const attrs = this.stroke(d, INK.white, 3);
    const el = this.b.create(arrow ? "arrow" : "segment", [this.dyn(() => ends()[0]), this.dyn(() => ends()[1])], arrow ? { ...attrs, lastArrow: { type: 2, size: 5 } } : attrs);
    o.parts = { line: [el], marks: this.edgeMarks(ends, d.marks, d.parallel, d), label: [this.label(o, d.label, () => { const [a, b] = ends(); return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]; }, "segment", d)].filter(Boolean) };
    o.order = ["line", "marks", "label"];
  },
  make_segment3(d) { this.seg3(d, false); },
  make_vector3(d) { this.seg3(d, true); },

  /** r = a + t·b: "through": a, "dir": b (or "to": a point), drawn for t in "t": [t0, t1]. */
  make_line3(d) {
    const P = this.point3Ref(d.through);
    const dir = d.to ? (() => { const Q = this.point3Ref(d.to); return () => sub(Q(), P()); })() : this.vec3(d.dir);
    const range = () => (d.t ?? [-2, 2]).map((v) => this.ev(v));
    const ends3 = () => { const [t0, t1] = range(); return [add(P(), mul(dir(), t0)), add(P(), mul(dir(), t1))]; };
    const ends = () => ends3().map((e) => this.proj(e));
    const o = this.register({ id: d.id, type: "line3", color: colour(d.color, INK.cyan), line: ends, line3: () => ({ p: P(), u: dir() }) });
    const el = this.b.create("segment", [this.dyn(() => ends()[0]), this.dyn(() => ends()[1])], this.stroke(d, INK.cyan, 3));
    o.parts = { line: [el], label: [this.label(o, d.label, () => ends()[1], "point", d)].filter(Boolean) };
    o.order = ["line", "label"];
  },

  make_polygon3(d) {
    const verts = d.points.map((p) => this.point3Ref(p));
    const P2 = () => this.projAll(verts.map((v) => v()));
    const o = this.register({ id: d.id, type: "polygon3", color: colour(d.color), poly: P2 });
    verts.forEach((v, i) => this.registerPoint3(`${d.id}.${i + 1}`, v));
    const n = verts.length;
    const edges = verts.map((_, i) => this.dataCurve(() => { const p = P2(); return [p[i], p[(i + 1) % n]]; }, this.stroke(d, INK.white, 3)));
    const fill = d.fill ? [this.dataCurve(() => { const p = P2(); return [...p, p[0]]; }, { ...HIDDEN, strokeWidth: 0, strokeOpacity: 0, fillColor: colour(d.fill), fillOpacity: d.fillOpacity ?? 0.25 })] : [];
    o.parts = { edges, fill, label: [this.label(o, d.label, () => { const p = P2(); return [p.reduce((s, q) => s + q[0], 0) / n, p.reduce((s, q) => s + q[1], 0) / n]; }, "inside", d)].filter(Boolean) };
    o.order = ["edges", "fill", "label"];
  },

  /** A patch of a plane: "through" a point, with "normal" [a, b, c] or "spans": [u, v]; "size": [w, h]. */
  make_plane3(d) {
    const P = this.point3Ref(d.through);
    const basis = () => {
      if (d.spans) {
        const a = this.vec3(d.spans[0])(), b = this.vec3(d.spans[1])();
        const e1 = unit(a);
        return [e1, unit(sub(b, mul(e1, dot(b, e1))))];
      }
      const n = unit(this.vec3(d.normal)());
      const helper = Math.abs(n[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
      const e1 = unit(cross(helper, n));
      return [e1, cross(n, e1)];
    };
    const [w, h] = (d.size ?? [3, 3]).map((v) => this.ev(v));
    const corners = () => {
      const p = P(), [e1, e2] = basis();
      return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => add(p, add(mul(e1, (a * w) / 2), mul(e2, (b * h) / 2))));
    };
    const P2 = () => this.projAll(corners());
    const c = colour(d.color, INK.violet);
    const o = this.register({ id: d.id, type: "plane3", color: c, poly: P2 });
    const el = this.dataCurve(() => { const p = P2(); return [...p, p[0]]; }, { ...this.stroke(d, INK.violet, 2), fillColor: colour(d.fill ?? d.color, INK.violet), fillOpacity: d.fillOpacity ?? 0.16 });
    o.parts = { plane: [el], label: [this.label(o, d.label, () => P2()[2], "point", d)].filter(Boolean) };
    o.order = ["plane", "label"];
  },

  /** 3-D axes from the origin: "x": [a, b], "y", "z"; names at the ends; optional ticks every "ticks". */
  make_axes3(d) {
    const r = (k) => (d[k] ?? [0, 4]).map((v) => this.ev(v));
    const axis = (k, i) => {
      const [a, b] = r(k);
      const e = [0, 0, 0];
      const lo = [...e], hi = [...e];
      lo[i] = a;
      hi[i] = b;
      return [lo, hi];
    };
    const o = this.register({ id: d.id, type: "axes3", color: INK.white });
    o.parts = { x: [], y: [], z: [], names: [], ticks: [] };
    o.order = ["x", "y", "z", "ticks", "names"];
    ["x", "y", "z"].forEach((k, i) => {
      if (d[k] === false) return;
      const ends = () => axis(k, i).map((p) => this.proj(p));
      o.parts[k].push(this.b.create("arrow", [this.dyn(() => ends()[0]), this.dyn(() => ends()[1])], { ...HIDDEN, strokeColor: INK.white, strokeWidth: 2.4, lastArrow: { type: 2, size: 5 } }));
      const no = this.registerPoint3(`${d.id}.${k}`, () => axis(k, i)[1]);
      const lab = this.label(no, d.names?.[i] ?? k, no.pos, "point", { color: "dim", labelSize: 20, labelPos: this.outward(no.pos(), this.proj([0, 0, 0])) });
      o.parts.names.push(lab);
      if (d.ticks) {
        const step = this.ev(d.ticks);
        const [a, b] = r(k);
        const other = i === 2 ? 0 : 2;
        for (let v = Math.ceil(a / step) * step; v <= b - step * 0.5; v += step) {
          if (Math.abs(v) < 1e-9) continue;
          const t = this.dataCurve(() => {
            const p = [0, 0, 0], q = [0, 0, 0];
            p[i] = q[i] = v;
            p[other] = -0.08;
            q[other] = 0.08;
            return [this.proj(p), this.proj(q)];
          }, { ...HIDDEN, strokeColor: INK.white, strokeWidth: 1.8 });
          t.__quick = true;
          o.parts.ticks.push(t);
        }
      }
    });
    const origin = this.registerPoint3(`${d.id}.O`, () => [0, 0, 0]);
    if (d.origin) o.parts.names.push(this.label(origin, d.origin, origin.pos, "point", { color: "dim", labelSize: 20, labelPos: "sw" }));
  },

  /** An angle mark in space at V between V→A and V→B (a square when it is 90°). */
  make_angle3(d) {
    const [A, V, B] = d.points.map((p) => this.point3Ref(p));
    const r = () => this.ev(d.radius ?? 0.5);
    const geom = () => {
      const v = V(), u = unit(sub(A(), v)), w = unit(sub(B(), v));
      const th = Math.acos(clamp(dot(u, w), -1, 1));
      return { v, u, w, th, e2: unit(sub(w, mul(u, dot(w, u)))) };
    };
    const right = () => Math.abs(geom().th - Math.PI / 2) < 1e-6 && d.square !== false;
    const pts = () => {
      const { v, u, w, th, e2 } = geom();
      if (right()) {
        const s = r() * 0.6;
        return this.projAll([add(v, mul(u, s)), add(v, mul(add(u, w), s)), add(v, mul(w, s))]);
      }
      return this.projAll(Array.from({ length: 31 }, (_, k) => { const t = (th * k) / 30; return add(v, mul(add(mul(u, Math.cos(t)), mul(e2, Math.sin(t))), r())); }));
    };
    const o = this.register({ id: d.id, type: "angle3", color: colour(d.color, INK.orange) });
    const el = this.dataCurve(pts, this.stroke(d, INK.orange, 2.5));
    const at = () => { const { v, u, w } = geom(); return this.proj(add(v, mul(unit(add(u, w)), r() * (d.labelDistance ?? 1.9)))); };
    const text = d.label === "auto" ? (d.points.every((p) => typeof p === "string") ? `{angle(${d.points.join(",")}):${d.dp ?? 1}}°` : undefined) : d.label;
    o.parts = { mark: [el], label: text === undefined ? [] : [this.text(at, this.template(text), d, 22)] };
    o.order = ["mark", "label"];
  },

  // ── Solids ──────────────────────────────────────────────────────────────────────────────────
  /** The corner points of a polyhedron, before "at" moves it. */
  polyhedronPoints(d) {
    const e = (v) => this.ev(v);
    switch (d.kind) {
      case "cube":
      case "cuboid": {
        const sz = d.kind === "cube" ? [d.size, d.size, d.size] : d.size;
        const [l, w, h] = sz.map(e);
        return [[0, 0, 0], [l, 0, 0], [l, w, 0], [0, w, 0], [0, 0, h], [l, 0, h], [l, w, h], [0, w, h]];
      }
      case "prism": {
        if (d.cross) {
          const L = e(d.length);
          const c = d.cross.map(([x, z]) => [e(x), e(z)]);
          return [...c.map(([x, z]) => [x, 0, z]), ...c.map(([x, z]) => [x, L, z])];
        }
        const h = e(d.height);
        const b = d.base.map(([x, y]) => [e(x), e(y)]);
        return [...b.map(([x, y]) => [x, y, 0]), ...b.map(([x, y]) => [x, y, h])];
      }
      case "pyramid": {
        const b = d.base ? d.base.map(([x, y]) => [e(x), e(y)]) : (() => { const [l, w] = (Array.isArray(d.size) ? d.size : [d.size, d.size]).map(e); return [[0, 0], [l, 0], [l, w], [0, w]]; })();
        const cx = b.reduce((s, p) => s + p[0], 0) / b.length, cy = b.reduce((s, p) => s + p[1], 0) / b.length;
        const apex = d.apex ? d.apex.map(e) : [cx, cy, e(d.height)];
        return [...b.map(([x, y]) => [x, y, 0]), apex];
      }
      case "tetrahedron": {
        const s = e(d.size ?? 2);
        return [[0, 0, 0], [s, 0, 0], [s / 2, (s * Math.sqrt(3)) / 2, 0], [s / 2, (s * Math.sqrt(3)) / 6, s * Math.sqrt(2 / 3)]];
      }
      case "hull":
        return d.points.map((p) => p.map(e));
    }
    throw new Error(`unknown solid kind "${d.kind}" (cuboid, cube, prism, pyramid, tetrahedron, hull, cylinder, cone, frustum, sphere, hemisphere)`);
  },

  /**
   * A solid. Polyhedra (cuboid, cube, prism, pyramid, tetrahedron, hull) name their corners with
   * "names" ("ABCDEFGH") so lines can be drawn between them; curved solids (cylinder, cone,
   * frustum, sphere, hemisphere) name points with "points": { "O": "centre", "V": "apex", "A": "rim:0" }.
   * "edgeLabels": { "AB": "8 cm" }. "level": the depth of liquid inside (can be a param).
   */
  make_solid(d) {
    const at = this.point3Ref(d.at ?? [0, 0, 0]);
    const o = this.register({ id: d.id, type: "solid", color: colour(d.color) });
    o.parts = { fills: [], edges: [], hidden: [], liquid: [], labels: [] };
    o.order = ["fills", "edges", "hidden", "liquid", "labels"];
    if (["cylinder", "cone", "frustum", "sphere", "hemisphere"].includes(d.kind)) return this.curvedSolid(d, o, at);
    const P = this.memo(() => { const base = at(); return this.polyhedronPoints(d).map((p) => add(p, base)); });
    const faces = hull3(P());
    const edgeMap = new Map();
    faces.forEach((f, fi) => f.forEach((a, k) => {
      const b = f[(k + 1) % f.length];
      const key = a < b ? `${a},${b}` : `${b},${a}`;
      if (!edgeMap.has(key)) edgeMap.set(key, { a: Math.min(a, b), b: Math.max(a, b), faces: [] });
      edgeMap.get(key).faces.push(fi);
    }));
    const front = this.memo(() => {
      const p = P(), V = this.ensureView().viewer();
      return faces.map((f) => dot(cross(sub(p[f[1]], p[f[0]]), sub(p[f[2]], p[f[0]])), V) > 1e-9);
    });
    const c = colour(d.color, INK.white);
    const solidAttrs = { ...HIDDEN, strokeColor: c, strokeWidth: d.width ?? 3, lineCap: "round" };
    const dashAttrs = { ...HIDDEN, strokeColor: c, strokeWidth: 2.2, strokeOpacity: 0.75, dash: 2 };
    for (const e of edgeMap.values()) {
      const seen = () => e.faces.some((fi) => front()[fi]);
      o.parts.edges.push(this.dataCurve(() => (seen() ? this.projAll([P()[e.a], P()[e.b]]) : []), solidAttrs));
      if (d.showHidden !== false) o.parts.hidden.push(this.dataCurve(() => (seen() ? [] : this.projAll([P()[e.a], P()[e.b]])), dashAttrs));
    }
    if (d.fill) {
      faces.forEach((f, fi) => o.parts.fills.push(this.dataCurve(() => {
        if (!front()[fi]) return [];
        const q = this.projAll(f.map((i) => P()[i]));
        return [...q, q[0]];
      }, { ...HIDDEN, strokeWidth: 0, strokeOpacity: 0, fillColor: colour(d.fill), fillOpacity: d.fillOpacity ?? 0.14 })));
    }
    const centre2 = () => { const q = this.projAll(P()); return [q.reduce((s, v) => s + v[0], 0) / q.length, q.reduce((s, v) => s + v[1], 0) / q.length]; };
    // Corner names: each becomes a 3-D point other objects can use.
    const names = typeof d.names === "string" ? d.names.split("") : d.names ?? [];
    names.forEach((name, i) => {
      if (!name || name === " " || name === "_") return;
      const po = this.registerPoint3(name, () => P()[i], { color: c });
      if (d.labels !== false) {
        const lab = this.label(po, name, po.pos, "point", { color: d.labelColor ?? d.color ?? "white", labelPos: this.outward(po.pos(), centre2()), labelSize: d.labelSize ?? 22 });
        o.parts.labels.push(lab);
        po.parts = { label: [lab] };
        po.order = ["label"];
      }
    });
    for (const [pair, text] of Object.entries(d.edgeLabels ?? {})) {
      const [n1, n2] = pair.length === 2 ? pair.split("") : pair.split(/[-,]/);
      const i1 = names.indexOf(n1), i2 = names.indexOf(n2);
      if (i1 < 0 || i2 < 0) throw new Error(`edgeLabels: no corners "${n1}" and "${n2}"`);
      const ends = () => this.projAll([P()[i1], P()[i2]]);
      const mid = () => { const [a, b] = ends(); return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]; };
      const eo = { id: `${d.id}.${pair}`, line: ends };
      o.parts.labels.push(this.label(eo, String(text), mid, "segment", { color: d.dimColor ?? "cyan", labelPos: this.awaySide(ends(), centre2()) }));
    }
    if (d.level !== undefined) this.polyLiquid(d, o, P, edgeMap);
    for (const [k, v] of Object.entries(d.points ?? {})) this.registerPoint3(k, this.point3Ref(v));
  },

  /** "perp+" or "perp-": the side of a segment away from a figure's centre. */
  awaySide([a, b], centre) {
    const dx = (b[0] - a[0]) * this.b.unitX, dy = -(b[1] - a[1]) * this.b.unitY;
    const n = Math.hypot(dx, dy) || 1;
    let perp = [-dy / n, dx / n];
    if (perp[1] > 0) perp = [-perp[0], -perp[1]];
    const m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const cx = (centre[0] - m[0]) * this.b.unitX, cy = -(centre[1] - m[1]) * this.b.unitY;
    return perp[0] * cx + perp[1] * cy > 0 ? "perp-" : "perp+";
  },

  polyLiquid(d, o, P, edgeMap) {
    const c = colour(d.liquidColor ?? "cyan");
    const cut = () => {
      const p = P();
      const z0 = Math.min(...p.map((q) => q[2]));
      const zc = z0 + this.ev(d.level);
      const below = p.filter((q) => q[2] <= zc + 1e-9);
      const surface = p.filter((q) => Math.abs(q[2] - zc) < 1e-9);
      for (const e of edgeMap.values()) {
        const A = p[e.a], B = p[e.b];
        if ((A[2] - zc) * (B[2] - zc) < 0) {
          const t = (zc - A[2]) / (B[2] - A[2]);
          const q = add(A, mul(sub(B, A), t));
          below.push(q);
          surface.push(q);
        }
      }
      return { body: hull2(this.projAll(below)), top: hull2(this.projAll(surface)) };
    };
    o.parts.liquid.push(
      this.dataCurve(() => { const h = cut().body; return h.length ? [...h, h[0]] : []; }, { ...HIDDEN, strokeWidth: 0, strokeOpacity: 0, fillColor: c, fillOpacity: d.liquidOpacity ?? 0.3 }),
      this.dataCurve(() => { const h = cut().top; return h.length ? [...h, h[0]] : []; }, { ...HIDDEN, strokeColor: c, strokeWidth: 2.2, fillColor: c, fillOpacity: 0.18 }),
    );
  },

  curvedSolid(d, o, at) {
    const kind = d.kind;
    const [A, E1, E2] = { z: [[0, 0, 1], [1, 0, 0], [0, 1, 0]], x: [[1, 0, 0], [0, 1, 0], [0, 0, 1]], y: [[0, 1, 0], [0, 0, 1], [1, 0, 0]] }[d.axis ?? "z"];
    const r = () => this.ev(d.radius ?? 1), h = () => this.ev(d.height ?? 2), r2 = () => this.ev(d.topRadius ?? 0.5);
    const radial = (phi) => add(mul(E1, Math.cos(phi)), mul(E2, Math.sin(phi)));
    const point = (t, rad, phi) => add(add(at(), mul(A, t)), mul(radial(phi), rad));
    const V = () => this.ensureView().viewer();
    const inverted = !!d.inverted;
    const bowl = kind === "hemisphere" && (d.flat === "top" || d.bowl === true);
    const side = (phi) => {
      if (kind === "cylinder" || kind === "sphere" || kind === "hemisphere") return radial(phi);
      if (kind === "cone") return add(mul(radial(phi), h()), mul(A, inverted ? -r() : r()));
      return add(mul(radial(phi), h()), mul(A, r() - r2()));
    };
    // Each rim: its height on the axis, its radius, and the outward normal of the flat face it bounds (if any).
    // A face joined to another solid ("joined": ["top"]) is covered: its rim is seen only where the side faces you.
    const joined = new Set([].concat(d.joined ?? []));
    const rims = () => rimsOf().map((rim) => ((rim.top && joined.has("top")) || (!rim.top && joined.has("bottom")) ? { ...rim, cap: 0 } : rim));
    const rimsOf = () => {
      switch (kind) {
        case "cylinder": return [{ t: 0, rad: r(), cap: -1 }, { t: h(), rad: r(), cap: 1, top: true }];
        case "cone": return inverted ? [{ t: h(), rad: r(), cap: 1, top: true }] : [{ t: 0, rad: r(), cap: -1 }];
        case "frustum": return [{ t: 0, rad: r(), cap: -1 }, { t: h(), rad: r2(), cap: 1, top: true }];
        case "sphere": return [{ t: 0, rad: r(), cap: 0 }];
        case "hemisphere": return [{ t: 0, rad: r(), cap: bowl ? 1 : -1, top: bowl }];
      }
      return [];
    };
    const N = 120;
    const phiOf = (i) => (2 * Math.PI * i) / N;
    const visibleAt = (rim, phi) => (rim.cap !== 0 && dot(mul(A, rim.cap), V()) > 1e-9) || dot(side(phi), V()) > 1e-9;
    const rimLines = (seen) => rims().flatMap((rim) => runs(N, (i) => visibleAt(rim, phiOf(i)) === seen, (i) => this.proj(point(rim.t, rim.rad, phiOf(i)))));
    // Where the side surface turns away from the viewer: the outline lines.
    const silhouettePhis = () => {
      const out = [];
      const g = (phi) => dot(side(phi), V());
      // Samples are offset from whole degrees so an outline exactly on a sample is not missed.
      for (let i = 0; i < 360; i++) {
        let a = ((i + 0.3719) * 2 * Math.PI) / 360, b = ((i + 1.3719) * 2 * Math.PI) / 360;
        if (g(a) * g(b) < 0) {
          for (let k = 0; k < 50; k++) { const m = (a + b) / 2; if (g(a) * g(m) <= 0) b = m; else a = m; }
          out.push((a + b) / 2);
        }
      }
      return out;
    };
    const outline = () => {
      const lines = [];
      if (kind === "cylinder") for (const p of silhouettePhis()) lines.push(this.projAll([point(0, r(), p), point(h(), r(), p)]));
      if (kind === "frustum") for (const p of silhouettePhis()) lines.push(this.projAll([point(0, r(), p), point(h(), r2(), p)]));
      if (kind === "cone") {
        const apex = point(inverted ? 0 : h(), 0, 0), rimT = inverted ? h() : 0;
        for (const p of silhouettePhis()) lines.push(this.projAll([apex, point(rimT, r(), p)]));
      }
      if (kind === "sphere" || kind === "hemisphere") {
        // The outline of a sphere is the great circle facing the viewer; a hemisphere keeps its dome half.
        const v = V();
        let g1 = cross(v, A);
        if (len(g1) < 1e-6) g1 = E1;
        g1 = unit(g1);
        const g2 = cross(v, g1);
        const pts = (i) => add(at(), mul(add(mul(g1, Math.cos(phiOf(i))), mul(g2, Math.sin(phiOf(i)))), r()));
        const keep = (i) => kind === "sphere" || (dot(sub(pts(i), at()), A) * (bowl ? -1 : 1) >= -1e-9);
        lines.push(...runs(N, keep, (i) => this.proj(pts(i))));
      }
      return lines;
    };
    const c = colour(d.color, INK.white);
    o.parts.edges.push(this.multiCurve(outline, { ...HIDDEN, strokeColor: c, strokeWidth: d.width ?? 3, lineCap: "round" }));
    o.parts.edges.push(this.multiCurve(() => rimLines(true), { ...HIDDEN, strokeColor: c, strokeWidth: d.width ?? 3, lineCap: "round" }));
    if (d.showHidden !== false) o.parts.hidden.push(this.multiCurve(() => rimLines(false), { ...HIDDEN, strokeColor: c, strokeWidth: 2.2, strokeOpacity: 0.75, dash: 2 }));
    if (d.fill) {
      o.parts.fills.push(this.dataCurve(() => {
        const pts = [];
        for (const rim of rims()) for (let i = 0; i < N; i += 3) pts.push(this.proj(point(rim.t, rim.rad, phiOf(i))));
        for (const l of outline()) pts.push(...l);
        if (kind === "cone") pts.push(this.proj(point(inverted ? 0 : h(), 0, 0)));
        const hh = hull2(pts);
        return hh.length ? [...hh, hh[0]] : [];
      }, { ...HIDDEN, strokeWidth: 0, strokeOpacity: 0, fillColor: colour(d.fill), fillOpacity: d.fillOpacity ?? 0.12 }));
    }
    // Named points: "centre" (base centre), "top", "apex", "rim:deg", "toprim:deg".
    const named = (spec) => {
      const m = /^(rim|toprim):(.+)$/.exec(spec);
      if (m) return () => point(m[1] === "toprim" ? h() : kind === "cone" && inverted ? h() : 0, m[1] === "toprim" && kind === "frustum" ? r2() : r(), this.ev(m[2]) * DEG);
      if (spec === "centre" || spec === "center") return () => point(kind === "cone" && inverted ? h() : 0, 0, 0);
      if (spec === "top") return () => point(h(), 0, 0);
      if (spec === "apex") return () => point(kind === "cone" && !inverted ? h() : 0, 0, 0);
      if (spec === "base") return () => point(0, 0, 0);
      return this.point3Ref(spec);
    };
    const centre2 = () => this.proj(point(kind === "sphere" || kind === "hemisphere" ? 0 : h() / 2, 0, 0));
    for (const [name, spec] of Object.entries(d.points ?? {})) {
      const po = this.registerPoint3(name, named(String(spec)), { color: c });
      if (d.labels !== false) {
        const lab = this.label(po, name, po.pos, "point", { color: d.labelColor ?? d.color ?? "white", labelPos: this.outward(po.pos(), centre2()) });
        o.parts.labels.push(lab);
        po.parts = { label: [lab] };
        po.order = ["label"];
      }
    }
    for (const [k, v] of [["centre", "centre"], ["top", "top"], ["apex", "apex"]]) this.registerPoint3(`${d.id}.${k}`, named(v));
    if (d.level !== undefined) {
      const lc = colour(d.liquidColor ?? "cyan");
      const level = () => clamp(this.ev(d.level), 0, kind === "sphere" || kind === "hemisphere" ? r() * 2 : h());
      const radAt = (t) => {
        if (kind === "cylinder") return r();
        if (kind === "frustum") return r() + ((r2() - r()) * t) / h();
        if (kind === "cone") return inverted ? (r() * t) / h() : r() * (1 - t / h());
        // A bowl: depth t from the bottom of the sphere.
        const z = -r() + t;
        return Math.sqrt(Math.max(0, r() * r() - z * z));
      };
      const tOf = (L) => (bowl ? -r() + L : L);
      const body = () => {
        const L = level(), pts = [];
        for (let i = 0; i < N; i += 2) pts.push(this.proj(point(tOf(L), radAt(L), phiOf(i))));
        if (bowl) for (let j = 0; j <= 10; j++) { const tt = (L * j) / 10; for (let i = 0; i < N; i += 6) pts.push(this.proj(point(tOf(tt), radAt(tt), phiOf(i)))); }
        else if (kind === "cone" && inverted) pts.push(this.proj(point(0, 0, 0)));
        else for (let i = 0; i < N; i += 2) pts.push(this.proj(point(0, radAt(0), phiOf(i))));
        const hh = hull2(pts);
        return hh.length ? [...hh, hh[0]] : [];
      };
      const surface = () => { const L = level(); return Array.from({ length: N + 1 }, (_, i) => this.proj(point(tOf(L), radAt(L), phiOf(i)))); };
      o.parts.liquid.push(
        this.dataCurve(body, { ...HIDDEN, strokeWidth: 0, strokeOpacity: 0, fillColor: lc, fillOpacity: d.liquidOpacity ?? 0.3 }),
        this.dataCurve(surface, { ...HIDDEN, strokeColor: lc, strokeWidth: 2.2, fillColor: lc, fillOpacity: 0.18 }),
      );
      this.registerPoint3(`${d.id}.surface`, () => point(tOf(level()), 0, 0));
    }
  },

  // ── Nets ────────────────────────────────────────────────────────────────────────────────────
  /** The faces of a net, flat: each face's corners, its parent face, the hinge it folds about and by how much. */
  netFaces(d) {
    const e = (v) => this.ev(v);
    const rect = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
    switch (d.of) {
      case "cube":
      case "cuboid": {
        const [l, w, h] = (d.of === "cube" ? [d.size, d.size, d.size] : d.size).map(e);
        return [
          { pts: rect(0, 0, l, w), parent: null, name: "base" },
          { pts: rect(0, -h, l, 0), parent: 0, hinge: [3, 2], angle: 90, name: "front" },
          { pts: rect(0, w, l, w + h), parent: 0, hinge: [0, 1], angle: 90, name: "back" },
          { pts: rect(-h, 0, 0, w), parent: 0, hinge: [1, 2], angle: 90, name: "left" },
          { pts: rect(l, 0, l + h, w), parent: 0, hinge: [0, 3], angle: 90, name: "right" },
          { pts: rect(0, w + h, l, w + h + w), parent: 2, hinge: [0, 1], angle: 90, name: "top" },
        ];
      }
      case "prism": {
        // A strip of rectangles (one per side of the cross-section) with the two ends on the first.
        let c = d.cross.map(([x, y]) => [e(x), e(y)]);
        const area = c.reduce((s, p, i) => s + p[0] * c[(i + 1) % c.length][1] - c[(i + 1) % c.length][0] * p[1], 0);
        if (area < 0) c = c.reverse();
        const L = e(d.length);
        const n = c.length;
        const side = (k) => Math.hypot(c[(k + 1) % n][0] - c[k][0], c[(k + 1) % n][1] - c[k][1]);
        const dirOf = (k) => Math.atan2(c[(k + 1) % n][1] - c[k][1], c[(k + 1) % n][0] - c[k][0]);
        const turn = (k) => { let t = dirOf(k + 1) - dirOf(k); while (t < 0) t += 2 * Math.PI; while (t >= 2 * Math.PI) t -= 2 * Math.PI; return t / DEG; };
        const faces = [];
        let x = 0;
        for (let k = 0; k < n; k++) {
          faces.push({ pts: rect(x, 0, x + side(k), L), parent: k === 0 ? null : k - 1, hinge: k === 0 ? undefined : [0, 3], angle: k === 0 ? 0 : turn(k - 1), name: `side ${k + 1}` });
          x += side(k);
        }
        // The cross-section with its first side along the first rectangle's top (and bottom) edge.
        const a0 = dirOf(0), [ox, oy] = c[0];
        const local = c.map(([px, py]) => { const dx = px - ox, dy = py - oy; return [dx * Math.cos(-a0) - dy * Math.sin(-a0), dx * Math.sin(-a0) + dy * Math.cos(-a0)]; });
        faces.push({ pts: local.map(([u, v]) => [u, L + v]), parent: 0, hinge: [0, 1], angle: 90, name: "end" });
        faces.push({ pts: local.map(([u, v]) => [u, -v]), parent: 0, hinge: [0, 1], angle: 90, name: "end" });
        return faces;
      }
      case "pyramid":
      case "tetrahedron": {
        let base, apex;
        if (d.of === "tetrahedron") {
          const s = e(d.size ?? 2);
          base = [[0, 0], [s, 0], [s / 2, (s * Math.sqrt(3)) / 2]];
          apex = [s / 2, (s * Math.sqrt(3)) / 6, s * Math.sqrt(2 / 3)];
        } else {
          base = d.base ? d.base.map(([x, y]) => [e(x), e(y)]) : (() => { const [l, w] = (Array.isArray(d.size) ? d.size : [d.size, d.size]).map(e); return [[0, 0], [l, 0], [l, w], [0, w]]; })();
          const area = base.reduce((s, p, i) => s + p[0] * base[(i + 1) % base.length][1] - base[(i + 1) % base.length][0] * p[1], 0);
          if (area < 0) base = base.reverse();
          const cx = base.reduce((s, p) => s + p[0], 0) / base.length, cy = base.reduce((s, p) => s + p[1], 0) / base.length;
          apex = d.apex ? d.apex.map(e) : [cx, cy, e(d.height ?? 2)];
        }
        const faces = [{ pts: base, parent: null, name: "base" }];
        base.forEach((v, k) => {
          const w = base[(k + 1) % base.length];
          const ex = w[0] - v[0], ey = w[1] - v[1], el = Math.hypot(ex, ey);
          const t = ((apex[0] - v[0]) * ex + (apex[1] - v[1]) * ey) / (el * el);
          const F = [v[0] + t * ex, v[1] + t * ey, 0];
          const slant = len(sub(apex, F));
          const out = [ey / el, -ex / el];
          const flat = [F[0] + out[0] * slant, F[1] + out[1] * slant];
          const cosD = dot([-out[0], -out[1], 0], sub(apex, F)) / slant;
          faces.push({ pts: [v, w, flat], parent: 0, hinge: [0, 1], angle: 180 - Math.acos(clamp(cosD, -1, 1)) / DEG, name: `face ${k + 1}` });
        });
        return faces;
      }
      case "cylinder": {
        const r = e(d.radius ?? 1), h = e(d.height ?? 2), W = 2 * Math.PI * r;
        const circle = (cx, cy) => Array.from({ length: 72 }, (_, i) => [cx + r * Math.cos((i * 2 * Math.PI) / 72), cy + r * Math.sin((i * 2 * Math.PI) / 72)]);
        return [
          { pts: rect(0, 0, W, h), parent: null, name: "curved surface" },
          { pts: circle(W / 2, h + r), parent: null, name: "top" },
          { pts: circle(W / 2, -r), parent: null, name: "base" },
        ];
      }
      case "cone": {
        const r = e(d.radius ?? 1), h = e(d.height ?? 2), l = Math.hypot(r, h), th = (2 * Math.PI * r) / l;
        const sector = [[0, 0], ...Array.from({ length: 61 }, (_, i) => { const a = -Math.PI / 2 - th / 2 + (th * i) / 60; return [l * Math.cos(a), l * Math.sin(a)]; })];
        const circle = Array.from({ length: 72 }, (_, i) => [r * Math.cos((i * 2 * Math.PI) / 72), -l - r + r * Math.sin((i * 2 * Math.PI) / 72)]);
        return [{ pts: sector, parent: null, name: "curved surface" }, { pts: circle, parent: null, name: "base" }];
      }
    }
    if (d.faces) return d.faces.map((f) => ({ pts: f.points.map(([x, y]) => [e(x), e(y)]), parent: f.parent ?? null, hinge: f.hinge, angle: e(f.angle ?? 90), name: f.name }));
    throw new Error(`unknown net "${d.of}" (cube, cuboid, prism, pyramid, tetrahedron, cylinder, cone, or your own "faces")`);
  },

  /**
   * The net of a solid, flat on the board, with fold lines dashed. "fold" (0 → 1, usually a param)
   * folds every face up about its hinge into the solid; pair it with a view whose elevation
   * depends on the same param to watch it from above, then from the side.
   */
  make_net(d) {
    const off = this.pointRef(d.at ?? [0, 0])();
    const faces = this.netFaces(d).map((f) => ({ ...f, pts: f.pts.map(([x, y]) => [x + off[0], y + off[1]]) }));
    for (const f of faces) {
      if (f.parent === null || f.parent === undefined) continue;
      if (!(f.parent < faces.indexOf(f))) throw new Error("each face's parent must come before it");
      const [i, j] = f.hinge;
      const p = f.pts[i], q = f.pts[j];
      const u = [q[0] - p[0], q[1] - p[1]];
      const cen = [f.pts.reduce((s, v) => s + v[0], 0) / f.pts.length, f.pts.reduce((s, v) => s + v[1], 0) / f.pts.length];
      f.sgn = Math.sign(u[0] * (cen[1] - p[1]) - u[1] * (cen[0] - p[0])) || 1;
    }
    const fold = () => clamp(this.ev(d.fold ?? 0), 0, 1);
    let cacheKey = null, cache = null;
    const world = () => {
      const F = fold();
      if (F === cacheKey) return cache;
      const T = [];
      faces.forEach((f, k) => {
        if (f.parent === null || f.parent === undefined) T[k] = (p) => p;
        else {
          const a = [...f.pts[f.hinge[0]], 0], b = [...f.pts[f.hinge[1]], 0];
          const u = unit(sub(b, a)), th = f.sgn * f.angle * DEG * F, parent = T[f.parent];
          T[k] = (p) => parent(rotateAbout(p, a, u, th));
        }
      });
      cacheKey = F;
      cache = faces.map((f, k) => f.pts.map(([x, y]) => T[k]([x, y, 0])));
      return cache;
    };
    // Which edges are hinges (fold lines): the child's hinge edge, and the parent edge it sits on.
    const same = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1]) < 1e-7;
    const hingeEdges = faces.map(() => new Set());
    faces.forEach((f, k) => {
      if (f.parent === null || f.parent === undefined) return;
      const [i, j] = f.hinge;
      hingeEdges[k].add(Math.min(i, j) === 0 && Math.max(i, j) === f.pts.length - 1 ? f.pts.length - 1 : Math.min(i, j));
      const par = faces[f.parent];
      par.pts.forEach((p, m) => {
        const q = par.pts[(m + 1) % par.pts.length];
        if ((same(p, f.pts[i]) && same(q, f.pts[j])) || (same(p, f.pts[j]) && same(q, f.pts[i]))) hingeEdges[f.parent].add(m);
      });
    });
    const c = colour(d.color, INK.white);
    const fc = colour(d.fill ?? "cyan");
    const o = this.register({ id: d.id, type: "net", color: c });
    o.parts = { fills: [], edges: [], folds: [], labels: [] };
    o.order = ["edges", "folds", "fills", "labels"];
    faces.forEach((f, k) => {
      const n = f.pts.length;
      const outer = () => {
        const w = this.projAll(world()[k]);
        const lines = [];
        let cur = null;
        for (let m = 0; m < n; m++) {
          if (hingeEdges[k].has(m)) { cur = null; continue; }
          if (!cur) lines.push((cur = [w[m]]));
          cur.push(w[(m + 1) % n]);
        }
        // A run that wraps round the end joins the first one.
        if (lines.length > 1 && !hingeEdges[k].has(n - 1) && !hingeEdges[k].has(0)) lines[0] = [...lines.pop(), ...lines[0].slice(1)];
        return lines;
      };
      const edge = this.multiCurve(outer, { ...HIDDEN, strokeColor: c, strokeWidth: d.width ?? 2.8, lineCap: "round" });
      const fill = this.dataCurve(() => { const w = this.projAll(world()[k]); return [...w, w[0]]; }, { ...HIDDEN, strokeWidth: 0, strokeOpacity: 0, fillColor: fc, fillOpacity: d.fillOpacity ?? 0.16 });
      o.parts.edges.push(edge);
      o.parts.fills.push(fill);
      o.parts[`f${k + 1}`] = [edge, fill];
      if (f.parent !== null && f.parent !== undefined) {
        const [i, j] = f.hinge;
        o.parts.folds.push(this.dataCurve(() => { const w = this.projAll(world()[k]); return [w[i], w[j]]; }, { ...HIDDEN, strokeColor: c, strokeWidth: 2, strokeOpacity: 0.85, dash: 2 }));
      }
      if (d.labels?.[k]) {
        const centre = () => { const w = this.projAll(world()[k]); return [w.reduce((s, p) => s + p[0], 0) / n, w.reduce((s, p) => s + p[1], 0) / n]; };
        const fo = this.register({ id: `${d.id}.f${k + 1}`, type: "point", pos: centre, parts: {}, order: [] });
        const lab = this.label(fo, String(d.labels[k]), centre, "inside", { color: d.labelColor ?? "white", labelSize: d.labelSize ?? 20 });
        o.parts.labels.push(lab);
        o.parts[`f${k + 1}`].push(lab);
      }
    });
  },

  // ── Solid of revolution ─────────────────────────────────────────────────────────────────────
  /**
   * The region under y = f(x) from a to b turned about the x-axis ("axis": "x", the default), or
   * about the vertical axis ("axis": "y": f then gives the radius at each height). "between":
   * [f, g] turns the region between two curves (a washer). Draws the outline, the end rims (back
   * halves dashed), the region itself, and a typical slice (a param can slide it).
   */
  make_revolution(d) {
    const outer = this.fnOf(d.between ? d.between[0] : d.of);
    const inner = d.between ? this.fnOf(d.between[1]) : null;
    const vertical = d.axis === "y";
    const [A, E1, E2] = vertical ? [[0, 0, 1], [1, 0, 0], [0, 1, 0]] : [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
    const lim = () => [this.ev(d.from), this.ev(d.to)];
    const V = () => this.ensureView().viewer();
    const P = (u, rad, phi) => add(mul(A, u), mul(add(mul(E1, Math.cos(phi)), mul(E2, Math.sin(phi))), rad));
    const slopeOf = (f) => (u) => { const hh = 1e-5 * Math.max(1, Math.abs(u)); return (f(u + hh) - f(u - hh)) / (2 * hh); };
    const N = 120, phiOf = (i) => (2 * Math.PI * i) / N;
    const frame = () => { const v = V(); return { v, aV: dot(A, v), rho: Math.hypot(dot(E1, v), dot(E2, v)), psi: Math.atan2(dot(E2, v), dot(E1, v)) }; };
    // The outline of a surface of revolution: where its normal (−R′A + radial) turns side-on to the viewer.
    const outline = (f) => {
      const [a, b] = lim(), { aV, rho, psi } = frame(), sl = slopeOf(f);
      const one = [], two = [];
      for (let k = 0; k <= 100; k++) {
        const u = a + ((b - a) * k) / 100;
        const cc = (sl(u) * aV) / (rho || 1e-9);
        if (Math.abs(cc) > 1) { one.push([NaN, NaN]); two.push([NaN, NaN]); continue; }
        const dphi = Math.acos(cc);
        one.push(this.proj(P(u, f(u), psi + dphi)));
        two.push(this.proj(P(u, f(u), psi - dphi)));
      }
      return [one, two].flatMap(splitFinite3);
    };
    const sideN = (f, u, phi) => add(mul(A, -slopeOf(f)(u)), add(mul(E1, Math.cos(phi)), mul(E2, Math.sin(phi))));
    const rimRuns = (f, u, capSign, seen) => runs(N, (i) => (dot(mul(A, capSign), V()) > 1e-9 || dot(sideN(f, u, phiOf(i)), V()) > 1e-9) === seen, (i) => this.proj(P(u, f(u), phiOf(i))));
    // The flat region itself is drawn in the plane through the axis that faces the viewer.
    const facePhi = () => {
      const { psi } = frame();
      const o0 = this.proj([0, 0, 0]);
      const score = (phi) => { const q = this.proj(add(mul(E1, Math.cos(phi)), mul(E2, Math.sin(phi)))); return vertical ? q[0] - o0[0] : q[1] - o0[1]; };
      return score(psi + Math.PI / 2) >= score(psi - Math.PI / 2) ? psi + Math.PI / 2 : psi - Math.PI / 2;
    };
    const c = colour(d.color, INK.white);
    const o = this.register({ id: d.id, type: "revolution", color: c });
    const axisEnds = () => { const [a, b] = lim(); return [this.proj(mul(A, Math.min(0, a) - 0.6)), this.proj(mul(A, b + 1))]; };
    const axis = this.b.create("arrow", [this.dyn(() => axisEnds()[0]), this.dyn(() => axisEnds()[1])], { ...HIDDEN, strokeColor: INK.grey, strokeWidth: 2, lastArrow: { type: 2, size: 5 } });
    const region = this.dataCurve(() => {
      const [a, b] = lim(), phi = facePhi(), top = [], bottom = [];
      for (let k = 0; k <= 80; k++) { const u = a + ((b - a) * k) / 80; top.push(this.proj(P(u, outer(u), phi))); }
      for (let k = 80; k >= 0; k--) { const u = a + ((b - a) * k) / 80; bottom.push(this.proj(P(u, inner ? inner(u) : 0, phi))); }
      return [...top, ...bottom, top[0]];
    }, { ...HIDDEN, strokeColor: colour(d.profileColor ?? "yellow"), strokeWidth: 3, fillColor: colour(d.profileColor ?? "yellow"), fillOpacity: 0.22 });
    const out = this.multiCurve(() => outline(outer), { ...HIDDEN, strokeColor: c, strokeWidth: 3, lineCap: "round" });
    const ends = this.multiCurve(() => [...rimRuns(outer, lim()[0], -1, true), ...rimRuns(outer, lim()[1], 1, true)], { ...HIDDEN, strokeColor: c, strokeWidth: 3 });
    const hiddenLines = () => {
      const lines = [...rimRuns(outer, lim()[0], -1, false), ...rimRuns(outer, lim()[1], 1, false)];
      if (inner) {
        // The hole: its surface is inside, so its outline is hidden; its rim shows on an end face you can see.
        lines.push(...outline(inner));
        for (const [u, cap] of [[lim()[0], -1], [lim()[1], 1]]) if (dot(mul(A, cap), V()) <= 1e-9) lines.push(Array.from({ length: N + 1 }, (_, i) => this.proj(P(u, inner(u), phiOf(i)))));
      }
      return lines;
    };
    const hidden = this.multiCurve(hiddenLines, { ...HIDDEN, strokeColor: c, strokeWidth: 2.2, strokeOpacity: 0.75, dash: 2 });
    const holes = inner ? [this.multiCurve(() => [[lim()[0], -1], [lim()[1], 1]].filter(([, cap]) => dot(mul(A, cap), V()) > 1e-9).map(([u]) => Array.from({ length: N + 1 }, (_, i) => this.proj(P(u, inner(u), phiOf(i))))), { ...HIDDEN, strokeColor: c, strokeWidth: 3 })] : [];
    const slice = d.slice !== undefined ? [this.multiCurve(() => {
      const sv = this.ev(d.slice);
      const ring = (f) => Array.from({ length: N + 1 }, (_, i) => this.proj(P(sv, f(sv), phiOf(i))));
      return inner ? [ring(outer), ring(inner)] : [ring(outer)];
    }, { ...HIDDEN, strokeColor: colour(d.sliceColor ?? "cyan"), strokeWidth: 2.6, fillColor: colour(d.sliceColor ?? "cyan"), fillOpacity: 0.3 }, { evenodd: true })] : [];
    o.parts = { axis: [axis], region: [region], outline: [out], ends: [ends, ...holes], hidden: [hidden], slice };
    o.order = ["axis", "region", "outline", "ends", "hidden", "slice"];
  },
};

function splitFinite3(line) {
  const out = [];
  let cur = [];
  for (const p of line) {
    if (p.every(Number.isFinite)) cur.push(p);
    else if (cur.length) out.push(cur), (cur = []);
  }
  if (cur.length) out.push(cur);
  return out.filter((l) => l.length > 1);
}

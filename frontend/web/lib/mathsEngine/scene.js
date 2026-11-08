// Scene builder: turns a JSON scene spec into exact JSXGraph objects, all hidden until the pencil
// draws them. Nothing here knows any topic: a spec names general constructions (a point on a
// function, a root, an intersection picked by a rule, a tangent, an inequality, a transformation…)
// and every coordinate is computed from them. See maths-lab/SPEC.md for the format.
import { compile, formatNumber } from "./expr.js";
import * as G from "./geometry.js";
import { INK, colour, HIDDEN, FONT, MATH_FONT, isMathLetter, BOARD_BG } from "./style.js";

/** What a label says now (its template evaluated), or "" when it cannot be worked out yet. */
const safeText = (f) => { try { return String(f()); } catch { return ""; } };
import { insidePolygon } from "./contour.js";
import { TYPES_2D } from "./types2d.js";
import { TYPES_DATA } from "./typesdata.js";
import { TYPES_3D } from "./types3d.js";

export { INK, colour };

export class Scene {
  constructor(board, spec) {
    this.b = board;
    this.spec = spec;
    // Anything that can move (a param, a transformation's progress, a moved point) bumps the
    // version, so positions are worked out once per change, not every time they are asked for.
    this.version = 0;
    this.params = new Proxy({ ...(spec.params ?? {}) }, {
      set: (t, k, v) => {
        if (t[k] !== v) {
          t[k] = v;
          this.version++;
        }
        return true;
      },
    });
    this.objs = new Map();
    this.transforms = new Map();
    this.traces = [];
    this.labels = [];
    this.cache = new Map();
    this.frames = new Map();
    this.view = null;
    this.curFrame = null;
    this.problems = [];
    const [x0, y1, x1, y0] = board.getBoundingBox();
    this.bbox = { x0, x1, y0, y1 };
    this.unit = Math.min(x1 - x0, y1 - y0) / 12;
    this.buildEnv();
  }

  // ── Expressions: params, named values, function objects and geometry helpers ──────────────
  buildEnv() {
    const vars = {};
    for (const name of Object.keys(this.params)) Object.defineProperty(vars, name, { get: () => this.params[name], enumerable: true });
    for (const [name, src] of Object.entries(this.spec.values ?? {})) Object.defineProperty(vars, name, { get: () => this.ev(src), enumerable: true });
    const obj = (tree) => {
      if (tree.k !== "var") throw new Error("expected the name of an object");
      const o = this.objs.get(tree.name);
      if (!o) throw new Error(`no object "${tree.name}"`);
      return o;
    };
    const point = (tree) => {
      const o = obj(tree);
      if (!o.pos) throw new Error(`"${tree.name}" is not a point`);
      return o.pos();
    };
    const num = (tree, env, run) => run(tree, env);
    const fnOf = (tree) => {
      const o = obj(tree);
      if (o.fn) return o.fn;
      if (o.line) {
        const [p, q] = o.line();
        return (x) => p[1] + ((q[1] - p[1]) / (q[0] - p[0])) * (x - p[0]);
      }
      throw new Error(`"${tree.name}" is not a function`);
    };
    // A 3-D point answers with its 3-D coordinates; a 2-D point with its board ones.
    const space = (tree) => {
      const o = obj(tree);
      if (o.pos3) return o.pos3();
      if (!o.pos) throw new Error(`"${tree.name}" is not a point`);
      return o.pos();
    };
    const funcs = {
      X: ([a]) => space(a)[0],
      Y: ([a]) => space(a)[1],
      Z: ([a]) => space(a)[2] ?? 0,
      dist: ([a, b]) => {
        const p = space(a), q = space(b);
        return Math.hypot(q[0] - p[0], q[1] - p[1], (q[2] ?? 0) - (p[2] ?? 0));
      },
      angle: ([a, v, b]) => {
        const A = space(a), V = space(v), B = space(b);
        const u = [A[0] - V[0], A[1] - V[1], (A[2] ?? 0) - (V[2] ?? 0)], w = [B[0] - V[0], B[1] - V[1], (B[2] ?? 0) - (V[2] ?? 0)];
        const c = (u[0] * w[0] + u[1] * w[1] + u[2] * w[2]) / (Math.hypot(...u) * Math.hypot(...w));
        return (Math.acos(Math.max(-1, Math.min(1, c))) * 180) / Math.PI;
      },
      // slope(f, x) for a curve; slope(l) for a straight line.
      slope: ([f, x], env, run) => {
        const o = obj(f);
        if (o.line && x === undefined) {
          const [p, q] = o.line();
          return (q[1] - p[1]) / (q[0] - p[0]);
        }
        return G.slope(fnOf(f), num(x, env, run));
      },
      integral: ([f, a, b], env, run) => G.integral(fnOf(f), num(a, env, run), num(b, env, run)),
      // The trapezium rule with n strips: trap(f, a, b, n).
      trap: ([f, a, b, n], env, run) => {
        const F = fnOf(f), A = num(a, env, run), B = num(b, env, run), N = Math.max(1, Math.round(num(n, env, run)));
        const h = (B - A) / N;
        let s = (F(A) + F(B)) / 2;
        for (let i = 1; i < N; i++) s += F(A + i * h);
        return s * h;
      },
    };
    void point;
    this.env = { vars, funcs, rawArgs: new Set(Object.keys(funcs)) };
  }

  /** Function objects are callable in expressions: f(2). Added as each one is built. */
  addFunc(id, fn) {
    this.env.funcs[id] = (x) => fn(x);
  }

  compiled(src) {
    if (!this.cache.has(src)) this.cache.set(src, compile(src));
    return this.cache.get(src);
  }

  /** A number from a spec value: a number, or an expression string (with optional extra variables). */
  ev(v, extra) {
    if (typeof v === "number") return v;
    if (v === undefined || v === null) return NaN;
    const fn = this.compiled(String(v));
    if (!extra) return fn(this.env);
    const vars = Object.create(this.env.vars);
    Object.assign(vars, extra);
    return fn({ ...this.env, vars });
  }

  /** "gradient = {slope(f, t):1}" → live string. */
  template(src) {
    const parts = String(src).split(/(\{[^}]+\})/g).filter((s) => s !== "");
    const pieces = parts.map((p) => {
      const m = /^\{([^}:]+)(?::([^}]*))?\}$/.exec(p);
      if (!m) return () => p;
      return () => {
        try {
          return formatNumber(this.ev(m[1]), m[2]);
        } catch {
          return "?";
        }
      };
    });
    return () => pieces.map((f) => f()).join("");
  }

  /**
   * A point reference: an object id, or [x, y] with numbers or expressions. While an object with
   * "frame" is built, [x, y] is read in that frame (a tilted slope, say): x along it, y across it.
   */
  pointRef(ref) {
    if (typeof ref === "string") {
      const o = this.objs.get(ref);
      if (!o?.pos) throw new Error(`"${ref}" is not a point`);
      return () => o.pos();
    }
    if (Array.isArray(ref) && ref.length === 2) {
      const fr = this.curFrame;
      if (fr) return () => fr.toBoard([this.ev(ref[0]), this.ev(ref[1])]);
      return () => [this.ev(ref[0]), this.ev(ref[1])];
    }
    throw new Error(`can't read point ${JSON.stringify(ref)}`);
  }

  /** A frame: an origin and a direction for its x-axis (degrees, anticlockwise from the board's). */
  buildFrame(f) {
    const origin = this.pointRef(f.origin ?? [0, 0]);
    const angle = () => (this.ev(f.angle ?? 0) * Math.PI) / 180;
    this.frames.set(f.id, {
      id: f.id,
      angle,
      toBoard: ([u, v]) => {
        const o = origin(), a = angle();
        return [o[0] + u * Math.cos(a) - v * Math.sin(a), o[1] + u * Math.sin(a) + v * Math.cos(a)];
      },
    });
  }

  frameOf(id) {
    const f = this.frames.get(id);
    if (!f) throw new Error(`no frame "${id}"`);
    return f;
  }

  /** Board units for a length in screen pixels. */
  px(n) { return n / this.b.unitX; }
  py(n) { return n / this.b.unitY; }

  lineRef(ref) {
    if (Array.isArray(ref) && ref.length === 2 && (typeof ref[0] === "string" || Array.isArray(ref[0]))) {
      const p = this.pointRef(ref[0]), q = this.pointRef(ref[1]);
      return () => [p(), q()];
    }
    const o = this.objs.get(ref);
    if (!o?.line) throw new Error(`"${ref}" is not a line`);
    return () => o.line();
  }

  // ── JSXGraph helpers ───────────────────────────────────────────────────────────────────────
  dyn(get) {
    return [() => get()[0], () => get()[1]];
  }
  stroke(d, fallback, width = 3) {
    return { ...HIDDEN, strokeColor: colour(d.color, fallback), strokeWidth: d.width ?? width, strokeOpacity: d.opacity ?? 1, dash: d.dash ? 2 : 0, lineCap: "round" };
  }
  text(get, content, d, size = 24) {
    const t = this.b.create("text", [() => get()[0], () => get()[1], content], {
      ...HIDDEN, strokeColor: colour(d.labelColor ?? d.color, INK.white), fontSize: d.size ?? size,
      anchorX: "middle", anchorY: "middle", display: "html", cssStyle: isMathLetter(typeof content === "function" ? safeText(content) : content) ? MATH_FONT : FONT, parse: false, useMathJax: false,
    });
    // Known without rendering, so layout can see texts that are still hidden.
    t.__content = typeof content === "function" ? content : () => String(content);
    t.__size = d.size ?? size;
    return t;
  }

  /** A label attached to an object: its offset (in pixels) is chosen when it is drawn, so it lands clear of everything else. */
  label(o, textSrc, anchor, kind, d = {}) {
    if (textSrc === undefined || textSrc === false) return null;
    const src = textSrc === true ? o.id : String(textSrc);
    // The anchor may be a list of candidate points (along a curve): layout picks the clearest one.
    const candidates = Array.isArray(anchor) ? anchor : null;
    const lab = { offset: [0, 0], kind, pref: d.labelPos ?? "auto", obj: o, content: this.template(src), size: d.labelSize ?? 22, candidates, pick: 0 };
    lab.anchor = candidates ? () => candidates[lab.pick]() : anchor;
    const at = () => {
      const a = lab.anchor();
      return [a[0] + lab.offset[0] / this.b.unitX, a[1] - lab.offset[1] / this.b.unitY];
    };
    lab.el = this.text(at, lab.content, { color: d.labelColor ?? d.color, size: lab.size }, lab.size);
    lab.el.__label = lab;
    this.labels.push(lab);
    return lab.el;
  }

  /** A closed or open shape whose points are recomputed every update (fills, areas, shading). */
  dataCurve(points, attrs) {
    const c = this.b.create("curve", [[0], [0]], attrs);
    c.updateDataArray = function () {
      const pts = points();
      this.dataX = pts.map((p) => p[0]);
      this.dataY = pts.map((p) => p[1]);
    };
    return c;
  }

  register(o) {
    if (this.objs.has(o.id)) throw new Error(`two objects are called "${o.id}"`);
    o.hidden = (this.spec.objects ?? []).find((d) => d.id === o.id)?.hidden === true;
    this.objs.set(o.id, o);
    return o;
  }

  // ── Build everything in the spec, in order (later objects may refer to earlier ones) ───────
  build() {
    if (this.spec.board?.grid) this.buildGrid(this.spec.board.grid);
    if (this.spec.board?.axes) this.buildAxes(this.spec.board.axes);
    if (this.spec.board?.view) this.buildView(this.spec.board.view);
    const animated = new Set();
    for (const st of this.spec.steps ?? []) for (const a of [].concat(st.animate ?? [])) if (a.transform) animated.add(a.transform);
    for (const t of this.spec.transforms ?? []) this.buildTransform(t, animated.has(t.id));
    for (const f of this.spec.frames ?? []) this.buildFrame(f);
    for (const d of this.spec.objects ?? []) {
      try {
        const make = this[`make_${d.type}`];
        if (!make) throw new Error(`unknown type "${d.type}"`);
        this.curFrame = d.frame ? this.frameOf(d.frame) : null;
        make.call(this, d);
      } catch (err) {
        this.problems.push(`${d.id ?? "?"}: ${err.message}`);
      } finally {
        this.curFrame = null;
      }
    }
    for (const g of this.spec.groups ?? []) this.register({ id: g.id, type: "group", parts: { all: g.of.flatMap((id) => this.allInOrder(id)) }, order: ["all"] });
    this.b.update();
    for (const fn of this.afterBuild ?? []) fn();
    return this;
  }

  /** An object's elements in drawing order. */
  allInOrder(id) {
    const o = this.objs.get(id);
    if (!o) throw new Error(`group: no object "${id}"`);
    return o.order.flatMap((k) => o.parts[k] ?? []);
  }

  /** Squared paper over the board (no axes): "grid": 1, or { "step": 1, "x": [a, b], "y": [c, d] }. */
  buildGrid(g) {
    const { x0, x1, y0, y1 } = this.bbox;
    const step = this.ev(typeof g === "object" ? g.step ?? 1 : g === true ? 1 : g);
    const xr = typeof g === "object" && g.x ? g.x.map((v) => this.ev(v)) : [x0, x1];
    const yr = typeof g === "object" && g.y ? g.y.map((v) => this.ev(v)) : [y0, y1];
    const lines = [];
    const attrs = { ...HIDDEN, strokeColor: INK.white, strokeOpacity: 0.16, strokeWidth: 1 };
    for (let x = Math.ceil(xr[0] / step - 1e-9) * step; x <= xr[1] + 1e-9; x += step) lines.push(this.b.create("segment", [[x, yr[0]], [x, yr[1]]], attrs));
    for (let y = Math.ceil(yr[0] / step - 1e-9) * step; y <= yr[1] + 1e-9; y += step) lines.push(this.b.create("segment", [[xr[0], y], [xr[1], y]], attrs));
    for (const el of lines) el.__quick = true;
    this.register({ id: "grid", type: "grid", parts: { lines }, order: ["lines"] });
  }

  /**
   * Axes: arrows, ticks and numbers (and an optional grid). They cross at "at" (default the origin).
   * Ticks are a list (numbers, expressions such as "pi/2", or { "at": …, "label": "…" }) or a step;
   * "xFormat"/"yFormat" write the numbers ("pi" → π/2, "frac" → 3/4, or decimal places).
   */
  buildAxes(a) {
    const { x0, x1, y0, y1 } = this.bbox;
    const [cx, cy] = a.at ? [this.ev(a.at[0]), this.ev(a.at[1])] : [0, 0];
    const xr = Array.isArray(a.x) ? a.x.map((v) => this.ev(v)) : [x0 + (x1 - x0) * 0.04, x1 - (x1 - x0) * 0.03];
    const yr = Array.isArray(a.y) ? a.y.map((v) => this.ev(v)) : [y0 + (y1 - y0) * 0.05, y1 - (y1 - y0) * 0.04];
    const showX = a.x !== false, showY = a.y !== false;
    const arrow = (p, q) => this.b.create("arrow", [p, q], { ...HIDDEN, strokeColor: INK.white, strokeWidth: 2.5, lastArrow: { type: 2, size: 5 } });
    const xAxis = showX ? [arrow([xr[0], cy], [xr[1], cy])] : [];
    const yAxis = showY ? [arrow([cx, yr[0]], [cx, yr[1]])] : [];
    const tl = this.py(6), tlx = this.px(6);
    const ticks = [];
    const ticksOf = (spec, range, skip, fmt) => {
      const out = [];
      const put = (v, label) => {
        if (!Number.isFinite(v) || Math.abs(v - skip) < 1e-9 || v < range[0] - 1e-9 || v > range[1] + 1e-9) return;
        out.push({ v: G.tidy(v), label: label ?? formatNumber(G.tidy(v), fmt) });
      };
      if (Array.isArray(spec)) {
        for (const t of spec) {
          if (t && typeof t === "object") put(this.ev(t.at), t.label === undefined ? undefined : String(t.label));
          else put(this.ev(t));
        }
        return out;
      }
      const step = this.ev(spec ?? 1);
      if (!(step > 0)) return out;
      for (let k = Math.ceil((range[0] - skip) / step - 1e-9); skip + k * step <= range[1] - step * 0.3; k++) if (k !== 0) put(skip + k * step);
      return out;
    };
    const quietX = new Set((a.quietX ?? []).map((v) => G.tidy(this.ev(v)))), quietY = new Set((a.quietY ?? []).map((v) => G.tidy(this.ev(v))));
    const xt = showX ? ticksOf(a.xTicks, xr, cx, a.xFormat) : [], yt = showY ? ticksOf(a.yTicks, yr, cy, a.yFormat) : [];
    const numSize = a.numberSize ?? 18;
    for (const { v, label } of xt) {
      ticks.push(this.b.create("segment", [[v, cy - tl], [v, cy + tl]], { ...HIDDEN, strokeColor: INK.white, strokeWidth: 2 }));
      if (!quietX.has(v) && label !== "") ticks.push(this.text(() => [v, cy - this.py(18)], label, { color: "dim" }, numSize));
    }
    for (const { v, label } of yt) {
      ticks.push(this.b.create("segment", [[cx - tlx, v], [cx + tlx, v]], { ...HIDDEN, strokeColor: INK.white, strokeWidth: 2 }));
      // Numbers sit to the left of the axis, right-aligned by their width.
      const w = String(label).length * numSize * 0.42;
      if (!quietY.has(v) && label !== "") ticks.push(this.text(() => [cx - this.px(8 + w / 2), v], label, { color: "dim" }, numSize));
    }
    if (a.origin) ticks.push(this.text(() => [cx - this.px(12), cy - this.py(16)], String(a.origin), { color: "dim" }, numSize));
    const names = [];
    if (showX) {
      // A long name ("mass (g)") sits above the end of the axis, ending at the arrow.
      const xl = String(a.xLabel ?? "x");
      const w = xl.length * 20 * 0.42;
      names.push(this.text(() => [xr[1] - this.px(xl.length > 2 ? 6 + w / 2 : 8), cy + this.py(16)], xl, { color: "dim" }, 20));
    }
    if (showY) {
      const yl = String(a.yLabel ?? "y");
      // A long name ("Frequency density") goes beside the top of the axis, not on it.
      const w = yl.length * 20 * 0.42;
      names.push(this.text(() => [cx + this.px(yl.length > 2 ? 12 + w / 2 : 14), yr[1] - this.py(6)], yl, { color: "dim" }, 20));
    }
    const grid = [];
    if (a.grid) {
      const gx = a.gridStep ? ticksOf(a.gridStep, xr, cx) : xt, gy = a.gridStep ? ticksOf(a.gridStep, yr, cy) : yt;
      for (const { v } of gx) grid.push(this.b.create("segment", [[v, yr[0]], [v, yr[1]]], { ...HIDDEN, strokeColor: INK.white, strokeOpacity: 0.12, strokeWidth: 1 }));
      for (const { v } of gy) grid.push(this.b.create("segment", [[xr[0], v], [xr[1], v]], { ...HIDDEN, strokeColor: INK.white, strokeOpacity: 0.12, strokeWidth: 1 }));
    }
    // Ticks, numbers and the grid are drawn in one quick pass, not one by one.
    for (const el of [...ticks, ...names, ...grid]) el.__quick = true;
    this.register({ id: "axes", parts: { grid, x: xAxis, y: yAxis, ticks: [...ticks, ...names] }, order: ["grid", "x", "y", "ticks"] });
  }

  buildTransform(t, animated) {
    const self = this;
    let progress = animated ? 0 : 1;
    const tf = {
      id: t.id,
      get s() { return progress; },
      set s(v) { if (v !== progress) { progress = v; self.version++; } },
      get() {
        const out = { kind: t.kind };
        if (t.center !== undefined) out.center = self.pointRef(t.center)();
        if (t.angle !== undefined) out.angle = self.ev(t.angle);
        if (t.factor !== undefined) out.factor = self.ev(t.factor);
        if (t.line !== undefined) out.line = self.lineRef(t.line)();
        if (t.vector !== undefined) {
          if (typeof t.vector === "string") {
            const [p, q] = self.lineRef(t.vector)();
            out.vector = G.sub(q, p);
          } else out.vector = [self.ev(t.vector[0]), self.ev(t.vector[1])];
        }
        return out;
      },
    };
    this.transforms.set(t.id, tf);
  }

  // ── Points ─────────────────────────────────────────────────────────────────────────────────
  make_point(d) {
    let pos;
    if (d.at) {
      const self = this;
      let moved = null;
      const state = { get p() { return moved; }, set p(v) { moved = v; self.version++; } };
      const base = this.pointRef(d.at);
      pos = () => state.p ?? base();
      pos.state = state;
    } else if (d.on) {
      const f = this.fnOf(d.on);
      pos = () => {
        const x = this.ev(d.x);
        return [x, f(x)];
      };
    } else if (d.root) {
      const f = this.fnOf(d.root);
      pos = () => [G.rootNear(f, this.ev(d.near ?? 0)), 0];
    } else if (d.turning) {
      const f = this.fnOf(d.turning);
      pos = () => {
        const x = G.turningNear(f, this.ev(d.near ?? 0));
        return [x, f(x)];
      };
    } else if (d.intersect) {
      pos = this.intersection(d.intersect, d.pick);
    } else if (d.midpoint) {
      const p = this.pointRef(d.midpoint[0]), q = this.pointRef(d.midpoint[1]);
      pos = () => G.mid(p(), q());
    } else if (d.onCircle) {
      const c = this.objs.get(d.onCircle);
      if (!c?.circle) throw new Error(`"${d.onCircle}" is not a circle`);
      pos = () => {
        const { c: ctr, r } = c.circle();
        const a = (this.ev(d.angle) * Math.PI) / 180;
        return [ctr[0] + r * Math.cos(a), ctr[1] + r * Math.sin(a)];
      };
    } else if (d.foot) {
      const p = this.pointRef(d.foot[0]), l = this.lineRef(d.foot[1]);
      pos = () => G.foot(p(), ...l());
    } else if (d.image) {
      const src = this.pointRef(d.image.of), tf = this.tf(d.image.by);
      pos = () => G.transformPoint(src(), tf.get(), tf.s);
    } else throw new Error("a point needs at, on, root, turning, intersect, midpoint, onCircle, foot or image");
    const raw = pos;
    pos = this.memo(raw);
    pos.state = raw.state;
    const o = this.register({ id: d.id, type: "point", color: colour(d.color), pos, imageOf: d.image?.by });
    const el = this.pointMark(pos, d);
    o.parts = { point: [el], label: [this.label(o, d.label, pos, "point", d)].filter(Boolean) };
    o.order = ["point", "label"];
  }

  /** A point's mark: a dot (default), "x" (a plotted cross), "+" or "open" (a hollow circle). */
  pointMark(pos, d, fallback = INK.white) {
    const c = colour(d.color, fallback);
    const m = d.marker ?? "dot";
    const face = { dot: "o", x: "x", "+": "+", open: "o" }[m] ?? "o";
    const size = d.size ?? (m === "x" || m === "+" ? 5 : m === "open" ? 4.5 : 3.5);
    return this.b.create("point", this.dyn(pos), {
      ...HIDDEN, name: "", withLabel: false, size, face, strokeColor: c, strokeWidth: m === "dot" ? 2 : 2.5,
      fillColor: m === "open" ? BOARD_BG : c, fillOpacity: 1,
    });
  }

  tf(id) {
    const tf = this.transforms.get(id);
    if (!tf) throw new Error(`no transform "${id}"`);
    return tf;
  }

  /** A function of nothing, worked out again only when something has moved. */
  memo(fn) {
    let at = -1, value;
    return () => {
      if (at !== this.version) {
        value = fn();
        at = this.version;
      }
      return value;
    };
  }

  /** A function y = f(x): a function object, a polyline through data, or a (non-vertical) straight line. */
  fnOf(id) {
    const o = this.objs.get(id);
    if (o?.fn) return o.fn;
    if (o?.line) return (x) => lineFn(o.line())(x);
    throw new Error(`"${id}" is not a function or a line`);
  }

  intersection(ids, rule) {
    const shapes = ids.map((id) => {
      const o = this.objs.get(id);
      if (!o) throw new Error(`no object "${id}"`);
      return o;
    });
    const ruleOf = () => (Array.isArray(rule) ? [this.ev(rule[0]), this.ev(rule[1])] : rule ?? "left");
    return this.memo(() => {
      const [a, b] = shapes;
      let sols = [];
      if (a.line && b.line) sols = G.lineLine(...a.line(), ...b.line());
      else if (a.line && b.circle) sols = G.lineCircle(...a.line(), b.circle().c, b.circle().r);
      else if (a.circle && b.line) sols = G.lineCircle(...b.line(), a.circle().c, a.circle().r);
      else if (a.circle && b.circle) sols = G.circleCircle(a.circle().c, a.circle().r, b.circle().c, b.circle().r);
      else {
        const fa = a.fn ?? (a.line ? lineFn(a.line()) : null), fb = b.fn ?? (b.line ? lineFn(b.line()) : null);
        if (!fa || !fb) throw new Error("can't intersect these two");
        const lo = Math.max(a.domain?.()[0] ?? this.bbox.x0, b.domain?.()[0] ?? this.bbox.x0);
        const hi = Math.min(a.domain?.()[1] ?? this.bbox.x1, b.domain?.()[1] ?? this.bbox.x1);
        sols = G.curveCurve(fa, fb, lo, hi);
      }
      return G.pick(sols, ruleOf());
    });
  }

  // ── Lines ──────────────────────────────────────────────────────────────────────────────────
  lineEnds(d) {
    if (d.from !== undefined && d.to !== undefined) {
      const p = this.pointRef(d.from), q = this.pointRef(d.to);
      return () => [p(), q()];
    }
    if (d.through !== undefined && d.gradient !== undefined) {
      const p = this.pointRef(d.through);
      return () => {
        const a = p();
        return [a, [a[0] + 1, a[1] + this.ev(d.gradient)]];
      };
    }
    if (d.through !== undefined && (d.parallelTo || d.perpendicularTo)) {
      const p = this.pointRef(d.through), l = this.lineRef(d.parallelTo ?? d.perpendicularTo);
      return () => {
        const a = p(), [u, v] = l();
        let dir = G.sub(v, u);
        if (d.perpendicularTo) dir = [-dir[1], dir[0]];
        return [a, G.add(a, dir)];
      };
    }
    if (d.from !== undefined && d.angle !== undefined) {
      // From a point, in a direction (degrees; within the object's frame, if it has one) for a length.
      const p = this.pointRef(d.from), fr = this.curFrame;
      return () => {
        const a = p();
        const th = (this.ev(d.angle) * Math.PI) / 180 + (fr ? fr.angle() : 0);
        const L = this.ev(d.length ?? 1);
        return [a, [a[0] + L * Math.cos(th), a[1] + L * Math.sin(th)]];
      };
    }
    if (d.vertical !== undefined) return () => [[this.ev(d.vertical), 0], [this.ev(d.vertical), 1]];
    if (d.horizontal !== undefined) return () => [[0, this.ev(d.horizontal)], [1, this.ev(d.horizontal)]];
    throw new Error("a line needs from and to, through with gradient, parallelTo or perpendicularTo, vertical or horizontal");
  }

  makeLinear(d, kind) {
    const ends = this.lineEnds(d);
    const o = this.register({ id: d.id, type: kind, color: colour(d.color), line: ends });
    const p = () => ends()[0], q = () => ends()[1];
    const attrs = this.stroke(d, INK.white, 3);
    let el;
    if (kind === "segment") el = this.b.create("segment", [this.dyn(p), this.dyn(q)], attrs);
    else if (kind === "vector") el = this.b.create("arrow", [this.dyn(p), this.dyn(q)], { ...attrs, lastArrow: { type: 2, size: 5 } });
    else el = this.b.create("line", [this.dyn(p), this.dyn(q)], { ...attrs, straightFirst: kind === "line", straightLast: true });
    const mid = () => {
      if (kind === "segment" || kind === "vector") return G.mid(p(), q());
      // An infinite line's label sits where it leaves the board on the right (or the top).
      return this.edgePoint(p(), q());
    };
    const marks = kind === "segment" || kind === "vector" ? this.edgeMarks(ends, d.marks, d.parallel, d) : [];
    o.parts = { line: [el], marks, label: [this.label(o, d.label, mid, kind === "line" ? "edge" : "segment", d)].filter(Boolean) };
    o.order = ["line", "marks", "label"];
    o.ends = ends;
  }

  /**
   * Equal-length ticks (marks: 1, 2, 3) and parallel arrows (parallel: 1, 2) at the middle of a
   * segment, sized in screen pixels so they look the same on every board.
   */
  edgeMarks(ends, ticks = 0, arrows = 0, d = {}) {
    const out = [];
    const ux = this.b.unitX, uy = this.b.unitY;
    const frame = () => {
      const [p, q] = ends();
      let dx = (q[0] - p[0]) * ux, dy = (q[1] - p[1]) * uy;
      // Parallel sides carry arrows pointing the same way: always rightwards (or up, if vertical).
      if (dx < -1e-9 || (Math.abs(dx) <= 1e-9 && dy < 0)) (dx = -dx), (dy = -dy);
      const L = Math.hypot(dx, dy) || 1;
      const u = [dx / L, dy / L], n = [-u[1], u[0]];
      const m = G.mid(p, q);
      // Pixel offsets (along u, along n) → board coordinates.
      return (a, b) => [m[0] + (a * u[0] + b * n[0]) / ux, m[1] + (a * u[1] + b * n[1]) / uy];
    };
    const attrs = { ...HIDDEN, strokeColor: colour(d.markColor ?? d.color, INK.white), strokeWidth: 2.2, lineCap: "round" };
    for (let k = 0; k < (ticks ?? 0); k++) {
      const off = (k - (ticks - 1) / 2) * 6;
      const el = this.dataCurve(() => { const at = frame(); return [at(off, -7), at(off, 7)]; }, attrs);
      el.__small = true;
      out.push(el);
    }
    for (let k = 0; k < (arrows ?? 0); k++) {
      const off = (k - (arrows - 1) / 2) * 8;
      const el = this.dataCurve(() => { const at = frame(); return [at(off - 5, -6), at(off + 2, 0), at(off - 5, 6)]; }, attrs);
      el.__small = true;
      out.push(el);
    }
    return out;
  }
  make_segment(d) { this.makeLinear(d, "segment"); }
  make_vector(d) { this.makeLinear(d, "vector"); }
  make_line(d) { this.makeLinear(d, "line"); }
  make_ray(d) { this.makeLinear(d, "ray"); }

  /** Where the line through p, q is about to leave the board, towards its right or top end. */
  edgePoint(p, q) {
    const { x0, x1, y0, y1 } = this.bbox;
    const pad = 0.09;
    const X0 = x0 + (x1 - x0) * pad, X1 = x1 - (x1 - x0) * pad, Y0 = y0 + (y1 - y0) * pad, Y1 = y1 - (y1 - y0) * pad;
    const box = [[X0, Y0], [X1, Y0], [X1, Y1], [X0, Y1]];
    let best = null;
    for (let i = 0; i < 4; i++) {
      const hit = G.lineLine(p, q, box[i], box[(i + 1) % 4])[0];
      if (!hit) continue;
      if (hit[0] < X0 - 1e-9 || hit[0] > X1 + 1e-9 || hit[1] < Y0 - 1e-9 || hit[1] > Y1 + 1e-9) continue;
      if (!best || hit[0] + hit[1] * 0.01 > best[0] + best[1] * 0.01) best = hit;
    }
    return best ?? G.mid(p, q);
  }

  // ── Curves ─────────────────────────────────────────────────────────────────────────────────
  make_function(d) {
    const fn = (x) => this.ev(d.expr, { x });
    const domain = () => (d.domain ? [this.ev(d.domain[0]), this.ev(d.domain[1])] : [this.bbox.x0, this.bbox.x1]);
    const o = this.register({ id: d.id, type: "function", color: colour(d.color, INK.yellow), fn, domain });
    this.addFunc(d.id, fn);
    const el = this.b.create("functiongraph", [fn, () => domain()[0], () => domain()[1]], { ...this.stroke(d, INK.yellow, 3.5), numberPointsHigh: 600 });
    const end = () => {
      // Its label goes near the right end of the part that is on the board.
      const [a, b] = domain();
      for (let i = 0; i <= 40; i++) {
        const x = b - ((b - a) * i) / 40;
        const y = fn(x);
        if (y > this.bbox.y0 && y < this.bbox.y1 - (this.bbox.y1 - this.bbox.y0) * 0.08) return [x, y];
      }
      return [b, fn(b)];
    };
    // Other places along the curve the label may sit, if the end is crowded.
    const along = (f) => () => {
      const [a, b] = domain();
      const x = a + (b - a) * f, y = fn(x);
      return y > this.bbox.y0 && y < this.bbox.y1 ? [x, y] : [NaN, NaN];
    };
    const anchors = d.labelAt !== undefined ? [() => { const x = this.ev(d.labelAt); return [x, fn(x)]; }] : [end, along(0.8), along(0.62), along(0.45), along(0.28)];
    o.parts = { curve: [el], label: [this.label(o, d.label, anchors, "curve", d)].filter(Boolean) };
    o.order = ["curve", "label"];
  }

  make_curve(d) {
    const X = (t) => this.ev(d.x, { t }), Y = (t) => this.ev(d.y, { t });
    const range = () => [this.ev(d.t?.[0] ?? 0), this.ev(d.t?.[1] ?? 1)];
    const o = this.register({ id: d.id, type: "curve", color: colour(d.color) });
    const el = this.b.create("curve", [X, Y, () => range()[0], () => range()[1]], { ...this.stroke(d, INK.white, 3), numberPointsHigh: 500 });
    o.parts = { curve: [el], label: [this.label(o, d.label, () => [X(range()[1]), Y(range()[1])], "curve", d)].filter(Boolean) };
    o.order = ["curve", "label"];
  }

  /**
   * The angle (radians) at which a closed shape's label sits on its edge: given, or chosen among
   * 16 directions — not inside another circle or oval (a Venn diagram), away from the board's
   * middle, and on the upper side when there is a choice.
   */
  outsideAngle(centre, given, radius = () => 1, selfId = null) {
    if (given !== undefined) return () => (this.ev(given) * Math.PI) / 180;
    return this.memo(() => {
      const c = centre(), r = radius();
      const { x0, x1, y0, y1 } = this.bbox;
      const dx = (c[0] - (x0 + x1) / 2) * this.b.unitX, dy = (c[1] - (y0 + y1) / 2) * this.b.unitY;
      const far = Math.hypot(dx, dy) > Math.min(this.b.canvasWidth, this.b.canvasHeight) * 0.12;
      const away = Math.atan2(dy, dx);
      const others = [...this.objs.values()].filter((o) => o.id !== selfId && (o.circle || (o.type === "ellipse" && o.poly)));
      let best = null;
      for (let k = 0; k < 16; k++) {
        const a = (k * Math.PI) / 8;
        const p = [c[0] + 1.15 * r * Math.cos(a), c[1] + 1.15 * r * Math.sin(a)];
        let score = 0.1 * (1 - Math.cos(a - Math.PI / 4));
        for (const o of others) {
          if (o.circle) {
            const q = o.circle();
            if (Math.hypot(p[0] - q.c[0], p[1] - q.c[1]) < q.r) score += 10;
          } else if (insidePolygon(o.poly(), p[0], p[1])) score += 10;
        }
        if (far) score -= 2 * Math.cos(a - away);
        if (Math.sin(a) < -0.2) score += 0.8;
        if (!best || score < best.score) best = { score, a };
      }
      return best.a;
    });
  }

  compassOf(angle) {
    const names = ["e", "ne", "n", "nw", "w", "sw", "s", "se"];
    return names[((Math.round(angle / (Math.PI / 4)) % 8) + 8) % 8];
  }

  make_circle(d) {
    const c = this.pointRef(d.center);
    const r = d.through !== undefined ? (() => { const t = this.pointRef(d.through); return () => G.dist(c(), t()); })() : () => this.ev(d.radius);
    const o = this.register({ id: d.id, type: "circle", color: colour(d.color), circle: () => ({ c: c(), r: r() }), sdf: (x, y) => r() - Math.hypot(x - c()[0], y - c()[1]) });
    const fill = d.fill ? { fillColor: colour(d.fill), fillOpacity: d.fillOpacity ?? 0.25 } : {};
    const el = this.b.create("curve", [(t) => c()[0] + r() * Math.cos(t), (t) => c()[1] + r() * Math.sin(t), 0, 2 * Math.PI], { ...this.stroke(d, INK.white, 3), ...fill, numberPointsHigh: 400 });
    const la = this.outsideAngle(c, d.labelAngle, r, d.id);
    o.parts = { circle: [el], label: [this.label(o, d.label, () => [c()[0] + r() * Math.cos(la()), c()[1] + r() * Math.sin(la())], "point", { ...d, labelPos: d.labelPos ?? (() => this.compassOf(la())) })].filter(Boolean) };
    o.order = ["circle", "label"];
  }

  arcParts(d) {
    const c = this.pointRef(d.center);
    const k = d.units === "rad" ? 1 : Math.PI / 180;
    const a0 = () => this.ev(d.from) * k, a1 = () => this.ev(d.to) * k;
    const r = () => this.ev(d.radius);
    return { c, a0, a1, r };
  }

  make_arc(d) {
    const { c, a0, a1, r } = this.arcParts(d);
    const o = this.register({ id: d.id, type: "arc", color: colour(d.color) });
    const el = this.b.create("curve", [(t) => c()[0] + r() * Math.cos(t), (t) => c()[1] + r() * Math.sin(t), a0, a1], { ...this.stroke(d, INK.white, 3), numberPointsHigh: 300 });
    const midA = () => (a0() + a1()) / 2;
    o.parts = { arc: [el], label: [this.label(o, d.label, () => [c()[0] + r() * Math.cos(midA()), c()[1] + r() * Math.sin(midA())], "point", d)].filter(Boolean) };
    o.order = ["arc", "label"];
  }

  make_sector(d) {
    const { c, a0, a1, r } = this.arcParts(d);
    const o = this.register({ id: d.id, type: "sector", color: colour(d.color, INK.green) });
    const pts = (o.poly = () => {
      const out = [c()];
      for (let i = 0; i <= 80; i++) {
        const a = a0() + ((a1() - a0()) * i) / 80;
        out.push([c()[0] + r() * Math.cos(a), c()[1] + r() * Math.sin(a)]);
      }
      out.push(c());
      return out;
    });
    const el = this.dataCurve(pts, { ...this.stroke(d, INK.green, 1.5), fillColor: colour(d.fill ?? d.color, INK.green), fillOpacity: d.fillOpacity ?? 0.3 });
    o.parts = { sector: [el], label: [this.label(o, d.label, () => { const m = (a0() + a1()) / 2; return [c()[0] + r() * 0.55 * Math.cos(m), c()[1] + r() * 0.55 * Math.sin(m)]; }, "inside", d)].filter(Boolean) };
    o.order = ["sector", "label"];
  }

  make_polygon(d) {
    let verts;
    if (d.image) {
      const src = this.objs.get(d.image.of);
      if (!src?.verts) throw new Error(`"${d.image.of}" is not a polygon`);
      const tf = this.tf(d.image.by);
      verts = src.verts.map((v) => () => G.transformPoint(v(), tf.get(), tf.s));
    } else verts = d.points.map((p) => this.pointRef(p));
    const o = this.register({ id: d.id, type: "polygon", color: colour(d.color), verts, poly: () => verts.map((v) => v()), imageOf: d.image?.by });
    // Each vertex is a point the spec can refer to: T.1, T.2, …
    verts.forEach((v, i) => this.register({ id: `${d.id}.${i + 1}`, type: "point", pos: v, parts: {}, order: [] }));
    const n = verts.length;
    const edges = verts.map((v, i) => this.b.create("segment", [this.dyn(v), this.dyn(verts[(i + 1) % n])], this.stroke(d, INK.white, 3)));
    // Per-edge equal-length ticks and parallel arrows: "edgeMarks": [1, 1, 0], "parallelMarks": [1, 0, 1, 0].
    const marks = verts.flatMap((v, i) => this.edgeMarks(() => [v(), verts[(i + 1) % n]()], d.edgeMarks?.[i] ?? 0, d.parallelMarks?.[i] ?? 0, d));
    const fill = d.fill ? [this.dataCurve(() => [...o.poly(), o.poly()[0]], { ...HIDDEN, strokeWidth: 0, strokeOpacity: 0, fillColor: colour(d.fill), fillOpacity: d.fillOpacity ?? 0.25 })] : [];
    const centroid = () => {
      const p = o.poly();
      return [p.reduce((s, q) => s + q[0], 0) / p.length, p.reduce((s, q) => s + q[1], 0) / p.length];
    };
    o.parts = { edges, marks, fill, label: [this.label(o, d.label, centroid, "inside", d)].filter(Boolean) };
    o.order = ["edges", "marks", "fill", "label"];
  }

  make_tangent(d, normal = false) {
    const f = this.fnOf(d.to);
    const len = () => this.ev(d.length ?? 2);
    const ends = () => {
      const x = this.ev(d.at);
      const m = G.slope(f, x);
      let dir = [1, m];
      if (normal) dir = [-m, 1];
      const n = Math.hypot(...dir);
      const u = [dir[0] / n, dir[1] / n];
      const p = [x, f(x)];
      return [G.add(p, G.scale(u, -len() / 2)), G.add(p, G.scale(u, len() / 2))];
    };
    const o = this.register({ id: d.id, type: "segment", color: colour(d.color, INK.cyan), line: ends });
    const el = this.b.create("segment", [this.dyn(() => ends()[0]), this.dyn(() => ends()[1])], this.stroke(d, INK.cyan, 3));
    o.parts = { line: [el], label: [this.label(o, d.label, () => ends()[1], "point", d)].filter(Boolean) };
    o.order = ["line", "label"];
  }
  make_normal(d) { this.make_tangent(d, true); }

  make_area(d) {
    const top = d.under ? this.fnOf(d.under) : this.fnOf(d.between[0]);
    const bottom = d.under ? () => 0 : this.fnOf(d.between[1]);
    const lims = () => [this.ev(d.from), this.ev(d.to)];
    const pts = () => {
      const [a, b] = lims();
      const out = [];
      for (let i = 0; i <= 120; i++) { const x = a + ((b - a) * i) / 120; out.push([x, top(x)]); }
      for (let i = 120; i >= 0; i--) { const x = a + ((b - a) * i) / 120; out.push([x, bottom(x)]); }
      out.push(out[0]);
      return out;
    };
    const o = this.register({ id: d.id, type: "area", color: colour(d.color, INK.green), poly: pts });
    const el = this.dataCurve(pts, { ...this.stroke(d, INK.green, 1.5), fillColor: colour(d.fill ?? d.color, INK.green), fillOpacity: d.fillOpacity ?? 0.35 });
    const inside = () => {
      const [a, b] = lims();
      const x = (a + b) / 2;
      return [x, (top(x) + bottom(x)) / 2.4];
    };
    o.parts = { area: [el], label: [this.label(o, d.label, inside, "inside", d)].filter(Boolean) };
    o.order = ["area", "label"];
  }

  /** "x + y < 5": the boundary line (broken if strict) and the shading of the side NOT wanted (Cambridge convention). */
  make_inequality(d) {
    const m = /^(.*?)(<=|>=|≤|≥|<|>)(.*)$/.exec(String(d.expr));
    if (!m) throw new Error(`"${d.expr}" is not an inequality`);
    const op = { "≤": "<=", "≥": ">=" }[m[2]] ?? m[2];
    const strict = op === "<" || op === ">";
    const L = (x, y) => this.ev(m[1], { x, y }) - this.ev(m[3], { x, y });
    const c = L(0, 0), a = L(1, 0) - c, b = L(0, 1) - c;
    for (const [x, y] of [[2, 3], [-1.5, 0.7]]) if (Math.abs(L(x, y) - (a * x + b * y + c)) > 1e-6) throw new Error("only straight-line inequalities are supported");
    const holds = (x, y) => {
      const v = L(x, y);
      return op === "<" ? v < 0 : op === "<=" ? v <= 1e-12 : op === ">" ? v > 0 : v >= -1e-12;
    };
    const { x0, x1, y0, y1 } = this.bbox;
    const ends = () => (Math.abs(b) > 1e-12 ? [[x0, (-c - a * x0) / b], [x1, (-c - a * x1) / b]] : [[-c / a, y0], [-c / a, y1]]);
    const n = Math.hypot(a, b) || 1;
    const sdf = (x, y) => (op === "<" || op === "<=" ? -L(x, y) : L(x, y)) / n;
    const o = this.register({ id: d.id, type: "inequality", color: colour(d.color), line: ends, keep: holds, sdf });
    const line = this.b.create("line", [this.dyn(() => ends()[0]), this.dyn(() => ends()[1])], { ...this.stroke({ ...d, dash: strict }, INK.white, 3), straightFirst: true, straightLast: true });
    const rect = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
    const unwanted = G.clipPolygon(rect, (x, y) => !holds(x, y), L);
    const shade = this.dataCurve(() => (unwanted.length ? [...unwanted, unwanted[0]] : []), { ...HIDDEN, strokeWidth: 0, strokeOpacity: 0, fillColor: INK.shade, fillOpacity: d.shadeOpacity ?? 0.42 });
    o.parts = { line: [line], label: [this.label(o, d.label, () => this.edgePoint(...ends()), "edge", d)].filter(Boolean), shade: [shade] };
    o.order = ["line", "label", "shade"];
  }

  /** The region where all the listed inequalities hold: only its label is drawn (e.g. "R"). */
  make_feasible(d) {
    const ineqs = d.of.map((id) => {
      const o = this.objs.get(id);
      if (!o?.keep) throw new Error(`"${id}" is not an inequality`);
      return o;
    });
    const { x0, x1, y0, y1 } = this.bbox;
    let poly = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
    for (const q of ineqs) {
      const [p1, p2] = q.line();
      const val = (x, y) => G.cross(G.sub(p2, p1), G.sub([x, y], p1));
      poly = G.clipPolygon(poly, q.keep, val);
    }
    const centre = poly.length ? [poly.reduce((s, p) => s + p[0], 0) / poly.length, poly.reduce((s, p) => s + p[1], 0) / poly.length] : [NaN, NaN];
    const o = this.register({ id: d.id, type: "feasible", color: colour(d.color, INK.yellow), poly: () => poly });
    const el = this.text(() => centre, this.template(d.label ?? "R"), { color: d.color ?? "yellow", size: d.size }, 34);
    o.parts = { label: [el] };
    o.order = ["label"];
  }

  /** An angle mark at V between V→A and V→B, always the angle inside (≤ 180°); a square when it is 90°. */
  make_angle(d) {
    const [A, V, B] = d.points.map((p) => this.pointRef(p));
    const r = () => this.ev(d.radius ?? this.unit * 0.75);
    const dirs = () => {
      const v = V();
      const a0 = Math.atan2(A()[1] - v[1], A()[0] - v[0]);
      let delta = Math.atan2(B()[1] - v[1], B()[0] - v[0]) - a0;
      while (delta > Math.PI) delta -= 2 * Math.PI;
      while (delta < -Math.PI) delta += 2 * Math.PI;
      return { v, a0, delta };
    };
    const isRight = () => Math.abs(Math.abs(dirs().delta) - Math.PI / 2) < 1e-6;
    const pts = () => {
      const { v, a0, delta } = dirs();
      if (isRight() && d.square !== false) {
        const s = r() * 0.7;
        const u = [Math.cos(a0), Math.sin(a0)], w = [Math.cos(a0 + delta), Math.sin(a0 + delta)];
        return [G.add(v, G.scale(u, s)), G.add(v, G.scale(G.add(u, w), s)), G.add(v, G.scale(w, s))];
      }
      const out = [];
      for (let i = 0; i <= 40; i++) out.push([v[0] + r() * Math.cos(a0 + (delta * i) / 40), v[1] + r() * Math.sin(a0 + (delta * i) / 40)]);
      return out;
    };
    const o = this.register({ id: d.id, type: "angle", color: colour(d.color, INK.orange) });
    const el = this.dataCurve(pts, this.stroke(d, INK.orange, 2.5));
    const at = () => {
      const { v, a0, delta } = dirs();
      const m = a0 + delta / 2;
      const k = r() * (d.labelDistance ?? 1.9);
      return [v[0] + k * Math.cos(m), v[1] + k * Math.sin(m)];
    };
    const text = d.label === "auto" || d.label === undefined ? (d.label === undefined ? undefined : `{angle(${d.points.join(",")}):${d.dp ?? 0}}°`) : d.label;
    const lab = text === undefined ? null : this.text(at, this.template(text), d, 22);
    o.parts = { mark: [el], label: lab ? [lab] : [] };
    o.order = ["mark", "label"];
  }

  make_text(d) {
    const at = d.at ? this.pointRef(d.at) : null;
    const anchorObj = d.anchor ? this.objs.get(d.anchor) : null;
    const o = this.register({ id: d.id, type: "text", color: colour(d.color) });
    let el;
    if (anchorObj?.pos || anchorObj?.line) {
      const anchor = anchorObj.pos ?? (() => G.mid(...anchorObj.line()));
      el = this.label(o, d.text, anchor, anchorObj.pos ? "point" : "segment", d);
    } else {
      if (!at) throw new Error("a text needs at [x, y] or an anchor object");
      el = this.text(at, this.template(d.text), d, d.size ?? 24);
    }
    o.parts = { text: [el] };
    o.order = ["text"];
  }

  /** The path a point leaves behind while it moves (a locus, or a curve being traced out). */
  make_trace(d) {
    const src = this.objs.get(d.of);
    if (!src?.pos) throw new Error(`"${d.of}" is not a point`);
    const pts = [];
    const o = this.register({ id: d.id, type: "trace", color: colour(d.color) });
    const el = this.dataCurve(() => pts, this.stroke(d, INK.white, 3));
    o.parts = { trace: [el] };
    o.order = ["trace"];
    this.traces.push({ el, src, pts });
  }

  /** Two-stage (or deeper) probability tree. Parts: "1" (first stage), each first-stage label ("R"), and "path.R.R". */
  make_tree(d) {
    const root = this.pointRef(d.at ?? [0, 0])();
    const dx = d.stageWidth ?? 3;
    const spread = d.spread ?? [3, 1.8];
    const gap = d.labelGap ?? 0.55;
    const o = this.register({ id: d.id, type: "tree", color: INK.white });
    o.parts = {};
    o.order = [];
    const seg = (p, q, attrs) => this.b.create("segment", [p, q], attrs);
    const walk = (branches, from, depth, path) => {
      const n = branches.length;
      const ys = branches.map((_, i) => from[1] + (spread[depth] ?? spread[spread.length - 1]) * ((n - 1) / 2 - i));
      const key = depth === 0 ? "1" : path.join(".");
      o.parts[key] = o.parts[key] ?? [];
      o.order.push(key);
      branches.forEach((br, i) => {
        const end = [from[0] + dx, ys[i]];
        const start = depth === 0 ? from : [from[0] + gap, from[1]];
        const c = colour(br.color, INK.white);
        const midp = G.mid(start, end);
        const above = ys[i] >= from[1];
        o.parts[key].push(seg(start, end, { ...HIDDEN, strokeColor: INK.white, strokeWidth: 2.5 }));
        o.parts[key].push(this.text(() => [end[0] + 0.32, end[1]], String(br.label), { color: br.color }, 24));
        if (br.p !== undefined) o.parts[key].push(this.text(() => [midp[0] - 0.15, midp[1] + (above ? 0.38 : -0.38)], String(br.p), { color: br.color }, 20));
        const here = [...path, br.label];
        // The path highlight for this branch, drawn only when a step asks for it.
        const hl = `path.${here.join(".")}`;
        const prev = path.length ? o.parts[`path.${path.join(".")}`] ?? [] : [];
        o.parts[hl] = [...prev, seg(start, end, { ...HIDDEN, strokeColor: INK.yellow, strokeWidth: 6 })];
        if (br.outcome !== undefined) o.parts[`${hl}.outcome`] = [this.text(() => [end[0] + 1.9, end[1]], this.template(String(br.outcome)), { color: "yellow" }, 22)];
        if (br.children) walk(br.children, end, depth + 1, here);
        void c;
      });
    };
    walk(d.branches, root, 0, []);
    o.order = [...new Set(o.order)];
  }

  // ── What the player asks for ───────────────────────────────────────────────────────────────
  /** "f" → all its parts in order; "i1.shade" → that part; "T.edges" → the edges. */
  itemsFor(ref) {
    if (this.objs.has(ref)) {
      const o = this.objs.get(ref);
      return o.order.flatMap((k) => o.parts[k] ?? []);
    }
    // "S.mean.label": the object may itself have a dotted id, so try every split.
    for (let dot = ref.indexOf("."); dot > 0; dot = ref.indexOf(".", dot + 1)) {
      const o = this.objs.get(ref.slice(0, dot));
      const part = ref.slice(dot + 1);
      if (o?.parts?.[part]) return o.parts[part];
    }
    throw new Error(`nothing called "${ref}" to draw`);
  }

  /** Every element an object has, for hiding and ghosting. */
  allElements(id) {
    const o = this.objs.get(id);
    if (!o) return [];
    return Object.values(o.parts ?? {}).flat().filter(Boolean);
  }

  tick() {
    for (const tr of this.traces) {
      // A trace records only once it has been drawn.
      if (!tr.el.visPropCalc?.visible) continue;
      const p = tr.src.pos();
      const last = tr.pts[tr.pts.length - 1];
      if (!last || Math.hypot(p[0] - last[0], p[1] - last[1]) > 1e-3) tr.pts.push(p);
    }
  }
}

Object.assign(Scene.prototype, TYPES_2D, TYPES_DATA, TYPES_3D);

function lineFn([p, q]) {
  return (x) => p[1] + ((q[1] - p[1]) / (q[0] - p[0])) * (x - p[0]);
}

// More 2-D constructions for the scene engine: ellipses, number lines (with solution sets and
// jumps), shaded regions of any shape (Venn sets, arc-bounded regions, Argand regions), implicit
// curves, slope fields, trapezium/rectangle strips and cobweb diagrams. Each is general: a spec
// gives the maths (sets, inequalities, a function, data) and every position is computed here.
import * as G from "./geometry.js";
import { formatNumber } from "./expr.js";
import { INK, colour, HIDDEN } from "./style.js";
import { marchingSquares, polygonSdf } from "./contour.js";

const DEG = Math.PI / 180;
const SUB = "₀₁₂₃₄₅₆₇₈₉";
const subscript = (n) => String(n).split("").map((c) => SUB[Number(c)] ?? c).join("");

export const TYPES_2D = {
  // ── Shared helpers ────────────────────────────────────────────────────────────────────────
  /** One element made of several polylines (gaps between them); evenodd fill so holes stay empty. */
  multiCurve(getLines, attrs, { evenodd = false } = {}) {
    const c = this.b.create("curve", [[0], [0]], attrs);
    c.updateDataArray = function () {
      const xs = [], ys = [];
      for (const line of getLines()) {
        if (!line?.length) continue;
        if (xs.length) xs.push(NaN), ys.push(NaN);
        for (const p of line) xs.push(p[0]), ys.push(p[1]);
      }
      this.dataX = xs;
      this.dataY = ys;
    };
    if (evenodd) (this.afterBuild ??= []).push(() => c.rendNode?.setAttribute("fill-rule", "evenodd"));
    return c;
  },

  /** A string that changes whenever anything that can move does (params, transforms, moved points). */
  stateKey() {
    return this.version;
  },

  /** A scratch environment with x and y (and any extra names) as plain writable variables. */
  xyEnv(extra = ["x", "y"]) {
    const vars = Object.create(this.env.vars);
    for (const k of extra) Object.defineProperty(vars, k, { value: 0, writable: true, enumerable: true });
    return { env: { ...this.env, vars }, vars };
  },

  /**
   * Samples fn(x, y) on a grid of screen pixels (step px) and returns its contours in board
   * coordinates. pad: the grid's outer ring counts as outside (so a region is closed at the board
   * edge). pole: also find the inside point furthest from the boundary (where a label goes).
   */
  contourOf(fn, { pad = false, step = 3, pole = false } = {}) {
    const b = this.b;
    const W = b.canvasWidth, H = b.canvasHeight;
    const nx = Math.ceil(W / step) + 3, ny = Math.ceil(H / step) + 3;
    const ox = b.origin.scrCoords[1], oy = b.origin.scrCoords[2];
    const toBoard = (i, j) => [((i - 1) * step - ox) / b.unitX, (oy - (H - (j - 1) * step)) / b.unitY];
    const vals = new Float64Array(nx * ny);
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const [x, y] = toBoard(i, j);
        let v = fn(x, y);
        if (Number.isNaN(v)) v = pad ? -1 : NaN;
        if (pad && (i === 0 || j === 0 || i === nx - 1 || j === ny - 1)) v = Math.min(v, -1e-9);
        vals[j * nx + i] = v;
      }
    }
    const lines = marchingSquares(vals, nx, ny)
      .map((l) => l.map(([i, j]) => toBoard(i, j)))
      .flatMap((l) => splitFinite(l));
    let centre = [NaN, NaN];
    if (pole) {
      const edge = [];
      for (const l of lines) for (let k = 0; k < l.length; k += 2) edge.push(l[k]);
      let best = -1;
      const toPx = (p) => [p[0] * b.unitX, p[1] * b.unitY];
      const edgePx = edge.map(toPx);
      for (let j = 2; j < ny - 2; j += 2) {
        for (let i = 2; i < nx - 2; i += 2) {
          if (!(vals[j * nx + i] > 0)) continue;
          const p = toBoard(i, j);
          const [px, py] = toPx(p);
          let d = Infinity;
          for (const [ex, ey] of edgePx) {
            const dd = (ex - px) ** 2 + (ey - py) ** 2;
            if (dd < d) d = dd;
          }
          // Keep clear of the board's own edge too.
          const sx = (i - 1) * step, sy = (j - 1) * step;
          d = Math.min(d, sx ** 2, (W - sx) ** 2, sy ** 2, (H - sy) ** 2);
          if (d > best) {
            best = d;
            centre = p;
          }
        }
      }
    }
    return { lines, centre };
  },

  /** A region condition → a preparer that returns (x, y) → value (> 0 inside). */
  conditionFn(c) {
    if (c && typeof c === "object") {
      if (c.inside) return this.insideFn(c.inside, false);
      if (c.outside) return this.insideFn(c.outside, true);
      throw new Error(`can't read condition ${JSON.stringify(c)}`);
    }
    const s = String(c).trim();
    if (this.objs.has(s)) return this.insideFn(s, false);
    const neg = /^(?:not\s+|!|outside\s+)(.+)$/.exec(s);
    if (neg && this.objs.has(neg[1].trim())) return this.insideFn(neg[1].trim(), true);
    // An inequality in x and y; chains ("1 < x < 3") and "and" are allowed.
    const parts = s.split(/\s+and\s+/);
    const fns = parts.map((p) => this.inequalityFn(p));
    return () => {
      const ready = fns.map((f) => f());
      return (x, y) => Math.min(...ready.map((f) => f(x, y)));
    };
  },

  inequalityFn(src) {
    const bits = String(src).split(/(<=|>=|≤|≥|<|>)/);
    if (bits.length < 3) throw new Error(`"${src}" is not a condition (an object id, "not <id>", or an inequality in x and y)`);
    const { env, vars } = this.xyEnv();
    const sides = [];
    for (let k = 0; k + 2 < bits.length; k += 2) {
      const op = { "≤": "<=", "≥": ">=" }[bits[k + 1]] ?? bits[k + 1];
      sides.push({ L: this.compiled(bits[k]), R: this.compiled(bits[k + 2]), less: op === "<" || op === "<=" });
    }
    return () => (x, y) => {
      vars.x = x;
      vars.y = y;
      let m = Infinity;
      for (const { L, R, less } of sides) {
        const v = R(env) - L(env);
        m = Math.min(m, less ? v : -v);
      }
      return m;
    };
  },

  insideFn(id, negate) {
    const o = this.objs.get(id);
    if (!o) throw new Error(`no object "${id}"`);
    const sgn = negate ? -1 : 1;
    if (o.circle) {
      return () => {
        const { c, r } = o.circle();
        return (x, y) => sgn * (r - Math.hypot(x - c[0], y - c[1]));
      };
    }
    if (o.poly) {
      return () => {
        const p = o.poly();
        return (x, y) => sgn * polygonSdf(p, x, y);
      };
    }
    if (o.prepare) {
      return () => {
        const f = o.prepare();
        return (x, y) => sgn * f(x, y);
      };
    }
    if (o.sdf) return () => (x, y) => sgn * o.sdf(x, y);
    throw new Error(`"${id}" has no inside (use a circle, ellipse, polygon, sector, area, region or inequality)`);
  },

  // ── Ellipse (an oval: Venn sets, mapping diagrams, loci) ─────────────────────────────────────
  make_ellipse(d) {
    const c = this.pointRef(d.center);
    const rx = () => this.ev(d.rx), ry = () => this.ev(d.ry ?? d.rx), rot = () => this.ev(d.rotate ?? 0) * DEG;
    const at = (t) => {
      const C = c(), a = rot();
      const x = rx() * Math.cos(t), y = ry() * Math.sin(t);
      return [C[0] + x * Math.cos(a) - y * Math.sin(a), C[1] + x * Math.sin(a) + y * Math.cos(a)];
    };
    const poly = () => Array.from({ length: 145 }, (_, i) => at((2 * Math.PI * i) / 144));
    const o = this.register({ id: d.id, type: "ellipse", color: colour(d.color), poly, centre: c });
    const el = this.dataCurve(poly, { ...this.stroke(d, INK.white, 3), fillColor: colour(d.fill ?? d.color), fillOpacity: d.fill ? d.fillOpacity ?? 0.2 : 0 });
    const la = this.outsideAngle(c, d.labelAngle, () => Math.max(rx(), ry()), d.id);
    o.parts = { ellipse: [el], label: [this.label(o, d.label, () => at(la() - rot()), "point", { ...d, labelPos: d.labelPos ?? (() => this.compassOf(la())) })].filter(Boolean) };
    o.order = ["ellipse", "label"];
  },

  // ── Number line ─────────────────────────────────────────────────────────────────────────────
  /** A single scale: arrows at both ends, ticks (a step or a list), numbers (or your own labels). */
  make_numberline(d) {
    const y = this.ev(d.y ?? 0);
    const [a, b] = (d.range ?? [this.bbox.x0 + (this.bbox.x1 - this.bbox.x0) * 0.05, this.bbox.x1 - (this.bbox.x1 - this.bbox.x0) * 0.05]).map((v) => this.ev(v));
    const o = this.register({ id: d.id, type: "numberline", color: colour(d.color), line: () => [[a, y], [b, y]], nl: { y, a, b } });
    const arrows = d.arrows !== false;
    const line = this.b.create("segment", [[a, y], [b, y]], {
      ...this.stroke(d, INK.white, 2.5),
      firstArrow: arrows ? { type: 2, size: 5 } : false, lastArrow: arrows ? { type: 2, size: 5 } : false,
    });
    const ticks = [], numbers = [];
    const tick = (v, big) => {
      const h = this.py(big ? 8 : 5);
      const t = this.b.create("segment", [[v, y - h], [v, y + h]], { ...HIDDEN, strokeColor: colour(d.color, INK.white), strokeWidth: big ? 2.2 : 1.6 });
      t.__quick = true;
      ticks.push(t);
    };
    const margin = (b - a) * 0.01;
    const list = (spec) => {
      if (Array.isArray(spec)) return spec.map((t) => (t && typeof t === "object" ? { v: this.ev(t.at), label: t.label } : { v: this.ev(t) }));
      const step = this.ev(spec ?? 1);
      const out = [];
      if (!(step > 0)) return out;
      for (let k = Math.ceil((a + margin) / step - 1e-9); k * step <= b - margin + 1e-9; k++) out.push({ v: G.tidy(k * step) });
      return out;
    };
    if (d.minor) for (const { v } of list(d.minor)) tick(v, false);
    const custom = d.labels ?? {};
    for (const { v, label } of list(d.ticks)) {
      tick(v, true);
      const text = label ?? custom[String(v)] ?? (d.numbers === false ? "" : formatNumber(v, d.format));
      if (text !== "") {
        const t = this.text(() => [v, y - this.py(22)], String(text), { color: d.numberColor ?? "dim" }, d.numberSize ?? 19);
        t.__quick = true;
        numbers.push(t);
      }
    }
    o.parts = { line: [line], ticks, numbers, label: [this.label(o, d.label, () => [b, y], "point", d)].filter(Boolean) };
    o.order = ["line", "ticks", "numbers", "label"];
  },

  /** A solution set on a number line: a bold bar, a filled (≤) or hollow (<) circle at each end, an arrow to infinity. */
  make_interval(d) {
    const nl = this.objs.get(d.on);
    if (!nl?.nl) throw new Error(`"${d.on}" is not a number line`);
    const level = this.ev(d.level ?? 0);
    const y = () => nl.nl.y + this.py(18) * level;
    const inf = (v) => typeof v === "string" && /^[+-]?inf/.test(v.trim());
    const ends = [].concat(d.ends ?? ["closed", "closed"]);
    const lo = () => (inf(d.from) ? nl.nl.a : this.ev(d.from)), hi = () => (inf(d.to) ? nl.nl.b : this.ev(d.to));
    const c = colour(d.color, INK.yellow);
    const o = this.register({ id: d.id, type: "interval", color: c, line: () => [[lo(), y()], [hi(), y()]] });
    const bar = this.b.create("segment", [[lo, y], [hi, y]], {
      ...HIDDEN, strokeColor: c, strokeWidth: d.width ?? 4.5, lineCap: "round",
      firstArrow: inf(d.from) ? { type: 2, size: 4 } : false, lastArrow: inf(d.to) ? { type: 2, size: 4 } : false,
    });
    const marks = [];
    if (!inf(d.from)) marks.push(this.pointMark(() => [lo(), y()], { color: d.color ?? "yellow", marker: ends[0] === "open" ? "open" : "dot", size: 6 }));
    if (!inf(d.to)) marks.push(this.pointMark(() => [hi(), y()], { color: d.color ?? "yellow", marker: (ends[1] ?? ends[0]) === "open" ? "open" : "dot", size: 6 }));
    // A raised set gets thin drop lines to the scale, so the end values stay readable.
    const drops = [];
    if (level > 0) {
      for (const [v, isInf] of [[lo, inf(d.from)], [hi, inf(d.to)]]) {
        if (isInf) continue;
        const el = this.dataCurve(() => [[v(), nl.nl.y], [v(), y()]], { ...HIDDEN, strokeColor: c, strokeWidth: 1.6, strokeOpacity: 0.7, dash: 2 });
        el.__small = true;
        drops.push(el);
      }
    }
    o.parts = { drops, bar: [bar], ends: marks, label: [this.label(o, d.label, () => [(lo() + hi()) / 2, y()], "segment", d)].filter(Boolean) };
    o.order = ["drops", "bar", "ends", "label"];
  },

  /** A jump along a number line (counting on, a difference): a curved arrow with its label on top. */
  make_jump(d) {
    const nl = d.on ? this.objs.get(d.on) : null;
    if (d.on && !nl?.nl) throw new Error(`"${d.on}" is not a number line`);
    const y0 = () => (nl ? nl.nl.y : this.ev(d.y ?? 0));
    const below = d.side === "below";
    const geom = () => {
      const a = this.ev(d.from), b = this.ev(d.to);
      const hPx = Math.min(Math.abs(b - a) * this.b.unitX * 0.32, 46) + 10;
      const h = this.py(hPx) * (below ? -1 : 1);
      return { a, b, h, base: y0() + this.py(below ? -6 : 6) };
    };
    const pts = () => {
      const { a, b, h, base } = geom();
      const out = [];
      for (let k = 0; k <= 40; k++) {
        const t = Math.PI - (Math.PI * k) / 40;
        out.push([(a + b) / 2 + ((b - a) / 2) * Math.cos(t), base + h * Math.sin(t)]);
      }
      return out;
    };
    const c = colour(d.color, INK.cyan);
    const o = this.register({ id: d.id, type: "jump", color: c });
    const arc = this.dataCurve(pts, this.stroke(d, INK.cyan, 2.5));
    const head = this.dataCurve(() => {
      const p = pts();
      const end = p[p.length - 1], prev = p[p.length - 4];
      const ux = (end[0] - prev[0]) * this.b.unitX, uy = (end[1] - prev[1]) * this.b.unitY;
      const L = Math.hypot(ux, uy) || 1;
      const u = [ux / L, uy / L], n = [-u[1], u[0]];
      const at = (s, t) => [end[0] + (s * u[0] + t * n[0]) / this.b.unitX, end[1] + (s * u[1] + t * n[1]) / this.b.unitY];
      return [at(-9, -6), end, at(-9, 6)];
    }, { ...HIDDEN, strokeColor: c, strokeWidth: 2.5, lineCap: "round" });
    head.__small = true;
    o.parts = { arc: [arc, head], label: [this.label(o, d.label, () => { const { a, b, h, base } = geom(); return [(a + b) / 2, base + h]; }, "point", { ...d, labelPos: d.labelPos ?? (below ? "s" : "n") })].filter(Boolean) };
    o.order = ["arc", "label"];
  },

  // ── Regions: any set of points you can describe ─────────────────────────────────────────────
  /**
   * A shaded region. "where" lists conditions that must all hold; "any" lists several such lists
   * (their union). A condition is an object id (inside it), "not <id>" (outside it) or an
   * inequality in x and y ("y > x^2", "(x-2)^2 + y^2 <= 9", "1 < x < 3"). "within": an id the
   * region stays inside (a Venn diagram's rectangle). Fill "none" gives only the label, at the
   * point of the region furthest from its edges.
   */
  make_region(d) {
    const terms = d.any ? d.any.map((t) => [].concat(t)) : [[].concat(d.where ?? [])];
    if (d.within) for (const t of terms) t.push(d.within);
    const preparers = terms.map((t) => t.map((c) => this.conditionFn(c)));
    const value = () => {
      const fns = preparers.map((t) => t.map((p) => p()));
      return (x, y) => {
        let best = -Infinity;
        for (const t of fns) {
          let m = Infinity;
          for (const f of t) {
            const v = f(x, y);
            if (v < m) m = v;
            if (m <= best) break;
          }
          if (m > best) best = m;
        }
        return best;
      };
    };
    const state = { key: null, lines: [], centre: [NaN, NaN] };
    const compute = () => {
      const key = this.stateKey();
      if (key !== state.key) {
        state.key = key;
        const res = this.contourOf(value(), { pad: true, step: d.resolution ?? 2.5, pole: true });
        state.lines = res.lines;
        state.centre = res.centre;
      }
      return state;
    };
    const fill = d.fill ?? d.color ?? "yellow";
    const o = this.register({ id: d.id, type: "region", color: colour(fill === "none" ? d.color : fill, INK.yellow), centre: () => compute().centre });
    o.prepare = value;
    this.register({ id: `${d.id}.centre`, type: "point", pos: () => compute().centre, parts: {}, order: [] });
    const els = [];
    if (fill !== "none" || d.outline) {
      els.push(this.multiCurve(() => compute().lines, {
        ...HIDDEN, strokeColor: colour(d.color ?? fill, INK.yellow), strokeOpacity: d.outline ? 1 : 0, strokeWidth: d.outline ? d.width ?? 2.5 : 0,
        dash: d.dash ? 2 : 0, fillColor: colour(fill === "none" ? "white" : fill, INK.yellow), fillOpacity: fill === "none" ? 0 : d.opacity ?? 0.38,
      }, { evenodd: true }));
    }
    o.parts = { fill: els, label: [this.label(o, d.label, () => compute().centre, "inside", { ...d, labelColor: d.labelColor ?? (fill === "none" ? d.color ?? "white" : "white") })].filter(Boolean) };
    o.order = ["fill", "label"];
  },

  /** An implicit curve: "x^3 + y^3 = 6xy", "y^2 = x^3 - x", "x^2/9 + y^2/4 = 1". */
  make_implicit(d) {
    const [lhs, rhs] = String(d.expr).split(/(?<![<>!=])=(?!=)/);
    const L = this.compiled(lhs), R = this.compiled(rhs ?? "0");
    const { env, vars } = this.xyEnv();
    const fn = (x, y) => {
      vars.x = x;
      vars.y = y;
      return L(env) - R(env);
    };
    const state = { key: null, lines: [] };
    const compute = () => {
      const key = this.stateKey();
      if (key !== state.key) {
        state.key = key;
        state.lines = this.contourOf(fn, { step: d.resolution ?? 2 }).lines;
      }
      return state.lines;
    };
    const o = this.register({ id: d.id, type: "implicit", color: colour(d.color, INK.yellow), sdf: fn });
    const el = this.multiCurve(compute, { ...this.stroke(d, INK.yellow, 3.2) });
    const labelAt = () => {
      // Near the right end of the longest piece, inside the board.
      const lines = compute();
      const longest = lines.reduce((m, l) => (l.length > (m?.length ?? 0) ? l : m), null);
      if (!longest) return [NaN, NaN];
      const inBoard = longest.filter((p) => p[0] < this.bbox.x1 - (this.bbox.x1 - this.bbox.x0) * 0.1 && p[1] < this.bbox.y1 - (this.bbox.y1 - this.bbox.y0) * 0.1 && p[1] > this.bbox.y0 + (this.bbox.y1 - this.bbox.y0) * 0.08);
      return inBoard.reduce((m, p) => (p[0] > m[0] ? p : m), inBoard[0] ?? longest[0]);
    };
    o.parts = { curve: [el], label: [this.label(o, d.label, labelAt, "curve", d)].filter(Boolean) };
    o.order = ["curve", "label"];
  },

  /** Short segments with gradient dy/dx at grid points: "dydx": "x - y". */
  make_slopefield(d) {
    const F = this.compiled(String(d.dydx));
    const { env, vars } = this.xyEnv();
    const { x0, x1, y0, y1 } = this.bbox;
    const xr = d.x ? d.x.map((v) => this.ev(v)) : [x0, x1], yr = d.y ? d.y.map((v) => this.ev(v)) : [y0, y1];
    const step = this.ev(d.step ?? 0.5);
    const lenPx = (d.length !== undefined ? this.ev(d.length) : step * 0.55) * this.b.unitX;
    const lines = () => {
      const out = [];
      for (let x = Math.ceil(xr[0] / step) * step; x <= xr[1] + 1e-9; x += step) {
        for (let y = Math.ceil(yr[0] / step) * step; y <= yr[1] + 1e-9; y += step) {
          vars.x = x;
          vars.y = y;
          const m = F(env);
          if (!Number.isFinite(m)) continue;
          const dx = this.b.unitX, dy = m * this.b.unitY, L = Math.hypot(dx, dy);
          const hx = ((dx / L) * lenPx) / 2 / this.b.unitX, hy = ((dy / L) * lenPx) / 2 / this.b.unitY;
          out.push([[x - hx, y - hy], [x + hx, y + hy]]);
        }
      }
      return out;
    };
    const o = this.register({ id: d.id, type: "slopefield", color: colour(d.color, INK.grey) });
    o.parts = { field: [this.multiCurve(lines, { ...this.stroke(d, INK.grey, 1.6), strokeOpacity: d.opacity ?? 0.6 })] };
    o.order = ["field"];
  },

  /** Strips under a curve for the trapezium rule (or left/right/mid rectangles); n can be a param. */
  make_strips(d) {
    const f = this.fnOf(d.under);
    const rule = d.rule ?? "trapezium";
    const n = () => Math.max(1, Math.round(this.ev(d.n ?? 4)));
    const loops = () => {
      const a = this.ev(d.from), b = this.ev(d.to), k = n(), h = (b - a) / k;
      const out = [];
      for (let i = 0; i < k; i++) {
        const xa = a + i * h, xb = xa + h;
        let ya = f(xa), yb = f(xb);
        if (rule === "left") yb = ya;
        else if (rule === "right") ya = yb;
        else if (rule === "mid") ya = yb = f((xa + xb) / 2);
        out.push([[xa, 0], [xa, ya], [xb, yb], [xb, 0], [xa, 0]]);
      }
      return out;
    };
    const o = this.register({ id: d.id, type: "strips", color: colour(d.color, INK.cyan) });
    const el = this.multiCurve(loops, { ...this.stroke(d, INK.cyan, 2), fillColor: colour(d.fill ?? d.color, INK.cyan), fillOpacity: d.fillOpacity ?? 0.2 });
    o.parts = { strips: [el], label: [this.label(o, d.label, () => { const a = this.ev(d.from), b = this.ev(d.to); return [(a + b) / 2, f((a + b) / 2) / 2]; }, "inside", d)].filter(Boolean) };
    o.order = ["strips", "label"];
  },

  /** Iteration x(n+1) = f(x(n)) drawn between y = f(x) and y = x (a staircase or a cobweb). */
  make_cobweb(d) {
    const f = this.fnOf(d.of);
    const n = Math.max(1, Math.round(this.ev(d.n ?? 4)));
    const xs = () => {
      const out = [this.ev(d.x0)];
      for (let k = 0; k < n; k++) out.push(f(out[k]));
      return out;
    };
    const pts = () => {
      const x = xs();
      const out = [[x[0], 0], [x[0], x[1]]];
      for (let k = 1; k < x.length - 1; k++) out.push([x[k], x[k]], [x[k], x[k + 1]]);
      out.push([x[x.length - 1], x[x.length - 1]]);
      return out;
    };
    const o = this.register({ id: d.id, type: "cobweb", color: colour(d.color, INK.pink) });
    const el = this.dataCurve(pts, this.stroke(d, INK.pink, 2.4));
    // Each iterate is a point on the x-axis that can be labelled: <id>.0, <id>.1, …
    const labels = [];
    for (let k = 0; k <= n; k++) {
      const pos = () => [xs()[k], 0];
      const po = this.register({ id: `${d.id}.${k}`, type: "point", pos, parts: {}, order: [] });
      if (d.labels) {
        const lab = this.label(po, `${d.labels === true ? "x" : d.labels}${subscript(k)}`, pos, "point", { color: d.color ?? "pink", labelPos: "s", labelSize: 20 });
        po.parts = { label: [lab] };
        po.order = ["label"];
        labels.push(lab);
      }
    }
    // Dashed drops from the line y = x to each labelled iterate on the x-axis.
    const drops = d.labels ? [this.multiCurve(() => xs().slice(1).map((x) => [[x, x], [x, 0]]), { ...HIDDEN, strokeColor: colour(d.color, INK.pink), strokeWidth: 1.5, strokeOpacity: 0.55, dash: 2 })] : [];
    o.parts = { path: [el], drops, labels };
    o.order = ["path", "drops", "labels"];
  },
};

function splitFinite(line) {
  const out = [];
  let cur = [];
  for (const p of line) {
    if (Number.isFinite(p[0]) && Number.isFinite(p[1])) cur.push(p);
    else if (cur.length) out.push(cur), (cur = []);
  }
  if (cur.length > 1) out.push(cur);
  return out;
}

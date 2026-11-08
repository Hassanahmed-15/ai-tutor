// Data and layout constructions: polylines and smooth curves through data (frequency polygons,
// cumulative frequency, plotted tables), bar charts (single, dual, stacked, discrete
// distributions), histograms by frequency density, pie charts, scatter graphs with the mean point
// and line of best fit, dot plots, box plots, tables (sample-space grids, slots, bar models, grid
// shading, Pascal's triangle) and stem-and-leaf diagrams. A spec gives the data; every bar,
// angle, density and position is computed here.
import * as G from "./geometry.js";
import { formatNumber } from "./expr.js";
import { INK, colour, HIDDEN, SERIES } from "./style.js";

const DEG = Math.PI / 180;
const compass = (dx, dy) => {
  const a = Math.atan2(dy, dx) / DEG;
  const names = ["e", "ne", "n", "nw", "w", "sw", "s", "se"];
  return names[((Math.round(a / 45) % 8) + 8) % 8];
};

export const TYPES_DATA = {
  /** Data as numbers: a list of numbers or expressions (or one expression evaluated at each x). */
  numbers(list, where = "data") {
    if (!Array.isArray(list)) throw new Error(`${where} must be a list`);
    return list.map((v) => this.ev(v));
  },

  // ── Polyline / smooth curve through points ──────────────────────────────────────────────────
  /**
   * Through points ("points": ids or [x, y]; or "x": [...], "y": [...]). "smooth": "curve" (a natural
   * spline, for plotted graphs) or "monotone" (never overshoots: cumulative frequency). "marker":
   * "x" plots crosses at the data. When x increases along the data, the line is also a function
   * (so points can sit on it and read-off lines can meet it).
   */
  make_polyline(d) {
    let P;
    if (d.points) {
      const refs = d.points.map((p) => this.pointRef(p));
      P = this.memo(() => refs.map((r) => r()));
    } else {
      if (!Array.isArray(d.x) || !Array.isArray(d.y) || d.x.length !== d.y.length) throw new Error("a polyline needs points, or x and y lists of the same length");
      P = this.memo(() => d.x.map((x, i) => [this.ev(x), this.ev(d.y[i])]));
    }
    const smooth = d.smooth === true ? "curve" : d.smooth;
    const increasing = () => P().every((p, i, a) => i === 0 || p[0] > a[i - 1][0]);
    const interp = this.memo(() => {
      const pts = P();
      return !smooth || !pts.every((p, i, a) => i === 0 || p[0] > a[i - 1][0]) ? null : smooth === "monotone" ? monotoneCubic(pts) : naturalSpline(pts);
    });
    const sampled = () => {
      const pts = P();
      const f = interp();
      if (!f) return d.closed ? [...pts, pts[0]] : pts;
      const out = [];
      for (let i = 0; i < pts.length - 1; i++) for (let k = 0; k < 24; k++) {
        const x = pts[i][0] + ((pts[i + 1][0] - pts[i][0]) * k) / 24;
        out.push([x, f(x)]);
      }
      out.push(pts[pts.length - 1]);
      return out;
    };
    const fn = (x) => {
      const pts = P();
      if (x < pts[0][0] - 1e-12 || x > pts[pts.length - 1][0] + 1e-12) return NaN;
      const f = interp();
      if (f) return f(x);
      for (let i = 0; i < pts.length - 1; i++) {
        if (x <= pts[i + 1][0]) return pts[i][1] + ((pts[i + 1][1] - pts[i][1]) * (x - pts[i][0])) / (pts[i + 1][0] - pts[i][0]);
      }
      return pts[pts.length - 1][1];
    };
    const isFn = !d.closed && increasing();
    const o = this.register({ id: d.id, type: "polyline", color: colour(d.color, INK.yellow), poly: d.closed ? P : undefined, ...(isFn ? { fn, domain: () => [P()[0][0], P()[P().length - 1][0]] } : {}) });
    if (isFn) this.addFunc(d.id, fn);
    const curve = this.dataCurve(sampled, this.stroke(d, INK.yellow, 3));
    const marks = [];
    P().forEach((_, i) => {
      const pos = () => P()[i];
      this.register({ id: `${d.id}.${i + 1}`, type: "point", pos, parts: {}, order: [] });
      if (d.marker) marks.push(this.pointMark(pos, { color: d.markerColor ?? d.color ?? "white", marker: d.marker }));
    });
    o.parts = { points: marks, line: [curve], label: [this.label(o, d.label, () => P()[P().length - 1], "curve", d)].filter(Boolean) };
    o.order = d.marker ? ["points", "line", "label"] : ["line", "label"];
  },

  // ── Bar charts ──────────────────────────────────────────────────────────────────────────────
  /**
   * Bars at categories (named under the axis) or at x values. "values" (numbers or expressions),
   * or "expr" in x (a discrete distribution: "nCr(5, x) 0.3^x 0.7^(5 - x)"). Several "series"
   * stand side by side ("mode": "dual") or on top of each other ("stacked"). "width": 0 draws sticks.
   */
  make_bars(d) {
    const cats = d.categories;
    const xs = d.x ? this.numbers(d.x, "x") : cats ? cats.map((_, i) => i + 1) : [];
    if (!xs.length) throw new Error("bars need categories or x values");
    const series = (d.series ?? [{ values: d.values, expr: d.expr, color: d.color, name: d.name }]).map((s, k) => ({
      ...s,
      color: s.color ?? (d.series ? SERIES[k % SERIES.length] : d.color ?? "cyan"),
      vals: () => (s.expr !== undefined ? xs.map((x) => this.ev(s.expr, { x })) : this.numbers(s.values ?? [], "values")),
    }));
    const stacked = d.mode === "stacked";
    const nS = stacked ? 1 : series.length;
    const width = this.ev(d.width ?? (nS > 1 ? 0.7 : 0.55));
    const base = this.ev(d.base ?? 0);
    const o = this.register({ id: d.id, type: "bars", color: colour(series[0].color) });
    o.parts = { bars: [], names: [], values: [], key: [] };
    o.order = ["names", "bars", "values", "key"];
    xs.forEach((x, i) => {
      const barEls = [];
      series.forEach((s, k) => {
        const slot = stacked ? 0 : k;
        const w = width / nS;
        const left = x - width / 2 + slot * w;
        const bottom = () => (stacked ? base + series.slice(0, k).reduce((sum, t) => sum + t.vals()[i], 0) : base);
        const top = () => bottom() + s.vals()[i];
        const c = colour(s.color, INK.cyan);
        let el;
        if (width === 0) el = this.b.create("segment", [[x, () => bottom()], [x, () => top()]], { ...HIDDEN, strokeColor: c, strokeWidth: d.stickWidth ?? 6, lineCap: "butt" });
        // A bar of height 0 is not drawn at all (an overlay can pick out some bars only).
        else el = this.dataCurve(() => (Math.abs(top() - bottom()) < 1e-12 ? [] : [[left, bottom()], [left, top()], [left + w, top()], [left + w, bottom()], [left, bottom()]]), { ...HIDDEN, strokeColor: c, strokeWidth: 2.2, fillColor: c, fillOpacity: d.fillOpacity ?? 0.35 });
        barEls.push(el);
        const tip = () => [left + w / 2, top()];
        this.register({ id: `${d.id}.${i + 1}${series.length > 1 ? `.${k + 1}` : ""}`, type: "point", pos: tip, parts: {}, order: [] });
        if (d.showValues) {
          const t = this.text(() => [tip()[0], tip()[1] + this.py(14)], () => (Math.abs(s.vals()[i]) < 1e-12 && d.hideZero !== false ? "" : formatNumber(s.vals()[i], d.format)), { color: s.color }, d.valueSize ?? 18);
          o.parts.values.push(t);
          (o.parts[`v${i + 1}`] ??= []).push(t);
        }
      });
      o.parts[`b${i + 1}`] = barEls;
      o.parts.bars.push(...barEls);
      if (cats) {
        const t = this.text(() => [x, base - this.py(20)], String(cats[i]), { color: "white" }, d.nameSize ?? 19);
        t.__quick = true;
        o.parts.names.push(t);
      }
    });
    if (d.series && d.key !== false) {
      // A small key in the top-right corner.
      const { x1, y1, x0, y0 } = this.bbox;
      series.forEach((s, k) => {
        const kx = x1 - (x1 - x0) * 0.2, ky = y1 - (y1 - y0) * (0.07 + k * 0.07);
        const c = colour(s.color, INK.cyan);
        const sw = this.dataCurve(() => { const w = this.px(14), h = this.py(10); return [[kx, ky - h], [kx, ky + h], [kx + w, ky + h], [kx + w, ky - h], [kx, ky - h]]; }, { ...HIDDEN, strokeColor: c, strokeWidth: 2, fillColor: c, fillOpacity: 0.4 });
        sw.__small = true;
        const nm = String(s.name ?? `series ${k + 1}`);
        o.parts.key.push(sw, this.text(() => [kx + this.px(22 + nm.length * 4.2), ky], nm, { color: s.color }, 18));
      });
    }
  },

  /** A histogram: class boundaries and frequencies; bar heights are frequency densities (frequency ÷ class width × per). */
  make_histogram(d) {
    const bounds = d.bounds ? this.numbers(d.bounds, "bounds") : d.classes.flatMap((c, i) => (i === 0 ? [this.ev(c[0]), this.ev(c[1])] : [this.ev(c[1])]));
    const freqs = () => this.numbers(d.frequencies, "frequencies");
    if (freqs().length !== bounds.length - 1) throw new Error(`${bounds.length - 1} classes but ${freqs().length} frequencies`);
    const per = this.ev(d.per ?? 1);
    const density = d.density !== false;
    const height = (i) => (density ? (freqs()[i] / (bounds[i + 1] - bounds[i])) * per : freqs()[i]);
    const c = colour(d.color, INK.cyan);
    const o = this.register({ id: d.id, type: "histogram", color: c });
    o.parts = { bars: [], values: [] };
    o.order = ["bars", "values"];
    for (let i = 0; i < bounds.length - 1; i++) {
      const a = bounds[i], b = bounds[i + 1];
      const el = this.dataCurve(() => [[a, 0], [a, height(i)], [b, height(i)], [b, 0]], { ...HIDDEN, strokeColor: c, strokeWidth: 2.4, fillColor: colour(d.fill ?? d.color, INK.cyan), fillOpacity: d.fillOpacity ?? 0.3 });
      o.parts.bars.push(el);
      o.parts[`b${i + 1}`] = [el];
      const tip = () => [(a + b) / 2, height(i)];
      this.register({ id: `${d.id}.${i + 1}`, type: "point", pos: tip, parts: {}, order: [] });
      if (d.showValues) {
        const t = this.text(() => [tip()[0], tip()[1] + this.py(14)], () => formatNumber(height(i), d.format ?? "3sf"), { color: d.color ?? "cyan" }, 17);
        o.parts.values.push(t);
        o.parts[`v${i + 1}`] = [t];
      }
    }
  },

  /** A pie chart from values; each slice's angle is value ÷ total × 360°. */
  make_pie(d) {
    const c = this.pointRef(d.center ?? [0, 0]);
    const r = () => this.ev(d.radius ?? 3);
    const vals = () => this.numbers(d.values, "values");
    const start = this.ev(d.start ?? 90), dir = d.clockwise === false ? 1 : -1;
    const angles = () => {
      const v = vals(), total = v.reduce((s, x) => s + x, 0);
      let a = start;
      return v.map((x) => {
        const sweep = (x / total) * 360;
        const out = { a0: a, a1: a + dir * sweep, sweep };
        a += dir * sweep;
        return out;
      });
    };
    const o = this.register({ id: d.id, type: "pie", color: INK.white, circle: () => ({ c: c(), r: r() }) });
    o.parts = { slices: [], names: [], angles: [] };
    o.order = ["slices", "names", "angles"];
    d.values.forEach((_, i) => {
      const col = colour(d.colors?.[i] ?? SERIES[i % SERIES.length]);
      const pts = () => {
        const { a0, a1 } = angles()[i];
        const C = c(), R = r();
        const out = [C];
        for (let k = 0; k <= 60; k++) {
          const a = (a0 + ((a1 - a0) * k) / 60) * DEG;
          out.push([C[0] + R * Math.cos(a), C[1] + R * Math.sin(a)]);
        }
        out.push(C);
        return out;
      };
      const el = this.dataCurve(pts, { ...HIDDEN, strokeColor: INK.white, strokeWidth: 2.2, fillColor: col, fillOpacity: d.fillOpacity ?? 0.42 });
      o.parts.slices.push(el);
      o.parts[`s${i + 1}`] = [el];
      const midAt = (k) => () => {
        const { a0, a1 } = angles()[i];
        const m = ((a0 + a1) / 2) * DEG, C = c();
        return [C[0] + r() * k * Math.cos(m), C[1] + r() * k * Math.sin(m)];
      };
      const so = this.register({ id: `${d.id}.${i + 1}`, type: "point", pos: midAt(1), parts: {}, order: [] });
      if (d.labels?.[i] !== undefined) {
        const { a0, a1 } = angles()[i];
        const m = ((a0 + a1) / 2) * DEG;
        const lab = this.label(so, String(d.labels[i]), midAt(1), "point", { color: d.colors?.[i] ?? SERIES[i % SERIES.length], labelPos: compass(Math.cos(m), Math.sin(m)) });
        o.parts.names.push(lab);
        o.parts[`n${i + 1}`] = [lab];
      }
      if (d.showAngles) {
        const t = this.text(midAt(0.62), () => `${formatNumber(angles()[i].sweep, d.angleFormat ?? "0")}°`, { color: "white" }, 18);
        o.parts.angles.push(t);
        o.parts[`a${i + 1}`] = [t];
      }
    });
  },

  /** A scatter graph: crosses at the data; "mean": the mean point; "fit": the least-squares line through it. */
  make_scatter(d) {
    const xs = () => this.numbers(d.x, "x"), ys = () => this.numbers(d.y, "y");
    if (d.x.length !== d.y.length) throw new Error("x and y must have the same length");
    const mean = () => [avg(xs()), avg(ys())];
    const fit = () => {
      const x = xs(), y = ys(), [mx, my] = mean();
      let sxy = 0, sxx = 0;
      for (let i = 0; i < x.length; i++) {
        sxy += (x[i] - mx) * (y[i] - my);
        sxx += (x[i] - mx) ** 2;
      }
      const m = sxy / sxx;
      const lo = d.fitRange ? this.ev(d.fitRange[0]) : Math.min(...x), hi = d.fitRange ? this.ev(d.fitRange[1]) : Math.max(...x);
      return [[lo, my + m * (lo - mx)], [hi, my + m * (hi - mx)]];
    };
    const o = this.register({ id: d.id, type: "scatter", color: colour(d.color) });
    o.parts = { points: [], mean: [], fit: [] };
    o.order = ["points", "mean", "fit"];
    d.x.forEach((_, i) => {
      const pos = () => [xs()[i], ys()[i]];
      this.register({ id: `${d.id}.${i + 1}`, type: "point", pos, parts: {}, order: [] });
      o.parts.points.push(this.pointMark(pos, { color: d.color ?? "white", marker: d.marker ?? "x" }));
    });
    if (d.mean) {
      const mo = this.register({ id: `${d.id}.mean`, type: "point", color: colour(d.meanColor ?? "pink"), pos: mean });
      const els = [this.pointMark(mean, { color: d.meanColor ?? "pink", marker: "open", size: 6 }), this.pointMark(mean, { color: d.meanColor ?? "pink", marker: "+", size: 4 })];
      const lab = this.label(mo, d.meanLabel ?? "({X(" + d.id + ".mean):3sf}, {Y(" + d.id + ".mean):3sf})", mean, "point", { color: d.meanColor ?? "pink" });
      mo.parts = { point: els, label: [lab] };
      mo.order = ["point", "label"];
      o.parts.mean.push(...els, lab);
    }
    if (d.fit) {
      const fo = this.register({ id: `${d.id}.fit`, type: "segment", color: colour(d.fitColor ?? "yellow"), line: fit });
      const el = this.b.create("segment", [this.dyn(() => fit()[0]), this.dyn(() => fit()[1])], this.stroke({ color: d.fitColor ?? "yellow" }, INK.yellow, 3));
      const lab = this.label(fo, d.fitLabel, () => fit()[1], "point", { color: d.fitColor ?? "yellow" });
      fo.parts = { line: [el], label: [lab].filter(Boolean) };
      fo.order = ["line", "label"];
      o.parts.fit.push(el, ...[lab].filter(Boolean));
    }
  },

  /** A dot plot: one mark per value, stacked over the scale. */
  make_dotplot(d) {
    const vals = this.numbers(d.values, "values");
    const y0 = this.ev(d.y ?? 0);
    const gap = d.gap ?? 16;
    const counts = new Map();
    const o = this.register({ id: d.id, type: "dotplot", color: colour(d.color) });
    o.parts = { dots: [] };
    o.order = ["dots"];
    for (const v of vals) {
      const k = (counts.get(v) ?? 0) + 1;
      counts.set(v, k);
      o.parts.dots.push(this.pointMark(() => [v, y0 + this.py(gap * k)], { color: d.color ?? "cyan", marker: d.marker ?? "x" }));
    }
  },

  /** A box plot from the five numbers, or from raw data (quartiles as medians of the halves). */
  make_boxplot(d) {
    const five = () => {
      if (d.five) return this.numbers(d.five, "five");
      const s = this.numbers(d.data, "data").sort((a, b) => a - b);
      const med = (a) => (a.length % 2 ? a[(a.length - 1) / 2] : (a[a.length / 2 - 1] + a[a.length / 2]) / 2);
      const half = Math.floor(s.length / 2);
      return [s[0], med(s.slice(0, half)), med(s), med(s.slice(s.length - half)), s[s.length - 1]];
    };
    const y = () => this.ev(d.y ?? 1), h = () => this.ev(d.height ?? 0.8);
    const c = colour(d.color, INK.cyan);
    const o = this.register({ id: d.id, type: "boxplot", color: c });
    const at = (k) => () => [five()[k], y() + h() / 2];
    ["min", "q1", "median", "q3", "max"].forEach((name, k) => this.register({ id: `${d.id}.${name}`, type: "point", pos: at(k), parts: {}, order: [] }));
    const seg = (pts) => this.dataCurve(pts, { ...HIDDEN, strokeColor: c, strokeWidth: 2.6, lineCap: "round" });
    const box = this.dataCurve(() => { const f = five(), Y = y(), H = h(); return [[f[1], Y - H / 2], [f[1], Y + H / 2], [f[3], Y + H / 2], [f[3], Y - H / 2], [f[1], Y - H / 2]]; }, { ...HIDDEN, strokeColor: c, strokeWidth: 2.6, fillColor: c, fillOpacity: d.fillOpacity ?? 0.15 });
    const median = seg(() => { const f = five(); return [[f[2], y() - h() / 2], [f[2], y() + h() / 2]]; });
    const whiskers = [
      seg(() => { const f = five(); return [[f[0], y()], [f[1], y()]]; }),
      seg(() => { const f = five(); return [[f[3], y()], [f[4], y()]]; }),
      seg(() => { const f = five(); return [[f[0], y() - h() / 4], [f[0], y() + h() / 4]]; }),
      seg(() => { const f = five(); return [[f[4], y() - h() / 4], [f[4], y() + h() / 4]]; }),
    ];
    o.parts = { box: [box], median: [median], whiskers };
    o.order = ["box", "median", "whiskers"];
    o.five = five;
  },

  // ── Tables ──────────────────────────────────────────────────────────────────────────────────
  /**
   * A grid of cells, top-left corner at "at", each "cell": [w, h] (or "colWidths"/"rowHeights").
   * Cells are "rows": [[...], ...] (texts, with {expr} values), or computed: "value": an expression
   * in r, c (the cell's row and column) and R, C (the row and column header values). "header":
   * { "cols": [...], "rows": [...], "corner": "+" }. "shade": an expression in r, c, R, C (true →
   * shaded) or a list of [r, c]. "border": grid | outer | none. "gap" spaces the columns apart
   * (separate boxes) with an optional "joiner" text between. "shape": "triangle" (row r has r cells).
   */
  make_table(d) {
    const at = this.pointRef(d.at ?? [0, 0])();
    const head = d.header ?? {};
    const hr = head.cols ? 1 : 0, hc = head.rows ? 1 : 0;
    const bodyRows = d.rows ? d.rows.length : this.ev(d.rowCount ?? head.rows?.length ?? 1);
    const triangle = d.shape === "triangle";
    const bodyCols = d.rows ? Math.max(...d.rows.map((r) => r.length)) : this.ev(d.colCount ?? head.cols?.length ?? (triangle ? bodyRows : 1));
    const nR = bodyRows + hr, nC = bodyCols + hc;
    const size = Array.isArray(d.cell) ? d.cell : [1, 1];
    const cw = d.colWidths ? this.numbers(d.colWidths) : Array(nC).fill(this.ev(size[0]));
    const rh = d.rowHeights ? this.numbers(d.rowHeights) : Array(nR).fill(this.ev(size[1]));
    const cellExpr = d.value;
    const gap = this.ev(d.gap ?? 0);
    const xOf = (c) => at[0] + cw.slice(0, c).reduce((s, w) => s + w, 0) + gap * c;
    const yOf = (r) => at[1] - rh.slice(0, r).reduce((s, h) => s + h, 0);
    const width = xOf(nC) - gap - at[0], height = at[1] - yOf(nR);
    const rowLen = (r) => (triangle ? r + 1 : bodyCols);
    const rowShift = (r) => (triangle ? ((bodyCols - rowLen(r)) * cw[0]) / 2 : 0);
    const textCol = d.textColor ?? d.color ?? "white";
    const o = this.register({ id: d.id, type: "table", color: colour(d.color), poly: () => [[at[0], at[1]], [at[0] + width, at[1]], [at[0] + width, at[1] - height], [at[0], at[1] - height]] });
    o.parts = { grid: [], header: [], cells: [], shade: [], joiners: [] };
    o.order = ["grid", "header", "shade", "cells", "joiners"];
    const line = (p, q, strong) => {
      const el = this.b.create("segment", [p, q], { ...HIDDEN, strokeColor: colour(d.color, INK.white), strokeWidth: strong ? 2.6 : 1.8, strokeOpacity: strong ? 1 : 0.85 });
      el.__quick = !strong && !d.slowGrid;
      o.parts.grid.push(el);
    };
    const border = d.border ?? "grid";
    if (border !== "none" && !triangle) {
      if (gap > 0) {
        for (let c = hc; c < nC; c++) for (let r = hr; r < nR; r++) {
          const x0 = xOf(c), x1 = x0 + cw[c], y0 = yOf(r), y1 = yOf(r + 1);
          line([x0, y0], [x1, y0], true); line([x1, y0], [x1, y1], true); line([x1, y1], [x0, y1], true); line([x0, y1], [x0, y0], true);
        }
      } else {
        const L = at[0], R = at[0] + width, T = at[1], B = at[1] - height;
        line([L, T], [R, T], true); line([R, T], [R, B], true); line([R, B], [L, B], true); line([L, B], [L, T], true);
        if (border === "grid") {
          for (let c = 1; c < nC; c++) line([xOf(c), T], [xOf(c), B], hc > 0 && c === hc);
          for (let r = 1; r < nR; r++) line([L, yOf(r)], [R, yOf(r)], hr > 0 && r === hr);
        }
      }
    }
    const fit = (text, w, h) => {
      const base = d.textSize ?? 24;
      const byH = h * this.b.unitY * 0.62;
      const byW = (w * this.b.unitX * 0.92) / Math.max(1, String(text).length * 0.46);
      return Math.max(11, Math.min(base, byH, byW));
    };
    const putText = (src, r, c, color, list, shift = 0) => {
      const x = xOf(c) + cw[c] / 2 + shift, y = yOf(r) - rh[r] / 2;
      const content = this.template(String(src));
      const el = this.text(() => [x, y], content, { color }, fit(content(), cw[c], rh[r]));
      list.push(el);
      return el;
    };
    if (head.cols) head.cols.forEach((v, c) => putText(v, 0, c + hc, d.headerColor ?? "yellow", o.parts.header));
    if (head.rows) head.rows.forEach((v, r) => putText(v, r + hr, 0, d.headerColor ?? "yellow", o.parts.header));
    if (head.corner !== undefined && hr && hc) putText(head.corner, 0, 0, d.headerColor ?? "yellow", o.parts.header);
    const shadeTest = (() => {
      if (!d.shade) return () => false;
      if (Array.isArray(d.shade)) {
        const set = new Set(d.shade.map(([r, c]) => `${this.ev(r)},${this.ev(c)}`));
        return (r, c) => set.has(`${r},${c}`);
      }
      return (r, c, R, C) => !!this.ev(d.shade, { r, c, R, C });
    })();
    const headVal = (list, k) => {
      if (!list) return k;
      const v = Number(list[k - 1]);
      return Number.isFinite(v) ? v : k;
    };
    for (let r = 1; r <= bodyRows; r++) {
      const rowEls = [];
      for (let c = 1; c <= rowLen(r - 1); c++) {
        const R = headVal(head.rows, r), C = headVal(head.cols, c);
        const gr = r - 1 + hr, gc = c - 1 + hc;
        const shift = rowShift(r - 1);
        if (shadeTest(r, c, R, C)) {
          const x0 = xOf(gc) + shift, x1 = x0 + cw[gc], y0 = yOf(gr), y1 = yOf(gr + 1);
          const sc = colour(d.shadeColor ?? "yellow");
          const el = this.dataCurve(() => [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]], { ...HIDDEN, strokeWidth: 0, strokeOpacity: 0, fillColor: sc, fillOpacity: d.shadeOpacity ?? 0.4 });
          o.parts.shade.push(el);
          (o.parts[`shade${r}`] ??= []).push(el);
        }
        let src = d.rows ? d.rows[r - 1]?.[c - 1] : cellExpr !== undefined ? formatNumber(this.ev(cellExpr, { r, c, R, C }), d.format) : undefined;
        if (src === undefined || src === null || src === "") continue;
        const color = d.cellColors?.[r - 1]?.[c - 1] ?? textCol;
        const el = putText(src, gr, gc, color, o.parts.cells, shift);
        rowEls.push(el);
        o.parts[`cell${r}_${c}`] = [el];
      }
      o.parts[`row${r}`] = rowEls;
    }
    if (gap > 0 && d.joiner) {
      for (let c = hc; c < nC - 1; c++) for (let r = hr; r < nR; r++) {
        const x = xOf(c + 1) - gap / 2, y = yOf(r) - rh[r] / 2;
        o.parts.joiners.push(this.text(() => [x, y], String(d.joiner), { color: textCol }, fit(d.joiner, gap, rh[r])));
      }
    }
    // Corners of each body cell can be referred to: <id>.r.c is the cell's centre.
    for (let r = 1; r <= bodyRows; r++) for (let c = 1; c <= rowLen(r - 1); c++) {
      const gr = r - 1 + hr, gc = c - 1 + hc, shift = rowShift(r - 1);
      const pos = () => [xOf(gc) + cw[gc] / 2 + shift, yOf(gr) - rh[gr] / 2];
      this.register({ id: `${d.id}.${r}.${c}`, type: "point", pos, parts: {}, order: [] });
    }
  },

  /** A stem-and-leaf diagram (or back-to-back, with "left" data): leaves in fixed columns so they line up. */
  make_stemleaf(d) {
    const at = this.pointRef(d.at ?? [0, 0])();
    const unit = this.ev(d.stemUnit ?? 10), leafUnit = this.ev(d.leafUnit ?? 1);
    const split = (v) => {
      const stem = Math.floor(v / unit + 1e-9);
      return [stem, Math.round((v - stem * unit) / leafUnit)];
    };
    const right = this.numbers(d.data, "data").map(split);
    const left = d.left ? this.numbers(d.left, "left").map(split) : null;
    const all = [...right, ...(left ?? [])];
    const s0 = d.stems ? this.ev(d.stems[0]) : Math.min(...all.map((p) => p[0]));
    const s1 = d.stems ? this.ev(d.stems[1]) : Math.max(...all.map((p) => p[0]));
    const rowH = this.ev(d.rowHeight ?? 0.7), slot = this.ev(d.slot ?? 0.5), stemW = this.ev(d.stemWidth ?? 1.2);
    const leavesOf = (list, s) => list.filter((p) => p[0] === s).map((p) => p[1]).sort((a, b) => a - b);
    const maxLeft = left ? Math.max(1, ...Array.from({ length: s1 - s0 + 1 }, (_, k) => leavesOf(left, s0 + k).length)) : 0;
    const lineX = at[0] + maxLeft * slot + (left ? slot * 0.6 : 0) + stemW;
    const c = colour(d.color, INK.white);
    const o = this.register({ id: d.id, type: "stemleaf", color: c });
    o.parts = { stems: [], line: [], leaves: [], left: [], key: [] };
    o.order = ["stems", "line", "leaves", "left", "key"];
    const size = d.textSize ?? Math.min(26, rowH * this.b.unitY * 0.7);
    for (let k = 0; k <= s1 - s0; k++) {
      const s = s0 + k;
      const y = at[1] - rowH * (k + 0.5);
      const stemX = lineX - stemW / 2 + (left ? 0 : 0);
      o.parts.stems.push(this.text(() => [stemX, y], formatNumber(s), { color: d.stemColor ?? "yellow" }, size));
      const row = [];
      leavesOf(right, s).forEach((leaf, i) => {
        const el = this.text(() => [lineX + slot * (i + 0.9), y], formatNumber(leaf), { color: d.leafColor ?? "white" }, size);
        row.push(el);
      });
      o.parts[`row${k + 1}`] = row;
      o.parts.leaves.push(...row);
      if (left) {
        const lrow = [];
        const lv = leavesOf(left, s);
        // Back-to-back: smallest leaf next to the stem, growing to the left.
        lv.forEach((leaf, i) => lrow.push(this.text(() => [lineX - stemW - slot * (i + 0.6), y], formatNumber(leaf), { color: d.leftColor ?? "cyan" }, size)));
        o.parts[`left${k + 1}`] = lrow;
        o.parts.left.push(...lrow);
      }
    }
    const top = at[1], bottom = at[1] - rowH * (s1 - s0 + 1);
    o.parts.line.push(this.b.create("segment", [[lineX, top], [lineX, bottom]], { ...HIDDEN, strokeColor: c, strokeWidth: 2.6 }));
    if (left) o.parts.line.push(this.b.create("segment", [[lineX - stemW, top], [lineX - stemW, bottom]], { ...HIDDEN, strokeColor: c, strokeWidth: 2.6 }));
    if (d.key !== false) {
      const ex = right[0] ?? [s0, 0];
      const key = d.key ?? `Key: ${formatNumber(ex[0])} | ${formatNumber(ex[1])} means ${formatNumber(ex[0] * unit + ex[1] * leafUnit)}`;
      const t = this.text(() => [at[0] + this.px(String(key).length * 4.6), bottom - rowH * 0.7], String(key), { color: "dim" }, 19);
      o.parts.key.push(t);
    }
  },
};

function avg(a) {
  return a.reduce((s, v) => s + v, 0) / a.length;
}

/** Natural cubic spline through points with increasing x. */
function naturalSpline(pts) {
  const n = pts.length - 1;
  if (n < 2) return (x) => pts[0][1] + ((pts[1][1] - pts[0][1]) * (x - pts[0][0])) / (pts[1][0] - pts[0][0]);
  const h = [], al = [0];
  for (let i = 0; i < n; i++) h.push(pts[i + 1][0] - pts[i][0]);
  for (let i = 1; i < n; i++) al.push((3 / h[i]) * (pts[i + 1][1] - pts[i][1]) - (3 / h[i - 1]) * (pts[i][1] - pts[i - 1][1]));
  const l = [1], mu = [0], z = [0];
  for (let i = 1; i < n; i++) {
    l.push(2 * (pts[i + 1][0] - pts[i - 1][0]) - h[i - 1] * mu[i - 1]);
    mu.push(h[i] / l[i]);
    z.push((al[i] - h[i - 1] * z[i - 1]) / l[i]);
  }
  const c = Array(n + 1).fill(0), b = Array(n).fill(0), dd = Array(n).fill(0);
  for (let j = n - 1; j >= 0; j--) {
    c[j] = z[j] - mu[j] * c[j + 1];
    b[j] = (pts[j + 1][1] - pts[j][1]) / h[j] - (h[j] * (c[j + 1] + 2 * c[j])) / 3;
    dd[j] = (c[j + 1] - c[j]) / (3 * h[j]);
  }
  return (x) => {
    let j = n - 1;
    for (let i = 0; i < n; i++) if (x <= pts[i + 1][0]) { j = i; break; }
    const t = x - pts[j][0];
    return pts[j][1] + b[j] * t + c[j] * t * t + dd[j] * t * t * t;
  };
}

/** Fritsch–Carlson monotone cubic: smooth, and never rises above or dips below the data between points. */
function monotoneCubic(pts) {
  const n = pts.length;
  const dx = [], m = [];
  for (let i = 0; i < n - 1; i++) {
    dx.push(pts[i + 1][0] - pts[i][0]);
    m.push((pts[i + 1][1] - pts[i][1]) / dx[i]);
  }
  const t = [m[0]];
  for (let i = 1; i < n - 1; i++) t.push(m[i - 1] * m[i] <= 0 ? 0 : (m[i - 1] + m[i]) / 2);
  t.push(m[n - 2]);
  for (let i = 0; i < n - 1; i++) {
    if (m[i] === 0) { t[i] = t[i + 1] = 0; continue; }
    const a = t[i] / m[i], b = t[i + 1] / m[i], s = a * a + b * b;
    if (s > 9) { const k = 3 / Math.sqrt(s); t[i] = k * a * m[i]; t[i + 1] = k * b * m[i]; }
  }
  return (x) => {
    let i = n - 2;
    for (let k = 0; k < n - 1; k++) if (x <= pts[k + 1][0]) { i = k; break; }
    const h = dx[i], u = (x - pts[i][0]) / h;
    const h00 = 2 * u ** 3 - 3 * u ** 2 + 1, h10 = u ** 3 - 2 * u ** 2 + u, h01 = -2 * u ** 3 + 3 * u ** 2, h11 = u ** 3 - u ** 2;
    return h00 * pts[i][1] + h10 * h * t[i] + h01 * pts[i + 1][1] + h11 * h * t[i + 1];
  };
}

void G;

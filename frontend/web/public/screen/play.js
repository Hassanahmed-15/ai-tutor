// "TRY IT" (first built in screen-lab/public/play.js): the interactive board that follows Aria's explanation of a mark (owner 2026-11-17: drag
// to change values; Aria asks, the student answers; formulas, graphs, science diagrams and code).
//
// A play spec is plain data (written by a model, checked by lib/play.mjs): 1-2 sliders ("params"),
// live numbers computed from them ("values"), what to draw from them (a graph, a figure in a 100 x 100
// box, or code), and one challenge with a goal condition. Every number in the drawing may be an
// expression in the params and values, so the picture moves as the student drags. Nothing here knows
// any topic: the same engine draws a bending light ray, a line through a point or a loop's output.
import { compile, formatNumber } from "./vendor/expr.js";

const W = 560;
const H = 300;
const SVGNS = "http://www.w3.org/2000/svg";
const HAND = '"Patrick Hand", "Comic Sans MS", cursive';
const MONO = 'ui-monospace, "SF Mono", Menlo, Consolas, monospace';
const INK = { chalk: "#f4f4ee", yellow: "#ffe45c", cyan: "#7fd8ff", pink: "#ff9ecb", green: "#9be59b", orange: "#ffb36b", violet: "#c4a7ff", grey: "#8f8f99", red: "#ff7b7b" };
const ink = (c, fallback = "chalk") => INK[c] ?? INK[fallback];

/** A number, or an expression string in the params and values, as a function of the variables. */
function numFn(v) {
  if (typeof v === "number") return () => v;
  const f = compile(String(v));
  return (vars) => f({ vars });
}

/** "r = {r:1}°" → the text with each {expr:format} filled in. */
function templateFn(text) {
  const parts = String(text ?? "").split(/(\{[^{}]+\})/g).map((p) => {
    const m = /^\{([^{}:]+)(?::([^{}]*))?\}$/.exec(p);
    if (!m) return () => p;
    const f = compile(m[1]);
    return (vars) => formatNumber(f({ vars }), m[2]);
  });
  return (vars) => parts.map((p) => p(vars)).join("");
}

function niceStep(span) {
  const raw = span / 5;
  const p = 10 ** Math.floor(Math.log10(raw));
  return [1, 2, 2.5, 5, 10].map((k) => k * p).find((s) => s >= raw) ?? raw;
}

function el(tag, attrs = {}, parent) {
  const e = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  parent?.append(e);
  return e;
}

export class Play {
  /**
   * opts: onGoal(praiseText), onMiss(count, hintText), onChange(vars)
   */
  constructor(host, spec, opts = {}) {
    this.host = host;
    this.spec = spec;
    this.opts = opts;
    this.misses = 0;
    this.solved = false;
    const params = (spec.params ?? []).slice(0, 2);
    this.params = params.map((p) => ({ ...p, value: Number.isFinite(p.value) ? p.value : p.min }));
    this.values = (spec.values ?? []).slice(0, 3).map((v) => ({ ...v, f: numFn(v.expr) }));
    this.goal = spec.challenge?.goal ? numFn(spec.challenge.goal) : null;

    host.classList.add("pl");
    host.innerHTML = "";
    const stage = document.createElement("div");
    stage.className = "pl-stage";
    this.svg = el("svg", { viewBox: `0 0 ${W} ${H}`, class: "pl-svg" }, stage);
    host.append(stage);

    this.readout = document.createElement("div");
    this.readout.className = "pl-read";
    host.append(this.readout);

    const controls = document.createElement("div");
    controls.className = "pl-controls";
    this.sliders = this.params.map((p) => {
      const row = document.createElement("label");
      row.className = "pl-slider";
      const name = document.createElement("span");
      name.className = "pl-name";
      name.textContent = p.label ?? p.id;
      const input = document.createElement("input");
      Object.assign(input, { type: "range", min: p.min, max: p.max, step: p.step ?? (p.max - p.min) / 100, value: p.value });
      const val = document.createElement("span");
      val.className = "pl-val";
      row.append(name, input, val);
      controls.append(row);
      input.addEventListener("input", () => {
        p.value = Number(input.value);
        this.render();
      });
      // The student let go: that is their answer.
      input.addEventListener("change", () => this.judge());
      return { p, input, val };
    });
    host.append(controls);
    this.render();
  }

  /** The params and the values computed from them, for every expression. */
  vars() {
    const vars = {};
    for (const p of this.params) vars[p.id] = p.value;
    for (const v of this.values) {
      try {
        vars[v.id] = v.f(vars);
      } catch {
        vars[v.id] = NaN;
      }
    }
    return vars;
  }

  set(id, value) {
    const s = this.sliders.find((x) => x.p.id === id);
    if (!s) return;
    s.p.value = Math.max(s.p.min, Math.min(s.p.max, value));
    s.input.value = s.p.value;
    this.render();
  }

  met() {
    if (!this.goal) return false;
    try {
      return Boolean(this.goal(this.vars()));
    } catch {
      return false;
    }
  }

  judge() {
    if (!this.goal || this.solved) return;
    const vars = this.vars();
    const c = this.spec.challenge ?? {};
    if (this.met()) {
      this.solved = true;
      this.host.classList.add("solved");
      this.opts.onGoal?.(templateFn(c.praise ?? "That's it!")(vars));
    } else {
      this.misses++;
      this.opts.onMiss?.(this.misses, templateFn(c.hint ?? "Not yet: keep going.")(vars));
    }
  }

  render() {
    const vars = this.vars();
    for (const s of this.sliders) s.val.textContent = `${formatNumber(s.p.value, s.p.dp)}${s.p.unit ?? ""}`;
    this.svg.replaceChildren();
    this.lines = []; // points along drawn curves and rays, which labels keep off
    const kind = this.spec.kind;
    try {
      if (kind === "graph") this.graph(vars);
      else if (kind === "code") this.code(vars);
      else this.figure(vars);
    } catch (err) {
      console.warn(`[play] ${err.message}`);
    }
    this.untangle();
    // The live numbers and the live formula under the picture.
    const bits = this.values.filter((v) => v.label).map((v) => `<span class="pl-chip"><b>${esc(v.label)}</b> ${formatNumber(vars[v.id], v.dp)}${esc(v.unit ?? "")}</span>`);
    if (this.spec.formula) bits.push(`<span class="pl-formula">${esc(templateFn(this.spec.formula)(vars))}</span>`);
    this.readout.innerHTML = bits.join("");
    this.host.classList.toggle("near", this.met());
    this.opts.onChange?.(vars);
  }

  /** Words never sit on words: a label that overlaps an earlier one moves down, then up, a step at a time. */
  untangle() {
    const texts = [...this.svg.querySelectorAll("text.lbl")];
    const placed = [];
    const hit = (a, b) => a.x < b.x + b.width + 2 && b.x < a.x + a.width + 2 && a.y < b.y + b.height && b.y < a.y + a.height;
    for (const t of texts) {
      let box;
      try {
        box = t.getBBox();
      } catch {
        continue;
      }
      const y0 = Number(t.getAttribute("y"));
      for (const dy of [0, 18, -18, 36, -36, 54, -54, 72]) {
        const b = { x: box.x, y: box.y + dy, width: box.width, height: box.height };
        const onLine = this.lines.some(([px, py]) => px > b.x - 3 && px < b.x + b.width + 3 && py > b.y - 3 && py < b.y + b.height + 3);
        if (!placed.some((p) => hit(b, p)) && !onLine && b.y > 0 && b.y + b.height < H) {
          t.setAttribute("y", y0 + dy);
          box = b;
          break;
        }
      }
      placed.push(box);
    }
  }

  // ── a graph: axes from x/y ranges, curves in x and the params, points and guides ──
  graph(vars) {
    const s = this.spec;
    const [x0, x1] = s.x ?? [-5, 5];
    const [y0, y1] = s.y ?? [-5, 5];
    const L = 58, R = W - 24, T = 18, B = H - 42;
    const X = (x) => L + ((x - x0) / (x1 - x0)) * (R - L);
    const Y = (y) => B - ((y - y0) / (y1 - y0)) * (B - T);
    const g = el("g", {}, this.svg);
    const ax = (d, c = INK.grey, w = 1.5) => el("path", { d, stroke: c, "stroke-width": w, fill: "none", "stroke-linecap": "round" }, g);
    const xs = niceStep(x1 - x0);
    const ys = niceStep(y1 - y0);
    for (let v = Math.ceil(x0 / xs) * xs; v <= x1 + 1e-9; v += xs) {
      ax(`M${X(v)} ${T}V${B}`, "rgba(255,255,255,.06)", 1);
      text(g, X(v), B + 18, formatNumber(v), 14, INK.grey, "middle", HAND, "tick");
    }
    for (let v = Math.ceil(y0 / ys) * ys; v <= y1 + 1e-9; v += ys) {
      ax(`M${L} ${Y(v)}H${R}`, "rgba(255,255,255,.06)", 1);
      text(g, L - 8, Y(v) + 5, formatNumber(v), 14, INK.grey, "end", HAND, "tick");
    }
    const zx = x0 <= 0 && x1 >= 0 ? X(0) : L;
    const zy = y0 <= 0 && y1 >= 0 ? Y(0) : B;
    ax(`M${L} ${zy}H${R}`, INK.chalk, 1.8);
    ax(`M${zx} ${T}V${B}`, INK.chalk, 1.8);
    if (s.xLabel) text(g, R, B + 36, s.xLabel, 16, INK.chalk, "end");
    if (s.yLabel) text(g, L - 46, T + 2, s.yLabel, 16, INK.chalk, "start");
    for (const gd of s.guides ?? []) {
      if (gd.x !== undefined) ax(`M${X(numFn(gd.x)(vars))} ${T}V${B}`, ink(gd.color, "grey"), 1.5).setAttribute("stroke-dasharray", "5 6");
      if (gd.y !== undefined) ax(`M${L} ${Y(numFn(gd.y)(vars))}H${R}`, ink(gd.color, "grey"), 1.5).setAttribute("stroke-dasharray", "5 6");
    }
    for (const c of s.curves ?? []) {
      const f = compile(String(c.expr));
      let d = "";
      let pen = false;
      let last = null;
      for (let i = 0; i <= 240; i++) {
        const x = x0 + ((x1 - x0) * i) / 240;
        let y;
        try {
          y = f({ vars: { ...vars, x } });
        } catch {
          y = NaN;
        }
        if (!Number.isFinite(y) || y < y0 - (y1 - y0) || y > y1 + (y1 - y0)) {
          pen = false;
          continue;
        }
        d += `${pen ? "L" : "M"}${X(x).toFixed(1)} ${Y(y).toFixed(1)}`;
        pen = true;
        if (y >= y0 && y <= y1) {
          last = [X(x), Y(y)];
          this.lines.push(last);
        }
      }
      const clip = `pl-clip-${Math.random().toString(36).slice(2, 7)}`;
      const cp = el("clipPath", { id: clip }, g);
      el("rect", { x: L, y: T, width: R - L, height: B - T }, cp);
      el("path", { d, stroke: ink(c.color, "yellow"), "stroke-width": 3, fill: "none", "stroke-linecap": "round", "stroke-linejoin": "round", "clip-path": `url(#${clip})` }, g);
      // The curve's name sits where it leaves the graph, just above it.
      if (c.label && last) text(g, Math.min(R - 4, last[0]), Math.max(T + 14, Math.min(B - 8, last[1] + (last[1] < T + 40 ? 26 : -12))), templateFn(c.label)(vars), 17, ink(c.color, "yellow"), "end");
    }
    for (const p of s.points ?? []) {
      const px = numFn(p.at[0])(vars);
      const py = numFn(p.at[1])(vars);
      if (!Number.isFinite(px) || !Number.isFinite(py)) continue;
      const cx = Math.max(L, Math.min(R, X(px)));
      const cy = Math.max(T, Math.min(B, Y(py)));
      el("circle", { cx, cy, r: p.big ? 8 : 6, fill: ink(p.color, "pink"), stroke: "#000", "stroke-width": 2 }, g);
      if (p.label) text(g, cx + 12, cy - 10, templateFn(p.label)(vars), 17, ink(p.color, "pink"), cx > R - 120 ? "end" : "start");
    }
  }

  // ── a figure: FIGURE shapes in a 100 x 100 box, any number an expression ──
  figure(vars) {
    const size = H - 20;
    const ox = (W - size) / 2;
    const oy = 10;
    const P = ([x, y]) => [ox + (numFn(x)(vars) * size) / 100, oy + (numFn(y)(vars) * size) / 100];
    const S = (v) => (numFn(v)(vars) * size) / 100;
    const g = el("g", {}, this.svg);
    for (const sh of this.spec.shapes ?? []) {
      const stroke = ink(sh.color);
      const common = { stroke, "stroke-width": sh.w ?? 3, fill: sh.fill ? stroke : "none", "fill-opacity": sh.fill ? 0.14 : 1, "stroke-linecap": "round", "stroke-linejoin": "round" };
      if (sh.dash) common["stroke-dasharray"] = "6 7";
      if (sh.k === "circle") {
        const [cx, cy] = P(sh.c);
        el("circle", { cx, cy, r: S(sh.r), ...common }, g);
      } else if (sh.k === "ellipse") {
        const [cx, cy] = P(sh.c);
        el("ellipse", { cx, cy, rx: S(sh.rx), ry: S(sh.ry), ...common }, g);
      } else if (sh.k === "rect") {
        const [x, y] = P(sh.at);
        el("rect", { x, y, width: S(sh.size[0]), height: S(sh.size[1]), rx: S(sh.round ?? 0), ...common }, g);
      } else if (sh.k === "path" || sh.k === "arrow") {
        const pts = sh.k === "arrow" ? [sh.from, sh.to] : sh.pts ?? [];
        const xy = pts.map(P);
        if (xy.length < 2) continue;
        el("path", { d: `M${xy.map((p) => p.map((v) => v.toFixed(1)).join(" ")).join("L")}${sh.closed ? "Z" : ""}`, ...common }, g);
        if (sh.k === "arrow" || sh.head) {
          const [a, b] = xy.slice(-2);
          const ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
          const h = 13;
          el("path", { d: `M${b[0] - h * Math.cos(ang - 0.45)} ${b[1] - h * Math.sin(ang - 0.45)}L${b[0]} ${b[1]}L${b[0] - h * Math.cos(ang + 0.45)} ${b[1] - h * Math.sin(ang + 0.45)}`, ...common, fill: "none" }, g);
        }
      } else if (sh.k === "arc") {
        // An angle mark: centre, radius, from and to in degrees (0 = right, 90 = down).
        const [cx, cy] = P(sh.c);
        const r = S(sh.r);
        const a0 = (numFn(sh.from)(vars) * Math.PI) / 180;
        const a1 = (numFn(sh.to)(vars) * Math.PI) / 180;
        if (!Number.isFinite(a0) || !Number.isFinite(a1) || Math.abs(a1 - a0) < 1e-3) continue;
        const large = Math.abs(a1 - a0) > Math.PI ? 1 : 0;
        const sweep = a1 > a0 ? 1 : 0;
        el("path", { d: `M${cx + r * Math.cos(a0)} ${cy + r * Math.sin(a0)}A${r} ${r} 0 ${large} ${sweep} ${cx + r * Math.cos(a1)} ${cy + r * Math.sin(a1)}`, ...common, fill: "none" }, g);
      } else if (sh.k === "dots") {
        for (const p of sh.pts ?? []) {
          const [cx, cy] = P(p);
          el("circle", { cx, cy, r: 3.5, fill: stroke }, g);
        }
      } else if (sh.k === "text") {
        const [x, y] = P(sh.at);
        text(g, x, y, templateFn(sh.text)(vars), sh.size ?? 19, stroke, sh.align ?? "middle");
      }
    }
  }

  // ── code: lines with {expr} filled in, and what it prints ──
  code(vars) {
    const lines = (this.spec.lines ?? []).slice(0, 10).map((l) => templateFn(l)(vars));
    const size = lines.length > 7 ? 17 : 20;
    const g = el("g", {}, this.svg);
    const lh = size * 1.45;
    const top = 26;
    lines.forEach((l, i) => {
      const t = text(g, 34, top + i * lh, l, size, INK.chalk, "start", MONO);
      t.setAttribute("xml:space", "preserve");
      t.style.whiteSpace = "pre";
    });
    if (this.spec.output !== undefined) {
      const y = Math.min(H - 22, top + lines.length * lh + 22);
      text(g, 34, y, `▸ ${templateFn(this.spec.output)(vars)}`, size + 2, INK.green, "start", MONO);
    }
  }
}

function text(parent, x, y, str, size, color, anchor = "start", font = HAND, cls = "lbl") {
  const t = el("text", { x, y, fill: color, "font-size": size, "text-anchor": anchor, "font-family": font, class: cls }, parent);
  t.textContent = str;
  return t;
}

function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
}

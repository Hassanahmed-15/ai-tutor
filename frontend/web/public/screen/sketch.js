// The live board: draws a scene (lib/screen/sketch.ts; first built in screen-lab/) with a pencil, in
// step with Aria's sentences.
//
// The model only says WHAT to draw and during which sentence. Everything about WHERE is decided
// here, from measured text: each layout ("parts", "compare", "flow", "cycle", "hub", "equation",
// "graph", "code") has fixed rules for sizes and spacing, every figure is scaled to fill its box,
// labels sit in clear columns joined to their part by a leader line, and text that would not fit is
// made smaller, never cut or overlapped.
//
// World: 560 x 420 units (4:3), scaled to the board. Strokes are SVG paths drawn by animating their
// dash; text is HTML (so it measures exactly and maths can use KaTeX) revealed left to right.
import { compile } from "./vendor/expr.js";

const W = 560;
const H = 420;
const PAD = 16;
const SVGNS = "http://www.w3.org/2000/svg";
const HAND = '"Patrick Hand", "Comic Sans MS", cursive';
const MONO = 'ui-monospace, "SF Mono", Menlo, Consolas, monospace';
const INK = { chalk: "#f4f4ee", yellow: "#ffe45c", cyan: "#7fd8ff", pink: "#ff9ecb", green: "#9be59b", orange: "#ffb36b", violet: "#c4a7ff", grey: "#a3a3a3", red: "#ff7b7b" };
const ink = (c, fallback = "chalk") => INK[c] ?? INK[fallback];
const STROKE_PX_PER_MS = 0.42;
const TEXT_MS_PER_CHAR = 34;

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const f1 = (v) => Math.round(v * 10) / 10;
const P = (p) => `${f1(p[0])} ${f1(p[1])}`;
const num = (v) => typeof v === "number" && Number.isFinite(v);
const pt = (p) => Array.isArray(p) && p.length === 2 && num(p[0]) && num(p[1]);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** A seeded random, so a replay draws exactly the same wobbles. */
function rng(seedText) {
  let h = 2166136261;
  for (const ch of String(seedText)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return () => {
    h += 0x6d2b79f5;
    let t = h;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── Paths ────────────────────────────────────────────────────────────────────────────────────────

function linePath(pts, closed) {
  return pts.map((p, i) => `${i ? "L" : "M"}${P(p)}`).join(" ") + (closed ? " Z" : "");
}

/** A smooth curve through the points (Catmull-Rom as Béziers). */
function smoothPath(pts, closed) {
  if (pts.length < 3) return linePath(pts, closed);
  const Q = closed ? [pts[pts.length - 1], ...pts, pts[0], pts[1]] : [pts[0], ...pts, pts[pts.length - 1]];
  let d = `M${P(Q[1])}`;
  for (let i = 1; i < Q.length - 2; i++) {
    const [p0, p1, p2, p3] = [Q[i - 1], Q[i], Q[i + 1], Q[i + 2]];
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += ` C${P(c1)} ${P(c2)} ${P(p2)}`;
  }
  return d + (closed ? " Z" : "");
}

/** Points along a polyline every `step` units (for wavy lines and leader checks). */
function resample(pts, step, closed) {
  const list = closed ? [...pts, pts[0]] : pts;
  const out = [list[0]];
  for (let i = 1; i < list.length; i++) {
    const [a, b] = [list[i - 1], list[i]];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const n = Math.max(1, Math.round(len / step));
    for (let k = 1; k <= n; k++) out.push([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n]);
  }
  return out;
}

function wavyPoints(pts, closed, amp = 2.4, wave = 11) {
  const dense = resample(pts, 2, closed);
  let run = 0;
  return dense.map((p, i) => {
    const q = dense[Math.min(dense.length - 1, i + 1)];
    const o = dense[Math.max(0, i - 1)];
    if (i) run += Math.hypot(p[0] - o[0], p[1] - o[1]);
    const dx = q[0] - o[0];
    const dy = q[1] - o[1];
    const len = Math.hypot(dx, dy) || 1;
    const off = Math.sin((run / wave) * Math.PI * 2) * amp;
    return [p[0] - (dy / len) * off, p[1] + (dx / len) * off];
  });
}

function ellipsePoints(cx, cy, rx, ry, rot, rand, overshoot = true) {
  const n = 34;
  const start = rand() * Math.PI * 2;
  const extra = overshoot ? 0.16 : 0;
  const a = (rot * Math.PI) / 180;
  const out = [];
  for (let i = 0; i <= n; i++) {
    const t = start + (i / n) * Math.PI * 2 * (1 + extra);
    const j = 1 + (rand() - 0.5) * 0.022;
    const x = Math.cos(t) * rx * j;
    const y = Math.sin(t) * ry * j;
    out.push([cx + x * Math.cos(a) - y * Math.sin(a), cy + x * Math.sin(a) + y * Math.cos(a)]);
  }
  return out;
}

/** A pencil rounded rectangle: straight sides, curved corners, closed exactly (no corner loops). */
function roundRectPath(x, y, w, h, r, rand = () => 0.5) {
  r = clamp(r, 0, Math.min(w, h) / 2);
  const j = () => (rand() - 0.5) * 1.2;
  if (r < 1) return `M${P([x + j(), y + j()])} L${P([x + w + j(), y + j()])} L${P([x + w + j(), y + h + j()])} L${P([x + j(), y + h + j()])} Z`;
  return `M${P([x + r, y + j()])} L${P([x + w - r, y + j()])} Q${P([x + w, y])} ${P([x + w + j(), y + r])} L${P([x + w + j(), y + h - r])} Q${P([x + w, y + h])} ${P([x + w - r, y + h + j()])} L${P([x + r, y + h + j()])} Q${P([x, y + h])} ${P([x + j(), y + h - r])} L${P([x + j(), y + r])} Q${P([x, y])} ${P([x + r, y])} Z`;
}

function arrowHead(tip, from, size = 9) {
  const ang = Math.atan2(tip[1] - from[1], tip[0] - from[0]);
  const wing = (s) => [tip[0] - size * Math.cos(ang + s), tip[1] - size * Math.sin(ang + s)];
  return ` M${P(wing(0.45))} L${P(tip)} L${P(wing(-0.45))}`;
}

/** A pencil arrow from a to b, bent sideways by `bend` (% of its length). */
function arrowPath(a, b, bend = 0, head = true) {
  const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  const nx = -(b[1] - a[1]) / len;
  const ny = (b[0] - a[0]) / len;
  const c = [mid[0] + nx * (bend / 100) * len, mid[1] + ny * (bend / 100) * len];
  const d = bend ? `M${P(a)} Q${P(c)} ${P(b)}` : `M${P(a)} L${P(b)}`;
  return d + (head ? arrowHead(b, bend ? c : a) : "");
}

/** A symbol written on a drawing, with any LaTeX leftovers turned into plain text (H$_2$O → H₂O). */
const SUB = { 0: "₀", 1: "₁", 2: "₂", 3: "₃", 4: "₄", 5: "₅", 6: "₆", 7: "₇", 8: "₈", 9: "₉", "+": "₊", "-": "₋" };
const SUP = { 0: "⁰", 1: "¹", 2: "²", 3: "³", 4: "⁴", 5: "⁵", 6: "⁶", 7: "⁷", 8: "⁸", 9: "⁹", "+": "⁺", "-": "⁻" };
export function plainSymbol(t) {
  return String(t ?? "")
    .replace(/\$|\\[a-z]+\s*/gi, "")
    .replace(/_\{?([0-9+-]+)\}?/g, (_, d) => [...d].map((c) => SUB[c] ?? c).join(""))
    .replace(/\^\{?([0-9+-]+)\}?/g, (_, d) => [...d].map((c) => SUP[c] ?? c).join(""))
    .replace(/[{}]/g, "")
    .trim()
    .slice(0, 5);
}

/** A "picture" made only of a few boxes and letters says nothing: such figures are left out. */
function placeholderFigure(fig) {
  const shapes = (fig?.shapes ?? []).filter(validShape);
  if (!shapes.length) return true;
  const plain = shapes.every((s) => s.k === "rect" || s.k === "text");
  return plain && shapes.length <= 4;
}

// ── Measuring and boxes ──────────────────────────────────────────────────────────────────────────

const overlaps = (a, b, pad = 0) => a.x < b.x + b.w + pad && b.x < a.x + a.w + pad && a.y < b.y + b.h + pad && b.y < a.y + a.h + pad;

function nearestOnRect(r, p) {
  return [clamp(p[0], r.x, r.x + r.w), clamp(p[1], r.y, r.y + r.h)];
}

/** Where the segment from the box's centre towards p leaves the box (a leader's start). */
function edgeToward(r, p, pad = 4) {
  const cx = r.x + r.w / 2;
  const cy = r.y + r.h / 2;
  const dx = p[0] - cx;
  const dy = p[1] - cy;
  const sx = dx ? (r.w / 2 + pad) / Math.abs(dx) : Infinity;
  const sy = dy ? (r.h / 2 + pad) / Math.abs(dy) : Infinity;
  const s = Math.min(sx, sy, 1);
  return [cx + dx * s, cy + dy * s];
}

function niceStep(span, target = 5) {
  const raw = span / target;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const n = raw / mag;
  return (n < 1.5 ? 1 : n < 3 ? 2 : n < 7 ? 5 : 10) * mag;
}

function fmtNum(v) {
  const r = Math.round(v * 1000) / 1000;
  return String(r).replace("-", "−");
}

// ── The figure: model coordinates (0-100) to world coordinates, filling its box ───────────────────

function shapePoints(s) {
  switch (s.k) {
    case "circle":
      return [[s.c[0] - s.r, s.c[1] - s.r], [s.c[0] + s.r, s.c[1] + s.r]];
    case "ellipse": {
      const r = Math.max(s.rx, s.ry);
      return [[s.c[0] - r, s.c[1] - r], [s.c[0] + r, s.c[1] + r]];
    }
    case "rect":
      return [s.at, [s.at[0] + s.size[0], s.at[1] + s.size[1]]];
    case "path":
    case "dots":
      return s.pts;
    case "arrow":
      return [s.from, s.to];
    case "text":
      return [s.at];
    default:
      return [];
  }
}

function validShape(s) {
  if (!s || typeof s !== "object") return false;
  switch (s.k) {
    case "circle":
      return pt(s.c) && num(s.r) && s.r > 0;
    case "ellipse":
      return pt(s.c) && num(s.rx) && num(s.ry) && s.rx > 0 && s.ry > 0;
    case "rect":
      return pt(s.at) && pt(s.size) && s.size[0] > 0 && s.size[1] > 0;
    case "path":
      return Array.isArray(s.pts) && s.pts.length >= 2 && s.pts.every(pt);
    case "dots":
      return Array.isArray(s.pts) && s.pts.length >= 1 && s.pts.every(pt);
    case "arrow":
      return pt(s.from) && pt(s.to);
    case "text":
      return pt(s.at) && String(s.text ?? "").trim().length > 0;
    default:
      return false;
  }
}

/** Maps the figure's own extent onto `box` (keeping its shape), so a drawing always fills its box. */
function figureTransform(shapes, box) {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const s of shapes)
    for (const p of shapePoints(s)) {
      x0 = Math.min(x0, p[0]);
      y0 = Math.min(y0, p[1]);
      x1 = Math.max(x1, p[0]);
      y1 = Math.max(y1, p[1]);
    }
  const w = Math.max(x1 - x0, 8);
  const h = Math.max(y1 - y0, 8);
  const k = Math.min(box.w / w, box.h / h);
  const ox = box.x + (box.w - w * k) / 2 - x0 * k;
  const oy = box.y + (box.h - h * k) / 2 - y0 * k;
  return { k, map: (p) => [ox + p[0] * k, oy + p[1] * k], extent: { x: ox + x0 * k, y: oy + y0 * k, w: w * k, h: h * k } };
}

// ── The sketch ───────────────────────────────────────────────────────────────────────────────────

export class Sketch {
  constructor(host) {
    this.host = host;
    host.innerHTML = "";
    host.classList.add("sk");
    this.world = document.createElement("div");
    this.world.className = "sk-world";
    host.append(this.world);
    this.svg = document.createElementNS(SVGNS, "svg");
    this.svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    this.svg.setAttribute("class", "sk-svg");
    this.world.append(this.svg);
    this.nib = document.createElement("div");
    this.nib.className = "sk-nib";
    this.world.append(this.nib);
    this.items = [];
    this.gen = 0;
    this.spoken = 0; // the sentence Aria is on (1-based)
    this.sentenceMs = new Map();
    this.fit();
    this.resize = new ResizeObserver(() => this.fit());
    this.resize.observe(host);
  }

  fit() {
    const k = (this.host.clientWidth || W) / W;
    this.world.style.transform = `scale(${k})`;
    this.host.style.height = `${H * k}px`;
  }

  destroy() {
    this.gen++;
    this.resize.disconnect();
    this.host.innerHTML = "";
  }

  // ── building blocks ──

  /** An HTML text block at its natural size (wrapped at maxW), not yet placed or shown. */
  text(str, { size = 20, color = "chalk", maxW = W - 2 * PAD, align = "center", font = HAND, weight = 400, pre = false } = {}) {
    const el = document.createElement("div");
    el.className = "sk-text";
    el.textContent = pre ? String(str ?? "").replace(/\s+$/, "") : String(str ?? "").trim();
    if (pre) el.style.whiteSpace = "pre";
    Object.assign(el.style, { fontSize: `${size}px`, color: ink(color), maxWidth: `${maxW}px`, textAlign: align, fontFamily: font, fontWeight: weight });
    this.world.append(el);
    const box = { el, w: Math.ceil(el.offsetWidth) + 1, h: Math.ceil(el.offsetHeight), size };
    box.lines = Math.round(box.h / (size * 1.12));
    // Words are never broken: a word longer than the width shows as overflow, which fitText shrinks.
    box.overflow = el.scrollWidth > el.clientWidth + 1;
    if (box.overflow) box.w = Math.ceil(el.scrollWidth) + 1;
    return box;
  }

  /** The biggest size (down to `min`) at which the text fits in maxW on at most maxLines lines. */
  fitText(str, { size, min = 15, maxW, maxLines = 2, ...rest }) {
    for (let s = size; ; s -= 1) {
      const t = this.text(str, { size: s, maxW, ...rest });
      if ((t.lines <= maxLines && t.w <= maxW + 1 && !t.overflow) || s <= min) return t;
      t.el.remove();
    }
  }

  place(t, x, y) {
    t.x = x;
    t.y = y;
    Object.assign(t.el.style, { left: `${x}px`, top: `${y}px`, width: `${t.w}px` });
    return t;
  }

  path(d, { color = "chalk", width = 2.6, dash = false, fill = null, opacity = 1 } = {}) {
    const el = document.createElementNS(SVGNS, "path");
    el.setAttribute("d", d);
    el.setAttribute("fill", "none");
    el.setAttribute("stroke", ink(color));
    el.setAttribute("stroke-width", String(width));
    el.setAttribute("stroke-linecap", "round");
    el.setAttribute("stroke-linejoin", "round");
    if (opacity !== 1) el.setAttribute("opacity", String(opacity));
    this.svg.append(el);
    const item = { kind: "stroke", el, len: Math.max(1, el.getTotalLength()), dash, fillEl: null };
    if (dash) {
      // A dashed line is drawn through a mask, so its dashes appear as the pencil goes.
      const id = `sk-m${this.items.length}-${Math.round(Math.random() * 1e6)}`;
      const mask = document.createElementNS(SVGNS, "mask");
      mask.setAttribute("id", id);
      mask.setAttribute("maskUnits", "userSpaceOnUse");
      const m = el.cloneNode();
      m.setAttribute("stroke", "#fff");
      m.setAttribute("stroke-width", String(width + 4));
      mask.append(m);
      this.svg.append(mask);
      el.setAttribute("stroke-dasharray", "7 6");
      el.setAttribute("mask", `url(#${id})`);
      item.maskPath = m;
    }
    if (fill) {
      const fe = document.createElementNS(SVGNS, "path");
      fe.setAttribute("d", d);
      fe.setAttribute("fill", ink(fill));
      fe.setAttribute("fill-opacity", "0.17");
      fe.setAttribute("stroke", "none");
      fe.style.opacity = "0";
      this.svg.insertBefore(fe, this.svg.firstChild);
      item.fillEl = fe;
    }
    return item;
  }

  dot(p, { color = "chalk", r = 2.8 } = {}) {
    const el = document.createElementNS(SVGNS, "circle");
    el.setAttribute("cx", String(f1(p[0])));
    el.setAttribute("cy", String(f1(p[1])));
    el.setAttribute("r", String(r));
    el.setAttribute("fill", ink(color));
    this.svg.append(el);
    return { kind: "pop", el, at: p };
  }

  /** Adds things to the timeline: drawn during sentence `s`, in the order added. */
  add(s, ...things) {
    for (const t of things.flat()) if (t) this.items.push({ ...(t.kind ? t : { kind: "text", el: t.el, box: t }), s: clamp(Math.round(s || 1), 1, 99), seq: this.items.length });
  }

  // ── figures ──

  /** Draws a figure into `box`; returns { anchors: id → info } for labels. */
  figure(fig, box, { s = 1, seed = "", sOf = () => null } = {}) {
    const shapes = (fig?.shapes ?? []).filter(validShape);
    if (!shapes.length) return { anchors: new Map(), extent: box };
    const tf = figureTransform(shapes, box);
    const rand = rng(seed + JSON.stringify(shapes).length);
    const anchors = new Map();
    const width = clamp(2.2 + tf.k * 0.004, 2.2, 3);
    for (const sh of shapes) {
      const color = sh.color && INK[sh.color] ? sh.color : "chalk";
      const when = sh.s ?? sOf(sh.id) ?? s;
      const style = { color, width, dash: Boolean(sh.dash), fill: sh.fill && ["circle", "ellipse", "rect", "path"].includes(sh.k) ? color : null };
      let item = null;
      let info = null;
      switch (sh.k) {
        case "circle":
        case "ellipse": {
          const c = tf.map(sh.c);
          const rx = (sh.k === "circle" ? sh.r : sh.rx) * tf.k;
          const ry = (sh.k === "circle" ? sh.r : sh.ry) * tf.k;
          let pts = ellipsePoints(c[0], c[1], rx, ry, sh.rot ?? 0, rand, !sh.fill && !sh.wavy);
          if (sh.wavy) pts = wavyPoints(pts.slice(0, -1), true);
          item = this.path(smoothPath(pts, Boolean(sh.fill || sh.wavy)), style);
          info = { c, outline: ellipsePoints(c[0], c[1], rx, ry, sh.rot ?? 0, () => 0.5, false), area: Math.PI * rx * ry };
          break;
        }
        case "rect": {
          const a = tf.map(sh.at);
          const w = sh.size[0] * tf.k;
          const h = sh.size[1] * tf.k;
          const r = clamp((sh.round ?? 0) * tf.k, 0, Math.min(w, h) / 2);
          let pts;
          if (!sh.wavy) {
            const outline = resample([a, [a[0] + w, a[1]], [a[0] + w, a[1] + h], [a[0], a[1] + h]], 4, true);
            item = this.path(roundRectPath(a[0], a[1], w, h, r, rand), style);
            info = { c: [a[0] + w / 2, a[1] + h / 2], outline, area: w * h };
            break;
          }
          if (r > 1) {
            pts = [];
            const corner = (cx, cy, a0) => {
              for (let i = 0; i <= 5; i++) {
                const t = ((a0 + (i / 5) * 90) * Math.PI) / 180;
                pts.push([cx + Math.cos(t) * r, cy + Math.sin(t) * r]);
              }
            };
            corner(a[0] + w - r, a[1] + r, -90);
            corner(a[0] + w - r, a[1] + h - r, 0);
            corner(a[0] + r, a[1] + h - r, 90);
            corner(a[0] + r, a[1] + r, 180);
          } else pts = [a, [a[0] + w, a[1]], [a[0] + w, a[1] + h], [a[0], a[1] + h]];
          if (sh.wavy) pts = wavyPoints(pts, true);
          item = this.path(r > 1 || sh.wavy ? smoothPath(pts, true) : linePath(pts, true), style);
          info = { c: [a[0] + w / 2, a[1] + h / 2], outline: resample(pts, 4, true), area: w * h };
          break;
        }
        case "path": {
          let pts = sh.pts.map(tf.map);
          const closed = Boolean(sh.closed);
          const outline = resample(pts, 4, closed);
          if (sh.wavy) pts = wavyPoints(pts, closed);
          item = this.path(sh.smooth || sh.wavy ? smoothPath(pts, closed) : linePath(pts, closed), { ...style, fill: closed ? style.fill : null });
          let area = 0;
          if (closed) for (let i = 0; i < pts.length; i++) area += pts[i][0] * pts[(i + 1) % pts.length][1] - pts[(i + 1) % pts.length][0] * pts[i][1];
          const mid = outline[Math.floor(outline.length / 2)];
          const c = closed ? [pts.reduce((a, p) => a + p[0], 0) / pts.length, pts.reduce((a, p) => a + p[1], 0) / pts.length] : mid;
          info = { c, outline, area: Math.abs(area) / 2, open: !closed };
          break;
        }
        case "arrow": {
          const a = tf.map(sh.from);
          const b = tf.map(sh.to);
          item = this.path(arrowPath(a, b, clamp(sh.bend ?? 0, -40, 40)), { ...style, fill: null });
          info = { c: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], outline: [a, b], area: 0, open: true };
          break;
        }
        case "dots": {
          const dots = sh.pts.map((p) => this.dot(tf.map(p), { color, r: clamp(2.2 * tf.k * 0.4, 2.2, 3.6) }));
          this.add(when, dots);
          const c = tf.map(sh.pts[0]);
          info = { c, outline: sh.pts.map(tf.map), area: 0, open: true };
          break;
        }
        case "text": {
          const at = tf.map(sh.at);
          const t = this.text(plainSymbol(sh.text), { size: clamp(9 * tf.k * 0.9, 16, 26), color });
          this.place(t, at[0] - t.w / 2, at[1] - t.h / 2);
          this.add(when, t);
          info = { c: at, outline: [at], area: 0 };
          break;
        }
      }
      if (item) this.add(when, item);
      if (sh.id && info) anchors.set(sh.id, { ...info, id: sh.id, color });
    }
    return { anchors, extent: tf.extent };
  }

  // ── frame: title, takeaway ──

  frame(scene, last) {
    const title = this.fitText(scene.title || "", { size: 30, min: 20, maxW: W - 2 * PAD, maxLines: 1, color: "yellow" });
    this.place(title, (W - title.w) / 2, 8);
    this.add(1, title);
    let bottom = H - 12;
    if (String(scene.takeaway ?? "").trim()) {
      const t = this.fitText(scene.takeaway, { size: 22, min: 16, maxW: W - 2 * PAD - 20, maxLines: 1, color: "chalk" });
      const y = H - 12 - t.h;
      this.place(t, (W - t.w) / 2, y);
      const u = this.path(`M${P([(W - t.w) / 2 - 6, y + t.h + 1])} Q${P([W / 2, y + t.h + 4])} ${P([(W + t.w) / 2 + 6, y + t.h])}`, { color: "yellow", width: 2.4 });
      this.add(scene.takeawayS ?? last, t, u);
      bottom = y - 10;
    }
    return { x: PAD, y: 8 + title.h + 10, w: W - 2 * PAD, h: bottom - (8 + title.h + 10) };
  }

  // ── layouts ──

  layoutParts(scene, area, last) {
    const labels = (scene.labels ?? []).filter((l) => String(l?.text ?? "").trim());
    const firstS = new Map();
    for (const l of labels) if (!firstS.has(l.part)) firstS.set(l.part, l.s ?? 1);
    // A first pass without labels: where each part sits, to choose the label sides.
    const shapes = (scene.figure?.shapes ?? []).filter(validShape);
    const probe = figureTransform(shapes, { x: 0, y: 0, w: 100, h: 100 });
    const centreOf = (id) => {
      const sh = shapes.find((s) => s.id === id);
      if (!sh) return null;
      const pts = shapePoints(sh).map(probe.map);
      return [pts.reduce((a, p) => a + p[0], 0) / pts.length, pts.reduce((a, p) => a + p[1], 0) / pts.length];
    };
    const sized = (fontSize) =>
      labels.map((l) => ({ l, at: centreOf(l.part), t: this.fitText(l.text, { size: fontSize, min: 15, maxW: 150, maxLines: 2, color: l.color ?? shapes.find((s) => s.id === l.part)?.color ?? "chalk", align: "left" }) }));
    let rows = sized(21);
    // Sides: left half of the drawing → left column; keep the two columns balanced.
    rows.forEach((r) => (r.side = (r.at?.[0] ?? 50) < 50 ? "L" : "R"));
    const balance = () => {
      const left = rows.filter((r) => r.side === "L");
      const right = rows.filter((r) => r.side === "R");
      const [big, other] = left.length > right.length ? [left, "R"] : [right, "L"];
      if (big.length - (rows.length - big.length) > 1) {
        big.sort((a, b) => Math.abs((a.at?.[0] ?? 50) - 50) - Math.abs((b.at?.[0] ?? 50) - 50));
        big[0].side = other;
        balance();
      }
    };
    balance();
    const gap = 16;
    let colL = Math.max(0, ...rows.filter((r) => r.side === "L").map((r) => r.t.w));
    let colR = Math.max(0, ...rows.filter((r) => r.side === "R").map((r) => r.t.w));
    let size = Math.min(area.h, area.w - colL - colR - (colL ? gap : 0) - (colR ? gap : 0));
    if (size < 170 && rows.length) {
      rows.forEach((r) => r.t.el.remove());
      rows = sized(17).map((r, i) => ({ ...r, side: rows[i].side }));
      colL = Math.max(0, ...rows.filter((r) => r.side === "L").map((r) => r.t.w));
      colR = Math.max(0, ...rows.filter((r) => r.side === "R").map((r) => r.t.w));
      size = Math.min(area.h, area.w - colL - colR - (colL ? gap : 0) - (colR ? gap : 0));
    }
    const free = area.w - colL - colR - (colL ? gap : 0) - (colR ? gap : 0);
    const figBox = { x: area.x + colL + (colL ? gap : 0) + (free - size) / 2, y: area.y + (area.h - size) / 2, w: size, h: size };
    const { anchors, extent } = this.figure(scene.figure, figBox, { seed: scene.title, sOf: (id) => firstS.get(id) ?? null });
    // Label columns hug the drawing's real extent.
    const leftX = extent.x - gap - colL;
    const rightX = extent.x + extent.w + gap;
    const area2 = { top: area.y, bottom: area.y + area.h };
    for (const side of ["L", "R"]) {
      const list = rows.filter((r) => r.side === side && anchors.has(r.l.part));
      for (const r of list) {
        const a = anchors.get(r.l.part);
        r.anchor = a.c;
        r.want = a.c[1] - r.t.h / 2;
      }
      list.sort((a, b) => a.want - b.want);
      // Spread out with no overlap, as close to each part as they can be.
      let y = area2.top;
      for (const r of list) {
        r.y = Math.max(r.want, y);
        y = r.y + r.t.h + 8;
      }
      let limit = area2.bottom;
      for (const r of [...list].reverse()) {
        r.y = Math.min(r.y, limit - r.t.h);
        limit = r.y - 8;
      }
      for (const r of list) {
        const x = side === "L" ? Math.max(area.x, leftX + colL - r.t.w) : Math.min(rightX, area.x + area.w - r.t.w);
        this.place(r.t, x, r.y);
        // The leader ends ON the part: its centre if small, else the nearest point of its outline.
        const a = anchors.get(r.l.part);
        const from = [side === "L" ? x + r.t.w + 5 : x - 5, r.y + r.t.h / 2];
        let end = a.c;
        // A big closed outline (a cell wall) is pointed at where it is nearest; a line or a small
        // part at its middle.
        const big = a.area > size * size * 0.18 && !a.open;
        if (big && a.outline?.length) {
          let best = Infinity;
          for (const p of a.outline) {
            const d = Math.hypot(p[0] - from[0], p[1] - from[1]);
            if (d < best) {
              best = d;
              end = p;
            }
          }
        }
        const leader = this.path(`M${P(from)} L${P(end)}`, { color: "grey", width: 1.6 });
        const tip = this.dot(end, { color: a.color === "chalk" ? "yellow" : a.color, r: 2.6 });
        this.add(r.l.s ?? 1, leader, tip, r.t);
      }
    }
    // Labels whose part does not exist: listed under the drawing rather than lost.
    rows.filter((r) => !anchors.has(r.l.part)).forEach((r) => r.t.el.remove());
  }

  layoutCompare(scene, area) {
    const cols = (scene.columns ?? []).filter((c) => String(c?.title ?? "").trim()).slice(0, 4);
    const n = cols.length;
    if (!n) return;
    const groups = (scene.groups ?? []).filter((g) => Array.isArray(g?.covers) && g.covers.length && String(g.text ?? "").trim());
    const band = groups.length ? 52 : 0;
    const gap = 18;
    const colW = (area.w - gap * (n - 1)) / n;
    cols.forEach((c) => {
      if (c.figure && placeholderFigure(c.figure)) c.figure = null;
    });
    const hasFig = cols.some((c) => c.figure?.shapes?.length);
    const build = (titleSize, pointSize, figH) => {
      const out = cols.map((c) => {
        const title = this.fitText(c.title, { size: titleSize, min: 17, maxW: colW, maxLines: 2, color: c.color ?? "chalk" });
        const points = (c.points ?? []).slice(0, 3).map((p) => this.fitText(`${p}`, { size: pointSize, min: 14, maxW: colW - 4, maxLines: 3, color: "chalk" }));
        const h = title.h + (hasFig ? figH + 10 : 4) + points.reduce((a, p) => a + p.h + 6, 0);
        return { c, title, points, h };
      });
      return out;
    };
    let figH = Math.min(colW - 8, (area.h - band) * 0.48);
    let built = build(25, 19, figH);
    for (let i = 0; i < 4 && Math.max(...built.map((b) => b.h)) > area.h - band; i++) {
      built.forEach((b) => [b.title, ...b.points].forEach((t) => t.el.remove()));
      figH *= 0.82;
      built = build(23 - i, 18 - i * 0.5, figH);
    }
    const tallest = Math.max(...built.map((b) => b.h));
    const top = area.y + Math.max(0, (area.h - band - tallest) / 2);
    built.forEach((b, i) => {
      const x = area.x + i * (colW + gap);
      const s = b.c.s ?? i + 1;
      let y = top;
      this.place(b.title, x + (colW - b.title.w) / 2, y);
      this.add(s, b.title);
      y += b.title.h + 6;
      if (hasFig) {
        if (b.c.figure?.shapes?.length) this.figure(b.c.figure, { x: x + 6, y, w: colW - 12, h: figH }, { s, seed: `${scene.title}${i}` });
        y += figH + 10;
      }
      for (const p of b.points) {
        this.place(p, x + (colW - p.w) / 2, y);
        this.add(s, p);
        y += p.h + 6;
      }
      if (i > 0) this.add(1, this.path(`M${P([x - gap / 2, area.y + 4])} L${P([x - gap / 2, top + tallest])}`, { color: "grey", width: 1.4, dash: true, opacity: 0.6 }));
    });
    // Brackets that join columns sharing something, under them, labelled.
    const used = [];
    for (const g of groups) {
      const idx = g.covers.filter((k) => k >= 0 && k < n).sort((a, b) => a - b);
      if (!idx.length) continue;
      const x0 = area.x + idx[0] * (colW + gap) + 8;
      const x1 = area.x + idx[idx.length - 1] * (colW + gap) + colW - 8;
      const row = used.filter((u) => u.x0 < x1 && x0 < u.x1).length;
      used.push({ x0, x1 });
      const y = top + tallest + 10 + row * 4;
      const color = g.color ?? "yellow";
      const br = this.path(`M${P([x0, y - 6])} Q${P([x0, y])} ${P([x0 + 8, y])} L${P([x1 - 8, y])} Q${P([x1, y])} ${P([x1, y - 6])} M${P([(x0 + x1) / 2 - 6, y])} L${P([(x0 + x1) / 2, y + 6])} L${P([(x0 + x1) / 2 + 6, y])}`, { color, width: 2.2 });
      const t = this.fitText(g.text, { size: 21, min: 15, maxW: x1 - x0 + 20, maxLines: 1, color });
      this.place(t, clamp((x0 + x1) / 2 - t.w / 2, PAD, W - PAD - t.w), y + 8);
      this.add(g.s ?? n, br, t);
    }
  }

  stepBox(st, maxW, figH, color = "chalk") {
    const t = this.fitText(st.text, { size: 20, min: 15, maxW: maxW - 14, maxLines: 3, color });
    const hasFig = Boolean(st.figure?.shapes?.length);
    const w = Math.max(t.w + 18, hasFig ? Math.min(maxW, figH + 12) : 0);
    const h = t.h + 14 + (hasFig ? figH + 6 : 0);
    return { st, t, w: Math.min(maxW, w), h, hasFig };
  }

  drawStep(b, x, y, s, seed, figH) {
    const r = 9;
    const box = this.path(roundRectPath(x, y, b.w, b.h, r, rng(seed)), { color: "grey", width: 2 });
    this.add(s, box);
    let ty = y + 7;
    if (b.hasFig) {
      this.figure(b.st.figure, { x: x + 6, y: y + 6, w: b.w - 12, h: figH }, { s, seed });
      ty += figH + 6;
    }
    this.place(b.t, x + (b.w - b.t.w) / 2, ty);
    this.add(s, b.t);
    return { x, y, w: b.w, h: b.h };
  }

  layoutFlow(scene, area) {
    const steps = (scene.steps ?? []).filter((s) => String(s?.text ?? "").trim()).slice(0, 6);
    const n = steps.length;
    if (!n) return;
    const arrows = Array.isArray(scene.arrows) ? scene.arrows : [];
    steps.forEach((st) => {
      if (st.figure && placeholderFigure(st.figure)) st.figure = null;
    });
    // Each box must be wide enough for its longest word at a readable size; otherwise two rows.
    const longestWord = Math.max(
      ...steps.map((st) => {
        const words = String(st.text).split(/\s+/).sort((a, b) => b.length - a.length);
        const t = this.text(words[0], { size: 18 });
        t.el.remove();
        return t.w;
      }),
    );
    const minBox = Math.max(longestWord + 22, 86);
    const fits = (k) => (area.w - 34 * (k - 1)) / k >= minBox;
    const rowsN = n <= 3 || (n <= 4 && fits(n)) ? 1 : 2;
    const perRow = Math.ceil(n / rowsN);
    // Arrows get room for their words, so a label never sits on a box.
    let gapX = 34;
    for (const a of arrows) {
      if (!String(a ?? "").trim()) continue;
      const t = this.fitText(a, { size: 15, min: 12, maxW: 96, maxLines: 2, color: "grey" });
      gapX = Math.max(gapX, Math.min(104, t.w + 14, (area.w - minBox * perRow) / Math.max(1, perRow - 1)));
      t.el.remove();
    }
    const maxW = (area.w - gapX * (perRow - 1)) / perRow;
    const hasFig = steps.some((s) => s.figure?.shapes?.length);
    const figH = hasFig ? Math.min(maxW - 12, (area.h / rowsN) * 0.5) : 0;
    const boxes = steps.map((st, i) => this.stepBox(st, maxW, figH, i === n - 1 ? "yellow" : "chalk"));
    const rowH = (r) => Math.max(...boxes.slice(r * perRow, (r + 1) * perRow).map((b) => b.h));
    const rowGap = 40;
    const total = rowH(0) + (rowsN > 1 ? rowGap + rowH(1) : 0);
    let y = area.y + Math.max(0, (area.h - total) / 2);
    const placed = [];
    for (let r = 0; r < rowsN; r++) {
      const row = boxes.slice(r * perRow, (r + 1) * perRow);
      const width = row.reduce((a, b) => a + b.w, 0) + gapX * (row.length - 1);
      if (r === 0) {
        let x = area.x + (area.w - width) / 2;
        row.forEach((b, i) => {
          placed[i] = { b, x, y: y + (rowH(0) - b.h) / 2 };
          x += b.w + gapX;
        });
      } else {
        // The second row runs right to left from under the first row's end, so the path snakes.
        const last = placed[perRow - 1];
        let rx = Math.min(area.x + area.w, last.x + last.b.w / 2 + row[0].w / 2);
        row.forEach((b, i) => {
          rx -= b.w;
          placed[perRow + i] = { b, x: Math.max(area.x, rx), y: y + (rowH(1) - b.h) / 2 };
          rx -= gapX;
        });
      }
      y += rowH(r) + rowGap;
    }
    placed.forEach((p, k) => {
      const s = p.b.st.s ?? k + 1;
      const rect = this.drawStep(p.b, p.x, p.y, s, `${scene.title}${k}`, figH);
      p.rect = rect;
      if (k === 0) return;
      const q = placed[k - 1];
      const a = q.rect;
      const sameRow = Math.floor((k - 1) / perRow) === Math.floor(k / perRow);
      let from;
      let to;
      if (sameRow && a.x < rect.x) {
        from = [a.x + a.w + 5, a.y + a.h / 2];
        to = [rect.x - 5, rect.y + rect.h / 2];
      } else if (sameRow) {
        from = [a.x - 5, a.y + a.h / 2];
        to = [rect.x + rect.w + 5, rect.y + rect.h / 2];
      } else {
        from = [a.x + a.w / 2, a.y + a.h + 5];
        to = [rect.x + rect.w / 2, rect.y - 5];
      }
      const arrow = this.path(arrowPath(from, to, 0), { color: "yellow", width: 2.4 });
      const label = String(arrows[k - 1] ?? "").trim();
      const items = [arrow];
      if (label) {
        const t = this.fitText(label, { size: 15, min: 12, maxW: sameRow ? gapX - 12 : 140, maxLines: 2, color: "grey" });
        if (sameRow) this.place(t, (from[0] + to[0]) / 2 - t.w / 2, from[1] - t.h - 6);
        else this.place(t, from[0] + 8 + t.w > W - PAD ? from[0] - 8 - t.w : from[0] + 8, (from[1] + to[1]) / 2 - t.h / 2);
        items.push(t);
      }
      this.add(s, items);
    });
  }

  layoutCycle(scene, area) {
    const steps = (scene.steps ?? []).filter((s) => String(s?.text ?? "").trim()).slice(0, 6);
    const n = steps.length;
    if (n < 2) return this.layoutFlow(scene, area);
    const maxW = n <= 4 ? 170 : 140;
    const boxes = steps.map((st, i) => this.stepBox({ ...st, figure: null }, maxW, 0, i === 0 ? "yellow" : "chalk"));
    const cx = area.x + area.w / 2;
    const cy = area.y + area.h / 2;
    const bw = Math.max(...boxes.map((b) => b.w));
    const bh = Math.max(...boxes.map((b) => b.h));
    const rx = area.w / 2 - bw / 2 - 4;
    const ry = area.h / 2 - bh / 2 - 2;
    const angle = (i) => -Math.PI / 2 + (i / n) * Math.PI * 2;
    const rects = boxes.map((b, i) => {
      const x = cx + Math.cos(angle(i)) * rx - b.w / 2;
      const y = cy + Math.sin(angle(i)) * ry - b.h / 2;
      return this.drawStep(b, x, y, b.st.s ?? i + 1, `${scene.title}${i}`, 0);
    });
    const inside = (p, pad = 7) => rects.some((r) => p[0] > r.x - pad && p[0] < r.x + r.w + pad && p[1] > r.y - pad && p[1] < r.y + r.h + pad);
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const pts = [];
      for (let k = 0; k <= 60; k++) {
        const t = angle(i) + ((k / 60) * Math.PI * 2) / n;
        const p = [cx + Math.cos(t) * rx * 0.96, cy + Math.sin(t) * ry * 0.96];
        if (!inside(p)) pts.push(p);
      }
      if (pts.length < 3) continue;
      const d = smoothPath(pts.filter((_, k) => k % 3 === 0 || k === pts.length - 1), false) + arrowHead(pts[pts.length - 1], pts[pts.length - 3]);
      this.add(steps[j].s ?? j + 1, this.path(d, { color: "yellow", width: 2.3 }));
    }
    if (String(scene.center ?? "").trim()) {
      const t = this.fitText(scene.center, { size: 22, min: 15, maxW: rx * 1.1, maxLines: 2, color: "yellow" });
      this.place(t, cx - t.w / 2, cy - t.h / 2);
      this.add(steps[0]?.s ?? 1, t);
    }
  }

  layoutHub(scene, area) {
    const spokes = (scene.spokes ?? []).filter((s) => String(s?.text ?? "").trim()).slice(0, 6);
    const n = spokes.length;
    const cx = area.x + area.w / 2;
    const cy = area.y + area.h / 2;
    const angles = { 1: [0], 2: [180, 0], 3: [-90, 30, 150], 4: [-140, -40, 40, 140], 5: [-90, -18, 54, 126, 198], 6: [-150, -90, -30, 30, 90, 150] }[n] ?? [];
    for (let size = 20; size >= 14; size--) {
      const center = this.fitText(scene.center || scene.title, { size: size + 4, min: 16, maxW: 170, maxLines: 2, color: "yellow" });
      const cRect = { x: cx - center.w / 2 - 14, y: cy - center.h / 2 - 9, w: center.w + 28, h: center.h + 18 };
      const rx = area.w / 2 - 80;
      const ry = area.h / 2 - 28;
      const ts = spokes.map((sp, i) => {
        const t = this.fitText(sp.text, { size, min: 14, maxW: 150, maxLines: 3, color: "chalk" });
        const a = (angles[i] * Math.PI) / 180;
        const px = clamp(cx + Math.cos(a) * rx - t.w / 2, area.x, area.x + area.w - t.w);
        const py = clamp(cy + Math.sin(a) * ry - t.h / 2, area.y, area.y + area.h - t.h);
        return { sp, t, r: { x: px, y: py, w: t.w, h: t.h } };
      });
      const clash = ts.some((a, i) => overlaps(a.r, cRect, 6) || ts.some((b, j) => j > i && overlaps(a.r, b.r, 8)));
      if (clash && size > 14) {
        [center, ...ts.map((x) => x.t)].forEach((t) => t.el.remove());
        continue;
      }
      this.place(center, cx - center.w / 2, cy - center.h / 2);
      const ring = this.path(smoothPath(ellipsePoints(cx, cy, cRect.w / 2 + 4, cRect.h / 2 + 2, 0, rng(scene.title), true), false), { color: "yellow", width: 2.4 });
      this.add(1, center, ring);
      ts.forEach(({ sp, t, r }, i) => {
        this.place(t, r.x, r.y);
        const tc = [r.x + r.w / 2, r.y + r.h / 2];
        const a = Math.atan2(tc[1] - cy, tc[0] - cx);
        const start = [cx + Math.cos(a) * (cRect.w / 2 + 6), cy + Math.sin(a) * (cRect.h / 2 + 4)];
        const end = edgeToward(r, [cx, cy], 6);
        this.add(sp.s ?? i + 1, this.path(`M${P(start)} L${P(end)}`, { color: "grey", width: 1.8 }), t);
      });
      return;
    }
  }

  layoutEquation(scene, area) {
    // A word problem: its picture (labelled like "parts") on the left, the working on the right.
    if (scene.figure?.shapes?.length && !placeholderFigure(scene.figure)) {
      const figW = Math.round(area.w * 0.44);
      this.layoutParts({ figure: scene.figure, labels: scene.figureLabels ?? [], title: scene.title }, { x: area.x, y: area.y, w: figW, h: area.h });
      area = { x: area.x + figW + 14, y: area.y, w: area.w - figW - 14, h: area.h };
    }
    // Words typed straight into maths mode lose their spaces and go italic ("carbondioxide"): any run
    // of plain words outside \\text{} and outside a command is wrapped in \\text{}.
    const textify = (tex) => {
      let out = "";
      let i = 0;
      while (i < tex.length) {
        const rest = tex.slice(i);
        const textCmd = /^\\(?:text|mathrm|textbf|operatorname)\s*\{[^{}]*\}/.exec(rest);
        if (textCmd) {
          out += textCmd[0];
          i += textCmd[0].length;
          continue;
        }
        const cmd = /^\\[a-zA-Z]+/.exec(rest);
        if (cmd) {
          out += cmd[0];
          i += cmd[0].length;
          continue;
        }
        const words = /^[A-Za-z]{3,}(?:[ ,'-]+[A-Za-z]+)*/.exec(rest);
        if (words && !/[A-Za-z]$/.test(out)) {
          out += `\\text{${words[0]}}`;
          i += words[0].length;
          continue;
        }
        out += tex[i];
        i++;
      }
      return out;
    };
    const lines = (scene.lines ?? []).filter((l) => String(l?.tex ?? "").trim()).slice(0, 5);
    const callouts = (scene.callouts ?? []).filter((c) => lines[c?.line] && String(c.term ?? "") && String(lines[c.line].tex).includes(c.term));
    const katex = window.katex;
    const render = (l, li, size) => {
      let tex = String(l.tex);
      callouts.forEach((c, ci) => {
        if (c.line === li && tex.includes(c.term)) tex = tex.replace(c.term, `\\htmlId{sk-hl-${ci}}{${c.term}}`);
      });
      const el = document.createElement("div");
      el.className = "sk-text sk-eq";
      el.style.fontSize = `${size}px`;
      el.style.color = ink("chalk");
      try {
        if (!katex) throw new Error("no KaTeX");
        el.innerHTML = katex.renderToString(textify(tex), { throwOnError: true, trust: (ctx) => ctx.command === "\\htmlId", strict: "ignore", displayMode: true });
      } catch {
        try {
          el.innerHTML = katex ? katex.renderToString(String(l.tex), { throwOnError: true, strict: "ignore", displayMode: true }) : "";
        } catch {
          el.innerHTML = "";
        }
        if (!el.innerHTML) {
          el.textContent = String(l.tex).replace(/\\[a-z]+/gi, " ").replace(/[{}]/g, "");
          el.style.fontFamily = HAND;
        }
      }
      this.world.append(el);
      // Superscripts and wide symbols can stick out of the box KaTeX reports: measure the ink.
      const k = this.world.getBoundingClientRect().width / W || 1;
      const base = el.getBoundingClientRect();
      let right = base.left + el.offsetWidth * k;
      for (const part of el.querySelectorAll(".katex-html span")) {
        const r = part.getBoundingClientRect();
        if (r.width) right = Math.max(right, r.right);
      }
      const w = Math.max(el.offsetWidth, el.scrollWidth, (right - base.left) / k);
      el.style.width = `${Math.ceil(w) + 2}px`;
      return { el, w: Math.ceil(w) + 4, h: Math.ceil(el.offsetHeight), size };
    };
    // Each callout is written on the side its term is on (a numerator's above, a denominator's below;
    // otherwise below, then above for a second one on the same line), in a band kept free for it.
    const sides = (blocks) => {
      const perLine = new Map();
      callouts.forEach((c, ci) => {
        const eq = blocks[c.line]?.eq.el;
        const term = eq?.querySelector(`#sk-hl-${ci}`);
        let side = null;
        if (eq && term) {
          const a = eq.getBoundingClientRect();
          const b = term.getBoundingClientRect();
          const rel = (b.top + b.height / 2 - a.top) / (a.height || 1);
          if (rel < 0.42) side = "above";
          else if (rel > 0.58) side = "below";
        }
        const n = perLine.get(c.line) ?? 0;
        c.side = side ?? (n % 2 ? "above" : "below");
        perLine.set(c.line, n + 1);
      });
    };
    const BAND = 44;
    const bandAbove = (i) => (callouts.some((c) => c.line === i && c.side === "above") ? BAND : 0);
    const bandBelow = (i) => (callouts.some((c) => c.line === i && c.side === "below") ? BAND : 0);
    const NOTE_GAP = 34;
    let size = 36;
    let blocks;
    for (;;) {
      blocks = lines.map((l, i) => {
        const eq = render(l, i, size);
        const note = String(l.note ?? "").trim() ? this.fitText(l.note, { size: clamp(Math.round(size * 0.55), 15, 20), min: 14, maxW: 180, maxLines: 2, color: "cyan", align: "left" }) : null;
        return { l, eq, note };
      });
      sides(blocks);
      const widest = Math.max(...blocks.map((b) => b.eq.w + (b.note ? b.note.w + NOTE_GAP : 0)));
      const tall = blocks.reduce((a, b, i) => a + Math.max(b.eq.h, b.note?.h ?? 0) + bandAbove(i) + bandBelow(i), 0) + (blocks.length - 1) * 14;
      if (widest <= area.w && tall <= area.h) break;
      blocks.forEach((b) => [b.eq, b.note].forEach((t) => t?.el.remove()));
      if (size > 20) size -= 3;
      else if (lines.some((l) => l.note)) lines.forEach((l) => (l.note = "")); // too full: side notes go first
      else if (callouts.length > 2) callouts.splice(2);
      else if (lines.length > 3) lines.splice(3);
      else {
        blocks = lines.map((l, i) => ({ l, eq: render(l, i, size), note: null }));
        sides(blocks);
        break;
      }
    }
    const tall = blocks.reduce((a, b, i) => a + Math.max(b.eq.h, b.note?.h ?? 0) + bandAbove(i) + bandBelow(i), 0) + (blocks.length - 1) * 14;
    let y = area.y + Math.max(0, (area.h - tall) / 2);
    const placedLines = [];
    blocks.forEach((b, i) => {
      y += bandAbove(i);
      const rowH = Math.max(b.eq.h, b.note?.h ?? 0);
      const width = b.eq.w + (b.note ? b.note.w + NOTE_GAP : 0);
      const x = area.x + (area.w - width) / 2;
      this.place(b.eq, x, y + (rowH - b.eq.h) / 2);
      const s = b.l.s ?? i + 1;
      this.add(s, b.eq);
      if (b.note) {
        const nx = x + b.eq.w + NOTE_GAP;
        this.place(b.note, nx, y + (rowH - b.note.h) / 2);
        const arrow = this.path(arrowPath([nx - 5, y + rowH / 2], [x + b.eq.w + 11, y + rowH / 2], 0), { color: "cyan", width: 1.8 });
        this.add(s, arrow, b.note);
      }
      placedLines.push({ y, h: rowH });
      y += rowH + bandBelow(i) + 14;
    });
    // Callouts: ring the term in the formula and write what it is in the band, joined by an arrow.
    const wr = this.world.getBoundingClientRect();
    const k = wr.width / W || 1;
    const notes = [];
    callouts.forEach((c, ci) => {
      const el = this.world.querySelector(`#sk-hl-${ci}`);
      if (!el) return;
      const r = el.getBoundingClientRect();
      const box = { x: (r.left - wr.left) / k, y: (r.top - wr.top) / k, w: r.width / k, h: r.height / k };
      if (!box.w) return;
      const color = ["yellow", "pink", "green", "orange"][ci % 4];
      const t = this.fitText(c.text, { size: 18, min: 14, maxW: 170, maxLines: 2, color });
      const line = placedLines[c.line];
      const ty = c.side === "below" ? line.y + line.h + 12 : line.y - BAND + 2;
      notes.push({ c, ci, box, color, t, ty, x: box.x + box.w / 2 - t.w / 2 });
    });
    // Notes in the same band never overlap: pushed apart left to right, then kept on the board.
    for (const band of new Set(notes.map((n) => `${n.c.line}${n.c.side}`))) {
      const row = notes.filter((n) => `${n.c.line}${n.c.side}` === band).sort((a, b) => a.box.x - b.box.x);
      let x = PAD;
      for (const n of row) {
        n.x = Math.max(n.x, x);
        x = n.x + n.t.w + 14;
      }
      let limit = W - PAD;
      for (const n of [...row].reverse()) {
        n.x = Math.min(n.x, limit - n.t.w);
        limit = n.x - 14;
      }
    }
    for (const n of notes) {
      const { box, color, t, ty, c } = n;
      this.place(t, n.x, ty);
      const cx = box.x + box.w / 2;
      const cy = box.y + box.h / 2;
      const rx = box.w / 2 + 5;
      const ry = box.h / 2 + 3;
      // A wide term (words, a long product) gets a pill; a compact one an ellipse.
      const ring = box.w > box.h * 1.7 ? this.path(roundRectPath(box.x - 5, box.y - 2, box.w + 10, box.h + 4, (box.h + 4) / 2, rng(`${n.ci}`)), { color, width: 2.2 }) : this.path(smoothPath(ellipsePoints(cx, cy, rx, ry, 0, rng(`${n.ci}${c.term}`), true), false), { color, width: 2.2 });
      const to = c.side === "below" ? [cx, cy + ry + 3] : [cx, cy - ry - 3];
      const from = edgeToward({ x: n.x, y: ty, w: t.w, h: t.h }, to, 3);
      this.add(c.s ?? lines[c.line]?.s ?? 1, ring, this.path(arrowPath(from, to, 0), { color, width: 1.8 }), t);
    }
  }

  layoutGraph(scene, area) {
    const xr = scene.x;
    const yr = scene.y;
    if (!(Array.isArray(xr) && Array.isArray(yr) && xr[0] < xr[1] && yr[0] < yr[1])) return;
    const plot = { x: area.x + 40, y: area.y + 6, w: area.w - 56, h: area.h - 34 };
    const X = (v) => plot.x + ((v - xr[0]) / (xr[1] - xr[0])) * plot.w;
    const Y = (v) => plot.y + plot.h - ((v - yr[0]) / (yr[1] - yr[0])) * plot.h;
    const ax = clamp(0, yr[0], yr[1]);
    const ay = clamp(0, xr[0], xr[1]);
    const axes = this.path(`M${P([plot.x, Y(ax)])} L${P([plot.x + plot.w + 6, Y(ax)])}${arrowHead([plot.x + plot.w + 8, Y(ax)], [plot.x, Y(ax)], 8)} M${P([X(ay), plot.y + plot.h])} L${P([X(ay), plot.y - 6])}${arrowHead([X(ay), plot.y - 8], [X(ay), plot.y + plot.h], 8)}`, { color: "grey", width: 2 });
    const ticks = [];
    const tickItems = [];
    const sx = niceStep(xr[1] - xr[0]);
    for (let v = Math.ceil(xr[0] / sx) * sx; v <= xr[1] + 1e-9; v += sx) {
      if (Math.abs(v) < 1e-9 && ay === 0) continue;
      ticks.push(`M${P([X(v), Y(ax) - 4])} L${P([X(v), Y(ax) + 4])}`);
      const t = this.text(fmtNum(v), { size: 14, color: "grey" });
      this.place(t, X(v) - t.w / 2, Y(ax) + 6);
      tickItems.push(t);
    }
    const sy = niceStep(yr[1] - yr[0]);
    for (let v = Math.ceil(yr[0] / sy) * sy; v <= yr[1] + 1e-9; v += sy) {
      if (Math.abs(v) < 1e-9 && ax === 0) continue;
      ticks.push(`M${P([X(ay) - 4, Y(v)])} L${P([X(ay) + 4, Y(v)])}`);
      const t = this.text(fmtNum(v), { size: 14, color: "grey" });
      this.place(t, X(ay) - t.w - 7, Y(v) - t.h / 2);
      tickItems.push(t);
    }
    this.add(1, axes, ticks.length ? this.path(ticks.join(" "), { color: "grey", width: 1.6 }) : null, tickItems);
    if (scene.xLabel) {
      const t = this.fitText(scene.xLabel, { size: 17, min: 13, maxW: 160, maxLines: 1, color: "grey" });
      this.place(t, plot.x + plot.w - t.w, Y(ax) + 22 > area.y + area.h - t.h ? Y(ax) - t.h - 6 : Y(ax) + 22);
      this.add(1, t);
    }
    if (scene.yLabel) {
      const t = this.fitText(scene.yLabel, { size: 17, min: 13, maxW: 160, maxLines: 1, color: "grey" });
      this.place(t, Math.min(X(ay) + 10, W - PAD - t.w), plot.y - 8);
      this.add(1, t);
    }
    const labelRects = [];
    const free = (r) => !labelRects.some((o) => overlaps(o, r, 4)) && r.x >= PAD && r.x + r.w <= W - PAD && r.y >= area.y && r.y + r.h <= area.y + area.h;
    (scene.guides ?? []).forEach((g) => {
      if (num(g?.x) && g.x >= xr[0] && g.x <= xr[1]) this.add(g.s ?? 1, this.path(`M${P([X(g.x), plot.y])} L${P([X(g.x), plot.y + plot.h])}`, { color: "grey", width: 1.5, dash: true }));
      if (num(g?.y) && g.y >= yr[0] && g.y <= yr[1]) this.add(g.s ?? 1, this.path(`M${P([plot.x, Y(g.y)])} L${P([plot.x + plot.w, Y(g.y)])}`, { color: "grey", width: 1.5, dash: true }));
    });
    const colors = ["yellow", "cyan", "pink", "green"];
    // All curves first, then their labels, so no label is placed where a later curve runs.
    const curves = [];
    (scene.curves ?? []).forEach((c, ci) => {
      let fn;
      try {
        fn = compile(String(c.expr));
      } catch {
        return;
      }
      const color = c.color && INK[c.color] ? c.color : colors[ci % colors.length];
      const segs = [];
      let cur = [];
      for (let k = 0; k <= 220; k++) {
        const x = xr[0] + ((xr[1] - xr[0]) * k) / 220;
        let y;
        try {
          y = fn({ vars: { x } });
        } catch {
          y = NaN;
        }
        const inside = Number.isFinite(y) && y >= yr[0] - (yr[1] - yr[0]) * 0.02 && y <= yr[1] + (yr[1] - yr[0]) * 0.02;
        if (inside) cur.push([X(x), Y(clamp(y, yr[0], yr[1]))]);
        else if (cur.length) {
          segs.push(cur);
          cur = [];
        }
      }
      if (cur.length) segs.push(cur);
      const drawn = segs.filter((sg) => sg.length > 1);
      if (drawn.length) curves.push({ c, color, drawn });
    });
    const allPts = curves.flatMap((cv) => cv.drawn.flat());
    const clearOfCurves = (r) => !allPts.some((q) => q[0] > r.x - 4 && q[0] < r.x + r.w + 4 && q[1] > r.y - 4 && q[1] < r.y + r.h + 4);
    const axisRects = [{ x: plot.x - 40, y: Y(ax) - 2, w: plot.w + 50, h: 22 }, { x: X(ay) - 40, y: plot.y - 10, w: 46, h: plot.h + 12 }];
    const clearOfAxes = (r) => !axisRects.some((a) => overlaps(a, r, 0));
    const spotFor = (t, anchors, offsets) => {
      for (const p of anchors)
        for (const [dx, dy] of offsets) {
          const r = { x: p[0] + dx, y: p[1] + dy, w: t.w, h: t.h };
          if (free(r) && clearOfCurves(r) && clearOfAxes(r)) return r;
        }
      for (const p of anchors)
        for (const [dx, dy] of offsets) {
          const r = { x: p[0] + dx, y: p[1] + dy, w: t.w, h: t.h };
          if (free(r) && clearOfCurves(r)) return r;
        }
      return null;
    };
    for (const { c, color, drawn } of curves) {
      const items = [this.path(drawn.map((sg) => linePath(sg, false)).join(" "), { color, width: 2.8 })];
      if (String(c.label ?? "").trim()) {
        const t = this.fitText(c.label, { size: 18, min: 13, maxW: 170, maxLines: 1, color });
        const longest = drawn.reduce((a, b) => (b.length > a.length ? b : a));
        const anchors = [0.94, 0.85, 0.72, 0.6, 0.45, 0.3, 0.15].map((f) => longest[Math.floor((longest.length - 1) * f)]);
        const offsets = [[10, -t.h - 8], [-t.w - 10, -t.h - 8], [10, 8], [-t.w - 10, 8], [14, -t.h / 2], [-t.w - 14, -t.h / 2], [10, -t.h - 22], [-t.w - 10, 22]];
        const r = spotFor(t, anchors, offsets) ?? { x: clamp(anchors[0][0] - t.w / 2, PAD, W - PAD - t.w), y: clamp(anchors[0][1] - t.h - 12, area.y, area.y + area.h - t.h), w: t.w, h: t.h };
        labelRects.push(r);
        this.place(t, r.x, r.y);
        items.push(t);
      }
      this.add(c.s ?? 1, items);
    }
    (scene.points ?? []).forEach((pnt) => {
      if (!pt(pnt?.at)) return;
      const p = [X(pnt.at[0]), Y(pnt.at[1])];
      const color = pnt.color && INK[pnt.color] ? pnt.color : "chalk";
      const items = [this.dot(p, { color, r: 4 })];
      if (String(pnt.label ?? "").trim()) {
        const t = this.fitText(pnt.label, { size: 17, min: 13, maxW: 150, maxLines: 2, color });
        const offsets = [[10, -t.h - 6], [-t.w - 10, -t.h - 6], [10, 8], [-t.w - 10, 8], [14, -t.h / 2], [-t.w - 14, -t.h / 2], [10, -t.h - 26], [-t.w - 10, 26]];
        const r = spotFor(t, [p], offsets) ?? { x: clamp(p[0] + 8, PAD, W - PAD - t.w), y: clamp(p[1] - t.h - 4, area.y, area.y + area.h - t.h), w: t.w, h: t.h };
        labelRects.push(r);
        this.place(t, r.x, r.y);
        const near = [clamp(p[0], r.x, r.x + r.w), clamp(p[1], r.y, r.y + r.h)];
        if (Math.hypot(near[0] - p[0], near[1] - p[1]) > 16) items.push(this.path(`M${P(edgeToward(r, p, 3))} L${P(p)}`, { color, width: 1.4 }));
        items.push(t);
      }
      this.add(pnt.s ?? 1, items);
    });
  }

  layoutCode(scene, area) {
    const lines = (scene.lines ?? []).map((l) => String(l ?? "").replace(/\t/g, "  ")).slice(0, 14);
    if (!lines.length) return;
    const notes = (scene.notes ?? []).filter((n) => Number.isInteger(n?.line) && n.line >= 0 && n.line < lines.length && String(n.text ?? "").trim());
    const noteW = notes.length ? 170 : 0;
    const codeMax = area.w - noteW - (notes.length ? 30 : 0);
    let size = lines.length <= 4 ? 24 : lines.length <= 8 ? 20 : 17;
    let rows;
    for (;;) {
      rows = lines.map((l) => this.text(l || " ", { size, color: "chalk", font: MONO, align: "left", maxW: 2000, pre: true }));
      const widest = Math.max(...rows.map((r) => r.w));
      const tall = rows.length * size * 1.45;
      if ((widest <= codeMax && tall <= area.h) || size <= 11) break;
      rows.forEach((r) => r.el.remove());
      size -= 1;
    }
    const lh = size * 1.45;
    const codeW = Math.min(codeMax, Math.max(...rows.map((r) => r.w)));
    const x0 = area.x + (notes.length ? 0 : (area.w - codeW) / 2);
    const y0 = area.y + Math.max(0, (area.h - rows.length * lh) / 2);
    rows.forEach((r, i) => {
      this.place(r, x0, y0 + i * lh + (lh - r.h) / 2);
      this.add(1, r);
    });
    const colX = x0 + codeW + 30;
    const placed = notes
      .map((n) => ({ n, t: this.fitText(n.text, { size: 18, min: 14, maxW: Math.max(120, W - PAD - colX), maxLines: 3, color: "cyan", align: "left" }), want: y0 + n.line * lh + lh / 2 }))
      .sort((a, b) => a.want - b.want);
    let y = area.y;
    for (const p of placed) {
      p.y = Math.max(p.want - p.t.h / 2, y);
      y = p.y + p.t.h + 8;
    }
    let limit = area.y + area.h;
    for (const p of [...placed].reverse()) {
      p.y = Math.min(p.y, limit - p.t.h);
      limit = p.y - 8;
    }
    placed.forEach((p, i) => {
      const color = ["cyan", "yellow", "pink", "green"][i % 4];
      p.t.el.style.color = ink(color);
      this.place(p.t, colX, p.y);
      const row = rows[p.n.line];
      const ly = y0 + p.n.line * lh;
      // The ring starts at the code, not at its indentation.
      const text = lines[p.n.line];
      const indent = text.length ? (row.w * (text.length - text.trimStart().length)) / text.length : 0;
      const box = this.path(roundRectPath(x0 + indent - 6, ly + 1, row.w - indent + 12, lh - 2, 7, rng(`${i}`)), { color, width: 1.8 });
      const arrow = this.path(arrowPath([colX - 4, p.y + p.t.h / 2], [x0 + row.w + 9, ly + lh / 2], 0), { color, width: 1.8 });
      this.add(p.n.s ?? i + 1, box, arrow, p.t);
    });
  }

  // ── load + play ──

  /** Writes the heading at once (before the plan arrives), so the pencil is moving within a second or two. */
  preTitle(text) {
    if (!String(text ?? "").trim() || this.items.length) return;
    this.preTitled = String(text).trim();
    const t = this.fitText(this.preTitled, { size: 30, min: 20, maxW: W - 2 * PAD, maxLines: 1, color: "yellow" });
    this.place(t, (W - t.w) / 2, 8);
    const it = { kind: "text", el: t.el, box: t, s: 1, seq: 0 };
    this.hide(it);
    this.draw(it, 1, this.gen).then(() => (this.nib.style.opacity = "0"));
    this.preItem = it;
  }

  /** Lays the scene out (nothing shows yet). `sentences` are what Aria says, in order. */
  async load(scene, sentences = []) {
    this.gen++;
    this.svg.innerHTML = "";
    this.world.querySelectorAll(".sk-text").forEach((e) => e.remove());
    this.items = [];
    // The heading already written stays: same words, same place, not drawn twice.
    if (this.preTitled) scene = { ...scene, title: this.preTitled };
    this.scene = scene;
    this.sentences = sentences;
    try {
      await document.fonts.load(`20px ${HAND}`);
      // KaTeX's fonts load only when first used, so the first formula would be measured in a
      // narrower fallback font (and its notes would sit on it). Load them before measuring.
      if (window.katex && /\\|[\^_]/.test(JSON.stringify(scene))) {
        await Promise.all(["20px KaTeX_Main", "italic 20px KaTeX_Main", "italic 20px KaTeX_Math", "20px KaTeX_Size1", "20px KaTeX_Size2", "20px KaTeX_AMS"].map((f) => document.fonts.load(f).catch(() => null)));
      }
      await document.fonts.ready;
    } catch {
      // Fonts load in the background; measuring with the fallback is still in proportion.
    }
    const last = Math.max(1, sentences.length);
    const area = this.frame(scene, last);
    const fn = {
      parts: this.layoutParts,
      compare: this.layoutCompare,
      flow: this.layoutFlow,
      cycle: this.layoutCycle,
      hub: this.layoutHub,
      equation: this.layoutEquation,
      graph: this.layoutGraph,
      code: this.layoutCode,
    }[scene.kind];
    try {
      fn?.call(this, scene, area, last);
    } catch (err) {
      console.warn(`[sketch] layout failed: ${err?.message}`, err);
    }
    // Nothing shows until its sentence (but a heading written early stays written).
    for (const it of this.items) this.hide(it);
    if (this.preTitled && this.items[0]?.kind === "text") this.show(this.items[0]);
    this.items.sort((a, b) => a.s - b.s || a.seq - b.seq);
    this.next = 0;
    this.playing = false;
    this.overlapCheck();
    return this;
  }

  /** Boxes of placed text that overlap (should be none): reported for the bench. */
  overlapCheck() {
    const boxes = this.items.filter((i) => i.kind === "text" && i.box?.x !== undefined).map((i) => ({ x: i.box.x, y: i.box.y, w: i.box.w, h: i.box.h, t: i.el.textContent.slice(0, 30) }));
    const bad = [];
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) if (overlaps(boxes[i], boxes[j], -2)) bad.push(`${boxes[i].t} ⟂ ${boxes[j].t}`);
    const outside = boxes.filter((b) => b.x < 2 || b.y < 2 || b.x + b.w > W - 2 || b.y + b.h > H - 2).map((b) => b.t);
    this.report = { overlaps: bad, outside, items: this.items.length };
    return this.report;
  }

  hide(it) {
    if (it.kind === "stroke") {
      it.el.style.strokeDasharray = it.dash ? "7 6" : `${it.len} ${it.len}`;
      if (it.dash) {
        it.maskPath.style.strokeDasharray = `${it.len} ${it.len}`;
        it.maskPath.style.strokeDashoffset = `${it.len}`;
      } else it.el.style.strokeDashoffset = `${it.len}`;
      if (it.fillEl) it.fillEl.style.opacity = "0";
    } else if (it.kind === "text") {
      it.el.style.clipPath = "inset(-4px 100% -4px -4px)";
      it.el.style.visibility = "hidden";
    } else if (it.kind === "pop") it.el.style.opacity = "0";
    it.done = false;
  }

  show(it) {
    if (it.kind === "stroke") {
      (it.dash ? it.maskPath : it.el).style.strokeDashoffset = "0";
      if (it.fillEl) it.fillEl.style.opacity = "1";
    } else if (it.kind === "text") {
      it.el.style.visibility = "visible";
      it.el.style.clipPath = "none";
    } else it.el.style.opacity = "1";
    it.done = true;
  }

  naturalMs(it) {
    if (it.kind === "stroke") return clamp(it.len / STROKE_PX_PER_MS, 140, 1300);
    if (it.kind === "text") return clamp(it.el.textContent.length * TEXT_MS_PER_CHAR, 220, 1400);
    return 90;
  }

  /** Animates one item; resolves when drawn. */
  draw(it, speed, gen) {
    const ms = this.naturalMs(it) / speed;
    return new Promise((resolve) => {
      const t0 = performance.now();
      if (it.kind === "text") it.el.style.visibility = "visible";
      const box = it.kind === "text" ? it.box : null;
      const step = (now) => {
        if (gen !== this.gen) return resolve();
        const p = clamp((now - t0) / ms, 0, 1);
        const e = p < 1 ? 1 - (1 - p) * (1 - p) * 0.15 - (1 - p) * 0.85 : 1;
        if (it.kind === "stroke") {
          const off = it.len * (1 - e);
          (it.dash ? it.maskPath : it.el).style.strokeDashoffset = `${off}`;
          try {
            const q = it.el.getPointAtLength(it.len * e);
            this.nibAt(q.x, q.y);
          } catch {
            // getPointAtLength can throw on a degenerate path.
          }
        } else if (it.kind === "text") {
          it.el.style.clipPath = `inset(-4px ${(1 - e) * 100}% -4px -4px)`;
          if (box) this.nibAt(box.x + box.w * e, box.y + box.h * 0.8);
        } else {
          it.el.style.opacity = String(p);
          if (it.at) this.nibAt(it.at[0], it.at[1]);
        }
        if (p < 1) return requestAnimationFrame(step);
        this.show(it);
        if (it.fillEl) it.fillEl.animate?.([{ opacity: 0 }, { opacity: 1 }], { duration: 260 / speed, fill: "forwards" });
        resolve();
      };
      requestAnimationFrame(step);
    });
  }

  nibAt(x, y) {
    this.nib.style.transform = `translate(${x}px, ${y}px)`;
    this.nib.style.opacity = "1";
  }

  /**
   * Aria started sentence `k` (1-based), expected to last `ms`. Draws everything up to it, faster
   * when it is behind, so the drawing keeps up with her words.
   */
  sentence(k, ms) {
    this.spoken = Math.max(this.spoken, k);
    if (ms) this.sentenceMs.set(k, ms);
    this.pump();
  }

  /** She has finished: whatever is left is drawn now. */
  finish() {
    this.spoken = 99;
    this.pump();
  }

  async pump() {
    if (this.playing) return;
    this.playing = true;
    const gen = this.gen;
    try {
      while (gen === this.gen && this.next < this.items.length && this.items[this.next].s <= this.spoken) {
        const it = this.items[this.next];
        const sameS = this.items.filter((x, i) => i >= this.next && x.s === it.s);
        const left = sameS.reduce((a, x) => a + this.naturalMs(x), 0);
        const budget = (this.sentenceMs.get(it.s) ?? 3200) * 0.85;
        const behind = it.s < this.spoken;
        const speed = behind ? 3.2 : clamp(left / budget, 1, 3.5);
        await this.draw(it, speed, gen);
        this.next++;
      }
    } finally {
      this.playing = false;
      if (gen === this.gen) this.nib.style.opacity = this.next >= this.items.length ? "0" : this.nib.style.opacity;
    }
  }

  /** Draws it all again at its natural pace (the ↻ button). */
  async replay() {
    this.gen++;
    for (const it of this.items) this.hide(it);
    this.next = 0;
    this.playing = false;
    const gen = this.gen;
    for (const it of this.items) {
      if (gen !== this.gen) return;
      await this.draw(it, 1.3, gen);
      this.next++;
    }
    this.nib.style.opacity = "0";
  }

  /** Everything at once (thumbnails, tests). */
  showAll() {
    this.gen++;
    for (const it of this.items) this.show(it);
    this.next = this.items.length;
    this.nib.style.opacity = "0";
  }
}

import type { FigureShape, Ink } from "../figures/types";
import { drawableText } from "./glyphs";

/**
 * TWO ELEMENTS OF THE DIAGRAM GRAMMAR WHOSE GEOMETRY CODE WORKS OUT (lib/diagrams/grammar.ts).
 *
 *   - "geometry": a construction — a circle, points on it or anywhere, midpoints, the foot of a
 *     perpendicular, tangent points from an outside point — joined by segments, with right-angle
 *     squares, angle arcs and equal-length ticks. The writer names the construction; code puts every
 *     point where the geometry says (the foot of OM really is the midpoint of AB; a tangent really
 *     touches). A circle-theorems board was drawn as an icon flow of circles (QA 2026-10-17).
 *   - "collision": bodies on a line before and after an impact, each a labelled block with its mass,
 *     a velocity arrow whose direction is the sign of its velocity and whose length is its speed, and
 *     the chosen positive direction. A momentum lesson had no trolley on any board (QA 2026-10-17).
 *
 * Pure. Every part a label can name gets its anchor from the drawn geometry (`mark`), never from the
 * writer's guess.
 */

type Raw = Record<string, unknown>;
type P = [number, number];

export type KindContext = {
  inside: (x: number, y: number) => boolean;
  /** {part: id} when the value names a declared part, else {}. */
  partOf: (v: unknown) => { part?: string };
  /** Records points ON a part's art, from which code places its label anchor. */
  mark: (part: unknown, ...pts: P[]) => void;
  lineColour: (v: unknown, fallback?: Ink) => Ink;
  tint: (v: unknown, fallback?: Ink | "none") => Ink | "none";
  /** Numbers the art writes (checked against the lesson). */
  written: string[];
  /** A part whose name the art itself carries: it gets no margin label. */
  selfLabel?: (part: unknown) => void;
};

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : Number.NaN);
const str = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : typeof v === "number" && Number.isFinite(v) ? String(v) : "");
const isObj = (v: unknown): v is Raw => Boolean(v) && typeof v === "object" && !Array.isArray(v);
const r1 = (n: number) => Math.round(n * 10) / 10;
const numbers = (t: string) => t.match(/\d+(?:\.\d+)?/g) ?? [];

function arrowHead(from: P, tip: P, colour: Ink, part?: string, size = 11): FigureShape {
  const a = Math.atan2(tip[1] - from[1], tip[0] - from[0]);
  const at = (k: number): P => [tip[0] - size * Math.cos(a + k), tip[1] - size * Math.sin(a + k)];
  const [l, r] = [at(0.42), at(-0.42)];
  return { t: "path", d: `M${r1(l[0])} ${r1(l[1])} L${r1(tip[0])} ${r1(tip[1])} L${r1(r[0])} ${r1(r[1])} Z`, fill: colour, stroke: "none", ...(part ? { part } : {}) };
}

/* ── geometry ─────────────────────────────────────────────────────────────────────────────── */

export function geometryElement(e: Raw, ctx: KindContext): { shapes: FigureShape[]; issues: string[] } {
  const shapes: FigureShape[] = [];
  const issues: string[] = [];
  const pts = new Map<string, P>();
  const onCircle = new Set<string>();
  const circle = isObj(e.circle) ? { cx: num(e.circle.cx), cy: num(e.circle.cy), r: num(e.circle.r), raw: e.circle } : undefined;
  if (circle) {
    if (![circle.cx, circle.cy, circle.r].every(Number.isFinite) || circle.r < 20 || !ctx.inside(circle.cx - circle.r, circle.cy - circle.r) || !ctx.inside(circle.cx + circle.r, circle.cy + circle.r)) {
      return { shapes, issues: [`a geometry "circle" needs "cx", "cy" and "r" (at least 20) with the whole circle on the canvas`] };
    }
    shapes.push({ t: "circle", cx: r1(circle.cx), cy: r1(circle.cy), r: r1(circle.r), fill: "none", stroke: "ink", width: 2.2, ...ctx.partOf(circle.raw.part) });
    // The circle's label lands on its rim, upper right — never on a chord drawn inside it.
    const a = (60 * Math.PI) / 180;
    ctx.mark(circle.raw.part, [circle.cx + circle.r * Math.cos(a), circle.cy - circle.r * Math.sin(a)]);
  }
  const id = (v: unknown) => str(v, 4);
  const partOfPoint = new Map<string, unknown>();
  const get = (v: unknown): P | undefined => pts.get(id(v));
  for (const p of (Array.isArray(e.points) ? e.points : []).filter(isObj).slice(0, 16)) {
    const name = id(p.id);
    if (!name) { issues.push(`every geometry point needs an "id" (a letter such as "A")`); continue; }
    let at: P | undefined;
    if (p.centre === true || p.center === true) {
      if (circle) at = [circle.cx, circle.cy];
    } else if (Number.isFinite(num(p.deg))) {
      if (circle) { const a = (num(p.deg) * Math.PI) / 180; at = [circle.cx + circle.r * Math.cos(a), circle.cy - circle.r * Math.sin(a)]; onCircle.add(name); }
    } else if (Array.isArray(p.mid)) {
      const [a, b] = [get(p.mid[0]), get(p.mid[1])];
      if (a && b) at = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    } else if (Array.isArray(p.foot)) {
      // The foot of the perpendicular from the first point to the line through the other two.
      const [q, a, b] = [get(p.foot[0]), get(p.foot[1]), get(p.foot[2])];
      if (q && a && b) {
        const vx = b[0] - a[0], vy = b[1] - a[1], len = vx * vx + vy * vy;
        if (len > 0) { const t = ((q[0] - a[0]) * vx + (q[1] - a[1]) * vy) / len; at = [a[0] + vx * t, a[1] + vy * t]; }
      }
    } else if (p.tangentFrom !== undefined) {
      const q = get(p.tangentFrom);
      if (q && circle) {
        const dx = q[0] - circle.cx, dy = q[1] - circle.cy, d = Math.hypot(dx, dy);
        if (d <= circle.r + 1) { issues.push(`point "${name}": a tangent needs a point outside the circle`); continue; }
        const base = Math.atan2(dy, dx), alpha = Math.acos(circle.r / d);
        const a = base + (num(p.which) === 2 ? -alpha : alpha);
        at = [circle.cx + circle.r * Math.cos(a), circle.cy + circle.r * Math.sin(a)];
        onCircle.add(name);
      }
    } else if (Array.isArray(p.along) && Number.isFinite(num(p.t))) {
      const [a, b] = [get(p.along[0]), get(p.along[1])];
      if (a && b) at = [a[0] + (b[0] - a[0]) * num(p.t), a[1] + (b[1] - a[1]) * num(p.t)];
    } else if (Number.isFinite(num(p.x)) && Number.isFinite(num(p.y))) at = [num(p.x), num(p.y)];
    if (!at) { issues.push(`point "${name}" cannot be placed — give "deg" (on the circle), "centre": true, "x"/"y", "mid": [A, B], "foot": [P, A, B], "tangentFrom": P or "along": [A, B] with "t", naming only points listed before it`); continue; }
    if (!ctx.inside(at[0], at[1])) { issues.push(`point "${name}" lies off the canvas`); continue; }
    pts.set(name, at);
    if (p.part !== undefined) { ctx.mark(p.part, at); partOfPoint.set(name, p.part); }
  }
  if (pts.size < 2 && !circle) issues.push(`a geometry element needs a "circle" or at least 2 "points"`);
  const all = [...pts.values()];
  const centroid: P = circle ? [circle.cx, circle.cy] : all.length ? [all.reduce((s, q) => s + q[0], 0) / all.length, all.reduce((s, q) => s + q[1], 0) / all.length] : [0, 0];
  const away = (q: P, k: number): P => {
    const dx = q[0] - centroid[0], dy = q[1] - centroid[1], d = Math.hypot(dx, dy);
    return d < 1 ? [q[0] - k * 0.7, q[1] + k * 0.7] : [q[0] + (dx / d) * k, q[1] + (dy / d) * k];
  };

  for (const poly of (Array.isArray(e.polygons) ? e.polygons : []).filter(isObj).slice(0, 4)) {
    const ring = (Array.isArray(poly.points) ? poly.points : []).map(get).filter((q): q is P => Boolean(q));
    if (ring.length < 3) { issues.push(`a geometry polygon needs at least 3 named points`); continue; }
    shapes.push({ t: "path", d: `M${ring.map(([x, y]) => `${r1(x)} ${r1(y)}`).join(" L")} Z`, fill: ctx.tint(poly.fill, "none"), stroke: "none", opacity: 0.6, ...ctx.partOf(poly.part) });
    ctx.mark(poly.part, [ring.reduce((s, q) => s + q[0], 0) / ring.length, ring.reduce((s, q) => s + q[1], 0) / ring.length]);
  }

  // Directions of the lines leaving each point, so its letter is set in the widest gap between them.
  const spokes = new Map<string, number[]>();
  const spoke = (from: string, q: P | undefined) => { const p0 = pts.get(from); if (p0 && q) spokes.set(from, [...(spokes.get(from) ?? []), Math.atan2(q[1] - p0[1], q[0] - p0[0])]); };
  for (const s of (Array.isArray(e.segments) ? e.segments : []).filter(isObj).slice(0, 16)) {
    let [a, b] = [get(s.from), get(s.to)];
    spoke(id(s.from), b); spoke(id(s.to), a);
    if (!a || !b) { issues.push(`a geometry segment's "from" and "to" must name listed points`); continue; }
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len < 2) continue;
    const ext = Math.max(0, Math.min(200, num(s.extend) || 0));
    if (ext) { const ux = (b[0] - a[0]) / len, uy = (b[1] - a[1]) / len; a = [a[0] - ux * ext, a[1] - uy * ext]; b = [b[0] + ux * ext, b[1] + uy * ext]; }
    const colour = ctx.lineColour(s.color, "ink");
    const part = ctx.partOf(s.part);
    shapes.push({ t: "path", d: `M${r1(a[0])} ${r1(a[1])} L${r1(b[0])} ${r1(b[1])}`, stroke: colour, width: 2.2, fill: "none", ...(s.dash === true ? { dash: "6 5" } : {}), ...part });
    if (s.arrow === true) shapes.push(arrowHead(a, b, colour, part.part, 12));
    const mid: P = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    // A third of the way along, not the middle: a chord's midpoint is often a named point (M) of its own.
    ctx.mark(s.part, [a[0] + (b[0] - a[0]) * 0.32, a[1] + (b[1] - a[1]) * 0.32]);
    const text = drawableText(str(s.text, 14));
    if (text) {
      // Written beside the segment, on the side away from the figure's middle.
      const nx = -(b[1] - a[1]) / Math.hypot(b[0] - a[0], b[1] - a[1]), ny = (b[0] - a[0]) / Math.hypot(b[0] - a[0], b[1] - a[1]);
      const side = (mid[0] + nx - centroid[0]) * nx + (mid[1] + ny - centroid[1]) * ny >= 0 ? 1 : -1;
      shapes.push({ t: "text", x: r1(mid[0] + nx * 16 * side), y: r1(mid[1] + ny * 16 * side + 5), text, size: 14, anchor: "middle", fill: "ink" });
      ctx.written.push(...numbers(text));
    }
  }

  for (const ra of (Array.isArray(e.rightAngles) ? e.rightAngles : []).slice(0, 6)) {
    const [a, v, b] = Array.isArray(ra) ? [get(ra[0]), get(ra[1]), get(ra[2])] : [];
    if (!a || !v || !b) { issues.push(`a right angle is [A, vertex, B] — three listed points`); continue; }
    const u = (q: P): P => { const d = Math.hypot(q[0] - v[0], q[1] - v[1]) || 1; return [(q[0] - v[0]) / d, (q[1] - v[1]) / d]; };
    const [ua, ub] = [u(a), u(b)];
    const k = 12;
    shapes.push({ t: "path", d: `M${r1(v[0] + ua[0] * k)} ${r1(v[1] + ua[1] * k)} L${r1(v[0] + (ua[0] + ub[0]) * k)} ${r1(v[1] + (ua[1] + ub[1]) * k)} L${r1(v[0] + ub[0] * k)} ${r1(v[1] + ub[1] * k)}`, stroke: "ink", width: 1.5, fill: "none" });
  }

  for (const an of (Array.isArray(e.angles) ? e.angles : []).filter(isObj).slice(0, 6)) {
    const [v, a, b] = [get(an.at), get(an.from), get(an.to)];
    if (!v || !a || !b) { issues.push(`an angle needs "at" (the vertex), "from" and "to" — listed points`); continue; }
    const t1 = Math.atan2(a[1] - v[1], a[0] - v[0]);
    let dt = Math.atan2(b[1] - v[1], b[0] - v[0]) - t1;
    while (dt > Math.PI) dt -= 2 * Math.PI;
    while (dt < -Math.PI) dt += 2 * Math.PI;
    const rad = 24;
    const arcPts: P[] = Array.from({ length: 13 }, (_, i) => [v[0] + rad * Math.cos(t1 + (dt * i) / 12), v[1] + rad * Math.sin(t1 + (dt * i) / 12)]);
    const colour = ctx.lineColour(an.color, "#ea580c");
    shapes.push({ t: "path", d: `M${arcPts.map(([x, y]) => `${r1(x)} ${r1(y)}`).join(" L")}`, stroke: colour, width: 1.8, fill: "none", ...ctx.partOf(an.part) });
    ctx.mark(an.part, arcPts[6]);
    const text = drawableText(str(an.text, 10));
    if (text) {
      const mid = t1 + dt / 2;
      shapes.push({ t: "text", x: r1(v[0] + (rad + 16) * Math.cos(mid)), y: r1(v[1] + (rad + 16) * Math.sin(mid) + 5), text, size: 14, anchor: "middle", fill: "ink" });
      ctx.written.push(...numbers(text));
    }
  }

  for (const tk of (Array.isArray(e.ticks) ? e.ticks : []).filter(isObj).slice(0, 4)) {
    const count = Math.max(1, Math.min(3, Math.round(num(tk.count)) || 1));
    for (const seg of (Array.isArray(tk.segments) ? tk.segments : []).slice(0, 6)) {
      const [a, b] = Array.isArray(seg) ? [get(seg[0]), get(seg[1])] : [];
      if (!a || !b) { issues.push(`equal-length ticks name segments as [A, B] of listed points`); continue; }
      const d = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, ux = (b[0] - a[0]) / d, uy = (b[1] - a[1]) / d;
      for (let i = 0; i < count; i++) {
        const off = (i - (count - 1) / 2) * 5;
        const c: P = [(a[0] + b[0]) / 2 + ux * off, (a[1] + b[1]) / 2 + uy * off];
        shapes.push({ t: "path", d: `M${r1(c[0] - uy * 7)} ${r1(c[1] + ux * 7)} L${r1(c[0] + uy * 7)} ${r1(c[1] - ux * 7)}`, stroke: "ink", width: 1.6, fill: "none" });
      }
    }
  }

  // Every point: a dot and its letter, outside the figure (away from the centre).
  if (e.labelPoints !== false) {
    for (const [name, q] of pts) {
      shapes.push({ t: "circle", cx: r1(q[0]), cy: r1(q[1]), r: 3, fill: "ink", stroke: "none", ...ctx.partOf(partOfPoint.get(name)) });
      // Away from the figure's middle, unless lines leave the point that way: then in the widest gap
      // between its lines (the centre's "O" sat on a dashed radius).
      const k = onCircle.has(name) ? 15 : 14;
      let [lx, ly] = away(q, k);
      const lines = [...(spokes.get(name) ?? []), ...(circle && onCircle.has(name) ? [Math.atan2(circle.cy - q[1], circle.cx - q[0])] : [])];
      const diff = (a: number, b: number) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
      const pref = Math.atan2(ly - q[1], lx - q[0]);
      if (lines.some((l) => diff(l, pref) < 0.6)) {
        const best = Array.from({ length: 16 }, (_, i) => (i * Math.PI) / 8).map((t) => ({ t, gap: Math.min(...lines.map((l) => diff(l, t))) - diff(t, pref) * 0.15 })).sort((u, v) => v.gap - u.gap)[0].t;
        [lx, ly] = [q[0] + Math.cos(best) * k, q[1] + Math.sin(best) * k];
      }
      shapes.push({ t: "text", x: r1(lx), y: r1(ly + 5), text: name, size: 15, anchor: "middle", fill: "ink" });
    }
  }
  return { shapes, issues };
}

/* ── collision ────────────────────────────────────────────────────────────────────────────── */

type Body = { name: string; mass: string; v: number; vText: string; unknown: boolean; part: unknown; vPart: unknown };

function body(raw: Raw, unit: string): Body | string {
  const name = drawableText(str(raw.name ?? raw.label, 8));
  const massRaw = raw.mass;
  const mass = drawableText(typeof massRaw === "number" ? `${massRaw} kg` : str(massRaw, 12));
  const vRaw = raw.v ?? raw.velocity;
  const v = num(vRaw);
  const unknown = !Number.isFinite(v);
  const symbol = unknown ? drawableText(str(vRaw, 8)) : "";
  if (unknown && !symbol) return `every body needs "v": its signed velocity (a number) or the unknown's symbol ("v")`;
  // The writer's own digits ("3.0", not 3), without the sign: the arrow carries the direction.
  const digits = typeof vRaw === "string" && !unknown ? vRaw.trim().replace(/^[+−-]/, "") : String(Math.abs(v));
  const vText = unknown ? symbol : v === 0 ? "at rest" : `${digits} ${unit}`;
  return { name, mass, v: unknown ? 0 : v, vText, unknown, part: raw.part, vPart: raw.vPart ?? raw.velocityPart };
}

export function collisionElement(e: Raw, ctx: KindContext): { shapes: FigureShape[]; issues: string[] } {
  const shapes: FigureShape[] = [];
  const issues: string[] = [];
  const [x, y, w, h] = [num(e.x), num(e.y), num(e.w), num(e.h)];
  if (![x, y, w, h].every(Number.isFinite) || w < 300 || h < 230 || !ctx.inside(x, y) || !ctx.inside(x + w, y + h)) {
    return { shapes, issues: [`"collision" needs x, y, w (at least 300) and h (at least 230) on the canvas`] };
  }
  const unit = drawableText(str(e.unit, 8) || "m/s");
  const dir = /^l/i.test(str(e.positive, 8)) ? -1 : 1;
  const rows: Array<{ title: string; bodies: Body[] }> = [];
  for (const [key, title] of [["before", "Before impact"], ["after", "After impact"]] as const) {
    const list = (Array.isArray(e[key]) ? e[key] as unknown[] : []).filter(isObj).slice(0, 3).map((b) => body(b, unit));
    const bad = list.find((b): b is string => typeof b === "string");
    if (bad) { issues.push(bad); continue; }
    if (!list.length) { issues.push(`"collision" needs "${key}": 1-3 bodies [{"name", "mass", "v", "part"}]`); continue; }
    rows.push({ title: drawableText(str(e[`${key}Title`], 24)) || title, bodies: list as Body[] });
  }
  if (issues.length) return { shapes, issues };
  const masses = rows.flatMap((r) => r.bodies.map((b) => num((b.mass.match(/\d+(?:\.\d+)?/) ?? [])[0])));
  const maxMass = Math.max(...masses.filter(Number.isFinite), 0);
  const speeds = rows.flatMap((r) => r.bodies.filter((b) => !b.unknown).map((b) => Math.abs(b.v)));
  const maxSpeed = Math.max(...speeds, 0);
  const rowH = h / 2;
  const tints = ["blue", "orange", "green"];

  // The bodies keep a textbook spacing and the track runs just past them: spread over the whole width,
  // a two-trolley diagram was a wide strip that filled a third of the frame's height (QA 2026-10-17).
  const nMax = Math.max(...rows.map((r) => r.bodies.length));
  const spacingOf = (n: number) => Math.min(w / (n + 1), 200);
  const span = Math.min(w, Math.max(320, (nMax - 1) * spacingOf(nMax) + 120 + 140));
  const left = x + (w - span) / 2, right = left + span;
  // The positive direction, once, top right, level with the first caption.
  const firstBlockTop = y + rowH - 10 - Math.max(44, Math.min(60, rowH - 74));
  const px = right - 4, py = Math.max(y + 8, firstBlockTop - 56);
  const [from, to]: [P, P] = dir > 0 ? [[px - 54, py], [px, py]] : [[px, py], [px - 54, py]];
  shapes.push({ t: "path", d: `M${r1(from[0])} ${r1(from[1])} L${r1(to[0])} ${r1(to[1])}`, stroke: "ink", width: 1.6, fill: "none" });
  shapes.push(arrowHead(from, to, "ink", undefined, 9));
  shapes.push({ t: "text", x: r1(px - 62), y: r1(py + 5), text: "positive", size: 13, anchor: "end", fill: "muted" });

  rows.forEach((row, ri) => {
    const top = y + ri * rowH;
    const trackY = top + rowH - 10;
    const bh = Math.max(44, Math.min(60, rowH - 74));
    const blockTop = trackY - bh;
    // The caption sits just above its row's arrows, so a tall canvas leaves its slack at the top
    // (cropped away) rather than between the words and the bodies.
    shapes.push({ t: "text", x: r1(left), y: r1(Math.max(top + 16, blockTop - 52)), text: row.title, size: 14, anchor: "start", fill: "ink" });
    shapes.push({ t: "path", d: `M${r1(left)} ${r1(trackY)} H${r1(right)}`, stroke: "muted", width: 2, fill: "none" });
    const n = row.bodies.length;
    const spacing = spacingOf(n);
    row.bodies.forEach((b, i) => {
      const cx = x + w / 2 + (i - (n - 1) / 2) * spacing;
      const m = num((b.mass.match(/\d+(?:\.\d+)?/) ?? [])[0]);
      const bw = Math.max(64, Math.min(spacing * 0.6, 64 + (Number.isFinite(m) && maxMass > 0 ? 50 * Math.sqrt(m / maxMass) : 30)));
      // One body after a collision of two is the combined body (they coalesced).
      const combined = ri === 1 && n === 1 && rows[0].bodies.length > 1;
      const fill = ctx.tint(combined ? "purple" : tints[i % tints.length], "none");
      const part = ctx.partOf(b.part);
      shapes.push({ t: "path", d: `M${r1(cx - bw / 2)} ${r1(blockTop)} h${r1(bw)} v${r1(bh)} h${r1(-bw)} Z`, fill, stroke: "ink", width: 2, ...part });
      // Label points on the block's outline away from its words: the side edges at mid-height and the
      // top corners (a dot on the "A" inside the block hid it — QA 2026-10-17). The policy picks the
      // one a margin leader reaches cleanly.
      ctx.mark(b.part, [cx - bw / 2, blockTop + bh / 2], [cx + bw / 2, blockTop + bh / 2], [cx - bw / 2 + 5, blockTop + 2], [cx + bw / 2 - 5, blockTop + 2]);
      if (b.name) shapes.push({ t: "text", x: r1(cx), y: r1(blockTop + (b.mass ? bh * 0.42 : bh * 0.62)), text: b.name, size: 15, anchor: "middle", fill: "ink" });
      if (b.mass) { shapes.push({ t: "text", x: r1(cx), y: r1(blockTop + bh * (b.name ? 0.82 : 0.62)), text: b.mass, size: 13, anchor: "middle", fill: "ink" }); ctx.written.push(...numbers(b.mass)); }
      // The velocity: an arrow over the body, the way it moves, as long as its speed; at rest, words.
      const arrowY = blockTop - 16;
      if (!b.unknown && b.v === 0) {
        shapes.push({ t: "text", x: r1(cx), y: r1(arrowY + 4), text: "at rest", size: 13, anchor: "middle", fill: "muted" });
        return;
      }
      const sign = b.unknown ? dir : dir * Math.sign(b.v);
      const len = b.unknown ? Math.min(spacing * 0.7, 70) : Math.min(spacing * 0.8, 34 + 66 * (maxSpeed > 0 ? Math.abs(b.v) / maxSpeed : 1));
      const a: P = [cx - (sign * len) / 2, arrowY], z: P = [cx + (sign * len) / 2, arrowY];
      const colour = ctx.lineColour(b.unknown ? "purple" : "red", "ink");
      const vPart = ctx.partOf(b.vPart);
      shapes.push({ t: "path", d: `M${r1(a[0])} ${r1(a[1])} L${r1(z[0])} ${r1(z[1])}`, stroke: colour, width: 2.6, fill: "none", ...(b.unknown ? { dash: "6 4" } : {}), ...vPart });
      shapes.push(arrowHead(a, z, colour, vPart.part, 12));
      // The arrow carries its own value ("1.25 m/s"); a margin label on it lay along the arrow.
      ctx.mark(b.vPart, [cx, arrowY]);
      ctx.selfLabel?.(b.vPart);
      shapes.push({ t: "text", x: r1(cx), y: r1(arrowY - 9), text: b.vText, size: 14, anchor: "middle", fill: "ink" });
      if (!b.unknown) ctx.written.push(...numbers(b.vText));
    });
  });
  return { shapes, issues };
}

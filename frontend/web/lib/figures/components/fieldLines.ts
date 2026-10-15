import type { FigureComponent, FigureParams, FigurePart, FigureShape, Ink, Pt } from "../types";

const fmt = (n: number) => Number(n.toFixed(2));
type Setup = "point-charge" | "two-charges" | "parallel-plates" | "bar-magnet" | "earth-gravity";
const POS: Ink = "#dc2626", NEG: Ink = "#2563eb", LINE: Ink = "ink";

/** A field from point sources, q·r̂/r² summed (charges, or a magnet's two poles). */
type Source = { p: Pt; q: number };
export function fieldAt(sources: Source[], at: Pt): Pt {
  let x = 0, y = 0;
  for (const s of sources) {
    const dx = at.x - s.p.x, dy = at.y - s.p.y;
    const r2 = dx * dx + dy * dy + 1e-6, r3 = r2 * Math.sqrt(r2);
    x += (s.q * dx) / r3;
    y += (s.q * dy) / r3;
  }
  return { x, y };
}

/**
 * Follow a field line from `start` (along the field when dir = 1, against it when −1) with midpoint
 * (RK2) steps until it leaves the box, reaches `stop`, or the field vanishes (a neutral point).
 */
function trace(sources: Source[], start: Pt, dir: 1 | -1, box: { w: number; h: number }, stop: (p: Pt) => boolean, step = 2.5, max = 900): Pt[] {
  const pts: Pt[] = [start];
  let p = start;
  const unit = (v: Pt) => { const m = Math.hypot(v.x, v.y); return m < 1e-12 ? null : { x: v.x / m, y: v.y / m }; };
  for (let i = 0; i < max; i++) {
    const a = unit(fieldAt(sources, p));
    if (!a) break;
    const mid = { x: p.x + (dir * a.x * step) / 2, y: p.y + (dir * a.y * step) / 2 };
    const b = unit(fieldAt(sources, mid));
    if (!b || a.x * b.x + a.y * b.y < 0) break; // the field reverses: a neutral point
    p = { x: p.x + dir * b.x * step, y: p.y + dir * b.y * step };
    if (p.x < 4 || p.y < 4 || p.x > box.w - 4 || p.y > box.h - 4) break;
    pts.push(p);
    if (stop(p)) break;
  }
  return pts;
}

const polyline = (pts: Pt[], every = 3) => pts.filter((_, i) => i % every === 0 || i === pts.length - 1).map((p, i) => `${i ? "L" : "M"}${fmt(p.x)} ${fmt(p.y)}`).join(" ");

/** An arrowhead at `at`, pointing along `dir`. */
function head(at: Pt, dir: Pt, ink: Ink, size = 10): FigureShape {
  const m = Math.hypot(dir.x, dir.y) || 1;
  const ux = dir.x / m, uy = dir.y / m;
  const tip = { x: at.x + ux * size * 0.5, y: at.y + uy * size * 0.5 };
  return { t: "path", part: "direction-arrow", fill: ink, stroke: ink, width: 1, d: `M${fmt(tip.x)} ${fmt(tip.y)} L${fmt(tip.x - ux * size - uy * size * 0.5)} ${fmt(tip.y - uy * size + ux * size * 0.5)} L${fmt(tip.x - ux * size + uy * size * 0.5)} ${fmt(tip.y - uy * size - ux * size * 0.5)} Z` };
}

/** The point a fraction t of the way along a polyline, and the direction there. */
function along(pts: Pt[], t: number): { p: Pt; d: Pt } {
  const lens: number[] = [0];
  for (let i = 1; i < pts.length; i++) lens.push(lens[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
  const target = lens[lens.length - 1] * t;
  let i = 1;
  while (i < pts.length - 1 && lens[i] < target) i++;
  const a = pts[i - 1], b = pts[i];
  return { p: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, d: { x: b.x - a.x, y: b.y - a.y } };
}
const lineLength = (pts: Pt[]) => pts.reduce((s, p, i) => (i ? s + Math.hypot(p.x - pts[i - 1].x, p.y - pts[i - 1].y) : 0), 0);

function setupOf(v: unknown): Setup {
  const s = String(v ?? "").toLowerCase();
  if (/plate|capacitor|uniform/.test(s)) return "parallel-plates";
  if (/magnet/.test(s)) return "bar-magnet";
  if (/earth|grav|planet|mass/.test(s)) return "earth-gravity";
  if (/two|pair|dipole|charges/.test(s)) return "two-charges";
  return "point-charge";
}
const signOf = (c: string | undefined, fallback: 1 | -1): 1 | -1 => (c === "-" || c === "−" || c === "n" ? -1 : c === "+" || c === "p" ? 1 : fallback);
const signs = (v: unknown): string[] => String(v ?? "").toLowerCase().replace(/positive/g, "+").replace(/negative/g, "-").replace(/[^+\-−]/g, "").split("");

/**
 * FIELD-LINE PATTERNS, traced from the field itself (lines are integrated through the summed
 * inverse-square field of the sources), so every arrow points the right way by construction: away
 * from +, towards −; N to S outside a magnet; + plate to − plate (uniform, equally spaced, bowing at
 * the edges); radially inwards for gravity.
 */
export const fieldLines: FigureComponent = {
  name: "fieldLines",
  title: "Field-line pattern: a point charge, two charges, parallel plates, a bar magnet or the Earth's gravity, with arrows showing the field's direction",
  params: `setup ("point-charge" default, "two-charges", "parallel-plates", "bar-magnet", "earth-gravity"); sign for a point charge ("+" default or "-"); signs for two charges ("+-" default: opposite charges, "++" or "--": like charges, with a neutral point between); top for parallel plates (the top plate's sign, "+" default).`,
  match: /\bfield lines?\b|\b(electric|magnetic|gravitational) field\b|\bfield pattern\b|\bbar magnet\b|\bparallel plates\b|\bneutral point\b|\buniform field\b/i,
  parts: [
    { id: "source", name: "Source" },
    { id: "second-source", name: "Second source" },
    { id: "field-line", name: "Field line" },
    { id: "direction-arrow", name: "Direction of the field" },
    { id: "uniform-region", name: "Uniform field" },
    { id: "neutral-point", name: "Neutral point" },
  ],
  build(params: FigureParams) {
    const setup = setupOf(params.setup);
    const shapes: FigureShape[] = [];
    const W = 600, H = 440, cx = W / 2, cy = H / 2;
    const box = { w: W, h: H };
    const line = (pts: Pt[], ink: Ink = LINE) => shapes.push({ t: "path", part: "field-line", d: polyline(pts), stroke: ink, width: 2, fill: "none" });
    const charge = (part: string, p: Pt, q: 1 | -1, r = 22) => {
      shapes.push({ t: "circle", part, cx: fmt(p.x), cy: fmt(p.y), r, fill: q > 0 ? POS : NEG, stroke: "ink", width: 2 });
      // A plus or minus drawn as strokes, so it is centred exactly.
      shapes.push({ t: "path", part, d: `M${fmt(p.x - 9)} ${fmt(p.y)} H${fmt(p.x + 9)}${q > 0 ? ` M${fmt(p.x)} ${fmt(p.y - 9)} V${fmt(p.y + 9)}` : ""}`, stroke: "#ffffff", width: 3.4, fill: "none" });
    };
    let parts: FigurePart[] = [];
    let arrowAnchor: Pt = { x: cx, y: cy };
    let lineAnchor: Pt = { x: cx, y: cy };

    if (setup === "point-charge") {
      const q = signOf(signs(params.sign ?? params.signs)[0], 1);
      const n = 12;
      for (let i = 0; i < n; i++) {
        const a = (2 * Math.PI * (i + 0.5)) / n;
        const u = { x: Math.cos(a), y: Math.sin(a) };
        const r1 = 30, r2 = 196;
        line([{ x: cx + u.x * r1, y: cy + u.y * r1 }, { x: cx + u.x * r2, y: cy + u.y * r2 }]);
        const at = { x: cx + u.x * 128, y: cy + u.y * 128 };
        shapes.push(head(at, { x: u.x * q, y: u.y * q }, LINE, 12));
        if (i === 0) { arrowAnchor = at; lineAnchor = { x: cx + u.x * 170, y: cy + u.y * 170 }; }
      }
      charge("source", { x: cx, y: cy }, q, 24);
      const name = q > 0 ? "Positive charge" : "Negative charge";
      parts = [
        { id: "source", name, anchor: { x: cx, y: cy - 14 } },
        { id: "field-line", name: "Field line", anchor: lineAnchor },
        { id: "direction-arrow", name: q > 0 ? "Field points away from +" : "Field points towards −", anchor: arrowAnchor },
        { id: "second-source", name, anchor: { x: cx, y: cy + 14 } },
        { id: "uniform-region", name: "Field (radial)", anchor: lineAnchor },
        { id: "neutral-point", name: "Neutral point", anchor: { x: cx, y: cy } },
      ];
    } else if (setup === "two-charges") {
      const sg = signs(params.signs ?? params.sign);
      const q1 = signOf(sg[0], 1), q2 = signOf(sg[1], sg.length === 1 ? q1 : (-q1 as 1 | -1));
      const d = 125, R = 22;
      const s1: Source = { p: { x: cx - d, y: cy }, q: q1 }, s2: Source = { p: { x: cx + d, y: cy }, q: q2 };
      const sources = [s1, s2];
      const near = (p: Pt, s: Source) => Math.hypot(p.x - s.p.x, p.y - s.p.y) < R + 3;
      const lines: Pt[][] = [];
      const n = 16;
      // Seed lines on the charges they leave (+) or enter (−); with opposite charges, every line leaves + and ends on −.
      const seeds = q1 !== q2 ? [q1 > 0 ? s1 : s2] : [s1, s2];
      for (const s of seeds) {
        for (let i = 0; i < n; i++) {
          const a = (2 * Math.PI * (i + 0.5)) / n;
          const start = { x: s.p.x + Math.cos(a) * (R + 4), y: s.p.y + Math.sin(a) * (R + 4) };
          const dir = (s.q > 0 ? 1 : -1) as 1 | -1;
          const pts = trace(sources, start, dir, box, (p) => sources.some((o) => o !== s && near(p, o)));
          if (pts.length > 4) lines.push(dir > 0 ? pts : pts.slice().reverse());
        }
      }
      // Opposite charges: the lines that leave + outwards return to − from far away; draw those arriving on −'s far side too.
      if (q1 !== q2) {
        const sink = q1 < 0 ? s1 : s2, src = q1 < 0 ? s2 : s1;
        for (let i = 0; i < n; i++) {
          const a = (2 * Math.PI * (i + 0.5)) / n;
          const start = { x: sink.p.x + Math.cos(a) * (R + 4), y: sink.p.y + Math.sin(a) * (R + 4) };
          const pts = trace(sources, start, -1, box, (p) => near(p, src));
          if (pts.length > 4 && !near(pts[pts.length - 1], src)) lines.push(pts.slice().reverse());
        }
      }
      // Draw each line, an arrow halfway along it (lines are stored in the field's direction).
      let best = -1;
      lines.forEach((pts, i) => {
        line(pts);
        if (lineLength(pts) < 60) return;
        const { p, d: dirv } = along(pts, 0.5);
        shapes.push(head(p, dirv, LINE, 11));
        // Name an arrow on a line between the charges, above the axis.
        if (best < 0 && p.y < cy - 50 && p.y > cy - 150 && Math.abs(p.x - cx) < 40) { best = i; arrowAnchor = p; lineAnchor = along(pts, 0.3).p; }
      });
      charge("source", s1.p, q1, R);
      charge("second-source", s2.p, q2, R);
      const like = q1 === q2;
      const neutral = { x: cx, y: cy };
      if (like) shapes.push({ t: "path", part: "neutral-point", d: `M${cx - 7} ${cy - 7} L${cx + 7} ${cy + 7} M${cx - 7} ${cy + 7} L${cx + 7} ${cy - 7}`, stroke: "#d97706", width: 3, fill: "none" });
      const nm = (q: number) => (q > 0 ? "Positive charge" : "Negative charge");
      parts = [
        { id: "source", name: nm(q1), anchor: { x: s1.p.x, y: s1.p.y - 12 } },
        { id: "second-source", name: nm(q2), anchor: { x: s2.p.x, y: s2.p.y - 12 } },
        { id: "field-line", name: "Field line", anchor: lineAnchor },
        { id: "direction-arrow", name: like ? (q1 > 0 ? "Field points away from +" : "Field points towards −") : "Field direction (+ to −)", anchor: arrowAnchor },
        ...(like ? [{ id: "neutral-point", name: "Neutral point (no field)", anchor: neutral }] : []),
        { id: "uniform-region", name: like ? "Weak field between the charges" : "Strong field between the charges", anchor: like ? { x: cx, y: cy - 60 } : { x: cx, y: cy } },
        ...(like ? [] : [{ id: "neutral-point", name: "Neutral point", anchor: { x: cx, y: cy } }]),
      ];
    } else if (setup === "parallel-plates") {
      const top = signOf(signs(params.top ?? params.sign)[0], 1);
      const x0 = 130, x1 = 470, yT = 120, yB = 320, th = 12;
      const down = top > 0; // the field runs from the + plate to the − plate
      const n = 8;
      for (let i = 0; i < n; i++) {
        const x = x0 + 22 + (i * (x1 - x0 - 44)) / (n - 1);
        line([{ x, y: yT + th / 2 }, { x, y: yB - th / 2 }]);
        shapes.push(head({ x, y: (yT + yB) / 2 }, { x: 0, y: down ? 1 : -1 }, LINE, 12));
        if (i === 1) lineAnchor = { x, y: yT + 45 };
      }
      // The edge field bows outwards, beyond the ends of the plates.
      for (const [side, x] of [[-1, x0], [1, x1]] as const) {
        for (const bow of [34, 70]) {
          const startX = x - side * (bow > 50 ? 4 : 12);
          const d = `M${startX} ${yT + th / 2} Q${x + side * bow} ${(yT + yB) / 2} ${startX} ${yB - th / 2}`;
          shapes.push({ t: "path", part: "field-line", d, stroke: LINE, width: 2, fill: "none" });
          // A quadratic's midpoint: ¼·start + ½·control + ¼·end, where the curve runs straight up or down.
          const mx = 0.5 * startX + 0.5 * (x + side * bow);
          shapes.push(head({ x: mx, y: (yT + yB) / 2 }, { x: 0, y: down ? 1 : -1 }, LINE, 11));
          // The named arrow is the outermost on the left, so its leader crosses no other arrow (they share a height).
          if (side === -1 && bow > 50) arrowAnchor = { x: mx, y: (yT + yB) / 2 };
        }
      }
      const plate = (part: string, y: number, q: 1 | -1) => {
        shapes.push({ t: "path", part, d: `M${x0} ${y - th / 2} H${x1} V${y + th / 2} H${x0} Z`, fill: q > 0 ? POS : NEG, stroke: "ink", width: 2 });
        const sy = y + (y < cy ? -26 : 26);
        for (let i = 0; i < 7; i++) {
          const x = x0 + 25 + (i * (x1 - x0 - 50)) / 6;
          shapes.push({ t: "path", part, d: `M${x - 7} ${sy} H${x + 7}${q > 0 ? ` M${x} ${sy - 7} V${sy + 7}` : ""}`, stroke: q > 0 ? POS : NEG, width: 3, fill: "none" });
        }
      };
      plate("source", yT, top);
      plate("second-source", yB, (-top) as 1 | -1);
      const nm = (q: number) => (q > 0 ? "Positive plate" : "Negative plate");
      const gapX = x0 + 22 + (3.5 * (x1 - x0 - 44)) / (n - 1);
      parts = [
        { id: "source", name: nm(top), anchor: { x: x0 + 40, y: yT } },
        { id: "uniform-region", name: "Uniform field (equally spaced lines)", anchor: { x: gapX, y: (yT + yB) / 2 + 30 } },
        { id: "field-line", name: "Field line", anchor: lineAnchor },
        { id: "direction-arrow", name: "Field direction (+ to −)", anchor: arrowAnchor },
        { id: "second-source", name: nm(-top), anchor: { x: x1 - 40, y: yB } },
        { id: "neutral-point", name: "Edge effect (field weakens)", anchor: { x: x1 + 34, y: (yT + yB) / 2 + 40 } },
      ];
    } else if (setup === "bar-magnet") {
      const L = 220, T = 56;
      const left = cx - L / 2, right = cx + L / 2, top = cy - T / 2, bottom = cy + T / 2;
      const flip = signs(params.sign)[0] === "-" || /^s/i.test(String(params.north ?? params.left ?? "")); // N on the right instead
      const nP = { x: flip ? right - 22 : left + 22, y: cy }, sP = { x: flip ? left + 22 : right - 22, y: cy };
      const sources: Source[] = [{ p: nP, q: 1 }, { p: sP, q: -1 }];
      const inside = (p: Pt, pad = 0) => p.x > left - pad && p.x < right + pad && p.y > top - pad && p.y < bottom + pad;
      const outward = flip ? 1 : -1; // the N end's outward direction along x
      const lines: Pt[][] = [];
      const angles = [0, 16, 32, 50, 68, 88, 112, 140];
      for (const deg of angles) {
        for (const s of deg === 0 ? [1] : [1, -1]) {
          const a = (deg * Math.PI) / 180;
          const u = { x: outward * Math.cos(a), y: s * Math.sin(a) };
          let p = { ...nP };
          while (inside(p)) p = { x: p.x + u.x, y: p.y + u.y };
          if (flip ? p.x < cx : p.x > cx) continue; // only lines that leave the N half
          const start = { x: p.x + u.x * 2, y: p.y + u.y * 2 };
          const pts = trace(sources, start, 1, box, (q) => inside(q, 1), 2, 1400);
          if (pts.length > 4) lines.push(pts);
          // The mirror line arriving at the S end from far away (traced back from S); skipped when it closes on N.
          const v = { x: -u.x, y: u.y };
          let q = { ...sP };
          while (inside(q)) q = { x: q.x + v.x, y: q.y + v.y };
          const back = trace(sources, { x: q.x + v.x * 2, y: q.y + v.y * 2 }, -1, box, (r) => inside(r, 1), 2, 1400);
          if (back.length > 4 && !inside(back[back.length - 1], 1)) lines.push(back.slice().reverse());
        }
      }
      let best = -1;
      lines.forEach((pts, i) => {
        line(pts);
        if (lineLength(pts) < 50) return;
        const { p, d: dirv } = along(pts, 0.5);
        shapes.push(head(p, dirv, LINE, 11));
        if (best < 0 && p.y < top - 40 && Math.abs(p.x - cx) < 30) { best = i; arrowAnchor = p; lineAnchor = along(pts, 0.75).p; }
      });
      shapes.push({ t: "path", part: "source", d: `M${flip ? cx : left} ${top} H${flip ? right : cx} V${bottom} H${flip ? cx : left} Z`, fill: POS, stroke: "ink", width: 2 });
      shapes.push({ t: "path", part: "second-source", d: `M${flip ? left : cx} ${top} H${flip ? cx : right} V${bottom} H${flip ? left : cx} Z`, fill: NEG, stroke: "ink", width: 2 });
      shapes.push({ t: "text", part: "source", x: (flip ? cx + L / 4 : cx - L / 4), y: cy + 10, text: "N", size: 28, anchor: "middle", fill: "#ffffff" });
      shapes.push({ t: "text", part: "second-source", x: (flip ? cx - L / 4 : cx + L / 4), y: cy + 10, text: "S", size: 28, anchor: "middle", fill: "#ffffff" });
      const nX = flip ? cx + L / 4 : cx - L / 4, sX = flip ? cx - L / 4 : cx + L / 4;
      parts = [
        { id: "source", name: "North pole (N)", anchor: { x: nX + (flip ? 28 : -28), y: cy + 14 } },
        { id: "second-source", name: "South pole (S)", anchor: { x: sX + (flip ? -28 : 28), y: cy + 14 } },
        { id: "field-line", name: "Field line", anchor: lineAnchor },
        { id: "direction-arrow", name: "Field direction (N to S)", anchor: arrowAnchor },
        { id: "uniform-region", name: "Strongest field (lines closest)", anchor: { x: flip ? right + 14 : left - 14, y: cy - 22 } },
        { id: "neutral-point", name: "Weak field (lines far apart)", anchor: { x: cx, y: 18 } },
      ];
    } else {
      // Earth's gravitational field: radial, pointing in to the centre.
      const R = 92;
      let farAnchor: Pt = { x: cx, y: cy - 200 };
      const n = 12;
      for (let i = 0; i < n; i++) {
        const a = (2 * Math.PI * (i + 0.5)) / n - Math.PI / 2; // half a step round: no line runs level with a label's leader
        const u = { x: Math.cos(a), y: Math.sin(a) };
        line([{ x: cx + u.x * 205, y: cy + u.y * 205 }, { x: cx + u.x * (R + 4), y: cy + u.y * (R + 4) }]);
        const at = { x: cx + u.x * 150, y: cy + u.y * 150 };
        shapes.push(head(at, { x: -u.x, y: -u.y }, LINE, 12));
        if (i === 0) arrowAnchor = at;
        if (i === 1) lineAnchor = { x: cx + u.x * 185, y: cy + u.y * 185 };
        if (i === n - 1) farAnchor = { x: cx + u.x * 203, y: cy + u.y * 203 };
      }
      shapes.push({ t: "circle", part: "source", cx, cy, r: R, fill: "#2563eb", stroke: "ink", width: 2, opacity: 0.85 });
      shapes.push({ t: "circle", part: "second-source", cx, cy, r: 4, fill: "ink", stroke: "ink", width: 1 });
      parts = [
        { id: "source", name: "Earth", anchor: { x: cx - 40, y: cy + 50 } },
        { id: "field-line", name: "Field line", anchor: lineAnchor },
        { id: "direction-arrow", name: "Field points to the centre", anchor: arrowAnchor },
        { id: "second-source", name: "Centre of the Earth", anchor: { x: cx, y: cy } },
        { id: "uniform-region", name: "Field weaker further out", anchor: farAnchor },
        { id: "neutral-point", name: "Neutral point", anchor: { x: cx, y: cy + R } },
      ];
    }
    return { w: W, h: H, shapes, parts };
  },
};

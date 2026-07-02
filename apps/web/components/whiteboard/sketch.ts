/**
 * Hand-drawn path generation: every shape is built as an SVG path with small,
 * seeded random jitter at each anchor point, so it looks pen-drawn (Excalidraw/
 * rough.js style) instead of a perfect vector shape — but is fully deterministic
 * per element id, so it doesn't reshuffle on re-render.
 */

/** Deterministic 0-1 pseudo-random sequence from a string seed (mulberry32). */
function seededRandom(seed: string): () => number {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let state = h >>> 0;
  return () => {
    state = Math.imul(state ^ (state >>> 15), state | 1);
    state ^= state + Math.imul(state ^ (state >>> 7), state | 61);
    return ((state ^ (state >>> 14)) >>> 0) / 4294967296;
  };
}

function jitter(rand: () => number, amount: number) {
  return (rand() - 0.5) * 2 * amount;
}

/** A wobbly rounded rectangle, drawn as two slightly-offset overlapping passes (the rough.js "double stroke" look). */
export function sketchRect(seed: string, x: number, y: number, w: number, h: number, radius = 14): string {
  const rand = seededRandom(seed);
  const j = 3.2;
  const x0 = x - w / 2 + jitter(rand, j);
  const y0 = y - h / 2 + jitter(rand, j);
  const x1 = x + w / 2 + jitter(rand, j);
  const y1 = y + h / 2 + jitter(rand, j);
  const r = Math.min(radius, w / 3, h / 3);

  return [
    `M ${x0 + r} ${y0 + jitter(rand, j)}`,
    `Q ${x0 + jitter(rand, j)} ${y0 + jitter(rand, j)} ${x0 + jitter(rand, j)} ${y0 + r}`,
    `L ${x0 + jitter(rand, j)} ${y1 - r}`,
    `Q ${x0 + jitter(rand, j)} ${y1 + jitter(rand, j)} ${x0 + r} ${y1 + jitter(rand, j)}`,
    `L ${x1 - r} ${y1 + jitter(rand, j)}`,
    `Q ${x1 + jitter(rand, j)} ${y1 + jitter(rand, j)} ${x1 + jitter(rand, j)} ${y1 - r}`,
    `L ${x1 + jitter(rand, j)} ${y0 + r}`,
    `Q ${x1 + jitter(rand, j)} ${y0 + jitter(rand, j)} ${x1 - r} ${y0 + jitter(rand, j)}`,
    `Z`,
  ].join(" ");
}

/** A wobbly pill (fully rounded rect), used for "concept" nodes. */
export function sketchPill(seed: string, x: number, y: number, w: number, h: number): string {
  return sketchRect(seed, x, y, w, h, h / 2);
}

/** A hand-drawn-looking ellipse built from two bezier arcs with jitter. */
export function sketchCircle(seed: string, cx: number, cy: number, rx: number, ry: number): string {
  const rand = seededRandom(seed);
  const j = 2.6;
  const left = cx - rx + jitter(rand, j);
  const right = cx + rx + jitter(rand, j);
  const top = cy - ry + jitter(rand, j);
  const bottom = cy + ry + jitter(rand, j);
  return [
    `M ${left} ${cy + jitter(rand, j)}`,
    `C ${left} ${top + jitter(rand, j)} ${cx - rx * 0.4} ${top} ${cx} ${top}`,
    `C ${cx + rx * 0.4} ${top} ${right} ${top + jitter(rand, j)} ${right} ${cy + jitter(rand, j)}`,
    `C ${right} ${bottom + jitter(rand, j)} ${cx + rx * 0.4} ${bottom} ${cx} ${bottom}`,
    `C ${cx - rx * 0.4} ${bottom} ${left} ${bottom + jitter(rand, j)} ${left} ${cy + jitter(rand, j)}`,
    `Z`,
  ].join(" ");
}

/** A gently curved connector between two points (never a ruler-straight line), with seeded bow direction. */
export function sketchConnector(seed: string, x1: number, y1: number, x2: number, y2: number): { path: string; midX: number; midY: number } {
  const rand = seededRandom(seed);
  const dx = x2 - x1;
  const dy = y2 - y1;
  const dist = Math.hypot(dx, dy) || 1;
  const nx = -dy / dist;
  const ny = dx / dist;
  const bow = (rand() - 0.5) * Math.min(40, dist * 0.22) + Math.sign(rand() - 0.5) * 6;
  const midX = (x1 + x2) / 2 + nx * bow;
  const midY = (y1 + y2) / 2 + ny * bow;
  const j = 2;
  return {
    path: `M ${x1 + jitter(rand, j)} ${y1 + jitter(rand, j)} Q ${midX} ${midY} ${x2 + jitter(rand, j)} ${y2 + jitter(rand, j)}`,
    midX,
    midY,
  };
}

/** A hand-drawn "circle this" scribble used to mimic a teacher circling part of the board (emphasis / annotation). */
export function sketchScribbleRing(seed: string, cx: number, cy: number, rx: number, ry: number): string {
  const rand = seededRandom(seed + "-ring");
  const j = 5;
  const steps = 14;
  let d = "";
  for (let i = 0; i <= steps; i++) {
    const angle = (i / steps) * Math.PI * 2 * 1.12 - Math.PI / 2;
    const x = cx + Math.cos(angle) * (rx + jitter(rand, j));
    const y = cy + Math.sin(angle) * (ry + jitter(rand, j));
    d += i === 0 ? `M ${x} ${y} ` : `L ${x} ${y} `;
  }
  return d.trim();
}

/** A wobbly hexagon (org-chem ring feel), centered at cx,cy with the given width/height. */
export function sketchHexagon(seed: string, cx: number, cy: number, w: number, h: number): string {
  const rand = seededRandom(seed + "-hex");
  const j = 2.4;
  const rx = w / 2;
  const ry = h / 2;
  let d = "";
  for (let i = 0; i <= 6; i++) {
    // Flat-top hexagon: vertices every 60°, starting at -90° (top).
    const angle = (Math.PI / 3) * i - Math.PI / 2;
    const x = cx + Math.cos(angle) * rx + jitter(rand, j);
    const y = cy + Math.sin(angle) * ry + jitter(rand, j);
    d += i === 0 ? `M ${x} ${y} ` : `L ${x} ${y} `;
  }
  return `${d.trim()} Z`;
}

/** A hand-drawn polyline through points (zig-zag chains, freeform lines), with light jitter. */
export function sketchPolyline(seed: string, points: { x: number; y: number }[]): string {
  if (points.length === 0) return "";
  const rand = seededRandom(seed + "-poly");
  const j = 1.6;
  return points
    .map((p, i) => `${i === 0 ? "M" : "L"} ${p.x + jitter(rand, j)} ${p.y + jitter(rand, j)}`)
    .join(" ");
}

/** A straight-ish hand-drawn line between two points. */
export function sketchLine(seed: string, x1: number, y1: number, x2: number, y2: number): string {
  return sketchPolyline(seed, [
    { x: x1, y: y1 },
    { x: x2, y: y2 },
  ]);
}

/**
 * A real leaf silhouette: a pointed, slightly asymmetric oval outline, returned alongside
 * vein strokes (a center vein + side veins) so the engine can draw them as separate,
 * staggered pen strokes — the outline first, then veins filled in, like an actual sketch.
 */
export function sketchLeaf(seed: string, cx: number, cy: number, w: number, h: number): { outline: string; veins: string[] } {
  const rand = seededRandom(seed + "-leaf");
  const j = 2.2;
  const rx = w / 2;
  const ry = h / 2;
  const top = cy - ry;
  const bottom = cy + ry;

  // Pointed oval: two bezier arcs from the tip (top) to the base (bottom), bulging asymmetrically.
  const outline = [
    `M ${cx + jitter(rand, j)} ${top + jitter(rand, j)}`,
    `C ${cx + rx * 1.05} ${cy - ry * 0.35} ${cx + rx * 0.95} ${cy + ry * 0.5} ${cx + jitter(rand, j)} ${bottom + jitter(rand, j)}`,
    `C ${cx - rx * 0.95} ${cy + ry * 0.5} ${cx - rx * 1.05} ${cy - ry * 0.35} ${cx + jitter(rand, j)} ${top + jitter(rand, j)}`,
    `Z`,
  ].join(" ");

  const centerVein = sketchPolyline(seed + "-vein-c", [
    { x: cx, y: top + ry * 0.15 },
    { x: cx, y: bottom - ry * 0.1 },
  ]);
  const sideVeinA = sketchPolyline(seed + "-vein-a", [
    { x: cx, y: cy - ry * 0.15 },
    { x: cx + rx * 0.55, y: cy + ry * 0.15 },
  ]);
  const sideVeinB = sketchPolyline(seed + "-vein-b", [
    { x: cx, y: cy + ry * 0.25 },
    { x: cx - rx * 0.5, y: cy + ry * 0.55 },
  ]);

  return { outline, veins: [centerVein, sideVeinA, sideVeinB] };
}

/**
 * A sun: a wobbly circle plus N jittered rays radiating outward — returned as the circle
 * outline and a separate array of ray strokes so rays can stroke-in staggered after the
 * disc, like a teacher drawing the body first then adding rays.
 */
export function sketchSunburst(seed: string, cx: number, cy: number, r: number, rayCount = 8): { disc: string; rays: string[] } {
  const disc = sketchCircle(seed + "-disc", cx, cy, r * 0.62, r * 0.62);
  const rand = seededRandom(seed + "-rays");
  const rays: string[] = [];
  for (let i = 0; i < rayCount; i++) {
    const angle = (i / rayCount) * Math.PI * 2 + jitter(rand, 0.12);
    const innerR = r * 0.78;
    const outerR = r * (1.05 + Math.abs(jitter(rand, 0.18)));
    rays.push(
      sketchLine(
        `${seed}-ray-${i}`,
        cx + Math.cos(angle) * innerR,
        cy + Math.sin(angle) * innerR,
        cx + Math.cos(angle) * outerR,
        cy + Math.sin(angle) * outerR
      )
    );
  }
  return { disc, rays };
}

/** A water droplet: pointed top, rounded bottom — distinct from a generic circle. */
export function sketchDroplet(seed: string, cx: number, cy: number, w: number, h: number): string {
  const rand = seededRandom(seed + "-drop");
  const j = 1.8;
  const rx = w / 2;
  const top = cy - h / 2;
  const bottom = cy + h / 2;
  return [
    `M ${cx + jitter(rand, j)} ${top + jitter(rand, j)}`,
    `C ${cx + rx * 1.15} ${cy - h * 0.05} ${cx + rx} ${bottom - rx * 0.2} ${cx + jitter(rand, j)} ${bottom + jitter(rand, j)}`,
    `C ${cx - rx} ${bottom - rx * 0.2} ${cx - rx * 1.15} ${cy - h * 0.05} ${cx + jitter(rand, j)} ${top + jitter(rand, j)}`,
    `Z`,
  ].join(" ");
}

/** A small atom marker — semantic alias over sketchCircle so molecule call-sites read clearly. */
export function sketchAtom(seed: string, cx: number, cy: number, r: number): string {
  return sketchCircle(seed + "-atom", cx, cy, r, r);
}

/** A simple stove/kitchen icon: a rect body with 2-3 burner circles on top. */
export function sketchStove(seed: string, cx: number, cy: number, w: number, h: number): { body: string; burners: string[] } {
  const body = sketchRect(seed + "-stove-body", cx, cy, w, h, 10);
  const top = cy - h / 2;
  const burnerCount = 3;
  const burners: string[] = [];
  for (let i = 0; i < burnerCount; i++) {
    const bx = cx - w / 2 + (w / (burnerCount + 1)) * (i + 1);
    burners.push(sketchCircle(`${seed}-burner-${i}`, bx, top + h * 0.18, w * 0.09, w * 0.09));
  }
  return { body, burners };
}

export const PALETTE = [
  { stroke: "#6d28d9", fill: "#f5f3ff" }, // violet
  { stroke: "#0e7490", fill: "#ecfeff" }, // cyan
  { stroke: "#b45309", fill: "#fffbeb" }, // amber
  { stroke: "#be185d", fill: "#fdf2f8" }, // pink
  { stroke: "#15803d", fill: "#f0fdf4" }, // green
  { stroke: "#3730a3", fill: "#eef2ff" }, // indigo
];

export function colorForLayer(layer: number) {
  return PALETTE[layer % PALETTE.length];
}

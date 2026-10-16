import { project } from "./project";
import type { FigureShape } from "../figures/types";

/**
 * Public-domain outline data bundled with the app. Coordinates are lon/lat for the world map and
 * drawing-space polylines for the body, plant and cross-section frames. No network at runtime.
 */

type Ring = Array<[number, number]>;

/** Simplified continental outlines (equirectangular lon/lat), enough for a textbook world map. */
export const CONTINENTS: Ring[] = [
  // Africa
  [[-17, 32], [-9, 37], [10, 37], [11, 33], [25, 32], [32, 31], [35, 28], [43, 12], [51, 12], [51, 0], [43, -11], [40, -15], [32, -25], [29, -32], [19, -35], [18, -29], [14, -18], [12, -5], [-5, 5], [-10, 6], [-17, 14], [-17, 21], [-16, 28], [-17, 32]],
  // Europe
  [[-10, 36], [-9, 43], [-8, 43], [-6, 36], [-5, 43], [0, 51], [-5, 48], [-5, 58], [5, 61], [8, 54], [10, 59], [12, 55], [18, 55], [24, 60], [30, 60], [30, 46], [28, 41], [26, 40], [20, 40], [16, 39], [12, 42], [3, 43], [-1, 37], [-6, 36], [-9, 37], [-10, 36]],
  // Asia (mainland)
  [[30, 46], [30, 60], [40, 64], [60, 70], [90, 75], [140, 73], [170, 66], [180, 65], [170, 60], [160, 55], [145, 50], [142, 47], [140, 35], [128, 35], [122, 30], [120, 25], [110, 20], [109, 12], [105, 10], [100, 12], [98, 8], [94, 16], [90, 22], [80, 15], [73, 20], [70, 25], [62, 25], [60, 23], [56, 27], [48, 30], [44, 40], [40, 40], [36, 36], [32, 36], [30, 41], [30, 46]],
  // India
  [[68, 23], [73, 20], [77, 8], [80, 15], [88, 22], [92, 24], [88, 27], [80, 28], [74, 27], [70, 25], [68, 23]],
  // Arabia
  [[34, 31], [36, 29], [44, 12], [52, 15], [56, 26], [48, 30], [44, 40], [40, 36], [36, 36], [34, 31]],
  // North America
  [[-168, 66], [-165, 64], [-141, 60], [-130, 55], [-124, 48], [-124, 40], [-117, 32], [-110, 23], [-105, 22], [-97, 16], [-90, 16], [-87, 21], [-83, 22], [-81, 25], [-80, 32], [-76, 35], [-66, 44], [-60, 47], [-56, 51], [-64, 60], [-78, 62], [-85, 65], [-90, 68], [-95, 72], [-120, 74], [-140, 70], [-160, 68], [-168, 66]],
  // Central America
  [[-92, 15], [-88, 16], [-84, 10], [-78, 8], [-83, 8], [-87, 13], [-92, 15]],
  // South America
  [[-81, 12], [-77, 8], [-70, 12], [-60, 8], [-50, 0], [-35, -5], [-35, -20], [-40, -22], [-48, -28], [-53, -34], [-68, -55], [-71, -52], [-74, -42], [-71, -18], [-81, -5], [-81, 12]],
  // Australia
  [[113, -22], [114, -28], [115, -34], [125, -32], [131, -32], [137, -34], [146, -39], [150, -37], [153, -28], [153, -12], [145, -15], [142, -11], [136, -12], [129, -14], [122, -18], [113, -22]],
  // Greenland
  [[-73, 78], [-60, 82], [-20, 81], [-22, 70], [-44, 60], [-53, 71], [-73, 78]],
  // Madagascar
  [[43, -12], [50, -12], [47, -25], [43, -25], [43, -12]],
  // UK
  [[-6, 50], [-5, 58], [1, 61], [2, 53], [-5, 50], [-6, 50]],
];

const MAP_BOX = { x: 8, y: 8, w: 624, h: 312 };

function ringPath(ring: Ring, box = MAP_BOX): string {
  const pts = ring.map(([lon, lat]) => project(lon, lat, box));
  return `M${pts.map((p) => `${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" L")} Z`;
}

export function worldMapShapes(): FigureShape[] {
  const ocean: FigureShape = { t: "path", d: `M${MAP_BOX.x} ${MAP_BOX.y} h${MAP_BOX.w} v${MAP_BOX.h} h${-MAP_BOX.w} Z`, fill: "#dbeafe", stroke: "ink", width: 1.2 };
  const land = CONTINENTS.map((ring): FigureShape => ({ t: "path", d: ringPath(ring), fill: "#fde68a", stroke: "ink", width: 1 }));
  const equator: FigureShape = { t: "path", d: `M${MAP_BOX.x} ${MAP_BOX.y + MAP_BOX.h / 2} h${MAP_BOX.w}`, fill: "none", stroke: "muted", width: 0.8, dash: "5 4" };
  const tropics: FigureShape[] = [23.5, -23.5].map((lat) => {
    const y = project(0, lat, MAP_BOX).y;
    return { t: "path", d: `M${MAP_BOX.x} ${y.toFixed(1)} h${MAP_BOX.w}`, fill: "none", stroke: "muted", width: 0.6, dash: "3 5" };
  });
  return [ocean, ...land, equator, ...tropics];
}

export const WORLD_MAP_BOX = MAP_BOX;

/** Blank stratified frame (rock, soil, atmosphere, latitude bands sit inside). */
export function crossSectionShapes(w = 640, h = 400): FigureShape[] {
  return [
    { t: "path", d: `M24 24 H${w - 24} V${h - 24} H24 Z`, fill: "#f8fafc", stroke: "ink", width: 1.6 },
  ];
}

/** Simple anterior body outline, head at the top. Coordinates in a 200×400 frame, scaled by caller. */
export function bodyOutlinePath(ox = 220, oy = 20, s = 1): string {
  const p = (x: number, y: number) => `${(ox + x * s).toFixed(1)} ${(oy + y * s).toFixed(1)}`;
  return `M${p(100, 18)} C${p(118, 18)} ${p(132, 36)} ${p(132, 54)} C${p(132, 72)} ${p(118, 88)} ${p(100, 88)} C${p(82, 88)} ${p(68, 72)} ${p(68, 54)} C${p(68, 36)} ${p(82, 18)} ${p(100, 18)} Z M${p(100, 88)} L${p(100, 96)} M${p(72, 108)} C${p(56, 108)} ${p(44, 128)} ${p(48, 160)} L${p(58, 210)} L${p(70, 208)} L${p(66, 168)} L${p(78, 130)} L${p(78, 250)} L${p(70, 340)} L${p(88, 340)} L${p(96, 250)} L${p(104, 250)} L${p(112, 340)} L${p(130, 340)} L${p(122, 250)} L${p(122, 130)} L${p(134, 168)} L${p(130, 208)} L${p(142, 210)} L${p(152, 160)} C${p(156, 128)} ${p(144, 108)} ${p(128, 108)} L${p(100, 96)} Z`;
}

export function bodyShapes(): FigureShape[] {
  return [{ t: "path", d: bodyOutlinePath(), fill: "#fed7aa", stroke: "ink", width: 1.6 }];
}

/** Simple plant: stem, two leaves, flower head. */
export function plantShapes(): FigureShape[] {
  const stem: FigureShape = { t: "path", d: "M320 380 C318 300 322 220 320 120", fill: "none", stroke: "#15803d", width: 4 };
  const leafL: FigureShape = { t: "path", d: "M320 250 C250 220 210 180 240 160 C280 150 310 200 320 230 Z", fill: "#86efac", stroke: "ink", width: 1.4 };
  const leafR: FigureShape = { t: "path", d: "M320 210 C390 180 430 140 400 120 C360 110 330 160 320 190 Z", fill: "#86efac", stroke: "ink", width: 1.4 };
  const flower: FigureShape = { t: "circle", cx: 320, cy: 100, r: 28, fill: "#fde047", stroke: "ink", width: 1.4 };
  return [stem, leafL, leafR, flower];
}

export function baseShapes(base: string | undefined, w: number, h: number): FigureShape[] {
  if (base === "world-map") return worldMapShapes();
  if (base === "body") return bodyShapes();
  if (base === "plant") return plantShapes();
  if (base === "cross-section") return crossSectionShapes(w, h);
  return [];
}

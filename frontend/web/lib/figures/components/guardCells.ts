import type { FigureComponent, FigurePart, FigureParams, FigureShape, Pt } from "../types";
import { arrowShapes, r2, smoothClosed } from "./bioDraw";
import { bool } from "./mathsKit";

/**
 * A STOMA AND ITS GUARD CELLS in surface view, as the O/A Level textbook draws them: two bean-shaped
 * guard cells meeting at their ends round the pore, each with a thick inner wall (beside the pore)
 * and a thin outer wall, chloroplasts, a vacuole and a nucleus, set among epidermal cells that have
 * no chloroplasts. state "open": the guard cells are turgid and bow apart (the thin outer walls
 * stretch more than the thick inner ones), so the pore is a wide lens; "closed": flaccid, straighter
 * cells and a slit. Arrows show K⁺ ions and water moving in (opening) or out (closing).
 */

type State = "open" | "closed";

const W = 640, H = 420, O: Pt = { x: W / 2, y: H / 2 };
const B = 150; // half the length of the guard-cell pair
/** Every outline here lies inside the pale epidermis: a fixed dark that stays dark on the chalkboard too. */
const DARK = "#374151";
const C = {
  cytoplasm: "#fef9c3",
  innerWall: "#86b33a",
  vacuole: "#dbeafe",
  chloroplast: "#22c55e",
  nucleus: "#ddd6fe",
  epidermis: "#f0fdf4",
  water: "#1e40af",
  potassium: "#5b21b6",
} as const;

function stateOf(params: FigureParams): State {
  const s = String(params?.state ?? params?.stoma ?? params?.status ?? "").toLowerCase();
  if (/clos|shut|flaccid|night|dark|wilt/.test(s)) return "closed";
  return "open";
}

/** The pair's shape for a state: the half-width A of the whole pair, the pore's half-width and half-length. */
function geometry(state: State) {
  return state === "open" ? { A: 128, pore: 40, ph: 104, wall: 10 } : { A: 86, pore: 2.5, ph: 98, wall: 10 };
}

export const guardCells: FigureComponent = {
  name: "guardCells",
  title: "Stoma and guard cells: surface view of a stoma between two guard cells — thick inner walls, thin outer walls, chloroplasts, vacuole and nucleus, among epidermal cells — turgid and open, or flaccid and closed",
  params: `state ("open" default: turgid guard cells bowed apart round a wide pore | "closed": flaccid, straighter guard cells and a slit). showArrows (true default: K⁺ ions and water moving into the guard cells when opening, out when closing).`,
  match: /\bguard[- ]cells?\b|\bstomat(?:a|al)\b(?=[\s\S]{0,160}\b(?:open\w*|clos\w*|turgid|flaccid|guard|aperture|potassium|K\+|K⁺)\b)|\b(?:open\w*|clos\w*) (?:of |the )*stomat(?:a|al)\b|\bstomatal (?:opening|closure|closing|aperture|pore)s?\b|\bstoma\b(?=[\s\S]{0,80}\b(?:guard|open|clos\w*)\b)/i,
  parts: [
    { id: "guard-cell", name: "Guard cell" },
    { id: "stoma", name: "Stoma" },
    { id: "inner-wall", name: "Thick inner wall" },
    { id: "outer-wall", name: "Thin outer wall" },
    { id: "chloroplast", name: "Chloroplast" },
    { id: "vacuole", name: "Vacuole" },
    { id: "nucleus", name: "Nucleus" },
    { id: "epidermal-cell", name: "Epidermal cell" },
    { id: "potassium", name: "K⁺ ions" },
    { id: "water", name: "Water by osmosis" },
  ],
  build(params: FigureParams) {
    const state = stateOf(params ?? {});
    const arrows = bool(params?.showArrows ?? params?.arrows, true);
    const { A, pore, ph, wall } = geometry(state);
    const shapes: FigureShape[] = [];
    const parts: FigurePart[] = [];
    const P = (p: Pt) => `${r2(p.x)} ${r2(p.y)}`;

    /** The x of the pair's outer outline and of the thick wall's inner face at height dy, on side s (−1 left, +1 right). */
    const outerX = (dy: number, s: number) => O.x + s * A * Math.sqrt(Math.max(0, 1 - (dy / B) ** 2));
    const wallX = (dy: number, s: number) => (Math.abs(dy) < ph ? O.x + s * (pore + wall) * Math.sqrt(Math.max(0, 1 - (dy / ph) ** 2)) : O.x);

    // Epidermal cells round the pair, with the wavy (jigsaw) walls of a dicot leaf epidermis. Each
    // radial wall is computed once, so neighbouring cells share it exactly.
    const angles = [-90, -38, 0, 38, 90, 142, 180, 218];
    const outerAt = (deg: number): Pt => { const a = (deg * Math.PI) / 180; return { x: O.x + 302 * Math.cos(a), y: O.y + 200 * Math.sin(a) }; };
    const onPair = (deg: number): Pt => { const a = (deg * Math.PI) / 180; return { x: O.x + A * Math.cos(a), y: O.y + B * Math.sin(a) }; };
    const wavy = (p0: Pt, p1: Pt, amp: number, waves: number, n = 18): Pt[] => {
      const L = Math.hypot(p1.x - p0.x, p1.y - p0.y) || 1, nx = -(p1.y - p0.y) / L, ny = (p1.x - p0.x) / L;
      return Array.from({ length: n + 1 }, (_, i) => { const t = i / n, w = amp * Math.sin(t * waves * Math.PI); return { x: p0.x + (p1.x - p0.x) * t + nx * w, y: p0.y + (p1.y - p0.y) * t + ny * w }; });
    };
    const radialWalls = angles.map((deg) => wavy(onPair(deg), outerAt(deg), 5, 3));
    for (let i = 0; i < angles.length; i++) {
      const j = (i + 1) % angles.length;
      const a0 = angles[i], a1 = angles[j] + (j === 0 ? 360 : 0);
      const arc: Pt[] = [];
      for (let k = 0; k <= 10; k++) arc.push(onPair(a0 + ((a1 - a0) * k) / 10));
      // The outer edge of the patch: an elliptical arc with a gentle wave.
      const rim: Pt[] = [];
      for (let k = 0; k <= 16; k++) {
        const deg = a1 - ((a1 - a0) * k) / 16, a = (deg * Math.PI) / 180, w = 5 * Math.sin((k / 16) * 3 * Math.PI);
        rim.push({ x: O.x + (302 + w) * Math.cos(a), y: O.y + (200 + w) * Math.sin(a) });
      }
      rim[0] = radialWalls[j][radialWalls[j].length - 1];
      rim[rim.length - 1] = radialWalls[i][radialWalls[i].length - 1];
      const cell = [...arc, ...radialWalls[j].slice(1), ...rim.slice(1, -1), ...[...radialWalls[i]].reverse()];
      shapes.push({ t: "path", d: `M${cell.map(P).join(" L")} Z`, fill: C.epidermis, stroke: "#6b7280", width: 1.6, part: "epidermal-cell" });
    }

    // Each guard cell: cytoplasm filling the half of the pair beside the pore.
    for (const s of [-1, 1]) {
      const sweepOuter = s < 0 ? 0 : 1, sweepPore = s < 0 ? 1 : 0;
      const top = { x: O.x, y: O.y - B }, bot = { x: O.x, y: O.y + B };
      const cell = `M${P(top)} A${A} ${B} 0 0 ${sweepOuter} ${P(bot)} L${P({ x: O.x, y: O.y + ph })} A${r2(pore)} ${ph} 0 0 ${sweepPore} ${P({ x: O.x, y: O.y - ph })} Z`;
      shapes.push({ t: "path", d: cell, fill: C.cytoplasm, stroke: "none", part: "guard-cell" });
      // Vacuole along the middle of the cell.
      const vac: Pt[] = [];
      // Turgid cells hold a large vacuole; flaccid cells have lost water and the vacuole is smaller.
      const steps = 9, vw = state === "open" ? 0.2 : 0.13;
      for (let k = 0; k <= steps; k++) { const dy = -0.6 * B + (1.2 * B * k) / steps; const xo = outerX(dy, s), xi = wallX(dy, s); vac.push({ x: xo + (xi - xo) * (0.5 - vw), y: O.y + dy }); }
      for (let k = steps; k >= 0; k--) { const dy = -0.6 * B + (1.2 * B * k) / steps; const xo = outerX(dy, s), xi = wallX(dy, s); vac.push({ x: xo + (xi - xo) * (0.5 + vw), y: O.y + dy }); }
      shapes.push({ t: "path", d: smoothClosed(vac, 0.9), fill: C.vacuole, stroke: DARK, width: 1.3, part: "vacuole" });
      // Chloroplasts in the cytoplasm round the vacuole, lying along the walls.
      const chloro = [[-0.8, 0.5], [-0.5, 0.15], [-0.18, 0.86], [0.18, 0.14], [0.5, 0.85], [0.8, 0.5], [-0.5, 0.85], [0.5, 0.15]];
      for (const [fy, fx] of chloro) {
        const dy = fy * B, xo = outerX(dy, s), xi = wallX(dy, s);
        const c = { x: xo + (xi - xo) * fx, y: O.y + dy };
        // Along the wall: the outline's slope at this height.
        const slope = (outerX(dy + 1, s) - outerX(dy - 1, s)) / 2;
        const ang = (Math.atan2(1, slope) * 180) / Math.PI;
        const rx = 8.5, ry = 4.8;
        shapes.push({ t: "path", d: `M${P({ x: c.x - rx * Math.cos((ang * Math.PI) / 180), y: c.y - rx * Math.sin((ang * Math.PI) / 180) })} A${rx} ${ry} ${r2(ang)} 1 1 ${P({ x: c.x + rx * Math.cos((ang * Math.PI) / 180), y: c.y + rx * Math.sin((ang * Math.PI) / 180) })} A${rx} ${ry} ${r2(ang)} 1 1 ${P({ x: c.x - rx * Math.cos((ang * Math.PI) / 180), y: c.y - rx * Math.sin((ang * Math.PI) / 180) })} Z`, fill: C.chloroplast, stroke: DARK, width: 1, part: "chloroplast" });
      }
      // Nucleus in the middle of the cell.
      const nx = (outerX(0, s) + wallX(0, s)) / 2;
      shapes.push({ t: "path", d: `M${r2(nx - 11)} ${O.y} A11 16 0 1 0 ${r2(nx + 11)} ${O.y} A11 16 0 1 0 ${r2(nx - 11)} ${O.y} Z`, fill: C.nucleus, stroke: DARK, width: 1.6, part: "nucleus" });
      // Thin outer wall.
      shapes.push({ t: "path", d: `M${P(top)} A${A} ${B} 0 0 ${sweepOuter} ${P(bot)}`, fill: "none", stroke: DARK, width: 1.8, part: "outer-wall" });
      // Thick inner wall: a band along the pore.
      const band = `M${P({ x: O.x, y: O.y - ph })} A${r2(pore + wall)} ${ph} 0 0 ${sweepOuter} ${P({ x: O.x, y: O.y + ph })} A${r2(pore)} ${ph} 0 0 ${sweepPore} ${P({ x: O.x, y: O.y - ph })} Z`;
      shapes.push({ t: "path", d: band, fill: C.innerWall, stroke: DARK, width: 1.6, part: "inner-wall" });
    }
    // The walls where the two guard cells meet, above and below the pore.
    shapes.push({ t: "path", d: `M${O.x} ${O.y - B} V${O.y - ph} M${O.x} ${O.y + ph} V${O.y + B}`, fill: "none", stroke: DARK, width: 1.8, part: "guard-cell" });
    // The pore itself: a lens of air when open, a dark slit when closed.
    shapes.push(state === "open"
      ? { t: "path", d: `M${O.x} ${O.y - ph} A${pore} ${ph} 0 0 0 ${O.x} ${O.y + ph} A${pore} ${ph} 0 0 0 ${O.x} ${O.y - ph} Z`, fill: "#e0f2fe", stroke: "none", opacity: 0.9, part: "stoma" }
      : { t: "path", d: `M${O.x} ${O.y - ph + 10} V${O.y + ph - 10}`, fill: "none", stroke: DARK, width: 2.4, part: "stoma" });

    const sIn = state === "open"; // opening: in; closing: out
    if (arrows) {
      // K⁺ on the left guard cell, water on the right: into the cells when opening, out when closing.
      const ky = O.y - 64, wy = O.y + 64;
      const kIn = { x: outerX(ky - O.y, -1) + 22, y: ky }, kOut = { x: kIn.x - 96, y: ky };
      const wIn = { x: outerX(wy - O.y, 1) - 22, y: wy }, wOut = { x: wIn.x + 96, y: wy };
      const [kFrom, kTo] = sIn ? [kOut, kIn] : [kIn, kOut];
      const [wFrom, wTo] = sIn ? [wOut, wIn] : [wIn, wOut];
      shapes.push(...arrowShapes(kFrom, kTo, C.potassium, 2.8, "potassium", { head: 13 }));
      shapes.push({ t: "text", x: r2(kOut.x + 20), y: r2(ky - 12), text: "K⁺", size: 20, anchor: "middle", fill: C.potassium, part: "potassium" });
      shapes.push(...arrowShapes(wFrom, wTo, C.water, 2.8, "water", { head: 13 }));
      shapes.push({ t: "text", x: r2(wOut.x - 26), y: r2(wy + 26), text: "H₂O", size: 18, anchor: "middle", fill: C.water, part: "water" });
      parts.push(
        { id: "potassium", name: sIn ? "K⁺ ions move in" : "K⁺ ions move out", anchor: { x: r2(kOut.x + 6), y: ky } },
        { id: "water", name: sIn ? "Water enters by osmosis" : "Water leaves by osmosis", anchor: { x: r2(wOut.x - 6), y: wy } },
      );
    }

    const gdy = -0.62 * B, rdy = 0.55 * B;
    parts.unshift(
      { id: "guard-cell", name: sIn ? "Guard cell (turgid)" : "Guard cell (flaccid)", anchor: { x: r2((outerX(gdy, 1) + wallX(gdy, 1)) / 2 + 10), y: r2(O.y + gdy) } },
      { id: "stoma", name: sIn ? "Stoma (open)" : "Stoma (closed)", anchor: { x: O.x, y: O.y + (sIn ? 40 : 30) } },
      { id: "inner-wall", name: "Thick inner wall", anchor: { x: r2(wallX(-0.5 * ph, -1) + wall / 2), y: r2(O.y - 0.5 * ph) } },
      { id: "outer-wall", name: "Thin outer wall", anchor: { x: r2(outerX(rdy, 1)), y: r2(O.y + rdy) } },
      { id: "chloroplast", name: "Chloroplast", anchor: (() => { const dy = 0.8 * B, xo = outerX(dy, -1), xi = wallX(dy, -1); return { x: r2(xo + (xi - xo) * 0.5), y: r2(O.y + dy) }; })() },
      { id: "vacuole", name: "Vacuole", anchor: (() => { const dy = 0.3 * B, xo = outerX(dy, -1), xi = wallX(dy, -1); return { x: r2(xo + (xi - xo) * 0.45), y: r2(O.y + dy) }; })() },
      { id: "nucleus", name: "Nucleus", anchor: { x: r2((outerX(0, 1) + wallX(0, 1)) / 2 + 4), y: O.y } },
      { id: "epidermal-cell", name: "Epidermal cell (no chloroplasts)", anchor: { x: r2(O.x - A - 110), y: r2(O.y + 70) } },
    );
    return { w: W, h: H, shapes, parts };
  },
};

import type { FigureComponent, FigurePart, FigureParams, FigureShape, Ink, Pt } from "../types";
import { arrowHead, r2, smoothClosed, smoothOpen } from "./bioDraw";
import { thinLine } from "./nephron";

/**
 * A SECTION THROUGH HUMAN SKIN for temperature control, as the O Level textbooks draw it: the
 * epidermis with its wavy lower edge, the dermis (hair in its follicle, hair erector muscle,
 * sebaceous gland, a coiled sweat gland with its duct and pore, a temperature receptor, and the
 * blood supply — an arteriole rising to the capillary loop under the epidermis, a shunt vessel
 * across to the venule), and the fat layer beneath. `response` redraws what changes:
 *   hot  — arterioles to the surface dilate (vasodilation), the shunt closes, sweat pours out of the
 *          pore, the erector muscles relax and the hairs lie flat; heat radiates away;
 *   cold — those arterioles constrict (vasoconstriction), blood takes the shunt, no sweat, the
 *          erector muscles contract and the hairs stand up; the muscles beneath shiver.
 */

type Response = "none" | "hot" | "cold";
function responseOf(v: unknown): Response {
  const s = String(v ?? "").toLowerCase();
  if (/hot|warm|heat|dilat|sweat|overheat/.test(s)) return "hot";
  if (/cold|cool|chill|constrict|shiver/.test(s)) return "cold";
  return "none";
}

const C = {
  epidermis: "#fdba74" as Ink,
  dermis: "#fdba74" as Ink,
  fat: "#facc15" as Ink,
  fatLine: "#d97706" as Ink,
  hair: "#92400e" as Ink,
  sheath: "#fde68a" as Ink,
  muscle: "#fca5a5" as Ink,
  gland: "#fef3c7" as Ink,
  sweat: "#93c5fd" as Ink,
  sweatLine: "#2563eb" as Ink,
  artery: "#be123c" as Ink,
  arteryFill: "#fda4af" as Ink,
  vein: "#1d4ed8" as Ink,
  veinFill: "#93c5fd" as Ink,
  nerve: "#6d28d9" as Ink,
  heat: "#c2410c" as Ink,
};

const W = 700;
/** Skin surface, the epidermis's lower edge (mean), the top of the fat layer, the bottom of the skin. */
const SURF = 92, EPI = 128, FAT = 334, BASE = 416;
const pt = (x: number, y: number): Pt => ({ x, y });
const lerp = (a: Pt, b: Pt, t: number): Pt => pt(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t);
const surfY = (x: number) => SURF + 2.5 * Math.sin(x / 40);
const epiY = (x: number) => EPI + 7 * Math.sin(x / 15);

export const skinSection: FigureComponent = {
  name: "skinSection",
  title: "Skin section for temperature control: epidermis, dermis and fat layer, hair and hair erector muscle, sweat gland, duct and pore, temperature receptor, and the arteriole, shunt vessel, capillaries and venule",
  params: `response ("none" default | "hot": vasodilation, sweating, hairs lie flat, heat radiated | "cold": vasoconstriction, blood through the shunt vessel, hairs raised, shivering muscles below).`,
  match: /\b(section (through|of) (the )?(human )?skin|skin (section|structure|cross[- ]section))\b|\b(sweat glands?|sweat pores?|hair erector|erector (pili )?muscles?|arrector pili)\b|\bvaso(dilation|dilatation|constriction)\b(?=[\s\S]{0,200}\b(skin|temperature|heat|arteriole|capillar\w*)\b)|\bshunt vessels?\b|\b(skin|body) temperature\b(?=[\s\S]{0,200}\b(sweat\w*|vaso\w+|shiver\w*|hairs?)\b)|\bthermoregulation\b/i,
  parts: [
    { id: "epidermis", name: "Epidermis" },
    { id: "dermis", name: "Dermis" },
    { id: "fat-layer", name: "Fat layer" },
    { id: "hair", name: "Hair" },
    { id: "hair-erector-muscle", name: "Hair erector muscle" },
    { id: "sweat-gland", name: "Sweat gland" },
    { id: "sweat-pore", name: "Sweat pore" },
    { id: "capillaries", name: "Capillaries" },
    { id: "arteriole", name: "Arteriole" },
    { id: "shunt-vessel", name: "Shunt vessel" },
    { id: "venule", name: "Venule" },
    { id: "receptor", name: "Temperature receptor" },
    { id: "sweat-duct", name: "Sweat duct" },
    { id: "hair-follicle", name: "Hair follicle" },
    { id: "sebaceous-gland", name: "Sebaceous gland" },
    { id: "sweat", name: "Sweat" },
    { id: "heat-loss", name: "Heat lost by radiation" },
    { id: "shivering", name: "Shivering muscles" },
  ],
  build(params: FigureParams) {
    const response = responseOf(params?.response ?? params?.condition ?? params?.temperature);
    const hot = response === "hot", cold = response === "cold";
    const H = cold ? 456 : 420;

    const back: FigureShape[] = [];
    const walls: FigureShape[] = [];
    const lumens: FigureShape[] = [];
    const over: FigureShape[] = [];
    const parts: FigurePart[] = [];
    const tube = (d: string, outer: number, fill: Ink, part: string, edge: Ink = "ink", inner = outer - 4.2) => {
      walls.push({ t: "path", d, stroke: edge, width: outer, fill: "none", part });
      lumens.push({ t: "path", d, stroke: fill, width: Math.max(1.2, inner), fill: "none", part });
    };

    // ── The three layers. ──
    const xs = Array.from({ length: 36 }, (_, i) => 20 + (i * (W - 40)) / 35);
    const surface = xs.map((x) => pt(x, surfY(x)));
    const xsFine = Array.from({ length: 90 }, (_, i) => 20 + (i * (W - 40)) / 89);
    const epiEdge = xsFine.map((x) => pt(x, epiY(x)));
    const rev = (pts: Pt[]) => [...pts].reverse();
    const line = (pts: Pt[]) => pts.map((p) => `${r2(p.x)} ${r2(p.y)}`).join(" L");
    back.push({ t: "path", d: `M${line(epiEdge)} L${W - 20} ${FAT} L20 ${FAT} Z`, fill: C.dermis, stroke: "none", opacity: 0.2, part: "dermis" });
    back.push({ t: "path", d: `M20 ${FAT} L${W - 20} ${FAT} L${W - 20} ${BASE} L20 ${BASE} Z`, fill: C.fat, stroke: "none", opacity: 0.22, part: "fat-layer" });
    back.push({ t: "path", d: `M${line(surface)} L${line(rev(epiEdge))} Z`, fill: C.epidermis, stroke: "none", opacity: 0.85, part: "epidermis" });
    back.push({ t: "path", d: `M${line(surface)}`, stroke: "ink", width: 2.4, fill: "none", part: "epidermis" });
    back.push({ t: "path", d: `M${line(epiEdge)}`, stroke: "ink", width: 1.6, fill: "none", part: "epidermis" });
    back.push({ t: "path", d: `M20 ${FAT} H${W - 20}`, stroke: "ink", width: 1.4, fill: "none", dash: "7 6", part: "fat-layer" });
    back.push({ t: "path", d: `M20 ${r2(surfY(20))} V${BASE} H${W - 20} V${r2(surfY(W - 20))}`, stroke: "ink", width: 2, fill: "none" });
    // Fat cells: a packed layer of round cells.
    for (let row = 0; row < 3; row++) for (let i = 0; i < 24; i++) {
      const cx = 36 + i * 28 + (row % 2) * 14, cy = FAT + 16 + row * 25;
      if (cx > W - 34) continue;
      back.push({ t: "circle", cx, cy, r: 12, fill: "none", stroke: C.fatLine, width: 1.4, opacity: 0.75, part: "fat-layer" });
    }
    parts.push({ id: "epidermis", name: "Epidermis", anchor: pt(56, (SURF + EPI) / 2) }, { id: "dermis", name: "Dermis", anchor: pt(56, 236) }, { id: "fat-layer", name: "Fat layer", anchor: pt(64, FAT + 41) });

    // ── Hair in its follicle (slanting down to the right); the erector muscle on its left. ──
    const E = pt(206, surfY(206)), B = pt(278, 300);
    tube(`M${r2(E.x)} ${r2(E.y + 4)} L${r2(B.x)} ${r2(B.y)}`, 24, C.sheath, "hair-follicle");
    over.push({ t: "path", d: smoothClosed([pt(B.x - 18, B.y + 4), pt(B.x - 10, B.y - 14), pt(B.x + 10, B.y - 14), pt(B.x + 18, B.y + 4), pt(B.x, B.y + 20)]), fill: C.sheath, stroke: "ink", width: 2, part: "hair-follicle" });
    over.push({ t: "path", d: smoothClosed([pt(B.x - 6, B.y + 16), pt(B.x - 7, B.y + 4), pt(B.x, B.y - 2), pt(B.x + 7, B.y + 4), pt(B.x + 6, B.y + 16)]), fill: C.arteryFill, stroke: C.artery, width: 1.6, part: "hair-follicle" });
    // The hair shaft: from the bulb out of the skin, at an angle set by the erector muscle.
    const theta = ((hot ? 16 : cold ? 84 : 54) * Math.PI) / 180;
    const tip = pt(E.x - 86 * Math.cos(theta), E.y - 86 * Math.sin(theta));
    over.push({ t: "path", d: `M${r2(B.x - 2)} ${r2(B.y - 6)} L${r2(E.x)} ${r2(E.y)} Q${r2(E.x - 10 * Math.cos(theta))} ${r2(E.y - 10 * Math.sin(theta))} ${r2(tip.x)} ${r2(tip.y)}`, stroke: C.hair, width: 4.4, fill: "none", part: "hair" });
    parts.push({ id: "hair", name: "Hair", anchor: lerp(E, tip, 0.7) }, { id: "hair-follicle", name: "Hair follicle", anchor: lerp(E, B, 0.8) });
    // Sebaceous gland on the follicle's upper (left) side.
    const sg = lerp(E, B, 0.3);
    over.push({ t: "path", d: smoothClosed([pt(sg.x - 10, sg.y - 4), pt(sg.x - 20, sg.y - 12), pt(sg.x - 34, sg.y - 4), pt(sg.x - 36, sg.y + 12), pt(sg.x - 22, sg.y + 20), pt(sg.x - 8, sg.y + 12)]), fill: C.gland, stroke: "ink", width: 1.8, part: "sebaceous-gland" });
    parts.push({ id: "sebaceous-gland", name: "Sebaceous gland", anchor: pt(sg.x - 24, sg.y + 4) });
    // The erector muscle: from the follicle up to the underside of the epidermis, on the hair's side.
    const m0 = lerp(E, B, 0.62), m0s = pt(m0.x - 12, m0.y + 2);
    const mx = cold ? 168 : 150;
    const m1 = pt(mx, epiY(mx) + 4);
    const mm = lerp(m0s, m1, 0.5), dir = { x: m1.x - m0s.x, y: m1.y - m0s.y }, dl = Math.hypot(dir.x, dir.y) || 1;
    const half = hot ? 4 : cold ? 11 : 7;
    const side = { x: (-dir.y / dl) * half, y: (dir.x / dl) * half };
    over.push({ t: "path", d: smoothClosed([m0s, pt(mm.x + side.x, mm.y + side.y), m1, pt(mm.x - side.x, mm.y - side.y)], 0.8), fill: C.muscle, stroke: "ink", width: 1.8, part: "hair-erector-muscle" });
    parts.push({ id: "hair-erector-muscle", name: "Hair erector muscle", anchor: mm });

    // ── The temperature receptor: a sensory nerve ending just under the epidermis. ──
    const rx = 86;
    over.push(...thinLine([pt(rx + 8, BASE), pt(rx + 4, FAT), pt(rx - 4, 250), pt(rx, 172), pt(rx, 156)], { stroke: C.nerve, width: 2.6, part: "receptor" }));
    for (const [dx, dy] of [[-15, -16], [0, -20], [15, -15]] as const) {
      over.push({ t: "path", d: `M${rx} 156 Q${rx + dx * 0.3} ${156 + dy * 0.7} ${rx + dx} ${156 + dy}`, stroke: C.nerve, width: 2.2, fill: "none", part: "receptor" });
      over.push({ t: "circle", cx: rx + dx, cy: 156 + dy, r: 2.6, fill: C.nerve, stroke: "none", part: "receptor" });
    }
    parts.push({ id: "receptor", name: "Temperature receptor", anchor: pt(rx, 150) });

    // ── The sweat gland: a coiled tube deep in the dermis, its duct up to the pore. ──
    const G = pt(430, 298);
    // A coiled tube: loops one after another (a prolate cycloid), the duct leaving from the last.
    const coil = Array.from({ length: 90 }, (_, i) => {
      const t = Math.PI * 0.5 + (i / 89) * Math.PI * 6;
      return pt(G.x - 48 + 5.6 * (t - Math.PI * 0.5) - 14 * Math.sin(t), G.y - 18 * Math.cos(t) + 3 * Math.sin(t / 2));
    }).reverse();
    const ductStart = coil[0];
    const poreX = 470;
    const duct = [ductStart, pt(ductStart.x + 4, G.y - 36), pt(poreX - 4, 214), pt(poreX + 2, 170), pt(poreX - 2, epiY(poreX) + 2), pt(poreX + 6, (SURF + EPI) / 2 + 6), pt(poreX - 6, (SURF + EPI) / 2 - 6), pt(poreX, surfY(poreX))];
    const lumen = hot ? C.sweat : C.gland;
    tube(smoothOpen(coil), 13, lumen, "sweat-gland", "ink");
    tube(smoothOpen(duct), 11, lumen, "sweat-duct", "ink");
    // The pore: an opening in the surface.
    over.push({ t: "path", d: `M${poreX - 9} ${r2(surfY(poreX) - 1)} L${poreX + 9} ${r2(surfY(poreX) - 1)}`, stroke: hot ? C.sweat : C.gland, width: 4, fill: "none", part: "sweat-pore" });
    over.push({ t: "path", d: `M${poreX - 12} ${r2(surfY(poreX) - 3)} Q${poreX - 6} ${r2(surfY(poreX) + 2)} ${poreX - 5} ${r2(surfY(poreX) + 6)} M${poreX + 12} ${r2(surfY(poreX) - 3)} Q${poreX + 6} ${r2(surfY(poreX) + 2)} ${poreX + 5} ${r2(surfY(poreX) + 6)}`, stroke: "ink", width: 2, fill: "none", part: "sweat-pore" });
    parts.push({ id: "sweat-gland", name: "Sweat gland", anchor: pt(G.x + 31, G.y + 17) }, { id: "sweat-duct", name: "Sweat duct", anchor: pt(poreX - 3, 214) }, { id: "sweat-pore", name: "Sweat pore", anchor: pt(poreX, surfY(poreX) + 1) });
    if (hot) {
      // Sweat on the surface, about to evaporate.
      for (const [dx, k] of [[0, 1.5], [-30, 1.2], [30, 1.1]] as const) {
        const cx = poreX + dx, cy = surfY(poreX + dx) - 3 - 8 * k;
        over.push({ t: "path", d: `M${r2(cx)} ${r2(cy - 12 * k)} C${r2(cx + 7 * k)} ${r2(cy - 2 * k)} ${r2(cx + 8 * k)} ${r2(cy + 8 * k)} ${r2(cx)} ${r2(cy + 8 * k)} C${r2(cx - 8 * k)} ${r2(cy + 8 * k)} ${r2(cx - 7 * k)} ${r2(cy - 2 * k)} ${r2(cx)} ${r2(cy - 12 * k)} Z`, fill: C.sweat, stroke: C.sweatLine, width: 1.8, part: "sweat" });
      }
      parts.push({ id: "sweat", name: "Sweat", anchor: pt(poreX + 30, surfY(poreX + 30) - 12) });
    }

    // ── Blood supply: arteriole up to the capillary loop, venule down; the shunt vessel between. ──
    const ax = 556, vx = 640, shuntY = 252, loopTop = EPI + 14;
    const wUpper = hot ? 17 : cold ? 6.5 : 12;
    const wLoop = hot ? 11 : cold ? 4.4 : 8;
    const wShunt = hot ? 5 : cold ? 15 : 9;
    tube(`M${ax} ${BASE} L${ax} ${shuntY}`, 14, C.arteryFill, "arteriole", C.artery);
    tube(`M${ax} ${shuntY} L${ax} ${loopTop + 22}`, wUpper, C.arteryFill, "arteriole", C.artery);
    tube(`M${ax} ${loopTop + 24} C${ax} ${loopTop} ${ax + 12} ${loopTop - 6} ${(ax + vx) / 2} ${loopTop - 6} C${vx - 12} ${loopTop - 6} ${vx} ${loopTop} ${vx} ${loopTop + 24}`, wLoop, cold ? "#fecdd3" : C.arteryFill, "capillaries", C.artery);
    tube(`M${vx} ${loopTop + 22} L${vx} ${BASE}`, 14, C.veinFill, "venule", C.vein);
    tube(`M${ax} ${shuntY} L${vx} ${shuntY}`, wShunt, C.arteryFill, "shunt-vessel", C.artery);
    // Flow: small arrowheads up the arteriole and down the venule.
    over.push({ t: "path", d: arrowHead(pt(ax, 300), pt(ax, 320), 11), fill: C.artery, stroke: C.artery, width: 1, part: "arteriole" });
    over.push({ t: "path", d: arrowHead(pt(vx, 320), pt(vx, 300), 11), fill: C.vein, stroke: C.vein, width: 1, part: "venule" });
    parts.push(
      { id: "capillaries", name: "Capillaries", anchor: pt((ax + vx) / 2, loopTop - 6) },
      { id: "arteriole", name: "Arteriole", anchor: pt(ax, 200) },
      { id: "shunt-vessel", name: "Shunt vessel", anchor: pt((ax + vx) / 2, shuntY) },
      { id: "venule", name: "Venule", anchor: pt(vx, 300) },
    );

    // ── Responses outside the skin. ──
    if (hot) {
      // Heat radiating away from the warm surface (over the dilated capillaries and the sweat).
      let mid: Pt = pt(0, 0);
      for (const x0 of [574, 622, 670]) {
        const pts = Array.from({ length: 7 }, (_, i) => pt(x0 - 14 + (i % 2 ? 7 : -7), SURF - 10 - i * 10));
        if (x0 === 622) mid = pts[3];
        const end = pts[pts.length - 1];
        over.push(...thinLine(pts.slice(0, -1), { stroke: C.heat, width: 2.4, part: "heat-loss" }, 5));
        over.push({ t: "path", d: arrowHead(pt(end.x, end.y - 4), pts[pts.length - 2], 12), fill: C.heat, stroke: C.heat, width: 1, part: "heat-loss" });
      }
      parts.push({ id: "heat-loss", name: "Heat lost by radiation", anchor: mid });
    }
    if (cold) {
      // Skeletal muscle under the skin, contracting rapidly.
      const top = BASE + 6, bot = H - 6;
      over.push({ t: "path", d: `M20 ${top} H${W - 20} V${bot} H20 Z`, fill: C.muscle, stroke: "ink", width: 2, part: "shivering" });
      for (let i = 0; i < 3; i++) over.push({ t: "path", d: `M30 ${top + 8 + i * 8} H${W - 30}`, stroke: C.artery, width: 1.2, opacity: 0.5, fill: "none", part: "shivering" });
      for (const x of [200, 380, 560]) {
        const zig = Array.from({ length: 7 }, (_, i) => `${x + i * 6} ${(top + bot) / 2 + (i % 2 ? -7 : 7)}`).join(" L");
        over.push({ t: "path", d: `M${zig}`, stroke: "ink", width: 2, fill: "none", part: "shivering" });
      }
      parts.push({ id: "shivering", name: "Shivering muscles", anchor: pt(120, (top + bot) / 2) });
    }

    const order = skinSection.parts.map((p) => p.id);
    parts.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
    return { w: W, h: H, shapes: [...back, ...walls, ...lumens, ...over], parts };
  },
};

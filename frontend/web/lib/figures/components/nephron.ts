import type { FigureComponent, FigurePart, FigureParams, FigureShape, Ink, Pt } from "../types";
import { arrowShapes, r2, smoothOpen } from "./bioDraw";

/**
 * A NEPHRON WITH ITS BLOOD SUPPLY, as the O/A Level textbooks draw it: the renal corpuscle
 * (glomerulus in Bowman's capsule) and both convoluted tubules in the cortex, the loop of Henle
 * dipping into the medulla, the collecting duct running down through the medulla, the afferent
 * arteriole (wider) and efferent arteriole (narrower) at the capsule's vascular pole, and the
 * peritubular capillaries winding round the tubule. The tubule is one continuous tube (ink walls,
 * a filtrate-coloured lumen) from the capsule to the collecting duct, so the route of the filtrate
 * reads at a glance. Optional process arrows: ultrafiltration, selective and water reabsorption.
 */

type Processes = "none" | "ultrafiltration" | "reabsorption" | "all";

function processesOf(v: unknown): Processes {
  const s = String(v ?? "").toLowerCase();
  if (/\ball\b|\bboth\b|\bevery/.test(s)) return "all";
  if (/ultra|filtrat/.test(s) && /reabsor/.test(s)) return "all";
  if (/ultra|filtrat/.test(s)) return "ultrafiltration";
  if (/reabsor/.test(s)) return "reabsorption";
  return "none";
}

const C = {
  tubule: "#fde68a" as Ink,
  artery: "#be123c" as Ink,
  arteryFill: "#fda4af" as Ink,
  vein: "#1d4ed8" as Ink,
  veinFill: "#93c5fd" as Ink,
  glomFill: "#fecdd3" as Ink,
  cortex: "#fbcfe8" as Ink,
  medulla: "#f9a8d4" as Ink,
  filter: "#d97706" as Ink,
  reabsorb: "#16a34a" as Ink,
  water: "#0284c7" as Ink,
};

const W = 660, H = 460;
/** The cortex/medulla boundary. */
const BOUNDARY = 214;

const pt = (x: number, y: number): Pt => ({ x, y });
const polar = (c: Pt, r: number, deg: number): Pt => ({ x: c.x + r * Math.cos((deg * Math.PI) / 180), y: c.y + r * Math.sin((deg * Math.PI) / 180) });

/** Points along an arc (degrees, y down), for building smooth centrelines. */
function arcPts(c: Pt, r: number, from: number, to: number, n: number): Pt[] {
  return Array.from({ length: n + 1 }, (_, i) => polar(c, r, from + ((to - from) * i) / n));
}

/**
 * A smooth path cut into pieces of a few curve segments each (the same curve, exactly): a long
 * capillary as one shape has a bounding box over half the figure, which the label engine then
 * treats as an obstacle every leader crosses.
 */
function pieces(d: string, per = 2): string[] {
  const [head, ...segs] = d.split(" C");
  let at = head.slice(1);
  const out: string[] = [];
  for (let i = 0; i < segs.length; i += per) {
    const chunk = segs.slice(i, i + per);
    out.push(`M${at} C${chunk.join(" C")}`);
    const last = chunk[chunk.length - 1].trim().split(" ");
    at = last.slice(-2).join(" ");
  }
  return out;
}

/** The smooth curve through `pts`, re-sampled at about `step` units (so each piece of it is short). */
function resample(pts: Pt[], step: number): Pt[] {
  const d = smoothOpen(pts);
  const nums = (d.match(/-?\d*\.?\d+/g) ?? []).map(Number);
  // M x y, then (c1 c2 p) per segment: evaluate each cubic finely, then walk it at even spacing.
  const fine: Pt[] = [{ x: nums[0], y: nums[1] }];
  for (let i = 2; i + 5 < nums.length; i += 6) {
    const p0 = fine[fine.length - 1], c1 = { x: nums[i], y: nums[i + 1] }, c2 = { x: nums[i + 2], y: nums[i + 3] }, p3 = { x: nums[i + 4], y: nums[i + 5] };
    for (let k = 1; k <= 12; k++) {
      const t = k / 12, u = 1 - t;
      fine.push({ x: u * u * u * p0.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * p3.x, y: u * u * u * p0.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * p3.y });
    }
  }
  const out: Pt[] = [fine[0]];
  let acc = 0;
  for (let i = 1; i < fine.length; i++) {
    acc += Math.hypot(fine[i].x - fine[i - 1].x, fine[i].y - fine[i - 1].y);
    if (acc >= step || i === fine.length - 1) { out.push(fine[i]); acc = 0; }
  }
  return out;
}

/**
 * A thin line (a capillary, a nerve fibre) as the smooth curve through `route`, in short pieces:
 * crossing a thin line is normal for a textbook leader, so no piece should be big enough for the
 * label engine to count as an obstacle (it ignores boxes 6 units or less on a side).
 */
export function thinLine(route: Pt[], style: { stroke: Ink; width: number; part?: string; dash?: string; opacity?: number }, step = 7): FigureShape[] {
  return pieces(smoothOpen(resample(route, step)), 1).map((d) => ({ t: "path" as const, d, fill: "none" as const, ...style }));
}

export const nephron: FigureComponent = {
  name: "nephron",
  title: "A nephron and its blood supply: glomerulus in Bowman's capsule, proximal and distal convoluted tubules, loop of Henle, collecting duct, afferent and efferent arterioles and peritubular capillaries, across the cortex and medulla",
  params: `processes ("none" default | "ultrafiltration": arrows from the glomerulus into Bowman's capsule | "reabsorption": selective reabsorption from the proximal tubule and water reabsorption from the collecting duct | "all": every process plus urine leaving the collecting duct).`,
  match: /\bnephrons?\b|\bloop of Henle\b|\bBowman['’]?s capsule\b|\bglomerul(us|i|ar filtrat\w*)\b|\b(proximal|distal) convoluted tubules?\b|\bcollecting ducts?\b(?=[\s\S]{0,160}\b(ADH|water|urine|kidney|reabsor\w*)\b)|\bultrafiltration\b(?=[\s\S]{0,160}\b(kidney|renal|capsule|urine|filtrate)\b)|\bselective reabsorption\b|\b(afferent|efferent) arterioles?\b/i,
  parts: [
    { id: "glomerulus", name: "Glomerulus" },
    { id: "bowmans-capsule", name: "Bowman's capsule" },
    { id: "afferent-arteriole", name: "Afferent arteriole" },
    { id: "efferent-arteriole", name: "Efferent arteriole" },
    { id: "pct", name: "Proximal convoluted tubule" },
    { id: "loop-of-henle", name: "Loop of Henle" },
    { id: "dct", name: "Distal convoluted tubule" },
    { id: "collecting-duct", name: "Collecting duct" },
    { id: "peritubular-capillaries", name: "Peritubular capillaries" },
    { id: "descending-limb", name: "Descending limb" },
    { id: "ascending-limb", name: "Ascending limb" },
    { id: "venule", name: "Venule (to renal vein)" },
    { id: "cortex", name: "Cortex" },
    { id: "medulla", name: "Medulla" },
    { id: "ultrafiltration", name: "Ultrafiltration" },
    { id: "selective-reabsorption", name: "Selective reabsorption" },
    { id: "water-reabsorption", name: "Water reabsorption" },
    { id: "urine", name: "Urine to the renal pelvis" },
  ],
  build(params: FigureParams) {
    const processes = processesOf(params?.processes ?? params?.process ?? params?.show);
    const showFilter = processes === "ultrafiltration" || processes === "all";
    const showReabsorb = processes === "reabsorption" || processes === "all";

    const back: FigureShape[] = [];
    const walls: FigureShape[] = [];
    const lumens: FigureShape[] = [];
    const over: FigureShape[] = [];
    const parts: FigurePart[] = [];
    const tube = (d: string, outer: number, fill: Ink, part: string, edge: Ink = "ink", inner = outer - 4.4) => {
      walls.push({ t: "path", d, stroke: edge, width: outer, fill: "none", part });
      lumens.push({ t: "path", d, stroke: fill, width: inner, fill: "none", part });
    };

    // Cortex above, medulla below, with the boundary dashed between them.
    back.push({ t: "path", d: `M0 0 H${W} V${BOUNDARY} H0 Z`, fill: C.cortex, stroke: "none", opacity: 0.2, part: "cortex" });
    back.push({ t: "path", d: `M0 ${BOUNDARY} H${W} V${H} H0 Z`, fill: C.medulla, stroke: "none", opacity: 0.26, part: "medulla" });
    back.push({ t: "path", d: `M0 ${BOUNDARY} H${W}`, stroke: "muted", width: 1.8, dash: "9 7", fill: "none" });
    parts.push({ id: "cortex", name: "Cortex", anchor: pt(40, 196) }, { id: "medulla", name: "Medulla", anchor: pt(40, 236) });

    // ── The renal corpuscle: a cup (Bowman's capsule) open at the top for the arterioles. ──
    const G = pt(160, 112);
    const cupR = 46;
    const cup = smoothOpen(arcPts(G, cupR, -45, 225, 24));
    tube(cup, 22, C.tubule, "bowmans-capsule");

    // ── The tubule, one continuous centreline: capsule → PCT → loop → DCT → collecting duct. ──
    const start = polar(G, cupR, 30);
    const pctPts = [start, pt(214, 150), pt(232, 176), pt(258, 182), pt(270, 158), pt(262, 128), pt(276, 100), pt(302, 98), pt(312, 124), pt(306, 150), pt(316, 176), pt(340, 182), pt(352, 160)];
    const descX = 356, ascX = 400, loopBottom = 404;
    const loopC = pt((descX + ascX) / 2, loopBottom);
    const descPts = [pt(352, 160), pt(descX, 200), pt(descX, loopBottom - 30), pt(descX, loopBottom)];
    const bend = arcPts(loopC, (ascX - descX) / 2, 180, 0, 10);
    const ascPts = [pt(ascX, loopBottom), pt(ascX, loopBottom - 30), pt(ascX, 200), pt(ascX, 168)];
    const dctPts = [pt(ascX, 168), pt(404, 140), pt(424, 120), pt(452, 124), pt(458, 150), pt(482, 166), pt(506, 150), pt(500, 122), pt(512, 96), pt(540, 92), pt(566, 104)];
    const cdX = 590;
    // It runs on down to the renal pelvis; with "all" it stops short so the urine leaving it shows.
    const cdPts = [pt(cdX, 0), pt(cdX, 60), pt(cdX + 2, 200), pt(cdX + 4, processes === "all" ? 396 : H)];

    // Peritubular capillaries first, so the tubule's walls stand in front of them: from the efferent
    // arteriole over the proximal tubule, down beside the loop (vasa recta), up round the distal
    // tubule and into the venule; a second vessel runs under the proximal tubule, with cross-links.
    const capR = (ascX - descX) / 2 + 24;
    const capMain = [pt(214, 34), pt(244, 52), pt(284, 64), pt(322, 70), pt(334, 98), pt(330, 132), pt(332, 196), pt(332, 300), pt(332, loopBottom), ...arcPts(loopC, capR, 180, 0, 10).slice(1, -1), pt(424, loopBottom), pt(424, 300), pt(424, 206), pt(452, 194), pt(492, 194), pt(526, 172), pt(532, 132), pt(532, 92), pt(520, 64), pt(494, 48), pt(476, 30), pt(470, 14)];
    const vessel = (route: Pt[], width = 2.2) => {
      back.push(...thinLine(route, { stroke: C.artery, width, part: "peritubular-capillaries" }));
    };
    vessel(capMain);
    vessel([pt(244, 52), pt(232, 92), pt(234, 128), pt(250, 150)], 1.8);
    vessel([pt(284, 64), pt(289, 96), pt(288, 130), pt(286, 156)], 1.8);
    vessel([pt(332, 216), pt(300, 206), pt(280, 206), pt(250, 214)], 1.8);
    vessel([pt(452, 194), pt(438, 168), pt(440, 146)], 1.8);
    vessel([pt(526, 172), pt(498, 186)], 1.8);
    parts.push({ id: "peritubular-capillaries", name: "Peritubular capillaries", anchor: polar(loopC, capR, 90) });

    // Drawn as segments so each section is its own part (one stroke per section, joined end to end).
    const seg = (pts: Pt[]) => smoothOpen(pts, 1);
    tube(seg(pctPts), 18, C.tubule, "pct");
    tube(seg(descPts), 16, C.tubule, "descending-limb");
    tube(seg([pt(descX, loopBottom - 1), ...bend, pt(ascX, loopBottom - 1)]), 16, C.tubule, "loop-of-henle");
    tube(seg(ascPts), 18, C.tubule, "ascending-limb");
    tube(seg(dctPts), 18, C.tubule, "dct");
    // The collecting duct: wider, receiving other nephrons' tubules from above.
    tube(seg(cdPts), 26, C.tubule, "collecting-duct");
    tube(seg([pt(566, 104), pt(578, 110), pt(cdX, 112)]), 18, C.tubule, "dct");

    parts.push(
      { id: "pct", name: "Proximal convoluted tubule", anchor: pctPts[2] },
      { id: "descending-limb", name: "Descending limb", anchor: pt(descX, 300) },
      { id: "ascending-limb", name: "Ascending limb", anchor: pt(ascX, 290) },
      { id: "loop-of-henle", name: "Loop of Henle", anchor: polar(loopC, (ascX - descX) / 2, 90) },
      { id: "dct", name: "Distal convoluted tubule", anchor: pt(482, 166) },
      { id: "collecting-duct", name: "Collecting duct", anchor: pt(cdX + 3, 300) },
      { id: "bowmans-capsule", name: "Bowman's capsule", anchor: polar(G, cupR, 140) },
    );

    // ── Blood in and out of the glomerulus. ──
    const aff = smoothOpen([pt(0, 44), pt(60, 44), pt(110, 48), pt(134, 66), pt(146, 88)]);
    const eff = smoothOpen([pt(172, 88), pt(182, 62), pt(198, 42), pt(214, 34)]);
    tube(aff, 16, C.arteryFill, "afferent-arteriole", C.artery, 11);
    tube(eff, 11, C.arteryFill, "efferent-arteriole", C.artery, 6.6);
    parts.push({ id: "afferent-arteriole", name: "Afferent arteriole", anchor: pt(60, 44) }, { id: "efferent-arteriole", name: "Efferent arteriole", anchor: pt(198, 42) });
    // The venule collecting the capillaries, away to the renal vein.
    // The venule collecting the capillaries runs back beside the arterioles, out to the renal vein.
    tube(smoothOpen([pt(470, 14), pt(440, 12), pt(300, 12), pt(0, 12)]), 12, C.veinFill, "venule", C.vein, 7.6);
    parts.push({ id: "venule", name: "Venule (to renal vein)", anchor: pt(120, 12) });

    // The glomerulus: a knot of capillary loops filling the cup (a looping rosette round a soft core).
    over.push({ t: "circle", cx: G.x, cy: G.y + 3, r: 30, fill: C.glomFill, stroke: "none", part: "glomerulus" });
    const knot = Array.from({ length: 181 }, (_, i) => {
      const t = (i / 180) * Math.PI * 2;
      return { x: G.x + 17 * Math.cos(t) + 10 * Math.cos(7 * t) + 3 * Math.sin(3 * t), y: G.y + 3 + 17 * Math.sin(t) - 10 * Math.sin(7 * t) + 3 * Math.cos(2 * t) };
    });
    over.push({ t: "path", d: `M${knot.map((p) => `${r2(p.x)} ${r2(p.y)}`).join(" L")} Z`, fill: "none", stroke: C.artery, width: 2, part: "glomerulus" });
    parts.push({ id: "glomerulus", name: "Glomerulus", anchor: pt(G.x - 19, G.y + 3) });

    // ── Process arrows. ──
    if (showFilter) {
      // Filtrate forced out of the glomerulus into the capsule's space.
      for (const deg of [160, 115, 65, 20]) over.push(...arrowShapes(polar(G, 6, deg), polar(G, 41, deg), C.filter, 3, "ultrafiltration", { head: 12 }));
      parts.push({ id: "ultrafiltration", name: "Ultrafiltration", anchor: polar(G, 30, 115) });
    }
    if (showReabsorb) {
      // From the proximal tubule into the capillaries round it (glucose, amino acids, ions, water).
      for (const [a, b] of [[pt(276, 92), pt(266, 58)], [pt(302, 90), pt(312, 58)], [pt(258, 190), pt(266, 222)], [pt(305, 124), pt(278, 118)]] as const) over.push(...arrowShapes(a, b, C.reabsorb, 3, "selective-reabsorption", { head: 12 }));
      parts.push({ id: "selective-reabsorption", name: "Selective reabsorption", anchor: pt(307, 74) });
      // Water out of the collecting duct into the medulla (more of it with ADH).
      for (const y of [270, 330, 390]) over.push(...arrowShapes(pt(cdX - 16, y), pt(cdX - 62, y), C.water, 3, "water-reabsorption", { head: 12 }));
      over.push({ t: "text", x: cdX - 70, y: 306, text: "H₂O", size: 17, anchor: "end", fill: C.water, part: "water-reabsorption" });
      over.push({ t: "text", x: cdX - 70, y: 366, text: "H₂O", size: 17, anchor: "end", fill: C.water, part: "water-reabsorption" });
      parts.push({ id: "water-reabsorption", name: "Water reabsorption", anchor: pt(cdX - 40, 330) });
    }
    if (processes === "all") {
      over.push(...arrowShapes(pt(cdX + 4, 404), pt(cdX + 4, 456), "#c2410c", 3.2, "urine", { head: 13 }));
      parts.push({ id: "urine", name: "Urine to the renal pelvis", anchor: pt(cdX + 4, 426) });
    }

    // Labels in a sensible teaching order: the corpuscle, then the filtrate's route, then the blood.
    const order = nephron.parts.map((p) => p.id);
    parts.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
    return { w: W, h: H, shapes: [...back, ...walls, ...lumens, ...over], parts };
  },
};

import { solutionColour } from "../colours";
import type { FigureComponent, FigureParams, FigurePart, FigureShape, Pt } from "../types";
import { GLASS_W, shiftDrawing, beaker, bunsen, clipBelow, dots, flag, gauze, mat, oneOf, poly, r1, rotate, solidColour, surface, text, tripod, num, type Flame } from "./apparatusKit";

const VESSELS = ["beaker", "evaporating-basin", "crucible", "test-tube"] as const;
type Vessel = (typeof VESSELS)[number];

function vessel(v: unknown): Vessel {
  const s = String(v ?? "").toLowerCase();
  if (/basin|dish|evaporat/.test(s)) return "evaporating-basin";
  if (/crucible/.test(s)) return "crucible";
  if (/test[- ]?tube|boiling tube/.test(s)) return "test-tube";
  return oneOf(v, VESSELS, "beaker");
}

/**
 * Heating with a Bunsen burner on a heat-proof mat, as O Level / IGCSE books draw it: air hole open
 * for the hot blue (roaring) flame, closed for the yellow (luminous) flame. A beaker or evaporating
 * basin stands on a gauze on a tripod; a crucible sits in a pipe-clay triangle on the tripod; a test
 * tube is held in a clamp at an angle, its mouth pointing away.
 */
export const heating: FigureComponent = {
  name: "heating",
  title: "Heating with a Bunsen burner: burner with air hole and flame on a heat-proof mat; tripod with gauze (beaker, evaporating basin) or pipe-clay triangle (crucible), or a clamped test tube",
  params: `vessel ("beaker" default | "evaporating-basin" | "crucible" | "test-tube"), contents (what is being heated, e.g. "copper sulfate solution", "magnesium ribbon"), contentsColour (colour name: colourless, blue, pale blue, green, white, grey, black, sand…; liquids for beaker/basin/test tube, a solid for a crucible), flame ("blue" = air hole open, default | "yellow" = air hole closed), level (0-1, how full; default 0.45), boiling (true: bubbles in the liquid), crystals (true: crystals at the edge of an evaporating basin), lid (crucible lid; default true). Parts "stand" and "rest" are the tripod and gauze (pipe-clay triangle for a crucible; clamp stand and clamp for a test tube).`,
  match: /\bbunsen\b|\bpipe[- ]clay triangle\b|\bcrucible\b|\bevaporating (basin|dish)\b|\bheat[- ]proof mat\b|\bair hole\b|\b(luminous|non-luminous|roaring) flame\b|\b(tripod|gauze)\b(?=.*\b(heat\w*|bunsen|beaker|flame)\b)/i,
  parts: [
    { id: "bunsen", name: "Bunsen burner" },
    { id: "air-hole", name: "Air hole" },
    { id: "flame", name: "Flame" },
    { id: "stand", name: "Tripod (clamp stand for a test tube)" },
    { id: "rest", name: "Gauze (pipe-clay triangle for a crucible; clamp for a test tube)" },
    { id: "vessel", name: "Beaker / evaporating basin / crucible / test tube" },
    { id: "contents", name: "Contents" },
    { id: "mat", name: "Heat-proof mat" },
  ],
  build(params: FigureParams) {
    const v = vessel(params.vessel);
    const flame: Flame = oneOf(params.flame, ["blue", "yellow"] as const, "blue");
    const contentsName = text(params.contents, v === "crucible" ? "Solid" : "Solution");
    const isSolid = v === "crucible";
    const colour = isSolid ? solidColour(params.contentsColour, "grey") : solutionColour(params.contentsColour, "pale blue");
    const level = num(params.level, 0.45, 0.1, 0.85);
    const boiling = flag(params.boiling, false);
    const shapes: FigureShape[] = [];

    const cx = 200, matY = 404, baseY = matY, barrelTop = baseY - 84;
    const W = 400;
    let top = 0; // the highest thing drawn; the figure is cropped to it
    const ids = { burner: "bunsen", airHole: "air-hole", flame: "flame" };
    const matAt = mat(shapes, "mat", cx - (v === "test-tube" ? 40 : 0), matY, v === "test-tube" ? 150 : 130);
    let standAt: Pt, restAt: Pt, vesselAt: Pt, contentsAt: Pt;
    let standName = "Tripod", restName = "Gauze", vesselName = "Beaker";
    let flameTop: number;

    if (v === "test-tube") {
      standName = "Clamp stand";
      restName = "Clamp";
      vesselName = "Test tube";
      flameTop = barrelTop - (flame === "blue" ? 46 : 62);
      // Tube at 50° from the horizontal, its bottom just above the tip of the inner blue cone.
      const bottom: Pt = { x: cx + 4, y: flameTop + 4 };
      const len = 190, half = 13, ang = 50;
      // Built upright (bottom at the origin, mouth straight up), then turned so the mouth points up-left.
      const arc: Pt[] = [];
      for (let i = 0; i <= 12; i++) { const a = Math.PI * (i / 12); arc.push({ x: bottom.x + half * Math.cos(a), y: bottom.y - half + half * Math.sin(a) }); }
      const upright = [{ x: bottom.x + half, y: bottom.y - len }, ...arc, { x: bottom.x - half, y: bottom.y - len }];
      const tube = rotate(upright, bottom, -(90 - ang));
      const innerUp = [{ x: bottom.x + half - 1.5, y: bottom.y - len }, ...arc.map((p) => ({ x: bottom.x + (p.x - bottom.x) * 0.88, y: bottom.y - half + (p.y - (bottom.y - half)) * 0.88 })), { x: bottom.x - half + 1.5, y: bottom.y - len }];
      const inner = rotate(innerUp, bottom, -(90 - ang));
      const lowest = Math.max(...inner.map((p) => p.y)), highest = Math.min(...inner.map((p) => p.y));
      const surfaceY = lowest - (lowest - highest) * level * 0.5;
      const pool = clipBelow(inner, surfaceY);
      if (pool.length >= 3) {
        shapes.push({ t: "path", part: "contents", d: poly(pool), fill: colour, stroke: "none", opacity: 0.85 });
        const xs = pool.filter((p) => Math.abs(p.y - surfaceY) < 0.01).map((p) => p.x);
        if (xs.length >= 2) shapes.push({ t: "path", part: "contents", d: `M${r1(Math.min(...xs))} ${r1(surfaceY)} H${r1(Math.max(...xs))}`, stroke: "ink", width: 1.3, fill: "none" });
        contentsAt = { x: pool.reduce((t, p) => t + p.x, 0) / pool.length, y: pool.reduce((t, p) => t + p.y, 0) / pool.length };
        if (boiling) dots(shapes, "contents", [{ x: contentsAt.x - 4, y: contentsAt.y + 4 }, { x: contentsAt.x + 6, y: contentsAt.y - 2 }], 2.2, "none", "ink", 1);
      } else contentsAt = { x: bottom.x, y: bottom.y - 6 };
      shapes.push({ t: "path", part: "vessel", d: poly(tube, false), stroke: "ink", width: GLASS_W, fill: "none" });
      // Clamp stand and clamp gripping the tube near its mouth.
      const sx = 44;
      shapes.push({ t: "path", part: "stand", d: `M${sx - 26} ${matY - 10} h96 v10 h-96 z`, fill: "metal", stroke: "ink", width: 2 });
      shapes.push({ t: "path", part: "stand", d: `M${sx - 4} 40 h8 v${matY - 50} h-8 z`, fill: "metal", stroke: "ink", width: 2 });
      const grip = rotate([{ x: bottom.x, y: bottom.y - len * 0.78 }], bottom, -(90 - ang))[0];
      const jaw = rotate([{ x: bottom.x - half - 6, y: bottom.y - len * 0.78 - 9 }, { x: bottom.x + half + 6, y: bottom.y - len * 0.78 - 9 }, { x: bottom.x + half + 6, y: bottom.y - len * 0.78 + 9 }, { x: bottom.x - half - 6, y: bottom.y - len * 0.78 + 9 }], bottom, -(90 - ang));
      shapes.push({ t: "path", part: "rest", d: `M${sx - 6} ${r1(grip.y - 9)} h16 v18 h-16 z`, fill: "metal", stroke: "ink", width: 2 });
      shapes.push({ t: "path", part: "rest", d: `M${sx + 10} ${r1(grip.y)} H${r1(grip.x - 18)}`, stroke: "ink", width: 3, fill: "none" });
      shapes.push({ t: "path", part: "rest", d: poly(jaw), fill: "wood", stroke: "ink", width: 1.6, opacity: 0.9 });
      shapes.push({ t: "path", part: "vessel", d: poly(rotate([{ x: bottom.x - half, y: bottom.y - len * 0.78 - 9 }, { x: bottom.x + half, y: bottom.y - len * 0.78 - 9 }, { x: bottom.x + half, y: bottom.y - len * 0.78 + 9 }, { x: bottom.x - half, y: bottom.y - len * 0.78 + 9 }], bottom, -(90 - ang)), false), stroke: "ink", width: 1, fill: "none", opacity: 0.35 });
      standAt = { x: sx - 4, y: Math.min(grip.y + 60, matY - 60) };
      restAt = { x: sx - 6, y: grip.y };
      top = 30;
      const wallPt = rotate([{ x: bottom.x + half, y: bottom.y - len * 0.45 }], bottom, -(90 - ang))[0];
      vesselAt = wallPt;
    } else {
      const gauzeY = 266;
      const tripodAt = tripod(shapes, "stand", cx, gauzeY, matY, 64);
      standAt = { x: cx + 64 + 14 * 0.6, y: gauzeY + 6 + (matY - gauzeY - 6) * 0.6 };
      void tripodAt;
      if (v === "crucible") {
        restName = "Pipe-clay triangle";
        vesselName = "Crucible";
        // Pipe-clay triangle seen side-on: wire with clay sleeves; the crucible sits down inside it.
        shapes.push({ t: "path", part: "rest", d: `M${cx - 86} ${gauzeY - 2} H${cx + 86}`, stroke: "ink", width: 2, fill: "none" });
        for (const x of [cx - 70, cx + 26]) shapes.push({ t: "path", part: "rest", d: `M${x} ${gauzeY - 7} h44 v10 h-44 z`, fill: "paper", stroke: "ink", width: 1.6 });
        const ctop = gauzeY - 66, bot = gauzeY + 14, th = 40, bh = 24;
        top = ctop - 30;
        flameTop = bot + 6;
        const wall = (y: number, side: -1 | 1) => cx + side * (bh + ((bot - y) / (bot - ctop)) * (th - bh));
        const fill = bot - (bot - ctop) * level;
        shapes.push({ t: "path", part: "contents", d: poly([{ x: wall(fill, -1) + 2, y: fill }, { x: wall(fill, 1) - 2, y: fill }, { x: wall(bot - 2, 1) - 2, y: bot - 2 }, { x: wall(bot - 2, -1) + 2, y: bot - 2 }]), fill: colour, stroke: "ink", width: 1.2 });
        shapes.push({ t: "path", part: "vessel", d: `M${cx - th} ${ctop} L${cx - bh} ${bot} H${cx + bh} L${cx + th} ${ctop}`, fill: "none", stroke: "ink", width: GLASS_W });
        if (flag(params.lid, true)) shapes.push({ t: "path", part: "vessel", d: `M${cx - th - 6} ${ctop - 9} Q${cx} ${ctop - 15} ${cx + th + 8} ${ctop - 4} L${cx + th + 8} ${ctop + 1} Q${cx} ${ctop - 9} ${cx - th - 6} ${ctop - 4} Z`, fill: "paper", stroke: "ink", width: 1.8 });
        restAt = { x: cx + 66, y: gauzeY - 2 };
        vesselAt = { x: wall(ctop + 22, 1), y: ctop + 22 };
        contentsAt = { x: cx - 10, y: (fill + bot) / 2 };
      } else {
        gauze(shapes, "rest", cx, gauzeY, 84);
        restAt = { x: cx + 76, y: gauzeY - 2 };
        flameTop = gauzeY + 6;
        if (v === "beaker") {
          const base = gauzeY - 4, btop = base - 128, half = 54;
          top = btop - 12;
          const b = beaker(cx, btop, base, half);
          const lv = base - (base - btop - 10) * level;
          shapes.push({ t: "path", part: "contents", d: b.liquid(lv), fill: colour, stroke: "none", opacity: 0.85 });
          shapes.push({ t: "path", part: "contents", d: surface(cx - half + 1.5, cx + half - 1.5, lv), stroke: "ink", width: 1.4, fill: "none" });
          if (boiling) dots(shapes, "contents", [{ x: cx - 20, y: base - 14 }, { x: cx + 12, y: base - 26 }, { x: cx - 4, y: (lv + base) / 2 }, { x: cx + 26, y: lv + 12 }], 3, "none", "ink", 1.1);
          shapes.push({ t: "path", part: "vessel", d: b.outline, stroke: "ink", width: GLASS_W, fill: "none" });
          vesselAt = { x: cx + half, y: btop + 24 };
          contentsAt = { x: cx - half + 22, y: (lv + base) / 2 + 4 };
        } else {
          vesselName = "Evaporating basin";
          const rim = gauzeY - 4 - 46, base = gauzeY - 4, half = 80;
          top = rim - 24;
          // Shallow bowl: a cubic from the rim down to a small flat foot resting on the gauze.
          const curve = (side: -1 | 1, inset: number) => {
            const pts: Pt[] = [];
            const p0 = { x: cx + side * (half - inset), y: rim }, p1 = { x: cx + side * (half - 8 - inset), y: base - 12 }, p2 = { x: cx + side * (54 - inset), y: base - inset }, p3 = { x: cx + side * 16, y: base - inset };
            for (let i = 0; i <= 16; i++) {
              const t = i / 16, u = 1 - t;
              pts.push({ x: u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x, y: u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y });
            }
            return pts;
          };
          const outer = [...curve(-1, 0), ...curve(1, 0).reverse()];
          const inner = [...curve(-1, 2), ...curve(1, 2).reverse()];
          const lv = base - (base - rim) * level * 0.9;
          const pool = clipBelow(inner, lv);
          const xs = pool.filter((p) => Math.abs(p.y - lv) < 0.01).map((p) => p.x);
          const l = Math.min(...xs), r = Math.max(...xs);
          shapes.push({ t: "path", part: "contents", d: poly(pool), fill: colour, stroke: "none", opacity: 0.85 });
          shapes.push({ t: "path", part: "contents", d: surface(l, r, lv), stroke: "ink", width: 1.4, fill: "none" });
          if (flag(params.crystals, false)) for (const x of [l + 5, l + 15, r - 13, r - 23]) shapes.push({ t: "path", part: "contents", d: `M${r1(x)} ${r1(lv - 3)} l4 -5 l4 5 l-4 5 z`, fill: "paper", stroke: "ink", width: 1 });
          if (boiling) dots(shapes, "contents", [{ x: cx - 14, y: base - 8 }, { x: cx + 16, y: base - 10 }], 2.4, "none", "ink", 1);
          shapes.push({ t: "path", part: "vessel", d: poly(outer, false), stroke: "ink", width: GLASS_W, fill: "none" });
          shapes.push({ t: "path", part: "vessel", d: `M${cx + half} ${rim} q7 -1 11 -7`, stroke: "ink", width: GLASS_W, fill: "none" });
          contentsAt = { x: l + 26, y: (lv + base) / 2 };
          vesselAt = { x: cx + half - 3, y: rim + 14 };
        }
      }
    }

    const b = bunsen(shapes, ids, cx, baseY, barrelTop, flame, flameTop);
    // Text marks for the air hole: none; its state shows as an open (dark) or closed window.
    const parts: FigurePart[] = [
      { id: "bunsen", name: "Bunsen burner", anchor: b.burner },
      { id: "air-hole", name: flame === "blue" ? "Air hole (open)" : "Air hole (closed)", anchor: b.airHole },
      { id: "flame", name: flame === "blue" ? "Blue (roaring) flame" : "Yellow (luminous) flame", anchor: { x: cx - 6, y: (barrelTop + flameTop) / 2 + 4 } },
      { id: "stand", name: standName, anchor: standAt },
      { id: "rest", name: restName, anchor: restAt },
      { id: "vessel", name: vesselName, anchor: vesselAt },
      { id: "contents", name: contentsName, anchor: contentsAt },
      { id: "mat", name: "Heat-proof mat", anchor: matAt },
    ];
    for (const p of parts) p.anchor = { x: r1(p.anchor.x), y: r1(p.anchor.y) };
    shiftDrawing(shapes, parts, 0, -top);
    return { w: W, h: Math.round(matY + 16 - top), shapes, parts };
  },
};

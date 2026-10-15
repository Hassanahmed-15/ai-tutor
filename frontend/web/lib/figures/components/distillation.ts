import { solutionColour } from "../colours";
import type { FigureComponent, FigureParams, FigurePart, FigureShape, Pt } from "../types";
import { GLASS_W, P, add, arrow, bunsen, conicalFlask, dots, flag, gauze, mat, num, oneOf, poly, r1, surface, text, tripod, tubeWalls } from "./apparatusKit";

const TYPES = ["simple", "fractional"] as const;
const HEATS = ["bunsen", "arrow"] as const;

/**
 * Simple or fractional distillation, drawn the way O Level / IGCSE books draw it: round-bottomed
 * flask (with anti-bumping granules) heated on a tripod and gauze, a fractionating column packed with
 * glass beads (fractional only), a thermometer whose bulb sits level with the side arm, a Liebig
 * condenser sloping down with cooling water IN at the lower end and OUT at the upper end, and a
 * conical-flask receiver collecting the distillate.
 */
export const distillation: FigureComponent = {
  name: "distillation",
  title: "Distillation apparatus (simple or fractional): round-bottomed flask, thermometer at the side arm, Liebig condenser with water in at the bottom and out at the top, receiver",
  params: `type ("simple" | "fractional"; default simple — fractional adds a column packed with glass beads), mixture (what is in the flask, e.g. "salt solution", "ethanol and water"), distillate (what collects, e.g. "pure water", "ethanol"), mixtureColour and distillateColour (colour names: colourless, blue, pale blue, green, orange, red…; default colourless), heat ("bunsen" = Bunsen on tripod and gauze, default | "arrow" = a plain heat arrow), granules (false hides the anti-bumping granules; default true), distillateLevel (0-1, default 0.3)`,
  match: /\b(simple|fractional) distillation\b|\bdistillation\b|\bfractionating column\b|\bliebig\b|\bcondenser\b(?!.*\b(capacitor|electric)\b)/i,
  parts: [
    { id: "round-bottom-flask", name: "Round-bottomed flask" },
    { id: "mixture", name: "Mixture" },
    { id: "anti-bumping-granules", name: "Anti-bumping granules" },
    { id: "fractionating-column", name: "Fractionating column (still head in simple distillation)" },
    { id: "thermometer", name: "Thermometer" },
    { id: "condenser", name: "Condenser" },
    { id: "water-in", name: "Water in" },
    { id: "water-out", name: "Water out" },
    { id: "receiver", name: "Conical flask (receiver)" },
    { id: "distillate", name: "Distillate" },
    { id: "heat", name: "Heat" },
  ],
  build(params: FigureParams) {
    const type = oneOf(params.type, TYPES, "simple");
    const heat = oneOf(params.heat, HEATS, "bunsen");
    const fractional = type === "fractional";
    const mixtureName = text(params.mixture, fractional ? "Mixture of liquids" : "Mixture");
    const distillateName = text(params.distillate, "Distillate");
    const mixColour = solutionColour(params.mixtureColour, "colourless");
    const distColour = solutionColour(params.distillateColour, "colourless");
    const showGranules = flag(params.granules, true);
    const distLevel = num(params.distillateLevel, 0.3, 0.08, 0.8);
    const shapes: FigureShape[] = [];

    // ---- Vertical stack, from the thermometer down to the bench.
    const cx = 110, n = 13, r = 64, cn = 17;
    const thermTop = 14, bungTop = 46, bungBottom = 62, sideY = 104;
    const colTop = sideY + 26, colBottom = colTop + 150;
    const neckTop = fractional ? colBottom : sideY + 30;
    const joinY = neckTop + 28;
    const cy = joinY + Math.sqrt(r * r - n * n);
    const gauzeY = cy + r;

    // ---- Condenser geometry: along a line sloping down at 25° from the side arm.
    const deg = fractional ? 30 : 25, c = Math.cos((deg * Math.PI) / 180), s = Math.sin((deg * Math.PI) / 180);
    const S: Pt = { x: cx, y: sideY };
    const up = { x: s, y: -c }; // normal pointing up-right, off the axis
    const at = (t: number, off = 0): Pt => ({ x: S.x + t * c + off * up.x, y: S.y + t * s + off * up.y });
    const L = fractional ? 470 : 370, a = Math.round(L * 0.4), b = L - 45, J = 17;
    const B = at(L);
    const recNeckTop = B.y + 22;
    let recBase = recNeckTop + 112;
    const E: Pt = { x: B.x, y: recNeckTop + 36 };
    const bench = Math.max(heat === "bunsen" ? gauzeY + 120 : gauzeY + 64, recBase);
    if (bench - recBase < 40) recBase = bench; // stands on the bench rather than on a thin block
    const W = Math.round(B.x + 70), H = Math.round(bench + 14);

    // ---- Heating.
    let heatAnchor: Pt;
    if (heat === "bunsen") {
      mat(shapes, "heat", cx, bench - 12, 92);
      tripod(shapes, "heat", cx, gauzeY, bench - 12, 54);
      gauze(shapes, "heat", cx, gauzeY, 70);
      const b0 = bunsen(shapes, { burner: "heat", airHole: "heat", flame: "heat" }, cx, bench - 12, bench - 84, "blue", gauzeY + 8);
      heatAnchor = { x: cx - 6, y: b0.flame.y };
    } else {
      arrow(shapes, "heat", { x: cx, y: gauzeY + 56 }, { x: cx, y: gauzeY + 10 }, "ink", 4);
      heatAnchor = { x: cx - 2, y: gauzeY + 44 };
    }
    shapes.push({ t: "path", d: `M10 ${bench} H${W - 6}`, stroke: "muted", width: 1.6, fill: "none" });

    // ---- Round-bottomed flask, its mixture and the granules.
    const level = cy + r * 0.18;
    const ri = r - 1.6;
    const dx = Math.sqrt(ri * ri - (level - cy) ** 2);
    shapes.push({ t: "path", part: "mixture", d: `M${r1(cx - dx)} ${r1(level)} A${ri} ${ri} 0 0 0 ${r1(cx + dx)} ${r1(level)} Z`, fill: mixColour, stroke: "none", opacity: 0.85 });
    shapes.push({ t: "path", part: "mixture", d: surface(cx - dx, cx + dx, level), stroke: "ink", width: 1.4, fill: "none" });
    const granules: Pt[] = [-24, -9, 7, 22].map((gx, i) => ({ x: cx + gx, y: cy + Math.sqrt((r - 8) ** 2 - gx * gx) - (i % 2 ? 1 : 3) }));
    if (showGranules) dots(shapes, "anti-bumping-granules", granules, 4.2, "muted");
    shapes.push({ t: "path", part: "round-bottom-flask", d: `M${cx - n} ${neckTop} V${r1(joinY)} A${r} ${r} 0 1 0 ${cx + n} ${r1(joinY)} V${neckTop}`, stroke: "ink", width: GLASS_W, fill: "none" });

    // ---- Side arm + inner tube of the condenser, bending down into the receiver.
    const [lower, upper] = tubeWalls([S, B, E], 5);
    const toWall = (w: Pt[]) => {
      const t = (cx + n - w[0].x) / (w[1].x - w[0].x);
      return [{ x: cx + n, y: w[0].y + (w[1].y - w[0].y) * t }, ...w.slice(1)];
    };
    const up0 = toWall(upper), lo0 = toWall(lower);
    shapes.push({ t: "path", part: "condenser", d: `${poly(up0, false)} ${poly(lo0, false)}`, stroke: "ink", width: 2.2, fill: "none" });

    // ---- Still head (and fractionating column): walls broken where the side arm leaves.
    const headPart = "fractionating-column";
    let leftWall: string, rightWall: string;
    if (fractional) {
      leftWall = `M${cx - n} ${bungBottom} V${colTop} H${cx - cn} V${colBottom} H${cx - n} V${neckTop}`;
      rightWall = `M${cx + n} ${bungBottom} V${r1(up0[0].y)} M${cx + n} ${r1(lo0[0].y)} V${colTop} H${cx + cn} V${colBottom} H${cx + n} V${neckTop}`;
      const beads: Pt[] = [];
      for (let y = colTop + 14, row = 0; y < colBottom - 8; y += 9, row++) for (let x = cx - 10 + (row % 2 ? 5 : 0); x <= cx + 10; x += 10) beads.push({ x, y });
      dots(shapes, headPart, beads, 3.6, "glass", "ink", 1);
    } else {
      leftWall = `M${cx - n} ${bungBottom} V${neckTop}`;
      rightWall = `M${cx + n} ${bungBottom} V${r1(up0[0].y)} M${cx + n} ${r1(lo0[0].y)} V${neckTop}`;
    }
    shapes.push({ t: "path", part: headPart, d: `${leftWall} ${rightWall}`, stroke: "ink", width: GLASS_W, fill: "none" });
    // Ground-glass joint where the head meets the flask.
    shapes.push({ t: "path", part: "round-bottom-flask", d: `M${cx - n - 4} ${neckTop} h4 M${cx + n} ${neckTop} h4`, stroke: "ink", width: GLASS_W, fill: "none" });
    // Bung.
    shapes.push({ t: "path", part: headPart, d: `M${cx - n - 4} ${bungTop} H${cx + n + 4} L${cx + n} ${bungBottom} H${cx - n} Z`, fill: "#57534e", stroke: "ink", width: 1.6 });

    // ---- Thermometer: bulb level with the side arm's opening (it reads the vapour leaving).
    const bulbY = r1((up0[0].y + lo0[0].y) / 2);
    shapes.push({ t: "path", part: "thermometer", d: `M${cx} ${bulbY} V${bulbY - 50}`, stroke: "#ef4444", width: 2.4, fill: "none" });
    shapes.push({ t: "circle", part: "thermometer", cx, cy: bulbY, r: 6, fill: "#ef4444", stroke: "ink", width: 1.6 });
    shapes.push({ t: "path", part: "thermometer", d: `M${cx - 4} ${bulbY - 5} V${thermTop + 4} Q${cx} ${thermTop - 2} ${cx + 4} ${thermTop + 4} V${bulbY - 5}`, stroke: "ink", width: 1.8, fill: "none" });
    for (let y = thermTop + 10; y < bungTop - 2; y += 6) shapes.push({ t: "path", part: "thermometer", d: `M${cx + 4} ${y} h-3`, stroke: "ink", width: 1, fill: "none" });

    // ---- Condenser jacket (cooling water), with nubs: water IN at the LOWER end, OUT at the UPPER end.
    const tOut = a + 26, tIn = b - 26;
    const jacketFill = poly([at(a - 14, 6), at(a, J), at(b, J), at(b + 14, 6), at(b + 14, -6), at(b, -J), at(a, -J), at(a - 14, -6)]);
    shapes.push({ t: "path", part: "condenser", d: jacketFill, fill: "glass", stroke: "none" });
    const gap = 5 / c;
    shapes.push({ t: "path", part: "condenser", d: `${poly([at(a - 14, 6), at(a, J), at(tOut - gap, J)], false)} ${poly([at(tOut + gap, J), at(b, J), at(b + 14, 6)], false)} ${poly([at(a - 14, -6), at(a, -J), at(tIn - gap, -J)], false)} ${poly([at(tIn + gap, -J), at(b, -J), at(b + 14, -6)], false)}`, stroke: "ink", width: GLASS_W, fill: "none" });
    const pOut = at(tOut, J), pIn = at(tIn, -J);
    const outL = at(tOut - gap, J), outR = at(tOut + gap, J), inL = at(tIn - gap, -J), inR = at(tIn + gap, -J);
    shapes.push({ t: "path", part: "water-out", d: `M${P(outL)} V${r1(pOut.y - 20)} M${P(outR)} V${r1(pOut.y - 20)}`, stroke: "ink", width: 2.2, fill: "none" });
    shapes.push({ t: "path", part: "water-in", d: `M${P(inL)} V${r1(pIn.y + 20)} M${P(inR)} V${r1(pIn.y + 20)}`, stroke: "ink", width: 2.2, fill: "none" });
    const outTip = { x: pOut.x, y: pOut.y - 50 }, inTail = { x: pIn.x, y: pIn.y + 52 };
    arrow(shapes, "water-out", { x: pOut.x, y: pOut.y - 24 }, outTip, "#2563eb", 2.2);
    arrow(shapes, "water-in", inTail, { x: pIn.x, y: pIn.y + 24 }, "#2563eb", 2.2);

    // ---- Receiver (on a block if the condenser ends high) and distillate.
    const flask = conicalFlask(B.x, recNeckTop, recBase, 16, 50, 22);
    const dl = recBase - (recBase - flask.neckBottom) * distLevel;
    if (bench - recBase > 2) shapes.push({ t: "path", part: "receiver", d: `M${r1(B.x - 62)} ${r1(recBase)} h124 V${bench} h-124 Z`, fill: "wood", stroke: "ink", width: 2 });
    shapes.push({ t: "path", part: "distillate", d: flask.liquid(dl), fill: distColour, stroke: "none", opacity: 0.85 });
    shapes.push({ t: "path", part: "distillate", d: surface(flask.wall(dl, -1), flask.wall(dl, 1), dl), stroke: "ink", width: 1.4, fill: "none" });
    shapes.push({ t: "path", part: "receiver", d: flask.outline, stroke: "ink", width: GLASS_W, fill: "none" });
    shapes.push({ t: "path", part: "receiver", d: flask.lip, stroke: "ink", width: GLASS_W, fill: "none" });
    shapes.push({ t: "circle", part: "distillate", cx: r1(E.x), cy: r1(E.y + 9), r: 2.6, fill: distColour, stroke: "ink", width: 1 });

    const recY = recBase - 26;
    const parts: FigurePart[] = [
      { id: "round-bottom-flask", name: "Round-bottomed flask", anchor: { x: r1(cx - r * 0.96), y: r1(cy - r * 0.26) } },
      { id: "mixture", name: mixtureName, anchor: { x: r1(cx - r * 0.5), y: r1(cy + r * 0.5) } },
      { id: "anti-bumping-granules", name: "Anti-bumping granules", anchor: { x: r1(granules[0].x), y: r1(granules[0].y) } },
      { id: "fractionating-column", name: fractional ? "Fractionating column" : "Still head", anchor: fractional ? { x: cx - cn, y: r1((colTop + colBottom) / 2) } : { x: cx - n, y: r1((bungBottom + neckTop) / 2) } },
      { id: "thermometer", name: "Thermometer", anchor: { x: cx - 4, y: thermTop + 18 } },
      { id: "condenser", name: "Condenser", anchor: add(at((a + b) / 2 + 20, J - 3), { x: 0, y: 0 }) },
      { id: "water-in", name: "Water in", anchor: { x: r1(inTail.x), y: r1(inTail.y - 12) } },
      { id: "water-out", name: "Water out", anchor: { x: r1(outTip.x), y: r1(outTip.y + 14) } },
      { id: "receiver", name: "Conical flask", anchor: { x: r1(flask.wall(recY, 1)), y: r1(recY) } },
      { id: "distillate", name: distillateName, anchor: { x: r1(B.x + 10), y: r1((dl + recBase) / 2) } },
      { id: "heat", name: "Heat", anchor: heatAnchor },
    ];
    for (const p of parts) p.anchor = { x: r1(p.anchor.x), y: r1(p.anchor.y) };
    return { w: W, h: H, shapes, parts };
  },
};

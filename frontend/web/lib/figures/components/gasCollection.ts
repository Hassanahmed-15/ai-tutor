import { solutionColour } from "../colours";
import type { FigureComponent, FigureParams, FigurePart, FigureShape, Pt } from "../types";
import { GLASS_W, shiftDrawing, arrow, conicalFlask, dots, flag, num, oneOf, poly, r1, solidColour, surface, text, tubeWalls } from "./apparatusKit";

const METHODS = ["gas-syringe", "over-water", "upward-delivery", "downward-delivery"] as const;
type Method = (typeof METHODS)[number];

/** Spoken/written variants of each method name. */
function method(v: unknown): Method {
  const s = String(v ?? "").toLowerCase();
  if (/syringe/.test(s)) return "gas-syringe";
  if (/water|trough|measuring|cylinder|beehive/.test(s)) return "over-water";
  if (/upward|downward displacement of air|less dense|lighter/.test(s)) return "upward-delivery";
  if (/downward|upward displacement of air|denser|heavier/.test(s)) return "downward-delivery";
  return oneOf(v, METHODS, "gas-syringe");
}

/**
 * Making and collecting a gas, four textbook ways: a conical flask of reactants with a bung and
 * delivery tube, and the gas collected in a horizontal gas syringe (plunger pushed out, scale in cm³),
 * over water in an inverted measuring cylinder standing in a trough, or in a gas jar by upward
 * delivery (gas less dense than air; jar upside down, air pushed out downwards) or downward delivery
 * (gas denser than air; jar upright, air pushed out of the top).
 */
export const gasCollection: FigureComponent = {
  name: "gasCollection",
  title: "Making and collecting a gas: flask of reactants with bung and delivery tube; gas collected in a gas syringe, over water in an inverted measuring cylinder, or in a gas jar by upward or downward delivery",
  params: `method ("gas-syringe" default | "over-water" (inverted measuring cylinder in a trough) | "upward-delivery" (gas less dense than air, e.g. hydrogen, ammonia) | "downward-delivery" (gas denser than air, e.g. carbon dioxide, chlorine)), reactants (e.g. "marble chips + hydrochloric acid"), liquidColour (default colourless), solid (false hides the lumps of solid; default true), solidColour (white, grey, black, sand…; default white), gas (e.g. "carbon dioxide"), gasColour (default colourless; e.g. green for chlorine, brown for nitrogen dioxide), volume (cm³ collected 0-100 on the syringe or cylinder scale, or % of the jar filled; default 60). Part "displaced" is what the gas pushes out: the plunger, the water, or the air.`,
  match: /\bgas syringe\b|\bcollect(ing|ed|ion of)?\s+(a\s+|the\s+)?gas(es)?\b|\bgas(es)?\s+(is\s+|are\s+|was\s+)?collect(ed|ing|ion)\b|\b(collected|collection) over water\b|\b(upward|downward) (delivery|displacement)\b|\bdelivery tube\b|\bgas jar\b|\bbeehive shelf\b/i,
  parts: [
    { id: "reaction-flask", name: "Conical flask" },
    { id: "reactants", name: "Reactants" },
    { id: "bung", name: "Bung" },
    { id: "delivery-tube", name: "Delivery tube" },
    { id: "collector", name: "Gas syringe / measuring cylinder / gas jar" },
    { id: "gas", name: "Gas collected" },
    { id: "displaced", name: "Plunger / water / air pushed out" },
  ],
  build(params: FigureParams) {
    const m = method(params.method);
    const reactantsName = text(params.reactants, "Reactants");
    const gasName = text(params.gas, "Gas");
    const liquid = solutionColour(params.liquidColour, "colourless");
    const lumpColour = solidColour(params.solidColour, "white");
    const lumps = flag(params.solid, true);
    const gasColourName = String(params.gasColour ?? "").toLowerCase().trim();
    const gasFill = gasColourName && !/^(colourless|clear|none)$/.test(gasColourName) ? solutionColour(gasColourName) : null;
    const vol = num(params.volume, 60, 0, 100);
    const shapes: FigureShape[] = [];
    const gasShape = (d: string) => shapes.push({ t: "path", part: "gas", d, fill: gasFill ?? "glass", stroke: "none", opacity: gasFill ? 0.45 : 1 });
    const water: `#${string}` = "#93c5fd";

    // ---- Reaction flask, reactants (liquid, lumps, bubbles), bung.
    const cx = 92, neckTop = 178, base = 372, bench = base;
    const flask = conicalFlask(cx, neckTop, base, 16, 64, 30);
    const level = base - (base - flask.neckBottom) * 0.42;
    shapes.push({ t: "path", part: "reactants", d: flask.liquid(level), fill: liquid, stroke: "none", opacity: 0.85 });
    shapes.push({ t: "path", part: "reactants", d: surface(flask.wall(level, -1), flask.wall(level, 1), level), stroke: "ink", width: 1.4, fill: "none" });
    if (lumps) {
      const chips: Pt[] = [{ x: cx - 34, y: base - 9 }, { x: cx - 14, y: base - 8 }, { x: cx + 6, y: base - 9 }, { x: cx + 26, y: base - 8 }, { x: cx - 24, y: base - 22 }, { x: cx + 15, y: base - 21 }];
      for (const c of chips) shapes.push({ t: "path", part: "reactants", d: `M${c.x - 8} ${c.y + 5} L${c.x - 6} ${c.y - 5} L${c.x + 3} ${c.y - 7} L${c.x + 9} ${c.y} L${c.x + 5} ${c.y + 6} Z`, fill: lumpColour, stroke: "ink", width: 1.2 });
      dots(shapes, "reactants", [{ x: cx - 18, y: level + 14 }, { x: cx + 4, y: level + 24 }, { x: cx + 20, y: level + 10 }, { x: cx - 4, y: level + 34 }], 2.6, "none", "ink", 1);
    }
    shapes.push({ t: "path", part: "reaction-flask", d: flask.outline, stroke: "ink", width: GLASS_W, fill: "none" });
    shapes.push({ t: "path", part: "bung", d: `M${cx - 20} ${neckTop - 10} H${cx + 20} L${cx + 16} ${neckTop + 20} H${cx - 16} Z`, fill: "#57534e", stroke: "ink", width: 1.6 });

    // ---- Collection, by method. Each branch sets the tube's path and the anchors.
    let tube: Pt[] = [];
    let W = 600;
    let top = 0; // the highest thing drawn; the figure is cropped to it
    let collector: Pt = { x: 0, y: 0 }, gasAt: Pt = { x: 0, y: 0 }, displaced: Pt = { x: 0, y: 0 };
    let collectorName = "Gas syringe", displacedName = "Plunger";
    const start: Pt = { x: cx, y: neckTop + 30 };

    if (m === "gas-syringe") {
      const y = 124, half = 22, bx0 = 236, bx1 = 406, inner0 = bx0 + 6;
      top = y - half - 20;
      const travel = bx1 - inner0 - 16;
      const head = inner0 + (vol / 100) * travel;
      tube = [start, { x: cx, y }, { x: bx0 - 18, y }];
      // Nozzle, barrel, gas, piston + rod + handle.
      shapes.push({ t: "path", part: "collector", d: `M${bx0 - 22} ${y - 5} H${bx0} M${bx0 - 22} ${y + 5} H${bx0}`, stroke: "ink", width: 2.2, fill: "none" });
      if (head > inner0 + 1) gasShape(`M${inner0} ${y - half + 2} H${r1(head)} V${y + half - 2} H${inner0} Z`);
      shapes.push({ t: "path", part: "collector", d: `M${bx0} ${y - 5} V${y - half} H${bx1} M${bx0} ${y + 5} V${y + half} H${bx1} M${bx1} ${y - half - 6} V${y - half} M${bx1} ${y + half} V${y + half + 6}`, stroke: "ink", width: GLASS_W, fill: "none" });
      const rodEnd = head + (bx1 - inner0) + 8;
      shapes.push({ t: "path", part: "displaced", d: `M${r1(head)} ${y - half + 1.5} h8 V${y + half - 1.5} h-8 Z`, fill: "metal", stroke: "ink", width: 1.6 });
      shapes.push({ t: "path", part: "displaced", d: `M${r1(head + 8)} ${y - 4} H${r1(rodEnd)} V${y + 4} H${r1(head + 8)} Z`, fill: "glass", stroke: "ink", width: 1.6 });
      shapes.push({ t: "path", part: "displaced", d: `M${r1(rodEnd)} ${y - 13} h7 v26 h-7 Z`, fill: "glass", stroke: "ink", width: 1.8 });
      // Scale along the top of the barrel, 0 at the nozzle end.
      for (let v = 0; v <= 100; v += 10) {
        const x = r1(inner0 + 4 + (v / 100) * travel);
        shapes.push({ t: "path", part: "collector", d: `M${x} ${y - half} v${v % 20 === 0 ? 8 : 5}`, stroke: "ink", width: 1.1, fill: "none" });
        if (v % 20 === 0) shapes.push({ t: "text", part: "collector", x, y: y - half - 6, text: String(v), size: 11, anchor: "middle", fill: "muted" });
      }
      shapes.push({ t: "text", part: "collector", x: bx1 + 4, y: y - half - 6, text: "cm³", size: 11, anchor: "start", fill: "muted" });
      W = Math.round(Math.max(rodEnd + 20, bx1 + 100 + 26));
      collector = { x: (bx0 + bx1) / 2 + 40, y: y + half };
      // Gas anchored high in the barrel, beside the piston, so its leader clears the plunger's handle.
      gasAt = { x: Math.max(inner0 + 6, head - 12), y: y - 16 };
      displaced = { x: rodEnd + 7, y: y + 6 };
    } else if (m === "over-water") {
      collectorName = "Measuring cylinder";
      displacedName = "Water";
      const tx0 = 250, tx1 = 560, rim = 214, tBase = bench, wl = 236;
      const ccx = 440, half = 26, cTop = 44, mouth = 312, inTop = cTop + 4;
      top = cTop - 10;
      const gasLevel = inTop + (vol / 100) * (mouth - 40 - inTop);
      tube = [start, { x: cx, y: 124 }, { x: 330, y: 124 }, { x: 330, y: 340 }, { x: ccx, y: 340 }, { x: ccx, y: mouth - 22 }];
      // Trough and its water; the water inside the cylinder below the gas.
      shapes.push({ t: "path", part: "displaced", d: `M${tx0 + 1.5} ${wl} H${tx1 - 1.5} V${tBase - 1.5} H${tx0 + 1.5} Z`, fill: water, stroke: "none", opacity: 0.4 });
      shapes.push({ t: "path", part: "displaced", d: `M${tx0} ${wl} H${ccx - half} M${ccx + half} ${wl} H${tx1}`, stroke: "ink", width: 1.4, fill: "none" });
      shapes.push({ t: "path", part: "displaced", d: `M${ccx - half + 1.5} ${r1(gasLevel)} H${ccx + half - 1.5} V${mouth} H${ccx - half + 1.5} Z`, fill: water, stroke: "none", opacity: 0.4 });
      shapes.push({ t: "path", part: "displaced", d: `M${ccx - half} ${r1(gasLevel)} H${ccx + half}`, stroke: "ink", width: 1.4, fill: "none" });
      if (gasLevel > inTop + 1) gasShape(`M${ccx - half + 1.5} ${inTop} H${ccx + half - 1.5} V${r1(gasLevel)} H${ccx - half + 1.5} Z`);
      dots(shapes, "gas", [{ x: ccx - 3, y: mouth - 34 }, { x: ccx + 4, y: mouth - 52 }, { x: ccx - 2, y: Math.min(mouth - 70, gasLevel + 14) }], 3, "none", "ink", 1.1);
      shapes.push({ t: "path", part: "displaced", d: `M${tx0} ${rim} V${tBase} H${tx1} V${rim}`, stroke: "ink", width: GLASS_W, fill: "none" });
      // Inverted measuring cylinder: foot at the top, open mouth under the water; scale reads the gas volume.
      shapes.push({ t: "path", part: "collector", d: `M${ccx - half} ${mouth} V${cTop} H${ccx + half} V${mouth}`, stroke: "ink", width: GLASS_W, fill: "none" });
      shapes.push({ t: "path", part: "collector", d: `M${ccx - half - 12} ${cTop - 8} H${ccx + half + 12} V${cTop} H${ccx - half - 12} Z`, fill: "glass", stroke: "ink", width: 2 });
      for (let v = 0; v <= 100; v += 10) {
        const y = r1(inTop + (v / 100) * (mouth - 40 - inTop));
        shapes.push({ t: "path", part: "collector", d: `M${ccx + half} ${y} h-${v % 20 === 0 ? 10 : 6}`, stroke: "ink", width: 1.1, fill: "none" });
        if (v % 20 === 0 && v > 0) shapes.push({ t: "text", part: "collector", x: ccx + half - 13, y: y + 4, text: String(v), size: 10, anchor: "end", fill: "muted" });
      }
      W = tx1 + 14;
      collector = { x: ccx + half, y: Math.min(wl - 12, Math.max(cTop + 30, gasLevel + 30)) };
      gasAt = { x: ccx - 8, y: Math.max(inTop + 6, (inTop + gasLevel) / 2) };
      displaced = { x: tx1 - 30, y: (wl + tBase) / 2 + 20 };
    } else {
      collectorName = "Gas jar";
      displacedName = "Air pushed out";
      const jx = 440, half = 44;
      if (m === "upward-delivery") {
        // Jar upside down above the tube: the light gas rises and fills it from the top down.
        const jTop = 52, mouth = 268, inTop = jTop + 4;
        top = jTop - 2;
        const gasLevel = inTop + (vol / 100) * (mouth - inTop);
        tube = [start, { x: cx, y: 140 }, { x: 320, y: 140 }, { x: 320, y: 312 }, { x: jx, y: 312 }, { x: jx, y: jTop + 22 }];
        if (gasLevel > inTop + 1) gasShape(`M${jx - half + 1.5} ${inTop} H${jx + half - 1.5} V${r1(gasLevel)} H${jx - half + 1.5} Z`);
        shapes.push({ t: "path", part: "collector", d: `M${jx - half} ${mouth} V${jTop + 8} Q${jx - half} ${jTop} ${jx - half + 8} ${jTop} H${jx + half - 8} Q${jx + half} ${jTop} ${jx + half} ${jTop + 8} V${mouth}`, stroke: "ink", width: GLASS_W, fill: "none" });
        shapes.push({ t: "path", part: "collector", d: `M${jx - half - 6} ${mouth} h12 M${jx + half - 6} ${mouth} h12`, stroke: "ink", width: GLASS_W + 1, fill: "none" });
        arrow(shapes, "displaced", { x: jx - 24, y: mouth - 20 }, { x: jx - 30, y: mouth + 30 }, "muted", 2);
        arrow(shapes, "displaced", { x: jx + 24, y: mouth - 20 }, { x: jx + 30, y: mouth + 30 }, "muted", 2);
        collector = { x: jx + half, y: (jTop + mouth) / 2 + 30 };
        gasAt = { x: jx + 18, y: Math.max(inTop + 8, (inTop + gasLevel) / 2) };
        displaced = { x: jx + 28, y: mouth + 18 };
      } else {
        // Jar upright on the bench: the dense gas sinks and fills it from the bottom up.
        const mouth = 150, jBase = bench, inBase = jBase - 4;
        top = mouth - 66;
        const gasLevel = inBase - (vol / 100) * (inBase - mouth);
        tube = [start, { x: cx, y: mouth - 30 }, { x: jx - 14, y: mouth - 30 }, { x: jx - 14, y: jBase - 26 }];
        if (gasLevel < inBase - 1) gasShape(`M${jx - half + 1.5} ${r1(gasLevel)} H${jx + half - 1.5} V${inBase} H${jx - half + 1.5} Z`);
        shapes.push({ t: "path", part: "collector", d: `M${jx - half} ${mouth} V${jBase - 8} Q${jx - half} ${jBase} ${jx - half + 8} ${jBase} H${jx + half - 8} Q${jx + half} ${jBase} ${jx + half} ${jBase - 8} V${mouth}`, stroke: "ink", width: GLASS_W, fill: "none" });
        shapes.push({ t: "path", part: "collector", d: `M${jx - half - 6} ${mouth} h12 M${jx + half - 6} ${mouth} h12`, stroke: "ink", width: GLASS_W + 1, fill: "none" });
        arrow(shapes, "displaced", { x: jx + 18, y: mouth + 26 }, { x: jx + 34, y: mouth - 30 }, "muted", 2);
        collector = { x: jx + half, y: (mouth + gasLevel) / 2 };
        gasAt = { x: jx + 18, y: (gasLevel + inBase) / 2 };
        displaced = { x: jx + 30, y: mouth - 20 };
      }
      W = jx + half + 110;
    }

    // ---- Delivery tube (glass, drawn over the bung) and the bench.
    const [wa, wb] = tubeWalls(tube, 4);
    shapes.push({ t: "path", part: "delivery-tube", d: `${poly(wa, false)} ${poly(wb, false)}`, stroke: "ink", width: 2, fill: "none" });
    const endA = wa[wa.length - 1], endB = wb[wb.length - 1];
    if (m !== "gas-syringe") shapes.push({ t: "path", part: "delivery-tube", d: `M${r1(endA.x)} ${r1(endA.y)} L${r1(endB.x)} ${r1(endB.y)}`, stroke: "ink", width: 1, fill: "none", opacity: 0.4 });
    shapes.push({ t: "path", d: `M8 ${bench} H${W - 8}`, stroke: "muted", width: 1.6, fill: "none" });

    const parts: FigurePart[] = [
      { id: "reaction-flask", name: "Conical flask", anchor: { x: flask.wall(level - 30, -1), y: level - 30 } },
      { id: "reactants", name: reactantsName, anchor: { x: cx - 30, y: (level + base) / 2 } },
      { id: "bung", name: "Bung", anchor: { x: cx - 18, y: neckTop } },
      { id: "delivery-tube", name: "Delivery tube", anchor: { x: cx - 4, y: tube[1].y + 14 } },
      { id: "collector", name: collectorName, anchor: collector },
      { id: "gas", name: gasName, anchor: gasAt },
      { id: "displaced", name: displacedName, anchor: displaced },
    ];
    shiftDrawing(shapes, parts, 0, 12 - top);
    return { w: W, h: Math.round(bench - top + 24), shapes, parts };
  },
};

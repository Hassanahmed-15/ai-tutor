import { test } from "node:test";
import assert from "node:assert/strict";
import type { FigureComponent, FigureDrawing, FigureParams } from "../figures/types";
import { registerFigureComponent } from "../figures/registry";
import { leadersCross } from "../figures/labels";
import { layoutPanel, type Mark } from "../canvas/layout";
import { validateCanvasSpec } from "../canvas/validate";
import { distillation } from "../figures/components/distillation";
import { filtration } from "../figures/components/filtration";
import { chromatography, chromatogram } from "../figures/components/chromatography";
import { gasCollection } from "../figures/components/gasCollection";
import { heating } from "../figures/components/heating";
import { translatePath } from "../figures/components/apparatusKit";

const VARIANTS: Array<[FigureComponent, FigureParams[]]> = [
  [distillation, [{}, { type: "fractional" }, { type: "simple", heat: "arrow", granules: false }, { type: "fractional", heat: "arrow", distillateLevel: 0.9, mixtureColour: "blue" }]],
  [filtration, [{}, { residueColour: "black", filtrateColour: "blue", filtrateLevel: 0.7 }]],
  [chromatography, [{}, { dyes: "red, yellow", distances: "0, 3.5", references: "A: red, B: yellow, C: green 4.4", showRf: true }, { front: 2, distances: "9, 9, 9" }]],
  [gasCollection, [{}, { method: "over-water" }, { method: "upward-delivery", volume: 0 }, { method: "downward-delivery", volume: 100, gasColour: "green" }, { method: "gas-syringe", volume: 100, solid: false }]],
  [heating, [{}, { vessel: "evaporating-basin", crystals: true }, { vessel: "crucible", flame: "yellow", lid: false }, { vessel: "test-tube", boiling: true, level: 0.85 }]],
];
const JUNK: FigureParams = { type: "quantum", method: "teleport", vessel: "bucket", flame: "green", heat: 7, volume: "lots", level: -3, front: "x", dyes: ",,", distances: "a,b", references: "::, :", showRf: "maybe" };

const part = (d: FigureDrawing, id: string) => d.parts.find((p) => p.id === id)!;

test("each apparatus figure: declared parts are the built parts, anchors inside, shapes name real parts, no NaN — for every option set and for junk", () => {
  for (const [c, sets] of VARIANTS) {
    for (const params of [...sets, JUNK]) {
      const d = c.build(params);
      const label = `${c.name} ${JSON.stringify(params)}`;
      assert.deepEqual(d.parts.map((p) => p.id).sort(), c.parts.map((p) => p.id).sort(), label);
      for (const p of d.parts) assert.ok(p.anchor.x >= 0 && p.anchor.x <= d.w && p.anchor.y >= 0 && p.anchor.y <= d.h, `${label}: ${p.id} anchor (${p.anchor.x}, ${p.anchor.y}) inside ${d.w}×${d.h}`);
      for (const sh of d.shapes) {
        if (sh.part) assert.ok(d.parts.some((p) => p.id === sh.part), `${label}: shape names unknown part ${sh.part}`);
        assert.ok(!JSON.stringify(sh).includes("NaN") && !JSON.stringify(sh).includes("Infinity"), `${label}: bad number in ${JSON.stringify(sh).slice(0, 80)}`);
      }
      for (const id of c.parts.map((p) => p.id)) assert.ok(d.shapes.some((s) => s.part === id) || id === "anti-bumping-granules" || (id === "gas" && params.volume === 0), `${label}: ${id} has a shape`);
    }
  }
});

test("distillation: condenser water in at the bottom, out at the top; thermometer bulb level with the side arm; column only when fractional", () => {
  for (const type of ["simple", "fractional"]) {
    const d = distillation.build({ type });
    assert.ok(part(d, "water-in").anchor.y > part(d, "water-out").anchor.y + 40, `${type}: water in is below water out`);
    const bulb = d.shapes.find((s) => s.t === "circle" && s.part === "thermometer");
    assert.ok(bulb && bulb.t === "circle");
    const arm = d.shapes.find((s) => s.t === "path" && s.part === "condenser" && s.width === 2.2);
    assert.ok(arm && arm.t === "path");
    const ys = [...arm.d.matchAll(/M(\S+) (\S+)/g)].map((m) => Number(m[2]));
    assert.ok(bulb.cy > Math.min(...ys) && bulb.cy < Math.max(...ys), `${type}: bulb (${bulb.cy}) sits between the side arm's walls (${ys})`);
    const beads = d.shapes.filter((s) => s.t === "circle" && s.part === "fractionating-column").length;
    assert.ok(type === "fractional" ? beads > 10 : beads === 0, `${type}: glass beads`);
    assert.equal(part(d, "fractionating-column").name, type === "fractional" ? "Fractionating column" : "Still head");
  }
  const named = distillation.build({ mixture: "salt solution", distillate: "pure water", distillateColour: "colourless" });
  assert.equal(part(named, "mixture").name, "salt solution");
  assert.equal(part(named, "distillate").name, "pure water");
});

test("filtration: residue sits on the paper above the flask, filtrate below; colours follow the params", () => {
  const d = filtration.build({ residue: "sand", residueColour: "black", filtrate: "salt solution", filtrateColour: "blue" });
  assert.ok(part(d, "residue").anchor.y < part(d, "conical-flask").anchor.y && part(d, "residue").anchor.y < part(d, "filtrate").anchor.y);
  assert.ok(part(d, "filter-paper").anchor.y < part(d, "residue").anchor.y, "paper rim above the residue");
  assert.ok(d.shapes.some((s) => s.part === "residue" && s.fill === "#374151"));
  assert.ok(d.shapes.some((s) => s.part === "filtrate" && s.fill === "#3b82f6"));
  assert.equal(part(d, "residue").name, "sand");
});

test("chromatography: baseline above the solvent, front above the spots, Rf = dye distance ÷ solvent distance", () => {
  const params = { dyes: "blue, red, yellow", distances: "2, 4.4, 6", front: 8, references: "A: red, B: green 3", showRf: true };
  const chem = chromatogram(params);
  assert.deepEqual(chem.dyes.map((d) => d.rf), [0.25, 0.55, 0.75]);
  assert.equal(chem.references[0].dyes[0].distance, 4.4, "a reference of the same colour travels as far as the sample dye");
  assert.equal(chem.references[1].dyes[0].rf, 0.38);
  assert.ok(chromatogram({ distances: "12", front: 8 }).dyes[0].distance < 8, "no dye passes the solvent front");

  const d = chromatography.build(params);
  const solvent = d.shapes.find((s) => s.t === "path" && s.part === "solvent" && /^M\S+ \S+ Q/.test(s.d));
  assert.ok(solvent && solvent.t === "path");
  const solventY = Number(/^M\S+ (\S+) Q/.exec(solvent.d)![1]);
  const baseY = part(d, "baseline").anchor.y, frontY = part(d, "solvent-front").anchor.y;
  assert.ok(baseY < solventY - 10, "pencil baseline is above the solvent level");
  assert.ok(frontY < part(d, "spots").anchor.y, "the front is above every spot");
  // Each drawn sample spot is at Rf × (front distance) above the baseline.
  const spots = d.shapes.filter((s) => s.t === "path" && s.part === "spots").map((s) => Number(/^M\S+ (\S+) a/.exec((s as { d: string }).d)![1]));
  const rfs = spots.map((y) => Math.round(((baseY - y) / (baseY - frontY)) * 100) / 100).sort();
  assert.deepEqual(rfs, [0.25, 0.55, 0.75]);
  for (const v of ["0.25", "0.55", "0.75"]) assert.ok(d.shapes.some((s) => s.t === "text" && s.text === `Rf ${v}`), `shows Rf ${v}`);
  assert.ok(!chromatography.build({}).shapes.some((s) => s.t === "text" && s.text.startsWith("Rf")), "Rf only on request");
});

test("gas collection: each method draws its own collector; aliases are understood", () => {
  const names = (p: FigureParams) => { const d = gasCollection.build(p); return [part(d, "collector").name, part(d, "displaced").name]; };
  assert.deepEqual(names({}), ["Gas syringe", "Plunger"]);
  assert.deepEqual(names({ method: "collected over water" }), ["Measuring cylinder", "Water"]);
  assert.deepEqual(names({ method: "upward-delivery" }), ["Gas jar", "Air pushed out"]);
  assert.deepEqual(names({ method: "downward delivery" }), ["Gas jar", "Air pushed out"]);
  assert.ok(gasCollection.build({}).shapes.some((s) => s.t === "text" && s.text === "cm³"), "syringe scale in cm³");
  // Upward delivery: jar mouth down, so the gas (at the top) is above the air leaving at the bottom; downward: the reverse.
  const up = gasCollection.build({ method: "upward-delivery" }), down = gasCollection.build({ method: "downward-delivery" });
  assert.ok(part(up, "gas").anchor.y < part(up, "displaced").anchor.y);
  assert.ok(part(down, "gas").anchor.y > part(down, "displaced").anchor.y);
  // The syringe's gas grows with the volume collected.
  const gasWidth = (v: number) => { const s = gasCollection.build({ volume: v }).shapes.find((x) => x.part === "gas" && x.t === "path"); return s && s.t === "path" ? Number(/H\s*([\d.]+)/.exec(s.d)![1]) : 0; };
  assert.ok(gasWidth(80) > gasWidth(20));
});

test("heating: flame and air hole agree; the right support for each vessel", () => {
  const blue = heating.build({ flame: "blue" }), yellow = heating.build({ flame: "yellow" });
  assert.equal(part(blue, "air-hole").name, "Air hole (open)");
  assert.equal(part(yellow, "air-hole").name, "Air hole (closed)");
  assert.ok(blue.shapes.some((s) => s.part === "air-hole" && s.fill === "#1f2937"), "open hole is dark");
  assert.ok(!yellow.shapes.some((s) => s.part === "air-hole" && s.fill === "#1f2937"), "closed hole is not");
  const supports = (vessel: string) => { const d = heating.build({ vessel }); return [part(d, "vessel").name, part(d, "stand").name, part(d, "rest").name]; };
  assert.deepEqual(supports("beaker"), ["Beaker", "Tripod", "Gauze"]);
  assert.deepEqual(supports("evaporating dish"), ["Evaporating basin", "Tripod", "Gauze"]);
  assert.deepEqual(supports("crucible"), ["Crucible", "Tripod", "Pipe-clay triangle"]);
  assert.deepEqual(supports("boiling tube"), ["Test tube", "Clamp stand", "Clamp"]);
  // The flame reaches up to what it heats: its top is just below the vessel's bottom.
  const d = heating.build({ vessel: "beaker" });
  assert.ok(part(d, "flame").anchor.y > part(d, "rest").anchor.y && part(d, "rest").anchor.y > part(d, "contents").anchor.y);
});

test("match: each component is routed only the boards that need it", () => {
  const cases: Array<[FigureComponent, string[], string[]]> = [
    [distillation, ["Simple distillation of salt solution", "Fractional distillation of crude oil", "Separating ethanol and water using a fractionating column", "Water in at the bottom of the condenser"], ["Dissolve the salt in distilled water", "Filtration of sand", "Titration with a burette", "A capacitor stores charge"]],
    [filtration, ["Filtration separates sand from water", "The residue stays on the filter paper", "Collect the filtrate in a conical flask"], ["Simple distillation", "Paper chromatography of ink", "Apply a filter to the photo"]],
    [chromatography, ["Paper chromatography of black ink", "Calculating Rf values of dyes", "Mark the solvent front"], ["Filtration of sand", "Rf is not here", "The solvent dissolves the solute"]],
    [gasCollection, ["Measuring the rate with a gas syringe", "Hydrogen is collected over water", "Carbon dioxide by downward delivery", "Collecting the gas in a gas jar"], ["Collecting data about the class", "Gases in the atmosphere", "Paper chromatography"]],
    [heating, ["Heating with a Bunsen burner", "Close the air hole for a luminous flame", "Heat the crucible on a pipe-clay triangle", "Evaporating basin on a tripod and gauze"], ["Heating curve of water", "Fractionating column", "A blue solution of copper sulfate"]],
  ];
  for (const [c, yes, no] of cases) {
    for (const s of yes) assert.ok(c.match.test(s), `${c.name} should match "${s}"`);
    for (const s of no) assert.ok(!c.match.test(s), `${c.name} should not match "${s}"`);
  }
});

test("on the board: every label's leader ends on its part's anchor, in a margin, and no two leaders cross", () => {
  for (const [c, sets] of VARIANTS) {
    registerFigureComponent(c);
    for (const params of sets.slice(0, 2)) {
      for (const notes of [[], ["a note"]]) {
        const all = c.parts.map((p, i) => ({ id: p.id, s: i }));
        const spec = validateCanvasSpec({ heading: c.title.slice(0, 40), notes, cues: [], stage: { kind: "figure", component: c.name, params, parts: all.slice(0, 8) } }, 9);
        assert.ok(spec && spec.stage.kind === "figure", c.name);
        const layout = layoutPanel(spec!);
        const fig = layout.marks.find((m) => m.type === "figure") as Extract<Mark, { type: "figure" }>;
        const labels = layout.marks.filter((m): m is Extract<Mark, { type: "figure-label" }> => m.type === "figure-label");
        for (const l of labels) {
          const a = fig.drawing.parts.find((p) => p.id === l.part)!.anchor;
          const end = l.leader[l.leader.length - 1];
          assert.ok(Math.abs(end.x - (fig.rect.x + a.x * fig.scale)) < 0.01 && Math.abs(end.y - (fig.rect.y + a.y * fig.scale)) < 0.01, `${c.name}.${l.part} leader ends on its anchor`);
          assert.ok(l.side === "left" ? l.at.x <= fig.rect.x : l.at.x >= fig.rect.x + fig.rect.w, `${c.name}.${l.part} sits in a margin`);
        }
        for (let i = 0; i < labels.length; i++) for (let j = i + 1; j < labels.length; j++) assert.ok(!leadersCross(labels[i].leader, labels[j].leader), `${c.name}: ${labels[i].part} × ${labels[j].part}`);
      }
    }
  }
});

test("translatePath moves absolute coordinates only", () => {
  assert.equal(translatePath("M10 20 H30 V40 l5 5 A5 5 0 1 0 50 60 Z", 1, 2), "M 11 22 H 31 V 42 l 5 5 A 5 5 0 1 0 51 62 Z");
});

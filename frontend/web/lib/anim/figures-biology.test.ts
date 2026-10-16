import { test } from "node:test";
import assert from "node:assert/strict";
import { registerFigureComponent } from "../figures/registry";
import { leadersCross } from "../figures/labels";
import type { FigureComponent, FigureParams, FigureShape } from "../figures/types";
import { layoutPanel, type Mark } from "../canvas/layout";
import { validateCanvasSpec } from "../canvas/validate";
import { enzymeAction, enzymeSetup } from "../figures/components/enzymeAction";
import { membraneTransport, transportPlan } from "../figures/components/membraneTransport";
import { cellDivision, divisionPlan, parseStages } from "../figures/components/cellDivision";
import { foodWeb, parseFoodWeb } from "../figures/components/foodWeb";
import { ecologicalPyramid, pyramidData, percent } from "../figures/components/ecologicalPyramid";

const ALL: Array<[FigureComponent, FigureParams[]]> = [
  [enzymeAction, [{ model: "induced-fit" }, { denatured: true }, { inhibitor: "competitive" }, { inhibitor: "non-competitive", stage: "complex" }, { stage: "products", enzyme: "amylase", product: "maltose" }, { model: 7, stage: "nonsense", inhibitor: false }]],
  [membraneTransport, [{ process: "osmosis", higher: "right" }, { process: "active-transport", left: 1, right: 4 }, { process: "facilitated-diffusion", solute: "glucose" }, { left: 2, right: 2 }, { left: "abc", right: -3 }, { process: "osmosis", left: 0, right: 5 }]],
  [cellDivision, [{ type: "meiosis" }, { stage: "metaphase", chromosomes: 6 }, { type: "meiosis", stage: "anaphase II", chromosomes: 8 }, { type: "meiosis", stage: "prophase I", chromosomes: 2 }, { stage: "telophase II" }, { type: "meiosis", stage: "telophase II" }, { chromosomes: "2n = 7" }, { chromosomes: "lots" }]],
  [foodWeb, [{ organisms: "grass; rabbit; fox", links: "grass>rabbit>fox", highlight: "grass>rabbit>fox" }, { links: "algae>snail, snail>duck, algae>duck" }, { organisms: "x:producer" }, { organisms: "a:producer; b:decomposer", links: "a>b" }, { organisms: ";;;", links: ">>" }]],
  [ecologicalPyramid, [{ type: "numbers", levels: "oak:1; caterpillar:500; blue tit:20" }, { type: "biomass", levels: "a:800; b:200; c:50" }, { levels: "x:0; y:0" }, { levels: "nonsense" }, { type: "energy", levels: "p:87000; h:14000; c:1600; t:90", log: false }]],
];

test("biology figures: built parts ⊆ declared, at least two by default, anchors inside, shapes name built parts, finite geometry", () => {
  for (const [c, sets] of ALL) {
    const declared = new Set(c.parts.map((p) => p.id));
    assert.ok(c.build({}).parts.length >= 2, `${c.name} default has parts`);
    for (const params of [{}, ...sets]) {
      const fig = c.build(params);
      const where = `${c.name} ${JSON.stringify(params)}`;
      assert.ok(Number.isFinite(fig.w) && Number.isFinite(fig.h) && fig.w > 0 && fig.h > 0, where);
      for (const p of fig.parts) {
        assert.ok(declared.has(p.id), `${where}: undeclared part ${p.id}`);
        assert.ok(p.anchor.x >= 0 && p.anchor.x <= fig.w && p.anchor.y >= 0 && p.anchor.y <= fig.h, `${where}: ${p.id} anchor inside`);
        assert.ok(p.name.length > 0 && p.name.length <= 34, `${where}: ${p.id} name fits a label`);
      }
      assert.equal(new Set(fig.parts.map((p) => p.id)).size, fig.parts.length, `${where}: unique ids`);
      for (const sh of fig.shapes) {
        if (sh.part) assert.ok(fig.parts.some((p) => p.id === sh.part), `${where}: shape names unbuilt part ${sh.part}`);
        for (const v of Object.values(sh)) if (typeof v === "number") assert.ok(Number.isFinite(v), `${where}: finite`);
        if (sh.t === "path") assert.ok(!/NaN|Infinity/.test(sh.d), `${where}: finite path`);
      }
      for (const p of fig.parts) assert.ok(fig.shapes.some((s) => s.part === p.id), `${where}: ${p.id} has shapes`);
    }
  }
});

test("biology figures lay out on a board: leaders end on their anchors, labels in the margins, no leaders cross", () => {
  for (const [c] of ALL) {
    registerFigureComponent(c);
    for (const notes of [[], ["a key note"]]) {
      const d = c.build({});
      const spec = validateCanvasSpec({ heading: c.title.slice(0, 40), notes, cues: [], stage: { kind: "figure", component: c.name, params: {}, parts: d.parts.map((p, i) => ({ id: p.id, s: i })) } }, 9);
      assert.ok(spec && spec.stage.kind === "figure", c.name);
      const layout = layoutPanel(spec!);
      const fig = layout.marks.find((m) => m.type === "figure") as Extract<Mark, { type: "figure" }>;
      const labels = layout.marks.filter((m): m is Extract<Mark, { type: "figure-label" }> => m.type === "figure-label");
      assert.equal(labels.length, Math.min(8, d.parts.length), c.name);
      for (const l of labels) {
        const part = fig.drawing.parts.find((p) => p.id === l.part)!;
        const end = l.leader[l.leader.length - 1];
        assert.ok(Math.abs(end.x - (fig.rect.x + part.anchor.x * fig.scale)) < 0.01 && Math.abs(end.y - (fig.rect.y + part.anchor.y * fig.scale)) < 0.01, `${c.name}.${l.part}`);
        assert.ok(l.side === "left" ? l.at.x <= fig.rect.x : l.at.x >= fig.rect.x + fig.rect.w, `${c.name}.${l.part} in a margin`);
      }
      for (let i = 0; i < labels.length; i++) for (let j = i + 1; j < labels.length; j++) assert.ok(!leadersCross(labels[i].leader, labels[j].leader), `${c.name}: ${labels[i].part} × ${labels[j].part}`);
    }
  }
});

/* ── the science ─────────────────────────────────────────────────────────────────────────── */

const strokes = (shapes: FigureShape[], colours: string[]) => shapes.filter((s) => s.t === "path" && colours.includes(String(s.stroke)));

test("cell division: mitosis keeps 2n in each of 2 cells; meiosis gives 4 cells of n, one of each pair", () => {
  for (const twoN of [2, 4, 6, 8]) {
    const mit = divisionPlan({ chromosomes: twoN });
    const daughters = mit.stages.find((s) => s.id === "daughter")!;
    assert.equal(daughters.groups.length, 2);
    for (const g of daughters.groups) {
      assert.equal(g.length, twoN, "each mitotic daughter cell is 2n");
      for (let k = 0; k < twoN / 2; k++) assert.deepEqual(g.filter((c) => c.pair === k).map((c) => c.hom).sort(), [0, 1], "both homologues of every pair");
      assert.ok(g.every((c) => !c.dup), "single-chromatid chromosomes after division");
    }
    const mei = divisionPlan({ type: "meiosis", chromosomes: twoN });
    const gametes = mei.stages.find((s) => s.id === "gametes")!;
    assert.equal(gametes.groups.length, 4, "meiosis gives four cells");
    for (const g of gametes.groups) {
      assert.equal(g.length, twoN / 2, "each is haploid (n)");
      assert.deepEqual(g.map((c) => c.pair).sort(), Array.from({ length: twoN / 2 }, (_, k) => k), "one chromosome of each pair");
    }
    // Meiosis I separates homologues (still duplicated); meiosis II the chromatids.
    const a1 = divisionPlan({ type: "meiosis", chromosomes: twoN, stage: "anaphase I" }).stages[0];
    assert.ok(a1.groups.every((g) => g.length === twoN / 2 && g.every((c) => c.dup)));
    assert.ok(a1.groups[0].every((c, k) => c.hom !== a1.groups[1][k].hom), "homologues go to opposite poles");
    const a = divisionPlan({ chromosomes: twoN, stage: "anaphase" }).stages[0];
    assert.ok(a.groups.every((g) => g.length === twoN && g.every((c) => !c.dup)), "mitotic anaphase: 2n chromatids to each pole");
  }
  // The drawing has exactly those chromosomes: 2 × 2n rods (mitosis), 4 × n (meiosis).
  const red = "#dc2626", blue = "#2563eb";
  assert.equal(strokes(cellDivision.build({ stage: "daughter cells", chromosomes: 6 }).shapes, [red, blue]).length, 12);
  assert.equal(strokes(cellDivision.build({ type: "meiosis", stage: "daughter cells", chromosomes: 6 }).shapes, [red, blue]).length, 12);
  assert.equal(strokes(cellDivision.build({ type: "meiosis", stage: "daughter cells", chromosomes: 4 }).shapes, [red, blue]).length, 8);
  // A duplicated chromosome is two chromatids: metaphase of 2n = 4 has 8 chromatid strokes and 4 centromeres.
  const meta = cellDivision.build({ stage: "metaphase", chromosomes: 4 });
  assert.equal(strokes(meta.shapes, [red, blue]).length, 8);
  assert.equal(cellDivision.build({ stage: "daughter cells", chromosomes: 4 }).parts.find((p) => p.id === "daughter-cells")!.name, "Daughter cells (2n = 4)");
  assert.equal(cellDivision.build({ type: "meiosis", stage: "daughter cells" }).parts.find((p) => p.id === "daughter-cells")!.name, "Daughter cells (n = 2)");
  assert.equal(divisionPlan({ chromosomes: 7 }).twoN, 8, "2n is even");
  assert.equal(divisionPlan({ chromosomes: "2n = 6" }).twoN, 6);
  assert.deepEqual(parseStages("metaphase II, anaphase 1", "meiosis"), ["anaphase-1", "metaphase-2"], "in the division's order");
  assert.deepEqual(parseStages("prophase", "meiosis"), ["prophase-1"]);
  assert.equal(parseStages("all", "mitosis").length, 5);
  assert.ok(cellDivision.build({ type: "meiosis", stage: "prophase I" }).parts.some((p) => p.id === "homologous-pair"));
  assert.ok(!cellDivision.build({ stage: "prophase" }).parts.some((p) => p.id === "homologous-pair"), "mitosis does not pair homologues");
});

/** The tip of the net-movement arrow (its head's first point) and the shaft's start. */
function netArrow(params: FigureParams) {
  const sh = membraneTransport.build(params).shapes.filter((s) => s.part === "net-movement" && s.t === "path") as Array<{ d: string; fill?: string }>;
  const shaft = sh.find((s) => s.fill === "none")!, head = sh.find((s) => s.fill !== "none")!;
  const [sx] = shaft.d.match(/^M(-?[\d.]+)/)!.slice(1).map(Number);
  const [tx] = head.d.match(/^M(-?[\d.]+)/)!.slice(1).map(Number);
  return { sx, tx };
}

test("membrane transport: diffusion down the gradient, osmosis towards the concentrated solution, active transport against it with ATP", () => {
  const dif = transportPlan({ process: "diffusion", left: 5, right: 1 });
  assert.deepEqual(dif.net, { from: "left", to: "right", what: "particles" });
  assert.ok(dif.solute.left > dif.solute.right);
  assert.equal(dif.solute.right, Math.round((15 * 1) / 5), "counts in proportion to concentration");
  const d = netArrow({ process: "diffusion", left: 5, right: 1 });
  assert.ok(d.tx > d.sx, "arrow points right, high → low");

  const osm = transportPlan({ process: "osmosis", higher: "right" });
  assert.equal(osm.high, "right");
  assert.deepEqual(osm.net, { from: "left", to: "right", what: "water" }, "water moves into the more concentrated solution");
  assert.ok(osm.water.left > osm.water.right, "the dilute side has more water");
  assert.ok(osm.solute.right > osm.solute.left);
  const o = netArrow({ process: "osmosis", higher: "right" });
  assert.ok(o.tx > o.sx);
  const ob = membraneTransport.build({ process: "osmosis", higher: "left" });
  assert.equal(ob.parts.find((p) => p.id === "net-movement")!.name, "Net movement of water");
  assert.ok(ob.parts.some((p) => p.id === "water") && ob.parts.some((p) => p.id === "solute"));
  assert.ok(netArrow({ process: "osmosis", higher: "left" }).tx < netArrow({ process: "osmosis", higher: "left" }).sx, "towards the left when the left is concentrated");

  const act = transportPlan({ process: "active-transport", left: 1, right: 4 });
  assert.equal(act.high, "right");
  assert.deepEqual(act.net, { from: "left", to: "right", what: "particles" }, "low → high: against the gradient");
  assert.ok(act.atp);
  const ab = membraneTransport.build({ process: "active-transport", left: 1, right: 4 });
  assert.ok(ab.parts.some((p) => p.id === "atp"));
  assert.equal(ab.parts.find((p) => p.id === "protein")!.name, "Carrier protein");
  assert.ok(ab.shapes.some((s) => s.t === "text" && s.text === "ATP"));
  const a = netArrow({ process: "active-transport", left: 4, right: 1 });
  assert.ok(a.tx < a.sx, "high on the left: pumped leftwards, up the gradient");
  assert.ok(!membraneTransport.build({ process: "diffusion" }).parts.some((p) => p.id === "atp" || p.id === "protein"), "simple diffusion: no ATP, no protein");
  assert.equal(membraneTransport.build({ process: "facilitated-diffusion" }).parts.find((p) => p.id === "protein")!.name, "Channel protein");

  const eq = transportPlan({ left: 2, right: 2 });
  assert.equal(eq.net, null);
  assert.equal(membraneTransport.build({ left: 2, right: 2 }).parts.find((p) => p.id === "net-movement")!.name, "No net movement (equal)");
  // Drawn particle counts match the plan.
  const counted = membraneTransport.build({ process: "diffusion", left: 3, right: 1 }).shapes.filter((s) => s.t === "circle" && s.part === "solute").length;
  assert.equal(counted, 15 + 5);
});

test("food web: arrows from prey to predator (energy flow), levels from roles or links, highlighted chain", () => {
  const web = parseFoodWeb({ organisms: "grass; rabbit; fox", links: "grass>rabbit>fox" });
  assert.deepEqual(web.organisms.map((o) => o.level), [0, 1, 2], "levels worked out from the links");
  assert.deepEqual(web.links.map((l) => [web.organisms[l.prey].name, web.organisms[l.predator].name]), [["Grass", "Rabbit"], ["Rabbit", "Fox"]]);
  const roles = parseFoodWeb({ organisms: "oak:producer; aphid:primary; ladybird:secondary; fungi:decomposer", links: "oak>aphid, aphid>ladybird, ladybird>fungi" });
  assert.deepEqual(roles.organisms.map((o) => o.level), [0, 1, 2, -1]);
  // Every arrow's head is at its predator's end: up the page (predators sit above their prey).
  const fig = foodWeb.build({});
  const def = parseFoodWeb({});
  const heads = fig.shapes.filter((s) => s.part === "energy-flow" && s.t === "path" && s.fill !== "none") as Array<{ d: string }>;
  const shafts = fig.shapes.filter((s) => s.part === "energy-flow" && s.t === "path" && s.fill === "none") as Array<{ d: string }>;
  assert.equal(heads.length, def.links.length);
  heads.forEach((h, i) => {
    const tipY = Number(h.d.match(/^M[-\d.]+ ([-\d.]+)/)![1]);
    const startY = Number(shafts[i].d.match(/^M[-\d.]+ ([-\d.]+)/)![1]);
    assert.ok(tipY < startY, `arrow ${i} points from prey up to predator`);
  });
  assert.ok(fig.shapes.some((s) => s.t === "text" && s.text === "Grass"));
  assert.equal(fig.parts.find((p) => p.id === "producer")!.name, "Producer (grass)");
  const hl = foodWeb.build({ highlight: "grass>rabbit>hawk" });
  assert.equal(hl.shapes.filter((s) => s.part === "energy-flow" && s.t === "path" && s.fill === "#dc2626").length, 2, "two chain arrows in red");
  assert.equal(hl.parts.find((p) => p.id === "energy-flow")!.name, "Food chain (energy flow)");
  const deco = foodWeb.build({ organisms: "leaf:producer; worm:primary; fungi:decomposer", links: "leaf>worm, leaf>fungi, worm>fungi" });
  assert.ok(deco.parts.some((p) => p.id === "decomposer"));
});

test("ecological pyramid: widths proportional to the values, efficiency and energy lost computed, inverted when the data say so", () => {
  const b = pyramidData({ type: "biomass", levels: "a:800; b:200; c:50" });
  assert.ok(Math.abs(b.widths[0] / b.widths[1] - 4) < 1e-9 && Math.abs(b.widths[1] / b.widths[2] - 4) < 1e-9, "widths ∝ values");
  assert.deepEqual(b.efficiency, [25, 25]);
  assert.deepEqual(b.loss, [], "no energy loss on a biomass pyramid");
  const e = pyramidData({ type: "energy", levels: "grass:20000; grasshopper:2000; frog:200", log: false });
  assert.deepEqual(e.efficiency, [10, 10]);
  assert.deepEqual(e.loss, [18000, 1800]);
  assert.ok(Math.abs(e.widths[0] / e.widths[2] - 100) < 1e-9);
  const lg = pyramidData({ type: "energy", levels: "a:10000; b:1000; c:100; d:10" });
  assert.ok(lg.log, "an energy pyramid spanning powers of ten defaults to a log scale");
  const steps = lg.widths.slice(1).map((w, i) => lg.widths[i] - w);
  assert.ok(steps.every((s) => Math.abs(s - steps[0]) < 1e-9) && steps[0] > 0, "log widths fall by equal steps for each power of ten");
  const inv = pyramidData({ type: "numbers", levels: "oak tree:1; caterpillars:500; blue tits:20" });
  assert.ok(inv.widths[0] < inv.widths[1], "an inverted pyramid of numbers stays inverted");
  assert.deepEqual(inv.efficiency, [], "no transfer efficiency for numbers");
  const fig = ecologicalPyramid.build({ type: "energy", levels: "grass:20000; grasshopper:2000; frog:200", log: false });
  const texts = fig.shapes.filter((s) => s.t === "text").map((s) => (s as { text: string }).text);
  assert.ok(texts.includes("10%") && texts.includes("18,000") && texts.includes("20,000 kJ/m²/year"), texts.join(" | "));
  assert.equal(fig.parts.find((p) => p.id === "primary")!.name, "Primary consumers (grasshopper)");
  assert.ok(fig.parts.some((p) => p.id === "energy-loss") && fig.parts.some((p) => p.id === "efficiency"));
  assert.equal(percent(12.5), "12.5%");
  assert.equal(percent(0.456), "0.46%");
  assert.deepEqual(pyramidData({ levels: "fox:10, rabbit:100, grass:1000" }).levels.map((l) => l.name), ["grass", "rabbit", "fox"], "a top-down list is turned the right way up");
  assert.deepEqual(pyramidData({ levels: "a:1,000; b:100" }).levels.map((l) => l.value), [1000, 100], "thousands separators");
});

test("enzyme action: lock-and-key sequence, induced fit, denatured site, inhibitors", () => {
  assert.deepEqual(enzymeSetup({}).panels, ["approach", "complex", "products"]);
  const ids = (p: FigureParams) => enzymeAction.build(p).parts.map((x) => x.id).sort();
  assert.deepEqual(ids({}), ["active-site", "complex", "enzyme", "products", "substrate"]);
  assert.ok(ids({ denatured: true }).includes("denatured-site"));
  assert.ok(!ids({ denatured: true }).includes("products"));
  assert.equal(enzymeAction.build({ inhibitor: "competitive" }).parts.find((p) => p.id === "inhibitor")!.name, "Competitive inhibitor");
  assert.equal(enzymeAction.build({ inhibitor: "noncompetitive" }).parts.find((p) => p.id === "inhibitor")!.name, "Non-competitive inhibitor");
  assert.equal(enzymeAction.build({ model: "induced fit" }).parts.find((p) => p.id === "active-site")!.name, "Active site (not yet fitting)");
  assert.deepEqual(enzymeSetup({ stage: "complex" }).panels, ["complex"]);
  assert.equal(enzymeAction.build({ enzyme: "amylase" }).parts.find((p) => p.id === "enzyme")!.name, "Enzyme (amylase)");
  // The red cross ("cannot bind") appears only when the substrate cannot fit.
  const crosses = (p: FigureParams) => enzymeAction.build(p).shapes.filter((s) => s.t === "path" && s.stroke === "#dc2626" && s.width === 4).length;
  assert.equal(crosses({}), 0);
  assert.equal(crosses({ denatured: true }), 1);
  assert.equal(crosses({ inhibitor: "competitive" }), 1);
});

test("match: each biology figure is picked for its topic and not for others", () => {
  const yes: Array<[FigureComponent, string[]]> = [
    [enzymeAction, ["The lock and key model", "induced fit hypothesis", "How the active site binds the substrate", "enzyme-substrate complex", "Why enzymes denature at high temperature", "competitive inhibition of enzymes", "non-competitive inhibitors"]],
    [membraneTransport, ["Osmosis in plant cells", "Diffusion across a membrane", "Active transport in root hair cells", "facilitated diffusion through channel proteins", "a partially permeable membrane", "the concentration gradient"]],
    [cellDivision, ["Stages of mitosis", "Meiosis produces gametes", "prophase, metaphase, anaphase, telophase", "sister chromatids separate", "homologous chromosomes pair up", "the cell cycle"]],
    [foodWeb, ["A woodland food web", "food chains and trophic levels", "secondary consumers", "who eats whom in a pond"]],
    [ecologicalPyramid, ["Pyramid of biomass", "pyramids of numbers", "an energy pyramid", "efficiency of energy transfer between trophic levels", "the 10% rule"]],
  ];
  const no: Array<[FigureComponent, string[]]> = [
    [enzymeAction, ["Rate of photosynthesis", "The digestive system", "kinetic energy of particles", "denatured alcohol as a fuel"]],
    [membraneTransport, ["Refraction of light", "ionic bonding in salt", "the structure of the heart"]],
    [cellDivision, ["Nuclear fission in a reactor", "plant cell structure", "cell membranes"]],
    [foodWeb, ["Food tests for starch", "the chain rule in calculus", "the web of a spider"]],
    [ecologicalPyramid, ["Volume of a square-based pyramid", "the Egyptian pyramids", "a population pyramid"]],
  ];
  for (const [c, list] of yes) for (const s of list) assert.ok(c.match.test(s), `${c.name} should match "${s}"`);
  for (const [c, list] of no) for (const s of list) assert.ok(!c.match.test(s), `${c.name} should not match "${s}"`);
});

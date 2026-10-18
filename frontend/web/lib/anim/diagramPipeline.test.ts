import test from "node:test";
import assert from "node:assert/strict";
import { compileDiagram, isCompiledDiagram } from "../diagrams/grammar";
import { diagramIssues } from "../diagrams/grammarCheck";
import { diagramSvg } from "../diagrams/grammarRender";
import { photographic, VECTOR_FORM } from "../canvas/visualPolicy";
import type { CanvasPlanBeat } from "../canvas/types";

const currents = {
  w: 720, h: 380,
  elements: [
    { t: "world", lon: [-110, 20], lat: [-10, 70], x: 10, y: 10, w: 700, h: 360, latitudes: [0, 30, 60] },
    { t: "geoArrow", points: [[-80, 25], [-60, 42], [-15, 58]], color: "red", part: "gulf" },
    { t: "geoArrow", points: [[-14, 38], [-20, 18]], color: "blue", part: "canary" },
  ],
  parts: [{ id: "gulf", name: "Gulf Stream (warm)" }, { id: "canary", name: "Canary Current (cold)" }, { id: "na", name: "North America", at: [-100, 45] }],
};

test("a world map draws real coastlines in its window, currents along their coordinates, places by lon/lat", () => {
  const c = compileDiagram(currents);
  assert.ok(c.drawing, c.issues.join("; "));
  assert.ok(c.drawing!.shapes.length > 15, "land, ocean, latitudes and currents are drawn");
  // Every land path stays inside the map box (clipped, never dragged off the canvas).
  const land = c.drawing!.shapes.filter((s) => s.t === "path" && s.stroke === "#7c9a6a");
  assert.ok(land.length >= 5, "the Americas, Europe, Africa and Greenland are in this window");
  for (const s of land) if (s.t === "path") for (const n of s.d.match(/-?\d+(\.\d+)?/g)!.map(Number)) assert.ok(n >= 9.9 && n <= 710.1, `land at ${n} is outside the map box`);
  const na = c.drawing!.parts.find((p) => p.id === "na")!;
  // lon -100 in a -110..20 window over 700 px: (10/130)*700 + 10 ≈ 63.8.
  assert.ok(Math.abs(na.anchor.x - 63.8) < 1 && Math.abs(na.anchor.y - (10 + (25 / 80) * 360)) < 1);
  assert.ok(isCompiledDiagram(c.drawing), "the validator can trust a compiled drawing");
  assert.equal(isCompiledDiagram({ ...c.drawing }), false, "a copy (or a model's forgery) is not trusted");
});

test("geo elements need a world, and arrows must stay in the window", () => {
  assert.match(compileDiagram({ w: 400, h: 300, elements: [{ t: "geoArrow", points: [[0, 0], [10, 10]], part: "a" }], parts: [{ id: "a", name: "A" }] }).issues.join(" "), /needs a "world"/);
  const off = compileDiagram({ ...currents, elements: [currents.elements[0], { t: "geoArrow", points: [[100, 10], [120, 20]], part: "gulf" }] });
  assert.match(off.issues.join(" "), /leaves the map window/);
});

test("a plot draws axes and data, rejects data off its axes, and records its values", () => {
  const plot = (points: number[][]) => compileDiagram({ w: 600, h: 380, elements: [{ t: "plot", x: 80, y: 40, w: 480, h: 260, xAxis: { label: "Latitude", min: -90, max: 90, step: 30 }, yAxis: { label: "Energy", min: 0, max: 100, step: 25 }, series: [{ kind: "line", points, part: "e" }] }], parts: [{ id: "e", name: "Energy received" }] });
  const ok = plot([[-90, 10], [0, 95], [90, 10]]);
  assert.ok(ok.drawing, ok.issues.join("; "));
  assert.deepEqual(ok.facts.data, [-90, 10, 0, 95, 90, 10]);
  assert.ok(ok.drawing!.shapes.some((s) => s.t === "text" && s.text === "-60"), "ticks are written by code");
  assert.match(plot([[-90, 10], [0, 140]]).issues.join(" "), /outside the axes/);
  const bars = compileDiagram({ w: 600, h: 380, elements: [{ t: "plot", x: 80, y: 40, w: 480, h: 260, xAxis: { categories: ["UK", "Brazil"] }, yAxis: { min: 0, max: 100, step: 20 }, series: [{ kind: "bars", values: [80, 55], part: "share" }] }], parts: [{ id: "share", name: "Urban share" }] });
  assert.ok(bars.drawing, bars.issues.join("; "));
});

test("layers stack top first; repeat draws exactly its count", () => {
  const soil = compileDiagram({ w: 400, h: 400, elements: [{ t: "layers", x: 100, y: 20, w: 200, layers: [{ h: 40, fill: "brown", part: "o" }, { h: 90, fill: "sand", part: "top" }, { h: 110, fill: "grey", part: "rock" }] }], parts: [{ id: "o", name: "O horizon" }, { id: "top", name: "Topsoil" }, { id: "rock", name: "Bedrock" }] });
  assert.ok(soil.drawing);
  const y = (id: string) => soil.drawing!.parts.find((p) => p.id === id)!.anchor.y;
  assert.ok(y("o") < y("top") && y("top") < y("rock"));
  const pairs = compileDiagram({ w: 600, h: 300, elements: [{ t: "circle", cx: 300, cy: 150, r: 140, fill: "sky", part: "nucleus" }, { t: "repeat", count: 23, cols: 8, dx: 30, dy: 60, part: "pair", shape: { t: "rect", x: 190, y: 70, w: 8, h: 36, fill: "purple" } }], parts: [{ id: "nucleus", name: "Nucleus" }, { id: "pair", name: "Chromosome pairs" }] });
  assert.ok(pairs.drawing);
  assert.deepEqual(pairs.facts.counts, [{ part: "pair", count: 23 }]);
  // The nucleus's label points at the nucleus, not at a chromosome drawn inside it.
  const nucleus = pairs.drawing!.parts.find((p) => p.id === "nucleus")!.anchor;
  assert.ok(nucleus.y < 70 || nucleus.y > 226 || nucleus.x < 190 || nucleus.x > 410);
  assert.deepEqual(diagramIssues(pairs, { narration: "A body cell has 23 pairs of chromosomes." }), []);
  assert.match(diagramIssues(pairs, { narration: "A body cell has 22 pairs of chromosomes." }).join(" "), /repeat it exactly 22 times/);
});

test("the checks: required parts, invented numbers, the lesson's own data", () => {
  const c = compileDiagram({ w: 400, h: 300, elements: [{ t: "rect", x: 20, y: 20, w: 150, h: 100, fill: "blue", part: "a" }, { t: "circle", cx: 300, cy: 150, r: 60, fill: "red", part: "b" }, { t: "text", x: 300, y: 260, text: "45%" }], parts: [{ id: "a", name: "Trachea" }, { id: "b", name: "Bronchus" }] });
  const issues = diagramIssues(c, { narration: "Air passes down the trachea into each bronchus.", mustShow: ["Cilia"] });
  assert.ok(issues.some((i) => /requires "Cilia"/.test(i)));
  assert.ok(issues.some((i) => /writes 45/.test(i)));
  const plotted = compileDiagram({ w: 600, h: 380, elements: [{ t: "plot", x: 80, y: 40, w: 480, h: 260, xAxis: { min: 0, max: 10, step: 2 }, yAxis: { min: 0, max: 100, step: 20 }, series: [{ kind: "line", points: [[0, 10], [10, 90]], part: "l" }] }], parts: [{ id: "l", name: "Line" }] });
  assert.match(diagramIssues(plotted, { narration: "At 2 hours it was 30 and at 6 hours 70." }).join(" "), /plot the lesson's own data/);
});

test("a part's name written into the art is removed (labels are the label engine's); code text stays", () => {
  const c = compileDiagram({ w: 600, h: 380, elements: [{ t: "plot", x: 80, y: 40, w: 480, h: 260, xAxis: { categories: ["Primary", "Tertiary"] }, yAxis: { min: 0, max: 100, step: 20 }, series: [{ kind: "bars", values: [20, 70], part: "p" }] }, { t: "text", x: 300, y: 20, text: "Primary" }], parts: [{ id: "p", name: "Primary sector" }] });
  assert.ok(c.drawing);
  assert.equal(c.drawing!.shapes.filter((s) => s.t === "text" && s.text === "Primary").length, 1, "the category stays; the writer's copy goes");
  assert.match(diagramSvg(c.drawing!), /<svg[\s\S]*Primary sector/);
});

const beat = (title: string, brief: string, script = ""): CanvasPlanBeat => ({ id: "b1", title, brief, script, stage: "illustration", objects: [], carry: [], overview: false } as unknown as CanvasPlanBeat);
test("routing: a picture is for what a thing looks like; maps, sections and data are vector diagrams", () => {
  assert.equal(photographic(beat("A tropical rainforest", "What a tropical rainforest looks like")), true);
  assert.equal(photographic(beat("Ocean currents", "Warm and cold ocean currents on a world map")), false);
  assert.equal(photographic(beat("Leaf tissues", "Label the layers of a leaf cross-section")), false);
  assert.equal(photographic(beat("Chromosomes", "A diploid nucleus with 23 pairs")), false);
  assert.ok(VECTOR_FORM.test("the three-cell model of atmospheric circulation"));
  assert.ok(VECTOR_FORM.test("a soil profile"));
  assert.ok(!VECTOR_FORM.test("the causes of the First World War"));
});

test("a plot finds where two lines cross and guides it to both axes; loops turn the way given", () => {
  const c = compileDiagram({ w: 600, h: 400, elements: [{ t: "plot", x: 80, y: 30, w: 460, h: 300, xAxis: { label: "Quantity", min: 0, max: 10 }, yAxis: { label: "Price", min: 0, max: 10 },
    series: [{ kind: "line", points: [[1, 9], [9, 1]], part: "d" }, { kind: "line", points: [[1, 1], [9, 9]], part: "s" }],
    intersections: [{ of: ["d", "s"], part: "e", xPart: "q", yPart: "p" }] }],
    parts: [{ id: "d", name: "Demand" }, { id: "s", name: "Supply" }, { id: "e", name: "Equilibrium" }, { id: "q", name: "Q" }, { id: "p", name: "P" }] });
  assert.ok(c.drawing, c.issues.join("; "));
  const at = (id: string) => c.drawing!.parts.find((p) => p.id === id)!.anchor;
  // (5, 5) on 0..10 axes in a 460×300 box at (80, 30) → (310, 180).
  assert.deepEqual([at("e").x, at("e").y], [310, 180]);
  assert.deepEqual([at("q").x, at("q").y], [310, 330]);
  assert.deepEqual([at("p").x, at("p").y], [80, 180]);
  const parallel = compileDiagram({ w: 600, h: 400, elements: [{ t: "plot", x: 80, y: 30, w: 460, h: 300, xAxis: { min: 0, max: 10 }, yAxis: { min: 0, max: 10 }, series: [{ kind: "line", points: [[0, 1], [10, 2]], part: "a" }, { kind: "line", points: [[0, 5], [10, 6]], part: "b" }], intersections: [{ of: ["a", "b"] }] }], parts: [{ id: "a", name: "A" }, { id: "b", name: "B" }] });
  assert.match(parallel.issues.join(" "), /do not cross/);
  const loop = compileDiagram({ w: 400, h: 300, elements: [{ t: "loop", x: 50, y: 50, w: 140, h: 120, direction: "clockwise", color: "red", part: "h" }, { t: "loop", x: 210, y: 50, w: 140, h: 120, direction: "anticlockwise", color: "blue", part: "f" }], parts: [{ id: "h", name: "Hadley cell" }, { id: "f", name: "Ferrel cell" }] });
  assert.ok(loop.drawing, loop.issues.join("; "));
  assert.equal(loop.drawing!.shapes.filter((s) => s.part === "h" && s.t === "path" && s.fill === "#dc2626").length, 4, "four arrowheads in the cell's colour");
});

test("free shapes keep their meaning colours", () => {
  const c = compileDiagram({ w: 400, h: 300, elements: [{ t: "arrow", x1: 20, y1: 20, x2: 200, y2: 20, stroke: "red", part: "a" }, { t: "rect", x: 20, y: 60, w: 100, h: 80, fill: "blue", part: "b" }, { t: "circle", cx: 300, cy: 150, r: 50, fill: "green", part: "c" }], parts: [{ id: "a", name: "Warm air" }, { id: "b", name: "Box" }, { id: "c", name: "Ring" }] });
  assert.ok(c.drawing!.shapes.some((s) => s.t === "path" && s.stroke === "#dc2626"));
});

test("circulation cells turn the way physics allows: up where air rises, down where it sinks", () => {
  const c = compileDiagram({ w: 600, h: 300, elements: [{ t: "circulation", x: 20, y: 20, w: 560, h: 200, stops: [{ label: "30°N", flow: "sink" }, { label: "0°", flow: "rise", part: "itcz" }], cells: [{ part: "hadley" }] }], parts: [{ id: "hadley", name: "Hadley cell" }, { id: "itcz", name: "ITCZ" }] });
  assert.ok(c.drawing, c.issues.join("; "));
  // The arrowhead on the cell's right side (rising at the equator) points up: its tip is its highest point.
  const heads = c.drawing!.shapes.filter((s) => s.t === "path" && s.part === "hadley" && s.d.endsWith("Z") && !s.d.includes("Q"));
  const right = heads.map((s) => (s as { d: string }).d.match(/-?\d+(\.\d+)?/g)!.map(Number)).find((n) => n[0] > 500)!;
  assert.ok(right[3] < right[1] && right[3] < right[5], "the right-side head points up");
  assert.match(compileDiagram({ w: 600, h: 300, elements: [{ t: "circulation", x: 20, y: 20, w: 560, h: 200, stops: [{ flow: "rise" }, { flow: "rise" }] }], parts: [{ id: "x", name: "X" }] }).issues.join(" "), /rise at one and sink at the other/);
  const beam = compileDiagram({ w: 600, h: 300, elements: [{ t: "rect", x: 300, y: 50, w: 8, h: 200, fill: "yellow", part: "foil" }, { t: "beam", from: [40, 150], at: [304, 150], groups: [{ count: 6, turn: 0, part: "s" }, { count: 1, turn: 170, part: "b" }] }], parts: [{ id: "foil", name: "Gold foil" }, { id: "s", name: "Straight through" }, { id: "b", name: "Bounced back" }] });
  assert.ok(beam.drawing, beam.issues.join("; "));
  assert.equal(beam.drawing!.shapes.filter((s) => s.part === "s" && s.t === "path" && !s.d.endsWith("Z")).length, 6);
});

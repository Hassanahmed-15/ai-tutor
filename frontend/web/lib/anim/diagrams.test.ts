import test from "node:test";
import assert from "node:assert/strict";
import { parseDiagramSpec, numbersInSpec, flattenElements, DIAGRAM_STYLE_VERSION } from "../diagrams/spec";
import { project, validLonLat, clampLat, clampLon } from "../diagrams/project";
import { checkDiagram, fitText } from "../diagrams/check";
import { compileDiagram, repeatPlacements } from "../diagrams/render";
import { diagramCacheKey } from "../diagrams/cache";
import { acceptDiagram } from "../diagrams/write";
import { componentFitsSubject, hasVisualForm, isRealProcess, needsVectorDiagram } from "../diagrams/visualForm";
import { FIXTURES, fixtureBoard, CHROMOSOME_SETS, ENERGY_BUDGET, OCEAN_CURRENTS, ALPHA_SCATTER } from "../diagrams/fixtures";
import { layoutPanel } from "../canvas/layout";
import { validateCanvasSpec } from "../canvas/validate";
import { applyLessonVisualPolicy, pictureRequestProblem } from "../canvas/visualPolicy";
import { alignToNarration } from "../canvas/narrationSync";
import type { CanvasPlanBeat } from "../canvas/types";
// These tests check which ready-made kit a board is routed to. Course lessons switch picture kits off by
// default (lib/canvas/courseFigures.ts, tested in coursePicture.test.ts); the routing itself is checked here.
process.env.CANVAS_COURSE_READY_FIGURES = "on";
// …and the code diagrams themselves (owner, 2026-10-24: course lessons draw everything with gpt-image-2).
process.env.CANVAS_COURSE_CODE_DIAGRAMS = "on";


test("parseDiagramSpec accepts a closed grammar and drops unknown kinds", () => {
  const spec = parseDiagramSpec({
    w: 640, h: 400, base: "world-map",
    elements: [
      { t: "region", id: "box", s: 0, part: "Cell", shape: "rect", x: 10, y: 10, w: 40, h: 20, fill: "blue" },
      { t: "script", id: "evil", code: "alert(1)" },
      { t: "arrow", id: "a", s: 1, from: { id: "box" }, to: { x: 80, y: 80 }, label: "out" },
    ],
  });
  assert.ok(spec);
  assert.equal(spec.base, "world-map");
  assert.equal(spec.elements.length, 2);
  assert.ok(spec.elements.every((el) => el.t === "region" || el.t === "arrow"));
});

test("parseDiagramSpec returns null when nothing drawable remains", () => {
  assert.equal(parseDiagramSpec({ elements: [] }), null);
  assert.equal(parseDiagramSpec(null), null);
});

test("equirectangular projection puts the equator mid-height and Greenwich on the left-centre", () => {
  const box = { x: 0, y: 0, w: 360, h: 180 };
  const origin = project(0, 0, box);
  assert.equal(origin.x, 180);
  assert.equal(origin.y, 90);
  const north = project(0, 90, box);
  assert.equal(north.y, 0);
  assert.equal(clampLat(100), 90);
  assert.equal(clampLon(190), -170);
  assert.equal(validLonLat(-80, 26), true);
  assert.equal(validLonLat(200, 0), false);
});

test("repeat placements produce exact counts", () => {
  assert.equal(repeatPlacements(23, "grid", { x: 0, y: 0, w: 100, h: 100 }).length, 23);
  assert.equal(repeatPlacements(46, "grid", { x: 0, y: 0, w: 100, h: 100 }).length, 46);
  assert.equal(repeatPlacements(4, "row", { x: 0, y: 0, w: 90, h: 10 }).length, 4);
  assert.equal(repeatPlacements(6, "ring", { x: 0, y: 0, w: 80, h: 80 }).length, 6);
});

test("a vertical rod is a capsule, not a circle", () => {
  const drawing = compileDiagram(parseDiagramSpec({
    w: 80, h: 80, elements: [{ t: "region", id: "chr", s: 0, shape: "rod", x: 10, y: 10, w: 8, h: 40, fill: "blue" }],
  })!);
  const path = drawing.shapes.find((s) => s.t === "path");
  assert.ok(path && path.t === "path");
  assert.match(path.d, /V/);
});

test("compileDiagram draws repeat n as n shapes", () => {
  const spec = parseDiagramSpec({
    w: 400, h: 300, elements: [
      { t: "repeat", id: "set", s: 0, part: "n = 23", n: 23, layout: "grid", x: 20, y: 20, w: 200, h: 200, of: { t: "region", shape: "rod", w: 6, h: 16, fill: "blue" } },
    ],
  })!;
  const drawing = compileDiagram(spec);
  const rods = drawing.shapes.filter((s) => s.t === "path" && s.part?.startsWith("set-") || (s.t === "path" && s.part === "set-1") || s.part?.startsWith("set"));
  // Each rod is one path; the repeat id itself is not a path.
  assert.equal(drawing.shapes.filter((s) => s.t === "path").length, 23);
  assert.ok(drawing.parts.some((p) => p.name.includes("23")));
});

test("checkDiagram repairs overlap, clamps map coordinates, and never rejects", () => {
  const spec = parseDiagramSpec({
    w: 400, h: 300, base: "world-map",
    elements: [
      { t: "label", id: "a", s: 0, text: "Gulf Stream", at: { x: 40, y: 40 } },
      { t: "label", id: "b", s: 0, text: "Peru Current", at: { x: 40, y: 40 } },
      { t: "map-mark", id: "bad", s: 0, lon: 400, lat: 120, label: "Off" },
      { t: "arrow", id: "ghost", s: 0, from: { id: "missing" }, to: { x: 10, y: 10 } },
      { t: "label", id: "long", s: 0, text: "This label is far too long to fit in the thirty-four character room on a board", at: { x: 200, y: 80 }, leader: false },
    ],
  })!;
  const out = checkDiagram(spec, "The Gulf Stream is a warm current. The Peru Current is cold.");
  assert.ok(out.spec.elements.some((el) => el.t === "label"));
  assert.ok(out.repairs.length >= 1);
  const mark = out.spec.elements.find((el) => el.t === "map-mark");
  assert.ok(mark && mark.t === "map-mark");
  assert.ok(mark.lat <= 90 && mark.lon <= 180);
  assert.ok(!out.spec.elements.some((el) => el.id === "ghost"));
  const long = out.spec.elements.find((el) => el.id === "long");
  assert.ok(long && long.t === "label" && long.text.length <= 34);
  assert.ok(!long.text.includes("…"));
});

test("checkDiagram lists invented numbers as fact issues but still ships", () => {
  const spec = parseDiagramSpec({
    w: 400, h: 300, elements: [
      { t: "label", id: "n", s: 0, text: "n = 99", at: { x: 40, y: 40 }, leader: false },
      { t: "repeat", id: "set", s: 0, n: 99, layout: "row", x: 10, y: 60, w: 200, h: 20, of: { t: "region", shape: "rod", w: 4, h: 12 } },
    ],
  })!;
  const out = checkDiagram(spec, "A haploid nucleus has n = 23 chromosomes.");
  assert.ok(out.factIssues.length >= 1);
  assert.ok(out.spec.elements.length >= 1);
});

test("checkDiagram snaps a repeat count to the narration", () => {
  const spec = parseDiagramSpec({
    w: 400, h: 300, elements: [
      { t: "repeat", id: "set", s: 0, part: "haploid", n: 24, layout: "grid", x: 10, y: 10, w: 100, h: 100, of: { t: "region", shape: "rod", w: 6, h: 14 } },
    ],
  })!;
  const out = checkDiagram(spec, "Humans have n = 23 in a haploid nucleus.");
  const rep = out.spec.elements.find((el) => el.t === "repeat");
  assert.ok(rep && rep.t === "repeat");
  assert.equal(rep.n, 23);
});

test("series points pass through the narration's stated values after repair", () => {
  const spec = parseDiagramSpec({
    w: 640, h: 400, elements: [
      { t: "axis", id: "ax", s: 0, x: 40, y: 20, w: 500, h: 300, xLabel: "lat", yLabel: "E", xMin: -90, xMax: 90, yMin: -120, yMax: 120 },
      { t: "series", id: "c", s: 0, axis: "ax", points: [{ x: 0, y: 79 }, { x: 40, y: 1 }, { x: 90, y: -99 }] },
    ],
  })!;
  const out = checkDiagram(spec, "The surplus at the equator is 80 units. At 40 degrees it is zero. At the poles the deficit is 100 units.");
  const series = out.spec.elements.find((el) => el.t === "series");
  assert.ok(series && series.t === "series");
  assert.ok(series.points.some((p) => p.y === 80 || Math.abs(p.y - 80) < 1));
});

test("fitText never uses an ellipsis", () => {
  const t = fitText("The subtropical high pressure belt at thirty degrees", 20);
  assert.ok(t.length <= 20);
  assert.ok(!t.includes("…"));
});

test("every acceptance fixture compiles, validates and lays out with labels", () => {
  for (const fix of FIXTURES) {
    const spec = fixtureBoard(fix);
    const valid = validateCanvasSpec(spec, 6);
    assert.ok(valid, `${fix.id} did not validate`);
    assert.equal(valid!.stage.kind, "diagram");
    const layout = layoutPanel(valid!);
    const figure = layout.marks.find((m) => m.type === "figure");
    assert.ok(figure && figure.type === "figure", `${fix.id} has no figure mark`);
    assert.ok(figure.drawing.shapes.length >= 3, `${fix.id} drawing is empty`);
    const labels = layout.marks.filter((m) => m.type === "figure-label" || (m.type === "text" && m.text));
    const onDiagram = figure.drawing.shapes.filter((s) => s.t === "text");
    assert.ok(labels.length + onDiagram.length >= 1, `${fix.id} has no labels`);
    for (const m of layout.marks) {
      if (m.type === "figure-label") {
        assert.ok(m.at.x >= 0 && m.at.x <= 1000, `${fix.id} label ${m.part} off canvas`);
        assert.ok(m.leader.length >= 2);
      }
    }
  }
});

test("chromosome fixture draws exact n = 23 and 2n = 46", () => {
  const drawing = compileDiagram(CHROMOSOME_SETS.spec);
  const rods = drawing.shapes.filter((s) => s.t === "path");
  assert.ok(rods.length >= 23 + 46);
  const checked = checkDiagram(CHROMOSOME_SETS.spec, CHROMOSOME_SETS.script);
  const repeats = flattenElements(checked.spec.elements).filter((el) => el.t === "repeat");
  assert.deepEqual(repeats.map((r) => r.t === "repeat" ? r.n : 0).sort((a, b) => a - b), [23, 46]);
});

test("ocean current fixture uses warm red and cold blue", () => {
  const drawing = compileDiagram(OCEAN_CURRENTS.spec);
  const strokes = drawing.shapes.map((s) => ("stroke" in s ? s.stroke : "")).join(" ");
  assert.ok(strokes.includes("#dc2626") || strokes.includes("warm"), "warm current");
  assert.ok(strokes.includes("#2563eb") || strokes.includes("cold"), "cold current");
});

test("energy fixture's series includes the narration's 80, 40 and 100", () => {
  const nums = numbersInSpec(ENERGY_BUDGET.spec);
  assert.ok(nums.includes(80) && nums.includes(40) && nums.some((n) => Math.abs(n) === 100));
});

test("acceptDiagram compiles a model payload and ignores scripts", () => {
  const out = acceptDiagram({
    stage: {
      kind: "diagram",
      spec: { w: 400, h: 300, elements: [{ t: "region", id: "foil", s: 0, part: "Gold foil", shape: "rect", x: 100, y: 40, w: 10, h: 200 }] },
      parts: [{ id: "foil", name: "Gold foil", s: 0 }],
    },
  }, "Alpha particles strike a thin gold foil.");
  assert.ok(out);
  assert.equal(out.parts[0].id, "foil");
});

test("cache keys are stable for the same subject and parts", () => {
  const a = diagramCacheKey("Ocean currents", ["Gulf Stream", "Peru Current"], [1]);
  const b = diagramCacheKey("ocean currents", ["Peru Current", "Gulf Stream"], [1]);
  assert.equal(a, b);
  assert.ok(a.startsWith("asset-"));
  assert.notEqual(a, diagramCacheKey("Ocean currents", ["Gulf Stream"], [1]));
  assert.equal(DIAGRAM_STYLE_VERSION, "vector-1");
});

test("routing helpers: maps and counts need a vector diagram; a cycle is a process", () => {
  assert.equal(needsVectorDiagram("A world map of ocean currents: Gulf Stream and Peru Current"), true);
  assert.equal(hasVisualForm("three-cell model of atmospheric circulation"), true);
  assert.equal(isRealProcess("Evaporation then condensation then precipitation, a cycle"), true);
  assert.equal(componentFitsSubject("shapes3d", "Hadley cell and Ferrel cell atmospheric circulation"), false);
  assert.equal(componentFitsSubject("shapes3d", "Volume of a cuboid 3 by 4 by 5"), true);
});

test("pictureRequestProblem blocks maps and counts even when they are physical", () => {
  assert.ok(pictureRequestProblem("a world map of ocean currents", ["Gulf Stream", "Peru Current"]));
  assert.ok(pictureRequestProblem("46 chromosomes in 23 pairs", ["chromosome"]));
});

test("diagram parts appear on the sentence that names them", () => {
  const spec = fixtureBoard(ALPHA_SCATTER);
  if (spec.stage.kind !== "diagram") throw new Error("expected diagram");
  spec.stage.parts.forEach((p) => { p.s = 3; });
  alignToNarration(spec, { script: ALPHA_SCATTER.script });
  const foil = spec.stage.parts.find((p) => /foil/i.test(p.name) || p.id === "foil");
  assert.ok(foil);
  assert.equal(foil.s, 0, "gold foil is named in the first sentence");
});

test("routing order: exact kit, then vector diagram, never an unrelated solid", () => {
  const kit: CanvasPlanBeat = {
    id: "b1", title: "Setting up the titration", script: "Burette, pipette and conical flask for an acid-base titration.",
    stage: "flow", brief: "Burette, pipette, conical flask", objects: [], inside: null, carry: [], interaction: null, overview: false,
  };
  const geo: CanvasPlanBeat = {
    id: "b2", title: "Atmospheric circulation", script: "The three-cell model has Hadley, Ferrel and Polar cells with trade winds.",
    stage: "flow", brief: "three-cell model of atmospheric circulation", objects: [], inside: null, carry: [], interaction: null, overview: false,
  };
  const exam: CanvasPlanBeat = {
    id: "b3", title: "Exam practice", script: "Answer the question.", stage: "exam", brief: "exam", objects: [], inside: null, carry: [], interaction: null, overview: false,
  };
  const out = applyLessonVisualPolicy([kit, geo, exam], { mode: "course", aiPictures: true });
  assert.equal(out.beats[0].stage, "figure");
  assert.equal(out.beats[0].figure, "titration");
  // A circulation model is drawn by the coordinate grammar first ("drawn"); the scene grammar is its fallback.
  assert.equal(out.beats[1].stage, "figure");
  assert.equal(out.beats[1].figure, "drawn");
  assert.equal(out.beats[2].stage, "exam");
});

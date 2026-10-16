import { test } from "node:test";
import assert from "node:assert/strict";
import type { FigureComponent, FigureDrawing, FigureParams } from "../figures/types";
import { coordinateGrid, transformPoint, parseCurve, parsePoints, parseTransform, curveText } from "../figures/components/coordinateGrid";
import { numberLine, parseInequality, intervalsText, integerSolutions, valueText } from "../figures/components/numberLine";
import { parallelLines, relatedAngle, parsePair } from "../figures/components/parallelLines";
import { bearings, backBearing, bearingText, parseLegs, placeLegs, bearingOf } from "../figures/components/bearings";
import { shapes3d, coneSlant, pyramidSlant, visibility, parseSolid } from "../figures/components/shapes3d";

const COMPONENTS: FigureComponent[] = [coordinateGrid, numberLine, parallelLines, bearings, shapes3d];

function checkDrawing(c: FigureComponent, d: FigureDrawing, label: string) {
  const declared = c.parts.map((p) => p.id);
  const built = d.parts.map((p) => p.id);
  for (const id of built) assert.ok(declared.includes(id), `${label}: ${id} is declared`);
  assert.equal(new Set(built).size, built.length, `${label}: part ids are unique`);
  for (const p of d.parts) {
    assert.ok(Number.isFinite(p.anchor.x) && Number.isFinite(p.anchor.y), `${label}: ${p.id} anchor finite`);
    assert.ok(p.anchor.x >= 0 && p.anchor.x <= d.w && p.anchor.y >= 0 && p.anchor.y <= d.h, `${label}: ${p.id} anchor inside ${d.w}×${d.h}`);
    assert.ok(p.name.length > 0 && p.name.length <= 34, `${label}: ${p.id} name fits a label (${p.name})`);
  }
  for (const s of d.shapes) {
    if (s.part) assert.ok(built.includes(s.part), `${label}: shape names an unbuilt part ${s.part}`);
    if (s.t === "text") assert.ok(s.x >= 0 && s.x <= d.w && s.y >= 0 && s.y <= d.h, `${label}: text "${s.text}" inside`);
    if (s.t === "path") assert.ok(!/NaN|Infinity/.test(s.d), `${label}: path has finite numbers`);
    if (s.t === "circle") assert.ok([s.cx, s.cy, s.r].every(Number.isFinite), `${label}: circle finite`);
  }
  assert.ok(d.w > 100 && d.h > 100 && d.w < 1400 && d.h < 1200, `${label}: sensible size ${d.w}×${d.h}`);
}

test("defaults build at least two declared parts, anchors inside", () => {
  for (const c of COMPONENTS) {
    const d = c.build({});
    checkDrawing(c, d, c.name);
    assert.ok(d.parts.length >= 2, `${c.name}: ≥2 parts by default`);
  }
});

test("varied and hostile params never throw and still draw", () => {
  const sets: Record<string, FigureParams[]> = {
    coordinateGrid: [
      { shape: "A(1,1); B(4,1); C(1,3)", transform: "reflection", mirror: "y = x" },
      { shape: "A(1,1) B(3,1) C(3,2) D(1,2)", transform: "rotate 90° clockwise about (1,0)" },
      { shape: "(2,1),(4,1),(2,2)", transform: "enlargement", scaleFactor: "-1/2", centre: "(0,0)" },
      { shape: "A(1,1); B(3,1); C(1,4)", transform: "translation", vector: "4,-5" },
      { line: "y = x^2 - 2x - 3", points: "P(3,0); Q(-1,0)", segments: "PQ" },
      { line: "x = 2" }, { line: "2x + 3y = 6", xRange: "-5,5", yRange: "-4,4" },
      { shape: "A(500,-900)", transform: "enlarge sf 9 about (40,40)" }, { transform: "rotation", angle: "abc" },
      { line: "y = = x" }, { shape: "nonsense", points: 7, mirror: "y=x^2", transform: "reflect" },
    ],
    numberLine: [{ inequality: "x > 3" }, { inequality: "x <= -2 or x > 4", integers: true }, { inequality: "3x - 2 > x + 4" }, { inequality: "-1 <= x <= 1", points: "A:-3; B:2.5" }, { inequality: "x > 5 and x < 2" }, { inequality: "0 < x < 1000", integers: true }, { inequality: "<<<" }, { inequality: 7, range: "zz" }],
    parallelLines: [{ angle: 115, pair: "alternate" }, { angle: 40, pair: "co-interior", solve: true }, { angle: 90, pair: "vertically opposite" }, { angle: 150, pair: "straight line" }, { angle: "nope", pair: 3 }, { angle: 9999 }],
    bearings: [{ legs: "A to B: 065°, 8 km; B to C: 150°, 5 km; C to A" }, { legs: "Port to Lighthouse: 300°, 12 km" }, { bearing: 270, distance: 4, bearing2: 0, distance2: 3 }, { legs: "A to A: 10" }, { legs: ";;;", bearing: "x" }, { legs: "A to B: 000°, 5 km" }, { legs: "A to B: 360, 0 km" }],
    shapes3d: SOLIDS_PARAMS(),
  };
  for (const c of COMPONENTS) for (const p of sets[c.name]) checkDrawing(c, c.build(p), `${c.name} ${JSON.stringify(p)}`);
});

function SOLIDS_PARAMS(): FigureParams[] {
  const out: FigureParams[] = [];
  for (const solid of ["cuboid", "cube", "triangular prism", "square-based pyramid", "cylinder", "cone", "sphere", "hemisphere"]) {
    for (const view of ["solid", "net", "both"]) out.push({ solid, view, units: "cm" });
  }
  out.push({ solid: "cone", radius: 3, slant: 5, unknown: "height" }, { solid: "cuboid", length: 0.1, width: 50, height: -3 }, { solid: "prism", triangle: "right", show: "letters", hidden: false }, { solid: "zz", length: "abc" });
  return out;
}

test("coordinateGrid: transformations are computed exactly", () => {
  const P = { x: 3, y: -2 };
  const refl = (m: string) => transformPoint({ kind: "reflection", mirror: parseCurve(m, true)! }, P);
  assert.deepEqual(refl("y = x"), { x: -2, y: 3 }, "reflection in y = x swaps the coordinates");
  assert.deepEqual(refl("y = -x"), { x: 2, y: -3 });
  assert.deepEqual(refl("x = 1"), { x: -1, y: -2 });
  assert.deepEqual(refl("y = 2"), { x: 3, y: 6 });
  assert.deepEqual(refl("the y-axis"), { x: -3, y: -2 });
  assert.deepEqual(transformPoint({ kind: "rotation", angle: 90, centre: { x: 0, y: 0 } }, { x: 2, y: 1 }), { x: -1, y: 2 }, "90° anticlockwise about O: (x, y) → (−y, x)");
  assert.deepEqual(transformPoint({ kind: "rotation", angle: -90, centre: { x: 0, y: 0 } }, { x: 2, y: 1 }), { x: 1, y: -2 }, "90° clockwise: (x, y) → (y, −x)");
  assert.deepEqual(transformPoint({ kind: "rotation", angle: 180, centre: { x: 1, y: 1 } }, { x: 3, y: 2 }), { x: -1, y: 0 });
  assert.deepEqual(transformPoint({ kind: "translation", vector: { x: 4, y: -5 } }, { x: 1, y: 1 }), { x: 5, y: -4 });
  const C = { x: 1, y: 2 }, A = { x: 3, y: 5 };
  const A2 = transformPoint({ kind: "enlargement", k: 2, centre: C }, A);
  assert.ok(Math.abs(Math.hypot(A2.x - C.x, A2.y - C.y) - 2 * Math.hypot(A.x - C.x, A.y - C.y)) < 1e-9, "sf 2 doubles distances from the centre");
  assert.deepEqual(transformPoint({ kind: "enlargement", k: -0.5, centre: { x: 0, y: 0 } }, { x: 4, y: 2 }), { x: -2, y: -1 }, "negative fractional sf goes through the centre");
  // Parsing the transformation from words.
  const t = parseTransform({ transform: "rotate 90° clockwise about (1,0)" })!;
  assert.ok(t.kind === "rotation" && t.angle === -90 && t.centre.x === 1 && t.centre.y === 0);
  const r = parseTransform({ transform: "reflect in y = -x" })!;
  assert.ok(r.kind === "reflection" && r.mirror.kind === "fn" && r.mirror.b === -1 && r.mirror.c === 0);
  const e = parseTransform({ transform: "enlargement", scaleFactor: "1/3" })!;
  assert.ok(e.kind === "enlargement" && Math.abs(e.k - 1 / 3) < 1e-12);
  // The drawing really puts A′ where the maths says.
  const d = coordinateGrid.build({ shape: "A(1,2); B(4,2); C(1,4)", transform: "reflection", mirror: "y = x" });
  assert.equal(d.parts.find((p) => p.id === "image-vertex")!.name, "Vertex A′(2, 1)");
  assert.equal(d.parts.find((p) => p.id === "mirror-line")!.name, "Mirror line y = x");
  const a = d.parts.find((p) => p.id === "vertex")!.anchor, a2 = d.parts.find((p) => p.id === "image-vertex")!.anchor;
  // A(1,2) → A′(2,1): one square right, one down — on screen dx = dy (y is down), perpendicular to y = x.
  assert.ok(a2.x - a.x > 1 && Math.abs((a2.x - a.x) - (a2.y - a.y)) < 1e-6, "A→A′ drawn one square right and one down");
});

test("coordinateGrid: equations are parsed (linear and quadratic)", () => {
  assert.deepEqual(parseCurve("y = 2x + 1"), { kind: "fn", a: 0, b: 2, c: 1 });
  assert.deepEqual(parseCurve("y = x² − 4"), { kind: "fn", a: 1, b: 0, c: -4 });
  assert.deepEqual(parseCurve("y=1/2x-3"), { kind: "fn", a: 0, b: 0.5, c: -3 });
  assert.deepEqual(parseCurve("x = 3"), { kind: "vertical", x: 3 });
  const g = parseCurve("2x + 3y = 6")!;
  assert.ok(g.kind === "fn" && Math.abs(g.b + 2 / 3) < 1e-12 && Math.abs(g.c - 2) < 1e-12);
  assert.equal(parseCurve("y = x^2", true), null, "a mirror must be straight");
  assert.equal(parseCurve("y = = 2"), null);
  assert.equal(curveText(parseCurve("y = -x + 3")!), "y = −x + 3");
  assert.equal(curveText(parseCurve("y = 0.5x - 1")!), "y = 1/2x − 1");
  assert.deepEqual(parsePoints("A(1,2); B(−4, 6.5)").map((p) => [p.name, p.p.x, p.p.y]), [["A", 1, 2], ["B", -4, 6.5]]);
});

test("numberLine: inequalities are parsed and solved", () => {
  assert.deepEqual(parseInequality("-2 < x ≤ 3"), [{ lo: -2, hi: 3, loClosed: false, hiClosed: true }]);
  assert.deepEqual(parseInequality("x >= 1"), [{ lo: 1, hi: Infinity, loClosed: true, hiClosed: false }]);
  assert.deepEqual(parseInequality("x < -1 or x >= 2"), [{ lo: -Infinity, hi: -1, loClosed: false, hiClosed: false }, { lo: 2, hi: Infinity, loClosed: true, hiClosed: false }]);
  assert.deepEqual(parseInequality("x > -3 and x <= 4"), [{ lo: -3, hi: 4, loClosed: false, hiClosed: true }]);
  assert.deepEqual(parseInequality("3x - 2 > x + 4"), [{ lo: 3, hi: Infinity, loClosed: false, hiClosed: false }], "solved: x > 3");
  assert.deepEqual(parseInequality("-7 <= 2x - 1 < 6"), [{ lo: -3, hi: 3.5, loClosed: true, hiClosed: false }]);
  assert.deepEqual(parseInequality("5 - 2x ≥ 1"), [{ lo: -Infinity, hi: 2, loClosed: false, hiClosed: true }], "dividing by a negative flips the sign");
  assert.deepEqual(parseInequality("x > 5 and x < 2"), [], "no solution");
  assert.deepEqual(parseInequality("x < 1 or x < 4"), [{ lo: -Infinity, hi: 4, loClosed: false, hiClosed: false }], "union merges");
  assert.equal(parseInequality("<<<"), null);
  assert.equal(intervalsText(parseInequality("-2 < x ≤ 3")!), "−2 < x ≤ 3");
  assert.deepEqual(integerSolutions(parseInequality("-2 < x ≤ 3")!, -10, 10), [-1, 0, 1, 2, 3]);
  assert.equal(valueText(7 / 3), "7/3");
  assert.equal(valueText(-1.5), "−1.5");
  const d = numberLine.build({ inequality: "-2 < x <= 3", integers: true });
  assert.ok(d.parts.some((p) => p.id === "open-circle") && d.parts.some((p) => p.id === "closed-circle"));
  assert.equal(d.parts.find((p) => p.id === "integers")!.name, "Integers −1, 0, 1, 2, 3");
  assert.ok(d.shapes.some((s) => s.t === "circle" && s.part === "open-circle" && s.fill === "paper"), "open circle is hollow");
  assert.ok(!numberLine.build({ inequality: "x >= 1" }).parts.some((p) => p.id === "open-circle"), "no open circle when every end is included");
});

test("parallelLines: angle pairs are related correctly and drawn to scale", () => {
  assert.equal(relatedAngle("co-interior", 65) + 65, 180, "co-interior angles sum to 180°");
  assert.equal(relatedAngle("corresponding", 65), 65);
  assert.equal(relatedAngle("alternate", 110), 110);
  assert.equal(relatedAngle("vertically-opposite", 40), 40);
  assert.equal(relatedAngle("straight-line", 40), 140);
  assert.equal(parsePair("allied angles"), "co-interior");
  assert.equal(parsePair("Z angles"), "alternate");
  for (const pair of ["corresponding", "alternate", "co-interior", "vertically-opposite", "straight-line"]) for (const angle of [35, 65, 90, 115, 150]) {
    const d = parallelLines.build({ angle, pair, solve: true });
    checkDrawing(parallelLines, d, `${pair} ${angle}`);
    const want = relatedAngle(parsePair(pair), angle);
    assert.ok(d.shapes.some((s) => s.t === "text" && s.text === `x = ${want}°`), `${pair} ${angle}: x = ${want}°`);
    assert.ok(d.shapes.some((s) => s.t === "text" && s.text === `${angle}°`));
  }
  // The transversal meets the lines at the given angle.
  const d = parallelLines.build({ angle: 50 });
  const t = d.shapes.find((s) => s.t === "path" && s.part === "transversal")!;
  const n = (t as { d: string }).d.match(/-?[\d.]+/g)!.map(Number);
  const ang = (Math.atan2(-(n[3] - n[1]), n[2] - n[0]) * 180) / Math.PI;
  assert.ok(Math.abs(Math.abs(ang) - 50) < 0.1 || Math.abs(Math.abs(ang) - 130) < 0.1, `transversal at 50° (${ang})`);
});

test("bearings: back bearing, placement and three-figure notation", () => {
  for (const b of [0, 65, 150, 180, 245, 300, 359]) {
    const bb = backBearing(b);
    assert.ok(bb === b + 180 || bb === b - 180, `back bearing of ${b} = ${bb}`);
  }
  assert.equal(bearingText(65), "065°");
  assert.equal(bearingText(5), "005°");
  assert.equal(bearingText(360), "000°");
  const legs = parseLegs("A to B: 065°, 8 km; B to C: 150°, 5 km; C to A");
  assert.equal(legs.length, 3);
  assert.deepEqual([legs[0].from, legs[0].to, legs[0].bearing, legs[0].distance, legs[0].unit], ["A", "B", 65, 8, "km"]);
  const { legs: L, pos } = placeLegs(legs);
  const B = pos.get("B")!;
  assert.ok(Math.abs(Math.hypot(B.x, B.y) - 8) < 1e-9 && Math.abs(bearingOf({ x: 0, y: 0 }, B) - 65) < 1e-9);
  assert.ok(L[2].computed && Math.abs(bearingOf(pos.get("C")!, { x: 0, y: 0 }) - L[2].bearing) < 1e-9, "closing leg computed");
  assert.ok(Math.abs(bearingOf({ x: 0, y: 0 }, { x: -1, y: 0 }) - 270) < 1e-9, "due west is 270°");
  const d = bearings.build({ legs: "A to B: 065°, 8 km" });
  assert.equal(d.parts.find((p) => p.id === "back-bearing")!.name, "Back bearing (A from B) 245°");
  assert.ok(d.shapes.some((s) => s.t === "text" && s.text === "065°") && d.shapes.some((s) => s.t === "text" && s.text === "245°"));
  assert.ok(d.shapes.some((s) => s.t === "path" && s.part === "back-bearing" && / 1 1 /.test(s.d)), "a reflex bearing is drawn as the large arc, clockwise");
});

test("shapes3d: hidden edges, derived lengths, every solid", () => {
  assert.equal(coneSlant(3, 4), 5);
  assert.ok(Math.abs(pyramidSlant(6, 4) - 5) < 1e-12);
  // A cuboid seen from front-right-top hides exactly the three edges at its back-bottom-left corner.
  const verts = [] as Array<{ x: number; y: number; z: number }>;
  for (const z of [0, 1]) for (const [x, y] of [[0, 0], [1, 0], [1, 1], [0, 1]]) verts.push({ x, y, z });
  const { faceVisible, edges } = visibility(verts, [[0, 1, 2, 3], [4, 5, 6, 7], [0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7]]);
  assert.deepEqual(faceVisible, [true, false, false, true, true, false]);
  const hidden = edges.filter((e) => !e.visible).map((e) => `${e.a}-${e.b}`).sort();
  assert.deepEqual(hidden, ["0-4", "4-5", "4-7"]);
  const cube = shapes3d.build({ solid: "cuboid", length: 8, width: 5, height: 4, units: "cm" });
  assert.equal(cube.shapes.filter((s) => s.part === "hidden-edge").length, 3);
  for (const t of ["8 cm", "5 cm", "4 cm"]) assert.ok(cube.shapes.some((s) => s.t === "text" && s.text === t), `${t} written`);
  assert.equal(shapes3d.build({ solid: "cuboid", hidden: false }).shapes.filter((s) => s.part === "hidden-edge").length, 0);
  const cone = shapes3d.build({ solid: "cone", radius: 3, height: 4, units: "cm" });
  assert.equal(cone.parts.find((p) => p.id === "slant-height")!.name, "Slant height 5 cm");
  const cone2 = shapes3d.build({ solid: "cone", radius: 5, slant: 13 });
  assert.equal(cone2.parts.find((p) => p.id === "height")!.name, "Perpendicular height 12", "height from r and l");
  const net = shapes3d.build({ solid: "cone", radius: 3, height: 4, view: "net" });
  assert.ok(net.shapes.some((s) => s.t === "text" && s.text === "216°"), "sector angle 360 × r / l");
  assert.ok(shapes3d.build({ solid: "cylinder", view: "both" }).parts.some((p) => p.id === "net"));
  assert.ok(!shapes3d.build({ solid: "sphere", view: "net" }).parts.some((p) => p.id === "net"), "a sphere has no net");
  assert.equal(parseSolid("square-based pyramid"), "square-pyramid");
  assert.equal(parseSolid("rectangular prism"), "cuboid");
  assert.equal(parseSolid("triangular prism"), "triangular-prism");
  const u = shapes3d.build({ solid: "cylinder", unknown: "height" });
  assert.ok(u.shapes.some((s) => s.t === "text" && s.text === "x"));
});

test("each component's match routes its own boards and not calculus/trig or the others'", () => {
  const cases: Array<[FigureComponent, string[], string[]]> = [
    [coordinateGrid, ["Reflect the triangle in the line y = x", "Rotate shape A 90° clockwise about the origin", "Enlarge the shape by scale factor 2", "Translate the triangle by the vector (3, -2)", "Plot the points on a coordinate grid", "Find the centre of enlargement", "Negative scale factor"], ["Differentiate y = x^2", "Graph of y = sin x", "Translation of mRNA at the ribosome", "Reflection of light at a plane mirror", "The Earth's rotation causes day and night", "Transformations of the graph y = f(x)", "A transformation chain rewrites sin²x with a double-angle identity before integration"]],
    [numberLine, ["Show the inequality on a number line", "Solving inequalities", "Represent −2 < x ≤ 3", "Find the integer values that satisfy -3 < n ≤ 2"].slice(0, 3).concat(["List the integer values of n that satisfy the inequality"]), ["The triangle inequality", "Income inequality in the UK", "Limits as x tends to infinity", "Plot the points on a grid"]],
    [parallelLines, ["Angles in parallel lines", "Alternate angles are equal", "Co-interior angles add up to 180°", "A transversal cuts two parallel lines", "Corresponding angles", "Vertically opposite angles"], ["Parallel circuits", "Circle theorems: the alternate segment theorem", "Angles in a triangle", "The derivative of sin x"]],
    [bearings, ["Three-figure bearings", "Find the bearing of B from A", "Back bearings", "A ship sails on a bearing of 065°"], ["Ball bearings reduce friction", "This has no bearing on the result", "Bearing in mind the units", "Roller bearings in a wheel hub", "Angles in parallel lines"]],
    [shapes3d, ["Volume of a cylinder", "Surface area of a cuboid", "The net of a cube", "Slant height of a cone", "Volume of a triangular prism", "A square-based pyramid", "Volume of a hemisphere", "3D shapes: faces, edges and vertices"], ["Cone cells in the retina", "Light through a prism splits into colours", "The left hemisphere of the brain", "Integrate sin x dx", "Bearings from north", "The volume of gas at STP"]],
  ];
  for (const [c, yes, no] of cases) {
    for (const t of yes) assert.ok(c.match.test(t), `${c.name} should match "${t}"`);
    for (const t of no) assert.ok(!c.match.test(t), `${c.name} should not match "${t}"`);
  }
});

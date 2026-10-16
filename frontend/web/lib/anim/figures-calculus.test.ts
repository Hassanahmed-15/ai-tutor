import { test } from "node:test";
import assert from "node:assert/strict";
import type { FigureComponent, FigureDrawing, FigureParams } from "../figures/types";
import { riemannSum, riemann } from "../figures/components/riemannSum";
import { slopeField, rk4, equilibria } from "../figures/components/slopeField";
import { unitCircle, unitCirclePoint, parseAngle } from "../figures/components/unitCircle";
import { functionGraph, graphFeatures } from "../figures/components/functionGraph";
import { fractionModel, fractionMaths, parseFraction } from "../figures/components/fractionModel";
import { fn1, fn2, integrate, normalizeExpr, verticalAsymptotes, horizontalAsymptote } from "../figures/components/calculusKit";
import { fracStr } from "../figures/components/mathsKit";

const COMPONENTS: FigureComponent[] = [riemannSum, slopeField, unitCircle, functionGraph, fractionModel];
const near = (a: number, b: number, tol = 1e-6) => Math.abs(a - b) < tol;

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
    if (s.t === "text") assert.ok(s.x >= 0 && s.x <= d.w && s.y >= 0 && s.y <= d.h && !/NaN|undefined/.test(s.text), `${label}: text "${s.text}" inside and finite`);
    if (s.t === "path") assert.ok(!/NaN|Infinity/.test(s.d), `${label}: path has finite numbers`);
    if (s.t === "circle") assert.ok([s.cx, s.cy, s.r].every(Number.isFinite), `${label}: circle finite`);
  }
  assert.ok(d.w > 100 && d.h > 60 && d.w < 1400 && d.h < 1400, `${label}: sensible size ${d.w}×${d.h}`);
}
const texts = (d: FigureDrawing) => d.shapes.flatMap((s) => (s.t === "text" ? [s.text] : []));

test("each component builds at least two declared parts from no params", () => {
  for (const c of COMPONENTS) {
    const d = c.build({});
    checkDrawing(c, d, c.name);
    assert.ok(d.parts.length >= 2, `${c.name}: ≥2 parts`);
  }
});

test("hostile params never throw and still draw", () => {
  const junk: FigureParams[] = [
    { f: "x^^2", a: "zz", b: -1e9, n: 9999, method: 7 },
    { dydx: "import('fs')", xmin: 5, xmax: 5, x0: "q" },
    { angle: "abc", units: 3 },
    { f: "1/0", g: "sqrt(-1)", shade: "between", tangentAt: "x" },
    { fractions: "9/0; -2/3; 100/2", model: "hexagon", operation: "divide" },
    { f: "ln(x)", a: -2, b: 2, xmin: "a", ymax: 1e9 },
    { fractions: "", equivalent: 99 },
  ];
  for (const c of COMPONENTS) for (const p of junk) checkDrawing(c, c.build(p), `${c.name} ${JSON.stringify(p)}`);
});

test("formulas: implicit multiplication and textbook notation parse safely", () => {
  assert.equal(normalizeExpr("y = 2x^2 - 3x"), "2*x^2 - 3*x");
  assert.ok(near(fn1("3sin x")!(Math.PI / 2), 3));
  assert.ok(near(fn1("(x-1)(x+2)")!(2), 4));
  assert.ok(near(fn1("e^x")!(1), Math.E));
  assert.ok(near(fn1("|x| + log10(100)")!(-3), 5));
  assert.equal(fn1("process.exit()"), null);
  assert.equal(fn1("y + 1"), null, "f(x) may only use x");
  assert.ok(near(fn2("x y")!(2, 3), 6));
});

test("riemann sums: left sum of x² on [0,2] with n=4 is 1.75 against the exact 8/3", () => {
  const f = (x: number) => x * x;
  assert.ok(near(riemann(f, 0, 2, 4, "left").approx, 1.75));
  assert.ok(near(riemann(f, 0, 2, 4, "right").approx, 3.75));
  assert.ok(near(riemann(f, 0, 2, 4, "midpoint").approx, 2.625));
  assert.ok(near(riemann(f, 0, 2, 4, "trapezoid").approx, 2.75));
  assert.ok(near(integrate(f, 0, 2), 8 / 3, 1e-9));
  const d = riemannSum.build({ f: "x^2", a: 0, b: 2, n: 4, method: "left" });
  checkDrawing(riemannSum, d, "riemann x²");
  const t = texts(d).join(" | ");
  assert.match(t, /L₄ = 7\/4 ≈ 1\.75/);
  assert.match(t, /8\/3 ≈ 2\.6667/);
  assert.equal(d.parts.length, 5);
  const trap = riemannSum.build({ f: "sin(x)", a: 0, b: Math.PI, n: 6, method: "trapezoid", exact: false });
  assert.ok(!trap.parts.some((p) => p.id === "exact-area"), "exact hidden when asked");
  assert.ok(trap.parts.find((p) => p.id === "rectangle")!.name.includes("trapezoid"));
});

test("slope fields: dy/dx = y through (0,1) is e^x; equilibria are found", () => {
  const f = (_x: number, y: number) => y;
  const pts = rk4(f, 0, 1, 1, 200);
  assert.ok(near(pts[pts.length - 1].y, Math.E, 1e-8), "RK4 gives e at x = 1");
  assert.deepEqual(equilibria((_x, y) => y * (2 - y), -3, 3, -3, 3), [0, 2]);
  assert.deepEqual(equilibria((x, y) => x - y, -3, 3, -3, 3), [], "x − y has no horizontal equilibrium");
  const d = slopeField.build({ dydx: "y", xmin: -2, xmax: 2, ymin: -1, ymax: 4, x0: 0, y0: 1 });
  checkDrawing(slopeField, d, "slope field y");
  assert.deepEqual(d.parts.map((p) => p.id).sort(), ["equilibrium", "initial-condition", "slope-segment", "solution-curve"]);
  assert.ok(d.shapes.filter((s) => s.part === "slope-segment").length > 60, "a full field of segments");
  const bare = slopeField.build({ dydx: "x + y", solution: false });
  assert.ok(!bare.parts.some((p) => p.id === "solution-curve"));
});

test("unit circle: 150° → (−√3/2, 1/2), reference 30°, quadrant II", () => {
  const p = unitCirclePoint(150);
  assert.equal(p.cosText, "−√3/2");
  assert.equal(p.sinText, "1/2");
  assert.equal(p.reference, 30);
  assert.equal(p.quadrant, 2);
  assert.equal(unitCirclePoint(-45).quadrant, 4);
  assert.equal(unitCirclePoint(-45).cosText, "√2/2");
  assert.equal(unitCirclePoint(-45).sinText, "−√2/2");
  assert.equal(unitCirclePoint(390).reference, 30);
  assert.equal(unitCirclePoint(240).tanText, "√3");
  assert.equal(unitCirclePoint(90).quadrant, 0);
  assert.ok(near(parseAngle("5π/6").deg, 150) && parseAngle("5pi/6").radians);
  assert.ok(near(parseAngle(-3 * Math.PI / 4, "rad").deg, -135));
  assert.equal(parseAngle("-3pi/4").text, "−3π/4");
  const d = unitCircle.build({ angle: 150 });
  checkDrawing(unitCircle, d, "unit circle 150");
  assert.ok(texts(d).includes("(−√3/2, 1/2)"));
  assert.ok(texts(d).includes("30°"));
  assert.ok(["angle", "terminal-side", "point", "sine", "cosine", "reference-angle", "quadrant"].every((id) => d.parts.some((p) => p.id === id)));
  // The point is drawn on the circle in the right place.
  const P = d.parts.find((q) => q.id === "point")!.anchor;
  const sine = d.parts.find((q) => q.id === "sine")!.anchor;
  assert.ok(near(P.x, sine.x, 0.01), "sine drawn straight down from the point");
  for (const angle of [0, 90, 180, 270, 45, 720, -390]) checkDrawing(unitCircle, unitCircle.build({ angle, tan: true }), `unit circle ${angle}`);
});

test("function graphs: roots, turning points, asymptotes, intersections are computed", () => {
  const a = graphFeatures((x) => x * x - 4, -5, 5);
  assert.deepEqual(a.roots, [-2, 2]);
  assert.equal(a.yIntercept, -4);
  const b = graphFeatures((x) => (x - 1) ** 2 + 2, -5, 5);
  assert.equal(b.turning.length, 1);
  assert.ok(near(b.turning[0].x, 1, 1e-5) && near(b.turning[0].y, 2, 1e-5) && b.turning[0].kind === "min");
  assert.deepEqual(graphFeatures((x) => (x - 1) ** 2, -5, 5).roots, [1], "a touching root counts");
  const r = graphFeatures((x) => 1 / (x - 2) + 1, -5, 5);
  assert.deepEqual(r.vertical, [2]);
  assert.deepEqual(r.horizontal, [1]);
  assert.deepEqual(r.roots, [1]);
  assert.deepEqual(verticalAsymptotes(Math.log, -2, 4), [0], "ln x has x = 0");
  assert.equal(horizontalAsymptote(Math.exp, -1), 0);
  assert.equal(horizontalAsymptote((x) => x * x, 1), undefined);
  const i = graphFeatures((x) => 4 - x * x, -5, 5, (x) => x + 2);
  assert.deepEqual(i.intersections.map((p) => [p.x, p.y]), [[-2, 0], [1, 3]]);
  const d = functionGraph.build({ f: "4 - x^2", g: "x + 2", shade: "between", tangentAt: 1 });
  checkDrawing(functionGraph, d, "graph 4 − x²");
  const t = texts(d).join(" | ");
  assert.match(t, /Area = 9\/2 ≈ 4\.5/);
  assert.match(t, /gradient = −2/);
  assert.ok(["curve", "second-curve", "root", "turning-point", "intersection", "shaded-region", "tangent"].every((id) => d.parts.some((p) => p.id === id)));
  const g = functionGraph.build({ f: "x^2 - 4" });
  assert.ok(texts(g).includes("(−2, 0)") && texts(g).includes("(2, 0)") && texts(g).includes("(0, −4)"));
  for (const f of ["sin(x)", "tan(x)", "e^x", "ln(x)", "1/x^2", "x^3 - 3x", "1/x"]) checkDrawing(functionGraph, functionGraph.build({ f }), `graph ${f}`);
});

test("fractions: 3/4 + 2/3 = 17/12 over the common denominator 12", () => {
  const a = parseFraction("3/4")!, b = parseFraction("2/3")!;
  const m = fractionMaths(a, b, "add");
  assert.equal(m.lcd, 12);
  assert.equal(m.aOver, 9);
  assert.equal(m.bOver, 8);
  assert.equal(fracStr(m.result!), "17/12");
  assert.equal(fractionMaths(a, b, "compare").relation, ">");
  assert.equal(fracStr(fractionMaths(a, b, "multiply").result!), "1/2");
  assert.equal(fracStr(fractionMaths(a, b, "subtract").result!), "1/12");
  assert.deepEqual(parseFraction("1 1/2"), { n: 3, d: 2 });
  assert.equal(parseFraction("3/0"), undefined);
  for (const model of ["bar", "area", "circle", "number-line"]) for (const operation of ["compare", "add", "subtract", "multiply", "none"]) {
    const d = fractionModel.build({ fractions: "3/4; 2/3", model, operation });
    checkDrawing(fractionModel, d, `fraction ${model} ${operation}`);
  }
  const add = fractionModel.build({ fractions: "3/4; 2/3", operation: "add" });
  assert.ok(["whole", "shaded-part", "unit-fraction", "common-denominator", "result"].every((id) => add.parts.some((p) => p.id === id)));
  assert.ok(add.parts.find((p) => p.id === "result")!.name.includes("17/12"));
  assert.ok(add.shapes.filter((s) => s.part === "shaded-part").length >= 3 + 2 + 17, "every part shaded, the sum in twelfths");
  const eq = fractionModel.build({ fractions: "3/4", equivalent: 2 });
  assert.ok(eq.parts.find((p) => p.id === "result")!.name.includes("6/8"));
});

test("match: the right boards ask for these figures, and others do not", () => {
  const yes: Array<[FigureComponent, string]> = [
    [riemannSum, "Approximating area with a left Riemann sum"], [riemannSum, "The trapezoidal rule for estimating an integral"], [riemannSum, "Area under the curve using rectangles"],
    [slopeField, "Sketching a slope field for dy/dx = x − y"], [slopeField, "Direction fields and equilibrium solutions"],
    [unitCircle, "Angles on the unit circle"], [unitCircle, "Finding the reference angle for 150°"], [unitCircle, "The CAST diagram"],
    [functionGraph, "Sketch the graph of y = x² − 4"], [functionGraph, "Finding turning points of a cubic"], [functionGraph, "Vertical asymptotes of rational functions"], [functionGraph, "Area between two curves"],
    [fractionModel, "Equivalent fractions with a fraction bar"], [fractionModel, "Adding fractions with a common denominator"], [fractionModel, "Unit fractions"],
  ];
  for (const [c, text] of yes) assert.ok(c.match.test(text), `${c.name} should match "${text}"`);
  const no: Array<[FigureComponent, string]> = [
    [riemannSum, "The Riemann hypothesis and prime numbers"], [riemannSum, "Volume of a cylinder"],
    [slopeField, "Slope of a straight line"], [slopeField, "Magnetic field lines"],
    [unitCircle, "Area of a circle"], [unitCircle, "Circle theorems: angle at the centre"],
    [functionGraph, "The structure of DNA"], [functionGraph, "Pythagoras' theorem"], [functionGraph, "Bar chart of rainfall"],
    [fractionModel, "Fractional distillation of crude oil"], [fractionModel, "Simplifying algebraic fractions"],
  ];
  for (const [c, text] of no) assert.ok(!c.match.test(text), `${c.name} should not match "${text}"`);
});

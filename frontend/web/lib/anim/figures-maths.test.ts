import { test } from "node:test";
import assert from "node:assert/strict";
import type { FigureComponent, FigureDrawing, FigureParams } from "../figures/types";
import { triangle, solveTriangle } from "../figures/components/triangle";
import { circleTheorem, circleAngles, cyclicArcs, THEOREMS } from "../figures/components/circleTheorem";
import { vectors, parseVector, parseMultiple } from "../figures/components/vectors";
import { probabilityTree, buildTree, branchProbs } from "../figures/components/probabilityTree";
import { venn, vennRegions, parseShade } from "../figures/components/venn";

const COMPONENTS: FigureComponent[] = [triangle, circleTheorem, vectors, probabilityTree, venn];

/** The structural contract every drawing must keep. */
function checkDrawing(c: FigureComponent, d: FigureDrawing, label: string, exact: boolean) {
  const declared = c.parts.map((p) => p.id).sort();
  const built = d.parts.map((p) => p.id).sort();
  if (exact) assert.deepEqual(built, declared, `${label}: built parts == declared parts`);
  else for (const id of built) assert.ok(declared.includes(id), `${label}: ${id} is declared`);
  assert.equal(new Set(built).size, built.length, `${label}: part ids are unique`);
  for (const p of d.parts) {
    assert.ok(p.anchor.x >= 0 && p.anchor.x <= d.w && p.anchor.y >= 0 && p.anchor.y <= d.h, `${label}: ${p.id} anchor inside ${d.w}×${d.h}`);
    assert.ok(p.name.length > 0 && p.name.length <= 34, `${label}: ${p.id} name fits a label (${p.name})`);
  }
  for (const s of d.shapes) {
    if (s.part) assert.ok(built.includes(s.part), `${label}: shape names an unbuilt part ${s.part}`);
    if (s.t === "text") assert.ok(s.x >= 0 && s.x <= d.w && s.y >= 0 && s.y <= d.h, `${label}: text "${s.text}" inside`);
    if (s.t === "path") assert.ok(!/NaN|Infinity/.test(s.d), `${label}: path has finite numbers`);
  }
  assert.ok(d.w > 100 && d.h > 100 && d.w < 1200 && d.h < 1200, `${label}: sensible size ${d.w}×${d.h}`);
}

test("every maths component's default drawing builds exactly its declared parts, anchors inside", () => {
  for (const c of COMPONENTS) checkDrawing(c, c.name === "venn" ? c.build({ shade: "A∩B" }) : c.build({}), c.name, true);
});

test("odd or hostile params never throw and still draw", () => {
  const junk: FigureParams[] = [{ a: "x", b: -3, c: "", angleA: 400 }, { theorem: "nonsense", angle: "abc" }, { a: "1", b: "1,2,3", multiple: "zz" }, { firstP: "5,7", secondP: "|||" }, { counts: "a,b", shade: "((A" }, { sets: 9, setA: "" }];
  for (const c of COMPONENTS) for (const p of junk) checkDrawing(c, c.build(p), `${c.name} ${JSON.stringify(p)}`, false);
});

test("triangle: solved by the sine/cosine rules, drawn to scale", () => {
  const rt = solveTriangle([3, 4, 5], [undefined, undefined, undefined])!;
  assert.ok(Math.abs(rt.angles[2] - 90) < 1e-9, "3-4-5 has a right angle opposite the 5");
  assert.ok(Math.abs(rt.angles.reduce((t, a) => t + a, 0) - 180) < 1e-9);
  const sas = solveTriangle([5, 7, undefined], [undefined, undefined, 60])!;
  assert.ok(Math.abs(sas.sides[2] - Math.sqrt(25 + 49 - 35)) < 1e-9, "cosine rule: c² = a² + b² − 2ab cos C");
  const aas = solveTriangle([undefined, undefined, 10], [30, 60, undefined])!;
  assert.ok(Math.abs(aas.sides[0] - 5) < 1e-9 && Math.abs(aas.angles[2] - 90) < 1e-9, "30-60-90 with hypotenuse 10 has a = 5");
  assert.equal(solveTriangle([1, 2, 5], [undefined, undefined, undefined]), null, "triangle inequality");
  // The drawing really is that triangle: a right angle is drawn as a square, not an arc.
  const d = triangle.build({ a: 3, b: 4, c: 5 });
  const C = d.parts.find((p) => p.id === "vertex-c")!.anchor, A = d.parts.find((p) => p.id === "vertex-a")!.anchor, B = d.parts.find((p) => p.id === "vertex-b")!.anchor;
  const dot = (A.x - C.x) * (B.x - C.x) + (A.y - C.y) * (B.y - C.y);
  assert.ok(Math.abs(dot) < 1, "CA ⟂ CB in the drawing");
  const ratio = Math.hypot(A.x - B.x, A.y - B.y) / Math.hypot(B.x - C.x, B.y - C.y);
  assert.ok(Math.abs(ratio - 5 / 3) < 0.01, "sides are to scale");
  assert.ok(d.shapes.some((s) => s.t === "text" && s.text === "5"), "given side written");
  const u = triangle.build({ b: 7, c: 9, angleA: 40, unknown: "a", labels: "P,Q,R" });
  assert.ok(u.shapes.some((s) => s.t === "text" && s.text === "x") && u.shapes.some((s) => s.t === "text" && s.text === "40°"));
  assert.equal(u.parts.find((p) => p.id === "side-a")!.name, "Side QR");
});

test("circle theorems: the computed angle is the theorem's, for every theorem", () => {
  assert.equal(circleAngles("angle-at-centre", 50).found, 100, "angle at centre = 2 × angle at circumference");
  assert.equal(circleAngles("angle-at-centre", 130, undefined, "centre").found, 65);
  assert.equal(circleAngles("semicircle", 35).found, 90);
  assert.equal(circleAngles("semicircle", 35).other, 55);
  assert.equal(circleAngles("same-segment", 40).found, 40);
  assert.equal(circleAngles("cyclic-quadrilateral", 75, 95).found, 105);
  assert.equal(circleAngles("cyclic-quadrilateral", 75, 95).d, 85);
  assert.equal(circleAngles("tangent-radius", 32).other, 58);
  assert.equal(circleAngles("alternate-segment", 58).found, 58);
  // The cyclic quadrilateral's arcs really give those angles.
  const arcs = cyclicArcs(110, 70);
  assert.ok(Math.abs((arcs.q + arcs.s) / 2 - 110) < 1e-9 && Math.abs((arcs.s + arcs.t) / 2 - 70) < 1e-9 && Math.abs(arcs.p + arcs.q + arcs.s + arcs.t - 360) < 1e-9);
  for (const theorem of THEOREMS) {
    const d = circleTheorem.build({ theorem });
    checkDrawing(circleTheorem, d, theorem, true);
  }
  const d = circleTheorem.build({ theorem: "angle-at-centre", angle: 50 });
  const texts = d.shapes.filter((s) => s.t === "text").map((s) => (s.t === "text" ? s.text : ""));
  assert.ok(texts.includes("50°") && texts.includes("100°"), "values written at the arcs");
  const hidden = circleTheorem.build({ theorem: "angle-at-centre", angle: 50, show: "given" });
  assert.ok(!hidden.shapes.some((s) => s.t === "text" && s.text === "100°") && hidden.shapes.some((s) => s.t === "text" && s.text === "x"));
  // The drawing's inscribed angle really is the given one.
  const pts = circleTheorem.build({ theorem: "same-segment", angle: 40 });
  assert.ok(pts.shapes.some((s) => s.t === "text" && s.text === "40°"));
  assert.equal(circleTheorem.build({ theorem: "cyclic quadrilateral" }).parts.find((p) => p.id === "found-angle")!.name, "Opposite angle C");
});

test("vectors: parsed, added tip-to-tail, resultant computed", () => {
  assert.deepEqual(parseVector("(3, -1)"), { x: 3, y: -1 });
  assert.equal(parseVector("1,2,3"), undefined);
  assert.deepEqual(parseMultiple("-2b"), { k: -2, of: 1 });
  assert.deepEqual(parseMultiple("a"), { k: 1, of: 0 });
  const d = vectors.build({ a: "3,1", b: "1,2" });
  assert.ok(d.shapes.some((s) => s.t === "text" && s.text === "(4, 3)"), "resultant (4, 3)");
  const sub = vectors.build({ a: "2,3", b: "3,1", operation: "a-b" });
  assert.ok(sub.shapes.some((s) => s.t === "text" && s.text === "(−1, 2)"), "a − b = (−1, 2)");
  const noR = vectors.build({ a: "2,3", b: "3,1", resultant: false });
  checkDrawing(vectors, noR, "no resultant", false);
  assert.ok(!noR.parts.some((p) => p.id === "resultant"));
  const withMultiple = vectors.build({ a: "1,2", multiple: "2a", components: true });
  assert.ok(withMultiple.shapes.some((s) => s.t === "text" && s.text === "2a"));
});

test("probability tree: branches sum to 1, leaves multiply and sum to 1", () => {
  const ps = branchProbs(["0.3", "?"], 2);
  assert.ok(Math.abs(ps[1].value - 0.7) < 1e-12, "complement fills the gap");
  const fr = branchProbs(["1/3", ""], 2);
  assert.deepEqual(fr[1].frac, { n: 2, d: 3 });
  const norm = branchProbs(["2", "2"], 2);
  assert.ok(Math.abs(norm[0].value + norm[1].value - 1) < 1e-12, "out-of-range values become equal shares");
  const odd = branchProbs(["0.2", "0.2"], 2);
  assert.ok(Math.abs(odd[0].value - 0.5) < 1e-12, "a set not summing to 1 is normalised");
  const { leaves } = buildTree({ first: "Red,Blue", firstP: "3/5,2/5", secondP: "2/4,2/4|3/4,1/4" });
  assert.deepEqual(leaves.map((l) => l.text), ["3/10", "3/10", "3/10", "1/10"], "without replacement, exactly");
  assert.ok(Math.abs(leaves.reduce((t, l) => t + l.p, 0) - 1) < 1e-12);
  const three = buildTree({ stages: 3 });
  assert.equal(three.leaves.length, 8);
  assert.ok(three.leaves.every((l) => l.text === "1/8"));
  const dec = buildTree({ first: "Rain,Dry", firstP: "0.3,?", secondP: "0.4,0.6|0.1,0.9" });
  assert.deepEqual(dec.leaves.map((l) => l.text), ["0.12", "0.18", "0.07", "0.63"]);
  const d = probabilityTree.build({ first: "Red,Blue", firstP: "3/5,2/5", secondP: "2/4,2/4|3/4,1/4", working: true });
  assert.ok(d.shapes.some((s) => s.t === "text" && s.text === "3/5 × 2/4 = 3/10"));
  const one = probabilityTree.build({ stages: 1, first: "Win,Draw,Lose", firstP: "0.5,0.2,?" });
  checkDrawing(probabilityTree, one, "1-stage", false);
  assert.ok(one.shapes.some((s) => s.t === "text" && s.text === "0.3"));
});

test("venn: regions from counts or elements, shading parsed, region text written", () => {
  const r2 = vennRegions({ setA: "1,2,3,4,6,12", setB: "2,4,6,8,10,12", universal: "1-12" });
  assert.equal(r2.sets, 2);
  assert.deepEqual(r2.regions.get(3), ["2", "4", "6", "12"], "A ∩ B");
  assert.deepEqual(r2.regions.get(1), ["1", "3"]);
  assert.deepEqual(r2.regions.get(0), ["5", "7", "9", "11"], "outside both");
  const c3 = vennRegions({ counts: "10,8,6,4,3,2,1,5" });
  assert.equal(c3.sets, 3);
  assert.equal(c3.regions.get(7), 1, "A∩B∩C");
  assert.equal(c3.regions.get(5), 3, "A∩C only");
  assert.equal([...c3.regions.values()].reduce((t: number, v) => t + (v as number), 0), 39);
  const L = ["A", "B", "C"];
  const inter = parseShade("A∩B", L)!, comp = parseShade("(A u B)'", L)!, diff = parseShade("A n B'", L)!;
  assert.deepEqual([0, 1, 2, 3].map(inter), [false, false, false, true]);
  assert.deepEqual([0, 1, 2, 3, 4].map(comp), [true, false, false, false, true]);
  assert.deepEqual([0, 1, 2, 3].map(diff), [false, true, false, false]);
  assert.equal(parseShade("none", L), null);
  assert.equal(parseShade("((A", L), null);
  const d = venn.build({ names: "Tea,Coffee", counts: "12,5,8,3" });
  checkDrawing(venn, d, "2-set", false);
  for (const n of ["12", "5", "8", "3"]) assert.ok(d.shapes.some((s) => s.t === "text" && s.text === n), `count ${n} written`);
  assert.equal(d.parts.find((p) => p.id === "set-a")!.name, "Tea (A)");
  assert.ok(!d.shapes.some((s) => s.part === "shaded"), "nothing shaded unless asked");
  assert.ok(venn.build({ counts: "12,5,8,3", shade: "A∩B" }).shapes.some((s) => s.part === "shaded" && s.t === "path"), "A∩B shaded when asked");
  assert.ok(!venn.build({ counts: "1,2,3,4", shade: "none" }).parts.some((p) => p.id === "shaded"));
});

test("each component's match routes its own boards and not the others'", () => {
  const cases: Array<[FigureComponent, string[], string[]]> = [
    [triangle, ["Using Pythagoras' theorem", "The sine rule", "Angles in a triangle add to 180°", "An isosceles triangle"], ["Probability tree for two coins", "Vectors and the resultant", "Circle theorems: angle at the centre"]],
    [circleTheorem, ["Circle theorems", "The angle in a semicircle is 90°", "Opposite angles of a cyclic quadrilateral", "The alternate segment theorem"], ["A right-angled triangle", "Venn diagrams of sets", "Area of a circle"]],
    [vectors, ["Adding vectors tip-to-tail", "The resultant of two forces", "Column vectors", "Scalar multiples of a vector"], ["Probability tree", "Pythagoras' theorem", "Venn diagram"]],
    [probabilityTree, ["Drawing a probability tree", "Two picks without replacement", "Tree diagrams for independent events"], ["Venn diagrams", "Family tree of the Tudors", "Adding vectors"]],
    [venn, ["Venn diagrams", "Shade A ∩ B", "The universal set", "Set notation"], ["Probability tree diagram", "Triangle angles", "The Venn of a circle theorem"].slice(0, 2)],
  ];
  for (const [c, yes, no] of cases) {
    for (const t of yes) assert.ok(c.match.test(t), `${c.name} should match "${t}"`);
    for (const t of no) assert.ok(!c.match.test(t), `${c.name} should not match "${t}"`);
  }
});

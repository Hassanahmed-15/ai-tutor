import test from "node:test";
import assert from "node:assert/strict";
import { figureComponent, figureFor } from "../figures/registry";
import { layoutPanel, type Mark } from "../canvas/layout";
import type { CanvasBoardSpec } from "../canvas/types";

const proof = figureComponent("pythagorasProof")!;
const area = figureComponent("areaModel")!;

test("the Pythagoras proof: the slid triangles and the two new gaps tile the square exactly", () => {
  for (const [a, b] of [[3, 4], [1, 2], [5, 5], [2, 7]]) {
    const d = proof.build({ a, b });
    const tris = d.shapes.filter((s) => s.t === "path" && s.part === "triangles");
    assert.equal(tris.length, 4);
    assert.equal(tris.filter((t) => t.move).length, 3, "three triangles slide, one stays");
    // Sample the square: after the slide every point is in exactly one triangle, a² or b².
    const pts = (d: string) => [...d.matchAll(/(-?\d+\.?\d*) (-?\d+\.?\d*)/g)].map((m) => [Number(m[1]), Number(m[2])] as [number, number]);
    const inTri = (x: number, y: number, p: Array<[number, number]>) => {
      const [[x1, y1], [x2, y2], [x3, y3]] = p;
      const den = (y2 - y3) * (x1 - x3) + (x3 - x2) * (y1 - y3);
      const l1 = ((y2 - y3) * (x - x3) + (x3 - x2) * (y - y3)) / den;
      const l2 = ((y3 - y1) * (x - x3) + (x1 - x3) * (y - y3)) / den;
      return l1 > 0.001 && l2 > 0.001 && 1 - l1 - l2 > 0.001;
    };
    const moved = tris.map((t) => pts((t as { d: string }).d).slice(0, 3).map(([x, y]) => [x + (t.move?.dx ?? 0), y + (t.move?.dy ?? 0)] as [number, number]));
    const sq = (part: string) => pts((d.shapes.find((s) => s.t === "path" && s.part === part && s.fill !== "none") as { d: string }).d);
    const box = (p: Array<[number, number]>) => ({ x0: Math.min(...p.map((q) => q[0])), x1: Math.max(...p.map((q) => q[0])), y0: Math.min(...p.map((q) => q[1])), y1: Math.max(...p.map((q) => q[1])) });
    const A = box(sq("a-square"));
    const B = box(sq("b-square"));
    const big = box(pts((d.shapes.find((s) => s.t === "path" && s.part === "square") as { d: string }).d));
    let bad = 0;
    for (let x = big.x0 + 0.7; x < big.x1; x += 4.3)
      for (let y = big.y0 + 0.7; y < big.y1; y += 4.3) {
        const inA = x > A.x0 && x < A.x1 && y > A.y0 && y < A.y1 ? 1 : 0;
        const inB = x > B.x0 && x < B.x1 && y > B.y0 && y < B.y1 ? 1 : 0;
        if (moved.filter((t) => inTri(x, y, t)).length + inA + inB !== 1) bad++;
      }
    assert.ok(bad < 12, `a=${a} b=${b}: ${bad} sample points not covered exactly once`);
    // And before the slide the four triangles + c² fill it: c² = (a+b)² − 2ab, i.e. a² + b².
    const side = big.x1 - big.x0;
    const u = side / (a + b);
    assert.ok(Math.abs((a * u) ** 2 + (b * u) ** 2 - (side ** 2 - 2 * a * u * b * u)) < 1e-6);
  }
});

test("the proof is chosen for proof boards only; a plain Pythagoras calculation keeps the triangle", () => {
  assert.equal(figureFor("Proving Pythagoras' theorem: four right-angled triangles inside a square")?.name, "pythagorasProof");
  assert.equal(figureFor("Why Pythagoras' theorem is true: a rearrangement proof with squares")?.name, "pythagorasProof");
  assert.equal(figureFor("Pythagoras' theorem: find the hypotenuse of a right-angled triangle")?.name, "triangle");
  assert.notEqual(figureFor("Proof by induction of the sum of squares")?.name, "pythagorasProof");
});

test("the area model: expand pieces add up; completing the square moves the strip and leaves (b/2)²", () => {
  const e = area.build({ mode: "expand", p: 3, q: 2 });
  const texts = e.shapes.filter((s) => s.t === "text").map((s) => (s as { text: string }).text);
  for (const t of ["x²", "3x", "2x", "6"]) assert.ok(texts.includes(t), `expand shows ${t}`);
  const c = area.build({ mode: "complete-square", b: 6 });
  const moving = c.shapes.filter((s) => s.move);
  assert.ok(moving.some((s) => s.move!.rotate === 90 && s.t === "path"), "one strip turns a quarter and slides under the square");
  const ct = c.shapes.filter((s) => s.t === "text").map((s) => (s as { text: string }).text);
  for (const t of ["x²", "6x", "3x", "9", "x + 3"]) assert.ok(ct.includes(t), `complete-square shows ${t}`);
  const odd = area.build({ mode: "complete-square", b: 5 });
  assert.ok(odd.shapes.some((s) => s.t === "text" && s.text === "25/4"), "(5/2)² is written exactly");
});

test("the area model is chosen only when the picture is asked for, never for fractions", () => {
  assert.equal(figureFor("Completing the square as an area: the strip and the missing corner")?.name, "areaModel");
  assert.equal(figureFor("Expanding double brackets with the grid method and an area rectangle")?.name, "areaModel");
  assert.notEqual(figureFor("Completing the square to find the turning point")?.name, "areaModel");
  assert.notEqual(figureFor("Adding fractions with an area model")?.name, "areaModel");
});

test("a timed figure carries its parts' sentences; an untimed figure's mark is unchanged", () => {
  const spec = (component: string, params: Record<string, string | number>, parts: Array<{ id: string; name: string; s: number }>) => ({ v: 1, heading: "H", notes: [], cues: [], stage: { kind: "figure", component, params, parts } }) as unknown as CanvasBoardSpec;
  const timed = layoutPanel(spec("pythagorasProof", {}, [{ id: "triangles", name: "t", s: 1 }, { id: "step-slide", name: "s", s: 3 }]));
  const fig = timed.marks.find((m): m is Extract<Mark, { type: "figure" }> => m.type === "figure")!;
  assert.deepEqual(fig.timing, { triangles: 1, "step-slide": 3 });
  // Every part named on the first sentence: drawn whole, as before.
  const plain = layoutPanel(spec("vectors", {}, [{ id: "vector-a", name: "a", s: 0 }]));
  const pf = plain.marks.find((m): m is Extract<Mark, { type: "figure" }> => m.type === "figure")!;
  assert.equal(pf.timing, undefined);
  // A part named later is drawn when it is named (owner, 2026-10-23: diagrams appear part by part).
  const later = layoutPanel(spec("vectors", {}, [{ id: "vector-a", name: "a", s: 1 }]));
  const lf = later.marks.find((m): m is Extract<Mark, { type: "figure" }> => m.type === "figure")!;
  assert.deepEqual(lf.timing, { "vector-a": 1 });
  assert.ok(lf.drawing.shapes.some((sh) => sh.part === "vector-a" && sh.show === "vector-a"), "its shapes wait for its sentence");
});

test("the live 'Proof by rearrangement' board (it never says 'Pythagoras') gets the moving proof, whatever its visual label", async () => {
  const { applyLessonVisualPolicy } = await import("../canvas/visualPolicy");
  const live = "Now use four identical right triangles, each with legs a and b and hypotenuse c, inside a large square of side a plus b. Their four hypotenuses form a central square, whose side is c and whose area is c squared. The four triangles occupy four times one-half ab, leaving the central square. Rearranging the same four triangles changes their positions but not their total area, leaving squares with areas a squared and b squared. Therefore the large square gives c squared equals a squared plus b squared.";
  const mk = (id: string, title: string, script: string, stage: string, visualType?: string) => ({ id, title, script, stage, brief: title, objects: [], inside: null, carry: [], interaction: null, overview: false, ...(visualType ? { visualType } : {}) }) as never;
  for (const visualType of [undefined, "diagram", "sequence", "math", "concept"]) {
    const out = applyLessonVisualPolicy([
      mk("b1", "Squares on a right triangle", "Take a three-four-five triangle. The squares on the shorter sides have areas 9 and 16, and 9 plus 16 equals 25.", "scene", visualType),
      mk("b2", "Proof by rearrangement", live, "flow", visualType),
      mk("b3", "Finding a missing side", "Identify the hypotenuse. c squared equals 6 squared plus 8 squared, which is 100, so c is 10 centimetres.", "equation", visualType),
    ], { mode: "course", aiPictures: false });
    const b2 = out.beats.find((b) => b.id === "b2")!;
    assert.equal(b2.stage, "figure", `visual ${visualType}: ${JSON.stringify(out.audit).slice(0, 600)}`);
    assert.equal(b2.figure, "pythagorasProof", `visual ${visualType}`);
    assert.notEqual(out.beats.find((b) => b.id === "b1")!.figure, "pythagorasProof", "no proof on the 3-4-5 counting board");
    assert.notEqual(out.beats.find((b) => b.id === "b3")!.figure, "pythagorasProof", "no proof on the calculation board");
  }
});

test("the proof's steps follow the narration even when the writer put every part on sentence 0 and forgot the slide", async () => {
  const { alignToNarration } = await import("../canvas/narrationSync");
  const script = "Now use four identical right triangles, each with legs a and b and hypotenuse c, inside a large square of side a plus b. Their four hypotenuses form a central square, whose side is c and whose area is c squared. The four triangles occupy four times one-half ab, leaving the central square. Rearranging the same four triangles changes their positions but not their total area, leaving squares with areas a squared and b squared. Therefore the large square gives c squared equals a squared plus b squared.";
  const spec = { v: 1, heading: "Proof by rearrangement", notes: [], cues: [], stage: { kind: "figure", component: "pythagorasProof", params: { a: 3, b: 4 }, parts: [{ id: "square", name: "Square", s: 0 }, { id: "triangles", name: "Triangles", s: 0 }, { id: "c-square", name: "c²", s: 1 }, { id: "a-square", name: "a²", s: 0 }, { id: "b-square", name: "b²", s: 0 }] } } as unknown as CanvasBoardSpec;
  alignToNarration(spec, { script });
  const at = Object.fromEntries((spec.stage as { parts: Array<{ id: string; s: number }> }).parts.map((p) => [p.id, p.s]));
  assert.equal(at.triangles, 0);
  assert.equal(at["c-square"], 1);
  assert.equal(at["step-slide"], 3, "the slide is the 'Rearranging' sentence");
  assert.equal(at["a-square"], 3);
  assert.equal(at["b-square"], 3);
});

test("'rearrange the formula' on a calculation board is not a proof", () => {
  assert.notEqual(figureFor("Finding a missing leg: rearrange Pythagoras' theorem to a² = c² − b², then square-root to find the shorter side of the right-angled triangle")?.name, "pythagorasProof");
  assert.equal(figureFor("Rearranging the four triangles inside the square proves Pythagoras' theorem")?.name, "pythagorasProof");
});

test("the logic circuit is parsed from its expression and its truth table is computed, not written", async () => {
  const { parseLogic, truthTable } = await import("../figures/components/logicCircuit");
  const t = truthTable("(A OR B) AND NOT R")!;
  assert.deepEqual(t.vars, ["A", "B", "R"]);
  const row = (a: number, b: number, r: number) => t.rows.find((x) => x.inputs.join() === [a, b, r].map(Boolean).join())!.output;
  assert.equal(row(1, 0, 0), true);
  assert.equal(row(1, 0, 1), false);
  assert.equal(row(0, 0, 0), false);
  assert.equal(truthTable("A XOR B")!.rows.map((r) => Number(r.output)).join(""), "0110");
  assert.equal(truthTable("NOT (A AND B)")!.rows.map((r) => Number(r.output)).join(""), "1110");
  assert.ok(parseLogic("A ∧ ¬B ∨ C"));
  assert.equal(parseLogic("A AND (B OR"), null);
  const fig = figureComponent("logicCircuit")!.build({ expression: "(A OR B) AND NOT R", output: "Warning" });
  assert.ok(fig.shapes.filter((s) => s.t === "text" && /^[01]$/.test(s.text)).length === 8 * 4, "8 rows × 4 columns of 0/1");
  assert.equal(figureFor("Logic gates: AND, OR and NOT gates and their truth tables")?.name, "logicCircuit");
});

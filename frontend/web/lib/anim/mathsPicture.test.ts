import test from "node:test";
import assert from "node:assert/strict";
import { applyLessonVisualPolicy } from "../canvas/visualPolicy";
import { layoutPanel } from "../canvas/layout";
import { MATHS_BOARD_LOOK, mathsBoardContext, mathsFieldsPrompt, mathsPicturePrompt, parseMathsFields, withMathsBoardWriting } from "../canvas/mathsPicturePrompt";
import type { CanvasBoardSpec, CanvasPlanBeat, CanvasStage } from "../canvas/types";

// MATHS PICTURES (owner, 2026-10-25): a typed-prompt or PDF maths lecture draws what no code figure fits
// with gpt-image-2, white on black — and NOTHING else changes: courses, computer science, other subjects,
// videos and every board a code figure draws stay exactly as they were.

function beat(id: string, title: string, stage: CanvasStage, script: string, extra: Partial<CanvasPlanBeat> = {}): CanvasPlanBeat {
  return { id, title, script, stage, brief: title, objects: [], inside: null, carry: [], interaction: null, overview: false, ...extra };
}

// A board no code figure draws (a hexagon's lines of symmetry), one a code figure draws (a right-angled
// triangle), a working board and a flow.
const mathsPlan = () => [
  beat("b1", "Lines of symmetry of a regular hexagon", "sketch", "A regular hexagon has six lines of symmetry. Three join opposite corners and three join the midpoints of opposite sides."),
  beat("b2", "The right-angled triangle", "figure", "Triangle ABC has a right angle at C. Side AB is the hypotenuse, opposite the right angle.", { plannedFigure: "triangle" }),
  beat("b3", "Expanding the area", "equation", "The area is (a + b) squared, which is a² + 2ab + b². Subtract the four triangles to leave c²."),
  beat("b4", "Steps of the proof", "flow", "First draw the square, then place the triangles, then compare the areas."),
];

const route = (plan: CanvasPlanBeat[], options: Parameters<typeof applyLessonVisualPolicy>[1]) => Object.fromEntries(applyLessonVisualPolicy(plan, options).beats.map((b) => [b.id, `${b.stage}${b.mathsPicture ? "+maths-picture" : ""}${b.figure ? `:${b.figure}` : ""}`]));

test("a typed-prompt maths lecture: EVERY drawing is a gpt-image-2 picture (owner, 2026-10-26); working, flows and the rest as before", () => {
  const before = route(mathsPlan(), { mode: "prompt", topic: "Symmetry of polygons" });
  const after = route(mathsPlan(), { mode: "prompt", topic: "Symmetry of polygons", mathsPictures: true });
  assert.equal(after.b1, "illustration+maths-picture", "no code figure draws it");
  assert.equal(after.b2, "illustration+maths-picture", "a code figure board is a picture too");
  assert.equal(after.b4, before.b4, "a flow stays a flow");
  assert.match(after.b3, /^equation/, "working stays working");
  assert.equal(before.b2.startsWith("figure") || before.b2.startsWith("equation"), true, "it was a code figure");
});

test("code-first (CANVAS_MATHS_CODE_FIGURES=on): the drawing no code figure fits is a gpt-image-2 picture; the rest is as before", () => {
  const before = route(mathsPlan(), { mode: "prompt", topic: "Symmetry of polygons" });
  const after = route(mathsPlan(), { mode: "prompt", topic: "Symmetry of polygons", mathsPictures: "code-first" });
  assert.equal(after.b1, "illustration+maths-picture", "no code figure draws a hexagon's lines of symmetry");
  assert.equal(before.b1, "sketch", "it was a sketch");
  for (const id of ["b2", "b3", "b4"]) assert.equal(after[id], before[id], `${id} unchanged (${before[id]})`);
  assert.match(after.b2, /figure:triangle|equation:triangle/, "a code figure still comes first");
});

test("a PDF maths lecture (reference and strict) gets it too", () => {
  for (const mode of ["reference", "strict"] as const) {
    assert.equal(route(mathsPlan(), { mode, topic: "Symmetry of polygons", mathsPictures: true }).b1, "illustration+maths-picture", mode);
  }
});

test("nothing else changes: off by default, never a course, never computer science, never another subject", () => {
  const off = route(mathsPlan(), { mode: "prompt", topic: "Symmetry of polygons" });
  assert.ok(!Object.values(off).some((v) => v.includes("maths-picture")), "only when the lecture asks (a video or the old canvas route never does)");
  const course = mathsPlan().map((b) => ({ ...b, subject: "maths" as const, course: true }));
  assert.ok(!Object.values(route(course, { mode: "course", topic: "Symmetry of polygons", mathsPictures: true })).some((v) => v.includes("maths-picture")), "a course lesson keeps its own pictures");
  const cs = [beat("b1", "Backtracking permutations", "sketch", "Each call swaps one element and recurses on the rest, then swaps back.")];
  assert.ok(!route(cs, { mode: "prompt", topic: "Generating permutations with backtracking", mathsPictures: true }).b1.includes("maths-picture"), "computer science is not maths");
  const bio = [beat("b1", "Inside a leaf", "sketch", "The palisade layer sits under the upper epidermis.")];
  assert.ok(!route(bio, { mode: "prompt", topic: "Leaf structure", mathsPictures: true }).b1.includes("maths-picture"), "biology is not maths");
});

test("the lecture's judged subject decides: maths yes; a chemistry \"Formulae\" or computer science no", () => {
  const stamped = (subject: "maths" | "cs" | "other") => mathsPlan().map((b) => ({ ...b, subject }));
  assert.equal(route(stamped("maths"), { mode: "prompt", topic: "Symmetry of polygons", mathsPictures: true }).b1, "illustration+maths-picture");
  assert.ok(!Object.values(route(stamped("other"), { mode: "prompt", topic: "Formulae", mathsPictures: true })).some((v) => v.includes("maths-picture")), "judged chemistry");
  assert.ok(!Object.values(route(stamped("cs"), { mode: "prompt", topic: "Symmetry of polygons", mathsPictures: true })).some((v) => v.includes("maths-picture")), "judged computer science");
});

test("a board the chooser called working or an idea is not drawn", () => {
  const plan = [beat("b1", "Lines of symmetry of a regular hexagon", "sketch", "A regular hexagon has six lines of symmetry.", { visualType: "math" })];
  assert.ok(!route(plan, { mode: "prompt", topic: "Symmetry of polygons", mathsPictures: true }).b1.includes("maths-picture"));
});

test("the picture prompt: the whole board's context, white on black, minimal, labels exact", () => {
  const b = mathsPlan()[0];
  const spec = { v: 1, heading: "Four triangles in a square", notes: [{ id: "n1", text: "Big square: side a + b", s: 0 }], stage: { kind: "illustration", subject: "x", parts: [], labels: [] }, cues: [] } as unknown as CanvasBoardSpec;
  const ctx = withMathsBoardWriting(mathsBoardContext("Proof of Pythagoras theorem", b, { source: ["Page 3: the square of side a + b"], strict: true }), spec);
  const fields = parseMathsFields({ diagram_type: "square of side a + b with four right triangles inside", scope: "the whole square", view: "flat, square upright", parts: [{ name: "tilted square", where: "centre", looks: "side c" }, { name: "triangle", where: "each corner", looks: "legs a and b" }], must_be_true: ["four congruent right triangles"], labels: [{ text: "c", points_to: "tilted square", position: "beside its top side", sentence: 1 }], exact_text: ["a", "b"] }, ctx);
  assert.ok(fields, "planned");
  assert.equal(fields!.family, "maths");
  const prompt = mathsPicturePrompt(ctx, fields!) as Record<string, any>;
  assert.equal(prompt.look, MATHS_BOARD_LOOK);
  assert.match(prompt.look, /black background/i);
  assert.match(prompt.look, /white/i);
  assert.equal(prompt.board_context.what_the_teacher_says, b.script, "every sentence she says");
  assert.deepEqual(prompt.board_context.written_on_the_board_beside_it, ["Heading: Four triangles in a square", "Note (sentence 0): Big square: side a + b"]);
  assert.deepEqual(prompt.board_context.what_the_students_document_says, ["Page 3: the square of side a + b"]);
  assert.ok(prompt.strict_source, "a strict PDF draws only what its document says");
  assert.match(prompt.minimal, /One figure/);
  assert.deepEqual(prompt.labels.draw_exactly.map((l: { text: string }) => l.text), ["c"]);
  assert.match(mathsFieldsPrompt(ctx).user, /What Aria says, sentence by sentence/);
});

test("on the board: a maths picture has no paper, frame or tape; every other picture keeps its frame", () => {
  const spec = (onBoard: boolean) => ({ v: 1, heading: "Proof", notes: [{ id: "n1", text: "Four triangles", s: 0 }], stage: { kind: "illustration", subject: "square", parts: [], labels: [], src: "/x", paper: "#000000", ...(onBoard ? { onBoard: true } : {}) }, cues: [] } as unknown as CanvasBoardSpec);
  const picture = (s: CanvasBoardSpec) => layoutPanel(s).marks.find((m) => m.type === "picture") as { onBoard?: boolean } | undefined;
  assert.equal(picture(spec(true))?.onBoard, true);
  assert.equal(picture(spec(false))?.onBoard, undefined);
});

test("code-first: rejected once, drawn by gpt-image-2 the second time — every code-drawn maths board is marked, nothing else", async () => {
  const { asMathsPicture } = await import("../canvas/mathsPicturePrompt");
  const out = applyLessonVisualPolicy(mathsPlan(), { mode: "prompt", topic: "Symmetry of polygons", mathsPictures: "code-first" }).beats;
  const marked = (id: string) => out.find((b) => b.id === id)!.mathsPictureFallback === true;
  assert.ok(marked("b2"), "a code figure board");
  assert.ok(!marked("b1"), "already a picture");
  assert.ok(!marked("b4"), "a flow is not a drawing");
  const off = applyLessonVisualPolicy(mathsPlan(), { mode: "prompt", topic: "Symmetry of polygons" }).beats;
  assert.ok(!off.some((b) => b.mathsPictureFallback), "never without the lecture asking");
  const course = applyLessonVisualPolicy(mathsPlan().map((b) => ({ ...b, subject: "maths" as const, course: true })), { mode: "course", topic: "Symmetry of polygons", mathsPictures: "code-first" }).beats;
  assert.ok(!course.some((b) => b.mathsPictureFallback || b.mathsPicture), "never a course lesson");
  // The switch: a figure board becomes a picture board; a working board keeps its working, the picture beside it.
  const figureBoard = asMathsPicture({ ...mathsPlan()[1], stage: "figure", figure: "triangle", mathsPictureFallback: true });
  assert.equal(figureBoard.stage, "illustration");
  assert.equal(figureBoard.figure, undefined);
  assert.ok(figureBoard.mathsPicture && figureBoard.mathsPictureAsDrawn && !figureBoard.mathsPictureFallback);
  const working = asMathsPicture({ ...mathsPlan()[2], figure: "triangle", mathsPictureFallback: true });
  assert.equal(working.stage, "equation");
  assert.equal(working.figure, undefined);
  assert.ok(working.mathsPicture && working.mathsPictureAsDrawn);
});

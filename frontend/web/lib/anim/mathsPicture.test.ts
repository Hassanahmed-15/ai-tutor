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

test("no code library in a maths lecture (owner, 2026-10-26): a graph is a picture too; a failed picture is written, never code-drawn", async () => {
  const plan = [
    beat("b1", "The graph of y = x² − 4", "graph", "The curve crosses the x-axis at −2 and 2. Its lowest point is (0, −4)."),
    beat("b2", "Solving x² − 4 = 0", "equation", "We add 4 to both sides, so x² = 4, which gives x = 2 or x = −2."),
  ];
  const out = route(plan, { mode: "prompt", topic: "Solving quadratic equations", mathsPictures: true });
  assert.equal(out.b1, "illustration+maths-picture", "the graph is drawn by gpt-image-2");
  assert.match(out.b2, /^equation/, "working stays working");
  const { fallbackSpec } = await import("../canvas/fallback");
  const written = fallbackSpec({ ...plan[0], stage: "illustration", mathsPicture: true, boardNotes: [{ s: 0, text: "Roots: x = −2, x = 2" }, { s: 1, text: "Lowest point (0, −4)" }] });
  assert.equal(written.stage.kind, "sketch");
  assert.deepEqual((written.stage as { items: Array<{ type: string; text: string }> }).items.map((i) => i.type), ["text", "text"], "Aria's lines, written — no shapes");
});

test("gpt-image-2 sees the whole lecture: every board in order, this board's place, what the earlier boards wrote and drew, what comes next", () => {
  const plan = [
    beat("b1", "Lines of symmetry of a regular hexagon", "sketch", "A regular hexagon ABCDEF has six lines of symmetry."),
    beat("b2", "Rotational symmetry of the hexagon", "sketch", "Turning ABCDEF by 60 degrees about its centre O maps it onto itself."),
    beat("b3", "Symmetry of other polygons", "sketch", "A square has four lines of symmetry."),
  ];
  const earlier = [{ heading: "Lines of symmetry", notes: [{ text: "6 lines of symmetry" }], stage: { kind: "illustration", description: "Regular hexagon ABCDEF with its six dashed lines of symmetry through O." } }];
  const ctx = mathsBoardContext("Symmetry of polygons", plan[1], { plan, index: 1, earlier });
  assert.equal(ctx.lecture.position, "board 2 of 3");
  assert.equal(ctx.lecture.outline.length, 3);
  assert.match(ctx.lecture.outline[1], /← THIS BOARD/);
  assert.match(ctx.lecture.earlier[0], /6 lines of symmetry/);
  assert.match(ctx.lecture.earlier[0], /hexagon ABCDEF with its six dashed lines/, "the earlier picture, so letters stay the same");
  assert.match(ctx.lecture.next, /Symmetry of other polygons/);
  const fields = parseMathsFields({ diagram_type: "regular hexagon ABCDEF rotated 60 degrees about O", scope: "the whole hexagon", view: "flat", parts: [{ name: "centre O", where: "middle", looks: "a dot" }], must_be_true: ["six equal sides"], labels: [{ text: "O", points_to: "centre O", position: "beside the centre", sentence: 0 }] }, ctx)!;
  const prompt = mathsPicturePrompt(ctx, fields) as Record<string, any>;
  assert.equal(prompt.lecture_context.this_board, "board 2 of 3");
  assert.equal(prompt.lecture_context.the_whole_lecture_board_by_board.length, 3);
  assert.ok(prompt.lecture_context.what_the_boards_before_this_one_wrote_and_drew.length === 1);
  assert.match(prompt.lecture_context.keep_consistent, /same letters/);
  assert.match(mathsFieldsPrompt(ctx).user, /The whole lecture, board by board/);
});

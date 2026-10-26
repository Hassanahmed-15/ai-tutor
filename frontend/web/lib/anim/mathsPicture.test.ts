import test from "node:test";
import assert from "node:assert/strict";
import { applyLessonVisualPolicy } from "../canvas/visualPolicy";
import { layoutPanel } from "../canvas/layout";
import { mathsMentionAt, partMentionCues } from "../canvas/pictureTalk";
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

test("Aria points at the maths picture (owner, 2026-10-26): a part named in a sentence gets the pointer, a note naming it a line to its printed label", () => {
  // The b6 board of a real Pythagoras lecture: legs a and b, hypotenuse c split into m and n. Only labels read
  // off the picture (labelBox) can be pointed at; "m" was not read here.
  const box = (x: number, y: number) => ({ x, y, w: 0.03, h: 0.05 });
  const spec = {
    v: 1, heading: "Similar-Triangle Ratios",
    notes: [{ id: "n1", text: "Legs: a and b", s: 0 }, { id: "n2", text: "Hypotenuse: c", s: 1 }, { id: "n3", text: "a² = cm", s: 2 }, { id: "n4", text: "Hypotenuse: m + n = c", s: 3 }],
    stage: { kind: "illustration", subject: "right triangle", src: "/x", paper: "#000000", onBoard: true, labels: [], parts: [
      { id: "label-1", name: "a", s: 0, x: 0.15, y: 0.47, labelBox: box(0.15, 0.45) },
      { id: "label-2", name: "b", s: 0, x: 0.5, y: 0.83, labelBox: box(0.49, 0.8) },
      { id: "label-3", name: "c", s: 0, x: 0.55, y: 0.28, labelBox: box(0.54, 0.26) },
      { id: "label-4", name: "m", s: 0, x: 0.37, y: 0.2 },
    ] },
    cues: [],
  } as unknown as CanvasBoardSpec;
  const script = "Draw a right-angled triangle with legs a and b and hypotenuse c. Its hypotenuse is split into two parts, m and n. So a² = c·m. Adding gives a² + b² = c(m + n) = c².";
  const cues = partMentionCues(spec, script);
  assert.deepEqual(cues.filter((c) => c.s === 0).map((c) => c.target), ["label-1", "label-2", "label-3"], "named in the sentence, in order");
  assert.equal(cues.some((c) => c.target === "label-4"), false, "a label not read off the picture is never pointed at");
  assert.equal(cues.some((c) => c.s >= 2), false, "letters in working are not parts being named");
  const links = layoutPanel({ ...spec, cues }).marks.filter((m) => m.type === "partLink") as Array<{ id: string; s: number }>;
  assert.deepEqual(links.map((l) => `${l.id}@${l.s}`), ["link-n1@0", "link-n1-1@0", "link-n2@1"], "\"Legs: a and b\" to a and b, \"Hypotenuse: c\" to c; working notes get none");
  // A course board is unchanged: no maths reading of symbols there.
  const course = { ...spec, course: true, stage: { ...(spec.stage as object), onBoard: undefined, coursePicture: true } } as unknown as CanvasBoardSpec;
  assert.equal(partMentionCues(course, script).length, 0, "one-letter names are symbols on a course picture, never followed");
});

test("which words name a maths label: after a word for the part, never inside working", () => {
  const named = (text: string, name: string) => mathsMentionAt(text, name) >= 0;
  assert.equal(named("Construct a trapezoid whose parallel bases have lengths a and b, and whose height is a + b.", "b"), true);
  assert.equal(named("Construct a trapezoid whose parallel bases have lengths a and b, and whose height is a + b.", "a + b"), true);
  assert.equal(named("The angle at C is the right angle.", "C"), true);
  assert.equal(named("A right-angled triangle has one angle of 90 degrees.", "A"), false, "an article is not vertex A");
  assert.equal(named("The large square has area (a + b)² because its side is a.", "a + b"), false);
  assert.equal(named("so a² = c·m and b² = c·n, where m + n = c.", "c"), false);
  assert.equal(named("The x-axis is horizontal.", "x"), false);
  assert.equal(named("A right triangle has one angle measuring 90 degrees, like the corner of a room.", "a"), false, "an article after a part word");
  assert.equal(named("Construct a large square with side length a plus b.", "a"), false, "working said aloud");
  assert.equal(named("Consider a right triangle with angle theta, opposite side a, adjacent side b, and hypotenuse c.", "a"), true);
  assert.equal(named("If the legs are a and b and the hypotenuse is c, the theorem holds.", "b"), true);
  assert.equal(named("this part here is the height.", "height"), true, "a label in words is found as on a course picture");
});

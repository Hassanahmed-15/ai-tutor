import test from "node:test";
import assert from "node:assert/strict";
import { courseBoardContext, coursePicturePrompt, curriculumOf, fieldsPrompt, labelsMatch, lettersToText, mustFix, parsePictureFields, PICTURE_FAMILIES, withCoursePicture, type CourseBoardContext } from "../canvas/coursePicturePrompt";
import type { CanvasBoardSpec, CanvasPlanBeat } from "../canvas/types";
import type { SuprnotesLessonInput } from "../suprnotes";

/*
 * A course lesson's picture is drawn from the board's own context and comes back with what Aria needs to
 * teach from it (owner, 2026-10-24: "it should know what's in the images … draw the exact diagram that is
 * needed, not some other part of it").
 */

const beat = {
  id: "b2", title: "Structure of an Artery", brief: "An artery's thick wall and narrow lumen.",
  script: "An artery carries blood away from the heart at high pressure. Its thick muscular and elastic wall stretches with each beat. The lumen in the middle is narrow.",
  requiredVisual: { stages: ["illustration"], mustShow: ["lumen"] },
} as unknown as CanvasPlanBeat;

const doc = {
  lesson: { title: "Blood vessels", subject: "Biology" },
  lessonPlan: { sourceType: "curriculum" },
  contentBlocks: [
    { id: "c1", heading: "Capillaries and exchange", text: "Capillaries are one cell thick.", keyIdeas: ["capillary wall one cell thick"], teachingHints: [], facts: [{ source: "Cambridge IGCSE Biology 0610" }] },
    { id: "c2", heading: "Artery structure", text: "Arteries have thick muscular walls and a narrow lumen.", keyIdeas: ["artery wall thick", "narrow lumen"], teachingHints: ["Level: IGCSE.", "Do not teach (outside this syllabus level): tunica names."], facts: [{ source: "Cambridge IGCSE Biology 0610" }] },
  ],
} as unknown as SuprnotesLessonInput;

test("a course board's context: its own syllabus block, every sentence Aria says, its curriculum", () => {
  const ctx = courseBoardContext(doc, "Blood vessels", beat)!;
  assert.ok(ctx.syllabus.includes("Arteries have thick muscular walls"), "the artery block, not the capillary block");
  assert.equal(ctx.sentences.length, 3);
  assert.equal(ctx.curriculum.name, "Cambridge");
  assert.ok(ctx.hints.some((h) => h.startsWith("Do not teach")), "what is out of scope for the level travels with it");
  assert.deepEqual(ctx.mustShow, ["lumen"]);
});

test("a lesson that is not a course lesson has no course context (it keeps the earlier picture path)", () => {
  assert.equal(courseBoardContext({ lessonPlan: { sourceType: "pdf" }, contentBlocks: [{ id: "x" }] } as unknown as SuprnotesLessonInput, "t", beat), null);
  assert.equal(courseBoardContext(null, "t", beat), null);
});

test("the curriculum is read from the course's framework", () => {
  assert.equal(curriculumOf("Cambridge IGCSE Biology 0610").name, "Cambridge");
  assert.equal(curriculumOf("AQA GCSE Chemistry 8462").name, "UK GCSE / A Level");
  assert.equal(curriculumOf("AP Biology (College Board)").name, "US");
  assert.equal(curriculumOf("FBISE SSC Physics").name, "Pakistan");
  assert.equal(curriculumOf("Some other syllabus").name, "international");
});

const fieldsJson = {
  family: "biology", audience: "a 15-year-old IGCSE student", diagram_type: "artery in cross-section", scope: "the whole artery", view: "transverse section, lumen in the centre",
  parts: [{ name: "lumen", where: "centre", looks: "small circle" }, { name: "muscular and elastic wall", where: "middle ring", looks: "thick" }, { name: "outer layer", where: "outer ring", looks: "thin" }],
  must_be_true: ["The wall is much thicker than the lumen is wide."],
  labels: [
    { text: "lumen", points_to: "lumen", position: "right margin, middle", sentence: 2 },
    { text: "Lumen", points_to: "lumen", position: "left margin, top", sentence: 2 },
    { text: "thick muscular and elastic wall", points_to: "muscular and elastic wall", position: "right margin, upper", sentence: 9 },
    ...["a", "b", "c", "d", "e"].map((x) => ({ text: `extra ${x}`, points_to: x, position: "left", sentence: 0 })),
  ],
};

test("the planner's fields: at most five labels (simple pictures, 2026-10-24), no duplicate label, sentences inside the narration", () => {
  const f = parsePictureFields(fieldsJson, 3)!;
  assert.equal(f.family, "biology");
  assert.equal(f.labels.length, 5);
  assert.equal(f.labels.filter((l) => l.text.toLowerCase() === "lumen").length, 1);
  assert.equal(f.labels.find((l) => l.text.startsWith("thick"))!.sentence, 2, "a sentence past the end is clamped to the last one");
  assert.equal(parsePictureFields({ ...fieldsJson, family: "astrology" }, 3)!.family, "other", "an unknown family, with no course to go by");
  assert.equal(parsePictureFields({ ...fieldsJson, family: "other" }, 3, "chemistry")!.family, "chemistry", "every course board is drawn: an answer outside the list is the course's family");
});

test("the JSON prompt carries the board's context and the exact scope to draw", () => {
  const ctx = courseBoardContext(doc, "Blood vessels", beat) as CourseBoardContext;
  const f = parsePictureFields(fieldsJson, 3)!;
  const p = coursePicturePrompt(ctx, f, ["the line from \"lumen\" must end on its part"]) as Record<string, any>;
  assert.ok(p.board_context.what_the_teacher_says.includes("The lumen in the middle is narrow."));
  assert.match(p.board_context.draw_exactly_this, /artery in cross-section: the whole artery/);
  assert.equal(p.labels.count, "Exactly 5 labels.");
  assert.match(p.simplicity, /one idea/, "a simple picture is asked for");
  assert.ok(Array.isArray(p.biology_rules) && p.biology_rules.length > 3);
  assert.ok(p.never.some((r: string) => /prophet/.test(r)), "the sensitive-content rules are always there");
  assert.match(p.corrections, /must end on its part/);
});

test("labels are checked letter by letter: a misspelling, a missing label or extra words fail", () => {
  assert.deepEqual(labelsMatch(["separator", "lumen"], ["separator", "Lumen", "+", "−"]), { ok: true, missing: [], extra: [] });
  const typo = labelsMatch(["separator"], [lettersToText("s-e-p-a-r-t-o-r")]);
  assert.equal(typo.ok, false);
  assert.deepEqual(typo.missing, ["separator"]);
  assert.deepEqual(labelsMatch(["lumen"], ["lumen", "NM bead(I) bromide"]).extra, ["nmbeadibromide"]);
  assert.equal(lettersToText("o-u-t-e-r / l-a-y-e-r"), "outer layer");
});

test("the board takes its picture's labels as its parts: pointed at on the sentence that names them, no callouts over the picture", () => {
  const spec = {
    heading: "Artery", notes: [],
    stage: { kind: "illustration", subject: "an artery", parts: [{ id: "p1", name: "lumen", s: 1, say: "The space blood flows through." }, { id: "p2", name: "valve", s: 0 }], labels: ["p1", "p2"] },
    cues: [{ s: 1, action: "point", target: "p2" }, { s: 0, action: "zoom" }],
  } as unknown as CanvasBoardSpec;
  const out = withCoursePicture(spec, {
    labels: [{ text: "Lumen", part: "lumen", sentence: 2, x: 0.5, y: 0.5 }, { text: "Outer layer", part: "outer layer", sentence: 1, x: 0.8, y: 0.3 }],
    fields: { diagramType: "artery in cross-section", labels: [{ text: "Lumen", pointsTo: "lumen", position: "", sentence: 2 }, { text: "Outer layer", pointsTo: "outer layer", position: "", sentence: 1 }] },
    description: "A round artery in cross-section with a narrow lumen in the centre.",
    paper: "#ffffff",
  }, "/api/canvas-lecture/image/asset-x");
  if (out.stage.kind !== "illustration") throw new Error("still a picture board");
  assert.deepEqual(out.stage.labels, [], "the labels are in the picture: none drawn over it");
  assert.deepEqual(out.stage.parts.map((p) => [p.id, p.name, p.s]), [["p1", "Lumen", 2], ["label-2", "Outer layer", 1]]);
  assert.equal(out.stage.parts[0].say, "The space blood flows through.", "the planned part keeps what Aria says when it is tapped");
  assert.deepEqual(out.stage.labelsInPicture, ["Lumen", "Outer layer"]);
  assert.match(out.stage.description!, /narrow lumen/);
  assert.ok(!out.cues.some((c) => c.target === "p2"), "a part the picture does not show is no longer pointed at");
  assert.ok(out.cues.some((c) => c.target === "label-2" && c.s === 1 && c.action === "point"), "each labelled part is pointed at as Aria names it");
});

test("only the owner's must-fix faults redraw a picture; style, edges and unneeded detail do not", () => {
  const clean = { missing: [], extra: [] };
  const allowed = mustFix(clean, {
    facts: [{ fact: "four chambers", true: true }],
    pointers: [{ label: "aorta", result: "right part" }, { label: "septum", result: "edge of right part" }],
    errors: [{ kind: "minor", what: "the wall texture could be clearer" }],
  });
  assert.deepEqual(allowed, [], "a line at the edge of the right part and a cosmetic remark are allowed");
  const faults = mustFix({ missing: ["separator"], extra: ["nmbeadibromide"] }, {
    facts: [{ fact: "the molten salt is heated", true: false, why: "no heat source" }],
    pointers: [{ label: "air column", result: "different part" }, { label: "right atrium", result: "no line" }],
    errors: [{ kind: "invented", what: "a valve inside the artery" }, { kind: "missing", what: "the septum" }, { kind: "sensitive", what: "a figure of a prophet" }, { kind: "minor", what: "colours" }],
  });
  assert.equal(faults.length, 8);
  assert.ok(faults.some((f) => f.includes('"separator"')) && faults.some((f) => f.includes("valve")) && faults.some((f) => f.startsWith("remove (not allowed)")));
});

test("course lessons: EVERY drawing is a gpt-image-2 picture, exact diagrams too; other lessons keep their figures", async () => {
  const { applyLessonVisualPolicy } = await import("../canvas/visualPolicy");
  const make = (id: string, title: string, figure: string, script: string): CanvasPlanBeat => ({
    // A course lesson's boards carry their course's subject (lib/canvas/lessonSubject.ts): biology and chemistry are "other".
    id, title, script, stage: "figure", figure, brief: title, objects: [], inside: null, carry: [], interaction: null, overview: false, subject: "other",
  } as unknown as CanvasPlanBeat);
  const lesson = () => [
    make("b1", "Structure of the heart", "heart", "The heart has four chambers. The left ventricle has the thickest wall."),
    make("b2", "Inheritance of a single gene", "punnettSquare", "A Punnett square shows the offspring of two heterozygous parents. Three in four show the dominant trait."),
    make("b3", "Simple distillation", "distillation", "Distillation separates a solvent from a solution. The vapour condenses in the condenser."),
  ];
  const course = applyLessonVisualPolicy(lesson(), { mode: "course", aiPictures: true, topic: "Biology and chemistry" }).beats;
  assert.equal(course[0].stage, "illustration", "the heart is drawn by gpt-image-2");
  assert.equal(course[0].figure, undefined);
  // Owner, 2026-10-24: "I'm not allowing any code diagrams … relying on gpt-image-2 for everything".
  assert.equal(course[1].stage, "illustration", "a Punnett square is drawn by gpt-image-2 too, as an exact diagram");
  assert.equal(course[2].stage, "illustration", "lab apparatus is drawn by gpt-image-2");
  assert.ok(course.every((b) => b.course), "course boards are marked");
  const prompt = applyLessonVisualPolicy(lesson(), { mode: "prompt", aiPictures: true, topic: "Biology and chemistry" }).beats;
  assert.equal(prompt[0].stage, "figure", "a typed-prompt lesson keeps its ready-made figures");
  assert.ok(!prompt.some((b) => b.course));
  // The switch back: exact diagrams drawn by code again, only the ready-made pictures off.
  process.env.CANVAS_COURSE_CODE_DIAGRAMS = "on";
  try {
    const back = applyLessonVisualPolicy(lesson(), { mode: "course", aiPictures: true, topic: "Biology and chemistry" }).beats;
    assert.equal(back[1].stage, "figure", "with CANVAS_COURSE_CODE_DIAGRAMS=on a Punnett square is code again");
    assert.equal(back[0].stage, "illustration");
  } finally {
    delete process.env.CANVAS_COURSE_CODE_DIAGRAMS;
  }
});

test("a maths course's drawings are gpt-image-2 pictures too, and its working keeps a picture beside it", async () => {
  const { applyLessonVisualPolicy } = await import("../canvas/visualPolicy");
  const maths = (stage: string, figure?: string) => ({ id: "b1", title: "Pythagoras' theorem", script: "The triangle has legs 3 cm and 4 cm. 3² + 4² = 9 + 16 = 25. So the hypotenuse is 5 cm.", stage, figure, brief: "A right-angled triangle with legs 3 and 4", objects: [], inside: null, carry: [], interaction: "try", overview: false, subject: "maths" } as unknown as CanvasPlanBeat);
  const drawn = applyLessonVisualPolicy([maths("sketch")], { mode: "course", aiPictures: true, topic: "Pythagoras" }).beats[0];
  assert.equal(drawn.stage, "illustration", "a live sketch becomes a gpt-image-2 picture (owner, 2026-10-24)");
  assert.equal(drawn.interaction, null, "a slider cannot move a picture");
  const working = applyLessonVisualPolicy([maths("equation", "triangle")], { mode: "course", aiPictures: true, topic: "Pythagoras" }).beats[0];
  assert.equal(working.stage, "equation", "the working stays written");
  assert.equal(working.figure, undefined, "no code figure beside it");
  assert.equal(working.pictureBeside, true, "a gpt-image-2 picture beside it instead");
  const off = applyLessonVisualPolicy([maths("sketch")], { mode: "course", aiPictures: false, topic: "Pythagoras" }).beats[0];
  assert.notEqual(off.stage, "illustration", "with generated pictures off nothing is sent to the image model");
});

test("every subject family is offered to the planner, maths and computing included, each with its exact diagrams", () => {
  const ctx = courseBoardContext(doc, "Blood vessels", beat)!;
  const { system } = fieldsPrompt(ctx);
  assert.equal(PICTURE_FAMILIES.length, 15);
  for (const f of ["biology", "chemistry", "physics", "earth", "geography", "history", "economics", "social", "languages", "arts", "health", "religion", "technology", "maths", "computing"]) assert.ok(system.includes(`"${f}"`), f);
  assert.match(system, /Exact diagrams — graphs; Punnett squares/, "what code used to draw is now an exact diagram");
  assert.match(system, /Never drawn — [^\n]*portraits of real named people/);
  assert.match(system, /This course's family is "biology"/);
  assert.doesNotMatch(system, /Code draws/);
});

test("each family carries its own rules: no writing for languages, sacred figures never drawn, no reproductive anatomy, process arrows for earth science", () => {
  const ctx = courseBoardContext(doc, "Blood vessels", beat)!;
  const base = parsePictureFields(fieldsJson, 3)!;
  const languages = coursePicturePrompt(ctx, { ...base, family: "languages" }) as Record<string, any>;
  assert.equal(typeof languages.labels, "string", "no labels drawn in a languages picture");
  assert.match(languages.text_and_exclusions, /No writing anywhere/);
  const religion = coursePicturePrompt(ctx, { ...base, family: "religion" }) as Record<string, any>;
  assert.ok(religion.never.some((r: string) => /Prophet Muhammad/.test(r) && /Sikh Gurus/.test(r)));
  assert.ok(religion.never.some((r: string) => /calligraphy/.test(r)));
  const health = coursePicturePrompt(ctx, { ...base, family: "health" }) as Record<string, any>;
  assert.ok(health.never.some((r: string) => /reproductive anatomy/.test(r)));
  const earth = coursePicturePrompt(ctx, { ...base, family: "earth" }) as Record<string, any>;
  assert.match(earth.arrows, /broad arrows/);
  assert.doesNotMatch(earth.text_and_exclusions, /arrows/, "earth science may draw movement arrows");
  const history = coursePicturePrompt(ctx, { ...base, family: "history" }) as Record<string, any>;
  assert.ok(history.history_rules.some((r: string) => /never a sepia/.test(r)));
});

test("a no-writing family's picture keeps its labels on the board, written by code in the exact script", () => {
  const spec = { heading: "La cuisine", notes: [], stage: { kind: "illustration", subject: "a kitchen", parts: [], labels: [] }, cues: [] } as unknown as CanvasBoardSpec;
  const out = withCoursePicture(spec, {
    labels: [{ text: "la table", part: "table", sentence: 0, x: 0.4, y: 0.6 }, { text: "la chaise", part: "chair", sentence: 1, x: 0.7, y: 0.6 }],
    fields: { family: "languages", diagramType: "a kitchen", labels: [] },
    description: "A kitchen with a table and a chair.",
    paper: "#ffffff",
  }, "/api/canvas-lecture/image/x");
  if (out.stage.kind !== "illustration") throw new Error("still a picture board");
  assert.deepEqual(out.stage.labels, out.stage.parts.map((p) => p.id), "the board writes each label");
  assert.equal(out.stage.labelsInPicture, undefined);
  assert.equal(out.stage.coursePicture, true);
});

test("where the student studies shapes the people in the picture: modest dress and no pork for Pakistan; Australia and IB are recognised", () => {
  const ctx = { ...courseBoardContext(doc, "Blood vessels", beat)!, curriculum: curriculumOf("FBISE SSC Economics") };
  const p = coursePicturePrompt(ctx, { ...parsePictureFields(fieldsJson, 3)!, family: "economics" }) as Record<string, any>;
  assert.ok(p.never.some((r: string) => /modestly dressed/.test(r)) && p.never.some((r: string) => /pork/.test(r)));
  assert.equal(curriculumOf("ACARA v9 Science").name, "Australia");
  assert.equal(curriculumOf("IB Diploma Biology").name, "IB");
});

test("a label is a part's short name: explanations dropped, long names cut at a word", async () => {
  const { shortLabel } = await import("../canvas/coursePicturePrompt");
  assert.equal(shortLabel("Goggles — protect the eyes from splashes, broken glass"), "Goggles");
  assert.equal(shortLabel("Lab coat: protects clothing"), "Lab coat");
  assert.equal(shortLabel("teacher's designated assembly point"), "teacher's designated assembly point", "a name up to 40 characters is kept whole");
  assert.equal(shortLabel("water-filled capillary tube with a scale beside it"), "water-filled capillary tube with a scale");
  assert.equal(shortLabel("xylem"), "xylem");
});

test("labels read back by text recognition: wrapped labels and I/l confusions pass, a real misspelling fails", async () => {
  const { labelsInRecognisedText } = await import("../canvas/coursePicturePrompt");
  const ocr = "heavy\ncatalyst\nfraction\ncracking\nreactor\nserpartor\nmolten lead(Il) bromide\nH20";
  const r = labelsInRecognisedText(["heavy fraction", "cracking reactor", "molten lead(II) bromide", "separator", "H₂O"], ocr);
  assert.deepEqual(r.missing, ["separator"]);
});

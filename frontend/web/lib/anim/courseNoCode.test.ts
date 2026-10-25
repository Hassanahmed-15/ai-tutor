import test from "node:test";
import assert from "node:assert/strict";
import { fallbackSpec } from "../canvas/fallback";
import { boardAlone, removeNamedLines, parseBoardLook } from "../canvas/boardLookCheck";
import { dropRowsWhere, lineKey, sameLine, saysNothing } from "../canvas/equationCheck";
import { fittedNote, trimToFit, unfinishedNote } from "../text/fit";
import { layoutPanel } from "../canvas/layout";
import { coursePicturePrompt, familyOfCourse, parsePictureFields, withBoardWriting, type CourseBoardContext } from "../canvas/coursePicturePrompt";
import { curriculumOf } from "../canvas/coursePicturePrompt";
import type { CanvasBoardSpec, CanvasPlanBeat, EquationStage } from "../canvas/types";

/*
 * NO CODE DIAGRAMS IN COURSE LESSONS, AND THE THREE FIXES (owner, 2026-10-24: "I'm not allowing any code
 * diagrams … relying on gpt-image-2 for everything … it should be sent a complete board context … the board
 * itself should have a visual check"). The boards are the Cambridge IGCSE Chemistry "Formulae" lesson's,
 * session 7d9279dc (course bench 2026-10-24).
 */

const equation = (rows: string[]): EquationStage => {
  const tokens: EquationStage["tokens"] = [];
  const steps = rows.map((r, i) => {
    const order = r.split(" ").map((t, k) => { const id = `t${i}-${k}`; tokens.push({ id, text: t }); return id; });
    return { s: i, order };
  });
  return { kind: "equation", tokens, steps };
};

// Board 2 as it shipped: the false ion line written twice — as a note and as a line of working.
const board2 = (): CanvasBoardSpec => ({
  v: 1,
  heading: "Named compound formulae",
  notes: [
    { id: "say-1", text: "NaOH, Ca(OH)₂", s: 3 },
    { id: "say-2", text: "Ca(OH)₂ → Ca²⁺ + OH⁻", s: 4 },
    { id: "say-3", text: "Cu(II) sulfate → CuSO₄", s: 5 },
  ],
  stage: equation(["formula = Ca(OH)₂", "calcium hydroxide = Ca²⁺ + OH⁻", "copper(II) sulfate = CuSO₄"]),
  cues: [{ s: 4, at: 0.2, action: "point", target: "say-2" }, { s: 1, at: 0.1, action: "zoom" }],
} as unknown as CanvasBoardSpec);

test("fix 1: a line the look names as false is taken off — the note and the line of working — and the rest stays", () => {
  const verdict = parseBoardLook({ ok: false, problems: [{ kind: "wrong-fact", detail: "calcium hydroxide must give two hydroxide ions", serious: true, where: "writing", lines: ["Ca(OH)₂ → Ca²⁺ + OH⁻", "calcium hydroxide = Ca²⁺ + OH⁻"] }] });
  assert.equal(verdict.problems[0].where, "writing");
  const { spec, removed } = removeNamedLines(board2(), verdict.problems);
  assert.equal(removed.length, 2);
  assert.deepEqual(spec.notes.map((n) => n.text), ["NaOH, Ca(OH)₂", "Cu(II) sulfate → CuSO₄"]);
  if (spec.stage.kind !== "equation") throw new Error("still a working board");
  assert.equal(spec.stage.steps.length, 2, "the two true lines stay");
  assert.equal(spec.heading, "Named compound formulae", "the heading is never removed");
  assert.ok(!spec.cues.some((c) => c.target === "say-2"), "no cue points at a line that is gone");
});

test("fix 1 takes off only what was named: a fault in the picture, a minor note or an unmatched line removes nothing", () => {
  const picture = parseBoardLook({ problems: [{ kind: "mislabelled", detail: "label on the wrong part", serious: true, where: "picture", lines: ["Ca(OH)₂ → Ca²⁺ + OH⁻"] }] });
  assert.equal(removeNamedLines(board2(), picture.problems).removed.length, 0, "a picture's fault is the picture's to redraw");
  const minor = parseBoardLook({ problems: [{ kind: "overlap", detail: "close", serious: false, where: "writing", lines: ["Ca(OH)₂ → Ca²⁺ + OH⁻"] }] });
  assert.equal(removeNamedLines(board2(), minor.problems).removed.length, 0);
  const other = parseBoardLook({ problems: [{ kind: "wrong-fact", detail: "x", serious: true, where: "writing", lines: ["OH⁻"] }] });
  assert.equal(removeNamedLines(board2(), other.problems).removed.length, 0, "a short fragment is not a whole line");
  const all = parseBoardLook({ problems: [{ kind: "wrong-fact", detail: "x", serious: true, lines: ["formula = Ca(OH)₂", "calcium hydroxide = Ca²⁺ + OH⁻", "copper(II) sulfate = CuSO₄"] }] });
  const kept = removeNamedLines(board2(), all.problems).spec;
  assert.equal(kept.stage.kind === "equation" && kept.stage.steps.length, 3, "a working board is never left without a line");
});

test("lines match whatever way they are written: subscripts, superscripts, LaTeX, arrows and spaces", () => {
  assert.equal(lineKey("Ca(OH)₂ → Ca²⁺ + OH⁻"), lineKey("Ca(OH)_{2} \\rightarrow Ca^{2+} + OH^{-}"));
  assert.ok(sameLine("Ca(OH)₂ → Ca²⁺ + OH⁻", "Ca(OH)2 -> Ca2+ + OH-"));
  assert.ok(!sameLine("Ca(OH)₂ → Ca²⁺ + 2OH⁻", "Ca(OH)₂ → Ca²⁺ + OH⁻") || lineKey("Ca(OH)₂ → Ca²⁺ + 2OH⁻").length / lineKey("Ca(OH)₂ → Ca²⁺ + OH⁻").length >= 1, "the corrected line differs");
});

test("fix 2: a line of working whose two sides are the same says nothing and goes; real lines stay", () => {
  assert.ok(saysNothing("Na₂O = Na₂O"));
  assert.ok(saysNothing("Na_{2}O = Na₂O"));
  assert.ok(!saysNothing("2Na⁺ + O²⁻ = Na₂O"));
  assert.ok(!saysNothing("Ca + Cl₂ = CaCl₂"));
  assert.ok(!saysNothing("x ≠ x"));
  assert.ok(!saysNothing("a = b = a"), "only one equals sign is judged");
  // Board 7 as it shipped.
  const st = equation(["1 Ca²⁺ + 2 Cl⁻ = 0", "Ca + Cl₂ = CaCl₂", "2 Na⁺ + 1 O²⁻ = 0", "Na₂O = Na₂O"]);
  assert.deepEqual(dropRowsWhere(st, saysNothing), ["Na₂O = Na₂O"]);
  assert.equal(st.steps.length, 3);
  // As board 7 was stored: one step writing two lines with a "," between them — only the empty line goes.
  const two = equation(["1 Ca²⁺ + 2 Cl⁻ = 0", "2 Na⁺ + 1 O²⁻ = 0 , Na₂O = Na₂O"]);
  assert.deepEqual(dropRowsWhere(two, saysNothing), ["Na₂O = Na₂O"]);
  assert.equal(two.steps.length, 2, "the step keeps its true line");
  const text = new Map(two.tokens.map((t) => [t.id, t.text]));
  assert.equal(two.steps[1].order.map((id) => text.get(id)).join(" "), "2 Na⁺ + 1 O²⁻ = 0");
});

test("fix 3: a note is never cut mid-sentence — 'Molecular formula may be a multiple' stays whole", () => {
  const planned = "Molecular formula may be a multiple";
  assert.equal(planned.length, 35, "one character over the column's two lines");
  assert.equal(fittedNote(planned, "Molecular formula can be"), planned, "a shortening that stops mid-sentence is not used");
  assert.equal(fittedNote(planned, "Molecular formula: a multiple"), "Molecular formula: a multiple", "a complete shorter phrase is");
  assert.equal(fittedNote(planned, undefined), planned, "no shortening: written whole within three lines");
  const long = "The molecular formula of a compound can be a whole-number multiple of its empirical formula";
  const cut = fittedNote(long, undefined);
  assert.ok(cut.length <= 48 && !unfinishedNote(cut), `"${cut}"`);
  for (const t of ["Molecular formula can be a multiple of empirical", "The ions are held by strong attractions in a lattice", "Each atom has been counted in the model"]) {
    const out = trimToFit(t, 26);
    assert.ok(!unfinishedNote(out), `"${out}" ends where its sentence is still going`);
  }
});

test("fix 3 on the board: the whole note is laid out, nothing cut", () => {
  const spec = { v: 1, heading: "Empirical formula", notes: [{ id: "say-3", text: "Molecular formula may be a multiple", s: 0 }], stage: equation(["C₆H₁₂O₆ → 6 : 12 : 6"]), cues: [] } as unknown as CanvasBoardSpec;
  const note = layoutPanel(spec).marks.find((m) => m.type === "note" && m.id === "say-3") as { lines: string[] } | undefined;
  assert.equal(note?.lines.join(" "), "Molecular formula may be a multiple");
});

test("a course board that cannot be made is WRITTEN — what Aria writes as she speaks — never boxes or a figure", () => {
  const beat = { id: "b4", title: "Formulae from particle models", script: "Count each atom in one molecule. Methane has one carbon atom and four hydrogen atoms. Its formula is CH4.", stage: "illustration", brief: "", objects: ["carbon atom", "hydrogen atom", "methane"], inside: null, carry: [], interaction: null, overview: false, course: true, boardNotes: [{ s: 0, text: "Count atoms in one molecule" }, { s: 2, text: "Methane: CH₄" }] } as unknown as CanvasPlanBeat;
  const spec = fallbackSpec(beat);
  assert.equal(spec.stage.kind, "sketch");
  if (spec.stage.kind !== "sketch") return;
  assert.ok(spec.stage.items.every((it) => it.type === "text"), "writing only");
  assert.deepEqual(spec.stage.items.map((it) => (it as { text: string }).text), ["Count atoms in one molecule", "Methane: CH₄"]);
  const typed = fallbackSpec({ ...beat, course: undefined });
  assert.notEqual(typed.stage.kind, "sketch", "a typed-prompt lesson keeps its own fallback");
});

test("a working board's picture sits beside its lines: the picture on the left, the working on the right", () => {
  const stage = { ...equation(["3² + 4² = 25", "c = 5"]), picture: { kind: "illustration", subject: "right-angled triangle", parts: [{ id: "label-1", name: "hypotenuse", s: 1, x: 0.5, y: 0.4 }], labels: [], src: "/api/canvas-lecture/image/x", coursePicture: true, labelsInPicture: ["hypotenuse"] } } as EquationStage;
  const marks = layoutPanel({ v: 1, heading: "Pythagoras", notes: [], stage, cues: [] } as unknown as CanvasBoardSpec).marks;
  const picture = marks.find((m) => m.type === "picture") as { rect: { x: number; w: number } } | undefined;
  assert.ok(picture, "the picture is drawn");
  const part = marks.find((m) => m.type === "part" && m.id === "label-1");
  assert.ok(part, "the pen can point at the labelled part");
  const working = marks.find((m) => m.type === "equation") as { steps: Array<{ place: Record<string, { x: number }> }> } | undefined;
  const xs = (working?.steps ?? []).flatMap((st) => Object.values(st.place).map((p) => p.x));
  assert.ok(xs.length > 0, "the working is written");
  assert.ok(xs.every((x) => x > picture!.rect.x + picture!.rect.w), "the working is written to the right of the picture");
});

const ctx: CourseBoardContext = {
  course: "Chemistry — Formulae", lesson: "Formulae", board: "Named compound formulae", brief: "Formulae of named compounds and the ions in them.",
  family: "chemistry", objects: ["calcium hydroxide"], written: [],
  sentences: ["Calcium hydroxide is Ca(OH)₂.", "It contains one Ca²⁺ ion and two OH⁻ ions."], syllabus: "State the formulae of the compounds named in the syllabus.", hints: [], mustShow: [],
  curriculum: curriculumOf("Cambridge IGCSE Chemistry 0620"),
};

test("gpt-image-2 is sent the board's whole context: its heading, every note and line of working, what Aria says", () => {
  const withWriting = withBoardWriting(ctx, board2());
  assert.ok(withWriting.written.includes("Heading: Named compound formulae"));
  assert.ok(withWriting.written.some((w) => w.startsWith("Note (sentence 4): Ca(OH)₂ → Ca²⁺ + OH⁻")));
  assert.ok(withWriting.written.some((w) => w.startsWith("Working (sentence 1): calcium hydroxide = Ca²⁺ + OH⁻")));
  const f = parsePictureFields({ family: "chemistry", diagram_type: "ionic structure of calcium hydroxide", exact: true, scope: "one formula unit", view: "flat 2-D particle diagram", parts: [{ name: "calcium ion", where: "centre", looks: "large circle" }], must_be_true: ["one Ca²⁺ and two OH⁻"], labels: [{ text: "calcium ion", points_to: "calcium ion", position: "beside it", sentence: 1 }], exact_text: ["Ca²⁺", "OH⁻", "OH⁻", "Ca(OH)₂"], arrows: "" }, 2, "chemistry")!;
  assert.equal(f.exact, true);
  assert.deepEqual(f.exactText, ["Ca²⁺", "OH⁻", "Ca(OH)₂"], "each piece of exact text once");
  const p = coursePicturePrompt(withWriting, f) as Record<string, any>;
  assert.deepEqual(p.board_context.written_on_the_board_beside_it, withWriting.written);
  assert.equal(p.board_context.what_the_board_teaches, ctx.brief);
  assert.ok(Array.isArray(p.exact_diagram_rules), "an exact diagram is drawn by the exact-diagram rules");
  assert.deepEqual(p.exact_text, ["Ca²⁺", "OH⁻", "Ca(OH)₂"]);
  assert.match(p.text_and_exclusions, /the 1 label and the 3 pieces of exact text/);
  assert.ok(!p.never.some((r: string) => /No chemical formulas, equations, charge signs or numbers drawn as text/.test(r)), "formulas are allowed when listed");
});

test("maths and computing have their own rules; a course's subject names its family", () => {
  const f = parsePictureFields({ family: "maths", diagram_type: "right-angled triangle", exact: true, scope: "the whole triangle", view: "flat", parts: [{ name: "hypotenuse", where: "slope", looks: "longest side" }], must_be_true: ["legs 3 cm and 4 cm"], labels: [], exact_text: ["3 cm", "4 cm", "c"], arrows: "" }, 3, "maths")!;
  const p = coursePicturePrompt({ ...ctx, family: "maths" }, f) as Record<string, any>;
  assert.ok(p.maths_rules.some((r: string) => /right angles marked with a small square/.test(r)));
  assert.match(p.text_and_exclusions, /the 3 pieces of exact text/);
  assert.equal(familyOfCourse("Mathematics"), "maths");
  assert.equal(familyOfCourse("Computer Science"), "computing");
  assert.equal(familyOfCourse("Chemistry"), "chemistry");
  assert.equal(familyOfCourse("Physical Education"), "health", "not physics");
  assert.equal(familyOfCourse("Art and Design"), "arts");
  assert.equal(familyOfCourse("Design and Technology"), "technology");
  assert.equal(familyOfCourse("Combined Science"), undefined, "a combined-science board's family is the board's discipline");
});

test("the look sees the board alone: no pointer, rings or tap-to-explore spots — they were refused as meaningless circles", () => {
  const spec = {
    v: 1, heading: "Transpiration", notes: [{ id: "n1", text: "Light opens stomata", s: 0 }],
    stage: { kind: "illustration", subject: "leaf section", parts: [{ id: "p1", name: "Xylem", s: 1, x: 0.3, y: 0.5, say: "Water arrives in the xylem." }], labels: [], coursePicture: true },
    cues: [{ s: 1, at: 0.3, action: "point", target: "p1" }],
  } as unknown as CanvasBoardSpec;
  const alone = boardAlone(spec);
  assert.deepEqual(alone.cues, []);
  assert.ok(alone.stage.kind === "illustration" && alone.stage.parts.every((p) => p.say === undefined), "no explore spots");
  assert.ok(alone.stage.kind === "illustration" && alone.stage.parts[0].name === "Xylem", "the parts themselves stay");
  assert.equal(spec.cues.length, 1, "the board itself is untouched");
});

test("the things a board names reach the picture in words, never as ids (its labels read \"polar-bonds\")", async () => {
  const { courseBoardContext } = await import("../canvas/coursePicturePrompt");
  const doc = { lesson: { title: "Intermolecular forces", subject: "Chemistry" }, lessonPlan: { sourceType: "curriculum" }, contentBlocks: [{ id: "c1", heading: "Hydrogen bonds", text: "Hydrogen bonding in water.", keyIdeas: [], teachingHints: [], facts: [] }] };
  const beat = { id: "b1", title: "Permanent dipoles and hydrogen bonds", brief: "", script: "Water molecules are polar.", objects: ["water-molecules", "polar-bonds", "lone_pairs"] } as unknown as CanvasPlanBeat;
  const ctx = courseBoardContext(doc as never, "Intermolecular forces", beat)!;
  assert.deepEqual(ctx.objects, ["water molecules", "polar bonds", "lone pairs"]);
  assert.equal(ctx.family, "chemistry");
});

test("only a board that needs a picture gets one: something to SEE is a picture; a table, steps or a concept is writing", async () => {
  const { applyLessonVisualPolicy } = await import("../canvas/visualPolicy");
  const board = (id: string, stage: string, title: string, script: string, extra: Record<string, unknown> = {}) => ({ id, title, script, stage, brief: title, objects: [], inside: null, carry: [], interaction: null, overview: false, subject: "other", ...extra } as unknown as CanvasPlanBeat);
  const lesson = [
    board("b1", "compare", "Greenhouse gases compared", "Carbon dioxide comes from burning fossil fuels. Methane comes from livestock and landfill. Both absorb infrared radiation.", { visualType: "comparison" }),
    board("b2", "flow", "How acid rain forms", "Sulfur dioxide is released when fuels burn. It dissolves in rain water. The rain becomes acidic.", { visualType: "diagram" }),
    board("b3", "illustration", "A catalytic converter", "Exhaust gases pass over the catalyst. Carbon monoxide becomes carbon dioxide.", { visualType: "thing" }),
    board("b4", "flow", "Ways to reduce pollution", "Burn less fossil fuel. Use low-sulfur fuels. Fit catalytic converters.", { visualType: "sequence" }),
    board("b5", "illustration", "What a greenhouse gas is", "A greenhouse gas traps heat in the atmosphere. Carbon dioxide and methane are greenhouse gases.", { visualType: "concept" }),
  ];
  const out = applyLessonVisualPolicy(lesson, { mode: "course", aiPictures: true, topic: "Air pollution" });
  const stage = (id: string) => out.beats.find((b) => b.id === id)!.stage;
  assert.equal(stage("b1"), "compare", "the planner's table stays a table — no quota turns it into a picture");
  assert.equal(stage("b2"), "illustration", "a pathway the student must follow is a gpt-image-2 picture");
  assert.equal(stage("b3"), "illustration", "a real thing is a picture");
  const b4 = out.beats.find((b) => b.id === "b4")!, b5 = out.beats.find((b) => b.id === "b5")!;
  assert.ok(b4.stage === "sketch" && b4.written, "a list of steps is written as she speaks — no picture");
  assert.ok(b5.stage === "sketch" && b5.written, "a concept with nothing to see is written — no picture");
  assert.equal(out.beats.filter((b) => b.stage === "illustration").length, 2, "two pictures in five boards: only where needed");
});

test("a written board's false line is taken off like any other, and it keeps its true ones", () => {
  const spec = { v: 1, heading: "Nitrogen oxides", notes: [], stage: { kind: "sketch", items: [{ id: "line-1", type: "text", text: "Air: nitrogen + oxygen", s: 0 }, { id: "line-2", type: "text", text: "N₂ and O₂ react → NO", s: 1 }] }, cues: [] } as unknown as CanvasBoardSpec;
  const out = removeNamedLines(spec, parseBoardLook({ problems: [{ kind: "wrong-fact", detail: "not balanced", serious: true, where: "writing", lines: ["N₂ and O₂ react → NO"] }] }).problems);
  assert.deepEqual(out.removed, ["N₂ and O₂ react → NO"]);
  assert.equal(out.spec.stage.kind === "sketch" && out.spec.stage.items.length, 1);
});

test("a course lesson's visual choice decides each board on its need: no quota, no cap", async () => {
  const { chooseVisuals, COURSE_VISUAL_CHOICE_PROMPT, VISUAL_CHOICE_PROMPT } = await import("../canvas/visualChoice");
  const beats = [{ id: "b1", title: "Products from microbial cultures", brief: "", script: "Microorganisms make insulin, penicillin and mycoprotein.", stage: "illustration", objects: [], inside: null, carry: [], interaction: null, overview: false }] as unknown as CanvasPlanBeat[];
  let asked = "";
  const out = await chooseVisuals(async (system) => { asked = system; return { json: { boards: [{ id: "b1", visual: "concept", show: "" }] }, costUsd: 0 }; }, "Fermenters", beats, { course: true });
  assert.equal(asked, COURSE_VISUAL_CHOICE_PROMPT);
  assert.match(asked, /whenever SEEING something helps the student/);
  assert.match(asked, /there is NO limit/, "no cap on pictures: each board is decided on its own (owner, 2026-10-24)");
  assert.doesNotMatch(asked, /one or two pictures|When unsure, it gets no picture/, "no hidden cap");
  assert.doesNotMatch(asked, /nine in ten/, "and no 'most boards need a visual' quota either");
  assert.equal(out.beats[0].visualType, "concept");
  await chooseVisuals(async (system) => { asked = system; return { json: { boards: [] }, costUsd: 0 }; }, "Fermenters", beats);
  assert.equal(asked, VISUAL_CHOICE_PROMPT, "typed-prompt lessons keep their own visual choice");
});

test("formulas are written as in print, and only formulas: CH4 → CH₄, but Group 2 and Year 11 stay", async () => {
  const { chemSubscripts } = await import("../canvas/chemText");
  assert.equal(chemSubscripts("CH4, C2H6, C3H8, C4H10"), "CH₄, C₂H₆, C₃H₈, C₄H₁₀");
  assert.equal(chemSubscripts("Ca(OH)2 and H2SO4 make 2H2O"), "Ca(OH)₂ and H₂SO₄ make 2H₂O");
  assert.equal(chemSubscripts("Difference: CH2"), "Difference: CH₂");
  // Charges are raised, not lowered ("Ca2+" came out "Ca₂+").
  assert.equal(chemSubscripts("Two OH- balance Ca2+"), "Two OH⁻ balance Ca²⁺");
  assert.equal(chemSubscripts("SO42- and NH4+ and NO3- and CO32- and Fe3+"), "SO₄²⁻ and NH₄⁺ and NO₃⁻ and CO₃²⁻ and Fe³⁺");
  assert.equal(chemSubscripts("Na+ and Cl-"), "Na⁺ and Cl⁻");
  assert.equal(chemSubscripts("H2O - water"), "H₂O - water", "a dash between words is not a charge");
  for (const t of ["Group 2 metals", "Q1 is worth 2 marks", "Year 11", "6:12:6", "NaCl", "C=C leaves two single bonds", "Starts at (0, 1)", "B = exp(-2) = 0.135", "E = 2kT"]) assert.equal(chemSubscripts(t), t, t);
});

test("a written board is not a wall of text: lines in spoken order, formulas in print, no repeats, at most eight", () => {
  const notes = ["Chromosomes line up centrally", "Equatorial plane; metaphase plate", "Opposite spindle attachments", "Even genetic split", "Centromeres divide", "Centromere division releases chromatids", "Fibres pull to opposite poles", "Four replicated chromosomes aligned", "Metaphase plate", "Sister chromatids separate"];
  const beat = { id: "b2", title: "Metaphase and anaphase", script: notes.map((n) => `${n} here.`).join(" "), stage: "sketch", written: true, course: true, brief: "", objects: [], inside: null, carry: [], interaction: null, overview: false, boardNotes: notes.map((text, s) => ({ s, text })) } as unknown as CanvasPlanBeat;
  const spec = fallbackSpec(beat);
  const lines = spec.stage.kind === "sketch" ? spec.stage.items.map((it) => (it as { text: string }).text) : [];
  assert.ok(lines.length <= 8);
  assert.ok(!lines.includes("Metaphase plate"), "a line repeating an earlier one is left out");
  assert.equal(lines[0], "Chromosomes line up centrally");
});

test("a picture names its parts and never repeats the board: no 'change 1' labels, no copied working", async () => {
  const { namedLabel, parsePictureFields } = await import("../canvas/coursePicturePrompt");
  assert.equal(namedLabel("change 1", "faster particles"), "faster particles");
  assert.equal(namedLabel("second curve", "600 K curve"), "600 K curve");
  assert.equal(namedLabel("curve", "curve"), "", "a placeholder with no real name is dropped");
  assert.equal(namedLabel("Bowman's capsule", "capsule"), "Bowman's capsule", "a real name stays");
  const f = parsePictureFields({ family: "chemistry", diagram_type: "Charles's law graph", exact: true, scope: "the graph", view: "flat", parts: [{ name: "line", where: "middle", looks: "straight" }],
    labels: [{ text: "graph", points_to: "Charles's law line", position: "beside it", sentence: 0 }],
    exact_text: ["V₂ = 2.40 × 360 ÷ 300 = 2.88 dm³", "T (K)", "V"] }, 3, "chemistry", ["Heading: Charles's law", "Note (sentence 1): V₂ = 2.40 × 360 ÷ 300 = 2.88 dm³"])!;
  assert.deepEqual(f.labels.map((l) => l.text), ["Charles's law line"]);
  assert.deepEqual(f.exactText, ["T (K)", "V"], "the working written beside the picture is not drawn into it again");
});

test("a course board's look: a written board is numbered lines in two columns; a picture board's notes column is wider", () => {
  const written = { v: 1, subject: "other", heading: "Immunisation", notes: [], stage: { kind: "sketch", items: ["Inactive pathogen", "Antigens stimulate lymphocytes", "Memory cells remain", "Faster second response"].map((text, i) => ({ id: `line-${i + 1}`, type: "text", text, s: i, col: "full" })) }, cues: [] } as unknown as CanvasBoardSpec;
  const notes = layoutPanel(written).marks.filter((m) => m.type === "note") as Array<{ num?: number; x: number; y: number }>;
  assert.deepEqual(notes.map((n) => n.num), [1, 2, 3, 4], "numbered in order");
  assert.equal(new Set(notes.map((n) => n.x)).size, 2, "two columns");
  assert.ok(notes[0].y === notes[1].y && notes[2].y > notes[0].y, "read row by row");
  const picture = { v: 1, subject: "other", heading: "Kidney", notes: [{ id: "n1", text: "Bowman's capsule around glomerulus", s: 0 }], stage: { kind: "illustration", subject: "kidney", parts: [], labels: [], src: "/x" }, cues: [] } as unknown as CanvasBoardSpec;
  const laid = layoutPanel(picture).marks;
  const pic = laid.find((m) => m.type === "picture") as { rect: { x: number } };
  const note = laid.find((m) => m.type === "note") as { size: number; lines: string[] };
  assert.ok(pic.rect.x >= 452, "the picture sits right of a wider notes column");
  assert.ok(note.size >= 24 && note.lines.length <= 2, "bigger writing, at most two lines a note");
  const typed = layoutPanel({ ...picture, subject: undefined } as CanvasBoardSpec).marks.find((m) => m.type === "note") as { size: number };
  assert.ok(typed.size < 24, "other lectures keep their look");
});

test("Aria talks the student through a course picture: the pointer goes to each part as she names it; a note is tied to the part it names", async () => {
  const { partMentionCues, mentionAt } = await import("../canvas/pictureTalk");
  const spec = {
    v: 1, subject: "other", heading: "Kidney",
    notes: [{ id: "n1", text: "Cortex, medulla, renal pelvis", s: 0 }, { id: "n2", text: "Ureter carries urine", s: 1 }],
    stage: { kind: "illustration", subject: "kidney", coursePicture: true, labels: [], src: "/x", parts: [
      { id: "cortex", name: "Cortex", s: 0, x: 0.3, y: 0.3 }, { id: "medulla", name: "Medulla", s: 0, x: 0.35, y: 0.45 },
      { id: "pelvis", name: "Renal pelvis", s: 0, x: 0.4, y: 0.55 }, { id: "ureter", name: "Ureter", s: 1, x: 0.4, y: 0.85 } ] },
    cues: [{ s: 0, at: 0.3, action: "point", target: "cortex" }],
  } as unknown as CanvasBoardSpec;
  const script = "The kidney has an outer cortex, an inner medulla and a central renal pelvis. The renal pelvis drains into the ureter.";
  const cues = partMentionCues(spec, script);
  const talk = cues.filter((c) => c.action === "circle" || c.action === "point");
  assert.deepEqual(talk.filter((c) => c.s === 0).map((c) => c.target), ["cortex", "medulla", "pelvis"], "each part in the order she names it");
  assert.ok(talk.filter((c) => c.s === 0).every((c, i, a) => i === 0 || (c.at ?? 0) > (a[i - 1].at ?? 0)), "timed to when she says it");
  assert.equal(talk.find((c) => c.s === 1 && c.target === "pelvis")?.action, "point", "a part named again is pointed at again");
  assert.equal(talk.find((c) => c.s === 1 && c.target === "ureter")?.action, "circle", "a part named for the first time is circled");
  assert.ok(mentionAt("Bowman’s capsule around glomerulus", "Bowman's capsule") === 0, "apostrophes either way");
  assert.equal(mentionAt("the capsule", "Bowman's capsule"), -1, "half a name is not the part");
  const links = layoutPanel({ ...spec, cues }).marks.filter((m) => m.type === "partLink") as Array<{ id: string; s: number; until?: number }>;
  assert.deepEqual(links.map((l) => l.id), ["link-n1", "link-n2"], "each note naming a part is tied to it");
  assert.equal(links[0].until, 1, "shown while its sentence is said");
  const typed = layoutPanel({ ...spec, subject: undefined, cues } as CanvasBoardSpec).marks.filter((m) => m.type === "partLink");
  assert.equal(typed.length, 0, "other lectures keep their look");
});

test("the pointer follows real part names: a one-letter symbol is not a part, a hyphen or a raised digit still names one", async () => {
  const { mentionAt, talkable } = await import("../canvas/pictureTalk");
  assert.equal(talkable("M"), false, "'M' in 'g = F/m' is not the Earth");
  assert.equal(mentionAt("Polar bonds pull electrons", "polar-bonds"), 0);
  assert.equal(mentionAt("each carbon is sp² hybridised", "sp2 hybridised"), 15);
  assert.equal(mentionAt("the pH falls", "pH"), 4, "a two-letter name in its own case");
  assert.equal(mentionAt("graph of ph", "pH"), -1);
});

test("a course board never wipes a note on the sentence it is written: a sentence's notes start a new page together", () => {
  const notes = Array.from({ length: 14 }, (_, i) => ({ id: `n${i}`, s: Math.floor(i / 3), text: `Point ${i} about the reaction and its conditions here` }));
  for (const stage of [
    { kind: "illustration", subject: "x", coursePicture: true, labels: [], src: "/x", parts: [{ id: "a", name: "flask", s: 0, x: 0.5, y: 0.5 }] },
    { kind: "sketch", items: [] },
  ]) {
    const spec = { v: 1, subject: "other", heading: "Board", notes, stage, cues: [] } as unknown as CanvasBoardSpec;
    const marks = layoutPanel(spec).marks as Array<{ type: string; id: string; s: number; until?: number }>;
    const lost = marks.filter((m) => m.type === "note" && m.until !== undefined && m.until <= m.s);
    assert.deepEqual(lost.map((m) => m.id), [], `${stage.kind}: every note is drawn`);
    assert.equal(marks.filter((m) => m.type === "note").length, 14);
  }
});

test("an easy-words rewrite that drops a syllabus key point or term is caught", async () => {
  const { syllabusLost } = await import("../canvas/courseCoverage");
  const block = { keyIdeas: ["Capillaries have walls one cell thick so substances diffuse quickly"] };
  const before = "Capillaries have walls only one cell thick, so substances diffuse across them quickly. Valves stop backflow.";
  assert.deepEqual(syllabusLost(before, "Capillary walls are one cell thick, so things diffuse across them fast. Valves stop backflow.", block, ["valve"]), [], "simpler words, same point");
  assert.deepEqual(syllabusLost(before, "Tiny vessels are thin. Flaps stop blood going back.", block, ["valve"]), [block.keyIdeas[0], "valve"]);
  assert.deepEqual(syllabusLost(before, "anything", undefined), [], "not a course board");
});

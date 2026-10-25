import assert from "node:assert/strict";
import test from "node:test";
import { trimToFit, validateCanvasSpec, validationCutItems } from "../canvas/validate";
import { boardNotesOf, validatePlan } from "../canvas/plan";
import { layoutPanel } from "../canvas/layout";
import { checkCardIssues } from "../canvas/quizLint";
import type { QuizInteraction } from "../canvas/types";

test("over-long text ends at a natural break as a complete phrase, never with \"…\"", () => {
  const out = trimToFit("Primary data is collected first-hand for a specific project, such as interviews", 50);
  assert.ok(out.length <= 50 && !out.endsWith("…") && !/\b(for|a|such)$/.test(out), out);
  validateCanvasSpec({ heading: "Data", notes: [], cues: [], stage: { kind: "compare", left: { title: "Primary", items: [{ text: "Collected first-hand by the researcher for this specific project, through interviews or questionnaires", s: 0 }] }, right: { title: "Secondary", items: [{ text: "Already exists", s: 0 }] } } }, 2);
  assert.ok(validationCutItems().some((c) => c.text.startsWith("Collected first-hand") && c.max < c.text.length), "the whole text is kept for the shorten pass");
});

test("the planner's spoken board phrases are kept per sentence, within the board", () => {
  // A sentence may write up to three notes (a list, item by item: owner, 2026-10-23); a repeated note is dropped.
  const notes = boardNotesOf([{ s: 0, text: "Diploid: two sets (2n)" }, { s: 0, text: "second item" }, { s: 0, text: "Diploid: two sets (2n)" }, { s: 9, text: "beyond the script" }, { s: 1, text: "Gametes are haploid." }], 3).boardNotes!;
  assert.deepEqual(notes, [{ s: 0, text: "Diploid: two sets (2n)" }, { s: 0, text: "second item" }, { s: 1, text: "Gametes are haploid" }]);
  const plan = validatePlan({ beats: [{ title: "Sets", stage: "flow", script: "Body cells are diploid. Gametes are haploid. Fertilisation restores two sets.", objects: [], board: [{ s: 0, text: "Body cells: 2n" }, { s: 2, text: "n + n → 2n" }] }] })!;
  assert.equal(plan.beats[0].boardNotes?.length, 2);
});

test("the notes column is wiped only when the next note does not fit, in reading order", () => {
  // Four at a time wiped what Aria had just said within a few sentences (owner, 2026-10-23): a page now
  // holds as many as fit, and the note that does not fit starts again at the top.
  const notes = Array.from({ length: 14 }, (_, i) => ({ id: `say-${i + 1}`, text: `Point ${i + 1}`, s: i }));
  const spec = validateCanvasSpec({ heading: "Notes", notes: [], cues: [], stage: { kind: "flow", arrangement: "chain", nodes: [{ id: "a", label: "A", s: 0 }, { id: "b", label: "B", s: 1 }], arrows: [] } }, 14)!;
  spec.notes = notes; // the planner's notes go on after validation (lib/canvas/generate.ts writeAsSaid), uncapped
  const marks = layoutPanel(spec).marks.filter((m) => m.type === "note") as Array<{ id: string; y: number; until?: number }>;
  assert.equal(marks.length, 14);
  const next = marks.findIndex((m, i) => i > 0 && m.y === marks[0].y);
  assert.ok(next >= 7, `the first page holds ${next} short notes`);
  assert.equal(marks[0].until, next, "the first page leaves when the first note that does not fit is written");
  assert.ok(marks.slice(0, next).every((m, i) => i === 0 || m.y > marks[i - 1].y), "read top to bottom");
  assert.equal(marks[13].until, undefined, "the last page stays");
});

test("a check card is refused for a give-away, a long option or wrong arithmetic", () => {
  const card = (options: Array<[string, boolean]>, feedback = "Because the area scale factor is 3² = 9."): QuizInteraction => ({ kind: "quiz", question: "Shape A has area 18 m² and the scale factor to B is 3. What is the area of B?", options: options.map(([text, correct]) => ({ text, correct, feedback })) });
  assert.deepEqual(checkCardIssues(card([["162 m²", true], ["54 m²", false], ["27 m²", false], ["6 m²", false]]), "Areas scale by k squared."), []);
  assert.ok(checkCardIssues(card([["162 m²", true], ["54 m²", false], ["27 m²", false], ["6 m²", false]], "Because 18 × 9 = 150."), "").some((i) => /arithmetic/.test(i)));
  assert.ok(checkCardIssues(card([["162 m² because every length is three times longer so the area is nine times larger", true], ["54 m²", false], ["27 m²", false]]), "").some((i) => /60 characters|much longer/.test(i)));
});

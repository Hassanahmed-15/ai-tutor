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
  const notes = boardNotesOf([{ s: 0, text: "Diploid: two sets (2n)" }, { s: 0, text: "duplicate sentence" }, { s: 9, text: "beyond the script" }, { s: 1, text: "Gametes are haploid." }], 3).boardNotes!;
  assert.deepEqual(notes, [{ s: 0, text: "Diploid: two sets (2n)" }, { s: 1, text: "Gametes are haploid" }]);
  const plan = validatePlan({ beats: [{ title: "Sets", stage: "flow", script: "Body cells are diploid. Gametes are haploid. Fertilisation restores two sets.", objects: [], board: [{ s: 0, text: "Body cells: 2n" }, { s: 2, text: "n + n → 2n" }] }] })!;
  assert.equal(plan.beats[0].boardNotes?.length, 2);
});

test("the notes column holds four at a time and is wiped for the next four, in reading order", () => {
  const notes = Array.from({ length: 6 }, (_, i) => ({ id: `say-${i + 1}`, text: `Point ${i + 1}`, s: i }));
  const spec = validateCanvasSpec({ heading: "Notes", notes, cues: [], stage: { kind: "flow", arrangement: "chain", nodes: [{ id: "a", label: "A", s: 0 }, { id: "b", label: "B", s: 1 }], arrows: [] } }, 6)!;
  const marks = layoutPanel(spec).marks.filter((m) => m.type === "note") as Array<{ id: string; y: number; until?: number }>;
  assert.equal(marks.length, 6);
  assert.equal(marks[0].until, 4, "the first page leaves when the fifth note is written");
  assert.equal(marks[4].y, marks[0].y, "the fifth note starts again at the top");
  assert.equal(marks[5].until, undefined, "the last page stays");
});

test("a check card is refused for a give-away, a long option or wrong arithmetic", () => {
  const card = (options: Array<[string, boolean]>, feedback = "Because the area scale factor is 3² = 9."): QuizInteraction => ({ kind: "quiz", question: "Shape A has area 18 m² and the scale factor to B is 3. What is the area of B?", options: options.map(([text, correct]) => ({ text, correct, feedback })) });
  assert.deepEqual(checkCardIssues(card([["162 m²", true], ["54 m²", false], ["27 m²", false], ["6 m²", false]]), "Areas scale by k squared."), []);
  assert.ok(checkCardIssues(card([["162 m²", true], ["54 m²", false], ["27 m²", false], ["6 m²", false]], "Because 18 × 9 = 150."), "").some((i) => /arithmetic/.test(i)));
  assert.ok(checkCardIssues(card([["162 m² because every length is three times longer so the area is nine times larger", true], ["54 m²", false], ["27 m²", false]]), "").some((i) => /60 characters|much longer/.test(i)));
});

import test from "node:test";
import assert from "node:assert/strict";
import { lookFeedback, lookUserText, parseBoardLook } from "../canvas/boardLookCheck";
import { dropBrokenRows } from "../canvas/equationCheck";
import { checkNumbers } from "../canvas/numberCheck";
import type { EquationStage } from "../canvas/types";

/*
 * EYES ON EVERY BOARD (owner, 2026-10-23: "100 percent accurate diagrams … don't reduce the amount of
 * visuals"). The vision check's answer is read strictly, and a working board never ships a broken or false
 * line — the manager's probability board showed "P(not blue) = 1 −" and "1 − 1 − 0.8 = 0.2".
 */
test("a look is read strictly: only named kinds of fault count, and 'ok' never stands beside one", () => {
  assert.deepEqual(parseBoardLook({ ok: true, problems: [] }), { ok: true, problems: [] });
  const refused = parseBoardLook({ ok: true, problems: [{ kind: "covers-writing", detail: "the CaCO3 box sits on '= 100'" }, { kind: "style", detail: "too plain" }] });
  assert.equal(refused.ok, false, "a named fault outweighs ok: true");
  assert.deepEqual(refused.problems.map((p) => p.kind), ["covers-writing"], "an unknown kind (style) is not a fault");
  assert.equal(parseBoardLook({ ok: false, problems: [] }).ok, true, "a refusal that names no fault cannot be redrawn to fix it");
  assert.equal(parseBoardLook("nonsense").ok, true, "no answer is not a refusal");
  assert.match(lookFeedback(refused.problems), /covers-writing: the CaCO3 box sits on '= 100'/);
  assert.match(lookUserText({ topic: "Probability", title: "The probability scale", script: "Probability runs from 0 to 1." }), /Board: The probability scale\nWhat Aria says/);
});

/*
 * LOOSENED (owner, 2026-10-24: "please loosen its check, it always rejects things"): only a fault that would
 * teach something false or leave the board unreadable refuses it; small layout notes let the board ship.
 */
test("a look refuses a board only for a serious fault", () => {
  const minor = parseBoardLook({ ok: false, problems: [{ kind: "covers-writing", detail: "a halo edge touches a label", serious: false }, { kind: "empty-shape", detail: "one plain box", serious: false }] });
  assert.equal(minor.ok, true, "minor notes alone never refuse a board");
  assert.equal(minor.problems.length, 2, "they are still recorded");
  const serious = parseBoardLook({ ok: true, problems: [{ kind: "wrong-fact", detail: "the label says arteries carry blood to the heart", serious: true }] });
  assert.equal(serious.ok, false);
  const unsaid = parseBoardLook({ ok: true, problems: [{ kind: "mislabelled", detail: "'aorta' points at the vena cava" }] });
  assert.equal(unsaid.ok, false, "a fault that misleads is serious when the answer does not say");
  const both = [...minor.problems, ...serious.problems];
  assert.match(lookFeedback(both), /wrong-fact/);
  assert.doesNotMatch(lookFeedback(both), /one plain box/, "the redraw is asked to fix only what is serious");
});

const stage = (rows: string[]): EquationStage => {
  const tokens: EquationStage["tokens"] = [];
  const steps = rows.map((r, i) => ({ s: i, order: r.split(" ").map((t, k) => { const id = `t${i}-${k}`; tokens.push({ id, text: t } as EquationStage["tokens"][number]); return id; }), highlight: [] as string[] }));
  return { kind: "equation", tokens, steps } as unknown as EquationStage;
};

test("a kept working board loses its incomplete and false lines, never its true ones", () => {
  const st = stage(["P(not blue) = 1 − P(blue)", "P(not blue) = 1 −", "P(not blue) = 1 − 0.8", "1 − 1 − 0.8 = 0.2", "P(not blue) = 0.2"]);
  assert.equal(dropBrokenRows(st, checkNumbers), 2);
  assert.equal(st.steps.length, 3);
  const all = stage(["x = 1 −", "= 4"]);
  assert.equal(dropBrokenRows(all, checkNumbers), 0, "every line broken: the board is not left blank");
  const fine = stage(["3 × 4 = 12", "12 + 1 = 13"]);
  assert.equal(dropBrokenRows(fine, checkNumbers), 0);
});

test("a picture board a code-drawn figure can draw is that figure; a course's atom map needs a real reaction", async () => {
  const { applyLessonVisualPolicy } = await import("../canvas/visualPolicy");
  const beat = (over: Record<string, unknown>) => ({ id: "b1", title: "Artery Structure", script: "An artery has a thick muscular wall and elastic tissue around a small lumen. It carries blood away from the heart at high pressure.", stage: "illustration", brief: "artery cross-section", objects: [], inside: null, carry: [], interaction: null, overview: false, ...over }) as never;
  const artery = applyLessonVisualPolicy([beat({ requiredVisual: { stages: ["illustration"], mustShow: [] } })], { mode: "prompt", topic: "Blood vessels", aiPictures: true });
  assert.equal(artery.beats[0].stage, "figure", "a typed-prompt lesson: the code-drawn blood-vessel figure, not a generated artery");
  assert.equal(artery.beats[0].figure, "bloodVessels");
  // A course lesson's picture is drawn by gpt-image-2 with its labels (owner, 2026-10-24; lib/canvas/courseFigures.ts).
  const course = applyLessonVisualPolicy([beat({ subject: "other", requiredVisual: { stages: ["illustration"], mustShow: [] } })], { mode: "course", topic: "Blood vessels", aiPictures: true });
  assert.equal(course.beats[0].stage, "illustration", "a course lesson: the artery is a gpt-image-2 picture");
  const formula = applyLessonVisualPolicy([beat({ title: "Formula masses with brackets", stage: "atom-map", script: "In Ca(OH)₂ the bracket means two hydroxide groups, so add the masses of one calcium, two oxygens and two hydrogens.", brief: "count atoms in Ca(OH)2", requiredVisual: { stages: ["atom-map"], mustShow: [] } })], { mode: "course", topic: "Relative formula mass", aiPictures: false });
  assert.notEqual(formula.beats[0].stage, "atom-map", "no reaction diagram for a formula that does not react");
});

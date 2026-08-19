import test from "node:test";
import assert from "node:assert/strict";

import { expressionFor, FACE_SHAPES } from "../adhd/expression";
import { initialFocus, advanceFocus, type FocusTracker } from "../adhd/focusState";

const hold = (t: FocusTracker, e: number | null, ms: number) => {
  for (let i = 0; i < ms / 1000; i++) t = advanceFocus(t, e, 1000);
  return t;
};

test("a skip gets SURPRISE, never disapproval", () => {
  // The whole track is built so a negative signal never reads as judgement of the learner. A
  // disappointed teacher staring back after a skip is exactly what makes someone with rejection
  // sensitive dysphoria close the app.
  const face = expressionFor({ focus: initialFocus(), streak: 0, flash: "skipped" });
  assert.equal(face, "surprised");
  assert.ok(FACE_SHAPES[face].curve >= 0, "and the mouth must not be a frown");
});

test("a correct answer flashes delight, outranking the steady state", () => {
  // Reacting to what just happened is what makes a face feel responsive rather than configured.
  const drifting = hold(initialFocus(), 0.2, 5000);
  assert.equal(expressionFor({ focus: drifting, streak: 0 }), "bored");
  assert.equal(expressionFor({ focus: drifting, streak: 0, flash: "correct" }), "delighted");
});

test("focus states map to the faces you would expect", () => {
  assert.equal(expressionFor({ focus: hold(initialFocus(), 0.95, 120_000), streak: 5 }), "delighted");
  assert.equal(expressionFor({ focus: hold(initialFocus(), 0.2, 5000), streak: 0 }), "bored");

  let crashed = hold(initialFocus(), 0.95, 120_000);
  crashed = advanceFocus(crashed, 0.5, 1000);
  assert.equal(expressionFor({ focus: crashed, streak: 0 }), "tired");
});

test("with no camera the streak still moves the face", () => {
  // focus stays "unknown" forever when consent was declined. Without this the learner would get a
  // permanently blank teacher as a side effect of a privacy choice.
  const none = initialFocus();
  assert.equal(expressionFor({ focus: none, streak: 0 }), "neutral");
  assert.equal(expressionFor({ focus: none, streak: 4 }), "pleased");
});

test("bored and tired read as low energy; delighted and pleased read as high", () => {
  // Guards the geometry table against an edit that inverts a face without anyone noticing.
  assert.ok(FACE_SHAPES.bored.eye < FACE_SHAPES.neutral.eye, "bored has heavier lids");
  assert.ok(FACE_SHAPES.delighted.eye > FACE_SHAPES.neutral.eye, "delight opens them");
  assert.ok(FACE_SHAPES.delighted.curve > FACE_SHAPES.pleased.curve, "and smiles harder");
  assert.ok(FACE_SHAPES.bored.curve < 0, "bored actually frowns");
  assert.ok(FACE_SHAPES.delighted.brow < FACE_SHAPES.bored.brow, "brows rise with mood");
});

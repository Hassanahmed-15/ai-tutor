import test from "node:test";
import assert from "node:assert/strict";

import { expressionFor, FACE_SHAPES } from "../adhd/expression";
import { initialFocus, advanceFocus, type FocusTracker } from "../adhd/focusState";

const hold = (t: FocusTracker, e: number | null, ms: number) => {
  for (let i = 0; i < ms / 1000; i++) t = advanceFocus(t, e, 1000);
  return t;
};

test("a skip gets FURIOUS, and an unanswered question gets sad", () => {
  // This asserted "surprised, never disapproval" — the track was built so a negative signal never
  // read as judgement of the learner. Changed to furious as an explicit product decision, so the
  // test is rewritten to pin the NEW rule rather than deleted.
  assert.equal(expressionFor({ focus: initialFocus(), streak: 0, flash: "skipped" }), "furious");
  assert.equal(expressionFor({ focus: initialFocus(), streak: 0, flash: "unanswered" }), "sad");

  // What survives the change: both are FLASHES. The caller clears `flash`, so the face returns to
  // the learner's actual state. A reaction decays; a verdict does not — and a permanent glare is
  // the thing that makes someone with rejection sensitive dysphoria close the app.
  assert.equal(expressionFor({ focus: initialFocus(), streak: 0, flash: null }), "neutral");
});

test("the two reproachful faces are distinguishable, not just both frowns", () => {
  // Sad and furious differ by brow DIRECTION, which is the only cue that separates worried from
  // cross. Height alone would make both read as sleepy.
  assert.ok(FACE_SHAPES.furious.tilt > 0, "furious brows drive down toward the nose");
  assert.ok(FACE_SHAPES.sad.tilt < 0, "sad brows lift at the nose — the worried shape");
  assert.ok(FACE_SHAPES.furious.glasses > FACE_SHAPES.neutral.glasses,
            "and furious peers over the top of the glasses");
});

test("a correct answer flashes delight, outranking the steady state", () => {
  // Reacting to what just happened is what makes a face feel responsive rather than configured.
  const drifting = hold(initialFocus(), 0.2, 5000);
  assert.equal(expressionFor({ focus: drifting, streak: 0 }), "bored");
  assert.equal(expressionFor({ focus: drifting, streak: 0, flash: "correct" }), "delighted");
});

test("focus states map to the faces you would expect", () => {
  // Sustained high engagement is HAPPY — the brief's "happy when engagement is high".
  assert.equal(expressionFor({ focus: hold(initialFocus(), 0.95, 120_000), streak: 5 }), "happy");
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

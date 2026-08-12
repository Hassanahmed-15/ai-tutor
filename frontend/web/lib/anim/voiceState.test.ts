import assert from "node:assert/strict";
import test from "node:test";
import { derivePhase } from "../../components/classroom/VoiceState";

test("drawing status remains visible while the lecture is paused", () => {
  assert.equal(
    derivePhase({ status: "drawing", ariaSpeaking: false, studentSpeaking: false, muted: false, paused: true }),
    "drawing",
  );
});

test("student speech outranks every teacher-side status", () => {
  assert.equal(
    derivePhase({ status: "drawing", ariaSpeaking: true, studentSpeaking: true, muted: false, paused: true }),
    "student-speaking",
  );
});

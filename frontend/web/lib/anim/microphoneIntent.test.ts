import assert from "node:assert/strict";
import test from "node:test";
import { MicrophoneIntent } from "../useGeminiLiveTutor";

test("an unmute requested before the microphone track exists is applied when it arrives", () => {
  const intent = new MicrophoneIntent(true);
  intent.set(true);
  const lateTrack = { enabled: false };

  intent.apply(lateTrack);

  assert.equal(lateTrack.enabled, true);
  assert.equal(intent.get(), true);
});

test("the latest microphone choice wins while Gemini is connecting", () => {
  const intent = new MicrophoneIntent(true);
  intent.set(true);
  intent.set(false);
  const lateTrack = { enabled: true };

  intent.apply(lateTrack);

  assert.equal(lateTrack.enabled, false);
});

test("a new call resets to its configured privacy default after teardown", () => {
  let intent = new MicrophoneIntent(true);
  intent.set(true);
  intent = new MicrophoneIntent(true);
  const nextCallTrack = { enabled: true };

  intent.apply(nextCallTrack);

  assert.equal(nextCallTrack.enabled, false);
});

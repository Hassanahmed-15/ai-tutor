/**
 * THE GATE HEARS THE STUDENT, NOT ITS OWN LECTURE — AND NEVER WAITS FOREVER ON WORDS.
 *
 * Driven through the production arbiter (lib/voice/runtime/arbiter.ts).
 */
import test from "node:test";
import assert from "node:assert/strict";

import { TurnArbiter } from "../voice/runtime/arbiter";

function lectureArbiter(requireAddressingBeforeOpen = true) {
  const events: string[] = [];
  const arbiter = new TurnArbiter({
    profile: "lecture",
    config: { requireAddressingBeforeOpen },
    callbacks: {
      onOpenTurn: (_p, reason) => events.push(`open: ${reason}`),
      onPauseTutor: (reason) => events.push(`pause: ${reason}`),
    },
  });
  return { arbiter, events };
}

test("the lecture's own sentence heard through the speakers is echo, not a question", () => {
  const { arbiter, events } = lectureArbiter();
  arbiter.setTutor({ speaking: true, expectingAnswer: false });
  arbiter.setTopicWords(["derivative", "slope", "tangent", "curve"]);
  arbiter.setEchoText("So what is a derivative? It is the slope of the tangent to the curve.", 1000);
  arbiter.onEndpoint({ type: "onset" } as never, 1100);
  arbiter.provideTranscript("what is a derivative it is the slope of the tangent", true, 1300);
  assert.match(arbiter.getLastVerdict()?.reason ?? "", /echo/);
  assert.equal(events.some((e) => e.startsWith("pause")), false, "the lecture is not paused by its own words");
});

test("the student's own question during the lecture still gets through, by name", () => {
  const { arbiter, events } = lectureArbiter();
  arbiter.setTutor({ speaking: true, expectingAnswer: false });
  arbiter.setEchoText("So what is a derivative? It is the slope of the tangent to the curve.", 1000);
  arbiter.onEndpoint({ type: "onset" } as never, 1100);
  arbiter.provideTranscript("aria what is the slope of the tangent", false, 1300);
  assert.equal(arbiter.getLastVerdict()?.addressed, true);
  assert.ok(events.some((e) => e.startsWith("open")), JSON.stringify(events));
});

test("a recogniser that has died stops the gate waiting for words", () => {
  const { arbiter, events } = lectureArbiter();
  arbiter.setTutor({ speaking: false, expectingAnswer: false });
  // One transcript early in the session proved the recogniser worked…
  arbiter.provideTranscript("hello", true, 10);
  // …then it died.
  arbiter.setTranscriberAlive(false);
  arbiter.onEndpoint({ type: "onset" } as never, 1000);
  arbiter.onEndpoint({ type: "start", preroll: [] } as never, 1200);
  for (let t = 1220; t <= 5000; t += 20) {
    arbiter.onFrame(new Float32Array(320), { speech: true, probability: 0.6, confidence: 0.8, features: { f0: null, voicing: 0 } } as never, t);
    arbiter.tick(t);
  }
  assert.ok(events.some((e) => e.startsWith("open")), `the turn was let through: ${JSON.stringify(events)}`);
});

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

/*
 * Measured in a real session: three "hey Aria"s during the lecture, each heard by the gate, each
 * transcribed by Chrome as something garbled ("Yaariyan"), each dropped as "no evidence it was for
 * the tutor" — because the server second opinion only ran when there were NO local words at all.
 */
function secondOpinionArbiter() {
  const events: string[] = [];
  const arbiter = new TurnArbiter({
    profile: "lecture",
    config: { requireAddressingBeforeOpen: true },
    callbacks: {
      onOpenTurn: (_p, reason) => events.push(`open: ${reason}`),
      onPauseTutor: (reason) => events.push(`pause: ${reason}`),
      onSecondOpinion: () => events.push("second-opinion"),
    },
  });
  arbiter.setTutor({ speaking: true, expectingAnswer: false });
  return { arbiter, events };
}

function speak(arbiter: TurnArbiter, from: number, to: number) {
  for (let t = from; t <= to; t += 20) {
    arbiter.onFrame(new Float32Array(320), { speech: true, probability: 0.9, confidence: 0.9, features: { f0: null, voicing: 0 } } as never, t);
  }
}

test("garbled local words for a short call still get a second opinion, and the right words open the turn", () => {
  const { arbiter, events } = secondOpinionArbiter();
  arbiter.onEndpoint({ type: "onset" } as never, 1000);
  arbiter.onEndpoint({ type: "start", preroll: [] } as never, 1200);
  speak(arbiter, 1000, 2400);
  arbiter.provideTranscript("hey ideal can", false, 1800);
  arbiter.onEndpoint({ type: "end", durationMs: 1400, reason: "silence" } as never, 2600);
  assert.deepEqual(events, ["second-opinion"], "held for the server, not dropped");
  assert.equal(arbiter.getState(), "verifying");
  arbiter.provideSecondOpinion("Hey Aria, can you explain this?", 3800);
  assert.ok(events.some((e) => e.startsWith("open")), JSON.stringify(events));
  assert.ok(events.some((e) => e.startsWith("pause")), "the lecture pauses for the student");
});

test("the lecture's own echo is not sent for a second opinion", () => {
  const { arbiter, events } = secondOpinionArbiter();
  arbiter.setEchoText("Removing a node may disconnect parts of the tree from the rest.", 900);
  arbiter.onEndpoint({ type: "onset" } as never, 1000);
  speak(arbiter, 1000, 2400);
  arbiter.provideTranscript("removing a node may disconnect parts of the tree", true, 2000);
  arbiter.onEndpoint({ type: "end", durationMs: 1400, reason: "silence" } as never, 2600);
  assert.deepEqual(events, []);
});

test("a long conversation near the mic is not sent for a second opinion", () => {
  const { arbiter, events } = secondOpinionArbiter();
  arbiter.onEndpoint({ type: "onset" } as never, 1000);
  speak(arbiter, 1000, 5000);
  arbiter.provideTranscript("so I told him that we would meet after the match on Saturday and then go to the market for groceries", true, 4800);
  arbiter.onEndpoint({ type: "end", durationMs: 4000, reason: "silence" } as never, 5200);
  assert.deepEqual(events, []);
});

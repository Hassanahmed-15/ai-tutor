/**
 * "I keep calling Aria and she does not respond" (2026-11-09).
 *
 * Replayed through the real arbiter on a simulated clock, two things lost every call in a row: Chrome
 * writing down her narration instead of the call (judged her echo, so the server was never asked),
 * and a wrong voice profile vetoing her name for the rest of the lecture. Each test is one of those,
 * or the reason the fix is narrow: her own narration must still never stop her.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { TurnArbiter } from "../voice/runtime/arbiter";

const frame = new Float32Array(320);
const voiced = { speech: true, features: { f0: 180, voicing: 0.9 } } as never;
const NARRATION = "A stack keeps its items in order and the last item pushed onto the stack is always the first item that comes back off the stack again";
const ECHO: Array<[string, boolean]> = [["the last item pushed onto the stack is always the first item", true]];

function setup({ similarity, on = true, config = {} }: { similarity?: number; on?: boolean; config?: Record<string, number> } = {}) {
  const seen = { pause: 0, second: 0 };
  const verifier = similarity === undefined
    ? undefined
    : ({ enrolled: true, enrolledFrames: 100, match: () => ({ similarity, verdict: similarity <= 0.42 ? "other" : "student", reason: "" }), enrol() {} } as never);
  const arbiter = new TurnArbiter({
    profile: "lecture",
    verifier,
    config: { requireAddressingBeforeOpen: true, callByNameAlwaysHeard: on, ...config },
    callbacks: { onPauseTutor: () => { seen.pause += 1; }, onSecondOpinion: () => { seen.second += 1; } },
  });
  arbiter.setTutor({ speaking: true, expectingAnswer: false, speakingAs: "lecture" });
  arbiter.setEchoText(NARRATION, 0);
  return { arbiter, seen };
}

/** One utterance, then what the server hears if it is asked. Returns when it finished. */
function say(arbiter: TurnArbiter, at: number, words: Array<[string, boolean]>, server?: string): number {
  // A lecture says a new sentence every few seconds; the gate only trusts the last 20 s of them.
  arbiter.setEchoText(NARRATION, at);
  arbiter.onEndpoint({ type: "onset", at } as never, at);
  arbiter.onEndpoint({ type: "start", at: at + 200, preroll: [frame] } as never, at + 200);
  let now = at;
  for (let i = 0; i < 40; i++) {
    now = at + i * 20;
    arbiter.onFrame(frame, voiced, now);
  }
  for (const [text, final] of words) arbiter.provideTranscript(text, final, now);
  now += 700;
  arbiter.onEndpoint({ type: "end", reason: "silence", durationMs: 800, at: now } as never, now);
  if (arbiter.getState() === "verifying" && server !== undefined) {
    now += 800;
    arbiter.provideSecondOpinion(server, now);
  }
  return now;
}

/** Five calls a few seconds apart, the reply to each one starting as it would. */
function callFiveTimes(arbiter: TurnArbiter, words: Array<[string, boolean]>, server?: string): void {
  let at = 1_000;
  for (let i = 0; i < 5; i++) {
    at = say(arbiter, at, words, server) + 4_000;
    arbiter.responseStarted(at);
  }
}

test("a call Chrome wrote down as her narration is still heard, every time", () => {
  const { arbiter, seen } = setup();
  callFiveTimes(arbiter, ECHO, "Hey Aria");
  assert.equal(seen.second, 5);
  assert.equal(seen.pause, 5);
});

test("a long run of words under the narration does not hide the call", () => {
  const { arbiter, seen } = setup();
  callFiveTimes(arbiter, [["and so we say that the thing on top goes away before anything else that came along much earlier", true]], "Hey Aria");
  assert.equal(seen.pause, 5);
});

test("a wrong voice profile cannot veto her name, heard locally or by the server", () => {
  const local = setup({ similarity: 0.3 });
  callFiveTimes(local.arbiter, [["hey aria", true]], "Hey Aria");
  assert.equal(local.seen.pause, 5);
  const server = setup({ similarity: 0.3 });
  callFiveTimes(server.arbiter, [], "Hey Aria");
  assert.equal(server.seen.pause, 5);
});

test("the voice check still turns away vague speech from another voice", () => {
  const { arbiter, seen } = setup({ similarity: 0.3 });
  callFiveTimes(arbiter, [], "Can you explain that again");
  assert.equal(seen.pause, 0);
});

test("her own narration never stops her, even when the server is asked", () => {
  for (const server of [NARRATION, "So what is a stack?", "and the teacher finds the total area"]) {
    const { arbiter, seen } = setup();
    callFiveTimes(arbiter, ECHO, server);
    assert.equal(seen.pause, 0, server);
  }
});

test("the extra checks are rationed, by time and in total", () => {
  const close = setup();
  let at = 1_000;
  for (let i = 0; i < 4; i++) at = say(close.arbiter, at, ECHO, "") + 500;
  assert.ok(close.seen.second < 4, "calls under the gap share one check");

  const capped = setup({ config: { extraChecksMax: 2, extraCheckGapMs: 0 } });
  at = 1_000;
  for (let i = 0; i < 5; i++) at = say(capped.arbiter, at, ECHO, "") + 4_000;
  assert.equal(capped.seen.second, 2);
});

test("with the option off the gate behaves exactly as before", () => {
  const echo = setup({ on: false });
  callFiveTimes(echo.arbiter, ECHO, "Hey Aria");
  assert.equal(echo.seen.second, 0);
  assert.equal(echo.seen.pause, 0);
  const voice = setup({ on: false, similarity: 0.3 });
  callFiveTimes(voice.arbiter, [["hey aria", true]], "Hey Aria");
  assert.equal(voice.seen.pause, 0);
});

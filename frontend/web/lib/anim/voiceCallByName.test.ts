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

/*
 * "You keep saying aria aria and it listens after multiple retries" (2026-11-10). The check at the
 * end of speech was postponed by the repeats themselves, and until a first call succeeds there is
 * no voice profile. The name check runs during the speech.
 */
function watch({ config = {}, on = true, second = false, speaking = true }: { config?: Record<string, number>; on?: boolean; second?: boolean; speaking?: boolean } = {}) {
  const seen = { pause: 0, checks: 0, clip: 0 };
  const arbiter = new TurnArbiter({
    profile: "lecture",
    config: { requireAddressingBeforeOpen: true, callByNameAlwaysHeard: on, ...config },
    callbacks: {
      onPauseTutor: () => { seen.pause += 1; },
      onNameCheck: (audio) => { seen.checks += 1; seen.clip = audio.length; },
      ...(second ? { onSecondOpinion: () => {} } : {}),
    },
  });
  arbiter.setTutor({ speaking, expectingAnswer: false, speakingAs: "lecture" });
  return { arbiter, seen };
}
function begin(arbiter: TurnArbiter, at: number): void {
  arbiter.onEndpoint({ type: "onset", at } as never, at);
  arbiter.onEndpoint({ type: "start", at: at + 200, preroll: [frame] } as never, at + 200);
}
function voice(arbiter: TurnArbiter, from: number, ms: number): number {
  for (let t = from; t < from + ms; t += 20) arbiter.onFrame(frame, voiced, t);
  return from + ms;
}
const gap = (arbiter: TurnArbiter, at: number) => arbiter.onEndpoint({ type: "pause", at, spokenMs: 400 } as never, at);

test("the very first bare Aria is heard at the first small gap, with no voice profile", () => {
  const { arbiter, seen } = watch();
  begin(arbiter, 1_000);
  gap(arbiter, voice(arbiter, 1_000, 400) + 150);
  assert.equal(seen.checks, 1);
  arbiter.provideNameCheck("Aria.", 2_000);
  assert.equal(seen.pause, 1);
});

test("repeating her name keeps counting while a check is out, and the next one is heard", () => {
  const { arbiter, seen } = watch();
  begin(arbiter, 1_000);
  let at = voice(arbiter, 1_000, 400) + 150;
  gap(arbiter, at);
  arbiter.provideNameCheck("", at + 500);
  assert.equal(arbiter.getState(), "attending");
  at = voice(arbiter, at + 1_300, 400) + 150;
  gap(arbiter, at);
  assert.equal(seen.checks, 2);
  arbiter.provideNameCheck("Aria, Aria", at + 500);
  assert.equal(seen.pause, 1);
});

test("her voice leaking into the mic leaves no gap, and the call is still heard", () => {
  const { arbiter, seen } = watch();
  begin(arbiter, 1_000);
  let at = voice(arbiter, 1_000, 1_100);
  assert.equal(seen.checks, 1);
  assert.ok(seen.clip <= 65, "only the last moments are sent");
  arbiter.provideNameCheck("the last plate you put on the pile", at);
  assert.equal(seen.pause, 0);
  at = voice(arbiter, at, 1_400);
  assert.equal(seen.checks, 2);
  arbiter.provideNameCheck("the last plate, Aria", at);
  assert.equal(seen.pause, 1);
});

test("nothing but her literal name stops her through this check", () => {
  for (const heard of ["and the teacher finds the total area", "So what is a stack?", "Maria", ""]) {
    const { arbiter, seen } = watch();
    begin(arbiter, 1_000);
    gap(arbiter, voice(arbiter, 1_000, 400) + 150);
    arbiter.provideNameCheck(heard, 2_000);
    assert.equal(seen.pause, 0, heard);
  }
});

test("a script that says her name does not stop her", () => {
  const { arbiter, seen } = watch();
  arbiter.setEchoText("Hi I am Aria and today we will look at stacks", 900);
  begin(arbiter, 1_000);
  gap(arbiter, voice(arbiter, 1_000, 400) + 150);
  arbiter.provideNameCheck("I am Aria", 2_000);
  assert.equal(seen.pause, 0);
});

test("a check still out when the speech ends decides the utterance", () => {
  const heard = watch();
  begin(heard.arbiter, 1_000);
  let at = voice(heard.arbiter, 1_000, 400) + 150;
  gap(heard.arbiter, at);
  at += 700;
  heard.arbiter.onEndpoint({ type: "end", reason: "silence", durationMs: 400, at } as never, at);
  assert.equal(heard.arbiter.getState(), "verifying");
  heard.arbiter.provideNameCheck("Aria", at + 300);
  assert.equal(heard.seen.pause, 1);

  const missed = watch();
  begin(missed.arbiter, 1_000);
  at = voice(missed.arbiter, 1_000, 400) + 150;
  gap(missed.arbiter, at);
  at += 700;
  missed.arbiter.onEndpoint({ type: "end", reason: "silence", durationMs: 400, at } as never, at);
  missed.arbiter.provideNameCheck("something else", at + 300);
  assert.equal(missed.seen.pause, 0);
  assert.equal(missed.arbiter.getState(), "refractory");
});

test("the name checks are rationed, one at a time", () => {
  const busy = watch();
  begin(busy.arbiter, 1_000);
  voice(busy.arbiter, 1_000, 6_000);
  assert.equal(busy.seen.checks, 1, "never a second while one is out");

  const capped = watch({ config: { nameChecksMax: 2, nameCheckGapMs: 0 } });
  begin(capped.arbiter, 1_000);
  let at = 1_000;
  for (let i = 0; i < 6; i++) {
    at = voice(capped.arbiter, at, 1_100);
    capped.arbiter.provideNameCheck("", at);
  }
  assert.equal(capped.seen.checks, 2);
});

test("no name check when she is silent or the option is off", () => {
  for (const options of [{ speaking: false }, { on: false }]) {
    const { arbiter, seen } = watch(options);
    begin(arbiter, 1_000);
    gap(arbiter, voice(arbiter, 1_000, 2_000) + 150);
    assert.equal(seen.checks, 0);
  }
});


test("a call that starts during a server check is joined and heard when the check ends", () => {
  const { arbiter, seen } = watch({ second: true });
  begin(arbiter, 1_000);
  let at = voice(arbiter, 1_000, 400) + 150;
  at += 700;
  arbiter.onEndpoint({ type: "end", reason: "silence", durationMs: 400, at } as never, at);
  assert.equal(arbiter.getState(), "verifying");
  // The student calls now: the gate is busy and this onset does not open an episode.
  arbiter.onEndpoint({ type: "onset", at: at + 50 } as never, at + 50);
  arbiter.onEndpoint({ type: "start", at: at + 250, preroll: [frame] } as never, at + 250);
  let t = voice(arbiter, at + 50, 500);
  arbiter.provideSecondOpinion("the last plate you put on the pile", t);
  assert.equal(arbiter.getState(), "refractory");
  t = voice(arbiter, t, 500);
  assert.equal(arbiter.getState(), "attending", "joined once the cooldown ended");
  t += 150;
  arbiter.onEndpoint({ type: "pause", at: t, spokenMs: 400 } as never, t);
  arbiter.provideNameCheck("Aria", t + 400);
  assert.equal(seen.pause, 1);
});

test("speech joined mid-way can only be accepted by her name", () => {
  const { arbiter, seen } = watch({ second: true });
  let asked = 0;
  (arbiter as unknown as { callbacks: { onSecondOpinion: () => void } }).callbacks.onSecondOpinion = () => { asked += 1; };
  begin(arbiter, 1_000);
  let at = voice(arbiter, 1_000, 400) + 850;
  arbiter.onEndpoint({ type: "end", reason: "silence", durationMs: 400, at } as never, at);
  arbiter.onEndpoint({ type: "onset", at: at + 50 } as never, at + 50);
  let t = voice(arbiter, at + 50, 500);
  arbiter.provideSecondOpinion("nothing useful here", t);
  t = voice(arbiter, t, 600);
  assert.equal(arbiter.getState(), "attending");
  t += 850;
  arbiter.onEndpoint({ type: "end", reason: "silence", durationMs: 600, at: t } as never, t);
  assert.equal(arbiter.getState(), "verifying");
  assert.equal(asked, 2);
  arbiter.provideSecondOpinion("Can you explain what that means for me?", t + 300);
  assert.equal(seen.pause, 0);
});

test("with the option off nothing is joined", () => {
  const { arbiter } = watch({ on: false, second: true });
  arbiter.onEndpoint({ type: "onset", at: 1_000 } as never, 1_000);
  arbiter.provideTranscript("hello there", true, 1_050);
  arbiter.onEndpoint({ type: "abort", at: 1_100, reason: "blip" } as never, 1_100);
  arbiter.onEndpoint({ type: "start", at: 1_200, preroll: [frame] } as never, 1_200);
  voice(arbiter, 1_600, 600);
  assert.notEqual(arbiter.getState(), "attending");
});

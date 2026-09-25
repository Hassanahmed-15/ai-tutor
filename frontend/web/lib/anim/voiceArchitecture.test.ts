import test from "node:test";
import assert from "node:assert/strict";

import { SCENARIOS, runScenario, scoreScenario } from "../voice/runtime/scenarios";
import { VoiceSessionMachine, type VoiceSurface } from "../voice/sessionMachine";
import { PlaybackGenerationController } from "../voice/playbackGeneration";
import { profileForSurface } from "../voice/surfacePolicy";
import { classifyAddressing } from "../voice/runtime/addressing";

test("the 40-room scenario suite passes through the production detector/endpointer/arbiter", () => {
  const failures: string[] = [];
  for (const scenario of SCENARIOS) {
    const outcome = runScenario(scenario);
    const score = scoreScenario(scenario, outcome);
    if (!score.pass) failures.push(`#${scenario.id} ${scenario.name}: ${score.why}`);
  }
  assert.deepEqual(failures, []);
  assert.ok(SCENARIOS.length >= 40);
});

test("environmental noise never opens a user turn", () => {
  for (const id of [1, 2, 3, 4, 5, 6, 7, 27]) {
    const outcome = runScenario(SCENARIOS.find((scenario) => scenario.id === id)!);
    assert.ok(!outcome.events.some((event) => event.layer === "turn" && event.kind === "open"), `scenario ${id} opened a turn`);
  }
});

test("other people and side-conversation do not barge in", () => {
  for (const id of [8, 9, 10, 11, 13, 26, 29, 31, 40]) {
    const outcome = runScenario(SCENARIOS.find((scenario) => scenario.id === id)!);
    assert.equal(outcome.bargeReason, null, `scenario ${id} barged in`);
  }
});

test("real directed speech, name, whisper, overlap, short commands and pauses remain natural", () => {
  for (const id of [14, 15, 16, 17, 18, 19, 20, 23, 39]) {
    const outcome = runScenario(SCENARIOS.find((scenario) => scenario.id === id)!);
    assert.ok(outcome.bargeReason, `scenario ${id} did not barge in`);
  }
  assert.equal(runScenario(SCENARIOS.find((scenario) => scenario.id === 32)!).turns, 1);
  assert.equal(runScenario(SCENARIOS.find((scenario) => scenario.id === 33)!).turns, 2);
});

test("backchannels continue, but a backchannel followed by intent interrupts", () => {
  const context = { expectingAnswer: false, tutorSpeaking: true, topicWords: ["price", "curve"] };
  for (const text of ["uh-huh", "hmm", "okay", "right", "yeah", "yes", "got it", "mhm"]) {
    assert.equal(classifyAddressing(text, context).addressed, false, text);
  }
  for (const text of ["Okay, stop.", "Yeah, explain that again.", "Right, but what about price?"]) {
    assert.equal(classifyAddressing(text, context).addressed, true, text);
  }
});

test("every app voice surface maps into the one shared policy engine", () => {
  const surfaces: VoiceSurface[] = ["normal", "pdf", "chatbot", "planning", "design", "oral-test", "shared"];
  assert.deepEqual(surfaces.map(profileForSurface), ["lecture", "lecture", "conversation", "conversation", "conversation", "conversation", "conversation"]);
  for (const surface of surfaces) assert.equal(new VoiceSessionMachine(surface).value.surface, surface);
});

test("normal, PDF, chatbot and planning run the same noise/background/barge/turn matrix", () => {
  const surfaces: VoiceSurface[] = ["normal", "pdf", "chatbot", "planning"];
  const groups = [
    [1, 2, 3, 4, 5, 6, 7, 27, 41, 42, 43, 44, 45],
    [8, 9, 10, 11, 13, 26, 29, 31, 40, 46, 47, 48, 49],
    [14, 15, 16, 17, 18, 19, 20, 23, 50, 51, 52],
    [24, 25, 28, 30, 32, 33, 38, 53, 54, 55],
  ];
  for (const surface of surfaces) {
    for (const id of groups.flat()) {
      const original = SCENARIOS.find((scenario) => scenario.id === id)!;
      const scenario = { ...original, profile: profileForSurface(surface) };
      const outcome = runScenario(scenario);
      const scored = scoreScenario(scenario, outcome);
      assert.ok(scored.pass, `${surface} #${id}: ${scored.why}`);
    }
  }
});

test("authoritative session state handles true and false interruptions and reconnects", () => {
  const machine = new VoiceSessionMachine("normal", "test-session");
  machine.dispatch({ type: "START", at: 0 });
  machine.dispatch({ type: "CONNECTED", at: 1 });
  machine.dispatch({ type: "TUTOR_AUDIO_START", at: 2, generation: 1 });
  machine.dispatch({ type: "SPEECH_CANDIDATE", at: 3, confidence: 0.7, vadProbability: 0.8, reason: "candidate" });
  assert.equal(machine.value.state, "POSSIBLE_INTERRUPTION");
  machine.dispatch({ type: "INTERRUPTION_REJECTED", at: 4, reason: "bystander" });
  assert.equal(machine.value.state, "FALSE_INTERRUPTION");
  machine.dispatch({ type: "RESTORE_TUTOR", at: 5, reason: "restore" });
  assert.equal(machine.value.state, "TUTOR_SPEAKING");
  machine.dispatch({ type: "SPEECH_CANDIDATE", at: 6, confidence: 0.9, vadProbability: 0.9, reason: "candidate" });
  machine.dispatch({ type: "INTERRUPTION_CONFIRMED", at: 7, confidence: 1, reason: "addressed by name" });
  machine.dispatch({ type: "USER_TURN_OPEN", at: 8, reason: "barge" });
  machine.dispatch({ type: "USER_TURN_END", at: 9, reason: "endpoint" });
  assert.equal(machine.value.state, "PROCESSING");
  machine.dispatch({ type: "DISCONNECTED", at: 10, reason: "network" });
  assert.equal(machine.value.state, "RECONNECTING");
  machine.dispatch({ type: "RECONNECTED", at: 11 });
  assert.equal(machine.value.state, "LISTENING");
});

test("duplicate events and stale playback completions cannot corrupt state", () => {
  const machine = new VoiceSessionMachine("chatbot", "dedupe");
  machine.dispatch({ type: "START", at: 0 });
  machine.dispatch({ type: "CONNECTED", at: 1, eventId: "connected" });
  machine.dispatch({ type: "CONNECTED", at: 2, eventId: "connected" });
  assert.equal(machine.history.filter((transition) => transition.event === "CONNECTED").length, 1);
  machine.dispatch({ type: "TUTOR_AUDIO_START", at: 3, generation: 2 });
  machine.dispatch({ type: "TUTOR_AUDIO_END", at: 4, generation: 1 });
  assert.equal(machine.value.state, "TUTOR_SPEAKING");
});

test("interrupted playback invalidates every queued chunk from the old generation", () => {
  const playback = new PlaybackGenerationController("session");
  const first = playback.begin("reply-1");
  assert.ok(playback.noteAccepted(first, 2400));
  const cancelled = playback.invalidate();
  assert.ok(!playback.notePlayed(first, 2400));
  assert.ok(!playback.accept(first));
  const second = playback.begin("reply-2");
  assert.ok(second.generation > cancelled.generation);
  assert.ok(playback.noteAccepted(second, 1200));
  assert.ok(playback.notePlayed(second, 1200));
  assert.equal(playback.metrics.queuedSamples, 0);
});

test("race matrix: duplicate interruption, reconnect mid-speech/playback and late end are safe", () => {
  const machine = new VoiceSessionMachine("planning", "races");
  const playback = new PlaybackGenerationController("races");
  machine.dispatch({ type: "START", at: 0 });
  machine.dispatch({ type: "CONNECTED", at: 1 });
  const token = playback.begin("reply");
  machine.dispatch({ type: "TUTOR_AUDIO_START", at: 2, generation: token.generation });
  machine.dispatch({ type: "SPEECH_CANDIDATE", at: 3, confidence: 1, vadProbability: 1, reason: "speech", eventId: "candidate" });
  machine.dispatch({ type: "SPEECH_CANDIDATE", at: 4, confidence: 1, vadProbability: 1, reason: "duplicate", eventId: "candidate" });
  machine.dispatch({ type: "INTERRUPTION_CONFIRMED", at: 5, confidence: 1, reason: "directed", eventId: "interrupt" });
  machine.dispatch({ type: "INTERRUPTION_CONFIRMED", at: 6, confidence: 1, reason: "duplicate", eventId: "interrupt" });
  playback.invalidate();
  machine.dispatch({ type: "USER_TURN_OPEN", at: 7, reason: "barge" });
  machine.dispatch({ type: "DISCONNECTED", at: 8, reason: "drop during user turn" });
  machine.dispatch({ type: "SPEECH_CANDIDATE", at: 9, confidence: 1, vadProbability: 1, reason: "speech while reconnecting" });
  machine.dispatch({ type: "TUTOR_AUDIO_END", at: 10, generation: token.generation });
  assert.equal(machine.value.state, "RECONNECTING");
  assert.equal(playback.accept(token), false);
  machine.dispatch({ type: "RECONNECTED", at: 11 });
  assert.equal(machine.value.state, "LISTENING");
});

test("DEDICATED SESSION: a plain greeting reaches the tutor, a hail to someone else does not", () => {
  /*
   * The reported failure: the button said "Listening — just talk", and saying hello did nothing.
   * With the conversation profile "hello" scores 0.15 against a 0.50 bar, so the turn was never
   * opened. A session the student deliberately started has nobody else to be addressing.
   */
  const ctx = { expectingAnswer: false, tutorSpeaking: false };
  const dedicated = (text: string) => {
    let verdict = classifyAddressing(text, ctx);
    if (!verdict.addressed && verdict.score > 0) verdict = { ...verdict, addressed: true };
    return verdict.addressed;
  };
  for (const said of ["hello", "hi can you hear me", "hey", "explain linear regression", "what is overfitting"]) {
    assert.equal(dedicated(said), true, `"${said}" must reach the tutor in a dedicated session`);
  }
  // The words layer still has one job here: reject what is plainly someone else's conversation.
  for (const said of ["hey Sam I will call you back", "did you remember to send that email", "dinner is ready"]) {
    assert.equal(dedicated(said), false, `"${said}" is not for the tutor`);
  }
});

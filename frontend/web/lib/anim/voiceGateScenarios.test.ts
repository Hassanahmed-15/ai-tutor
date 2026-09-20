/**
 * THE ROOM, SCENARIO BY SCENARIO — the full gate (acoustic + speaker + words) against everything a
 * real room does, with the REAL addressing classifier and a REAL enrolled voiceprint, so nothing
 * is handed in by hand.
 *
 * Each case states what a person in the room would say the right outcome is:
 *   SILENT   — Aria neither stops nor answers; ideally no turn opens at all
 *   TURN     — a turn reaches the model (Aria silent) and she answers
 *   BARGE-IN — Aria stops mid-sentence and listens
 *
 * What synthesised audio proves: the decision logic, the layering, and that each acoustic class
 * is rejected for the property it is supposed to be rejected for. What it cannot prove: a real
 * false-interruption rate. That needs a microphone and a room, and no number here is one.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { analyzeVoiceFrame } from "../voice/features";
import { HeuristicVoiceprint } from "../voice/speakerProfile";
import { VoiceGate, type GateDecision, type GateProfile } from "../voice/voiceGate";

const RATE = 16_000;
const FRAME = 320; // 20 ms
const MS = 20;

// --- Generators (one 20 ms frame each, phase-continuous via `offset`) -----------------------------

function xorshift(seed: number) {
  let x = (seed || 1) | 0;
  return () => {
    x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
    return (x >>> 0) / 0xffffffff * 2 - 1;
  };
}
function noise(amplitude: number, seed: number): Float32Array {
  const rnd = xorshift(seed);
  const out = new Float32Array(FRAME);
  for (let i = 0; i < FRAME; i++) out[i] = rnd() * amplitude;
  return out;
}
/** Fan / AC: tonal hum, all of it below the speech band. */
function fan(amplitude: number, offset: number): Float32Array {
  const out = new Float32Array(FRAME);
  for (let i = 0; i < FRAME; i++) {
    const t = (offset * FRAME + i) / RATE;
    out[i] = amplitude * (Math.sin(2 * Math.PI * 60 * t) * 0.6 + Math.sin(2 * Math.PI * 120 * t) * 0.3 + Math.sin(2 * Math.PI * 95 * t) * 0.1);
  }
  return out;
}
/** Traffic: low rumble plus broadband hiss, slowly swelling. */
function traffic(amplitude: number, offset: number): Float32Array {
  const swell = 0.6 + 0.4 * Math.sin(offset / 20);
  const rumble = fan(amplitude * swell, offset);
  const hiss = noise(amplitude * 0.5 * swell, offset + 101);
  return mix(rumble, hiss);
}
/**
 * A voice: harmonic stack from the 2nd harmonic with a spectral tilt (timbre), a 5 Hz syllabic
 * loudness pulse and a 1.5% pitch vibrato. The modulation is not decoration — it is the property
 * that separates a voice from a chord or a hum, and the gate tests for it, so a voice synthesised
 * without it would be a tuning fork and fail as one.
 */
function voice(f0: number, offset: number, amplitude = 0.14, tilt = 1.0): Float32Array {
  const out = new Float32Array(FRAME);
  const DEPTH = 0.015;
  const VIBRATO_HZ = 6;
  for (let i = 0; i < FRAME; i++) {
    const t = (offset * FRAME + i) / RATE;
    /*
     * Phase is the INTEGRAL of instantaneous frequency. Multiplying a wobbling pitch by absolute
     * time instead — the obvious mistake — makes the wobble a chirp that grows without bound, and
     * by half a second the "1.5% vibrato" is a 25% frequency swing that no estimator could track.
     * ∫ f0·(1 + d·sin(2πFt)) dt = f0·(t − d·cos(2πFt)/(2πF)), so the phase below is exact.
     */
    const phaseTime = t - (DEPTH * Math.cos(2 * Math.PI * VIBRATO_HZ * t)) / (2 * Math.PI * VIBRATO_HZ);
    const syllable = 0.65 + 0.35 * Math.sin(2 * Math.PI * 5 * t);
    let s = 0;
    for (let h = 2; h <= 24; h++) {
      const hz = f0 * h;
      if (hz > 3800) break;
      s += Math.sin(2 * Math.PI * hz * phaseTime) / Math.pow(h, tilt);
    }
    out[i] = s * amplitude * syllable;
  }
  return out;
}
const STUDENT = (offset: number, amp = 0.14) => voice(130, offset, amp, 1.0);
const FRIEND = (offset: number, amp = 0.12) => voice(215, offset, amp, 0.6);
const ARIA = (offset: number, amp = 0.16) => voice(200, offset, amp, 0.8);
/** Music / TV: a chord of three tones in the speech band, steady. */
function music(amplitude: number, offset: number): Float32Array {
  const out = new Float32Array(FRAME);
  for (let i = 0; i < FRAME; i++) {
    const t = (offset * FRAME + i) / RATE;
    out[i] = amplitude * (Math.sin(2 * Math.PI * 440 * t) + Math.sin(2 * Math.PI * 554 * t) + Math.sin(2 * Math.PI * 659 * t)) / 3;
  }
  return out;
}
/** A notification ping: a short 1.5 kHz tone with a decaying envelope. */
function ping(offset: number, startFrame: number, lengthFrames = 8): Float32Array {
  const out = new Float32Array(FRAME);
  const k = offset - startFrame;
  if (k < 0 || k >= lengthFrames) return out;
  for (let i = 0; i < FRAME; i++) {
    const t = (k * FRAME + i) / RATE;
    out[i] = 0.4 * Math.exp(-t * 12) * Math.sin(2 * Math.PI * 1500 * t);
  }
  return out;
}
function click(amplitude: number): Float32Array {
  const out = new Float32Array(FRAME);
  for (let i = 0; i < 20; i++) out[i] = amplitude * (i % 2 === 0 ? 1 : -1) * (1 - i / 20);
  return out;
}
function silence(): Float32Array {
  return new Float32Array(FRAME);
}
function mix(a: Float32Array, b: Float32Array): Float32Array {
  const out = new Float32Array(FRAME);
  for (let i = 0; i < FRAME; i++) out[i] = a[i] + b[i];
  return out;
}
function seq(count: number, make: (i: number) => Float32Array): Float32Array[] {
  return Array.from({ length: count }, (_, i) => make(i));
}

// --- Harness ------------------------------------------------------------------------------------

type Expect = "SILENT" | "TURN" | "BARGE-IN";

interface Scenario {
  name: string;
  expect: Expect;
  profile?: GateProfile;
  frames: Float32Array[];
  /** Tutor audible for these frames (a range), else silent throughout. */
  tutorSpeakingFrames?: [number, number];
  expectingAnswer?: boolean;
  /** Transcript arriving during the audio. `final` defaults to true. */
  transcript?: { text: string; atFrame: number; final?: boolean };
  /** A second transcript, for interim-then-final cases. */
  transcript2?: { text: string; atFrame: number; final?: boolean };
  /** Skip enrolment: the gate has never heard the student. */
  unenrolled?: boolean;
  /** Ducking is allowed but must be undone: assert restore if ducked. */
}

interface Outcome {
  verdict: Expect;
  listened: boolean;
  ducked: boolean;
  restored: boolean;
  discarded: boolean;
  bargeReason: string | null;
  decisions: GateDecision[];
}

function enrolledVoiceprint(): HeuristicVoiceprint {
  const vp = new HeuristicVoiceprint();
  for (let i = 0; i < 80; i++) {
    const drift = 1 + 0.08 * Math.sin(i / 5);
    const a = STUDENT(i);
    // Scale for a little pitch drift by re-synthesising at the drifted f0.
    void a;
    vp.enrol(analyzeVoiceFrame(concat(voice(130 * drift, i, 0.14, 1.0), voice(130 * drift, i + 1, 0.14, 1.0)), RATE));
  }
  assert.ok(vp.enrolled, "test voiceprint must be enrolled");
  return vp;
}
function concat(a: Float32Array, b: Float32Array): Float32Array {
  const out = new Float32Array(a.length + b.length);
  out.set(a); out.set(b, a.length);
  return out;
}

function run(s: Scenario): Outcome {
  const o: Outcome = { verdict: "SILENT", listened: false, ducked: false, restored: false, discarded: false, bargeReason: null, decisions: [] };
  let turnEnded = false;
  const gate = new VoiceGate({
    profile: s.profile ?? "lecture",
    verifier: s.unenrolled ? new HeuristicVoiceprint() : enrolledVoiceprint(),
    callbacks: {
      onListen: () => { o.listened = true; },
      onDuck: () => { o.ducked = true; },
      onRestore: () => { o.restored = true; },
      onBargeIn: (why) => { o.bargeReason = why; },
      onTurnEnd: () => { turnEnded = true; },
      onDiscard: () => { o.discarded = true; },
      onDecision: (d) => o.decisions.push(d),
    },
  });
  gate.setTopicWords(["demand", "curve", "price", "quantity", "slope", "downward", "substitution"]);
  gate.setExpectingAnswer(Boolean(s.expectingAnswer));
  const [tsStart, tsEnd] = s.tutorSpeakingFrames ?? [-1, -1];
  for (let i = 0; i < s.frames.length; i++) {
    const now = i * MS;
    gate.setTutorSpeaking(i >= tsStart && i < tsEnd, now);
    gate.push(s.frames[i], now);
    if (s.transcript && i === s.transcript.atFrame) gate.provideTranscript(s.transcript.text, s.transcript.final ?? true, now);
    if (s.transcript2 && i === s.transcript2.atFrame) gate.provideTranscript(s.transcript2.text, s.transcript2.final ?? true, now);
  }
  // Trailing silence so every episode settles.
  for (let i = 0; i < 60; i++) {
    const now = (s.frames.length + i) * MS;
    gate.setTutorSpeaking(false, now);
    gate.push(silence(), now);
  }
  o.verdict = o.bargeReason ? "BARGE-IN" : turnEnded ? "TURN" : "SILENT";
  return o;
}

const LECTURE: [number, number] = [0, 100_000];

// --- The scenarios ------------------------------------------------------------------------------

const SCENARIOS: Scenario[] = [
  // Environmental noise while Aria is teaching. None of these may even open a turn.
  { name: "1. fan / AC running while Aria teaches", expect: "SILENT", tutorSpeakingFrames: LECTURE, frames: seq(150, (i) => fan(0.35, i)) },
  { name: "2. keyboard typing while Aria teaches", expect: "SILENT", tutorSpeakingFrames: LECTURE, frames: seq(150, (i) => (i % 5 === 0 ? click(0.5) : silence())) },
  { name: "3. TV / music in the background", expect: "SILENT", tutorSpeakingFrames: LECTURE, frames: seq(150, (i) => music(0.12, i)) },
  { name: "4. traffic outside", expect: "SILENT", tutorSpeakingFrames: LECTURE, frames: seq(150, (i) => traffic(0.3, i)) },
  { name: "5. a cough", expect: "SILENT", tutorSpeakingFrames: LECTURE, frames: [...seq(10, () => silence()), ...seq(4, (i) => STUDENT(i, 0.25)), ...seq(60, () => silence())] },
  { name: "6. laughing (short bursts, 'haha')", expect: "SILENT", tutorSpeakingFrames: LECTURE,
    frames: seq(90, (i) => (i % 12 < 5 ? STUDENT(i, 0.18) : silence())), transcript: { text: "haha", atFrame: 40 } },
  { name: "7. a phone notification", expect: "SILENT", tutorSpeakingFrames: LECTURE, frames: seq(80, (i) => ping(i, 10)) },

  // People in the room, not talking to Aria.
  { name: "8. friend talking to someone else", expect: "SILENT", tutorSpeakingFrames: LECTURE,
    frames: seq(90, (i) => FRIEND(i)), transcript: { text: "no it was on the table next to the keys", atFrame: 45 } },
  { name: "9. friend talking to ME (not to Aria)", expect: "SILENT", tutorSpeakingFrames: LECTURE,
    frames: seq(90, (i) => FRIEND(i)), transcript: { text: "hey are you coming to dinner", atFrame: 45 } },
  { name: "10. me talking to my friend", expect: "SILENT", tutorSpeakingFrames: LECTURE,
    frames: seq(90, (i) => STUDENT(i)), transcript: { text: "hey Sam I'll call you back in a minute", atFrame: 45 } },
  { name: "11. background conversation while Aria is talking", expect: "SILENT", tutorSpeakingFrames: LECTURE,
    frames: seq(120, (i) => mix(FRIEND(i, 0.08), voice(170, i, 0.07, 0.7))), transcript: { text: "did you remember to send that email", atFrame: 50 } },
  { name: "12. Aria's own voice through the speakers", expect: "SILENT", tutorSpeakingFrames: LECTURE,
    frames: seq(120, (i) => ARIA(i, 0.12)) },
  { name: "13. friend says a full sentence with a question mark, to someone else", expect: "SILENT", tutorSpeakingFrames: LECTURE,
    frames: seq(90, (i) => FRIEND(i)), transcript: { text: "what do you want for dinner?", atFrame: 45 } },

  // The student, genuinely talking to Aria while she is teaching: must barge in.
  { name: "14. me interrupting Aria with a question about the board", expect: "BARGE-IN", tutorSpeakingFrames: LECTURE,
    frames: seq(80, (i) => STUDENT(i)), transcript: { text: "wait, what does that step mean?", atFrame: 30 } },
  { name: "15. saying her name mid-lecture", expect: "BARGE-IN", tutorSpeakingFrames: LECTURE,
    frames: seq(60, (i) => STUDENT(i)), transcript: { text: "aria", atFrame: 20, final: false } },
  { name: "16. a short command: 'stop'", expect: "BARGE-IN", tutorSpeakingFrames: LECTURE,
    frames: seq(40, (i) => STUDENT(i)), transcript: { text: "stop", atFrame: 15 } },
  { name: "17. whispering a request", expect: "BARGE-IN", tutorSpeakingFrames: LECTURE,
    frames: seq(80, (i) => STUDENT(i, 0.06)), transcript: { text: "can you slow down please", atFrame: 35 } },
  { name: "18. overlapping speech: me over my friend", expect: "BARGE-IN", tutorSpeakingFrames: LECTURE,
    frames: seq(80, (i) => mix(STUDENT(i, 0.15), FRIEND(i, 0.06))), transcript: { text: "aria can you repeat that", atFrame: 35 } },
  { name: "19. speaking with pauses and stutters", expect: "BARGE-IN", tutorSpeakingFrames: LECTURE,
    frames: seq(100, (i) => (i % 11 === 10 ? silence() : STUDENT(i))), transcript: { text: "so — so why is it, um, why is it negative?", atFrame: 60 } },
  { name: "20. me over a running fan", expect: "BARGE-IN", tutorSpeakingFrames: LECTURE,
    frames: seq(80, (i) => mix(fan(0.3, i), STUDENT(i, 0.16))), transcript: { text: "why did that step change the sign?", atFrame: 35 } },
  { name: "21. verified student keeps talking and the transcriber is silent", expect: "BARGE-IN", tutorSpeakingFrames: LECTURE,
    frames: seq(160, (i) => STUDENT(i)) },
  { name: "22. UNVERIFIED voice keeps talking and the transcriber is silent — no stop without words", expect: "SILENT", tutorSpeakingFrames: LECTURE,
    frames: seq(160, (i) => STUDENT(i)), unenrolled: true },
  { name: "23. interim 'not for us' then final for-us — her name arrives late", expect: "BARGE-IN", tutorSpeakingFrames: LECTURE,
    frames: seq(90, (i) => STUDENT(i)), transcript: { text: "so the thing is", atFrame: 30, final: false }, transcript2: { text: "so the thing is aria I don't get it", atFrame: 60 } },

  // Aria silent (planning / chat): turns must reach her, and only the right ones.
  { name: "24. answering Aria's question in planning", expect: "TURN", profile: "conversation", expectingAnswer: true,
    frames: seq(80, (i) => STUDENT(i)), transcript: { text: "I think it slopes down because people buy less", atFrame: 40 } },
  { name: "25. a bare 'yes' when she asked a yes/no question", expect: "TURN", profile: "conversation", expectingAnswer: true,
    frames: seq(30, (i) => STUDENT(i)), transcript: { text: "yes", atFrame: 12 } },
  { name: "26. friend answers someone else while Aria waits", expect: "SILENT", profile: "conversation", expectingAnswer: true,
    frames: seq(80, (i) => FRIEND(i)), transcript: { text: "it's in the kitchen drawer", atFrame: 40 } },
  { name: "27. fan while Aria waits for an answer", expect: "SILENT", profile: "conversation", expectingAnswer: true,
    frames: seq(150, (i) => fan(0.35, i)) },
  { name: "28. asking Aria something out of the blue while she is idle", expect: "TURN", profile: "conversation",
    frames: seq(80, (i) => STUDENT(i)), transcript: { text: "aria, can you explain demand curves?", atFrame: 40 } },
  { name: "29. me talking to my friend while Aria is idle", expect: "SILENT", profile: "conversation",
    frames: seq(80, (i) => STUDENT(i)), transcript: { text: "hey Sam did you lock the door", atFrame: 40 } },
  { name: "30. student speaks just after Aria stops (echo guard must not swallow it)", expect: "TURN", profile: "conversation", expectingAnswer: true,
    tutorSpeakingFrames: [0, 8], frames: [...seq(8, (i) => ARIA(i)), ...seq(80, (i) => STUDENT(i))], transcript: { text: "the second one", atFrame: 50 } },
  { name: "31. friend directly addresses Aria but is not the enrolled student", expect: "SILENT", tutorSpeakingFrames: LECTURE,
    frames: seq(80, (i) => FRIEND(i)), transcript: { text: "Aria, stop the lecture", atFrame: 40 } },
];

// --- Scoring ------------------------------------------------------------------------------------

test("voice gate scenarios: every room sound gets the verdict a person would give", () => {
  const failures: string[] = [];
  for (const s of SCENARIOS) {
    const o = run(s);
    if (o.verdict !== s.expect) {
      const trail = o.decisions.slice(-4).map((d) => `${d.stage}:${d.reason}`).join(" → ");
      failures.push(`${s.name}: expected ${s.expect}, got ${o.verdict}${o.bargeReason ? ` (${o.bargeReason})` : ""} [${trail}]`);
    }
  }
  assert.equal(failures.length, 0, `\n${failures.join("\n")}`);
});

test("at least 20 distinct scenarios, covering every class the brief named", () => {
  assert.ok(SCENARIOS.length >= 20);
  const names = SCENARIOS.map((s) => s.name.toLowerCase()).join(" | ");
  for (const needle of ["fan", "keyboard", "tv", "music", "traffic", "cough", "laugh", "notification", "friend talking to someone", "friend talking to me", "me talking to my friend", "name", "overlapping", "whisper", "command", "pauses", "background conversation while aria"]) {
    assert.ok(names.includes(needle), `no scenario covers "${needle}"`);
  }
});

test("pure noise never opens a turn at all — Gemini receives nothing", () => {
  for (const s of SCENARIOS.filter((x) => /fan|keyboard|music|traffic|notification/.test(x.name) && !/over a running fan/.test(x.name))) {
    const o = run(s);
    assert.equal(o.listened, false, `${s.name} opened a turn`);
  }
});

test("a turn that turns out to be someone else's is discarded and the tutor restored", () => {
  for (const s of SCENARIOS.filter((x) => /friend talking|background conversation|talking to my friend|answers someone else/.test(x.name))) {
    const o = run(s);
    if (o.listened) {
      assert.equal(o.discarded, true, `${s.name}: turn opened but was not discarded`);
    }
    if (o.ducked) assert.equal(o.restored, true, `${s.name}: ducked but never restored`);
  }
});

test("barge-in is prompt: her name stops her within 100 ms of the transcript", () => {
  const s = SCENARIOS.find((x) => x.name.startsWith("15."))!;
  const o = run(s);
  const barge = o.decisions.find((d) => d.reason === "barge-in");
  assert.ok(barge, "no barge-in decision");
  assert.ok(barge!.at - s.transcript!.atFrame * MS <= 100, `barge-in came ${barge!.at - s.transcript!.atFrame * MS} ms after the name`);
});

test("the pre-roll is handed over when a turn opens", () => {
  let preroll: Float32Array[] = [];
  const gate = new VoiceGate({ callbacks: { onListen: (p) => { preroll = p; } } });
  for (let i = 0; i < 40; i++) gate.push(i < 20 ? silence() : STUDENT(i), i * MS);
  assert.ok(preroll.length >= 10, `expected a pre-roll of several frames, got ${preroll.length}`);
});

test("semantic prefilter keeps an acoustic candidate entirely local until words address Aria", () => {
  let listened = 0;
  let barged = 0;
  const gate = new VoiceGate({
    semanticPrefilter: true,
    callbacks: {
      onListen: () => { listened += 1; },
      onBargeIn: () => { barged += 1; },
    },
  });
  gate.setTutorSpeaking(true, 0);
  for (let i = 0; i < 35; i++) gate.push(STUDENT(i), i * MS);
  assert.equal(gate.getStage(), "candidate");
  assert.equal(listened, 0, "candidate audio escaped to Gemini before semantic acceptance");

  gate.provideTranscript("Arya, why did that sign change?", false, 35 * MS);
  assert.equal(listened, 1);
  assert.equal(barged, 1);
  assert.equal(gate.getStage(), "committed");
});

test("semantic prefilter rejects nearby conversation without opening a Gemini activity", () => {
  let listened = 0;
  const gate = new VoiceGate({
    semanticPrefilter: true,
    callbacks: { onListen: () => { listened += 1; } },
  });
  gate.setTutorSpeaking(true, 0);
  for (let i = 0; i < 35; i++) gate.push(FRIEND(i), i * MS);
  gate.provideTranscript("hey Sam did you lock the door", true, 35 * MS);
  assert.equal(listened, 0);
  for (let i = 35; i < 75; i++) gate.push(silence(), i * MS);
  assert.equal(gate.getStage(), "refractory");
});

test("every decision is explainable", () => {
  const o = run(SCENARIOS[13]);
  for (const d of o.decisions) assert.ok(d.reason && d.detail, "decision without a reason");
});

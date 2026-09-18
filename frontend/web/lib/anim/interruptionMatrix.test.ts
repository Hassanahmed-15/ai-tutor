/**
 * The interruption matrix as a scored table, rather than as scattered assertions.
 *
 * WHY A SECOND FILE. `interruptionGate.test.ts` proves individual behaviours — this fan does not
 * duck, that whisper does. It does not answer the question the change was actually made to answer:
 * across every condition a real room produces, how often does the tutor stop when it should not,
 * and how often does it fail to stop when it should? That needs every case scored against one
 * expected verdict and the errors counted, which is what this file does.
 *
 * WHAT A CASE MEANS. Each row declares an expectation of INTERRUPT or DO NOT INTERRUPT, where
 * "interrupt" means the tutor was stopped and the turn handed over — NOT merely ducked. Ducking is
 * deliberately not a failure: it is the gate reserving judgement, it is inaudible as an error, and
 * treating it as an interruption would score the design's central mechanism as a bug.
 *
 * WHAT THIS CANNOT PROVE, stated plainly because the numbers below invite over-reading. The audio is
 * synthesised: `voice()` is a harmonic stack with speech-band emphasis, not a person, and no
 * generator here reproduces room reverb, microphone colouration, codec artefacts, or the way real
 * speech and real noise overlap. A perfect score on this matrix means the DECISION LOGIC handles
 * every condition the generators can express. It is not a real-world accuracy figure, and the
 * summary deliberately prints that caveat next to the totals so it cannot be quoted without it.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { InterruptionGate, analyzeFrame, type GateDecision } from "../interruptionGate";

const SAMPLE_RATE = 16_000;
const FRAME = 512;
const FRAME_MS = (FRAME / SAMPLE_RATE) * 1000;

// --- Signal generators -----------------------------------------------------
// Each models one acoustic class by the property the detector is supposed to key on, so a failure
// names the property rather than just "case 7 broke".

function noise(amplitude: number, seed: number): Float32Array {
  const out = new Float32Array(FRAME);
  let state = seed || 1;
  for (let i = 0; i < FRAME; i += 1) {
    state = (state * 1_103_515_245 + 12_345) & 0x7fffffff;
    out[i] = ((state / 0x7fffffff) * 2 - 1) * amplitude;
  }
  return out;
}

/** Fan or AC: tonal, but all of it below the speech band. */
function fan(amplitude: number, offset: number): Float32Array {
  const out = new Float32Array(FRAME);
  for (let i = 0; i < FRAME; i += 1) {
    const t = (offset * FRAME + i) / SAMPLE_RATE;
    out[i] =
      amplitude *
      (Math.sin(2 * Math.PI * 60 * t) * 0.6 +
        Math.sin(2 * Math.PI * 120 * t) * 0.3 +
        Math.sin(2 * Math.PI * 95 * t) * 0.1);
  }
  return out;
}

function voice(amplitude: number, offset: number, f0 = 130): Float32Array {
  const out = new Float32Array(FRAME);
  for (let i = 0; i < FRAME; i += 1) {
    const t = (offset * FRAME + i) / SAMPLE_RATE;
    let sample = 0;
    for (let harmonic = 3; harmonic <= 24; harmonic += 1) {
      const hz = f0 * harmonic;
      if (hz > 3400) break;
      sample += Math.sin(2 * Math.PI * hz * t) / harmonic;
    }
    out[i] = sample * amplitude;
  }
  return out;
}

/** Two voices at once: the student over someone else, or two bystanders. */
function twoVoices(a: number, b: number, offset: number): Float32Array {
  const first = voice(a, offset, 130);
  const second = voice(b, offset, 210);
  const out = new Float32Array(FRAME);
  for (let i = 0; i < FRAME; i += 1) out[i] = first[i] + second[i];
  return out;
}

function click(amplitude: number): Float32Array {
  const out = new Float32Array(FRAME);
  for (let i = 0; i < 24; i += 1) out[i] = amplitude * (i % 2 === 0 ? 1 : -1) * (1 - i / 24);
  return out;
}

function silence(): Float32Array {
  return new Float32Array(FRAME);
}

function mix(a: Float32Array, b: Float32Array): Float32Array {
  const out = new Float32Array(FRAME);
  for (let i = 0; i < FRAME; i += 1) out[i] = a[i] + b[i];
  return out;
}

function repeat(count: number, make: (index: number) => Float32Array): Float32Array[] {
  return Array.from({ length: count }, (_, index) => make(index));
}

// --- Harness ---------------------------------------------------------------

type Verdict = "INTERRUPT" | "DO NOT INTERRUPT";

type MatrixCase = {
  name: string;
  /** What a person in the room would say the right answer is. */
  expect: Verdict;
  frames: Float32Array[];
  /**
   * The words, if any, that the server eventually transcribes, and whether they are addressed to
   * the tutor. `afterFrame` is when the transcript lands relative to the audio — real transcripts
   * arrive several hundred milliseconds into an utterance, which is exactly the delay ducking is
   * designed to cover.
   */
  transcript?: { text: string; addressed: boolean; afterFrame: number };
  /** Frames of tutor audio to declare before the case starts, for the self-echo rows. */
  tutorAudioUntilFrame?: number;
};

type Outcome = {
  verdict: Verdict;
  ducked: boolean;
  stopped: boolean;
  restored: boolean;
  /** The reason the gate gave for the decision that settled the case. */
  why: string;
  decisions: GateDecision[];
};

function evaluate(testCase: MatrixCase): Outcome {
  let ducked = false;
  let stopped = false;
  let restored = false;
  const decisions: GateDecision[] = [];

  const gate = new InterruptionGate(
    {},
    {
      onDuck: () => {
        ducked = true;
      },
      onStop: () => {
        stopped = true;
      },
      onRestore: () => {
        restored = true;
      },
      onDecision: (decision) => decisions.push(decision),
    },
  );

  if (testCase.tutorAudioUntilFrame !== undefined) {
    gate.noteTutorAudio(testCase.tutorAudioUntilFrame * FRAME_MS);
  }

  testCase.frames.forEach((samples, index) => {
    const now = index * FRAME_MS;
    gate.push(analyzeFrame(samples, SAMPLE_RATE), now);
    if (testCase.transcript && index === testCase.transcript.afterFrame) {
      gate.provideTranscript(testCase.transcript.text, testCase.transcript.addressed, now);
    }
  });

  // The verdict is STOPPED, not ducked. A duck is the gate withholding judgement; scoring it as an
  // interruption would count the mechanism that prevents false interruptions as a false
  // interruption.
  const verdict: Verdict = stopped ? "INTERRUPT" : "DO NOT INTERRUPT";

  const settling = stopped
    ? decisions.find((d) => d.reason === "addressed" || d.reason === "decision-timeout")
    : decisions.find((d) => d.reason === "not-addressed") ??
      decisions.find((d) => d.reason === "sustained-voice") ??
      decisions.at(-1);

  return {
    verdict,
    ducked,
    stopped,
    restored,
    why: settling ? `${settling.reason}: ${settling.detail}` : "no decision recorded",
    decisions,
  };
}

// --- The matrix ------------------------------------------------------------
// Ordered quietest to hardest, so the report reads like a walk across a room.

const MATRIX: MatrixCase[] = [
  {
    name: "quiet room",
    expect: "DO NOT INTERRUPT",
    frames: repeat(40, () => silence()),
  },
  {
    name: "quiet room with faint hiss",
    expect: "DO NOT INTERRUPT",
    frames: repeat(40, (i) => noise(0.004, i + 1)),
  },
  {
    name: "fan / AC at conversational distance",
    expect: "DO NOT INTERRUPT",
    frames: repeat(60, (i) => fan(0.25, i)),
  },
  {
    name: "fan / AC running loud",
    expect: "DO NOT INTERRUPT",
    frames: repeat(60, (i) => fan(0.5, i)),
  },
  {
    name: "white noise",
    expect: "DO NOT INTERRUPT",
    frames: repeat(60, (i) => noise(0.2, i + 7)),
  },
  {
    name: "loud white noise",
    expect: "DO NOT INTERRUPT",
    frames: repeat(60, (i) => noise(0.45, i + 11)),
  },
  {
    name: "keyboard typing",
    expect: "DO NOT INTERRUPT",
    // Sparse bursts, exactly as typing arrives: loud but never sustained.
    frames: repeat(60, (i) => (i % 4 === 0 ? click(0.5) : silence())),
  },
  {
    name: "single click / chair scrape",
    expect: "DO NOT INTERRUPT",
    frames: [...repeat(5, () => silence()), click(0.6), ...repeat(34, () => silence())],
  },
  {
    name: "short accidental sound (a cough)",
    expect: "DO NOT INTERRUPT",
    // Voice-like but far too brief to be an utterance — under the 240 ms debounce.
    frames: [...repeat(4, () => silence()), ...repeat(3, (i) => voice(0.2, i)), ...repeat(33, () => silence())],
  },
  {
    name: "fan plus occasional typing",
    expect: "DO NOT INTERRUPT",
    frames: repeat(60, (i) => (i % 5 === 0 ? mix(fan(0.25, i), click(0.4)) : fan(0.25, i))),
  },
  {
    name: "TV / music playing in the background",
    expect: "DO NOT INTERRUPT",
    frames: repeat(60, (i) => voice(0.08, i, 180)),
    transcript: { text: "and then the dog ran across the field", addressed: false, afterFrame: 22 },
  },
  {
    name: "one person speaking nearby, not to us",
    expect: "DO NOT INTERRUPT",
    frames: repeat(60, (i) => voice(0.09, i)),
    transcript: { text: "did you remember to send that email", addressed: false, afterFrame: 20 },
  },
  {
    name: "two people talking to each other",
    expect: "DO NOT INTERRUPT",
    frames: repeat(60, (i) => twoVoices(0.07, 0.06, i)),
    transcript: { text: "no it was on the table next to the keys", addressed: false, afterFrame: 24 },
  },
  {
    name: "someone asking another person a question",
    expect: "DO NOT INTERRUPT",
    frames: repeat(60, (i) => voice(0.1, i, 155)),
    transcript: { text: "hey can you pass me the charger", addressed: false, afterFrame: 21 },
  },
  {
    name: "distant voice across the room",
    expect: "DO NOT INTERRUPT",
    // Below the absolute floor: audible to a person, not plausibly addressed to this machine.
    frames: repeat(60, (i) => voice(0.012, i)),
  },
  {
    name: "the tutor's own voice through the speakers",
    expect: "DO NOT INTERRUPT",
    frames: repeat(40, (i) => voice(0.2, i)),
    tutorAudioUntilFrame: 40,
  },
  {
    name: "student asks a short question",
    expect: "INTERRUPT",
    frames: repeat(40, (i) => voice(0.14, i)),
    transcript: { text: "wait, what does that mean?", addressed: true, afterFrame: 18 },
  },
  {
    name: "student asks a long question",
    expect: "INTERRUPT",
    frames: repeat(90, (i) => voice(0.14, i)),
    transcript: {
      text: "okay so can you explain again how the second step follows from the first one, because I did not follow that part at all",
      addressed: true,
      afterFrame: 40,
    },
  },
  {
    name: "student speaks with pauses and stutters",
    expect: "INTERRUPT",
    // Gaps shorter than silenceMs must not end the utterance early.
    frames: repeat(70, (i) => (i % 9 === 8 ? silence() : voice(0.14, i))),
    transcript: { text: "so — so why is it, um, why is it negative?", addressed: true, afterFrame: 30 },
  },
  {
    name: "student whispers close to the microphone",
    expect: "INTERRUPT",
    frames: repeat(50, (i) => voice(0.055, i)),
    transcript: { text: "can you slow down please", addressed: true, afterFrame: 22 },
  },
  {
    name: "student speaks over a running fan",
    expect: "INTERRUPT",
    frames: repeat(50, (i) => mix(fan(0.25, i), voice(0.14, i))),
    transcript: { text: "why did that step change the sign?", addressed: true, afterFrame: 22 },
  },
  {
    name: "student speaks in a loud, noisy room",
    expect: "INTERRUPT",
    frames: repeat(50, (i) => mix(noise(0.05, i + 3), voice(0.16, i))),
    transcript: { text: "hold on, explain the last part again", addressed: true, afterFrame: 22 },
  },
  {
    name: "student speaks while another person is talking",
    expect: "INTERRUPT",
    frames: repeat(50, (i) => twoVoices(0.15, 0.07, i)),
    transcript: { text: "aria, can you repeat that?", addressed: true, afterFrame: 22 },
  },
  {
    name: "student speaks at arm's length from the microphone",
    expect: "INTERRUPT",
    frames: repeat(50, (i) => voice(0.08, i)),
    transcript: { text: "what happens if x is zero?", addressed: true, afterFrame: 22 },
  },
  {
    name: "student speaks and no transcript ever arrives",
    expect: "INTERRUPT",
    // The safety net: sustained speech with a silent transcriber must not duck forever.
    frames: repeat(80, (i) => voice(0.14, i)),
  },
  {
    name: "student interrupts right after the tutor stops talking",
    expect: "INTERRUPT",
    frames: repeat(60, (i) => voice(0.14, i)),
    tutorAudioUntilFrame: 6,
    transcript: { text: "wait, go back a step", addressed: true, afterFrame: 30 },
  },
];

// --- Scoring ---------------------------------------------------------------

test("interruption matrix: every condition gets the verdict a person would give", () => {
  const rows: string[] = [];
  let falsePositives = 0;
  let falseNegatives = 0;
  const failures: string[] = [];

  for (const testCase of MATRIX) {
    const outcome = evaluate(testCase);
    const correct = outcome.verdict === testCase.expect;

    // False POSITIVE: interrupted when it should not have. The bug this change exists to fix.
    // False NEGATIVE: failed to interrupt a student who was addressing the tutor.
    if (!correct) {
      if (testCase.expect === "DO NOT INTERRUPT") falsePositives += 1;
      else falseNegatives += 1;
      failures.push(
        `${testCase.name}: expected ${testCase.expect}, got ${outcome.verdict} — ${outcome.why}`,
      );
    }

    rows.push(
      [
        correct ? "PASS" : "FAIL",
        outcome.verdict.padEnd(16),
        outcome.ducked ? "ducked" : "      ",
        testCase.name.padEnd(48),
        outcome.why,
      ].join("  "),
    );
  }

  const total = MATRIX.length;
  const passed = total - failures.length;

  console.log("\n  INTERRUPTION MATRIX");
  console.log("  " + "-".repeat(118));
  for (const row of rows) console.log("  " + row);
  console.log("  " + "-".repeat(118));
  console.log(`  ${passed}/${total} correct`);
  console.log(`  false interruptions (stopped when it should not have): ${falsePositives}`);
  console.log(`  missed interruptions (did not stop for a real question): ${falseNegatives}`);
  console.log(
    "  NOTE: synthesised audio. This scores the decision logic, not real-world accuracy —\n" +
      "  no figure here is a measured false-positive rate for an actual room.\n",
  );

  assert.deepEqual(failures, [], `matrix failures:\n${failures.join("\n")}`);
});

test("no case interrupts without the words proving it was addressed", () => {
  // The structural guarantee behind the whole design: nothing reaches a stop except through a
  // transcript that was addressed, or the explicit timeout escape hatch. If a future change lets
  // acoustics alone commit, this fails even when every verdict above is still correct.
  for (const testCase of MATRIX) {
    const outcome = evaluate(testCase);
    if (!outcome.stopped) continue;
    const committedVia = outcome.decisions.find(
      (d) => d.reason === "addressed" || d.reason === "decision-timeout",
    );
    assert.ok(
      committedVia,
      `${testCase.name} stopped the tutor without an addressed transcript or a decision timeout`,
    );
  }
});

test("background speech ducks rather than stopping, and always recovers", () => {
  // The cases that motivated ducking. Each is real speech, so it is allowed — expected, even — to
  // dip the volume. What it must never do is stop the lecture, and it must restore afterwards.
  const bystanderCases = [
    "one person speaking nearby, not to us",
    "two people talking to each other",
    "someone asking another person a question",
    "TV / music playing in the background",
  ];

  for (const name of bystanderCases) {
    const testCase = MATRIX.find((c) => c.name === name);
    assert.ok(testCase, `missing matrix case: ${name}`);
    const outcome = evaluate(testCase);
    assert.equal(outcome.stopped, false, `${name} stopped the tutor`);
    assert.equal(outcome.restored, true, `${name} left the tutor ducked without restoring`);
  }
});

test("pure noise never even ducks", () => {
  // Stronger than "does not interrupt": a fan should not so much as dip the volume, because a duck
  // that never resolves to a stop is still an audible artefact if it happens constantly.
  const noiseCases = [
    "quiet room",
    "quiet room with faint hiss",
    "fan / AC at conversational distance",
    "fan / AC running loud",
    "white noise",
    "loud white noise",
    "keyboard typing",
    "single click / chair scrape",
    "fan plus occasional typing",
  ];

  for (const name of noiseCases) {
    const testCase = MATRIX.find((c) => c.name === name);
    assert.ok(testCase, `missing matrix case: ${name}`);
    const outcome = evaluate(testCase);
    assert.equal(outcome.ducked, false, `${name} ducked the tutor: ${outcome.why}`);
  }
});

test("every decision is explainable", () => {
  // The logging requirement, enforced rather than assumed: a decision with no machine reason or no
  // human sentence cannot be debugged when a real room behaves badly.
  for (const testCase of MATRIX) {
    for (const decision of evaluate(testCase).decisions) {
      assert.ok(decision.reason, `${testCase.name}: decision without a reason`);
      assert.ok(decision.detail.length > 0, `${testCase.name}: decision without an explanation`);
      assert.ok(
        decision.voiceConfidence >= 0 && decision.voiceConfidence <= 1,
        `${testCase.name}: voiceConfidence out of range`,
      );
    }
  }
});

/**
 * The interruption matrix: for each kind of sound a real room produces, does the tutor stop?
 *
 * WHY SYNTHESISED AUDIO. The decision under test is acoustic, so the honest test feeds it audio and
 * checks the verdict. Recording a real fan would test one fan in one room; generating the signal
 * lets each case state exactly which property is supposed to trigger the rejection — flat spectrum,
 * energy outside the speech band, too brief to be an utterance — and fail loudly when the detector
 * stops relying on that property.
 *
 * WHAT THIS CANNOT PROVE. Synthesised speech is a harmonic stack with formant-like peaks; it is not
 * a person. These tests pin the decision LOGIC and the feature extraction, and they will catch a
 * regression in either. They cannot establish a real-world false-positive rate, and no number
 * derived from this file should be quoted as one. That measurement needs a microphone and a person.
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_GATE_CONFIG,
  InterruptionGate,
  analyzeFrame,
  isVoiceLike,
  voiceConfidence,
  type GateDecision,
} from "../interruptionGate";

const SAMPLE_RATE = 16_000;
const FRAME = 512;
/** ~32 ms per frame at 16 kHz, matching the analysis cadence the hook feeds the gate. */
const FRAME_MS = (FRAME / SAMPLE_RATE) * 1000;

function frames(count: number, make: (index: number) => Float32Array): Float32Array[] {
  return Array.from({ length: count }, (_, index) => make(index));
}

/** Broadband noise with a flat spectrum — the acoustic signature of a fan, AC, or hiss. */
function whiteNoise(amplitude: number, seed = 1): Float32Array {
  const out = new Float32Array(FRAME);
  let state = seed;
  for (let i = 0; i < FRAME; i += 1) {
    // Deterministic LCG so a failure is reproducible rather than flaky.
    state = (state * 1_103_515_245 + 12_345) & 0x7fffffff;
    out[i] = ((state / 0x7fffffff) * 2 - 1) * amplitude;
  }
  return out;
}

/** Low-frequency rumble: a fan or AC, whose energy sits below the speech band. */
function rumble(amplitude: number, offset: number): Float32Array {
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

/**
 * A voice: a glottal pulse train at `f0` with harmonics rolling off, shaped so most energy lands
 * in 300-3400 Hz. Not a person, but it carries the two properties the detector keys on — harmonic
 * structure (low flatness) and speech-band concentration.
 */
function voice(amplitude: number, offset: number, f0 = 130): Float32Array {
  const out = new Float32Array(FRAME);
  for (let i = 0; i < FRAME; i += 1) {
    const t = (offset * FRAME + i) / SAMPLE_RATE;
    let sample = 0;
    // Harmonics through the speech band; weighted to put the bulk above 300 Hz.
    for (let harmonic = 3; harmonic <= 24; harmonic += 1) {
      const hz = f0 * harmonic;
      if (hz > 3400) break;
      sample += Math.sin(2 * Math.PI * hz * t) / harmonic;
    }
    out[i] = sample * amplitude;
  }
  return out;
}

/** A keyboard click or chair scrape: loud, extremely brief, spectrally bright. */
function click(amplitude: number): Float32Array {
  const out = new Float32Array(FRAME);
  for (let i = 0; i < 24; i += 1) {
    out[i] = amplitude * (i % 2 === 0 ? 1 : -1) * (1 - i / 24);
  }
  return out;
}

function silence(): Float32Array {
  return new Float32Array(FRAME);
}

type RunResult = {
  ducked: boolean;
  stopped: boolean;
  restored: boolean;
  decisions: GateDecision[];
  gate: InterruptionGate;
};

/** Feed frames through a fresh gate and record what the audio layer was told to do. */
function run(
  input: Float32Array[],
  options: { transcript?: { text: string; addressed: boolean; afterFrame: number } } = {},
): RunResult {
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

  input.forEach((samples, index) => {
    const now = index * FRAME_MS;
    gate.push(analyzeFrame(samples, SAMPLE_RATE), now);
    if (options.transcript && index === options.transcript.afterFrame) {
      gate.provideTranscript(options.transcript.text, options.transcript.addressed, now);
    }
  });

  return { ducked, stopped, restored, decisions, gate };
}

/** The last reason the gate recorded — what it would have written to the log. */
function lastReason(result: RunResult): string {
  return result.decisions.at(-1)?.reason ?? "none";
}

/**
 * Whether a reason was ever reached.
 *
 * Preferred over `lastReason` for anything transcript-driven: audio keeps arriving after the words
 * are classified, so the final entry in the log is whatever the microphone said last, not the
 * verdict. Asserting on the last entry made two passing behaviours look like failures.
 */
function sawReason(result: RunResult, reason: GateDecision["reason"]): boolean {
  return result.decisions.some((decision) => decision.reason === reason);
}

// ---------------------------------------------------------------------------
// Feature extraction — the measurements every later decision rests on.
// ---------------------------------------------------------------------------

test("white noise measures as flat, a voice does not", () => {
  const noise = analyzeFrame(whiteNoise(0.2), SAMPLE_RATE);
  const speech = analyzeFrame(voice(0.2, 0), SAMPLE_RATE);
  assert.ok(
    noise.flatness > speech.flatness,
    `white noise (${noise.flatness.toFixed(3)}) must be flatter than voice (${speech.flatness.toFixed(3)})`,
  );
  assert.ok(noise.flatness > DEFAULT_GATE_CONFIG.maxFlatness, "white noise must exceed the flatness gate");
  assert.ok(speech.flatness <= DEFAULT_GATE_CONFIG.maxFlatness, "voice must pass the flatness gate");
});

test("a fan's energy sits below the speech band", () => {
  const fan = analyzeFrame(rumble(0.25, 0), SAMPLE_RATE);
  assert.ok(
    fan.bandRatio < DEFAULT_GATE_CONFIG.minBandRatio,
    `fan band ratio ${fan.bandRatio.toFixed(3)} should be below ${DEFAULT_GATE_CONFIG.minBandRatio}`,
  );
});

test("a voice concentrates its energy in the speech band", () => {
  const speech = analyzeFrame(voice(0.2, 0), SAMPLE_RATE);
  assert.ok(
    speech.bandRatio >= DEFAULT_GATE_CONFIG.minBandRatio,
    `voice band ratio ${speech.bandRatio.toFixed(3)} should reach ${DEFAULT_GATE_CONFIG.minBandRatio}`,
  );
});

test("voice confidence ranks a voice above noise", () => {
  const speech = voiceConfidence(analyzeFrame(voice(0.2, 0), SAMPLE_RATE), DEFAULT_GATE_CONFIG);
  const noise = voiceConfidence(analyzeFrame(whiteNoise(0.2), SAMPLE_RATE), DEFAULT_GATE_CONFIG);
  const fan = voiceConfidence(analyzeFrame(rumble(0.25, 0), SAMPLE_RATE), DEFAULT_GATE_CONFIG);
  assert.ok(speech > 0.5, `voice confidence ${speech.toFixed(2)} should be high`);
  assert.ok(noise < 0.2, `white-noise confidence ${noise.toFixed(2)} should be low`);
  // A fan is tonal, so flatness and ZCR both flatter it; only its band placement gives it away.
  // This is the case that caught the original weighted-sum scoring at 0.70.
  assert.ok(fan < 0.3, `fan confidence ${fan.toFixed(2)} should be low`);
});

// ---------------------------------------------------------------------------
// DO NOT INTERRUPT
// ---------------------------------------------------------------------------

test("quiet room: never ducks", () => {
  const result = run(frames(60, silence));
  assert.equal(result.ducked, false);
  assert.equal(result.stopped, false);
  assert.equal(lastReason(result), "quiet");
});

test("fan / AC running continuously: never ducks", () => {
  const result = run(frames(120, (i) => rumble(0.25, i)));
  assert.equal(result.ducked, false, "a fan must never duck the tutor");
  assert.equal(result.stopped, false);
});

test("loud fan: still never ducks, however loud it gets", () => {
  // The old detector clamped its noise floor at 0.03, so anything above that interrupted forever.
  const result = run(frames(120, (i) => rumble(0.5, i)));
  assert.equal(result.ducked, false);
  assert.equal(result.stopped, false);
});

test("white noise: never ducks", () => {
  const result = run(frames(120, (i) => whiteNoise(0.25, i + 1)));
  assert.equal(result.ducked, false);
  assert.equal(result.stopped, false);
});

test("keyboard clicks: never duck", () => {
  // A click every fourth frame, as fast as a person types.
  const result = run(frames(80, (i) => (i % 4 === 0 ? click(0.6) : silence())));
  assert.equal(result.ducked, false, "typing must not duck the tutor");
  assert.equal(result.stopped, false);
});

test("a single short accidental sound does not duck", () => {
  // One frame of voice-like audio — a cough — well under the sustain requirement.
  const input = [...frames(10, silence), voice(0.3, 0), ...frames(30, silence)];
  const result = run(input);
  assert.equal(result.ducked, false, "a cough is too short to be an utterance");
});

test("mixed room noise — fan plus occasional clicks — never ducks", () => {
  const result = run(frames(150, (i) => {
    if (i % 11 === 0) return click(0.5);
    return rumble(0.22, i);
  }));
  assert.equal(result.ducked, false);
  assert.equal(result.stopped, false);
});

// ---------------------------------------------------------------------------
// The hard case: real speech that is NOT for us.
// ---------------------------------------------------------------------------

test("someone talking nearby ducks but does NOT stop once the words prove it was not for us", () => {
  // Real speech: it will and should duck. Only the transcript can exonerate it.
  const input = frames(40, (i) => voice(0.18, i, 115));
  const result = run(input, {
    transcript: { text: "did you remember to take the bins out", addressed: false, afterFrame: 20 },
  });
  assert.equal(result.ducked, true, "sustained speech should duck — acoustically it is a voice");
  assert.equal(result.stopped, false, "but it must never STOP for a conversation that is not ours");
  assert.equal(result.restored, true, "volume must come back");
  assert.equal(result.gate.getStage(), "rejected");
});

test("two people talking to each other: ducks, restores, never stops", () => {
  // Alternating pitches standing in for two speakers.
  const input = frames(50, (i) => voice(0.18, i, i % 10 < 5 ? 110 : 190));
  const result = run(input, {
    transcript: { text: "no I told him it was fine", addressed: false, afterFrame: 25 },
  });
  assert.equal(result.stopped, false, "cross-talk must never stop the tutor");
  assert.equal(result.restored, true);
});

test("TV dialogue in the background: ducks, then restores on the words", () => {
  const input = frames(60, (i) => voice(0.15, i, 150));
  const result = run(input, {
    transcript: { text: "and now the weather for the rest of the week", addressed: false, afterFrame: 22 },
  });
  assert.equal(result.stopped, false);
  assert.equal(result.restored, true);
  assert.equal(sawReason(result, "not-addressed"), true, "should have recorded WHY it restored");
});

// ---------------------------------------------------------------------------
// SHOULD INTERRUPT
// ---------------------------------------------------------------------------

test("student asks a question: ducks quickly, then stops", () => {
  const input = frames(40, (i) => voice(0.25, i));
  const result = run(input, {
    transcript: { text: "wait, what does entropy mean here?", addressed: true, afterFrame: 15 },
  });
  assert.equal(result.ducked, true);
  assert.equal(result.stopped, true);
  assert.equal(result.gate.getStage(), "committed");
  assert.equal(sawReason(result, "addressed"), true, "should have recorded WHY it stopped");
});

test("the duck happens within about a quarter second", () => {
  const input = frames(40, (i) => voice(0.25, i));
  let duckedAtFrame = -1;
  const gate = new InterruptionGate({}, { onDuck: () => { duckedAtFrame = seen; } });
  let seen = 0;
  input.forEach((samples, index) => {
    seen = index;
    gate.push(analyzeFrame(samples, SAMPLE_RATE), index * FRAME_MS);
  });
  assert.ok(duckedAtFrame >= 0, "should have ducked");
  const ms = duckedAtFrame * FRAME_MS;
  assert.ok(ms <= 400, `ducked after ${ms.toFixed(0)}ms — must stay responsive`);
  assert.ok(ms >= DEFAULT_GATE_CONFIG.minSpeechMs - FRAME_MS, `ducked after only ${ms.toFixed(0)}ms — too eager`);
});

test("a long question keeps the tutor stopped throughout", () => {
  const input = frames(90, (i) => voice(0.22, i));
  const result = run(input, {
    transcript: { text: "can you explain again why the gradient vanishes in deep networks?", addressed: true, afterFrame: 15 },
  });
  assert.equal(result.stopped, true);
  assert.equal(result.restored, false, "a committed interruption must not silently restore mid-question");
});

test("pauses and stutters inside one utterance do not end it prematurely", () => {
  // "I— uh— I mean—" : speech, gap, speech, gap, speech. Gaps stay under silenceMs.
  const input = [
    ...frames(10, (i) => voice(0.25, i)),
    ...frames(8, silence),
    ...frames(10, (i) => voice(0.25, i + 20)),
    ...frames(8, silence),
    ...frames(10, (i) => voice(0.25, i + 40)),
  ];
  const result = run(input, {
    transcript: { text: "I— uh— I mean, why is it squared?", addressed: true, afterFrame: 40 },
  });
  assert.equal(result.stopped, true, "a stuttered question is still a question");
});

test("no transcript at all: sustained speech eventually commits rather than ducking forever", () => {
  // Transcription can lag or fail. Continuing to duck indefinitely would leave the tutor murmuring
  // under a student who is clearly talking to it.
  const result = run(frames(80, (i) => voice(0.25, i)));
  assert.equal(result.ducked, true);
  assert.equal(result.stopped, true);
  assert.equal(
    result.decisions.some((d) => d.reason === "decision-timeout"),
    true,
    "should record that it committed on timeout, not on words",
  );
});

// ---------------------------------------------------------------------------
// Level and distance
// ---------------------------------------------------------------------------

test("a whisper close to the mic still ducks", () => {
  const input = frames(40, (i) => voice(0.055, i, 160));
  const result = run(input, { transcript: { text: "what was that last part?", addressed: true, afterFrame: 18 } });
  assert.equal(result.ducked, true, "a quiet voice is still a voice");
  assert.equal(result.stopped, true);
});

test("a voice too faint to be meant for us does not duck", () => {
  // Someone talking across a room, arriving below the absolute floor.
  const result = run(frames(60, (i) => voice(0.012, i, 120)));
  assert.equal(result.ducked, false);
  assert.equal(lastReason(result), "quiet");
});

test("speech over a running fan still ducks", () => {
  // The realistic case: the student talks while the AC runs. Mixed signal, voice must still win.
  const input = frames(40, (i) => {
    const speech = voice(0.22, i);
    const noise = rumble(0.12, i);
    const mixed = new Float32Array(FRAME);
    for (let s = 0; s < FRAME; s += 1) mixed[s] = speech[s] + noise[s];
    return mixed;
  });
  const result = run(input, { transcript: { text: "hold on, can you repeat that?", addressed: true, afterFrame: 18 } });
  assert.equal(result.ducked, true, "a fan must not mask a real question");
  assert.equal(result.stopped, true);
});

test("the noise floor adapts so a noisy room does not raise sensitivity", () => {
  const gate = new InterruptionGate();
  for (let i = 0; i < 100; i += 1) gate.push(analyzeFrame(rumble(0.3, i), SAMPLE_RATE), i * FRAME_MS);
  assert.ok(gate.getNoiseFloor() > 0.02, `floor should have risen to meet the room, got ${gate.getNoiseFloor().toFixed(4)}`);
  assert.equal(gate.getStage(), "idle", "learning the room must not itself be an interruption");
});

// ---------------------------------------------------------------------------
// Self-echo — the tutor hearing its own voice through the speakers.
// ---------------------------------------------------------------------------

test("the tutor's own audio never interrupts the tutor", () => {
  const gate = new InterruptionGate();
  let ducked = false;
  const echoGate = new InterruptionGate({}, { onDuck: () => { ducked = true; } });
  // Its own voice, fed back through the mic, while it is speaking.
  for (let i = 0; i < 40; i += 1) {
    const now = i * FRAME_MS;
    echoGate.noteTutorAudio(now);
    echoGate.push(analyzeFrame(voice(0.3, i), SAMPLE_RATE), now);
  }
  assert.equal(ducked, false, "echo of the tutor must never duck it");
  assert.equal(gate.getStage(), "idle");
});

test("once the tutor stops, a real voice is heard again", () => {
  let ducked = false;
  const gate = new InterruptionGate({}, { onDuck: () => { ducked = true; } });
  // Tutor speaking.
  for (let i = 0; i < 10; i += 1) {
    const now = i * FRAME_MS;
    gate.noteTutorAudio(now);
    gate.push(analyzeFrame(voice(0.3, i), SAMPLE_RATE), now);
  }
  // Tutor stops; cooldown lapses; the student speaks.
  const base = 10 * FRAME_MS + DEFAULT_GATE_CONFIG.selfEchoCooldownMs + 1;
  for (let i = 0; i < 20; i += 1) {
    gate.push(analyzeFrame(voice(0.3, i + 10), SAMPLE_RATE), base + i * FRAME_MS);
  }
  assert.equal(ducked, true, "after the cooldown a real voice must get through");
});

// ---------------------------------------------------------------------------
// Bookkeeping
// ---------------------------------------------------------------------------

test("every decision carries a machine-readable reason and a human explanation", () => {
  const result = run(frames(30, (i) => rumble(0.3, i)));
  assert.ok(result.decisions.length > 0);
  for (const decision of result.decisions) {
    assert.ok(decision.reason.length > 0, "every decision needs a reason code");
    assert.ok(decision.detail.length > 0, "every decision needs a human-readable detail");
    assert.ok(decision.voiceConfidence >= 0 && decision.voiceConfidence <= 1);
  }
});

test("reset restores the volume if it was ducked", () => {
  let restored = false;
  const gate = new InterruptionGate({}, { onRestore: () => { restored = true; } });
  for (let i = 0; i < 40; i += 1) gate.push(analyzeFrame(voice(0.25, i), SAMPLE_RATE), i * FRAME_MS);
  assert.equal(gate.getStage(), "ducked");
  gate.reset();
  assert.equal(restored, true, "tearing down mid-duck must not leave the tutor quiet forever");
  assert.equal(gate.getStage(), "idle");
});

test("isVoiceLike rejects each noise class on its own terms", () => {
  assert.equal(isVoiceLike(analyzeFrame(whiteNoise(0.2), SAMPLE_RATE), DEFAULT_GATE_CONFIG), false);
  assert.equal(isVoiceLike(analyzeFrame(rumble(0.3, 0), SAMPLE_RATE), DEFAULT_GATE_CONFIG), false);
  assert.equal(isVoiceLike(analyzeFrame(voice(0.25, 0), SAMPLE_RATE), DEFAULT_GATE_CONFIG), true);
});

/**
 * The speaker layer, on synthesised voices.
 *
 * WHAT THIS CAN PROVE. That the pitch estimator reads a harmonic stack correctly, that a profile
 * enrolled on one voice rejects a voice a fifth away and accepts its own, and that noise is never
 * mistaken for anyone. WHAT IT CANNOT. A real false-accept rate between two similar people — that
 * needs recordings and a room, and no number here should be quoted as one.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { analyzeVoiceFrame } from "../voice/features";
import { HeuristicVoiceprint } from "../voice/speakerProfile";

const RATE = 16_000;
const WINDOW = 640; // 40 ms — what the gate hands the feature extractor

/**
 * Harmonic stack with a spectral tilt, so two voices differ in timbre as well as pitch.
 *
 * Starts at the SECOND harmonic, like the interruption matrix's generator starts at the third: a
 * stack that begins at the fundamental with 1/h weights puts most of its power below 300 Hz, which
 * no real voice does (formants carry it) and which the speech-band guard rightly rejects.
 * Autocorrelation still reads the true pitch from the harmonic spacing.
 */
function voice(f0: number, tilt: number, offset: number, amplitude = 0.15): Float32Array {
  const out = new Float32Array(WINDOW);
  for (let i = 0; i < WINDOW; i++) {
    const t = (offset * WINDOW + i) / RATE;
    let s = 0;
    for (let h = 2; h <= 24; h++) {
      const hz = f0 * h;
      if (hz > 4000) break;
      s += Math.sin(2 * Math.PI * hz * t) / Math.pow(h, tilt);
    }
    out[i] = s * amplitude;
  }
  return out;
}

/**
 * xorshift32 via Math.imul. The matrix tests' LCG multiplies a 31-bit state by 1.1e9 in a JS
 * double, loses precision past 2^53, and collapses into a short cycle — which is PERIODIC, so a
 * pitch estimator reads it as a strongly voiced 0.85. Fine for a flatness test; wrong for this one.
 */
function noise(amplitude: number, seed: number): Float32Array {
  const out = new Float32Array(WINDOW);
  let x = (seed || 1) | 0;
  for (let i = 0; i < WINDOW; i++) {
    x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
    out[i] = ((x >>> 0) / 0xffffffff * 2 - 1) * amplitude;
  }
  return out;
}

test("pitch is read to within 2% on a 130 Hz and a 210 Hz voice", () => {
  const low = analyzeVoiceFrame(voice(130, 1.0, 3), RATE);
  const high = analyzeVoiceFrame(voice(210, 1.0, 3), RATE);
  assert.ok(low.f0 !== null && Math.abs(low.f0 - 130) / 130 < 0.02, `low f0=${low.f0}`);
  assert.ok(high.f0 !== null && Math.abs(high.f0 - 210) / 210 < 0.02, `high f0=${high.f0}`);
  assert.ok(low.voicing > 0.8 && high.voicing > 0.8, "harmonic stacks are strongly voiced");
});

test("noise is unvoiced and has no pitch", () => {
  const f = analyzeVoiceFrame(noise(0.3, 9), RATE);
  assert.ok(f.voicing < 0.5, `voicing=${f.voicing}`);
  assert.equal(f.f0, null);
});

test("band shape is level-independent, which is what survives the browser's AGC", () => {
  const quiet = analyzeVoiceFrame(voice(130, 1.0, 5, 0.03), RATE);
  const loud = analyzeVoiceFrame(voice(130, 1.0, 5, 0.3), RATE);
  let maxDiff = 0;
  for (let b = 0; b < quiet.bands.length; b++) maxDiff = Math.max(maxDiff, Math.abs(quiet.bands[b] - loud.bands[b]));
  assert.ok(maxDiff < 0.05, `band shape moved by ${maxDiff} with a 10x level change`);
});

function enrolled(f0: number, tilt: number): HeuristicVoiceprint {
  const vp = new HeuristicVoiceprint();
  for (let i = 0; i < 60; i++) {
    // A real voice wanders: ±8% pitch drift across the enrolment.
    const drift = 1 + 0.08 * Math.sin(i / 4);
    vp.enrol(analyzeVoiceFrame(voice(f0 * drift, tilt, i), RATE));
  }
  return vp;
}

test("a profile is not trusted until it has heard enough voiced speech", () => {
  const vp = new HeuristicVoiceprint();
  assert.equal(vp.enrolled, false);
  assert.equal(vp.match(analyzeVoiceFrame(voice(130, 1, 0), RATE)).verdict, "unknown");
  for (let i = 0; i < 10; i++) vp.enrol(analyzeVoiceFrame(noise(0.2, i), RATE));
  assert.equal(vp.enrolledFrames, 0, "noise must not count as enrolment");
});

test("the enrolled student is recognised, including at the edges of their range", () => {
  const vp = enrolled(130, 1.0);
  for (const f0 of [118, 125, 130, 138, 145]) {
    const m = vp.match(analyzeVoiceFrame(voice(f0, 1.0, 7), RATE));
    assert.equal(m.verdict, "student", `${f0} Hz: ${m.reason}`);
  }
});

test("a voice a fifth away with a different timbre is someone else", () => {
  const vp = enrolled(130, 1.0);
  for (const f0 of [200, 210, 230]) {
    const m = vp.match(analyzeVoiceFrame(voice(f0, 0.6, 7), RATE));
    assert.equal(m.verdict, "other", `${f0} Hz: ${m.reason}`);
  }
});

test("and the reverse: enrolled on the higher voice, the lower one is someone else", () => {
  const vp = enrolled(210, 0.6);
  assert.equal(vp.match(analyzeVoiceFrame(voice(210, 0.6, 9), RATE)).verdict, "student");
  assert.equal(vp.match(analyzeVoiceFrame(voice(130, 1.0, 9), RATE)).verdict, "other");
});

test("noise is never called the student, however loud", () => {
  const vp = enrolled(130, 1.0);
  const m = vp.match(analyzeVoiceFrame(noise(0.5, 4), RATE));
  assert.notEqual(m.verdict, "student");
});

test("similar voices are honestly 'unknown' rather than confidently wrong", () => {
  // Same tilt, pitch 15% apart — inside the spread of one expressive speaker. The right answer
  // is "cannot tell from this alone", and the gate treats unknown as "fall back to the words".
  const vp = enrolled(130, 1.0);
  const m = vp.match(analyzeVoiceFrame(voice(150, 1.0, 11), RATE));
  assert.notEqual(m.verdict, "other", `should not confidently reject a 15% pitch difference: ${m.reason}`);
});

test("reset forgets everything", () => {
  const vp = enrolled(130, 1.0);
  vp.reset();
  assert.equal(vp.enrolled, false);
  assert.equal(vp.enrolledFrames, 0);
});

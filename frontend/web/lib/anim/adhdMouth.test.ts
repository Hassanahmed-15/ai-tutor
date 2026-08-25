/**
 * Lip sync — the "mouth height varies across frames while audio plays" assertion.
 *
 * WHY HERE AND NOT IN THE BROWSER SUITE. The claim worth checking is that the mouth FOLLOWS THE
 * VOICE, and a Playwright run cannot honestly check that: TTS needs a live OpenAI key, the player
 * starts muted, and sampling an SVG attribute across animation frames from outside the page is
 * flaky enough that a green result would mean very little. The amplitude pipeline is where the
 * behaviour actually lives, and it is deterministic — so it is driven directly, with a fake
 * analyser feeding known waveforms.
 *
 * A MOUTH STUCK OPEN AND A MOUTH STUCK SHUT BOTH "RENDER". Only a moving one is working, so the
 * central test asserts variation over time rather than any single value.
 *
 * The avatar's binding is one expression — `ry={speaking ? 1.4 + level * 6.4 : 0}` in
 * TeacherAvatar — so a level that moves is a mouth height that moves.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { attachMouthAnalyser, detachMouthAnalyser, mouthLevel, mouthShape, onMouthShape, visemeFrom } from "../adhd/mouth";

const mouthShapeWidth = () => mouthShape().width;

/** Fake analyser whose waveform amplitude the test sets frame by frame. */
class FakeAnalyser {
  fftSize = 2048;
  smoothingTimeConstant = 0;
  /** 0-1 of full scale. The value the next getByteTimeDomainData call will encode. */
  amplitude = 0;
  /** Where the fake spectrum puts its energy: "low" (rounded), "high" (spread), "flat" (open). */
  tilt: "low" | "high" | "flat" = "flat";
  readonly context = { sampleRate: 44100 };
  get frequencyBinCount() {
    return this.fftSize / 2;
  }
  connect() {}
  getByteTimeDomainData(buf: Uint8Array) {
    // A square wave at the requested amplitude, so RMS equals the amplitude exactly and the
    // expected level is arithmetic rather than a fudge factor.
    const swing = Math.round(this.amplitude * 128);
    for (let i = 0; i < buf.length; i++) buf[i] = 128 + (i % 2 === 0 ? swing : -swing);
  }
  getByteFrequencyData(buf: Uint8Array) {
    const hzPerBin = this.context.sampleRate / 2 / buf.length;
    for (let i = 0; i < buf.length; i++) {
      const hz = i * hzPerBin;
      if (this.tilt === "flat") buf[i] = hz < 4000 ? 160 : 0;
      else if (this.tilt === "low") buf[i] = hz < 500 ? 220 : 10;
      else buf[i] = hz >= 2000 && hz < 4000 ? 220 : 10;
    }
  }
}

type Frame = () => void;

/** Install rAF stubs that queue the callback instead of running it, so frames are stepped by hand. */
function harness() {
  const analyser = new FakeAnalyser();
  let pending: Frame | null = null;
  const g = globalThis as unknown as Record<string, unknown>;
  g.requestAnimationFrame = (fn: Frame) => {
    pending = fn;
    return 1;
  };
  g.cancelAnimationFrame = () => {
    pending = null;
  };

  const ctx = { createAnalyser: () => analyser } as unknown as AudioContext;
  const source = { connect: () => {} } as unknown as AudioNode;
  attachMouthAnalyser(ctx, source); // runs frame 1 immediately

  /** Advance one frame at the given amplitude and return the resulting mouth level. */
  const step = (amplitude: number, tilt: "low" | "high" | "flat" = "flat") => {
    analyser.amplitude = amplitude;
    analyser.tilt = tilt;
    const fn = pending;
    if (!fn) throw new Error("no frame queued — the loop stopped");
    fn();
    return mouthLevel();
  };
  /** Hold an amplitude for n frames — at 60fps a syllable is ~10 frames, not one. */
  const hold = (amplitude: number, frames: number, tilt: "low" | "high" | "flat" = "flat") => {
    const out: number[] = [];
    for (let i = 0; i < frames; i++) out.push(step(amplitude, tilt));
    return out;
  };
  return { step, hold };
}

/**
 * Run a body with the analyser attached, detaching even when an assertion throws.
 *
 * The first version detached on the last line of each test. Test one failed, so its detach never
 * ran, the module-level rAF handle stayed set, and every subsequent attach skipped starting the
 * loop — turning one real failure into five and hiding which was which.
 */
function withMouth(body: (h: ReturnType<typeof harness>) => void) {
  const h = harness();
  try {
    body(h);
  } finally {
    detachMouthAnalyser();
  }
}

test("the mouth height VARIES across frames while audio plays", () => {
  withMouth(({ hold }) => {
    // Two spoken words with a real gap between them. Amplitudes are HELD, because the close is
    // deliberately gradual — asserting over single frames measured the smoothing, not the speech.
    const levels = [
      ...hold(0.24, 6), // "ionic"
      ...hold(0.40, 4),
      ...hold(0.0, 10), // the pause
      ...hold(0.31, 6), // "bonds"
      ...hold(0.0, 10),
    ];

    const distinct = new Set(levels.map((l) => l.toFixed(3)));
    assert.ok(distinct.size >= 8, `mouth barely moved: ${[...distinct].join(", ")}`);
    assert.ok(Math.max(...levels) > 0.5, "the mouth never opened meaningfully");
    assert.ok(Math.min(...levels) < 0.15, "the mouth never closed between words");
    // And the movement must track the VOICE, not just wobble: loud frames open, pauses close.
    assert.ok(levels[9] > 0.8, `should be wide open mid-word, got ${levels[9]}`);
    assert.ok(levels[19] < 0.1, `should be shut in the pause, got ${levels[19]}`);
  });
});

test("it opens fast and closes slowly — a mouth that snaps shut reads as a glitch", () => {
  withMouth(({ step }) => {
  const loud = step(0.3);
  assert.ok(loud > 0.9, `should open on the first loud frame, got ${loud}`);

  // One silent frame must NOT slam the mouth shut...
  const first = step(0);
  assert.ok(first > 0.2 && first < loud, `expected an eased close, got ${first}`);
  // ...but sustained silence must still settle it closed, not leave it hanging ajar.
  let last = first;
  for (let i = 0; i < 25; i++) last = step(0);
  assert.ok(last < 0.02, `mouth stayed open through silence: ${last}`);
  });
});

test("room tone does not make the mouth jitter", () => {
  withMouth(({ step }) => {
    // Below the 0.02 floor: real silence is never numerically exact, and a mouth twitching on noise
    // is the single most obvious tell that lip sync is fake.
    for (const a of [0.004, 0.011, 0.002, 0.015]) assert.equal(step(a), 0);
  });
});

test("detaching closes the mouth instead of freezing it mid-word", () => {
  withMouth(({ step }) => {
    assert.ok(step(0.35) > 0.5);
  });
  assert.equal(mouthLevel(), 0, "the mouth must close when the voice stops");
});

test("subscribers are notified and can unsubscribe", () => {
  const seen: number[] = [];
  const off = onMouthShape((m) => seen.push(m.open));
  withMouth(({ step }) => {
    step(0.3);
    step(0.1);
    assert.ok(seen.length >= 2, "subscriber heard nothing");

    off();
    const after = seen.length;
    step(0.4);
    assert.equal(seen.length, after, "unsubscribed listener still received updates");
  });
});

/*
 * VISEMES — the lip-shape half.
 *
 * `visemeFrom` is pure so the vowel rules can be checked as arithmetic instead of by staring at a
 * face. The claim is not that this identifies phonemes: it is that energy sitting HIGH in the
 * spectrum (front vowels like "ee") spreads the lips, and energy sitting LOW (rounded vowels like
 * "oo") purses them. Anything that inverts or flattens that relationship is a broken mouth.
 */
test("bright audio spreads the lips, dark audio rounds them", () => {
  const loud = 0.3;
  const ee = visemeFrom({ low: 20, mid: 120, high: 200 }, loud);
  const oo = visemeFrom({ low: 300, mid: 30, high: 5 }, loud);
  const ah = visemeFrom({ low: 150, mid: 150, high: 150 }, loud);

  assert.ok(ee.width > ah.width, `"ee" should be wider than "ah" (${ee.width} vs ${ah.width})`);
  assert.ok(ah.width > oo.width, `"ah" should be wider than "oo" (${ah.width} vs ${oo.width})`);
  // All three are the same loudness, so the JAW should not move with vowel colour — only the lips.
  assert.equal(ee.open, oo.open, "vowel colour must not change how far the jaw drops");
});

test("width stays inside 0-1 for every spectrum, including degenerate ones", () => {
  const spectra = [
    { low: 0, mid: 0, high: 1000 },   // all treble
    { low: 1000, mid: 0, high: 0 },   // all bass
    { low: 0, mid: 0, high: 0 },      // silence-shaped but loud: a click
    { low: 1, mid: 1, high: 1 },
  ];
  for (const b of spectra) {
    const { open, width } = visemeFrom(b, 0.3);
    assert.ok(width >= 0 && width <= 1, `width out of range for ${JSON.stringify(b)}: ${width}`);
    assert.ok(open >= 0 && open <= 1, `open out of range for ${JSON.stringify(b)}: ${open}`);
  }
});

test("silence closes the mouth and returns the lips to neutral", () => {
  // Not just open:0 — a mouth that closes while still holding a full pucker looks like a grimace,
  // and it is the shape the next word would start from.
  const quiet = visemeFrom({ low: 400, mid: 0, high: 0 }, 0.001);
  assert.equal(quiet.open, 0);
  assert.equal(quiet.width, 0.5);
});

test("the analyser loop actually moves the lips, not just the jaw", () => {
  // The end-to-end version of the test above: drive real frames through the loop and confirm the
  // published width follows the spectrum. Smoothing is deliberate, so this holds each tilt long
  // enough for the eased width to arrive.
  withMouth(({ hold }) => {
    hold(0.3, 25, "high");
    const spread = mouthShapeWidth();
    hold(0.3, 25, "low");
    const rounded = mouthShapeWidth();
    assert.ok(spread > rounded + 0.15,
              `lips did not change shape with the spectrum: spread=${spread} rounded=${rounded}`);
  });
});

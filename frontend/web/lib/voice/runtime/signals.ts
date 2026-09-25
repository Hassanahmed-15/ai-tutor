/**
 * SYNTHETIC ROOM SOUNDS, one 20 ms frame at a time — the lab's test signals.
 *
 * Ported from the production scenario suite so the lab and production judge the same audio. The
 * voice generator matters most: a harmonic stack with spectral tilt, a 5 Hz syllabic loudness
 * pulse and 1.5% vibrato whose phase is the INTEGRAL of instantaneous frequency (the obvious
 * `pitch*t` mistake turns vibrato into an unbounded chirp). Noise uses xorshift, because an LCG
 * collapses into a short cycle that reads as periodic — as a voice.
 *
 * Everything is phase-continuous via `offset` (the frame index), so frames concatenate into audio
 * that can also be PLAYED into the live pipeline through an AudioContext for stress tests.
 */

export const RATE = 16_000;
export const FRAME = 320; // 20 ms
export const FRAME_MS = 20;

export function xorshift(seed: number) {
  let x = (seed || 1) | 0;
  return () => {
    x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
    return ((x >>> 0) / 0xffffffff) * 2 - 1;
  };
}

export function noise(amplitude: number, seed: number): Float32Array {
  const rnd = xorshift(seed);
  const out = new Float32Array(FRAME);
  for (let i = 0; i < FRAME; i++) out[i] = rnd() * amplitude;
  return out;
}

/** Fan / AC: tonal hum, all of it below the speech band. */
export function fan(amplitude: number, offset: number): Float32Array {
  const out = new Float32Array(FRAME);
  for (let i = 0; i < FRAME; i++) {
    const t = (offset * FRAME + i) / RATE;
    out[i] = amplitude * (Math.sin(2 * Math.PI * 60 * t) * 0.6 + Math.sin(2 * Math.PI * 120 * t) * 0.3 + Math.sin(2 * Math.PI * 95 * t) * 0.1);
  }
  return out;
}

/** Traffic: low rumble plus broadband hiss, slowly swelling. */
export function traffic(amplitude: number, offset: number): Float32Array {
  const swell = 0.6 + 0.4 * Math.sin(offset / 20);
  return mix(fan(amplitude * swell, offset), noise(amplitude * 0.5 * swell, offset + 101));
}

/** A voice: f0 in Hz, tilt shapes the timbre (1.0 darker, 0.6 brighter). */
export function voice(f0: number, offset: number, amplitude = 0.14, tilt = 1.0): Float32Array {
  const out = new Float32Array(FRAME);
  const DEPTH = 0.015;
  const VIBRATO_HZ = 6;
  for (let i = 0; i < FRAME; i++) {
    const t = (offset * FRAME + i) / RATE;
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

/**
 * A voice a NEURAL detector recognises: the same harmonic source, shaped by three formants.
 *
 * Production's VAD check found that a bare harmonic stack scores ~0.07 with Silero while a
 * formant-shaped vowel scores 0.38-0.47 — the model was trained on speech, and speech has
 * resonances. The acoustic heuristics accept both, so this is used for every scenario voice and
 * the bare `voice()` is kept for callers that want a deliberately un-speech-like harmonic tone.
 *
 *   envelope "soft"  loudness pulses 0.65-1.0 at 5 Hz (continuous voicing, as in production's suite)
 *   envelope "hard"  half-wave syllables at 3.5 Hz with true gaps (as in production's VAD check)
 */
export type Formants = ReadonlyArray<readonly [number, number]>;
export const VOWEL_A: Formants = [[730, 90], [1090, 110], [2440, 140]];
export const VOWEL_I: Formants = [[300, 70], [2300, 130], [3000, 160]];
export const VOWEL_E: Formants = [[530, 80], [1840, 120], [2480, 140]];

export function formantVoice(f0: number, offset: number, amplitude = 0.14, formants: Formants = VOWEL_A, envelope: "soft" | "hard" = "soft"): Float32Array {
  const out = new Float32Array(FRAME);
  const DEPTH = 0.015;
  const VIBRATO_HZ = 6;
  for (let i = 0; i < FRAME; i++) {
    const t = (offset * FRAME + i) / RATE;
    const phaseTime = t - (DEPTH * Math.cos(2 * Math.PI * VIBRATO_HZ * t)) / (2 * Math.PI * VIBRATO_HZ);
    const syllable = envelope === "hard" ? Math.max(0, Math.sin(2 * Math.PI * 3.5 * t)) ** 0.5 : 0.65 + 0.35 * Math.sin(2 * Math.PI * 5 * t);
    let sum = 0;
    for (let h = 1; h <= 30; h++) {
      const hz = f0 * h;
      if (hz > 4000) break;
      let gain = 0;
      for (const [fc, bw] of formants) gain += 1 / (1 + ((hz - fc) / bw) ** 2);
      sum += (gain / h) * Math.sin(2 * Math.PI * hz * phaseTime);
    }
    out[i] = sum * amplitude * syllable;
  }
  return out;
}

/**
 * Speech-shaped voice for the NEURAL detector: formants that glide between vowels every ~150 ms
 * (a syllable is a movement, not a held vowel), a little aspiration noise, and cycle-to-cycle
 * pitch jitter. Each of these is something Silero learned from real speech and none of them is
 * present in a held tone; measured on the calibration page, a held formant vowel scores speech on
 * ~5% of frames and this on far more.
 */
export function speechVoice(f0: number, offset: number, amplitude = 0.14, seed = 1): Float32Array {
  const out = new Float32Array(FRAME);
  const rnd = xorshift(seed + offset * 7919);
  const vowels: Formants[] = [VOWEL_A, VOWEL_I, VOWEL_E];
  for (let i = 0; i < FRAME; i++) {
    const t = (offset * FRAME + i) / RATE;
    // Which vowel pair we are gliding between, and how far along.
    const cycle = t / 0.15;
    const from = vowels[Math.floor(cycle) % vowels.length];
    const to = vowels[(Math.floor(cycle) + 1) % vowels.length];
    const mixAmount = cycle - Math.floor(cycle);
    const jitter = 1 + 0.02 * Math.sin(2 * Math.PI * 27 * t) + 0.01 * Math.sin(2 * Math.PI * 6 * t);
    const syllable = 0.55 + 0.45 * Math.max(0, Math.sin(2 * Math.PI * 4 * t));
    let sum = 0;
    for (let h = 1; h <= 30; h++) {
      const hz = f0 * jitter * h;
      if (hz > 4000) break;
      let gain = 0;
      for (let k = 0; k < 3; k++) {
        const fc = from[k][0] * (1 - mixAmount) + to[k][0] * mixAmount;
        const bw = from[k][1] * (1 - mixAmount) + to[k][1] * mixAmount;
        gain += 1 / (1 + ((hz - fc) / bw) ** 2);
      }
      sum += (gain / h) * Math.sin(2 * Math.PI * hz * t);
    }
    out[i] = (sum * syllable + rnd() * 0.06) * amplitude;
  }
  return out;
}

/** A cast: three voices with distinct pitch and timbre. */
export interface Cast {
  STUDENT: (offset: number, amp?: number) => Float32Array;
  FRIEND: (offset: number, amp?: number) => Float32Array;
  ARIA: (offset: number, amp?: number) => Float32Array;
}

/** The bare harmonic cast production's matrix was built on: what the acoustic heuristics are tuned to. */
export const BARE_CAST: Cast = {
  STUDENT: (offset, amp = 0.14) => voice(130, offset, amp, 1.0),
  FRIEND: (offset, amp = 0.12) => voice(215, offset, amp, 0.6),
  ARIA: (offset, amp = 0.16) => voice(200, offset, amp, 0.8),
};

/** The speech-shaped cast for runs with the neural VAD. */
export const SPEECH_CAST: Cast = {
  STUDENT: (offset, amp = 0.14) => speechVoice(130, offset, amp, 1),
  FRIEND: (offset, amp = 0.12) => speechVoice(215, offset, amp, 2),
  ARIA: (offset, amp = 0.16) => speechVoice(200, offset, amp, 3),
};

export const STUDENT = BARE_CAST.STUDENT;
export const FRIEND = BARE_CAST.FRIEND;
export const ARIA = BARE_CAST.ARIA;

/** Music / TV: a steady chord of three tones in the speech band. */
export function music(amplitude: number, offset: number): Float32Array {
  const out = new Float32Array(FRAME);
  for (let i = 0; i < FRAME; i++) {
    const t = (offset * FRAME + i) / RATE;
    out[i] = (amplitude * (Math.sin(2 * Math.PI * 440 * t) + Math.sin(2 * Math.PI * 554 * t) + Math.sin(2 * Math.PI * 659 * t))) / 3;
  }
  return out;
}

/** A notification ping: a short 1.5 kHz tone with a decaying envelope. */
export function ping(offset: number, startFrame: number, lengthFrames = 8): Float32Array {
  const out = new Float32Array(FRAME);
  const k = offset - startFrame;
  if (k < 0 || k >= lengthFrames) return out;
  for (let i = 0; i < FRAME; i++) {
    const t = (k * FRAME + i) / RATE;
    out[i] = 0.4 * Math.exp(-t * 12) * Math.sin(2 * Math.PI * 1500 * t);
  }
  return out;
}

export function click(amplitude: number): Float32Array {
  const out = new Float32Array(FRAME);
  for (let i = 0; i < 20; i++) out[i] = amplitude * (i % 2 === 0 ? 1 : -1) * (1 - i / 20);
  return out;
}

export function silence(): Float32Array {
  return new Float32Array(FRAME);
}

export function mix(a: Float32Array, b: Float32Array): Float32Array {
  const out = new Float32Array(FRAME);
  for (let i = 0; i < FRAME; i++) out[i] = a[i] + b[i];
  return out;
}

export function seq(count: number, make: (i: number) => Float32Array): Float32Array[] {
  return Array.from({ length: count }, (_, i) => make(i));
}

/** Frames joined into one buffer, for playback through an AudioContext. */
export function joinFrames(frames: Float32Array[]): Float32Array {
  const out = new Float32Array(frames.length * FRAME);
  frames.forEach((frame, index) => out.set(frame, index * FRAME));
  return out;
}

/** Named noise beds the live stress panel can mix under the real microphone at a chosen level. */
export const NOISE_BEDS: Record<string, (offset: number, amplitude: number) => Float32Array> = {
  none: () => silence(),
  fan: (offset, amplitude) => fan(amplitude, offset),
  traffic: (offset, amplitude) => traffic(amplitude, offset),
  tv: (offset, amplitude) => music(amplitude * 0.4, offset),
  "other voice": (offset, amplitude) => FRIEND(offset, amplitude * 0.8),
  "my voice (synthetic)": (offset, amplitude) => SPEECH_CAST.STUDENT(offset, amplitude),
  keyboard: (offset, amplitude) => (offset % 5 === 0 ? click(amplitude * 1.6) : silence()),
  hiss: (offset, amplitude) => noise(amplitude * 0.5, offset + 7),
};

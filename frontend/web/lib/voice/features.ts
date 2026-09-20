/**
 * PER-FRAME ACOUSTIC FEATURES for the voice gate — the existing noise-vs-speech set plus what a
 * speaker profile needs.
 *
 * Builds on `analyzeFrame` from lib/interruptionGate.ts (RMS, spectral flatness, zero-crossing
 * rate, speech-band ratio), which is proven against the interruption matrix and stays the
 * authority on "is this noise". Added here:
 *
 *   f0        — fundamental frequency by normalised autocorrelation. The single most separating
 *               cue between two voices in the same room, and absent from the old gate entirely.
 *   voicing   — the autocorrelation peak height, 0..1. Voiced speech is periodic; a fan, a
 *               keyboard and a cough are not, however loud they are.
 *   centroid  — spectral centre of mass in Hz. Whispers and sibilants sit high, hums sit low.
 *   bands     — eight log band energies from 100 Hz to 4 kHz, mean-removed, so the vector is the
 *               SHAPE of the spectrum (timbre) and not its level. Level is what the browser's AGC
 *               destroys; shape is what survives it.
 *
 * Pitch wants at least two periods in the window, so the gate calls this on a 40 ms buffer
 * (two 20 ms frames) rather than one. Everything is O(n·k) with tiny constants — well under a
 * millisecond per call on any laptop, which is the budget for something that runs fifty times a
 * second on the main thread.
 */
import { analyzeFrame, type AudioFeatures } from "../interruptionGate";

export interface VoiceFrameFeatures extends AudioFeatures {
  /** Fundamental frequency in Hz, or null when the frame is not voiced. */
  f0: number | null;
  /** Normalised autocorrelation peak, 0..1. Above ~0.5 is periodic (voiced). */
  voicing: number;
  /** Spectral centroid in Hz. */
  centroid: number;
  /** Mean-removed log energies of BAND_EDGES bands — the timbre shape. */
  bands: Float32Array;
}

export const BAND_EDGES = [100, 200, 400, 700, 1000, 1500, 2200, 3000, 4000];
export const BAND_COUNT = BAND_EDGES.length - 1;

const F0_MIN = 70;
const F0_MAX = 400;

/**
 * Fundamental by normalised autocorrelation over the lag range of human pitch. Parabolic
 * interpolation around the best lag gives sub-sample resolution, which matters because a 130 Hz
 * voice at 16 kHz is a lag of 123.08 samples and rounding would quantise pitch to ~1%.
 */
function estimatePitch(raw: Float32Array, sampleRate: number): { f0: number | null; voicing: number } {
  /*
   * LOW-PASS FIRST. Pitch lives in the first few harmonics; the upper ones only hurt here. A real
   * voice has a percent or two of vibrato and jitter, and at the 20th harmonic a 1.5% wobble is a
   * 40 Hz drift across one 40 ms window — enough to scramble the autocorrelation at the true lag
   * and read a clearly voiced vowel as 0.3 "voicing". An 8-tap box average applied twice (first
   * null near 2 kHz at 16 kHz; a single pass still leaks 1-3 kHz at 0.2-0.6, the square drops 3 kHz
   * to 0.04) keeps the harmonics that carry the period and drops the ones that carry the drift.
   * Every practical pitch tracker does some version of this.
   */
  const n = raw.length;
  const TAPS = 8;
  let pcm = raw;
  for (let pass = 0; pass < 2; pass++) {
    const out = new Float32Array(n);
    let acc = 0;
    for (let i = 0; i < n; i++) {
      acc += pcm[i];
      if (i >= TAPS) acc -= pcm[i - TAPS];
      out[i] = acc / TAPS;
    }
    pcm = out;
  }
  const minLag = Math.floor(sampleRate / F0_MAX);
  const maxLag = Math.min(Math.floor(sampleRate / F0_MIN), n - 1);
  if (maxLag <= minLag) return { f0: null, voicing: 0 };

  let energy = 0;
  for (let i = 0; i < n; i++) energy += pcm[i] * pcm[i];
  if (energy < 1e-7) return { f0: null, voicing: 0 };

  let bestLag = -1;
  let best = 0;
  const scores = new Float32Array(maxLag + 1);
  for (let lag = minLag; lag <= maxLag; lag++) {
    let acc = 0;
    let e1 = 0;
    let e2 = 0;
    const len = n - lag;
    for (let i = 0; i < len; i++) {
      const a = pcm[i];
      const b = pcm[i + lag];
      acc += a * b;
      e1 += a * a;
      e2 += b * b;
    }
    const norm = Math.sqrt(e1 * e2) || 1e-9;
    const r = acc / norm;
    scores[lag] = r;
    if (r > best) {
      best = r;
      bestLag = lag;
    }
  }
  if (bestLag < 0) return { f0: null, voicing: 0 };

  /*
   * Octave errors. Every multiple of the true period also scores highly (the signal repeats there
   * too), so the global maximum can land on 2T or 3T and halve the pitch. The true period is the
   * SHORTEST lag that is a local peak within 10% of the best — for a voice with odd harmonics T/2 is
   * a visibly lower peak, so it is not chosen; for a signal with only even harmonics T/2 IS the
   * period, and that is the right answer.
   */
  for (let lag = minLag + 1; lag < bestLag; lag++) {
    if (scores[lag] >= best * 0.9 && scores[lag] >= scores[lag - 1] && scores[lag] >= scores[lag + 1]) {
      bestLag = lag;
      break;
    }
  }

  let lag = bestLag;
  if (bestLag > minLag && bestLag < maxLag) {
    const y0 = scores[bestLag - 1];
    const y1 = scores[bestLag];
    const y2 = scores[bestLag + 1];
    const denom = y0 - 2 * y1 + y2;
    if (Math.abs(denom) > 1e-9) lag = bestLag + (0.5 * (y0 - y2)) / denom;
  }
  const voicing = Math.max(0, Math.min(1, best));
  return { f0: voicing >= 0.3 ? sampleRate / lag : null, voicing };
}

/** Goertzel magnitude at one frequency — the same primitive analyzeFrame uses, kept local. */
function magnitudeAt(pcm: Float32Array, sampleRate: number, hz: number): number {
  const w = (2 * Math.PI * hz) / sampleRate;
  const coeff = 2 * Math.cos(w);
  let s0 = 0;
  let s1 = 0;
  let s2 = 0;
  for (let i = 0; i < pcm.length; i++) {
    s0 = pcm[i] + coeff * s1 - s2;
    s2 = s1;
    s1 = s0;
  }
  const power = s1 * s1 + s2 * s2 - coeff * s1 * s2;
  return Math.sqrt(Math.max(0, power)) / pcm.length;
}

export function analyzeVoiceFrame(pcm: Float32Array, sampleRate: number): VoiceFrameFeatures {
  const base = analyzeFrame(pcm, sampleRate);
  const { f0, voicing } = estimatePitch(pcm, sampleRate);

  // Three probes per band, averaged: enough to see the band's energy without an FFT.
  const bands = new Float32Array(BAND_COUNT);
  let centroidNum = 0;
  let centroidDen = 0;
  for (let b = 0; b < BAND_COUNT; b++) {
    const lo = BAND_EDGES[b];
    const hi = BAND_EDGES[b + 1];
    let energy = 0;
    for (let k = 0; k < 3; k++) {
      const hz = lo + ((k + 0.5) / 3) * (hi - lo);
      const m = magnitudeAt(pcm, sampleRate, hz);
      energy += m * m;
      centroidNum += hz * m;
      centroidDen += m;
    }
    bands[b] = Math.log(energy / 3 + 1e-12);
  }
  let mean = 0;
  for (let b = 0; b < BAND_COUNT; b++) mean += bands[b];
  mean /= BAND_COUNT;
  for (let b = 0; b < BAND_COUNT; b++) bands[b] -= mean;

  return {
    ...base,
    f0,
    voicing,
    centroid: centroidDen > 0 ? centroidNum / centroidDen : 0,
    bands,
  };
}

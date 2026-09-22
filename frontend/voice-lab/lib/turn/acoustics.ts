/**
 * ACOUSTIC FEATURES FOR ONE FRAME — the bottom layer of the voice lab's turn-taking stack.
 *
 * Ported from the production gate's feature extraction (lib/interruptionGate.ts `analyzeFrame`,
 * `voiceConfidence`, `isVoiceLike`; lib/voice/features.ts pitch/timbre) so the lab starts from the
 * constants that were MEASURED against real rooms rather than re-deriving them. Nothing in
 * production imports this file; it is a copy, and the lab is where it is allowed to change.
 *
 * Measured reference points, kept because every threshold below is set from them:
 *
 *     fan 60-120 Hz   flat 0.001  zcr 0.006  band 0.004   bandRms 0.005-0.011
 *     white noise     flat 0.580  zcr 0.511  band 0.380   bandRms 0.08-0.16
 *     speech          flat 0.008  zcr 0.049  band 0.979   bandRms 0.058
 *     whisper         rms 0.024                             bandRms 0.023
 *     voice over fan  rms 0.133   band 0.170                bandRms 0.055
 */

export interface AudioFeatures {
  rms: number;
  /** Wiener entropy 0..1: flat noise near 1, harmonic voice well under 0.4. */
  flatness: number;
  zcr: number;
  /** Share of energy in 300-3400 Hz. */
  bandRatio: number;
  /** Absolute speech-band level in the units of `rms` — survives loud out-of-band noise. */
  bandRms: number;
}

export interface VoiceFrameFeatures extends AudioFeatures {
  f0: number | null;
  /** Normalised autocorrelation peak 0..1; ≥0.5 is periodic (voiced). */
  voicing: number;
  centroid: number;
  /** Mean-removed log band energies — the timbre SHAPE, which survives AGC. */
  bands: Float32Array;
}

export interface AcousticsConfig {
  maxFlatness: number;
  minBandRatio: number;
  minBandRms: number;
  confidentBandRms: number;
  maxZcr: number;
  minRms: number;
}

export const ACOUSTICS: AcousticsConfig = {
  maxFlatness: 0.45,
  minBandRatio: 0.35,
  minBandRms: 0.02,
  confidentBandRms: 0.06,
  maxZcr: 0.45,
  minRms: 0.015,
};

export const BAND_EDGES = [100, 200, 400, 700, 1000, 1500, 2200, 3000, 4000];
export const BAND_COUNT = BAND_EDGES.length - 1;
const F0_MIN = 70;
const F0_MAX = 400;

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

export function analyzeFrame(samples: Float32Array, sampleRate: number): AudioFeatures {
  const n = samples.length;
  if (n === 0) return { rms: 0, flatness: 1, zcr: 0, bandRatio: 0, bandRms: 0 };
  let energy = 0;
  let crossings = 0;
  for (let i = 0; i < n; i += 1) {
    energy += samples[i] * samples[i];
    if (i > 0 && (samples[i] >= 0) !== (samples[i - 1] >= 0)) crossings += 1;
  }
  const rms = Math.sqrt(energy / n);
  const zcr = crossings / Math.max(1, n - 1);

  const BINS = 32;
  const maxHz = Math.min(8000, sampleRate / 2);
  const magnitudes = new Float64Array(BINS);
  for (let bin = 0; bin < BINS; bin += 1) {
    const hz = ((bin + 0.5) / BINS) * maxHz;
    const omega = (2 * Math.PI * hz) / sampleRate;
    const cosine = 2 * Math.cos(omega);
    let s0 = 0;
    let s1 = 0;
    let s2 = 0;
    for (let i = 0; i < n; i += 1) {
      s0 = samples[i] + cosine * s1 - s2;
      s2 = s1;
      s1 = s0;
    }
    magnitudes[bin] = Math.sqrt(Math.max(0, s1 * s1 + s2 * s2 - cosine * s1 * s2)) / n;
  }
  let total = 0;
  let band = 0;
  let logSum = 0;
  let arithmeticSum = 0;
  const EPSILON = 1e-10;
  for (let bin = 0; bin < BINS; bin += 1) {
    const hz = ((bin + 0.5) / BINS) * maxHz;
    const power = magnitudes[bin] * magnitudes[bin];
    total += power;
    if (hz >= 300 && hz <= 3400) band += power;
    logSum += Math.log(power + EPSILON);
    arithmeticSum += power + EPSILON;
  }
  const geometricMean = Math.exp(logSum / BINS);
  const arithmeticMean = arithmeticSum / BINS;
  const flatness = arithmeticMean > 0 ? clamp01(geometricMean / arithmeticMean) : 1;
  const bandRatio = total > 0 ? clamp01(band / total) : 0;
  return { rms, flatness, zcr, bandRatio, bandRms: rms * Math.sqrt(bandRatio) };
}

/** How voice-like a window is, 0..1. Band evidence gates multiplicatively; shape only refines. */
export function voiceConfidence(features: AudioFeatures, config: AcousticsConfig = ACOUSTICS): number {
  const shareScore = clamp01((features.bandRatio - config.minBandRatio) / (1 - config.minBandRatio));
  const tonal = features.flatness <= config.maxFlatness;
  const absoluteScore = tonal ? clamp01((features.bandRms - config.minBandRms) / (config.confidentBandRms - config.minBandRms)) : 0;
  const bandScore = Math.max(shareScore, absoluteScore);
  if (bandScore <= 0) return 0;
  const flatnessScore = clamp01((config.maxFlatness - features.flatness) / config.maxFlatness);
  const zcrScore = clamp01((config.maxZcr - features.zcr) / config.maxZcr);
  return clamp01(bandScore * (0.35 + 0.65 * (flatnessScore * 0.6 + zcrScore * 0.4)));
}

export function isVoiceLike(features: AudioFeatures, config: AcousticsConfig = ACOUSTICS): boolean {
  const tonal = features.flatness <= config.maxFlatness;
  const inSpeechBand = features.bandRatio >= config.minBandRatio || (tonal && features.bandRms >= config.minBandRms);
  return tonal && inSpeechBand && features.zcr <= config.maxZcr;
}

/** Fundamental by normalised autocorrelation, low-passed first so harmonic vibrato cannot scramble the lag. */
function estimatePitch(raw: Float32Array, sampleRate: number): { f0: number | null; voicing: number } {
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
    const r = acc / (Math.sqrt(e1 * e2) || 1e-9);
    scores[lag] = r;
    if (r > best) {
      best = r;
      bestLag = lag;
    }
  }
  if (bestLag < 0) return { f0: null, voicing: 0 };
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
  const voicing = clamp01(best);
  return { f0: voicing >= 0.3 ? sampleRate / lag : null, voicing };
}

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
  return Math.sqrt(Math.max(0, s1 * s1 + s2 * s2 - coeff * s1 * s2)) / pcm.length;
}

/** Call on a 40 ms window (two 20 ms frames): pitch needs two periods. */
export function analyzeVoiceFrame(pcm: Float32Array, sampleRate: number): VoiceFrameFeatures {
  const base = analyzeFrame(pcm, sampleRate);
  const { f0, voicing } = estimatePitch(pcm, sampleRate);
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
  return { ...base, f0, voicing, centroid: centroidDen > 0 ? centroidNum / centroidDen : 0, bands };
}

export function concatFrames(a: Float32Array, b: Float32Array): Float32Array {
  const out = new Float32Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

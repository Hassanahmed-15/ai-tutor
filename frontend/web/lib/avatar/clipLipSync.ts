import { Aligner, pauseAfterWord, unitsForWord, weightsFromSegments, type Unit } from "./align";
import { HOP_S, WINDOW_S, analyseVisemeCosts } from "./headFeatures";
import { loadLipsyncRules, wordsOf } from "./rules";
import { VISEME_NAMES, type VisemeWeights } from "./visemes";

/**
 * A NARRATION CLIP'S LIP TRACK, WORKED OUT BEFORE IT PLAYS. The lecture's narration arrives one
 * sentence at a time, as audio we hold before it is heard, with the sentence's text alongside. That is
 * everything forced alignment needs: decode the clip, let the phoneme listener (./headFeatures) score
 * every 16 ms of it, and fit the sentence's own mouth shapes, in order, to that evidence (./align).
 * The result is a mouth shape and a jaw opening for every frame of the clip, keyed to the clip's own
 * time, so playback reads it from the audio element's clock: exact, and right at any speed.
 *
 * Where the browser cannot run the listener offline, the words are still fitted — to the voice's
 * loud and quiet stretches alone — which keeps closures and pauses where the sentence has them.
 */
export type ClipLipTrack = {
  /** Seconds per frame. */
  hopS: number;
  /** Mouth shapes per frame (Oculus viseme names). */
  weights: VisemeWeights[];
  /** Jaw opening per frame, 0..1, from the clip's own loudness. */
  open: Float32Array;
  duration: number;
  /** "aligned" with the phoneme listener; "envelope" from loudness alone. */
  method: "aligned" | "envelope";
};

const SIL = VISEME_NAMES.indexOf("sil");

/** Loudness per frame (the listener's own framing: frame i covers [i·HOP, i·HOP + WINDOW)). */
export function frameLoudness(samples: Float32Array, sampleRate: number): Float32Array {
  const hop = Math.round(HOP_S * sampleRate);
  const win = Math.round(WINDOW_S * sampleRate);
  const n = Math.max(0, Math.floor((samples.length - win) / hop) + 1);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let sum = 0;
    for (let j = i * hop; j < i * hop + win; j++) sum += samples[j] * samples[j];
    out[i] = Math.sqrt(sum / win);
  }
  return out;
}

/**
 * Jaw opening from loudness, relative to the clip's own loud parts (its 95th percentile), so a quiet
 * clip and a loud one both move the mouth fully; under a sixth of that is closed.
 */
export function jawFromLoudness(rms: Float32Array): Float32Array {
  const sorted = Array.from(rms).sort((a, b) => a - b);
  const ref = Math.max(1e-4, sorted[Math.floor(sorted.length * 0.95)] ?? 0);
  const out = new Float32Array(rms.length);
  for (let i = 0; i < rms.length; i++) {
    const r = rms[i] / ref;
    out[i] = r < 0.16 ? 0 : Math.min(1, (r - 0.16) / 0.84) ** 0.8;
  }
  return out;
}

/** Costs from loudness alone: quiet frames are silence; voiced frames favour no shape over another. */
export function envelopeCosts(rms: Float32Array): Float32Array[] {
  const sorted = Array.from(rms).sort((a, b) => a - b);
  const ref = Math.max(1e-4, sorted[Math.floor(sorted.length * 0.95)] ?? 0);
  return Array.from(rms, (r) => {
    const c = new Float32Array(VISEME_NAMES.length);
    const quiet = r / ref < 0.12;
    for (let v = 0; v < c.length; v++) c[v] = v === SIL ? (quiet ? 0 : 6) : quiet ? 12 : 1;
    return c;
  });
}

/*
 * WHAT LOUDNESS SAYS ABOUT THE MOUTH. The phoneme listener ignores near-silent frames, and a p, b or
 * m is mostly near-silence: the lips are shut. Left alone, every shape costs the same there and the
 * aligner had no reason to put a closure in the quiet — it sealed her lips over loud vowels instead.
 * So, per frame, against the clip's own level: a sealed lip is cheap in the quiet and dear in the
 * loud; an open vowel is dear in near-silence; tongue stops (t, d, k) and fricatives sit between.
 */
const SEALED = new Set(["PP"]);
const STOPS = new Set(["DD", "kk", "nn", "TH"]);
const FRICATIVES = new Set(["FF", "SS", "CH"]);
const VOWELS = new Set(["aa", "E", "I", "O", "U", "RR"]);

export function withLoudnessPriors(costs: ArrayLike<number>[], rms: Float32Array): Float32Array[] {
  const sorted = Array.from(rms).sort((a, b) => a - b);
  const ref = Math.max(1e-4, sorted[Math.floor(sorted.length * 0.95)] ?? 0);
  return Array.from(costs, (c, f) => {
    const r = Math.min(1.2, (rms[f] ?? 0) / ref);
    const loud = Math.min(1, r / 0.55); // 0 silent … 1 a full vowel
    const out = new Float32Array(VISEME_NAMES.length);
    for (let v = 0; v < out.length; v++) {
      const name = VISEME_NAMES[v];
      let x = c[v] ?? 20;
      if (SEALED.has(name)) x += 22 * loud - 6 * (1 - loud);
      else if (STOPS.has(name)) x += 8 * loud;
      else if (FRICATIVES.has(name)) x += 4 * Math.abs(loud - 0.45);
      else if (VOWELS.has(name)) x += 14 * Math.max(0, 0.35 - r) / 0.35;
      else if (name === "sil") x += 30 * Math.min(1, r / 0.25);
      out[v] = Math.max(0, x);
    }
    return out;
  });
}

/** Fit the sentence's units to the frames and turn the segmentation into per-frame shapes. */
export function alignUnits(units: Unit[], costs: ArrayLike<number>[]): VisemeWeights[] {
  const aligner = new Aligner();
  aligner.addUnits(units);
  aligner.addFrames(costs);
  return weightsFromSegments(aligner.segments(true), costs.length);
}

/** The units of a whole sentence: every word's shapes, the pauses its punctuation promises. */
export function sentenceUnits(words: Array<{ word: string; visemes: string[]; durations: number[] }>): Unit[] {
  const units: Unit[] = [];
  words.forEach((w, i) => units.push(...unitsForWord(w.visemes, w.durations, 5, true, i < words.length - 1 ? pauseAfterWord(w.word) : "none")));
  // The clip ends in silence after its last word.
  units.push({ viseme: "sil", minFrames: 1, expectFrames: 4, maxFrames: 400, optional: true });
  return units;
}

/** Decode a clip to mono samples at 24 kHz (the narration's own rate). */
async function decode(blob: Blob): Promise<{ samples: Float32Array; sampleRate: number } | null> {
  if (typeof OfflineAudioContext === "undefined") return null;
  try {
    const ctx = new OfflineAudioContext(1, 1, 24000);
    const buffer = await ctx.decodeAudioData(await blob.arrayBuffer());
    return { samples: buffer.getChannelData(0), sampleRate: buffer.sampleRate };
  } catch (error) {
    console.warn("[mouth] narration clip could not be decoded:", error);
    return null;
  }
}

export async function prepareClipLipTrack(blob: Blob, text: string): Promise<ClipLipTrack | null> {
  const [audio, rules] = await Promise.all([decode(blob), loadLipsyncRules()]);
  if (!audio || audio.samples.length === 0) return null;
  const rms = frameLoudness(audio.samples, audio.sampleRate);
  if (rms.length === 0) return null;
  const open = jawFromLoudness(rms);
  const duration = audio.samples.length / audio.sampleRate;
  const words = rules ? wordsOf(rules, text) : [];
  if (words.length === 0) return { hopS: HOP_S, weights: Array.from(open, () => ({})), open, duration, method: "envelope" };
  const units = sentenceUnits(words);
  const heard = await analyseVisemeCosts(audio.samples, audio.sampleRate);
  // The listener's frames and the loudness frames are the same framing; trust the shorter.
  const costs = withLoudnessPriors(heard && heard.length ? heard.slice(0, rms.length) : envelopeCosts(rms), rms);
  const weights = alignUnits(units, costs);
  return { hopS: HOP_S, weights, open: open.slice(0, weights.length), duration, method: heard ? "aligned" : "envelope" };
}

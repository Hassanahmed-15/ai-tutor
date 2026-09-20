/**
 * WHOSE VOICE IS THIS? — the speaker layer of the voice gate.
 *
 * The gate needs one thing from this module: given a voiced frame, is it plausibly the student?
 * That question is behind an interface so the answer can improve without the gate changing. What
 * ships today is a HEURISTIC voiceprint, and it is honest about its limits:
 *
 *   - It enrols from the student's own confirmed turns (the gate only feeds it frames from
 *     utterances the semantic layer accepted), so nobody types anything and nothing is stored.
 *   - It matches on pitch range, timbre shape and spectral centroid. That separates two clearly
 *     different voices — a 130 Hz speaker from a 210 Hz one — reliably, and two similar voices
 *     poorly. It is a strong filter against "someone else in the room", not biometric proof.
 *   - A neural embedding (a d-vector via onnxruntime-web) would do better on similar voices; it
 *     can implement the same `SpeakerVerifier` and be dropped in. Nothing else would change.
 *
 * Everything here is level-independent by construction, because the browser's automatic gain
 * control rewrites absolute level continuously and any profile built on loudness drifts within
 * minutes. Pitch and spectral SHAPE survive AGC; that is why they were chosen.
 */
import { BAND_COUNT, type VoiceFrameFeatures } from "./features";

export type SpeakerVerdict = "student" | "other" | "unknown";

export interface SpeakerMatch {
  /** 0..1, higher is more like the enrolled student. */
  similarity: number;
  verdict: SpeakerVerdict;
  /** Why, for the decision trail. */
  reason: string;
}

export interface SpeakerVerifier {
  /** Learn from a frame the gate has confirmed came from the student. */
  enrol(features: VoiceFrameFeatures): void;
  /** True once there is enough enrolled speech to judge anyone. */
  readonly enrolled: boolean;
  /** Voiced frames enrolled so far. */
  readonly enrolledFrames: number;
  match(features: VoiceFrameFeatures): SpeakerMatch;
  reset(): void;
}

export interface VoiceprintConfig {
  /** Voiced frames needed before the profile is trusted. 40 × 40 ms = 1.6 s of actual voicing. */
  minEnrolFrames: number;
  /** Frames kept for pitch statistics; older ones are forgotten so the profile can drift with the voice. */
  pitchMemory: number;
  /** Similarity at or above which a frame is called the student. */
  studentThreshold: number;
  /** Similarity at or below which a frame is called someone else. Between the two is "unknown". */
  otherThreshold: number;
  /** Only frames at least this voiced are used for enrolment or matching. */
  minVoicing: number;
}

export const DEFAULT_VOICEPRINT_CONFIG: VoiceprintConfig = {
  minEnrolFrames: 40,
  pitchMemory: 600,
  studentThreshold: 0.62,
  otherThreshold: 0.42,
  minVoicing: 0.5,
};

const EMA = 0.03;

function median(sorted: number[]): number {
  const m = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[m] : (sorted[m - 1] + sorted[m]) / 2;
}

export class HeuristicVoiceprint implements SpeakerVerifier {
  private readonly config: VoiceprintConfig;
  private pitches: number[] = [];
  private sortedPitches: number[] | null = null;
  private timbre = new Float32Array(BAND_COUNT);
  private centroidMean = 0;
  private centroidVar = 0;
  private frames = 0;

  constructor(config: Partial<VoiceprintConfig> = {}) {
    this.config = { ...DEFAULT_VOICEPRINT_CONFIG, ...config };
  }

  get enrolled(): boolean {
    return this.frames >= this.config.minEnrolFrames;
  }

  get enrolledFrames(): number {
    return this.frames;
  }

  /**
   * Voiced AND in the speech band. Voicing alone is not enough: a fan's 120 Hz harmonic is
   * perfectly periodic and would enrol as a very calm student. The band ratio is the same test the
   * noise gate uses, applied here so hum can never become the profile.
   */
  private usable(features: VoiceFrameFeatures): boolean {
    return features.f0 !== null && features.voicing >= this.config.minVoicing && features.bandRatio >= 0.3;
  }

  enrol(features: VoiceFrameFeatures): void {
    if (!this.usable(features)) return;
    this.pitches.push(features.f0 as number);
    if (this.pitches.length > this.config.pitchMemory) this.pitches.shift();
    this.sortedPitches = null;

    if (this.frames === 0) {
      this.timbre.set(features.bands);
      this.centroidMean = features.centroid;
      this.centroidVar = 200 * 200;
    } else {
      for (let b = 0; b < BAND_COUNT; b++) this.timbre[b] += EMA * (features.bands[b] - this.timbre[b]);
      const delta = features.centroid - this.centroidMean;
      this.centroidMean += EMA * delta;
      this.centroidVar += EMA * (delta * delta - this.centroidVar);
    }
    this.frames += 1;
  }

  match(features: VoiceFrameFeatures): SpeakerMatch {
    if (!this.enrolled) return { similarity: 0.5, verdict: "unknown", reason: "not enrolled yet" };
    if (!this.usable(features)) {
      return { similarity: 0.5, verdict: "unknown", reason: "unvoiced or out-of-band frame" };
    }

    /*
     * PITCH. Compared in log space against the enrolled median with the enrolled spread as the
     * unit, so a naturally wide-ranging voice is not penalised for being expressive. A voice a
     * full musical fifth away (×1.5) scores near zero on this term whatever its spread.
     */
    if (!this.sortedPitches) this.sortedPitches = [...this.pitches].sort((a, b) => a - b);
    const sorted = this.sortedPitches;
    const med = median(sorted);
    const p20 = sorted[Math.floor(sorted.length * 0.2)];
    const p80 = sorted[Math.floor(sorted.length * 0.8)];
    const spread = Math.max(0.12, Math.log(p80 / p20) / 2); // half the 20-80 range, floor ≈ 12%
    const pitchDistance = Math.abs(Math.log((features.f0 as number) / med)) / spread; // in "spreads"
    const pitchScore = Math.max(0, 1 - pitchDistance / 3);

    /* TIMBRE. Cosine similarity of the mean-removed band shape. */
    let dot = 0;
    let na = 0;
    let nb = 0;
    for (let b = 0; b < BAND_COUNT; b++) {
      dot += this.timbre[b] * features.bands[b];
      na += this.timbre[b] * this.timbre[b];
      nb += features.bands[b] * features.bands[b];
    }
    const timbreScore = na > 0 && nb > 0 ? Math.max(0, (dot / Math.sqrt(na * nb) + 1) / 2) : 0.5;

    /* CENTROID. z-score against the enrolled distribution, softened. */
    const z = Math.abs(features.centroid - this.centroidMean) / Math.sqrt(Math.max(this.centroidVar, 100 * 100));
    const centroidScore = Math.max(0, 1 - z / 3);

    const similarity = pitchScore * 0.5 + timbreScore * 0.35 + centroidScore * 0.15;
    const verdict: SpeakerVerdict =
      similarity >= this.config.studentThreshold ? "student" : similarity <= this.config.otherThreshold ? "other" : "unknown";
    return {
      similarity,
      verdict,
      reason: `pitch ${(features.f0 as number).toFixed(0)}Hz vs ${med.toFixed(0)}Hz (${pitchScore.toFixed(2)}), timbre ${timbreScore.toFixed(2)}, centroid ${centroidScore.toFixed(2)}`,
    };
  }

  reset(): void {
    this.pitches = [];
    this.sortedPitches = null;
    this.timbre = new Float32Array(BAND_COUNT);
    this.centroidMean = 0;
    this.centroidVar = 0;
    this.frames = 0;
  }
}

/** A verifier that never has an opinion — for modes that opt out, and for tests of the gate alone. */
export class NoSpeakerVerifier implements SpeakerVerifier {
  enrol(): void {}
  readonly enrolled = false;
  readonly enrolledFrames = 0;
  match(): SpeakerMatch {
    return { similarity: 0.5, verdict: "unknown", reason: "speaker verification disabled" };
  }
  reset(): void {}
}

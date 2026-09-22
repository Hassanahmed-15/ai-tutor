/**
 * WHOSE VOICE IS THIS? — the speaker layer. Ported from production (lib/voice/speakerProfile.ts).
 *
 * Heuristic voiceprint: enrolled from the student's own accepted turns, matched on pitch range,
 * timbre shape and spectral centroid — all level-independent, because the browser's AGC rewrites
 * absolute level continuously. It separates clearly different voices well and similar voices
 * poorly; it is a strong filter against "someone else in the room", not biometric proof. The
 * interface is what matters: a neural embedding can replace it without the arbiter changing.
 */
import { BAND_COUNT, type VoiceFrameFeatures } from "./acoustics";

export type SpeakerVerdict = "student" | "other" | "unknown";

export interface SpeakerMatch {
  similarity: number;
  verdict: SpeakerVerdict;
  reason: string;
}

export interface SpeakerVerifier {
  enrol(features: VoiceFrameFeatures): void;
  readonly enrolled: boolean;
  readonly enrolledFrames: number;
  match(features: VoiceFrameFeatures): SpeakerMatch;
  reset(): void;
}

export interface VoiceprintConfig {
  minEnrolFrames: number;
  pitchMemory: number;
  studentThreshold: number;
  otherThreshold: number;
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
    if (!this.usable(features)) return { similarity: 0.5, verdict: "unknown", reason: "unvoiced or out-of-band frame" };
    if (!this.sortedPitches) this.sortedPitches = [...this.pitches].sort((a, b) => a - b);
    const sorted = this.sortedPitches;
    const med = median(sorted);
    const p20 = sorted[Math.floor(sorted.length * 0.2)];
    const p80 = sorted[Math.floor(sorted.length * 0.8)];
    const spread = Math.max(0.12, Math.log(p80 / p20) / 2);
    const pitchDistance = Math.abs(Math.log((features.f0 as number) / med)) / spread;
    const pitchScore = Math.max(0, 1 - pitchDistance / 3);
    let dot = 0;
    let na = 0;
    let nb = 0;
    for (let b = 0; b < BAND_COUNT; b++) {
      dot += this.timbre[b] * features.bands[b];
      na += this.timbre[b] * this.timbre[b];
      nb += features.bands[b] * features.bands[b];
    }
    const timbreScore = na > 0 && nb > 0 ? Math.max(0, (dot / Math.sqrt(na * nb) + 1) / 2) : 0.5;
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

export class NoSpeakerVerifier implements SpeakerVerifier {
  enrol(): void {}
  readonly enrolled = false;
  readonly enrolledFrames = 0;
  match(): SpeakerMatch {
    return { similarity: 0.5, verdict: "unknown", reason: "speaker verification disabled" };
  }
  reset(): void {}
}

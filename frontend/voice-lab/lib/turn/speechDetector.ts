/**
 * IS THIS FRAME SPEECH? — one answer per 20 ms, from the best evidence available.
 *
 * Two sources, one interface. When the Silero neural VAD is loaded (lib/turn/sileroVad.ts, browser
 * only) its probability is the primary judgement — it was trained on real speech in real rooms and
 * answers the question directly. When it is not (model still downloading, WASM blocked, or the pure
 * test harness), the acoustic heuristics decide: tonal, in the speech band, not hiss, above the
 * floor. Either way the STEADINESS test applies on top: a chord, a hum or a held tone is periodic
 * and in-band and, over a single window, indistinguishable from a vowel; over 160 ms it is not,
 * because speech is never steady — its loudness pulses with every syllable and its pitch wanders.
 *
 * While the tutor is audible the bar rises (the microphone hears the speakers), and for a short
 * echo guard after she stops, so her own tail cannot open a turn.
 *
 * Production's Silero constants are load-bearing and copied exactly: 576-sample frames (512 makes
 * the model report ~0.001 for clear speech, silently) and a 0.35 threshold (speech scores 0.38-0.47
 * on this model; the documented 0.5 rejects every word while looking healthy).
 */
import { ACOUSTICS, analyzeVoiceFrame, isVoiceLike, voiceConfidence, type VoiceFrameFeatures } from "./acoustics";

export interface DetectorConfig {
  vadThreshold: number;
  vadThresholdWhileTutorSpeaking: number;
  minConfidence: number;
  minConfidenceWhileTutorSpeaking: number;
  minRms: number;
  echoGuardMs: number;
  steadyToneWindows: number;
}

export const DEFAULT_DETECTOR_CONFIG: DetectorConfig = {
  vadThreshold: 0.35,
  vadThresholdWhileTutorSpeaking: 0.5,
  minConfidence: 0.45,
  minConfidenceWhileTutorSpeaking: 0.7,
  minRms: ACOUSTICS.minRms,
  echoGuardMs: 250,
  steadyToneWindows: 8,
};

export interface DetectorInput {
  /** A 40 ms window (this frame and the previous one): pitch needs two periods. */
  window: Float32Array;
  /** Silero's probability for the latest frame, or null when the neural VAD is unavailable. */
  vadProbability: number | null;
  tutorSpeaking: boolean;
  /** Milliseconds since the tutor's audio was last audible; Infinity if never. */
  msSinceTutorAudible: number;
}

export interface DetectorVerdict {
  speech: boolean;
  /** Silero's probability, or the heuristic confidence when Silero is unavailable. */
  probability: number;
  confidence: number;
  features: VoiceFrameFeatures;
  source: "silero" | "heuristic";
  steadyTone: boolean;
  guarded: boolean;
  reason: string;
}

export class SpeechDetector {
  readonly config: DetectorConfig;
  private recentF0: number[] = [];
  private recentRms: number[] = [];

  constructor(config: Partial<DetectorConfig> = {}) {
    this.config = { ...DEFAULT_DETECTOR_CONFIG, ...config };
  }

  judge(input: DetectorInput): DetectorVerdict {
    const features = analyzeVoiceFrame(input.window, 16_000);
    const confidence = voiceConfidence(features);
    const steadyTone = this.isSteadyTone(features);
    const guarded = input.tutorSpeaking || input.msSinceTutorAudible < this.config.echoGuardMs;
    const loudEnough = features.rms >= this.config.minRms;

    if (input.vadProbability !== null) {
      const threshold = guarded ? this.config.vadThresholdWhileTutorSpeaking : this.config.vadThreshold;
      const passes = input.vadProbability >= threshold;
      const speech = passes && loudEnough && !steadyTone;
      const reason = !passes
        ? `silero ${input.vadProbability.toFixed(2)} < ${threshold}${guarded ? " (guarded)" : ""}`
        : !loudEnough
          ? `below floor (rms ${features.rms.toFixed(3)})`
          : steadyTone
            ? "periodic but unmodulated — a tone, not a voice"
            : `silero ${input.vadProbability.toFixed(2)}`;
      return { speech, probability: input.vadProbability, confidence, features, source: "silero", steadyTone, guarded, reason };
    }

    const floor = guarded ? this.config.minConfidenceWhileTutorSpeaking : this.config.minConfidence;
    const voiceLike = isVoiceLike(features);
    const speech = voiceLike && confidence >= floor && loudEnough && !steadyTone;
    const reason = !voiceLike
      ? `not voice-like (flat ${features.flatness.toFixed(2)}, band ${features.bandRatio.toFixed(2)}, zcr ${features.zcr.toFixed(2)})`
      : confidence < floor
        ? `confidence ${confidence.toFixed(2)} < ${floor}${guarded ? " (guarded)" : ""}`
        : !loudEnough
          ? `below floor (rms ${features.rms.toFixed(3)})`
          : steadyTone
            ? "periodic but unmodulated — a tone, not a voice"
            : `confidence ${confidence.toFixed(2)}`;
    return { speech, probability: confidence, confidence, features, source: "heuristic", steadyTone, guarded, reason };
  }

  private isSteadyTone(features: VoiceFrameFeatures): boolean {
    if (features.f0 !== null && features.voicing >= 0.5) {
      this.recentF0.push(features.f0);
      this.recentRms.push(features.rms);
      if (this.recentF0.length > this.config.steadyToneWindows) {
        this.recentF0.shift();
        this.recentRms.shift();
      }
    }
    if (this.recentF0.length < this.config.steadyToneWindows) return false;
    const cv = (values: number[]) => {
      const mean = values.reduce((a, b) => a + b, 0) / values.length;
      const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length;
      return mean > 0 ? Math.sqrt(variance) / mean : 0;
    };
    // Real speech: pitch CV well over 1% and loudness CV well over 10% across 160 ms.
    return cv(this.recentF0) < 0.006 && cv(this.recentRms) < 0.08;
  }

  reset(): void {
    this.recentF0 = [];
    this.recentRms = [];
  }
}

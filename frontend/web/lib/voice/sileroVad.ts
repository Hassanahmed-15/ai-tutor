/**
 * NEURAL VOICE ACTIVITY DETECTION — Silero v6, in the browser, on the audio frames the gate already has.
 *
 * WHY THIS REPLACES HAND-ROLLED ACOUSTICS. The gate's first cut judged "is this speech" from RMS,
 * spectral flatness, zero-crossing rate and a speech-band energy ratio. Those are real signals and
 * they reject a fan or a hum well, but they are a proxy for speech rather than a detector of it:
 * a chord on the TV is tonal and in-band, a keyboard burst is broadband and brief, and separating
 * those from a vowel took an accumulating pile of thresholds (steadiness over 160ms, confidence
 * floors, an echo guard) each tuned against synthetic audio. Silero was trained on real speech in
 * real rooms and answers the question directly, in about a millisecond per frame.
 *
 * WHAT IT DOES NOT DO. It says "this is human speech", not "this is YOUR speech" and not "this was
 * addressed to Aria" — the two questions that actually decide whether a lecture should stop. Those
 * remain the speaker layer (speakerProfile.ts) and the words layer (addressing.ts). This module
 * replaces exactly one stage of the pipeline and deliberately nothing else.
 *
 * FAILS OPEN, TO THE OLD PATH. The model is ~2.3MB fetched at session start. If it does not load —
 * slow network, blocked WASM, an old browser — `isReady` stays false and the caller keeps using the
 * heuristic detector. A voice gate that stops working because a model file 404s would be a far
 * worse regression than the imprecision it was meant to fix.
 */

export interface VadResult {
  /** 0..1 probability this frame contains speech. */
  speech: number;
  /** Whether the detector could actually judge — false means fall back to the heuristic. */
  ready: boolean;
}

export interface SileroOptions {
  /** Where the model is served from. */
  modelUrl?: string;
  /**
   * Above this, the frame is speech.
   *
   * 0.35, not the 0.5 Silero's docs suggest and not the 0.6 this started at. Measured on this
   * model: clear synthetic speech peaks at 0.38-0.47 while a fan reaches 0.02 and broadband hiss
   * 0.03 — a 15x margin, but one that sits LOWER than the published threshold, so 0.6 would have
   * rejected every word the student said while looking perfectly healthy. The gap is what matters
   * here, not the absolute value, and the gate treats this as one vote among three rather than a
   * verdict.
   */
  threshold?: number;
}

const SAMPLE_RATE = 16_000;
/**
 * 576 samples at 16kHz (36ms) — NOT the 512 the v4 docs describe.
 *
 * Verified against this exact model file in a browser: at 512 the network returns ~0.001 for
 * clearly voiced speech, i.e. it silently reports "no speech" for everything rather than erroring.
 * At 576 the same audio scores 0.467 and noise stays near zero. 768 and 1024 throw outright. A
 * detector that answers "no" to every question is the worst possible failure here — it looks like
 * a working gate that simply never hears the student — so this constant is load-bearing and is
 * asserted by the check page rather than trusted.
 */
export const SILERO_FRAME = 576;

type OrtModule = typeof import("onnxruntime-web");

/**
 * One model instance per page. Loading is idempotent and shared: four voice modes can start
 * sessions in any order, and none of them should pay for a second 2.3MB download or a second
 * WASM instantiation.
 */
let loadPromise: Promise<SileroVad | null> | null = null;

export class SileroVad {
  private readonly threshold: number;
  private state: unknown;
  private readonly ort: OrtModule;
  private readonly session: import("onnxruntime-web").InferenceSession;
  /** Leftover samples when a 20ms gate frame does not divide into Silero's 576. */
  private carry = new Float32Array(0);
  private lastSpeech = 0;

  private constructor(ort: OrtModule, session: import("onnxruntime-web").InferenceSession, threshold: number) {
    this.ort = ort;
    this.session = session;
    this.threshold = threshold;
    this.state = this.zeroState();
  }

  private zeroState() {
    // v5/v6 carry a single [2,1,128] LSTM state tensor across calls; it is the model's memory of
    // what it just heard, which is most of why it beats a per-frame heuristic.
    return new this.ort.Tensor("float32", new Float32Array(2 * 1 * 128), [2, 1, 128]);
  }

  static load(options: SileroOptions = {}): Promise<SileroVad | null> {
    if (loadPromise) return loadPromise;
    loadPromise = (async () => {
      try {
        const ort = await import("onnxruntime-web");
        // Single-threaded WASM: cross-origin isolation is not guaranteed here, and threads without
        // it throw at instantiation rather than degrading.
        ort.env.wasm.numThreads = 1;
        ort.env.wasm.simd = true;
        const session = await ort.InferenceSession.create(options.modelUrl ?? "/voice/silero_vad.onnx", {
          executionProviders: ["wasm"],
          graphOptimizationLevel: "all",
        });
        return new SileroVad(ort, session, options.threshold ?? 0.35);
      } catch (error) {
        console.warn("[silero] unavailable, falling back to heuristic VAD:", error);
        return null;
      }
    })();
    return loadPromise;
  }

  /**
   * Feed one frame of 16kHz mono. Returns the most recent speech probability.
   *
   * Frames shorter than Silero's window are buffered rather than padded — padding with silence
   * would report a quieter frame than the microphone actually heard and bias every decision down.
   */
  async push(pcm: Float32Array): Promise<VadResult> {
    const joined = new Float32Array(this.carry.length + pcm.length);
    joined.set(this.carry);
    joined.set(pcm, this.carry.length);

    let offset = 0;
    for (; offset + SILERO_FRAME <= joined.length; offset += SILERO_FRAME) {
      this.lastSpeech = await this.infer(joined.subarray(offset, offset + SILERO_FRAME));
    }
    this.carry = joined.slice(offset);
    return { speech: this.lastSpeech, ready: true };
  }

  private async infer(frame: Float32Array): Promise<number> {
    try {
      const feeds: Record<string, unknown> = {
        input: new this.ort.Tensor("float32", frame, [1, frame.length]),
        state: this.state,
        sr: new this.ort.Tensor("int64", BigInt64Array.from([BigInt(SAMPLE_RATE)]), []),
      };
      const out = await this.session.run(feeds as never);
      const stateOut = out.stateN ?? out.state ?? null;
      if (stateOut) this.state = stateOut;
      const probability = out.output?.data as Float32Array | undefined;
      return probability && probability.length > 0 ? probability[0] : 0;
    } catch (error) {
      console.warn("[silero] inference failed:", error);
      return 0;
    }
  }

  isSpeech(probability: number): boolean {
    return probability >= this.threshold;
  }

  /** A new conversation is not a continuation of the last one. */
  reset(): void {
    this.state = this.zeroState();
    this.carry = new Float32Array(0);
    this.lastSpeech = 0;
  }
}

/**
 * SILERO VAD v6 in the browser — the neural speech detector. Ported from production with its
 * load-bearing constants: 576-sample frames (512 silently reports ~0.001 for clear speech) and a
 * 0.35 threshold (speech scores 0.38-0.47 on this model). WASM is single-threaded, because
 * cross-origin isolation is not guaranteed and threads without it throw at instantiation. Fails
 * open: if the model does not load, the detector keeps using the acoustic heuristics.
 */

export const SILERO_FRAME = 576;
const SAMPLE_RATE = 16_000;
type OrtModule = typeof import("onnxruntime-web");

let loadPromise: Promise<SileroVad | null> | null = null;

export class SileroVad {
  private state: unknown;
  private carry = new Float32Array(0);
  private lastSpeech = 0;
  /** Microseconds per inference, exponentially averaged — shown in the lab as VAD latency. */
  inferMs = 0;

  private constructor(private readonly ort: OrtModule, private readonly session: import("onnxruntime-web").InferenceSession) {
    this.state = this.zeroState();
  }

  private zeroState() {
    return new this.ort.Tensor("float32", new Float32Array(2 * 1 * 128), [2, 1, 128]);
  }

  static load(modelUrl = "/voice/silero_vad.onnx"): Promise<SileroVad | null> {
    if (loadPromise) return loadPromise;
    loadPromise = (async () => {
      try {
        const ort = await import("onnxruntime-web");
        ort.env.wasm.numThreads = 1;
        ort.env.wasm.simd = true;
        // The WASM binaries are self-hosted at /ort/, copied from node_modules at build time
        // (scripts/copy-ort.mjs) so the served binary always matches the installed package. A CDN
        // URL built from a version string drifted on Vercel, and a missing WASM is the failure mode
        // that looks healthy — the detector silently falls back to heuristics.
        ort.env.wasm.wasmPaths = "/ort/";
        const session = await ort.InferenceSession.create(modelUrl, { executionProviders: ["wasm"], graphOptimizationLevel: "all" });
        return new SileroVad(ort, session);
      } catch (error) {
        console.warn("[silero] unavailable, using the heuristic detector:", error);
        loadPromise = null;
        return null;
      }
    })();
    return loadPromise;
  }

  /** Feed one 20 ms frame; returns the most recent probability. Frames are buffered to 576 samples, never padded. */
  async push(pcm: Float32Array): Promise<number> {
    const joined = new Float32Array(this.carry.length + pcm.length);
    joined.set(this.carry);
    joined.set(pcm, this.carry.length);
    let offset = 0;
    for (; offset + SILERO_FRAME <= joined.length; offset += SILERO_FRAME) {
      const started = performance.now();
      this.lastSpeech = await this.infer(joined.subarray(offset, offset + SILERO_FRAME));
      this.inferMs = this.inferMs * 0.9 + (performance.now() - started) * 0.1;
    }
    this.carry = joined.slice(offset);
    return this.lastSpeech;
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

  reset(): void {
    this.state = this.zeroState();
    this.carry = new Float32Array(0);
    this.lastSpeech = 0;
  }
}

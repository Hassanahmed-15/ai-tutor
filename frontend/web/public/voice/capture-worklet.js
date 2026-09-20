/**
 * MICROPHONE CAPTURE, OFF THE MAIN THREAD, IN 20 ms FRAMES.
 *
 * Replaces `createScriptProcessor(4096, 1, 1)`, which had two costs that matter for a voice gate:
 *
 *   1. LATENCY. 4096 samples at 48 kHz is 85 ms per callback, so the gate could not know a sound
 *      had started until up to 85 ms after it had — and every stage of the gate stacks on top of
 *      that. A 20 ms frame is the granularity every VAD in the field works at, and it is what lets a
 *      genuine barge-in cut the tutor's audio before the student has finished their first word.
 *
 *   2. JANK. ScriptProcessor runs on the main thread, so a heavy React render delayed audio delivery
 *      and a burst of frames arrived together. The worklet runs on the audio rendering thread; its
 *      timing is the audio clock's, not the UI's.
 *
 * Resampling happens here rather than in the main thread for the same reason: the gate wants
 * 16 kHz mono (what Gemini takes, and what the feature extraction is tuned for) and doing that
 * per-frame on the audio thread keeps the main thread's work to feature math on 320 floats.
 *
 * Output: `port.postMessage({ type: "frame", pcm: Float32Array(320), t: <audio-clock seconds> })`
 * — exactly one 20 ms frame per message, transferred not copied.
 *
 * This file is served statically from /voice/capture-worklet.js and loaded with
 * `audioContext.audioWorklet.addModule(...)`. It is plain JS on purpose: worklets cannot import
 * the app's modules, and it must not depend on the bundler.
 */

const TARGET_RATE = 16_000;
const FRAME_SAMPLES = 320; // 20 ms at 16 kHz

class AriaCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    // `sampleRate` is a global in AudioWorkletGlobalScope: the context's real rate (44.1k/48k).
    this.step = sampleRate / TARGET_RATE;
    this.phase = 0;
    this.frame = new Float32Array(FRAME_SAMPLES);
    this.filled = 0;
    this.lastInput = 0;
    this.enabled = true;
    this.port.onmessage = (event) => {
      if (event.data && event.data.type === "enable") this.enabled = Boolean(event.data.value);
    };
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || !input[0]) return true;
    const channel = input[0];
    if (!this.enabled) return true;

    /*
     * Linear-interpolating decimator. Not a windowed-sinc resampler — that would be better
     * anti-aliasing, but speech energy above 8 kHz is small and the browser's own noise
     * suppression has already low-passed the signal; the gate's features (RMS, spectral flatness,
     * band ratios, pitch) are not sensitive to the residual. Latency and simplicity win here.
     */
    let phase = this.phase;
    let prev = this.lastInput;
    for (let i = 0; i < channel.length; i++) {
      const current = channel[i];
      while (phase < 1) {
        this.frame[this.filled++] = prev + (current - prev) * phase;
        phase += this.step;
        if (this.filled === FRAME_SAMPLES) {
          const out = this.frame;
          this.frame = new Float32Array(FRAME_SAMPLES);
          this.filled = 0;
          this.port.postMessage({ type: "frame", pcm: out, t: currentTime }, [out.buffer]);
        }
      }
      phase -= 1;
      prev = current;
    }
    this.phase = phase;
    this.lastInput = prev;
    return true;
  }
}

registerProcessor("aria-capture", AriaCaptureProcessor);

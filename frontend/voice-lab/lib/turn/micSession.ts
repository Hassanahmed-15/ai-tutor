/**
 * THE MICROPHONE, KEPT ALIVE — capture with health monitoring and automatic reconnection.
 *
 * A voice session dies in ways the app never sees: the track ends when a USB headset is unplugged,
 * the AudioContext is suspended when the tab loses focus or iOS interrupts audio, the OS mutes the
 * track, a device change swaps the default input. In every case the frames simply stop and the
 * gate looks healthy while hearing nothing. This module treats "frames are arriving" as the only
 * definition of connected, watches for it directly, and reconnects with backoff — reporting every
 * state change so the debug console shows exactly what happened and when.
 *
 * Frames: 20 ms of 16 kHz mono, delivered as Float32Array, resampled from the device rate.
 * Capture runs on an AudioWorklet when available and falls back to ScriptProcessor.
 */

export type MicState = "idle" | "requesting" | "connected" | "stalled" | "reconnecting" | "denied" | "failed";

export interface MicSessionCallbacks {
  onFrame: (pcm: Float32Array, at: number) => void;
  onState: (state: MicState, detail: string) => void;
  onLevel?: (rms: number) => void;
}

export interface MicSessionOptions {
  /** Frames not arriving for this long marks the session stalled and triggers a reconnect. */
  stallMs?: number;
  maxReconnects?: number;
  /** Mix a synthetic bed under the microphone, for stress tests. Returns 20 ms at 16 kHz. */
  bed?: () => Float32Array | null;
}

const TARGET_RATE = 16_000;
const FRAME = 320;

const WORKLET_SOURCE = `
class Capture extends AudioWorkletProcessor {
  constructor() { super(); this.buffer = []; }
  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (channel) this.port.postMessage(channel.slice(0));
    return true;
  }
}
registerProcessor("lab-capture", Capture);
`;

export class MicSession {
  private state: MicState = "idle";
  private stream: MediaStream | null = null;
  private context: AudioContext | null = null;
  private node: AudioWorkletNode | ScriptProcessorNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private resampleCarry = new Float32Array(0);
  private frameCarry = new Float32Array(0);
  private lastFrameAt = 0;
  private watchdog: ReturnType<typeof setInterval> | null = null;
  private reconnects = 0;
  private wanted = false;
  private bedOffset = 0;
  private readonly stallMs: number;
  private readonly maxReconnects: number;

  constructor(private readonly callbacks: MicSessionCallbacks, private readonly options: MicSessionOptions = {}) {
    this.stallMs = options.stallMs ?? 1500;
    this.maxReconnects = options.maxReconnects ?? 6;
  }

  getState(): MicState {
    return this.state;
  }

  async start(): Promise<void> {
    this.wanted = true;
    this.reconnects = 0;
    await this.connect("start requested");
  }

  stop(): void {
    this.wanted = false;
    this.teardown();
    this.setState("idle", "stopped");
  }

  /** Simulate a disconnect for testing: the track ends as if the device were unplugged. */
  simulateDrop(): void {
    const track = this.stream?.getAudioTracks()[0];
    if (track) {
      track.stop();
      this.setState("stalled", "simulated device drop (track stopped)");
    }
  }

  private setState(state: MicState, detail: string): void {
    this.state = state;
    this.callbacks.onState(state, detail);
  }

  private async connect(why: string): Promise<void> {
    this.setState(this.reconnects > 0 ? "reconnecting" : "requesting", why);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: false, autoGainControl: true },
      });
      const track = stream.getAudioTracks()[0];
      track.addEventListener("ended", () => this.onLost("track ended (device removed or permission revoked)"));
      track.addEventListener("mute", () => this.callbacks.onState(this.state, "track muted by the OS"));
      track.addEventListener("unmute", () => this.callbacks.onState(this.state, "track unmuted"));
      this.stream = stream;

      const context = new AudioContext();
      this.context = context;
      context.addEventListener("statechange", () => {
        this.callbacks.onState(this.state, `AudioContext ${context.state}`);
        if (context.state === "suspended" && this.wanted) void context.resume();
      });
      const source = context.createMediaStreamSource(stream);
      this.source = source;

      let node: AudioWorkletNode | ScriptProcessorNode;
      try {
        const url = URL.createObjectURL(new Blob([WORKLET_SOURCE], { type: "application/javascript" }));
        await context.audioWorklet.addModule(url);
        const worklet = new AudioWorkletNode(context, "lab-capture", { numberOfInputs: 1, numberOfOutputs: 1, channelCount: 1 });
        worklet.port.onmessage = (event: MessageEvent<Float32Array>) => this.onChunk(event.data, context.sampleRate);
        node = worklet;
      } catch {
        const processor = context.createScriptProcessor(1024, 1, 1);
        processor.onaudioprocess = (event) => this.onChunk(event.inputBuffer.getChannelData(0).slice(0), context.sampleRate);
        node = processor;
      }
      this.node = node;
      source.connect(node);
      // Keep the graph alive without feeding the mic to the speakers.
      const sink = context.createGain();
      sink.gain.value = 0;
      node.connect(sink);
      sink.connect(context.destination);
      if (context.state !== "running") await context.resume();

      this.lastFrameAt = performance.now();
      this.startWatchdog();
      this.setState("connected", `${context.sampleRate} Hz, ${node instanceof AudioWorkletNode ? "AudioWorklet" : "ScriptProcessor"}`);
      navigator.mediaDevices.addEventListener?.("devicechange", this.onDeviceChange);
    } catch (error) {
      const name = error instanceof DOMException ? error.name : "";
      if (name === "NotAllowedError" || name === "SecurityError") {
        this.wanted = false;
        this.setState("denied", "microphone permission denied");
        return;
      }
      this.setState("failed", error instanceof Error ? error.message : "microphone unavailable");
      this.scheduleReconnect("getUserMedia failed");
    }
  }

  private onDeviceChange = () => {
    this.callbacks.onState(this.state, "audio devices changed");
  };

  private onLost(detail: string): void {
    if (!this.wanted) return;
    this.setState("stalled", detail);
    this.scheduleReconnect(detail);
  }

  private scheduleReconnect(detail: string): void {
    if (!this.wanted) return;
    if (this.reconnects >= this.maxReconnects) {
      this.setState("failed", `gave up after ${this.reconnects} reconnects: ${detail}`);
      return;
    }
    const delay = Math.min(4000, 300 * 2 ** this.reconnects);
    this.reconnects += 1;
    this.setState("reconnecting", `reconnect ${this.reconnects} in ${delay} ms — ${detail}`);
    this.teardown(false);
    setTimeout(() => {
      if (this.wanted) void this.connect(`reconnect ${this.reconnects}`);
    }, delay);
  }

  private startWatchdog(): void {
    if (this.watchdog) clearInterval(this.watchdog);
    this.watchdog = setInterval(() => {
      if (!this.wanted || this.state !== "connected") return;
      const since = performance.now() - this.lastFrameAt;
      if (since >= this.stallMs) this.onLost(`no audio frames for ${Math.round(since)} ms`);
    }, 250);
  }

  private onChunk(chunk: Float32Array, sampleRate: number): void {
    if (this.state === "reconnecting" && this.wanted) this.setState("connected", "frames resumed");
    if (this.state !== "connected") return;
    this.lastFrameAt = performance.now();
    this.reconnects = 0;
    const resampled = sampleRate === TARGET_RATE ? chunk : this.resample(chunk, sampleRate);
    let joined = new Float32Array(this.frameCarry.length + resampled.length);
    joined.set(this.frameCarry);
    joined.set(resampled, this.frameCarry.length);
    let offset = 0;
    for (; offset + FRAME <= joined.length; offset += FRAME) {
      const frame = joined.slice(offset, offset + FRAME);
      const bed = this.options.bed?.();
      if (bed) for (let i = 0; i < FRAME; i++) frame[i] += bed[i];
      this.bedOffset += 1;
      let energy = 0;
      for (let i = 0; i < FRAME; i++) energy += frame[i] * frame[i];
      this.callbacks.onLevel?.(Math.sqrt(energy / FRAME));
      this.callbacks.onFrame(frame, performance.now());
    }
    this.frameCarry = joined.slice(offset);
    joined = new Float32Array(0);
  }

  /** Linear resampling with a carried fractional position — adequate for a 16 kHz VAD input. */
  private resample(chunk: Float32Array, from: number): Float32Array {
    const input = new Float32Array(this.resampleCarry.length + chunk.length);
    input.set(this.resampleCarry);
    input.set(chunk, this.resampleCarry.length);
    const ratio = from / TARGET_RATE;
    const outLength = Math.floor((input.length - 1) / ratio);
    const out = new Float32Array(Math.max(0, outLength));
    for (let i = 0; i < out.length; i++) {
      const position = i * ratio;
      const index = Math.floor(position);
      const frac = position - index;
      out[i] = input[index] * (1 - frac) + (input[Math.min(input.length - 1, index + 1)] ?? input[index]) * frac;
    }
    const consumed = Math.floor(out.length * ratio);
    this.resampleCarry = input.slice(consumed);
    return out;
  }

  private teardown(resetState = true): void {
    if (this.watchdog) clearInterval(this.watchdog);
    this.watchdog = null;
    navigator.mediaDevices?.removeEventListener?.("devicechange", this.onDeviceChange);
    try { this.node?.disconnect(); } catch { /* already gone */ }
    try { this.source?.disconnect(); } catch { /* already gone */ }
    this.stream?.getTracks().forEach((track) => track.stop());
    void this.context?.close().catch(() => undefined);
    this.node = null;
    this.source = null;
    this.stream = null;
    this.context = null;
    this.frameCarry = new Float32Array(0);
    this.resampleCarry = new Float32Array(0);
    if (resetState) this.reconnects = 0;
  }
}

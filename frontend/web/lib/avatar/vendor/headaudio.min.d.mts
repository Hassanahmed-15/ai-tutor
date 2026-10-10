/** HeadAudio (met4citizen, MIT): audio-driven viseme detection in an audio worklet. Minified build vendored as-is. */
export class HeadAudio extends AudioWorkletNode {
  constructor(audioCtx: AudioContext, options?: { processorOptions?: Record<string, unknown>; parameterData?: Record<string, number> } | null);
  /** Oculus viseme blend-shape updates: key is e.g. "viseme_PP", value 0..1. */
  onvalue: ((key: string, value: number) => void) | null;
  onstarted: ((data: { event: string; t: number }) => void) | null;
  onended: ((data: { event: string; t: number }) => void) | null;
  loadModel(url: string, reset?: boolean): Promise<void>;
  /** Advance the viseme easing; `dt` in milliseconds. Call once per animation frame. */
  update(dt: number): void;
  start(): void;
  stop(): void;
  resetAll(): void;
}

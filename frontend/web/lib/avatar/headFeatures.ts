import { VISEME_NAMES } from "./visemes";

/**
 * THE EAR, AHEAD OF TIME. HeadAudio's worklet (lib/avatar/vendor, MIT) turns 16 ms of voice into
 * MFCC features and measures how far they sit from each of its 39 phoneme prototypes. Live, it
 * listens to the output and lags it; here the same worklet runs inside an OfflineAudioContext over
 * a chunk we hold BEFORE it plays, faster than real time (a whole sentence in ~50 ms), so the
 * aligner (lib/avatar/align.ts) has every frame's evidence while the sound is still in the future.
 *
 * Returns, per 16 ms frame, a cost for each of the 15 visemes: the least distance to any prototype
 * of that shape. Frames the worklet's gate calls silence cost nothing as `sil` and a lot as
 * anything else. Null where the browser cannot run worklets offline; callers fall back.
 */

/** 256 samples at the worklet's 16 kHz. */
export const HOP_S = 0.016;
/** The worklet's window: two hops. A frame's evidence is centred one hop after its start. */
export const WINDOW_S = 0.032;
const QUIET_COST = 20;
const RECORD_BYTES = 368;
const SIL_INDEX = VISEME_NAMES.indexOf("sil");

type Prototype = { phoneme: string; group: number; viseme: number; mu: Float32Array; sigmaInvLower: Float32Array };
let modelPromise: Promise<Prototype[] | null> | null = null;

/** The model file, decoded the way HeadAudio.loadModel decodes it: fixed 368-byte records. */
function loadModel(): Promise<Prototype[] | null> {
  modelPromise ??= (async () => {
    try {
      const res = await fetch("/headaudio/model-en-mixed.bin");
      if (!res.ok) return null;
      const bin = await res.arrayBuffer();
      const out: Prototype[] = [];
      for (let off = 0; off + RECORD_BYTES <= bin.byteLength; off += RECORD_BYTES) {
        const dv = new DataView(bin, off, 8);
        const id = dv.getUint32(0);
        const hi = id >>> 16;
        const lo = id & 0xffff;
        out.push({
          phoneme: lo === 0 ? String.fromCodePoint(hi) : String.fromCodePoint(hi, lo),
          group: dv.getUint8(5),
          viseme: dv.getUint8(7),
          // Own copies: a view over the whole file would clone the whole file on every post.
          mu: new Float32Array(new Float32Array(bin, off + 8, 12)),
          sigmaInvLower: new Float32Array(new Float32Array(bin, off + 56, 78)),
        });
      }
      return out.length ? out : null;
    } catch (error) {
      console.warn("[mouth] viseme model unavailable:", error);
      return null;
    }
  })();
  return modelPromise;
}

type VisemeEvent = { event: string; viseme?: number; t: number; distances?: ArrayLike<number> };

/**
 * Costs per frame for `samples` (any sample rate; the worklet resamples). Frame i covers
 * [i·HOP_S, i·HOP_S + WINDOW_S) of the samples; the last frame is the last full window.
 */
export async function analyseVisemeCosts(samples: Float32Array, sampleRate: number): Promise<Float32Array[] | null> {
  if (typeof OfflineAudioContext === "undefined") return null;
  const model = await loadModel();
  if (!model) return null;
  const frames = Math.floor((samples.length / sampleRate - WINDOW_S) / HOP_S) + 1;
  if (frames <= 0) return [];
  const out: Float32Array[] = [];
  for (let i = 0; i < frames; i++) {
    const c = new Float32Array(VISEME_NAMES.length).fill(QUIET_COST);
    c[SIL_INDEX] = 0;
    out.push(c);
  }
  try {
    const ctx = new OfflineAudioContext(1, samples.length, sampleRate);
    await ctx.audioWorklet.addModule("/headaudio/headworklet.min.mjs");
    const buffer = ctx.createBuffer(1, samples.length, sampleRate);
    buffer.getChannelData(0).set(samples);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    const node = new AudioWorkletNode(ctx, "headworklet", {
      numberOfInputs: 1,
      numberOfOutputs: 0,
      channelCount: 1,
      channelCountMode: "explicit",
      channelInterpretation: "speakers",
      outputChannelCount: [],
      processorOptions: { visemeEventsEnabled: true },
      // Aria's voice sits around 220 Hz (the model's default 150 never produced a closed lip).
      parameterData: { vadGateActiveDb: -46, vadGateInactiveDb: -56, speakerMeanHz: 220 },
    });
    const events: VisemeEvent[] = [];
    node.port.onmessage = (e: MessageEvent<VisemeEvent>) => {
      if (e.data?.event === "viseme") events.push(e.data);
    };
    node.port.postMessage({ event: "model", model });
    node.port.postMessage({ event: "start" });
    source.connect(node);
    source.start(0);
    // Offline rendering can finish before the port's messages reach the processor, which then
    // hears everything with no model and says nothing. A short wait lets them land (2 ms suffices).
    await new Promise((r) => setTimeout(r, 10));
    await ctx.startRendering();
    // The port delivers after rendering resolves, from another thread: poll until two quiet polls in a row.
    for (let quiet = 0, seen = 0, polls = 0; quiet < 2 && polls < 40; polls++) {
      await new Promise((r) => setTimeout(r, 5));
      quiet = events.length === seen ? quiet + 1 : 0;
      seen = events.length;
    }
    for (const e of events) {
      if (!e.distances || e.distances.length !== model.length) continue;
      const i = Math.round(e.t / HOP_S);
      if (i < 0 || i >= frames) continue;
      const c = out[i];
      c.fill(Number.POSITIVE_INFINITY);
      for (let p = 0; p < model.length; p++) {
        const v = model[p].viseme;
        if (v < 0 || v >= c.length) continue;
        const d = e.distances[p];
        if (d < c[v]) c[v] = d;
      }
      // A shape with no prototype at all is as unlikely as the worst one heard.
      let worst = 0;
      for (let v = 0; v < c.length; v++) if (c[v] !== Number.POSITIVE_INFINITY && c[v] > worst) worst = c[v];
      for (let v = 0; v < c.length; v++) if (c[v] === Number.POSITIVE_INFINITY) c[v] = worst;
    }
    return out;
  } catch (error) {
    console.warn("[mouth] offline viseme analysis unavailable:", error);
    return null;
  }
}

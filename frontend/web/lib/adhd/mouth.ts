/**
 * Live mouth shape for the teacher's voice, derived from whatever audio is currently playing.
 *
 * WHY ON-DEVICE ANALYSIS AND NOT PROVIDER VISEMES. OpenAI TTS returns audio bytes with no timing
 * data of any kind, so there is nothing to sync to. Providers that DO emit visemes (Azure's
 * `visemeReceived`, Polly's speech marks) would mean a second TTS vendor, and would still leave the
 * Gemini Live tutor silent — its replies are generated in real time, so there is no clip to analyse
 * ahead of playback. Analysing the output covers both voices with one mechanism.
 *
 * WHAT THIS IS AND IS NOT. It is not phoneme-accurate: it cannot tell "b" from "m". It gets the two
 * things people actually read as speech — the TIMING (opening on stressed syllables, closing in the
 * pauses, stopping dead at the end of a sentence) and a coarse VOWEL SHAPE (wide "ee" vs rounded
 * "oo" vs open "ah"). On a stylised cartoon face that reads as talking; a precise-but-slightly-wrong
 * mouth on a realistic face is the one that looks broken.
 *
 * A tiny module-level store rather than React state: the value changes ~60 times a second, and
 * re-rendering the whole player at that rate to move one SVG ellipse would be absurd. Components
 * subscribe and update only themselves.
 */

import { appendToScript, EMPTY_SCRIPT, expectedIndex, reconcile, type Script } from "../avatar/script";
import type { VisemeName } from "../avatar/visemes";

/** The mouth shape. Both 0-1. `open` is jaw drop, `width` is how spread vs rounded the lips are. */
export type MouthShape = { open: number; width: number };

/*
 * VISEMES, FOR A REALISTIC FACE. The three-band shape above is enough for a cartoon mouth; Aria's
 * photoreal head (components/avatar/AriaAvatar.tsx) wants to know WHICH sound it hears — lips sealed
 * on p/b/m, lower lip under the teeth on f/v, rounded for "oo", spread for "ee". HeadAudio (MIT,
 * lib/avatar/vendor) does that in an audio worklet from MFCC features, in about 50 ms, with a 14 kB
 * model, no server. It is attached to the same bus, best-effort: where worklets are unavailable or
 * the model fails to load, the shape above carries on alone and the face uses it.
 */
export type VisemeWeights = Record<string, number>;
let visemes: VisemeWeights = {};
let visemeNode: { update: (dt: number) => void; disconnect: () => void; stop?: () => void } | null = null;
let visemeOwner: MouthToken = 0;
let lastVisemeTick = 0;
const workletReady = new WeakMap<AudioContext, Promise<boolean>>();

/** The live viseme weights (HeadAudio's Oculus names without the "viseme_" prefix); empty until the model listens. */
export function visemeWeights(): VisemeWeights {
  return scripted ?? visemes;
}

/*
 * THE SCRIPT. Gemini sends the words of a reply before the audio that says them, so the mouth can
 * know what shape is due and let the listener confirm it (lib/avatar/script.ts). The voice hook
 * calls these: begin when a reply's first chunk is scheduled, append each piece of transcript,
 * extend as each chunk is scheduled (the clock is the AudioContext's), end on finish or barge-in.
 * Progress through the words = progress through the scheduled audio.
 */
type SpeechScript = { script: Script; startAt: number; endAt: number; cursor: number; pendingText: string; rules: LipsyncRules | null };
type LipsyncRules = { preProcessText: (s: string) => string; wordsToVisemes: (w: string) => { visemes: string[]; durations: number[] } };
let speech: SpeechScript | null = null;
let scripted: VisemeWeights | null = null;
/** Words that arrived before the reply's first audio (Gemini sends the transcript ahead): the reply's opening. */
let wordsAhead = "";
let rulesPromise: Promise<LipsyncRules | null> | null = null;

function loadRules(): Promise<LipsyncRules | null> {
  rulesPromise ??= import("../avatar/vendor/lipsync-en.mjs").then((m) => new m.LipsyncEn() as LipsyncRules).catch((error) => {
    console.warn("[mouth] text rules unavailable:", error);
    return null;
  });
  return rulesPromise;
}

/** A reply is starting: its first audio is scheduled at `startAt` on the context's clock. */
export function beginSpeechScript(startAt: number): void {
  speech = { script: EMPTY_SCRIPT, startAt, endAt: startAt, cursor: 0, pendingText: wordsAhead, rules: null };
  wordsAhead = "";
  scripted = null;
  void loadRules().then((rules) => {
    if (speech && rules) {
      speech.rules = rules;
      if (speech.pendingText) {
        const text = speech.pendingText;
        speech.pendingText = "";
        appendSpeechText(text);
      }
    }
  });
}

/** Words of the reply, as the transcript brings them. */
export function appendSpeechText(text: string): void {
  if (!speech) {
    // No audio yet: these words open the reply about to be heard.
    wordsAhead = `${wordsAhead} ${text}`.slice(-600);
    return;
  }
  if (!speech.rules) {
    speech.pendingText += text;
    return;
  }
  const clean = speech.rules.preProcessText(text);
  for (const word of clean.split(/\s+/)) {
    const w = word.replace(/[^A-Za-z']/g, "");
    if (!w) continue;
    const out = speech.rules.wordsToVisemes(w);
    speech.script = appendToScript(speech.script, out.visemes, out.durations);
  }
}

/** The audio of the reply now runs to `endAt` on the context's clock. */
export function extendSpeechAudio(endAt: number): void {
  if (speech && endAt > speech.endAt) speech.endAt = endAt;
}

/** For the lab: where the script is. */
export function speechScriptDebug(): { visemes: number; cursor: number; progress: number } | null {
  if (!speech) return null;
  const ctx = analyser?.context;
  const now = ctx ? ctx.currentTime : speech.startAt;
  return { visemes: speech.script.visemes.length, cursor: speech.cursor, progress: speech.endAt > speech.startAt ? Math.round(((now - speech.startAt) / (speech.endAt - speech.startAt)) * 100) / 100 : 0 };
}

/** The reply is over, or was cut off. */
export function endSpeechScript(): void {
  speech = null;
  scripted = null;
  wordsAhead = "";
}

/** The viseme the script expects at the context's `now`, reconciled with what the listener hears. */
function scriptedWeightsAt(now: number): VisemeWeights | null {
  if (!speech || speech.script.visemes.length === 0 || speech.endAt <= speech.startAt) return null;
  const progress = (now - speech.startAt) / (speech.endAt - speech.startAt);
  if (progress < 0 || progress > 1.05) return null;
  const expected = expectedIndex(speech.script, Math.min(1, progress));
  let heard: VisemeName | null = null;
  let best = 0.45; // only a confident ear may move the script
  for (const [k, v] of Object.entries(visemes)) if (k !== "sil" && v > best) { best = v; heard = k as VisemeName; }
  const r = reconcile(speech.script, speech.cursor, expected, heard);
  speech.cursor = r.cursor;
  if (!r.viseme) return null;
  // The listener's own weights when it agreed; else the script's shape at speaking strength.
  return heard === r.viseme ? visemes : { [r.viseme]: 0.65 };
}

/** Load the worklet once per context. False when the browser or the network says no. */
function ensureWorklet(ctx: AudioContext): Promise<boolean> {
  let ready = workletReady.get(ctx);
  if (!ready) {
    ready = (async () => {
      if (typeof window === "undefined" || !ctx.audioWorklet) return false;
      try {
        await ctx.audioWorklet.addModule("/headaudio/headworklet.min.mjs");
        return true;
      } catch (error) {
        console.warn("[mouth] viseme worklet unavailable:", error);
        return false;
      }
    })();
    workletReady.set(ctx, ready);
  }
  return ready;
}

/** Start listening for visemes on `source`; a token that stops owning the analyser is ignored when it resolves. */
async function attachVisemes(ctx: AudioContext, source: AudioNode, token: MouthToken): Promise<void> {
  if (!(await ensureWorklet(ctx))) return;
  if (token !== owner) return;
  try {
    const { HeadAudio } = await import("../avatar/vendor/headaudio.min.mjs");
    if (token !== owner) return;
    // Aria's voice sits around 220 Hz; the model's Mel spacing stretches to match (its default is 150).
    const node = new HeadAudio(ctx, { parameterData: { vadGateActiveDb: -46, vadGateInactiveDb: -56, speakerMeanHz: 220 } });
    await node.loadModel("/headaudio/model-en-mixed.bin");
    if (token !== owner) {
      node.stop?.();
      return;
    }
    node.onvalue = (key: string, value: number) => {
      const name = key.startsWith("viseme_") ? key.slice(7) : key;
      visemes = { ...visemes, [name]: value };
    };
    source.connect(node);
    visemeNode = node;
    visemeOwner = token;
    lastVisemeTick = performance.now();
  } catch (error) {
    console.warn("[mouth] visemes unavailable:", error);
  }
}

function detachVisemes() {
  try {
    visemeNode?.stop?.();
    visemeNode?.disconnect();
  } catch {
    // Already gone with its context.
  }
  visemeNode = null;
  visemeOwner = 0;
  visemes = {};
}

type Listener = (shape: MouthShape) => void;

const listeners = new Set<Listener>();
let shape: MouthShape = { open: 0, width: 0.5 };
let raf = 0;
let analyser: AnalyserNode | null = null;
// Typed over ArrayBuffer explicitly: TS 5.7 made Uint8Array generic, and getByteTimeDomainData
// will not accept the SharedArrayBuffer-compatible default.
let timeBuf: Uint8Array<ArrayBuffer> | null = null;
let freqBuf: Uint8Array<ArrayBuffer> | null = null;

/**
 * Identifies which audio source owns the analyser.
 *
 * Two independent pipelines feed this — the scripted narration in `lib/voice.ts` and the Gemini Live
 * tutor in `lib/useGeminiLiveTutor.ts`. Without a token, a narration clip finishing would call
 * `detach()` and shut the mouth in the middle of the tutor's sentence, because the detach cannot
 * tell whether it still owns the analyser. Only the current owner may detach.
 */
export type MouthToken = number;
let owner: MouthToken = 0;
let nextToken: MouthToken = 1;

/** Current mouth shape. Safe to call at any time; closed when nothing is speaking. */
export function mouthShape(): MouthShape {
  return shape;
}

/** Openness alone, for callers that only need the jaw. */
export function mouthLevel(): number {
  return shape.open;
}

export function onMouthShape(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function publish(next: MouthShape) {
  shape = next;
  for (const fn of listeners) fn(next);
}

/**
 * Split the spectrum into three bands and infer lip spread from where the energy sits.
 *
 * Pure, and separated from the analyser loop for the same reason `score.ts` and `focusState.ts` are
 * pure: a rule you cannot test without a microphone and a live lecture is a rule nobody ever checks.
 *
 * The physical claim is rough but real — front vowels ("ee", "ih") carry a high second formant and
 * are spoken with spread lips; back/rounded vowels ("oo", "oh") push energy low and are spoken with
 * rounded lips. So high-vs-low balance is a usable proxy for how wide the mouth should be.
 */
export function visemeFrom(bands: { low: number; mid: number; high: number }, rms: number): MouthShape {
  // Silence: closed, and resting at neutral width so the next word does not start from a grimace.
  if (rms < 0.02) return { open: 0, width: 0.5 };

  const total = bands.low + bands.mid + bands.high;
  // Energy with no discernible distribution (a click, a buffer of near-nothing) should not be
  // allowed to throw the lips to an extreme.
  if (total <= 0) return { open: Math.min(1, rms * 4.2), width: 0.5 };

  const openness = Math.min(1, rms * 4.2);
  // 0 = all energy low (rounded), 1 = all energy high (spread).
  const brightness = (bands.mid * 0.5 + bands.high) / total;
  // Compressed toward the middle: real speech rarely sits at either extreme, and a mouth that snaps
  // between a full pucker and a full grin on every syllable reads as a glitch rather than as speech.
  const width = Math.max(0, Math.min(1, 0.5 + (brightness - 0.45) * 1.6));
  return { open: openness, width };
}

/**
 * Attach to an existing audio graph. Returns a token to pass back to `detachMouthAnalyser`.
 *
 * Both callers already build an AudioContext for their own reasons, so this taps the chain they have
 * rather than creating a second context — two contexts on one element is a silent way to lose audio
 * entirely on some browsers.
 */
export function attachMouthAnalyser(ctx: AudioContext, source: AudioNode): MouthToken {
  const node = ctx.createAnalyser();
  // 512 gives ~86Hz bins at 44.1kHz — enough to separate the bands below, still short enough a
  // window to follow the syllable rate.
  node.fftSize = 512;
  node.smoothingTimeConstant = 0.55;
  source.connect(node);

  analyser = node;
  timeBuf = new Uint8Array(new ArrayBuffer(node.fftSize));
  freqBuf = new Uint8Array(new ArrayBuffer(node.frequencyBinCount));
  owner = nextToken++;
  // The viseme listener on the same source, when the browser can run it; never awaited.
  detachVisemes();
  void attachVisemes(ctx, source, owner);
  if (!raf) loop();
  return owner;
}

/** Detach. A token that no longer owns the analyser is ignored — see `MouthToken`. */
export function detachMouthAnalyser(token?: MouthToken) {
  if (token !== undefined && token !== owner) return;
  analyser = null;
  timeBuf = null;
  freqBuf = null;
  owner = 0;
  detachVisemes();
  if (raf) cancelAnimationFrame(raf);
  raf = 0;
  publish({ open: 0, width: 0.5 }); // the mouth must close when the voice stops, not freeze mid-word
}

function loop() {
  raf = requestAnimationFrame(loop);
  if (!analyser || !timeBuf || !freqBuf) return;

  // The viseme weights ease toward the sound HeadAudio heard; it wants the frame time in ms.
  if (visemeNode && visemeOwner === owner) {
    const now = performance.now();
    visemeNode.update(Math.min(100, now - lastVisemeTick));
    lastVisemeTick = now;
  }
  // The script's shape for this moment, when a reply is being spoken and the voice is not in a pause.
  scripted = speech && shape.open > 0.03 ? scriptedWeightsAt(analyser.context.currentTime) : null;

  analyser.getByteTimeDomainData(timeBuf);
  // RMS around the 128 midpoint of unsigned time-domain data. Peak amplitude would make the mouth
  // snap fully open on any transient; RMS tracks how loud the voice actually is.
  let sum = 0;
  for (let i = 0; i < timeBuf.length; i++) {
    const v = (timeBuf[i] - 128) / 128;
    sum += v * v;
  }
  const rms = Math.sqrt(sum / timeBuf.length);

  analyser.getByteFrequencyData(freqBuf);
  const bands = bandEnergy(freqBuf, analyser.context.sampleRate);
  const target = visemeFrom(bands, rms);

  // Asymmetric smoothing: open fast, close slower. A mouth that snaps shut between syllables reads
  // as a glitch; one that eases shut reads as speech. Width is always eased — lips do not teleport.
  publish({
    open: target.open > shape.open ? target.open : shape.open * 0.72 + target.open * 0.28,
    width: shape.width * 0.8 + target.width * 0.2,
  });
}

/** Sum FFT magnitudes into the three bands, using the real sample rate rather than assuming 44.1k. */
function bandEnergy(buf: Uint8Array, sampleRate: number) {
  const hzPerBin = sampleRate / 2 / buf.length;
  let low = 0, mid = 0, high = 0;
  for (let i = 0; i < buf.length; i++) {
    const hz = i * hzPerBin;
    const v = buf[i];
    if (hz < 500) low += v;
    else if (hz < 2000) mid += v;
    else if (hz < 4000) high += v;
    // Above 4kHz is mostly sibilance and noise; it says little about lip shape.
  }
  return { low, mid, high };
}

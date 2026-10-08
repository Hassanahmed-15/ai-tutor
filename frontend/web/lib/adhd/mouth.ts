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

import { pauseAfterWord, unitsForWord } from "../avatar/align";
import { lipTrackAudio, lipTrackBegin, lipTrackEnd, lipTrackWords, type VisemeTrack } from "../avatar/lipTrack";
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
/** The eased scripted weights: shapes attack in ~40 ms and release in ~90 ms, as lips do. */
let scriptedEased: VisemeWeights = {};
/** Lips lead the sound by this much: a shape is visible just before its sound is heard. */
const SCRIPT_LEAD_S = 0.08;
/** Words that arrived before the reply's first audio (Gemini sends the transcript ahead): the reply's opening. */
let wordsAhead = "";
let rulesPromise: Promise<LipsyncRules | null> | null = null;

function loadRules(): Promise<LipsyncRules | null> {
  rulesPromise ??= import("../avatar/vendor/lipsync-en.mjs").then((m) => {
    const rules = new m.LipsyncEn() as LipsyncRules & { rules?: Record<string, { visemes: string[] }[]> };
    // TalkingHead gives "w" the f/v shape (lower lip under the teeth). On a real face a "w" is a
    // rounded lip, as in "oo": "we", "was", "with" are among a lecture's commonest words.
    for (const rule of rules.rules?.W ?? []) rule.visemes = rule.visemes.map((v) => (v === "FF" ? "U" : v));
    return rules as LipsyncRules;
  }).catch((error) => {
    console.warn("[mouth] text rules unavailable:", error);
    return null;
  });
  return rulesPromise;
}

/*
 * THE ALIGNED TRACK. Better than the script's guess at timing: each chunk's audio is analysed before
 * it plays (lib/avatar/headFeatures.ts) and the words are aligned to that evidence
 * (lib/avatar/align.ts, lib/avatar/lipTrack.ts), giving per-frame viseme weights on the audio
 * clock. When the track covers the moment being heard, it is the mouth; the script below is the
 * fallback for browsers that cannot run the worklet offline.
 */
let visemeTrack: VisemeTrack | null = null;

function visemeFrameAt(at: number): VisemeWeights | null {
  if (!visemeTrack) return null;
  // Frame i's evidence is centred one hop after its start.
  const i = Math.round((at - visemeTrack.startAt) / visemeTrack.hopS - 1);
  if (i < 0 || i >= visemeTrack.weights.length) return null;
  return visemeTrack.weights[i];
}

/** A reply is starting: its first audio is scheduled at `startAt` on the context's clock. */
export function beginSpeechScript(startAt: number): void {
  speech = { script: EMPTY_SCRIPT, startAt, endAt: startAt, cursor: 0, pendingText: wordsAhead, rules: null };
  wordsAhead = "";
  scripted = null;
  visemeTrack = null;
  lipTrackBegin(startAt, (t) => {
    visemeTrack = t;
  });
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
    lipTrackWords(unitsForWord(out.visemes, out.durations, 5, true, pauseAfterWord(word)));
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
  scriptedEased = {};
  wordsAhead = "";
  visemeTrack = null;
  lipTrackEnd();
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
 * The voice's recent peak level, for automatic gain. Gemini's replies play at full scale, where
 * `rms * 4.2` saturated at 1 for seconds at a time: a jaw pinned wide open, with no dip between
 * syllables, which read as no lip-sync at all. Openness is now loudness relative to this peak,
 * which rises at once and decays slowly, so a quiet voice and a loud one both move the mouth.
 */
let peakRms = 0.05;

/*
 * THE TIMELINE: the mouth computed from the audio BEFORE it plays. Analysing the live output lags
 * the sound by ~120 ms measured (the analyser's window and smoothing, then a render frame, then
 * the easing), and the device's output latency sits on top (100–250 ms on Bluetooth), so the lips
 * were a quarter of a second off the voice, which reads as no sync at all. Every reply chunk is a
 * buffer we hold before it is scheduled, so its mouth can be worked out in advance, keyed to the
 * audio clock, and read at `now − outputLatency + lead`: the lips move with the sound as it reaches
 * the ear, a touch before, as real lips do (the mouth starts moving before the voice).
 */
export type MouthFrame = { at: number; open: number; width: number };
const FRAME_S = 0.02;
/** Lips lead the sound by this much. */
const LEAD_S = 0.06;
let timeline: MouthFrame[] = [];
let timelineEndsAt = 0;
/** The voice's level across the reply so far, for automatic gain on the frames. */
let timelinePeak = 0.05;

/**
 * Work out the mouth for one chunk of PCM and put it on the timeline at `startAt` (audio clock).
 * Per frame: loudness relative to the reply's running peak, and the spectral balance of the frame —
 * the same rule the live analyser uses (visemeFrom), just ahead of time.
 */
export function scheduleMouthFrames(samples: Float32Array, sampleRate: number, startAt: number): void {
  lipTrackAudio(samples, sampleRate, startAt);
  const hop = Math.max(1, Math.round(sampleRate * FRAME_S));
  const frames: MouthFrame[] = [];
  for (let i = 0; i + hop <= samples.length; i += hop) {
    let sum = 0;
    for (let j = i; j < i + hop; j++) sum += samples[j] * samples[j];
    const rms = Math.sqrt(sum / hop);
    timelinePeak = Math.max(0.03, rms > timelinePeak ? rms : timelinePeak * 0.995);
    const relative = rms / timelinePeak;
    const bands = bandEnergyFromSamples(samples, i, hop, sampleRate);
    const target = visemeFrom(bands, rms < 0.02 || relative < 0.2 ? 0 : Math.min(1, relative * 0.95) / 4.2);
    frames.push({ at: startAt + i / sampleRate, open: target.open, width: target.width });
  }
  if (frames.length === 0) return;
  // A chunk that starts before the end of the last one replaces that stretch (a reschedule).
  if (timeline.length && frames[0].at < timelineEndsAt) timeline = timeline.filter((f) => f.at < frames[0].at);
  timeline.push(...frames);
  timelineEndsAt = frames[frames.length - 1].at + FRAME_S;
  // What has played is of no further use.
  if (timeline.length > 3000) timeline = timeline.slice(-2000);
}

/** The timeline is over: a reply finished or was cut off. The live analyser carries on alone. */
export function clearMouthTimeline(): void {
  timeline = [];
  timelineEndsAt = 0;
  timelinePeak = 0.05;
}

/** The frame due at `at` on the audio clock, or null when the timeline does not cover it. */
export function mouthFrameAt(at: number): MouthFrame | null {
  if (timeline.length === 0 || at < timeline[0].at - FRAME_S || at > timelineEndsAt) return null;
  let lo = 0;
  let hi = timeline.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (timeline[mid].at <= at) lo = mid;
    else hi = mid - 1;
  }
  return timeline[lo];
}

/** Three-band energy of one frame of samples: Goertzel at a few probe frequencies per band, cheap and enough for lip spread. */
function bandEnergyFromSamples(samples: Float32Array, start: number, length: number, sampleRate: number): { low: number; mid: number; high: number } {
  const probe = (hz: number) => {
    const coeff = 2 * Math.cos((2 * Math.PI * hz) / sampleRate);
    let s1 = 0, s2 = 0;
    for (let n = 0; n < length; n++) {
      const s0 = samples[start + n] + coeff * s1 - s2;
      s2 = s1;
      s1 = s0;
    }
    return Math.sqrt(Math.max(0, s1 * s1 + s2 * s2 - coeff * s1 * s2));
  };
  return {
    low: probe(150) + probe(300) + probe(450),
    mid: probe(700) + probe(1100) + probe(1600),
    high: probe(2200) + probe(2900) + probe(3600),
  };
}

let loopDebug: { clock: number; now: number; ahead: number | null; frames: number } = { clock: 0, now: 0, ahead: null, frames: 0 };
/** What the mouth loop last read, for the lab. */
export function mouthLoopDebug() {
  return loopDebug;
}

/** The audio clock the lips should read: now, less the device's output latency, plus the lead. */
function lipClock(ctx: BaseAudioContext): number {
  const outputLatency = (ctx as AudioContext).outputLatency ?? 0;
  return ctx.currentTime - outputLatency + LEAD_S;
}

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
  peakRms = 0.05; // a new voice sets its own level
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
  clearMouthTimeline();
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
  // The script's shape for this moment, when a reply is being spoken and the voice is not in a pause,
  // eased so one shape becomes the next rather than switching.
  const aligned = visemeFrameAt(lipClock(analyser.context));
  const scriptTarget = aligned ?? (speech && shape.open > 0.03 ? scriptedWeightsAt(lipClock(analyser.context) - LEAD_S + SCRIPT_LEAD_S) : null);
  if (scriptTarget) {
    const next: VisemeWeights = {};
    // The aligned track has its own rise and fall built in, so it is followed closely.
    const attack = aligned ? 0.7 : 0.45;
    const release = aligned ? 0.5 : 0.22;
    for (const k of new Set([...Object.keys(scriptedEased), ...Object.keys(scriptTarget)])) {
      const a = scriptedEased[k] ?? 0;
      const b = (scriptTarget[k] ?? 0) * (aligned ? 0.75 : 1);
      const v = b > a ? a + (b - a) * attack : a + (b - a) * release;
      if (v > 0.01) next[k] = v;
    }
    scriptedEased = next;
    scripted = next;
  } else {
    scriptedEased = {};
    scripted = null;
  }

  analyser.getByteTimeDomainData(timeBuf);
  // RMS around the 128 midpoint of unsigned time-domain data. Peak amplitude would make the mouth
  // snap fully open on any transient; RMS tracks how loud the voice actually is.
  let sum = 0;
  for (let i = 0; i < timeBuf.length; i++) {
    const v = (timeBuf[i] - 128) / 128;
    sum += v * v;
  }
  const rms = Math.sqrt(sum / timeBuf.length);
  peakRms = Math.max(0.03, rms > peakRms ? rms : peakRms * 0.995);

  analyser.getByteFrequencyData(freqBuf);
  const bands = bandEnergy(freqBuf, analyser.context.sampleRate);
  // Relative loudness: full peak is a fully open vowel; under a fifth of the peak is a pause.
  // Real silence is an absolute floor (room tone must not twitch the mouth); within speech, a pause
  // is under a fifth of the voice's own peak.
  const relative = rms / peakRms;
  const heardNow = visemeFrom(bands, rms < 0.02 || relative < 0.2 ? 0 : Math.min(1, relative * 0.95) / 4.2);
  // The timeline, when it covers this moment, is the mouth for the sound reaching the ear now; the
  // analyser is the fallback for sources that were never scheduled through it (narration, the lab).
  const ahead = mouthFrameAt(lipClock(analyser.context));
  loopDebug = { clock: lipClock(analyser.context), now: analyser.context.currentTime, ahead: ahead ? ahead.at : null, frames: timeline.length };
  const target: MouthShape = ahead ? { open: ahead.open, width: ahead.width } : heardNow;

  // Timeline frames are already at the right moment: show them. The analyser path keeps its
  // asymmetric smoothing (open fast, close a little slower). Width is always eased: lips do not teleport.
  publish({
    open: ahead ? (target.open > shape.open ? target.open : shape.open * 0.35 + target.open * 0.65) : target.open > shape.open ? target.open : shape.open * 0.6 + target.open * 0.4,
    width: shape.width * 0.7 + target.width * 0.3,
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

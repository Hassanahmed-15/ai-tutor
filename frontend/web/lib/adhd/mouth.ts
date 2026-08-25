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

/** The mouth shape. Both 0-1. `open` is jaw drop, `width` is how spread vs rounded the lips are. */
export type MouthShape = { open: number; width: number };

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
  if (raf) cancelAnimationFrame(raf);
  raf = 0;
  publish({ open: 0, width: 0.5 }); // the mouth must close when the voice stops, not freeze mid-word
}

function loop() {
  raf = requestAnimationFrame(loop);
  if (!analyser || !timeBuf || !freqBuf) return;

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

// "Aria, …": follow-up questions by voice while the board is open (overlay.js starts and stops it).
//
// The microphone runs only while a board is on screen. A small loudness detector cuts the student's
// speech into utterances; each one is turned into text by Aria's own speech-to-text route
// (/api/voice-transcribe, ~$0.003 a minute of speech, logged to the screen tag). An utterance counts
// only when it starts with her name ("Aria, why…", "hey Aria…"); a bare "Aria" makes the next
// utterance the question. Everything else (other people, a video playing, her own voice) is ignored.

const RATE = 16000;
const CHUNK = 2048; // 128 ms at 16 kHz
const PRE_ROLL = 3; // chunks kept from before the voice started
const END_SILENCE = 6; // ~0.8 s of quiet ends an utterance
const MIN_VOICED = 3; // shorter than ~0.4 s is a cough or a click
const MAX_CHUNKS = 78; // ~10 s, under the transcribe route's size cap
const FOLLOW_MS = 8000; // after a bare "Aria", how long the next utterance counts as the question

// Her name as speech-to-text writes it, in the first few words.
const NAME = /^(aria|arya|ariya|ariah|arria|area|aaria|maria|ari)$/i;
const FILLER = /^(hey|hi|hello|ok|okay|so|um|uh|and|yo|oh)$/i;
const STOP = /^(stop|wait|shh+|quiet|be quiet|pause|hold on|enough)\b/i;

/** The text after her name, or null when the utterance was not for her. */
export function addressed(text) {
  const words = String(text ?? "").trim().split(/\s+/);
  for (let i = 0; i < Math.min(words.length, 4); i++) {
    const w = words[i].replace(/[^a-z']/gi, "");
    if (NAME.test(w)) return words.slice(i + 1).join(" ").replace(/^[\s,.!?:;-]+/, "").trim();
    if (!FILLER.test(w)) return null;
  }
  return null;
}

export const isStop = (text) => STOP.test(String(text ?? "").trim());

function wav(chunks) {
  const n = chunks.reduce((a, c) => a + c.length, 0);
  const buf = new ArrayBuffer(44 + n * 2);
  const v = new DataView(buf);
  const str = (o, s) => [...s].forEach((ch, i) => v.setUint8(o + i, ch.charCodeAt(0)));
  str(0, "RIFF");
  v.setUint32(4, 36 + n * 2, true);
  str(8, "WAVEfmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, RATE, true);
  v.setUint32(28, RATE * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  str(36, "data");
  v.setUint32(40, n * 2, true);
  let o = 44;
  for (const c of chunks)
    for (let i = 0; i < c.length; i++, o += 2) v.setInt16(o, Math.max(-1, Math.min(1, c[i])) * 0x7fff, true);
  return new Blob([buf], { type: "audio/wav" });
}

/**
 * opts: onQuestion(text), onStop(), onState(state) with state "off" | "listening" | "hearing" |
 * "waiting" (heard her name, waiting for the question) | "blocked" (no microphone), speaking() (true
 * while Aria talks: her own voice must be louder to count, in case echo cancelling misses it).
 */
export function createListener(opts) {
  let stream = null;
  let ctx = null;
  let node = null;
  let on = false;
  let noise = 0.01;
  let pre = [];
  let voiced = 0;
  let quiet = 0;
  let utterance = null;
  let waitingUntil = 0;
  const state = (s) => opts.onState?.(s);

  async function handle(blob) {
    let text = "";
    try {
      const r = await fetch("/api/voice-transcribe", { method: "POST", headers: { "content-type": "audio/wav", "x-aria-spend": "screen" }, body: blob });
      text = r.ok ? ((await r.json()).text ?? "") : "";
    } catch {
      // A lost utterance is the same as an unheard one.
    }
    if (on) heard(text);
  }

  /** What to do with one utterance's text. */
  function heard(text) {
    console.info(`[listen] heard: "${text}"`);
    const rest = addressed(text);
    if (rest === null) {
      if (Date.now() < waitingUntil && text.trim().length > 1) {
        waitingUntil = 0;
        state("listening");
        return isStop(text) ? opts.onStop?.() : opts.onQuestion?.(text.trim());
      }
      return state(Date.now() < waitingUntil ? "waiting" : "listening");
    }
    if (!rest) {
      waitingUntil = Date.now() + FOLLOW_MS;
      opts.onStop?.({ quiet: true });
      state("waiting");
      setTimeout(() => on && waitingUntil && Date.now() >= waitingUntil && state("listening"), FOLLOW_MS + 50);
      return;
    }
    waitingUntil = 0;
    state("listening");
    if (isStop(rest)) opts.onStop?.();
    else opts.onQuestion?.(rest);
  }

  function onChunk(samples) {
    let sum = 0;
    for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
    const rms = Math.sqrt(sum / samples.length);
    const loud = opts.speaking?.() ? Math.max(0.035, noise * 6) : Math.max(0.015, noise * 3.5);
    if (!utterance) {
      pre.push(samples);
      if (pre.length > PRE_ROLL) pre.shift();
      if (rms > loud) {
        utterance = [...pre];
        voiced = 1;
        quiet = 0;
        state("hearing");
      } else noise = Math.max(0.002, noise * 0.95 + rms * 0.05);
      return;
    }
    utterance.push(samples);
    if (rms > Math.max(0.01, noise * 2)) {
      voiced++;
      quiet = 0;
    } else quiet++;
    if (quiet >= END_SILENCE || utterance.length >= MAX_CHUNKS) {
      const done = utterance;
      utterance = null;
      pre = [];
      if (voiced >= MIN_VOICED) handle(wav(done));
      else state(Date.now() < waitingUntil ? "waiting" : "listening");
    }
  }

  return {
    heard,
    get on() {
      return on;
    },
    async start() {
      if (on) return;
      on = true;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } });
        if (!on) return this.stop();
        ctx = new AudioContext({ sampleRate: RATE });
        const src = ctx.createMediaStreamSource(stream);
        // ScriptProcessor is old but needs no extra module file, and 128 ms chunks are plenty here.
        node = ctx.createScriptProcessor(CHUNK, 1, 1);
        node.onaudioprocess = (e) => on && onChunk(new Float32Array(e.inputBuffer.getChannelData(0)));
        src.connect(node);
        node.connect(ctx.destination);
        state("listening");
      } catch (err) {
        console.warn(`[listen] no microphone: ${err?.name ?? err}`);
        on = false;
        state("blocked");
      }
    },
    stop() {
      on = false;
      utterance = null;
      pre = [];
      waitingUntil = 0;
      node?.disconnect();
      ctx?.close().catch(() => {});
      stream?.getTracks().forEach((t) => t.stop());
      node = ctx = stream = null;
      state("off");
    },
  };
}

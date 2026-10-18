/**
 * Teacher narration playback. The demo uses the browser's speechSynthesis by default so
 * it never spends OpenAI credits. Cloud TTS can be explicitly enabled by passing
 * `cloudTts: true`. Two real-world bugs this fixes that the previous version had:
 *
 * 1. `speechSynthesis.getVoices()` returns [] on first call in Chrome — voice lists load
 *    asynchronously. Calling it immediately silently picks no/garbage voice. We wait for
 *    the `voiceschanged` event (with a timeout) before picking a voice.
 * 2. Browsers block audio.play()/speechSynthesis.speak() that isn't triggered by a direct
 *    user gesture (autoplay policy) — a beat that tries to talk on its own can fail SILENTLY
 *    with no error event at all. We surface this as `onBlocked` so the UI can show a
 *    "tap to enable sound" recovery action instead of just being mute.
 */

import { attachMouthAnalyser, detachMouthAnalyser, startClipLipSync, type MouthToken } from "./adhd/mouth";
import { prepareClipLipTrack, type ClipLipTrack } from "./avatar/clipLipSync";
import { CLIP_FETCH_CONCURRENCY, SENTENCE_GAP_MS, sentenceAlignedProgress, sentenceWeight } from "./narrationClock";
import { recordTtsResponse } from "./costLedger";
import { ensureRunning, registerAudioContext, resumeAllAudio } from "./voice/audioOutput";
import { withoutSourceTags } from "./webSources";
import { withoutOldTransferPrompt } from "./canvas/oldTransferPrompt";

export type NarrationHandle = {
  cancel: () => void;
  /** Freeze the active narration at its current media timestamp without destroying it. Returns
   *  false when this narration can't be paused, so the caller can fall back to cancel(). */
  pause: () => boolean;
  /** Continue a paused narration from the exact timestamp where it was interrupted. Returns
   *  false if there's nothing resumable. */
  resume: () => boolean;
  /**
   * Change the speed of THIS narration while it plays.
   *
   * Without it the only way to change speed was to cancel and start again, which is what the
   * player did: the beat replayed from its first sentence every time the student touched the
   * control. On the cloud path the running clip changes speed at once; the browser-speech fallback
   * cannot re-time an utterance already queued, so it applies from the next sentence.
   */
  setRate: (rate: number) => void;
};

/** The speeds offered (lib/playbackPrefs.ts): 0.5x to 1.5x. Beyond these, time-stretched speech stops sounding like speech. */
export const MIN_NARRATION_RATE = 0.5;
export const MAX_NARRATION_RATE = 1.5;
const clampRate = (rate: number) =>
  Number.isFinite(rate) ? Math.min(MAX_NARRATION_RATE, Math.max(MIN_NARRATION_RATE, rate)) : 1;

/**
 * Whether narration uses OpenAI cloud TTS by default. ON: real warm teacher voice, plays
 * through the browser's normal <audio> media pipeline (works even where the browser's own
 * speechSynthesis engine is broken/silent), but costs ~$0.015/min of audio per playback.
 * OFF: free browser speechSynthesis (silent on some Chrome-on-macOS setups). Individual
 * callers can still override per call via `cloudTts`. Flip this one constant to disable
 * cloud TTS everywhere.
 */
const CLOUD_TTS_DEFAULT = true;

/** Dev-only narration trace; `next dev` forwards it to the server log beside the [playback] lines. */
function traceNarration(event: string, detail: Record<string, unknown>) {
  if (process.env.NODE_ENV === "production") return;
  console.log(`[playback] narration-${event} ${JSON.stringify(detail)}`);
}
const CLOUD_TTS_GAIN = 1.45;
const BROWSER_TTS_VOLUME = 1;
/** How long a clip keeps being retried (spaced out) before it is given up on. */
const CLIP_RETRY_WINDOW_MS = 20_000;

/** Resolves when the browser is back online, or after `ms` at most. */
function untilOnline(ms: number): Promise<void> {
  return new Promise((resolve) => {
    if (typeof window === "undefined" || navigator.onLine !== false || ms <= 0) return resolve();
    const done = () => {
      window.removeEventListener("online", done);
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(done, ms);
    window.addEventListener("online", done);
  });
}

export interface NarrationCallbacks {
  onStart: () => void;
  onEnd: () => void;
  /** Fired when the browser silently blocked audio (autoplay policy) — needs a user tap to unlock. */
  onBlocked: () => void;
  /** Fired whenever the teacher starts a new sentence so visuals can follow the exact explanation. */
  onSentenceStart?: (index: number, sentence: string, total: number) => void;
  /**
   * Asked just BEFORE sentence `index` starts playing (index > 0); true holds the narration there,
   * paused, until it is resumed. `onSentenceStart` fires once a sentence is already audible, so a hold
   * made there let the first words of a prediction's reveal play out (owner, 2026-10-18: the card
   * "never really waits for me and tells the answers"). A number is a wait in ms before the sentence
   * (thinking time) — counted on the narration's own clock, so it stands still while paused.
   */
  holdBefore?: (index: number, sentence: string) => boolean | number;
  /** Fired from the active audio/timeline clock. `progress` is 0..1 for the current beat. */
  onProgress?: (progress: number, currentTimeMs: number, durationMs: number) => void;
  /**
   * Fired as narration passes each word, for reading along.
   *
   * ESTIMATED, NOT MEASURED. Cloud TTS returns audio with a real clock but no word timings, so the
   * position is interpolated inside the current sentence using the same weights that drive
   * `onSentenceStart`. Mid-sentence it can be a word or two out; the error is bounded by the
   * sentence and resets at every sentence boundary, which is what keeps it usable. Weighting is by
   * vowel groups rather than characters, because "2019" is four characters and about five syllables
   * spoken and generated lectures are full of numbers.
   *
   * Consumers should render this forgivingly — a soft trailing highlight rather than a hard box, so
   * a one-word error is invisible instead of looking broken.
   */
  onWordStart?: (wordIndex: number, sentenceIndex: number) => void;
  /** Playback speed multiplier (1 = normal). Applies to both the OpenAI audio element and
   *  the browser TTS fallback's base rate. Defaults to 1. */
  rate?: number;
  /** Override server-side OpenAI TTS for this call. Defaults to CLOUD_TTS_DEFAULT. */
  cloudTts?: boolean;
  /**
   * Don't cancel narrations that are already running. Used for short interjections the teacher
   * makes while a beat is FROZEN mid-sentence (a comprehension question, a re-explanation), so the
   * beat can still resume from where it stopped afterwards instead of replaying from the top.
   *
   * Only `useVoiceDirector` should set this — it is what guarantees the preserved narration stays
   * paused while the interjection plays, so the two never overlap.
   */
  preserveActive?: boolean;
  /**
   * What happens when a part's FIRST clip cannot be synthesised (a failed /api/tts call, after its
   * retries). "browser" (the default): the whole part is read by the browser's own speech engine —
   * a different voice, with no lip sync. "silent": Aria's voice is ALWAYS kept — every sentence
   * waits for its own clip, and one that never comes passes as a timed gap. The standard lecture,
   * its chat answers and its checkpoint voice use "silent" (owner, 2026-10-17: "the voice of Aria
   * changes and during that she doesn't lip sync — a very common and big issue").
   */
  voiceFallback?: "browser" | "silent";
}

/*
 * ONE AUDIO CONTEXT FOR EVERY NARRATION.
 *
 * Each narration used to build its own context after its first clip downloaded — outside any
 * click — and when the browser held that new context suspended for 1.2 s, the clip played without
 * the volume boost and without the mouth analyser: after a pause that restarted the part, Aria
 * sounded quieter and her mouth stopped (2026-10-14). The context is now made once, resumed inside
 * the Play click (unlockAudio) and on every later interaction (lib/voice/audioOutput.ts), and each
 * narration only adds and removes its own nodes on it.
 */
let sharedNarrationContext: AudioContext | null = null;
function narrationContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (sharedNarrationContext && (sharedNarrationContext.state as string) !== "closed") return sharedNarrationContext;
  const Ctor = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  try {
    sharedNarrationContext = new Ctor();
    registerAudioContext(sharedNarrationContext);
  } catch {
    sharedNarrationContext = null;
  }
  return sharedNarrationContext;
}

let voicesReadyPromise: Promise<SpeechSynthesisVoice[]> | null = null;
const activeNarrationCancelers = new Set<() => void>();

export function cancelActiveNarrations() {
  for (const cancel of [...activeNarrationCancelers]) cancel();
  activeNarrationCancelers.clear();
}

function waitForVoices(): Promise<SpeechSynthesisVoice[]> {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return Promise.resolve([]);
  if (voicesReadyPromise) return voicesReadyPromise;

  voicesReadyPromise = new Promise((resolve) => {
    const existing = window.speechSynthesis.getVoices();
    if (existing.length > 0) {
      resolve(existing);
      return;
    }
    const onChange = () => {
      const voices = window.speechSynthesis.getVoices();
      if (voices.length > 0) {
        window.speechSynthesis.removeEventListener("voiceschanged", onChange);
        resolve(voices);
      }
    };
    window.speechSynthesis.addEventListener("voiceschanged", onChange);
    // Some browsers never fire voiceschanged if there's truly nothing to load — don't hang forever.
    setTimeout(() => {
      window.speechSynthesis.removeEventListener("voiceschanged", onChange);
      resolve(window.speechSynthesis.getVoices());
    }, 1200);
  });
  return voicesReadyPromise;
}

/**
 * Scores installed system voices and returns the best teacher-like candidate. Picks
 * "Daniel" (a calm, measured British narrator-register voice) first when installed —
 * chosen over the previous default (Samantha) per explicit preference. Falls back to
 * quality-tier scoring (neural/premium engines, then other steady narrator-style voices)
 * for browsers/OSes where Daniel isn't available.
 */
function pickTeacherVoice(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | undefined {
  const english = voices.filter((v) => v.lang.toLowerCase().startsWith("en"));
  if (english.length === 0) return voices[0];

  // Chrome exposes this as "Daniel (English (United Kingdom))", not bare "Daniel".
  const daniel = english.find((v) => v.name.toLowerCase().startsWith("daniel"));
  if (daniel) return daniel;

  const score = (v: SpeechSynthesisVoice): number => {
    const name = v.name.toLowerCase();
    let s = 0;
    if (/neural|premium|enhanced|natural|online/.test(name)) s += 10;
    if (/google/.test(name) && /uk|gb/.test(name)) s += 6;
    if (/arthur|oliver|ryan|brian|nathan|george/.test(name)) s += 5; // other steady narrator-register voices
    if (v.lang === "en-GB") s += 3; // British register reads as more "lecturer," matching Daniel's tone
    if (/compact|espeak|robot/.test(name)) s -= 8; // known low-quality legacy engines
    if (v.localService) s += 1; // local voices have lower latency, slight tiebreak
    return s;
  };

  return [...english].sort((a, b) => score(b) - score(a))[0];
}

/** One-time "unlock" for the browser's autoplay gate — call this directly inside a click handler. */
export function unlockAudio() {
  if (typeof window === "undefined") return;
  // Inside the click: the one moment every browser lets a suspended audio context start — so the
  // narration context is made (or woken) here, and every narration after it plays through it.
  narrationContext();
  resumeAllAudio();
  if ("speechSynthesis" in window) {
    // A zero-length utterance still counts as "spoken" for the autoplay gate in most browsers.
    const u = new SpeechSynthesisUtterance(" ");
    u.volume = 0;
    window.speechSynthesis.speak(u);
  }
}

export function splitNarrationSentences(text: string): string[] {
  // A lecture written before 2026-10-16 may end its scripts with "Sources: [S1], [S2]." or with the
  // old "Now try the same reasoning…" sentence — neither is said.
  return withoutOldTransferPrompt(withoutSourceTags(text)).split(/(?<=[.!?۔؟])\s+/).map((sentence) => sentence.trim()).filter(Boolean);
}

export function playNarration(text: string, callbacks: NarrationCallbacks): NarrationHandle {
  if (!callbacks.preserveActive) cancelActiveNarrations();
  /*
   * Mutable: `setRate` changes it mid-narration, and every duration below reads it at the moment it
   * is needed rather than capturing it once — so a sentence gap, a fallback estimate and the next
   * clip all follow a speed change made halfway through.
   */
  let rate = clampRate(callbacks.rate ?? 1);
  const useCloudTts = callbacks.cloudTts ?? CLOUD_TTS_DEFAULT;
  const initialSentences = splitNarrationSentences(text);
  let cancelled = false;
  let paused = false;
  let pausedAtMs = 0;
  let totalPausedMs = 0;
  let audio: HTMLAudioElement | null = null;
  let audioContext: AudioContext | null = null;
  // Identifies this clip's claim on the shared mouth analyser, so a detach here cannot shut the
  // mouth while the Gemini Live tutor is mid-sentence. See lib/adhd/mouth.ts.
  let mouthToken: MouthToken | undefined;
  let cueTimers: ReturnType<typeof setTimeout>[] = [];
  let progressRaf = 0;
  let resumeProgressLoop: (() => void) | null = null;
  let objectUrl: string | null = null;
  /** True while a sentence clip is actually playing — false in the gaps between them. */
  let clipActive = false;
  /** Stops the playing clip's lip track (see `trackFor`). A holder: it is set from a callback. */
  const lips: { stop: (() => void) | null } = { stop: null };
  /** Wakes the loop awaiting the current clip, so cancel() never leaves it waiting forever. */
  let clipWaiter: (() => void) | null = null;
  /** This narration's own nodes on the shared context, removed when it ends (the context stays). */
  let graphNodes: AudioNode[] = [];
  const disconnectGraph = () => {
    for (const node of graphNodes) {
      try {
        node.disconnect();
      } catch {
        /* already disconnected */
      }
    }
    graphNodes = [];
  };
  /** Silences this narration's element for good: a clip that started late can never sound after the end. */
  const silenceElement = () => {
    if (!audio) return;
    audio.onended = null;
    audio.onerror = null;
    audio.pause();
    audio.removeAttribute("src");
  };
  /** Re-attaches the CURRENT sentence's lips (set while a clip plays); used after a resume. */
  let armLips: (() => void) | null = null;
  /** True once the part is being read by the browser's speech engine instead of cloud clips. */
  let browserMode = false;
  const clearCues = () => {
    cueTimers.forEach((timer) => clearTimeout(timer));
    cueTimers = [];
  };
  const stopProgressLoop = () => {
    if (progressRaf) window.cancelAnimationFrame(progressRaf);
    progressRaf = 0;
  };
  const cancel = () => {
    if (cancelled) return;
    cancelled = true;
    activeNarrationCancelers.delete(cancel);
    clipWaiter?.();
    clipWaiter = null;
    silenceElement();
    audio = null;
    stopProgressLoop();
    lips.stop?.();
    lips.stop = null;
    armLips = null;
    detachMouthAnalyser(mouthToken);
    mouthToken = undefined;
    disconnectGraph();
    audioContext = null;
    clearCues();
    if (objectUrl) {
      URL.revokeObjectURL(objectUrl);
      objectUrl = null;
    }
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
  };
  const pause = (): boolean => {
    if (cancelled) return false;
    if (paused) return true; // already frozen
    paused = true;
    pausedAtMs = typeof performance !== "undefined" ? performance.now() : Date.now();
    if (audio && !audio.paused) audio.pause();
    stopProgressLoop();
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.pause();
    }
    return true;
  };
  const resume = (): boolean => {
    if (cancelled || !paused) return false;
    const resumedAtMs = typeof performance !== "undefined" ? performance.now() : Date.now();
    totalPausedMs += Math.max(0, resumedAtMs - pausedAtMs);
    paused = false;
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.resume();
    }
    /*
     * Only a clip that is genuinely MID-PLAY is restarted. Between sentences the element has ended,
     * and play() on an ended element starts it again from the top — so resuming in the gap would
     * have repeated the sentence just finished. The loop's own paused-aware sleep carries on instead.
     */
    if (audio && clipActive) {
      void audio.play().then(() => {
        resumeProgressLoop?.();
        // Her lips for the sentence she is back in — an interjection made while she was paused
        // (a chat answer, a board line) may have taken the mouth and left it closed.
        armLips?.();
      }).catch((err) => {
        // A second pause landing before play() settled is not a blocked autoplay.
        if (err instanceof DOMException && err.name === "AbortError") return;
        callbacks.onBlocked();
      });
    } else {
      resumeProgressLoop?.();
    }
    return true;
  };
  activeNarrationCancelers.add(cancel);
  callbacks.onProgress?.(0, 0, 1);
  if (initialSentences.length > 0) {
    callbacks.onSentenceStart?.(0, initialSentences[0], initialSentences.length);
  }

  const browserFallback = async () => {
    if (cancelled) return;
    browserMode = true;

    const sentences = splitNarrationSentences(text);
    if (sentences.length === 0) {
      activeNarrationCancelers.delete(cancel);
      callbacks.onEnd();
      return;
    }

    const hasSpeech = typeof window !== "undefined" && "speechSynthesis" in window;
    const voices = hasSpeech ? await waitForVoices() : [];
    if (cancelled) return;
    const preferred = hasSpeech ? pickTeacherVoice(voices) : undefined;
    if (hasSpeech) window.speechSynthesis.cancel();

    // CRITICAL: the lecture's visual cues and beat advancement are driven by this
    // time-based timeline, NOT by speech-engine events. Some environments (notably some
    // Chrome-on-macOS setups) accept speechSynthesis.speak() — reporting speaking:true —
    // but never actually fire onstart/onend/onerror and produce no audio, which used to
    // freeze the whole lecture (cues stuck, animations stuck, no advancement). Now speech
    // is best-effort and layered ON TOP of a self-driving timeline: if the engine works you
    // hear it in sync; if it's dead, the lecture still flows visually and advances on time.
    let started = false;
    let cursor = 0;
    const weights = sentences.map((sentence) => Math.max(1.35, sentence.length / 13));
    const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
    const estimatedMs = Math.max(4200, (totalWeight * 900 + (sentences.length - 1) * 320) / rate);
    const startMs = performance.now();

    const cueNext = () => {
      if (cancelled) return;
      if (paused) {
        cueTimers.push(setTimeout(cueNext, 80));
        return;
      }
      if (cursor >= sentences.length) {
        stopProgressLoop();
        callbacks.onProgress?.(1, estimatedMs, estimatedMs);
        /*
         * THE QUEUE IS DRAINED BEFORE THIS NARRATION LETS GO. The clock can run ahead of the speech
         * engine (numbers, formulas, a slow network voice), and this narration used to unregister
         * itself on the clock's end with sentences still queued — so after the last part nothing
         * could cancel them and Aria kept talking on the "Lecture complete" screen (2026-10-14).
         * It stays cancellable until the engine is quiet (bounded at 12 s), then ends.
         */
        const drainedBy = performance.now() + 12_000;
        const waitForQuiet = () => {
          if (cancelled) return;
          const speaking = hasSpeech && (window.speechSynthesis.speaking || window.speechSynthesis.pending);
          if ((speaking || paused) && performance.now() < drainedBy) {
            cueTimers.push(setTimeout(waitForQuiet, 150));
            return;
          }
          if (hasSpeech) window.speechSynthesis.cancel();
          activeNarrationCancelers.delete(cancel);
          callbacks.onEnd();
        };
        waitForQuiet();
        return;
      }
      const sentenceIndex = cursor;
      const sentence = sentences[sentenceIndex];
      cursor += 1;

      // Fire the visual cue immediately — this is what the board animations follow.
      if (sentenceIndex > 0) callbacks.onSentenceStart?.(sentenceIndex, sentence, sentences.length);

      // Best-effort speech, layered on. Its events do NOT gate progression.
      if (hasSpeech) {
        const u = new SpeechSynthesisUtterance(sentence);
        u.rate = 0.93 * rate;
        u.pitch = 1.08; // brighter and more classroom-teacher than the old narrator register
        u.volume = BROWSER_TTS_VOLUME;
        if (preferred) u.voice = preferred;
        u.onstart = () => {
          if (!started) {
            started = true;
            callbacks.onStart();
          }
        };
        try {
          window.speechSynthesis.speak(u);
        } catch {
          /* speech is optional — ignore engine failures, the timeline drives everything */
        }
      }

      // Advance on an estimated speaking duration so paced visuals feel right whether or
      // not audio actually plays. ~85ms/char ≈ a clear narration rate (~12 chars/sec),
      // floored so very short sentences still get a readable beat, plus a brief pause.
      // The real rate, not a clamped one: at 0.5x a 1x floor advanced the board twice as fast as
      // the voice. The gap scales too, or slow speech would still be followed by a brisk pause.
      const spokenMs = Math.max(2200, sentence.length * 85) / rate;
      setTimeout(cueNext, spokenMs + 240 / rate);
    };
    const progressLoop = () => {
      if (cancelled) return;
      if (paused) return;
      const currentMs = Math.min(estimatedMs, performance.now() - startMs - totalPausedMs);
      callbacks.onProgress?.(estimatedMs > 0 ? currentMs / estimatedMs : 1, currentMs, estimatedMs);
      if (currentMs < estimatedMs) {
        progressRaf = window.requestAnimationFrame(progressLoop);
      }
    };
    resumeProgressLoop = progressLoop;
    cueNext();
    progressLoop();

    // We still want onStart to fire promptly so the UI shows "speaking" even before the
    // (best-effort) audio engine confirms it. If the engine never fires its own onstart
    // shortly, surface it as started anyway so the player's status text isn't stuck.
    setTimeout(() => {
      if (!cancelled && !started) {
        started = true;
        callbacks.onStart();
      }
    }, 700);
  };

  (async () => {
    if (!useCloudTts) {
      void browserFallback();
      return;
    }

    /**
     * ONE CLIP PER SENTENCE — so the board knows which sentence is playing instead of guessing.
     *
     * This path used to synthesise the whole beat as a single clip and work out the current sentence
     * by mapping playback progress onto a character-count layout. Speech does not advance per
     * character: it pauses at every full stop and spends far longer on "CO2", "2019" or a formula than
     * their length suggests. Measured on 12 real beats, the guess put the board a median 0.69 s and up
     * to 2.66 s away from the voice, with 28 of 87 sentence boundaries off by a second or more — the
     * worst on formula-heavy beats, where the next step appeared while the last was still being said.
     *
     * With a clip per sentence the cue fires when that clip STARTS, which is when the teacher starts
     * saying it. The boundary is a fact. See lib/narrationClock.ts for how the position is reported
     * so every existing board reads it without change.
     */
    const sentences = splitNarrationSentences(text);
    if (sentences.length === 0) {
      activeNarrationCancelers.delete(cancel);
      callbacks.onEnd();
      return;
    }
    const weights = sentences.map(sentenceWeight);
    const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
    const estimatedTotalMs = Math.max(4200, (totalWeight * 900 + (sentences.length - 1) * 320) / rate);
    const estimatedSentenceMs = (i: number) => Math.max(2200, sentences[i].length * 85) / rate;

    /*
     * Synthesis: sentence 0 first, the rest queued behind it a few at a time. The first clip is a
     * single short sentence rather than a whole beat, so the teacher starts speaking SOONER than the
     * single-clip path allowed; later clips are normally ready before the one before them finishes.
     */
    // "silent": Aria's voice is kept through a failed clip (the lecture); see voiceFallback.
    const keepVoice = callbacks.voiceFallback === "silent";
    const resolvers: Array<(blob: Blob | null) => void> = [];
    const clipPromises = sentences.map(
      (_, i) => new Promise<Blob | null>((resolve) => { resolvers[i] = resolve; }),
    );
    let nextToFetch = 0;
    let inFlight = 0;
    /*
     * ONE CLIP, FETCHED SO THAT IT ARRIVES. A clip request that hung — seen as 73 s of silence in
     * the middle of a part, nothing else happening — held the narration at that sentence. Each try
     * now gives up after 10 s and is retried twice; clips are fetched well ahead of playback, so a
     * retry normally lands before the sentence is reached. A 4xx is a real answer and is not retried.
     */
    /*
     * RETRIED ACROSS A CONNECTION BLIP, NOT INSIDE IT. The three tries used to run back to back: a
     * dropped connection fails a request at once, so all three were spent within ~250 ms and every
     * sentence fetched during a two-second drop was lost to a silent gap (2026-10-16). Tries are now
     * spaced out (0.5, 1, 2, 4 s…) over a window of CLIP_RETRY_WINDOW_MS, and while the browser
     * reports itself offline a try waits for the connection to come back. Playback waits on it: a
     * slow clip pauses Aria on that sentence, and she says it in her own voice when it arrives.
     *
     * A part that hands itself to the browser voice when its first clip fails ("browser") keeps the
     * one 7 s try for that clip: the student is waiting in silence for it.
     */
    const fetchClip = async (text: string, singleTry = false): Promise<Blob | null> => {
      const deadline = performance.now() + CLIP_RETRY_WINDOW_MS;
      for (let attempt = 0; !cancelled; attempt += 1) {
        if (!singleTry && typeof navigator !== "undefined" && navigator.onLine === false) {
          await untilOnline(deadline - performance.now());
          if (cancelled) return null;
        }
        try {
          const res = await fetch("/api/tts", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text }),
            signal: typeof AbortSignal !== "undefined" && "timeout" in AbortSignal ? AbortSignal.timeout(singleTry ? 7_000 : 10_000) : undefined,
          });
          recordTtsResponse(res);
          if (res.ok) return await res.blob();
          if (res.status < 500) return null;
        } catch {
          /* timed out or dropped: try again */
        }
        traceNarration("clip-retry", { attempt: attempt + 1, text: text.slice(0, 40) });
        const wait = Math.min(4_000, 500 * 2 ** attempt);
        if (singleTry || performance.now() + wait >= deadline) return null;
        await new Promise((resolve) => setTimeout(resolve, wait));
      }
      return null;
    };
    /*
     * EVERY SENTENCE'S LIPS, WORKED OUT AS ITS AUDIO ARRIVES — before it plays (clips are fetched
     * ahead). The sentence's words are force-aligned to its own audio (lib/avatar/clipLipSync.ts),
     * and the mouth reads the result from the element's clock while it plays.
     */
    const tracks: Array<Promise<ClipLipTrack | null> | undefined> = [];
    const trackFor = (i: number, blob: Blob) => (tracks[i] ??= prepareClipLipTrack(blob, sentences[i]).catch(() => null));
    const pump = () => {
      while (!cancelled && inFlight < CLIP_FETCH_CONCURRENCY && nextToFetch < sentences.length) {
        const i = nextToFetch;
        nextToFetch += 1;
        inFlight += 1;
        fetchClip(sentences[i], i === 0 && !keepVoice)
          .then((blob) => {
            if (blob) void trackFor(i, blob);
            resolvers[i](blob);
          })
          .finally(() => {
            inFlight -= 1;
            pump();
          });
      }
    };
    pump();

    /*
     * Nothing has played yet. A part that does not keep Aria's voice hands itself to the browser's
     * voice when its first clip fails. One that keeps it ("silent") no longer waits here: it used to
     * wait for the SECOND clip's retries to decide (3 x 10 s) — 23 s of dead air at the start of a
     * part while the player said she was speaking (2026-10-16). Every sentence, the first included,
     * now waits in the loop below for its own clip.
     */
    let firstClip: Blob | null = null;
    if (!keepVoice) {
      firstClip = await clipPromises[0];
      if (cancelled) return;
      if (!firstClip) {
        void browserFallback();
        return;
      }
    }

    /*
     * ONE element for every sentence, with its `src` swapped per clip.
     *
     * `createMediaElementSource` may be called only once per element, and the gain stage and the
     * avatar's mouth analyser both hang off that node. Binding the graph to a single element keeps
     * the volume boost and lip sync intact across every sentence change.
     */
    audio = new Audio();
    audio.preload = "auto";
    try {
      /*
       * ROUTED THROUGH WEB AUDIO ONLY WHEN IT CAN SOUND. Routing the element into a context makes
       * the context its ONLY way out, and a browser may hold a context suspended: the clip then
       * "plays" in silence while the lecture says Aria is speaking. The shared narration context
       * (narrationContext) is woken inside the Play click, so it is normally running already; when it
       * is not running within a moment, the element plays on its own (no volume boost, no mouth
       * animation), which is always audible.
       */
      const shared = narrationContext();
      if (shared && (await ensureRunning(shared, 1_200))) {
        audioContext = shared;
        const source = audioContext.createMediaElementSource(audio);
        graphNodes.push(source);
        let tail: AudioNode = source;
        if (CLOUD_TTS_GAIN > 1) {
          const gain = audioContext.createGain();
          gain.gain.value = CLOUD_TTS_GAIN;
          source.connect(gain);
          graphNodes.push(gain);
          tail = gain;
        }
        tail.connect(audioContext.destination);
        mouthToken = attachMouthAnalyser(audioContext, tail);
      } else {
        traceNarration("unrouted", { state: shared?.state ?? "none" });
      }
    } catch {
      // If Web Audio routing fails, the plain media element still plays at normal volume.
    }

    // Word cues are now estimated INSIDE a sentence whose start is exact, so the error is bounded by
    // one sentence and resets at every boundary.
    const wantWords = typeof callbacks.onWordStart === "function";
    const wordPlans = wantWords
      ? sentences.map((sentence) => {
          const words = sentence.split(/\s+/).filter(Boolean);
          const wordWeights = words.map((word) => {
            const vowels = word.match(/[aeiouy]+/gi)?.length ?? 1;
            const digits = (word.match(/\d/g)?.length ?? 0) * 1.5;
            return Math.max(1, vowels + digits);
          });
          const total = wordWeights.reduce((sum, w) => sum + w, 0) || 1;
          let running = 0;
          return { total, cumulative: wordWeights.map((w) => (running += w)) };
        })
      : [];
    let lastWordKey = "";
    let elapsedBeforeMs = 0;

    /** A delay that stands still while narration is paused, and ends at once on cancel. */
    const sleep = (ms: number) =>
      new Promise<void>((resolve) => {
        let remaining = ms;
        let last = performance.now();
        const tick = () => {
          if (cancelled) return resolve();
          const now = performance.now();
          if (!paused) remaining -= now - last;
          last = now;
          if (remaining <= 0) return resolve();
          cueTimers.push(setTimeout(tick, 40));
        };
        tick();
      });

    /*
     * HER OWN VOICE OR NONE. A sentence whose clip was not ready within 4 s used to be read by the
     * browser's speech engine: a different voice, and a still mouth (nothing it says reaches the lip
     * track or the analyser) while she still showed as speaking — "the voice of Aria changes and
     * she doesn't lip sync" (2026-10-17). Every sentence now waits for its own clip (fetchClip keeps
     * retrying across a blip for CLIP_RETRY_WINDOW_MS); one that never comes passes as a timed gap.
     */
    const clipFor = async (i: number): Promise<Blob | null> => {
      let ready = false;
      const slow = window.setTimeout(() => {
        if (!ready) traceNarration("clip-waiting", { sentence: i, text: sentences[i].slice(0, 40) });
      }, 1_500);
      const blob = await clipPromises[i];
      ready = true;
      window.clearTimeout(slow);
      if (!blob) traceNarration("clip-failed", { sentence: i, text: sentences[i].slice(0, 40) });
      return blob;
    };

    callbacks.onStart();

    for (let i = 0; i < sentences.length; i += 1) {
      if (cancelled) return;
      const blob = i === 0 && firstClip ? firstClip : await clipFor(i);
      if (cancelled) return;

      // A clip that never came, after all its retries: a timed gap, so the board stays in step.
      if (!blob) {
        if (i > 0) callbacks.onSentenceStart?.(i, sentences[i], sentences.length);
        callbacks.onProgress?.(sentenceAlignedProgress(weights, i, 0), elapsedBeforeMs, estimatedTotalMs);
        await sleep(estimatedSentenceMs(i));
        elapsedBeforeMs += estimatedSentenceMs(i);
        continue;
      }

      if (objectUrl) URL.revokeObjectURL(objectUrl);
      objectUrl = URL.createObjectURL(blob);
      audio.src = objectUrl;
      audio.defaultPlaybackRate = rate;
      audio.playbackRate = rate;
      // Tempo without pitch: 1.5x must not become a chipmunk, nor 0.5x a slowed tape. Browsers default
      // to this already; setting it makes the choice explicit rather than inherited.
      audio.preservesPitch = true;
      (audio as HTMLAudioElement & { webkitPreservesPitch?: boolean }).webkitPreservesPitch = true;
      audio.volume = 1;

      // The player may hold here, before a word of this sentence is heard (a prediction's reveal).
      const hold = i > 0 && !paused ? callbacks.holdBefore?.(i, sentences[i]) : false;
      if (hold === true) pause();
      else if (typeof hold === "number" && hold > 0) await sleep(hold);
      if (cancelled) return;
      if (paused) await sleep(1);
      if (cancelled) return;
      // A browser can suspend the output between clips; the element would then play in silence.
      // Bounded: a resume the browser refuses must not hold the lecture (see lib/voice/audioOutput).
      if (audioContext && audioContext.state !== "running") await ensureRunning(audioContext, 1_200);
      // A pause that landed DURING that wait: the sentence waits for the resume instead of playing
      // through the pause.
      if (paused) await sleep(1);
      if (cancelled) return;

      /*
       * PLAYED, OR WAITED FOR — NEVER SKIPPED BY A PAUSE. A pause while play() is pending rejects it
       * with AbortError, and that used to be treated as a failed clip: the sentence was passed over
       * in silence and never spoken (2026-10-14). An abort or a pause now waits for the resume and
       * plays the SAME sentence; only a real failure (or three) is a timed gap.
       */
      let played = false;
      for (let attempt = 0; attempt < 3 && !played; attempt += 1) {
        try {
          await audio.play();
          played = true;
        } catch (err) {
          // DOMException "NotAllowedError" = autoplay-blocked, not a server/network problem.
          if (err instanceof DOMException && err.name === "NotAllowedError") {
            activeNarrationCancelers.delete(cancel);
            callbacks.onBlocked();
            return;
          }
          if (cancelled) return;
          const aborted = err instanceof DOMException && err.name === "AbortError";
          if (!aborted && !paused) break;
          await sleep(1);
          if (cancelled) return;
        }
      }
      if (cancelled) return;
      if (!played) {
        if (i > 0) callbacks.onSentenceStart?.(i, sentences[i], sentences.length);
        await sleep(estimatedSentenceMs(i));
        elapsedBeforeMs += estimatedSentenceMs(i);
        continue;
      }
      clipActive = true;

      // Her lips for this sentence: its prepared track, read at the element's time less the output
      // latency (in media seconds, so it holds at any speed).
      {
        const el = audio;
        const ctx = audioContext;
        const sentence = i;
        const clock = () => {
          if (cancelled || !el || el.paused || el.ended) return null;
          const latency = ctx ? (ctx.outputLatency || 0) + (ctx.baseLatency || 0) : 0.03;
          return Math.max(0, el.currentTime - latency * (el.playbackRate || 1));
        };
        armLips = () => {
          void trackFor(sentence, blob).then((track) => {
            if (!track || cancelled || audio !== el || el.ended || !clipActive) return;
            lips.stop?.();
            lips.stop = startClipLipSync(track, clock);
          });
        };
        armLips();
      }

      // THE SYNC POINT: the teacher has just started saying sentence i, so the board moves now.
      // Sentence 0's cue was sent before any audio existed, so the board is ready as speech begins.
      if (i > 0) callbacks.onSentenceStart?.(i, sentences[i], sentences.length);

      const clipIndex = i;
      const loop = () => {
        if (cancelled || !audio || paused) return;
        const duration = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : 0;
        const fraction = duration > 0 ? Math.min(1, audio.currentTime / duration) : 0;
        callbacks.onProgress?.(
          sentenceAlignedProgress(weights, clipIndex, fraction),
          elapsedBeforeMs + audio.currentTime * 1000,
          estimatedTotalMs,
        );
        const plan = wordPlans[clipIndex];
        if (plan) {
          const target = fraction * plan.total;
          let wordIndex = plan.cumulative.findIndex((boundary) => target < boundary);
          if (wordIndex === -1) wordIndex = plan.cumulative.length - 1;
          const key = `${clipIndex}:${wordIndex}`;
          if (key !== lastWordKey) {
            lastWordKey = key;
            callbacks.onWordStart?.(wordIndex, clipIndex);
          }
        }
        if (!audio.paused && !audio.ended) progressRaf = window.requestAnimationFrame(loop);
      };
      resumeProgressLoop = loop;
      loop();

      /*
       * A CLIP THAT STOPS MOVING IS NOTICED. The narration waited for "ended" alone, so a clip that
       * stalled — play() refused after a resume, the element stuck — left 38 s of silence with the
       * lecture still "speaking". Every half second: an output the browser suspended is resumed; a
       * clip that should be playing but is not is nudged; one stuck for 8 s is given up, and the
       * lecture goes on with the next sentence rather than going quiet.
       */
      await new Promise<void>((resolve) => {
        let lastTime = -1;
        let stuckSince = performance.now();
        const watchdog = setInterval(() => {
          if (cancelled || !audio) return;
          if (paused) { stuckSince = performance.now(); return; }
          if (audioContext && audioContext.state !== "running") void audioContext.resume().catch(() => {});
          if (audio.currentTime !== lastTime) { lastTime = audio.currentTime; stuckSince = performance.now(); return; }
          const stuck = performance.now() - stuckSince;
          if (stuck > 2_500 && audio.paused && !audio.ended) void audio.play().catch(() => {});
          if (stuck > 8_000) {
            traceNarration("clip-stalled", { sentence: clipIndex, at: audio.currentTime });
            done();
          }
        }, 500);
        const done = () => {
          clearInterval(watchdog);
          clipWaiter = null;
          resolve();
        };
        clipWaiter = done;
        audio!.onended = done;
        audio!.onerror = done;
      });
      clipActive = false;
      armLips = null;
      stopProgressLoop();
      lips.stop?.();
      lips.stop = null;
      if (cancelled) return;
      // A clip given up on (stalled) must not start sounding later, over the next sentence.
      if (!audio.ended) audio.pause();

      elapsedBeforeMs += (Number.isFinite(audio.duration) ? audio.duration : 0) * 1000;
      callbacks.onProgress?.(sentenceAlignedProgress(weights, clipIndex, 1), elapsedBeforeMs, estimatedTotalMs);
      if (i < sentences.length - 1) await sleep(SENTENCE_GAP_MS / rate);
    }

    if (cancelled) return;
    activeNarrationCancelers.delete(cancel);
    stopProgressLoop();
    clearCues();
    if (objectUrl) {
      URL.revokeObjectURL(objectUrl);
      objectUrl = null;
    }
    detachMouthAnalyser(mouthToken);
    mouthToken = undefined;
    // The narration is over: its element is silenced for good and its nodes leave the shared context.
    silenceElement();
    disconnectGraph();
    audioContext = null;
    callbacks.onProgress?.(1, elapsedBeforeMs, elapsedBeforeMs);
    callbacks.onEnd();
  })();

  const setRate = (next: number) => {
    const before = rate;
    rate = clampRate(next);
    // The clip that is playing now changes speed immediately; the ones after it are set as they load.
    if (audio) {
      audio.defaultPlaybackRate = rate;
      audio.playbackRate = rate;
    }
    /*
     * The browser's speech engine cannot re-time an utterance already queued, so its queue kept
     * speaking at the old speed for a few sentences. On a real change the queue is dropped; the
     * timeline speaks the next sentence at the new speed.
     */
    if (browserMode && rate !== before && typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
  };

  return {
    cancel,
    pause,
    resume,
    setRate,
  };
}

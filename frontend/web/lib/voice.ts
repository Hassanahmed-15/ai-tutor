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

import { attachMouthAnalyser, detachMouthAnalyser, type MouthToken } from "./adhd/mouth";
import { CLIP_FETCH_CONCURRENCY, SENTENCE_GAP_MS, sentenceAlignedProgress, sentenceWeight } from "./narrationClock";
import { recordTtsResponse } from "./costLedger";

export type NarrationHandle = {
  cancel: () => void;
  /** Freeze the active narration at its current media timestamp without destroying it. Returns
   *  false when this narration can't be paused, so the caller can fall back to cancel(). */
  pause: () => boolean;
  /** Continue a paused narration from the exact timestamp where it was interrupted. Returns
   *  false if there's nothing resumable. */
  resume: () => boolean;
};

/**
 * Whether narration uses OpenAI cloud TTS by default. ON: real warm teacher voice, plays
 * through the browser's normal <audio> media pipeline (works even where the browser's own
 * speechSynthesis engine is broken/silent), but costs ~$0.015/min of audio per playback.
 * OFF: free browser speechSynthesis (silent on some Chrome-on-macOS setups). Individual
 * callers can still override per call via `cloudTts`. Flip this one constant to disable
 * cloud TTS everywhere.
 */
const CLOUD_TTS_DEFAULT = true;
const CLOUD_TTS_GAIN = 1.45;
const BROWSER_TTS_VOLUME = 1;

export interface NarrationCallbacks {
  onStart: () => void;
  onEnd: () => void;
  /** Fired when the browser silently blocked audio (autoplay policy) — needs a user tap to unlock. */
  onBlocked: () => void;
  /** Fired whenever the teacher starts a new sentence so visuals can follow the exact explanation. */
  onSentenceStart?: (index: number, sentence: string, total: number) => void;
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
  if ("speechSynthesis" in window) {
    // A zero-length utterance still counts as "spoken" for the autoplay gate in most browsers.
    const u = new SpeechSynthesisUtterance(" ");
    u.volume = 0;
    window.speechSynthesis.speak(u);
  }
}

export function splitNarrationSentences(text: string): string[] {
  return text.split(/(?<=[.!?])\s+/).map((sentence) => sentence.trim()).filter(Boolean);
}

export function playNarration(text: string, callbacks: NarrationCallbacks): NarrationHandle {
  if (!callbacks.preserveActive) cancelActiveNarrations();
  const rate = callbacks.rate ?? 1;
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
  /** Wakes the loop awaiting the current clip, so cancel() never leaves it waiting forever. */
  let clipWaiter: (() => void) | null = null;
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
    if (audio) {
      audio.pause();
      audio = null;
    }
    stopProgressLoop();
    detachMouthAnalyser(mouthToken);
    mouthToken = undefined;
    void audioContext?.close();
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
      void audio.play().then(() => resumeProgressLoop?.()).catch(() => callbacks.onBlocked());
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
        activeNarrationCancelers.delete(cancel);
        stopProgressLoop();
        callbacks.onProgress?.(1, estimatedMs, estimatedMs);
        callbacks.onEnd();
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
      const spokenMs = Math.max(2200, sentence.length * 85) / Math.max(0.5, rate);
      setTimeout(cueNext, spokenMs + 240);
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
    const estimatedSentenceMs = (i: number) => Math.max(2200, sentences[i].length * 85) / Math.max(0.5, rate);

    /*
     * Synthesis: sentence 0 first, the rest queued behind it a few at a time. The first clip is a
     * single short sentence rather than a whole beat, so the teacher starts speaking SOONER than the
     * single-clip path allowed; later clips are normally ready before the one before them finishes.
     */
    const resolvers: Array<(blob: Blob | null) => void> = [];
    const clipPromises = sentences.map(
      (_, i) => new Promise<Blob | null>((resolve) => { resolvers[i] = resolve; }),
    );
    let nextToFetch = 0;
    let inFlight = 0;
    const pump = () => {
      while (!cancelled && inFlight < CLIP_FETCH_CONCURRENCY && nextToFetch < sentences.length) {
        const i = nextToFetch;
        nextToFetch += 1;
        inFlight += 1;
        fetch("/api/tts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: sentences[i] }),
        })
          .then((res) => {
            recordTtsResponse(res);
            return res.ok ? res.blob() : null;
          })
          .catch(() => null)
          .then((blob) => resolvers[i](blob))
          .finally(() => {
            inFlight -= 1;
            pump();
          });
      }
    };
    pump();

    // Nothing has played yet, so a first clip that cannot be synthesised falls back exactly as the
    // single-clip path did.
    const firstClip = await clipPromises[0];
    if (cancelled) return;
    if (!firstClip) {
      void browserFallback();
      return;
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
      const AudioContextCtor =
        window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (AudioContextCtor) {
        audioContext = new AudioContextCtor();
        const source = audioContext.createMediaElementSource(audio);
        let tail: AudioNode = source;
        if (CLOUD_TTS_GAIN > 1) {
          const gain = audioContext.createGain();
          gain.gain.value = CLOUD_TTS_GAIN;
          source.connect(gain);
          tail = gain;
        }
        tail.connect(audioContext.destination);
        mouthToken = attachMouthAnalyser(audioContext, tail);
        void audioContext.resume();
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

    callbacks.onStart();

    for (let i = 0; i < sentences.length; i += 1) {
      if (cancelled) return;
      const blob = i === 0 ? firstClip : await clipPromises[i];
      if (cancelled) return;

      /*
       * A sentence that could not be synthesised still happens.
       *
       * Its cue fires and the lecture waits roughly as long as it would take to say, so the board
       * stays in step and the beat advances rather than stalling on one failed request.
       */
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
      audio.volume = 1;

      if (paused) await sleep(1);
      if (cancelled) return;

      try {
        await audio.play();
      } catch (err) {
        // DOMException "NotAllowedError" = autoplay-blocked, not a server/network problem.
        if (err instanceof DOMException && err.name === "NotAllowedError") {
          activeNarrationCancelers.delete(cancel);
          callbacks.onBlocked();
          return;
        }
        if (i > 0) callbacks.onSentenceStart?.(i, sentences[i], sentences.length);
        await sleep(estimatedSentenceMs(i));
        elapsedBeforeMs += estimatedSentenceMs(i);
        continue;
      }
      if (cancelled) return;
      clipActive = true;

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

      await new Promise<void>((resolve) => {
        const done = () => {
          clipWaiter = null;
          resolve();
        };
        clipWaiter = done;
        audio!.onended = done;
        audio!.onerror = done;
      });
      clipActive = false;
      stopProgressLoop();
      if (cancelled) return;

      elapsedBeforeMs += (Number.isFinite(audio.duration) ? audio.duration : 0) * 1000;
      callbacks.onProgress?.(sentenceAlignedProgress(weights, clipIndex, 1), elapsedBeforeMs, estimatedTotalMs);
      if (i < sentences.length - 1) await sleep(SENTENCE_GAP_MS / Math.max(0.5, rate));
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
    void audioContext?.close();
    audioContext = null;
    callbacks.onProgress?.(1, elapsedBeforeMs, elapsedBeforeMs);
    callbacks.onEnd();
  })();

  return {
    cancel,
    pause,
    resume,
  };
}

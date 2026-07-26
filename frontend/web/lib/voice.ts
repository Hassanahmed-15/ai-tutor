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

export type NarrationHandle = {
  cancel: () => void;
  /**
   * Freeze playback in place (keeps position, sentence cue and board progress). Returns false when
   * this narration can't be paused (browser-TTS fallback), so the caller can fall back to a restart.
   */
  pause: () => boolean;
  /** Continue from exactly where pause() stopped. Returns false if there's nothing resumable. */
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
  /** Playback speed multiplier (1 = normal). Applies to both the OpenAI audio element and
   *  the browser TTS fallback's base rate. Defaults to 1. */
  rate?: number;
  /** Override server-side OpenAI TTS for this call. Defaults to CLOUD_TTS_DEFAULT. */
  cloudTts?: boolean;
  /**
   * Don't cancel narrations that are already running. Used for short interjections the teacher makes
   * while a beat is FROZEN mid-sentence (a comprehension question, a re-explanation), so the beat can
   * still resume from where it stopped afterwards instead of replaying from the top.
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
  let audio: HTMLAudioElement | null = null;
  let audioContext: AudioContext | null = null;
  let cueTimers: ReturnType<typeof setTimeout>[] = [];
  let progressRaf = 0;
  let objectUrl: string | null = null;
  // Set by the cloud-TTS path once its <audio> element exists, so the lesson can pause/resume in
  // place instead of cancelling and replaying the beat from the top.
  let pauseImpl: (() => boolean) | null = null;
  let resumeImpl: (() => boolean) | null = null;
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
    if (audio) {
      audio.pause();
      audio = null;
    }
    stopProgressLoop();
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
      const currentMs = Math.min(estimatedMs, performance.now() - startMs);
      callbacks.onProgress?.(estimatedMs > 0 ? currentMs / estimatedMs : 1, currentMs, estimatedMs);
      if (currentMs < estimatedMs) {
        progressRaf = window.requestAnimationFrame(progressLoop);
      }
    };
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

    try {
      const res = await fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      if (!res.ok) throw new Error("tts unavailable");
      const blob = await res.blob();
      if (cancelled) return;
      objectUrl = URL.createObjectURL(blob);
      audio = new Audio(objectUrl);
      audio.playbackRate = rate;
      audio.volume = 1;
      const sentences = splitNarrationSentences(text);
      const weights = sentences.map((sentence) => Math.max(1.35, sentence.length / 13));
      const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
      const cumulative = weights.reduce<number[]>((acc, weight, i) => {
        acc.push((acc[i - 1] ?? 0) + weight);
        return acc;
      }, []);
      let lastCueIndex = initialSentences.length > 0 ? 0 : -1;
      const estimatedDurationMs = Math.max(4200, (totalWeight * 900 + (sentences.length - 1) * 320) / rate);
      const emitAudioClock = () => {
        if (cancelled || !audio) return;
        const durationMs = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration * 1000 : estimatedDurationMs;
        const currentMs = Math.min(durationMs, audio.currentTime * 1000);
        const progress = durationMs > 0 ? Math.max(0, Math.min(1, currentMs / durationMs)) : 0;
        callbacks.onProgress?.(progress, currentMs, durationMs);

        if (sentences.length > 0) {
          const currentWeight = progress * totalWeight;
          const nextBoundaryIndex = cumulative.findIndex((boundary) => currentWeight < boundary);
          const cueIndex = nextBoundaryIndex === -1 ? sentences.length - 1 : nextBoundaryIndex;
          if (cueIndex !== lastCueIndex) {
            lastCueIndex = cueIndex;
            callbacks.onSentenceStart?.(cueIndex, sentences[cueIndex], sentences.length);
          }
        }

        if (!audio.paused && !audio.ended) progressRaf = window.requestAnimationFrame(emitAudioClock);
      };
      try {
        const AudioContextCtor =
          window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (AudioContextCtor && CLOUD_TTS_GAIN > 1) {
          audioContext = new AudioContextCtor();
          const source = audioContext.createMediaElementSource(audio);
          const gain = audioContext.createGain();
          gain.gain.value = CLOUD_TTS_GAIN;
          source.connect(gain).connect(audioContext.destination);
          void audioContext.resume();
        }
      } catch {
        // If Web Audio routing fails, the plain media element still plays at normal volume.
      }
      audio.onended = () => {
        activeNarrationCancelers.delete(cancel);
        stopProgressLoop();
        clearCues();
        if (objectUrl) {
          URL.revokeObjectURL(objectUrl);
          objectUrl = null;
        }
        void audioContext?.close();
        audioContext = null;
        callbacks.onProgress?.(1, audio?.duration ? audio.duration * 1000 : 1, audio?.duration ? audio.duration * 1000 : 1);
        callbacks.onEnd();
      };
      audio.onerror = () => {
        activeNarrationCancelers.delete(cancel);
        stopProgressLoop();
        clearCues();
        if (objectUrl) {
          URL.revokeObjectURL(objectUrl);
          objectUrl = null;
        }
        void audioContext?.close();
        audioContext = null;
        void browserFallback();
      };
      // Pausing the <audio> element freezes the audio clock, which is what drives BOTH the board
      // progress and the sentence cues — so resume continues exactly where it stopped.
      pauseImpl = () => {
        if (cancelled || !audio) return false;
        audio.pause();
        stopProgressLoop();
        return true;
      };
      resumeImpl = () => {
        if (cancelled || !audio || audio.ended) return false;
        void audio.play().catch(() => {});
        stopProgressLoop();
        emitAudioClock();
        return true;
      };
      callbacks.onStart();
      await audio.play();
      emitAudioClock();
    } catch (err) {
      // DOMException "NotAllowedError" = autoplay-blocked, not a server/network problem.
      if (err instanceof DOMException && err.name === "NotAllowedError") {
        activeNarrationCancelers.delete(cancel);
        callbacks.onBlocked();
        return;
      }
      void browserFallback();
    }
  })();

  return {
    cancel,
    pause: () => (pauseImpl ? pauseImpl() : false),
    resume: () => (resumeImpl ? resumeImpl() : false),
  };
}

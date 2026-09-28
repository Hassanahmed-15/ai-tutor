/**
 * Browser-side semantic prefilter for the voice gate.
 *
 * Gemini Live must not see an acoustic candidate merely so we can learn whether its words were
 * addressed to Arya: opening that activity is itself an interruption. Chromium's speech
 * recognizer gives the gate interim words from the same continuously available microphone first.
 * The Web Speech implementation may use the browser vendor's recognition service; this module
 * does not claim that recognition is on-device. Its architectural job is to keep unaccepted audio
 * out of the conversational Gemini Live session.
 * This adapter is deliberately tiny and replaceable; an on-device WASM recognizer can implement
 * the same interface without changing the gate or Gemini transport.
 */

export interface LocalTranscript {
  text: string;
  final: boolean;
}

export interface LocalTranscriber {
  readonly available: boolean;
  start(): void;
  stop(): void;
}

interface RecognitionAlternativeLike { transcript: string }
interface RecognitionResultLike {
  readonly isFinal: boolean;
  readonly length: number;
  [index: number]: RecognitionAlternativeLike;
}
interface RecognitionEventLike {
  readonly resultIndex: number;
  readonly results: { readonly length: number; [index: number]: RecognitionResultLike };
}
interface RecognitionErrorLike { error?: string }
interface RecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: RecognitionEventLike) => void) | null;
  onerror: ((event: RecognitionErrorLike) => void) | null;
  onend: (() => void) | null;
  onstart?: (() => void) | null;
  start(): void;
  stop(): void;
}
type RecognitionConstructor = new () => RecognitionLike;
type RecognitionWindow = Window & typeof globalThis & {
  SpeechRecognition?: RecognitionConstructor;
  webkitSpeechRecognition?: RecognitionConstructor;
};

export function browserSemanticPrefilterAvailable(): boolean {
  if (typeof window === "undefined") return false;
  const w = window as RecognitionWindow;
  return Boolean(w.SpeechRecognition ?? w.webkitSpeechRecognition);
}

export function createBrowserLocalTranscriber(
  onTranscript: (transcript: LocalTranscript) => void,
  language?: string,
  /**
   * Whether the recogniser can currently produce words. The gate waits for words before letting a
   * voice through; when the recogniser has died (permission refused, the vendor service failing,
   * a start that keeps throwing) that wait would never end — "I keep saying Aria and nothing
   * happens". Reported so the gate stops waiting on it. Alive again the moment it hears anything.
   */
  onHealth?: (alive: boolean) => void,
): LocalTranscriber {
  if (typeof window === "undefined") return { available: false, start() {}, stop() {} };
  const w = window as RecognitionWindow;
  const Constructor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
  if (!Constructor) return { available: false, start() {}, stop() {} };

  const recognition = new Constructor();
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.lang = language || document.documentElement.lang || navigator.language || "en-US";
  let wanted = false;
  let running = false;
  let restartTimer: ReturnType<typeof setTimeout> | null = null;
  let failures = 0;
  let alive: boolean | null = null;
  const trace = (event: string) => {
    if (process.env.NODE_ENV !== "production") console.log(`[voice] recogniser ${event}`);
  };
  const report = (next: boolean) => {
    if (alive === next) return;
    alive = next;
    onHealth?.(next);
  };

  const scheduleRestart = (delay: number) => {
    if (restartTimer) clearTimeout(restartTimer);
    restartTimer = setTimeout(() => {
      restartTimer = null;
      restart();
    }, delay);
  };

  const restart = () => {
    if (!wanted || running) return;
    try {
      recognition.start();
      running = true;
    } catch {
      /*
       * Chrome throws while an earlier instance is still winding down — and a start that throws
       * never ends, so no `onend` would ever come to retry it. The recogniser used to stay off for
       * the rest of the session. Retry with backoff; after several failures, report it dead.
       */
      failures += 1;
      if (failures >= 3) report(false);
      scheduleRestart(Math.min(4_000, 250 * 2 ** Math.min(failures, 4)));
    }
  };

  recognition.onstart = () => {
    running = true;
    trace("started");
  };
  recognition.onresult = (event) => {
    failures = 0;
    report(true);
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const result = event.results[i];
      const text = result[0]?.transcript?.trim();
      if (text && result.isFinal) trace(`heard: "${text.slice(0, 60)}"`);
      if (text) onTranscript({ text, final: result.isFinal });
    }
  };
  recognition.onerror = (event) => {
    trace(`error: ${event.error ?? "unknown"}`);
    // "no-speech" and "aborted" are normal in an always-on recognizer. Permission denial is not
    // retried; the PCM gate stops waiting on words and uses its fallback.
    if (event.error === "no-speech" || event.error === "aborted") return;
    if (event.error === "not-allowed" || event.error === "service-not-allowed" || event.error === "audio-capture") {
      wanted = false;
      report(false);
      return;
    }
    // "network" and the like: the vendor service is failing. Several in a row without a single
    // word means it is not coming back on its own.
    failures += 1;
    if (failures >= 3) report(false);
  };
  recognition.onend = () => {
    running = false;
    if (!wanted) return;
    scheduleRestart(failures > 0 ? Math.min(4_000, 250 * 2 ** Math.min(failures, 4)) : 120);
  };

  return {
    available: true,
    start() {
      wanted = true;
      restart();
    },
    stop() {
      wanted = false;
      if (restartTimer) clearTimeout(restartTimer);
      restartTimer = null;
      if (!running) return;
      try { recognition.stop(); } catch { /* already stopped */ }
      running = false;
    },
  };
}

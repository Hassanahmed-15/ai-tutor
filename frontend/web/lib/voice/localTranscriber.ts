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

  const restart = () => {
    if (!wanted || running) return;
    try {
      recognition.start();
      running = true;
    } catch {
      // Chrome throws while an earlier recognition instance is still winding down. onend retries.
    }
  };

  recognition.onresult = (event) => {
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const result = event.results[i];
      const text = result[0]?.transcript?.trim();
      if (text) onTranscript({ text, final: result.isFinal });
    }
  };
  recognition.onerror = (event) => {
    // "no-speech" and transient audio errors are normal in an always-on recognizer. Permission
    // denial is not retried; the PCM gate remains active and uses its conservative fallback.
    if (event.error === "not-allowed" || event.error === "service-not-allowed") wanted = false;
  };
  recognition.onend = () => {
    running = false;
    if (!wanted) return;
    restartTimer = setTimeout(restart, 120);
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

/**
 * WORDS, BEFORE ANY AUDIO LEAVES THE PAGE — the browser recogniser as the semantic prefilter.
 *
 * The arbiter needs to know whether the words were for the tutor BEFORE a turn is committed, and
 * it must not open a model session merely to find out. Chromium's continuous recogniser gives
 * interim words within a few hundred milliseconds from the same microphone. Its own endpointing is
 * ignored: the endpointer decides where turns start and end, the recogniser only supplies text.
 * Every result is logged as a transcription event.
 */

export interface Transcript {
  text: string;
  final: boolean;
  at: number;
}

export interface Transcriber {
  readonly available: boolean;
  start(): void;
  stop(): void;
}

interface RecognitionAlternativeLike { transcript: string }
interface RecognitionResultLike { readonly isFinal: boolean; readonly length: number; [index: number]: RecognitionAlternativeLike }
interface RecognitionEventLike { readonly resultIndex: number; readonly results: { readonly length: number; [index: number]: RecognitionResultLike } }
interface RecognitionErrorLike { error?: string }
interface RecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: RecognitionEventLike) => void) | null;
  onerror: ((event: RecognitionErrorLike) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
type RecognitionConstructor = new () => RecognitionLike;
type RecognitionWindow = Window & typeof globalThis & { SpeechRecognition?: RecognitionConstructor; webkitSpeechRecognition?: RecognitionConstructor };

export function transcriberAvailable(): boolean {
  if (typeof window === "undefined") return false;
  const w = window as RecognitionWindow;
  return Boolean(w.SpeechRecognition ?? w.webkitSpeechRecognition);
}

export function createTranscriber(
  onTranscript: (transcript: Transcript) => void,
  onStatus: (status: "started" | "ended" | "error" | "restarting", detail: string) => void,
  language?: string,
): Transcriber {
  if (typeof window === "undefined") return { available: false, start() {}, stop() {} };
  const w = window as RecognitionWindow;
  const Constructor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
  if (!Constructor) return { available: false, start() {}, stop() {} };

  const recognition = new Constructor();
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.lang = language || navigator.language || "en-US";
  let wanted = false;
  let running = false;
  let restartTimer: ReturnType<typeof setTimeout> | null = null;

  const restart = () => {
    if (!wanted || running) return;
    try {
      recognition.start();
    } catch {
      // Chrome throws while an earlier instance is still winding down; onend retries.
    }
  };
  recognition.onstart = () => { running = true; onStatus("started", "recogniser listening"); };
  recognition.onresult = (event) => {
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const result = event.results[i];
      const text = result[0]?.transcript?.trim();
      if (text) onTranscript({ text, final: result.isFinal, at: performance.now() });
    }
  };
  recognition.onerror = (event) => {
    onStatus("error", event.error ?? "unknown");
    if (event.error === "not-allowed" || event.error === "service-not-allowed") wanted = false;
  };
  recognition.onend = () => {
    running = false;
    onStatus("ended", wanted ? "recogniser ended; restarting" : "recogniser stopped");
    if (!wanted) return;
    restartTimer = setTimeout(() => { onStatus("restarting", ""); restart(); }, 120);
  };

  return {
    available: true,
    start() { wanted = true; restart(); },
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

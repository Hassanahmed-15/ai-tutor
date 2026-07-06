"use client";

/**
 * Shared Web Speech API helpers (the browser's built-in speech recognition). Extracted from
 * DysgraphiaLessonPlayer so the lesson chat's voice input and the dysgraphia scribe both use
 * one implementation. The standard TS DOM lib doesn't type SpeechRecognition, so we declare
 * a minimal shape.
 */

export interface SpeechRecognitionResultLike {
  resultIndex: number;
  results: { [i: number]: { [j: number]: { transcript: string }; isFinal: boolean }; length: number };
}
export interface SpeechRecognitionLike extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((ev: SpeechRecognitionResultLike) => void) | null;
  onerror: ((ev: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
}

export function getSpeechRecognition(): SpeechRecognitionLike | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: new () => SpeechRecognitionLike;
    webkitSpeechRecognition?: new () => SpeechRecognitionLike;
  };
  const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
  return Ctor ? new Ctor() : null;
}

export function isSpeechSupported(): boolean {
  return getSpeechRecognition() !== null;
}

export interface VoiceCaptureHandle {
  stop: () => void;
}

/**
 * Captures one spoken utterance. Calls `onInterim` with live partial text (for a "listening…"
 * display), `onFinal` with the complete transcript when the user stops or pauses, and
 * `onError` on failure. Returns a handle to stop early. Designed for "speak one question".
 */
export function captureVoice(callbacks: {
  onInterim?: (text: string) => void;
  onFinal: (text: string) => void;
  onError?: (message: string) => void;
}): VoiceCaptureHandle | null {
  const recognition = getSpeechRecognition();
  if (!recognition) {
    callbacks.onError?.("Voice input isn't supported in this browser.");
    return null;
  }
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.lang = "en-US";

  let finalTranscript = "";
  let done = false;

  recognition.onresult = (ev) => {
    let interim = "";
    for (let i = ev.resultIndex; i < ev.results.length; i++) {
      const result = ev.results[i];
      const transcript = result[0]?.transcript ?? "";
      if (result.isFinal) finalTranscript += `${transcript} `;
      else interim += transcript;
    }
    callbacks.onInterim?.(`${finalTranscript} ${interim}`.trim());
  };
  recognition.onerror = (e) => {
    if (done) return;
    done = true;
    callbacks.onError?.(e.error || "I couldn't hear you clearly.");
  };
  recognition.onend = () => {
    if (done) return;
    done = true;
    const text = finalTranscript.trim();
    if (text) callbacks.onFinal(text);
    else callbacks.onError?.("I didn't catch that — try again.");
  };

  recognition.start();
  return { stop: () => recognition.stop() };
}

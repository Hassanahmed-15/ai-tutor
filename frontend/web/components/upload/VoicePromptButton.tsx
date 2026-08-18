"use client";

import { useEffect, useRef, useState } from "react";
import { Mic, Square } from "lucide-react";
import { captureVoice, isSpeechSupported, type VoiceCaptureHandle } from "@/lib/speech";

/**
 * Dictate a prompt instead of typing it.
 *
 * Reuses `lib/speech.ts`, which the blind and dysgraphia players already use, rather than adding a
 * second speech implementation — one place to fix when a browser changes its behaviour.
 *
 * Live partial text is written straight into the field via `onTranscript` as it is recognised, so
 * what the student sees is the actual prompt that will be submitted, not a separate preview they
 * then have to accept. `baseText` keeps anything already typed: dictation appends to it rather than
 * silently discarding it.
 *
 * Renders nothing when the browser has no speech recognition (Firefox, most in-app webviews). A
 * button that cannot work is worse than no button, and the field beside it still accepts typing.
 */
export function VoicePromptButton({
  baseText,
  onTranscript,
  className,
  title = "Dictate your prompt",
  showLabel = false,
}: {
  baseText: string;
  onTranscript: (text: string) => void;
  className?: string;
  title?: string;
  /** Render text beside the icon. For places where a bare icon would read as decoration. */
  showLabel?: boolean;
}) {
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const handleRef = useRef<VoiceCaptureHandle | null>(null);
  // Read at start rather than on every result, so words spoken mid-utterance are not appended to a
  // field that dictation is itself rewriting.
  const baseRef = useRef("");

  // Support is checked after mount: `window` does not exist during SSR, and rendering the button
  // on the server then removing it on hydration would flash a control that never works.
  useEffect(() => setSupported(isSpeechSupported()), []);

  // Stop the microphone if this unmounts mid-utterance, otherwise recognition keeps running with
  // nowhere to deliver its result.
  useEffect(() => () => handleRef.current?.stop(), []);

  if (!supported) return null;

  function stop() {
    handleRef.current?.stop();
    handleRef.current = null;
    setListening(false);
  }

  function start() {
    setError(null);
    baseRef.current = baseText.trim();
    const join = (text: string) => (baseRef.current ? `${baseRef.current} ${text}` : text);
    handleRef.current = captureVoice({
      onInterim: (text) => onTranscript(join(text)),
      onFinal: (text) => {
        onTranscript(join(text));
        handleRef.current = null;
        setListening(false);
      },
      onError: (message) => {
        setError(message);
        handleRef.current = null;
        setListening(false);
      },
    });
    if (handleRef.current) setListening(true);
  }

  return (
    <>
      <button
        type="button"
        onClick={() => (listening ? stop() : start())}
        aria-label={listening ? "Stop dictating" : title}
        aria-pressed={listening}
        title={listening ? "Stop dictating" : title}
        className={
          className ??
          "grid size-9 shrink-0 place-items-center rounded-[var(--radius)] transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--hud-cyan)]"
        }
        style={{
          color: listening ? "var(--hud-bg)" : "var(--hud-text-dim)",
          background: listening ? "var(--hud-cyan)" : "transparent",
          borderColor: listening ? "var(--hud-cyan)" : "var(--hud-line)",
          transitionDuration: "var(--motion-fast)",
        }}
      >
        {listening ? (
          <Square aria-hidden="true" size={showLabel ? 12 : 14} strokeWidth={2.4} />
        ) : (
          <Mic aria-hidden="true" size={showLabel ? 13 : 17} strokeWidth={1.8} />
        )}
        {showLabel && <span>{listening ? "Stop" : "Speak"}</span>}
      </button>
      {/* Announced, not just shown — a student who is dictating may not be looking at the screen. */}
      <span aria-live="polite" className="sr-only">
        {listening ? "Listening" : error ?? ""}
      </span>
      {error && !listening && (
        <span role="status" className="text-[0.72rem] text-[var(--hud-danger)]">
          {error}
        </span>
      )}
    </>
  );
}

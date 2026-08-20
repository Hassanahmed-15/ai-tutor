"use client";

import { useEffect, useRef } from "react";
import type { GeminiLiveStatus } from "@/lib/useGeminiLiveTutor";

/**
 * The only screen in voice mode.
 *
 * DESIGNED FOR RESIDUAL SIGHT, NOT FOR SIGHT. Most people who select this mode have some usable
 * vision, so the transcript is set very large and at maximum contrast, with speakers separated by
 * position and colour rather than by a small label. Nothing here is required to operate the tutor —
 * everything shown is also spoken — so a screen reader user loses nothing by ignoring it entirely.
 *
 * The transcript is an `aria-live` log so a screen reader announces new lines as they arrive,
 * rather than the user having to go looking for them.
 *
 * There is exactly one control: a way out. Everything else happens by talking, and a screen full of
 * buttons would contradict the mode.
 */

export type TranscriptLine = {
  id: string;
  role: "student" | "tutor";
  text: string;
  final: boolean;
};

type LectureSummary = {
  status: string;
  topic: string;
  beats: unknown[];
  index: number;
};

export function VoiceTranscript({
  lines,
  status,
  connected,
  lecture,
  error,
  onExit,
  onRetryConnect,
}: {
  lines: TranscriptLine[];
  status: GeminiLiveStatus;
  connected: boolean;
  lecture: LectureSummary;
  error: string | null;
  onExit: () => void;
  onRetryConnect: () => void;
}) {
  const endRef = useRef<HTMLDivElement>(null);

  // Follow the conversation. `smooth` is avoided: with lines arriving every few hundred ms the
  // animation never settles, which is uncomfortable for exactly the low-vision readers this view
  // is for.
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [lines]);

  /**
   * One plain sentence describing what the app is doing.
   *
   * Written as prose rather than a status code because a screen reader reads it aloud — "Connecting
   * to the tutor" is useful where "CONNECTING" is an abbreviation the listener has to decode.
   */
  const stateLine = (() => {
    if (status === "mic-denied") return "The microphone is blocked. Allow microphone access to continue.";
    if (status === "error") return error ?? "The connection failed.";
    if (status === "connecting") return "Connecting to the tutor.";
    if (status === "idle") return "Not connected.";
    if (lecture.status === "building") return `Preparing a lecture on ${lecture.topic}. This takes a few minutes.`;
    if (lecture.status === "playing") return `Lecture in progress — section ${lecture.index + 1} of ${lecture.beats.length}.`;
    if (lecture.status === "paused") return `Paused at section ${lecture.index + 1} of ${lecture.beats.length}.`;
    if (lecture.status === "finished") return "The lecture is complete.";
    if (lecture.status === "ready") return "The lecture is ready.";
    return "Listening.";
  })();

  const needsRetry = status === "error" || status === "mic-denied";

  /**
   * The one gesture the browser requires.
   *
   * Microphone access cannot be requested without a user action, so the session genuinely cannot
   * start on its own. Rather than a small "Reconnect" chip somewhere on the page, the whole screen
   * becomes the button — impossible to miss with low vision, impossible to mis-tap, and reachable
   * with a single Tab-then-Enter for anyone on a keyboard. It is autofocused so a screen reader
   * lands on it and reads what it does immediately.
   */
  if (status === "idle") {
    return (
      <main className="flex min-h-screen items-center justify-center p-6" style={{ background: "#000", color: "#fff" }}>
        <button
          type="button"
          autoFocus
          onClick={onRetryConnect}
          className="flex h-full min-h-[70vh] w-full max-w-3xl flex-col items-center justify-center gap-6 rounded-3xl border px-8 text-center"
          style={{ borderColor: "#444", background: "#0a0a0a" }}
        >
          <span className="text-[3rem] font-semibold leading-tight">Start</span>
          <span className="text-[1.6rem] leading-relaxed" style={{ color: "#c8c8c8" }}>
            Press to begin talking with Aria. She will ask what you would like to learn.
          </span>
        </button>
      </main>
    );
  }

  return (
    <main
      className="flex min-h-screen flex-col"
      // Pure black and near-white, rather than the app's usual tinted surfaces: this is the one
      // screen where maximum contrast matters more than house style.
      style={{ background: "#000", color: "#fff" }}
    >
      <header
        className="flex shrink-0 items-center justify-between gap-4 border-b px-6 py-4"
        style={{ borderColor: "#333" }}
      >
        <div className="min-w-0">
          <h1 className="text-[1.4rem] font-semibold tracking-tight">Aria</h1>
          {/* The status is announced when it changes, so a listener is told the lecture finished or
              the build failed without having to ask. */}
          <p aria-live="polite" className="mt-0.5 truncate text-[1.05rem]" style={{ color: "#c8c8c8" }}>
            {stateLine}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-3">
          {/* A speaking/listening indicator with a text alternative, not colour alone. */}
          <span
            className="inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-[0.95rem]"
            style={{ background: connected ? "#0d3b1e" : "#3b0d0d", color: connected ? "#7dffb0" : "#ff9a9a" }}
          >
            <span
              aria-hidden="true"
              className="size-2.5 rounded-full"
              style={{ background: connected ? "#3ee87f" : "#ff5c5c" }}
            />
            {connected ? "Live" : "Offline"}
          </span>

          {needsRetry && (
            <button
              type="button"
              onClick={onRetryConnect}
              className="rounded-[var(--radius)] px-4 py-2 text-[1rem] font-medium"
              style={{ background: "#fff", color: "#000" }}
            >
              Reconnect
            </button>
          )}

          <button
            type="button"
            onClick={onExit}
            className="rounded-[var(--radius)] border px-4 py-2 text-[1rem]"
            style={{ borderColor: "#666", color: "#fff" }}
          >
            Leave
          </button>
        </div>
      </header>

      {/* The conversation. `log` + polite so new lines are announced in order without stealing
          focus from whatever the user is doing. */}
      <div
        role="log"
        aria-live="polite"
        aria-label="Conversation"
        className="flex-1 overflow-y-auto px-6 py-8"
      >
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-7">
          {lines.length === 0 && (
            <p className="text-[1.6rem] leading-relaxed" style={{ color: "#8a8a8a" }}>
              Say what you would like to learn.
            </p>
          )}

          {lines.map((line) => {
            const isStudent = line.role === "student";
            return (
              <div key={line.id} className={isStudent ? "self-end text-right" : "self-start"} style={{ maxWidth: "90%" }}>
                <p
                  className="mb-1 text-[0.95rem] uppercase tracking-[0.14em]"
                  style={{ color: isStudent ? "#8fd0ff" : "#9a9a9a" }}
                >
                  {isStudent ? "You" : "Aria"}
                </p>
                <p
                  // Large by default. Line height is generous because long spoken sentences wrap
                  // several times and tight leading is where low-vision readers lose their place.
                  className="text-[1.85rem] leading-[1.5]"
                  style={{
                    color: isStudent ? "#dcefff" : "#ffffff",
                    // An unfinished line is dimmed rather than hidden, so the reader can watch
                    // recognition arrive instead of waiting for a line to appear all at once.
                    opacity: line.final ? 1 : 0.72,
                  }}
                >
                  {line.text}
                </p>
              </div>
            );
          })}
          <div ref={endRef} />
        </div>
      </div>
    </main>
  );
}

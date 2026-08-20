"use client";

import { useEffect, useRef, useState } from "react";
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

/**
 * Shows — and periodically announces — that a lecture is being built.
 *
 * Two audiences, one component. For low vision there is a large bar with a moving progress fill and
 * a running elapsed count, so the screen visibly changes and the wait is legible at a glance. For a
 * screen reader there is a separate polite live region that re-announces roughly every 20 seconds:
 * a status that is written once is announced once, which is exactly the failure being fixed — after
 * that, nothing tells the listener the system is still alive.
 *
 * The announcement text CHANGES each time ("about a minute in", "about two minutes in"). An
 * aria-live region whose content is identical is often not re-announced at all, so a static
 * "Still building" would be silently dropped by the very users who need it most.
 */
function BuildIndicator({ topic }: { topic: string }) {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(timer);
  }, []);

  // Roughly four minutes is typical; the bar is a reassurance that something is happening, not a
  // precise estimate, and it eases toward the end rather than pretending to complete.
  const fraction = Math.min(0.96, seconds / 240);

  const announcement = (() => {
    const minutes = Math.floor(seconds / 60);
    if (seconds < 20) return `Building your lecture on ${topic}. This usually takes three to five minutes.`;
    if (minutes < 1) return `Still building your lecture on ${topic}. Under a minute so far.`;
    return `Still building your lecture on ${topic}. About ${minutes} minute${minutes === 1 ? "" : "s"} so far.`;
  })();

  return (
    <div className="shrink-0 border-b px-6 py-5" style={{ borderColor: "#333", background: "#0c0c0c" }}>
      <div className="mx-auto w-full max-w-3xl">
        <p className="text-[1.5rem] font-semibold">Building your lecture</p>
        <p className="mt-1 text-[1.15rem]" style={{ color: "#c8c8c8" }}>
          {topic} — {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, "0")} elapsed, usually three to five minutes
        </p>

        <div
          className="mt-3 h-3 w-full overflow-hidden rounded-full"
          style={{ background: "#242424" }}
          role="progressbar"
          aria-label="Lecture build progress"
          aria-valuetext={announcement}
        >
          <div
            className="h-full rounded-full"
            style={{ width: `${fraction * 100}%`, background: "#3ee87f", transition: "width 1s linear" }}
          />
        </div>

        {/* Re-announced on a slow cadence, keyed so the text genuinely changes. */}
        <p aria-live="polite" className="sr-only">
          {seconds % 20 === 0 ? announcement : ""}
        </p>
      </div>
    </div>
  );
}

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
    // Not repeated here: the build banner below carries this, with a live timer. Saying it twice
    // means a screen reader announces the same fact from two places.
    if (lecture.status === "building") return "Listening.";
    if (lecture.status === "playing") return `Lecture in progress — section ${lecture.index + 1} of ${lecture.beats.length}.`;
    if (lecture.status === "paused") return `Paused at section ${lecture.index + 1} of ${lecture.beats.length}.`;
    if (lecture.status === "finished") return "The lecture is complete.";
    if (lecture.status === "ready") return "The lecture is ready.";
    return "Listening.";
  })();

  const needsRetry = status === "error" || status === "mic-denied";

  /**
   * Starting without needing to FIND anything.
   *
   * A microphone still cannot be opened without a user gesture — that is a browser rule, not a
   * design choice. But requiring someone to locate a button on screen was the wrong conclusion to
   * draw from it. Three things fix that:
   *
   *   1. The page SPEAKS on arrival, via speechSynthesis, which needs no permission and no gesture.
   *      The student is told what to do instead of having to discover it.
   *   2. ANY key and a click ANYWHERE count as the gesture. There is nothing to aim at, so nothing
   *      to miss — the whole window is the target.
   *   3. The prompt is still rendered, large, for anyone who is looking.
   *
   * The listener is attached to the window rather than to a focused element so it works no matter
   * where a screen reader has left focus.
   */
  useEffect(() => {
    if (status !== "idle") return;

    const spoken =
      "Aria is ready. Press any key, or tap anywhere, and tell me what you would like to learn.";
    // Cancel anything queued from a previous visit, otherwise Chrome stacks utterances.
    try {
      window.speechSynthesis?.cancel();
      const utterance = new SpeechSynthesisUtterance(spoken);
      utterance.rate = 1;
      window.speechSynthesis?.speak(utterance);
    } catch {
      // No speech synthesis: the on-screen text and the any-key handler still work.
    }

    const begin = () => {
      window.speechSynthesis?.cancel();
      onRetryConnect();
    };
    window.addEventListener("keydown", begin, { once: true });
    window.addEventListener("pointerdown", begin, { once: true });
    return () => {
      window.removeEventListener("keydown", begin);
      window.removeEventListener("pointerdown", begin);
      window.speechSynthesis?.cancel();
    };
  }, [status, onRetryConnect]);

  if (status === "idle") {
    return (
      <main
        className="flex min-h-screen cursor-pointer items-center justify-center p-6 text-center"
        style={{ background: "#000", color: "#fff" }}
      >
        {/* Announced immediately, so a screen reader reads it without the user going looking. */}
        <div role="status" aria-live="assertive" className="max-w-3xl">
          <p className="text-[3rem] font-semibold leading-tight">Aria is ready</p>
          <p className="mt-6 text-[1.7rem] leading-relaxed" style={{ color: "#c8c8c8" }}>
            Press any key, or tap anywhere, and tell me what you would like to learn.
          </p>
        </div>
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

      {/* A build indicator that does NOT depend on the tutor talking.
          If Gemini goes quiet, silence must not be indistinguishable from a crash — so the app
          itself shows progress and, separately, announces it on a slow timer. */}
      {lecture.status === "building" && <BuildIndicator topic={lecture.topic} />}

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

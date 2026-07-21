"use client";

import { HudEyebrow } from "../hud/HudKit";
import type { RealtimeStatus } from "@/lib/useRealtimeTutor";

/**
 * Live-tutor conversation panel (full-duplex realtime session). Shows connection state, a live
 * transcript for accessibility, a mute toggle, an end-call button, and a "live — costs apply"
 * indicator. Purely presentational — the session lives in useRealtimeTutor (see LessonPlayer).
 */
export function LiveTutorPanel({
  status,
  speaking,
  muted,
  errorMessage,
  transcript,
  onMuteToggle,
  onEnd,
}: {
  status: RealtimeStatus;
  speaking: boolean;
  muted: boolean;
  errorMessage: string | null;
  transcript: Array<{ role: "student" | "tutor"; text: string }>;
  onMuteToggle: () => void;
  onEnd: () => void;
}) {
  const stateLabel =
    status === "connecting"
      ? "Connecting…"
      : status === "drawing"
        ? "Drawing an explanation…"
        : status === "mic-denied"
          ? "Microphone blocked"
          : status === "blocked"
            ? "Tap to allow audio"
            : status === "error"
              ? "Connection error"
              : speaking
                ? "Tutor is speaking…"
                : "Listening…";

  const live = status === "live" || status === "drawing" || status === "connecting";

  return (
    <div className="hud-materialize absolute inset-x-0 bottom-0 z-40 border-t border-[var(--hud-cyan)]/25 bg-black/92 p-4 backdrop-blur-md">
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span
            className={`inline-block size-3 rounded-full ${
              speaking ? "bg-[var(--hud-cyan)] animate-pulse" : status === "connecting" ? "bg-amber-400 animate-pulse" : "bg-rose-400 animate-pulse"
            }`}
          />
          <div>
            <HudEyebrow>Live tutor</HudEyebrow>
            <p className="mt-0.5 text-sm font-bold text-white">{stateLabel}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {live && (
            <span className="rounded-full bg-rose-500/15 px-3 py-1 text-[10px] font-black uppercase tracking-[0.16em] text-rose-300">
              ● live — costs apply
            </span>
          )}
          <button
            onClick={onMuteToggle}
            disabled={!live}
            className="hud-btn-ghost rounded-full px-4 py-1.5 text-xs font-bold disabled:opacity-40"
          >
            {muted ? "🔇 Unmute" : "🎙 Mute"}
          </button>
          <button onClick={onEnd} className="rounded-full bg-rose-500/90 px-4 py-1.5 text-xs font-black text-white hover:bg-rose-500">
            End call
          </button>
        </div>
      </div>

      {errorMessage && <p className="mb-2 text-xs font-semibold text-rose-300">{errorMessage}</p>}
      {status === "mic-denied" && (
        <p className="mb-2 text-xs font-semibold text-amber-300">
          Microphone access was blocked. Allow the mic in your browser and try again.
        </p>
      )}

      <div className="max-h-32 space-y-1.5 overflow-y-auto rounded-xl bg-white/5 p-3" aria-live="polite">
        {transcript.length === 0 ? (
          <p className="text-xs italic text-[var(--hud-text-faint)]">Say hello, ask a question, or ask to see a diagram…</p>
        ) : (
          transcript.map((line, i) => (
            <p key={i} className="text-sm leading-snug">
              <span className={`font-black ${line.role === "tutor" ? "text-[var(--hud-cyan)]" : "text-rose-300"}`}>
                {line.role === "tutor" ? "Aria: " : "You: "}
              </span>
              <span className="text-white/90">{line.text}</span>
            </p>
          ))
        )}
      </div>
    </div>
  );
}

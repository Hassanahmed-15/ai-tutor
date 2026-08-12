"use client";

import {
  AlertTriangle,
  PenTool,
  Loader2,
  MicOff,
  Pause,
  RadioTower,
  Sparkles,
  Volume2,
  WifiOff,
  type LucideIcon,
} from "lucide-react";

/**
 * WHO IS SPEAKING — the single most important thing the classroom communicates.
 *
 * The brief lists ten voice states. `useRealtimeTutor` already exposes a status union plus
 * `speaking` / `isSpeaking` / `muted` flags, so this component derives the display state from
 * that existing surface rather than introducing a second source of truth. Nothing here talks to
 * the audio pipeline — it only renders what the hook already knows.
 *
 * ACCESSIBILITY. Each state carries three independent signals: colour, a distinct icon, and a
 * text label. A colour-blind student and a screen-reader user both get the full meaning, which
 * is WCAG 2.2 AA 1.4.1 (use of colour). The container is an `aria-live` region so a state change
 * is announced without stealing focus mid-lecture.
 */
export type VoicePhase =
  | "connecting"
  | "ready"
  | "listening"
  | "student-speaking"
  | "thinking"
  | "drawing"
  | "aria-speaking"
  | "paused"
  | "reconnecting"
  | "mic-blocked"
  | "failed";

const STATES: Record<VoicePhase, { label: string; hint: string; icon: LucideIcon; fg: string; bg: string }> = {
  connecting:        { label: "Connecting",      hint: "Opening the voice channel",        icon: Loader2,       fg: "var(--hud-text-dim)", bg: "var(--hud-surface)" },
  ready:             { label: "Ready",           hint: "Aria is ready to begin",           icon: RadioTower,    fg: "var(--ok)",           bg: "var(--ok-dim)" },
  listening:         { label: "Listening",       hint: "Your microphone is open",          icon: RadioTower,    fg: "var(--listening)",    bg: "var(--listening-dim)" },
  "student-speaking":{ label: "You're speaking", hint: "Aria has stopped to listen",       icon: RadioTower,    fg: "var(--listening)",    bg: "var(--listening-dim)" },
  thinking:          { label: "Thinking",        hint: "Aria is working out a reply",      icon: Loader2,       fg: "var(--speaking)",     bg: "var(--speaking-dim)" },
  drawing:           { label: "Teacher is drawing… please wait", hint: "A new board is being generated", icon: PenTool, fg: "var(--speaking)", bg: "var(--speaking-dim)" },
  "aria-speaking":   { label: "Aria is speaking",hint: "Interrupt any time — just talk",   icon: Volume2,       fg: "var(--speaking)",     bg: "var(--speaking-dim)" },
  paused:            { label: "Paused",          hint: "The lecture is held",              icon: Pause,         fg: "var(--hud-warn)",     bg: "var(--warn-dim)" },
  reconnecting:      { label: "Reconnecting",    hint: "The connection dropped — retrying",icon: WifiOff,       fg: "var(--hud-warn)",     bg: "var(--warn-dim)" },
  "mic-blocked":     { label: "Microphone blocked", hint: "Allow microphone access to talk", icon: MicOff,      fg: "var(--hud-danger)",   bg: "var(--danger-dim)" },
  failed:            { label: "Connection failed", hint: "Voice is unavailable",           icon: AlertTriangle, fg: "var(--hud-danger)",   bg: "var(--danger-dim)" },
};

/**
 * Maps the tutor hook's existing state onto a display phase.
 *
 * Ordering matters and encodes the barge-in contract: a student who starts talking outranks
 * everything, because the interface must visibly enter the listening state the instant Aria's
 * audio is cut. Aria speaking is checked only after that.
 */
export function derivePhase(input: {
  status: string;
  ariaSpeaking: boolean;
  studentSpeaking: boolean;
  muted: boolean;
  paused: boolean;
}): VoicePhase {
  const { status, ariaSpeaking, studentSpeaking, muted, paused } = input;
  if (status === "mic-denied" || status === "blocked") return "mic-blocked";
  if (status === "error") return "failed";
  if (status === "connecting") return "connecting";
  if (studentSpeaking) return "student-speaking";
  if (paused) return "paused";
  if (status === "drawing") return "drawing";
  if (ariaSpeaking) return "aria-speaking";
  if (status === "live") return muted ? "ready" : "listening";
  return "ready";
}

export function VoiceState({ phase, className = "" }: { phase: VoicePhase; className?: string }) {
  const s = STATES[phase];
  const Icon = s.icon;
  const spins = phase === "connecting" || phase === "thinking" || phase === "drawing";

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={`${s.label}. ${s.hint}`}
      className={`flex items-center gap-2.5 rounded-[var(--radius)] px-3 py-2 ${className}`}
      style={{ background: s.bg, color: s.fg }}
    >
      <Icon aria-hidden="true" size={15} className={spins ? "animate-spin" : ""} strokeWidth={2} />
      <span className="text-[0.8rem] font-medium leading-none whitespace-nowrap">{s.label}</span>
    </div>
  );
}

/**
 * A speaking-channel meter. Two fixed bars — Aria and You — where only the active one lights.
 * This exists because "who is talking" read from a single changing label is easy to miss in
 * peripheral vision during a lecture; two lanes make it glanceable.
 */
export function SpeakerLanes({ ariaSpeaking, studentSpeaking }: { ariaSpeaking: boolean; studentSpeaking: boolean }) {
  return (
    <div className="flex items-center gap-3" aria-hidden="true">
      {(
        [
          ["Aria", ariaSpeaking, "var(--speaking)"],
          ["You", studentSpeaking, "var(--listening)"],
        ] as const
      ).map(([who, active, colour]) => (
        <div key={who} className="flex items-center gap-1.5">
          <span
            className="h-1 w-8 rounded-full transition-colors"
            style={{
              background: active ? colour : "var(--hud-line)",
              transitionDuration: "var(--motion-fast)",
            }}
          />
          <span
            className="text-[0.68rem] leading-none transition-colors"
            style={{ color: active ? colour : "var(--hud-text-faint)", transitionDuration: "var(--motion-fast)" }}
          >
            {who}
          </span>
        </div>
      ))}
    </div>
  );
}

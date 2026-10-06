"use client";

import { useEffect, useState } from "react";
import type { TeacherQuiz } from "@/lib/useTeacherQuiz";

/**
 * The card shown while the TEACHER has stopped to ask the student something — the on-screen half of
 * `useTeacherQuiz`. It shows what she asked, what she is hearing back, and her verdict.
 *
 * The typed box is a real fallback, not decoration: `captureVoice` is Web Speech API and doesn't
 * exist outside Chromium, so without it the student would have no way to answer at all.
 */
export function QuizPrompt({
  quiz,
  accentVar = "var(--hud-cyan)",
  onSkip,
}: {
  quiz: TeacherQuiz;
  accentVar?: string;
  /** Lets the student wave the question away and carry on. */
  onSkip: () => void;
}) {
  const [typed, setTyped] = useState("");
  useEffect(() => {
    if (quiz.phase === "asking") setTyped("");
  }, [quiz.phase]);

  if (quiz.phase === "idle") return null;

  const status =
    quiz.phase === "asking"
      ? "Listen…"
      : quiz.phase === "listening"
        ? "Listening for your answer…"
        : quiz.phase === "grading"
          ? "Thinking about that…"
          : "";

  return (
    <div className="beat-fade-in absolute inset-x-0 bottom-0 z-40 p-4 sm:p-6">
      {/* A scrim under the panel. Without it the board — and the caption bar, which sits at the
          same edge — showed through the translucent card, so the question competed with the text
          behind it and neither was comfortably readable. */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-[140%] bg-[var(--hud-surface)]" />
      <div className="relative mx-auto max-w-2xl rounded-2xl border border-[var(--hud-line)] bg-[var(--hud-surface)] p-5 shadow-[var(--elev-2)]">
        {/* Both kinds now read "Quick check". The other label was "Let's pause a second", which
            narrates the interruption instead of naming what it is — the panel appearing is already
            the pause, so saying so adds a beat of chatter to every prompt. */}
        <p className="hud-eyebrow text-[0.65rem] tracking-[0.2em]" style={{ color: accentVar }}>
          Quick check
        </p>

        <p className="mt-2 text-lg font-bold leading-snug text-[var(--hud-text)]">{quiz.question}</p>

        {quiz.phase === "feedback" ? (
          <p className="mt-4 text-base font-semibold text-[var(--hud-text-dim)]">{quiz.feedback}</p>
        ) : (
          <>
            {status && (
              <p className="mt-3 flex items-center gap-2 text-sm font-bold text-[var(--hud-text-dim)]">
                {quiz.phase === "listening" && (
                  <span className="size-2 animate-pulse rounded-full" style={{ background: accentVar }} />
                )}
                {status}
              </p>
            )}

            {quiz.heard && <p className="mt-2 text-sm italic text-[var(--hud-text-dim)]">“{quiz.heard}”</p>}

            {(!quiz.supportsVoice || quiz.phase === "listening") && (
              <form
                className="mt-4 flex gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!typed.trim()) return;
                  quiz.submitAnswer(typed);
                }}
              >
                <input
                  value={typed}
                  onChange={(e) => setTyped(e.target.value)}
                  placeholder={quiz.supportsVoice ? "…or type your answer" : "Type your answer"}
                  className="min-w-0 flex-1 rounded-full border border-[var(--hud-line)] bg-[var(--hud-surface)] px-4 py-2 text-sm font-semibold text-[var(--hud-text)] outline-none placeholder:text-[var(--hud-text-faint)] focus:border-[var(--hud-line-strong)]"
                />
                <button
                  type="submit"
                  disabled={!typed.trim()}
                  className="rounded-full px-5 py-2 text-sm font-black text-[var(--accent-on)] transition disabled:opacity-40"
                  style={{ background: accentVar }}
                >
                  Answer
                </button>
              </form>
            )}

            <button onClick={onSkip} className="mt-3 text-xs font-bold text-[var(--hud-text-dim)] underline-offset-2 hover:text-[var(--hud-text-dim)] hover:underline">
              Skip this question
            </button>
          </>
        )}
      </div>
    </div>
  );
}

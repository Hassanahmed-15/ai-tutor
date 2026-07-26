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
      <div className="mx-auto max-w-2xl rounded-2xl border border-white/15 bg-slate-950/90 p-5 shadow-2xl backdrop-blur-md">
        <p className="hud-eyebrow text-[0.65rem] tracking-[0.2em]" style={{ color: accentVar }}>
          {quiz.kind === "understanding" ? "Quick check" : "Let's pause a second"}
        </p>

        <p className="mt-2 text-lg font-bold leading-snug text-white">{quiz.question}</p>

        {quiz.phase === "feedback" ? (
          <p className="mt-4 text-base font-semibold text-white/80">{quiz.feedback}</p>
        ) : (
          <>
            {status && (
              <p className="mt-3 flex items-center gap-2 text-sm font-bold text-white/50">
                {quiz.phase === "listening" && (
                  <span className="size-2 animate-pulse rounded-full" style={{ background: accentVar }} />
                )}
                {status}
              </p>
            )}

            {quiz.heard && <p className="mt-2 text-sm italic text-white/65">“{quiz.heard}”</p>}

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
                  className="min-w-0 flex-1 rounded-full border border-white/15 bg-white/5 px-4 py-2 text-sm font-semibold text-white outline-none placeholder:text-white/30 focus:border-white/35"
                />
                <button
                  type="submit"
                  disabled={!typed.trim()}
                  className="rounded-full px-5 py-2 text-sm font-black text-slate-950 transition disabled:opacity-40"
                  style={{ background: accentVar }}
                >
                  Answer
                </button>
              </form>
            )}

            <button onClick={onSkip} className="mt-3 text-xs font-bold text-white/35 underline-offset-2 hover:text-white/60 hover:underline">
              Skip this question
            </button>
          </>
        )}
      </div>
    </div>
  );
}

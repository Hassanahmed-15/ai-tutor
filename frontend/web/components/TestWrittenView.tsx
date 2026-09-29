"use client";

import { useState } from "react";
import { HudCorners, HudEyebrow } from "@/components/hud/HudKit";
import type { TestBank, TestGradeResult } from "@/lib/testPrompt";

/** Written test: exam-paper layout, all questions on one page, submit-all-at-once, then one
 *  batch rubric-grading call (/api/grade-test). Every question must have something written in it
 *  before the paper can be handed in — a blank left by accident used to be graded as wrong, which
 *  is a harsh way to find out you missed one. */
export function TestWrittenView({
  bank,
  onGraded,
  onBack,
}: {
  bank: TestBank;
  onGraded: (results: TestGradeResult[], answers: Record<string, string>) => void;
  onBack: () => void;
}) {
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** Whitespace is not an answer, so the count is of questions with something actually written. */
  const answered = bank.questions.filter((q) => (answers[q.id] ?? "").trim().length > 0).length;
  const unanswered = bank.questions.length - answered;

  async function submit() {
    if (submitting || unanswered > 0) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/grade-test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ questions: bank.questions, answers }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !Array.isArray(data.results)) throw new Error(data.error || "Grading failed.");
      onGraded(data.results as TestGradeResult[], answers);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Grading failed.");
      setSubmitting(false);
    }
  }

  return (
    <section className="relative z-10 min-h-screen w-full overflow-y-auto bg-gradient-to-b from-[#05040c] via-[#0a0810] to-[#05040c] p-6 lg:p-10">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_20%,rgba(99,102,241,0.15),transparent_50%)]" />

      <div className="relative z-20 mx-auto mb-10 flex max-w-3xl items-center justify-between">
        <div>
          <HudEyebrow>Written test</HudEyebrow>
          <h1 className="mt-3 font-display text-4xl font-light leading-tight sm:text-5xl">
            Testing <span className="hud-text-glow italic">{bank.topic}</span>
          </h1>
        </div>
        <button onClick={onBack} className="hud-btn-ghost shrink-0 rounded-full px-5 py-2 text-sm font-bold">
          Back
        </button>
      </div>

      <div className="relative z-20 mx-auto max-w-3xl space-y-6">
        <div className="relative rounded-[2rem] border border-[var(--hud-line)]/50 bg-gradient-to-br from-white/[0.04] to-white/[0.02] p-8">
          <HudCorners />
          <div className="relative z-10 space-y-8">
            {bank.questions.map((q, i) => (
              <div key={q.id}>
                <p className="mb-3 font-display text-lg font-semibold leading-snug text-[var(--hud-text)]">
                  <span className="text-[var(--hud-cyan)]">{i + 1}.</span> {q.prompt}
                </p>
                <textarea
                  value={answers[q.id] ?? ""}
                  onChange={(e) => setAnswers((prev) => ({ ...prev, [q.id]: e.target.value }))}
                  placeholder="Your answer…"
                  rows={3}
                  className="w-full rounded-2xl border border-[var(--hud-line)] bg-white/[0.04] px-5 py-4 text-base font-medium text-[var(--hud-text)] placeholder:text-[var(--hud-text-faint)] focus:border-[var(--hud-cyan)]/60 focus:outline-none"
                />
              </div>
            ))}
          </div>
        </div>

        {error && <p className="text-sm font-semibold text-rose-300">⚠️ {error}</p>}

        <button
          onClick={submit}
          disabled={submitting || unanswered > 0}
          className="w-full rounded-full bg-gradient-to-r from-indigo-500 to-fuchsia-500 py-4 text-base font-black shadow-[0_0_40px_rgba(129,140,248,0.3)] transition hover:shadow-[0_0_60px_rgba(129,140,248,0.5)] disabled:opacity-40 disabled:shadow-none"
        >
          {submitting ? "Grading…" : "Submit test"}
        </button>
        {/* A disabled button with no reason beside it is just a broken button. */}
        {unanswered > 0 && (
          <p className="text-center text-sm font-semibold text-[var(--hud-text-faint)]">
            {answered} of {bank.questions.length} answered — {unanswered === 1 ? "one question is" : `${unanswered} questions are`} still blank.
          </p>
        )}
      </div>
    </section>
  );
}

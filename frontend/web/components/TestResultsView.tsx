"use client";

import { HudEyebrow } from "@/components/hud/HudKit";
import type { TestBank, TestGradeResult } from "@/lib/testPrompt";

/**
 * The scorecard shown after a test finishes grading.
 *
 * Each question carries the mark, what the student wrote, why it was judged that way, and — when
 * they got it wrong — what a full answer covers. The feedback is the point: the grader is a model
 * reading against a rubric, so it can say which idea was missing rather than just that one was.
 */
export function TestResultsView({
  bank,
  results,
  answers,
  onBack,
}: {
  bank: TestBank;
  results: TestGradeResult[];
  /** Written mode: typed answers keyed by question id. Oral mode: omitted (transcript-graded). */
  answers?: Record<string, string>;
  onBack: () => void;
}) {
  const score = results.filter((r) => r.correct).length;

  return (
    <section className="relative z-10 min-h-screen w-full overflow-y-auto bg-gradient-to-b from-[#05040c] via-[#0a0810] to-[#05040c] p-6 lg:p-10">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_20%,rgba(99,102,241,0.15),transparent_50%)]" />

      <div className="relative z-20 mx-auto mb-10 flex max-w-3xl items-center justify-between">
        <div>
          <HudEyebrow>Test results</HudEyebrow>
          <h1 className="mt-3 font-display text-4xl font-light leading-tight sm:text-5xl">
            {score} / {results.length} <span className="hud-text-glow italic">correct</span>
          </h1>
        </div>
        <button onClick={onBack} className="hud-btn-ghost shrink-0 rounded-full px-5 py-2 text-sm font-bold">
          Done
        </button>
      </div>

      <div className="relative z-20 mx-auto max-w-3xl space-y-4">
        {bank.questions.map((q) => {
          const result = results.find((r) => r.id === q.id);
          if (!result) return null;
          return (
            <div
              key={q.id}
              className={`rounded-2xl border p-6 ${result.correct ? "border-emerald-400/30 bg-emerald-400/[0.04]" : "border-rose-400/30 bg-rose-400/[0.04]"}`}
            >
              <div className="flex items-start justify-between gap-4">
                <p className="font-display text-lg font-semibold leading-snug text-[var(--hud-text)]">
                  {result.correct ? "✓" : "✗"} {q.prompt}
                </p>
              </div>
              {answers?.[q.id] && <p className="mt-2 text-sm text-[var(--hud-text-dim)]">Your answer: {answers[q.id]}</p>}
              <p className="mt-2 text-sm font-semibold text-[var(--hud-text-dim)]">{result.feedback}</p>
              {!result.correct && (
                <p className="mt-2 text-sm italic text-[var(--hud-text-faint)]">A full answer: {q.rubric.modelAnswer}</p>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

"use client";

import { Check, CircleDot, X } from "lucide-react";
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
  slideOf,
  onReviewSlide,
}: {
  bank: TestBank;
  results: TestGradeResult[];
  /** Written mode: typed answers keyed by question id. Oral mode: omitted (transcript-graded). */
  answers?: Record<string, string>;
  onBack: () => void;
  /** The slide (0-based) a question's beat is, or -1. With `onReviewSlide`, a wrong answer links back to it. */
  slideOf?: (beatId: string) => number;
  /** Replays the lecture from that slide. Without it the scorecard is exactly as before. */
  onReviewSlide?: (index: number) => void;
}) {
  const score = results.filter((r) => r.correct).length;
  const earned = results.reduce((sum, r) => sum + r.pointsEarned, 0);
  const available = results.reduce((sum, r) => sum + r.pointsAvailable, 0);
  const partial = results.filter((r) => r.status === "partial").length;

  return (
    <section className="relative z-10 min-h-screen w-full overflow-y-auto p-6 lg:p-10 bg-[var(--hud-bg)]">

      <div className="relative z-20 mx-auto mb-10 flex max-w-3xl items-center justify-between">
        <div>
          <HudEyebrow>Test results</HudEyebrow>
          <h1 className="mt-3 font-display text-4xl font-light leading-tight sm:text-5xl">
            {earned} / {available} <span className="hud-text-glow italic">marks</span><span className="ml-3 text-lg text-[var(--hud-text-dim)]">({score} / {results.length} fully correct{partial > 0 ? `, ${partial} partial` : ""})</span>
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
          const slide = result.status !== "correct" && slideOf && onReviewSlide ? slideOf(q.beatId) : -1;
          const tone = result.status === "correct" ? "border-[var(--ok)] bg-[var(--ok-dim)]" : result.status === "partial" ? "border-amber-400/55 bg-amber-400/10" : "border-[var(--hud-danger)] bg-[var(--danger-dim)]";
          return (
            <div
              key={q.id}
              className={`rounded-2xl border p-6 ${tone}`}
            >
              <div className="flex items-start justify-between gap-4">
                <p className="font-display text-lg font-semibold leading-snug text-[var(--hud-text)]">
                  {result.status === "correct" ? <Check size={16} aria-label="Correct" className="mr-1 inline align-[-2px]" /> : result.status === "partial" ? <CircleDot size={16} aria-label="Partially correct" className="mr-1 inline align-[-2px] text-amber-400" /> : <X size={16} aria-label="Misconception" className="mr-1 inline align-[-2px]" />}{q.prompt}
                </p>
              </div>
              {answers?.[q.id] && <p className="mt-2 text-sm text-[var(--hud-text-dim)]">Your answer: {answers[q.id]}</p>}
              <p className="mt-2 text-sm font-semibold text-[var(--hud-text-dim)]">{result.feedback}</p>
              {result.missingKeyPoints.length > 0 && <p className="mt-2 text-sm text-amber-300">Still needed: {result.missingKeyPoints.join("; ")}</p>}
              {result.misconception && <p className="mt-2 text-sm text-[var(--hud-danger)]">Misconception to fix: {result.misconception}</p>}
              {result.status === "misconception" && (
                <p className="mt-2 text-sm italic text-[var(--hud-text-faint)]">A full answer: {q.rubric.modelAnswer}</p>
              )}
              {/* Says what actually happened: an answer with an error is not "one part missing". */}
              {result.status === "partial" && (
                <p className="mt-2 text-sm font-bold text-amber-400">
                  {result.misconception ? "Partly right · contains an error" : `Accurate core answer · ${result.missingKeyPoints.length > 1 ? `${result.missingKeyPoints.length} requested parts are missing` : "a requested part is missing"}`}
                </p>
              )}
              {slide >= 0 && (
                <button
                  type="button"
                  onClick={() => onReviewSlide?.(slide)}
                  data-review-slide={slide + 1}
                  className="hud-btn-ghost mt-3 rounded-full px-4 py-1.5 text-xs font-bold"
                >
                  Review slide {slide + 1} ▸
                </button>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

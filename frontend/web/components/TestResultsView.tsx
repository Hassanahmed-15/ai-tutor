"use client";

import { useState } from "react";
import { HudCorners, HudEyebrow } from "@/components/hud/HudKit";
import { LessonPlayer } from "@/components/LessonPlayer";
import type { TestBank, TestGradeResult } from "@/lib/testPrompt";
import type { Beat } from "@/lib/lessonContent";

type RemediationState = { status: "loading" } | { status: "ready"; beats: Beat[] } | { status: "error"; error: string };

/** Scorecard shown after either test mode finishes grading — same shape/component for both.
 *  Each wrong answer gets "Explain this again", which generates and plays a short remediation
 *  mini-lesson grounded in that specific question + the student's actual wrong answer. */
export function TestResultsView({
  topic,
  bank,
  results,
  answers,
  onBack,
}: {
  topic: string;
  bank: TestBank;
  results: TestGradeResult[];
  /** Written mode: typed answers keyed by question id. Oral mode: omitted (transcript-graded). */
  answers?: Record<string, string>;
  onBack: () => void;
}) {
  const [remediation, setRemediation] = useState<Record<string, RemediationState>>({});
  // Which question's remediation modal is currently open (null = closed) — decoupled from the
  // cached remediation results above so closing the modal never discards/re-triggers generation.
  const [openModalFor, setOpenModalFor] = useState<string | null>(null);
  const score = results.filter((r) => r.correct).length;

  async function explainAgain(questionId: string) {
    const cached = remediation[questionId];
    if (cached?.status === "ready") {
      setOpenModalFor(questionId);
      return;
    }
    const question = bank.questions.find((q) => q.id === questionId);
    if (!question) return;
    setRemediation((prev) => ({ ...prev, [questionId]: { status: "loading" } }));
    try {
      const res = await fetch("/api/generate-remediation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic, question, studentAnswer: answers?.[questionId] ?? "" }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !Array.isArray(data.beats) || data.beats.length === 0) {
        throw new Error(data.error || "Could not generate an explanation.");
      }
      setRemediation((prev) => ({ ...prev, [questionId]: { status: "ready", beats: data.beats } }));
      setOpenModalFor(questionId);
    } catch (err) {
      setRemediation((prev) => ({ ...prev, [questionId]: { status: "error", error: err instanceof Error ? err.message : "Failed." } }));
    }
  }

  const openState = openModalFor ? remediation[openModalFor] : undefined;
  const activeBeats = openState?.status === "ready" ? openState.beats : null;

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
          const state = remediation[q.id];
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
                <>
                  <p className="mt-2 text-sm italic text-[var(--hud-text-faint)]">Model answer: {q.rubric.modelAnswer}</p>
                  {!state && (
                    <button
                      onClick={() => explainAgain(q.id)}
                      className="mt-4 rounded-full border border-[var(--hud-cyan)]/40 bg-[var(--hud-cyan)]/[0.06] px-5 py-2 text-sm font-bold text-[var(--hud-cyan)] transition hover:bg-[var(--hud-cyan)]/[0.12]"
                    >
                      Explain this again →
                    </button>
                  )}
                  {state?.status === "loading" && <p className="mt-4 text-sm font-semibold text-[var(--hud-text-faint)]">Preparing an explanation…</p>}
                  {state?.status === "error" && <p className="mt-4 text-sm font-semibold text-rose-300">⚠️ {state.error}</p>}
                  {state?.status === "ready" && (
                    <button
                      onClick={() => explainAgain(q.id)}
                      className="mt-4 rounded-full border border-[var(--hud-line)] px-5 py-2 text-sm font-bold text-[var(--hud-text-dim)] hover:text-[var(--hud-text)]"
                    >
                      Watch again
                    </button>
                  )}
                </>
              )}
            </div>
          );
        })}
      </div>

      {activeBeats && (
        <div className="fixed inset-0 z-[80] bg-black/90">
          <HudCorners />
          <LessonPlayer
            beats={activeBeats}
            title="Explaining this again"
            autoVoiceAssistant={false}
            onExit={() => setOpenModalFor(null)}
          />
        </div>
      )}
    </section>
  );
}

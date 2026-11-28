"use client";

import { useState, type ReactNode } from "react";
import { Check, ChevronDown, ChevronLeft, Minus, RotateCcw, Sparkles, TriangleAlert, X } from "lucide-react";
import { DifficultyTag, EXACT, ExamMath } from "./bits";
import type { ExamResult, QuestionResult, StudentQuestion } from "./types";

/**
 * THE RESULTS: the score as a ring, the percent and an approximate grade; then a card per question (marks, what Aria
 * read, her feedback, the first error in amber, the correct working step by step); then "Your mistakes, explained"
 * with the two ways on: a lecture with one board per mistake, or a new test on what was missed.
 */
function ScoreRing({ percent }: { percent: number }) {
  const r = 52;
  const c = 2 * Math.PI * r;
  const p = Math.max(0, Math.min(100, percent));
  return (
    <svg viewBox="0 0 120 120" className="size-[132px] shrink-0 -rotate-90" role="img" aria-label={`Score ${Math.round(p)} percent`}>
      <circle cx="60" cy="60" r={r} fill="none" stroke="var(--hud-surface-2)" strokeWidth="10" />
      <circle cx="60" cy="60" r={r} fill="none" stroke="var(--hud-cyan)" strokeWidth="10" strokeLinecap="round" strokeDasharray={`${(c * p) / 100} ${c}`} className="transition-[stroke-dasharray] duration-1000" />
      <text x="60" y="60" textAnchor="middle" dominantBaseline="central" transform="rotate(90 60 60)" className="font-display" fontSize="28" fontWeight="600" fill="var(--hud-text)">
        {Math.round(p)}%
      </text>
    </svg>
  );
}

function Mark({ r }: { r: QuestionResult }) {
  const full = r.awarded >= r.max && r.max > 0;
  const none = r.awarded <= 0;
  const tone = full ? "text-[var(--success)] border-[var(--success)]/40 bg-[var(--success-soft)]" : none ? "text-[var(--danger)] border-[var(--danger)]/40 bg-[var(--danger-soft)]" : "text-[var(--warning)] border-[var(--warning)]/40 bg-[var(--warning-soft)]";
  const Icon = full ? Check : none ? X : Minus;
  return (
    <span className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-2.5 py-0.5 text-[0.8125rem] font-semibold tabular-nums ${tone}`}>
      <Icon size={13} strokeWidth={3} aria-hidden /> {r.awarded}/{r.max} <span className="sr-only">marks</span>
    </span>
  );
}

function Label({ children }: { children: ReactNode }) {
  return <p className="font-[family-name:var(--font-hud-mono)] text-[0.6875rem] uppercase tracking-[0.1em] text-[var(--hud-text-faint)]">{children}</p>;
}

function ResultCard({ q, r }: { q: StudentQuestion; r: QuestionResult }) {
  const [working, setWorking] = useState(!r.correct);
  return (
    <li className="rounded-[var(--radius-lg)] border border-[var(--hud-line)] bg-[var(--hud-surface)] p-5 sm:p-6" data-result={q.n}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="font-display text-[1.15rem] font-semibold text-[var(--hud-text)]">Question {q.n}</span>
          <DifficultyTag level={q.difficulty} />
          <span className="text-[0.75rem] text-[var(--hud-text-faint)]">{q.subtopic}</span>
        </div>
        <Mark r={r} />
      </div>
      <div className="mt-2 line-clamp-3 text-[0.9rem] leading-relaxed text-[var(--hud-text-dim)]"><ExamMath text={q.stem} /></div>

      <div className="mt-4">
        <Label>What Aria read{q.answerOn === "paper" ? " on your page" : ""}</Label>
        <div className="mt-1.5 whitespace-pre-wrap rounded-[10px] bg-[var(--hud-bg)] px-3.5 py-2.5 text-[0.95rem] leading-relaxed text-[var(--hud-text)]">
          {r.studentAnswer ? <ExamMath text={q.style === "mcq" && q.options?.[r.studentAnswer.trim() as "A"] ? `${r.studentAnswer.trim()}: ${q.options[r.studentAnswer.trim() as "A"]}` : r.studentAnswer} /> : <span className="italic text-[var(--hud-text-faint)]">No answer</span>}
        </div>
        {r.readConfidence === "low" && (
          <p className="mt-2 flex items-start gap-1.5 text-[0.8125rem] leading-snug text-[var(--hud-text-dim)]" data-low-confidence="">
            <TriangleAlert size={14} className="mt-px shrink-0 text-[var(--warning)]" aria-hidden />
            Aria wasn&apos;t sure she read your writing correctly. Check this against your page; if she misread it, your mark may be too low.
          </p>
        )}
      </div>

      {r.feedback && <p className="mt-4 text-[0.98rem] leading-relaxed text-[var(--hud-text)]"><ExamMath text={r.feedback} /></p>}

      {r.firstError && (
        <div className="mt-4 rounded-[10px] border-l-4 border-[var(--warning)] bg-[var(--warning-soft)] px-4 py-3" data-first-error="">
          <p className="text-[0.8125rem] font-semibold text-[var(--warning)]">Where it first went wrong{r.firstError.step ? `: ${r.firstError.step}` : ""}</p>
          <p className="mt-1 text-[0.95rem] leading-relaxed text-[var(--hud-text)]"><ExamMath text={r.firstError.what} /></p>
          {r.firstError.why && <p className="mt-1 text-[0.875rem] leading-relaxed text-[var(--hud-text-dim)]"><ExamMath text={r.firstError.why} /></p>}
        </div>
      )}

      {r.correctWorking.length > 0 && (
        <div className="mt-4">
          <button
            type="button"
            onClick={() => setWorking((w) => !w)}
            aria-expanded={working}
            className="flex items-center gap-1.5 text-[0.8125rem] font-semibold text-[var(--hud-cyan)] transition hover:opacity-80"
          >
            <ChevronDown size={15} className={`transition-transform ${working ? "rotate-180" : ""}`} aria-hidden />
            {working ? "Hide the correct working" : "Show the correct working"}
          </button>
          {working && (
            <ol className="mt-2.5 space-y-1.5" data-correct-working="">
              {r.correctWorking.map((step, i) => (
                <li key={i} className="flex gap-3 text-[0.95rem] leading-relaxed text-[var(--hud-text)]">
                  <span className="grid size-6 shrink-0 place-items-center rounded-md bg-[var(--hud-surface-2)] text-[0.75rem] font-semibold text-[var(--hud-text-dim)]">{i + 1}</span>
                  <span className="min-w-0 flex-1 overflow-x-auto"><ExamMath text={step} /></span>
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
    </li>
  );
}

export function ExamResults({
  topic,
  questions,
  result,
  onExplain,
  onRetry,
  onExit,
}: {
  topic: string;
  questions: StudentQuestion[];
  result: ExamResult;
  onExplain: () => void;
  onRetry: () => void;
  onExit: () => void;
}) {
  const byId = new Map(questions.map((q) => [q.id, q]));
  const rows = result.results.map((r) => ({ r, q: byId.get(r.id) })).filter((x): x is { r: QuestionResult; q: StudentQuestion } => Boolean(x.q)).sort((a, b) => a.q.n - b.q.n);
  const mistakes = result.mistakes.map((r) => ({ r, q: byId.get(r.id) })).filter((x): x is { r: QuestionResult; q: StudentQuestion } => Boolean(x.q)).sort((a, b) => a.q.n - b.q.n);

  return (
    <main className="hud-canvas hud-grain min-h-screen px-4 pb-16 pt-4 sm:px-6" data-practice-phase="results" style={EXACT}>
      <div className="mx-auto w-full max-w-3xl">
        <button type="button" onClick={onExit} className="mb-4 flex items-center gap-1 rounded-full px-2 py-1.5 text-[0.8125rem] font-medium text-[var(--hud-text-dim)] transition hover:bg-[var(--hud-surface-2)] hover:text-[var(--hud-text)]">
          <ChevronLeft size={15} aria-hidden /> Back to home
        </button>

        <section className="beat-fade-in flex flex-col items-center gap-6 rounded-[var(--radius-lg)] border border-[var(--hud-line)] bg-[var(--hud-surface)] p-6 shadow-[var(--elev-2)] sm:flex-row sm:p-8" aria-label="Your score">
          <ScoreRing percent={result.percent} />
          <div className="text-center sm:text-left">
            <p className="font-[family-name:var(--font-hud-mono)] text-[0.6875rem] uppercase tracking-[0.12em] text-[var(--hud-text-faint)]">Practice test · {topic}</p>
            <p className="mt-2 font-display text-[2.4rem] leading-none tracking-[-0.02em] text-[var(--hud-text)]" data-grade={result.grade}>Grade {result.grade}</p>
            <p className="mt-1 text-[0.8125rem] text-[var(--hud-text-faint)]">approximate</p>
            <p className="mt-3 text-[1rem] text-[var(--hud-text-dim)]">
              <b className="font-semibold text-[var(--hud-text)]">{result.total}</b> of {result.max} marks · {mistakes.length ? `${mistakes.length} question${mistakes.length === 1 ? "" : "s"} to look at again` : "no mistakes"}
            </p>
          </div>
        </section>

        <h2 className="mt-10 font-display text-[1.6rem] text-[var(--hud-text)]">Question by question</h2>
        <ul className="mt-4 space-y-4">
          {rows.map(({ q, r }) => <ResultCard key={q.id} q={q} r={r} />)}
        </ul>

        <section className="mt-10 rounded-[var(--radius-lg)] border border-[var(--hud-line)] bg-[var(--hud-surface)] p-5 sm:p-6" aria-labelledby="mistakes-title" data-mistakes="">
          <h2 id="mistakes-title" className="font-display text-[1.6rem] text-[var(--hud-text)]">Your mistakes, explained</h2>
          {mistakes.length ? (
            <ul className="mt-4 space-y-3">
              {mistakes.map(({ q, r }) => (
                <li key={q.id} className="flex gap-3">
                  <span className="grid size-7 shrink-0 place-items-center rounded-md border border-[var(--hud-line-strong)] text-xs font-semibold text-[var(--hud-text-dim)]">{q.n}</span>
                  <div className="min-w-0">
                    <p className="text-[0.95rem] font-medium text-[var(--hud-text)]">{q.subtopic}</p>
                    <p className="mt-0.5 text-[0.875rem] leading-snug text-[var(--hud-text-dim)]"><ExamMath text={r.firstError?.what || r.feedback} /></p>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-[0.95rem] text-[var(--hud-text-dim)]">Full marks: nothing to explain. Try a harder test next.</p>
          )}
          <div className="mt-6 flex flex-col gap-2.5 sm:flex-row sm:flex-wrap">
            {mistakes.length > 0 && (
              <button type="button" onClick={onExplain} className="hud-btn-primary inline-flex min-h-11 items-center justify-center gap-2 rounded-full px-5 py-2.5 text-[0.9rem] font-semibold" data-explain-mistakes="">
                <Sparkles size={16} aria-hidden /> Explain my mistakes: one board for each
              </button>
            )}
            <button type="button" onClick={onRetry} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-full border border-[var(--hud-line)] px-5 py-2.5 text-[0.9rem] font-medium text-[var(--hud-text)] transition hover:border-[var(--hud-cyan)]" data-retry-missed="">
              <RotateCcw size={15} aria-hidden /> {mistakes.length ? "New test on what I missed" : "New test"}
            </button>
          </div>
        </section>
      </div>
    </main>
  );
}

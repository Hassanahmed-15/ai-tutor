"use client";

import { useState } from "react";
import { ArrowRight, Check, ChevronLeft } from "lucide-react";

/**
 * ONE PLANNING QUESTION, drawn exactly as the typed-prompt planning screen draws it (LearnPage
 * `renderDiagnosticFocus`): the progress dashes, the topic in small capitals, the big serif question and its
 * lettered answer cards. Like the intake card (components/planning/QuestionCard.tsx) it ends with an "Other" row the
 * student can type into. A single choice moves on when tapped; a multi-select ticks cards and waits for "Continue".
 */
export type FocusOption = { label: string; hint?: string };

export function FocusQuestion({
  topic,
  dashes,
  at,
  question,
  remark,
  options,
  picked,
  multi,
  exclusive,
  otherPlaceholder = "Type your own answer",
  otherInput = "text",
  onPick,
  onContinue,
  onBack,
  onExit,
  exitLabel = "Back to home",
}: {
  topic: string;
  /** How many dashes, and which one this question is (0-based). */
  dashes: number;
  at: number;
  question: string;
  remark?: string;
  options: FocusOption[];
  picked: string[];
  multi?: boolean;
  /** A multi-select option that stands alone ("Everything"): picking it clears the rest, and the other way round. */
  exclusive?: string;
  otherPlaceholder?: string;
  otherInput?: "text" | "number";
  /** The new answer. For a single choice the parent moves on. */
  onPick: (labels: string[]) => void;
  onContinue?: () => void;
  onBack?: () => void;
  onExit: () => void;
  exitLabel?: string;
}) {
  const typed = picked.find((l) => !options.some((o) => o.label === l)) ?? "";
  // Keyed by question in the parent, so a new question opens with its own typed answer in the box.
  const [draft, setDraft] = useState(typed);

  const chosen = picked.filter((l) => options.some((o) => o.label === l));
  function toggle(label: string) {
    if (!multi) { onPick([label]); return; }
    let next = chosen.includes(label) ? chosen.filter((l) => l !== label) : [...chosen, label];
    if (exclusive) next = label === exclusive ? (next.includes(exclusive) ? [exclusive] : []) : next.filter((l) => l !== exclusive);
    const text = draft.trim();
    onPick(text && !(exclusive && label === exclusive && next.includes(exclusive)) ? [...next, text] : next);
  }
  function commitTyped(): boolean {
    const text = draft.replace(/\s+/g, " ").trim().slice(0, 120);
    if (!multi) { if (text) onPick([text]); return Boolean(text); }
    const kept = exclusive && text ? chosen.filter((l) => l !== exclusive) : chosen;
    onPick(text ? [...kept, text] : kept);
    return true;
  }
  const canContinue = multi && (chosen.length > 0 || draft.trim().length > 0);

  return (
    <div className="mx-auto flex min-h-[calc(100vh-8rem)] w-full max-w-2xl flex-col justify-center py-10" data-practice-question={question}>
      <div className="mb-8 flex items-center gap-3">
        <div className="flex items-center gap-1.5" aria-label={`Question ${at + 1} of ${dashes}`}>
          {Array.from({ length: dashes }, (_, i) => (
            <span
              key={i}
              className={`h-1.5 rounded-full transition-all duration-500 ${
                i < at ? "w-6 bg-[var(--hud-cyan)]" : i === at ? "w-10 bg-[var(--hud-cyan)]/70" : "w-6 bg-[var(--hud-surface-2)]"
              }`}
            />
          ))}
        </div>
        <span className="truncate font-[family-name:var(--font-hud-mono)] text-[0.6875rem] uppercase tracking-[0.1em] text-[var(--hud-text-faint)]">
          Practice test · {topic}
        </span>
      </div>

      {remark && <p className="beat-fade-in mb-4 text-[0.95rem] leading-relaxed text-[var(--hud-text-dim)]">{remark}</p>}

      <h2 key={question} className="beat-fade-in font-display text-balance text-[2.1rem] leading-[1.1] tracking-[-0.01em] text-[var(--hud-text)] sm:text-[2.7rem]">
        {question}
      </h2>
      {multi && <p className="mt-2 text-[0.86rem] text-[var(--hud-text-faint)]">Pick as many as you like</p>}

      <div key={`${question}-options`} className="beat-fade-in mt-8 grid gap-2.5">
        {options.map((option, i) => {
          const on = chosen.includes(option.label);
          return (
            <button
              key={option.label}
              type="button"
              aria-pressed={on}
              onClick={() => toggle(option.label)}
              className={`home-lift group flex items-center gap-4 rounded-[14px] border px-4 py-3.5 text-left transition hover:border-[var(--hud-cyan)] ${
                on ? "border-[var(--hud-cyan)] bg-[var(--hud-cyan)]/[0.14]" : "border-[var(--hud-line)] bg-[var(--hud-surface)]"
              }`}
            >
              <span
                className={`grid size-7 shrink-0 place-items-center rounded-md border text-xs font-semibold ${
                  on
                    ? "border-[var(--hud-cyan)] bg-[var(--hud-cyan)] text-[var(--hud-bg)]"
                    : "border-[var(--hud-line-strong)] text-[var(--hud-text-faint)] group-hover:border-[var(--hud-cyan)] group-hover:text-[var(--hud-cyan)]"
                }`}
              >
                {on && multi ? <Check size={14} strokeWidth={3} aria-hidden /> : String.fromCharCode(65 + i)}
              </span>
              <span className="min-w-0">
                <span className="block text-[1rem] font-medium text-[var(--hud-text)]">{option.label}</span>
                {option.hint && <span className="mt-0.5 block text-[0.86rem] text-[var(--hud-text-faint)]">{option.hint}</span>}
              </span>
            </button>
          );
        })}

        {/* Other: the student's own answer, typed. */}
        <form
          onSubmit={(e) => { e.preventDefault(); if (commitTyped() && multi && onContinue) onContinue(); }}
          className={`home-lift group flex items-center gap-4 rounded-[14px] border px-4 py-2.5 transition focus-within:border-[var(--hud-cyan)] hover:border-[var(--hud-cyan)] ${
            typed ? "border-[var(--hud-cyan)] bg-[var(--hud-cyan)]/[0.14]" : "border-[var(--hud-line)] bg-[var(--hud-surface)]"
          }`}
        >
          <span className="grid size-7 shrink-0 place-items-center rounded-md border border-[var(--hud-line-strong)] text-xs font-semibold text-[var(--hud-text-faint)] group-focus-within:border-[var(--hud-cyan)] group-focus-within:text-[var(--hud-cyan)]">
            {String.fromCharCode(65 + options.length)}
          </span>
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => { if (multi) commitTyped(); }}
            type={otherInput}
            inputMode={otherInput === "number" ? "numeric" : undefined}
            min={otherInput === "number" ? 3 : undefined}
            max={otherInput === "number" ? 15 : undefined}
            maxLength={120}
            placeholder={`Other: ${otherPlaceholder.charAt(0).toLowerCase()}${otherPlaceholder.slice(1)}`}
            aria-label="Other: your own answer"
            className="min-w-0 flex-1 bg-transparent py-1 text-[1rem] font-medium text-[var(--hud-text)] outline-none placeholder:font-normal placeholder:text-[var(--hud-text-faint)]"
          />
          {!multi && (
            <button
              type="submit"
              disabled={!draft.trim()}
              aria-label="Use my answer"
              className="grid size-8 shrink-0 place-items-center rounded-full border border-[var(--hud-line)] text-[var(--hud-text-dim)] transition hover:border-[var(--hud-cyan)] hover:text-[var(--hud-cyan)] disabled:opacity-30"
            >
              <ArrowRight size={15} aria-hidden />
            </button>
          )}
        </form>
      </div>

      <div className="mt-8 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          {onBack ? (
            <button type="button" onClick={onBack} className="flex items-center gap-1 rounded-full px-3 py-2 text-[0.8125rem] font-medium text-[var(--hud-text-dim)] transition hover:bg-[var(--hud-surface-2)] hover:text-[var(--hud-text)]">
              <ChevronLeft size={15} aria-hidden /> Back
            </button>
          ) : (
            <button type="button" onClick={onExit} className="flex items-center gap-1 rounded-full px-3 py-2 text-[0.8125rem] font-medium text-[var(--hud-text-dim)] transition hover:bg-[var(--hud-surface-2)] hover:text-[var(--hud-text)]">
              <ChevronLeft size={15} aria-hidden /> {exitLabel}
            </button>
          )}
        </div>
        {multi && onContinue && (
          <button
            type="button"
            onClick={() => { commitTyped(); onContinue(); }}
            disabled={!canContinue}
            className="hud-btn-primary rounded-full px-6 py-2.5 text-[0.9rem] font-semibold disabled:opacity-40"
          >
            Continue
          </button>
        )}
      </div>
    </div>
  );
}

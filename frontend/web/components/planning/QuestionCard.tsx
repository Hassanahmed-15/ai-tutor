"use client";

import { useEffect, useRef, useState } from "react";
import { Check, ChevronLeft, CornerDownLeft, Mic, MicOff } from "lucide-react";

/**
 * THE PLANNING QUESTIONS, IN ONE CARD (owner, 2026-10-20: "exactly like Claude when it asks
 * questions — it shouldn't look like it switched screen at the second question"). One card stays on
 * screen: a row of tabs (one per question, ticked when answered, then Submit), the open question,
 * its numbered options with a short line under each, and Back / Next. Picking an option of a
 * single-choice question moves to the next tab; any tab can be opened again to change an answer;
 * nothing happens until Submit. Numbers 1–9 pick, ← → move between tabs, Enter goes on.
 *
 * "OTHER", AS IN CLAUDE (owner, 2026-10-22: "if other you can type your answer"): every question ends
 * with an Other row that opens a text box. What the student types is their answer — on a single-choice
 * question it moves on like a pick (Enter), on a multi-select it stands beside the ticks. It reaches
 * the parent as one more label that is not an option's.
 */
export type CardOption = { label: string; description?: string };
export type CardQuestion = { id: string; header: string; question: string; multi?: boolean; options: CardOption[] };

export function QuestionCard({
  questions,
  answers,
  tab,
  onTab,
  onAnswer,
  onSubmit,
  topic,
  note,
  voice,
  heard,
}: {
  questions: CardQuestion[];
  /** Per question id: the picked option labels (one for a single-choice question). */
  answers: Record<string, string[]>;
  /** The open tab: a question id, or "submit". */
  tab: string;
  onTab: (tab: string) => void;
  onAnswer: (questionId: string, labels: string[]) => void;
  onSubmit: () => void;
  topic: string;
  note?: string | null;
  voice?: { live: boolean; muted: boolean; toggleMute: () => void };
  /** An option just heard by voice: it lights up for a moment before it is picked. */
  heard?: string | null;
}) {
  const index = questions.findIndex((q) => q.id === tab);
  const open = index >= 0 ? questions[index] : null;
  /** The typed answer of a question: its one answer that is not an option's label. */
  const typedOf = (q: CardQuestion) => (answers[q.id] ?? []).find((l) => !q.options.some((o) => o.label === l)) ?? "";
  // The Other box being typed in (its question id) and what is in it.
  const [typing, setTypingState] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  // Read by the box's blur, which can fire after Enter or Escape already closed it.
  const typingRef = useRef<string | null>(null);
  const setTyping = (id: string | null) => { typingRef.current = id; setTypingState(id); };
  const answered = (q: CardQuestion) => (answers[q.id]?.length ?? 0) > 0 || Boolean(q.multi) || (typing === q.id && draft.trim().length > 0);
  /** The text box's words become the answer (an empty box takes the typed answer away). */
  function commitTyped(q: CardQuestion): boolean {
    if (typingRef.current !== q.id) return false;
    const text = draft.replace(/\s+/g, " ").trim().slice(0, 300);
    const picked = (answers[q.id] ?? []).filter((l) => q.options.some((o) => o.label === l));
    setTyping(null);
    if (q.multi) onAnswer(q.id, text ? [...picked, text] : picked);
    else if (text) onAnswer(q.id, [text]);
    return Boolean(text);
  }
  function startTyping(q: CardQuestion) {
    setDraft(typedOf(q));
    setTyping(q.id);
  }
  const next = () => {
    if (open) commitTyped(open);
    onTab(index >= 0 && index < questions.length - 1 ? questions[index + 1].id : "submit");
  };
  const back = () => onTab(index > 0 ? questions[index - 1].id : index < 0 && questions.length ? questions[questions.length - 1].id : tab);

  function pick(q: CardQuestion, label: string) {
    if (q.multi) {
      const now = answers[q.id] ?? [];
      onAnswer(q.id, now.includes(label) ? now.filter((l) => l !== label) : [...now, label]);
      return;
    }
    setTyping(null);
    onAnswer(q.id, [label]);
    // As in Claude: a single choice moves straight on.
    window.setTimeout(() => onTab(index < questions.length - 1 ? questions[index + 1].id : "submit"), 160);
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) return;
      if (open && /^[1-9]$/.test(e.key)) {
        const option = open.options[Number(e.key) - 1];
        if (option) { e.preventDefault(); pick(open, option.label); }
        else if (Number(e.key) === open.options.length + 1) { e.preventDefault(); startTyping(open); }
      } else if (e.key === "ArrowRight") { e.preventDefault(); next(); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); back(); }
      else if (e.key === "Enter") { e.preventDefault(); if (open) next(); else onSubmit(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return (
    // Pinned to the top, never centred: a centred card jumped up and down as its height changed
    // between tabs, which read as a new screen.
    <div className="mx-auto flex w-full max-w-2xl flex-col pb-10 pt-[12vh]">
      <span className="mb-4 truncate font-[family-name:var(--font-hud-mono)] text-[0.6875rem] uppercase tracking-[0.1em] text-[var(--hud-text-faint)]">{topic}</span>
      <section aria-label="Questions before the lesson" className="overflow-hidden rounded-2xl border border-[var(--hud-line)] bg-[var(--hud-surface)] shadow-[0_8px_30px_rgba(0,0,0,0.18)]">
        {/* The tabs: one per question, ticked once answered, then Submit. */}
        <div role="tablist" className="flex flex-wrap items-center gap-1.5 border-b border-[var(--hud-line)] px-4 py-3">
          {questions.map((q) => {
            const active = q.id === tab;
            const done = (answers[q.id]?.length ?? 0) > 0;
            return (
              <button
                key={q.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => onTab(q.id)}
                className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[0.8125rem] font-medium transition ${active ? "bg-[var(--hud-surface-2)] text-[var(--hud-text)]" : "text-[var(--hud-text-dim)] hover:text-[var(--hud-text)]"}`}
              >
                <span className={`grid size-3.5 place-items-center rounded-[3px] border ${done ? "border-[var(--hud-cyan)] bg-[var(--hud-cyan)] text-[var(--hud-bg)]" : "border-[var(--hud-line-strong)]"}`}>
                  {done && <Check size={10} strokeWidth={3} />}
                </span>
                {q.header}
              </button>
            );
          })}
          <button
            type="button"
            role="tab"
            aria-selected={tab === "submit"}
            onClick={() => onTab("submit")}
            className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[0.8125rem] font-medium transition ${tab === "submit" ? "bg-[var(--hud-surface-2)] text-[var(--hud-text)]" : "text-[var(--hud-text-dim)] hover:text-[var(--hud-text)]"}`}
          >
            <Check size={13} /> Submit
          </button>
        </div>

        <div className="px-5 pb-5 pt-5 sm:px-6">
          {open ? (
            <>
              <h2 className="text-balance text-[1.15rem] font-semibold leading-snug text-[var(--hud-text)]">{open.question}</h2>
              {open.multi && <p className="mt-1 text-[0.8125rem] text-[var(--hud-text-faint)]">Select all that apply</p>}
              <ul className="mt-4 grid gap-1.5">
                {open.options.map((o, i) => {
                  const on = (answers[open.id] ?? []).includes(o.label);
                  const lit = heard === o.label;
                  return (
                    <li key={o.label}>
                      <button
                        type="button"
                        onClick={() => pick(open, o.label)}
                        aria-pressed={on}
                        className={`group flex w-full items-start gap-3 rounded-xl border px-3.5 py-3 text-left transition ${on || lit ? "border-[var(--hud-cyan)] bg-[var(--hud-cyan)]/[0.10]" : "border-transparent hover:border-[var(--hud-line)] hover:bg-[var(--hud-surface-2)]"}`}
                      >
                        {open.multi ? (
                          <span className={`mt-0.5 grid size-[1.125rem] shrink-0 place-items-center rounded-[4px] border ${on ? "border-[var(--hud-cyan)] bg-[var(--hud-cyan)] text-[var(--hud-bg)]" : "border-[var(--hud-line-strong)]"}`}>
                            {on && <Check size={12} strokeWidth={3} />}
                          </span>
                        ) : (
                          <span className={`mt-px grid size-6 shrink-0 place-items-center rounded-md text-[0.75rem] font-semibold ${on ? "bg-[var(--hud-cyan)] text-[var(--hud-bg)]" : "bg-[var(--hud-surface-2)] text-[var(--hud-text-dim)]"}`}>{i + 1}</span>
                        )}
                        <span className="min-w-0">
                          <span className="block text-[0.95rem] font-medium text-[var(--hud-text)]">{o.label}</span>
                          {o.description && <span className="mt-0.5 block text-[0.8125rem] leading-snug text-[var(--hud-text-faint)]">{o.description}</span>}
                        </span>
                      </button>
                    </li>
                  );
                })}
                <li>
                  {(() => {
                    const typed = typedOf(open);
                    const editing = typing === open.id;
                    const on = Boolean(typed) && !editing;
                    return (
                      <div
                        role="button"
                        tabIndex={editing ? -1 : 0}
                        onClick={() => { if (!editing) startTyping(open); }}
                        onKeyDown={(e) => { if (!editing && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); e.stopPropagation(); startTyping(open); } }}
                        className={`flex w-full cursor-text items-start gap-3 rounded-xl border px-3.5 py-3 text-left transition ${on || editing ? "border-[var(--hud-cyan)] bg-[var(--hud-cyan)]/[0.10]" : "border-transparent hover:border-[var(--hud-line)] hover:bg-[var(--hud-surface-2)]"}`}
                      >
                        {open.multi ? (
                          <span className={`mt-0.5 grid size-[1.125rem] shrink-0 place-items-center rounded-[4px] border ${on ? "border-[var(--hud-cyan)] bg-[var(--hud-cyan)] text-[var(--hud-bg)]" : "border-[var(--hud-line-strong)]"}`}>
                            {on && <Check size={12} strokeWidth={3} />}
                          </span>
                        ) : (
                          <span className={`mt-px grid size-6 shrink-0 place-items-center rounded-md text-[0.75rem] font-semibold ${on ? "bg-[var(--hud-cyan)] text-[var(--hud-bg)]" : "bg-[var(--hud-surface-2)] text-[var(--hud-text-dim)]"}`}>{open.options.length + 1}</span>
                        )}
                        {editing ? (
                          <span className="flex min-w-0 flex-1 items-center gap-2">
                            <input
                              autoFocus
                              value={draft}
                              onChange={(e) => setDraft(e.target.value)}
                              onBlur={() => commitTyped(open)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") {
                                  e.preventDefault();
                                  // A typed answer to a single-choice question moves on, as a pick does.
                                  if (commitTyped(open) && !open.multi) window.setTimeout(() => onTab(index < questions.length - 1 ? questions[index + 1].id : "submit"), 160);
                                } else if (e.key === "Escape") {
                                  e.preventDefault();
                                  setTyping(null);
                                }
                              }}
                              maxLength={300}
                              placeholder="Type your answer…"
                              aria-label="Your own answer"
                              className="min-w-0 flex-1 bg-transparent text-[0.95rem] font-medium text-[var(--hud-text)] outline-none placeholder:font-normal placeholder:text-[var(--hud-text-faint)]"
                            />
                            <CornerDownLeft size={14} className="shrink-0 text-[var(--hud-text-faint)]" aria-hidden />
                          </span>
                        ) : (
                          <span className="min-w-0">
                            <span className="block text-[0.95rem] font-medium text-[var(--hud-text)]">{typed || "Other"}</span>
                            <span className="mt-0.5 block text-[0.8125rem] leading-snug text-[var(--hud-text-faint)]">{typed ? "Your answer: click to change it" : "Type your own answer"}</span>
                          </span>
                        )}
                      </div>
                    );
                  })()}
                </li>
              </ul>
            </>
          ) : (
            <>
              <h2 className="text-[1.15rem] font-semibold text-[var(--hud-text)]">Review your answers</h2>
              <ul className="mt-4 grid gap-3">
                {questions.map((q) => (
                  <li key={q.id}>
                    <button type="button" onClick={() => onTab(q.id)} className="w-full rounded-lg px-1 py-0.5 text-left transition hover:bg-[var(--hud-surface-2)]">
                      <span className="block text-[0.8125rem] text-[var(--hud-text-faint)]">{q.question}</span>
                      <span className="mt-0.5 block text-[0.95rem] font-medium text-[var(--hud-text)]">
                        {(answers[q.id] ?? []).join(", ") || (q.multi ? "None: it's all new to me" : "Not answered")}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}

          <div className="mt-6 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              {(index > 0 || (!open && questions.length > 0)) && (
                <button type="button" onClick={back} className="flex items-center gap-1 rounded-lg px-3 py-2 text-[0.875rem] text-[var(--hud-text-dim)] transition hover:bg-[var(--hud-surface-2)] hover:text-[var(--hud-text)]">
                  <ChevronLeft size={15} /> Back
                </button>
              )}
              {voice?.live && (
                <button
                  type="button"
                  onClick={voice.toggleMute}
                  aria-pressed={voice.muted}
                  aria-label={voice.muted ? "Unmute: answer by voice" : "Mute"}
                  title={voice.muted ? "Unmute: answer by voice" : "Mute"}
                  className={`grid size-8 place-items-center rounded-full border transition-colors ${voice.muted ? "border-[var(--hud-line)] text-[var(--hud-text-faint)]" : "border-[var(--hud-cyan)] text-[var(--hud-cyan)]"}`}
                >
                  {voice.muted ? <MicOff size={14} /> : <Mic size={14} />}
                </button>
              )}
            </div>
            {open ? (
              <button
                type="button"
                onClick={next}
                disabled={!answered(open)}
                className="rounded-lg bg-[var(--hud-cyan)] px-4 py-2 text-[0.875rem] font-semibold text-[var(--hud-bg)] transition hover:opacity-90 disabled:opacity-40"
              >
                Next
              </button>
            ) : (
              <button type="button" onClick={onSubmit} className="rounded-lg bg-[var(--hud-cyan)] px-4 py-2 text-[0.875rem] font-semibold text-[var(--hud-bg)] transition hover:opacity-90">
                Submit answers
              </button>
            )}
          </div>
        </div>
      </section>
      {note && <p className="mt-4 truncate text-[0.75rem] text-[var(--hud-text-faint)]">{note}</p>}
    </div>
  );
}

"use client";

import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft, ArrowRight, Car, Check, ChefHat, Clapperboard, Feather, Gamepad2, Gauge, Globe2, Hammer, Hand, HeartPulse,
  Languages, Leaf, Lightbulb, ListOrdered, Loader2, MessageCircle, MessagesSquare, Music, NotebookPen, Orbit, Palette,
  PawPrint, Rocket, Shapes, Smartphone, StickyNote, Telescope, Trophy, Wallet, type LucideIcon,
} from "lucide-react";
import {
  CHALLENGE_OPTIONS, ENGLISH_OPTIONS, GOAL_OPTIONS, HELP_OPTIONS, INTERESTS, MAX_HELPS, MAX_INTERESTS, emptyPreferences,
  type LearningPreferences, type PreferenceOption,
} from "@/lib/learningPreferences";

/**
 * "HOW DO YOU LIKE TO LEARN?" — one question at a time, answered by tapping (owner, 2026-10-05:
 * "a much better and easy UI"). Shown once during onboarding, and again from settings on request.
 *
 * Five questions, every one skippable: goal, what helps, challenge, interests, English. A single
 * answer moves on by itself; a pick-several question has Continue. Primary-school students get the
 * kid wording. The answers drive the Teaching Policy (lib/teachingPolicy.ts) — they change what a
 * lesson leans on, never whether it has a board and a voice, and nothing here labels anyone a
 * "visual learner".
 */

const ICONS: Record<string, LucideIcon> = {
  Trophy, NotebookPen, Lightbulb, Telescope, Shapes, ListOrdered, Globe2, StickyNote, Hand, Feather, Gauge, Rocket,
  MessageCircle, MessagesSquare, Languages, Gamepad2, Music, PawPrint, Orbit, ChefHat, Smartphone, Palette, Car, Leaf,
  Wallet, HeartPulse, Clapperboard, Hammer,
};

type Key = "goal" | "helps" | "challenge" | "interests" | "english";

type Question = {
  key: Key;
  title: string;
  kidTitle: string;
  sub: string;
  kidSub: string;
  /** How many may be picked; 1 = a single answer that moves on by itself. */
  max: number;
};

const QUESTIONS: Question[] = [
  { key: "goal", title: "What brings you to Aria?", kidTitle: "What do you want help with?", sub: "Pick the one that fits best.", kidSub: "Tap one.", max: 1 },
  { key: "helps", title: "What helps you learn best?", kidTitle: "What helps you learn?", sub: `Pick up to ${MAX_HELPS}. Every lesson still has drawings and Aria's voice — this is what she leans on.`, kidSub: `Tap up to ${MAX_HELPS}.`, max: MAX_HELPS },
  { key: "challenge", title: "How big should the steps be?", kidTitle: "How hard should lessons be?", sub: "You can always say \"simpler\" or \"deeper\" during a lesson.", kidSub: "You can change this any time.", max: 1 },
  { key: "interests", title: "What are you into?", kidTitle: "What do you like?", sub: `Aria builds her examples around these. Pick up to ${MAX_INTERESTS}.`, kidSub: `Aria will use these in examples. Tap up to ${MAX_INTERESTS}.`, max: MAX_INTERESTS },
  { key: "english", title: "How comfortable are you with English?", kidTitle: "Is English easy for you?", sub: "Lessons are in English. Aria can keep the words plain.", kidSub: "Lessons are in English.", max: 1 },
];

const OPTIONS: Record<Exclude<Key, "interests">, PreferenceOption<string>[]> = {
  goal: GOAL_OPTIONS,
  helps: HELP_OPTIONS,
  challenge: CHALLENGE_OPTIONS,
  english: ENGLISH_OPTIONS,
};

function picked(prefs: LearningPreferences, key: Key): string[] {
  const v = prefs[key];
  return Array.isArray(v) ? v : v ? [v] : [];
}

export function LearningPreferencesFlow({
  initial,
  kid = false,
  name,
  saving,
  error,
  finishLabel = "Finish",
  onFinish,
  onBack,
}: {
  initial?: LearningPreferences | null;
  /** Primary-school wording. */
  kid?: boolean;
  /** Greets them on the first question. */
  name?: string | null;
  saving: boolean;
  error?: string | null;
  finishLabel?: string;
  onFinish: (prefs: LearningPreferences) => void;
  /** Back from the first question (to the screen before), when there is one. */
  onBack?: () => void;
}) {
  const [prefs, setPrefs] = useState<LearningPreferences>(initial ?? emptyPreferences());
  const [index, setIndex] = useState(0);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const advanceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const q = QUESTIONS[index];
  const last = index === QUESTIONS.length - 1;
  const chosen = picked(prefs, q.key);

  // A new question is announced: focus its heading (not on first paint, which would scroll).
  const firstPaint = useRef(true);
  useEffect(() => {
    if (firstPaint.current) { firstPaint.current = false; return; }
    headingRef.current?.focus({ preventScroll: true });
  }, [index]);
  useEffect(() => () => { if (advanceTimer.current) clearTimeout(advanceTimer.current); }, []);

  function next(state = prefs) {
    if (advanceTimer.current) clearTimeout(advanceTimer.current);
    if (last) onFinish(state);
    else setIndex((i) => i + 1);
  }

  function choose(value: string) {
    if (saving) return;
    if (q.max === 1) {
      const state = { ...prefs, [q.key]: value } as LearningPreferences;
      setPrefs(state);
      // The last answer waits for Finish: saving should be a choice, not a side effect of a tap.
      if (last) return;
      // Long enough to see the card light up, short enough to feel like one tap.
      if (advanceTimer.current) clearTimeout(advanceTimer.current);
      advanceTimer.current = setTimeout(() => next(state), 280);
      return;
    }
    const list = picked(prefs, q.key);
    const on = list.includes(value);
    if (!on && list.length >= q.max) return;
    setPrefs({ ...prefs, [q.key]: on ? list.filter((v) => v !== value) : [...list, value] } as LearningPreferences);
  }

  function back() {
    if (advanceTimer.current) clearTimeout(advanceTimer.current);
    if (index > 0) setIndex(index - 1);
    else onBack?.();
  }

  const options: Array<{ value: string; label: string; hint: string; icon: string }> = q.key === "interests"
    ? INTERESTS.map((i) => ({ value: i.id, label: i.label, hint: "", icon: i.icon }))
    : OPTIONS[q.key].map((o) => ({ value: o.value, label: kid ? o.kidLabel ?? o.label : o.label, hint: kid ? o.kidHint ?? "" : o.hint, icon: o.icon }));
  const full = q.max > 1 && chosen.length >= q.max;

  return (
    <div>
      {/* Progress: one segment per question, so "how much is left" is visible at a glance. */}
      <div className="flex items-center justify-between gap-4">
        <p className="text-[0.75rem] font-semibold uppercase tracking-[0.14em] text-[var(--hud-text-faint)]" aria-live="polite">
          Question {index + 1} of {QUESTIONS.length}
        </p>
        <button
          type="button"
          onClick={() => next()}
          disabled={saving}
          className="text-[0.82rem] text-[var(--hud-text-dim)] underline decoration-[var(--hud-line-strong)] underline-offset-4 hover:text-[var(--hud-text)] disabled:opacity-50"
        >
          {last ? "Skip and finish" : "Skip"}
        </button>
      </div>
      <div className="mt-3 flex gap-1.5" aria-hidden="true">
        {QUESTIONS.map((item, i) => (
          <span
            key={item.key}
            className="h-1 flex-1 rounded-full transition-colors"
            style={{ background: i <= index ? "var(--hud-cyan)" : "var(--hud-line)", transitionDuration: "var(--motion-fast, 160ms)" }}
          />
        ))}
      </div>

      <div key={q.key} className="pref-step-in mt-9">
        {index === 0 && name && (
          <p className="mb-2 text-[0.95rem] text-[var(--hud-text-dim)]">Nice to meet you, {name.split(/\s+/)[0]}.</p>
        )}
        <h1 ref={headingRef} tabIndex={-1} className="font-display text-[2.1rem] leading-tight tracking-[-0.03em] text-[var(--hud-text)] focus:outline-none sm:text-[2.4rem]">
          {kid ? q.kidTitle : q.title}
        </h1>
        <p className="mt-3 text-[0.95rem] leading-relaxed text-[var(--hud-text-dim)]">{kid ? q.kidSub : q.sub}</p>

        <div
          role={q.max === 1 ? "radiogroup" : "group"}
          aria-label={kid ? q.kidTitle : q.title}
          className={q.key === "interests" ? "mt-8 grid grid-cols-2 gap-2 sm:grid-cols-3" : q.key === "challenge" || q.key === "english" ? "mt-8 grid gap-3 sm:grid-cols-3" : "mt-8 grid gap-3 sm:grid-cols-2"}
        >
          {options.map(({ value, label, hint, icon }) => {
            const on = chosen.includes(value);
            const Icon = ICONS[icon] ?? Lightbulb;
            const blocked = full && !on;
            const compact = q.key === "interests";
            return (
              <button
                key={value}
                type="button"
                {...(q.max === 1 ? { role: "radio", "aria-checked": on } : { "aria-pressed": on })}
                aria-disabled={blocked || undefined}
                onClick={() => choose(value)}
                disabled={saving}
                className={`group relative flex w-full items-center gap-3 rounded-[calc(var(--radius)+4px)] border text-left transition-[border-color,background,transform] hover:-translate-y-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--hud-cyan)] disabled:opacity-50 ${compact ? "px-3 py-3" : q.key === "challenge" || q.key === "english" ? "flex-col items-start px-4 py-4" : "px-4 py-4"}`}
                style={{
                  borderColor: on ? "var(--hud-cyan)" : "var(--hud-line-strong)",
                  background: on ? "var(--hud-cyan-glow)" : "var(--hud-surface)",
                  opacity: blocked ? 0.45 : 1,
                  transitionDuration: "var(--motion-fast, 160ms)",
                }}
              >
                <span
                  aria-hidden="true"
                  className={`grid shrink-0 place-items-center rounded-[var(--radius)] ${compact ? "size-8" : "size-10"}`}
                  style={{ background: on ? "var(--hud-cyan)" : "var(--hud-cyan-glow-soft)", color: on ? "var(--hud-bg)" : "var(--hud-cyan)" }}
                >
                  <Icon size={compact ? 16 : 19} strokeWidth={2} />
                </span>
                <span className="min-w-0 pr-5">
                  <span className={`block font-medium text-[var(--hud-text)] ${compact ? "text-[0.88rem]" : "text-[0.98rem]"}`}>{label}</span>
                  {hint && <span className="mt-0.5 block text-[0.8rem] leading-snug text-[var(--hud-text-faint)]">{hint}</span>}
                </span>
                {on && (
                  <span aria-hidden="true" className="absolute right-3 top-3 grid size-5 place-items-center rounded-full" style={{ background: "var(--hud-cyan)", color: "var(--hud-bg)" }}>
                    <Check size={12} strokeWidth={3} />
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {q.max > 1 && (
          <p className="mt-3 text-[0.8rem] text-[var(--hud-text-faint)]" aria-live="polite">
            {chosen.length === 0 ? "Nothing picked yet — that's fine too." : `${chosen.length} of ${q.max} picked${full ? " — that's the most; tap one to unpick it" : ""}`}
          </p>
        )}
      </div>

      {error && <p role="alert" className="mt-5 text-[0.82rem] text-[var(--hud-danger)]">{error}</p>}

      <div className="mt-10 flex items-center justify-between gap-3">
        {index > 0 || onBack ? (
          <button
            type="button"
            onClick={back}
            disabled={saving}
            className="inline-flex items-center gap-1.5 text-[0.86rem] text-[var(--hud-text-dim)] hover:text-[var(--hud-text)] disabled:opacity-50"
          >
            <ArrowLeft aria-hidden="true" size={14} /> Back
          </button>
        ) : <span />}
        {/* A single answer moves on by itself; Continue is there for pick-several questions, for an
            answer already given (after going back), and for the last question. */}
        {(q.max > 1 || chosen.length > 0 || last) && (
          <button
            type="button"
            onClick={() => next()}
            disabled={saving}
            className="hud-btn-primary inline-flex min-w-[9rem] items-center justify-center gap-2 rounded-[var(--radius)] px-6 py-3 text-[0.95rem] disabled:opacity-50"
          >
            {saving ? <><Loader2 aria-hidden="true" size={15} className="animate-spin" /> Saving…</>
              : last ? <>{finishLabel} <ArrowRight aria-hidden="true" size={15} /></>
              : <>Continue <ArrowRight aria-hidden="true" size={15} /></>}
          </button>
        )}
      </div>
    </div>
  );
}

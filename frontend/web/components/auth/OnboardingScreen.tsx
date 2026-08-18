"use client";

import { useState } from "react";
import { ArrowRight, Loader2 } from "lucide-react";
import { PREFERENCES, PROFILE_OPTIONS } from "@/lib/accessibilityProfiles";
import type { AccessibilityProfile } from "@/lib/db/cosmos";

/**
 * The learning profile, asked once.
 *
 * ONE PROFILE, NOT A CHECKLIST. Earlier this screen offered independent checkboxes for ADHD,
 * dyslexia and hearing plus a separate vision question, which quietly promised combinations the
 * player cannot deliver: a lecture cannot be simultaneously audio-only (blind) and caption-first
 * (deaf), and the ADHD and dyslexia tracks restructure the same beats in different ways. Asking for
 * one answer is honest about that, and it is the whole reason the choice is easy to change from
 * settings later — someone who is both low-vision and ADHD picks whichever matters more today.
 *
 * The preferences underneath ARE multi-select, because those genuinely do compose.
 *
 * Nothing is required, and unanswered is stored as null rather than false. A student who skips a
 * question has not told us the answer is no — collapsing silence into "no" is how accessibility
 * features end up never reaching the people they exist for.
 */
type Tri = boolean | null;

type State = {
  displayName: string;
  age: string;
  accessibility: AccessibilityProfile | null;
  captions: Tri;
  reducedMotion: Tri;
  slowerPace: Tri;
  simplerLanguage: Tri;
  notes: string;
};

export function OnboardingScreen({ email, onDone }: { email: string; onDone: () => void }) {
  const [s, setS] = useState<State>({
    displayName: "", age: "", accessibility: null,
    captions: null, reducedMotion: null, slowerPace: null, simplerLanguage: null,
    notes: "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/onboarding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...s, age: s.age ? Number(s.age) : null }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Could not save that.");
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save that.");
      setBusy(false);
    }
  }

  return (
    <main className="hud-canvas hud-grain relative min-h-screen overflow-y-auto px-6 py-16">
      <div className="relative z-10 mx-auto w-full max-w-lg">
        <h1 className="font-display text-[2.4rem] leading-tight tracking-[-0.03em] text-[var(--hud-text)]">
          Before we start.
        </h1>
        <p className="mt-3 text-[0.95rem] leading-relaxed text-[var(--hud-text-dim)]">
          Aria adapts to how you learn. Answer what is useful and skip the rest — you can change any
          of it later in settings.
        </p>
        {email && <p className="mt-1 text-[0.78rem] text-[var(--hud-text-faint)]">Signed in as {email}</p>}

        <form onSubmit={submit} className="mt-10 space-y-8">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="name" className="mb-1.5 block text-[0.82rem] text-[var(--hud-text-dim)]">
                What should Aria call you?
              </label>
              <input
                id="name" value={s.displayName}
                onChange={(e) => setS({ ...s, displayName: e.target.value })}
                placeholder="Your name"
                className="w-full rounded-[var(--radius)] border bg-[var(--hud-surface)] px-3.5 py-2.5 text-[0.92rem] text-[var(--hud-text)] placeholder:text-[var(--hud-text-faint)] focus:outline-none focus:ring-1 focus:ring-[var(--hud-cyan)]"
                style={{ borderColor: "var(--hud-line)" }}
              />
            </div>
            <div>
              <label htmlFor="age" className="mb-1.5 block text-[0.82rem] text-[var(--hud-text-dim)]">
                Age
              </label>
              <input
                id="age" type="number" min={5} max={120} value={s.age}
                onChange={(e) => setS({ ...s, age: e.target.value })}
                placeholder="e.g. 21"
                className="w-full rounded-[var(--radius)] border bg-[var(--hud-surface)] px-3.5 py-2.5 text-[0.92rem] text-[var(--hud-text)] placeholder:text-[var(--hud-text-faint)] focus:outline-none focus:ring-1 focus:ring-[var(--hud-cyan)]"
                style={{ borderColor: "var(--hud-line)" }}
              />
            </div>
          </div>

          {/* A real radiogroup, not styled buttons with aria-pressed. Arrow keys move between
              options and only one is ever announced as selected, which is precisely the constraint
              this question has. */}
          <fieldset role="radiogroup" aria-labelledby="a11y-legend">
            <legend id="a11y-legend" className="mb-1 text-[0.95rem] text-[var(--hud-text)]">
              Which one describes you best?
            </legend>
            <p className="mb-3 text-[0.78rem] text-[var(--hud-text-faint)]">
              Pick one — it shapes how every lecture is built. You can switch it whenever you like.
            </p>
            <div className="space-y-1.5">
              {PROFILE_OPTIONS.map(({ value, label, effect }) => {
                const on = s.accessibility === value;
                return (
                  <button
                    key={value} type="button" role="radio" aria-checked={on}
                    onClick={() => setS({ ...s, accessibility: value })}
                    className="flex w-full items-start gap-3 rounded-[var(--radius)] border px-3.5 py-3 text-left transition-colors"
                    style={{
                      borderColor: on ? "var(--hud-cyan)" : "var(--hud-line)",
                      background: on ? "var(--hud-cyan-glow)" : "transparent",
                      transitionDuration: "var(--motion-fast)",
                    }}
                  >
                    {/* A ring, not a tick box — the shape itself says "one of these". */}
                    <span
                      aria-hidden="true"
                      className="mt-0.5 grid size-4 shrink-0 place-items-center rounded-full border"
                      style={{ borderColor: on ? "var(--hud-cyan)" : "var(--hud-line-strong)" }}
                    >
                      {on && <span className="size-2 rounded-full" style={{ background: "var(--hud-cyan)" }} />}
                    </span>
                    <span>
                      <span className="block text-[0.9rem] text-[var(--hud-text)]">{label}</span>
                      <span className="mt-0.5 block text-[0.76rem] leading-relaxed text-[var(--hud-text-faint)]">
                        {effect}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          </fieldset>

          <fieldset>
            <legend className="mb-2.5 text-[0.82rem] text-[var(--hud-text-dim)]">
              Anything else that would help? Choose any.
            </legend>
            <div className="space-y-1.5">
              {PREFERENCES.map(({ key, label, hint }) => {
                const on = s[key] === true;
                return (
                  <button
                    key={key} type="button" aria-pressed={on}
                    onClick={() => setS((prev) => ({ ...prev, [key]: prev[key] === true ? null : true }))}
                    className="flex w-full items-start gap-3 rounded-[var(--radius)] border px-3.5 py-2.5 text-left transition-colors"
                    style={{
                      borderColor: on ? "var(--hud-cyan)" : "var(--hud-line)",
                      background: on ? "var(--hud-cyan-glow)" : "transparent",
                    }}
                  >
                    <span
                      aria-hidden="true"
                      className="mt-0.5 grid size-4 shrink-0 place-items-center rounded-[3px] border text-[10px]"
                      style={{
                        borderColor: on ? "var(--hud-cyan)" : "var(--hud-line-strong)",
                        background: on ? "var(--hud-cyan)" : "transparent",
                        color: "var(--hud-bg)",
                      }}
                    >
                      {on ? "✓" : ""}
                    </span>
                    <span>
                      <span className="block text-[0.9rem] text-[var(--hud-text)]">{label}</span>
                      <span className="mt-0.5 block text-[0.76rem] text-[var(--hud-text-faint)]">{hint}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          </fieldset>

          <div>
            <label htmlFor="notes" className="mb-1.5 block text-[0.82rem] text-[var(--hud-text-dim)]">
              Anything else Aria should know? (optional)
            </label>
            <textarea
              id="notes" rows={2} value={s.notes}
              onChange={(e) => setS({ ...s, notes: e.target.value })}
              placeholder="How you learn best, what you find hard…"
              className="w-full resize-none rounded-[var(--radius)] border bg-[var(--hud-surface)] px-3.5 py-2.5 text-[0.9rem] text-[var(--hud-text)] placeholder:text-[var(--hud-text-faint)] focus:outline-none focus:ring-1 focus:ring-[var(--hud-cyan)]"
              style={{ borderColor: "var(--hud-line)" }}
            />
          </div>

          {error && <p role="alert" className="text-[0.82rem] text-[var(--hud-danger)]">{error}</p>}

          <button
            type="submit" disabled={busy}
            className="hud-btn-primary inline-flex w-full items-center justify-center gap-2 rounded-[var(--radius)] px-6 py-3 text-[0.95rem] disabled:opacity-50"
          >
            {busy ? <><Loader2 aria-hidden="true" size={15} className="animate-spin" /> Saving…</>
                  : <>Start learning <ArrowRight aria-hidden="true" size={15} /></>}
          </button>
        </form>
      </div>
    </main>
  );
}

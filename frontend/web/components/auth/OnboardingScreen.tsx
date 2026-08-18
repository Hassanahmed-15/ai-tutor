"use client";

import { useState } from "react";
import { ArrowRight, Loader2 } from "lucide-react";

/**
 * The learning profile, asked once.
 *
 * WHY THESE QUESTIONS, AND WHY THEY ARE OPTIONAL. Each answer changes what a lecture DOES, not
 * merely how it looks — captions change whether meaning ever lives in audio alone, reduced motion
 * changes whether the board draws itself or simply appears, simpler language changes the script.
 * Asking them is only worth it if they are acted on.
 *
 * Nothing is required, and unanswered is stored as null rather than false. A student who skips
 * "are you dyslexic?" has not told us they are not — collapsing silence into "no" is how
 * accessibility features end up never reaching the people they exist for.
 *
 * Phrasing is first-person and plain ("I use a screen reader"), not clinical. This is a form about
 * someone's body and mind, and the tone should not read like an intake questionnaire.
 */
type Tri = boolean | null;

const SUPPORTS: { key: keyof State; label: string; hint: string }[] = [
  { key: "adhd", label: "I have ADHD", hint: "Shorter beats, and a pause when attention drifts." },
  { key: "dyslexia", label: "I have dyslexia", hint: "Less text on the board, more spoken explanation." },
  { key: "hearing", label: "I am deaf or hard of hearing", hint: "Everything spoken is also written." },
  { key: "captions", label: "Always caption the narration", hint: "Useful whether or not you can hear it." },
  { key: "reducedMotion", label: "Reduce motion", hint: "Boards appear instead of animating." },
  { key: "slowerPace", label: "Go at a slower pace", hint: "Longer pauses, more time at checkpoints." },
  { key: "simplerLanguage", label: "Use simpler language", hint: "Shorter sentences, fewer clauses." },
];

type State = {
  displayName: string;
  age: string;
  vision: string | null;
  adhd: Tri;
  dyslexia: Tri;
  hearing: Tri;
  captions: Tri;
  reducedMotion: Tri;
  slowerPace: Tri;
  simplerLanguage: Tri;
  notes: string;
};

export function OnboardingScreen({ email, onDone }: { email: string; onDone: () => void }) {
  const [s, setS] = useState<State>({
    displayName: "", age: "", vision: null,
    adhd: null, dyslexia: null, hearing: null,
    captions: null, reducedMotion: null, slowerPace: null, simplerLanguage: null,
    notes: "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggle(key: keyof State) {
    setS((prev) => ({ ...prev, [key]: prev[key] === true ? null : true }));
  }

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
          of it later.
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

          <fieldset>
            <legend className="mb-2.5 text-[0.82rem] text-[var(--hud-text-dim)]">How do you read the board?</legend>
            <div className="flex flex-wrap gap-2">
              {[
                ["normal", "I read it on screen"],
                ["low-vision", "I have low vision"],
                ["blind", "I use a screen reader"],
              ].map(([value, label]) => {
                const on = s.vision === value;
                return (
                  <button
                    key={value} type="button"
                    onClick={() => setS({ ...s, vision: on ? null : value })}
                    aria-pressed={on}
                    className="rounded-[var(--radius)] border px-3.5 py-2 text-[0.85rem] transition-colors"
                    style={{
                      borderColor: on ? "var(--hud-cyan)" : "var(--hud-line)",
                      background: on ? "var(--hud-cyan-glow)" : "transparent",
                      color: on ? "var(--hud-cyan-bright)" : "var(--hud-text-dim)",
                    }}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </fieldset>

          <fieldset>
            <legend className="mb-2.5 text-[0.82rem] text-[var(--hud-text-dim)]">
              Anything that would help? Choose any.
            </legend>
            <div className="space-y-1.5">
              {SUPPORTS.map(({ key, label, hint }) => {
                const on = s[key] === true;
                return (
                  <button
                    key={key} type="button" onClick={() => toggle(key)} aria-pressed={on}
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

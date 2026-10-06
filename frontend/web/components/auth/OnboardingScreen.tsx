"use client";

import { AriaLockup } from "@/components/brand/AriaMark";
import { useEffect, useState } from "react";
import { ArrowLeft, ArrowRight, Loader2 } from "lucide-react";
import { PREFERENCES, PROFILE_OPTIONS } from "@/lib/accessibilityProfiles";
import type { AccessibilityProfile } from "@/lib/db/cosmos";
import { levelBand } from "@/lib/education";
import type { LearningPreferences } from "@/lib/learningPreferences";
import type { LearnerProfile } from "./AuthGate";
import { LearnerProfileFields, type LearnerFieldsValue } from "./LearnerProfileFields";
import { LearningPreferencesFlow } from "./LearningPreferencesFlow";

/**
 * ONBOARDING, THREE SCREENS (owner's spec, 2026-09-29; the middle one added 2026-10-05).
 *
 *  1. THE LEARNER PROFILE — name, age, country (detected from the IP address, always editable),
 *     study level, subjects, curriculum/exam/track. It sets up the learner's educational context so
 *     Aria's homepage suggestions, terminology, examples and questions fit from the first lesson.
 *     Name, level and at least one subject are required; the rest can be skipped.
 *  2. HOW THEY LIKE TO LEARN — five tap-only questions, one at a time, every one skippable
 *     (components/auth/LearningPreferencesFlow.tsx). They become the Teaching Policy every lecture
 *     follows (lib/teachingPolicy.ts).
 *  3. ACCESSIBILITY — first a single question. "No, continue" finishes onboarding without the full
 *     menu; "Yes, customize my experience" opens it. Whatever is chosen is stored on the profile and
 *     applied automatically in every session, exactly as before.
 *
 * An account made before a screen existed (`profileOnly`) sees just the screens it is missing — the
 * profile and/or the preferences — once, prefilled, and goes straight back in: its accessibility
 * choices are kept as they are.
 *
 * ONE PROFILE, NOT A CHECKLIST (screen 3, unchanged). A lecture cannot be simultaneously audio-only
 * (blind) and caption-first (deaf), and the ADHD and dyslexia tracks restructure the same beats in
 * different ways, so the profile is one choice; the preferences under it DO compose. Unanswered is
 * stored as null rather than false — silence is not a "no".
 */
type Tri = boolean | null;
type Step = "profile" | "preferences" | "access";

type Access = {
  accessibility: AccessibilityProfile | null;
  captions: Tri;
  reducedMotion: Tri;
  slowerPace: Tri;
  simplerLanguage: Tri;
  notes: string;
};

const INPUT =
  "w-full rounded-[var(--radius)] border border-[var(--input-border)] bg-[var(--hud-surface)] px-4 py-3 text-[0.93rem] text-[var(--hud-text)] placeholder:text-[var(--hud-text-faint)] focus:border-[var(--hud-cyan)] focus:outline-none focus:ring-2 focus:ring-[var(--hud-cyan-glow)]";
const LABEL = "mb-1.5 block text-[0.84rem] font-medium text-[var(--hud-text)]";

export function OnboardingScreen({
  email,
  profile,
  profileOnly = false,
  needsPreferences = false,
  onDone,
}: {
  email: string;
  profile?: LearnerProfile;
  /** Already onboarded before the newer screens existed: only the missing ones. */
  profileOnly?: boolean;
  /** The preferences screen has not been seen yet. */
  needsPreferences?: boolean;
  onDone: () => void;
}) {
  const learner = profile?.learner ?? null;
  // The screens this account still needs, in order. A new account resumes where it left off.
  const steps: Step[] = profileOnly
    ? ([] as Step[]).concat(learner?.completedAt ? [] : ["profile"], needsPreferences ? ["preferences"] : [])
    : ["profile", "preferences", "access"];
  const firstStep: Step = profileOnly
    ? steps[0] ?? "profile"
    : !learner?.completedAt ? "profile" : !learner.preferences?.completedAt ? "preferences" : "access";
  const [step, setStep] = useState<Step>(firstStep);
  const stepAfter = (current: Step): Step | null => steps[steps.indexOf(current) + 1] ?? null;
  const [displayName, setDisplayName] = useState(profile?.displayName ?? "");
  const [age, setAge] = useState(profile?.age ? String(profile.age) : "");
  const [fields, setFields] = useState<LearnerFieldsValue>({
    country: learner?.country ?? null,
    countrySource: learner?.countrySource ?? null,
    studyLevel: learner?.studyLevel ?? null,
    subjects: learner?.subjects ?? [],
    curricula: learner?.curricula ?? [],
  });
  const [detecting, setDetecting] = useState(!learner?.country);
  const [needsHelp, setNeedsHelp] = useState<boolean | null>(null);
  const [access, setAccess] = useState<Access>({
    accessibility: profile?.accessibility ?? null,
    captions: profile?.captions ?? null,
    reducedMotion: profile?.reducedMotion ?? null,
    slowerPace: profile?.slowerPace ?? null,
    simplerLanguage: profile?.simplerLanguage ?? null,
    notes: profile?.notes ?? "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The country, from the IP address (or the browser's language) — prefilled, never locked.
  useEffect(() => {
    if (learner?.country) return;
    let cancelled = false;
    fetch("/api/geo", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled || !data?.country) return;
        setFields((f) => (f.country ? f : { ...f, country: data.country, countrySource: data.source === "ip" ? "ip" : "language" }));
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setDetecting(false); });
    return () => { cancelled = true; };
  }, [learner?.country]);

  async function save(body: Record<string, unknown>) {
    const res = await fetch("/api/onboarding", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Could not save that.");
  }

  async function submitProfile(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    const missing = [!displayName.trim() && "your name", !fields.studyLevel && "a study level", fields.subjects.length === 0 && "at least one subject"].filter(Boolean);
    if (missing.length) {
      setError(`Please add ${missing.join(", ")}.`);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await save({
        displayName: displayName.trim(),
        age: age ? Number(age) : null,
        learner: { ...fields, complete: true },
        // Screen 1 of 3 for a new account; an existing one is already onboarded.
        ...(profileOnly ? {} : { complete: false }),
      });
      goTo(stepAfter("profile"));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save that.");
      setBusy(false);
    }
  }

  /** On to the next screen, or into the app when this was the last one this account needed. */
  function goTo(next: Step | null) {
    if (!next) return onDone();
    setBusy(false);
    setError(null);
    setStep(next);
    window.scrollTo({ top: 0 });
  }

  async function savePreferences(prefs: LearningPreferences) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await save({
        // Finishing — answered or skipped — marks the screen seen, so it is shown once.
        learner: { preferences: { ...prefs, complete: true } },
        ...(profileOnly ? {} : { complete: false }),
      });
      goTo(stepAfter("preferences"));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save that.");
      setBusy(false);
    }
  }

  // Primary-school students read the kid wording on the preferences screen.
  const kid = levelBand(fields.studyLevel) === "primary" || (Number(age) > 0 && Number(age) <= 11);

  async function finish(withSupport: boolean) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await save(
        withSupport
          ? { ...access, complete: true }
          // "No, continue": an active "no accommodation needed" — not the same as unanswered.
          : { accessibility: "none", complete: true },
      );
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save that.");
      setBusy(false);
    }
  }

  return (
    <main className="hud-canvas relative min-h-screen overflow-y-auto px-6 py-14">
      <div className={`relative z-10 mx-auto w-full ${step === "preferences" ? "max-w-2xl" : "max-w-lg"}`}>
        <div className="mb-10 flex items-center justify-between">
          <AriaLockup size={24} />
          {steps.length > 1 && step !== "preferences" && (
            <p className="flex items-center gap-3 text-[0.8125rem] text-[var(--hud-text-dim)]" aria-live="polite">
              Step {steps.indexOf(step) + 1} of {steps.length}
              <span aria-hidden="true" className="flex gap-1">
                {steps.map((s, i) => (
                  <span key={s} className={`h-1 w-6 rounded-full ${i <= steps.indexOf(step) ? "bg-[var(--hud-cyan)]" : "bg-[var(--hud-line)]"}`} />
                ))}
              </span>
            </p>
          )}
        </div>

        {step === "preferences" ? (
          <LearningPreferencesFlow
            initial={learner?.preferences ?? null}
            kid={kid}
            name={displayName}
            saving={busy}
            error={error}
            finishLabel={stepAfter("preferences") ? "Continue" : "Start learning"}
            onFinish={(prefs) => void savePreferences(prefs)}
            onBack={steps.includes("profile") ? () => goTo("profile") : undefined}
          />
        ) : step === "profile" ? (
          <>
            <h1 className="font-display text-[1.75rem] leading-tight tracking-[-0.02em] text-[var(--hud-text)]">
              {profileOnly ? "Tell Aria about your studies." : "Before we start."}
            </h1>
            <p className="mt-3 text-[0.95rem] leading-relaxed text-[var(--hud-text-dim)]">
              {profileOnly
                ? "Aria now tailors suggestions, examples and terminology to what you study. This takes a minute, and you can change it later in settings."
                : "Tell Aria what you study, so lessons use the right level, terms and examples from the start. You can change any of it later in settings."}
            </p>
            {email && <p className="mt-1 text-[0.78rem] text-[var(--hud-text-faint)]">Signed in as {email}</p>}

            <form onSubmit={submitProfile} className="mt-9 space-y-7" noValidate>
              <div className="grid gap-4 sm:grid-cols-[1fr_8rem]">
                <div>
                  <label htmlFor="name" className={LABEL}>
                    Name<span className="ml-1 text-[var(--hud-text-faint)]" aria-hidden="true">*</span>
                  </label>
                  <input
                    id="name" value={displayName} required aria-required="true" autoComplete="given-name"
                    onChange={(e) => setDisplayName(e.target.value)}
                    placeholder="What should Aria call you?"
                    className={INPUT} style={{ borderColor: "var(--hud-line)" }}
                  />
                </div>
                <div>
                  <label htmlFor="age" className={LABEL}>Age</label>
                  <input
                    id="age" type="number" min={5} max={120} inputMode="numeric" value={age}
                    onChange={(e) => setAge(e.target.value)}
                    placeholder="e.g. 17"
                    className={INPUT} style={{ borderColor: "var(--hud-line)" }}
                  />
                </div>
              </div>

              <LearnerProfileFields value={fields} onChange={setFields} detecting={detecting} />

              <p className="text-[0.76rem] text-[var(--hud-text-faint)]"><span aria-hidden="true">*</span> Required</p>

              {error && <p role="alert" className="text-[0.82rem] text-[var(--hud-danger)]">{error}</p>}

              <button
                type="submit" disabled={busy}
                className="hud-btn-primary inline-flex w-full items-center justify-center gap-2 rounded-[var(--radius)] px-6 py-3 text-[0.95rem] disabled:opacity-50"
              >
                {busy ? <><Loader2 aria-hidden="true" size={15} className="animate-spin" /> Saving…</>
                      : profileOnly ? <>Save and continue <ArrowRight aria-hidden="true" size={15} /></>
                      : <>Continue <ArrowRight aria-hidden="true" size={15} /></>}
              </button>
            </form>
          </>
        ) : (
          <>
            <h1 className="font-display text-[1.75rem] leading-tight tracking-[-0.02em] text-[var(--hud-text)]">
              Do you need any accessibility support while using Aria?
            </h1>
            <p className="mt-3 text-[0.95rem] leading-relaxed text-[var(--hud-text-dim)]">
              Aria can change how lessons are shown and paced. You can set this up any time later in settings.
            </p>

            <div className="mt-8 grid gap-3 sm:grid-cols-2" role="group" aria-label="Accessibility support">
              <button
                type="button"
                aria-pressed={needsHelp === true}
                onClick={() => setNeedsHelp(true)}
                disabled={busy}
                className="rounded-[var(--radius)] border px-4 py-3.5 text-left text-[0.93rem] text-[var(--hud-text)] transition-colors disabled:opacity-50"
                style={{ borderColor: needsHelp === true ? "var(--hud-cyan)" : "var(--hud-line-strong)", background: needsHelp === true ? "var(--hud-cyan-glow)" : "transparent" }}
              >
                Yes, customize my experience
              </button>
              <button
                type="button"
                onClick={() => void finish(false)}
                disabled={busy}
                className="inline-flex items-center justify-between gap-2 rounded-[var(--radius)] border px-4 py-3.5 text-left text-[0.93rem] text-[var(--hud-text)] transition-colors hover:bg-[var(--hud-surface)] disabled:opacity-50"
                style={{ borderColor: "var(--hud-line-strong)" }}
              >
                No, continue {busy && needsHelp !== true ? <Loader2 aria-hidden="true" size={15} className="animate-spin" /> : <ArrowRight aria-hidden="true" size={15} />}
              </button>
            </div>

            {needsHelp === true && (
              <form
                onSubmit={(e) => { e.preventDefault(); void finish(true); }}
                className="mt-10 space-y-8"
              >
                {/* A real radiogroup: arrow keys move between options and only one is announced as
                    selected, which is precisely the constraint this question has. */}
                <fieldset role="radiogroup" aria-labelledby="a11y-legend">
                  <legend id="a11y-legend" className="mb-1 text-[0.95rem] text-[var(--hud-text)]">
                    Which one describes you best?
                  </legend>
                  <p className="mb-3 text-[0.78rem] text-[var(--hud-text-faint)]">
                    Pick one — it shapes how every lecture is built. You can switch it whenever you like.
                  </p>
                  <div className="space-y-1.5">
                    {PROFILE_OPTIONS.map(({ value, label, effect }) => {
                      const on = access.accessibility === value;
                      return (
                        <button
                          key={value} type="button" role="radio" aria-checked={on}
                          onClick={() => setAccess({ ...access, accessibility: value })}
                          className="flex w-full items-start gap-3 rounded-[var(--radius)] border px-3.5 py-3 text-left transition-colors"
                          style={{
                            borderColor: on ? "var(--hud-cyan)" : "var(--hud-line)",
                            background: on ? "var(--hud-cyan-glow)" : "transparent",
                            transitionDuration: "var(--motion-fast)",
                          }}
                        >
                          <span
                            aria-hidden="true"
                            className="mt-0.5 grid size-4 shrink-0 place-items-center rounded-full border"
                            style={{ borderColor: on ? "var(--hud-cyan)" : "var(--hud-line-strong)" }}
                          >
                            {on && <span className="size-2 rounded-full" style={{ background: "var(--hud-cyan)" }} />}
                          </span>
                          <span>
                            <span className="block text-[0.9rem] text-[var(--hud-text)]">{label}</span>
                            <span className="mt-0.5 block text-[0.76rem] leading-relaxed text-[var(--hud-text-faint)]">{effect}</span>
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
                      const on = access[key] === true;
                      return (
                        <button
                          key={key} type="button" aria-pressed={on}
                          onClick={() => setAccess((prev) => ({ ...prev, [key]: prev[key] === true ? null : true }))}
                          className="flex w-full items-start gap-3 rounded-[var(--radius)] border px-3.5 py-2.5 text-left transition-colors"
                          style={{ borderColor: on ? "var(--hud-cyan)" : "var(--hud-line)", background: on ? "var(--hud-cyan-glow)" : "transparent" }}
                        >
                          <span
                            aria-hidden="true"
                            className="mt-0.5 grid size-4 shrink-0 place-items-center rounded-[3px] border text-[10px]"
                            style={{ borderColor: on ? "var(--hud-cyan)" : "var(--hud-line-strong)", background: on ? "var(--hud-cyan)" : "transparent", color: "var(--hud-bg)" }}
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
                    id="notes" rows={2} value={access.notes}
                    onChange={(e) => setAccess({ ...access, notes: e.target.value })}
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
            )}

            {needsHelp !== true && error && <p role="alert" className="mt-4 text-[0.82rem] text-[var(--hud-danger)]">{error}</p>}

            <button
              type="button"
              onClick={() => { setStep("preferences"); setError(null); }}
              disabled={busy}
              className="mt-8 inline-flex items-center gap-1.5 text-[0.84rem] text-[var(--hud-text-dim)] hover:text-[var(--hud-text)]"
            >
              <ArrowLeft aria-hidden="true" size={14} /> Back to how you like to learn
            </button>
          </>
        )}
      </div>
    </main>
  );
}

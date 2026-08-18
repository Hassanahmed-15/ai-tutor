"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Loader2, LogOut, X } from "lucide-react";
import { PREFERENCES, PROFILE_OPTIONS } from "@/lib/accessibilityProfiles";
import type { AccessibilityProfile } from "@/lib/db/cosmos";
import type { LearnerProfile, SessionUser } from "./AuthGate";

/**
 * Profile and settings.
 *
 * THE POINT OF THIS SCREEN is that the accessibility profile is switchable. Onboarding asks for one
 * answer because the lecture engine can only run one at a time — but "one at a time" is not "one
 * forever". Someone who is both low-vision and ADHD genuinely needs to move between the two, and a
 * disability someone acquires or a day when a different accommodation matters more should take two
 * clicks, not a support request. Everything else here follows from that: same options, same
 * wording, same shape as onboarding, so switching feels like revisiting a decision rather than
 * filling in a new form.
 *
 * Saving is explicit rather than per-toggle. Switching profile restructures the next lecture, and a
 * change that large should be something you commit to, not something that happens while you are
 * still reading the options.
 */
export function SettingsScreen({
  user,
  profile,
  onClose,
  onSaved,
}: {
  user: SessionUser | null;
  profile: LearnerProfile;
  onClose: () => void;
  onSaved: () => Promise<void> | void;
}) {
  const [username, setUsername] = useState(user?.username ?? "");
  const [displayName, setDisplayName] = useState(profile?.displayName ?? "");
  const [age, setAge] = useState(profile?.age != null ? String(profile.age) : "");
  const [accessibility, setAccessibility] = useState<AccessibilityProfile | null>(
    profile?.accessibility ?? null,
  );
  const [prefs, setPrefs] = useState({
    captions: profile?.captions ?? null,
    reducedMotion: profile?.reducedMotion ?? null,
    slowerPace: profile?.slowerPace ?? null,
    simplerLanguage: profile?.simplerLanguage ?? null,
  });
  const [notes, setNotes] = useState(profile?.notes ?? "");

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  // Escape closes, and focus starts inside the panel — the minimum a modal owes a keyboard user.
  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const res = await fetch("/api/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username,
          displayName,
          age: age ? Number(age) : null,
          accessibility,
          ...prefs,
          notes,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Could not save that.");
      setSaved(true);
      await onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save that.");
    } finally {
      setBusy(false);
    }
  }

  async function signOut() {
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
    // A full reload rather than a state refresh: signing out should leave nothing of the previous
    // session in memory, including any lecture the player still holds.
    window.location.reload();
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="settings-title"
      className="fixed inset-0 z-50 overflow-y-auto"
      style={{ background: "color-mix(in srgb, var(--hud-bg) 88%, transparent)", backdropFilter: "blur(6px)" }}
      onMouseDown={(e) => {
        // Only a click on the backdrop itself closes — not one that started inside the panel and
        // drifted out, which is how text selection near an edge otherwise loses your edits.
        if (!panelRef.current?.contains(e.target as Node)) onClose();
      }}
    >
      <div className="min-h-screen px-6 py-12">
        <div
          ref={panelRef}
          className="hud-materialize mx-auto w-full max-w-lg rounded-[var(--radius-lg)] border p-7"
          style={{ borderColor: "var(--hud-line)", background: "var(--hud-surface)" }}
        >
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2
                id="settings-title"
                className="font-display text-[1.8rem] leading-tight tracking-[-0.03em] text-[var(--hud-text)]"
              >
                Profile & settings
              </h2>
              <p className="mt-1 text-[0.8rem] text-[var(--hud-text-faint)]">{user?.email}</p>
            </div>
            <button
              ref={closeRef}
              type="button"
              onClick={onClose}
              aria-label="Close settings"
              className="grid size-9 shrink-0 place-items-center rounded-[var(--radius)] text-[var(--hud-text-faint)] transition-colors hover:bg-[var(--hud-surface-2)] hover:text-[var(--hud-text)]"
            >
              <X aria-hidden="true" size={17} />
            </button>
          </div>

          <form onSubmit={save} className="mt-8 space-y-8">
            <section>
              <h3 className="mb-3 text-[0.95rem] text-[var(--hud-text)]">Account</h3>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <label htmlFor="set-username" className="mb-1.5 block text-[0.82rem] text-[var(--hud-text-dim)]">
                    Username
                  </label>
                  <input
                    id="set-username"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    minLength={3}
                    maxLength={24}
                    pattern="[A-Za-z0-9_\-]{3,24}"
                    title="3–24 characters: letters, numbers, hyphen or underscore."
                    className="w-full rounded-[var(--radius)] border bg-[var(--hud-bg)] px-3.5 py-2.5 text-[0.92rem] text-[var(--hud-text)] focus:outline-none focus:ring-1 focus:ring-[var(--hud-cyan)]"
                    style={{ borderColor: "var(--hud-line)" }}
                  />
                </div>
                <div>
                  <label htmlFor="set-name" className="mb-1.5 block text-[0.82rem] text-[var(--hud-text-dim)]">
                    What Aria calls you
                  </label>
                  <input
                    id="set-name"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    placeholder="Your name"
                    className="w-full rounded-[var(--radius)] border bg-[var(--hud-bg)] px-3.5 py-2.5 text-[0.92rem] text-[var(--hud-text)] placeholder:text-[var(--hud-text-faint)] focus:outline-none focus:ring-1 focus:ring-[var(--hud-cyan)]"
                    style={{ borderColor: "var(--hud-line)" }}
                  />
                </div>
                <div>
                  <label htmlFor="set-age" className="mb-1.5 block text-[0.82rem] text-[var(--hud-text-dim)]">
                    Age
                  </label>
                  <input
                    id="set-age"
                    type="number"
                    min={5}
                    max={120}
                    value={age}
                    onChange={(e) => setAge(e.target.value)}
                    className="w-full rounded-[var(--radius)] border bg-[var(--hud-bg)] px-3.5 py-2.5 text-[0.92rem] text-[var(--hud-text)] focus:outline-none focus:ring-1 focus:ring-[var(--hud-cyan)]"
                    style={{ borderColor: "var(--hud-line)" }}
                  />
                </div>
              </div>
            </section>

            <section>
              <fieldset role="radiogroup" aria-labelledby="set-a11y-legend">
                <legend id="set-a11y-legend" className="mb-1 text-[0.95rem] text-[var(--hud-text)]">
                  Accessibility profile
                </legend>
                <p className="mb-3 text-[0.78rem] leading-relaxed text-[var(--hud-text-faint)]">
                  One at a time, and switchable whenever you need. It takes effect on your next lecture.
                </p>
                <div className="space-y-1.5">
                  {PROFILE_OPTIONS.map(({ value, label, effect }) => {
                    const on = accessibility === value;
                    return (
                      <button
                        key={value}
                        type="button"
                        role="radio"
                        aria-checked={on}
                        onClick={() => setAccessibility(value)}
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
                          <span className="mt-0.5 block text-[0.76rem] leading-relaxed text-[var(--hud-text-faint)]">
                            {effect}
                          </span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              </fieldset>
            </section>

            <section>
              <fieldset>
                <legend className="mb-1 text-[0.95rem] text-[var(--hud-text)]">Preferences</legend>
                <p className="mb-3 text-[0.78rem] text-[var(--hud-text-faint)]">
                  These stack — turn on as many as help.
                </p>
                <div className="space-y-1.5">
                  {PREFERENCES.map(({ key, label, hint }) => {
                    const on = prefs[key] === true;
                    return (
                      <button
                        key={key}
                        type="button"
                        aria-pressed={on}
                        onClick={() => setPrefs((p) => ({ ...p, [key]: p[key] === true ? null : true }))}
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
            </section>

            <section>
              <label htmlFor="set-notes" className="mb-1.5 block text-[0.82rem] text-[var(--hud-text-dim)]">
                Anything else Aria should know?
              </label>
              <textarea
                id="set-notes"
                rows={2}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="How you learn best, what you find hard…"
                className="w-full resize-none rounded-[var(--radius)] border bg-[var(--hud-bg)] px-3.5 py-2.5 text-[0.9rem] text-[var(--hud-text)] placeholder:text-[var(--hud-text-faint)] focus:outline-none focus:ring-1 focus:ring-[var(--hud-cyan)]"
                style={{ borderColor: "var(--hud-line)" }}
              />
            </section>

            {error && (
              <p role="alert" className="text-[0.82rem] leading-relaxed text-[var(--hud-danger)]">
                {error}
              </p>
            )}

            <div className="flex items-center gap-3">
              <button
                type="submit"
                disabled={busy}
                className="hud-btn-primary inline-flex items-center justify-center gap-2 rounded-[var(--radius)] px-6 py-2.5 text-[0.92rem] disabled:opacity-50"
              >
                {busy ? (
                  <>
                    <Loader2 aria-hidden="true" size={15} className="animate-spin" /> Saving…
                  </>
                ) : (
                  "Save changes"
                )}
              </button>
              {/* aria-live so the confirmation is announced, not just seen. */}
              <span aria-live="polite" className="text-[0.82rem] text-[var(--hud-cyan-bright)]">
                {saved && !busy && (
                  <span className="inline-flex items-center gap-1.5">
                    <Check aria-hidden="true" size={14} /> Saved
                  </span>
                )}
              </span>
            </div>
          </form>

          <div className="mt-8 border-t pt-5" style={{ borderColor: "var(--hud-line)" }}>
            <button
              type="button"
              onClick={signOut}
              className="inline-flex items-center gap-2 text-[0.85rem] text-[var(--hud-text-dim)] transition-colors hover:text-[var(--hud-text)]"
            >
              <LogOut aria-hidden="true" size={14} /> Sign out
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

"use client";

import { useTheme, type ThemeChoice } from "@/components/theme/useTheme";
import { useEffect, useRef, useState } from "react";
import { Check, Loader2, LogOut, X } from "lucide-react";
import { PREFERENCES, PROFILE_OPTIONS } from "@/lib/accessibilityProfiles";
import type { AccessibilityProfile } from "@/lib/db/cosmos";
import type { LearnerProfile, SessionUser, TeachingDepth } from "./AuthGate";

const THEME_CHOICES: { value: ThemeChoice; label: string }[] = [
  { value: "system", label: "Match my device" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

/** The sections, in the order the left-hand list shows them. */
type SettingsSection = "account" | "profile" | "preferences" | "accessibility" | "insights" | "memory";
const SECTIONS: { id: SettingsSection; label: string }[] = [
  { id: "account", label: "Account" },
  { id: "profile", label: "Learner profile" },
  { id: "preferences", label: "Preferences" },
  { id: "accessibility", label: "Accessibility" },
  { id: "insights", label: "How you're doing" },
  { id: "memory", label: "What Aria remembers" },
];

const FIELD =
  "w-full rounded-[var(--radius)] border border-[var(--input-border)] bg-[var(--hud-surface)] px-3.5 py-2.5 text-[0.9rem] text-[var(--hud-text)] placeholder:text-[var(--hud-text-faint)] focus:border-[var(--hud-cyan)] focus:outline-none focus:ring-2 focus:ring-[var(--hud-cyan-glow)]";
const SELECT =
  "w-full rounded-[var(--radius)] border border-[var(--input-border)] bg-[var(--hud-surface)] px-2.5 py-2 text-[0.8125rem] text-[var(--hud-text)] focus:border-[var(--hud-cyan)] focus:outline-none";

const TEACHING_DEPTHS: { value: TeachingDepth; label: string; hint: string }[] = [
  { value: "adaptive", label: "Adaptive", hint: "Aria decides from each question: a short question gets a short answer." },
  { value: "quick", label: "Quick", hint: "The fewest boards that answer the question." },
  { value: "balanced", label: "Balanced", hint: "A full explanation, without extras." },
  { value: "deep", label: "Deep", hint: "Go further: mechanism, edge cases, more examples." },
];
import { LearnerMemoryPanel } from "@/components/memory/LearnerMemoryPanel";
import { LearnerProfileInsights } from "@/components/memory/LearnerProfileInsights";
import { LearnerProfileFields, type LearnerFieldsValue } from "./LearnerProfileFields";
import { allCurricula, allStudyLevels, curriculaFor, studyLevelOptions, type EduOption } from "@/lib/education";

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
  const [theme, setTheme] = useTheme();
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
  const [teachingDepth, setTeachingDepth] = useState<TeachingDepth>(profile?.teachingDepth ?? "adaptive");
  // The learner profile's basics — the same fields as onboarding screen 1 — and per-subject levels.
  const [learnerFields, setLearnerFields] = useState<LearnerFieldsValue>({
    country: profile?.learner?.country ?? null,
    countrySource: profile?.learner?.countrySource ?? null,
    studyLevel: profile?.learner?.studyLevel ?? null,
    subjects: profile?.learner?.subjects ?? [],
    curricula: profile?.learner?.curricula ?? [],
  });
  // Per subject, where it differs from the main ones — chosen here, or learned from lessons
  // (lib/learnerBasics.ts learnSubjectContext; `learned` marks those, and saving keeps the mark).
  const [subjectLevels, setSubjectLevels] = useState<Record<string, EduOption & { learned?: boolean }>>(profile?.learner?.subjectLevels ?? {});
  const [subjectCurricula, setSubjectCurricula] = useState<Record<string, Array<EduOption & { learned?: boolean }>>>(profile?.learner?.subjectCurricula ?? {});
  const levelChoicesFor = (subject: EduOption) => {
    const local = studyLevelOptions(learnerFields.country, [subject]);
    const seen = new Set(local.map((l) => l.id));
    return [...local, ...allStudyLevels().filter((l) => !seen.has(l.id))];
  };
  const curriculumChoicesFor = (subject: EduOption) => {
    const suggested = curriculaFor({ country: learnerFields.country, level: subjectLevels[subject.id] ?? learnerFields.studyLevel, subjects: [subject] });
    const current = subjectCurricula[subject.id] ?? [];
    const seen = new Set(suggested.map((c) => c.id));
    return [...suggested, ...current.filter((c) => !seen.has(c.id)), ...allCurricula().filter((c) => !seen.has(c.id) && !current.some((x) => x.id === c.id))];
  };

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  /** The section being read, for the list on the left and the title above the content. */
  const [active, setActive] = useState<SettingsSection>("account");

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
          teachingDepth,
          notes,
          learner: {
            ...learnerFields,
            // Only subjects still chosen keep their own level and curriculum.
            subjectLevels: Object.fromEntries(Object.entries(subjectLevels).filter(([id]) => learnerFields.subjects.some((s) => s.id === id))),
            subjectCurricula: Object.fromEntries(Object.entries(subjectCurricula).filter(([id]) => learnerFields.subjects.some((s) => s.id === id))),
          },
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

  /*
   * TWO PANES, as a settings dialog should be: the sections down the left, the one you are reading
   * named at the top, Save and Cancel always in reach at the bottom. Every section stays on the page
   * (the list jumps to it), so a save always carries every field and nothing is hidden from a
   * screen reader or a search.
   */
  const jumpTo = (id: SettingsSection) => {
    const scroller = scrollRef.current;
    const target = scroller?.querySelector<HTMLElement>(`[data-section="${id}"]`);
    if (!scroller || !target) return;
    setActive(id);
    scroller.scrollTo({ top: target.offsetTop - 8, behavior: "smooth" });
  };
  const onScroll = () => {
    const scroller = scrollRef.current;
    if (!scroller) return;
    const atEnd = scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 4;
    let current: SettingsSection = SECTIONS[0].id;
    for (const { id } of SECTIONS) {
      const el = scroller.querySelector<HTMLElement>(`[data-section="${id}"]`);
      if (el && el.offsetTop - scroller.scrollTop <= 48) current = id;
    }
    setActive(atEnd ? SECTIONS[SECTIONS.length - 1].id : current);
  };
  const choice = (on: boolean) => ({
    borderColor: on ? "var(--hud-cyan)" : "var(--hud-line)",
    background: on ? "var(--accent-soft)" : "var(--hud-surface)",
  });
  const sectionClass = "scroll-mt-2 border-b border-[var(--hud-line)] pb-8 pt-1 last:border-b-0";
  const headingClass = "mb-1 text-[0.95rem] font-medium text-[var(--hud-text)]";
  const helpClass = "mb-4 text-[0.8125rem] leading-relaxed text-[var(--hud-text-dim)]";
  const groupLabelClass = "mb-2.5 text-[0.8125rem] font-medium text-[var(--hud-text-dim)]";

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="settings-title"
      className="fixed inset-0 z-50 grid place-items-center p-3 sm:p-8"
      style={{ background: "var(--scrim)" }}
      onMouseDown={(e) => {
        // Only a click on the backdrop itself closes — not one that started inside the panel and
        // drifted out, which is how text selection near an edge otherwise loses your edits.
        if (!panelRef.current?.contains(e.target as Node)) onClose();
      }}
    >
      <div
        ref={panelRef}
        className="hud-materialize grid h-[min(46rem,calc(100dvh-1.5rem))] w-full max-w-[56rem] grid-rows-[auto_minmax(0,1fr)] overflow-hidden rounded-[var(--radius-lg)] border border-[var(--hud-line)] bg-[var(--hud-surface)] shadow-[var(--elev-2)] sm:grid-cols-[13.75rem_minmax(0,1fr)] sm:grid-rows-1"
      >
        <nav
          aria-label="Settings sections"
          className="flex gap-0.5 overflow-x-auto border-b border-[var(--hud-line)] bg-[var(--hud-bg)] p-2 sm:flex-col sm:overflow-visible sm:border-b-0 sm:border-r sm:px-3 sm:py-5"
        >
          <h2 id="settings-title" className="mb-3 px-2.5 text-[1.0625rem] font-semibold text-[var(--hud-text)] max-sm:sr-only">
            Settings
          </h2>
          {SECTIONS.map(({ id, label }) => (
            <button
              key={id}
              type="button"
              onClick={() => jumpTo(id)}
              aria-current={active === id ? "true" : undefined}
              className={`flex h-9 shrink-0 items-center whitespace-nowrap rounded-[var(--radius)] px-2.5 text-left text-[0.875rem] transition-colors ${
                active === id
                  ? "bg-[var(--hud-surface-2)] font-medium text-[var(--hud-text)]"
                  : "text-[var(--hud-text-dim)] hover:bg-[var(--hud-surface-2)] hover:text-[var(--hud-text)]"
              }`}
            >
              {label}
            </button>
          ))}
          <span className="hidden flex-1 sm:block" />
          <button
            type="button"
            onClick={signOut}
            className="flex h-9 shrink-0 items-center gap-2 whitespace-nowrap rounded-[var(--radius)] px-2.5 text-[0.875rem] text-[var(--hud-danger)] transition-colors hover:bg-[var(--danger-dim)]"
          >
            <LogOut aria-hidden="true" size={14} /> Sign out
          </button>
        </nav>

        <div className="flex min-h-0 flex-col">
          <div className="flex shrink-0 items-center justify-between gap-4 border-b border-[var(--hud-line)] px-6 py-3.5">
            <div className="min-w-0">
              <p className="text-[0.9375rem] font-medium text-[var(--hud-text)]">{SECTIONS.find((s) => s.id === active)?.label}</p>
              {user?.email && <p className="truncate text-[0.75rem] text-[var(--hud-text-dim)]">{user.email}</p>}
            </div>
            <button
              ref={closeRef}
              type="button"
              onClick={onClose}
              aria-label="Close settings"
              className="grid size-8 shrink-0 place-items-center rounded-[var(--radius)] text-[var(--hud-text-dim)] transition-colors hover:bg-[var(--hud-surface-2)] hover:text-[var(--hud-text)]"
            >
              <X aria-hidden="true" size={16} />
            </button>
          </div>

          <div ref={scrollRef} onScroll={onScroll} className="relative min-h-0 flex-1 overflow-y-auto px-6 py-6">
            <form id="settings-form" onSubmit={save} className="flex flex-col gap-8">
              <section data-section="account" aria-labelledby="set-account-h" className={sectionClass}>
                <h3 id="set-account-h" className={headingClass}>Account</h3>
                <p className={helpClass}>How you sign in, and what Aria calls you.</p>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="sm:col-span-2">
                    <label htmlFor="set-username" className="mb-1.5 block text-[0.8125rem] font-medium text-[var(--hud-text)]">
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
                      className={FIELD}
                    />
                  </div>
                  <div>
                    <label htmlFor="set-name" className="mb-1.5 block text-[0.8125rem] font-medium text-[var(--hud-text)]">
                      What Aria calls you
                    </label>
                    <input
                      id="set-name"
                      value={displayName}
                      onChange={(e) => setDisplayName(e.target.value)}
                      placeholder="Your name"
                      className={FIELD}
                    />
                  </div>
                  <div>
                    <label htmlFor="set-age" className="mb-1.5 block text-[0.8125rem] font-medium text-[var(--hud-text)]">
                      Age
                    </label>
                    <input
                      id="set-age"
                      type="number"
                      min={5}
                      max={120}
                      value={age}
                      onChange={(e) => setAge(e.target.value)}
                      className={FIELD}
                    />
                  </div>
                </div>
              </section>

              <section data-section="profile" aria-labelledby="set-profile-h" className={sectionClass}>
                <h3 id="set-profile-h" className={headingClass}>Your learner profile</h3>
                <p className={helpClass}>What you study and where. Aria uses it for suggestions, examples and terminology.</p>
                <LearnerProfileFields value={learnerFields} onChange={setLearnerFields} />
                {learnerFields.subjects.length > 0 && (
                  <div className="mt-6">
                    <p className="mb-1 text-[0.875rem] font-medium text-[var(--hud-text)]">Level and curriculum by subject</p>
                    <p className="mb-3 text-[0.8125rem] text-[var(--hud-text-dim)]">Only where a subject differs from your main ones. Aria also fills these in from your lessons.</p>
                    <div className="space-y-2.5">
                      {learnerFields.subjects.map((subject) => {
                        const level = subjectLevels[subject.id];
                        const curriculum = subjectCurricula[subject.id]?.[0];
                        const learned = Boolean(level?.learned || curriculum?.learned);
                        return (
                          <div key={subject.id} className="grid grid-cols-1 items-center gap-2 sm:grid-cols-[1fr_1.3fr_1.3fr]">
                            <span className="min-w-0 truncate text-[0.875rem] text-[var(--hud-text)]">
                              {subject.label}
                              {learned && <span className="ml-1.5 whitespace-nowrap text-[0.75rem] text-[var(--hud-text-dim)]">learned from your lessons</span>}
                            </span>
                            <label htmlFor={`subject-level-${subject.id}`} className="sr-only">{`${subject.label} study level`}</label>
                            <select
                              id={`subject-level-${subject.id}`}
                              value={level?.id ?? ""}
                              onChange={(e) => {
                                const picked = levelChoicesFor(subject).find((l) => l.id === e.target.value);
                                setSubjectLevels((prev) => {
                                  const next = { ...prev };
                                  if (picked) next[subject.id] = { id: picked.id, label: picked.label };
                                  else delete next[subject.id];
                                  return next;
                                });
                              }}
                              className={SELECT}
                            >
                              <option value="">Same level as my main one</option>
                              {levelChoicesFor(subject).map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
                            </select>
                            <label htmlFor={`subject-curriculum-${subject.id}`} className="sr-only">{`${subject.label} curriculum, exam or track`}</label>
                            <select
                              id={`subject-curriculum-${subject.id}`}
                              value={curriculum?.id ?? ""}
                              onChange={(e) => {
                                const picked = curriculumChoicesFor(subject).find((c) => c.id === e.target.value);
                                setSubjectCurricula((prev) => {
                                  const next = { ...prev };
                                  if (picked) next[subject.id] = [{ id: picked.id, label: picked.label }];
                                  else delete next[subject.id];
                                  return next;
                                });
                              }}
                              className={SELECT}
                            >
                              <option value="">Same curriculum as my main one</option>
                              {curriculumChoicesFor(subject).map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
                            </select>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
                <div className="mt-6">
                  <label htmlFor="set-notes" className="mb-1.5 block text-[0.8125rem] font-medium text-[var(--hud-text)]">
                    Anything else Aria should know? <span className="font-normal text-[var(--hud-text-dim)]">Optional</span>
                  </label>
                  <textarea
                    id="set-notes"
                    rows={3}
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="How you learn best, what you find hard…"
                    className={`${FIELD} resize-none`}
                  />
                </div>
              </section>

              <section data-section="preferences" aria-labelledby="set-prefs-h" className={sectionClass}>
                <h3 id="set-prefs-h" className={headingClass}>Preferences</h3>
                <p className={helpClass}>How Aria looks and how she teaches. Appearance applies at once, on this device.</p>

                {/* Appearance applies at once and lives in this browser only (components/theme/useTheme.ts);
                    it is not part of the saved profile. */}
                <p id="set-theme-label" className={groupLabelClass}>Appearance</p>
                <div role="radiogroup" aria-labelledby="set-theme-label" className="grid grid-cols-3 gap-2">
                  {THEME_CHOICES.map(({ value, label }) => {
                    const on = theme === value;
                    return (
                      <button
                        key={value}
                        type="button"
                        role="radio"
                        aria-checked={on}
                        onClick={() => setTheme(value)}
                        className="flex flex-col gap-2 rounded-[var(--radius)] border p-2 text-left text-[0.875rem] text-[var(--hud-text)] transition-colors"
                        style={choice(on)}
                      >
                        <span aria-hidden="true" className="flex h-10 overflow-hidden rounded-[var(--radius-sm)] border border-[var(--hud-line)]">
                          {value !== "dark" && <span className="flex-1 bg-[#F7F7F5]" />}
                          {value !== "light" && <span className="flex-1 bg-[#111110]" />}
                        </span>
                        {label}
                      </button>
                    );
                  })}
                </div>

                <p id="set-depth-label" className={`${groupLabelClass} mt-7`}>How much should Aria teach?</p>
                <div role="group" aria-labelledby="set-depth-label" className="grid gap-2 sm:grid-cols-2">
                  {TEACHING_DEPTHS.map(({ value, label, hint }) => {
                    const on = teachingDepth === value;
                    return (
                      <button
                        key={value}
                        type="button"
                        aria-pressed={on}
                        title={hint}
                        onClick={() => setTeachingDepth(value)}
                        className="flex flex-col gap-0.5 rounded-[var(--radius)] border px-3.5 py-3 text-left transition-colors"
                        style={choice(on)}
                      >
                        <span className="text-[0.875rem] font-medium text-[var(--hud-text)]">{label}</span>
                        <span className="text-[0.75rem] leading-relaxed text-[var(--hud-text-dim)]">{hint}</span>
                      </button>
                    );
                  })}
                </div>
                <p className="mt-2 text-[0.75rem] text-[var(--hud-text-dim)]">
                  Your default. Saying &ldquo;quickly&rdquo; or &ldquo;in depth&rdquo; in a question always wins.
                </p>

                <p className={`${groupLabelClass} mt-7`}>Lesson</p>
                <div className="flex flex-col">
                  {PREFERENCES.map(({ key, label, hint }) => {
                    const on = prefs[key] === true;
                    return (
                      <button
                        key={key}
                        type="button"
                        aria-pressed={on}
                        onClick={() => setPrefs((p) => ({ ...p, [key]: p[key] === true ? null : true }))}
                        className="flex w-full items-center gap-4 border-b border-[var(--hud-line)] py-3 text-left last:border-b-0"
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block text-[0.875rem] text-[var(--hud-text)]">{label}</span>
                          <span className="mt-0.5 block text-[0.75rem] text-[var(--hud-text-dim)]">{hint}</span>
                        </span>
                        {/* A switch, drawn: the button's pressed state is what assistive tech reads. */}
                        <span
                          aria-hidden="true"
                          className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${on ? "bg-[var(--hud-cyan)]" : "bg-[var(--hud-line-strong)]"}`}
                        >
                          <span className={`absolute top-0.5 size-4 rounded-full bg-[var(--hud-surface)] shadow-[var(--elev-1)] transition-[left] ${on ? "left-[1.125rem]" : "left-0.5"}`} />
                        </span>
                      </button>
                    );
                  })}
                </div>
              </section>

              <section data-section="accessibility" aria-labelledby="set-a11y-legend" className={sectionClass}>
                <fieldset role="radiogroup" aria-labelledby="set-a11y-legend">
                  <legend id="set-a11y-legend" className={headingClass}>
                    Accessibility profile
                  </legend>
                  <p className={helpClass}>One at a time, and switchable whenever you need. It takes effect on your next lecture.</p>
                  <div className="space-y-2">
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
                          style={choice(on)}
                        >
                          <span
                            aria-hidden="true"
                            className="mt-0.5 grid size-4 shrink-0 place-items-center rounded-full border"
                            style={{ borderColor: on ? "var(--hud-cyan)" : "var(--input-border)" }}
                          >
                            {on && <span className="size-2 rounded-full" style={{ background: "var(--hud-cyan)" }} />}
                          </span>
                          <span>
                            <span className="block text-[0.875rem] text-[var(--hud-text)]">{label}</span>
                            <span className="mt-0.5 block text-[0.75rem] leading-relaxed text-[var(--hud-text-dim)]">{effect}</span>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </fieldset>
              </section>
            </form>

            {/* Not form fields — they save themselves — so they sit after the form. */}
            <div className="mt-8 flex flex-col gap-8">
              <section data-section="insights" aria-labelledby="set-insights-h" className={sectionClass}>
                <h3 id="set-insights-h" className={headingClass}>How you&apos;re doing</h3>
                <p className={helpClass}>
                  Your profile as Aria has come to know it, subject by subject. It grows with every lesson — correct anything that&apos;s wrong.
                </p>
                <LearnerProfileInsights basics={profile?.learner ?? null} />
              </section>

              <section data-section="memory" aria-labelledby="set-memory-h" className={sectionClass}>
                <h3 id="set-memory-h" className={headingClass}>What Aria remembers about you</h3>
                <p className={helpClass}>
                  Carried from one lesson to the next so she starts where you are. Correct anything that&apos;s wrong.
                </p>
                <LearnerMemoryPanel />
              </section>
            </div>
          </div>

          <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-[var(--hud-line)] px-6 py-3">
            {/* aria-live so the outcome is announced, not just seen. */}
            <span aria-live="polite" className="mr-auto text-[0.8125rem]">
              {error ? (
                <span role="alert" className="text-[var(--hud-danger)]">{error}</span>
              ) : saved && !busy ? (
                <span className="inline-flex items-center gap-1.5 text-[var(--ok)]">
                  <Check aria-hidden="true" size={14} /> Saved
                </span>
              ) : null}
            </span>
            <button type="button" onClick={onClose} className="hud-btn-ghost h-9 px-4 text-[0.875rem] font-medium">
              Cancel
            </button>
            <button
              type="submit"
              form="settings-form"
              disabled={busy}
              className="hud-btn-primary inline-flex h-9 items-center justify-center gap-2 px-4 text-[0.875rem] disabled:opacity-60"
            >
              {busy ? (
                <>
                  <Loader2 aria-hidden="true" size={15} className="animate-spin" /> Saving…
                </>
              ) : (
                "Save changes"
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

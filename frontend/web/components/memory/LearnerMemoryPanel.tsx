"use client";

import { useEffect, useState } from "react";
import { effectiveMastery, personaIsStale, type ConceptMemory, type LearnerMemory, type MemoryEdit } from "@/lib/learnerModel";

/**
 * "What Aria remembers about you" — the student's long-term memory, in their hands.
 *
 * At the top, the portrait: what Aria thinks about them as a learner, written from every lesson,
 * planning conversation, question and checkpoint (lib/learnerPersona.ts), stored with the rest of
 * their memory. They can rewrite it in their own words — their text then stays authoritative for
 * every later refresh — or ask Aria to write it again. It is refreshed here on sight whenever
 * evidence has arrived since it was written.
 *
 * Below, collapsed, the record it rests on: lessons and concepts, each still correctable. That is
 * the condition for remembering at all: a student who can see "Aria thinks I know X" can fix it,
 * and one who cannot is being taught by a guess they never got to challenge.
 *
 * Edits are applied optimistically and rolled back if the server refuses them.
 */

const BANDS: Array<{ id: string; label: string; test: (m: number) => boolean }> = [
  { id: "solid", label: "You know these", test: (m) => m >= 0.7 },
  { id: "shaky", label: "Still settling", test: (m) => m >= 0.3 && m < 0.7 },
  { id: "new", label: "New to you", test: (m) => m < 0.3 },
];

const HEADING = "text-[0.8rem] font-semibold uppercase tracking-wider text-[var(--hud-text-faint)]";
const PILL = "rounded-full border border-[var(--hud-line)] px-2.5 py-0.5 text-[0.75rem] text-[var(--hud-text-dim)] hover:text-[var(--hud-text)]";
const QUIET = "rounded-full px-2 py-0.5 text-[0.75rem] text-[var(--hud-text-faint)] hover:text-[var(--hud-text)]";

export function LearnerMemoryPanel({ compact = false }: { compact?: boolean }) {
  const [memory, setMemory] = useState<LearnerMemory | null>(null);
  const [persisted, setPersisted] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [confirmingWipe, setConfirmingWipe] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [draft, setDraft] = useState<string | null>(null);
  const [showLessons, setShowLessons] = useState(false);
  const [showConcepts, setShowConcepts] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/learner-memory")
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) return;
        setMemory(data.memory ?? null);
        setPersisted(data.persisted !== false);
        // Something new since the portrait was written: have Aria write it again, now, on sight.
        if (data.persisted !== false && data.personaStale) void refresh(false);
      })
      .catch(() => !cancelled && setError("Couldn't load what Aria remembers."));
    return () => {
      cancelled = true;
    };
  }, []);

  async function refresh(force: boolean) {
    setRefreshing(true);
    setError(null);
    const res = await fetch("/api/learner-memory/persona", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ force }),
    }).catch(() => null);
    const data = res ? await res.json().catch(() => ({})) : {};
    setRefreshing(false);
    if (!res?.ok) {
      setError(data.error ?? "Aria couldn't write this just now. Try again in a moment.");
      return;
    }
    if (data.memory) setMemory(data.memory);
  }

  async function edit(change: MemoryEdit, optimistic: (m: LearnerMemory) => LearnerMemory) {
    if (!memory) return;
    const before = memory;
    setMemory(optimistic(memory));
    setError(null);
    const res = await fetch("/api/learner-memory", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(change),
    }).catch(() => null);
    const data = res ? await res.json().catch(() => ({})) : {};
    if (!res?.ok) {
      setMemory(before);
      setError(data.error ?? "That change didn't save. Try again.");
      return;
    }
    if (data.memory) setMemory(data.memory);
  }

  async function wipe() {
    setConfirmingWipe(false);
    const res = await fetch("/api/learner-memory", { method: "DELETE" }).catch(() => null);
    if (!res?.ok) {
      setError("Couldn't clear it. Try again.");
      return;
    }
    const data = await res.json().catch(() => ({}));
    setMemory(data.memory ?? null);
  }

  if (error && !memory) return <p className="text-[0.85rem] text-[var(--hud-danger,#f87171)]">{error}</p>;
  if (!memory) return <p className="text-[0.85rem] text-[var(--hud-text-faint)]">Loading…</p>;
  if (!persisted) {
    return <p className="text-[0.85rem] text-[var(--hud-text-faint)]">Sign in and Aria will remember what you learn between lessons.</p>;
  }

  const persona = memory.persona;
  const concepts = Object.values(memory.concepts).sort((a, b) => b.lastSeen.localeCompare(a.lastSeen));
  const open = memory.misconceptions.filter((m) => !m.resolved);
  const lessons = [...(memory.lessons ?? [])].reverse();
  const empty = !persona && lessons.length === 0 && concepts.length === 0 && memory.misconceptions.length === 0 && !memory.preferences.style && !memory.preferences.background;
  const stale = personaIsStale(memory);

  const setMastery = (c: ConceptMemory, mastery: number) =>
    edit({ op: "setMastery", key: c.key, mastery }, (m) => ({ ...m, concepts: { ...m.concepts, [c.key]: { ...c, mastery, lastSeen: new Date().toISOString() } } }));
  const removeConcept = (c: ConceptMemory) =>
    edit({ op: "removeConcept", key: c.key }, (m) => {
      const next = { ...m.concepts };
      delete next[c.key];
      return { ...m, concepts: next };
    });
  const saveDraft = () => {
    const text = (draft ?? "").trim();
    setDraft(null);
    if (!text || text === persona?.summary) return;
    void edit({ op: "setPersonaNote", text }, (m) => ({
      ...m,
      persona: {
        ...(m.persona ?? { interests: [], strengths: [], growthAreas: [], learningStyle: "", teachingPlan: "", basedOn: { lessons: 0, excerpts: 0, concepts: 0 } }),
        summary: text,
        studentNote: text,
        generatedAt: new Date().toISOString(),
      },
    }));
  };

  const chips = (label: string, items: string[]) =>
    items.length > 0 && (
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="mr-1 text-[0.75rem] text-[var(--hud-text-faint)]">{label}</span>
        {items.map((item) => (
          <span key={item} className="rounded-full border border-[var(--hud-line)] px-2 py-0.5 text-[0.75rem] text-[var(--hud-text-dim)]">
            {item}
          </span>
        ))}
      </div>
    );

  const basedOn = persona
    ? [
        persona.basedOn.lessons > 0 && `${persona.basedOn.lessons} lesson${persona.basedOn.lessons === 1 ? "" : "s"}`,
        persona.basedOn.excerpts > 0 && `${persona.basedOn.excerpts} of your messages`,
        persona.basedOn.concepts > 0 && `${persona.basedOn.concepts} concept${persona.basedOn.concepts === 1 ? "" : "s"}`,
      ].filter(Boolean).join(", ")
    : "";

  return (
    <div data-learner-memory className="space-y-5 text-[0.88rem]">
      {empty && !refreshing && (
        <p className="text-[var(--hud-text-faint)]">
          Nothing yet. After your first lesson, Aria keeps track of what you know, what&apos;s still settling, and any mix-ups, so the next lesson starts from where you are.
        </p>
      )}

      {(persona || refreshing) && (
        <section data-persona className="rounded-lg border border-[var(--hud-line)] p-4">
          <div className="mb-2 flex items-center justify-between gap-3">
            <h4 className={HEADING}>What Aria thinks about you</h4>
            {draft === null && (
              <span className="flex shrink-0 gap-1.5">
                <button type="button" onClick={() => setDraft(persona?.summary ?? "")} className={PILL} disabled={refreshing}>
                  Edit
                </button>
                <button type="button" onClick={() => void refresh(true)} className={PILL} disabled={refreshing}>
                  {refreshing ? "Updating…" : "Refresh"}
                </button>
              </span>
            )}
          </div>

          {refreshing && !persona && <p className="text-[var(--hud-text-faint)]">Aria is writing what she thinks about you…</p>}

          {draft !== null ? (
            <div className="space-y-2">
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                rows={4}
                maxLength={1200}
                autoFocus
                aria-label="What Aria thinks about you, in your own words"
                className="w-full rounded-md border border-[var(--hud-line)] bg-transparent px-3 py-2 text-[0.88rem] text-[var(--hud-text)] outline-none focus:border-[var(--hud-text-faint)]"
              />
              <p className="text-[0.75rem] text-[var(--hud-text-faint)]">Your words become the portrait, and Aria builds on them — never against them — whenever she refreshes it.</p>
              <span className="flex gap-1.5">
                <button type="button" onClick={saveDraft} className={PILL}>Save</button>
                <button type="button" onClick={() => setDraft(null)} className={QUIET}>Cancel</button>
              </span>
            </div>
          ) : persona ? (
            <div className="space-y-3">
              <p className="whitespace-pre-line leading-relaxed text-[var(--hud-text)]">{persona.summary}</p>
              {chips("Interests", persona.interests)}
              {chips("Strong on", persona.strengths)}
              {chips("Still settling", persona.growthAreas)}
              {persona.learningStyle && <p className="text-[var(--hud-text-dim)]">{persona.learningStyle}</p>}
              {persona.teachingPlan && (
                <p className="text-[var(--hud-text-dim)]">
                  <span className="text-[var(--hud-text-faint)]">How I&apos;ll teach you: </span>
                  {persona.teachingPlan}
                </p>
              )}
              <p className="text-[0.75rem] text-[var(--hud-text-faint)]">
                {refreshing ? "Updating from your latest lesson… " : stale ? "New since this was written. " : ""}
                {persona.studentNote ? "In your own words" : "Written by Aria"}
                {basedOn ? ` from ${basedOn}` : ""} · {new Date(persona.generatedAt).toLocaleDateString()}
              </p>
            </div>
          ) : null}
        </section>
      )}

      {lessons.length > 0 && (
        <div>
          <button type="button" onClick={() => setShowLessons((v) => !v)} aria-expanded={showLessons} className={`${HEADING} flex items-center gap-2`}>
            <span aria-hidden="true">{showLessons ? "▾" : "▸"}</span> Lessons with Aria ({lessons.length})
          </button>
          {showLessons && (
            <ul className="mt-2 space-y-1">
              {lessons.slice(0, compact ? 5 : 30).map((lesson, i) => (
                <li key={`${lesson.at}-${i}`} className="flex items-baseline justify-between gap-3 text-[var(--hud-text-dim)]">
                  <span className="min-w-0 truncate">{lesson.topic}</span>
                  <span className="shrink-0 text-[0.75rem] text-[var(--hud-text-faint)]">
                    {lesson.beatsWatched > 0 ? `${lesson.beatsWatched} part${lesson.beatsWatched === 1 ? "" : "s"} watched · ` : ""}
                    {new Date(lesson.at).toLocaleDateString()}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {concepts.length > 0 && (
        <div>
          <button type="button" onClick={() => setShowConcepts((v) => !v)} aria-expanded={showConcepts} className={`${HEADING} flex items-center gap-2`}>
            <span aria-hidden="true">{showConcepts ? "▾" : "▸"}</span> What you&apos;ve covered ({concepts.length})
          </button>
          {showConcepts && (
            <div className="mt-3 space-y-4">
              {BANDS.map((band) => {
                const items = concepts.filter((c) => band.test(effectiveMastery(c)));
                if (items.length === 0) return null;
                return (
                  <div key={band.id}>
                    <h5 className={`mb-2 ${HEADING}`}>{band.label}</h5>
                    <ul className="space-y-1.5">
                      {items.slice(0, compact ? 8 : 40).map((c) => (
                        <li key={c.key} className="flex items-center justify-between gap-3 rounded-md border border-[var(--hud-line)] px-3 py-2">
                          <span className="min-w-0 truncate text-[var(--hud-text)]" title={c.evidence.map((e) => e.note).join("\n")}>
                            {c.label}
                          </span>
                          <span className="flex shrink-0 gap-1.5">
                            {band.id !== "solid" && (
                              <button type="button" onClick={() => setMastery(c, 0.9)} className={PILL}>
                                I know this
                              </button>
                            )}
                            {band.id !== "new" && (
                              <button type="button" onClick={() => setMastery(c, 0.2)} className={PILL}>
                                I don&apos;t
                              </button>
                            )}
                            <button type="button" onClick={() => removeConcept(c)} aria-label={`Forget ${c.label}`} className={QUIET}>
                              Forget
                            </button>
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {memory.misconceptions.length > 0 && (
        <div>
          <h4 className={`mb-2 ${HEADING}`}>
            Mix-ups Aria will help with{open.length === 0 ? " (all sorted)" : ""}
          </h4>
          <ul className="space-y-1.5">
            {memory.misconceptions.map((m) => (
              <li key={m.id} className="flex items-center justify-between gap-3 rounded-md border border-[var(--hud-line)] px-3 py-2">
                <span className={`min-w-0 ${m.resolved ? "text-[var(--hud-text-faint)] line-through" : "text-[var(--hud-text)]"}`}>{m.text}</span>
                <span className="flex shrink-0 gap-1.5">
                  <button
                    type="button"
                    onClick={() => edit({ op: "resolveMisconception", id: m.id, resolved: !m.resolved }, (x) => ({ ...x, misconceptions: x.misconceptions.map((y) => (y.id === m.id ? { ...y, resolved: !m.resolved } : y)) }))}
                    className={PILL}
                  >
                    {m.resolved ? "Not sorted" : "Sorted now"}
                  </button>
                  <button
                    type="button"
                    onClick={() => edit({ op: "removeMisconception", id: m.id }, (x) => ({ ...x, misconceptions: x.misconceptions.filter((y) => y.id !== m.id) }))}
                    aria-label="Forget this mix-up"
                    className={QUIET}
                  >
                    Forget
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {(memory.preferences.style || memory.preferences.background) && (
        <div>
          <h4 className={`mb-2 ${HEADING}`}>How you like to learn</h4>
          {(["style", "background"] as const).map((field) =>
            memory.preferences[field] ? (
              <p key={field} className="flex items-center justify-between gap-3 rounded-md border border-[var(--hud-line)] px-3 py-2">
                <span className="min-w-0 text-[var(--hud-text)]">{memory.preferences[field]}</span>
                <button
                  type="button"
                  onClick={() => edit({ op: "setPreference", field, value: null }, (x) => ({ ...x, preferences: { ...x.preferences, [field]: null } }))}
                  className={`shrink-0 ${QUIET}`}
                >
                  Forget
                </button>
              </p>
            ) : null,
          )}
        </div>
      )}

      {error && <p role="alert" className="text-[0.82rem] text-[var(--hud-danger,#f87171)]">{error}</p>}

      {!empty && (
        <div className="pt-1">
          {confirmingWipe ? (
            <span className="flex items-center gap-3 text-[0.82rem]">
              <span className="text-[var(--hud-text-dim)]">Forget everything Aria remembers, including what she thinks about you?</span>
              <button type="button" onClick={wipe} className="font-medium text-[var(--hud-danger,#f87171)]">Yes, forget it all</button>
              <button type="button" onClick={() => setConfirmingWipe(false)} className="text-[var(--hud-text-faint)]">Cancel</button>
            </span>
          ) : (
            <button type="button" onClick={() => setConfirmingWipe(true)} className="text-[0.82rem] text-[var(--hud-text-faint)] hover:text-[var(--hud-text)]">
              Forget everything
            </button>
          )}
        </div>
      )}
    </div>
  );
}

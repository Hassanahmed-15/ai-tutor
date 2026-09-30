"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import type { LearnerBasics } from "@/lib/db/cosmos";
import type { ConceptMemory, LearnerMemory } from "@/lib/learnerModel";
import { learnerProfileView } from "@/lib/learnerProfileView";

/**
 * THE EVOLVING PROFILE, subject by subject (lib/learnerProfileView.ts): study level, curriculum,
 * strong and weak areas, mastered, needs review, current topics, typical lesson length, and how
 * they learn best. Built from what Aria has learned in lessons — never asked for — and correctable
 * here: move an idea between mastered and needs-review, drop one that is wrong, or say how you like
 * things explained. Each correction goes through the learner memory's own edits.
 */
function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[8.5rem_1fr] gap-3 py-1.5 text-[0.84rem]">
      <dt className="text-[var(--hud-text-faint)]">{label}</dt>
      <dd className="min-w-0 text-[var(--hud-text)]">{children}</dd>
    </div>
  );
}

export function LearnerProfileInsights({ basics }: { basics: LearnerBasics | null }) {
  const [memory, setMemory] = useState<LearnerMemory | null>(null);
  const [loading, setLoading] = useState(true);
  const [styleDraft, setStyleDraft] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/learner-memory", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => setMemory((data?.memory as LearnerMemory | undefined) ?? null))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const edit = useCallback(async (body: Record<string, unknown>) => {
    const res = await fetch("/api/learner-memory", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
    const data = res?.ok ? await res.json().catch(() => null) : null;
    if (data?.memory) setMemory(data.memory as LearnerMemory);
  }, []);

  const view = useMemo(() => learnerProfileView(basics, memory), [basics, memory]);

  if (loading) {
    return <p className="flex items-center gap-2 text-[0.82rem] text-[var(--hud-text-faint)]"><Loader2 aria-hidden="true" size={14} className="animate-spin" /> Loading your profile…</p>;
  }

  const none = <span className="text-[var(--hud-text-faint)]">—</span>;

  const conceptList = (items: ConceptMemory[], actions: Array<{ label: string; mastery: number }>) =>
    items.length === 0 ? none : (
      <ul className="flex flex-wrap gap-1.5">
        {items.map((c) => (
          <li key={c.key} className="group flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[0.8rem]" style={{ borderColor: "var(--hud-line)" }}>
            {c.label}
            {actions.map((a) => (
              <button key={a.label} type="button" onClick={() => void edit({ op: "setMastery", key: c.key, mastery: a.mastery })} className="ml-1 text-[0.7rem] text-[var(--hud-text-faint)] underline-offset-2 hover:text-[var(--hud-text)] hover:underline">
                {a.label}
              </button>
            ))}
            <button type="button" onClick={() => void edit({ op: "removeConcept", key: c.key })} aria-label={`Remove ${c.label}`} className="ml-1 text-[var(--hud-text-faint)] hover:text-[var(--hud-text)]">×</button>
          </li>
        ))}
      </ul>
    );

  return (
    <div className="space-y-5">
      <dl className="rounded-[var(--radius)] border px-4 py-2" style={{ borderColor: "var(--hud-line)" }}>
        <Row label="Curriculum">{basics?.curricula.length ? basics.curricula.map((c) => c.label).join(", ") : none}</Row>
        <Row label="Current topics">{view.currentTopics.length ? view.currentTopics.join(", ") : none}</Row>
        <Row label="Typical lesson">{view.typicalLessonDuration ?? none}</Row>
        <Row label="Learns best with">
          {styleDraft === null ? (
            <span className="flex flex-wrap items-center gap-2">
              {view.preferredExplanation ?? none}
              <button type="button" onClick={() => setStyleDraft(memory?.preferences.style ?? view.preferredExplanation ?? "")} className="text-[0.75rem] text-[var(--hud-cyan-bright)] underline-offset-2 hover:underline">
                Change
              </button>
            </span>
          ) : (
            <span className="flex gap-2">
              <label htmlFor="style-draft" className="sr-only">How you like things explained</label>
              <input id="style-draft" value={styleDraft} onChange={(e) => setStyleDraft(e.target.value)} placeholder="e.g. Visual + worked examples" className="min-w-0 flex-1 rounded-md border bg-[var(--hud-bg)] px-2 py-1 text-[0.82rem]" style={{ borderColor: "var(--hud-line)" }} />
              <button type="button" onClick={() => { void edit({ op: "setPreference", field: "style", value: styleDraft.trim() || null }); setStyleDraft(null); }} className="text-[0.78rem] text-[var(--hud-cyan-bright)]">Save</button>
              <button type="button" onClick={() => setStyleDraft(null)} className="text-[0.78rem] text-[var(--hud-text-faint)]">Cancel</button>
            </span>
          )}
        </Row>
      </dl>

      {view.subjects.length === 0 ? (
        <p className="text-[0.82rem] text-[var(--hud-text-faint)]">Add your subjects above — Aria fills this in as you learn.</p>
      ) : (
        view.subjects.map((s) => (
          <section key={s.subject?.id ?? "other"} className="rounded-[var(--radius)] border px-4 py-3" style={{ borderColor: "var(--hud-line)" }} aria-label={s.subject?.label ?? "Other topics"}>
            <h4 className="mb-1 text-[0.9rem] font-semibold text-[var(--hud-text)]">{s.subject?.label ?? "Other topics"}</h4>
            <dl>
              <Row label="Study level">{s.studyLevel?.label ?? none}</Row>
              <Row label="Strong areas">{conceptList(s.strong, [{ label: "mastered", mastery: 0.9 }])}</Row>
              <Row label="Mastered">{conceptList(s.mastered, [{ label: "review", mastery: 0.5 }])}</Row>
              <Row label="Needs review">{conceptList(s.needsReview, [{ label: "mastered", mastery: 0.9 }])}</Row>
              <Row label="Weak areas">
                {s.weakConcepts.length || s.weak.length ? (
                  <div className="space-y-1.5">
                    {s.weakConcepts.length > 0 && conceptList(s.weakConcepts, [{ label: "got it now", mastery: 0.7 }])}
                    {s.weak.length > 0 && <p className="text-[0.8rem] text-[var(--hud-text-dim)]">To correct: {s.weak.join("; ")}</p>}
                  </div>
                ) : none}
              </Row>
              <Row label="Current topics">{s.currentTopics.length ? s.currentTopics.join(", ") : none}</Row>
            </dl>
          </section>
        ))
      )}
    </div>
  );
}

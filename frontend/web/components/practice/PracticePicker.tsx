"use client";

import { useEffect, useState } from "react";
import { ArrowRight, Dices, History, Loader2 } from "lucide-react";
import { fetchReplay, shelfFor, SOURCE_ICONS, useLectureHistory } from "@/components/lecture/LectureHistory";
import { useAuth } from "@/components/auth/AuthGate";
import { boardTitles, lectureSource, sheetPlan } from "@/lib/practice/source";
import type { PracticePreset } from "./PracticeExam";

/**
 * WHAT TO PRACTISE, on the front page in Practice mode (owner 2026-11-27): a lecture the student already watched (its
 * boards become the practice sheet's source, lib/practice/source.ts), or any topic — typed in the box above, or a
 * random one of the student's own suggested topics (/api/learner-profile/tiles).
 */
type Tile = { id: string; prompt: string; reason?: string };

const CARD = "flex min-w-0 flex-col gap-3 rounded-[18px] border border-[var(--hud-line)] bg-[var(--hud-surface)] p-4 text-[0.875rem]";
const ROW = "group flex w-full items-center gap-3 rounded-[12px] border border-transparent px-2.5 py-2 text-left transition-colors hover:border-[var(--hud-line)] hover:bg-[var(--hud-surface-2)] disabled:opacity-60";

export function PracticePicker({ onSheet, onTopic, columns = 2 }: { onSheet: (preset: PracticePreset) => void; onTopic: (topic: string) => void; /** 1 in the homepage's narrow right column. */ columns?: 1 | 2 }) {
  const { profile } = useAuth();
  const { items, loading } = useLectureHistory();
  const [showAll, setShowAll] = useState(false);
  const [opening, setOpening] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [tiles, setTiles] = useState<Tile[]>([]);

  useEffect(() => {
    const c = new AbortController();
    fetch("/api/learner-profile/tiles", { cache: "no-store", signal: c.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setTiles(Array.isArray(d?.tiles) ? (d.tiles as Tile[]) : []))
      .catch(() => {});
    return () => c.abort();
  }, []);

  const ready = items.filter((i) => i.status === "ready" || i.status === "ready-with-errors" || i.status === "processing-videos");
  const shown = ready.slice(0, showAll ? 12 : 4);

  async function fromLecture(id: string) {
    setOpening(id);
    setNote(null);
    try {
      const lecture = await fetchReplay(id);
      const source = lectureSource(lecture.topic, lecture.beats);
      if (!source) throw new Error("This lecture is too short to make a practice sheet from.");
      onSheet({ plan: sheetPlan(source, profile?.learner?.studyLevel?.label ?? ""), subtopics: boardTitles(lecture.beats) });
    } catch (e) {
      setNote((e as Error).message || "That lecture couldn't be opened.");
      setOpening(null);
    }
  }

  return (
    <div className={`hud-materialize mx-auto grid w-full max-w-[820px] gap-4 ${columns === 2 ? "grid-cols-1 sm:grid-cols-2" : "grid-cols-1"}`} data-practice-picker="">
      <section aria-labelledby="practice-from-lecture" className={CARD}>
        <h2 id="practice-from-lecture" className="flex items-center gap-2 text-[1rem] font-semibold text-[var(--hud-text)]">
          <History size={17} strokeWidth={1.9} aria-hidden /> From a lecture you watched
        </h2>
        <p className="text-[0.8125rem] leading-relaxed text-[var(--hud-text-dim)]">Six exam-style questions on exactly what that lecture taught.</p>
        {loading ? (
          <p className="flex items-center gap-2 text-[var(--hud-text-faint)]"><Loader2 size={14} className="animate-spin" aria-hidden /> Finding your lectures…</p>
        ) : shown.length ? (
          <ul className="flex flex-col gap-1">
            {shown.map((item) => {
              const Icon = SOURCE_ICONS[item.sourceType] ?? History;
              return (
                <li key={item.id}>
                  <button type="button" onClick={() => void fromLecture(item.id)} disabled={opening !== null} className={ROW} data-practice-lecture={item.id}>
                    <Icon size={16} strokeWidth={1.8} aria-hidden className="shrink-0 text-[var(--hud-text-faint)]" />
                    <span className="flex min-w-0 flex-1 flex-col leading-tight">
                      <span className="truncate font-medium text-[var(--hud-text)]">{item.topic}</span>
                      <span className="truncate text-[0.75rem] text-[var(--hud-text-faint)]">{shelfFor(item.createdAt)} · {item.beatCount} boards</span>
                    </span>
                    {opening === item.id ? <Loader2 size={15} className="shrink-0 animate-spin text-[var(--hud-cyan)]" aria-label="Opening" /> : <ArrowRight size={15} aria-hidden className="shrink-0 text-[var(--hud-text-faint)] group-hover:text-[var(--hud-cyan)]" />}
                  </button>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-[var(--hud-text-faint)]">No saved lectures yet. Watch one, then practise it here.</p>
        )}
        {ready.length > 4 && (
          <button type="button" onClick={() => setShowAll((v) => !v)} className="self-start text-[0.8125rem] font-medium text-[var(--hud-cyan)] hover:underline">
            {showAll ? "Show fewer" : `Show more (${Math.min(ready.length, 12) - 4})`}
          </button>
        )}
        {note && <p role="alert" className="text-[0.8125rem] text-[var(--hud-danger)]">{note}</p>}
      </section>

      <section aria-labelledby="practice-any-topic" className={CARD}>
        <h2 id="practice-any-topic" className="flex items-center gap-2 text-[1rem] font-semibold text-[var(--hud-text)]">
          <Dices size={17} strokeWidth={1.9} aria-hidden /> Any topic
        </h2>
        <p className="text-[0.8125rem] leading-relaxed text-[var(--hud-text-dim)]">Type a topic in the box above, or let Aria pick one for you. A few questions first, then your test.</p>
        <button
          type="button"
          disabled={!tiles.length}
          onClick={() => { const t = tiles[Math.floor(Math.random() * tiles.length)]; if (t) onTopic(t.prompt); }}
          className="hud-btn-primary inline-flex items-center justify-center gap-2 self-start rounded-full px-4 py-2 text-[0.875rem] font-semibold disabled:opacity-50"
          data-practice-random=""
        >
          <Dices size={15} aria-hidden /> Random topic
        </button>
        {tiles.length > 0 && (
          <ul className="flex flex-wrap gap-1.5" aria-label="Suggested topics">
            {tiles.slice(0, 4).map((t) => (
              <li key={t.id} className="min-w-0 max-w-full">
                <button type="button" onClick={() => onTopic(t.prompt)} title={t.reason} className="max-w-full truncate rounded-full border border-[var(--hud-line)] px-3 py-1 text-[0.8125rem] text-[var(--hud-text-dim)] transition-colors hover:border-[var(--hud-line-strong)] hover:text-[var(--hud-text)]">
                  {t.prompt}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

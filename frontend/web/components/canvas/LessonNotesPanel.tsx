"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { BookOpen, RotateCcw, X, ArrowDown } from "lucide-react";
import { revealUnits, shownCount, type BoardBlock } from "@/lib/canvas/blocks";
import { BlockView, CALLOUT_LABEL, Inline } from "./BlockContent";

export type NotesSection = { key: string; index: number; title: string; blocks: BoardBlock[] };
export type AskedNote = { id: string; index: number; question: string; answer: string };

/**
 * THE LESSON NOTES (CANVAS_BLOCKS=on): the whole lesson so far in full, section by section, the board's words
 * appearing as Aria says them, and the student's own questions with their answers. Older sections stay;
 * scrolling back does not stop her, and "Back to now" returns. Replay teaches a section again.
 */
export function LessonNotesPanel({ sections, current, clock, asked, onReplay }: { sections: NotesSection[]; current: number; clock: number; asked: AskedNote[]; onReplay: (index: number) => void }) {
  const [open, setOpen] = useState(false);
  const [away, setAway] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const timed = useMemo(() => sections.map((s) => ({ ...s, items: s.blocks.map((block) => ({ block, units: revealUnits(block) })) })), [sections]);
  const visible = timed.filter((s) => s.index <= current);
  const said = visible.reduce((n, s) => n + s.items.reduce((m, it) => m + shownCount(it.units, s.index < current ? Infinity : clock), 0), 0);
  const follow = () => {
    const el = box.current;
    if (!el) return;
    const units = el.querySelectorAll<HTMLElement>("[data-bk-unit]");
    const last = units[units.length - 1];
    if (last) el.scrollTo({ top: Math.max(0, last.offsetTop - el.clientHeight * 0.7), behavior: "smooth" });
  };
  useEffect(() => {
    if (open && !away) follow();
  }, [open, away, said, asked.length]);

  return (
    <>
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="pointer-events-auto absolute right-3 top-[60px] z-20 inline-flex h-9 items-center gap-1.5 rounded-full border border-[var(--hud-line-strong)] bg-[var(--hud-surface)] px-3 text-[0.82rem] text-[var(--hud-text)] shadow-[var(--elev-1)]" data-notes-toggle="">
        <BookOpen aria-hidden="true" size={15} /> Lesson notes
      </button>
      {open && (
        <aside aria-label="Lesson notes" className="absolute inset-y-0 right-0 z-30 flex w-[min(460px,94vw)] flex-col border-l border-[var(--hud-line-strong)] bg-[var(--hud-surface)] shadow-[var(--elev-2)]">
          <header className="flex h-12 shrink-0 items-center justify-between border-b border-[var(--hud-line)] px-4">
            <span className="text-[0.92rem] font-semibold text-[var(--hud-text)]">Lesson notes</span>
            <button type="button" aria-label="Close lesson notes" onClick={() => setOpen(false)} className="grid size-8 place-items-center rounded-full text-[var(--hud-text-dim)] hover:bg-[var(--hud-surface-2)]"><X aria-hidden="true" size={16} /></button>
          </header>
          <div
            ref={box}
            className="bk-panel relative min-h-0 flex-1 overflow-y-auto px-5 py-4"
            onScroll={(e) => {
              const el = e.currentTarget;
              const units = el.querySelectorAll<HTMLElement>("[data-bk-unit]");
              const last = units[units.length - 1];
              setAway(Boolean(last) && last.offsetTop - el.scrollTop > el.clientHeight + 40 || (Boolean(last) && last.offsetTop < el.scrollTop - 40));
            }}
          >
            {visible.map((s) => (
              <section key={s.key} className="mb-7" data-section={s.index}>
                <div className="mb-2 flex items-center justify-between gap-2 border-b border-[var(--hud-line)] pb-1">
                  <h2 className="text-[1.02rem] font-semibold text-[var(--hud-text)]">{s.title}</h2>
                  <button type="button" onClick={() => onReplay(s.index)} aria-label={`Replay: ${s.title}`} className="inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[0.75rem] text-[var(--hud-text-dim)] hover:bg-[var(--hud-surface-2)] hover:text-[var(--hud-text)]"><RotateCcw aria-hidden="true" size={12} /> Replay</button>
                </div>
                {s.items.map(({ block, units }) => {
                  const n = shownCount(units, s.index < current ? Infinity : clock);
                  return n > 0 ? <BlockView key={block.id} block={block} units={units} shown={n} /> : null;
                })}
                {asked.filter((a) => a.index === s.index).map((a) => (
                  <aside key={a.id} className="bk-box bk-asked">
                    <div className="bk-label"><span aria-hidden="true">{CALLOUT_LABEL.you_asked.mark}</span> {CALLOUT_LABEL.you_asked.word}</div>
                    <p className="bk-p"><strong><Inline text={a.question} /></strong></p>
                    {a.answer && <p className="bk-p"><Inline text={a.answer} /></p>}
                  </aside>
                ))}
              </section>
            ))}
            {away && (
              <button type="button" onClick={() => { setAway(false); follow(); }} className="sticky bottom-2 left-1/2 inline-flex -translate-x-1/2 items-center gap-1 rounded-full bg-[var(--accent)] px-3 py-1.5 text-[0.8rem] text-[var(--accent-on)] shadow-[var(--elev-2)]">
                <ArrowDown aria-hidden="true" size={13} /> Back to now
              </button>
            )}
          </div>
        </aside>
      )}
    </>
  );
}

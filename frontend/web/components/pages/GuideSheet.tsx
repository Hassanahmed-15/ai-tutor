"use client";

import { useEffect } from "react";
import { BookOpen, MessageSquareText, Mic, Orbit, Play, Sparkles, X } from "lucide-react";

/**
 * THE GUIDE: how Aria works, for someone who has never used her. Five steps, each an icon and one
 * short line, and one thing to try. A sheet from the right (the library's shape), opened from the
 * header's Guide door, and once by itself for a brand-new account (lib: `aria.guide.seen`).
 */
const STEPS: { icon: React.ReactNode; line: string }[] = [
  { icon: <MessageSquareText size={18} strokeWidth={1.7} />, line: "Ask anything — type it, say it, or drop a PDF or video." },
  { icon: <Sparkles size={18} strokeWidth={1.7} />, line: "Aria asks two or three quick questions to pitch it right." },
  { icon: <Play size={18} strokeWidth={1.7} />, line: "You see the plan, change anything, then press Start." },
  { icon: <Mic size={18} strokeWidth={1.7} />, line: "She teaches on a board. Interrupt any time — just speak." },
  { icon: <Orbit size={18} strokeWidth={1.7} />, line: "Your Library keeps every lesson; your Map shows what you know." },
];

export const GUIDE_SEEN_KEY = "aria.guide.seen";

export function guideSeen(): boolean {
  try { return localStorage.getItem(GUIDE_SEEN_KEY) === "1"; } catch { return true; }
}

export function GuideSheet({ onClose, onTry }: { onClose: () => void; onTry: (topic: string) => void }) {
  useEffect(() => {
    try { localStorage.setItem(GUIDE_SEEN_KEY, "1"); } catch { /* a blocked store just shows it again */ }
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <>
      <button type="button" aria-label="Close the guide" onClick={onClose} className="fixed inset-0 z-40 bg-[var(--scrim)]" />
      <aside aria-label="How Aria works" className="home-sheet-in fixed inset-y-0 right-0 z-50 flex w-[min(24rem,92vw)] flex-col border-l border-[var(--hud-line)] bg-[var(--sidebar)] shadow-[var(--elev-2)]">
        <div className="flex h-16 shrink-0 items-center justify-between px-5">
          <span className="font-display text-[1.5rem] text-[var(--hud-text)]">How Aria works</span>
          <button type="button" onClick={onClose} aria-label="Close" className="grid size-9 place-items-center rounded-full text-[var(--hud-text-dim)] hover:bg-[var(--sidebar-hover)] hover:text-[var(--hud-text)]">
            <X aria-hidden="true" size={16} />
          </button>
        </div>
        <ol className="flex flex-col gap-1 px-3">
          {STEPS.map((step, i) => (
            <li key={i} className="flex items-start gap-3.5 rounded-[var(--radius-lg)] px-3 py-3">
              <span aria-hidden="true" className="grid size-10 shrink-0 place-items-center rounded-full bg-[var(--accent-soft)] text-[var(--hud-cyan)]">{step.icon}</span>
              <span className="pt-1.5 text-[0.95rem] leading-snug text-[var(--hud-text)]">
                <span className="mr-2 font-[family-name:var(--font-hud-mono)] text-[0.7rem] text-[var(--hud-text-faint)]">{i + 1}</span>
                {step.line}
              </span>
            </li>
          ))}
        </ol>
        <div className="mt-auto px-6 pb-8">
          <p className="mb-2 text-[0.75rem] text-[var(--hud-text-faint)]">Try one</p>
          <div className="flex flex-wrap gap-2">
            {["Explain the Krebs cycle", "How do vaccines work?", "While loops in Python"].map((t) => (
              <button key={t} type="button" onClick={() => { onTry(t); onClose(); }} className="rounded-full border border-[var(--hud-line)] bg-[var(--hud-surface)] px-3.5 py-1.5 text-[0.85rem] text-[var(--hud-text)] transition-colors hover:border-[var(--hud-cyan)]">
                {t}
              </button>
            ))}
          </div>
          <p className="mt-6 flex items-center gap-2 text-[0.75rem] text-[var(--hud-text-faint)]"><BookOpen size={13} aria-hidden="true" /> Open this any time from Guide.</p>
        </div>
      </aside>
    </>
  );
}

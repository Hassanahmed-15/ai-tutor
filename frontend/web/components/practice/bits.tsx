"use client";

import type React from "react";
import { useEffect, useState } from "react";
import type { Difficulty } from "./types";
import { MathText } from "@/components/MathText";

/** The app font turns "(c)" into "©" with a ligature: off on the paper, where part labels and working must read exactly. */
export const EXACT: React.CSSProperties = { fontVariantLigatures: "none", fontFeatureSettings: '"liga" 0, "clig" 0, "calt" 0, "dlig" 0' };

const TAG: Record<Difficulty, string> = {
  easy: "border-[var(--success)]/40 bg-[var(--success-soft)] text-[var(--success)]",
  medium: "border-[var(--hud-cyan)]/40 bg-[var(--hud-cyan)]/[0.10] text-[var(--hud-cyan)]",
  hard: "border-[var(--danger)]/40 bg-[var(--danger-soft)] text-[var(--danger)]",
};

export function DifficultyTag({ level }: { level: Difficulty }) {
  return (
    <span className={`inline-flex h-5 items-center rounded-full border px-2 text-[0.6875rem] font-semibold uppercase tracking-[0.06em] ${TAG[level]}`}>
      {level}
    </span>
  );
}

/** "Aria is writing your test…": the planning screen's "Thinking…" line, with a note under it. */
/** `slowAfterMs`: past it, a second line says it is taking longer than usual (owner 2026-11-28), so a long wait never looks stuck. */
export function Waiting({ line, note, slowAfterMs, slowNote = "This is taking longer than usual. Aria is still checking the questions, so hold on a little longer." }: { line: string; note?: string; slowAfterMs?: number; slowNote?: string }) {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    if (!slowAfterMs) return;
    const t = window.setTimeout(() => setSlow(true), slowAfterMs);
    return () => window.clearTimeout(t);
  }, [slowAfterMs]);
  return (
    <main className="hud-canvas hud-grain flex min-h-screen items-center justify-center px-4 sm:px-6" data-practice-phase="waiting">
      <div className="w-full max-w-2xl">
        <div className="flex items-center gap-3 text-[var(--hud-text-dim)]" role="status" aria-live="polite">
          <span className="aria-breathe size-2.5 rounded-full bg-[var(--hud-cyan)]" />
          <span className="font-display text-[1.6rem] italic">{line}</span>
        </div>
        {note && <p className="mt-3 pl-[1.375rem] text-[0.9rem] text-[var(--hud-text-faint)]">{note}</p>}
        {slow && <p className="mt-2 pl-[1.375rem] text-[0.9rem] text-[var(--hud-text-dim)]" data-practice-slow="">{slowNote}</p>}
      </div>
    </main>
  );
}

/**
 * Maths in exam text. Practice questions, schemes and feedback write every formula as `$…$` (docs/practice-exam.md),
 * but MathText only reads `$…$` as maths when it holds TeX (so "$5" stays money) — "$x+y=9$" showed raw. Here every
 * single-dollar span is maths: it is turned into \( … \) first; `$$ … $$` stays as it is.
 */
export function ExamMath({ text }: { text: string }) {
  // A model sometimes breaks the line or leaves a space right after "$" ("$\n\\mathrm{CH_2O}$", 2026-11-28): the pair may
  // span a line break, and what is inside is trimmed, so it still renders as maths.
  const tex = String(text ?? "").replace(/(?<!\$)\$(?!\$)([^$]{1,400}?)(?<!\$)\$(?!\$)/g, (_, m: string) => `\\(${m.replace(/\s+/g, " ").trim()}\\)`);
  return <MathText text={tex} />;
}

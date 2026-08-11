"use client";

import { HudPage, HudButton, type PageName } from "@/components/hud/HudKit";
import { TRACKS } from "@/components/hud/tracks";

/**
 * THE METHOD — four stages, one line each.
 *
 * This route was the mode gallery: six cards and a sticky detail panel. Modes are no longer
 * offered, so it now answers what actually happens between asking and being taught — stated as
 * briefly as the sequence allows, because a numbered list is the one place where prose adds
 * nothing.
 */
const STAGES = [
  ["01", "Brief", "A sentence, or a document you have been avoiding."],
  ["02", "Plan", "A structure you can reorder, cut, or reject."],
  ["03", "Compose", "Each idea gets the board it needs — chart, proof, diagram, drawing."],
  ["04", "Teach", "Spoken and drawn together. Interrupt at any point."],
];

export function TracksPage({ go, onStart }: { go: (p: PageName) => void; onStart: (p: PageName) => void }) {
  const standard = TRACKS[0];

  return (
    <HudPage current="tracks" go={go} onStart={() => onStart(standard.page)}>
      <section className="mx-auto max-w-4xl px-6 pt-24">
        <h1 className="hud-materialize font-display text-[3rem] leading-[0.94] tracking-[-0.035em] sm:text-[4.6rem]">
          Four stages. You are
          <br />
          present for <span className="italic text-[var(--hud-cyan)]">two.</span>
        </h1>
      </section>

      <section className="mx-auto max-w-4xl px-6 pt-16">
        {STAGES.map(([n, title, body], i) => (
          <article
            key={n}
            className="hud-materialize grid grid-cols-[3.5rem_1fr] gap-6 border-t border-[var(--hud-line)] py-9"
            style={{ animationDelay: `${0.05 * i}s` }}
          >
            <span className="hud-eyebrow pt-2 text-[var(--hud-cyan)]">{n}</span>
            <div>
              <h2 className="font-display text-[1.9rem] leading-tight tracking-[-0.015em]">{title}</h2>
              <p className="mt-2.5 max-w-lg text-[0.95rem] leading-[1.7] text-[var(--hud-text-dim)]">{body}</p>
            </div>
          </article>
        ))}
        <hr className="hud-rule" />
      </section>

      <section className="mx-auto max-w-4xl px-6 pt-16">
        <div className="flex flex-wrap items-center gap-7">
          <HudButton onClick={() => go("learn")} className="px-9 py-4">
            Begin
          </HudButton>
          <button
            onClick={() => onStart(standard.page)}
            className="text-sm text-[var(--hud-text-dim)] transition-colors hover:text-[var(--hud-text)]"
          >
            Watch a finished one
          </button>
        </div>
      </section>
    </HudPage>
  );
}

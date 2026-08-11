"use client";

import { HudPage, HudButton, type PageName } from "@/components/hud/HudKit";

/**
 * POSITION — the argument, in four short paragraphs.
 *
 * Replaces the previous manifesto entirely. That page argued for six accessibility modes in the
 * present tense, which is a claim a visitor cannot act on now the chooser is gone. This states
 * the actual position and stops. No cards, no icons, no drop cap — one column, wide margins.
 */
export function AboutPage({ go, onStart }: { go: (p: PageName) => void; onStart: () => void }) {
  return (
    <HudPage current="about" go={go} onStart={onStart}>
      <article className="mx-auto max-w-2xl px-6 pt-24 pb-24">
        <h1 className="hud-materialize font-display text-[3rem] leading-[0.94] tracking-[-0.035em] sm:text-[4.4rem]">
          Teaching does not
          <br />
          <span className="italic text-[var(--hud-cyan)]">scale.</span> That is the point.
        </h1>

        <div className="mt-14 space-y-7 border-t border-[var(--hud-line)] pt-10 text-[1.05rem] leading-[1.85] text-[var(--hud-text-dim)]">
          <p className="hud-materialize">
            Every attempt to industrialise education works the same way: record once, serve to
            everyone. It is efficient, and it is why so little of it lands. The recording cannot
            know which sentence lost you.
          </p>
          <p className="hud-materialize" style={{ animationDelay: "0.08s" }}>
            A tutor works because none of that is true. The explanation is assembled in front of
            you, aimed at what you specifically do not have, and abandoned the moment it stops
            working.
          </p>
          <p className="hud-materialize" style={{ animationDelay: "0.14s" }}>
            So nothing here is stored. You give a subject, argue with the plan, and it teaches —
            stopping whenever you speak.
          </p>
          <p className="hud-materialize" style={{ animationDelay: "0.2s" }}>
            It takes minutes and costs real money each time, because a model is doing the work
            rather than a server handing back a file. We would rather say so.
          </p>
        </div>

        <div className="mt-14">
          <HudButton onClick={() => go("learn")} className="px-9 py-4">
            Begin
          </HudButton>
        </div>
      </article>
    </HudPage>
  );
}

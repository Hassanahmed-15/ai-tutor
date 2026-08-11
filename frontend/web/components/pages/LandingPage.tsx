"use client";

import { HudPage, HudButton, type PageName } from "@/components/hud/HudKit";
import { DEMO_HARDCODED } from "@/lib/demo/demoLecture";

/**
 * The front page.
 *
 * Near-black, one brass accent, and almost nothing on it. The brief was minimal, so the page is
 * a headline, a line, and a way in — three short principles below the fold for anyone who scrolls,
 * and nothing else. No mode row, no stat grid, no pull-quote, no shimmer banner, no glow.
 *
 * The restraint is the design. If it looks empty, that is the intent: everything removed here was
 * competing with the one sentence that matters.
 */
const PRINCIPLES = [
  ["Nothing stored", "Written when you ask. Never retrieved."],
  ["Your plan first", "You approve the structure before a word exists."],
  ["Interrupt it", "Speak mid-sentence. It stops and answers."],
];

export function LandingPage({ go, onStart }: { go: (p: PageName) => void; onStart: () => void }) {
  return (
    <HudPage current="landing" go={go} onStart={onStart}>
      {/* HERO */}
      <section className="relative mx-auto flex min-h-[78vh] max-w-5xl flex-col justify-center px-6">
        <h1 className="hud-materialize max-w-3xl font-display text-[3.4rem] leading-[0.92] tracking-[-0.035em] text-[var(--hud-text-dim)] sm:text-[6rem]">
          The lecture did not exist
          <br />
          until you <span className="text-[var(--hud-text)]">asked.</span>
        </h1>

        <p
          className="hud-materialize mt-9 max-w-md text-[1.05rem] leading-[1.7] text-[var(--hud-text-dim)]"
          style={{ animationDelay: "0.12s" }}
        >
          Name a subject. It plans, draws, and teaches — once, for you.
        </p>

        <div className="hud-materialize mt-11 flex items-center gap-7" style={{ animationDelay: "0.22s" }}>
          <HudButton onClick={() => go("learn")} className="px-9 py-4">
            Begin
          </HudButton>
          <button
            onClick={onStart}
            className="text-sm text-[var(--hud-text-dim)] transition-colors hover:text-[var(--hud-text)]"
          >
            Watch one first
          </button>
        </div>

        {process.env.NODE_ENV !== "production" && DEMO_HARDCODED && (
          <button
            onClick={() => go("demo")}
            className="mt-8 self-start text-xs text-[var(--hud-text-faint)] transition-colors hover:text-[var(--hud-cyan)]"
          >
            Dev · free demo
          </button>
        )}
      </section>

      {/* THREE LINES */}
      <section className="relative mx-auto max-w-5xl px-6 pb-10">
        <div className="grid gap-px border-t border-[var(--hud-line)] sm:grid-cols-3">
          {PRINCIPLES.map(([title, body], i) => (
            <div key={title} className="hud-materialize py-9 sm:pr-8" style={{ animationDelay: `${0.06 * i}s` }}>
              <h2 className="font-display text-[1.45rem] leading-tight">{title}</h2>
              <p className="mt-2.5 text-[0.9rem] leading-[1.65] text-[var(--hud-text-dim)]">{body}</p>
            </div>
          ))}
        </div>
      </section>
    </HudPage>
  );
}

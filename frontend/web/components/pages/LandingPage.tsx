"use client";

import { HudPage, HudEyebrow, HudButton, HudDivider, HudPanel, type PageName } from "@/components/hud/HudKit";
import { TRACKS } from "@/components/hud/tracks";
import { DEMO_HARDCODED } from "@/lib/demo/demoLecture";

/**
 * The landing page — the dark-luxury front door. Big editorial serif hero, a slow gold
 * halo, a quiet line of the six modes, and a few proof statements. Logic-free marketing.
 */
export function LandingPage({ go, onStart }: { go: (p: PageName) => void; onStart: () => void }) {
  return (
    <HudPage current="landing" go={go} onStart={onStart}>
      {/* HERO */}
      <section className="relative mx-auto flex max-w-5xl flex-col items-center px-6 pt-16 text-center sm:pt-24">
        {/* slow conic cyan halo behind the headline */}
        <div className="pointer-events-none absolute -top-10 left-1/2 -z-0 size-[640px] -translate-x-1/2 opacity-[0.18]">
          <div
            className="hud-halo size-full rounded-full"
            style={{ background: "conic-gradient(from 0deg, transparent, rgba(94,234,212,0.6), transparent 40%, rgba(94,234,212,0.3), transparent 75%)" }}
          />
        </div>

        <div className="hud-materialize relative" style={{ animationDelay: "0.05s" }}>
          <HudEyebrow>One lesson · many minds</HudEyebrow>
        </div>

        <h1
          className="hud-materialize relative mt-7 font-display text-[3.4rem] font-light leading-[1.02] tracking-tight sm:text-[5.6rem]"
          style={{ animationDelay: "0.15s" }}
        >
          Learning, shaped
          <br />
          to <span className="hud-text-glow italic">every mind.</span>
        </h1>

        <p
          className="hud-materialize relative mt-8 max-w-xl text-lg font-light leading-8 text-[var(--hud-text-dim)]"
          style={{ animationDelay: "0.28s" }}
        >
          Aria is one living lesson that quietly reshapes itself around how you learn — whether
          you see it, hear it, or need it broken down, slowed down, or spoken aloud.
        </p>

        <div className="hud-materialize relative mt-10 flex flex-col items-center gap-4 sm:flex-row" style={{ animationDelay: "0.4s" }}>
          <HudButton onClick={() => go("learn")} className="px-9 py-4 text-base">
            Teach me anything →
          </HudButton>
          <HudButton variant="ghost" onClick={onStart} className="px-9 py-4 text-base">
            Or choose a mode
          </HudButton>
        </div>

        {process.env.NODE_ENV !== "production" && DEMO_HARDCODED && (
          <button
            onClick={() => go("demo")}
            className="hud-materialize relative mt-4 text-xs font-medium text-[var(--hud-text-faint)] hover:text-[var(--hud-cyan)] hover:underline"
            style={{ animationDelay: "0.46s" }}
          >
            Dev: free hardcoded demo (no generation cost) →
          </button>
        )}

        {/* the six modes as a quiet cyan-ticked line */}
        <div className="hud-materialize relative mt-16 flex flex-wrap items-center justify-center gap-x-7 gap-y-3" style={{ animationDelay: "0.52s" }}>
          {TRACKS.map((t) => (
            <button
              key={t.id}
              onClick={() => go("tracks")}
              className="group flex items-center gap-2 text-sm text-[var(--hud-text-faint)] transition-colors hover:text-[var(--hud-text)]"
            >
              <span style={{ color: t.accent }}>{t.glyph}</span>
              {t.name}
            </button>
          ))}
        </div>
      </section>

      {/* QUIET STAT LINE */}
      <section className="relative mx-auto mt-28 max-w-5xl px-6">
        <HudDivider />
        <div className="mt-12 grid gap-10 sm:grid-cols-3">
          {[
            { k: "Drawn live", v: "Every idea sketched stroke by stroke, in time with the voice." },
            { k: "Spoken warmly", v: "A real teacher's voice, not a flat reader — narration that pauses and emphasizes." },
            { k: "Six minds", v: "Standard, Blind, ADHD, Autism, Dyslexia, Dysgraphia — one lesson, reshaped for each." },
          ].map((s, i) => (
            <div key={s.k} className="hud-materialize" style={{ animationDelay: `${0.1 * i}s` }}>
              <p className="font-display text-2xl text-[var(--hud-text)]">{s.k}</p>
              <p className="mt-3 text-sm leading-6 text-[var(--hud-text-dim)]">{s.v}</p>
            </div>
          ))}
        </div>
      </section>

      {/* EDITORIAL PULL QUOTE */}
      <section className="relative mx-auto mt-32 max-w-4xl px-6 text-center">
        <div
          className="pointer-events-none absolute inset-x-0 top-1/2 -z-0 mx-auto h-64 max-w-2xl -translate-y-1/2 rounded-full opacity-20 blur-3xl"
          style={{ background: "radial-gradient(circle, rgba(94,234,212,0.5), transparent 70%)" }}
        />
        <p className="relative font-display text-3xl font-light italic leading-snug text-[var(--hud-text)] sm:text-[2.6rem]">
          &ldquo;The lesson should bend to the learner — not the other way around.&rdquo;
        </p>
        <button onClick={() => go("about")} className="relative mt-8 text-sm font-medium text-[var(--hud-cyan)] hover:underline">
          Read the manifesto →
        </button>
      </section>

      {/* MODE PREVIEW CTA */}
      <section className="relative mx-auto mt-32 max-w-6xl px-6">
        <HudPanel className="overflow-hidden p-10 text-center sm:p-16">
          <div className="hud-shimmer pointer-events-none absolute inset-0" />
          <div className="relative">
            <HudEyebrow>Ready when you are</HudEyebrow>
            <h2 className="mt-5 font-display text-4xl font-light sm:text-5xl">Begin the same lesson, your way.</h2>
            <p className="mx-auto mt-5 max-w-lg text-[var(--hud-text-dim)]">
              Pick the mode that fits how your mind works. You can change it any time.
            </p>
            <div className="mt-9">
              <HudButton onClick={onStart} className="px-9 py-4 text-base">
                Choose your mode →
              </HudButton>
            </div>
          </div>
        </HudPanel>
      </section>
    </HudPage>
  );
}

"use client";

import { useState } from "react";
import { HudPage, HudEyebrow, HudPanel, type PageName } from "@/components/hud/HudKit";
import { TRACKS, type TrackMeta } from "@/components/hud/tracks";

/**
 * The mode gallery — "Choose your mind." Six large luxury cards, each glowing in its own
 * accent on hover, with an expanded detail panel. Selecting a card starts that lesson.
 * Replaces the old plain DisabilitySelect grid (logic preserved: each card maps to the
 * same player route).
 */
export function TracksPage({ go, onStart }: { go: (p: PageName) => void; onStart: (p: PageName) => void }) {
  const [active, setActive] = useState<TrackMeta>(TRACKS[0]);

  return (
    <HudPage current="tracks" go={go} onStart={() => onStart(TRACKS[0].page)}>
      <section className="mx-auto max-w-6xl px-6 pt-10">
        <div className="text-center">
          <HudEyebrow>Before we begin</HudEyebrow>
          <h1 className="mt-5 font-display text-5xl font-light leading-tight sm:text-6xl">
            Choose how your <span className="hud-text-glow italic">mind</span> learns.
          </h1>
          <p className="mx-auto mt-5 max-w-xl text-[var(--hud-text-dim)]">
            Each mode runs the photosynthesis demo, reshaped for the way you take things in — or
            type your own topic and Aria builds a live lecture for it.
          </p>
        </div>

        {/* Teach-me-anything chat mode */}
        <HudPanel className="hud-materialize mt-10 flex flex-col items-center justify-between gap-4 overflow-hidden p-6 sm:flex-row sm:p-7">
          <div className="hud-shimmer pointer-events-none absolute inset-0" />
          <div className="relative">
            <p className="hud-eyebrow text-[var(--hud-cyan)]">Different mode</p>
            <h2 className="mt-2 font-display text-2xl">Teach me anything — open the chat builder.</h2>
            <p className="mt-1 text-sm text-[var(--hud-text-dim)]">
              Chat with Aria, choose a lesson mood, then generate a full demo-style lecture for any topic.
            </p>
          </div>
          <button onClick={() => go("learn")} className="hud-btn-primary relative shrink-0 rounded-full px-7 py-3 text-sm font-black">
            Open chat →
          </button>
        </HudPanel>

        <p className="mt-10 text-center hud-eyebrow text-[var(--hud-cyan)]">Or run the demo in a mode</p>

        {/* Gallery + detail */}
        <div className="mt-14 grid gap-8 lg:grid-cols-[1fr_360px]">
          <div className="grid gap-4 sm:grid-cols-2">
            {TRACKS.map((t, i) => (
              <button
                key={t.id}
                onMouseEnter={() => setActive(t)}
                onFocus={() => setActive(t)}
                onClick={() => onStart(t.page)}
                className="hud-materialize text-left"
                style={{ animationDelay: `${i * 0.06}s` }}
              >
                <HudPanel hover className="group overflow-hidden p-6 text-left">
                  <div
                    className="pointer-events-none absolute -right-10 -top-10 size-32 rounded-full opacity-0 blur-2xl transition-opacity duration-500 group-hover:opacity-40"
                    style={{ background: t.accent }}
                  />
                  <div className="relative flex items-start justify-between">
                    <span className="grid size-11 place-items-center rounded-xl text-xl" style={{ background: t.glow, color: t.accent }}>
                      {t.glyph}
                    </span>
                    <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-[var(--hud-text-faint)]">Ready</span>
                  </div>
                  <h3 className="relative mt-5 font-display text-2xl text-[var(--hud-text)]">{t.name}</h3>
                  <p className="relative mt-1 text-sm font-medium" style={{ color: t.accent }}>{t.tagline}</p>
                  <p className="relative mt-3 text-sm leading-6 text-[var(--hud-text-dim)]">{t.description}</p>
                </HudPanel>
              </button>
            ))}
          </div>

          {/* sticky detail panel */}
          <aside className="lg:sticky lg:top-8 lg:h-fit">
            <HudPanel className="overflow-hidden p-7">
              <div
                className="pointer-events-none absolute -right-16 -top-16 size-48 rounded-full opacity-25 blur-3xl"
                style={{ background: active.accent }}
              />
              <div className="relative">
                <span className="grid size-14 place-items-center rounded-2xl text-2xl" style={{ background: active.glow, color: active.accent }}>
                  {active.glyph}
                </span>
                <h2 className="mt-5 font-display text-3xl text-[var(--hud-text)]">{active.name}</h2>
                <p className="mt-1 text-sm font-medium" style={{ color: active.accent }}>{active.tagline}</p>
                <p className="mt-5 text-sm leading-7 text-[var(--hud-text-dim)]">{active.detail}</p>
                <button
                  onClick={() => onStart(active.page)}
                  className="hud-btn-primary mt-7 w-full rounded-full py-3.5 text-sm font-bold"
                >
                  Begin in {active.name} mode →
                </button>
              </div>
            </HudPanel>
            <p className="mt-4 px-2 text-center text-xs text-[var(--hud-text-faint)]">
              Hover a card to preview · click to begin
            </p>
          </aside>
        </div>
      </section>
    </HudPage>
  );
}

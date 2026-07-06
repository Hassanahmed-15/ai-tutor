"use client";

import { HudPage, HudEyebrow, HudButton, HudDivider, HudPanel, type PageName } from "@/components/hud/HudKit";
import { TRACKS } from "@/components/hud/tracks";

/**
 * The lesson-complete page — a real ending where lessons used to just stop. Recaps the
 * photosynthesis lesson, celebrates finishing, and offers a replay or a new mode. `lastTrack`
 * is the player the student just exited from, so "replay" returns to the right one.
 */
const RECAP = [
  { icon: "☀️", text: "Sunlight, water, and carbon dioxide come in." },
  { icon: "🍃", text: "Inside the chloroplast, light splits water and builds sugar." },
  { icon: "🍬", text: "The plant keeps the sugar as its food." },
  { icon: "🫧", text: "Oxygen is released into the air we breathe." },
];

export function CompletePage({ go, lastTrack, onReplay }: { go: (p: PageName) => void; lastTrack: PageName; onReplay: () => void }) {
  const track = TRACKS.find((t) => t.page === lastTrack) ?? TRACKS[0];

  return (
    <HudPage current="complete" go={go} onStart={() => go("tracks")}>
      <section className="mx-auto max-w-3xl px-6 pt-16 text-center">
        {/* cyan seal */}
        <div className="hud-materialize relative mx-auto grid size-24 place-items-center">
          <div className="pointer-events-none absolute inset-0 rounded-full opacity-40 blur-2xl" style={{ background: "radial-gradient(circle, rgba(94,234,212,0.8), transparent 70%)" }} />
          <div className="hud-halo absolute inset-0 rounded-full border border-[var(--hud-cyan)]/40" />
          <span className="relative font-display text-4xl hud-text-glow">✦</span>
        </div>

        <HudEyebrow>Lesson complete</HudEyebrow>
        <h1 className="mt-5 font-display text-5xl font-light leading-tight sm:text-6xl">
          You finished <span className="hud-text-glow italic">photosynthesis.</span>
        </h1>
        <p className="mx-auto mt-5 max-w-lg text-[var(--hud-text-dim)]">
          Completed in <span className="text-[var(--hud-text)]">{track.name}</span> mode — {track.tagline.toLowerCase()}.
        </p>

        <HudDivider />

        {/* recap */}
        <div className="mx-auto mt-10 max-w-xl space-y-3 text-left">
          <p className="hud-eyebrow text-center text-[var(--hud-cyan)]">The whole story, once more</p>
          {RECAP.map((r, i) => (
            <div key={i} className="hud-materialize" style={{ animationDelay: `${i * 0.08}s` }}>
              <HudPanel className="flex items-center gap-4 px-5 py-4">
                <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-white/5 text-xl">{r.icon}</span>
                <span className="text-sm font-medium leading-snug text-[var(--hud-text-dim)]">{r.text}</span>
              </HudPanel>
            </div>
          ))}
        </div>

        {/* actions */}
        <div className="mt-12 flex flex-col items-center justify-center gap-4 sm:flex-row">
          <HudButton onClick={onReplay} className="px-9 py-4 text-base">
            Replay in {track.name} mode
          </HudButton>
          <HudButton variant="ghost" onClick={() => go("tracks")} className="px-9 py-4 text-base">
            Try a different mode →
          </HudButton>
        </div>

        {/* other modes */}
        <div className="mt-16">
          <p className="hud-eyebrow text-[var(--hud-cyan)]">Or experience it another way</p>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-x-7 gap-y-3">
            {TRACKS.filter((t) => t.page !== lastTrack).map((t) => (
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
        </div>
      </section>
    </HudPage>
  );
}

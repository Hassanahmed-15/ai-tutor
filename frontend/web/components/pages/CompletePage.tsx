"use client";

import { HudPage, HudButton, type PageName } from "@/components/hud/HudKit";

/**
 * The page after a lecture ends.
 *
 * The mode-switching offer is gone with the rest of mode selection, and so is the hardcoded
 * photosynthesis recap — it listed four bullet points about chloroplasts regardless of what had
 * just been taught, which is worse than no recap once lectures are generated on demand.
 *
 * `lastTrack` is still accepted so app/page.tsx needs no change.
 */
export function CompletePage({ go, onReplay }: { go: (p: PageName) => void; lastTrack: PageName; onReplay: () => void }) {
  return (
    <HudPage current="complete" go={go} onStart={() => go("learn")}>
      <section className="mx-auto flex min-h-[70vh] max-w-3xl flex-col justify-center px-6">
        <h1 className="hud-materialize font-display text-[3rem] leading-[0.94] tracking-[-0.035em] sm:text-[4.4rem]">
          Finished.
          <br />
          <span className="italic text-[var(--hud-cyan)]">It will not run</span> that way again.
        </h1>

        <p
          className="hud-materialize mt-9 max-w-md text-[1.02rem] leading-[1.7] text-[var(--hud-text-dim)]"
          style={{ animationDelay: "0.1s" }}
        >
          Replay gives you this recording. Asking again writes a new lecture.
        </p>

        <div className="hud-materialize mt-11 flex items-center gap-7" style={{ animationDelay: "0.18s" }}>
          <HudButton onClick={onReplay} className="px-9 py-4">
            Replay
          </HudButton>
          <button
            onClick={() => go("learn")}
            className="text-sm text-[var(--hud-text-dim)] transition-colors hover:text-[var(--hud-text)]"
          >
            Something new
          </button>
        </div>
      </section>
    </HudPage>
  );
}

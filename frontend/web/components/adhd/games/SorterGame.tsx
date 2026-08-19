"use client";

import { lazy, Suspense, useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { GameSpec } from "@/lib/adhd/games/spec";
import { initialSorter, sorterPassed, type SorterState } from "@/lib/adhd/games/sorterRules";
import { useReducedMotion } from "@/lib/anim/useReducedMotion";

/**
 * Sorting Run — steer the falling term into the right bin.
 *
 * This file is the SHELL: it owns the backdrop fetch, the start and end cards, the accessible
 * mirror of the run, and the choice of renderer. The 3D scene lives in `SorterScene.tsx` and the
 * rules live in `lib/adhd/games/sorterRules.ts`, and neither knows about the other.
 *
 * THREE IS LAZY-LOADED. It is ~25MB on disk and a real parse cost in the browser, so a learner who
 * never opens game mode must never pay for it — hence `lazy()` around the scene rather than a
 * static import. That also keeps three out of the server bundle, which matters because it touches
 * `window` on import.
 *
 * WEBGL IS NOT GUARANTEED. Old hardware, locked-down school machines, blocked contexts and headless
 * browsers all exist. When there is no context to be had the round is not lost: the caller falls
 * back to the DOM round, which is already built and tested. A blank canvas would be the worst of
 * the three outcomes and is the one this exists to avoid.
 */

const SorterScene = lazy(() => import("./SorterScene").then((m) => ({ default: m.SorterScene })));

/**
 * WebGL support, read as an external store rather than probed in an effect.
 *
 * The probe is a synchronous fact about the device, not something to synchronise — reading it with
 * `useState` + `useEffect` means a setState during commit, which React's compiler rejects and which
 * paints one frame of the wrong thing first. `useSyncExternalStore` is the primitive for exactly
 * this, and `lib/anim/useReducedMotion.ts` already uses it here for the same reason.
 *
 * Cached, because creating a probe context on every render would leak them — browsers cap the
 * number of live WebGL contexts and silently drop the oldest.
 */
let webglOk: boolean | null = null;
function getSnapshot(): boolean {
  if (webglOk !== null) return webglOk;
  try {
    const canvas = document.createElement("canvas");
    webglOk = !!(canvas.getContext("webgl2") ?? canvas.getContext("webgl"));
  } catch {
    webglOk = false;
  }
  return webglOk;
}

/** Never changes for the life of the page, so there is nothing to subscribe to. */
function subscribe(): () => void {
  return () => {};
}

/** The server has no canvas. Assume support and let the client correct it on first paint. */
function getServerSnapshot(): boolean {
  return true;
}

export function SorterGame({
  spec,
  topic,
  onDone,
  onUnsupported,
}: {
  spec: GameSpec;
  /** Lesson topic, used only to fetch a backdrop. Absent is fine — the game plays without one. */
  topic?: string;
  /** Called when the run ends, with whether it counts as passed. */
  onDone: (passed: boolean) => void;
  /** Called instead of rendering when WebGL is unavailable, so the caller can use the DOM round. */
  onUnsupported?: () => void;
}) {
  const reduced = useReducedMotion();
  const [started, setStarted] = useState(false);
  const [hud, setHud] = useState<SorterState>(initialSorter);
  const [ended, setEnded] = useState<SorterState | null>(null);
  const doneRef = useRef(onDone);
  const unsupportedRef = useRef(onUnsupported);
  useEffect(() => {
    doneRef.current = onDone;
    unsupportedRef.current = onUnsupported;
  });

  const supported = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  // Telling the parent is a side effect, so it stays in an effect — but it sets no state here.
  useEffect(() => {
    if (!supported) unsupportedRef.current?.();
  }, [supported]);

  /**
   * The backdrop arrives whenever it arrives, and the game never waits for it.
   *
   * An earlier version gated the renderer on this fetch. Generating the image takes ten to twenty
   * seconds, and for all of it the learner sat looking at an empty box — a test caught it as
   * `canvas=false`. Decoration must never block play.
   */
  const [bg, setBg] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    if (!topic) return;
    fetch("/api/game-art", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ topic }),
    })
      .then((r) => (r.ok ? r.json() : { url: null }))
      .then((d) => { if (live && typeof d.url === "string") setBg(d.url); })
      .catch(() => { /* a missing picture is not a missing game */ });
    return () => { live = false; };
  }, [topic]);

  if (!supported) {
    // The caller swaps in the DOM round; this stops the board flashing empty in between.
    return (
      <div className="grid h-full w-full place-items-center bg-[#070b16] text-sm text-white/50">
        Loading round…
      </div>
    );
  }

  return (
    <div className="relative h-full w-full overflow-hidden bg-[#070b16]" data-sorter-game={spec.beatId}>
      {/*
        The backdrop lives HERE, not in the scene, so it exists from the moment the board mounts —
        visible behind the start card, and observable before anyone presses play. Inside the scene
        it only appeared after the round began, which meant a check for it could not tell "not
        generated yet" from "the art layer is broken".
      */}
      <div
        data-sorter-backdrop={bg ? "on" : "off"}
        className="absolute inset-0 bg-cover bg-center transition-opacity duration-1000"
        style={{ backgroundImage: bg ? `url(${bg})` : undefined, opacity: bg ? 0.34 : 0 }}
      />

      {supported && started && (
        <Suspense
          fallback={<div className="grid h-full w-full place-items-center text-sm text-white/40">Building the board…</div>}
        >
          <SorterScene spec={spec} reduced={reduced} onState={setHud} onEnd={setEnded} />
        </Suspense>
      )}

      {/* HUD in the DOM, not in the scene: crisp at any resolution, and it is the same element a
          screen reader and a test can read. Drawn into the canvas it would be invisible to both. */}
      {started && !ended && (
        <div className="pointer-events-none absolute inset-x-0 top-0 z-40 flex items-center justify-between px-5 py-3 font-mono text-[0.82rem] text-white/80">
          <span>SCORE {hud.score}</span>
          <span className={hud.combo >= 2 ? "text-teal-300" : "text-transparent"}>
            {hud.combo}× combo
          </span>
          <span>
            {"♥".repeat(Math.max(0, hud.lives))}
            <span className="ml-3 text-white/45">{hud.resolved}/{spec.items.length}</span>
          </span>
        </div>
      )}

      <span className="sr-only" data-sorter-state aria-live="polite">
        {ended
          ? `finished, ${ended.correct} right, ${ended.wrong + ended.missed} not`
          : `${hud.resolved} of ${spec.items.length} sorted`}
      </span>

      {/* The start card. The bins have to be readable before anything falls — the first tile used to
          arrive while the learner was still working out what the two sides meant. */}
      {supported && !started && !ended && (
        <div className="absolute inset-0 z-50 grid place-items-center bg-black/70 backdrop-blur-sm">
          <div className="flex max-w-lg flex-col items-center gap-4 px-6 text-center">
            <h2 className="text-2xl font-black text-white">{spec.title}</h2>
            <p className="text-sm leading-relaxed text-white/70">
              Steer each one into <span className="font-bold text-teal-300">{spec.bins[0]}</span> or{" "}
              <span className="font-bold text-violet-300">{spec.bins[1]}</span>.
              <br />
              <span className="text-white/45">move the mouse · {spec.items.length} to sort · 3 lives</span>
            </p>
            <button
              data-sorter-start
              onClick={() => setStarted(true)}
              className="rounded-full bg-teal-400/20 px-6 py-2.5 text-sm font-bold text-teal-100 ring-1 ring-teal-400/40 transition hover:bg-teal-400/30"
            >
              Start
            </button>
          </div>
        </div>
      )}

      {ended && (
        <div className="absolute inset-0 z-50 grid place-items-center bg-black/80 backdrop-blur-sm">
          <div className="flex flex-col items-center gap-3 px-6 text-center">
            <p className={`text-3xl font-black ${sorterPassed(ended) ? "text-emerald-300" : "text-amber-300"}`}>
              {sorterPassed(ended) ? "Sorted!" : "Out of lives"}
            </p>
            <p className="text-sm text-white/70">
              {ended.score} points · best combo {ended.bestCombo} · {ended.correct} right,{" "}
              {ended.wrong + ended.missed} not
            </p>
            <button
              data-sorter-continue
              onClick={() => doneRef.current(sorterPassed(ended))}
              className="rounded-full bg-teal-400/15 px-6 py-2.5 text-sm font-bold text-teal-200 ring-1 ring-teal-400/30 transition hover:bg-teal-400/25"
            >
              Continue →
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

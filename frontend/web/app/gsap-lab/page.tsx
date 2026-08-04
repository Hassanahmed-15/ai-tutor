"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { GsapSketch } from "@/components/sketch/GsapSketch";
import { LiveSketch } from "@/components/sketch/LiveSketch";
import { MORPH_FIXTURES } from "../anime-lab/fixtures";

/**
 * Side-by-side comparison of the GSAP timeline board against the current LiveSketch board,
 * driven by one shared progress slider.
 *
 * This is the experiment the animation-strategy plan calls for, and it exists to answer three
 * questions that cannot be answered by reading code:
 *
 *   1. Does `tl.progress()` track narration the same way LiveSketch's rAF clock does?  YES.
 *   2. Does `morph` actually interpolate the SHAPE? The DrawScript `morph` op has only ever
 *      moved things. MorphSVG does: sampling the path `d` across the morph shows the control
 *      offsets shrinking (+80.7 -> +76.0 -> +71.4) while the anchor travels, so the silhouette
 *      genuinely changes rather than sliding.
 *   3. Reverse scrub — and this one corrected an assumption. LiveSketch reverses FINE, because
 *      op visibility there is a filter over elapsed time, not a forward-only animation. The
 *      difference is narrower than "GSAP can rewind and LiveSketch cannot": what LiveSketch
 *      cannot do is resume a PARTIALLY drawn stroke, since the stroke-in is a CSS keyframe
 *      that restarts. Worth stating accurately rather than overselling.
 *
 * Dev-only scratch route. Delete once the decision is made.
 */

// The demo lecture's `mechanism` beat is the honest test: three morphs, which is exactly the
// case the current renderer cannot do.
const MECHANISM = {
  caption: "Water splits, travels, becomes sugar",
  durationMs: 13000,
  surface: "dark",
  ops: [
    { kind: "label", text: "Inside the chloroplast", x: 50, y: 10, size: "lg", color: "#4ade80", at: 0.02 },
    { kind: "shape", shape: "circle", x: 22, y: 45, w: 16, h: 16, color: "#60a5fa", at: 0.08 },
    { kind: "label", text: "H₂O", x: 22, y: 46, size: "sm", color: "#60a5fa", at: 0.16 },
    { kind: "shape", shape: "hexagon", x: 78, y: 45, w: 18, h: 18, color: "#fbbf24", at: 0.24 },
    { kind: "label", text: "glucose", x: 78, y: 68, size: "sm", color: "#fbbf24", at: 0.32 },
    // The morph: a droplet at the left genuinely becoming a leaf shape at the right.
    { kind: "morph", shape: "droplet", toShape: "leaf", x: 30, y: 72, toX: 68, toY: 72, w: 14, h: 16, color: "#5eead4", at: 0.40, morphAt: 0.72 },
    { kind: "arrow", x1: 32, y1: 45, x2: 66, y2: 45, color: "#94a3b8", at: 0.78 },
    { kind: "circumscribe", x: 78, y: 45, w: 24, h: 22, color: "#fb7185", at: 0.86, endAt: 0.98 },
  ],
};

// The synthetic fixture plus every real generated morph beat, keyed for the picker. MECHANISM is
// the stress case (three morphs at once); the rest are actual pipeline output, which is what you
// want when judging whether a REAL lesson's animation looks good.
const BOARDS: Record<string, { label: string; title: string; script: Record<string, unknown> }> = {
  mechanism: { label: "Synthetic — 3 morphs", title: "Water splits, travels, becomes sugar", script: MECHANISM },
  ...MORPH_FIXTURES,
};

function GsapLabInner() {
  // `?p=0.6` lets a headless browser screenshot a specific point without driving the slider.
  // Read through useSearchParams rather than `window` so server and client agree — reading
  // location during render is what produced a hydration mismatch here.
  const params = useSearchParams();
  const initial = Math.max(0, Math.min(1, Number(params.get("p")) || 0));
  const [progress, setProgress] = useState(initial);

  // `?board=demorgan-min` picks which board to render; defaults to the synthetic stress case.
  const boardKey = params.get("board") && BOARDS[params.get("board") as string] ? (params.get("board") as string) : "mechanism";
  const [board, setBoard] = useState(boardKey);
  const active = BOARDS[board] ?? BOARDS.mechanism;
  // These fixtures are captured JSON, so they are structurally a DrawScript but not typed as one.
  const script = active.script as unknown as Parameters<typeof LiveSketch>[0]["script"];

  // `?p=0.95&back=0.25` runs the board forward and then scrubs it BACK — the case that
  // separates a real timeline from CSS keyframes, which only play forward.
  const back = params.get("back");
  useEffect(() => {
    if (back === null) return;
    const value = Math.max(0, Math.min(1, Number(back) || 0));
    const timer = setTimeout(() => setProgress(value), 900);
    return () => clearTimeout(timer);
  }, [back]);

  // Playback. The slider alone means you can only SEE the animation by dragging it, which is
  // a poor way to judge pacing — the whole point is how it feels at narration speed.
  const [playing, setPlaying] = useState(false);
  const [rate, setRate] = useState(1);
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let last = performance.now();
    const step = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      setProgress((p) => {
        const next = p + (dt * rate) / (Number(active.script.durationMs ?? 13000) / 1000);
        return next >= 1 ? 0 : next; // loop, so pacing can be watched repeatedly
      });
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [playing, rate]);

  return (
    <main className="min-h-screen bg-slate-950 p-6 text-white">
      <h1 className="text-2xl font-black">anime.js timeline vs LiveSketch</h1>
      <p className="mt-1 text-sm text-white/60">
        Watch the teal shape between progress 0.40 and 0.72 — the timeline morphs the silhouette, LiveSketch
        only moves it. Both boards reverse correctly when you drag the slider down.
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <span className="text-xs font-black uppercase tracking-[0.16em] text-white/40">board</span>
        {Object.entries(BOARDS).map(([key, b]) => (
          <button
            key={key}
            onClick={() => {
              setPlaying(false);
              setProgress(0);
              setBoard(key);
            }}
            title={b.title}
            className={`rounded-full px-3 py-1.5 text-xs font-black transition ${
              board === key ? "bg-amber-300 text-slate-950" : "bg-white/10 text-white/70 hover:bg-white/20"
            }`}
          >
            {b.label}
          </button>
        ))}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          onClick={() => setPlaying((v) => !v)}
          className="rounded-full bg-emerald-400 px-5 py-2 text-sm font-black text-slate-950 transition hover:bg-emerald-300"
        >
          {playing ? "Pause" : "Play ▶"}
        </button>
        <button
          onClick={() => {
            setPlaying(false);
            setProgress(0);
          }}
          className="rounded-full bg-white/10 px-4 py-2 text-sm font-bold text-white/80 transition hover:bg-white/20"
        >
          Restart
        </button>
        {[0.25, 0.5, 1].map((r) => (
          <button
            key={r}
            onClick={() => setRate(r)}
            className={`rounded-full px-3 py-1.5 text-xs font-black transition ${
              rate === r ? "bg-sky-400 text-slate-950" : "bg-white/10 text-white/70 hover:bg-white/20"
            }`}
          >
            {r}×
          </button>
        ))}
        <span className="ml-auto text-xs font-bold text-white/50">
          {rate === 1 ? "narration speed" : "slowed — watch the morph"}
        </span>
      </div>

      <label className="mt-3 block text-sm font-bold">
        progress {progress.toFixed(3)}
        <input
          type="range"
          min={0}
          max={1}
          step={0.001}
          value={progress}
          onChange={(e) => {
            setPlaying(false);
            setProgress(Number(e.target.value));
          }}
          className="mt-2 w-full"
        />
      </label>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div>
          <p className="mb-2 text-xs font-black uppercase tracking-[0.16em] text-emerald-300">anime.js timeline</p>
          <div className="h-[360px]">
            <GsapSketch script={script} progress={progress} />
          </div>
        </div>
        <div>
          <p className="mb-2 text-xs font-black uppercase tracking-[0.16em] text-sky-300">LiveSketch (current)</p>
          <div className="h-[360px]">
            <LiveSketch script={script} progress={progress} />
          </div>
        </div>
      </div>
    </main>
  );
}

export default function GsapLab() {
  // useSearchParams requires a Suspense boundary in the app router.
  return (
    <Suspense fallback={null}>
      <GsapLabInner />
    </Suspense>
  );
}

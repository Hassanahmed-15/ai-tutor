"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { PlotBoard } from "@/components/sketch/PlotBoard";
import { EquationBoard } from "@/components/sketch/EquationBoard";
import { validatePlotSpec, type PlotSpec } from "@/lib/plotSpec";
import { validateEquationSpec, type EquationSpec } from "@/lib/equationSpec";

/**
 * `/board-lab` — the Vega-Lite chart and the KaTeX derivation on real specs, driven by one slider.
 *
 * Dev-only, and the same idea as /structure-lab and /anime-lab: judging whether these boards read
 * well, and asserting in a test that they actually RENDER, should not require generating a whole
 * lecture and hoping the right beat appears. Everything here is deterministic — no model call — so
 * a Playwright run measures the renderer and nothing else.
 *
 *   ?board=compound-interest&p=1     jump to a progress point for a headless screenshot
 *
 * The specs below go through the real validators, so this page also proves the thing the unit
 * tests can only assert indirectly: what survives validation is what the board can draw.
 */

const PLOTS: Record<string, unknown> = {
  "compound-interest": {
    mark: { type: "line", point: true },
    data: {
      values: Array.from({ length: 21 }, (_, year) => ({
        year,
        balance: Math.round(1000 * 1.08 ** year * 100) / 100,
      })),
    },
    encoding: {
      x: { field: "year", type: "quantitative", title: "Years" },
      y: { field: "balance", type: "quantitative", title: "Balance ($)" },
    },
  },
  "rainfall-by-month": {
    mark: "bar",
    data: {
      values: [
        { month: "Jan", mm: 78 }, { month: "Feb", mm: 61 }, { month: "Mar", mm: 55 },
        { month: "Apr", mm: 42 }, { month: "May", mm: 39 }, { month: "Jun", mm: 31 },
        { month: "Jul", mm: 28 }, { month: "Aug", mm: 34 }, { month: "Sep", mm: 47 },
        { month: "Oct", mm: 66 }, { month: "Nov", mm: 81 }, { month: "Dec", mm: 88 },
      ],
    },
    encoding: {
      // `sort` is not optional here. A nominal axis defaults to alphabetical, which renders the
      // months as "Apr, Aug, Dec, Feb…" — a chart in the wrong order teaches the wrong thing, and
      // it looks like a rendering bug rather than a spec one.
      x: {
        field: "month",
        type: "nominal",
        title: "Month",
        sort: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
      },
      y: { field: "mm", type: "quantitative", title: "Rainfall (mm)" },
    },
  },
};

const EQUATIONS: Record<string, unknown> = {
  pythagoras: {
    title: "Solving for the hypotenuse",
    steps: [
      { tex: "a^2 + b^2 = c^2", why: "Pythagoras' theorem" },
      { tex: "3^2 + 4^2 = c^2", why: "substitute a = 3, b = 4" },
      { tex: "9 + 16 = c^2", why: "evaluate the squares" },
      { tex: "c = \\sqrt{25} = 5", why: "take the positive root" },
    ],
  },
  quadratic: {
    title: "The quadratic formula",
    steps: [
      { tex: "ax^2 + bx + c = 0", why: "the general quadratic" },
      { tex: "x^2 + \\frac{b}{a}x = -\\frac{c}{a}", why: "divide by a, move the constant" },
      { tex: "\\left(x + \\frac{b}{2a}\\right)^2 = \\frac{b^2 - 4ac}{4a^2}", why: "complete the square" },
      { tex: "x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}", why: "take roots and isolate x" },
    ],
  },
};

function BoardLab() {
  const params = useSearchParams();
  const requested = params.get("board") ?? "compound-interest";
  const [progress, setProgress] = useState(() => {
    const p = Number(params.get("p"));
    return Number.isFinite(p) ? Math.max(0, Math.min(1, p)) : 1;
  });

  const plot = PLOTS[requested] ? validatePlotSpec(PLOTS[requested]) : null;
  const equation = EQUATIONS[requested] ? validateEquationSpec(EQUATIONS[requested]) : null;

  return (
    <main className="min-h-screen bg-slate-950 p-6 text-white">
      <h1 className="text-xl font-black">board-lab</h1>
      <p className="mt-1 text-sm text-white/50">
        Vega-Lite charts and KaTeX derivations on fixed specs. No model call — what you see is the
        renderer.
      </p>

      <div className="mt-4 flex flex-wrap gap-2">
        {[...Object.keys(PLOTS), ...Object.keys(EQUATIONS)].map((name) => (
          <a
            key={name}
            href={`/board-lab?board=${name}&p=${progress}`}
            data-board-link={name}
            className={`rounded-full px-3 py-1.5 text-xs transition ${
              name === requested ? "bg-white/20 text-white" : "bg-white/5 text-white/60 hover:bg-white/15"
            }`}
          >
            {name}
          </a>
        ))}
      </div>

      <label className="mt-5 block text-sm font-bold">
        progress {progress.toFixed(2)}
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={progress}
          onChange={(e) => setProgress(Number(e.target.value))}
          className="mt-2 w-full max-w-2xl"
        />
      </label>

      <div className="mt-5 h-[460px] max-w-4xl" data-lab-stage="">
        {plot ? (
          <PlotBoard spec={plot as PlotSpec} progress={progress} />
        ) : equation ? (
          <EquationBoard spec={equation as EquationSpec} progress={progress} />
        ) : (
          // A spec that fails validation must say so here rather than rendering an empty frame —
          // "the validator rejected this" and "the board drew nothing" are different bugs.
          <p data-lab-error="" className="rounded-xl bg-rose-500/10 p-4 text-sm text-rose-300">
            No board named &quot;{requested}&quot;, or its spec did not validate.
          </p>
        )}
      </div>
    </main>
  );
}

export default function Page() {
  return (
    <Suspense fallback={null}>
      <BoardLab />
    </Suspense>
  );
}

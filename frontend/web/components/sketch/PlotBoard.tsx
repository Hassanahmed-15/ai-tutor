"use client";

import { useEffect, useRef, useState } from "react";
import type { PlotSpec } from "@/lib/plotSpec";

/**
 * A Vega-Lite chart, revealed with the beat's narration progress.
 *
 * WHY VEGA-LITE OWNS PLOTS. It is a declarative grammar of graphics — the chart is described as
 * data plus encodings, and axes, ticks, binning and legends are DERIVED rather than drawn. Two
 * consequences matter: a model writes it reliably because the JSON shape is small and regular, and
 * the result is exact, because nothing about the geometry came from the model. That is the same
 * principle ELK gives structure diagrams, applied to quantities. Manim can draw a handsome curve
 * but spends seconds of Python rendering a fixed video of what is usually a static chart.
 *
 * vega-embed is imported dynamically: vega-lite is ESM-only with a top-level await, so a static
 * import would drag it into the CommonJS test build and any server path that cannot load it.
 *
 * Progress drives a WIPE rather than a re-render. Re-embedding on every narration tick would re-run
 * the whole Vega dataflow many times a second; wiping the plotting area left-to-right gives the
 * same "being drawn" reading from one embed, and keeps the axes and legend present throughout —
 * which is what you want, since the axes are the context the curve is read against.
 */
export function PlotBoard({ spec, progress = 0 }: { spec: PlotSpec; progress?: number }) {
  const host = useRef<HTMLDivElement | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    let view: { finalize: () => void } | null = null;
    (async () => {
      try {
        const embed = (await import("vega-embed")).default;
        if (!alive || !host.current) return;
        const res = await embed(host.current, spec as Parameters<typeof embed>[1], {
          actions: false,
          renderer: "svg",
        });
        if (!alive) {
          res.view.finalize();
          return;
        }
        view = res.view;
      } catch (err) {
        if (alive) setError(err instanceof Error ? err.message : "vega-embed failed");
      }
    })();
    return () => {
      alive = false;
      view?.finalize();
    };
  }, [spec]);

  if (error) {
    return (
      <section className="flex h-full items-center rounded-xl border border-slate-200 bg-white p-4">
        <p className="text-sm text-rose-600">
          <span className="font-bold">Vega-Lite could not render this:</span> {error}
        </p>
      </section>
    );
  }

  const shown = Math.max(0, Math.min(1, progress));
  return (
    <section
      data-board="plot"
      className="relative h-full w-full overflow-hidden rounded-xl border border-slate-200 bg-white p-3"
    >
      <div ref={host} className="h-full w-full [&_svg]:!h-auto [&_svg]:!w-full" />
      {/* Wipes the drawn marks left-to-right. Sits inside the plot area only, so the axes and
          legend stay readable from the first frame rather than arriving with the data. */}
      <div
        data-plot-wipe=""
        className="pointer-events-none absolute inset-y-3 right-3 bg-white transition-[width] duration-150"
        style={{ width: `${(1 - shown) * 88}%` }}
      />
    </section>
  );
}

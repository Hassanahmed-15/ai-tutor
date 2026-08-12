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

  /**
   * Serialise the spec for the dependency comparison.
   *
   * `spec` is an object read fresh off the beat on each render, so a raw `[spec]` dependency
   * compares by reference and re-embeds whenever the parent re-renders — which the narration tick
   * causes constantly. Comparing the CONTENT means the chart embeds once per actual spec and
   * survives every unrelated re-render.
   */
  const specKey = JSON.stringify(spec);

  useEffect(() => {
    let alive = true;
    let view: { finalize: () => void } | null = null;
    let raf = 0;

    (async () => {
      try {
        const embed = (await import("vega-embed")).default;
        if (!alive) return;

        /**
         * Wait for the host element instead of giving up on it.
         *
         * The dynamic import of vega-embed resolves asynchronously, and on a cold chunk load it
         * can land before the ref is attached — at which point the old code hit `if (!host.current)
         * return` and silently never tried again. The chart then appeared only when something else
         * forced a re-render, which is why pausing and resuming "started loading" a chart that
         * should already have been there.
         *
         * A bounded rAF wait costs nothing when the ref is already set (the first check passes) and
         * removes the race entirely when it is not.
         */
        const host_ = await new Promise<HTMLDivElement | null>((resolve) => {
          let tries = 0;
          const check = () => {
            if (!alive) return resolve(null);
            if (host.current) return resolve(host.current);
            if (tries++ > 60) return resolve(null); // ~1s at 60fps, then give up honestly
            raf = requestAnimationFrame(check);
          };
          check();
        });
        if (!alive || !host_) return;

        const res = await embed(host_, spec as Parameters<typeof embed>[1], {
          actions: false,
          renderer: "svg",
        });
        if (!alive) {
          res.view.finalize();
          return;
        }
        view = res.view;
        setError(null);
      } catch (err) {
        if (alive) setError(err instanceof Error ? err.message : "vega-embed failed");
      }
    })();

    return () => {
      alive = false;
      if (raf) cancelAnimationFrame(raf);
      view?.finalize();
    };
    // `specKey` is the content hash of `spec`; depending on the object itself would re-embed on
    // every parent render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [specKey]);

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

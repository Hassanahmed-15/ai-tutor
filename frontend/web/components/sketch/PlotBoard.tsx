"use client";

import { useEffect, useRef, useState } from "react";
import type { PlotSpec } from "@/lib/plotSpec";

/**
 * A Vega-Lite chart, committed as one complete visual when Vega has finished rendering it.
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
 * Charts are not handwriting. Revealing one with a white wipe leaves an axis-only frame at the
 * start of every beat, which looks exactly like failed data binding. The host stays invisible while
 * Vega embeds, then the complete chart appears in one commit: axes, marks, labels and legend
 * together. `progress` remains in the prop contract so every board renderer is interchangeable,
 * but it deliberately does not control a chart's visibility.
 */
export function PlotBoard({ spec }: { spec: PlotSpec; progress?: number }) {
  const host = useRef<HTMLDivElement | null>(null);
  const [errorState, setErrorState] = useState<{ key: string; message: string } | null>(null);
  const [readySpecKey, setReadySpecKey] = useState<string | null>(null);

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
        // `embed` resolves only after the Vega view has run. One animation frame lets the browser
        // commit that finished SVG before making the host visible, so an axis-only intermediate
        // frame can never be presented to the student.
        raf = requestAnimationFrame(() => {
          if (alive) setReadySpecKey(specKey);
        });
      } catch (err) {
        if (alive) {
          setErrorState({
            key: specKey,
            message: err instanceof Error ? err.message : "vega-embed failed",
          });
        }
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

  const error = errorState?.key === specKey ? errorState.message : null;
  const ready = readySpecKey === specKey;
  if (error) {
    return (
      <section className="flex h-full items-center rounded-xl border border-slate-200 bg-white p-4">
        <p className="text-sm text-rose-600">
          <span className="font-bold">Vega-Lite could not render this:</span> {error}
        </p>
      </section>
    );
  }

  return (
    <section
      data-board="plot"
      data-plot-ready={ready ? "true" : "false"}
      className="relative h-full w-full overflow-hidden rounded-xl border border-slate-200 bg-white p-3"
    >
      <div
        ref={host}
        aria-hidden={!ready}
        className={`h-full w-full [&_svg]:!h-auto [&_svg]:!w-full ${ready ? "opacity-100" : "opacity-0"}`}
      />
      {!ready && (
        <div className="absolute inset-0 grid place-items-center bg-white" role="status" aria-live="polite">
          <span className="text-sm font-semibold text-slate-500">Preparing chart…</span>
        </div>
      )}
    </section>
  );
}

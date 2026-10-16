"use client";

import { useMemo } from "react";
import Link from "next/link";
import { CanvasPanel } from "@/components/canvas/CanvasPanel";
import { layoutPanel } from "@/lib/canvas/layout";
import { validateCanvasSpec } from "@/lib/canvas/validate";
import { FIGURE_COMPONENTS } from "@/lib/figures/registry";
import { PANEL_H, PANEL_W } from "@/lib/canvas/types";

/** One board per component, built from its own defaults, every part labelled. */
export function FigureGalleryClient() {
  const boards = useMemo(() => FIGURE_COMPONENTS.map((c) => {
    const parts = c.build({}).parts.slice(0, 8).map((p, i) => ({ id: p.id, name: p.name, s: i }));
    const spec = validateCanvasSpec({ heading: c.title.split(":")[0].slice(0, 56), notes: [], cues: [], stage: { kind: "figure", component: c.name, params: {}, parts } }, 9);
    return spec ? { name: c.name, title: c.title, params: c.params, spec, layout: layoutPanel(spec) } : null;
  }).filter((b): b is NonNullable<typeof b> => Boolean(b)), []);
  return (
    <main className="min-h-screen bg-slate-50"><div className="mx-auto max-w-6xl px-4 py-8 text-slate-900">
      <h1 className="text-2xl font-black">Figure gallery</h1>
      <p className="mt-1 text-sm text-slate-600">
        {boards.length} diagrams drawn by code, shown with their default settings. In a lesson, Aria chooses the settings (contents, values, colours) and which parts to label. The licensed textbook diagrams (heart, cell, eye…) are at <Link className="font-bold text-violet-700 underline" href="/figure-lab">/figure-lab</Link>.
      </p>
      <div className="mt-6 grid gap-8">
        {boards.map((b) => (
          <section key={b.name} className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
            <h2 className="px-1 text-sm font-black uppercase tracking-wider text-slate-500">{b.name}</h2>
            <svg viewBox={`0 0 ${PANEL_W} ${PANEL_H}`} className="mt-2 w-full" style={{ fontFamily: "Nunito, Outfit, sans-serif" }}>
              <CanvasPanel layout={b.layout} spec={b.spec} shownThrough={Infinity} sentenceProgress={1} live={false} vars={{}} carryFrom={{}} reducedMotion theme="paper" />
            </svg>
            <details className="mt-2 px-1 text-xs text-slate-600">
              <summary className="cursor-pointer font-bold">What Aria can set</summary>
              <p className="mt-1">{b.params}</p>
            </details>
          </section>
        ))}
      </div>
    </div></main>
  );
}

"use client";

import { useMemo } from "react";
import katex from "katex";
import "katex/dist/katex.min.css";
import type { EquationSpec } from "@/lib/equationSpec";

/**
 * A derivation, revealed a line at a time against the beat's narration progress.
 *
 * Deliberately NOT an SVG board. Every other renderer here draws; this one TYPESETS, because a
 * derivation is read rather than looked at. Trying to express one as shapes is what produced the
 * boards where "3² + 4² = c²" was literal glyphs pushed around a canvas — the maths rendered as
 * decoration instead of as maths.
 *
 * KaTeX rather than MathJax: 2-3× faster, a far smaller bundle, and — the reason it belongs in
 * this pipeline — it can be asked to THROW on bad input, so lib/equationSpec.ts can guarantee that
 * anything which validates is renderable. Its limits are real and worth knowing: a narrower LaTeX
 * subset, and no MathML output, so screen readers get nothing from it. For a disability-focused
 * product that is a debt, not a detail.
 *
 * Each step also carries WHY it follows from the one above. That is the part a picture of an
 * equation always loses, and the part a student actually needs.
 */
export function EquationBoard({ spec, progress = 0 }: { spec: EquationSpec; progress?: number }) {
  // Typeset once. Every string was already vetted by validateEquationSpec with throwOnError, so
  // throwOnError:false here is a formality rather than a way of quietly rendering broken maths.
  const html = useMemo(
    () => spec.steps.map((s) => katex.renderToString(s.tex, { throwOnError: false, displayMode: true })),
    [spec],
  );

  // Steps share the timeline evenly, with a short lead-in so the first line is not present at 0.
  const shown = Math.floor(Math.max(0, Math.min(1, progress)) * (spec.steps.length + 0.4));

  return (
    <section
      data-board="equation"
      className="h-full w-full overflow-auto rounded-xl border border-slate-200 bg-white p-5 text-slate-900"
    >
      {spec.title && <h3 className="mb-4 text-center text-lg font-black text-slate-800">{spec.title}</h3>}
      <ol className="space-y-4">
        {spec.steps.map((step, i) => (
          <li
            key={i}
            data-step={i}
            className="transition-opacity duration-300"
            // Past steps STAY. A derivation whose earlier lines vanish cannot be checked against
            // itself, and the accumulating board is the whole reason this reads better than
            // narration alone.
            style={{ opacity: i < shown ? 1 : 0.08 }}
          >
            <div className="flex items-baseline gap-3">
              <span className="w-5 shrink-0 text-right text-xs font-bold text-slate-400">{i + 1}</span>
              <div className="flex-1" dangerouslySetInnerHTML={{ __html: html[i] }} />
            </div>
            {step.why && <p className="ml-8 mt-1 text-xs font-semibold italic text-amber-700">{step.why}</p>}
          </li>
        ))}
      </ol>
    </section>
  );
}

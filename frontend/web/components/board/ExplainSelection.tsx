"use client";

import { useEffect, useMemo, useState } from "react";
import { Sparkles, X } from "lucide-react";

import type { AnnotationStroke } from "@/lib/board/annotations";
import { contentBox } from "@/lib/board/geometry";
import { boundsOf, buildExplainRequest, recentSelection } from "@/lib/board/selection";

/**
 * "EXPLAIN THIS" — the action that appears where the student just marked.
 *
 * The old behaviour was invisible and automatic: 900ms after the pen lifted, the WHOLE board was
 * posted to the model with `describeOnly: true`, and the description was quietly folded into the
 * tutor's context. The student was never told it happened, never asked for it, and never got an
 * answer — so the single most natural question in a lesson ("what is THAT?") had no affordance at
 * all, and the feature that existed instead spent a model call on every stray stroke.
 *
 * Here the student marks something and a button appears at the mark. It names what it will explain
 * — the board's own words when they were captured, so "Explain 'squared residuals'" rather than a
 * generic label — because a button that says what it will do is the difference between an obvious
 * action and a gamble.
 *
 * It is anchored to the SELECTION, in board space, so it sits beside what was marked at any window
 * size, and it flips above or below the mark to avoid covering it. Controls must not obscure the
 * teaching content, least of all the part the student is asking about.
 */
export function ExplainSelection({
  strokes,
  conceptTitle,
  currentSentence,
  onExplain,
  onDismiss,
  busy,
}: {
  strokes: AnnotationStroke[];
  conceptTitle?: string;
  currentSentence?: string;
  /** Ask the tutor. Receives the fully-built question and the region to crop. */
  onExplain: (request: NonNullable<ReturnType<typeof buildExplainRequest>>) => void;
  onDismiss: () => void;
  busy?: boolean;
}) {
  const [box, setBox] = useState<{ width: number; height: number } | null>(null);

  // The anchor is in board space; converting it needs the live pixel size of the stage.
  useEffect(() => {
    const measure = () => {
      const stage = document.querySelector('[aria-label="Teaching board"]') as HTMLElement | null;
      if (!stage) return;
      const rect = stage.getBoundingClientRect();
      setBox({ width: rect.width, height: rect.height });
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [strokes.length]);

  const request = useMemo(
    () => buildExplainRequest(strokes, { conceptTitle, currentSentence }),
    [strokes, conceptTitle, currentSentence],
  );

  const anchor = useMemo(() => {
    const selection = recentSelection(strokes);
    return boundsOf(selection);
  }, [strokes]);

  if (!request || !anchor || !box) return null;

  const content = contentBox(box.width, box.height);
  const centreX = content.x + (anchor.x + anchor.width / 2) * content.width;
  /*
   * `anchor` is the PADDED crop (see PADDING in lib/board/selection.ts), which extends well past
   * the ink. Offsetting from it put the button inside the padding and straight on top of the words
   * the student had just underlined — the one thing this must never cover, since it is what they
   * are asking about. Measured from the raw stroke extent instead, with a full button-height gap.
   */
  const inkYs = strokes.flatMap((stroke) => stroke.points.map((point) => point.y));
  const inkTop = content.y + Math.min(...inkYs) * content.height;
  const inkBottom = content.y + Math.max(...inkYs) * content.height;
  const BUTTON_H = 44;
  const GAP = 16;
  // Prefer above the ink; drop below when there is not room for the whole button plus its gap.
  const above = inkTop - (BUTTON_H + GAP) > 8;
  const top = above ? inkTop - (BUTTON_H + GAP) : inkBottom + GAP;

  const label = request.selectedText
    ? `Explain “${request.selectedText.length > 36 ? `${request.selectedText.slice(0, 36)}…` : request.selectedText}”`
    : "Explain this";

  return (
    <div
      className="pointer-events-none absolute inset-0 z-30"
      // The layer is inert; only the button inside it takes pointer events, so marking continues
      // to work underneath while the offer is on screen.
      aria-live="polite"
    >
      <div
        className="pointer-events-auto absolute flex -translate-x-1/2 items-center gap-1 rounded-full border border-amber-300/30 bg-[#12151c]/95 p-1 pl-1.5 shadow-2xl backdrop-blur-xl"
        style={{ left: Math.max(96, Math.min(box.width - 96, centreX)), top: Math.max(8, top) }}
      >
        <button
          onClick={() => onExplain(request)}
          disabled={busy}
          className="flex h-9 items-center gap-2 rounded-full bg-amber-300 px-3.5 text-[0.84rem] font-semibold text-[#12151c] transition hover:bg-amber-200 disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-300"
        >
          <Sparkles size={15} />
          <span className="max-w-[22ch] truncate">{busy ? "Asking Aria…" : label}</span>
        </button>
        <button
          onClick={onDismiss}
          aria-label="Dismiss"
          className="flex h-9 w-8 items-center justify-center rounded-full text-white/45 transition hover:bg-white/10 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-300"
        >
          <X size={15} />
        </button>
      </div>
    </div>
  );
}

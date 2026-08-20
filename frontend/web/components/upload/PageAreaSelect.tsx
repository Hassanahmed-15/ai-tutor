"use client";

import { useRef, useState } from "react";
import type { NormalisedRect } from "@/components/upload/PageSelector";

/**
 * Drag a rectangle over the page preview to say "explain THIS bit".
 *
 * WHERE THIS LIVES IS THE POINT. The first version put the entry behind a small "Select an area"
 * link under a grid thumbnail, and the answer to "where do I select a portion?" was: nowhere you
 * could see — the link sat below the fold of a scrolling grid of 150px tiles. Meanwhile the upload
 * screen already showed the selected page LARGE in the next pane over, which is both where the
 * student is looking and the only size at which you can aim at a formula. So the preview is the
 * control now, and there is no entry point to find.
 *
 * The rectangle is reported NORMALISED (0-1). This image is whatever size the viewport allows, and
 * the server crops a full-resolution render of the same page, so pixels measured here would mean
 * nothing there.
 */
export function PageAreaSelect({
  src,
  alt,
  rect,
  onChange,
}: {
  src: string;
  alt: string;
  rect: NormalisedRect | undefined;
  onChange: (rect: NormalisedRect | undefined) => void;
}) {
  const imageRef = useRef<HTMLImageElement>(null);
  const [dragFrom, setDragFrom] = useState<{ x: number; y: number } | null>(null);
  const [draft, setDraft] = useState<NormalisedRect | null>(null);

  const shown = draft ?? rect;

  /** Where a pointer sits within the image, 0-1, clamped so a drag past the edge still tracks. */
  function pointIn(event: React.PointerEvent): { x: number; y: number } | null {
    const box = imageRef.current?.getBoundingClientRect();
    if (!box || box.width === 0 || box.height === 0) return null;
    return {
      x: Math.min(1, Math.max(0, (event.clientX - box.left) / box.width)),
      y: Math.min(1, Math.max(0, (event.clientY - box.top) / box.height)),
    };
  }

  /** Normalised as it is built, so a drag in any direction yields a positive box. */
  function boxBetween(a: { x: number; y: number }, b: { x: number; y: number }): NormalisedRect {
    return {
      x: Math.min(a.x, b.x),
      y: Math.min(a.y, b.y),
      width: Math.abs(b.x - a.x),
      height: Math.abs(b.y - a.y),
    };
  }

  return (
    <div className="flex h-full min-h-0 w-full flex-col items-center justify-center gap-2">
      <div className="relative min-h-0">
        {/* eslint-disable-next-line @next/next/no-img-element -- a data: URI has no remote host to
            optimise and next/image would only add overhead here. */}
        <img
          ref={imageRef}
          src={src}
          alt={alt}
          draggable={false}
          data-page-area-image
          className="max-h-full max-w-full select-none rounded-[var(--radius)] border bg-white object-contain"
          style={{ borderColor: "var(--hud-line)", touchAction: "none", cursor: "crosshair" }}
          onPointerDown={(event) => {
            const at = pointIn(event);
            if (!at) return;
            event.currentTarget.setPointerCapture(event.pointerId);
            setDragFrom(at);
            setDraft({ x: at.x, y: at.y, width: 0, height: 0 });
          }}
          onPointerMove={(event) => {
            if (!dragFrom) return;
            const at = pointIn(event);
            if (at) setDraft(boxBetween(dragFrom, at));
          }}
          onPointerUp={(event) => {
            if (!dragFrom) return;
            const at = pointIn(event) ?? dragFrom;
            const box = boxBetween(dragFrom, at);
            setDragFrom(null);
            setDraft(null);
            // A click, or a flick of a few pixels, is not a selection — and treating one as a region
            // would crop a sliver and transcribe nothing. Clicking clears instead, which is what a
            // click on a selection is usually meant to do.
            onChange(box.width >= 0.02 && box.height >= 0.02 ? box : undefined);
          }}
        />

        {shown && (
          <span
            aria-hidden="true"
            data-page-area-rect
            className="pointer-events-none absolute border-2"
            style={{
              borderColor: "var(--hud-cyan)",
              background: "color-mix(in srgb, var(--hud-cyan) 14%, transparent)",
              left: `${shown.x * 100}%`,
              top: `${shown.y * 100}%`,
              width: `${shown.width * 100}%`,
              height: `${shown.height * 100}%`,
            }}
          />
        )}
      </div>

      {/* Said out loud, because a draggable image looks exactly like an undraggable one. */}
      <p className="text-center text-[0.75rem]" style={{ color: "var(--hud-text-faint)" }}>
        {rect ? (
          <>
            Aria will read just this area.{" "}
            <button
              type="button"
              data-clear-area
              onClick={() => onChange(undefined)}
              className="underline underline-offset-2"
              style={{ color: "var(--hud-text-dim)" }}
            >
              Use the whole page
            </button>
          </>
        ) : (
          "Drag across the page to have Aria explain just that part — a formula, a table, a figure."
        )}
      </p>
    </div>
  );
}

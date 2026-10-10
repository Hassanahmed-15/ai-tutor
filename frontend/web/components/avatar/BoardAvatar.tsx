"use client";

import { useLayoutEffect, useRef, useState, type RefObject } from "react";
import { AriaAvatar } from "./AriaAvatar";
import type { AvatarState } from "@/lib/avatar/face";

/**
 * ARIA AT THE BOARD. Not a video tile in a box: her bust as a cutout, standing at the lower right of
 * the board like a teacher at the edge of her slide, a soft light behind her when she speaks. Pointer
 * events pass through, so nothing under her is lost.
 *
 * She never covers a question, asked or answered:
 *  - "beside-panel": the questions panel is open. She stands just left of it, measured from its own
 *    edge, so the conversation and its input box are never under her (a column on a wide screen, a
 *    sheet over the board's edge on a narrower one; both are measured, neither is assumed).
 *  - "pip": a question is on the board (a checkpoint, a quiz) or she is drawing an answer there. She
 *    steps back to a small picture in the board's top-right corner, which those never use, and
 *    returns when it is done.
 * The one instance moves and resizes; it is never remounted (her head takes seconds to load).
 */
export type BoardAvatarMode = "board" | "beside-panel" | "pip";

export function BoardAvatar({
  state,
  mode,
  board,
  panel,
  onUnavailable,
}: {
  state: AvatarState;
  mode: BoardAvatarMode;
  /** The teaching board's element. */
  board: RefObject<HTMLElement | null>;
  /** The questions panel's element, when it is open. */
  panel: RefObject<HTMLElement | null>;
  onUnavailable?: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState<{ right: number; top?: number } | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const parent = (el.offsetParent as HTMLElement | null)?.getBoundingClientRect();
      if (!parent) return;
      const p = panel.current?.getBoundingClientRect();
      const panelLeft = p && p.width > 0 ? p.left : Infinity;
      if (mode === "beside-panel" && panelLeft < Infinity) {
        setPlace({ right: Math.max(8, parent.right - panelLeft + 12) });
        return;
      }
      const b = board.current?.getBoundingClientRect();
      if (mode === "pip" && b) {
        // The board's top-right corner, or the part of it the panel does not cover.
        const edge = Math.min(b.right, panelLeft - 6);
        setPlace({ right: Math.max(8, parent.right - edge + 10), top: Math.max(8, b.top - parent.top + 10) });
        return;
      }
      setPlace(null);
    };
    measure();
    // The panel slides in over ~300 ms: measure again once it has arrived.
    const late = window.setTimeout(measure, 380);
    const ro = new ResizeObserver(measure);
    for (const n of [el.offsetParent, board.current, panel.current]) if (n) ro.observe(n as Element);
    window.addEventListener("resize", measure);
    return () => {
      window.clearTimeout(late);
      ro.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [mode, board, panel]);

  const small = mode === "pip";
  return (
    <div
      ref={ref}
      className={`pointer-events-none absolute z-30 hidden transition-[right,top,bottom] duration-500 ease-out md:block ${place ? "" : "bottom-[4.75rem] right-2 lg:right-4"}`}
      style={place ? { right: place.right, ...(place.top !== undefined ? { top: place.top } : { bottom: "4.75rem" }) } : undefined}
    >
      <div
        aria-hidden="true"
        className={`absolute left-1/2 top-[58%] -z-10 -translate-x-1/2 -translate-y-1/2 rounded-full transition-[opacity,width,height] duration-500 ${small ? "size-[8rem]" : "size-[16rem]"}`}
        style={{ background: "radial-gradient(circle, var(--hud-cyan-glow) 0%, rgba(0,0,0,0) 68%)", opacity: state === "speaking" ? 1 : state === "listening" ? 0.55 : 0.25 }}
      />
      <AriaAvatar
        state={state}
        transparent
        className={`transition-[width,height] duration-500 ease-out ${small ? "h-[9.5rem] w-[7.5rem]" : "h-[19rem] w-[15rem] lg:h-[21rem] lg:w-[16.5rem]"}`}
        onUnavailable={onUnavailable}
      />
    </div>
  );
}

"use client";

import { useLayoutEffect, useRef, useState, type RefObject } from "react";
import { AriaAvatar } from "./AriaAvatar";
import type { AvatarState } from "@/lib/avatar/face";

/**
 * ARIA MOVES BETWEEN PLACES; SHE IS NEVER REMOUNTED. Her head takes ~10 s to load, so there is one
 * instance, positioned over the player and flown to whichever SLOT is hers right now: large and
 * centred on the section card when a part begins, her own column beside the board while it is
 * drawn, the top of the questions sheet when it opens. A slot is an empty element in the normal
 * layout; this measures it and eases to its rectangle, so layout changes (a sheet opening, a
 * resize) move her with everything else.
 *
 * Several candidate slots may be given: the first with a size wins. That is how one place has
 * two layouts, a column on a wide screen and a corner on a narrow one, without JS media queries.
 */
export function AvatarFlyer({
  slots,
  place,
  state,
  within,
  onUnavailable,
}: {
  /** Candidate slot elements for the current place, in order of preference. */
  slots: RefObject<HTMLElement | null>[];
  /** A key naming the place, so a change re-measures even when the refs are the same objects. */
  place: string;
  state: AvatarState;
  /** The positioned ancestor the flyer lives in. */
  within: RefObject<HTMLElement | null>;
  onUnavailable?: () => void;
}) {
  const [box, setBox] = useState<{ left: number; top: number; width: number; height: number } | null>(null);
  const settled = useRef(false);
  // Once the head renders, the flyer gets its own compositing layer. Without this, over a board
  // with a backdrop-filter overlay, the canvas could stay invisible until something re-composited.
  const [ready, setReady] = useState(false);

  useLayoutEffect(() => {
    const host = within.current;
    if (!host) return;
    const measure = () => {
      const base = host.getBoundingClientRect();
      for (const ref of slots) {
        const el = ref.current;
        if (!el) continue;
        const r = el.getBoundingClientRect();
        if (r.width < 8 || r.height < 8) continue;
        setBox({ left: r.left - base.left, top: r.top - base.top, width: r.width, height: r.height });
        return;
      }
      setBox(null);
    };
    measure();
    // The sheet slides in over ~300 ms; measure again once it has arrived. And once a second
    // after that: slots mount and unmount with the lesson, and a cheap re-measure is surer
    // than naming every reason they might.
    const late = window.setTimeout(measure, 350);
    const tick = window.setInterval(measure, 1000);
    const ro = new ResizeObserver(measure);
    ro.observe(host);
    for (const ref of slots) if (ref.current) ro.observe(ref.current);
    window.addEventListener("resize", measure);
    return () => {
      window.clearTimeout(late);
      window.clearInterval(tick);
      ro.disconnect();
      window.removeEventListener("resize", measure);
    };
    // Slots are stable refs; the place key says when the set changed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [place, within]);

  // The first placement is immediate; after that, every move eases.
  useLayoutEffect(() => {
    if (box) settled.current = true;
  }, [box]);

  const glow = state === "speaking" ? 1 : state === "listening" ? 0.55 : 0.25;
  // z-60: above the board's own overlays (its pre-start dim, the section card) and the questions
  // sheet (z-40), below the check-in and other modal surfaces (z-80).
  return (
    <div
      aria-hidden={box ? undefined : true}
      className="pointer-events-none absolute isolate z-[60]"
      style={{
        left: box?.left ?? 0,
        top: box?.top ?? 0,
        width: box?.width ?? 0,
        height: box?.height ?? 0,
        opacity: box ? 1 : 0,
        transform: ready ? "translateZ(0)" : undefined,
        transition: settled.current ? "left 650ms cubic-bezier(.2,.8,.2,1), top 650ms cubic-bezier(.2,.8,.2,1), width 650ms cubic-bezier(.2,.8,.2,1), height 650ms cubic-bezier(.2,.8,.2,1), opacity 300ms" : "opacity 300ms",
      }}
    >
      <div
        aria-hidden="true"
        className="absolute left-1/2 top-[58%] -z-10 aspect-square w-[110%] -translate-x-1/2 -translate-y-1/2 rounded-full transition-opacity duration-500"
        style={{ background: "radial-gradient(circle, var(--hud-cyan-glow) 0%, rgba(0,0,0,0) 68%)", opacity: glow }}
      />
      {/* The bust fades from the shoulders down: the head bundle has a dark plate behind the torso
          that would otherwise show as a rectangle over a light board. (Headless Chromium on
          SwiftShader cannot composite a masked WebGL canvas, so screenshots there need the GPU:
          `--use-angle=metal`. Real browsers are fine.) */}
      <AriaAvatar state={state} transparent className="h-full w-full [mask-image:linear-gradient(to_bottom,black_68%,transparent_94%)]" onReady={() => setReady(true)} onUnavailable={onUnavailable} />
    </div>
  );
}

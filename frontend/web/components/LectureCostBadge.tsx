"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  COST_STREAM_LABELS,
  EMPTY_COST_LEDGER,
  getCostLedger,
  subscribeCostLedger,
  type CostStream,
} from "@/lib/costLedger";

/**
 * The cost of the lecture on screen, at the top of it: one total, and what it is made of.
 *
 * It used to show generation alone, labelled "excludes document & playback" — honest about its
 * scope, but not the cost of the lecture. Every stream that spends money now reports what it
 * measured (see lib/costLedger.ts), so the total is the lecture's, and it keeps rising as narration
 * plays and questions are asked, because that is when that money is spent.
 *
 * What it will not do is round unmeasured spend down to zero: calls that returned no usage to price
 * are counted and shown as "unpriced", so the figure never claims to be more complete than it is.
 */
const ORDER: CostStream[] = ["document", "planning", "generation", "narration", "questions", "liveTutor"];

export function LectureCostBadge({
  reused = false,
  demo = false,
  generating = false,
}: {
  /** Served from the lecture cache: no generation spend for this build. */
  reused?: boolean;
  demo?: boolean;
  /** Generation is still running, so its figure is a running total. */
  generating?: boolean;
}) {
  const ledger = useSyncExternalStore(subscribeCostLedger, getCostLedger, () => EMPTY_COST_LEDGER);
  const ref = useRef<HTMLDivElement>(null);
  const [top, setTop] = useState(8);

  /*
   * Sit just BELOW the player's header, not in it. The header row is full (title, speaking and
   * activity pills, controls) and wraps onto more rows as the screen narrows, so no fixed offset is
   * right: at 1400px it is one row, on a phone it is three, and a fixed offset put the badge over
   * the Pause button. So measure the header this badge shares a wrapper with, and follow it.
   */
  useEffect(() => {
    const host = ref.current?.parentElement;
    const header = host?.querySelector("header");
    if (!host || !header) return;
    const place = () => {
      const offset = header.getBoundingClientRect().bottom - host.getBoundingClientRect().top;
      setTop(Math.max(8, Math.round(offset) + 6));
    };
    place();
    const observer = new ResizeObserver(place);
    observer.observe(header);
    return () => observer.disconnect();
  }, []);

  const parts = ORDER.filter((stream) => ledger.lines[stream].usd > 0);

  return (
    <div ref={ref} style={{ top }} className="pointer-events-none absolute left-0 right-0 z-[60] flex justify-end px-4 sm:justify-center">
      <div
        className="hud-eyebrow flex max-w-full flex-wrap items-center justify-center gap-x-1.5 gap-y-0.5 rounded-full border border-[var(--hud-line-strong)] bg-black/70 px-3.5 py-1.5 text-[0.65rem] backdrop-blur-md"
        title="Measured from the usage each provider returned. Rises as narration plays and questions are asked."
      >
        <span className="text-[var(--hud-text-faint)] normal-case tracking-normal font-semibold">
          {demo ? "Demo lecture" : "This lecture"}
        </span>
        <span className="text-[var(--hud-cyan)]">${ledger.totalUsd.toFixed(4)}</span>
        {/* A phone has room for the total only; the breakdown would cover the board chip. */}
        {parts.length > 0 && (
          <span className="hidden text-[var(--hud-text-faint)] normal-case tracking-normal opacity-70 sm:inline">
            {parts
              .map((stream) => `${COST_STREAM_LABELS[stream]} $${ledger.lines[stream].usd.toFixed(4)}`)
              .join(" · ")}
          </span>
        )}
        {reused && (
          <span className="text-[var(--hud-text-faint)] normal-case tracking-normal opacity-70">· reused, no generation cost</span>
        )}
        {generating && (
          <span className="text-[var(--hud-text-faint)] normal-case tracking-normal opacity-70">· still generating</span>
        )}
        {ledger.unpriced > 0 && (
          <span className="text-amber-300/80 normal-case tracking-normal">
            + {ledger.unpriced} unpriced call{ledger.unpriced === 1 ? "" : "s"}
          </span>
        )}
      </div>
    </div>
  );
}

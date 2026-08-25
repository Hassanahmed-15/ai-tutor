"use client";

import { useEffect, useState } from "react";
import { onAdhdScore, type AdhdScoreSnapshot } from "@/lib/adhd/events";

/**
 * The score, rendered in the lesson header.
 *
 * It lives here rather than in `AdhdLayer` because the header is the only place it can be a LAID OUT
 * element instead of an overlay. The previous version was absolutely positioned over the board and
 * clipped the frame at every viewport size — the fix is not a better offset, it is being part of the
 * layout at all.
 */
export function AdhdScoreChip() {
  const [s, setS] = useState<AdhdScoreSnapshot | null>(null);
  useEffect(() => onAdhdScore(setS), []);
  if (!s) return null;

  return (
    <div className="flex shrink-0 items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5">
      {/* tabular-nums so a rising score does not shuffle the chip's width on every beat */}
      <span className="text-[0.72rem] font-black tabular-nums text-amber-300">{s.xp} XP</span>
      {s.streak > 0 && (
        <span className="text-[0.72rem] font-black tabular-nums text-white/55">{s.combo.toFixed(1)}×</span>
      )}
      <span className="text-[0.72rem] font-black tabular-nums text-teal-300">{s.coins}c</span>
      {s.cards > 0 && <span className="text-[0.72rem] font-black tabular-nums text-white/40">{s.cards}🃏</span>}
      {s.locked && (
        <span className="flex items-center gap-1 rounded-full bg-emerald-400/15 px-2 py-0.5 text-[0.66rem] font-black text-emerald-200">
          <span className="size-1.5 rounded-full bg-emerald-300" />
          {s.lockedMins >= 1 ? `${s.lockedMins}m` : "focused"}
        </span>
      )}
    </div>
  );
}

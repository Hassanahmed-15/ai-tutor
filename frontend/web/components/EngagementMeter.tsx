"use client";

import type { useEngagementScore } from "@/lib/useEngagementScore";

/**
 * Live engagement rate, ALWAYS shown. Blends the on-device camera signal (when the student granted
 * it) with behavioural signals — questions asked, checkpoint misses, drift, idle time — so it still
 * reports a real number with the camera off. The trailing tag says which inputs are feeding it, so
 * the number is never a black box.
 */
export function EngagementMeter({
  engagement,
  accent = "bg-accent-adhd",
}: {
  engagement: ReturnType<typeof useEngagementScore>;
  /** Tailwind bg class for the "healthy" state, so each track can use its own accent. */
  accent?: string;
}) {
  const { rate, low, usingCamera, reason } = engagement;
  const tone = low ? "bg-amber-400" : rate >= 70 ? accent : "bg-sky-400";
  return (
    <div
      className="flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3 py-1.5"
      title={`Engagement ${rate}% — ${reason}. ${
        usingCamera
          ? "Camera + activity signals (camera runs on-device, never uploaded)."
          : "Based on your activity (camera off)."
      }`}
    >
      <span className={`size-2 rounded-full ${tone}`} />
      <span className="text-xs font-black tabular-nums text-white/75">{rate}%</span>
      <span className="h-1.5 w-12 overflow-hidden rounded-full bg-white/10">
        <span className={`block h-full rounded-full transition-all duration-700 ${tone}`} style={{ width: `${Math.max(4, rate)}%` }} />
      </span>
      <span className="hidden text-[10px] font-bold uppercase tracking-wider text-white/35 sm:inline">
        {usingCamera ? "cam+activity" : "activity"}
      </span>
    </div>
  );
}

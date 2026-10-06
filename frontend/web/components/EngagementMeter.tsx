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
  const tone = low ? "bg-[var(--hud-cyan)]" : rate >= 70 ? accent : "bg-[var(--hud-cyan)]";
  return (
    <div
      className="flex items-center gap-2 rounded-full border border-[var(--hud-line)] bg-[var(--hud-surface)] px-3 py-1.5"
      title={`Engagement ${rate}% — ${reason}. ${
        usingCamera
          ? "Camera + activity signals (camera runs on-device, never uploaded)."
          : "Based on your activity (camera off)."
      }`}
    >
      <span className={`size-2 rounded-full ${tone}`} />
      <span className="text-xs font-black tabular-nums text-[var(--hud-text-dim)]">{rate}%</span>
      <span className="h-1.5 w-12 overflow-hidden rounded-full bg-[var(--hud-surface-2)]">
        <span className={`block h-full rounded-full transition-all duration-700 ${tone}`} style={{ width: `${Math.max(4, rate)}%` }} />
      </span>
      <span className="hidden text-[10px] font-bold uppercase tracking-wider text-[var(--hud-text-dim)] sm:inline">
        {usingCamera ? "cam+activity" : "activity"}
      </span>
    </div>
  );
}

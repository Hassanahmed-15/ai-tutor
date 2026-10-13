"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/components/auth/AuthGate";
import { onSpendStatus, startSpendReporter, stopSpendReporter } from "@/lib/spendReporter";
import type { SpendStatus } from "@/lib/spendTracking";

/**
 * TODAY'S AI SPEND, for the accounts lib/spendTracking.ts tracks (Hassan's and Minahil's) — and a
 * warning once the day passes the limit ($2.50). Everyone else sees nothing: the server answers
 * `{ tracked: false }` and nothing is reported.
 *
 * A small pill at the top centre of every page (the corners hold the lecture header and its dock):
 * neutral below 80% of the limit, amber from 80%, red over it — and over it, a banner once a day
 * that can be dismissed. Warning only: nothing is blocked.
 */
export function DailySpendBadge() {
  const { user } = useAuth();
  const [status, setStatus] = useState<SpendStatus | null>(null);
  // The day whose warning was dismissed, remembered per browser.
  const [dismissedDay, setDismissedDay] = useState<string | null>(() => {
    try {
      return typeof window === "undefined" ? null : localStorage.getItem("aria.spendWarningDismissed");
    } catch {
      return null;
    }
  });

  useEffect(() => {
    if (!user) return;
    let alive = true;
    const off = onSpendStatus((next) => alive && setStatus(next));
    void fetch("/api/spend")
      .then((res) => (res.ok ? (res.json() as Promise<SpendStatus>) : null))
      .then((next) => {
        if (!alive || !next) return;
        setStatus(next);
        if (next.tracked) startSpendReporter();
      })
      .catch(() => {});
    return () => {
      alive = false;
      off();
      stopSpendReporter();
    };
  }, [user]);

  if (!user || !status?.tracked) return null;
  const share = status.limitUsd > 0 ? status.spentUsd / status.limitUsd : 0;
  const tone = status.over
    ? "border-red-500/60 bg-red-600/90 text-white"
    : share >= 0.8
      ? "border-amber-400/60 bg-amber-400/90 text-black"
      : "border-[var(--hud-line)] bg-[var(--hud-surface)]/90 text-[var(--hud-text-dim)]";
  const showBanner = status.over && dismissedDay !== status.day;

  return (
    <>
      {/* A thin tab hanging from the top edge, above every page's header rather than over it. */}
      <div className="pointer-events-none fixed inset-x-0 top-0 z-[70] flex justify-center">
        <div
          className={`pointer-events-auto rounded-b-lg border border-t-0 px-2.5 py-px text-[0.65rem] font-semibold leading-4 shadow backdrop-blur ${tone}`}
          title="Today's AI spend for this account (resets at midnight Pakistan time)"
          data-daily-spend
        >
          Today&apos;s AI spend: ${status.spentUsd.toFixed(2)} / ${status.limitUsd.toFixed(2)}
        </div>
      </div>
      {showBanner && (
        <div className="pointer-events-none fixed inset-x-0 bottom-24 z-[70] flex justify-center px-4">
        <div role="alert" className="pointer-events-auto flex max-w-md items-start gap-3 rounded-xl border border-red-500/60 bg-red-600 px-4 py-3 text-sm text-white shadow-lg">
          <p className="flex-1">
            You&apos;ve spent <b>${status.spentUsd.toFixed(2)}</b> on AI today — over your <b>${status.limitUsd.toFixed(2)}</b> daily limit.
          </p>
          <button
            type="button"
            onClick={() => {
              setDismissedDay(status.day);
              try {
                localStorage.setItem("aria.spendWarningDismissed", status.day);
              } catch {
                /* not remembered */
              }
            }}
            className="shrink-0 rounded-md bg-white/15 px-2 py-0.5 text-xs font-bold hover:bg-white/25"
          >
            OK
          </button>
        </div>
        </div>
      )}
    </>
  );
}

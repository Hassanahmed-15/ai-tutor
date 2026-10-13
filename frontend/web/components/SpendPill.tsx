"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useAuth } from "@/components/auth/AuthGate";
import type { SpendKind } from "@/lib/spend/usage";
import type { SpendStatus } from "@/lib/spendTracking";

/**
 * TODAY'S AI SPEND, beside the profile button on the main page — for the accounts lib/spendTracking.ts
 * tracks (Hassan's and Minahil's) and nobody else: the server answers `{ tracked: false }` for every
 * other account and the pill renders nothing.
 *
 * The figures are the server's spend log (lib/spend): every paid AI call, priced as it is made and
 * filed under the account it was for. The pill shows the day's total; hovering, focusing or tapping
 * it opens where it went — by part of the app and by model — and the whole app's total.
 *
 * Neutral below 80% of the daily limit ($2.50), amber from 80%, red over it — and over it, a warning
 * once a day that can be dismissed. Warning only: nothing is blocked. The day turns at midnight
 * Pakistan time.
 */

const REFRESH_EVERY_MS = 15_000;
const DISMISSED_KEY = "aria.spendWarningDismissed";

const KIND_LABELS: Record<SpendKind, string> = {
  planning: "Planning",
  generation: "Board writing & animation",
  pictures: "Pictures",
  narration: "Narration voice",
  questions: "Questions & drawings",
  document: "Reading the PDF",
  video: "Reading the video",
  voice: "Live voice",
  personal: "Personalisation",
  other: "Other",
};

export function SpendPill() {
  const { user } = useAuth();
  const [status, setStatus] = useState<SpendStatus | null>(null);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  // The day whose warning was dismissed, remembered per browser.
  const [dismissedDay, setDismissedDay] = useState<string | null>(() => {
    try {
      return typeof window === "undefined" ? null : localStorage.getItem(DISMISSED_KEY);
    } catch {
      return null;
    }
  });

  // Read on arrival, then keep fresh while the page is in view.
  useEffect(() => {
    if (!user) return;
    let alive = true;
    const load = async () => {
      try {
        const res = await fetch("/api/spend", { cache: "no-store" });
        if (!res.ok) return;
        const next = (await res.json()) as SpendStatus;
        if (alive) setStatus(next);
      } catch {
        // Keep the last figure.
      }
    };
    void load();
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, REFRESH_EVERY_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") void load();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      alive = false;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [user]);

  // A tapped-open breakdown closes on a tap elsewhere or Escape.
  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointer);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!user || !status?.tracked) return null;
  const share = status.limitUsd > 0 ? status.spentUsd / status.limitUsd : 0;
  const tone = status.over
    ? "border-[var(--danger)] bg-[var(--danger-soft)] text-[var(--danger)]"
    : share >= 0.8
      ? "border-[var(--warning)] bg-[var(--warning-soft)] text-[var(--warning)]"
      : "border-[var(--hud-line)] bg-[var(--hud-surface)] text-[var(--hud-text-dim)] hover:border-[var(--hud-line-strong)]";
  const breakdown = status.breakdown;
  const parts = breakdown
    ? Object.entries(breakdown.byKind)
        .map(([kind, usd]) => ({ label: KIND_LABELS[kind as SpendKind] ?? kind, usd: usd ?? 0 }))
        .filter((p) => p.usd > 0)
        .sort((a, b) => b.usd - a.usd)
    : [];
  const models = breakdown ? Object.entries(breakdown.byModel).filter(([, usd]) => usd > 0).sort((a, b) => b[1] - a[1]) : [];
  const showWarning = status.over && dismissedDay !== status.day;

  return (
    <>
      <div ref={rootRef} className="group relative" data-spend-pill>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-label={`Today's AI spend: $${status.spentUsd.toFixed(2)} of $${status.limitUsd.toFixed(2)}`}
          className={`flex h-8 items-center rounded-full border px-3 text-[0.8125rem] font-medium tabular-nums transition-colors ${tone}`}
        >
          ${status.spentUsd.toFixed(2)} today
        </button>
        <div
          role="region"
          aria-label="Where today's AI spend went"
          className={`absolute right-0 top-full z-[80] mt-2 w-72 rounded-[var(--radius)] border border-[var(--hud-line)] bg-[var(--hud-surface)] p-3 text-[0.75rem] leading-snug text-[var(--hud-text)] shadow-lg transition group-focus-within:visible group-focus-within:opacity-100 group-hover:visible group-hover:opacity-100 ${
            open ? "visible opacity-100" : "invisible opacity-0"
          }`}
        >
          <p className="flex justify-between gap-3 font-semibold">
            <span>Today</span>
            <span className="tabular-nums">
              ${status.spentUsd.toFixed(4)} <span className="font-normal text-[var(--hud-text-dim)]">of ${status.limitUsd.toFixed(2)}</span>
            </span>
          </p>
          {parts.length > 0 ? (
            <ul className="mt-1.5 space-y-0.5">
              {parts.map((part) => (
                <li key={part.label} className="flex justify-between gap-3">
                  <span className="truncate text-[var(--hud-text-dim)]">{part.label}</span>
                  <span className="tabular-nums">${part.usd.toFixed(3)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-1 text-[var(--hud-text-dim)]">Nothing spent yet today.</p>
          )}
          {models.length > 0 && (
            <div className="mt-2 border-t border-[var(--hud-line)] pt-2">
              <p className="font-semibold text-[var(--hud-text-dim)]">By model</p>
              <ul className="mt-1 space-y-0.5">
                {models.map(([model, usd]) => (
                  <li key={model} className="flex justify-between gap-3">
                    <span className="truncate text-[var(--hud-text-dim)]">{model}</span>
                    <span className="tabular-nums">${usd.toFixed(4)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {breakdown && breakdown.unpriced > 0 && (
            <p className="mt-1 text-[var(--warning)]">
              +{breakdown.unpriced} unpriced call{breakdown.unpriced === 1 ? "" : "s"}
            </p>
          )}
          {typeof status.appUsd === "number" && (
            <p className="mt-2 flex justify-between gap-3 border-t border-[var(--hud-line)] pt-2 font-semibold">
              <span>Whole app today{typeof status.appCalls === "number" ? ` (${status.appCalls} calls)` : ""}</span>
              <span className="tabular-nums">${status.appUsd.toFixed(3)}</span>
            </p>
          )}
          <p className="mt-2 text-[0.6875rem] text-[var(--hud-text-dim)]">Resets at midnight Pakistan time.</p>
        </div>
      </div>
      {/* On <body>, not inside the header: the header's own stacking would keep it under the page. */}
      {showWarning && createPortal(
        <div className="pointer-events-none fixed inset-x-0 bottom-6 z-[70] flex justify-center px-4">
          <div role="alert" className="pointer-events-auto flex max-w-md items-start gap-3 rounded-xl border border-red-500/60 bg-red-600 px-4 py-3 text-sm text-white shadow-lg">
            <p className="flex-1">
              You&apos;ve spent <b>${status.spentUsd.toFixed(2)}</b> on AI today — over your <b>${status.limitUsd.toFixed(2)}</b> daily limit.
            </p>
            <button
              type="button"
              onClick={() => {
                setDismissedDay(status.day);
                try {
                  localStorage.setItem(DISMISSED_KEY, status.day);
                } catch {
                  /* not remembered */
                }
              }}
              className="shrink-0 rounded-md bg-white/15 px-2 py-0.5 text-xs font-bold hover:bg-white/25"
            >
              OK
            </button>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}

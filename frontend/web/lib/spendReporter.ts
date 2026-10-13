import type { SpendStatus } from "./spendTracking";

/**
 * KEEPS A TRACKED ACCOUNT'S DAILY SPEND UP TO DATE for components/DailySpendBadge.tsx.
 *
 * It used to SEND the browser's cost ledger to /api/spend. Since 2026-10-13 every paid call is
 * priced on the server and written to the spend log (lib/openaiClient.ts, lib/spend) with the
 * account it was for — including narration, pictures, the PDF and the live voice, which the
 * browser ledger missed or under-counted — so the day's total is READ from there instead. Sending
 * the ledger as well would count the same calls twice. Started only for tracked accounts.
 */

const POLL_EVERY_MS = 15_000;

let started = false;
let timer: ReturnType<typeof setInterval> | null = null;
const listeners = new Set<(status: SpendStatus) => void>();

async function refresh(): Promise<void> {
  try {
    const res = await fetch("/api/spend", { cache: "no-store" });
    if (!res.ok) return;
    const status = (await res.json()) as SpendStatus;
    for (const listener of listeners) listener(status);
  } catch {
    // Keep the last figure.
  }
}

/** Start keeping the total fresh (idempotent). */
export function startSpendReporter(): void {
  if (started || typeof window === "undefined") return;
  started = true;
  timer = setInterval(() => void refresh(), POLL_EVERY_MS);
}

export function stopSpendReporter(): void {
  if (!started) return;
  started = false;
  if (timer) clearInterval(timer);
  timer = null;
}

/** Be told the day's total each time it is read. */
export function onSpendStatus(listener: (status: SpendStatus) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

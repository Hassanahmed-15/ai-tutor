import { getCostLedger, subscribeCostLedger } from "./costLedger";
import { ledgerIncrease, type SpendStatus } from "./spendTracking";

/**
 * SENDS A TRACKED ACCOUNT'S AI SPEND TO /api/spend as the lecture's cost ledger measures it.
 *
 * The ledger (lib/costLedger.ts) already adds up everything a lecture spends, in the browser. This
 * watches its total, sends each rise to the server every few seconds (and once more as the page
 * closes), and passes the day's total back to the badge (components/DailySpendBadge.tsx). Started
 * only for accounts the server says are tracked — nothing is sent for anyone else.
 */

const SEND_EVERY_MS = 3_000;

let started = false;
let baseline = 0;
let pending = 0;
let timer: ReturnType<typeof setTimeout> | null = null;
let stopLedger: (() => void) | null = null;
const listeners = new Set<(status: SpendStatus) => void>();

function publish(status: SpendStatus) {
  for (const listener of listeners) listener(status);
}

async function send(): Promise<void> {
  timer = null;
  if (pending <= 0) return;
  const usd = pending;
  pending = 0;
  try {
    const res = await fetch("/api/spend", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ usd }) });
    if (res.ok && res.status !== 204) publish((await res.json()) as SpendStatus);
    else if (!res.ok) pending += usd; // try again with the next batch
  } catch {
    pending += usd;
  }
}

function schedule() {
  if (!timer) timer = setTimeout(() => void send(), SEND_EVERY_MS);
}

/** A page closing sends what is still pending, without waiting for a reply. */
function flushOnClose() {
  if (pending <= 0) return;
  const blob = new Blob([JSON.stringify({ usd: pending })], { type: "application/json" });
  if (navigator.sendBeacon?.("/api/spend", blob)) pending = 0;
}

/** Start reporting (idempotent). The ledger total at this moment is the baseline: it is not re-sent. */
export function startSpendReporter(): void {
  if (started || typeof window === "undefined") return;
  started = true;
  baseline = getCostLedger().totalUsd;
  stopLedger = subscribeCostLedger(() => {
    const next = ledgerIncrease(baseline, getCostLedger().totalUsd);
    baseline = next.baseline;
    if (next.reportUsd > 0) {
      pending += next.reportUsd;
      schedule();
    }
  });
  window.addEventListener("pagehide", flushOnClose);
}

export function stopSpendReporter(): void {
  if (!started) return;
  started = false;
  stopLedger?.();
  stopLedger = null;
  window.removeEventListener("pagehide", flushOnClose);
  flushOnClose();
}

/** Be told the day's total after every report the server accepts. */
export function onSpendStatus(listener: (status: SpendStatus) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

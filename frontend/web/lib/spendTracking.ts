/**
 * A DAILY AI-SPEND WATCH FOR CHOSEN ACCOUNTS (2026-10-13). Hassan's and Minahil's accounts have
 * their AI spend added up per day and shown to them; past the daily limit they are WARNED — nothing
 * is blocked. Every other account is not tracked at all.
 *
 * Pure (no server or browser APIs), so it is unit-tested (lib/anim/spendTracking.test.ts) and shared
 * by app/api/spend/route.ts, lib/spendReporter.ts and components/DailySpendBadge.tsx.
 *
 * What is counted is what the lecture's cost ledger measured (lib/costLedger.ts): reading the
 * document, planning, generating, narrating, answering questions and the live voice tutor.
 */

/** The accounts tracked when SPEND_TRACKED_EMAILS is not set: Hassan's and Minahil's. */
export const DEFAULT_TRACKED_EMAILS = ["hassankzr2006@gmail.com", "mrauf.bese23seecs@seecs.edu.pk"];

/** The daily warning line, in US dollars, when SPEND_DAILY_LIMIT_USD is not set. */
export const DEFAULT_DAILY_LIMIT_USD = 2.5;

/** The tracked emails: SPEND_TRACKED_EMAILS (comma-separated) or the default two, lower-cased. */
export function trackedEmails(env: Record<string, string | undefined> = process.env): string[] {
  const list = env.SPEND_TRACKED_EMAILS?.trim() ? env.SPEND_TRACKED_EMAILS.split(",") : DEFAULT_TRACKED_EMAILS;
  return list.map((e) => e.trim().toLowerCase()).filter(Boolean);
}

export function isTracked(email: string | null | undefined, env: Record<string, string | undefined> = process.env): boolean {
  return Boolean(email) && trackedEmails(env).includes(String(email).trim().toLowerCase());
}

export function dailyLimitUsd(env: Record<string, string | undefined> = process.env): number {
  const n = Number(env.SPEND_DAILY_LIMIT_USD);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_DAILY_LIMIT_USD;
}

/** Pakistan Standard Time is UTC+5 all year (no daylight saving). */
const PKT_OFFSET_MS = 5 * 60 * 60 * 1000;

/** The day a moment falls on in Pakistan, as YYYY-MM-DD: the spend resets at midnight PKT. */
export function spendDay(now: Date = new Date()): string {
  return new Date(now.getTime() + PKT_OFFSET_MS).toISOString().slice(0, 10);
}

export function spendDocId(userId: string, day: string): string {
  return `${userId}:${day}`;
}

/** The most one report may add — anything larger is a bug, not a lecture. */
export const MAX_REPORT_USD = 5;

/**
 * How much the lecture's ledger total went UP since it was last seen, and the new baseline.
 *
 * The ledger is per lecture: it climbs as costs are measured (a running generation total replaces
 * the last one, which is still a rise) and drops to zero when a new lecture starts. A rise is
 * reported; a drop is a new lecture, so the baseline moves down with it and nothing is reported.
 */
export function ledgerIncrease(lastTotal: number, nextTotal: number): { reportUsd: number; baseline: number } {
  if (!Number.isFinite(nextTotal) || nextTotal < 0) return { reportUsd: 0, baseline: lastTotal };
  if (nextTotal <= lastTotal) return { reportUsd: 0, baseline: nextTotal };
  return { reportUsd: nextTotal - lastTotal, baseline: nextTotal };
}

export type SpendStatus = { tracked: false } | { tracked: true; day: string; spentUsd: number; limitUsd: number; over: boolean };

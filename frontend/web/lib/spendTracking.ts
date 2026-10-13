/**
 * A DAILY AI-SPEND WATCH FOR CHOSEN ACCOUNTS (2026-10-13). Hassan's and Minahil's accounts have
 * their AI spend added up per day and shown to them; past the daily limit they are WARNED — nothing
 * is blocked. Every other account is not tracked at all.
 *
 * Pure (no server or browser APIs), so it is unit-tested (lib/anim/spendTracking.test.ts) and shared
 * by app/api/spend/route.ts and components/SpendPill.tsx (the pill beside the profile button on the
 * main page — shown to these accounts only).
 *
 * What is counted is the server's spend log (lib/spend): every paid AI call, priced as it is made
 * and filed under the account it was for — planning, the lecture worker's boards, pictures,
 * narration, questions, the PDF or video, and the live voice tutor.
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

/** The moments a Pakistan day covers, as ISO strings: [midnight PKT, next midnight PKT). */
export function spendDayRange(day: string): { from: string; to: string } {
  const start = Date.parse(`${day}T00:00:00Z`) - PKT_OFFSET_MS;
  return { from: new Date(start).toISOString(), to: new Date(start + 86_400_000).toISOString() };
}

/** The most one browser report (the live voice's measured spend) may add — anything larger is a bug. */
export const MAX_REPORT_USD = 5;

/** Where a day's spend went, as the spend log sums it (lib/spend/record.ts `SpendSummary`, minus the total). */
export type SpendBreakdown = { calls: number; unpriced: number; byKind: Partial<Record<string, number>>; byModel: Record<string, number> };

export type SpendStatus =
  | { tracked: false }
  | {
      tracked: true;
      day: string;
      spentUsd: number;
      limitUsd: number;
      over: boolean;
      /** This account's spend today, by part of the app and by model. */
      breakdown?: SpendBreakdown;
      /** The whole app's spend over the same Pakistan day. */
      appUsd?: number;
      appCalls?: number;
    };

/**
 * How long a parsed document's images are kept, and which are dropped when there are too many.
 *
 * Split out of `lib/pageImageStore.ts` because that module carries `server-only` — correctly, since
 * it holds uploaded page images and must never be bundled toward a browser — and a module that
 * throws on import cannot be unit tested. The Map plumbing there is trivial; these two rules are
 * where the edge cases live, so this is the half worth asserting.
 */

export const RETENTION_RULES = {
  /** Long enough to cover parsing, planning and a slow generation; short enough to bound memory. */
  TTL_MS: 45 * 60 * 1000,
  /** Documents kept at once. The oldest is dropped first when a new one would exceed this. */
  MAX_DOCUMENTS: 8,
} as const;

/** True once an entry is old enough to be treated as gone. */
export function isExpired(createdAt: number, now: number): boolean {
  return now - createdAt > RETENTION_RULES.TTL_MS;
}

/**
 * How many of the oldest entries must go before one more will fit.
 *
 * Returns 0 rather than a negative number when there is room, so the caller can loop on it without
 * a guard of its own.
 */
export function evictionCount(currentSize: number): number {
  return Math.max(0, currentSize - RETENTION_RULES.MAX_DOCUMENTS + 1);
}

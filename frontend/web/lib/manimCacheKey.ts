import { createHash } from "node:crypto";

/**
 * The Manim render cache key, split out of manimRender.ts so it can be tested.
 *
 * manimRender.ts is marked `import "server-only"`, which throws the moment anything requires it
 * from the CommonJS test build — so the bug below could not be pinned where it lived. It is pure
 * hashing with no server dependency, so it belongs in its own module anyway.
 */

export type ManimQuality = "low" | "medium" | "high";

/**
 * Serialises with keys sorted AT EVERY DEPTH.
 *
 * The previous implementation passed `Object.keys(script).sort()` as JSON.stringify's second
 * argument, believing it sorted keys. It does not — that argument is a replacer **allow-list
 * applied at every depth**. With top-level keys `["caption","durationMs","ops"]`, nothing inside
 * an op matched the list, so every op serialised to `{}` and the scene spec never entered the
 * cache key at all. Two beats with the same caption and duration but completely different scenes
 * therefore collided, and the second was served the first one's video.
 */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(",")}}`;
}

/** Stable cache key: same script + same renderer => same id, regardless of key order. */
export function manimCacheKey(script: unknown, quality: ManimQuality, rendererVersion: string): string {
  return createHash("sha256")
    .update(`${rendererVersion}:${quality}:${stableStringify(script)}`)
    .digest("hex")
    .slice(0, 32);
}

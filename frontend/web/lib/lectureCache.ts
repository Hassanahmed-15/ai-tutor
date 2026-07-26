import "server-only";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Beat } from "./lessonContent";

/**
 * Lesson cache — replaying the SAME task folder used to re-run the whole multi-agent pipeline
 * (~$0.25 and ~90s) for a byte-identical result. We key a filesystem cache on the full generation
 * input so a repeat build is instant and free.
 *
 * ⚠️ CACHE_VERSION DISCIPLINE: bump it whenever prompts, agents, or post-processing change,
 * otherwise a stale lecture is served and the change looks like it did nothing.
 */

// v1: multi-agent pipeline (director + chalkboard + animation + image-explainer + vision critic),
// KaTeX math on the board, handwriting fonts, accept-best animations.
const CACHE_VERSION = "v1";

const CACHE_DIR = path.join(process.cwd(), ".lecture-cache");

export type CachedLecture = { beats: Beat[]; costUsd: number; topic: string; createdAt: string };

/** Stable cache key over everything that can change the generated lecture. */
export function lectureCacheKey(input: {
  topic: string;
  mood: string;
  slideContext?: string;
  sourceDocument: unknown;
  model: string;
}): string {
  const payload = JSON.stringify({
    v: CACHE_VERSION,
    topic: input.topic,
    mood: input.mood,
    slideContext: input.slideContext ?? "",
    model: input.model,
    source: input.sourceDocument ?? null,
  });
  return createHash("sha256").update(payload).digest("hex").slice(0, 40);
}

export async function readCachedLecture(key: string): Promise<CachedLecture | null> {
  try {
    const raw = await readFile(path.join(CACHE_DIR, `${key}.json`), "utf8");
    const parsed = JSON.parse(raw) as CachedLecture;
    if (!Array.isArray(parsed?.beats) || parsed.beats.length === 0) return null;
    return parsed;
  } catch {
    return null; // miss (or unreadable) — never block generation on the cache
  }
}

export async function writeCachedLecture(key: string, value: Omit<CachedLecture, "createdAt">): Promise<void> {
  try {
    await mkdir(CACHE_DIR, { recursive: true });
    const record: CachedLecture = { ...value, createdAt: new Date().toISOString() };
    await writeFile(path.join(CACHE_DIR, `${key}.json`), JSON.stringify(record), "utf8");
  } catch (err) {
    // A cache write failure must never fail the lecture the student is waiting on.
    console.error(`[cache] write failed: ${err instanceof Error ? err.message : "error"}`);
  }
}

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
// v6: sandbox boards rebuilt — the animation prompt is now a fixed layout grid plus a worked
//     example instead of a rule list, catalogue artwork is mandatory when it covers the subject
//     (and labels anchor inside it), and the vision critic REFUSES a sub-floor board rather than
//     shipping it. Not bumping this served pre-fix boards and made all of it look like a no-op.
// v7: sandbox prompt forbids text inside the drawing band (x=440..740) and requires each label its
//     own row — the heart board had put eight labels across the chambers with crossing leader lines.
// v8: worked example now demonstrates eight labels stacked down the right column at 40px, which is
//     the case the prose rule alone never got the model to handle (valve names stayed on the heart).
const CACHE_VERSION = "v8";

const CACHE_DIR = path.join(process.cwd(), ".lecture-cache");

export type CachedLecture = { beats: Beat[]; costUsd: number; topic: string; createdAt: string };

/** Stable cache key over everything that can change the generated lecture. */
export function lectureCacheKey(input: {
  topic: string;
  mood: string;
  slideContext?: string;
  sourceDocument: unknown;
  model: string;
  /** Every model/flag that can materially change generated boards. Without this, changing the
   *  deployment quality profile can still serve a lecture built under the previous profile. */
  generationProfile?: Record<string, string | number | boolean>;
}): string {
  const payload = JSON.stringify({
    v: CACHE_VERSION,
    topic: input.topic,
    mood: input.mood,
    slideContext: input.slideContext ?? "",
    model: input.model,
    generationProfile: input.generationProfile ?? {},
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

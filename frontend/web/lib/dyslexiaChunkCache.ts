import type { DyslexiaChunk, ReadingLevel } from "./dyslexiaLectureContent";

/**
 * Per-beat rewrites fetched from `/api/dyslexia-chunks`, kept for the life of the page.
 *
 * IN MEMORY, NOT localStorage. Beat ids are positional — `pdf-1` is the first beat of whichever
 * lecture is open — so a persisted cache would serve one lecture's lines for another's beat. Keying
 * on the script text instead would survive that, but a lecture's worth of rewrites is not worth the
 * storage budget for a value that is cheap to refetch and only useful while the lesson is on screen.
 *
 * The in-flight map exists because React will call this from an effect that can re-run before the
 * first request resolves; without it a re-render fires a second identical request and pays twice.
 */

export type DyslexiaRewrite = {
  dense: string;
  chunks: Record<ReadingLevel, DyslexiaChunk[]>;
  /** Lowercased word → syllable pieces, for tap-a-word. Empty when nothing was hard enough. */
  syllables: Record<string, string[]>;
};

export type RewriteRequest = {
  beatId: string;
  title: string;
  script: string;
  points?: string[];
};

const cache = new Map<string, DyslexiaRewrite>();
const inFlight = new Map<string, Promise<DyslexiaRewrite | null>>();

/** Already-resolved rewrite for a beat, or null. Synchronous — safe to call during render. */
export function cachedRewrite(beatId: string): DyslexiaRewrite | null {
  return cache.get(beatId) ?? null;
}

/**
 * Fetch (or join an in-flight fetch for) one beat's rewrite.
 *
 * Resolves to null on any failure — no key configured, a 502, a dropped connection. The caller
 * already has a working local split, so a failed rewrite must degrade to "keep what you have"
 * rather than surface an error at a student mid-lesson.
 */
export function fetchRewrite(request: RewriteRequest, signal?: AbortSignal): Promise<DyslexiaRewrite | null> {
  const hit = cache.get(request.beatId);
  if (hit) return Promise.resolve(hit);

  const pending = inFlight.get(request.beatId);
  if (pending) return pending;

  const run = (async (): Promise<DyslexiaRewrite | null> => {
    try {
      const res = await fetch("/api/dyslexia-chunks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          beatId: request.beatId,
          title: request.title,
          script: request.script,
          points: request.points ?? [],
        }),
        signal,
      });
      if (!res.ok) return null;
      const data = await res.json().catch(() => null);
      if (!data?.chunks?.simplest?.length) return null;

      const rewrite: DyslexiaRewrite = {
        dense: typeof data.dense === "string" ? data.dense : "",
        chunks: {
          simplest: data.chunks.simplest,
          simple: data.chunks.simple,
          standard: data.chunks.standard,
        },
        syllables: data.syllables && typeof data.syllables === "object" ? data.syllables : {},
      };
      cache.set(request.beatId, rewrite);
      return rewrite;
    } catch {
      // Includes AbortError when the player moved on — indistinguishable from any other miss here,
      // and treated the same way: the local split stands.
      return null;
    } finally {
      inFlight.delete(request.beatId);
    }
  })();

  inFlight.set(request.beatId, run);
  return run;
}

/** Test seam: forget everything, so a test can exercise a cold fetch. */
export function resetRewriteCache(): void {
  cache.clear();
  inFlight.clear();
}

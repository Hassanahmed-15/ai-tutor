import "server-only";

import { execFile } from "node:child_process";
import { manimCacheKey as cacheKey } from "./manimCacheKey";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { manimPool } from "./manimWorkerPool";

const execFileAsync = promisify(execFile);

/**
 * Renders a DrawScript beat to MP4 with Manim, and caches the result.
 *
 * WHY VIDEO AT ALL. Manim is Python that writes a file; it cannot run in a browser. So a
 * Manim beat is fundamentally different from a LiveSketch beat: it is produced once, ahead
 * of time, and then played back. What makes that acceptable is scripts/manim/render_beat.py
 * preserving the DrawScript's `at` axis as the video's time axis — so the player can scrub
 * `currentTime` from narration progress and stay in sync exactly as the live board does.
 *
 * WHY CACHING IS NOT OPTIONAL. A render costs ~4-10s of CPU. Beats are re-requested on every
 * replay, every reload, and every student taking the same lesson, so without a cache the same
 * seconds are burned repeatedly. The key is a hash of the script plus the renderer version,
 * which means a script edit or a renderer change invalidates naturally and an unchanged beat
 * is free forever.
 *
 * This follows the invocation pattern already established by lib/pdfPythonPipeline.ts.
 */

/**
 * Bump when render_beat.py changes in a way that alters output. Invalidates the cache.
 * 2 — honours `surface` (paper boards render on white), contrast guard, camera auto-fit.
 *     Without this bump every beat rendered on the old near-black board keeps being served.
 * 3 — `manimScene` ops (graph/transform/flow/geometry) and a lighter paper ink.
 * 4 — MP4s are remuxed with `+faststart`. Every earlier file has its `moov` atom after the
 *     payload, which is half of why the player could not seek them.
 * 5 — UTF-8 on the worker channel (subscripts were mangled), real sun/droplet/leaf/stove
 *     silhouettes instead of generic boxes, and a real UI font with a text halo.
 */
const RENDERER_VERSION = "5";

const SCRIPT = path.join(process.cwd(), "scripts", "manim", "render_beat.py");
/**
 * The venv interpreter. Note `python3` is deliberately NOT the default here (unlike
 * pdfPythonPipeline): on Windows `python3` is a Store alias stub that fails, and Manim needs
 * its own dependency set anyway.
 */
const PYTHON =
  process.env.MANIM_PYTHON_BINARY ??
  path.join(process.cwd(), "scripts", "manim", ".venv", "Scripts", "python.exe");

const CACHE_DIR = process.env.MANIM_CACHE_DIR ?? path.join(process.cwd(), ".manim-cache");

const RENDER_TIMEOUT_MS = Number(process.env.MANIM_RENDER_TIMEOUT_MS ?? 180_000);

export type ManimQuality = "low" | "medium" | "high";

export type ManimRenderResult = {
  /** Cache key — also the filename stem, and what the playback route asks for. */
  id: string;
  durationMs: number;
  bytes: number;
};

/** Stable cache key: same script + same renderer => same id, regardless of key order.
 *  The hashing itself lives in lib/manimCacheKey.ts so it is reachable from the test build, which
 *  cannot require anything marked `server-only`. */
export function manimCacheKey(script: unknown, quality: ManimQuality): string {
  return cacheKey(script, quality, RENDERER_VERSION);
}

function videoPathFor(id: string): string {
  return path.join(CACHE_DIR, `${id}.mp4`);
}

function metaPathFor(id: string): string {
  return path.join(CACHE_DIR, `${id}.json`);
}

/** A finished render, or null if this beat has not been rendered yet. */
export async function readCachedRender(id: string): Promise<ManimRenderResult | null> {
  // Reject anything that is not a plain hex id before it reaches the filesystem — this value
  // arrives from the client, and `..` in a path parameter is the oldest trick there is.
  if (!/^[a-f0-9]{32}$/.test(id)) return null;
  try {
    const [info, meta] = await Promise.all([
      stat(videoPathFor(id)),
      readFile(metaPathFor(id), "utf-8"),
    ]);
    if (!info.isFile() || info.size === 0) return null;
    const parsed = JSON.parse(meta) as { durationMs?: number };
    return { id, durationMs: Number(parsed.durationMs) || 0, bytes: info.size };
  } catch {
    return null;
  }
}

export async function readCachedVideo(id: string): Promise<Buffer | null> {
  if (!/^[a-f0-9]{32}$/.test(id)) return null;
  try {
    return await readFile(videoPathFor(id));
  } catch {
    return null;
  }
}

/** In-flight renders, so two requests for the same beat don't both spawn Python. */
const inFlight = new Map<string, Promise<ManimRenderResult>>();

/**
 * Renders `script`, or returns the cached result. Concurrent callers for the same script
 * share one render rather than racing — without this, a page with several beats visible
 * would spawn several identical Python processes at once.
 */
export async function renderBeat(
  script: unknown,
  quality: ManimQuality = "medium",
): Promise<ManimRenderResult> {
  const id = manimCacheKey(script, quality);

  const cached = await readCachedRender(id);
  if (cached) return cached;

  const existing = inFlight.get(id);
  if (existing) return existing;

  const job = (async (): Promise<ManimRenderResult> => {
    await mkdir(CACHE_DIR, { recursive: true });
    const scriptPath = path.join(CACHE_DIR, `${id}.input.json`);
    await writeFile(scriptPath, JSON.stringify(script), "utf-8");

    // Warm pool first — it skips the ~3.3s Manim import and renders several beats at once.
    // The one-shot path stays as a fallback so a broken pool degrades to "slow" rather than
    // "broken".
    let durationMs = 0;
    try {
      durationMs = await manimPool().submit({ script, output: videoPathFor(id), quality });
    } catch (poolError) {
      const reason = poolError instanceof Error ? poolError.message : "unknown";
      console.error(`[manim] worker pool failed (${reason}); falling back to one-shot render`);

      const { stdout } = await execFileAsync(
        PYTHON,
        [SCRIPT, scriptPath, videoPathFor(id), "--quality", quality],
        {
          timeout: RENDER_TIMEOUT_MS,
          maxBuffer: 4 * 1024 * 1024,
          // Manim stages frames in the system temp dir. That is on C: here, which is full, so
          // keep scratch space beside the cache where the render output already has to fit.
          env: { ...process.env, TMPDIR: CACHE_DIR, TEMP: CACHE_DIR, TMP: CACHE_DIR },
        },
      );

      // render_beat.py prints one JSON line on success; anything else means it failed in a way
      // its own error handling did not catch.
      const line = stdout.trim().split("\n").pop() ?? "";
      try {
        durationMs = Number((JSON.parse(line) as { durationMs?: number }).durationMs) || 0;
      } catch {
        throw new Error(`manim renderer returned unparseable output: ${line.slice(0, 200)}`);
      }
    }

    const info = await stat(videoPathFor(id));
    await writeFile(metaPathFor(id), JSON.stringify({ durationMs, quality }), "utf-8");
    return { id, durationMs, bytes: info.size };
  })();

  inFlight.set(id, job);
  try {
    return await job;
  } finally {
    inFlight.delete(id);
  }
}

/** True when a DrawScript contains anything render_beat.py cannot draw yet. */
export function unsupportedOpKinds(script: unknown): string[] {
  const ops = (script as { ops?: { kind?: string }[] })?.ops ?? [];
  const unsupported = new Set(["scene", "image", "reactAnimation", "chalkBoard"]);
  return [...new Set(ops.map((op) => op?.kind).filter((k): k is string => !!k && unsupported.has(k)))];
}

import { NextResponse } from "next/server";
import { manimCacheKey, renderBeat, unsupportedOpKinds, type ManimQuality } from "@/lib/manimRender";
import { MANIM_POOL_SIZE } from "@/lib/manimWorkerPool";

/**
 * Renders a DrawScript beat to MP4 with Manim and returns its cache id.
 *
 * Off by default. Manim is a Python + ffmpeg toolchain that must be installed on the host
 * (see scripts/manim/requirements.txt), and rendering costs several seconds of CPU per beat,
 * so this stays behind MANIM_RENDER_ENABLED rather than being something a deploy can trip
 * over silently.
 *
 * Repeated calls for the same script are free: the result is cached by content hash, and
 * concurrent callers share one render.
 */

const MANIM_RENDER_ENABLED = process.env.MANIM_RENDER_ENABLED === "1";
const QUALITIES = new Set<ManimQuality>(["low", "medium", "high"]);

export async function POST(req: Request) {
  if (!MANIM_RENDER_ENABLED) {
    return NextResponse.json(
      { error: "Manim rendering is turned off. Set MANIM_RENDER_ENABLED=1 to enable it." },
      { status: 503 },
    );
  }

  let body: { script?: unknown; scripts?: unknown[]; quality?: string; prefetch?: boolean };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Body must be JSON." }, { status: 400 });
  }

  const quality0 = QUALITIES.has(body.quality as ManimQuality) ? (body.quality as ManimQuality) : "medium";

  /**
   * Batch prefetch: hand over every beat of a lecture at once, and return IMMEDIATELY with
   * the ids rather than waiting for the renders.
   *
   * This is the actual fix for "the narration finished before the video appeared". Rendering
   * on demand means the student waits for the beat they are already hearing; kicking all
   * beats off when the lecture loads means beat 3 has been ready for a minute by the time
   * anyone reaches it. The pool renders them warm and several at a time, so a 12-beat lecture
   * is done in roughly the time it takes to listen to beat 0.
   */
  if (Array.isArray(body.scripts)) {
    const scripts = body.scripts.filter(
      (s): s is object => !!s && typeof s === "object" && Array.isArray((s as { ops?: unknown }).ops),
    );
    const ids = scripts.map((script) => manimCacheKey(script, quality0));

    for (const script of scripts) {
      // Deliberately not awaited: the response should not wait on the render queue. Failures
      // are logged and the beat falls back to the live board when it is reached.
      void renderBeat(script, quality0).catch((error) => {
        const message = error instanceof Error ? error.message : "unknown error";
        console.error(`[manim-render] prefetch failed: ${message}`);
      });
    }

    return NextResponse.json({ prefetching: ids.length, ids, poolSize: MANIM_POOL_SIZE });
  }

  const script = body.script;
  if (!script || typeof script !== "object" || !Array.isArray((script as { ops?: unknown }).ops)) {
    return NextResponse.json({ error: "Expected { script: DrawScript } with an ops array." }, { status: 400 });
  }

  try {
    const result = await renderBeat(script, quality0);
    return NextResponse.json({
      id: result.id,
      url: `/api/manim-render/${result.id}`,
      durationMs: result.durationMs,
      bytes: result.bytes,
      // Surfaced rather than hidden: these ops rendered as nothing, and a caller comparing
      // the video to the live board deserves to know why something is missing.
      unsupportedOps: unsupportedOpKinds(script),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    console.error(`[manim-render] ${message}`);
    return NextResponse.json({ error: `Render failed: ${message}` }, { status: 500 });
  }
}

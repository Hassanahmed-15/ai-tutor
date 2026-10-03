import { currentUser } from "@/lib/auth";
import { progressiveSnapshot } from "@/lib/progressiveLectureStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await currentUser();
  if (!auth) return new Response("Authentication required.", { status: 401 });
  const { id } = await params;
  /*
   * A JUST-CREATED LECTURE CAN BE MISSED BY THE FIRST READ. The page opens this stream the moment
   * the lecture is created, and a read in that first instant sometimes found no session (measured
   * 2026-10-03: four of six streams opened within ~100 ms of creation got 404). EventSource never
   * retries a 404, so the build screen froze on "Starting" while the lecture was being written. The
   * first read is therefore retried for up to three seconds before "not found" is believed.
   */
  let first: Awaited<ReturnType<typeof progressiveSnapshot>> = null;
  for (let attempt = 0; attempt < 7 && !first && !request.signal.aborted; attempt++) {
    if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, 500));
    first = await progressiveSnapshot(auth.userId, id).catch((error) => {
      console.error(`[progressive-events] snapshot for ${id} failed: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    });
  }
  if (!first) return new Response("Progressive lecture not found.", { status: 404 });
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let fingerprint = "";
      const started = Date.now();
      try {
        while (!request.signal.aborted && Date.now() - started < 210_000) {
          const snapshot = await progressiveSnapshot(auth.userId, id);
          if (!snapshot) break;
          // A playable beat is later replaced by its premium enrichment. Aggregate counters can
          // remain unchanged during that replacement, so use the per-document snapshot version.
          const nextFingerprint = snapshot.snapshotVersion;
          if (nextFingerprint !== fingerprint) {
            controller.enqueue(encoder.encode(`event: snapshot\ndata: ${JSON.stringify(snapshot)}\n\n`));
            fingerprint = nextFingerprint;
          } else {
            controller.enqueue(encoder.encode(": heartbeat\n\n"));
          }
          if (snapshot.complete || snapshot.status === "failed") break;
          /*
           * POLL FAST WHILE THE STUDENT IS STARING AT A SPINNER, SLOWLY ONCE PLAYBACK HAS STARTED.
           *
           * A flat 1.25 s added up to ~0.6 s of average dead time onto first play — time the lecture
           * was ready and nobody had been told. Before `starterReady` that latency is the only thing
           * between a finished beat and audio, so it is worth a tighter loop; afterwards the next
           * beat is being pre-built behind a playing one and there is nothing to race, so the
           * interval returns to 1.25 s rather than hammering Cosmos for the rest of the lecture.
           */
          await new Promise((resolve) => setTimeout(resolve, snapshot.starterReady ? 1_250 : 350));
        }
      } catch {
        if (!request.signal.aborted) controller.enqueue(encoder.encode(`event: stream-error\ndata: ${JSON.stringify({ error: "Lecture update stream failed." })}\n\n`));
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

import { NextResponse } from "next/server";

export const runtime = "nodejs";
// Never cached: a cached health check is worse than none, because it reports the app as healthy
// long after it has stopped being so.
export const dynamic = "force-dynamic";

/**
 * Liveness/readiness probe for the container platform.
 *
 * Deliberately does NOT call OpenAI/Gemini or touch the filesystem. A health check that depends on
 * third-party APIs will fail (and get your container restarted) during an unrelated upstream
 * outage, turning a degraded feature into a total outage. This answers only "is this process
 * running and able to serve HTTP", which is exactly what the platform needs to decide whether to
 * route traffic here.
 *
 * The reported flags are for humans debugging a deployment — they say whether the required
 * secrets were actually injected, which is the single most common cause of a container that
 * starts fine but fails on first real request.
 */
export async function GET() {
  return NextResponse.json(
    {
      status: "ok",
      uptimeSeconds: Math.round(process.uptime()),
      node: process.version,
      /*
       * Every secret the app throws without, not just the two model keys.
       *
       * Auth, lecture history and progressive generation each read their own variable and fail at
       * the first real request if it is missing — a container that starts cleanly and then 502s on
       * every build looks identical to a code bug from the outside. `storageQueue` in particular is
       * the one that was missing from the deployed app while the code had started requiring it.
       */
      env: {
        openaiKey: Boolean(process.env.OPENAI_API_KEY),
        geminiKey: Boolean(process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY),
        authSecret: Boolean(process.env.AUTH_SECRET),
        cosmos: Boolean(process.env.COSMOS_CONNECTION_STRING),
        storageConnection: Boolean(process.env.AZURE_STORAGE_CONNECTION_STRING),
        storageContainer: Boolean(process.env.AZURE_STORAGE_CONTAINER),
        storageQueue: Boolean(process.env.AZURE_STORAGE_QUEUE),
      },
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

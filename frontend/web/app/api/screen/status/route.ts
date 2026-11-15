import { spawnSync } from "node:child_process";
import { blobStorageConfigured } from "@/lib/blobStorage";
import { sandboxCheck } from "@/lib/screen/slide";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Can this server make screen-mark slides, safely? For the deploy check: Manim and ffmpeg present,
 * video storage set up, and slide code run as a user that cannot read the server's keys. Booleans only.
 */
export async function GET() {
  const sandbox = await sandboxCheck();
  const ffmpeg = spawnSync("ffmpeg", ["-version"], { timeout: 10_000 }).status === 0;
  const ready = sandbox.manim && sandbox.serverEnvHidden && ffmpeg && blobStorageConfigured();
  return Response.json({ ready, ffmpeg, storage: blobStorageConfigured(), ...sandbox }, { headers: { "Cache-Control": "no-store" } });
}

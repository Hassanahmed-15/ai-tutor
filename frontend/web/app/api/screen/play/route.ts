import { cleanText, dataImage, ndjson, screenCaller, spendAs, validRun } from "@/lib/screen/common";
import { makePlay, mockPlay } from "@/lib/screen/play";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** The Try-it challenge for a mark Aria has explained and drawn (lib/screen/play.ts). */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const mock = body.mock === true;
  const caller = await screenCaller(mock);
  if (caller instanceof Response) return caller;
  if (!validRun(body.run)) return Response.json({ error: "Unknown mark: explain it first." }, { status: 400 });
  const concept = cleanText(body.concept, 80);
  const said = cleanText(body.said, 1200);
  const crop = dataImage(body.crop);
  const scene = body.scene && typeof body.scene === "object" && JSON.stringify(body.scene).length < 20_000 ? body.scene : null;
  return ndjson(req, async (send, signal) => {
    if (mock) {
      await new Promise((r) => setTimeout(r, 300));
      send({ t: "done", play: mockPlay(), mock: true });
      return;
    }
    const result = await spendAs(caller, "video", () => makePlay({ concept, said, scene, crop, signal }));
    send({ t: "done", ...result });
  });
}

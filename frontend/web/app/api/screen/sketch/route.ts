import { cleanText, dataImage, ndjson, screenCaller, spendAs, validRun } from "@/lib/screen/common";
import { makeSketch, mockSketch } from "@/lib/screen/sketch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** The live pencil board's plan for a mark Aria is explaining (lib/screen/sketch.ts). */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const mock = body.mock === true;
  const caller = await screenCaller(mock);
  if (caller instanceof Response) return caller;
  if (!validRun(body.run)) return Response.json({ error: "Unknown mark: explain it first." }, { status: 400 });
  const concept = cleanText(body.concept, 80);
  const said = cleanText(body.said, 1200);
  const crop = dataImage(body.crop);
  return ndjson(req, async (send, signal) => {
    if (mock) {
      await new Promise((r) => setTimeout(r, 400));
      const { scene, sentences } = mockSketch(said);
      send({ t: "scene", scene, sentences });
      send({ t: "done", ok: true, mock: true });
      return;
    }
    const result = await spendAs(caller, "video", () => makeSketch({ concept, said, crop, signal, send }));
    send({ t: "done", ...result });
  });
}

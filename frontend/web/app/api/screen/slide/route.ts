import { cleanText, dataImage, ndjson, screenCaller, spendAs, validRun, workDir } from "@/lib/screen/common";
import { makeSlide } from "@/lib/screen/slide";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** The one-slide Manim video for a mark Aria has just explained (lib/screen/slide.ts). */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const mock = body.mock === true;
  const caller = await screenCaller(mock);
  if (caller instanceof Response) return caller;
  if (!validRun(body.run)) return Response.json({ error: "Unknown mark: explain it first." }, { status: 400 });
  const run = body.run;
  const concept = cleanText(body.concept, 80);
  const said = cleanText(body.said, 1200);
  const crop = dataImage(body.crop);
  return ndjson(req, async (send, signal) => {
    const work = await workDir(run, "slide");
    try {
      const result = await spendAs(caller, "video", () => makeSlide({ caller, run, dir: work.dir, concept, said, crop, mock, signal, send }));
      send({ t: "done", ...result });
    } finally {
      await work.done();
    }
  });
}

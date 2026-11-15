import { cleanText, dataImage, ndjson, runId, screenCaller, spendAs } from "@/lib/screen/common";
import { explainMark, mockExplain } from "@/lib/screen/explain";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** A mark from the desktop overlay (public/screen/): Aria's words stream back as NDJSON (lib/screen/common.ts). */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const mock = body.mock === true;
  const caller = await screenCaller(mock);
  if (caller instanceof Response) return caller;
  const crop = dataImage(body.crop);
  if (!crop) return Response.json({ error: "No picture of the mark came with the request." }, { status: 400 });
  const context = dataImage(body.context);
  const question = cleanText(body.question, 300);
  return ndjson(req, async (send, signal) => {
    const run = runId();
    send({ t: "run", run });
    const started = Date.now();
    const result = mock ? await mockExplain(send) : await spendAs(caller, "questions", () => explainMark({ crop, context, question, signal, send }));
    send({ t: "done", ...result, ms: Date.now() - started });
  });
}

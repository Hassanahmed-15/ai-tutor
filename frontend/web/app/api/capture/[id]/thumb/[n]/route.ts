import { NextResponse } from "next/server";
import { lessonCaller } from "@/lib/auth";
import { names, ownerSession, readSlot } from "@/lib/capture/session";
import { getFile } from "@/lib/capture/store";
import { validSlot } from "@/lib/capture/rules";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** A photo's thumbnail, straightened, for the computer's capture panel (its latest version). */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string; n: string }> }) {
  const auth = await lessonCaller();
  if (!auth) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  const { id, n: raw } = await params;
  const n = Number(raw);
  if (!validSlot(n) || !(await ownerSession(id, auth.userId))) return NextResponse.json({ error: "No such photo." }, { status: 404 });
  const slot = await readSlot(id, n);
  // The slot is recorded the moment the photo arrives and the thumbnail a few seconds later, once it is
  // straightened (app/api/capture/[id]/photo): wait for it, up to 20 s, rather than show a broken image.
  let body = slot ? await getFile(names.thumb(id, n, slot.version)) : null;
  for (let waited = 0; slot && !body && waited < 20_000; waited += 400) {
    await new Promise((resolve) => setTimeout(resolve, 400));
    const now = await readSlot(id, n);
    if (!now || now.version !== slot.version || now.state === "failed" || now.state === "deleted") break;
    body = await getFile(names.thumb(id, n, slot.version));
  }
  if (!body) return NextResponse.json({ error: "No such photo." }, { status: 404 });
  return new NextResponse(new Uint8Array(body), { headers: { "Content-Type": "image/jpeg", "Cache-Control": "private, max-age=3600" } });
}

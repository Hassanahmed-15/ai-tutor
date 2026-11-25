import { after, NextResponse } from "next/server";
import { captureStatus, hasMarker, phoneSession, readSlot, setMarker, writeOrder, writeSlot } from "@/lib/capture/session";
import { readPhoto } from "@/lib/capture/read";
import { MAX_PHOTOS, validSlot } from "@/lib/capture/rules";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const tokenOf = (request: Request) => request.headers.get("x-capture-token");

/** The phone's view: what it took and how each photo is doing. The first call tells the computer it connected. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const found = await phoneSession(id, tokenOf(request));
  if ("error" in found) return NextResponse.json({ error: found.error }, { status: found.status });
  if (!(await hasMarker(id, "connected"))) await setMarker(id, "connected");
  return NextResponse.json(await captureStatus(id, found.session), { headers: { "Cache-Control": "private, no-store" } });
}

/**
 * The phone's actions: { action: "order", order: [3,1,2] } · { action: "delete", n } · { action: "use", n } (read a
 * photo held as too dark / no page anyway) · { action: "send" } (done: the computer carries on).
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const found = await phoneSession(id, tokenOf(request));
  if ("error" in found) return NextResponse.json({ error: found.error }, { status: found.status });
  const { session } = found;
  const body = (await request.json().catch(() => ({}))) as { action?: string; n?: unknown; order?: unknown };
  const n = Number(body.n);
  if (body.action === "order" && Array.isArray(body.order)) {
    await writeOrder(id, body.order.map(Number).filter(validSlot).slice(0, MAX_PHOTOS));
  } else if (body.action === "delete" && validSlot(n)) {
    const slot = await readSlot(id, n);
    if (slot) await writeSlot(id, { ...slot, state: "deleted" });
  } else if (body.action === "use" && validSlot(n)) {
    const slot = await readSlot(id, n);
    if (slot && slot.state === "held") {
      await writeSlot(id, { ...slot, state: "reading", startedAt: Date.now() });
      after(() => readPhoto(session, n, slot.version).then(() => undefined));
    }
  } else if (body.action === "send") {
    await setMarker(id, "sent");
  } else {
    return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  }
  return NextResponse.json(await captureStatus(id, session));
}

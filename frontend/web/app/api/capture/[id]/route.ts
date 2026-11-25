import { NextResponse } from "next/server";
import { lessonCaller } from "@/lib/auth";
import { allSlots, captureStatus, deleteSession, ownerSession, setMarker } from "@/lib/capture/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The computer's view of its capture: phone connected or not, and each photo's state. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await lessonCaller();
  if (!auth) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  const { id } = await params;
  const session = await ownerSession(id, auth.userId);
  if (!session) return NextResponse.json({ error: "No such capture." }, { status: 404 });
  return NextResponse.json(await captureStatus(id, session), { headers: { "Cache-Control": "private, no-store" } });
}

/** Closed on the computer: the phone is told, and the photos are deleted. */
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await lessonCaller();
  if (!auth) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  const { id } = await params;
  const session = await ownerSession(id, auth.userId);
  if (!session) return NextResponse.json({ error: "No such capture." }, { status: 404 });
  const slots = await allSlots(id);
  // The record and its "cancelled" marker stay, so a phone still open hears that it was closed; the photos go.
  await setMarker(id, "cancelled");
  await deleteSession(id, slots, { keepRecord: true }).catch(() => undefined);
  return NextResponse.json({ ok: true });
}

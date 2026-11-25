import { after, NextResponse } from "next/server";
import { names, phoneSession, readSlot, writeSlot } from "@/lib/capture/session";
import { putFile } from "@/lib/capture/store";
import { straightenPhoto } from "@/lib/capture/photo";
import { readPhoto } from "@/lib/capture/read";
import { MAX_PHOTO_BYTES, imageKind, photoProblem, validSlot } from "@/lib/capture/rules";
import type { CaptureSession } from "@/lib/capture/rules";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * ONE PHOTO FROM THE PHONE, the moment it is taken (`?n=` is its slot, 1..6; a retake re-uses the slot). Checked
 * (a real JPEG/PNG, under 8 MB), its slot recorded with a new version, and ANSWERED AT ONCE. Straightening
 * (lib/capture/photo.ts), the quality verdict, storing its copies and reading it all happen after the answer
 * (next/server `after`); the phone learns "blurry" / "too dark" / "ready" from its status poll.
 *
 * It used to answer only after straightening and three uploads: 11–50 s of "Sending to your computer…" from this PC
 * (2026-11-25), long enough that the phone sent photo 1 again and two uploads both became version 1.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const found = await phoneSession(id, request.headers.get("x-capture-token"));
  if ("error" in found) return NextResponse.json({ error: found.error }, { status: found.status });
  const { session } = found;
  const n = Number(new URL(request.url).searchParams.get("n"));
  if (!validSlot(n)) return NextResponse.json({ error: "Up to 6 photos." }, { status: 400 });
  const form = await request.formData().catch(() => null);
  const file = form?.get("photo");
  if (!file || typeof file === "string") return NextResponse.json({ error: "No photo was sent." }, { status: 400 });
  if (file.size > MAX_PHOTO_BYTES) return NextResponse.json({ error: "That photo is too large." }, { status: 413 });
  const bytes = Buffer.from(await file.arrayBuffer());
  const kind = imageKind(bytes);
  if (!kind) return NextResponse.json({ error: "That is not a photo (JPEG or PNG)." }, { status: 415 });

  // The slot first, so a second photo for it (a quick retake) gets the next version, never the same one.
  const previous = await readSlot(id, n);
  const version = (previous?.version ?? 0) + 1;
  await writeSlot(id, { n, version, state: "reading", problem: null, error: null, startedAt: Date.now(), width: 0, height: 0 });
  after(() => preparePhoto(session, n, version, bytes, kind));
  return NextResponse.json({ n, version, state: "reading", problem: null });
}

/** Straighten, judge, store and read one photo. Never throws: a failure is the slot's state. */
async function preparePhoto(session: CaptureSession, n: number, version: number, bytes: Buffer, kind: "jpeg" | "png"): Promise<void> {
  const id = session.id;
  const current = async () => {
    const slot = await readSlot(id, n);
    return slot && slot.version === version && slot.state !== "deleted" ? slot : null;
  };
  let straight;
  try {
    straight = await straightenPhoto(bytes, kind);
  } catch (error) {
    console.warn(`[capture] ${id.slice(0, 8)} photo ${n} could not be straightened: ${(error as Error).message.slice(0, 160)}`);
    const slot = await current();
    if (slot) await writeSlot(id, { ...slot, state: "failed", error: "That photo could not be opened. Please take it again." });
    return;
  }
  // putFile keeps an immutable file in memory before it stores it, so the read finds the page at once.
  const stored = Promise.all([
    putFile(names.page(id, n, version), straight.page, "image/jpeg", { immutable: true }),
    putFile(names.vision(id, n, version), straight.vision, "image/jpeg", { immutable: true }),
    putFile(names.thumb(id, n, version), straight.thumb, "image/jpeg", { immutable: true }),
  ]);
  const problem = photoProblem(straight);
  // Too dark, or no page in it: held, unread (nothing spent) until the student says "use anyway".
  const held = problem === "dark" || problem === "no-page";
  const reading = held ? null : readPhoto(session, n, version);
  await stored;
  const slot = await current();
  // Its read marks it ready only while the slot holds this version; "reading" is written here only if it has not.
  if (slot && slot.state === "reading") await writeSlot(id, { ...slot, state: held ? "held" : "reading", problem, width: straight.width, height: straight.height });
  console.log(`[capture] ${id.slice(0, 8)} photo ${n} v${version}: ${straight.width}x${straight.height}, sharpness ${straight.sharpness}, brightness ${straight.brightness}, page ${straight.pageFound ? (straight.warped ? "found and flattened" : "found") : "not found"}${problem ? `, ${problem}` : ""}`);
  await reading;
}

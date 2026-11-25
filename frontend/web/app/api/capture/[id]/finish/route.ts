import { NextResponse } from "next/server";
import { lessonCaller } from "@/lib/auth";
import { allSlots, deleteSession, names, ownerSession, readOrder, readSlot, setMarker } from "@/lib/capture/session";
import { getFile, getJson } from "@/lib/capture/store";
import { readInFlight, readPhoto, type PageResult } from "@/lib/capture/read";
import { assembleCapturedPages, type CapturedPage } from "@/lib/capture/assemble";
import { slotsInOrder, type SlotRecord } from "@/lib/capture/rules";
import { putDocumentImages } from "@/lib/pageImageStore";
import { isSuprnotesLessonInput } from "@/lib/suprnotes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const STUCK_MS = 120_000;
const WAIT_MS = 150_000;

/** The result of one photo: the read running in this process, else the stored one, else (stuck) read now. */
async function resultOf(session: NonNullable<Awaited<ReturnType<typeof ownerSession>>>, slot: SlotRecord): Promise<PageResult | null> {
  const running = readInFlight(session.id, slot.n, slot.version);
  if (running) return running;
  const deadline = Date.now() + WAIT_MS;
  for (;;) {
    const stored = await getJson<PageResult>(names.result(session.id, slot.n, slot.version));
    if (stored) return stored;
    const now = await readSlot(session.id, slot.n);
    if (!now || now.version !== slot.version || now.state === "failed" || now.state === "deleted" || now.state === "held") return null;
    // A read that ended without a word (its replica was stopped mid-read): read it here instead.
    if (now.state === "reading" && Date.now() - now.startedAt > STUCK_MS) return readPhoto(session, slot.n, slot.version);
    if (Date.now() > deadline) return null;
    await new Promise((r) => setTimeout(r, 1500));
  }
}

/**
 * "USE THESE PAGES": the photos in the student's order, read (waiting for the last ones), assembled into ONE
 * document with pages 1..N (lib/capture/assemble.ts) and answered in the shape /api/parse-pdf answers — the
 * computer then goes on to the reference/strict choice exactly as for a PDF. The pages' vision copies become the
 * document's page images (the strict panel shows them). The session's files are then deleted.
 */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await lessonCaller();
  if (!auth) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  const { id } = await params;
  const session = await ownerSession(id, auth.userId);
  if (!session) return NextResponse.json({ error: "No such capture." }, { status: 404 });
  const slots = await allSlots(id);
  const ordered = slotsInOrder(slots, await readOrder(id)).filter((s) => s.state === "ready" || s.state === "reading");
  if (!ordered.length) return NextResponse.json({ error: "No photo is ready yet." }, { status: 409 });
  const started = Date.now();
  const results = await Promise.all(ordered.map((slot) => resultOf(session, slot)));
  const read = ordered.map((slot, i) => ({ slot, result: results[i] })).filter((x): x is { slot: SlotRecord; result: PageResult } => Boolean(x.result && isSuprnotesLessonInput(x.result.sourceDocument)));
  if (!read.length) return NextResponse.json({ error: "None of the photos could be read. Please take them again." }, { status: 422 });
  const assembled = assembleCapturedPages(read.map((x) => x.result as CapturedPage));
  const visions = await Promise.all(read.map((x) => getFile(names.vision(id, x.slot.n, x.slot.version))));
  const documentId = putDocumentImages(visions.flatMap((v, i) => (v ? [{ pageNumber: i + 1, dataUrl: `data:image/jpeg;base64,${v.toString("base64")}` }] : [])));
  console.log(`[capture] ${id.slice(0, 8)} finished: ${read.length} of ${ordered.length} page(s) in ${Math.round((Date.now() - started) / 1000)}s after "use these pages", ${assembled.blockCount} block(s), ${assembled.assetCount} figure(s), $${assembled.costUsd.toFixed(4)}`);
  await setMarker(id, "sent").catch(() => undefined);
  await deleteSession(id, slots, { keepRecord: true }).catch(() => undefined);
  return NextResponse.json({ ...assembled, documentId, skipped: ordered.length - read.length });
}

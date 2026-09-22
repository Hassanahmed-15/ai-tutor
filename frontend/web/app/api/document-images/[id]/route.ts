import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { getDocumentImages } from "@/lib/pageImageStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The uploaded pages, as images, for the live voice tutor.
 *
 * The voice sessions (planning, the build wait, the lesson) were given the document only as
 * extracted text — and a scanned PDF has none, so Aria talked about a document she had never seen.
 * The pages parse-pdf already rendered are handed to her instead, exactly as the student sees them.
 *
 * The id is an unguessable UUID minted per upload, and the store expires entries after 45 minutes
 * (lib/pageImageRetention.ts); a miss is an ordinary 404 the client treats as "no pages to share".
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await currentUser();
  if (!auth) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  const { id } = await params;
  const images = getDocumentImages(id);
  if (!images) return NextResponse.json({ error: "Those pages are no longer available." }, { status: 404 });
  return NextResponse.json(
    {
      unit: images.unit,
      pages: images.pages.map((page) => ({ pageNumber: page.pageNumber, dataUrl: page.dataUrl })),
      // The crops the student dragged — the part of the page the lesson is about.
      regions: images.regions.map((region) => ({ pageNumber: region.pageNumber, dataUrl: region.dataUrl, rect: region.rect })),
    },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}

import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { databaseConfigured, ensureContainers, viewerDocuments, type ViewerDocumentDoc } from "@/lib/db/cosmos";
import { deleteBlob, downloadBlobRange, parseByteRange, storedBlobProperties } from "@/lib/blobStorage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function findDoc(userId: string, id: string): Promise<ViewerDocumentDoc | null> {
  await ensureContainers();
  const { resource } = await viewerDocuments().item(id, userId).read<ViewerDocumentDoc>().catch(() => ({ resource: undefined }));
  return resource ?? null;
}

/**
 * Serves the stored PDF, range-capable exactly like the lecture video route (see that file's
 * comment) — the browser's own PDF.js range-fetches a large document, requesting only the byte
 * spans for the pages currently on screen, which is what keeps a 300-page file from having to
 * download in full before the first page paints.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!databaseConfigured()) return new Response("Document storage is not configured", { status: 503 });
  const session = await currentUser();
  if (!session) return new Response("Authentication required", { status: 401 });

  const { id } = await params;
  if (!/^[a-f0-9-]{36}$/.test(id)) return new Response("Invalid document id", { status: 400 });

  try {
    const doc = await findDoc(session.userId, id);
    if (!doc) return new Response("Not found", { status: 404 });

    const properties = await storedBlobProperties(doc.blobName);
    const range = parseByteRange(request.headers.get("range"), properties.totalBytes);
    const baseHeaders: Record<string, string> = {
      "Content-Type": "application/pdf",
      "Accept-Ranges": "bytes",
      "Cache-Control": "private, max-age=3600",
      "Content-Disposition": `inline; filename="${doc.name.replace(/"/g, "")}"`,
    };

    if (range === "invalid") {
      return new Response(null, {
        status: 416,
        headers: { ...baseHeaders, "Content-Range": `bytes */${properties.totalBytes}` },
      });
    }

    const download = await downloadBlobRange(doc.blobName, range ?? undefined);
    if (range) {
      return new Response(new Uint8Array(download.body), {
        status: 206,
        headers: {
          ...baseHeaders,
          "Content-Range": `bytes ${range.start}-${range.end}/${download.totalBytes}`,
          "Content-Length": String(download.body.length),
        },
      });
    }
    return new Response(new Uint8Array(download.body), {
      headers: { ...baseHeaders, "Content-Length": String(download.body.length) },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Stored document could not be loaded.";
    console.error(`[viewer-documents] ${id} failed: ${message}`);
    return new Response("Stored document could not be loaded", { status: 502 });
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!databaseConfigured()) return NextResponse.json({ error: "Document storage is not configured." }, { status: 503 });
  const session = await currentUser();
  if (!session) return NextResponse.json({ error: "Sign in first." }, { status: 401 });

  const { id } = await params;
  const doc = await findDoc(session.userId, id);
  if (!doc) return NextResponse.json({ error: "Not found." }, { status: 404 });

  await deleteBlob(doc.blobName).catch(() => {});
  await viewerDocuments().item(id, session.userId).delete().catch(() => {});
  return NextResponse.json({ ok: true });
}

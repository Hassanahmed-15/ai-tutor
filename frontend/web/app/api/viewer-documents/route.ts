import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { PDFDocument } from "pdf-lib";
import { currentUser } from "@/lib/auth";
import {
  databaseConfigured,
  ensureContainers,
  viewerDocuments,
  type ViewerDocumentDoc,
} from "@/lib/db/cosmos";
import {
  blobStorageConfigured,
  uploadRawBlob,
  viewerDocumentBlobName,
} from "@/lib/blobStorage";
import { convertPptxToPdf } from "@/lib/pptxToPdf";
import {
  VIEWER_DOCUMENT_LIMITS,
  viewerDocumentTooLarge,
  viewerDocumentTooManyPages,
  viewerTooLargeMessage,
  viewerTooManyPagesMessage,
} from "@/lib/viewerDocumentLimits";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * The standalone document viewer's own upload path.
 *
 * SEPARATE FROM THE LESSON-BUILDING UPLOAD FLOW ON PURPOSE. document-pages/parse-pdf/parse-pptx
 * all exist to feed the lecture pipeline — they extract text and figures for a model, and enforce
 * the 20-page limit that pipeline needs to hold a whole document in one prompt. This route answers
 * a different, older question: "let me read this file." It stores the actual PDF bytes (converting
 * a PPT/PPTX to PDF first, through the SAME LibreOffice path parse-pptx's preview already uses) so
 * the browser can render real pages with a real text layer, at a size — hundreds of pages — the
 * lesson pipeline was never meant to handle.
 *
 * PDF-lib for the page count, not the Python rasteriser. Counting pages does not require decoding
 * or rendering a single one; loading the structure is enough, and it is the same library already
 * used for export-pdf, so this adds no new dependency.
 */
export async function POST(request: Request) {
  if (!databaseConfigured() || !blobStorageConfigured()) {
    return NextResponse.json({ error: "Document storage is not configured." }, { status: 503 });
  }
  const session = await currentUser();
  if (!session) return NextResponse.json({ error: "Sign in to open documents." }, { status: 401 });

  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Attach a PDF or PowerPoint file." }, { status: 400 });
  }

  const name = file.name || "Document";
  const lower = name.toLowerCase();
  const isPdf = lower.endsWith(".pdf") || file.type === "application/pdf";
  const isPptx =
    lower.endsWith(".pptx") ||
    lower.endsWith(".ppt") ||
    file.type.includes("presentationml") ||
    file.type === "application/vnd.ms-powerpoint";

  if (!isPdf && !isPptx) {
    return NextResponse.json({ error: "Only PDF and PowerPoint files are supported." }, { status: 400 });
  }
  if (file.size > VIEWER_DOCUMENT_LIMITS.MAX_BYTES) {
    return NextResponse.json({ error: viewerTooLargeMessage(file.size) }, { status: 413 });
  }

  const uploadedBytes = new Uint8Array(await file.arrayBuffer());
  let pdfBytes: Uint8Array;
  let sourceKind: ViewerDocumentDoc["sourceKind"];

  if (isPdf) {
    pdfBytes = uploadedBytes;
    sourceKind = "pdf";
  } else {
    const converted = await convertPptxToPdf(uploadedBytes);
    if (!converted) {
      return NextResponse.json(
        {
          error:
            "This PowerPoint could not be converted for viewing. LibreOffice may be unavailable on the server, " +
            "or the file may be corrupted.",
        },
        { status: 422 },
      );
    }
    pdfBytes = converted;
    sourceKind = "pptx";
    // The converted PDF is the thing actually stored and served, so it is what the size limit
    // applies to from here on — a compact deck that expands into a heavy PDF must still be caught.
    if (viewerDocumentTooLarge(pdfBytes.length)) {
      return NextResponse.json({ error: viewerTooLargeMessage(pdfBytes.length) }, { status: 413 });
    }
  }

  let pageCount: number;
  try {
    const doc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
    pageCount = doc.getPageCount();
  } catch {
    return NextResponse.json({ error: "That file does not look like a valid PDF." }, { status: 422 });
  }
  if (viewerDocumentTooManyPages(pageCount)) {
    return NextResponse.json({ error: viewerTooManyPagesMessage(pageCount) }, { status: 413 });
  }
  if (pageCount === 0) {
    return NextResponse.json({ error: "That document has no pages." }, { status: 422 });
  }

  await ensureContainers();
  const documentId = randomUUID();
  const blobName = viewerDocumentBlobName(session.userId, documentId);

  try {
    await uploadRawBlob(blobName, Buffer.from(pdfBytes), "application/pdf");
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Could not store the document." },
      { status: 502 },
    );
  }

  const doc: ViewerDocumentDoc = {
    id: documentId,
    userId: session.userId,
    name: name.slice(0, 200),
    sourceKind,
    blobName,
    pageCount,
    bytes: pdfBytes.length,
    createdAt: new Date().toISOString(),
  };
  await viewerDocuments().items.create(doc);

  return NextResponse.json({
    id: documentId,
    name: doc.name,
    sourceKind,
    pageCount,
    bytes: doc.bytes,
  });
}

/** Recent documents this student has opened, newest first — for a "continue reading" list. */
export async function GET() {
  if (!databaseConfigured()) return NextResponse.json({ documents: [] });
  const session = await currentUser();
  if (!session) return NextResponse.json({ documents: [] });

  await ensureContainers();
  const { resources } = await viewerDocuments()
    .items.query<ViewerDocumentDoc>({
      query: "SELECT * FROM c WHERE c.userId = @userId ORDER BY c.createdAt DESC OFFSET 0 LIMIT 20",
      parameters: [{ name: "@userId", value: session.userId }],
    })
    .fetchAll();

  return NextResponse.json({
    documents: resources.map((d) => ({
      id: d.id,
      name: d.name,
      sourceKind: d.sourceKind,
      pageCount: d.pageCount,
      bytes: d.bytes,
      createdAt: d.createdAt,
    })),
  });
}

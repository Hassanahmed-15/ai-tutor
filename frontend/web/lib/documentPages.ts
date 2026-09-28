/**
 * The upload's rendered pages, fetched once per document and shared.
 *
 * The source panel and the figure board both show the student's own pages; fetching the same
 * data-URL payload twice doubled the heaviest request of a PDF lesson.
 */
export type DocumentPageImage = { pageNumber: number; dataUrl: string };
export type DocumentPagesResult = { unit: "page" | "slide"; pages: DocumentPageImage[] };

const cache = new Map<string, Promise<DocumentPagesResult>>();

export function loadDocumentPages(documentId: string): Promise<DocumentPagesResult> {
  const cached = cache.get(documentId);
  if (cached) return cached;
  const request = fetch(`/api/document-images/${encodeURIComponent(documentId)}`, { cache: "no-store" })
    .then(async (response) => {
      const data = (await response.json().catch(() => ({}))) as { unit?: string; pages?: DocumentPageImage[]; error?: string };
      if (!response.ok || !Array.isArray(data.pages) || data.pages.length === 0) {
        throw new Error(data.error || "The source pages are no longer available.");
      }
      return {
        unit: data.unit === "slide" ? "slide" : "page",
        pages: data.pages.slice().sort((a, b) => a.pageNumber - b.pageNumber),
      } as DocumentPagesResult;
    })
    .catch((error) => {
      cache.delete(documentId); // a failure can be retried
      throw error;
    });
  cache.set(documentId, request);
  return request;
}

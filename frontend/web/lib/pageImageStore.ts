import "server-only";
import { randomUUID } from "node:crypto";
import { evictionCount, isExpired } from "./pageImageRetention";

/**
 * Where a parsed document's page images wait between parsing and generation.
 *
 * WHY A SERVER-SIDE STORE AND NOT THE RESPONSE BODY. Parsing and generation are two separate
 * requests made by the browser, so anything one produces and the other needs normally travels back
 * through the client. That works for the source document, which is text. It does not work here:
 * twenty page images are three to five megabytes, and round-tripping them would put that on the
 * wire twice, through JSON.stringify and a base64 inflation on both legs, to hand the server back
 * bytes it produced itself thirty seconds earlier.
 *
 * WHAT THIS COSTS. The same thing `lib/sessionStore.ts` costs, for the same reason: an in-process
 * Map does not survive a restart and does not span instances. That is why every read is allowed to
 * miss. A miss degrades the lecture to text-only grounding — which is exactly what the pipeline did
 * before page images existed — rather than failing the request. Losing the pictures must never lose
 * the lesson.
 *
 * Entries expire on their own so a long-lived process does not accumulate the images of every
 * document anyone has ever uploaded.
 */

export type StoredPageImage = {
  pageNumber: number;
  /** A complete `data:` URL, ready to hand to a vision model without further work. */
  dataUrl: string;
};

export type StoredRegionImage = {
  pageNumber: number;
  dataUrl: string;
  /** Normalised rect the student dragged, kept so the prompt can say where on the page it was. */
  rect: { x: number; y: number; width: number; height: number };
};

export type StoredDocumentImages = {
  pages: StoredPageImage[];
  /** The exact crops the student dragged. Empty when they pointed at nothing. */
  regions: StoredRegionImage[];
  unit: "page" | "slide";
  createdAt: number;
};

/**
 * The map lives on `globalThis`, NOT in this module's scope.
 *
 * THE BUG THIS FIXES. A plain `const store = new Map()` here is one map *per copy of this module*,
 * and Next.js gives each route handler its own bundle — so `/api/parse-pdf` wrote into one map and
 * `/api/generate-lecture` read from a different, permanently empty one. Every lookup missed, and
 * because a miss is designed to degrade silently rather than fail, the symptom was not an error: it
 * was `documentId: "stored"` at parse time and `pageImages: 0` at generation time, with the lecture
 * quietly written from text alone. Dev hot-reload discards module scope between requests as well,
 * so even a single bundle would have lost it.
 *
 * A global survives both, because there is exactly one `globalThis` per Node process — which is the
 * real unit these two routes share. The same reasoning as the well-known database-client singleton.
 */
const STORE_KEY = Symbol.for("aria.pageImageStore");

type GlobalWithStore = typeof globalThis & {
  [STORE_KEY]?: Map<string, StoredDocumentImages>;
};

const globalRef = globalThis as GlobalWithStore;
const store: Map<string, StoredDocumentImages> = globalRef[STORE_KEY] ?? new Map();
globalRef[STORE_KEY] = store;

function evictExpired(now: number): void {
  for (const [id, entry] of store) {
    if (isExpired(entry.createdAt, now)) store.delete(id);
  }
}

/**
 * Park a document's images and return the id that fetches them back.
 *
 * Returns null when there is nothing worth storing, so callers can treat "no images" as one case
 * rather than distinguishing an empty document from a failed render.
 */
export function putDocumentImages(
  pages: StoredPageImage[],
  regions: StoredRegionImage[] = [],
  unit: "page" | "slide" = "page",
): string | null {
  if (pages.length === 0 && regions.length === 0) return null;
  const now = Date.now();
  evictExpired(now);

  // Map iteration is insertion-ordered, so the first key is the oldest surviving entry.
  for (let dropped = evictionCount(store.size); dropped > 0; dropped -= 1) {
    const oldest = store.keys().next();
    if (oldest.done) break;
    store.delete(oldest.value);
  }

  const id = randomUUID();
  store.set(id, { pages, regions, unit, createdAt: now });
  return id;
}

/** The images for a document, or null when the id is unknown, expired, or was never stored. */
export function getDocumentImages(documentId: string | null | undefined): StoredDocumentImages | null {
  if (!documentId) return null;
  const entry = store.get(documentId);
  if (!entry) return null;
  if (isExpired(entry.createdAt, Date.now())) {
    store.delete(documentId);
    return null;
  }
  return entry;
}

/** Test seam: drops everything. Never called by the app. */
export function clearDocumentImages(): void {
  store.clear();
}

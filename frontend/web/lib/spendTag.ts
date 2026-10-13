import { spendKindForPath, type SpendKind } from "./spend/usage";

/**
 * THE LESSON'S SPEND TAG, in the browser. One tag per lesson: started at its first paid step
 * (an upload, a video link, or the first planning question), kept through planning and the build,
 * joined by the lecture's own id once it exists (the worker files its spend under that id), and
 * cleared when the student goes home.
 *
 * Every same-origin `/api/` request carries the current tag and the part of the app it is for
 * (`x-aria-spend`, `x-aria-spend-kind`); lib/openaiClient.ts reads them to file each OpenAI call
 * under this lesson. The badge then asks `/api/spend` for everything filed under the tags.
 */
let tags: string[] = [];
const listeners = new Set<() => void>();
let snapshot: readonly string[] = tags;

function emit() {
  snapshot = [...tags];
  for (const fn of listeners) fn();
}

/** Start a tag for a new lesson unless one is already running for the lesson in progress. */
export function ensureSpendTag(): string {
  if (tags.length === 0) {
    const id = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(36).slice(2);
    tags = [`lesson-${id.slice(0, 18)}`];
    emit();
  }
  return tags[tags.length - 1];
}

/** The lecture now has its own id (the worker's spend is filed under it). */
export function addSpendTag(id: string): void {
  if (!id || tags.includes(id)) return;
  if (tags.length === 0) ensureSpendTag();
  tags = [...tags, id];
  emit();
}

/** The lesson is over (the student went home): the next lesson starts a fresh tag. */
export function endSpendTag(): void {
  if (tags.length === 0) return;
  tags = [];
  emit();
}

export function spendTags(): readonly string[] {
  return snapshot;
}

export function onSpendTags(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Report spend measured in the browser (the live voice talks to Google directly). */
export function reportClientSpend(model: string, usd: number): void {
  if (!(usd > 0)) return;
  void fetch("/api/spend", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ model, usd, kind: "voice" satisfies SpendKind }) }).catch(() => {});
}

/** Label every same-origin API request with the lesson and the part of the app. Installed once. */
function install() {
  const w = window as unknown as { __ariaSpendFetch?: boolean };
  if (w.__ariaSpendFetch) return;
  w.__ariaSpendFetch = true;
  const original = window.fetch.bind(window);
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    try {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const path = url.startsWith("/") ? url : url.startsWith(window.location.origin) ? url.slice(window.location.origin.length) : null;
      if (path && path.startsWith("/api/")) {
        const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
        const tag = tags[tags.length - 1];
        if (tag && !headers.has("x-aria-spend")) headers.set("x-aria-spend", tag);
        if (!headers.has("x-aria-spend-kind")) headers.set("x-aria-spend-kind", spendKindForPath(path));
        return original(input, { ...init, headers });
      }
    } catch {
      // Never let labelling stop a request.
    }
    return original(input, init);
  };
}

if (typeof window !== "undefined") install();

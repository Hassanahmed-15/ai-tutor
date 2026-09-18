import type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";

/**
 * Concurrency-limited `doc.getPage()` queue, shared by every PageCanvas in a document.
 *
 * pdf.js talks to a SINGLE worker connection per document. Calling `getPage()` for every page the
 * instant a large PDF opens (which is what naive "measure every page up front" code does) queues
 * hundreds of requests into that one connection ahead of the handful the student can actually see —
 * the visible pages' own `render()` calls end up stuck behind that backlog, so the document appears
 * to stall or never finish opening. This queue caps how many `getPage()` calls are in flight at
 * once and lets a caller jump the line (used when a page becomes visible) instead of waiting behind
 * every other page's request.
 */
const MAX_CONCURRENT = 4;

type Waiter = { resolve: (page: PDFPageProxy) => void; reject: (err: unknown) => void };

type Job = {
  pageNumber: number;
  priority: boolean;
  /** One shared in-flight fetch can have several waiters (PageCanvas asks for the same page twice
   *  — once to measure, once to render); each gets the same PDFPageProxy once it resolves. */
  waiters: Waiter[];
};

export function createPageQueue(doc: PDFDocumentProxy) {
  const pending = new Map<number, Job>();
  let active = 0;

  const start = (job: Job) => {
    active += 1;
    doc
      .getPage(job.pageNumber)
      .then((page) => {
        for (const w of job.waiters) w.resolve(page);
      })
      .catch((err) => {
        for (const w of job.waiters) w.reject(err);
      })
      .finally(() => {
        active -= 1;
        pump();
      });
  };

  const pump = () => {
    while (active < MAX_CONCURRENT && pending.size > 0) {
      // Priority jobs (a page that just became visible) always jump ahead of the backlog of
      // off-screen measurement calls, however large that backlog is — without this, "priority"
      // only mattered when a worker slot happened to be free the instant it was requested, and a
      // page landing mid-scroll on a saturated queue would still wait behind hundreds of pages the
      // student will never look at.
      let next: [number, Job] | undefined;
      for (const entry of pending) {
        if (entry[1].priority) {
          next = entry;
          break;
        }
      }
      if (!next) next = pending.entries().next().value as [number, Job];
      const [pageNumber, job] = next;
      pending.delete(pageNumber);
      start(job);
    }
  };

  return {
    /** Fetch a page, queued behind at most MAX_CONCURRENT other in-flight fetches. Two callers
     *  asking for the same page number while it is still pending share one underlying fetch; call
     *  the returned `cancel` (not the queue-wide one) to drop only this specific waiter. */
    getPage(pageNumber: number, priority = false): { promise: Promise<PDFPageProxy>; cancel: () => void } {
      let waiter: Waiter;
      const promise = new Promise<PDFPageProxy>((resolve, reject) => {
        waiter = { resolve, reject };
        if (active < MAX_CONCURRENT && !pending.has(pageNumber)) {
          // A free worker slot and nothing already queued for this page: skip the queue entirely.
          start({ pageNumber, priority, waiters: [waiter] });
          return;
        }
        const existing = pending.get(pageNumber);
        if (existing) {
          existing.priority = existing.priority || priority;
          existing.waiters.push(waiter);
        } else {
          pending.set(pageNumber, { pageNumber, priority, waiters: [waiter] });
        }
        pump();
      });
      return {
        promise,
        // Drop only this waiter; a job already running can't be un-started, and if another
        // waiter still wants this page, the job (and its other waiters) must stay queued.
        cancel: () => {
          const job = pending.get(pageNumber);
          if (!job) return;
          job.waiters = job.waiters.filter((w) => w !== waiter);
          if (job.waiters.length === 0) pending.delete(pageNumber);
        },
      };
    },
  };
}

export type PageQueue = ReturnType<typeof createPageQueue>;

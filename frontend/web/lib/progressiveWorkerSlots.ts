/*
 * A FREE SLOT TAKES THE NEXT TASK AT ONCE (owner, 2026-10-27). The lecture worker used to take a batch from
 * the queue and wait for all of it: a lesson's plan task ends by growing the knowledge graph, and its first
 * three boards, queued meanwhile, waited 14 s for it while the student waited for board 1; one slow board
 * held up the next ones the same way. Here up to `slots` tasks run at once, and each slot that frees asks
 * the queue for more. Stopping lets the running tasks finish.
 */
export async function runInSlots<M>(opts: {
  slots: number;
  stopping: () => boolean;
  /** Up to `max` messages, or none. */
  receive: (max: number) => Promise<M[]>;
  handle: (message: M) => Promise<void>;
  /** The wait after an empty receive, and while every slot is busy. */
  idleMs?: number;
  busyMs?: number;
}): Promise<void> {
  const idleMs = opts.idleMs ?? 1_000;
  const busyMs = opts.busyMs ?? 250;
  let active = 0;
  while (!opts.stopping()) {
    const free = opts.slots - active;
    if (free <= 0) {
      await delay(busyMs);
      continue;
    }
    const messages = await opts.receive(free);
    if (messages.length === 0) {
      await delay(idleMs);
      continue;
    }
    for (const message of messages) {
      active++;
      void opts.handle(message)
        .catch((error) => console.error("[progressive-worker] message handling failed:", error))
        .finally(() => { active--; });
    }
  }
  while (active > 0) await delay(busyMs);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

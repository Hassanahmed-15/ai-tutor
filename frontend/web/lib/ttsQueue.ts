/**
 * THE NARRATION QUEUE (app/api/tts): at most `concurrency` syntheses at once, and the sentence a
 * student is about to HEAR goes before any warm-up of later parts.
 *
 * Measured on the live site (2026-10-14): one lecture's player asks for 4 clips at once and its warmer
 * for 2 more, against a first-come-first-served limit of 4 — so the next sentence queued behind
 * warm-ups, the player gave up on it after 10 s, and the lecture went quiet (16.8 s mid-part).
 *
 *  - a heard sentence (`warm: false`) starts whenever a slot is free;
 *  - a warm-up starts only when no heard sentence is waiting, and warm-ups never hold more than
 *    `warmSlots` slots, so heard sentences always find room;
 *  - a waiting warm-up that the player then asks for is promoted (`priority.warm = false; wake()`).
 *
 * Pure (no server APIs), so it is unit-tested (lib/anim/ttsQueue.test.ts).
 */
export type TtsPriority = { warm: boolean };

export function createTtsQueue(concurrency: number, warmSlots = Math.max(1, concurrency - 2)) {
  let active = 0;
  let activeWarm = 0;
  const waiters: Array<{ priority: TtsPriority; wake: () => void }> = [];

  const canStart = (priority: TtsPriority) => {
    if (active >= concurrency) return false;
    if (!priority.warm) return true;
    return activeWarm < warmSlots && !waiters.some((w) => !w.priority.warm);
  };

  /** Every waiter re-checks; the ones for a heard sentence are woken (and so re-check) first. */
  const wake = () => {
    const parked = waiters.splice(0);
    for (const w of [...parked.filter((p) => !p.priority.warm), ...parked.filter((p) => p.priority.warm)]) w.wake();
  };

  async function run<T>(fn: () => Promise<T>, priority: TtsPriority): Promise<T> {
    // Checked and taken in one step after each wake-up, so the slot count is never exceeded.
    while (!canStart(priority)) await new Promise<void>((resolve) => waiters.push({ priority, wake: resolve }));
    const heldAsWarm = priority.warm;
    active++;
    if (heldAsWarm) activeWarm++;
    try {
      return await fn();
    } finally {
      active--;
      if (heldAsWarm) activeWarm--;
      wake();
    }
  }

  return { run, wake, stats: () => ({ active, activeWarm, waiting: waiters.length }) };
}

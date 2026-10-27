/*
 * A SLOW SENTENCE IS ASKED FOR TWICE (owner, 2026-10-27: "Aria gets quiet sometimes"). In the hour of a live
 * lecture, 24 of 127 sentences stalled at OpenAI — no answer within 6 s, or a clip that stopped half-way — and
 * the player waits on a sentence until its clip arrives (lib/voice.ts, "silent": her voice is never swapped),
 * so each stall was 6-12 s of quiet. A healthy sentence answers in about 1.5 s. A call with no answer after
 * `answerMs`, or answered but not finished after `finishMs`, gets a second call beside it: the first to
 * finish is used and the other dropped (an unanswered call is not billed).
 */

/** One call for a sentence's audio: its result, when its answer started, and a way to drop it. */
export type SpeechCall<T> = { result: Promise<T>; answered: Promise<void>; abort: () => void };

export async function hedged<T>(start: () => SpeechCall<T>, opts: { answerMs: number; finishMs: number; onHedge?: (why: string) => void }): Promise<T> {
  const first = start();
  const settled = first.result.then(() => true, () => true);
  const answered = await Promise.race([settled, first.answered.then(() => true), after(opts.answerMs, false)]);
  const finished = answered && (await Promise.race([settled, after(opts.finishMs, false)]));
  if (finished) return first.result;
  opts.onHedge?.(answered ? `not finished ${opts.finishMs / 1000} s after answering` : `no answer in ${opts.answerMs / 1000} s`);
  const second = start();
  // Whichever is still running when the other finishes is dropped.
  const running = new Set([first, second]);
  for (const call of running) call.result.then(() => running.delete(call), () => running.delete(call));
  try {
    return await Promise.any([first.result, second.result]);
  } catch (error) {
    throw error instanceof AggregateError ? error.errors[error.errors.length - 1] : error;
  } finally {
    for (const call of running) call.abort();
  }
}

function after<T>(ms: number, value: T): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms).unref?.());
}

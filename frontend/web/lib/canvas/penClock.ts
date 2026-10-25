/**
 * HOW LONG THE PEN STILL OWES HER VOICE (owner, 2026-10-23: "the pencil just got way too fast and then
 * the voice came … I want 100 percent synchronisation with voice"). The marker on the live board
 * (components/canvas/MarkerWriter.tsx) reports what it has left to write for the sentences she has
 * already said; the player waits that long before her next sentence, and before the next board, so a
 * sentence's ink is always finished before she says the next one — the pen never has to race to catch up.
 *
 * One live board writes at a time, so this is one reader at a time; a board that unmounts stops answering.
 */
let source: (() => number) | null = null;

/** The live marker's answer to "how long until you are done with what she has said?" (ms). */
export function reportPenRemaining(read: () => number): () => void {
  source = read;
  return () => {
    if (source === read) source = null;
  };
}

export function penRemainingMs(): number {
  try {
    return source ? Math.max(0, source()) : 0;
  } catch {
    return 0;
  }
}

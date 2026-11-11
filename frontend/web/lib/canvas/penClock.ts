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

/**
 * HOW LONG THE BOARD'S LIVING EQUATION STILL NEEDS (components/canvas/LivingEquationView.tsx): the states she
 * has said that it has not shown yet, and a moment to read the last one. The player waits for it before the
 * next board (bounded), so the working is never cut off at the end of a board (owner, 2026-11-11).
 */
let equation: (() => number) | null = null;

export function reportEquationRemaining(read: () => number): () => void {
  equation = read;
  return () => {
    if (equation === read) equation = null;
  };
}

export function equationRemainingMs(): number {
  try {
    return equation ? Math.max(0, equation()) : 0;
  } catch {
    return 0;
  }
}

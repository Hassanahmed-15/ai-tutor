/**
 * FIX-UP BOARDS IN THE PLAYER'S LIST (lib/canvas/fixupBoard.ts). The server's plan numbers its boards 0..n-1 and
 * the player's list was exactly that list. A fix-up board is shown right after the board whose question was
 * answered wrongly, without renumbering the plan (boards being written keep their numbers): the player's list is
 * the plan's boards with the fix-ups placed after their anchors, and every position sent to the server is turned
 * back into the plan's number. Pure (tested).
 */

/** `after`: the board it is shown after; `for`: the board whose question it fixes (they differ when it came late). */
export type Detour<T> = { after: string; beat: T; for?: string };
type Keyed = { id: string };

/** A fix-up board: "cv-<session>-fx…". */
export function isDetourBeat(beat: Keyed | undefined): boolean {
  return Boolean(beat && /-fx[0-9a-z]+$/.test(beat.id));
}

/** The plan's boards with each fix-up after its anchor (several after one anchor keep their order). */
export function withDetours<T extends Keyed>(planned: T[], detours: Array<Detour<T>>): T[] {
  const out: T[] = [];
  for (const beat of planned) {
    if (!beat) continue;
    out.push(beat);
    for (const d of detours) if (d.after === beat.id) out.push(d.beat);
  }
  return out;
}

/** At most this many fix-up boards are shown in one lecture. */
export const MAX_FIXUPS = 3;

/**
 * WHERE A FIX-UP BOARD GOES when it arrives (or null: not shown). Right after the board that asked while the student
 * is still on it; after the board being played when they have moved on (after a fix-up being played: after that
 * fix-up's own anchor, in arrival order); never a second one for the same board, never past MAX_FIXUPS, never for
 * a fix-up board's own question. Pure (tested).
 */
export function fixupPlacement<T extends Keyed>(planned: T[], detours: Array<Detour<T>>, playhead: number, askedOn: string, fixId: string): string | null {
  if (isDetourBeat({ id: askedOn }) || detours.length >= MAX_FIXUPS) return null;
  if (detours.some((d) => d.beat.id === fixId || (d.for ?? d.after) === askedOn)) return null;
  const list = withDetours(planned, detours);
  const anchorAt = list.findIndex((b) => b.id === askedOn);
  if (anchorAt < 0) return null;
  const playing = list[playhead];
  if (!playing || playhead <= anchorAt) return askedOn;
  return isDetourBeat(playing) ? detours.find((d) => d.beat.id === playing.id)?.after ?? askedOn : playing.id;
}

/** The plan's number for a position in the player's list (a fix-up board counts as the board it follows). */
export function planIndexOf<T extends Keyed>(list: T[], index: number): number {
  if (index < 0) return index;
  let planned = -1;
  for (let i = 0; i <= Math.min(index, list.length - 1); i++) if (!isDetourBeat(list[i])) planned++;
  // Past the end of what is loaded: the boards not loaded yet are all planned ones.
  return planned + Math.max(0, index - (list.length - 1));
}

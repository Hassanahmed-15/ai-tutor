import { layoutPanel } from "./layout";
import type { CanvasBoardSpec, CanvasPlanBeat } from "./types";

/** The Beat id of a canvas board — deterministic, so the recap can name boards not yet written. */
export function canvasBeatId(sessionId: string, planId: string): string {
  return `cv-${sessionId}-${planId}`;
}

/**
 * A board's ties to the boards before it, checked against them: a close-up "inside" an earlier board
 * keeps its place only if that board drew the object, and only a whole element of the same kind
 * "carries" across from the previous board. An earlier board not written yet is trusted (the player
 * skips anything it cannot find); boards are written three at a time, so this runs again when one
 * is finished later (lib/progressiveLectureWorker.ts reconnectLaterBoards). Code only; running it again
 * with more boards in hand can only drop a tie the board before cannot hold. Returns whether anything changed.
 */
export function connectToEarlier(spec: CanvasBoardSpec, plan: CanvasPlanBeat[], index: number, earlier: Array<CanvasBoardSpec | undefined>, sessionId: string): boolean {
  const beat = plan[index];
  const before = JSON.stringify([spec.inside ?? null, spec.carry ?? null]);
  const parentIndex = beat.inside ? plan.findIndex((b) => b.id === beat.inside!.beat) : -1;
  const parent = parentIndex >= 0 && parentIndex < index ? earlier[parentIndex] : undefined;
  const insideOk = parentIndex >= 0 && parentIndex < index && (!parent || Boolean(layoutPanel(parent).targets[beat.inside!.object]));
  if (insideOk) spec.inside = { beat: canvasBeatId(sessionId, beat.inside!.beat), id: beat.inside!.object };
  else delete spec.inside;
  const previous = index > 0 ? earlier[index - 1] : undefined;
  const typesHere = new Map(layoutPanel(spec).marks.map((m) => [m.id, m.type]));
  const typesBefore = previous ? new Map(layoutPanel(previous).marks.map((m) => [m.id, m.type])) : null;
  const carry = (spec.carry ?? beat.carry).filter((id) => index > 0 && typesHere.has(id) && (!typesBefore || typesBefore.get(id) === typesHere.get(id)));
  if (carry.length) spec.carry = carry;
  else delete spec.carry;
  return JSON.stringify([spec.inside ?? null, spec.carry ?? null]) !== before;
}

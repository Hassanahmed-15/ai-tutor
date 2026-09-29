import type { Beat } from "../lessonContent";
import { animationModelLabel } from "../animationModels";
import { illustrationIdOf } from "./illustratedLayout";

/**
 * The tagline over the board (components/sketch/RendererBadge.tsx BoardTagline): what drew THIS
 * board and what it cost, and what is coming next and whether it is ready. Developer telemetry, shown
 * only with NEXT_PUBLIC_SHOW_RENDERER_BADGE=1 — asked for on 2026-09-29 to watch generation while
 * testing lectures. Pure, so it is tested directly.
 */

type AnyOp = { kind: string; code?: string; status?: string; model?: string; trial?: { costUsd?: number; ms?: number }; ops?: unknown[] };

function opsOf(beat: Beat | undefined): AnyOp[] {
  return ((beat?.draw?.ops ?? []) as unknown as AnyOp[]);
}

/** A board still waiting on the server for its drawing. */
export function boardPending(beat: Beat | undefined): boolean {
  return opsOf(beat).some((op) =>
    (op.kind === "reactAnimation" && !op.code && op.status !== "failed")
    || (op.kind === "chalkBoard" && (!Array.isArray(op.ops) || op.ops.length === 0) && op.status !== "failed"));
}

const KIND_LABELS: Record<string, string> = {
  plotBoard: "Chart",
  equationBoard: "Derivation",
  structureScene: "Diagram",
  codeBoard: "Code",
  chalkBoard: "Chalkboard",
  image: "Picture",
};

/** "Illustrated · Motion · gpt-image-1 · $0.073 · 31s", "Motion · GPT-5.6 Terra · $0.214 · 48s", "Chart". */
export function boardSummary(beat: Beat | undefined): string {
  const ops = opsOf(beat);
  const animation = ops.find((op) => op.kind === "reactAnimation");
  if (animation) {
    if (!animation.code) return animation.status === "failed" ? "Motion · unavailable" : "Motion · drawing…";
    const parts = [illustrationIdOf(animation.code) ? "Illustrated · Motion" : "Motion"];
    const model = animationModelLabel(animation.model);
    if (model) parts.push(model);
    const cost = animation.trial?.costUsd;
    if (typeof cost === "number" && Number.isFinite(cost)) parts.push(`$${cost.toFixed(3)}`);
    const ms = animation.trial?.ms;
    if (typeof ms === "number" && Number.isFinite(ms) && ms > 0) parts.push(`${Math.round(ms / 1000)}s`);
    return parts.join(" · ");
  }
  const kind = ops.map((op) => KIND_LABELS[op.kind]).find(Boolean);
  return kind ?? "Board";
}

export type IncomingState = "ready" | "drawing" | "writing" | "last";

/**
 * The next board: its title and state. "writing" is a board the lecture has planned but whose beat
 * has not arrived yet (a progressive lecture streams later beats while earlier ones play).
 */
export function incomingSummary(beats: Beat[], index: number, plannedTotal: number): { text: string; state: IncomingState } {
  const next = beats[index + 1];
  if (next) {
    const state: IncomingState = boardPending(next) ? "drawing" : "ready";
    return { text: `next: ${next.title} · ${state === "ready" ? "ready" : "drawing…"}`, state };
  }
  if (index + 1 < plannedTotal) return { text: `next: board ${index + 2} of ${plannedTotal} · being written…`, state: "writing" };
  return { text: "last board", state: "last" };
}

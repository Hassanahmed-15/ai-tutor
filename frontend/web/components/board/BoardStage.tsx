"use client";

import { useEffect, useRef, useState } from "react";
import { AlertCircle, Loader2 } from "lucide-react";

/**
 * THE BOARD SURFACE, AND HOW ONE CONCEPT BECOMES THE NEXT.
 *
 * The old transition was not a transition: `setStage("slide")` unmounted the entire board subtree
 * the instant narration ended, showed a full-screen title card for 1500ms, then mounted the next
 * board with an 850ms fade. Two boards never existed at once — `key={beat.id}` made overlap
 * impossible — so the lecture read as a slide deck clicking forward, which is exactly what a
 * teaching board should not feel like.
 *
 * Here the outgoing board stays mounted while the incoming one arrives, so the change can be a
 * MOVE rather than a cut:
 *
 *   ERASE  — the finished board wipes away left-to-right, the way a teacher clears one, then the
 *            next concept is drawn on the clean surface. Used when the new concept is unrelated.
 *   SLIDE  — the board slides up and the next rolls in beneath it, like a roller blackboard.
 *            Used when the new concept continues the last one, because the motion reads as
 *            "there is more of this" rather than "that is finished".
 *
 * Both are ~900ms, under the student's sense of a pause, and both respect prefers-reduced-motion
 * by degrading to a plain swap rather than a spin.
 */

export type BoardTransition = "erase" | "slide" | "none";

export interface BoardStageProps {
  /** Changes when the concept changes; drives the transition. */
  boardKey: string;
  children: React.ReactNode;
  transition?: BoardTransition;
  status?: BoardStatus;
  /** Rendered above the board surface but below any status veil — the annotation layer. */
  overlay?: React.ReactNode;
}

export type BoardStatus =
  | { kind: "ready" }
  | { kind: "generating"; label: string }
  | { kind: "waiting"; label: string }
  | { kind: "paused" }
  | { kind: "error"; label: string; onRetry?: () => void };

const TRANSITION_MS = 900;

export function BoardStage({ boardKey, children, transition = "erase", status = { kind: "ready" }, overlay }: BoardStageProps) {
  const [outgoing, setOutgoing] = useState<{ key: string; node: React.ReactNode } | null>(null);
  const previous = useRef<{ key: string; node: React.ReactNode }>({ key: boardKey, node: children });
  const [phase, setPhase] = useState<"idle" | "leaving">("idle");

  useEffect(() => {
    if (previous.current.key === boardKey) {
      previous.current = { key: boardKey, node: children };
      return;
    }
    const reduced = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (transition === "none" || reduced) {
      previous.current = { key: boardKey, node: children };
      return;
    }
    // Keep the finished board alive so the two can overlap for the length of the move.
    setOutgoing(previous.current);
    setPhase("leaving");
    previous.current = { key: boardKey, node: children };
    const timer = window.setTimeout(() => {
      setOutgoing(null);
      setPhase("idle");
    }, TRANSITION_MS);
    return () => window.clearTimeout(timer);
  }, [boardKey, children, transition]);

  const veiled = status.kind !== "ready";

  return (
    <section
      className="relative min-h-0 flex-1 overflow-hidden rounded-2xl border border-white/[0.07] bg-[#080a0e]"
      aria-label="Teaching board"
    >
      {/* The outgoing concept, on its way out. */}
      {outgoing && (
        <div
          key={`out-${outgoing.key}`}
          className={`absolute inset-0 ${transition === "slide" ? "board-slide-out" : "board-erase-out"}`}
          aria-hidden="true"
        >
          {outgoing.node}
        </div>
      )}

      {/* The current concept. */}
      <div
        key={`in-${boardKey}`}
        className={`absolute inset-0 ${phase === "leaving" ? (transition === "slide" ? "board-slide-in" : "board-draw-in") : ""}`}
      >
        {children}
      </div>

      {overlay}

      {veiled && <StatusVeil status={status} />}
    </section>
  );
}

/**
 * The states the old board could not express.
 *
 * Paused showed nothing at all — the board simply froze mid-draw while an amber chip sat 700px away
 * in the header, so a student could reasonably think the lecture had crashed. `waitingForNextBeat`
 * was worse: its status string was computed and then never rendered anywhere. And every failure
 * card was a dead end with no retry, leaking operator language like "Generated animation code was
 * not available".
 */
function StatusVeil({ status }: { status: BoardStatus }) {
  if (status.kind === "ready") return null;

  const paused = status.kind === "paused";
  return (
    <div
      role="status"
      aria-live="polite"
      className={`absolute inset-0 flex items-center justify-center p-6 transition ${
        paused ? "bg-[#080a0e]/55 backdrop-blur-[2px]" : "bg-[#080a0e]/80 backdrop-blur-sm"
      }`}
    >
      <div className="flex max-w-md flex-col items-center gap-3 text-center">
        {status.kind === "generating" || status.kind === "waiting" ? (
          <>
            <Loader2 size={22} className="animate-spin text-white/50" aria-hidden="true" />
            <p className="text-[0.95rem] font-medium text-white/85">{status.label}</p>
            <p className="text-[0.8rem] text-white/45">Aria is still working on this part.</p>
          </>
        ) : status.kind === "paused" ? (
          <>
            <div className="flex h-14 w-14 items-center justify-center rounded-full border border-white/15 bg-black/40">
              <span className="block h-5 w-1.5 rounded-sm bg-white/70" />
              <span className="ml-1.5 block h-5 w-1.5 rounded-sm bg-white/70" />
            </div>
            <p className="text-[0.95rem] font-medium text-white/85">Paused</p>
            <p className="text-[0.8rem] text-white/45">Press play, or just start talking to Aria.</p>
          </>
        ) : (
          <>
            <AlertCircle size={22} className="text-amber-300/80" aria-hidden="true" />
            <p className="text-[0.95rem] font-medium text-white/85">{status.label}</p>
            {status.onRetry && (
              <button
                onClick={status.onRetry}
                className="mt-1 rounded-lg border border-white/15 px-4 py-2 text-[0.82rem] font-medium text-white/80 transition hover:bg-white/10 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-300"
              >
                Try this board again
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}

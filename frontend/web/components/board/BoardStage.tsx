"use client";

import { useEffect, useState } from "react";
import { AlertCircle, Loader2 } from "lucide-react";
import type { BoardMove } from "@/lib/board/teachingState";

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

/** Must match `board-title-out` in globals.css — the card unmounts when its exit has finished. */
const TITLE_EXIT_MS = 420;

export interface BoardStageProps {
  /** Changes when the concept changes; drives the transition. */
  boardKey: string;
  children: React.ReactNode;
  transition?: BoardTransition;
  /** Teaching decision, not a cosmetic animation choice. */
  move?: BoardMove;
  /** Finished sections on the same roller belt, oldest first. */
  sections?: Array<{ key: string; node: React.ReactNode }>;
  status?: BoardStatus;
  /** Rendered above the board surface but below any status veil — the annotation layer. */
  overlay?: React.ReactNode;
  /**
   * The section card shown while this board prepares, or null to show none.
   *
   * Null on a continuation pass: the second or third board of one subtopic is the same section, so
   * re-announcing it would turn one idea back into several slides.
   */
  title?: string | null;
  /** Fired once the board has actually painted, so the card can hand over instead of timing out. */
  onBoardPainted?: () => void;
  /** Small line above the title — where this section sits in the lesson. */
  titleEyebrow?: string;
  /** The board behind the card is still being generated; show that rather than a silent title. */
  titlePending?: boolean;
}

export type BoardStatus =
  | { kind: "ready" }
  | { kind: "generating"; label: string }
  | { kind: "waiting"; label: string }
  | { kind: "paused" }
  | { kind: "error"; label: string; onRetry?: () => void };

export function BoardStage({
  boardKey,
  children,
  transition = "erase",
  move,
  sections = [],
  status = { kind: "ready" },
  overlay,
  title,
  onBoardPainted,
  titleEyebrow,
  titlePending,
}: BoardStageProps) {
  /*
   * "The board has painted" = two animation frames after this board mounted: one for the browser to
   * lay the new subtree out, one for it to paint. A single rAF fires before paint, and a load/ready
   * callback is not available here because the board has a dozen render branches (LiveSketch, chalk,
   * React animation, status cards) and only the stage sees all of them.
   */
  useEffect(() => {
    if (!onBoardPainted) return;
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => onBoardPainted());
    });
    return () => {
      cancelAnimationFrame(raf1);
      if (raf2) cancelAnimationFrame(raf2);
    };
  }, [boardKey, onBoardPainted]);

  /*
   * The card outlives its own `title` prop by one animation, so handing over is a dissolve rather
   * than a cut. `shownTitle` holds the last real title while `leaving` drives the exit; it clears
   * when the animation ends, or on a timer for the reduced-motion case where no animation runs.
   */
  const [shownTitle, setShownTitle] = useState<string | null>(title ?? null);
  useEffect(() => {
    if (title) {
      setShownTitle(title);
      return;
    }
    if (!shownTitle) return;
    const t = setTimeout(() => setShownTitle(null), TITLE_EXIT_MS);
    return () => clearTimeout(t);
  }, [title, shownTitle]);

  const retained = sections.filter((section) => section.key !== boardKey).slice(-5);
  const belt = [...retained, { key: boardKey, node: children }];
  const activeIndex = belt.length - 1;

  const veiled = status.kind !== "ready";

  return (
    <section
      className="relative h-full min-h-0 flex-1 overflow-hidden rounded-2xl border border-white/[0.07] bg-[#080a0e]"
      aria-label="Teaching board"
    >
      <div
        className="absolute inset-0 transition-transform duration-[900ms] ease-[cubic-bezier(.65,0,.35,1)] motion-reduce:transition-none"
        style={{ transform: `translateY(-${activeIndex * 100}%)` }}
      >
        {belt.map((section, sectionIndex) => (
          <div
            key={section.key}
            data-board-section={section.key}
            data-active-board={section.key === boardKey ? "true" : "false"}
            className={`absolute inset-x-0 h-full ${section.key === boardKey && (move === "fresh" || transition === "erase") ? "board-draw-in" : ""}`}
            style={{ top: `${sectionIndex * 100}%` }}
            aria-hidden={section.key === boardKey ? undefined : true}
          >
            {section.node}
          </div>
        ))}
      </div>

      {overlay}

      {shownTitle ? <SectionCard title={shownTitle} leaving={!title} eyebrow={titleEyebrow} pending={titlePending} /> : null}

      {veiled && <StatusVeil status={status} />}
    </section>
  );
}

/**
 * The section card: the title of the subtopic about to be taught.
 *
 * It sits OVER the board rather than replacing it, which is the whole change. The old card was a
 * separate stage — the board was unmounted, the card held the screen for a flat 1500ms, and only
 * then did the board mount and begin drawing, so the student watched several seconds of nothing
 * between every explanation. Here the board is already mounting and drawing underneath; the card
 * covers it only until there is something worth uncovering, then fades out over it.
 *
 * It leaves on its own `board-title-out` animation rather than unmounting instantly, so the
 * hand-off is a dissolve into the board instead of a cut.
 */
function SectionCard({ title, leaving, eyebrow, pending }: { title: string; leaving: boolean; eyebrow?: string; pending?: boolean }) {
  return (
    <div
      className="board-title-card pointer-events-none absolute inset-0 z-20 flex items-center justify-center bg-[#080a0e] px-8 lg:px-16"
      data-leaving={leaving ? "true" : "false"}
      aria-hidden="true"
    >
      {/* One faint warm wash, matching the board's own backdrop. The predecessor used a purple/cyan
          gradient card that looked like a corporate slide deck dropped into a lecture — a different
          visual language from the board it was introducing, which is why it read as an interruption
          rather than as the lesson starting. */}
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(232,168,124,0.07),transparent_60%)]" />
      <div className="relative w-full max-w-3xl">
        {eyebrow && (
          <p className="mb-4 text-[0.7rem] font-black uppercase tracking-[0.22em] text-white/30">{eyebrow}</p>
        )}
        {/* Left-aligned, like a teacher writing a heading at the top of a board — not centred like
            a title slide. Balanced weight and a rule beneath, so it reads as a heading rather than
            a splash screen. */}
        <h2 className="text-balance text-3xl font-bold leading-[1.12] tracking-[-0.01em] text-white/95 sm:text-4xl lg:text-[2.9rem]">
          {title}
        </h2>
        <div className="mt-5 h-px w-16 bg-gradient-to-r from-amber-300/60 to-transparent" />
        {/* A silent title for several seconds is indistinguishable from a hung lecture. When the
            board behind the card is still being written, say so. */}
        {pending && (
          <p className="mt-5 flex items-center gap-2 text-[0.8rem] font-medium text-white/40">
            <Loader2 size={13} className="animate-spin" aria-hidden="true" />
            Drawing the board…
          </p>
        )}
      </div>
    </div>
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

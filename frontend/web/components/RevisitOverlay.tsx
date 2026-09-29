"use client";

import { useEffect, useRef, type ReactNode } from "react";
import type { RevisitMark } from "@/lib/revisit";

/**
 * AN EARLIER SLIDE, BACK ON SCREEN FOR A QUESTION (lib/revisit.ts).
 *
 * The lecture stays where it was — its narration is frozen, not stopped, and `index` never moves —
 * so this is an overlay over the current board, not navigation: going to the old slide for real
 * would cancel the paused narration and restart the part from its first sentence. The old board is
 * shown finished; once Aria's answer arrives, the board's own pen rings what she points at and writes
 * her note on it (the sandbox's `annotate` message). When the student says continue or presses
 * Play, the player clears this and the lecture carries on mid-sentence.
 */
export function RevisitOverlay({
  slideNumber,
  title,
  marks,
  note,
  onContinue,
  children,
}: {
  slideNumber: number;
  title: string;
  marks: RevisitMark[];
  note: string;
  onContinue: () => void;
  /** The old board, rendered finished. */
  children: ReactNode;
}) {
  const boardRef = useRef<HTMLDivElement>(null);

  /*
   * The annotation is posted until the board acknowledges it. The sandbox registers its message
   * handler only once its script has run, and a board can take a second to boot, so a single post
   * at mount would usually be dropped (the same race ReactAnimationSandbox documents for progress).
   */
  useEffect(() => {
    if (!marks.length && !note) return;
    let done = false;
    const frames = () => Array.from(boardRef.current?.querySelectorAll("iframe") ?? []);
    const onMessage = (event: MessageEvent) => {
      if (event.data?.type === "annotated" && frames().some((f) => f.contentWindow === event.source)) done = true;
    };
    window.addEventListener("message", onMessage);
    const post = () => {
      if (done) return;
      for (const frame of frames()) {
        try {
          frame.contentWindow?.postMessage({ type: "annotate", marks, note }, "*");
        } catch {
          // A frame mid-teardown has no window; the next tick tries again.
        }
      }
    };
    post();
    const timer = window.setInterval(post, 400);
    const stop = window.setTimeout(() => window.clearInterval(timer), 20_000);
    return () => {
      window.removeEventListener("message", onMessage);
      window.clearInterval(timer);
      window.clearTimeout(stop);
    };
  }, [marks, note]);

  return (
    <div className="absolute inset-0 z-40 flex flex-col overflow-hidden rounded-[inherit] bg-slate-950">
      <div ref={boardRef} className="relative min-h-0 flex-1">
        {children}
      </div>
      <div className="pointer-events-none absolute inset-x-0 top-3 flex justify-center">
        <div className="pointer-events-auto flex items-center gap-3 rounded-full border border-white/10 bg-slate-900/90 py-1.5 pl-4 pr-1.5 text-sm text-slate-200 shadow-lg backdrop-blur">
          <span>
            Back on <span className="font-semibold text-white">slide {slideNumber}</span>
            <span className="text-slate-400"> · {title}</span>
          </span>
          <button
            type="button"
            onClick={onContinue}
            className="rounded-full bg-violet-500 px-3 py-1 text-xs font-semibold text-white transition hover:bg-violet-400"
          >
            Continue the lecture
          </button>
        </div>
      </div>
    </div>
  );
}

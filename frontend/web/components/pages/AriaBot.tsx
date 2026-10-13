"use client";

import { useEffect, useRef, useState } from "react";
import { DotAvatar, type DotGaze, type DotMouthInput } from "@/components/avatar/DotAvatar";
import type { VisemeName } from "@/lib/avatar/visemes";

/**
 * ARIA SAYING HELLO on the home page: Dot, the cartoon Aria (components/avatar/DotAvatar.tsx — the
 * same character who teaches beside the board), with a greeting typed into a speech bubble: "Hey,
 * I'm Aria — your personalized tutor." Replaced the box robot on 2026-10-12 at the owner's request.
 *
 * Her mouth shapes each letter as it types (a vowel opens, m/b/p shut the lips, f/v put the teeth on
 * the lip), her eyes follow the pointer, and she blinks and breathes. With less motion asked for (the
 * device setting or the account's `data-reduced-motion`), the whole sentence is there at once and
 * she does not follow the pointer. Clicking her says it again.
 */
const GREETING = "Hey, I'm Aria — your personalized tutor.";
const TYPE_MS = 38;

function prefersStill(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia("(prefers-reduced-motion: reduce)").matches ||
    document.documentElement.dataset.reducedMotion === "1"
  );
}

export function AriaBot({ size = 196 }: { size?: number }) {
  const [typed, setTyped] = useState(0);
  const [run, setRun] = useState(0);
  const sceneRef = useRef<HTMLDivElement>(null);
  const botRef = useRef<HTMLDivElement>(null);
  const gaze = useRef<DotGaze>(null);
  const mouth = useRef<DotMouthInput>(null);

  // The greeting types out once per visit, and again on each click.
  useEffect(() => {
    if (prefersStill()) {
      setTyped(GREETING.length);
      return;
    }
    setTyped(0);
    let i = 0;
    const start = window.setTimeout(() => {
      const timer = window.setInterval(() => {
        // Less motion asked for after she appeared (the account's setting loads late): finish now.
        i = prefersStill() ? GREETING.length : i + 1;
        setTyped(i);
        if (i >= GREETING.length) window.clearInterval(timer);
      }, TYPE_MS);
      cleanup = () => window.clearInterval(timer);
    }, 450);
    let cleanup = () => window.clearTimeout(start);
    return () => {
      window.clearTimeout(start);
      cleanup();
    };
  }, [run]);

  // Her eyes follow the pointer: CSS variables on the scene, throttled to one write per frame, no
  // re-render. Touch has no hovering pointer to follow, so it is left out.
  useEffect(() => {
    if (prefersStill()) return;
    const scene = sceneRef.current;
    const bot = botRef.current;
    if (!scene || !bot) return;
    let frame = 0;
    let last: PointerEvent | null = null;
    const paint = () => {
      frame = 0;
      if (!last) return;
      const box = bot.getBoundingClientRect();
      const dx = last.clientX - (box.left + box.width / 2);
      const dy = last.clientY - (box.top + box.height * 0.42);
      const reach = Math.max(1, Math.hypot(dx, dy));
      const pull = Math.min(1, reach / 320);
      gaze.current = { x: (dx / reach) * pull, y: (dy / reach) * pull };
    };
    const onMove = (event: PointerEvent) => {
      if (event.pointerType === "touch") return;
      last = event;
      if (!frame) frame = requestAnimationFrame(paint);
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => {
      window.removeEventListener("pointermove", onMove);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);

  const talking = typed < GREETING.length;
  // The letter just typed sets her mouth: the greeting is "said" as it appears.
  useEffect(() => {
    mouth.current = talking && typed > 0 ? letterMouth(GREETING, typed - 1) : null;
  }, [typed, talking]);

  return (
    <div ref={sceneRef} className="bot-scene flex flex-col items-center gap-3 sm:flex-row sm:gap-5">
      <button
        type="button"
        onClick={() => setRun((n) => n + 1)}
        aria-label="Say hello again"
        className="shrink-0 rounded-[var(--radius-lg)] focus-visible:outline-2 focus-visible:outline-offset-4"
      >
        <div ref={botRef} style={{ width: size, height: size }} aria-hidden="true">
          <DotAvatar state={talking ? "speaking" : "idle"} gaze={gaze} mouth={mouth} className="h-full w-full drop-shadow-[0_10px_28px_var(--dot-shadow)]" />
        </div>
      </button>

      {/* The speech bubble. Its tail points at her: left on a wide screen, down on a narrow one. */}
      <div className="bot-bubble relative max-w-[17rem] rounded-[var(--radius-lg)] border border-[var(--hud-line)] bg-[var(--hud-surface)] px-4 py-3 shadow-[var(--elev-1)]">
        <span aria-hidden="true" className="bot-bubble-tail" />
        <h1 className="text-[1.0625rem] font-medium leading-snug text-[var(--hud-text)] sm:text-[1.1875rem]">
          <span className="sr-only">{GREETING}</span>
          <span aria-hidden="true">
            {GREETING.slice(0, typed)}
            {talking && <span className="bot-caret">|</span>}
            {/* Kept in the layout from the start, so the bubble never grows as the words arrive. */}
            <span className="invisible">{GREETING.slice(typed)}</span>
          </span>
        </h1>
      </div>
    </div>
  );
}

/** The mouth for one typed letter of `text` (index `i`), as viseme weights. Spaces and punctuation rest. */
function letterMouth(text: string, i: number): DotMouthInput {
  const c = text[i]?.toLowerCase() ?? " ";
  const next = text[i + 1]?.toLowerCase() ?? "";
  const v: VisemeName | null =
    c === "t" && next === "h" ? "TH"
    : "a".includes(c) ? "aa"
    : "e".includes(c) ? "E"
    : "iy".includes(c) ? "I"
    : "o".includes(c) ? "O"
    : "uw".includes(c) ? "U"
    : "mbp".includes(c) ? "PP"
    : "fv".includes(c) ? "FF"
    : "tdnl".includes(c) ? "DD"
    : "szcx".includes(c) ? "SS"
    : "kgq".includes(c) ? "kk"
    : c === "r" ? "RR"
    : "jh".includes(c) ? "CH"
    : null;
  return v ? { weights: { [v]: 1 }, open: 0.7 } : { weights: {}, open: 0 };
}

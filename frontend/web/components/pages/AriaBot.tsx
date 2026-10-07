"use client";

import { useEffect, useRef, useState } from "react";

/**
 * ARIA, AS A LITTLE BOX ROBOT — a screen for a face, two eyes, and a greeting typed into a speech
 * bubble: "Hey, I'm Aria — your personalized tutor." (asked for 2026-10-07, in place of the orb).
 *
 * Every colour is a theme token, so she is violet on dark and red on light with no overrides. The
 * motion is transforms only: a slow bob, a blink, eyes that follow the pointer, and a mouth that
 * moves while the words type out. With less motion asked for (the device setting or the account's
 * `data-reduced-motion`), she stands still and the whole sentence is there at once. Clicking her
 * says it again.
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
  const botRef = useRef<SVGSVGElement>(null);

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
      scene.style.setProperty("--ex", `${((dx / reach) * 4 * pull).toFixed(2)}px`);
      scene.style.setProperty("--ey", `${((dy / reach) * 3 * pull).toFixed(2)}px`);
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

  return (
    <div ref={sceneRef} className="bot-scene flex flex-col items-center gap-3 sm:flex-row sm:gap-5">
      <button
        type="button"
        onClick={() => setRun((n) => n + 1)}
        aria-label="Say hello again"
        className="shrink-0 rounded-[var(--radius-lg)] focus-visible:outline-2 focus-visible:outline-offset-4"
      >
        <svg ref={botRef} width={size} height={size} viewBox="0 0 200 200" aria-hidden="true" className={`bot ${talking ? "bot-talking" : ""}`}>
          <ellipse className="bot-shadow" cx="100" cy="188" rx="50" ry="6" />
          <g className="bot-bob">
            {/* Antenna, with a light that breathes. */}
            <line x1="100" y1="40" x2="100" y2="22" className="bot-antenna" strokeWidth="4" strokeLinecap="round" />
            <circle cx="100" cy="18" r="6" className="bot-antenna-dot" />
            {/* Feet. */}
            <rect x="68" y="148" width="20" height="16" rx="6" className="bot-shade" />
            <rect x="112" y="148" width="20" height="16" rx="6" className="bot-shade" />
            {/* The box: a darker side for depth, the front, a sheen along the top. */}
            <rect x="46" y="46" width="124" height="108" rx="26" className="bot-shade" />
            <rect x="36" y="38" width="124" height="108" rx="26" className="bot-front" />
            <rect x="50" y="44" width="96" height="10" rx="5" className="bot-sheen" />
            {/* Ear bolts. */}
            <circle cx="36" cy="92" r="7" className="bot-shade" />
            <circle cx="160" cy="92" r="7" className="bot-shade" />
            {/* The screen face. */}
            <rect x="52" y="58" width="92" height="66" rx="16" className="bot-screen" />
            <g className="bot-eyes">
              <g className="bot-eye">
                <ellipse cx="80" cy="88" rx="10" ry="12" className="bot-eye-white" />
                <circle cx="80" cy="89" r="4.6" className="bot-pupil" />
              </g>
              <g className="bot-eye">
                <ellipse cx="116" cy="88" rx="10" ry="12" className="bot-eye-white" />
                <circle cx="116" cy="89" r="4.6" className="bot-pupil" />
              </g>
            </g>
            <ellipse cx="98" cy="110" rx="9" ry="2.2" className="bot-mouth" />
          </g>
        </svg>
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

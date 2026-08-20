"use client";

import { useEffect, useRef, useState } from "react";
import type { Mcq } from "@/lib/adhd/games/mcq";
import {
  initialFlappy, applyFlappy, pathsFor, seedFrom, gateAt,
  type FlappyState, type TilePath,
} from "@/lib/adhd/games/flappyRules";
import { useReducedMotion } from "@/lib/anim/useReducedMotion";

/**
 * Flappy Gates — fly the answer.
 *
 * A plain 2D canvas and no engine. Phaser and three.js both came and went before this: a bird, some
 * walls and three doors do not need a scene graph, and 2D keeps the option text crisp, which is the
 * only thing here that absolutely must be readable.
 *
 * THE RULES ARE NOT IN THIS FILE. Physics, the course, bumps and which gate a height picks all live
 * in `lib/adhd/games/flappyRules.ts` as a pure reducer. This turns that state into pixels and
 * nothing else — the same split that let the renderer be replaced twice without touching a rule.
 *
 * OPTION TEXT IS DOM, NOT CANVAS. Learned the hard way: 3D text rendered "CO₂" as a tofu box because
 * it rasterised from one font, and lesson content is full of ₂, →, Δ and µ. Real DOM gets every
 * glyph the page can render, stays sharp at any zoom, and a screen reader can read it.
 */

const GATE_TINTS = ["#2dd4bf", "#a78bfa", "#fbbf24"] as const;

export function FlappyGates({
  mcq,
  backdrop,
  onDone,
}: {
  mcq: Mcq;
  /** Optional generated art behind the flight. Absent is fine. */
  backdrop?: string | null;
  onDone: (correct: boolean) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const reduced = useReducedMotion();

  const [state, setState] = useState<FlappyState>(initialFlappy);
  const [result, setResult] = useState<{ picked: 0 | 1 | 2; correct: boolean } | null>(null);

  // The live values the animation loop reads. Kept in refs because the loop runs ~60 times a second
  // and re-rendering React at that rate to move one bird would be the same mistake as everywhere.
  const runRef = useRef<FlappyState>(initialFlappy());
  const doneRef = useRef(onDone);
  useEffect(() => { doneRef.current = onDone; });

  const paths = useRef<TilePath[]>(pathsFor(seedFrom(mcq.beatId)));

  /* Input: pointer, space and up-arrow all flap. */
  useEffect(() => {
    const flap = () => {
      if (runRef.current.chosen !== null) return;
      runRef.current = applyFlappy(runRef.current, { type: "flap" });
      setState(runRef.current);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.code === "Space" || e.code === "ArrowUp") {
        e.preventDefault();
        flap();
      }
    };
    const el = canvasRef.current;
    el?.addEventListener("pointerdown", flap);
    window.addEventListener("keydown", onKey);
    return () => {
      el?.removeEventListener("pointerdown", flap);
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  /* The loop. */
  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    const bg = backdrop ? new Image() : null;
    if (bg && backdrop) bg.src = backdrop;

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;

      const before = runRef.current;
      const next = applyFlappy(before, { type: "tick", dt, paths: paths.current });
      runRef.current = next;
      if (next !== before) setState(next);

      if (next.chosen !== null && before.chosen === null) {
        setResult({ picked: next.chosen, correct: next.chosen === mcq.answer });
      }

      draw(canvasRef.current, next, paths.current, mcq, bg, reduced);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [mcq, backdrop, reduced]);

  const live = state.chosen === null;
  const aimingAt = gateAt(state.y);

  return (
    <div className="relative h-full w-full overflow-hidden bg-[#070b16]" data-flappy-game={mcq.beatId}>
      <canvas ref={canvasRef} className="h-full w-full touch-none" data-flappy-canvas />

      {/* The question, above the flight. */}
      <div className="pointer-events-none absolute inset-x-0 top-0 p-4">
        <p className="mx-auto max-w-3xl rounded-xl bg-black/70 px-5 py-3 text-center text-base font-bold leading-snug text-white backdrop-blur">
          {mcq.question}
        </p>
      </div>

      {/* Gates as DOM, on the right, aligned with the thirds the rules use. */}
      <div className="pointer-events-none absolute inset-y-0 right-0 flex w-[42%] flex-col justify-center gap-2 p-3">
        {mcq.options.map((option, i) => (
          <div
            key={option}
            data-flappy-gate={i}
            className={`flex min-h-[27%] items-center rounded-2xl border-2 px-4 py-3 text-[0.92rem] font-semibold leading-tight transition ${
              live && aimingAt === i
                ? "border-white/70 bg-white/15 text-white"
                : "border-white/12 bg-black/45 text-white/70"
            }`}
            style={live && aimingAt === i ? { borderColor: GATE_TINTS[i], boxShadow: `0 0 24px ${GATE_TINTS[i]}55` } : undefined}
          >
            {option}
          </div>
        ))}
      </div>

      {/* Readable by a test and a screen reader; neither can see a canvas. */}
      <span className="sr-only" data-flappy-state aria-live="polite">
        {result
          ? `finished, ${result.correct ? "correct" : "incorrect"}`
          : `flying, aiming at option ${aimingAt + 1} of 3`}
      </span>

      {!state.started && !result && (
        <div className="absolute inset-0 z-30 grid place-items-center bg-black/65 backdrop-blur-sm">
          <div className="flex max-w-md flex-col items-center gap-3 px-6 text-center">
            <p className="text-[0.72rem] font-black uppercase tracking-[0.18em] text-teal-300">Checkpoint</p>
            <p className="text-sm leading-relaxed text-white/75">
              Tap or press <span className="font-bold text-white">space</span> to fly. Steer through the
              gate that answers the question.
            </p>
            <button
              data-flappy-start
              onClick={() => {
                runRef.current = applyFlappy(runRef.current, { type: "flap" });
                setState(runRef.current);
              }}
              className="rounded-full bg-teal-400/20 px-6 py-2.5 text-sm font-bold text-teal-100 ring-1 ring-teal-400/40 transition hover:bg-teal-400/30"
            >
              Fly
            </button>
          </div>
        </div>
      )}

      {result && (
        <div className="absolute inset-0 z-30 grid place-items-center bg-black/78 backdrop-blur-sm">
          <div className="flex max-w-lg flex-col items-center gap-3 px-6 text-center">
            <p className={`text-3xl font-black ${result.correct ? "text-emerald-300" : "text-amber-300"}`}>
              {result.correct ? "Right through it!" : "Not that gate"}
            </p>
            {/* Always show the answer on a miss. A round that only says "wrong" teaches nothing. */}
            {!result.correct && (
              <p className="text-sm leading-relaxed text-white/75">
                The answer was <span className="font-bold text-white">{mcq.options[mcq.answer]}</span>.
              </p>
            )}
            <button
              data-flappy-continue
              onClick={() => doneRef.current(result.correct)}
              className="rounded-full bg-teal-400/15 px-6 py-2.5 text-sm font-bold text-teal-200 ring-1 ring-teal-400/30 transition hover:bg-teal-400/25"
            >
              Continue →
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Paint one frame.
 *
 * Everything here is derived from the state it is handed — there is no game logic in this function,
 * which is what keeps it safe to rewrite for looks without breaking a rule.
 */
function draw(
  canvas: HTMLCanvasElement | null,
  run: FlappyState,
  paths: TilePath[],
  mcq: Mcq,
  bg: HTMLImageElement | null,
  reduced: boolean,
) {
  if (!canvas) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
    canvas.width = w * dpr;
    canvas.height = h * dpr;
  }
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);

  // The flight field is the left 58%; the gates own the right.
  const fieldW = w * 0.58;

  ctx.fillStyle = "#070b16";
  ctx.fillRect(0, 0, w, h);

  /*
   * Everything after this is clipped to the field.
   *
   * Without it the pipes drew straight across the answer cards — obstacles printed over the thing
   * the learner is trying to read, which made the gates look like part of the course rather than
   * the choice at the end of it.
   */
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, fieldW, h);
  ctx.clip();
  if (bg?.complete && bg.naturalWidth > 0) {
    ctx.globalAlpha = 0.3;
    const scale = Math.max(w / bg.naturalWidth, h / bg.naturalHeight);
    ctx.drawImage(bg, (w - bg.naturalWidth * scale) / 2, (h - bg.naturalHeight * scale) / 2,
                  bg.naturalWidth * scale, bg.naturalHeight * scale);
    ctx.globalAlpha = 1;
  }

  // Lane guides at the thirds, so the mapping from height to gate is visible rather than guessed.
  ctx.strokeStyle = "rgba(255,255,255,0.08)";
  ctx.lineWidth = 1;
  for (const t of [1 / 3, 2 / 3]) {
    ctx.beginPath();
    ctx.moveTo(0, h * t);
    ctx.lineTo(w, h * t);
    ctx.stroke();
  }

  /*
   * The three trails.
   *
   * Drawn as routes rather than hazards: a faint line through each trail's tiles so the shape of
   * the route reads at a glance, and the tiles themselves brighten as they are passed. The learner
   * should be able to see which answer they are flying toward well before they arrive.
   */
  const px = (at: number) => fieldW * (0.22 + (at - run.progress) * 2.4);
  paths.forEach((path) => {
    const tint = GATE_TINTS[path.gate];
    const aimed = gateAt(run.y) === path.gate;

    ctx.strokeStyle = `${tint}${aimed ? "66" : "22"}`;
    ctx.lineWidth = aimed ? 3 : 2;
    ctx.beginPath();
    path.tiles.forEach((t, i) => {
      const x = px(t.at);
      const y = h * t.y;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();

    path.tiles.forEach((t) => {
      const x = px(t.at);
      if (x < -40 || x > fieldW + 20) return;
      const passed = run.progress > t.at;
      const y = h * t.y;
      ctx.fillStyle = passed ? tint : `${tint}${aimed ? "55" : "26"}`;
      ctx.beginPath();
      ctx.roundRect(x - 15, y - 7, 30, 14, 5);
      ctx.fill();
      if (passed) {
        ctx.strokeStyle = `${tint}99`;
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
    });
  });

  /* The three gate mouths at the right edge of the field, tinted to match the DOM cards. */
  for (let i = 0; i < 3; i++) {
    const top = (h / 3) * i;
    ctx.fillStyle = `${GATE_TINTS[i]}${i === gateAt(run.y) ? "44" : "1a"}`;
    ctx.fillRect(fieldW - 10, top + 6, 14, h / 3 - 12);
  }

  /* The bird. */
  const bx = fieldW * 0.22;
  const by = h * run.y;
  ctx.save();
  ctx.translate(bx, by);
  if (!reduced) ctx.rotate(Math.max(-0.5, Math.min(0.8, run.vy * 0.6)));
  ctx.fillStyle = "#fbbf24";
  ctx.beginPath();
  ctx.ellipse(0, 0, 15, 12, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#f59e0b";
  ctx.beginPath();
  ctx.ellipse(-4, 2, 8, 6, -0.4, 0, Math.PI * 2); // wing
  ctx.fill();
  ctx.fillStyle = "#0f172a";
  ctx.beginPath();
  ctx.arc(6, -3, 2.2, 0, Math.PI * 2); // eye
  ctx.fill();
  ctx.restore();

  ctx.restore();

  /* Progress along the course — the only number on the canvas. */
  ctx.fillStyle = "rgba(45,212,191,0.35)";
  ctx.fillRect(0, h - 4, fieldW * run.progress, 4);
  void mcq;
}

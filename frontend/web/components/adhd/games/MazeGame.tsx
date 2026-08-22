"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Mcq } from "@/lib/adhd/games/mcq";
import {
  mazeFor, initialMaze, move, seedFrom, dirForKey,
  N, E, S, W, type Dir, type MazeState,
} from "@/lib/adhd/games/mazeRules";
import { useReducedMotion } from "@/lib/anim/useReducedMotion";

/**
 * The checkpoint maze.
 *
 * Arrow keys (or WASD) walk a grid of walls; the three answers sit in three corners, and stepping
 * onto one commits it. A plain 2D canvas — a maze is lines and a dot, and no engine makes that
 * better.
 *
 * THE RULES ARE NOT IN THIS FILE. Generation, movement, walls and answering all live in
 * `lib/adhd/games/mazeRules.ts` as pure functions. That is what let a real bug get caught before
 * anyone played it: the route to one answer used to pass straight through another answer's cell and
 * commit the wrong one, which a flood-fill test found and no amount of playing would have.
 *
 * OPTION TEXT IS DOM. Canvas text has bitten this twice — lesson content is full of ₂, →, Δ, and a
 * canvas rasterises from one font. The labels are real DOM, so every glyph the page can render works
 * and a screen reader can read them.
 */

const TINTS = ["#2dd4bf", "#a78bfa", "#fbbf24"] as const;
/**
 * Each goal is NUMBERED, in the grid and on its card.
 *
 * Two problems solved by one marker. The cards used to sit on top of the corners they described,
 * covering about three rows of grid including two answer cells and the corridors to them — a card
 * over a corridor is indistinguishable from a wall, which is why the maze read as unsolvable. And
 * naming corners instead ("bottom-right") is only approximate: an answer sits on the nearest DEAD
 * END to its corner, which can be several cells away. A number on the cell and the same number on
 * the card is exact wherever the cell ends up.
 */
const MARKERS = ["1", "2", "3"] as const;

export function MazeGame({
  mcq,
  onDone,
}: {
  mcq: Mcq;
  onDone: (correct: boolean) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const reduced = useReducedMotion();

  const maze = useMemo(() => mazeFor(seedFrom(mcq.beatId)), [mcq.beatId]);
  const [state, setState] = useState<MazeState>(() => initialMaze(maze));
  const [started, setStarted] = useState(false);

  const doneRef = useRef(onDone);
  useEffect(() => { doneRef.current = onDone; });

  const step = useCallback((dir: Dir) => {
    setStarted(true);
    setState((s) => move(maze, s, dir));
  }, [maze]);

  /* Keyboard. Arrows are captured so the page cannot scroll out from under the maze. */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const dir = dirForKey(e.code);
      if (!dir) return;
      e.preventDefault();
      step(dir);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [step]);

  /* Paint. Cheap enough to redraw on every state change — a move is a keypress, not a frame. */
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const box = Math.min(canvas.clientWidth, canvas.clientHeight);
    if (canvas.width !== box * dpr || canvas.height !== box * dpr) {
      canvas.width = box * dpr;
      canvas.height = box * dpr;
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, box, box);

    const pad = 10;
    const cell = (box - pad * 2) / maze.size;
    const px = (i: number) => pad + i * cell;

    ctx.fillStyle = "#f8fafc";
    ctx.fillRect(pad - 4, pad - 4, box - pad * 2 + 8, box - pad * 2 + 8);

    /* The answer cells, tinted, so the destinations read before the walls do. */
    maze.answers.forEach((a, i) => {
      ctx.fillStyle = TINTS[i];
      ctx.fillRect(px(a.x), px(a.y), cell, cell);
      // The number, so a goal is identifiable wherever its dead end happens to be — and still
      // readable once the player is standing on it.
      ctx.fillStyle = "#0b1220";
      ctx.font = `700 ${Math.round(cell * 0.62)}px system-ui, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(MARKERS[i], px(a.x) + cell / 2, px(a.y) + cell / 2 + cell * 0.02);
    });

    /* Breadcrumbs — where you have already been. A maze without them is a memory test. */
    if (!reduced) {
      ctx.fillStyle = "rgba(56,189,248,0.16)";
      for (const c of state.trail) ctx.fillRect(px(c.x) + 2, px(c.y) + 2, cell - 4, cell - 4);
    }

    /* Walls. */
    ctx.strokeStyle = "#0f172a";
    ctx.lineWidth = Math.max(2, cell * 0.16);
    ctx.lineCap = "square";
    ctx.beginPath();
    for (let y = 0; y < maze.size; y++) {
      for (let x = 0; x < maze.size; x++) {
        const w = maze.walls[y][x];
        const x0 = px(x);
        const y0 = px(y);
        if (w & N) { ctx.moveTo(x0, y0); ctx.lineTo(x0 + cell, y0); }
        if (w & W) { ctx.moveTo(x0, y0); ctx.lineTo(x0, y0 + cell); }
        // Only the far edges need drawing from the far side, or every wall is stroked twice.
        if (x === maze.size - 1 && w & E) { ctx.moveTo(x0 + cell, y0); ctx.lineTo(x0 + cell, y0 + cell); }
        if (y === maze.size - 1 && w & S) { ctx.moveTo(x0, y0 + cell); ctx.lineTo(x0 + cell, y0 + cell); }
      }
    }
    ctx.stroke();

    /* The player. */
    ctx.fillStyle = "#e11d48";
    ctx.beginPath();
    ctx.arc(px(state.at.x) + cell / 2, px(state.at.y) + cell / 2, cell * 0.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 2;
    ctx.stroke();
  }, [maze, state, reduced]);

  const result = state.chosen === null ? null : { picked: state.chosen, correct: state.chosen === mcq.answer };

  return (
    <div className="relative flex h-full w-full flex-col items-center gap-2 overflow-hidden bg-[#0b1220] p-3" data-maze-game={mcq.beatId}>
      <p className="w-full max-w-3xl shrink-0 rounded-xl bg-black/60 px-4 py-2 text-center text-[0.9rem] font-bold leading-snug text-white">
        {mcq.question}
      </p>

      {/*
        The maze and the options sit SIDE BY SIDE and never overlap.
        `min-h-0` matters on the square: without it it refuses to shrink and pushes the question and
        the pad out of a short container instead of getting smaller.
      */}
      <div className="flex min-h-0 w-full flex-1 items-center justify-center gap-4">
        <div className="relative aspect-square h-full max-h-full">
          <canvas ref={canvasRef} className="h-full w-full rounded-xl" data-maze-canvas />
        </div>

        {/* Options as DOM, beside the board — every glyph the page can render, readable by a screen
            reader, and covering none of the maze. */}
        <ul className="flex w-[min(38%,320px)] shrink-0 flex-col gap-2">
          {mcq.options.map((option, i) => (
            <li
              key={option}
              data-maze-option={i}
              className="flex items-start gap-2.5 rounded-xl bg-white/[0.05] px-3 py-2 text-[0.82rem] font-semibold leading-tight text-white/90"
            >
              <span
                className="grid size-6 shrink-0 place-items-center rounded-md text-[0.78rem] font-black text-[#0b1220]"
                style={{ background: TINTS[i] }}
              >
                {MARKERS[i]}
              </span>
              <span className="min-w-0">{option}</span>
            </li>
          ))}
        </ul>
      </div>

      {/* On-screen controls: the maze must be playable without a keyboard. */}
      <div className="grid shrink-0 grid-cols-3 gap-1.5" data-maze-pad>
        <span />
        <PadButton dir="up" onPress={step} label="↑" />
        <span />
        <PadButton dir="left" onPress={step} label="←" />
        <PadButton dir="down" onPress={step} label="↓" />
        <PadButton dir="right" onPress={step} label="→" />
      </div>

      <span className="sr-only" data-maze-state aria-live="polite">
        {result
          ? `finished, ${result.correct ? "correct" : "incorrect"}`
          : `at row ${state.at.y + 1}, column ${state.at.x + 1}, ${state.moves} moves`}
      </span>

      {!started && !result && (
        <p className="text-[0.75rem] text-white/45">
          Arrow keys or WASD — reach the corner that answers the question.
        </p>
      )}

      {result && (
        <div className="absolute inset-0 z-30 grid place-items-center bg-black/80 backdrop-blur-sm">
          <div className="flex max-w-lg flex-col items-center gap-3 px-6 text-center">
            <p className={`text-3xl font-black ${result.correct ? "text-emerald-300" : "text-amber-300"}`}>
              {result.correct ? "That's the one!" : "Not that corner"}
            </p>
            {/* Always show the answer on a miss — a round that only says "wrong" teaches nothing. */}
            {!result.correct && (
              <p className="text-sm leading-relaxed text-white/75">
                The answer was <span className="font-bold text-white">{mcq.options[mcq.answer]}</span>.
              </p>
            )}
            <button
              data-maze-continue
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

function PadButton({ dir, label, onPress }: { dir: Dir; label: string; onPress: (d: Dir) => void }) {
  return (
    <button
      data-maze-move={dir}
      aria-label={`Move ${dir}`}
      onClick={() => onPress(dir)}
      className="grid size-10 place-items-center rounded-lg border border-white/12 bg-white/[0.06] text-white/70 transition hover:bg-white/15"
    >
      {label}
    </button>
  );
}

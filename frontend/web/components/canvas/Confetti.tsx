"use client";

import { useMemo } from "react";
import { useReducedMotion } from "@/lib/anim/useReducedMotion";

/**
 * A short burst of confetti — ONLY for a correct answer (a predict question got right, a drawing
 * Aria checked and accepted), never for reaching the end of a lesson: celebration that rewards
 * attention rather than understanding is the kind of gamification the evidence warns about.
 * Pure CSS, removed by the caller after ~1.6 s; nothing at all under reduced motion.
 */
const COLORS = ["#ff6b4a", "#1fa4a0", "#f2b233", "#7a6ff0", "#22c55e"];

export function Confetti({ seed }: { seed: number }) {
  const reduced = useReducedMotion();
  const pieces = useMemo(() => {
    // A small seeded generator, so one burst looks the same if it re-renders.
    const rand = (n: number) => {
      const x = Math.sin(seed * 0.0001 + n * 12.9898) * 43758.5453;
      return x - Math.floor(x);
    };
    let n = 0;
    const next = () => rand(++n);
    return Array.from({ length: 42 }, (_, i) => ({
      left: 50 + (next() - 0.5) * 30,
      dx: (next() - 0.5) * 520,
      rise: 140 + next() * 220,
      rot: (next() - 0.5) * 900,
      delay: next() * 120,
      w: 6 + next() * 6,
      color: COLORS[i % COLORS.length],
    }));
  }, [seed]);
  if (reduced) return null;
  return (
    <div className="pointer-events-none absolute inset-0 z-30 overflow-hidden" aria-hidden="true">
      <style>{`@keyframes cv-confetti { 0% { transform: translate(0,0) rotate(0); opacity: 1; } 35% { transform: translate(calc(var(--dx) * .55), calc(var(--rise) * -1)) rotate(calc(var(--rot) * .4)); opacity: 1; } 100% { transform: translate(var(--dx), 260px) rotate(var(--rot)); opacity: 0; } }`}</style>
      {pieces.map((p, i) => (
        <span
          key={i}
          className="absolute top-[45%] block rounded-[2px]"
          style={{
            left: `${p.left}%`,
            width: p.w,
            height: p.w * 0.45,
            background: p.color,
            animation: `cv-confetti 1500ms cubic-bezier(.2,.7,.3,1) ${p.delay}ms both`,
            ["--dx" as string]: `${p.dx}px`,
            ["--rise" as string]: `${p.rise}px`,
            ["--rot" as string]: `${p.rot}deg`,
          }}
        />
      ))}
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";
import { arrangeRadial } from "../../lib/anim/arrange";
import { laggedRange } from "../../lib/anim/compose";
import { useReducedMotion } from "../../lib/anim/useReducedMotion";

export type AnimationTemplate = "process" | "shrink" | "cycle" | "build" | "compare" | "transform";

export interface SceneStep {
  id: string;
  label: string;
  detail?: string;
  emphasis?: boolean;
  side?: "a" | "b";
}

export interface AnimatedScene {
  template: AnimationTemplate;
  caption?: string;
  steps: SceneStep[];
  compareLabels?: { a: string; b: string };
}

const TICK_MS = 1500;

/**
 * The motion-visual layer: visuals that DEMONSTRATE a concept by moving, not static
 * labeled boxes. One generic component drives a shared "active step" clock; each
 * template paints that clock differently. Topic-agnostic — the reasoning layer (mock or
 * LLM) picks the template + fills the steps, this just animates whatever it's handed.
 */
export function AnimatedScene({ scene, progress }: { scene: AnimatedScene; progress?: number }) {
  // Re-mount (resetting the animation clock) whenever the beat's scene changes, so the
  // inner component can start from active=0 via useState initialiser — no setState-in-effect.
  const sceneKey = `${scene.template}:${scene.steps.map((s) => s.id).join(",")}`;
  return <SceneClock key={sceneKey} scene={scene} progress={progress} />;
}

function SceneClock({ scene, progress }: { scene: AnimatedScene; progress?: number }) {
  const stepCount = Math.max(1, scene.steps.length);
  const [ticked, setTicked] = useState(0);
  const reducedMotion = useReducedMotion();

  // A caller that has a narration clock passes `progress`, and the scene follows the words.
  // The free-running TICK_MS interval is the fallback for standalone/demo use: it can never
  // line up with what the tutor is saying, because nothing tells it what that is.
  const externallyDriven = typeof progress === "number";

  useEffect(() => {
    if (externallyDriven || reducedMotion) return;
    const id = setInterval(() => setTicked((a) => (a + 1) % (stepCount + 1)), TICK_MS);
    return () => clearInterval(id);
  }, [stepCount, externallyDriven, reducedMotion]);

  // Narration-driven: map 0-1 onto step indices, holding the last step to the end rather
  // than wrapping. Reduced motion: jump straight to the completed scene.
  const sceneProgress = externallyDriven ? Math.max(0, Math.min(1, progress)) : 0;
  const active = externallyDriven
    ? Math.min(stepCount - 1, Math.floor(sceneProgress * stepCount))
    : reducedMotion
      ? stepCount - 1
      : ticked;

  return (
    <section className="relative flex min-h-[640px] flex-col overflow-hidden rounded-[1.75rem] border border-slate-200 bg-[#0b1020] p-8 text-white">
      <BoardGlow />
      <div className="relative flex items-center justify-between">
        <div>
          <p className="text-sm font-bold uppercase tracking-[0.18em] text-indigo-300">Live demonstration</p>
          {scene.caption && <h2 className="mt-1 text-3xl font-black tracking-tight">{scene.caption}</h2>}
        </div>
        <TemplateBadge template={scene.template} />
      </div>

      <div className="relative mt-6 flex flex-1 items-center justify-center">
        <SceneBody scene={scene} active={active} />
      </div>

      <StepDots count={stepCount} active={Math.min(active, stepCount - 1)} />
    </section>
  );
}

function SceneBody({ scene, active }: { scene: AnimatedScene; active: number }) {
  switch (scene.template) {
    case "shrink":
      return <ShrinkScene steps={scene.steps} active={active} />;
    case "cycle":
      return <CycleScene steps={scene.steps} active={active} />;
    case "build":
      return <BuildScene steps={scene.steps} active={active} />;
    case "compare":
      return <CompareScene steps={scene.steps} labels={scene.compareLabels} active={active} />;
    case "transform":
      return <TransformScene steps={scene.steps} active={active} />;
    case "process":
    default:
      return <ProcessScene steps={scene.steps} active={active} />;
  }
}

/* ----------------------------- process ----------------------------- */
// Ordered steps advance through; a glowing token sweeps through, each step lights as the
// token reaches it. Horizontal for short sequences, vertical for longer ones so it never
// wraps into a messy grid. The classic "and then... and then..." teaching motion.
function ProcessScene({ steps, active }: { steps: SceneStep[]; active: number }) {
  const vertical = steps.length > 4;
  return (
    <div className={`flex w-full items-stretch justify-center ${vertical ? "flex-col gap-3" : "gap-3"} ${vertical ? "max-w-xl" : ""}`}>
      {steps.map((step, i) => {
        const reached = i <= active;
        const isActive = i === active;
        return (
          <div key={step.id} className={`flex ${vertical ? "flex-col" : "items-center"} gap-2`}>
            <div
              className={`flex flex-col rounded-2xl border-2 p-4 transition-all duration-500 ${vertical ? "w-full flex-row items-center gap-4" : "w-44"} ${
                isActive
                  ? "scale-[1.03] border-indigo-300 bg-indigo-500/30 shadow-[0_0_40px_rgba(129,140,248,0.45)]"
                  : reached
                    ? "border-indigo-400/40 bg-white/5"
                    : "border-white/10 bg-white/[0.02] opacity-40"
              }`}
            >
              <span className={`grid size-8 shrink-0 place-items-center rounded-full text-sm font-black ${isActive ? "bg-indigo-300 text-indigo-950" : "bg-white/10 text-indigo-200"}`}>
                {i + 1}
              </span>
              <div className={vertical ? "flex flex-1 flex-col text-left" : "mt-2"}>
                <span className="text-lg font-black leading-tight">{step.label}</span>
                {step.detail && isActive && (
                  <span className="mt-0.5 text-sm font-semibold text-indigo-100/80">{step.detail}</span>
                )}
              </div>
            </div>
            {i < steps.length - 1 && (
              <span className={`font-black transition-colors duration-500 ${vertical ? "ml-4 text-2xl leading-none" : "text-2xl"} ${i < active ? "text-indigo-300" : "text-white/15"}`}>
                {vertical ? "↓" : "→"}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ----------------------------- shrink ----------------------------- */
// A set of items where, each tick, a growing share is "eliminated" (crossed out, faded).
// Demonstrates search / filtering / narrowing-down by literally removing possibilities.
function ShrinkScene({ steps, active }: { steps: SceneStep[]; active: number }) {
  // Each tick eliminates roughly half of what remains (binary-search-like intuition),
  // but never the emphasized "answer" step.
  const answerIdx = steps.findIndex((s) => s.emphasis);
  const eliminated = new Set<number>();
  let remaining = steps.map((_, i) => i);
  for (let t = 0; t < active; t++) {
    const half = remaining.filter((i) => i !== answerIdx);
    const drop = half.slice(0, Math.ceil(half.length / 2));
    drop.forEach((i) => eliminated.add(i));
    remaining = steps.map((_, i) => i).filter((i) => !eliminated.has(i));
    if (remaining.length <= 1) break;
  }
  return (
    <div className="flex w-full flex-wrap items-center justify-center gap-3">
      {steps.map((step, i) => {
        const gone = eliminated.has(i);
        const survivor = !gone;
        const isAnswer = i === answerIdx && remaining.length <= 1 && survivor;
        return (
          <div
            key={step.id}
            className={`relative grid h-24 w-24 place-items-center rounded-2xl border-2 text-center text-lg font-black transition-all duration-700 ${
              gone
                ? "scale-90 border-rose-500/30 bg-rose-500/5 text-white/25"
                : isAnswer
                  ? "scale-110 border-emerald-300 bg-emerald-500/30 text-white shadow-[0_0_40px_rgba(52,211,153,0.5)]"
                  : "border-indigo-300/60 bg-indigo-500/15 text-white"
            }`}
          >
            {step.label}
            {gone && <span className="absolute inset-0 grid place-items-center text-4xl text-rose-400/70">&times;</span>}
          </div>
        );
      })}
    </div>
  );
}

/* ----------------------------- cycle ----------------------------- */
// Steps arranged on a ring; a token travels around endlessly. For loops / feedback /
// natural cycles where the end feeds the beginning.
function CycleScene({ steps, active }: { steps: SceneStep[]; active: number }) {
  const n = steps.length;
  const radius = 180;
  const cx = 0;
  const cy = 0;
  const cur = active % n;
  // Ring positions come from the shared arrangeRadial (lib/anim/arrange) so this and
  // LiveSketch's CycleScene finally agree on where node 0 sits. arrangeRadial works on the
  // 0-100 board grid, so map its output back onto this scene's centred SVG coordinates.
  const ring = arrangeRadial(n, { center: { x: 50, y: 50 }, radius: 50 });
  const toLocal = (p: { x: number; y: number }) => ({
    x: cx + ((p.x - 50) / 50) * radius,
    y: cy + ((p.y - 50) / 50) * (radius / 0.62),
  });
  return (
    <svg viewBox="-260 -240 520 480" className="h-[460px] w-full">
      <circle cx={cx} cy={cy} r={radius} fill="none" stroke="rgba(129,140,248,0.25)" strokeWidth={2} strokeDasharray="6 8" />
      {steps.map((step, i) => {
        const { x, y } = toLocal(ring[i]);
        const isActive = i === cur;
        return (
          <g key={step.id} style={{ transition: "all 600ms" }}>
            {i < n && (
              <CycleArrow from={i} to={(i + 1) % n} n={n} radius={radius} lit={i === cur} />
            )}
            <circle
              cx={x}
              cy={y}
              r={isActive ? 46 : 38}
              fill={isActive ? "rgba(99,102,241,0.55)" : "rgba(255,255,255,0.06)"}
              stroke={isActive ? "#a5b4fc" : "rgba(255,255,255,0.18)"}
              strokeWidth={isActive ? 3 : 2}
              style={{ transition: "all 500ms", filter: isActive ? "drop-shadow(0 0 18px rgba(129,140,248,0.7))" : "none" }}
            />
            <text x={x} y={y + 5} textAnchor="middle" className="fill-white font-black" style={{ fontSize: 14 }}>
              {step.label.length > 12 ? `${step.label.slice(0, 11)}…` : step.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function CycleArrow({ from, to, n, radius, lit }: { from: number; to: number; n: number; radius: number; lit: boolean }) {
  const a1 = (from / n) * Math.PI * 2 - Math.PI / 2;
  const a2 = (to / n) * Math.PI * 2 - Math.PI / 2;
  const r = radius;
  const x1 = Math.cos(a1) * r;
  const y1 = Math.sin(a1) * r;
  const x2 = Math.cos(a2) * r;
  const y2 = Math.sin(a2) * r;
  const large = 0;
  const sweep = 1;
  return (
    <path
      d={`M ${x1} ${y1} A ${r} ${r} 0 ${large} ${sweep} ${x2} ${y2}`}
      fill="none"
      stroke={lit ? "#a5b4fc" : "rgba(255,255,255,0.12)"}
      strokeWidth={lit ? 4 : 2}
      style={{ transition: "all 500ms" }}
    />
  );
}

/* ----------------------------- build ----------------------------- */
// Parts assemble into a whole, one piece at a time, stacking up. For "how X is made /
// composed" concepts.
//
// The per-piece offset comes from `laggedRange` (Manim's LaggedStart) rather than a flat
// `i * 40ms`: the schedule is normalised over the whole group, so the last piece of a
// nine-item stack lands at the same point in the window as the last piece of a three-item
// one, instead of trailing three times further behind.
const BUILD_LAG = { lagRatio: 0.32 } as const;
const BUILD_STAGGER_MS = 340;
function BuildScene({ steps, active }: { steps: SceneStep[]; active: number }) {
  return (
    <div className="flex w-full flex-col items-center gap-3">
      {steps.map((step, i) => {
        const placed = i <= active;
        const isActive = i === active;
        return (
          <div
            key={step.id}
            className={`w-full max-w-lg rounded-2xl border-2 p-4 text-center text-lg font-black transition-all duration-700 ${
              placed
                ? isActive
                  ? "translate-y-0 border-amber-300 bg-amber-400/25 text-white opacity-100 shadow-[0_0_36px_rgba(251,191,36,0.4)]"
                  : "translate-y-0 border-amber-400/40 bg-white/5 text-white opacity-100"
                : "translate-y-6 border-white/10 bg-white/[0.02] text-white/30 opacity-0"
            }`}
            style={{ transitionDelay: placed ? `${Math.round(laggedRange(i, steps.length, BUILD_LAG).start * BUILD_STAGGER_MS)}ms` : "0ms" }}
          >
            {step.label}
            {step.detail && isActive && <p className="mt-1 text-sm font-semibold text-amber-100/80">{step.detail}</p>}
          </div>
        );
      })}
    </div>
  );
}

/* ----------------------------- compare ----------------------------- */
// Two columns side by side; their rows reveal in step, differences pulsing. For
// "X vs Y" / contrast concepts.
function CompareScene({ steps, labels, active }: { steps: SceneStep[]; labels?: { a: string; b: string }; active: number }) {
  const a = steps.filter((s) => s.side !== "b");
  const b = steps.filter((s) => s.side === "b");
  const col = (items: SceneStep[], title: string, accent: string) => (
    <div className="flex-1 rounded-2xl border border-white/10 bg-white/[0.03] p-5">
      <p className={`text-center text-lg font-black ${accent}`}>{title}</p>
      <div className="mt-4 flex flex-col gap-3">
        {items.map((step, i) => {
          const shown = i <= active;
          const isActive = i === active;
          return (
            <div
              key={step.id}
              className={`rounded-xl border-2 p-3 text-center font-bold transition-all duration-500 ${
                shown
                  ? isActive
                    ? "scale-105 border-white/60 bg-white/15 text-white"
                    : "border-white/15 bg-white/5 text-white/90"
                  : "border-white/5 bg-transparent text-white/20 opacity-0"
              }`}
            >
              {step.label}
            </div>
          );
        })}
      </div>
    </div>
  );
  return (
    <div className="flex w-full max-w-3xl gap-5">
      {col(a, labels?.a ?? "Option A", "text-sky-300")}
      {col(b.length ? b : [], labels?.b ?? "Option B", "text-rose-300")}
    </div>
  );
}

/* ----------------------------- transform ----------------------------- */
// One thing morphs into another across stages: each stage cross-fades into the next,
// scaling slightly, so it reads as a single thing changing rather than a list.
function TransformScene({ steps, active }: { steps: SceneStep[]; active: number }) {
  const idx = Math.min(active, steps.length - 1);
  return (
    <div className="relative grid w-full max-w-xl place-items-center">
      <div className="relative h-56 w-full">
        {steps.map((step, i) => {
          const isCurrent = i === idx;
          return (
            <div
              key={step.id}
              className="absolute inset-0 grid place-items-center transition-all duration-700"
              style={{
                opacity: isCurrent ? 1 : 0,
                transform: isCurrent ? "scale(1)" : "scale(0.9)",
              }}
            >
              <div className="rounded-3xl border-2 border-fuchsia-300 bg-fuchsia-500/25 px-12 py-10 text-center shadow-[0_0_50px_rgba(232,121,249,0.4)]">
                <p className="text-3xl font-black">{step.label}</p>
                {step.detail && <p className="mt-2 text-base font-semibold text-fuchsia-100/80">{step.detail}</p>}
              </div>
            </div>
          );
        })}
      </div>
      <div className="mt-6 flex items-center gap-2">
        {steps.map((step, i) => (
          <span key={step.id} className={`text-sm font-black ${i === idx ? "text-fuchsia-200" : "text-white/30"}`}>
            {step.label}
            {i < steps.length - 1 && <span className="mx-2 text-white/20">&rarr;</span>}
          </span>
        ))}
      </div>
    </div>
  );
}

/* ----------------------------- chrome ----------------------------- */
function StepDots({ count, active }: { count: number; active: number }) {
  return (
    <div className="relative mt-6 flex items-center justify-center gap-2">
      {Array.from({ length: count }).map((_, i) => (
        <span
          key={i}
          className={`h-2 rounded-full transition-all duration-300 ${i === active ? "w-8 bg-indigo-300" : "w-2 bg-white/20"}`}
        />
      ))}
    </div>
  );
}

function TemplateBadge({ template }: { template: AnimationTemplate }) {
  const labels: Record<AnimationTemplate, string> = {
    process: "Step by step",
    shrink: "Narrowing down",
    cycle: "A loop",
    build: "Building up",
    compare: "Side by side",
    transform: "Transforming",
  };
  return (
    <span className="rounded-full bg-white/10 px-4 py-2 text-sm font-black text-indigo-100 ring-1 ring-white/15">
      {labels[template]}
    </span>
  );
}

function BoardGlow() {
  return (
    <div
      className="pointer-events-none absolute inset-0"
      style={{
        backgroundImage:
          "radial-gradient(circle at 20% 18%, rgba(99,102,241,0.22), transparent 42%), radial-gradient(circle at 82% 82%, rgba(232,121,249,0.16), transparent 46%)",
      }}
    />
  );
}

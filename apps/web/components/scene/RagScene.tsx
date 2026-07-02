"use client";

import { useEffect, useMemo, useState } from "react";

/**
 * Bespoke RAG animation — NOT a flowchart. A question physically flies in, a wall of
 * documents sits in the middle, the RELEVANT ones fly out and glow while the rest dim,
 * then they slide into an answer panel that types itself out using them. Real spatial
 * motion on a timeline, looping. This is the "watch the mechanism happen" visual.
 */

type Phase = "ask" | "search" | "retrieve" | "answer" | "hold";

// Timeline (ms): how long each phase lasts before advancing.
const PHASES: { phase: Phase; ms: number }[] = [
  { phase: "ask", ms: 1600 },
  { phase: "search", ms: 1700 },
  { phase: "retrieve", ms: 2200 },
  { phase: "answer", ms: 2600 },
  { phase: "hold", ms: 1800 },
];

const TOTAL = PHASES.reduce((s, p) => s + p.ms, 0);

// 18 docs in the wall; these indices are the "relevant" ones that fly out.
const DOC_COUNT = 18;
const RELEVANT = new Set([3, 7, 10]);
const ANSWER_TEXT = "Vaccines train your immune system using a harmless piece of a germ, so your body recognizes the real one later.";

const DOC_COLORS = ["#a5b4fc", "#67e8f9", "#fcd34d", "#f9a8d4", "#86efac", "#c4b5fd"];

export function RagScene() {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    let raf = 0;
    const start = performance.now();
    const loop = (now: number) => {
      const t = (now - start) % TOTAL;
      setElapsed(t);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  const phase = phaseAt(elapsed);

  // Grid geometry for the document wall (percent-based, within the stage).
  const cols = 3;
  const docs = useMemo(
    () =>
      Array.from({ length: DOC_COUNT }, (_, i) => ({
        i,
        relevant: RELEVANT.has(i),
        color: DOC_COLORS[i % DOC_COLORS.length],
        col: i % cols,
        row: Math.floor(i / cols),
      })),
    []
  );

  // How far along we are in answer typing (0..1) during answer + hold phases.
  const typeProgress = (() => {
    const startAt = PHASES[0].ms + PHASES[1].ms + PHASES[2].ms;
    if (elapsed < startAt) return 0;
    return Math.min(1, (elapsed - startAt) / (PHASES[3].ms * 0.9));
  })();
  const typedChars = Math.floor(typeProgress * ANSWER_TEXT.length);

  return (
    <section className="relative flex min-h-[640px] flex-col overflow-hidden rounded-[1.75rem] border border-slate-200 bg-[#070b1a] p-7 text-white">
      <Glow />
      <div className="relative flex items-center justify-between">
        <div>
          <p className="text-sm font-bold uppercase tracking-[0.18em] text-indigo-300">Live demonstration</p>
          <h2 className="mt-1 text-3xl font-black tracking-tight">Watch RAG find its evidence</h2>
        </div>
        <PhasePill phase={phase} />
      </div>

      {/* Stage */}
      <div className="relative mt-4 flex-1">
        {/* 1. The question, flying in from the left */}
        <QuestionCard phase={phase} />

        {/* 2. The document wall (middle) */}
        <div className="absolute left-1/2 top-1/2 h-[360px] w-[300px] -translate-x-1/2 -translate-y-1/2">
          {docs.map((d) => (
            <DocCard
              key={d.i}
              doc={d}
              cols={cols}
              phase={phase}
            />
          ))}
          {phase === "search" && <ScanSweep />}
        </div>

        {/* 3. The answer panel (right), types itself out */}
        <AnswerPanel
          active={phase === "answer" || phase === "hold"}
          typed={ANSWER_TEXT.slice(0, typedChars)}
          done={typeProgress >= 1}
        />
      </div>

      <Timeline elapsed={elapsed} />
    </section>
  );
}

function phaseAt(t: number): Phase {
  let acc = 0;
  for (const p of PHASES) {
    acc += p.ms;
    if (t < acc) return p.phase;
  }
  return "hold";
}

/* ----------------------------- question ----------------------------- */
function QuestionCard({ phase }: { phase: Phase }) {
  // Slides in from far left during "ask", then parks at the left edge.
  const arrived = phase !== "ask" ? true : false;
  return (
    <div
      className="absolute top-1/2 z-20 w-56 -translate-y-1/2 transition-all duration-[900ms] ease-out"
      style={{
        left: arrived ? "1%" : "-30%",
        opacity: arrived || phase === "ask" ? 1 : 1,
      }}
    >
      <div className="rounded-2xl border-2 border-indigo-300 bg-indigo-500/25 p-4 shadow-[0_0_40px_rgba(129,140,248,0.5)]">
        <p className="text-xs font-black uppercase tracking-wider text-indigo-200">Question</p>
        <p className="mt-1 text-lg font-black leading-snug">How do vaccines work?</p>
      </div>
      {/* a little "beam" pulsing toward the docs once it has arrived */}
      {(phase === "search" || phase === "retrieve") && (
        <div className="absolute right-[-40px] top-1/2 h-1 w-10 -translate-y-1/2 animate-pulse rounded-full bg-indigo-300/70" />
      )}
    </div>
  );
}

/* ----------------------------- documents ----------------------------- */
function DocCard({
  doc,
  cols,
  phase,
}: {
  doc: { i: number; relevant: boolean; color: string; col: number; row: number };
  cols: number;
  phase: Phase;
}) {
  const rows = Math.ceil(DOC_COUNT / cols);
  const cellW = 100 / cols;
  const cellH = 100 / rows;
  const baseLeft = doc.col * cellW + cellW / 2;
  const baseTop = doc.row * cellH + cellH / 2;

  const flying = doc.relevant && (phase === "retrieve" || phase === "answer" || phase === "hold");
  const dimmed = !doc.relevant && (phase === "retrieve" || phase === "answer" || phase === "hold");

  // When flying, relevant docs leave the wall and stack toward the right (the answer side).
  // They settle into a small vertical stack just left of the answer panel.
  const flyOrder = doc.relevant ? [...RELEVANT].indexOf(doc.i) : 0;
  const target = flying
    ? { left: 250, top: 18 + flyOrder * 30 } // percentages overshoot intentionally -> handled via translate
    : { left: baseLeft, top: baseTop };

  const lit = phase === "search" && doc.relevant; // pulse the relevant ones during the scan

  return (
    <div
      className="absolute transition-all duration-[900ms]"
      style={{
        left: `${target.left}%`,
        top: `${target.top}%`,
        transform: "translate(-50%, -50%)",
        transitionTimingFunction: "cubic-bezier(0.5, 0, 0.2, 1)",
        zIndex: flying ? 30 : 10,
      }}
    >
      <div
        className="grid h-12 w-10 place-items-center rounded-md border transition-all duration-500"
        style={{
          borderColor: flying || lit ? doc.color : "rgba(255,255,255,0.18)",
          background: flying || lit ? `${doc.color}33` : "rgba(255,255,255,0.04)",
          opacity: dimmed ? 0.18 : 1,
          boxShadow: flying || lit ? `0 0 18px ${doc.color}aa` : "none",
          transform: lit ? "scale(1.12)" : "scale(1)",
        }}
      >
        <div className="flex flex-col gap-[3px]">
          <span className="block h-[2px] w-5 rounded-full bg-white/60" />
          <span className="block h-[2px] w-4 rounded-full bg-white/40" />
          <span className="block h-[2px] w-5 rounded-full bg-white/40" />
        </div>
      </div>
    </div>
  );
}

function ScanSweep() {
  return (
    <div
      className="pointer-events-none absolute inset-y-0 w-16"
      style={{
        background: "linear-gradient(90deg, transparent, rgba(129,140,248,0.35), transparent)",
        animation: "rag-scan 1.6s linear",
      }}
    />
  );
}

/* ----------------------------- answer ----------------------------- */
function AnswerPanel({ active, typed, done }: { active: boolean; typed: string; done: boolean }) {
  return (
    <div
      className="absolute right-[1%] top-1/2 z-20 w-[300px] -translate-y-1/2 transition-all duration-700"
      style={{ opacity: active ? 1 : 0.25, transform: `translateY(-50%) scale(${active ? 1 : 0.96})` }}
    >
      <div
        className="rounded-2xl border-2 p-5 transition-all duration-500"
        style={{
          borderColor: active ? "#34d399" : "rgba(255,255,255,0.15)",
          background: active ? "rgba(16,185,129,0.12)" : "rgba(255,255,255,0.03)",
          boxShadow: done ? "0 0 44px rgba(52,211,153,0.45)" : "none",
        }}
      >
        <div className="flex items-center justify-between">
          <p className="text-xs font-black uppercase tracking-wider text-emerald-300">Answer</p>
          {done && <span className="rounded-full bg-emerald-400/20 px-2 py-0.5 text-[10px] font-black text-emerald-200">cited ✓</span>}
        </div>
        <p className="mt-2 min-h-[96px] text-base font-bold leading-snug">
          {typed}
          {active && !done && <span className="ml-0.5 inline-block h-4 w-[2px] animate-pulse bg-emerald-300 align-middle" />}
        </p>
        {done && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {["doc 04", "doc 08", "doc 11"].map((c) => (
              <span key={c} className="rounded-md bg-white/10 px-2 py-1 text-[10px] font-bold text-white/70 ring-1 ring-white/15">
                {c}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* ----------------------------- chrome ----------------------------- */
function PhasePill({ phase }: { phase: Phase }) {
  const label: Record<Phase, string> = {
    ask: "A question arrives",
    search: "Searching the shelf",
    retrieve: "Pulling the evidence",
    answer: "Writing the answer",
    hold: "Answer with receipts",
  };
  return (
    <span className="rounded-full bg-white/10 px-4 py-2 text-sm font-black text-indigo-100 ring-1 ring-white/15">
      {label[phase]}
    </span>
  );
}

function Timeline({ elapsed }: { elapsed: number }) {
  return (
    <div className="relative mt-4 h-1.5 overflow-hidden rounded-full bg-white/10">
      <div className="h-full bg-indigo-300/80" style={{ width: `${(elapsed / TOTAL) * 100}%` }} />
    </div>
  );
}

function Glow() {
  return (
    <div
      className="pointer-events-none absolute inset-0"
      style={{
        backgroundImage:
          "radial-gradient(circle at 18% 30%, rgba(99,102,241,0.22), transparent 42%), radial-gradient(circle at 84% 70%, rgba(16,185,129,0.16), transparent 46%)",
      }}
    />
  );
}

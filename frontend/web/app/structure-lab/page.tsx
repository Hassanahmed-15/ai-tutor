"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { StructureBoard } from "@/components/sketch/StructureBoard";
import type { StructureSpec } from "@/lib/structureSpec";

/**
 * `/structure-lab` — the structural board on real specs, driven by one progress slider.
 *
 * Dev-only, and the same idea as /anime-lab: judging whether these boards read well should not
 * require generating a whole lecture and hoping the beat appears.
 *
 *   ?spec=rock-cycle&p=0.8   jump to a progress point for a headless screenshot
 */

const SPECS: Record<string, StructureSpec> = {
  "rock-cycle": {
    kind: "cycle",
    title: "The Rock Cycle",
    nodes: [
      { id: "magma", label: "Magma" },
      { id: "igneous", label: "Igneous rock" },
      { id: "sediment", label: "Sediment" },
      { id: "sedimentary", label: "Sedimentary rock" },
      { id: "metamorphic", label: "Metamorphic rock" },
    ],
    edges: [
      { from: "magma", to: "igneous", label: "cools" },
      { from: "igneous", to: "sediment", label: "weathers" },
      { from: "sediment", to: "sedimentary", label: "compacts" },
      { from: "sedimentary", to: "metamorphic", label: "heat + pressure" },
      { from: "metamorphic", to: "magma", label: "melts" },
    ],
  },
  "tcp-handshake": {
    kind: "state",
    title: "TCP three-way handshake",
    nodes: [
      { id: "closed", label: "CLOSED" },
      { id: "syn", label: "SYN sent" },
      { id: "synack", label: "SYN-ACK received" },
      { id: "estab", label: "ESTABLISHED" },
    ],
    edges: [
      { from: "closed", to: "syn", label: "client SYN" },
      { from: "syn", to: "synack", label: "server SYN-ACK" },
      { from: "synack", to: "estab", label: "client ACK" },
    ],
  },
  "pythagoras": {
    kind: "flow",
    title: "Solving with Pythagoras",
    nodes: [
      { id: "given", label: "a = 3, b = 4" },
      { id: "law", label: "a^2 + b^2 = c^2" },
      { id: "sub", label: "9 + 16 = c^2" },
      { id: "solve", label: "c = 5" },
    ],
    edges: [
      { from: "given", to: "law", label: "apply" },
      { from: "law", to: "sub", label: "substitute" },
      { from: "sub", to: "solve", label: "solve" },
    ],
  },
};

function Inner() {
  const params = useSearchParams();
  const key = params.get("spec") && SPECS[params.get("spec") as string] ? (params.get("spec") as string) : "rock-cycle";
  const [spec, setSpec] = useState(key);
  const [progress, setProgress] = useState(Math.max(0, Math.min(1, Number(params.get("p")) || 0)));

  return (
    <main className="min-h-screen bg-slate-950 p-6 text-white">
      <h1 className="text-2xl font-black">Structural board — spec in, ELK layout out</h1>
      <p className="mt-1 text-sm text-white/60">
        No coordinates come from the model: it supplies nodes and edges, ELK decides every position and
        routes every arrow. Overlap and off-canvas text are not reachable states.
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {Object.keys(SPECS).map((k) => (
          <button
            key={k}
            onClick={() => {
              setSpec(k);
              setProgress(0);
            }}
            className={`rounded-full px-3 py-1.5 text-xs font-black transition ${
              spec === k ? "bg-teal-300 text-slate-950" : "bg-white/10 text-white/70 hover:bg-white/20"
            }`}
          >
            {k}
          </button>
        ))}
      </div>

      <label className="mt-4 block text-sm font-bold">
        progress {progress.toFixed(3)}
        <input
          type="range"
          min={0}
          max={1}
          step={0.001}
          value={progress}
          onChange={(e) => setProgress(Number(e.target.value))}
          className="mt-2 w-full"
        />
      </label>

      <div className="mt-6 h-[420px] max-w-[1000px]">
        <StructureBoard spec={SPECS[spec]} progress={progress} />
      </div>
    </main>
  );
}

export default function StructureLab() {
  return (
    <Suspense fallback={null}>
      <Inner />
    </Suspense>
  );
}

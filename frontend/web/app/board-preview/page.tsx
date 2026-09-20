"use client";

/**
 * A dev-only harness for the teaching board: the real BoardStage, BoardDock and AnnotationLayer,
 * driven by fake content. It exists because the lecture player sits behind auth and a live
 * generation, so the board's layout, transitions and states cannot otherwise be looked at — and
 * every claim about how this feels has to be checkable by eye.
 */
import { useState } from "react";

import { AnnotationLayer, type BoardTool } from "@/components/board/AnnotationLayer";
import { BoardDock } from "@/components/board/BoardDock";
import { BoardStage, type BoardStatus, type BoardTransition } from "@/components/board/BoardStage";
import { EMPTY_ANNOTATIONS, canUndo, undo } from "@/lib/board/annotations";

const CONCEPTS = [
  { id: "c1", title: "What a line of best fit is", body: "y = mx + b" },
  { id: "c2", title: "Measuring the error", body: "Σ(yᵢ − ŷᵢ)²" },
  { id: "c3", title: "Descending the gradient", body: "θ ← θ − α∇J(θ)" },
];

export default function BoardPreview() {
  const [index, setIndex] = useState(0);
  const [tool, setTool] = useState<BoardTool>("none");
  const [annotations, setAnnotations] = useState(EMPTY_ANNOTATIONS);
  const [playing, setPlaying] = useState(true);
  const [transition, setTransition] = useState<BoardTransition>("erase");
  const [status, setStatus] = useState<BoardStatus>({ kind: "ready" });
  const [marksVisible, setMarksVisible] = useState(true);
  const concept = CONCEPTS[index];

  return (
    <main className="flex h-screen flex-col bg-[#0b0c10] text-white">
      <header className="flex shrink-0 items-center justify-between px-4 py-3">
        <p className="text-sm font-medium">Linear regression</p>
        <div className="flex gap-2 text-xs">
          {(["erase", "slide", "none"] as const).map((t) => (
            <button key={t} onClick={() => setTransition(t)} className={`rounded px-2 py-1 ${transition === t ? "bg-white text-black" : "bg-white/10"}`}>{t}</button>
          ))}
          {(["ready", "generating", "paused", "error"] as const).map((s) => (
            <button key={s} onClick={() => setStatus(s === "ready" ? { kind: "ready" } : s === "generating" ? { kind: "generating", label: "Drawing this concept…" } : s === "paused" ? { kind: "paused" } : { kind: "error", label: "This board didn't come out right.", onRetry: () => setStatus({ kind: "ready" }) })} className={`rounded px-2 py-1 ${status.kind === s ? "bg-amber-300 text-black" : "bg-white/10"}`}>{s}</button>
          ))}
          <button onClick={() => setMarksVisible((v) => !v)} className="rounded bg-white/10 px-2 py-1">marks: {marksVisible ? "on" : "off"}</button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 px-3">
        <BoardStage
          boardKey={concept.id}
          transition={transition}
          status={status}
          overlay={
            <AnnotationLayer
              boardId={concept.id}
              tool={tool}
              state={annotations}
              onChange={setAnnotations}
              visible={marksVisible}
            />
          }
        >
          <div className="flex h-full flex-col items-center justify-center gap-4 bg-[#080a0e]">
            <p className="text-xs uppercase tracking-[0.2em] text-white/35">Concept {index + 1}</p>
            <h2 className="font-display text-4xl">{concept.title}</h2>
            <p className="rounded-xl border border-white/10 px-6 py-4 font-mono text-2xl text-amber-200/90">{concept.body}</p>
          </div>
        </BoardStage>
      </div>

      <BoardDock
        playing={playing}
        onTogglePlay={() => setPlaying((p) => !p)}
        onPrevious={() => setIndex((i) => Math.max(0, i - 1))}
        onNext={() => setIndex((i) => Math.min(CONCEPTS.length - 1, i + 1))}
        canGoPrevious={index > 0}
        canGoNext={index < CONCEPTS.length - 1}
        tool={tool}
        onToolChange={setTool}
        onUndo={() => setAnnotations(undo(annotations))}
        canUndo={canUndo(annotations)}
        micOn={false}
        onToggleMic={() => {}}
        micAvailable
        positionLabel={`Part ${index + 1} of ${CONCEPTS.length}`}
      />
    </main>
  );
}

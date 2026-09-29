import type { Beat } from "../lessonContent";
import { animationModelLabel } from "../animationModels";
import { illustrationIdOf } from "./illustratedLayout";

/**
 * What the lecture has cost, BY MODEL — the top-right tag over the board (developer view, see
 * components/sketch/RendererBadge.tsx). Asked for on 2026-09-29.
 *
 * The client cost ledger (lib/costLedger.ts) knows spend by STREAM, not by model. Boards are the
 * exception: each board carries the model that drew it and what it cost (op.model, op.trial.costUsd),
 * so the generation stream is split into those boards plus what remains ("lecture writing": planning,
 * scripts, other boards' engines). Every other stream keeps its own line. Nothing is counted twice:
 * the parts sum to the ledger's total. A lecture served from the cache has no generation spend this
 * session, so its boards' old costs are not shown as if they were being paid now.
 */

type LedgerLine = { usd: number };
export type CostLines = Record<"document" | "planning" | "generation" | "narration" | "questions" | "liveTutor", LedgerLine>;
export type ModelCostPart = { label: string; usd: number };

const STREAM_LABELS: Record<Exclude<keyof CostLines, "generation">, string> = {
  document: "document",
  planning: "planning",
  narration: "narration",
  questions: "questions",
  liveTutor: "live tutor",
};

type BoardOp = { kind: string; code?: string; model?: string; trial?: { costUsd?: number } };

/** Board spend per model, from the boards themselves. Picture boards are one line. */
export function boardCostsByModel(beats: Beat[]): Map<string, number> {
  const byModel = new Map<string, number>();
  for (const beat of beats) {
    for (const op of (beat.draw?.ops ?? []) as unknown as BoardOp[]) {
      const usd = op.kind === "reactAnimation" ? op.trial?.costUsd : undefined;
      if (typeof usd !== "number" || !Number.isFinite(usd) || usd <= 0) continue;
      const label = illustrationIdOf(op.code) ? "Pictures" : animationModelLabel(op.model) ?? "boards";
      byModel.set(label, (byModel.get(label) ?? 0) + usd);
    }
  }
  return byModel;
}

export function modelCostBreakdown(beats: Beat[], lines: CostLines): { totalUsd: number; parts: ModelCostPart[] } {
  const parts: ModelCostPart[] = [];
  const generation = lines.generation.usd;
  if (generation > 0) {
    const boards = boardCostsByModel(beats);
    let boardTotal = 0;
    for (const [label, usd] of boards) {
      parts.push({ label, usd });
      boardTotal += usd;
    }
    // The session total can lag the boards by a poll; never show a negative remainder.
    const rest = generation - boardTotal;
    if (rest > 0.00005) parts.push({ label: "lecture writing", usd: rest });
  }
  for (const [stream, label] of Object.entries(STREAM_LABELS) as Array<[keyof typeof STREAM_LABELS, string]>) {
    if (lines[stream].usd > 0) parts.push({ label, usd: lines[stream].usd });
  }
  parts.sort((a, b) => b.usd - a.usd);
  return { totalUsd: parts.reduce((sum, part) => sum + part.usd, 0), parts };
}

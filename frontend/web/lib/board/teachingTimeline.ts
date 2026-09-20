import type { DrawScript } from "@/components/sketch/LiveSketch";
import { sentenceWeight } from "@/lib/narrationClock";
import { splitNarrationSentences } from "@/lib/voice";

import { resolveOpTiming, sentenceFraction, syncCoverage, type TimedOp } from "./sentenceSync";
import { chooseSurface, toLiveSketchSurface } from "./surfaces";

export interface TeachingTimelineDiagnostics {
  sentenceCount: number;
  boundOps: number;
  unboundOps: number;
  sentencesCovered: number;
  coverage: number;
}

/**
 * One clock for voice and visuals.
 *
 * Generation stores semantic sentence bindings; this adapter turns them into the fractional clock
 * understood by every existing renderer. Old cached `at` values remain valid, so migration never
 * blanks a lesson. A surface is also chosen here when an older board did not declare one.
 */
export function coordinateTeachingTimeline(
  draw: DrawScript,
  lesson: { title: string; objective?: string; script: string },
): { draw: DrawScript; diagnostics: TeachingTimelineDiagnostics } {
  const sentences = splitNarrationSentences(lesson.script);
  const weights = sentences.map(sentenceWeight);
  const timed = draw.ops as Array<DrawScript["ops"][number] & TimedOp>;
  const resolved = resolveOpTiming(timed, weights).map((op) => {
    if (typeof op.untilSentence !== "number" || !("endAt" in op)) return op;
    return { ...op, endAt: sentenceFraction(Math.min(sentences.length - 1, op.untilSentence + 1), weights) };
  }) as DrawScript["ops"];
  const coverage = syncCoverage(timed, sentences.length);
  const choice = chooseSurface(lesson);
  const surface = draw.surface ?? (choice.surface === "split" ? "split" : toLiveSketchSurface(choice.surface));
  const panes = draw.panes ?? (choice.panes
    ? { left: toLiveSketchSurface(choice.panes.left), right: toLiveSketchSurface(choice.panes.right) }
    : undefined);

  return {
    draw: { ...draw, surface, panes, ops: resolved },
    diagnostics: {
      sentenceCount: sentences.length,
      boundOps: coverage.bound,
      unboundOps: coverage.unbound,
      sentencesCovered: coverage.sentencesCovered,
      coverage: coverage.coverage,
    },
  };
}


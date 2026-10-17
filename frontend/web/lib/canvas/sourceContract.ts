import { visualRequirements } from "../curriculum/lessonSpec";
import { nativeStageFor } from "./visualPolicy";
import type { CanvasPlanBeat } from "./types";

/**
 * THE COURSE'S VISUAL CONTRACT, FOR A TYPED, PDF OR VIDEO LESSON.
 *
 * A course board's stage comes from a deterministic contract (lib/curriculum/lessonSpec.ts
 * visualRequirements): figure, molecule, atom map, graph, equation, compare, flow, illustration or
 * code — never a free-form "diagram" — and the contract's must-show parts are checked and labelled.
 * Typed, PDF and video lessons had no contract, so their planner picked "diagram" boards that no
 * course ever gets, and those were the badly labelled ones ("courses don't have this problem" —
 * owner, 2026-10-17). Each of their boards now gets the same contract from its own title and brief.
 *
 * A purpose-built stage the planner chose and the contract cannot express (a data structure, code,
 * a graph, an equation, a molecule, an atom map, a figure kit) is kept: it joins the contract's
 * stages. A planned "diagram" is replaced the way a course board's would be.
 */
const PURPOSE_BUILT = new Set(["structure", "code", "graph", "equation", "molecule", "atom-map", "figure"]);

export function withCourseContract(beat: CanvasPlanBeat): CanvasPlanBeat {
  if (beat.refresher || beat.overview || beat.stage === "exam" || beat.requiredVisual) return beat;
  const [req] = visualRequirements([{ code: null, text: `${beat.title}. ${beat.brief ?? ""}` }]);
  if (!req?.required) {
    // No contract stage for this board: a planned "diagram" becomes the native board a course would draw.
    return beat.stage === "diagram" ? { ...beat, stage: nativeStageFor(beat), figure: undefined } : beat;
  }
  const stages = [...req.preferredStages];
  if (PURPOSE_BUILT.has(beat.stage) && !stages.includes(beat.stage)) stages.unshift(beat.stage);
  const next: CanvasPlanBeat = { ...beat, requiredVisual: { stages, mustShow: req.mustShow } };
  // The contract decides a planned "diagram" (lib/canvas/visualPolicy.ts applies the contract stage).
  if (beat.stage === "diagram") Object.assign(next, { stage: stages[0], figure: undefined });
  return next;
}

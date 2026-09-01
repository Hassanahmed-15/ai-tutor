/**
 * The stages a lesson build actually passes through, and how they become a percentage.
 *
 * WHY THIS EXISTS. The build screen used to show one line of status text that changed twice in
 * four minutes, so a student could not tell a slow lecture from a dead one. The fix is not a
 * smoother spinner — it is telling them what the pipeline is really doing.
 *
 * NOTHING HERE IS A TIMER. Percentage comes from which stages have genuinely COMPLETED in
 * app/api/generate-lecture/route.ts, never from elapsed time. That distinction is the whole point:
 * a progress bar that advances on a clock is a lie that gets found out precisely when the build is
 * slow and the student most needs the truth. The one place time is used at all is the remaining
 * estimate, which is explicitly labelled as an estimate and is allowed to be wrong.
 *
 * STAGES ARE PIPELINE BOUNDARIES, NOT WISHES. Each stage below ends at a point where real work
 * finishes and the next call has not yet started. That is why there is no separate "writing quiz
 * questions" stage: the checkpoint questions are written inside the same model call that writes
 * the script, so a stage for them could only ever be decorative. Merging them into "Designing
 * explanations and questions" is less tidy than the eight-item wishlist and considerably more
 * honest.
 */

export type LessonDesignStageId =
  | "analyzing"
  | "concepts"
  | "structuring"
  | "explanations"
  | "visuals"
  | "activities"
  | "finalizing";

export type LessonDesignStage = {
  id: LessonDesignStageId;
  /** Shown in the stage checklist. Present tense — it is what Aria is doing right now. */
  label: string;
  /** Spoken by Gemini Live on entry. Written to be said aloud, not read. */
  spoken: string;
  /**
   * Share of the whole build, 0-1. These are measured shares, not equal slices: the parallel asset
   * fill genuinely dominates a build, and pretending each stage is one seventh would make the bar
   * sprint to 70% and then sit still for two minutes.
   */
  weight: number;
};

/**
 * Weights sum to 1. They come from where wall-clock time actually goes in a build: the script call
 * and the parallel fill block are most of it, and the finalize passes are near-instant.
 */
export const LESSON_DESIGN_STAGES: LessonDesignStage[] = [
  {
    id: "analyzing",
    label: "Analyzing your material",
    spoken: "I'm reading through your material now.",
    weight: 0.08,
  },
  {
    id: "concepts",
    label: "Identifying key concepts",
    spoken: "I'm picking out the key concepts worth teaching.",
    weight: 0.07,
  },
  {
    id: "structuring",
    label: "Structuring the lesson",
    spoken: "I'm laying out the order the lesson should follow.",
    weight: 0.3,
  },
  {
    id: "explanations",
    label: "Designing explanations and questions",
    spoken: "I'm writing the explanations and the questions I'll ask you along the way.",
    weight: 0.1,
  },
  {
    id: "visuals",
    label: "Preparing visual and board content",
    spoken: "I'm drawing the board content for each section.",
    weight: 0.28,
  },
  {
    id: "activities",
    label: "Preparing activities and labels",
    spoken: "I'm setting up the interactive parts and labelling the diagrams.",
    weight: 0.12,
  },
  {
    id: "finalizing",
    label: "Finalizing your live lesson",
    spoken: "I'm putting the finishing touches on your lesson.",
    weight: 0.05,
  },
];

export const FIRST_STAGE: LessonDesignStageId = LESSON_DESIGN_STAGES[0].id;

export function stageById(id: string): LessonDesignStage | null {
  return LESSON_DESIGN_STAGES.find((stage) => stage.id === id) ?? null;
}

export function stageIndex(id: string): number {
  return LESSON_DESIGN_STAGES.findIndex((stage) => stage.id === id);
}

/**
 * Fraction complete, 0-1, from the CURRENT stage plus how far into it the pipeline reports being.
 *
 * Every stage before the current one is counted whole; the current one contributes its weight
 * scaled by `stageFraction`. That inner fraction is only ever supplied where the pipeline can
 * genuinely count something — chunked PDF generation knows it has finished four of eleven
 * sections — and defaults to 0 everywhere else rather than being invented.
 *
 * Deliberately never returns 1 for a running build. A bar sitting on 100% while the screen has not
 * changed is the single worst state a progress UI can be in, so completion is a state the caller
 * sets when the job is genuinely done, not a number this function can drift into.
 */
export function progressFor(stage: string, stageFraction = 0): number {
  const index = stageIndex(stage);
  if (index < 0) return 0;
  const clamped = Math.max(0, Math.min(1, stageFraction));
  let done = 0;
  for (let i = 0; i < index; i++) done += LESSON_DESIGN_STAGES[i].weight;
  const total = done + LESSON_DESIGN_STAGES[index].weight * clamped;
  // Cap below 1 so only genuine completion shows 100%.
  return Math.min(0.99, total);
}

/** The stages already finished when `stage` is current — for the ✓ list. */
export function completedStages(stage: string): LessonDesignStageId[] {
  const index = stageIndex(stage);
  if (index < 0) return [];
  return LESSON_DESIGN_STAGES.slice(0, index).map((s) => s.id);
}

/**
 * Rough seconds remaining, or null when there is not enough evidence to say.
 *
 * Extrapolated from the build's OWN pace: if 40% took 60 seconds, the remaining 60% will take
 * about 90. That is a real estimate from real elapsed time against real completed work, and it
 * self-corrects as the build goes — unlike a fixed "about four minutes" which is wrong for every
 * lecture that is not average.
 *
 * Returns null below a floor of measured progress, because dividing by a tiny fraction produces
 * confident nonsense ("47 minutes remaining") in the first seconds of a build. Callers show
 * nothing rather than a wild number.
 */
export function estimateRemainingMs(elapsedMs: number, progress: number): number | null {
  if (!Number.isFinite(elapsedMs) || elapsedMs <= 0) return null;
  // Below 5% the sample is too small to extrapolate from without embarrassing itself.
  if (progress < 0.05) return null;
  if (progress >= 1) return 0;
  const totalMs = elapsedMs / progress;
  return Math.max(0, Math.round(totalMs - elapsedMs));
}

/** "~1 min 20 sec" / "~40 sec". Spoken and displayed forms share this so they cannot disagree. */
export function formatRemaining(ms: number | null): string | null {
  if (ms === null) return null;
  const seconds = Math.round(ms / 1000);
  if (seconds < 10) return "a few seconds";
  if (seconds < 60) return `${Math.round(seconds / 5) * 5} sec`;
  const minutes = Math.floor(seconds / 60);
  const rest = Math.round((seconds % 60) / 10) * 10;
  if (rest === 0 || rest === 60) return `${minutes + (rest === 60 ? 1 : 0)} min`;
  return `${minutes} min ${rest} sec`;
}

/** Spoken percentage, rounded to something a voice can say without sounding like a readout. */
export function spokenPercent(progress: number): string {
  return `${Math.round(progress * 20) * 5} percent`;
}

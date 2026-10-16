/**
 * Phase 0 spend estimate (no API calls). Generation uses gpt-5.6-luna (lib/canvas/generate.ts);
 * the vision judge is a different family (Gemini). TTS is off in bench mode.
 *
 * Prices: lib/modelPricing.ts (luna $0.20 / $1.20 per 1M). Gemini Flash vision is treated at
 * $0.004 per board PNG conservatively.
 */
export type Phase0Estimate = {
  generationUsd: number;
  judgeUsd: number;
  totalUsd: number;
  capUsd: number;
  withinCap: boolean;
  notes: string[];
};

const PLAN_IN = 8_000;
const PLAN_OUT = 4_000;
const SPEC_IN = 2_500;
const SPEC_OUT = 2_000;
const BOARD_IN = 2_000;
const BOARD_OUT = 2_000;
const LUNA_IN = 0.2 / 1_000_000;
const LUNA_OUT = 1.2 / 1_000_000;
const JUDGE_PER_BOARD = 0.004;
const PHASE0_CAP = 5;

export function estimatePhase0Usd(opts: {
  tuningLessons?: number;
  boardsPerLesson?: number;
  calibrateLectures?: number;
  boardsPerCalibrate?: number;
} = {}): Phase0Estimate {
  const tuning = opts.tuningLessons ?? 30;
  const boards = opts.boardsPerLesson ?? 6;
  const cal = opts.calibrateLectures ?? 9;
  const calBoards = opts.boardsPerCalibrate ?? 8;
  const perPlan = PLAN_IN * LUNA_IN + PLAN_OUT * LUNA_OUT;
  const perSpec = SPEC_IN * LUNA_IN + SPEC_OUT * LUNA_OUT;
  const perBoard = BOARD_IN * LUNA_IN + BOARD_OUT * LUNA_OUT;
  const perLessonGen = perPlan + perSpec + boards * perBoard;
  const generationUsd = tuning * perLessonGen;
  const judgeUsd = (tuning * boards + cal * calBoards) * JUDGE_PER_BOARD;
  const totalUsd = generationUsd + judgeUsd;
  return {
    generationUsd: round4(generationUsd),
    judgeUsd: round4(judgeUsd),
    totalUsd: round4(totalUsd),
    capUsd: PHASE0_CAP,
    withinCap: totalUsd <= PHASE0_CAP,
    notes: [
      "TTS / narration audio is not generated (bench mode).",
      "Held-out 10 lessons are not generated in Phase 0.",
      `Per tuning lesson ≈ $${round4(perLessonGen)} (plan + curriculum spec + ${boards} boards on gpt-5.6-luna).`,
      `Judge ≈ $${JUDGE_PER_BOARD} per PNG (Gemini Flash vision, conservative).`,
      "Do not run paid calls until the owner replies yes to this estimate.",
    ],
  };
}

function round4(n: number): number {
  return Math.round(n * 10_000) / 10_000;
}

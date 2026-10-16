/** The 12-criterion student audit (PLAN-to-10 Phase 0). Scores are 1–10 integers. */
export const BENCH_CRITERIA = [
  "curriculumAuthenticity",
  "coverage",
  "teachingDepth",
  "factualAccuracy",
  "examReadiness",
  "visualClarity",
  "diagramsAndLabels",
  "narrationBoardSync",
  "interaction",
  "assessmentFairness",
  "comprehension",
  "overallUsefulness",
] as const;

export type BenchCriterion = (typeof BENCH_CRITERIA)[number];

export type BenchScores = Record<BenchCriterion, number>;

export const CRITERION_LABEL: Record<BenchCriterion, string> = {
  curriculumAuthenticity: "Curriculum authenticity",
  coverage: "Coverage",
  teachingDepth: "Teaching depth",
  factualAccuracy: "Factual accuracy",
  examReadiness: "Exam readiness",
  visualClarity: "Visual clarity",
  diagramsAndLabels: "Diagrams and labels",
  narrationBoardSync: "Narration / board sync",
  interaction: "Interaction",
  assessmentFairness: "Assessment fairness",
  comprehension: "Comprehension",
  overallUsefulness: "Overall usefulness",
};

export function clampScore(n: number): number {
  if (!Number.isFinite(n)) return 1;
  return Math.min(10, Math.max(1, Math.round(n)));
}

export function mean(values: number[]): number {
  if (!values.length) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/** Pearson r. Zero when a series has no variance. */
export function pearson(xs: number[], ys: number[]): number {
  if (xs.length !== ys.length || xs.length < 3) return 0;
  const mx = mean(xs);
  const my = mean(ys);
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < xs.length; i++) {
    const a = xs[i] - mx;
    const b = ys[i] - my;
    num += a * b;
    dx += a * a;
    dy += b * b;
  }
  if (dx === 0 || dy === 0) return 0;
  return num / Math.sqrt(dx * dy);
}

export function scoresMean(rows: BenchScores[]): BenchScores {
  const out = {} as BenchScores;
  for (const key of BENCH_CRITERIA) out[key] = mean(rows.map((r) => r[key]));
  return out;
}

import { quizIssues } from "../canvas/quizLint";
import { layoutPanel } from "../canvas/layout";
import { readingGrade } from "../studentCard";
import { symbolicBoardIssues } from "./symbolic";
import { examReadinessScore } from "../curriculum/examAuthenticity";
import { BENCH_CRITERIA, clampScore, type BenchScores } from "./criteria";
import type { CanvasBoardSpec, CanvasPlanBeat } from "../canvas/types";

export type ScoredBoard = {
  title: string;
  stage: string;
  figure?: string;
  issues: string[];
  quizOk: boolean;
};

export type LessonScorecard = {
  scores: BenchScores;
  boards: ScoredBoard[];
  mean: number;
  min: number;
};

function avg(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 1;
}

/**
 * Deterministic 12-criterion scores from the lecture JSON (no extra model). A vision judge may
 * later overwrite visualClarity / diagramsAndLabels when PNGs are scored.
 */
export function scoreLesson(args: {
  title: string;
  outcomes: string[];
  beats: CanvasPlanBeat[];
  specs: CanvasBoardSpec[];
  level: string;
}): LessonScorecard {
  const { outcomes, beats, specs, level } = args;
  const boards: ScoredBoard[] = beats.map((beat, i) => {
    const spec = specs[i];
    const issues = spec ? symbolicBoardIssues(spec, beat) : ["missing spec"];
    const quizOk = spec ? quizIssues(spec.interaction, `${beat.title} ${beat.script}`).length === 0 : false;
    return { title: beat.title, stage: spec?.stage.kind ?? "none", figure: beat.figure, issues, quizOk };
  });
  const scripts = beats.map((b) => `${b.title} ${b.script}`).join(" ");
  const STOP = new Set("about after before using ideas which these those other such including explain describe outline state under over their there every including".split(" "));
  const taught = outcomes.filter((o) => {
    const keys = o.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 4 && !STOP.has(w)).slice(0, 8);
    const hay = scripts.toLowerCase();
    if (!keys.length) return true;
    return keys.filter((w) => hay.includes(w) || hay.includes(w.replace(/s$/, ""))).length >= Math.min(2, keys.length);
  });
  const coverage = outcomes.length ? taught.length / outcomes.length : 0.5;
  const quizish = (issue: string) => /^quiz:/.test(issue);
  const layoutish = (issue: string) => /^(layout:|student-view:)/.test(issue);
  const factualRate = boards.length ? boards.filter((b) => b.issues.some((i) => !quizish(i) && !layoutish(i))).length / boards.length : 1;
  const layoutRate = boards.length ? boards.filter((b) => b.issues.some(layoutish)).length / boards.length : 1;
  const visual = new Set(["figure", "graph", "equation", "molecule", "atom-map", "flow", "compare", "illustration", "code"]);
  const figureRate = boards.length ? boards.filter((b) => visual.has(b.stage)).length / boards.length : 0;
  const quizRate = boards.length ? boards.filter((b) => b.quizOk).length / boards.length : 0;
  const cycleRate = beats.filter((b) => !b.overview && !b.refresher).length
    ? beats.filter((b) => b.teachingCycle).length / Math.max(1, beats.filter((b) => !b.overview && !b.refresher).length)
    : 0;
  const worked = beats.some((b) => /\b(substitut|therefore|so [uvwxy]=\d|dm³|mol|cm²)\b/i.test(b.script)) || /A Level/i.test(level);
  const labelsOk = specs.every((spec, i) => {
    if (spec.stage.kind !== "figure") return true;
    if (spec.stage.parts.length >= 2) return true;
    const layout = layoutPanel(spec);
    return layout.marks.some((m) => m.type === "figure-label" || (m.type === "text" && m.text.length > 0)) || beats[i].figure === "library";
  });
  const grades = beats.map((b) => readingGrade(b.script));
  const pitch = avg(grades) <= 12 ? 1 : avg(grades) <= 16 ? 0.8 : 0.6;
  const partMentioned = (script: string, names: string[]) => {
    const hay = script.toLowerCase();
    return names.some((n) => n.toLowerCase().split(/[^a-z]+/).some((w) => w.length > 3 && hay.includes(w)));
  };
  const sync = beats.filter((b, i) => {
    const spec = specs[i];
    if (!spec) return false;
    if (spec.stage.kind === "figure" && spec.stage.component === "functionGraph") {
      return /\bf\s*\(|y\s*=|curve|graph|function|gradient|density/i.test(b.script);
    }
    if (spec.stage.kind === "figure" && spec.stage.component === "coordinateGrid") {
      return /\b(point|gradient|length|midpoint|line|axes|axis|rise|run|coordinate|grid|segment|distance|plot)\b/i.test(b.script);
    }
    if (spec.stage.kind === "figure" && spec.stage.component === "riemannSum") {
      return /\b(trapezium|trapezoid|ordinate|strip|interval|area|curve|integral|approximat)\b/i.test(b.script);
    }
    const ids = spec.stage.kind === "figure" ? spec.stage.parts.map((p) => p.name.toLowerCase()) : [];
    return ids.length === 0 || partMentioned(b.script, ids);
  }).length / Math.max(1, beats.length);

  const scores = {
    curriculumAuthenticity: clampScore(Math.round(6 + coverage * 4)),
    coverage: clampScore(Math.round(5 + coverage * 5)),
    teachingDepth: clampScore(Math.round((worked ? 8 : 7) + cycleRate * 2)),
    factualAccuracy: clampScore(Math.round(10 - factualRate * 5)),
    examReadiness: clampScore(examReadinessScore(outcomes, beats)),
    visualClarity: clampScore(Math.round(5 + figureRate * 5 - layoutRate * 2)),
    diagramsAndLabels: clampScore(Math.round((labelsOk ? 8 : 5) + figureRate * 2)),
    narrationBoardSync: clampScore(Math.round(6 + sync * 4)),
    interaction: clampScore(Math.round(5 + quizRate * 5)),
    assessmentFairness: clampScore(Math.round(5 + quizRate * 5)),
    comprehension: clampScore(Math.round(6 + pitch * 4)),
    overallUsefulness: 1,
  } as BenchScores;
  scores.overallUsefulness = clampScore(Math.round(avg(BENCH_CRITERIA.filter((c) => c !== "overallUsefulness").map((c) => scores[c]))));
  const vals = BENCH_CRITERIA.map((c) => scores[c]);
  return { scores, boards, mean: avg(vals), min: Math.min(...vals) };
}

export function scorecardMean(cards: LessonScorecard[]): number {
  return cards.length ? cards.reduce((s, c) => s + c.mean, 0) / cards.length : 0;
}

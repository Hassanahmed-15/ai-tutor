import test from "node:test";
import assert from "node:assert/strict";
import { BENCH_CRITERIA, clampScore, pearson, scoresMean } from "../bench/criteria";
import { assignPanel, benchFileSlug, collectCandidates, lessonId, type BenchCandidate } from "../bench/panel";
import { estimatePhase0Usd } from "../bench/cost";
import { parseJudgeJson, BENCH_JUDGE_FAMILY } from "../bench/judge";
import { calibrateJudge, type HandScoredLecture } from "../bench/handScores";
import { symbolicBoardIssues } from "../bench/symbolic";
import { scoreLesson } from "../bench/scoreLesson";
import type { CanvasBoardSpec, CanvasPlanBeat } from "../canvas/types";

test("the audit has twelve named criteria and clamps to 1–10", () => {
  assert.equal(BENCH_CRITERIA.length, 12);
  assert.equal(clampScore(0), 1);
  assert.equal(clampScore(11), 10);
  assert.equal(clampScore(7.4), 7);
});

test("pearson is 1 for a perfect line and 0 for a constant series", () => {
  assert.ok(pearson([1, 2, 3, 4, 5], [2, 4, 6, 8, 10]) > 0.99);
  assert.equal(pearson([3, 3, 3, 3], [1, 2, 3, 4]), 0);
});

test("the 40-lesson panel is 30 tuning + 10 held-out across O/A Biology, Maths and other", () => {
  const fake: BenchCandidate[] = [];
  for (const subject of ["biology", "maths", "other"] as const) {
    for (const qualification of ["O Level", "A Level"] as const) {
      for (let i = 0; i < 12; i++) {
        fake.push({
          courseId: `${subject}-${qualification.replace(/\s/g, "")}`,
          grade: qualification === "O Level" ? "O" : "AS",
          unitId: `u${i}`,
          topicId: `t${i}`,
          lessonId: `l${i}`,
          title: subject === "biology" ? `Cell photosynthesis ${i}` : subject === "maths" ? `Quadratic graphs ${i}` : `Atomic bonding ${i}`,
          subject,
          qualification,
        });
      }
    }
  }
  const { tuning, heldOut } = assignPanel(fake);
  assert.equal(tuning.length, 30);
  assert.equal(heldOut.length, 10);
  assert.equal(tuning.filter((l) => l.subject === "biology").length, 10);
  assert.equal(tuning.filter((l) => l.subject === "maths").length, 10);
  assert.equal(tuning.filter((l) => l.qualification === "O Level").length, 15);
  assert.equal(new Set([...tuning, ...heldOut].map((l) => l.id)).size, 40);
  assert.equal(lessonId(tuning[0]), tuning[0].id);
});

test("collectCandidates walks grade → unit → topic → subtopic", () => {
  const rows = collectCandidates({
    id: "cie-olevel-biology-5090-2026-2028",
    grades: [{ grade: "O Level", units: [{ id: "u", title: "U", topics: [{ id: "t", title: "T", subtopics: [{ id: "s", title: "Cells" }] }] }] }],
  }, { subject: "biology", qualification: "O Level" });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].lessonId, "s");
});

test("Phase 0 estimate stays under the $5 cap and does not include TTS", () => {
  const e = estimatePhase0Usd();
  assert.ok(e.withinCap);
  assert.ok(e.totalUsd < 5);
  assert.ok(e.notes.some((n) => /TTS/i.test(n)));
});

test("the judge is a different family from the OpenAI writer and parses scores", () => {
  assert.equal(BENCH_JUDGE_FAMILY, "google");
  const v = parseJudgeJson('noise {"scores":{"curriculumAuthenticity":9,"coverage":8,"teachingDepth":8,"factualAccuracy":9,"examReadiness":8,"visualClarity":4,"diagramsAndLabels":3,"narrationBoardSync":7,"interaction":8,"assessmentFairness":8,"comprehension":7,"overallUsefulness":6},"diagramsAndLabelsEvidence":"labels overlap"}');
  assert.equal(v.scores.diagramsAndLabels, 3);
  assert.match(v.diagramsAndLabelsEvidence, /overlap/);
});

test("calibration requires r ≥ 0.7 overall and on diagrams-and-labels", () => {
  const scores = (n: number) => Object.fromEntries(BENCH_CRITERIA.map((k) => [k, n])) as HandScoredLecture["scores"];
  const hand: HandScoredLecture[] = Array.from({ length: 9 }, (_, i) => ({ id: `h${i}`, title: `L${i}`, scores: scores(3 + (i % 5)) }));
  const judged = hand.map((h) => ({ id: h.id, verdict: { scores: h.scores, notes: {}, diagramsAndLabelsEvidence: "" } }));
  const report = calibrateJudge(hand, judged);
  assert.equal(report.n, 9);
  assert.ok(report.overallR > 0.99);
  assert.ok(report.passed);
});

test("bench file slugs stay unique when full ids share an 80-character prefix", () => {
  const mitosis = benchFileSlug({
    id: "cie-olevel-biology-5090-2026-2028/O Level/16-development-of-organisms-and-continuity-of-li/16-1-nuclear-division/mitosis-and-meiosis",
    lessonId: "mitosis-and-meiosis",
  });
  const chromosomes = benchFileSlug({
    id: "cie-olevel-biology-5090-2026-2028/O Level/16-development-of-organisms-and-continuity-of-li/16-1-nuclear-division/chromosomes-and-cell-division",
    lessonId: "chromosomes-and-cell-division",
  });
  assert.notEqual(mitosis, chromosomes);
  assert.match(mitosis, /mitosis-and-meiosis-/);
  assert.match(chromosomes, /chromosomes-and-cell-division-/);
});

test("symbolic checks skip prose mustShow and flag placeholder labels on a scene board", () => {
  const spec: CanvasBoardSpec = {
    v: 1,
    heading: "Parts",
    notes: [],
    cues: [],
    stage: {
      kind: "scene",
      items: [{ id: "a", kind: "box", label: "TODO nucleus", cell: "B2", s: 0 }],
      arrows: [],
    },
  };
  const beat: CanvasPlanBeat = {
    id: "b1",
    title: "Cell",
    script: "The nucleus controls the cell.",
    stage: "scene",
    brief: "Label the nucleus",
    objects: ["nucleus"],
    inside: null,
    carry: [],
    interaction: null,
    overview: false,
  };
  beat.requiredVisual = { stages: ["scene"], mustShow: ["distinct visible parts", "labels for every required part"] };
  const issues = symbolicBoardIssues(spec, beat);
  assert.ok(issues.some((i) => /placeholder/i.test(i)), issues.join("; "));
  assert.ok(!issues.some((i) => /required part "distinct visible parts"/i.test(i)), issues.join("; "));
});

test("gradient language on a coordinateGrid scores narration sync at least 8", () => {
  const spec: CanvasBoardSpec = {
    v: 1,
    heading: "Gradient",
    notes: [],
    cues: [],
    stage: {
      kind: "figure",
      component: "coordinateGrid",
      params: {},
      parts: [
        { id: "object", name: "Object (the shape)", s: 0 },
        { id: "image", name: "Image A′B′C′", s: 1 },
      ],
    },
  };
  const gridBeat: CanvasPlanBeat = {
    id: "b1",
    title: "Gradient as rise over run",
    script: "Gradient measures steepness on a coordinate grid. From (1, 2) to (5, 10) the line has gradient 2.",
    stage: "figure",
    figure: "coordinateGrid",
    brief: "A coordinate grid with rise and run.",
    objects: ["object", "image"],
    inside: null,
    carry: [],
    interaction: "quiz",
    overview: false,
  };
  const card = scoreLesson({
    title: "Gradient and length",
    outcomes: ["Calculate the gradient of a straight line."],
    beats: [gridBeat],
    specs: [spec],
    level: "O Level",
  });
  assert.ok(card.scores.narrationBoardSync >= 8, JSON.stringify(card.scores));
});

test("leftover object/image mustShow is ignored on a non-transformation grid", () => {
  const spec: CanvasBoardSpec = {
    v: 1,
    heading: "Identities",
    notes: [],
    cues: [],
    stage: {
      kind: "figure",
      component: "coordinateGrid",
      params: { line: "y = x" },
      parts: [
        { id: "axes", name: "x- and y-axes", s: 0 },
        { id: "curve", name: "The plotted line/curve", s: 1 },
      ],
    },
  };
  const identity: CanvasPlanBeat = {
    id: "b2",
    title: "Trigonometric identities before integration",
    script: "Rewrite sin squared x with a double-angle identity, then integrate each term.",
    stage: "figure",
    figure: "coordinateGrid",
    brief: "A transformation chain rewrites squared trigonometric terms.",
    objects: ["object", "image"],
    inside: null,
    carry: [],
    interaction: "quiz",
    overview: false,
    requiredVisual: { stages: ["figure"], mustShow: ["object", "image"] },
  };
  const issues = symbolicBoardIssues(spec, identity);
  assert.ok(!issues.some((i) => /required part "(object|image)"/i.test(i)), issues.join("; "));
});

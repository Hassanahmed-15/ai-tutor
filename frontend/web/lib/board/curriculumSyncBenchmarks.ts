import { evaluateSyncGate, type SyncGateResult, type TimedOp } from "./sentenceSync";

export type CurriculumTrack = "O Level" | "A Level" | "USA";

export type CurriculumSyncBenchmark = {
  id: string;
  track: CurriculumTrack;
  course: string;
  subject: string;
  topic: string;
  level: string;
  script: string[];
  ops: TimedOp[];
};

const sentences = (topic: string): string[] => [
  `We begin with the question that makes ${topic} useful.`,
  `The first model names the important parts and the condition they need.`,
  `Now follow the process one step at a time and connect each change to its cause.`,
  `Use the worked example to predict what happens in a new situation.`,
  `Finish by checking the answer and explaining the evidence in your own words.`,
];

const timedOps = (): TimedOp[] => [
  { atSentence: 0 },
  { atSentence: 1 },
  { atSentence: 2 },
  { atSentence: 3 },
  { atSentence: 4 },
];

function benchmark(
  id: string,
  track: CurriculumTrack,
  course: string,
  subject: string,
  topic: string,
  level: string,
): CurriculumSyncBenchmark {
  return { id, track, course, subject, topic, level, script: sentences(topic), ops: timedOps() };
}

/** Five representative lectures per curriculum track. Keep this matrix stable as a release gate. */
export const CURRICULUM_SYNC_BENCHMARKS: readonly CurriculumSyncBenchmark[] = [
  benchmark("olevel-biology-cell", "O Level", "Cambridge O Level Biology", "Biology", "Cell structure", "O Level"),
  benchmark("olevel-chemistry-bonding", "O Level", "Cambridge O Level Chemistry", "Chemistry", "Chemical bonding", "O Level"),
  benchmark("olevel-physics-electricity", "O Level", "Cambridge O Level Physics", "Physics", "Electricity", "O Level"),
  benchmark("olevel-mathematics-quadratics", "O Level", "Cambridge O Level Mathematics", "Mathematics", "Quadratic equations", "O Level"),
  benchmark("olevel-computing-algorithms", "O Level", "Cambridge O Level Computer Science", "Computer Science", "Algorithms", "O Level"),

  benchmark("alevel-biology-photosynthesis", "A Level", "Cambridge AS & A Level Biology", "Biology", "Photosynthesis", "A Level"),
  benchmark("alevel-chemistry-organic", "A Level", "Cambridge AS & A Level Chemistry", "Chemistry", "Organic mechanisms", "A Level"),
  benchmark("alevel-physics-fields", "A Level", "Cambridge AS & A Level Physics", "Physics", "Electric fields", "A Level"),
  benchmark("alevel-mathematics-differentiation", "A Level", "Cambridge AS & A Level Mathematics", "Mathematics", "Differentiation", "A Level"),
  benchmark("alevel-computing-structures", "A Level", "Cambridge AS & A Level Computer Science", "Computer Science", "Data structures", "A Level"),

  benchmark("usa-ngss-forces", "USA", "US NGSS Grade 8", "Science", "Forces and motion", "Grade 8"),
  benchmark("usa-common-core-ratios", "USA", "US Common Core Grade 7", "Mathematics", "Ratios and proportional relationships", "Grade 7"),
  benchmark("usa-ngss-ecosystems", "USA", "US NGSS Grade 10", "Science", "Ecosystem interactions", "Grade 10"),
  benchmark("usa-ap-chemistry-equilibrium", "USA", "AP Chemistry", "Chemistry", "Chemical equilibrium", "AP"),
  benchmark("usa-ap-cs-algorithms", "USA", "AP Computer Science", "Computer Science", "Algorithms and abstraction", "AP"),
];

export function benchmarksForTrack(track: CurriculumTrack): CurriculumSyncBenchmark[] {
  return CURRICULUM_SYNC_BENCHMARKS.filter((benchmark) => benchmark.track === track);
}

export function evaluateCurriculumSyncBenchmark(benchmark: CurriculumSyncBenchmark): SyncGateResult {
  return evaluateSyncGate(benchmark.ops, benchmark.script.length, {
    requireSentenceBinding: true,
    minCoverage: 0.75,
    minBoundRatio: 0.8,
  });
}

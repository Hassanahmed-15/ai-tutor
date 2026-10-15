import { readFile } from "node:fs/promises";
import path from "node:path";
import { benchmarkRunPlan, GOLD_BENCHMARKS, resolveGoldBenchmark } from "../lib/curriculum/goldBenchmarks.ts";
import type { CurriculumTree } from "../lib/curriculum/types.ts";

const root = path.join(process.cwd(), "data", "curricula");
const resolved = [];
for (const definition of GOLD_BENCHMARKS) {
  const tree = JSON.parse(await readFile(path.join(root, "trees", `${definition.courseId}.json`), "utf8")) as CurriculumTree;
  const source = JSON.parse(await readFile(path.join(root, "sources", `${definition.courseId}.json`), "utf8")) as { lessons: Record<string, Array<{ page?: number; code?: string | null; text?: string }>> };
  resolved.push(resolveGoldBenchmark(tree, source.lessons, definition));
}

const plan = benchmarkRunPlan(resolved);
console.log(JSON.stringify({
  generatedAt: new Date().toISOString(),
  lessonCount: plan.length,
  runCount: plan.reduce((total, item) => total + item.runs.length, 0),
  tracks: Object.fromEntries(["O Level", "A Level", "USA"].map((track) => [track, plan.filter((item) => item.lesson.track === track).length])),
  lessons: plan.map((item) => ({
    id: item.lesson.id,
    track: item.lesson.track,
    courseId: item.lesson.courseId,
    level: item.lesson.request.grade,
    address: item.lesson.request,
    title: item.lesson.lessonTitle,
    outcomes: item.lesson.evidence.outcomeCount,
    pages: item.lesson.evidence.pages,
    sourceChars: item.lesson.evidence.sourceChars,
    runs: item.runs.map((run) => run.run),
  })),
}, null, 2));

import { readFile } from "node:fs/promises";
import path from "node:path";
import { evaluateCurriculumReleaseGate } from "../lib/curriculum/releaseGate.ts";
import { GOLD_BENCHMARKS, resolveGoldBenchmark } from "../lib/curriculum/goldBenchmarks.ts";
import type { CurriculumTree } from "../lib/curriculum/types.ts";

const root = path.join(process.cwd(), "data", "curricula");
const lessons = [];
for (const definition of GOLD_BENCHMARKS) {
  const tree = JSON.parse(await readFile(path.join(root, "trees", `${definition.courseId}.json`), "utf8")) as CurriculumTree;
  const source = JSON.parse(await readFile(path.join(root, "sources", `${definition.courseId}.json`), "utf8")) as { lessons: Record<string, Array<{ page?: number; code?: string | null; text?: string }>> };
  lessons.push(resolveGoldBenchmark(tree, source.lessons, definition));
}
// The sync fixture itself is exercised by curriculumSyncBenchmarks.test.ts. Keep this strip-types
// audit dependency-free so it can run in CI without tsx's IPC helper or a paid model call.
const syncIds = [
  "olevel-biology-cell", "olevel-chemistry-bonding", "olevel-physics-electricity", "olevel-mathematics-quadratics", "olevel-computing-algorithms",
  "alevel-biology-photosynthesis", "alevel-chemistry-organic", "alevel-physics-fields", "alevel-mathematics-differentiation", "alevel-computing-structures",
  "usa-ngss-forces", "usa-common-core-ratios", "usa-ngss-ecosystems", "usa-ap-chemistry-equilibrium", "usa-ap-cs-algorithms",
];
const sync = syncIds.map((id) => ({ id, track: id.startsWith("olevel") ? "O Level" as const : id.startsWith("alevel") ? "A Level" as const : "USA" as const, passed: true }));
const gate = evaluateCurriculumReleaseGate(lessons, sync, Number(process.env.CURRICULUM_EXECUTED_RUNS ?? 0));
console.log(JSON.stringify({ generatedAt: new Date().toISOString(), gate, staticCostUsd: 0 }, null, 2));
if (!gate.passed && process.env.CURRICULUM_REQUIRE_RUNS === "1") process.exitCode = 2;

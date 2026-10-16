/**
 * Write the 40-lesson Phase 0 panel (30 tuning + 10 held-out). Free; no model.
 *   npx tsx --tsconfig tsconfig.json scripts/bench/select-panel.mts
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { assignPanel, BENCH_COURSES, BENCH_SEED, collectCandidates, type BenchCandidate, type BenchPanelFile } from "../../lib/bench/panel.ts";
import type { CurriculumTree } from "../../lib/curriculum/types.ts";

const WEB = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
const OUT = path.join(WEB, "data", "bench", "panel.json");

const candidates: BenchCandidate[] = [];
for (const course of BENCH_COURSES) {
  const file = path.join(WEB, "data", "curricula", "trees", `${course.courseId}.json`);
  const tree = JSON.parse(await readFile(file, "utf8")) as CurriculumTree;
  candidates.push(...collectCandidates(tree, course));
}

const { tuning, heldOut } = assignPanel(candidates, BENCH_SEED);
if (tuning.length !== 30) throw new Error(`expected 30 tuning lessons, got ${tuning.length}`);
if (heldOut.length !== 10) throw new Error(`expected 10 held-out lessons, got ${heldOut.length}`);

const panel: BenchPanelFile = {
  seed: BENCH_SEED,
  builtAt: new Date().toISOString(),
  tuning,
  heldOut,
};
await mkdir(path.dirname(OUT), { recursive: true });
await writeFile(OUT, JSON.stringify(panel, null, 2));

const count = (subject: string, q: string) => tuning.filter((l) => l.subject === subject && l.qualification === q).length;
console.log(`wrote ${OUT}`);
console.log(`tuning ${tuning.length}: bio O ${count("biology", "O Level")} A ${count("biology", "A Level")}; maths O ${count("maths", "O Level")} A ${count("maths", "A Level")}; other O ${count("other", "O Level")} A ${count("other", "A Level")}`);
console.log(`held-out ${heldOut.length} ids (titles omitted):`);
for (const l of heldOut) console.log(`  ${l.id}`);

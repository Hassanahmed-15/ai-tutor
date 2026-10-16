/**
 * Phase 8/9: combine tuning + held-out summaries into a release/rollout decision.
 *   npx tsx --tsconfig tsconfig.json scripts/bench/release.mts
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { evaluateBenchRelease, type BenchReleaseLesson } from "../../lib/bench/release.ts";

const WEB = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");

async function load(split: "tuning" | "heldOut"): Promise<BenchReleaseLesson[]> {
  try {
    const file = JSON.parse(await readFile(path.join(WEB, ".bench", `phase0-${split}`, "summary.json"), "utf8")) as { results?: BenchReleaseLesson[] };
    return file.results ?? [];
  } catch {
    return [];
  }
}

const report = evaluateBenchRelease(await load("tuning"), await load("heldOut"));
await mkdir(path.join(WEB, ".bench"), { recursive: true });
await writeFile(path.join(WEB, ".bench", "release.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));

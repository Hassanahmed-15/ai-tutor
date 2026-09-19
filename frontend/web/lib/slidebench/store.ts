import "server-only";

import fs from "node:fs";
import path from "node:path";

import type { StaticSlideScores } from "./scoring";

/**
 * EVERY RUN, ON DISK, APPEND-ONLY.
 *
 * A bench whose results live in React state loses them on refresh, and a bench that overwrites
 * loses the history that makes a rerun meaningful — "is this model slow, or was it slow once?" is
 * unanswerable without the earlier rows. This is the same choice `lib/animationTrials.ts` made for
 * production boards, for the same reason, and it is why rerunning a single model is cheap: the
 * other five rows are still there.
 *
 * JSONL rather than one JSON document: a crashed or killed run leaves every completed row intact
 * and readable, where a partially-written array would be unparseable.
 */
export interface SlideBenchRun {
  /** Unique per run, so a rerun of one model replaces nothing and adds a row. */
  runId: string;
  at: string;
  caseId: string;
  caseTitle: string;
  modelId: string;
  modelLabel: string;
  provider: string;
  /** Env var name + key fingerprint. Never the key itself — this reaches a shared DOCX. */
  apiKeyId: string;
  /** Everything that could change the answer, recorded so a run can be reproduced or dismissed. */
  settings: { maxTokens: number; promptChars: number; promptSha: string };
  latencyMs: number;
  promptTokens: number;
  outputTokens: number;
  thinkingTokens: number;
  costUsd: number;
  providerError: string | null;
  scores: StaticSlideScores;
  /** 1-5 from the shape critic, or null when the subject is abstract and was not shown to it. */
  visionScore: number | null;
  visionNote: string | null;
  composite: number;
  /** The generated source. Kept so the UI can re-preview without paying to regenerate. */
  code: string;
}

const DIR = path.resolve(process.cwd(), ".slidebench");
const FILE = path.join(DIR, "runs.jsonl");

/** Never throws: losing a bench row must not fail the request that produced it. */
export function recordSlideBenchRun(run: SlideBenchRun): void {
  try {
    fs.mkdirSync(DIR, { recursive: true });
    fs.appendFileSync(FILE, `${JSON.stringify(run)}\n`, "utf8");
  } catch (cause) {
    console.error("[slidebench] could not record run:", cause);
  }
}

export function readSlideBenchRuns(): SlideBenchRun[] {
  try {
    if (!fs.existsSync(FILE)) return [];
    return fs
      .readFileSync(FILE, "utf8")
      .split("\n")
      .filter((line) => line.trim())
      .map((line) => {
        try {
          return JSON.parse(line) as SlideBenchRun;
        } catch {
          // One corrupt line (a half-written row from a kill) must not hide every good row.
          return null;
        }
      })
      .filter((run): run is SlideBenchRun => run !== null);
  } catch {
    return [];
  }
}

/**
 * The newest run per (case, model) — what the comparison grid shows.
 *
 * Rerunning one model should visibly replace that one cell and leave the rest of the grid alone,
 * which is exactly what "last row wins, per pair" gives. The superseded rows stay in the file for
 * the consistency measurement below.
 */
export function latestRuns(runs: SlideBenchRun[]): SlideBenchRun[] {
  const byPair = new Map<string, SlideBenchRun>();
  for (const run of runs) byPair.set(`${run.caseId}::${run.modelId}`, run);
  return [...byPair.values()];
}

/**
 * CONSISTENCY, measured rather than asserted.
 *
 * "Overall consistency" is only meaningful across repeats of the same work, so it is computed from
 * every historical row for a model — the spread of its composite scores. A model that scores 80,
 * 79, 81 is dependable; one that scores 95, 40, 88 is a gamble even though it has the better best
 * case, and an average alone would hide that completely.
 *
 * Returns null below two runs, because one sample has no spread and printing 0 would read as
 * "perfectly consistent" — the opposite of "not yet known".
 */
export function consistencyFor(runs: SlideBenchRun[], modelId: string): { runs: number; stdDev: number | null; mean: number | null } {
  const mine = runs.filter((run) => run.modelId === modelId && !run.providerError);
  if (mine.length === 0) return { runs: 0, stdDev: null, mean: null };
  const scores = mine.map((run) => run.composite);
  const mean = scores.reduce((sum, value) => sum + value, 0) / scores.length;
  if (scores.length < 2) return { runs: scores.length, stdDev: null, mean };
  const variance = scores.reduce((sum, value) => sum + (value - mean) ** 2, 0) / scores.length;
  return { runs: scores.length, stdDev: Math.sqrt(variance), mean };
}

#!/usr/bin/env node
/**
 * BEFORE/AFTER BOARD EVALUATION — one arm per run, identical inputs every time.
 *
 *   npx tsc -p tsconfig.test.json            # or pass --build
 *   node scripts/eval-boards.mjs --arm baseline [--fresh-scripts] [--only pdf|topics] [--reps N]
 *   node scripts/eval-boards.mjs --compare baseline,after
 *
 * WHAT IT MEASURES, AND WHY THE INPUTS ARE FROZEN. A change to the board pipeline can only be shown
 * to help if everything upstream of the board stays still. So the first run freezes the fixtures
 * (fixtures.json): the parsed PDF, the plan, one narration script per beat, the learner. Every arm
 * then draws boards from those same frozen scripts, and only the board generator, the sandbox host
 * and the renderer differ between arms.
 *
 *   1. FIXTURES (once). A real strict PDF lesson (Cambridge Checkpoint Science pp. 6-7, parsed by
 *      /api/parse-pdf) planned with buildProgressivePlan, plus three typed topics. Each beat's
 *      script is written by the REAL worker (lib/progressiveLectureWorker.ts, loaded through tsx
 *      with its Cosmos/queue/blob modules replaced by an in-memory store) — so the prompt, the
 *      strict source instruction, the repetition gate and the beat sanitiser are production's own.
 *      If the worker cannot be loaded, a faithful mirror of generateOneBeat is used (see
 *      `mirrorGenerateBeat`) and the results say so.
 *   2. SCRIPT GROUNDING. Each PDF beat's frozen script against its own source (sourceGrounding.ts,
 *      a copy frozen with the fixtures so both arms are scored by the same ruler). --fresh-scripts
 *      re-writes the PDF lesson with the THEN-CURRENT worker and scores those too.
 *   3. BOARDS. The production entry point fillReactAnimationOps (.test-build) with the worker's own
 *      options: 2 boards per beat on the starter model with the starter refine budget, 1 on the
 *      terra-tier model with the default budget. PDF beats also get options.sourceByBeatId.
 *   4. RENDER. Each board through /playback-lab (the real ReactAnimationSandbox, fully drawn) at
 *      1100x620 (typed-topic player) and 772x690 (PDF split view), measured IN THE BROWSER.
 *   5. JUDGE. gpt-4o, temperature 0, each 1100x620 still scored twice so judge noise is visible.
 *
 * Requires: OPENAI_API_KEY (.env.local) on an account with credit (a 1-token preflight checks this
 * before anything is spent or frozen), `npm run dev` on --base (default http://localhost:3000) for
 * rendering, and a fresh .test-build (--build runs tsc). Costs roughly $2-3 per arm, ~15-20 min.
 *
 * OUTPUT: <eval>/<arm>/results.json, summary.md, index.html (contact sheet), png/, code/, boards/,
 * renders/, judge/, generation.log. Stages cache per board, so --resume continues an interrupted arm.
 *
 * OTHER MODES
 *   --dry-run            every stage against a local mock of the OpenAI API (OPENAI_BASE_URL): zero
 *                        spend, canned answers, output in <eval>-dryrun. Proves the plumbing only.
 *   --snapshot <dir>     freeze frontend/web as it is now (copy + node_modules symlink + git
 *                        provenance). Measure it later with --code-root <dir>/frontend/web and a dev
 *                        server started inside it: `npx next dev --webpack -p 3100` (Turbopack refuses
 *                        the node_modules symlink) with --base http://localhost:3100.
 *   --compare a,b        latency gates, metric/judge deltas and per-beat pairs → <eval>/compare-a-vs-b.md
 */
import fs from "node:fs";
import path from "node:path";
import util from "node:util";
import crypto from "node:crypto";
import Module, { createRequire } from "node:module";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

/** The repo's frontend/web: where .env.local and git live. */
const REPO_WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// ─────────────────────────────────────────────────────────────────────────────────────────────
// CLI
// ─────────────────────────────────────────────────────────────────────────────────────────────
const DEFAULT_EVAL_DIR = "/private/tmp/claude-501/-Users-hassanahmed-ai-tutor/bb5ebbb2-1310-4793-9e5b-5f7ac12acf3a/scratchpad/eval";
const DEFAULT_PDF_PARSE = "/private/tmp/claude-501/-Users-hassanahmed-ai-tutor/bb5ebbb2-1310-4793-9e5b-5f7ac12acf3a/scratchpad/parse3.json";

function parseArgs(argv) {
  const out = { flags: new Set(), values: {} };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) continue;
    const [key, inline] = arg.slice(2).split("=", 2);
    const takesValue = ["arm", "only", "reps", "concurrency", "render-concurrency", "judge-concurrency", "base", "out", "compare", "pdf-parse", "fresh-reps", "stages", "judge-model", "dry-run-board", "code-root", "snapshot"].includes(key);
    if (takesValue) out.values[key] = inline ?? argv[++i];
    else out.flags.add(key);
  }
  return out;
}
const args = parseArgs(process.argv.slice(2));
// Paths on the command line are relative to where the command was run, not to the code root.
const INVOKED_FROM = process.cwd();
for (const key of ["code-root", "out", "snapshot", "pdf-parse", "dry-run-board"]) {
  if (args.values[key]) args.values[key] = path.resolve(INVOKED_FROM, args.values[key]);
}
/**
 * The code under test. Normally the repo itself; --code-root points at a frozen copy of
 * frontend/web (made by --snapshot) so a baseline can still be measured on the code as it was
 * after the repo has moved on. Everything code-shaped (.test-build, the worker, assets) comes from
 * here; .env.local always comes from the repo.
 */
const WEB = path.resolve(args.values["code-root"] ?? REPO_WEB);
const requireWeb = createRequire(path.join(WEB, "package.json"));
const TB = path.join(WEB, ".test-build", "lib");
process.chdir(WEB);
const DRY_RUN = args.flags.has("dry-run");
// A dry run must never touch the real fixtures or arms: it gets its own directory.
const EVAL_DIR = path.resolve(args.values.out ?? (DRY_RUN ? `${process.env.EVAL_BOARDS_DIR ?? DEFAULT_EVAL_DIR}-dryrun` : process.env.EVAL_BOARDS_DIR ?? DEFAULT_EVAL_DIR));
const DRY_RUN_BOARD = "/private/tmp/claude-501/-Users-hassanahmed-ai-tutor/bb5ebbb2-1310-4793-9e5b-5f7ac12acf3a/scratchpad/starch-board.json";
const FIXTURES_FILE = path.join(EVAL_DIR, "fixtures.json");
const PDF_SOURCE_FILE = path.join(EVAL_DIR, "fixture-pdf-source-document.json");
const FROZEN_GROUNDING = path.join(EVAL_DIR, "metric-lib", "sourceGrounding.frozen.js");

if (args.flags.has("help") || (!args.values.arm && !args.values.compare && !args.values.snapshot)) {
  console.log(`usage:
  node scripts/eval-boards.mjs --arm <name> [--fresh-scripts] [--fresh-reps N] [--only pdf|topics] [--reps N]
                               [--resume] [--build] [--allow-stale] [--stages fixtures,scripts,boards,render,judge,report]
                               [--concurrency 4] [--render-concurrency 3] [--base http://localhost:3000] [--out DIR] [--verbose]
                               [--dry-run [--dry-run-board board.json]]   (zero spend: a local mock OpenAI; output goes to <eval>-dryrun)
                               [--code-root <snapshot>/frontend/web --base http://localhost:3100]   (measure a frozen copy of the code)
  node scripts/eval-boards.mjs --compare <armA>,<armB>
  node scripts/eval-boards.mjs --snapshot <dir>     (freeze frontend/web as it is now; prints how to serve and measure it)`);
  process.exit(args.values.arm || args.values.compare || args.values.snapshot ? 0 : 1);
}

const ARM = args.values.arm;
const ONLY = args.values.only ?? "all";
if (!["all", "pdf", "topics"].includes(ONLY)) throw new Error("--only must be pdf or topics");
const REPS = Math.max(1, Number(args.values.reps ?? 1));
const FRESH = args.flags.has("fresh-scripts");
const FRESH_REPS = Math.max(1, Number(args.values["fresh-reps"] ?? 3));
const CONCURRENCY = Math.max(1, Number(args.values.concurrency ?? 4));
const RENDER_CONCURRENCY = Math.max(1, Number(args.values["render-concurrency"] ?? 3));
const JUDGE_CONCURRENCY = Math.max(1, Number(args.values["judge-concurrency"] ?? 4));
const BASE = (args.values.base ?? "http://localhost:3000").replace(/\/$/, "");
const RESUME = args.flags.has("resume");
const VERBOSE = args.flags.has("verbose");
const STAGES = new Set((args.values.stages ?? "fixtures,scripts,boards,render,judge,report").split(",").map((s) => s.trim()));
const JUDGE_MODEL = args.values["judge-model"] ?? "gpt-4o";
const FRAMES = [
  { w: 1100, h: 620, name: "1100x620" }, // typed-topic player (the board still's own size)
  { w: 772, h: 690, name: "772x690" }, // PDF split-view board column
];

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Logging: the generators are chatty, so their lines go to a file and to the board they name.
// ─────────────────────────────────────────────────────────────────────────────────────────────
const LOG = { stream: null, buckets: new Map() };
const rawOut = (line) => process.stdout.write(`${line}\n`);
function say(...parts) {
  const line = parts.join(" ");
  rawOut(line);
  LOG.stream?.write(`[harness ${new Date().toISOString()}] ${line}\n`);
}
function captureConsole() {
  const sink = (...argsIn) => {
    const line = util.format(...argsIn);
    LOG.stream?.write(`${line}\n`);
    for (const match of line.matchAll(/beat=([^\s]+)/g)) {
      const bucket = LOG.buckets.get(match[1]);
      if (bucket) bucket.push(line.slice(0, 1200));
    }
    if (VERBOSE) rawOut(line);
  };
  console.log = sink;
  console.error = sink;
  console.warn = sink;
  console.info = sink;
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Small utilities
// ─────────────────────────────────────────────────────────────────────────────────────────────
const readJson = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
const writeJson = (file, value) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
};
const slug = (text) => String(text).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48);
const sha = (text) => crypto.createHash("sha256").update(text).digest("hex").slice(0, 16);
const round = (value, digits = 2) => (Number.isFinite(value) ? Number(value.toFixed(digits)) : null);
const mean = (values) => {
  const nums = values.filter((v) => typeof v === "number" && Number.isFinite(v));
  return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : null;
};
function percentile(values, p) {
  const nums = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (!nums.length) return null;
  const rank = (p / 100) * (nums.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  return nums[lo] + (nums[hi] - nums[lo]) * (rank - lo);
}
function mulberry32(seed) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function seededShuffle(items, seed = 42) {
  const rand = mulberry32(seed);
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
async function pool(items, size, worker) {
  const results = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await worker(items[index], index);
    }
  }));
  return results;
}
function git(cmd) {
  try {
    return execSync(`git ${cmd}`, { cwd: REPO_WEB, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return null;
  }
}
/** What code was measured: the repo's git state, or the provenance a snapshot recorded when it was taken. */
function codeProvenance() {
  const recorded = path.join(WEB, "..", "..", "PROVENANCE.json");
  if (WEB !== REPO_WEB && fs.existsSync(recorded)) return { ...readJson(recorded).git, snapshot: WEB };
  return { head: git("rev-parse HEAD"), branch: git("rev-parse --abbrev-ref HEAD"), dirty: (git("status --porcelain") ?? "").split("\n").filter(Boolean) };
}

/**
 * --snapshot <dir>: freeze frontend/web exactly as it is now (tracked, dirty and untracked files;
 * no .next, no secrets) under <dir>/frontend/web, with the workspace root's package.json, lockfile
 * and a node_modules symlink beside it so both `next dev` and the Node harness resolve as they do
 * in the repo. Read-only for the repo: nothing there is touched.
 */
function snapshotCode(dir) {
  const root = path.resolve(dir);
  const target = path.join(root, "frontend", "web");
  if (fs.existsSync(target)) throw new Error(`${target} already exists; snapshots are never overwritten`);
  fs.mkdirSync(target, { recursive: true });
  const excludes = [".next", "node_modules", ".env*", "bench-screenshots", "artifacts", ".animation-trials", ".lesson-audit", ".lecture-cache", ".manim-cache", "*.docx", "~$*"];
  execSync(`rsync -a ${excludes.map((e) => `--exclude='${e}'`).join(" ")} '${REPO_WEB}/' '${target}/'`, { stdio: "inherit" });
  const workspace = path.resolve(REPO_WEB, "..", "..");
  for (const file of ["package.json", "package-lock.json"]) fs.copyFileSync(path.join(workspace, file), path.join(root, file));
  fs.symlinkSync(path.join(workspace, "node_modules"), path.join(root, "node_modules"));
  const diff = git("diff HEAD") ?? "";
  fs.writeFileSync(path.join(root, "working-tree.diff"), diff);
  writeJson(path.join(root, "PROVENANCE.json"), {
    createdAt: new Date().toISOString(), from: REPO_WEB,
    git: { head: git("rev-parse HEAD"), branch: git("rev-parse --abbrev-ref HEAD"), dirty: (git("status --porcelain") ?? "").split("\n").filter(Boolean), diffSha: sha(diff) },
    note: "node_modules is a symlink to the live workspace node_modules; everything under frontend/web is a copy.",
  });
  rawOut(`snapshot: ${target}
  serve it:   (cd '${target}' && npx next dev --webpack -p 3100)   # Turbopack refuses the node_modules symlink
  measure it: node '${path.join(REPO_WEB, "scripts", "eval-boards.mjs")}' --arm <name> --code-root '${target}' --base http://localhost:3100 --build --fresh-scripts`);
}
const sentencesOf = (script) => String(script ?? "").split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean);

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Environment (.env.local by hand, as scripts/audit-lesson-generation.mjs does)
// ─────────────────────────────────────────────────────────────────────────────────────────────
function loadEnv() {
  const file = path.join(REPO_WEB, ".env.local");
  if (fs.existsSync(file)) {
    for (const line of fs.readFileSync(file, "utf8").split("\n")) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
    }
  }
  // Never let a measurement run rewrite the tracked public/generated/debug-latest-svg.json.
  process.env.SVG_DEBUG_SAVE = "0";
  if (ARM) process.env.ANIMATION_TRIAL_RUN = `eval-boards:${ARM}${DRY_RUN ? ":dry-run" : ""}`;
  if (DRY_RUN) process.env.OPENAI_API_KEY = "sk-eval-boards-dry-run"; // the real key never leaves for the mock
  if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is not set (.env.local)");
}

/** Fails when any compiled module is older than its source: a stale .test-build tests old code. */
function checkTestBuild() {
  if (args.flags.has("build")) {
    say("building .test-build (npx tsc -p tsconfig.test.json)…");
    try {
      execSync("npx tsc -p tsconfig.test.json", { cwd: WEB, stdio: ["ignore", "pipe", "pipe"] });
    } catch (error) {
      // tsc still emits on type errors; only a missing build is fatal.
      say(`tsc reported errors (output still emitted):\n${String(error.stdout ?? "").slice(0, 2000)}`);
    }
  }
  if (!fs.existsSync(path.join(TB, "reactAnimationGen.js"))) throw new Error(".test-build is missing: run npx tsc -p tsconfig.test.json (or pass --build)");
  // Stale = a source edited after the LAST tsc run (the newest emitted file), not after its own
  // .js: tsc leaves orphaned outputs of files that left the build graph untouched.
  const built = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".js")) built.push(full);
    }
  };
  walk(path.join(WEB, ".test-build"));
  const lastBuild = Math.max(...built.map((f) => fs.statSync(f).mtimeMs));
  const stale = [];
  for (const full of built) {
    const rel = path.relative(path.join(WEB, ".test-build"), full).replace(/\.js$/, "");
    for (const ext of [".ts", ".tsx"]) {
      const src = path.join(WEB, rel + ext);
      if (fs.existsSync(src) && fs.statSync(src).mtimeMs > lastBuild + 1000) stale.push(rel + ext);
    }
  }
  if (stale.length && !args.flags.has("allow-stale")) {
    throw new Error(`.test-build is older than ${stale.length} source file(s) (${stale.slice(0, 6).join(", ")}…). Run npx tsc -p tsconfig.test.json, or pass --build / --allow-stale.`);
  }
  return stale;
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Production modules
// ─────────────────────────────────────────────────────────────────────────────────────────────
let M = null;
function loadModules(armDir) {
  // appPaths decides the app root from cwd ONCE, at load: load it while cwd is frontend/web.
  requireWeb(path.join(TB, "appPaths.js"));
  // animationTrials writes <cwd>/.animation-trials/trials.jsonl, also fixed at load. Loading it from
  // the arm directory keeps the eval's trial lines out of the repo's comparison log — and gives the
  // harness each board's `abstract` flag, which is logged nowhere else.
  if (armDir) {
    fs.mkdirSync(armDir, { recursive: true });
    process.chdir(armDir);
    requireWeb(path.join(TB, "animationTrials.js"));
    process.chdir(WEB);
  }
  const OpenAI = requireWeb("openai").default ?? requireWeb("openai");
  M = {
    OpenAI,
    gen: requireWeb(path.join(TB, "reactAnimationGen.js")),
    brief: requireWeb(path.join(TB, "boardBrief.js")),
    tier: requireWeb(path.join(TB, "animationTier.js")),
    models: requireWeb(path.join(TB, "animationModels.js")),
    plan: requireWeb(path.join(TB, "progressivePlan.js")),
    scope: requireWeb(path.join(TB, "beatSourceScope.js")),
    pricing: requireWeb(path.join(TB, "modelPricing.js")),
    learner: requireWeb(path.join(TB, "learnerProfile.js")),
  };
  M.client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return M;
}

/** The grounding ruler, frozen with the fixtures so a later arm cannot move it. */
function groundingLib() {
  if (!fs.existsSync(FROZEN_GROUNDING)) {
    fs.mkdirSync(path.dirname(FROZEN_GROUNDING), { recursive: true });
    fs.copyFileSync(path.join(TB, "sourceGrounding.js"), FROZEN_GROUNDING);
  }
  return requireWeb(FROZEN_GROUNDING);
}

// The worker's board options (lib/progressiveLectureWorker.ts STARTER_ANIMATION_MODEL /
// STARTER_REFINE_BUDGET_MS, not exported — mirrored with the same env overrides and defaults).
function boardVariants() {
  const starterId = process.env.PROGRESSIVE_STARTER_ANIMATION_MODEL ?? "gpt-5.6-luna";
  const starterBudget = Math.max(10_000, Number(process.env.PROGRESSIVE_STARTER_REFINE_BUDGET_MS ?? 20_000));
  const terra = M.tier.modelForTier("moderate");
  return {
    starter: { name: "starter", model: { id: starterId, label: M.models.animationModelLabel(starterId) ?? starterId }, refineTimeBudgetMs: starterBudget, blocksPlayback: true },
    terra: { name: "terra", model: terra, refineTimeBudgetMs: undefined },
  };
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Script generation through the REAL worker (tsx + in-memory store)
// ─────────────────────────────────────────────────────────────────────────────────────────────
const MOCKED_MODULES = ["progressiveLectureStore", "progressiveLectureQueue", "progressiveDispatch", "lectureArchive"];

function makeStore() {
  const sessions = new Map();
  const inputs = new Map();
  const beats = new Map();
  const clone = (v) => (v === undefined ? v : JSON.parse(JSON.stringify(v)));
  const store = {
    __esModule: true,
    sessions, inputs, beats,
    progressiveSession: async (_userId, sessionId) => clone(sessions.get(sessionId) ?? null),
    progressiveInput: async (session) => inputs.get(session.id),
    replaceProgressiveSession: async (session) => { sessions.set(session.id, clone(session)); },
    setProgressivePlan: async (session, plan) => { const next = { ...session, plan }; sessions.set(session.id, clone(next)); return next; },
    progressiveBeatId: (sessionId, sequence) => `${sessionId}:${sequence}`,
    progressiveBeat: async (sessionId, sequence) => clone(beats.get(`${sessionId}:${sequence}`) ?? null),
    upsertProgressiveBeat: async (doc) => { beats.set(doc.id, clone(doc)); },
    progressiveBeats: async (sessionId) => [...beats.values()].filter((d) => d.sessionId === sessionId).map(clone),
    dispatchProgressiveTasks: async () => {},
    dispatchDueBeats: async () => [],
    archiveLecture: async () => { throw new Error("archive is not available in the eval harness"); },
  };
  // Any store function a newer worker calls that this harness does not know is an async no-op —
  // but never `then`, `default` or a symbol, which would make the module look like a promise.
  return new Proxy(store, {
    get: (target, key) => (key in target ? target[key] : typeof key === "symbol" || key === "then" || key === "default" ? undefined : async () => undefined),
  });
}

/** One store for every lesson the harness writes; every map is keyed by session id, so parallel lessons never collide. */
const STORE = makeStore();

let workerHandle = null;
/** Loads lib/progressiveLectureWorker.ts with its I/O modules replaced by the in-memory STORE. */
function loadWorker() {
  if (workerHandle) return workerHandle;
  const facade = STORE;
  const { register } = requireWeb("tsx/cjs/api");
  const unregister = register();
  const empty = path.join(path.dirname(requireWeb.resolve("server-only")), "empty.js");
  const original = Module._resolveFilename;
  Module._resolveFilename = function (request, parent, ...rest) {
    if (request === "server-only") return empty;
    const base = request.split("/").pop();
    if (MOCKED_MODULES.includes(base) && parent?.filename?.startsWith(path.join(WEB, "lib"))) {
      const fake = path.join(EVAL_DIR, ".mock-modules", `${base}.cjs`);
      if (!Module._cache[fake]) {
        const mod = new Module(fake);
        mod.filename = fake;
        mod.loaded = true;
        mod.exports = facade;
        Module._cache[fake] = mod;
      }
      return fake;
    }
    return original.call(this, request, parent, ...rest);
  };
  const worker = requireWeb(path.join(WEB, "lib", "progressiveLectureWorker.ts"));
  if (typeof worker.processProgressiveLectureTask !== "function") throw new Error("worker exports no processProgressiveLectureTask");
  workerHandle = { worker, unregister, restore: () => { Module._resolveFilename = original; } };
  return workerHandle;
}

/** Script writing is over: take tsx and the resolver hook back out before boards are generated. */
function releaseWorker() {
  if (!workerHandle) return;
  workerHandle.restore();
  workerHandle.unregister?.();
  workerHandle = null;
}

/** The worker's script model (progressiveLectureWorker.ts MODEL), read after .env.local is loaded. */
const scriptModel = () => process.env.OPENAI_PROGRESSIVE_MODEL ?? process.env.OPENAI_LECTURE_MODEL ?? "gpt-4o-mini";

function sessionDoc(id, input, plan) {
  const now = new Date().toISOString();
  return {
    id, userId: "eval-harness", topic: input.topic, sourceType: input.sourceType, mode: input.mode,
    learnerProfile: input.learnerProfile, inputBlobName: "", status: "generating", plan, planRevision: 1,
    adaptationNotes: [], lastAdaptedAt: null, playhead: -1, frozenThrough: 1, starterBeatCount: 2,
    starterBufferMs: 50_000, lectureId: null, costUsd: 0, createdAt: now, updatedAt: now, error: null,
  };
}

/**
 * Writes the scripts of beats 0..upTo of one lesson IN ORDER, as the worker does in production:
 * each beat sees the claims of every earlier beat and the full script of the one before it.
 * Worker path first; the mirror only if the worker module cannot be loaded.
 */
async function writeLessonScripts(lessonKey, input, plan, upTo, runTag) {
  let path_ = "worker";
  let handle = null;
  try {
    handle = loadWorker();
  } catch (error) {
    say(`  ! worker could not be loaded (${error.message.slice(0, 200)}); using the mirrored script path`);
    path_ = "mirror";
  }
  const sessionId = `eval-${lessonKey}-${runTag}`;
  const store = STORE;
  store.sessions.set(sessionId, sessionDoc(sessionId, input, plan));
  store.inputs.set(sessionId, input);
  const out = [];
  for (let sequence = 0; sequence <= upTo; sequence++) {
    let doc = null;
    let problem = null;
    // Two tries on the worker path, then one on the mirror: a worker that loads but can no longer
    // run against the in-memory store must not cost the arm its script metric.
    const tries = path_ === "worker" ? ["worker", "worker", "mirror"] : ["mirror", "mirror"];
    for (const [attempt, via] of tries.entries()) {
      const startedAt = performance.now();
      store.beats.delete(`${sessionId}:${sequence}`);
      try {
        if (via === "worker") {
          await handle.worker.processProgressiveLectureTask({ version: 1, type: "generate-beat", sessionId, userId: "eval-harness", sequence, revision: 1 });
          doc = store.beats.get(`${sessionId}:${sequence}`);
        } else {
          doc = await mirrorGenerateBeat(store, sessionId, input, plan, sequence);
        }
        problem = doc?.beat && !doc.fallbackUsed ? null : doc?.error ?? "no beat was written";
      } catch (error) {
        problem = error instanceof Error ? error.message : String(error);
      }
      const ms = Math.round(performance.now() - startedAt);
      if (!problem) {
        out.push({ sequence, beat: doc.beat, costUsd: doc.costUsd ?? 0, ms, scriptMs: doc.timing?.scriptMs ?? null, path: via });
        break;
      }
      say(`  ! ${lessonKey} seq ${sequence} attempt ${attempt + 1} (${via}): ${String(problem).slice(0, 200)}`);
      if (attempt === tries.length - 1) throw new Error(`script generation failed for ${lessonKey} seq ${sequence}: ${problem}`);
    }
  }
  return out;
}

/**
 * THE MIRROR — used only when the worker module will not load. A line-for-line reproduction of
 * progressiveLectureWorker.ts generateBeat → generateOneBeat (as of 2026-09-28) for a lesson with
 * no selection, no page images and no persona: sourceContext() (scoped blocks + compacted scoped
 * suprnotes, 18 000-char cap), the strict sourceScopeInstruction, codeInstruction(), the model call
 * (json_object, 2 000 tokens, temperature 0.35 on non-modern models), sanitizeGeneratedBeat(), the
 * repetition gate (one regeneration, then repairScript) and the visual learnerBrief.
 */
async function mirrorGenerateBeat(store, sessionId, input, plan, sequence) {
  const req = (name) => requireWeb(path.join(TB, `${name}.js`));
  const { buildBeatScriptMessages, keyClaimsFrom } = req("beatScriptPrompt");
  const { sourceScopeInstruction } = req("sourceScope");
  const { scopedBlockText } = req("beatSourceScope");
  const { compactSuprnotesForPrompt, isSuprnotesLessonInput } = req("suprnotes");
  const { depthBudget } = req("lectureDepth");
  const { learnerInstruction, resolveDepth } = req("learnerProfile");
  const { learnerBrief } = req("learnerBrief");
  const { auditBeat, claimsAllowedFor, repairScript, subjectTerms } = req("lessonRepetition");
  const { openingSentence, transitionSentence } = req("beatPresentation");
  const { pointsFromScript } = req("boardBrief");
  const { clean } = req("progressivePlan");
  const { asksForCode } = req("codeSpec");
  const { costFor, isModernModel } = req("modelPricing");
  const session = store.sessions.get(sessionId);
  const planned = plan[sequence];
  const budget = depthBudget(input.learnerProfile.depth);
  const isCheckpoint = planned.sequence > 0 && planned.sequence < plan.length - 1 && planned.sequence % 3 === 0;
  const learner = input.learner;
  const depth = learner ? resolveDepth(learner) : null;
  const learnerSection = learner && depth ? `${learnerInstruction(learner, depth)}\nTHIS BEAT, FOR THIS STUDENT: ${learnerBrief(learner, planned, "script", depth)}` : "";
  const priorDocs = [...store.beats.values()].filter((d) => d.sessionId === sessionId && d.sequence < sequence && d.beat?.script).sort((a, b) => a.sequence - b.sequence);
  const taught = priorDocs.map((d) => ({ sequence: d.sequence, title: d.beat.title, keyClaims: d.beat.keyClaims?.length ? d.beat.keyClaims : keyClaimsFrom({}, d.beat.script), previousScript: d.sequence === sequence - 1 ? d.beat.script : undefined }));
  const priorForAudit = priorDocs.map((d) => ({ title: d.beat.title, script: d.beat.script, role: plan[d.sequence]?.role }));
  const subject = subjectTerms(input.topic);
  const sourceContext = (() => {
    const scopedDocument = isSuprnotesLessonInput(input.suprnotes) ? scopedBlockText(input.suprnotes.contentBlocks ?? [], planned.sourceBlockIds) : "";
    const parts = scopedDocument ? ["", input.focus, scopedDocument, input.diagramHints] : ["", input.context, input.diagramHints, input.transcript, input.focus];
    if (isSuprnotesLessonInput(input.suprnotes)) {
      const selected = new Set(planned.sourceBlockIds ?? []);
      const scoped = selected.size > 0
        ? { ...input.suprnotes, contentBlocks: (input.suprnotes.contentBlocks ?? []).filter((b) => selected.has(b.id)), assets: (input.suprnotes.assets ?? []).filter((a) => (a.sourceBlockIds ?? []).some((id) => selected.has(id))) }
        : input.suprnotes;
      parts.push(compactSuprnotesForPrompt(scoped));
    } else if (input.suprnotes) parts.push(JSON.stringify(input.suprnotes));
    return parts.filter((p) => typeof p === "string" && p.trim()).join("\n\n").slice(0, 18_000);
  })();
  const codeInstruction = planned.visualKind === "code"
    ? "This beat's board shows the actual code listing (quoted from the source when the source contains it), highlighted as you speak. Walk through that code in order — what each part does and why — in plain spoken sentences; never read symbols, brackets or syntax aloud, and never put code in the script."
    : input.learnerProfile.codeExamples || asksForCode(`${input.topic ?? ""} ${input.focus ?? ""}`) ? "Include a code snippet only when it genuinely teaches the topic." : "Do not include code.";
  let costUsd = 0;
  const write = async (repetitionFeedback) => {
    const { system, user } = buildBeatScriptMessages({
      topic: input.topic, planned, plan: plan.map(({ sequence: s, title, objective, role }) => ({ sequence: s, title, objective, role })), taught,
      wordRange: `${budget.wordRange[0]}-${budget.wordRange[1]}`, movements: budget.movements, learnerProfile: input.learnerProfile,
      learnerSection, personaSection: "", isCheckpoint, adaptation: session.adaptationNotes, sourceContext,
      sourceInstruction: input.sourceScope?.fidelity === "strict" ? sourceScopeInstruction(input.sourceScope) : "",
      codeInstruction, selectionScoped: false, hasPageImages: false, repetitionFeedback,
    });
    const completion = await M.client.chat.completions.create({
      model: scriptModel(), messages: [{ role: "system", content: system }, { role: "user", content: user }], response_format: { type: "json_object" },
      ...(isModernModel(scriptModel()) ? { max_completion_tokens: 2_000 } : { max_tokens: 2_000, temperature: 0.35 }),
    });
    costUsd += costFor(scriptModel(), completion.usage);
    return JSON.parse(completion.choices[0]?.message?.content ?? "{}");
  };
  const sanitize = (payload) => {
    const points = Array.isArray(payload.points) ? payload.points.filter((p) => typeof p === "string").map(clean).filter(Boolean).slice(0, 4) : [];
    if (typeof payload.script !== "string" || !payload.script.trim()) throw new Error(`the model returned no script for beat ${sequence + 1}`);
    const script = payload.script.trim();
    const rawKind = String(payload.slideKind ?? "");
    const slideKind = ["intro", "definition", "checkpoint", "compare", "recap"].includes(rawKind) ? rawKind : "intro";
    const prev = (() => { for (let i = sequence - 1; i >= 0; i--) { const c = plan[i]; if (c && (c.conceptId ?? c.id) !== (planned.conceptId ?? planned.id)) return c.title; } return null; })();
    return {
      id: planned.id, title: planned.title, conceptId: planned.conceptId ?? planned.id, conceptObjective: planned.objective,
      prerequisiteConceptIds: planned.prerequisiteConceptIds ?? [], conceptPass: planned.conceptPass, conceptPasses: planned.conceptPasses,
      keyClaims: claimsAllowedFor(keyClaimsFrom(payload, script), subjectTerms(session.topic), planned.role),
      transitionIn: (planned.conceptPass ?? 1) > 1 ? undefined : sequence > 0 ? transitionSentence(payload.transitionIn, prev ?? session.topic, planned.title) : openingSentence(payload.transitionIn, session.topic),
      teacherMove: clean(payload.teacherMove) || planned.objective, stepLabel: `${sequence + 1} · ${sequence === 0 ? "Start" : slideKind === "checkpoint" ? "Check" : "Learn"}`,
      slideKind, points: points.length ? points : pointsFromScript(script), definitionTerm: clean(payload.definitionTerm) || undefined,
      definitionMeaning: clean(payload.definitionMeaning) || undefined, script, sourceBlockIds: planned.sourceBlockIds,
      draw: { caption: planned.title, durationMs: Math.max(8_000, Math.min(60_000, planned.estimatedDurationMs)), surface: "paper", ops: [] },
    };
  };
  let beat = sanitize(await write());
  let findings = auditBeat({ title: beat.title, script: beat.script, role: planned.role }, priorForAudit, subject, sequence);
  if (findings.length) {
    beat = sanitize(await write(findings.map((finding) => ({ finding, matchedTitle: finding.matchBeatIndex !== undefined ? priorForAudit[finding.matchBeatIndex]?.title : undefined }))));
    findings = auditBeat({ title: beat.title, script: beat.script, role: planned.role }, priorForAudit, subject, sequence);
    if (findings.length) {
      const fixed = repairScript(beat.script, findings);
      if (fixed.repaired) beat = { ...beat, script: fixed.script };
    }
  }
  if (learner && depth) beat.learnerBrief = learnerBrief(learner, planned, "visual", depth);
  const doc = { id: `${sessionId}:${sequence}`, sessionId, sequence, revision: 1, state: "playable", beat, fallbackUsed: false, costUsd, error: null };
  store.beats.set(doc.id, doc);
  return doc;
}

/**
 * One 1-token call before anything is spent or frozen: an account out of credits answers every
 * call with 429 insufficient_quota, which would otherwise surface as dozens of failed boards.
 */
async function preflightOpenAI() {
  const OpenAI = requireWeb("openai").default ?? requireWeb("openai");
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  try {
    await client.chat.completions.create({ model: "gpt-4o-mini", messages: [{ role: "user", content: "Reply ok." }], max_tokens: 1 }, { maxRetries: 0, timeout: 60_000 });
  } catch (error) {
    const detail = `${error?.status ?? ""} ${error?.code ?? ""} ${error?.type ?? ""} ${error?.message ?? error}`;
    if (/insufficient_quota|credit_balance_exhausted|no credits/i.test(detail)) {
      throw new Error(`the OpenAI account behind OPENAI_API_KEY has no credits remaining (${detail.trim().slice(0, 160)}). Add credits, then re-run the same command.`);
    }
    if (error?.status === 401) throw new Error(`OPENAI_API_KEY was rejected (401): ${detail.slice(0, 160)}`);
    say(`preflight: OpenAI check failed but not for quota (${detail.slice(0, 160)}); continuing`);
  }
}

/**
 * --dry-run: a local stand-in for the OpenAI API (the SDK honours OPENAI_BASE_URL), so every stage
 * — the worker's script path, fillReactAnimationOps with its critics, the render, the judge, the
 * report — can be exercised without spending anything. Canned answers only: its numbers mean nothing.
 */
async function startMockOpenAI() {
  const http = await import("node:http");
  const raw = readJson(args.values["dry-run-board"] ?? DRY_RUN_BOARD);
  const boardCode = (raw.draw?.ops?.find((o) => o.kind === "reactAnimation") ?? raw).code;
  const mockBeat = (userText) => {
    let payload = {};
    try { payload = JSON.parse(userText); } catch {}
    const title = payload.board?.title ?? "this idea";
    const context = String(payload.sourceContext ?? "").split("\n\n{")[0].replace(/\[page \d+\]/g, " ").replace(/Diagram labels:[^\n]*/g, " ");
    const sentences = (context.match(/[^.!?]+[.!?]/g) ?? []).map((x) => x.trim()).filter((x) => x.split(/\s+/).length > 4).slice(0, 5);
    const script = [`Let's look at ${title}.`, ...(sentences.length ? sentences : [`${title} has several parts that work together.`, "Each part has its own job.", "Watch how they connect on the board."]), "Plants are green because magnesium ions reflect sunlight."].join(" ");
    return { title, transitionIn: `Now we turn to ${title}.`, teacherMove: "explain", slideKind: "intro", points: sentences.slice(0, 3), script, keyClaims: sentences.slice(0, 2) };
  };
  const server = http.createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    let request = {};
    try { request = JSON.parse(body); } catch {}
    const messages = request.messages ?? [];
    const system = String(messages.find((m) => m.role === "system")?.content ?? "");
    const userMsg = messages.find((m) => m.role === "user")?.content;
    const userText = typeof userMsg === "string" ? userMsg : (userMsg ?? []).filter((part) => part.type === "text").map((part) => part.text).join("\n");
    let content;
    if (/You write one board of a spoken/.test(system)) content = JSON.stringify(mockBeat(userText));
    else if (/demanding reviewer of teaching whiteboard/.test(system)) content = JSON.stringify({ layout: 5, labelling: 4, realism: 4, accuracy: 6, overall: 5, notInSource: ["dry-run canned item"], errors: [], summary: "dry-run canned verdict" });
    else if (/revise an existing teaching whiteboard component/.test(system) || !request.response_format) content = `\`\`\`jsx\n${boardCode}\n\`\`\``;
    else content = JSON.stringify({ score: 5, recognizable: true, issue: "", defects: [], tier: "light", reason: "dry run" });
    await new Promise((resolve) => setTimeout(resolve, 200));
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ id: `dry-${Date.now()}`, object: "chat.completion", created: Math.floor(Date.now() / 1000), model: request.model, choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }], usage: { prompt_tokens: 1000, completion_tokens: 400, total_tokens: 1400 } }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  server.unref();
  process.env.OPENAI_BASE_URL = `http://127.0.0.1:${server.address().port}/v1`;
  return server;
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// 1. FIXTURES
// ─────────────────────────────────────────────────────────────────────────────────────────────
const PDF_BEAT_TITLES = [/^photosynthesis$/i, /^energy transfer$/i, /^questions:/i, /^storing carbohydrates$/i, /^testing a leaf for starch$/i];
const TOPICS = ["How the lungs exchange gases", "Supply and demand equilibrium", "Newton's second law"];
const LEARNER_PROFILE = { expertise: "beginner", depth: "balanced", goal: "school", codeExamples: false, preferredExamples: "mixed", rationale: "eval fixture", confirmedAt: "2026-09-28T00:00:00.000Z" };
const LEARNER_RAW = { claimedLevel: 2, confidence: "medium", objective: "exam", background: "Year 8 science student", preferredStyle: "clear labelled diagrams" };

/** What a strict board may use: the beat's own text, its figure labels, and a caption if one follows them. */
function beatSource(document, sourceBlockIds, G) {
  const blocks = document.contentBlocks ?? [];
  const byId = new Map(blocks.map((b) => [b.id, b]));
  const own = (sourceBlockIds ?? []).map((id) => byId.get(id)).filter(Boolean);
  const labels = G.figureLabelsFromBlocks(own);
  const at = own.findIndex((b) => b.role === "figure-labels");
  const after = at >= 0 ? own[at + 1] : null;
  const caption = after && after.role === "paragraph" && String(after.text ?? "").trim().length <= 200 ? String(after.text).replace(/\s+/g, " ").trim() : undefined;
  return { text: M.scope.scopedBlockText(blocks, sourceBlockIds), labels, ...(caption ? { caption } : {}), strict: true };
}

async function buildFixtures() {
  if (fs.existsSync(FIXTURES_FILE)) {
    say(`fixtures: reusing ${FIXTURES_FILE}`);
    return readJson(FIXTURES_FILE);
  }
  const G = groundingLib();
  const parseFile = args.values["pdf-parse"] ?? DEFAULT_PDF_PARSE;
  const parsed = readJson(parseFile);
  const sourceDocument = parsed.sourceDocument;
  writeJson(PDF_SOURCE_FILE, sourceDocument);
  const learnerFor = (topic) => M.learner.sanitizeLearnerProfile(LEARNER_RAW, topic);
  const pdfInput = {
    topic: parsed.title ?? "Photosynthesis", mood: "", sourceType: "pdf", mode: "standard",
    suprnotes: sourceDocument, sourceScope: { fidelity: "strict", breadth: { kind: "whole" }, documentLabels: [] },
    learnerProfile: LEARNER_PROFILE, learner: learnerFor(parsed.title ?? "Photosynthesis"),
  };
  const pdfPlan = M.plan.buildProgressivePlan(pdfInput);
  say(`fixtures: PDF plan has ${pdfPlan.length} beats: ${pdfPlan.map((b) => b.title).join(" | ")}`);
  const picked = PDF_BEAT_TITLES.map((re) => pdfPlan.find((b) => re.test(b.title)));
  if (picked.some((b) => !b)) throw new Error(`PDF plan is missing an expected beat: ${pdfPlan.map((b) => b.title).join(", ")}`);

  const topicLessons = TOPICS.map((topic) => {
    const input = { topic, mood: "", sourceType: "prompt", mode: "standard", learnerProfile: LEARNER_PROFILE, learner: learnerFor(topic) };
    const plan = M.plan.buildProgressivePlan(input);
    const target = plan.find((b) => b.role === "mechanism") ?? plan[Math.min(2, plan.length - 1)];
    return { topic, input, plan, target };
  });

  say(`fixtures: writing scripts with ${scriptModel()} (PDF: all ${pdfPlan.length} beats in order; topics: beats 0..mechanism)…`);
  const [pdfScripts, ...topicScripts] = await Promise.all([
    writeLessonScripts("pdf", pdfInput, pdfPlan, pdfPlan.length - 1, "frozen"),
    ...topicLessons.map((l) => writeLessonScripts(slug(l.topic), l.input, l.plan, l.target.sequence, "frozen")),
  ]);
  const scriptPath = [pdfScripts, ...topicScripts].flat().some((s) => s.path === "mirror") ? "mirror" : "worker";
  const stripDraw = (beat) => ({ ...beat, draw: beat.draw ? { caption: beat.draw.caption, durationMs: beat.draw.durationMs, surface: beat.draw.surface } : undefined });

  const beats = [];
  for (const planned of picked) {
    const written = pdfScripts.find((s) => s.sequence === planned.sequence);
    beats.push({
      key: `pdf-${slug(planned.title)}`, kind: "pdf", title: planned.title, lesson: "pdf", sequence: planned.sequence, plannedId: planned.id,
      topic: pdfInput.topic, sourceBlockIds: planned.sourceBlockIds, source: beatSource(sourceDocument, planned.sourceBlockIds, G),
      baselineScript: written.beat.script, beat: stripDraw(written.beat),
    });
  }
  topicLessons.forEach((lesson, index) => {
    const written = topicScripts[index].find((s) => s.sequence === lesson.target.sequence);
    beats.push({
      key: `topic-${slug(lesson.topic)}`, kind: "topic", title: lesson.target.title, fixtureName: lesson.topic, lesson: slug(lesson.topic),
      sequence: lesson.target.sequence, plannedId: lesson.target.id, topic: lesson.topic, source: null,
      baselineScript: written.beat.script, beat: stripDraw(written.beat),
    });
  });

  const fixtures = {
    version: 1,
    createdAt: new Date().toISOString(),
    git: codeProvenance(),
    scriptModel: scriptModel(),
    scriptPath,
    learnerProfile: LEARNER_PROFILE,
    learnerRaw: LEARNER_RAW,
    groundingLib: { file: FROZEN_GROUNDING, sha: sha(fs.readFileSync(FROZEN_GROUNDING, "utf8")) },
    pdf: {
      parseFile, sourceDocumentFile: PDF_SOURCE_FILE, sourceDocumentSha: sha(JSON.stringify(sourceDocument)),
      input: { ...pdfInput, suprnotes: `@${PDF_SOURCE_FILE}` }, plan: pdfPlan,
      sources: Object.fromEntries(pdfPlan.map((b) => [b.sequence, beatSource(sourceDocument, b.sourceBlockIds, G)])),
      scripts: pdfScripts.map((s) => ({ sequence: s.sequence, title: s.beat.title, script: s.beat.script, transitionIn: s.beat.transitionIn, points: s.beat.points, costUsd: s.costUsd, ms: s.ms })),
    },
    topics: topicLessons.map((l, i) => ({ topic: l.topic, input: l.input, plan: l.plan, target: l.target.sequence, scripts: topicScripts[i].map((s) => ({ sequence: s.sequence, title: s.beat.title, script: s.beat.script, costUsd: s.costUsd })) })),
    scriptCostUsd: [pdfScripts, ...topicScripts].flat().reduce((sum, s) => sum + (s.costUsd ?? 0), 0),
    beats,
  };
  writeJson(FIXTURES_FILE, fixtures);
  say(`fixtures: froze ${beats.length} beats (${scriptPath} script path) → ${FIXTURES_FILE}`);
  return fixtures;
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// 2. SCRIPT GROUNDING
// ─────────────────────────────────────────────────────────────────────────────────────────────
function scoreScript(G, text, source) {
  if (!text) return null;
  return {
    ratio: round(G.groundingRatio(text, source), 4),
    ungroundedSentences: G.ungroundedSentences(text, source),
    sentences: G.splitSentences(text).length,
  };
}

/** The frozen source of one PDF beat (fixtures.pdf.sources), so a scoping change cannot move the ruler. */
function sourceForSequence(fixtures, document, sequence, G) {
  const frozen = fixtures.pdf.sources?.[sequence];
  if (frozen) return frozen;
  const planned = fixtures.pdf.plan.find((b) => b.sequence === sequence);
  return beatSource(document, planned?.sourceBlockIds ?? [], G);
}

async function scriptGrounding(fixtures, armDir, allowGenerate = true) {
  const G = groundingLib();
  const document = readJson(fixtures.pdf.sourceDocumentFile);
  const boardSeqs = new Set(fixtures.beats.filter((b) => b.kind === "pdf").map((b) => b.sequence));
  const frozen = fixtures.pdf.scripts.map((s) => {
    const source = sourceForSequence(fixtures, document, s.sequence, G);
    return {
      sequence: s.sequence, title: s.title, boardBeat: boardSeqs.has(s.sequence),
      script: scoreScript(G, s.script, source),
      transitionIn: scoreScript(G, s.transitionIn, source),
      points: scoreScript(G, (s.points ?? []).join(". "), source),
    };
  });
  const result = { frozen, fresh: null };
  const cacheFile = path.join(armDir, "fresh-scripts.json");
  if ((FRESH && ONLY !== "topics" && allowGenerate) || fs.existsSync(cacheFile)) {
    let runs;
    if (fs.existsSync(cacheFile) && (RESUME || !allowGenerate)) runs = readJson(cacheFile).runs;
    else {
      say(`scripts: re-writing the PDF lesson ${FRESH_REPS}x with the then-current script path…`);
      const input = { ...fixtures.pdf.input, suprnotes: document };
      runs = await Promise.all(Array.from({ length: FRESH_REPS }, (_, r) => writeLessonScripts("pdf", input, fixtures.pdf.plan, fixtures.pdf.plan.length - 1, `fresh${r + 1}-${Date.now()}`)
        .then((scripts) => scripts.map((s) => ({ sequence: s.sequence, title: s.beat.title, script: s.beat.script, transitionIn: s.beat.transitionIn, points: s.beat.points, costUsd: s.costUsd, ms: s.ms, path: s.path })))));
      writeJson(cacheFile, { createdAt: new Date().toISOString(), runs });
    }
    result.fresh = {
      reps: runs.length,
      path: runs.flat().some((s) => s.path === "mirror") ? "mirror" : "worker",
      costUsd: runs.flat().reduce((sum, s) => sum + (s.costUsd ?? 0), 0),
      perRun: runs.map((scripts, r) => scripts.map((s) => {
        const source = sourceForSequence(fixtures, document, s.sequence, G);
        return { run: r + 1, sequence: s.sequence, title: s.title, boardBeat: boardSeqs.has(s.sequence), script: scoreScript(G, s.script, source), transitionIn: scoreScript(G, s.transitionIn, source), points: scoreScript(G, (s.points ?? []).join(". "), source), text: s.script };
      })),
    };
  }
  return result;
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// 3. BOARDS
// ─────────────────────────────────────────────────────────────────────────────────────────────
function boardJobs(fixtures) {
  const variants = boardVariants();
  const beats = fixtures.beats.filter((b) => ONLY === "all" || (ONLY === "pdf" ? b.kind === "pdf" : b.kind === "topic"));
  const jobs = [];
  for (const beat of beats) {
    for (let rep = 1; rep <= 2 * REPS; rep++) jobs.push({ beat, variant: variants.starter, id: `${beat.key}--starter-${rep}` });
    for (let rep = 1; rep <= REPS; rep++) jobs.push({ beat, variant: variants.terra, id: `${beat.key}--terra-${rep}` });
  }
  // A fixed shuffle: the same order in every arm, and models/beats spread across the run.
  return seededShuffle(jobs, 42);
}

/** A Map that also reads as a plain object, so either access style in the generator finds it. */
function sourceMap(id, value) {
  const map = new Map([[id, value]]);
  map[id] = value;
  return map;
}

function trialFor(armDir, beatId) {
  const file = path.join(armDir, ".animation-trials", "trials.jsonl");
  if (!fs.existsSync(file)) return null;
  const lines = fs.readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } });
  return lines.filter((l) => l?.beatId === beatId).pop() ?? null;
}

async function generateBoard(job, armDir) {
  const metaFile = path.join(armDir, "boards", `${job.id}.json`);
  if (RESUME && fs.existsSync(metaFile)) return readJson(metaFile);
  const fixture = job.beat;
  const beat = JSON.parse(JSON.stringify(fixture.beat));
  beat.id = job.id;
  beat.script = fixture.baselineScript;
  // premiumPlaceholder(beat, "react-animation") from the worker: the brief is only what the student hears and reads.
  const brief = M.brief.boardBriefFor(beat);
  beat.draw = { caption: beat.title, durationMs: beat.draw?.durationMs ?? 45_000, surface: "paper", ops: [{ kind: "reactAnimation", teachingPoint: brief, at: 0, endAt: 1 }] };
  const options = { animationIndexOffset: fixture.sequence, refineTimeBudgetMs: job.variant.refineTimeBudgetMs, model: job.variant.model };
  // The worker marks its opening beats blocksPlayback (no refine call); an older arm ignores it.
  if (job.variant.blocksPlayback) options.blocksPlayback = true;
  if (fixture.kind === "pdf") options.sourceByBeatId = sourceMap(beat.id, fixture.source);
  const bucket = [];
  LOG.buckets.set(job.id, bucket);
  const startedAt = performance.now();
  let stats = null;
  let thrown = null;
  try {
    stats = await M.gen.fillReactAnimationOps(M.client, [beat], options);
  } catch (error) {
    thrown = error instanceof Error ? error.message : String(error);
  }
  const ms = Math.round(performance.now() - startedAt);
  LOG.buckets.delete(job.id);
  const op = beat.draw.ops[0];
  const codePath = op.code ? path.join(armDir, "code", `${job.id}.jsx`) : null;
  if (codePath) {
    fs.mkdirSync(path.dirname(codePath), { recursive: true });
    fs.writeFileSync(codePath, op.code);
  }
  const timing = stats?.timings?.[0] ?? null;
  const trial = trialFor(armDir, job.id);
  const meta = {
    id: job.id, beatKey: fixture.key, beat: fixture.title, kind: fixture.kind, variant: job.variant.name,
    model: op.model ?? job.variant.model.id, refineTimeBudgetMs: job.variant.refineTimeBudgetMs ?? null,
    ms, timing, costUsd: stats?.costUsd ?? null, status: op.status ?? null, error: op.error ?? thrown ?? stats?.issues?.[0] ?? null,
    outcome: timing?.outcome ?? null, refineScore: op.trial?.score ?? null, refineTrail: op.trial?.refineTrail ?? null,
    attempts: timing?.attempts?.length ?? op.trial?.attempts ?? null, abstract: trial?.abstract ?? null,
    rejections: (timing?.attempts ?? []).map((a) => a.outcome).filter((o) => /rejected|error/.test(o)),
    assetIds: op.assetIds ?? [], sentenceTotal: Math.max(1, sentencesOf(beat.script).length), brief,
    codePath, codeSha: op.code ? sha(op.code) : null, codeChars: op.code?.length ?? 0,
    logs: bucket.filter((l) => /\[anim(-vision|-refine|-timing)?\]|\[react-assets\]|layout reject|REFUSED|SHIPPED|GAVE UP|accepted best/.test(l)).slice(0, 60),
  };
  writeJson(metaFile, meta);
  return meta;
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// 4. RENDER + GEOMETRY (runs inside the sandbox iframe; must be self-contained)
// ─────────────────────────────────────────────────────────────────────────────────────────────
function measureInFrame(opts) {
  const svg = document.querySelector("#root svg");
  if (!svg) return { error: "no <svg> rendered in the sandbox" };
  const SKIP = new Set(["defs", "marker", "clippath", "mask", "pattern", "symbol", "lineargradient", "radialgradient", "filter", "title", "desc", "metadata", "style"]);
  const inSkip = (el) => { for (let n = el.parentNode; n && n !== svg; n = n.parentNode) if (n.localName && SKIP.has(n.localName.toLowerCase())) return true; return false; };
  const visible = (el) => {
    for (let n = el; n && n !== svg && n.nodeType === 1; n = n.parentNode) {
      const cs = getComputedStyle(n);
      if (cs.display === "none" || cs.visibility === "hidden" || Number(cs.opacity) === 0) return false;
    }
    return true;
  };
  const vbBase = svg.viewBox && svg.viewBox.baseVal;
  const svgRect = svg.getBoundingClientRect();
  const VB = vbBase && vbBase.width > 0 && vbBase.height > 0 ? { x: vbBase.x, y: vbBase.y, w: vbBase.width, h: vbBase.height } : { x: 0, y: 0, w: svgRect.width, h: svgRect.height };
  const inv = svg.getScreenCTM().inverse();
  const toVB = (x, y) => { const p = svg.createSVGPoint(); p.x = x; p.y = y; const q = p.matrixTransform(inv); return [q.x, q.y]; };
  const userToVB = (el, x, y) => { const p = svg.createSVGPoint(); p.x = x; p.y = y; const s = p.matrixTransform(el.getScreenCTM()); return toVB(s.x, s.y); };
  const boxVB = (el) => {
    const r = el.getBoundingClientRect();
    const a = toVB(r.left, r.top);
    const b = toVB(r.right, r.bottom);
    return { x: Math.min(a[0], b[0]), y: Math.min(a[1], b[1]), w: Math.abs(b[0] - a[0]), h: Math.abs(b[1] - a[1]) };
  };
  const area = (b) => Math.max(0, b.w) * Math.max(0, b.h);
  const distToBox = (x, y, b) => Math.hypot(Math.max(b.x - x, 0, x - (b.x + b.w)), Math.max(b.y - y, 0, y - (b.y + b.h)));
  const short = (s) => s.replace(/\s+/g, " ").trim().slice(0, 48);
  const vw = document.documentElement.clientWidth;
  const vh = document.documentElement.clientHeight;
  const scale = svg.getScreenCTM().a || 1;

  // Catalogue artwork (<Asset/>) is a <g transform="translate(dx,dy) scale(s)"> around inline SVG.
  const assetGroups = opts.assetIds && opts.assetIds.length
    ? [...svg.querySelectorAll("g[transform]")].filter((g) => /^translate\(-?[\d.eE+-]+,-?[\d.eE+-]+\) scale\(-?[\d.eE+-]+\)$/.test(g.getAttribute("transform") || "") && g.querySelectorAll("path,circle,ellipse,rect,polygon").length >= 3)
    : [];
  const inAsset = (el) => assetGroups.some((g) => g !== el && g.contains(el));

  // TEXT
  const texts = [...svg.querySelectorAll("text")]
    .filter((t) => !inSkip(t) && visible(t))
    .map((t) => ({ el: t, text: (t.textContent || "").replace(/\s+/g, " ").trim(), box: boxVB(t), client: t.getBoundingClientRect(), asset: inAsset(t) }))
    .filter((t) => t.text);
  const labelTexts = texts.filter((t) => !t.asset);

  // (a) pairwise overlaps > 2 units in both directions
  const overlaps = [];
  for (let i = 0; i < labelTexts.length; i++) for (let j = i + 1; j < labelTexts.length; j++) {
    const a = labelTexts[i].box; const b = labelTexts[j].box;
    const dx = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
    const dy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
    if (dx > 2 && dy > 2) overlaps.push({ a: short(labelTexts[i].text), b: short(labelTexts[j].text), dx: Math.round(dx), dy: Math.round(dy) });
  }
  // (b) outside the viewBox, and actually cut off by the visible frame
  const outsideViewBox = labelTexts.filter((t) => t.box.x < VB.x - 2 || t.box.y < VB.y - 2 || t.box.x + t.box.w > VB.x + VB.w + 2 || t.box.y + t.box.h > VB.y + VB.h + 2).map((t) => short(t.text));
  const clippedByFrame = labelTexts.filter((t) => t.client.left < -1 || t.client.top < -1 || t.client.right > vw + 1 || t.client.bottom > vh + 1).map((t) => short(t.text));
  // (c) still masked by the host's handwriting clip at full progress (clip narrower than the text)
  let clipAttached = 0;
  const masked = [];
  for (const t of labelTexts) {
    let step = null;
    for (let n = t.el; n && n !== svg; n = n.parentNode) {
      if (n.getAttribute && /teacher-clip-/.test(n.getAttribute("clip-path") || "")) { step = n; break; }
    }
    if (!step) continue;
    clipAttached++;
    const id = (step.getAttribute("clip-path").match(/#([^)]+)\)/) || [])[1];
    const rect = id ? svg.querySelector(`[id="${id}"] rect`) : null;
    if (!rect) continue;
    const cx = Number(rect.getAttribute("x")); const cy = Number(rect.getAttribute("y"));
    const cw = Number(rect.getAttribute("width")); const ch = Number(rect.getAttribute("height"));
    const bb = t.el.getBBox();
    const m = step.getScreenCTM().inverse().multiply(t.el.getScreenCTM());
    const corners = [[bb.x, bb.y], [bb.x + bb.width, bb.y], [bb.x, bb.y + bb.height], [bb.x + bb.width, bb.y + bb.height]].map(([x, y]) => { const p = svg.createSVGPoint(); p.x = x; p.y = y; return p.matrixTransform(m); });
    const minX = Math.min(...corners.map((p) => p.x)); const maxX = Math.max(...corners.map((p) => p.x));
    const minY = Math.min(...corners.map((p) => p.y)); const maxY = Math.max(...corners.map((p) => p.y));
    const hidden = Math.max(0, maxX - (cx + cw)) + Math.max(0, cx - minX);
    if (hidden > 1 || cy > minY + 1 || cy + ch < maxY - 1) masked.push({ text: short(t.text), hiddenWidth: Math.round(hidden), shownFraction: Math.round(100 * Math.max(0, Math.min(1, (cx + cw - minX) / Math.max(1, maxX - minX)))) / 100 });
  }
  // Host text shift (keepTextInsideBoard appends "translate(dx dy)" with a space) — informational.
  const hostShifted = labelTexts.filter((t) => /translate\(-?[\d.]+ -?[\d.]+\)\s*$/.test(t.el.getAttribute("transform") || "")).map((t) => `${short(t.text)} ${t.el.getAttribute("transform")}`);
  // Legibility: rendered font size in screen px at this frame.
  const fontPx = labelTexts.map((t) => (parseFloat(getComputedStyle(t.el).fontSize) || 16) * scale);
  const tinyText = labelTexts.filter((_, i) => fontPx[i] < 11).map((t) => short(t.text));
  const ellipsized = labelTexts.filter((t) => /(…|\.\.\.)$/.test(t.text)).map((t) => short(t.text));

  // SHAPES
  const shapeEls = [...svg.querySelectorAll("path,line,polyline,polygon,circle,ellipse,rect,image,use")].filter((el) => !inSkip(el) && !inAsset(el) && visible(el));
  const vbArea = VB.w * VB.h;
  const shapes = shapeEls.map((el) => ({ el, tag: el.localName, box: boxVB(el) })).filter((s) => s.box.w > 0 || s.box.h > 0);
  for (const g of assetGroups) if (visible(g)) shapes.push({ el: g, tag: "asset", box: boxVB(g) });
  for (const s of shapes) s.background = s.tag === "rect" && area(s.box) >= 0.5 * vbArea;
  const anchors = shapes.filter((s) => !s.background);

  // (d) dangling connectors
  const onCurve = (d) => {
    const per = { m: 2, l: 2, h: 1, v: 1, c: 6, s: 4, q: 4, t: 2, a: 7 };
    let cmd = null; let nums = 0; let count = 0; let closed = false;
    for (const tok of d.match(/[a-zA-Z]|-?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/g) || []) {
      if (/^[a-zA-Z]$/.test(tok)) { cmd = tok.toLowerCase(); nums = 0; if (cmd === "z") closed = true; continue; }
      if (!cmd || !per[cmd]) continue;
      nums++;
      if (nums % per[cmd] === 0) count++;
    }
    return { count, closed };
  };
  const unfilled = (el) => { const cs = getComputedStyle(el); return cs.fill === "none" || Number(cs.fillOpacity) === 0 || /rgba\([^)]*,\s*0\)$/.test(cs.fill) || cs.fill === "transparent"; };
  const stroked = (el) => { const cs = getComputedStyle(el); return cs.stroke && cs.stroke !== "none" && Number(cs.strokeOpacity) !== 0; };
  const hasMarker = (el) => { const cs = getComputedStyle(el); return ["markerStart", "markerMid", "markerEnd"].some((k) => cs[k] && cs[k] !== "none") || ["marker-start", "marker-mid", "marker-end"].some((a) => el.hasAttribute(a)); };
  const connectors = [];
  for (const s of shapes) {
    if (s.background || s.tag === "asset") continue;
    const el = s.el;
    let kind = null;
    if (s.tag === "line") kind = "line";
    else if ((s.tag === "path" || s.tag === "polyline") && hasMarker(el)) kind = "marker";
    else if (s.tag === "path" && unfilled(el) && stroked(el)) { const c = onCurve(el.getAttribute("d") || ""); if (!c.closed && c.count <= 3) kind = "short-path"; }
    else if (s.tag === "polyline" && unfilled(el) && stroked(el) && (el.points?.numberOfItems ?? 99) <= 3) kind = "short-path";
    if (!kind) continue;
    let ends;
    try {
      if (s.tag === "line") ends = [userToVB(el, el.x1.baseVal.value, el.y1.baseVal.value), userToVB(el, el.x2.baseVal.value, el.y2.baseVal.value)];
      else { const len = el.getTotalLength(); const p0 = el.getPointAtLength(0); const p1 = el.getPointAtLength(len); ends = [userToVB(el, p0.x, p0.y), userToVB(el, p1.x, p1.y)]; }
    } catch { continue; }
    if (Math.hypot(ends[0][0] - ends[1][0], ends[0][1] - ends[1][1]) < 6) continue;
    connectors.push({ s, kind, ends });
  }
  const connectorSet = new Set(connectors.map((c) => c.s));
  const dangling = [];
  let looseEnds = 0;
  for (const c of connectors) {
    const loose = c.ends.filter(([x, y]) => {
      const nearText = labelTexts.some((t) => distToBox(x, y, t.box) <= 20);
      if (nearText) return false;
      return !anchors.some((a) => {
        if (a === c.s) return false;
        // An arrowhead drawn as its own tiny shape AT this end is part of the connector, not a target.
        const tiny = Math.max(a.box.w, a.box.h) <= 18 && ["polygon", "path", "polyline", "line"].includes(a.tag);
        if (tiny && distToBox(x, y, a.box) <= 4) return false;
        if (connectorSet.has(a) && Math.max(a.box.w, a.box.h) <= 18) return false;
        return distToBox(x, y, a.box) <= 20;
      });
    });
    if (loose.length) {
      looseEnds += loose.length;
      dangling.push({ kind: c.kind, tag: c.s.tag, from: c.ends[0].map(Math.round), to: c.ends[1].map(Math.round), looseEnds: loose.length });
    }
  }

  // (e) content bbox coverage of the frame, and centring (client px of the iframe viewport)
  const contentClient = [...labelTexts.map((t) => t.client), ...anchors.map((a) => a.el.getBoundingClientRect())].filter((r) => r.width > 0 || r.height > 0);
  let coverage = null; let centreOffset = null; let coverageOfViewBox = null; let bbox = null;
  if (contentClient.length) {
    const u = contentClient.reduce((acc, r) => ({ l: Math.min(acc.l, r.left), t: Math.min(acc.t, r.top), r: Math.max(acc.r, r.right), b: Math.max(acc.b, r.bottom) }), { l: Infinity, t: Infinity, r: -Infinity, b: -Infinity });
    const l = Math.max(0, u.l); const t = Math.max(0, u.t); const r = Math.min(vw, u.r); const b = Math.min(vh, u.b);
    coverage = Math.max(0, r - l) * Math.max(0, b - t) / (vw * vh);
    centreOffset = [((l + r) / 2 - vw / 2) / vw, ((t + b) / 2 - vh / 2) / vh];
    const a = toVB(u.l, u.t); const z = toVB(u.r, u.b);
    coverageOfViewBox = Math.min(1, (Math.abs(z[0] - a[0]) * Math.abs(z[1] - a[1])) / vbArea);
    bbox = [Math.round(u.l), Math.round(u.t), Math.round(u.r), Math.round(u.b)];
  }
  const pct = (v) => (v === null ? null : Math.round(v * 1000) / 10);
  // How much of the frame the viewBox itself occupies once scaled to fit (a 16:9 board in a squarer
  // frame is letterboxed): the viewBox corners through the screen CTM, clamped to the viewport.
  const c0 = svg.createSVGPoint(); c0.x = VB.x; c0.y = VB.y;
  const c1 = svg.createSVGPoint(); c1.x = VB.x + VB.w; c1.y = VB.y + VB.h;
  const s0 = c0.matrixTransform(svg.getScreenCTM()); const s1 = c1.matrixTransform(svg.getScreenCTM());
  const vbFill = (Math.max(0, Math.min(vw, Math.max(s0.x, s1.x)) - Math.max(0, Math.min(s0.x, s1.x))) * Math.max(0, Math.min(vh, Math.max(s0.y, s1.y)) - Math.max(0, Math.min(s0.y, s1.y)))) / (vw * vh);
  return {
    viewBox: [VB.x, VB.y, VB.w, VB.h], frame: [vw, vh], svgPx: [Math.round(svgRect.width), Math.round(svgRect.height)],
    viewBoxFillOfFramePct: pct(vbFill),
    textCount: labelTexts.length, assetTextCount: texts.length - labelTexts.length, assetGroups: assetGroups.length,
    overlaps, overlapCount: overlaps.length,
    outsideViewBox, outsideViewBoxCount: outsideViewBox.length, clippedByFrame, clippedByFrameCount: clippedByFrame.length,
    masked, maskedCount: masked.length, clipAttachedCount: clipAttached,
    connectors: connectors.length, dangling, danglingCount: dangling.length, looseEnds,
    coveragePct: pct(coverage), coverageOfViewBoxPct: pct(coverageOfViewBox),
    centreOffsetPct: centreOffset ? centreOffset.map((v) => Math.round(v * 1000) / 10) : null, contentBBoxPx: bbox,
    hostShifted, hostShiftedCount: hostShifted.length, tinyText, tinyTextCount: tinyText.length, minFontPx: fontPx.length ? Math.round(Math.min(...fontPx) * 10) / 10 : null,
    ellipsized, labels: labelTexts.map((t) => t.text),
  };
}

let browserPromise = null;
async function browser() {
  if (!browserPromise) {
    const { chromium } = requireWeb("playwright");
    browserPromise = chromium.launch();
  }
  return browserPromise;
}

async function renderBoard(meta, frame, pngPath) {
  const code = fs.readFileSync(meta.codePath, "utf8");
  const b = await browser();
  const context = await b.newContext({ viewport: { width: 1400, height: 1000 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const renderErrors = [];
  const pageNoise = [];
  page.on("pageerror", (error) => renderErrors.push(`pageerror: ${String(error.message).slice(0, 300)}`));
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const where = message.location()?.url ?? "";
    const text = `${message.text().slice(0, 300)}${where ? ` @${where.slice(0, 60)}` : ""}`;
    if (/about:srcdoc/.test(where) || /animation|sandbox|Asset\b/i.test(message.text())) renderErrors.push(`console: ${text}`);
    else pageNoise.push(text);
  });
  try {
    await page.addInitScript((still) => { window.__BOARD_STILL__ = still; }, { code, assetIds: meta.assetIds ?? [], sentenceTotal: meta.sentenceTotal });
    await page.goto(`${BASE}/playback-lab`, { waitUntil: "domcontentloaded", timeout: 180_000 });
    await page.addStyleTag({ content: `[data-still]{width:${frame.w}px!important;height:${frame.h}px!important}` });
    // Wait for the board's <svg> inside the sandbox — or for the sandbox to crash, which unmounts
    // the iframe (ReactAnimationSandbox returns null on failure) after an error in about:srcdoc.
    let iframe = null;
    let crashedAt = null;
    for (const deadline = Date.now() + 60_000; Date.now() < deadline;) {
      iframe = await page.$("[data-still] iframe");
      const frameHandle = iframe ? await iframe.contentFrame() : null;
      const drawn = frameHandle ? await frameHandle.evaluate(() => Boolean(document.querySelector("#root svg"))).catch(() => false) : false;
      if (drawn) break;
      if (renderErrors.some((e) => /about:srcdoc/.test(e))) {
        crashedAt ??= Date.now();
        if (Date.now() - crashedAt > 2_500) break;
      }
      iframe = null;
      await page.waitForTimeout(250);
    }
    if (!iframe) {
      renderErrors.push(crashedAt ? "sandbox crashed before drawing (see the about:srcdoc error)" : "sandbox never drew an <svg> within 60 s (transpile, runtime or asset load failed)");
      await page.locator("[data-still]").screenshot({ path: pngPath }).catch(() => {});
      return { png: pngPath, renderErrors, pageNoise, metrics: null };
    }
    const content = await iframe.contentFrame();
    let settled = true;
    await content.waitForFunction(() => {
      const svg = document.querySelector("#root svg");
      if (!svg) return false;
      return [...document.querySelectorAll("[data-teach-order]")].every((n) => n.style.opacity === "1");
    }, null, { timeout: 30_000 }).catch(() => { settled = false; });
    await content.evaluate(() => (document.fonts ? document.fonts.ready.then(() => true) : true)).catch(() => {});
    await page.waitForTimeout(900);
    if (!(await page.$("[data-still] iframe"))) renderErrors.push("sandbox reported an error and unmounted");
    if (!settled) renderErrors.push("board never reached the fully-drawn state within 30 s");
    let metrics = null;
    try {
      const live = await (await page.$("[data-still] iframe"))?.contentFrame();
      metrics = live ? await live.evaluate(measureInFrame, { assetIds: meta.assetIds ?? [] }) : null;
      if (metrics?.error) renderErrors.push(metrics.error);
    } catch (error) {
      renderErrors.push(`measure failed: ${String(error.message).slice(0, 200)}`);
    }
    await page.locator("[data-still]").screenshot({ path: pngPath });
    return { png: pngPath, renderErrors, pageNoise: pageNoise.slice(0, 5), metrics };
  } finally {
    await context.close();
  }
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// 5. JUDGE
// ─────────────────────────────────────────────────────────────────────────────────────────────
const JUDGE_SYSTEM = `You are a demanding reviewer of teaching whiteboard diagrams for school students. You see ONE finished board (a still image) and are told what it must teach. Score it from 1 (unusable) to 10 (premium textbook figure) on each criterion. Be strict and consistent: an adequate classroom board is 5-6; 9-10 only for a figure a textbook publisher would print as is.

layout — placement and spacing: balanced use of the frame, no crowding, no large empty regions, nothing overlapping, a clear reading order, the title not colliding with the content.
labelling — every label fully legible (not cut off, not overlapped, not too small) and placed beside the part it names, with a leader line or arrow that actually reaches that part; arrows start and end on named things; no floating or dangling arrows.
realism — the drawings look like the real things they depict (recognisable, correctly shaped and proportioned, with their characteristic features), not generic ovals, blobs or boxes. For an abstract idea (a graph, a force diagram) judge whether it uses the correct conventional form, drawn cleanly.
accuracy — see the accuracy rule in the request.
overall — how good this board is as a teaching figure for this beat, all things considered.

Return JSON only: {"layout":n,"labelling":n,"realism":n,"accuracy":n,"overall":n,"notInSource":["…"],"errors":["…"],"summary":"one sentence"}. notInSource lists every drawn object, label, number or claim the SOURCE does not contain (empty for a board with no source). errors lists factual errors and every cut-off, overlapping, unreadable or dangling element you can see.`;

function judgeRequest(meta, fixture) {
  if (fixture.kind === "pdf") {
    const s = fixture.source;
    return `Beat title: ${fixture.title}

ACCURACY RULE (strict source mode): judge accuracy ONLY against the SOURCE below. Every drawn object, label, number and claim must be stated or shown in the source. Anything not in the source is an error even if it is true in general; anything contradicting the source is a worse error. Drawing the source's own figure faithfully is correct.

SOURCE (the only permitted material):
${s.text}

Figure labels printed in the source: ${s.labels.length ? s.labels.join(", ") : "(none)"}
${s.caption ? `Figure caption: ${s.caption}` : ""}`.trim();
  }
  return `Beat title: ${fixture.title} (lesson: ${fixture.topic})

ACCURACY RULE: scientific correctness — every drawn object, label, number, arrow direction and claim must be correct and appropriate for a school student.

What the board was briefed to teach: ${meta.brief}`;
}

async function judgePng(meta, fixture, pngPath, run) {
  const image = fs.readFileSync(pngPath).toString("base64");
  const startedAt = performance.now();
  const completion = await M.client.chat.completions.create({
    model: JUDGE_MODEL,
    temperature: 0,
    max_tokens: 700,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: JUDGE_SYSTEM },
      { role: "user", content: [{ type: "text", text: judgeRequest(meta, fixture) }, { type: "image_url", image_url: { url: `data:image/png;base64,${image}`, detail: "high" } }] },
    ],
  }, { timeout: 120_000 });
  let parsed = {};
  try { parsed = JSON.parse(completion.choices[0]?.message?.content ?? "{}"); } catch { parsed = {}; }
  const score = (k) => (Number.isFinite(Number(parsed[k])) ? Math.max(1, Math.min(10, Number(parsed[k]))) : null);
  return {
    run, model: completion.model, ms: Math.round(performance.now() - startedAt), costUsd: M.pricing.costFor(JUDGE_MODEL, completion.usage),
    scores: { layout: score("layout"), labelling: score("labelling"), realism: score("realism"), accuracy: score("accuracy"), overall: score("overall") },
    notInSource: Array.isArray(parsed.notInSource) ? parsed.notInSource.slice(0, 20) : [],
    errors: Array.isArray(parsed.errors) ? parsed.errors.slice(0, 20) : [],
    summary: typeof parsed.summary === "string" ? parsed.summary : "",
  };
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// 6. REPORT
// ─────────────────────────────────────────────────────────────────────────────────────────────
const CRITERIA = ["layout", "labelling", "realism", "accuracy", "overall"];
const GEOMETRY = [
  ["overlapCount", "text overlaps"], ["outsideViewBoxCount", "text outside viewBox"], ["clippedByFrameCount", "text cut off by frame"],
  ["maskedCount", "text still masked"], ["clipAttachedCount", "reveal clip still attached"], ["danglingCount", "dangling connectors"],
  ["looseEnds", "loose connector ends"], ["connectors", "connectors"], ["coveragePct", "content coverage %"], ["absCentreX", "|centre offset x| %"],
  ["absCentreY", "|centre offset y| %"], ["viewBoxFillOfFramePct", "viewBox fill of frame % (letterbox)"], ["textCount", "text elements"], ["tinyTextCount", "text < 11px"],
  ["hostShiftedCount", "host-shifted text"], ["renderErrorCount", "render errors"],
];

function geometryRow(render) {
  const m = render?.metrics;
  if (!render) return null;
  return {
    ...Object.fromEntries(GEOMETRY.map(([k]) => [k, m?.[k] ?? null])),
    absCentreX: m?.centreOffsetPct ? Math.abs(m.centreOffsetPct[0]) : null,
    absCentreY: m?.centreOffsetPct ? Math.abs(m.centreOffsetPct[1]) : null,
    renderErrorCount: render.renderErrors?.length ?? 0,
  };
}

function judgeMeans(boards, run) {
  const rows = boards.flatMap((b) => (b.judge ?? []).filter((j) => run === "both" || j.run === run));
  return Object.fromEntries(CRITERIA.map((c) => [c, mean(rows.map((j) => j.scores?.[c]))]));
}

function aggregate(boards) {
  const shipped = boards.filter((b) => b.codePath);
  const out = { boards: boards.length, withCode: shipped.length, failed: boards.length - shipped.length, geometry: {}, judge: {}, grounding: null };
  for (const frame of FRAMES) {
    const rows = shipped.map((b) => geometryRow(b.renders?.[frame.name])).filter(Boolean);
    out.geometry[frame.name] = Object.fromEntries(GEOMETRY.map(([k]) => [k, mean(rows.map((r) => r[k]))]));
    out.geometry[frame.name].boardsWithOverlap = rows.filter((r) => r.overlapCount > 0).length;
    out.geometry[frame.name].boardsWithDangling = rows.filter((r) => r.danglingCount > 0).length;
    out.geometry[frame.name].boardsWithMasked = rows.filter((r) => r.maskedCount > 0).length;
    out.geometry[frame.name].boardsWithRenderError = rows.filter((r) => r.renderErrorCount > 0).length;
    out.geometry[frame.name].measured = rows.length;
  }
  out.judge = { run1: judgeMeans(shipped, 1), run2: judgeMeans(shipped, 2), mean: judgeMeans(shipped, "both") };
  out.judge.meanAbsRunDiff = Object.fromEntries(CRITERIA.map((c) => [c, mean(shipped.map((b) => {
    const [r1, r2] = [b.judge?.find((j) => j.run === 1), b.judge?.find((j) => j.run === 2)];
    return r1 && r2 && r1.scores[c] != null && r2.scores[c] != null ? Math.abs(r1.scores[c] - r2.scores[c]) : null;
  }))]));
  const grounded = shipped.filter((b) => b.labelGrounding);
  if (grounded.length) {
    out.grounding = {
      boards: grounded.length,
      meanGroundedShare: mean(grounded.map((b) => b.labelGrounding.share)),
      meanUngroundedLabels: mean(grounded.map((b) => b.labelGrounding.ungrounded.length)),
      boardsFullyGrounded: grounded.filter((b) => b.labelGrounding.ungrounded.length === 0).length,
      judgeNotInSourceMean: mean(grounded.map((b) => mean((b.judge ?? []).map((j) => j.notInSource.length)))),
    };
  }
  return out;
}

function latencyTable(boards) {
  const byModel = new Map();
  for (const b of boards) {
    const list = byModel.get(b.model) ?? [];
    list.push(b);
    byModel.set(b.model, list);
  }
  return [...byModel.entries()].map(([model, list]) => ({
    model, n: list.length, failed: list.filter((b) => !b.codePath).length,
    p50: percentile(list.map((b) => b.ms), 50), p90: percentile(list.map((b) => b.ms), 90), max: Math.max(...list.map((b) => b.ms)),
    phaseP50: Object.fromEntries(["modelMs", "checkMs", "criticMs", "refineMs", "assetsMs"].map((k) => [k, percentile(list.map((b) => b.timing?.[k]), 50)])),
    costMean: mean(list.map((b) => b.costUsd)),
    abstractBoards: list.filter((b) => b.abstract).length,
    outcomes: list.reduce((acc, b) => ({ ...acc, [b.outcome ?? "none"]: (acc[b.outcome ?? "none"] ?? 0) + 1 }), {}),
  }));
}

function renderStatus(b) {
  if (!b.codePath) return "no board";
  const errors = FRAMES.flatMap((f) => b.renders?.[f.name]?.renderErrors ?? []);
  if (!errors.length) return b.renders ? "ok" : "not rendered";
  return `ERROR: ${errors[0].replace(/\s+/g, " ").replace(/\|/g, "/").slice(0, 70)}`;
}
const f1 = (v, d = 1) => (v === null || v === undefined || Number.isNaN(v) ? "—" : typeof v === "number" ? v.toFixed(d) : String(v));
const secs = (ms) => (ms === null || ms === undefined ? "—" : `${(ms / 1000).toFixed(1)} s`);

function summaryMarkdown(results) {
  const L = [];
  const all = results.boards;
  L.push(`# Board eval — arm \`${results.arm}\`${results.dryRun ? " — DRY RUN (mock OpenAI; numbers are meaningless)" : ""}`, "");
  L.push(`Run ${results.startedAt} → ${results.finishedAt}. Code ${results.git.snapshot ? `snapshot ${results.git.snapshot} (taken from ` : ""}git ${results.git.head?.slice(0, 10)} on ${results.git.branch}, ${results.git.dirty.length} dirty paths${results.git.snapshot ? ")" : ""}. Fixtures ${results.fixtures.sha} (created ${results.fixtures.createdAt}, scripts via the ${results.fixtures.scriptPath} path on ${results.fixtures.scriptModel}).`);
  L.push(`Boards: ${results.options.variants.map((v) => `${v.name} = ${v.model} (refine budget ${v.refineTimeBudgetMs ? `${v.refineTimeBudgetMs / 1000} s` : "default"})`).join("; ")}; ${results.options.reps} rep(s) → ${all.length} boards, concurrency ${results.options.concurrency}. Judge ${results.options.judgeModel}, temperature 0, 2 runs per 1100x620 PNG.`);
  L.push(`${results.dryRun ? "Mock-priced (nothing was spent): " : ""}Spend: boards $${f1(results.spend.boardsUsd, 3)}, judge $${f1(results.spend.judgeUsd, 3)}, scripts $${f1(results.spend.scriptsUsd, 3)} → **$${f1(results.spend.totalUsd, 2)}**.`, "");

  L.push("## Board latency (wall clock around fillReactAnimationOps)", "");
  L.push("| model | n | failed | p50 | p90 | max | model p50 | check p50 | critic p50 | refine p50 | mean $ | abstract | outcomes |");
  L.push("|---|---|---|---|---|---|---|---|---|---|---|---|---|");
  for (const r of results.latency) {
    L.push(`| ${r.model} | ${r.n} | ${r.failed} | ${secs(r.p50)} | ${secs(r.p90)} | ${secs(r.max)} | ${secs(r.phaseP50.modelMs)} | ${secs(r.phaseP50.checkMs)} | ${secs(r.phaseP50.criticMs)} | ${secs(r.phaseP50.refineMs)} | ${f1(r.costMean, 3)} | ${r.abstractBoards} | ${Object.entries(r.outcomes).map(([k, v]) => `${k} ${v}`).join(", ")} |`);
  }
  L.push("");

  L.push("## Geometry (means per board, measured in the browser; viewBox units unless %)", "");
  const groups = [["all", results.aggregate.all], ["pdf", results.aggregate.pdf], ["topic", results.aggregate.topic], ...Object.entries(results.aggregate.byModel)];
  for (const frame of FRAMES) {
    L.push(`### ${frame.name}${frame.name === "772x690" ? " (PDF split view)" : ""}`, "");
    L.push(`| metric | ${groups.map(([name]) => name).join(" | ")} |`);
    L.push(`|---|${groups.map(() => "---").join("|")}|`);
    for (const [key, label] of GEOMETRY) L.push(`| ${label} | ${groups.map(([, agg]) => f1(agg?.geometry?.[frame.name]?.[key], 2)).join(" | ")} |`);
    for (const [key, label] of [["boardsWithOverlap", "boards with ≥1 overlap"], ["boardsWithDangling", "boards with ≥1 dangling"], ["boardsWithMasked", "boards with ≥1 masked text"], ["boardsWithRenderError", "boards with a render error"], ["measured", "boards measured"]]) {
      L.push(`| ${label} | ${groups.map(([, agg]) => f1(agg?.geometry?.[frame.name]?.[key], 0)).join(" | ")} |`);
    }
    L.push("");
  }

  L.push("## Label grounding (PDF boards, rendered <text> vs sourceVocabulary)", "");
  const g = results.aggregate.pdf?.grounding;
  if (g) {
    L.push(`Mean grounded share **${f1(g.meanGroundedShare * 100)}%**, mean ungrounded labels per board ${f1(g.meanUngroundedLabels, 2)}, fully grounded boards ${g.boardsFullyGrounded}/${g.boards}; judge "not in source" items per board ${f1(g.judgeNotInSourceMean, 2)}.`, "");
  } else L.push("No PDF boards in this arm.", "");

  L.push("## Judge (gpt-4o, 1-10, 1100x620)", "");
  L.push(`| group | run | ${CRITERIA.join(" | ")} |`);
  L.push(`|---|---|${CRITERIA.map(() => "---").join("|")}|`);
  for (const [name, agg] of groups) {
    if (!agg) continue;
    for (const run of ["run1", "run2", "mean"]) L.push(`| ${name} | ${run} | ${CRITERIA.map((c) => f1(agg.judge[run][c], 2)).join(" | ")} |`);
    L.push(`| ${name} | mean abs(run1−run2) | ${CRITERIA.map((c) => f1(agg.judge.meanAbsRunDiff[c], 2)).join(" | ")} |`);
  }
  L.push("");

  L.push("## Per board", "");
  L.push("| board | kind | model | time | outcome | abstract | render | overlaps 1100/772 | dangling 1100/772 | masked | coverage % 1100/772 | centre % (x,y) 1100 | grounded | ungrounded labels | judge overall r1/r2 | accuracy r1/r2 |");
  L.push("|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|");
  for (const b of [...all].sort((a, z) => a.id.localeCompare(z.id))) {
    const r1 = b.renders?.["1100x620"]?.metrics; const r2 = b.renders?.["772x690"]?.metrics;
    const j1 = b.judge?.find((j) => j.run === 1)?.scores; const j2 = b.judge?.find((j) => j.run === 2)?.scores;
    L.push(`| ${b.id} | ${b.kind} | ${b.model} | ${secs(b.ms)} | ${b.outcome ?? "—"}${b.codePath ? "" : " (no code)"} | ${b.abstract ?? "—"} | ${renderStatus(b)} | ${f1(r1?.overlapCount, 0)}/${f1(r2?.overlapCount, 0)} | ${f1(r1?.danglingCount, 0)}/${f1(r2?.danglingCount, 0)} | ${f1(r1?.maskedCount, 0)} | ${f1(r1?.coveragePct)}/${f1(r2?.coveragePct)} | ${r1?.centreOffsetPct ? r1.centreOffsetPct.join(", ") : "—"} | ${b.labelGrounding ? `${f1(b.labelGrounding.share * 100, 0)}%` : "—"} | ${b.labelGrounding ? b.labelGrounding.ungrounded.map((u) => `"${u.label}"`).join(", ").slice(0, 160) || "none" : "—"} | ${f1(j1?.overall, 0)}/${f1(j2?.overall, 0)} | ${f1(j1?.accuracy, 0)}/${f1(j2?.accuracy, 0)} |`);
  }
  L.push("");

  L.push("## PDF script grounding (sourceGrounding.ts, frozen copy)", "");
  const sg = results.scriptGrounding;
  const ug = (s) => (s ? s.ungroundedSentences.length : "—");
  L.push("Frozen scripts (these feed the boards in every arm):", "");
  L.push("| seq | beat | board beat | script ratio | ungrounded sentences | transitionIn ratio | points ratio |");
  L.push("|---|---|---|---|---|---|---|");
  for (const row of sg.frozen) L.push(`| ${row.sequence} | ${row.title} | ${row.boardBeat ? "yes" : ""} | ${f1(row.script?.ratio, 3)} | ${ug(row.script)} of ${row.script?.sentences ?? "—"} | ${f1(row.transitionIn?.ratio, 3)} | ${f1(row.points?.ratio, 3)} |`);
  const boardRows = sg.frozen.filter((r) => r.boardBeat);
  L.push(`| | **mean (board beats)** | | ${f1(mean(boardRows.map((r) => r.script?.ratio)), 3)} | ${f1(mean(boardRows.map((r) => r.script?.ungroundedSentences.length)), 2)} | | |`);
  L.push(`| | **mean (all ${sg.frozen.length})** | | ${f1(mean(sg.frozen.map((r) => r.script?.ratio)), 3)} | ${f1(mean(sg.frozen.map((r) => r.script?.ungroundedSentences.length)), 2)} | | |`, "");
  const examples = boardRows.flatMap((r) => (r.script?.ungroundedSentences ?? []).slice(0, 2).map((s) => `- **${r.title}**: "${s.sentence.slice(0, 180)}" — missing: ${s.missing.slice(0, 8).join(", ")}`));
  if (examples.length) L.push("Examples of ungrounded sentences in the frozen scripts:", "", ...examples.slice(0, 10), "");
  if (sg.fresh) {
    L.push(`Fresh scripts (--fresh-scripts: the whole PDF lesson re-written ${sg.fresh.reps}x with the then-current ${sg.fresh.path} path, $${f1(sg.fresh.costUsd, 3)}):`, "");
    L.push("| seq | beat | board beat | ratio per run | mean ratio | ungrounded sentences per run |");
    L.push("|---|---|---|---|---|---|");
    const seqs = [...new Set(sg.fresh.perRun.flat().map((r) => r.sequence))].sort((a, z) => a - z);
    for (const seq of seqs) {
      const rows = sg.fresh.perRun.map((run) => run.find((r) => r.sequence === seq)).filter(Boolean);
      L.push(`| ${seq} | ${rows[0]?.title} | ${rows[0]?.boardBeat ? "yes" : ""} | ${rows.map((r) => f1(r.script?.ratio, 3)).join(" / ")} | ${f1(mean(rows.map((r) => r.script?.ratio)), 3)} | ${rows.map((r) => ug(r.script)).join(" / ")} |`);
    }
    const flat = sg.fresh.perRun.flat();
    const fb = flat.filter((r) => r.boardBeat);
    L.push(`| | **mean (board beats)** | | | ${f1(mean(fb.map((r) => r.script?.ratio)), 3)} | ${f1(mean(fb.map((r) => r.script?.ungroundedSentences.length)), 2)} |`);
    L.push(`| | **mean (all beats)** | | | ${f1(mean(flat.map((r) => r.script?.ratio)), 3)} | ${f1(mean(flat.map((r) => r.script?.ungroundedSentences.length)), 2)} |`, "");
  }

  L.push("## Files", "");
  L.push(`- results: \`${results.files.results}\``, `- PNGs: \`${results.files.png}\``, `- board code: \`${results.files.code}\``, `- per-board generation records: \`${results.files.boards}\``, `- generator log: \`${results.files.log}\``, `- contact sheet: \`${results.files.index}\``, "");
  L.push("## Protocol notes", "", ...results.notes.map((n) => `- ${n}`), "");
  return L.join("\n");
}

function contactSheet(results, armDir) {
  const rows = [...results.boards].sort((a, z) => a.id.localeCompare(z.id)).map((b) => {
    const j = b.judge?.find((x) => x.run === 1);
    const imgs = FRAMES.map((f) => b.renders?.[f.name]?.png ? `<img src="${path.relative(armDir, b.renders[f.name].png)}" style="height:${f.name === "1100x620" ? 250 : 224}px">` : "").join(" ");
    return `<section><h3>${b.id} · ${b.model} · ${secs(b.ms)} · judge ${j ? CRITERIA.map((c) => `${c[0]}${j.scores[c]}`).join(" ") : "—"}</h3>${imgs}<p>${j?.summary ?? ""}</p>${b.labelGrounding?.ungrounded.length ? `<p>ungrounded: ${b.labelGrounding.ungrounded.map((u) => u.label).join(" · ")}</p>` : ""}</section>`;
  }).join("\n");
  fs.writeFileSync(path.join(armDir, "index.html"), `<!doctype html><meta charset="utf-8"><title>Board eval ${results.arm}</title><style>body{font:13px system-ui;margin:16px;background:#f4f4f2}section{background:#fff;padding:8px 12px;margin:0 0 12px;border-radius:6px}h3{margin:4px 0;font-size:13px}img{border:1px solid #ddd;margin-right:8px}</style><h1>${results.arm}</h1>${rows}`);
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// COMPARE two arms
// ─────────────────────────────────────────────────────────────────────────────────────────────
function compareArms(a, b) {
  const A = readJson(path.join(EVAL_DIR, a, "results.json"));
  const B = readJson(path.join(EVAL_DIR, b, "results.json"));
  const L = [`# Board eval — \`${a}\` vs \`${b}\``, ""];
  L.push("## Latency gates (p50 ≤ 1.05×, p90 ≤ 1.10×)", "", "| model | p50 A | p50 B | ratio | p90 A | p90 B | ratio | gate |", "|---|---|---|---|---|---|---|---|");
  for (const ra of A.latency) {
    const rb = B.latency.find((r) => r.model === ra.model);
    if (!rb) continue;
    const r50 = rb.p50 / ra.p50; const r90 = rb.p90 / ra.p90;
    L.push(`| ${ra.model} | ${secs(ra.p50)} | ${secs(rb.p50)} | ${f1(r50, 2)} | ${secs(ra.p90)} | ${secs(rb.p90)} | ${f1(r90, 2)} | ${r50 <= 1.05 && r90 <= 1.1 ? "pass" : "FAIL"} |`);
  }
  L.push("", "## Means", "", `| group | metric | ${a} | ${b} | Δ |`, "|---|---|---|---|---|");
  for (const group of ["all", "pdf", "topic"]) {
    const ga = A.aggregate[group]; const gb = B.aggregate[group];
    if (!ga || !gb) continue;
    for (const c of CRITERIA) L.push(`| ${group} | judge ${c} | ${f1(ga.judge.mean[c], 2)} | ${f1(gb.judge.mean[c], 2)} | ${f1(gb.judge.mean[c] - ga.judge.mean[c], 2)} |`);
    for (const frame of FRAMES) for (const [key, label] of GEOMETRY) {
      const va = ga.geometry[frame.name]?.[key]; const vb = gb.geometry[frame.name]?.[key];
      L.push(`| ${group} | ${label} @${frame.name} | ${f1(va, 2)} | ${f1(vb, 2)} | ${va != null && vb != null ? f1(vb - va, 2) : "—"} |`);
    }
    if (ga.grounding && gb.grounding) L.push(`| ${group} | label grounded share | ${f1(ga.grounding.meanGroundedShare, 3)} | ${f1(gb.grounding.meanGroundedShare, 3)} | ${f1(gb.grounding.meanGroundedShare - ga.grounding.meanGroundedShare, 3)} |`);
  }
  L.push("", "## Paired by beat (mean over that beat's boards)", "", `| beat | judge overall ${a} | ${b} | Δ | overlaps@1100 ${a} | ${b} | dangling@1100 ${a} | ${b} | grounded ${a} | ${b} |`, "|---|---|---|---|---|---|---|---|---|---|");
  const beats = [...new Set(A.boards.map((x) => x.beatKey))];
  for (const key of beats) {
    const pa = A.boards.filter((x) => x.beatKey === key); const pb = B.boards.filter((x) => x.beatKey === key);
    const jo = (list) => mean(list.flatMap((x) => (x.judge ?? []).map((j) => j.scores.overall)));
    const gm = (list, k) => mean(list.map((x) => x.renders?.["1100x620"]?.metrics?.[k]));
    const gr = (list) => mean(list.map((x) => x.labelGrounding?.share));
    L.push(`| ${key} | ${f1(jo(pa), 2)} | ${f1(jo(pb), 2)} | ${f1(jo(pb) - jo(pa), 2)} | ${f1(gm(pa, "overlapCount"), 2)} | ${f1(gm(pb, "overlapCount"), 2)} | ${f1(gm(pa, "danglingCount"), 2)} | ${f1(gm(pb, "danglingCount"), 2)} | ${f1(gr(pa), 2)} | ${f1(gr(pb), 2)} |`);
  }
  const fr = (R) => (R.scriptGrounding.fresh ? mean(R.scriptGrounding.fresh.perRun.flat().filter((r) => r.boardBeat).map((r) => r.script?.ratio)) : null);
  L.push("", "## Script grounding", "", `| | ${a} | ${b} |`, "|---|---|---|", `| frozen scripts, mean ratio (board beats) | ${f1(mean(A.scriptGrounding.frozen.filter((r) => r.boardBeat).map((r) => r.script?.ratio)), 3)} | ${f1(mean(B.scriptGrounding.frozen.filter((r) => r.boardBeat).map((r) => r.script?.ratio)), 3)} |`, `| fresh scripts, mean ratio (board beats) | ${f1(fr(A), 3)} | ${f1(fr(B), 3)} |`, "");
  const out = path.join(EVAL_DIR, `compare-${a}-vs-${b}.md`);
  fs.writeFileSync(out, L.join("\n"));
  rawOut(L.join("\n"));
  rawOut(`\nwrote ${out}`);
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────────────────────────────────────────────────────
async function main() {
  if (args.values.snapshot) {
    snapshotCode(args.values.snapshot);
    return;
  }
  if (args.values.compare) {
    const [a, b] = args.values.compare.split(",");
    compareArms(a, b);
    return;
  }
  loadEnv();
  const stale = checkTestBuild();
  if (DRY_RUN) {
    await startMockOpenAI();
    say(`DRY RUN: OpenAI is a local mock at ${process.env.OPENAI_BASE_URL}; results go to ${EVAL_DIR} and mean nothing about quality.`);
  }
  // Before the arm directory exists: a run that cannot spend must leave nothing behind.
  const modelStages = ["fixtures", "scripts", "boards", "judge"].some((stage) => STAGES.has(stage));
  if (modelStages && !DRY_RUN) await preflightOpenAI();

  const armDir = path.join(EVAL_DIR, ARM);
  if (fs.existsSync(armDir) && !RESUME) {
    const aside = `${armDir}.prev-${new Date().toISOString().replace(/[:.]/g, "-")}`;
    fs.renameSync(armDir, aside);
    rawOut(`moved the previous ${ARM} arm aside → ${aside}`);
  }
  fs.mkdirSync(armDir, { recursive: true });
  LOG.stream = fs.createWriteStream(path.join(armDir, "generation.log"), { flags: "a" });
  captureConsole();
  loadModules(armDir);
  const startedAt = new Date().toISOString();
  const notes = [
    "Scripts are frozen in fixtures.json and feed the board generator in every arm; only board generation, the sandbox host and rendering differ between arms.",
    `Script path: the real lib/progressiveLectureWorker.ts generate-beat task, loaded via tsx with progressiveLectureStore/Queue/Dispatch and lectureArchive replaced by an in-memory store (mirror fallback: mirrorGenerateBeat). Beats of a lesson are written in order so each sees the earlier beats' claims, as in production. No page images (documentId omitted), no persona; a fixed learner profile (${JSON.stringify(LEARNER_RAW)}) supplies the learner brief.`,
    "Board options mirror the worker: starter = PROGRESSIVE_STARTER_ANIMATION_MODEL ?? gpt-5.6-luna with PROGRESSIVE_STARTER_REFINE_BUDGET_MS ?? 20 s and blocksPlayback (no refine call); terra = modelForTier('moderate') with the module-default refine budget (a non-starter beat's options). The placeholder op mirrors premiumPlaceholder: teachingPoint = boardBriefFor(beat). PDF beats also pass options.sourceByBeatId (a Map that also has the id as an own property) = {text: scopedBlockText, labels: figureLabelsFromBlocks, caption, strict: true}.",
    "Each board gets its own beat id (<beat>--<variant>-<rep>) so logs, trials and sourceByBeatId are per board. Trial lines go to <arm>/.animation-trials/trials.jsonl (the module is loaded from the arm directory), which is where each board's abstract flag comes from.",
    "Geometry is measured in the sandbox iframe after every [data-teach-order] reaches opacity 1 (+0.9 s), in viewBox units: overlaps = text boxes intersecting >2 units in both axes; outside = beyond the viewBox by >2; masked = a host teacher-clip still narrower/shorter than its text; dangling = an endpoint of a <line>, a marker-bearing path/polyline, or an open unfilled path/polyline with ≤3 on-curve points that is >20 units from every other shape/text box (rects covering ≥50% of the viewBox ignored; a tiny (≤18) arrowhead shape at that very end does not count as a target); coverage/centre = the union of text and non-background shape boxes in the iframe viewport.",
    "Label grounding uses a copy of .test-build/lib/sourceGrounding.js frozen with the fixtures (metric-lib/), so a later change to the module cannot move the ruler; the rendered <text> strings (catalogue-artwork text excluded) are tested with labelIsGrounded(sourceVocabulary({text, labels, caption})).",
    "The judge sees the 1100x620 PNG at detail=high, twice, temperature 0, no seed; PDF beats are judged against their source text/labels/caption only, topic beats for scientific correctness against their board brief.",
    "Latency is one run of each arm, not interleaved, so provider drift between runs is a confound; board order is a fixed seeded shuffle in every arm.",
  ];
  if (stale.length) notes.push(`WARNING: ran with a stale .test-build (${stale.length} files newer than their build).`);

  const fixtures = STAGES.has("fixtures") || !fs.existsSync(FIXTURES_FILE) ? await buildFixtures() : readJson(FIXTURES_FILE);
  const fixturesSha = sha(fs.readFileSync(FIXTURES_FILE, "utf8"));
  const G = groundingLib();

  // Frozen-script grounding is free and always reported; fresh scripts are written only in the
  // scripts stage (and reused from fresh-scripts.json otherwise).
  const scriptGroundingResult = await scriptGrounding(fixtures, armDir, STAGES.has("scripts"));
  say(`scripts: frozen board-beat mean grounding ratio ${f1(mean(scriptGroundingResult.frozen.filter((r) => r.boardBeat).map((r) => r.script?.ratio)), 3)}${scriptGroundingResult.fresh ? `; fresh ${f1(mean(scriptGroundingResult.fresh.perRun.flat().filter((r) => r.boardBeat).map((r) => r.script?.ratio)), 3)}` : ""}`);

  releaseWorker();
  const jobs = boardJobs(fixtures);
  const variants = boardVariants();
  let boards = [];
  if (STAGES.has("boards")) {
    say(`boards: ${jobs.length} boards (${[...new Set(jobs.map((j) => j.variant.model.id))].join(", ")}), concurrency ${CONCURRENCY}…`);
    let done = 0;
    boards = await pool(jobs, CONCURRENCY, async (job) => {
      const meta = await generateBoard(job, armDir);
      done++;
      say(`  [${done}/${jobs.length}] ${job.id}: ${secs(meta.ms)} ${meta.outcome ?? meta.status ?? "?"}${meta.abstract ? " (abstract)" : ""} $${f1(meta.costUsd, 3)}${meta.codePath ? "" : ` NO CODE: ${String(meta.error).slice(0, 120)}`}`);
      return meta;
    });
  } else {
    boards = jobs.map((job) => path.join(armDir, "boards", `${job.id}.json`)).filter((f) => fs.existsSync(f)).map(readJson);
  }

  const fixtureByKey = new Map(fixtures.beats.map((b) => [b.key, b]));
  const pngDir = path.join(armDir, "png");
  fs.mkdirSync(pngDir, { recursive: true });
  if (STAGES.has("render")) {
    const reachable = await fetch(`${BASE}/playback-lab`).then((r) => r.ok).catch(() => false);
    if (!reachable) throw new Error(`${BASE}/playback-lab is not reachable: start the dev server (npm run dev) and re-run with --resume`);
    const renderJobs = boards.filter((b) => b.codePath).flatMap((b) => FRAMES.map((frame) => ({ b, frame })));
    say(`render: ${renderJobs.length} stills at ${FRAMES.map((f) => f.name).join(" + ")}…`);
    await pool(renderJobs, RENDER_CONCURRENCY, async ({ b, frame }) => {
      const cacheFile = path.join(armDir, "renders", `${b.id}-${frame.name}.json`);
      if (RESUME && fs.existsSync(cacheFile)) { b.renders = { ...(b.renders ?? {}), [frame.name]: readJson(cacheFile) }; return; }
      let render;
      for (let attempt = 1; attempt <= 2; attempt++) {
        try {
          render = await renderBoard(b, frame, path.join(pngDir, `${b.id}-${frame.name}.png`));
          break;
        } catch (error) {
          render = { png: null, renderErrors: [`render harness failed: ${String(error.message).slice(0, 200)}`], metrics: null };
        }
      }
      writeJson(cacheFile, render);
      b.renders = { ...(b.renders ?? {}), [frame.name]: render };
    });
  } else {
    for (const b of boards) for (const frame of FRAMES) {
      const cacheFile = path.join(armDir, "renders", `${b.id}-${frame.name}.json`);
      if (fs.existsSync(cacheFile)) b.renders = { ...(b.renders ?? {}), [frame.name]: readJson(cacheFile) };
    }
  }

  // (h) label grounding, node-side, on what the browser actually drew at 1100x620
  for (const b of boards) {
    const fixture = fixtureByKey.get(b.beatKey);
    const labels = b.renders?.["1100x620"]?.metrics?.labels;
    if (fixture?.kind !== "pdf" || !labels) continue;
    const vocab = G.sourceVocabulary(fixture.source);
    const rows = labels.map((label) => ({ label, missing: G.ungroundedTerms(label, vocab) }));
    b.labelGrounding = { total: rows.length, share: rows.length ? rows.filter((r) => r.missing.length === 0).length / rows.length : 1, ungrounded: rows.filter((r) => r.missing.length > 0) };
  }

  if (STAGES.has("judge")) {
    const judgeJobs = boards.filter((b) => b.renders?.["1100x620"]?.png && fs.existsSync(b.renders["1100x620"].png)).flatMap((b) => [1, 2].map((run) => ({ b, run })));
    say(`judge: ${judgeJobs.length} calls on ${JUDGE_MODEL}…`);
    await pool(judgeJobs, JUDGE_CONCURRENCY, async ({ b, run }) => {
      const cacheFile = path.join(armDir, "judge", `${b.id}-run${run}.json`);
      let verdict;
      if (RESUME && fs.existsSync(cacheFile)) verdict = readJson(cacheFile);
      else {
        for (let attempt = 1; attempt <= 3 && !verdict; attempt++) {
          try { verdict = await judgePng(b, fixtureByKey.get(b.beatKey), b.renders["1100x620"].png, run); } catch (error) { say(`  ! judge ${b.id} run ${run} attempt ${attempt}: ${error.message}`); }
        }
        if (verdict) writeJson(cacheFile, verdict);
      }
      if (verdict) b.judge = [...(b.judge ?? []).filter((j) => j.run !== run), verdict].sort((x, z) => x.run - z.run);
    });
  } else {
    for (const b of boards) for (const run of [1, 2]) {
      const cacheFile = path.join(armDir, "judge", `${b.id}-run${run}.json`);
      if (fs.existsSync(cacheFile)) b.judge = [...(b.judge ?? []), readJson(cacheFile)];
    }
  }

  const byKind = (kind) => boards.filter((b) => b.kind === kind);
  const models = [...new Set(boards.map((b) => b.model))];
  if (DRY_RUN) notes.unshift("DRY RUN — every model answer came from a local mock (canned scripts, one canned board, canned verdicts). These numbers validate the harness plumbing only.");
  const results = {
    arm: ARM, dryRun: DRY_RUN, startedAt, finishedAt: new Date().toISOString(), codeRoot: WEB,
    git: codeProvenance(),
    fixtures: { file: FIXTURES_FILE, sha: fixturesSha, createdAt: fixtures.createdAt, scriptModel: fixtures.scriptModel, scriptPath: fixtures.scriptPath },
    options: {
      only: ONLY, reps: REPS, concurrency: CONCURRENCY, freshScripts: FRESH, freshReps: FRESH ? FRESH_REPS : 0, judgeModel: JUDGE_MODEL, base: BASE, frames: FRAMES.map((f) => f.name),
      variants: Object.values(variants).map((v) => ({ name: v.name, model: v.model.id, refineTimeBudgetMs: v.refineTimeBudgetMs ?? null })),
      env: Object.fromEntries(["OPENAI_ANIMATION_MODEL", "OPENAI_ANIMATION_ATTEMPTS", "OPENAI_ANIMATION_MAX_TOKENS", "ANIMATION_CANDIDATES", "REACT_REFINE_ROUNDS", "REACT_REFINE_TIME_BUDGET_MS", "OPENAI_VISION_MODEL", "REACT_ANIMATION_VISION_CRITIC", "SVG_DEBUG_SAVE", "ANIMATION_TRIAL_RUN"].map((k) => [k, k === "OPENAI_ANIMATION_MODEL" || k === "SVG_DEBUG_SAVE" || k === "ANIMATION_TRIAL_RUN" || k.endsWith("_ATTEMPTS") || k.endsWith("_TOKENS") ? process.env[k] ?? null : process.env[k] ? "(set)" : null])),
    },
    spend: {
      boardsUsd: boards.reduce((s, b) => s + (b.costUsd ?? 0), 0),
      judgeUsd: boards.reduce((s, b) => s + (b.judge ?? []).reduce((t, j) => t + (j.costUsd ?? 0), 0), 0),
      scriptsUsd: scriptGroundingResult.fresh?.costUsd ?? 0,
    },
    latency: latencyTable(boards),
    aggregate: {
      all: aggregate(boards), pdf: byKind("pdf").length ? aggregate(byKind("pdf")) : null, topic: byKind("topic").length ? aggregate(byKind("topic")) : null,
      byModel: Object.fromEntries(models.map((m) => [m, aggregate(boards.filter((b) => b.model === m))])),
    },
    scriptGrounding: scriptGroundingResult,
    boards: boards.map((b) => ({ ...b, pngs: Object.fromEntries(Object.entries(b.renders ?? {}).map(([k, v]) => [k, v.png])) })),
    files: {
      results: path.join(armDir, "results.json"), summary: path.join(armDir, "summary.md"), png: pngDir, code: path.join(armDir, "code"),
      boards: path.join(armDir, "boards"), log: path.join(armDir, "generation.log"), index: path.join(armDir, "index.html"),
    },
    notes,
  };
  results.spend.totalUsd = results.spend.boardsUsd + results.spend.judgeUsd + results.spend.scriptsUsd;
  writeJson(results.files.results, results);
  if (STAGES.has("report")) {
    fs.writeFileSync(results.files.summary, summaryMarkdown(results));
    contactSheet(results, armDir);
  }
  say(`done: ${results.files.summary} (spend $${f1(results.spend.totalUsd, 2)})`);
}

main()
  .catch((error) => {
    rawOut(`eval-boards failed: ${error?.stack ?? error}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (browserPromise) await (await browserPromise).close().catch(() => {});
    releaseWorker();
    LOG.stream?.end();
  });

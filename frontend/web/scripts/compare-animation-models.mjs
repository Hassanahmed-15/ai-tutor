/**
 * Which model draws the best lecture animations? Needs `npm run dev` running.
 *
 *   node scripts/compare-animation-models.mjs head-to-head <out-dir> [beats=6]
 *   node scripts/compare-animation-models.mjs summarise [trials.jsonl]
 *
 * HEAD-TO-HEAD is the fair verdict. In a rotated lecture (ANIMATION_MODEL_ROTATION=1) each model gets
 * DIFFERENT beats, and beats differ in difficulty, so a model can look good by drawing easy ones.
 * Here every chosen beat is drawn by all three models through the real pipeline (the dev-only
 * /api/sandbox-board route runs fillReactAnimationOps with the model pinned), and every board is
 * scored by the same judge. Each finished board is screenshotted fully drawn, so the numbers can be
 * checked by eye — the scores have been wrong before, and the pictures have not.
 *
 * SUMMARISE reads the trial log every generated board appends to (.animation-trials/trials.jsonl),
 * which includes boards from real rotated lectures.
 *
 * Provider failures (a 503, a timeout) are counted apart from drawing failures: a model that could
 * not be reached has not drawn a bad board, and the report says which is which.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const BASE = process.env.LAB_URL ?? "http://localhost:3000";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MODELS = ["gpt-5.6-luna", "gpt-5.6-terra", "gpt-5.6-sol"];
const [mode, ...rest] = process.argv.slice(2);

const split = (t) => t.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean);
const PHYSICAL = /\b(cell|membrane|organ|heart|lung|brain|neuron|leaf|plant|photosynth|molecule|atom|reaction|enzyme|protein|dna|blood|anatomy|engine|circuit|battery|motor|magnet|wave|lens|planet|orbit|volcano|rock|river|climate|animal|bacteria|virus|digest|respirat)\b/i;

function median(values) {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** One row per model: the numbers the report is built from. */
export function summarise(trials) {
  return MODELS.map((model) => {
    const mine = trials.filter((t) => t.model === model);
    const reached = mine.filter((t) => !t.providerError);
    const scored = reached.map((t) => t.score).filter((s) => typeof s === "number");
    const shipped = reached.filter((t) => t.outcome === "shipped" || t.outcome === "sub-floor");
    const round = (v, d = 2) => (v === null || v === undefined ? null : Number(v.toFixed(d)));
    return {
      model,
      boards: mine.length,
      providerFailures: mine.length - reached.length,
      shippedAtFloor: reached.filter((t) => t.outcome === "shipped").length,
      shippedBelowFloor: reached.filter((t) => t.outcome === "sub-floor").length,
      refused: reached.filter((t) => t.outcome === "refused").length,
      failed: reached.filter((t) => t.outcome === "failed").length,
      scored: scored.length,
      meanScore: round(scored.length ? scored.reduce((a, b) => a + b, 0) / scored.length : null),
      medianScore: median(scored),
      meanAttempts: round(reached.length ? reached.reduce((a, t) => a + t.attempts, 0) / reached.length : null, 1),
      meanCostUsd: round(shipped.length ? shipped.reduce((a, t) => a + t.costUsd, 0) / shipped.length : null, 4),
      medianSeconds: round(median(reached.map((t) => t.ms / 1000)), 0),
    };
  });
}

/* ── summarise ───────────────────────────────────────────────────────────── */

if (mode === "summarise") {
  const file = rest[0] ?? path.join(ROOT, ".animation-trials", "trials.jsonl");
  const trials = fs.readFileSync(file, "utf8").split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l));
  console.table(summarise(trials));
  process.exit(0);
}

if (mode !== "head-to-head") {
  console.error("usage: compare-animation-models.mjs head-to-head <out-dir> [beats] | summarise [trials.jsonl]");
  process.exit(1);
}

/* ── head-to-head ────────────────────────────────────────────────────────── */

const outDir = rest[0];
const beatCount = Number(rest[1] ?? 6);
if (!outDir) throw new Error("out-dir is required");
fs.mkdirSync(outDir, { recursive: true });
const resultsFile = path.join(outDir, "results.json");

/**
 * Real beats from real cached lectures: one per lecture so topics differ, animated beats only, and
 * physical subjects first — the shared judge scores those, while abstract diagrams skip it, so a
 * sample of only abstract beats would compare cost and reliability but not quality.
 */
function chooseBeats() {
  const cacheDir = path.join(ROOT, ".lecture-cache");
  const seenTopics = new Set();
  const candidates = [];
  for (const f of fs.readdirSync(cacheDir)) {
    const lecture = JSON.parse(fs.readFileSync(path.join(cacheDir, f), "utf8"));
    const topic = String(lecture.topic ?? "").slice(0, 60);
    if (seenTopics.has(topic)) continue;
    for (const beat of lecture.beats ?? []) {
      const op = (beat.draw?.ops ?? []).find((o) => o.kind === "reactAnimation" && o.teachingPoint);
      if (!op || split(beat.script ?? "").length < 4) continue;
      seenTopics.add(topic);
      candidates.push({
        beatId: `${f.slice(0, 6)}-${beat.id}`.slice(0, 80),
        title: beat.title,
        teachingPoint: op.teachingPoint,
        script: beat.script,
        topic,
        physical: PHYSICAL.test(`${beat.title} ${beat.script}`),
      });
      break;
    }
  }
  const physical = candidates.filter((c) => c.physical);
  const abstract = candidates.filter((c) => !c.physical);
  const take = Math.ceil(beatCount / 2);
  return [...physical.slice(0, take), ...abstract].slice(0, beatCount);
}

const results = fs.existsSync(resultsFile) ? JSON.parse(fs.readFileSync(resultsFile, "utf8")) : { beats: [] };
// H2H_BEATS names a JSON file of beats to use instead ({ beatId, title, teachingPoint, script,
// topic, physical }[]), so a run can be set up deliberately rather than taken from whatever is cached.
const chosen = () => (process.env.H2H_BEATS ? JSON.parse(fs.readFileSync(process.env.H2H_BEATS, "utf8")) : chooseBeats());
const beats = results.beats.length ? results.beats.map((b) => b.beat) : chosen();
if (!results.beats.length) results.beats = beats.map((beat) => ({ beat, boards: {} }));
console.log(`head-to-head: ${beats.length} beats x ${MODELS.length} models`);
for (const b of beats) console.log(`  ${b.physical ? "physical" : "abstract"}  ${b.title}  (${b.topic})`);

async function draw(beat, model) {
  const started = Date.now();
  try {
    const res = await fetch(`${BASE}/api/sandbox-board`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: beat.title, teachingPoint: beat.teachingPoint, script: beat.script, model, beatId: beat.beatId }),
      signal: AbortSignal.timeout(15 * 60_000),
    });
    const data = await res.json().catch(() => ({}));
    return { httpStatus: res.status, wallMs: Date.now() - started, ...data };
  } catch (err) {
    return { httpStatus: 0, wallMs: Date.now() - started, error: String(err?.message ?? err), code: null };
  }
}

// Beats one at a time, the three models of a beat together: each beat's boards are drawn under the
// same conditions, and no more than three generations run at once.
for (const entry of results.beats) {
  const missing = MODELS.filter((m) => !entry.boards[m]);
  if (!missing.length) continue;
  console.log(`drawing "${entry.beat.title}" with ${missing.join(", ")}`);
  const drawn = await Promise.all(missing.map((m) => draw(entry.beat, m)));
  missing.forEach((m, i) => {
    entry.boards[m] = drawn[i];
    const t = drawn[i].trial;
    console.log(`  ${m.padEnd(17)} status=${drawn[i].status ?? drawn[i].httpStatus} score=${t?.score ?? "-"} attempts=${t?.attempts ?? "-"} $${t?.costUsd ?? "-"} ${Math.round(drawn[i].wallMs / 1000)}s ${drawn[i].error ? `err=${String(drawn[i].error).slice(0, 90)}` : ""}`);
  });
  fs.writeFileSync(resultsFile, JSON.stringify(results, null, 2));
}

/* ── screenshots, fully drawn ────────────────────────────────────────────── */

const { chromium } = await import("playwright");
const browser = await chromium.launch();
for (const [bi, entry] of results.beats.entries()) {
  for (const model of MODELS) {
    const board = entry.boards[model];
    const shot = path.join(outDir, `beat${bi}-${model}.png`);
    if (!board?.code || fs.existsSync(shot)) continue;
    const page = await browser.newPage({ viewport: { width: 1100, height: 620 } });
    await page.addInitScript((still) => { window.__BOARD_STILL__ = still; }, {
      code: board.code,
      assetIds: board.assetIds ?? [],
      sentenceTotal: split(entry.beat.script).length,
      model,
      costUsd: board.trial?.costUsd,
    });
    await page.goto(`${BASE}/playback-lab`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector("[data-still] iframe", { timeout: 60_000 }).catch(() => {});
    await page.waitForTimeout(6_000);
    await page.locator("[data-still]").screenshot({ path: shot }).catch(() => {});
    board.screenshot = path.basename(shot);
    await page.close();
  }
}
await browser.close();
fs.writeFileSync(resultsFile, JSON.stringify(results, null, 2));

/* ── the numbers ─────────────────────────────────────────────────────────── */

// The server logs each board's exact outcome as it finishes (lib/animationTrials.ts); use that
// rather than guessing it from the response. A board with no log line never reached the end of the
// pipeline at all — the route or the provider failed — and is counted as a provider failure.
const logFile = path.join(ROOT, ".animation-trials", "trials.jsonl");
const logged = fs.existsSync(logFile)
  ? fs.readFileSync(logFile, "utf8").split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l))
  : [];
const trials = results.beats.flatMap((entry) =>
  MODELS.map((model) => {
    const line = logged.filter((t) => t.beatId === entry.beat.beatId && t.model === model).at(-1);
    if (line) return line;
    const b = entry.boards[model] ?? {};
    return {
      model, beatId: entry.beat.beatId, outcome: "failed", providerError: String(b.error ?? `HTTP ${b.httpStatus}`),
      score: null, attempts: 0, costUsd: 0, ms: b.wallMs ?? 0,
    };
  }),
);
const summary = summarise(trials);
fs.writeFileSync(path.join(outDir, "summary.json"), JSON.stringify({ summary, trials }, null, 2));
console.table(summary);

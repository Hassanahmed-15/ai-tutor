/**
 * ONE BEAT THROUGH THE REAL ROUTING AND THE REAL PLOT FILLER — run the way the worker runs.
 *
 *   node --import ./scripts/worker-register.mjs --import tsx scripts/probe-quantitative-beat.mts
 *
 * Must run under tsx, like `npm run worker:lecture`: vega-lite is ESM-only, and the CommonJS test
 * build compiles its dynamic import into a require() that cannot load it — so in that build even a
 * trivially valid spec "fails to compile", and a probe there cannot judge a plot at all.
 *
 * Asks, for the board that prompted lib/quantitativeBeat.ts: does the gate fire, does the director
 * choose a plot, and does the filled Vega-Lite spec name its axes and series? About $0.02.
 */
import fs from "node:fs";
import path from "node:path";
import OpenAI from "openai";
import { looksQuantitative } from "../lib/quantitativeBeat";
import { planBeatVisual, specToBrief } from "../lib/beatVisualSpec";
import { direct } from "../lib/director";
import { fillSpecBoardOps } from "../lib/specBoardGen";
import type { Beat } from "../lib/lessonContent";

const ROOT = path.resolve(import.meta.dirname, "..");
for (const line of fs.readFileSync(path.join(ROOT, ".env.local"), "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}

const beat = {
  id: "reg-types",
  title: "Types of Regularization",
  teacherMove: "",
  stepLabel: "",
  slideKind: "definition",
  points: ["Absolute-value and squared penalties"],
  script:
    "L1 regularization adds the absolute value of each weight to the loss, so its penalty is V-shaped with a sharp corner at zero. " +
    "L2 regularization adds the squared weight instead, which is a smooth parabola. " +
    "That sharp corner is why L1 pushes many weights exactly to zero, while L2 only shrinks them.",
} as unknown as Beat;

const out = process.argv[2] ?? path.join(ROOT, "probe-out");
fs.mkdirSync(out, { recursive: true });
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

console.log("gate fires:", looksQuantitative(beat));
const visual = await planBeatVisual(client, beat);
if (!visual.spec) throw new Error("no visual spec");
const selected = await direct(client, specToBrief(visual.spec));
console.log("director:", selected.plan?.board, "/", selected.plan?.form);
if (selected.plan?.board !== "plotBoard") process.exit(1);

beat.draw = {
  caption: beat.title,
  durationMs: 45_000,
  surface: "paper",
  ops: [{ kind: "plotBoard", plotBrief: selected.plan.brief ?? specToBrief(visual.spec), at: 0, endAt: 1 }],
} as Beat["draw"];
const stats = await fillSpecBoardOps(client, [beat], {});
const op = beat.draw!.ops[0] as { spec?: Record<string, unknown>; error?: string };
console.log("filled:", stats.filled, "rejected:", stats.rejected, op.error ? `(${op.error})` : "");
if (!op.spec) process.exit(1);

fs.writeFileSync(path.join(out, "reg-plot-spec.json"), JSON.stringify(op.spec, null, 2));
const spec = op.spec as { encoding?: Record<string, { title?: string; field?: string }>; layer?: { encoding?: Record<string, { title?: string; field?: string }> }[]; data?: { values?: unknown[] } };
const enc = spec.encoding ?? spec.layer?.[0]?.encoding ?? {};
console.log("x axis:", enc.x?.title ?? `(untitled, field ${enc.x?.field})`);
console.log("y axis:", enc.y?.title ?? `(untitled, field ${enc.y?.field})`);
console.log("series:", enc.color?.field ?? "(one series)");
console.log("data points:", spec.data?.values?.length ?? 0, JSON.stringify(spec.data?.values?.slice(0, 3)));
console.log(`spec written to ${path.join(out, "reg-plot-spec.json")}`);

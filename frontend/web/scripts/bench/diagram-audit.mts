/**
 * Three O/A Level lectures, scored on the rubric. Cap: $1.
 *
 *   NODE_OPTIONS=--conditions=react-server npx tsx --tsconfig tsconfig.json scripts/bench/diagram-audit.mts
 */
import { readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { scoreLesson } from "../../lib/bench/scoreLesson.ts";
import { boardPng } from "../../lib/bench/renderSvg.ts";
import { generateCanvasLecture } from "../../lib/canvas/generate.ts";
import { canvasSpecOf } from "../../lib/canvas/progressive.ts";
import type { CanvasPlanBeat } from "../../lib/canvas/types.ts";

const WEB = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
const MAX_USD = Number(process.env.DIAGRAM_AUDIT_MAX_USD ?? "1");

function loadEnv() {
  try {
    for (const line of readFileSync(path.join(WEB, ".env.local"), "utf8").split("\n")) {
      const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  } catch { /* no .env.local */ }
}

const TOPICS = [
  { id: "geo-energy", subject: "Geography", title: "A Level Geography: the global energy budget, the three-cell atmospheric model, world ocean currents and the seasonal shift of the ITCZ", level: "A Level" },
  { id: "bio-meiosis", subject: "Biology", title: "O Level Biology: chromosome number in humans, haploid n = 23 and diploid 2n = 46", level: "O Level" },
  { id: "phys-alpha", subject: "Physics", title: "O Level Physics: Rutherford gold-foil alpha-particle scattering experiment", level: "O Level" },
];

loadEnv();
process.env.CANVAS_AI_PICTURES = process.env.CANVAS_AI_PICTURES ?? "off";
process.env.DIAGRAM_VISION = process.env.DIAGRAM_VISION ?? "off";
process.env.CANVAS_CHECK_CARDS = process.env.CANVAS_CHECK_CARDS ?? "off";
process.chdir(WEB);

const outDir = path.join(WEB, ".bench", "diagram-audit");
await mkdir(outDir, { recursive: true });
await mkdir(path.join(outDir, "png"), { recursive: true });

let spent = 0;
const cards: unknown[] = [];

if (!process.env.OPENAI_API_KEY) {
  console.log("OPENAI_API_KEY is not set; skipping paid lecture generation.");
  await writeFile(path.join(outDir, "report.json"), JSON.stringify({ maxUsd: MAX_USD, spent: 0, skipped: "no API key", cards: [] }, null, 2));
  process.exit(0);
}

for (const lesson of TOPICS) {
  if (spent >= MAX_USD) {
    console.log(`cap $${MAX_USD} reached before ${lesson.id}`);
    break;
  }
  const t0 = Date.now();
  try {
    const lecture = await generateCanvasLecture(lesson.title, "diagram-audit");
    spent += lecture.costUsd;
    const specs = lecture.beats.map((b) => canvasSpecOf(b)!).filter(Boolean);
    const beats: CanvasPlanBeat[] = lecture.beats.map((b, i) => ({
      id: b.id,
      title: b.title,
      script: b.script,
      stage: specs[i]?.stage.kind ?? "scene",
      brief: b.teacherMove,
      objects: [],
      inside: null,
      carry: [],
      interaction: null,
      overview: false,
    }));
    const card = scoreLesson({ title: lesson.title, outcomes: [lesson.title], beats, specs, level: lesson.level });
    for (let i = 0; i < specs.length; i++) {
      try {
        await writeFile(path.join(outDir, "png", `${lesson.id}-b${i + 1}.png`), boardPng(specs[i]));
      } catch (e) {
        console.warn("png", lesson.id, i, (e as Error).message);
      }
    }
    const row = {
      ...lesson,
      usd: lecture.costUsd,
      ms: Date.now() - t0,
      stages: specs.map((s) => s.stage.kind),
      scores: card.scores,
      mean: card.mean,
      min: card.min,
      flowFallbacks: specs.filter((s) => s.stage.kind === "flow").length,
      compareFallbacks: specs.filter((s) => s.stage.kind === "compare").length,
      log: lecture.log,
    };
    cards.push(row);
    await writeFile(path.join(outDir, `${lesson.id}.json`), JSON.stringify({ lesson, lecture: { id: lecture.id, costUsd: lecture.costUsd, log: lecture.log }, card, stages: row.stages }, null, 2));
    console.log(JSON.stringify({ id: lesson.id, usd: lecture.costUsd, spent, diagramsAndLabels: card.scores.diagramsAndLabels, visualClarity: card.scores.visualClarity, stages: row.stages }));
  } catch (e) {
    console.error(lesson.id, e);
    cards.push({ ...lesson, error: (e as Error).message, usd: 0 });
  }
}

await writeFile(path.join(outDir, "report.json"), JSON.stringify({ maxUsd: MAX_USD, spent, cards }, null, 2));
console.log("wrote", path.join(outDir, "report.json"), "spent", spent);

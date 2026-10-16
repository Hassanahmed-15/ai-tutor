/**
 * Phase 0/release bench: plan + boards (no TTS), PNG render, deterministic 12-criterion scores.
 *
 *   npx tsx --tsconfig tsconfig.json scripts/bench/run.mts --estimate
 *   NODE_OPTIONS=--conditions=react-server npx tsx --tsconfig tsconfig.json scripts/bench/run.mts --paid --tuning --maxUsd 4.5
 *   NODE_OPTIONS=--conditions=react-server npx tsx --tsconfig tsconfig.json scripts/bench/run.mts --rescore --tuning
 */
import { readFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { estimatePhase0Usd } from "../../lib/bench/cost.ts";
import { benchFileSlug, type BenchPanelFile } from "../../lib/bench/panel.ts";
import { scoreLesson, scorecardMean, type LessonScorecard } from "../../lib/bench/scoreLesson.ts";
import { boardPng } from "../../lib/bench/renderSvg.ts";
import { BENCH_CRITERIA, type BenchScores } from "../../lib/bench/criteria.ts";
import { lessonDocument, type Evidence } from "../../lib/curriculum/lessonSpec.ts";
import { planLessonSpec } from "../../lib/curriculum/planSpec.ts";
import { lessonKey } from "../../lib/curriculum/mastery.ts";
import type { CurriculumTree } from "../../lib/curriculum/types.ts";
import { planCanvasLecture, writeCanvasBoard, canvasSpecOf } from "../../lib/canvas/progressive.ts";
import type { CanvasBoardSpec, CanvasPlanBeat } from "../../lib/canvas/types.ts";
import type { ProgressiveLectureInput } from "../../lib/progressiveLectureTypes.ts";
import { createOpenAI } from "../../lib/openaiClient.ts";

const WEB = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
const rescoreOnly = process.argv.includes("--rescore");
const paid = process.argv.includes("--paid");
const estimateOnly = !rescoreOnly && (process.argv.includes("--estimate") || !paid);
const maxUsd = Number(process.argv.find((a, i, all) => all[i - 1] === "--maxUsd") ?? "4.5");
const limit = Number(process.argv.find((a, i, all) => all[i - 1] === "--limit") ?? "30");
const split = process.argv.includes("--held-out") ? "heldOut" : "tuning";

function loadEnv() {
  try {
    for (const line of readFileSync(path.join(WEB, ".env.local"), "utf8").split("\n")) {
      const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  } catch { /* no .env.local */ }
}

if (!rescoreOnly) {
  const e = estimatePhase0Usd();
  console.log(JSON.stringify(e, null, 2));
  if (estimateOnly) {
    console.log("No API calls. Pass --paid only after the owner has replied yes to this estimate.");
    process.exit(0);
  }
}

loadEnv();
process.env.CANVAS_AI_PICTURES = process.env.CANVAS_AI_PICTURES ?? "off";
process.chdir(WEB);

if (!rescoreOnly && !process.env.OPENAI_API_KEY) {
  console.error("OPENAI_API_KEY is not set");
  process.exit(1);
}

const panel = JSON.parse(await readFile(path.join(WEB, "data/bench/panel.json"), "utf8")) as BenchPanelFile;
const lessons = (split === "heldOut" ? panel.heldOut : panel.tuning).slice(0, limit);
const outDir = path.join(WEB, ".bench", `phase0-${split}`);
await mkdir(outDir, { recursive: true });
await mkdir(path.join(outDir, "png"), { recursive: true });

const openai = rescoreOnly ? null : createOpenAI({ apiKey: process.env.OPENAI_API_KEY });
const MODEL = process.env.CURRICULUM_SPEC_MODEL ?? "gpt-5.6-luna";
const PRICE = { input: 0.2, output: 1.2 };
const profile: ProgressiveLectureInput["learnerProfile"] = {
  expertise: "intermediate",
  depth: "balanced",
  goal: "exam",
  codeExamples: false,
  preferredExamples: "worked",
  rationale: "bench",
  confirmedAt: new Date().toISOString(),
};

let spent = 0;
const cards: Array<LessonScorecard & { id: string; subject: string; title: string; usd: number; stages: string[] }> = [];
const slugs = lessons.map((lesson) => benchFileSlug(lesson));
if (new Set(slugs).size !== slugs.length) {
  console.error("bench file slug collision in the panel");
  process.exit(1);
}

async function evidenceFor(courseId: string, grade: string, unitId: string, topicId: string, lessonId: string): Promise<Evidence[]> {
  try {
    const file = JSON.parse(await readFile(path.join(WEB, "data/curricula/sources", `${courseId}.json`), "utf8")) as { lessons: Record<string, Evidence[]> };
    const exact = file.lessons[lessonKey(grade, unitId, topicId, lessonId)] ?? [];
    if (exact.length) return exact;
    return Object.entries(file.lessons).filter(([key]) => key.split("/").includes(topicId)).flatMap(([, ev]) => ev);
  } catch {
    return [];
  }
}

function meanScores(list: BenchScores[]): BenchScores {
  const out = {} as BenchScores;
  for (const k of BENCH_CRITERIA) out[k] = list.length ? Math.round((list.reduce((s, x) => s + x[k], 0) / list.length) * 10) / 10 : 0;
  return out;
}

for (const lesson of lessons) {
  if (!rescoreOnly && spent >= maxUsd) {
    console.log(`stopped at $${spent.toFixed(4)} (cap $${maxUsd})`);
    break;
  }
  const slug = benchFileSlug(lesson);
  const existingPath = path.join(outDir, `${slug}.json`);
  const tree = JSON.parse(await readFile(path.join(WEB, "data/curricula/trees", `${lesson.courseId}.json`), "utf8")) as CurriculumTree;
  const g = tree.grades.find((x) => x.grade === lesson.grade);
  const u = g?.units.find((x) => x.id === lesson.unitId);
  const t = u?.topics.find((x) => x.id === lesson.topicId);
  const s = t?.subtopics.find((x) => x.id === lesson.lessonId);
  const outcomeTexts = s?.outcomes.map((o) => o.text) ?? [];
  try {
    const existing = JSON.parse(await readFile(existingPath, "utf8")) as { usd?: number; card?: LessonScorecard; plan?: CanvasPlanBeat[]; specs?: CanvasBoardSpec[] };
    if (existing.card && existing.plan && existing.specs && (rescoreOnly || !process.argv.includes("--force"))) {
      const card = rescoreOnly
        ? scoreLesson({ title: s?.title ?? lesson.title, outcomes: outcomeTexts, beats: existing.plan, specs: existing.specs, level: lesson.grade })
        : existing.card;
      if (rescoreOnly) {
        existing.card = card;
        await writeFile(existingPath, JSON.stringify(existing, null, 2));
      }
      spent += existing.usd ?? 0;
      cards.push({ ...card, id: lesson.id, subject: lesson.subject, title: lesson.title, usd: existing.usd ?? 0, stages: card.boards.map((b) => b.stage) });
      console.log(`${rescoreOnly ? "rescore" : "reuse"} ${lesson.title.slice(0, 42)}`);
      continue;
    }
  } catch { /* generate */ }
  if (rescoreOnly) {
    console.warn(`skip missing ${lesson.id}`);
    continue;
  }
  if (!g || !u || !t || !s) {
    console.warn(`skip missing ${lesson.id}`);
    continue;
  }
  const started = Date.now();
  const courseLabel = [tree.board, tree.qualification, tree.subject, tree.syllabusCode].filter(Boolean).join(" ");
  const outcomes = s.outcomes.map((o) => ({ code: o.code, text: o.text }));
  const evidence = await evidenceFor(lesson.courseId, lesson.grade, lesson.unitId, lesson.topicId, lesson.lessonId);
  let lessonUsd = 0;
  try {
    const planned = await planLessonSpec(openai!, MODEL, { courseLabel, level: lesson.grade, title: s.title, outcomes, evidence });
    lessonUsd += (planned.usage.input * PRICE.input + planned.usage.output * PRICE.output) / 1e6;
    const document = lessonDocument(planned.spec, {
      request: { courseId: lesson.courseId, version: tree.build.builtAt, grade: lesson.grade, unitId: lesson.unitId, topicId: lesson.topicId, lessonId: lesson.lessonId },
      framework: [tree.framework, tree.syllabusCode].filter(Boolean).join(" "),
      subject: tree.subject,
      sourceUrl: tree.source.urls[0],
    }, evidence);
    const input: ProgressiveLectureInput = {
      topic: `${courseLabel}: ${s.title}`,
      mood: "",
      sourceType: "suprnotes",
      mode: "standard",
      suprnotes: document,
      learnerProfile: profile,
    };
    const sessionId = `bench-${lesson.lessonId}`.slice(0, 80);
    const canvas = await planCanvasLecture(input);
    lessonUsd += canvas.costUsd;
    const plan = canvas.plan.map((p) => p.canvas).filter((b): b is CanvasPlanBeat => Boolean(b));
    const earlier: Array<CanvasBoardSpec | undefined> = [];
    const specs: CanvasBoardSpec[] = [];
    const batch = 3;
    for (let i = 0; i < plan.length; i += batch) {
      const slice = plan.slice(i, i + batch);
      const written = await Promise.all(slice.map((beat, j) => writeCanvasBoard({
        userId: "bench",
        sessionId,
        topic: input.topic,
        plan,
        index: i + j,
        earlier,
        notes: [],
        document,
      })));
      for (const w of written) {
        lessonUsd += w.costUsd;
        const spec = canvasSpecOf(w.beat);
        specs.push(spec!);
        earlier.push(spec);
      }
    }
    spent += lessonUsd;
    const card = scoreLesson({ title: s.title, outcomes: outcomes.map((o) => o.text), beats: plan, specs, level: lesson.grade });
    for (let i = 0; i < specs.length; i++) {
      try {
        await writeFile(path.join(outDir, "png", `${slug}-b${i + 1}.png`), boardPng(specs[i]));
      } catch (err) {
        console.warn(`png ${slug} b${i + 1}: ${(err as Error).message}`);
      }
    }
    await writeFile(path.join(outDir, `${slug}.json`), JSON.stringify({ lesson, usd: lessonUsd, card, plan, specs }, null, 2));
    cards.push({ ...card, id: lesson.id, subject: lesson.subject, title: s.title, usd: lessonUsd, stages: specs.map((sp) => sp.stage.kind) });
    const by = Object.entries(card.scores).map(([k, v]) => `${k}:${v}`).join(" ");
    console.log(`${lesson.subject.padEnd(8)} ${s.title.slice(0, 42).padEnd(42)} boards ${plan.length} mean ${card.mean.toFixed(1)} min ${card.min} $${lessonUsd.toFixed(4)} ${((Date.now() - started) / 1000).toFixed(0)}s  ${by}`);
  } catch (err) {
    spent += lessonUsd;
    console.error(`FAIL ${lesson.id}: ${(err as Error).message} ($${lessonUsd.toFixed(4)})`);
    await writeFile(path.join(outDir, `${lesson.lessonId}-error.json`), JSON.stringify({ lesson, error: (err as Error).message, usd: lessonUsd }, null, 2));
  }
}

const bySubject = (subject: string) => cards.filter((c) => c.subject === subject);
const summary = {
  split,
  spentUsd: Number(spent.toFixed(4)),
  capUsd: maxUsd,
  n: cards.length,
  overallMean: Number(scorecardMean(cards).toFixed(2)),
  bySubject: Object.fromEntries(["biology", "maths", "other"].map((s) => {
    const list = bySubject(s);
    return [s, { n: list.length, mean: Number(scorecardMean(list).toFixed(2)), scores: meanScores(list.map((c) => c.scores)) }];
  })),
  weakestCriterion: BENCH_CRITERIA.map((k) => ({ k, mean: cards.length ? cards.reduce((s, c) => s + c.scores[k], 0) / cards.length : 0 })).sort((a, b) => a.mean - b.mean)[0],
  results: cards.map((c) => ({ id: c.id, title: c.title, subject: c.subject, mean: Number(c.mean.toFixed(2)), min: c.min, usd: Number(c.usd.toFixed(4)), stages: c.stages, scores: c.scores })),
};
await writeFile(path.join(outDir, "summary.json"), JSON.stringify(summary, null, 2));
console.log(JSON.stringify({ spentUsd: summary.spentUsd, overallMean: summary.overallMean, bySubject: summary.bySubject, weakest: summary.weakestCriterion }, null, 2));

/**
 * LESSON OUTLINES WRITTEN AHEAD. The first student to open a lesson waited about a minute for its outline (a LessonSpec);
 * every later student got it from the cache. This writes the missing ones before anyone asks.
 *   node --env-file=.env.local --conditions=react-server --import tsx scripts/curriculum/prebuild-outlines.mts            counts only (free)
 *   … --run --max-usd=5 [--course=<id>] [--concurrency=6]                                                                 PAID: stops at the cap
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { curriculumLessons } from "../../lib/db/cosmos";
import { createOpenAI } from "../../lib/openaiClient";
import { costFor } from "../../lib/modelPricing";
import { planLessonSpec } from "../../lib/curriculum/planSpec";
import { cacheId, type CachedLesson } from "../../lib/curriculum/lessonCache";
import { evidenceFor, gradeLabel } from "../../lib/curriculum/lessonSources";
import type { CurriculumLessonRequest } from "../../lib/curriculum/lessonSpec";
import type { CurriculumTree } from "../../lib/curriculum/types";

const flag = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=")[1];
const run = process.argv.includes("--run");
const maxUsd = Number(flag("max-usd") ?? 0);
const concurrency = Number(flag("concurrency") ?? 6);
if (run && !(maxUsd > 0)) throw new Error("--run needs --max-usd");
const MODEL = process.env.CURRICULUM_SPEC_MODEL ?? "gpt-5.6-luna";
const dir = path.join(process.cwd(), "data/curricula/trees");
const container = await curriculumLessons();
const { resources } = await container.items.query<{ id: string }>({ query: "SELECT c.id FROM c" }).fetchAll();
const cached = new Set(resources.map((r) => r.id));

type Job = { r: CurriculumLessonRequest; tree: CurriculumTree; grade: string; title: string; outcomes: Array<{ code: string | null; text: string }> };
const jobs: Job[] = [];
let lessons = 0, courses = 0;
for (const file of readdirSync(dir).filter((f) => f.endsWith(".json"))) {
  if (flag("course") && file !== `${flag("course")}.json`) continue;
  const tree = JSON.parse(readFileSync(path.join(dir, file), "utf8")) as CurriculumTree;
  courses++;
  for (const g of tree.grades) for (const u of g.units) for (const t of u.topics) for (const s of t.subtopics) {
    lessons++;
    const r: CurriculumLessonRequest = { courseId: file.replace(/\.json$/, ""), version: tree.build.builtAt, grade: g.grade, unitId: u.id, topicId: t.id, lessonId: s.id };
    if (!cached.has(cacheId(r))) jobs.push({ r, tree, grade: g.grade, title: s.title, outcomes: s.outcomes.map((o) => ({ code: o.code, text: o.text })) });
  }
}
console.log({ courses, lessons, written: lessons - jobs.length, toWrite: jobs.length });
if (!run) process.exit(0);

const client = createOpenAI({ apiKey: process.env.OPENAI_API_KEY });
let spent = 0, done = 0, failed = 0, next = 0;
await Promise.all(Array.from({ length: concurrency }, async () => {
  while (next < jobs.length && spent < maxUsd) {
    const { r, tree, grade, title, outcomes } = jobs[next++];
    try {
      const evidence = await evidenceFor(r);
      const courseLabel = [tree.board, tree.qualification, tree.subject, tree.syllabusCode].filter(Boolean).join(" ");
      const { spec, modelGaps, usage } = await planLessonSpec(client, MODEL, { courseLabel, level: gradeLabel(tree, grade), title, outcomes, evidence });
      spent += costFor(MODEL, { prompt_tokens: usage.input, completion_tokens: usage.output });
      const doc: CachedLesson = { id: cacheId(r), request: r, spec, createdAt: new Date().toISOString(), model: MODEL, modelGaps };
      await container.items.upsert(doc);
      if (++done % 25 === 0) console.log(`${done} written, $${spent.toFixed(3)}`);
    } catch (error) {
      failed++;
      console.warn(`${r.courseId} ${r.lessonId}: ${(error as Error).message.slice(0, 120)}`);
    }
  }
}));
console.log({ written: done, failed, usd: Number(spent.toFixed(3)), left: jobs.length - done - failed });

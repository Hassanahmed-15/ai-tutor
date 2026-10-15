/**
 * A PILOT RUN of curriculum lesson specs for review: the same request, prompts and schema as
 * /api/curricula/lesson, for a spread of lessons in one course, written to
 * data/curricula/pilot/<courseId>.json so a teacher can read every spec against its syllabus page.
 *
 *   node --env-file=.env.local --import tsx scripts/curriculum/pilot.mts <courseId> [count=20] [maxUsd=1]
 *
 * Paid (one luna call per lesson, two when the first plan misses an outcome); stops before the next call once spend reaches maxUsd.
 */
import fs from "node:fs";
import path from "node:path";
import OpenAI from "openai";
import type { Evidence } from "../../lib/curriculum/lessonSpec";
import { planLessonSpec } from "../../lib/curriculum/planSpec";
import { lessonKey } from "../../lib/curriculum/mastery";
import type { CurriculumTree } from "../../lib/curriculum/types";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
const DATA = path.join(ROOT, "data/curricula");
const MODEL = process.env.CURRICULUM_SPEC_MODEL ?? "gpt-5.6-luna";
const PRICE = { input: 0.2, output: 1.2 }; // $/M tokens, lib/modelPricing.ts

const [courseId, countArg = "20", maxArg = "1"] = process.argv.slice(2);
if (!courseId) throw new Error("usage: pilot.mts <courseId> [count] [maxUsd]");
const count = Number(countArg);
const maxUsd = Number(maxArg);

const tree = JSON.parse(fs.readFileSync(path.join(DATA, "trees", `${courseId}.json`), "utf8")) as CurriculumTree;
const sources = JSON.parse(fs.readFileSync(path.join(DATA, "sources", `${courseId}.json`), "utf8")) as { lessons: Record<string, Evidence[]> };

// Every lesson, then an even spread across the course (so every subject/unit range is sampled).
const all = tree.grades.flatMap((g) => g.units.flatMap((u) => u.topics.flatMap((t) => t.subtopics.map((s) => ({ g, u, t, s })))));
const step = all.length / Math.min(count, all.length);
const chosen = Array.from({ length: Math.min(count, all.length) }, (_, i) => all[Math.floor(i * step)]);

const client = new OpenAI();
const courseLabel = [tree.board, tree.qualification, tree.subject, tree.syllabusCode].filter(Boolean).join(" ");
let spent = 0;
const results: unknown[] = [];
for (const { g, u, t, s } of chosen) {
  if (spent >= maxUsd) { console.log(`stopped at $${spent.toFixed(4)} (budget $${maxUsd})`); break; }
  const key = lessonKey(g.grade, u.id, t.id, s.id);
  const evidence = sources.lessons[key] ?? [];
  const outcomes = s.outcomes.map((o) => ({ code: o.code, text: o.text }));
  const level = g.grade === "all" ? tree.qualification ?? tree.framework : g.grade;
  const started = Date.now();
  const { spec, modelGaps, attempts, usage } = await planLessonSpec(client, MODEL, { courseLabel, level, title: s.title, outcomes, evidence });
  const usd = (usage.input * PRICE.input + usage.output * PRICE.output) / 1e6;
  spent += usd;
  results.push({ key, unit: u.title, topic: t.title, evidencePages: evidence.map((e) => e.page), modelGaps, attempts, usd: Number(usd.toFixed(5)), ms: Date.now() - started, spec });
  console.log(`${u.title.slice(0, 34).padEnd(34)} ${s.title.slice(0, 40).padEnd(40)} outcomes ${outcomes.length} boards ${spec.boards.length} untaught-by-model ${modelGaps.length} tries ${attempts} pages [${evidence.map((e) => e.page).join(",")}] $${usd.toFixed(4)} ${((Date.now() - started) / 1000).toFixed(0)}s`);
}
fs.mkdirSync(path.join(DATA, "pilot"), { recursive: true });
fs.writeFileSync(path.join(DATA, "pilot", `${courseId}.json`), JSON.stringify({ courseId, model: MODEL, builtAt: new Date().toISOString(), spentUsd: Number(spent.toFixed(4)), lessons: results }, null, 2));
console.log(`done — ${results.length} specs, $${spent.toFixed(4)}`);

/**
 * TEACHING EVAL — does a course lesson TEACH (each idea built up in its teaching order) or give an
 * overview? Real cached course lesson plans, each planned twice by the real board planner:
 *   before: as today (CANVAS_TEACHING_ORDERS off, one board per idea, no framing);
 *   after:  lesson 1 of its series (lib/curriculum/lessonSpec.ts lessonPartDocument) in teaching order
 *           (lib/teaching/courseOrders.ts), with the new rules.
 * Both teach the same ideas. Plan only — no boards drawn, no pictures, no voice. A blind judge scores each
 * plan's scripts against the rubric for its ideas' lesson types; code counts banned words, sentence
 * length and key-point coverage.
 *
 *   NODE_OPTIONS=--conditions=react-server npx tsx --env-file=.env.local --tsconfig tsconfig.json \
 *     scripts/bench/teaching-eval.mts <outDir> [maxUsd=3] [--estimate]
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { curriculumLessons } from "../../lib/db/cosmos.ts";
import type { CachedLesson } from "../../lib/curriculum/lessonCache.ts";
import { lessonDocument, lessonPartDocument, type LessonSpec } from "../../lib/curriculum/lessonSpec.ts";
import { splitIntoLessons } from "../../lib/series/split.ts";
import { withTeachingOrders } from "../../lib/teaching/courseOrders.ts";
import { lessonTypeOf, orderLine, studentLevelFor, type LessonType } from "../../lib/teaching/lessonTypes.ts";
import { bannedWordsIn } from "../../lib/teaching/styleCheck.ts";
import { planCanvasLecture } from "../../lib/canvas/progressive.ts";
import { jsonCall } from "../../lib/canvas/generate.ts";
import { courseCoverageGaps } from "../../lib/canvas/courseCoverage.ts";
import { createOpenAI } from "../../lib/openaiClient.ts";
import type { ProgressiveLectureInput } from "../../lib/progressiveLectureTypes.ts";
import type { SuprnotesLessonInput } from "../../lib/suprnotes.ts";
import { buildStudentCard } from "../../lib/studentCard.ts";
import { PROFILES } from "./lectureChecks.mts";

const [outDir = "tmp/teaching-eval", maxUsdArg = "3"] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const estimateOnly = process.argv.includes("--estimate");
const MAX_USD = Number(maxUsdArg);
const JUDGE = process.env.TEACHING_JUDGE_MODEL ?? "gpt-5.6-luna";
mkdirSync(outDir, { recursive: true });
const profile = PROFILES.find((p) => p.id === "olevel")!;
const level = studentLevelFor(profile.snapshot.expertise);

// How many lessons of each kind of idea to test (a lesson counts for the kind most of its ideas are).
const WANT: Partial<Record<LessonType, number>> = { concept: 3, procedure: 3, memorization: 2, analysis: 3, experiment: 2, coding: 2, language: 2, proof: 1, problem_solving: 1, creative: 1 };

const subjectOf = (spec: LessonSpec) => spec.courseLabel.replace(/^(Cambridge|Edexcel|AQA|OCR|Pearson|IB|AP|College Board|FBISE|PMDC|NGA Center \/ CCSSO)\s*/i, "");
const c = await curriculumLessons();
const { resources } = await c.items.query<CachedLesson>({ query: "SELECT TOP 600 * FROM c WHERE IS_DEFINED(c.spec) ORDER BY c._ts DESC" }).fetchAll();
const seen = new Set<string>();
const picked: Array<{ cached: CachedLesson; kind: LessonType }> = [];
const left = { ...WANT };
for (const r of resources) {
  const key = `${r.spec.courseLabel}|${r.spec.lessonTitle}`;
  if (seen.has(key) || !r.spec.boards.length) continue;
  seen.add(key);
  const types = r.spec.boards.map((b) => lessonTypeOf({ subject: subjectOf(r.spec), title: b.title, objective: b.objective, keyPoints: b.keyPoints, outcomes: b.outcomeRefs.map((i) => r.spec.outcomes[i - 1]?.text ?? "") }));
  const counts = new Map<LessonType, number>();
  types.forEach((t) => counts.set(t, (counts.get(t) ?? 0) + 1));
  const kind = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
  // Rare kinds count for a lesson that has one such idea at all.
  const rare = (Object.keys(left) as LessonType[]).find((t) => (left[t] ?? 0) > 0 && t !== "concept" && counts.has(t));
  const take = (left[kind] ?? 0) > 0 ? kind : rare;
  if (!take) continue;
  left[take] = (left[take] ?? 0) - 1;
  picked.push({ cached: r, kind: take });
}
// --only=a,b re-runs just the lessons whose title contains one of these words.
const only = process.argv.find((a) => a.startsWith("--only="))?.slice(7).split(",") ?? null;
if (only) picked.splice(0, picked.length, ...picked.filter((p) => only.some((o) => p.cached.spec.lessonTitle.includes(o))));
console.log(`picked ${picked.length} lessons: ${picked.map((p) => `${p.kind}: ${p.cached.spec.lessonTitle}`).join(" | ")}`);
console.log(`missing kinds (none cached): ${Object.entries(left).filter(([, n]) => (n ?? 0) > 0).map(([t, n]) => `${t}×${n}`).join(", ") || "none"}`);
const estimate = picked.length * 2 * 0.02 + picked.length * 2 * 0.004;
console.log(`estimated cost: ~$${estimate.toFixed(2)} (cap $${MAX_USD})`);
if (estimateOnly) process.exit(0);

const client = createOpenAI({ apiKey: process.env.OPENAI_API_KEY });
let spent = 0;
const results: Array<Record<string, unknown>> = [];

function inputFor(doc: SuprnotesLessonInput, title: string): ProgressiveLectureInput {
  const card = buildStudentCard(profile.basics, title, {}, profile.support);
  return { topic: title, mood: "", sourceType: "suprnotes", mode: "standard", suprnotes: doc, learnerProfile: profile.snapshot, ...(card ? { studentCard: card } : {}) } as unknown as ProgressiveLectureInput;
}

const JUDGE_PROMPT = `You are a strict head of department judging whether lesson scripts TEACH or only give an OVERVIEW. You see only what the teacher will say, board by board.
TEACHING means each idea is built up for a student meeting it for the first time, in the order that suits that kind of idea (given). An OVERVIEW sentence names or states an idea without building it (no why, no picture, no real example, no steps, no check).
Score 1-10 (10 = an excellent teacher; 5 = adequate; 2 = a textbook summary):
- ideas[]: for each idea listed, built_up (is it built up rather than stated?) and order (does the teaching follow that idea's order?).
- plain_words: short sentences, everyday words a 14-year-old second-language English speaker follows.
- terms: every technical term explained simply the first time and then used consistently.
- steps: every step of every example or method is said, with why.
- overall: could a student who has never met this topic understand it from these scripts alone?
Also: checks = how many questions are put to the student AND then answered; overview_sentences = up to 5 sentences that only state or name an idea; accuracy_issues = factual or arithmetic errors ([] if none).
Reply as JSON: {"ideas":[{"title":"","built_up":0,"order":0}],"plain_words":0,"terms":0,"steps":0,"overall":0,"checks":0,"overview_sentences":[],"accuracy_issues":[]}`;

async function judge(title: string, ideas: Array<{ title: string; type: LessonType }>, beats: Array<{ title: string; script: string }>) {
  const user = `LESSON: ${title}\nIDEAS AND THEIR TEACHING ORDER:\n${ideas.map((i) => `- ${i.title} (${i.type}): ${orderLine(i.type, level)}`).join("\n")}\n\nSCRIPTS:\n${beats.map((b, i) => `BOARD ${i + 1}: ${b.title}\n${b.script}`).join("\n\n")}`;
  const { json, costUsd } = await jsonCall(client, JUDGE, JUDGE_PROMPT, user, 3000);
  spent += costUsd;
  return json as { ideas?: Array<{ built_up: number; order: number }>; plain_words?: number; terms?: number; steps?: number; overall?: number; checks?: number; overview_sentences?: string[]; accuracy_issues?: string[] };
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
function measured(beats: Array<{ title: string; script: string }>, doc: SuprnotesLessonInput) {
  const sentences = beats.flatMap((b) => b.script.split(/(?<=[.!?])\s+/).filter((s) => s.trim()));
  const gaps = courseCoverageGaps(beats.map((b, i) => ({ id: `b${i + 1}`, title: b.title, script: b.script })), doc.contentBlocks ?? []);
  const points = (doc.contentBlocks ?? []).reduce((n, b) => n + (b.keyIdeas?.length ?? 0), 0);
  const missed = gaps.boards.reduce((n, g) => n + g.missing.length, 0);
  return { boards: beats.length, sentences: sentences.length, wordsPerSentence: +mean(sentences.map((s) => s.split(/\s+/).length)).toFixed(1), banned: beats.flatMap((b) => bannedWordsIn(b.script)).length, keyPointsTaught: points ? +(1 - missed / points).toFixed(2) : 1 };
}

for (const { cached, kind } of picked) {
  if (spent > MAX_USD) { console.log(`stopping: $${spent.toFixed(3)} spent (cap $${MAX_USD})`); break; }
  const spec = cached.spec;
  const subject = subjectOf(spec);
  const parts = splitIntoLessons(spec.boards.map((b) => ({ title: b.title, outcomeRefs: b.outcomeRefs })));
  const part = parts[0];
  const meta = { request: cached.request, framework: "", subject };
  const ideas = part.ideas.map((i) => ({ title: spec.boards[i].title, type: lessonTypeOf({ subject, title: spec.boards[i].title, objective: spec.boards[i].objective, keyPoints: spec.boards[i].keyPoints, outcomes: spec.boards[i].outcomeRefs.map((r) => spec.outcomes[r - 1]?.text ?? "") }) }));
  const row: Record<string, unknown> = { lesson: `${spec.courseLabel} — ${spec.lessonTitle}`, kind, ideas: ideas.map((i) => `${i.title} (${i.type})`) };
  for (const condition of ["before", "after"] as const) {
    process.env.CANVAS_TEACHING_ORDERS = condition === "after" ? "on" : "off";
    const sub: LessonSpec = { ...spec, boards: part.ideas.map((i) => spec.boards[i]), checkpoint: spec.checkpoint.filter((x) => part.outcomeRefs.includes(x.outcomeRef)), examPractice: (spec.examPractice ?? []).filter((q) => part.outcomeRefs.includes(q.outcomeRef)) };
    const doc = condition === "after" ? withTeachingOrders(lessonPartDocument(spec, meta, [], parts, 0), level) : lessonDocument(sub, meta, []);
    try {
      const t0 = Date.now();
      const canvas = await planCanvasLecture(inputFor(doc, spec.lessonTitle));
      spent += canvas.costUsd;
      const beats = canvas.plan.map((b) => ({ title: b.title, script: b.canvas?.script ?? "" }));
      const scores = await judge(spec.lessonTitle, ideas, beats);
      row[condition] = { ...measured(beats, doc), seconds: Math.round((Date.now() - t0) / 1000), ...scores, ideaScores: scores.ideas };
      writeFileSync(path.join(outDir, `${results.length + 1}-${condition}.json`), JSON.stringify({ lesson: row.lesson, beats }, null, 1));
      console.log(`${row.lesson} [${condition}]: overall ${scores.overall}, built-up ${mean((scores.ideas ?? []).map((i) => i.built_up)).toFixed(1)}, order ${mean((scores.ideas ?? []).map((i) => i.order)).toFixed(1)}, plain ${scores.plain_words}, ${beats.length} boards — $${spent.toFixed(3)} so far`);
    } catch (error) {
      row[condition] = { error: (error as Error).message.slice(0, 200) };
      console.log(`${row.lesson} [${condition}] failed: ${(error as Error).message.slice(0, 160)}`);
    }
  }
  results.push(row);
  writeFileSync(path.join(outDir, "results.json"), JSON.stringify({ spent, results }, null, 1));
}
process.env.CANVAS_TEACHING_ORDERS = "off";

// Summary: before vs after, averaged over lessons that ran in both.
type Run = { overall?: number; plain_words?: number; terms?: number; steps?: number; checks?: number; banned?: number; wordsPerSentence?: number; keyPointsTaught?: number; boards?: number; ideaScores?: Array<{ built_up: number; order: number }>; overview_sentences?: string[]; accuracy_issues?: string[] };
const both = results.filter((r) => (r.before as Run)?.overall !== undefined && (r.after as Run)?.overall !== undefined);
const avg = (cond: "before" | "after", f: (r: Run) => number) => mean(both.map((r) => f(r[cond] as Run))).toFixed(2);
const rows: Array<[string, (r: Run) => number]> = [
  ["overall (1-10)", (r) => r.overall ?? 0],
  ["ideas built up (1-10)", (r) => mean((r.ideaScores ?? []).map((i) => i.built_up))],
  ["order followed (1-10)", (r) => mean((r.ideaScores ?? []).map((i) => i.order))],
  ["plain words (1-10)", (r) => r.plain_words ?? 0],
  ["terms explained (1-10)", (r) => r.terms ?? 0],
  ["steps with why (1-10)", (r) => r.steps ?? 0],
  ["checks asked and answered", (r) => r.checks ?? 0],
  ["overview sentences found", (r) => (r.overview_sentences ?? []).length],
  ["accuracy issues", (r) => (r.accuracy_issues ?? []).length],
  ["banned words", (r) => r.banned ?? 0],
  ["words per sentence", (r) => r.wordsPerSentence ?? 0],
  ["key points taught", (r) => r.keyPointsTaught ?? 0],
  ["boards", (r) => r.boards ?? 0],
];
const table = [`| measure | before | after |`, `|---|---|---|`, ...rows.map(([name, f]) => `| ${name} | ${avg("before", f)} | ${avg("after", f)} |`)].join("\n");
console.log(`\n${both.length} lessons in both conditions, $${spent.toFixed(3)} spent\n${table}`);
writeFileSync(path.join(outDir, "summary.md"), `${both.length} lessons, $${spent.toFixed(3)}\n\n${table}\n`);

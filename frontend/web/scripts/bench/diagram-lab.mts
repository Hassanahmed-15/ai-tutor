/**
 * DIAGRAM LAB — fast, cheap look at the diagrams and labels of NEW random course lessons (owner,
 * 2026-10-17: full-lecture tests took too long and cost too much). Plans each lesson, then writes ONLY
 * its visual boards (figure, diagram, picture, graph) — no narration audio, no playback, no test.
 * Saves snapshot-shaped JSON for scripts/bench/diagram-lab-render.mts.
 *
 *   NODE_OPTIONS=--conditions=react-server npx tsx --env-file=.env.local --tsconfig tsconfig.json scripts/bench/diagram-lab.mts <outDir> [count=5] [maxUsd=0.6]
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { lessonDocument, type Evidence } from "../../lib/curriculum/lessonSpec.ts";
import { planLessonSpec } from "../../lib/curriculum/planSpec.ts";
import { lessonKey } from "../../lib/curriculum/mastery.ts";
import type { CurriculumTree } from "../../lib/curriculum/types.ts";
import { planCanvasLecture, writeCanvasBoard, canvasSpecOf } from "../../lib/canvas/progressive.ts";
import type { CanvasBoardSpec, CanvasPlanBeat } from "../../lib/canvas/types.ts";
import type { ProgressiveLectureInput } from "../../lib/progressiveLectureTypes.ts";
import { createOpenAI } from "../../lib/openaiClient.ts";

const WEB = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
const [outDir, countArg, capArg] = process.argv.slice(2);
const count = Number(countArg ?? 5), cap = Number(capArg ?? 0.6);
const ALL = process.argv.includes("--all");
mkdirSync(outDir, { recursive: true });
const COURSES = ["cie-olevel-biology-5090-2026-2028", "cie-alevel-biology-9700-2025-2027", "cie-olevel-mathematics-d-4024-2025-2027", "cie-alevel-mathematics-9709-2026-2027"];
const VISUAL = new Set(["figure", "diagram", "illustration", "graph", "molecule", "atom-map"]);
const openai = createOpenAI({ apiKey: process.env.OPENAI_API_KEY });
const MODEL = process.env.CURRICULUM_SPEC_MODEL ?? "gpt-5.6-luna";
const profile: ProgressiveLectureInput["learnerProfile"] = { expertise: "intermediate", depth: "balanced", goal: "exam", codeExamples: false, preferredExamples: "worked", rationale: "diagram lab", confirmedAt: new Date().toISOString() };

function pickLessons() {
  const out: Array<{ courseId: string; tree: CurriculumTree; grade: string; unitId: string; topicId: string; lessonId: string; title: string; outcomes: Array<{ code: string | null; text: string }> }> = [];
  for (let i = 0; i < count; i++) {
    const courseId = COURSES[i % COURSES.length];
    const tree = JSON.parse(readFileSync(path.join(WEB, "data/curricula/trees", `${courseId}.json`), "utf8")) as CurriculumTree;
    const all = tree.grades.flatMap((g) => g.units.flatMap((u) => u.topics.flatMap((t) => t.subtopics.filter((s) => s.outcomes.length).map((s) => ({ g, u, t, s })))));
    const { g, u, t, s } = all[Math.floor(Math.random() * all.length)];
    out.push({ courseId, tree, grade: g.grade, unitId: u.id, topicId: t.id, lessonId: s.id, title: s.title, outcomes: s.outcomes.map((o) => ({ code: o.code, text: o.text })) });
  }
  return out;
}

function evidenceFor(courseId: string, key: string, topicId: string): Evidence[] {
  try {
    const file = JSON.parse(readFileSync(path.join(WEB, "data/curricula/sources", `${courseId}.json`), "utf8")) as { lessons: Record<string, Evidence[]> };
    return file.lessons[key] ?? Object.entries(file.lessons).filter(([k]) => k.split("/").includes(topicId)).flatMap(([, ev]) => ev);
  } catch { return []; }
}

let spent = 0;
const summary: string[] = [];
await Promise.all(pickLessons().map(async (lesson, n) => {
  const id = `L${n + 1}`;
  const t0 = Date.now();
  let usd = 0;
  try {
    const { tree } = lesson;
    const courseLabel = [tree.board, tree.qualification, tree.subject, tree.syllabusCode].filter(Boolean).join(" ");
    const evidence = evidenceFor(lesson.courseId, lessonKey(lesson.grade, lesson.unitId, lesson.topicId, lesson.lessonId), lesson.topicId);
    const planned = await planLessonSpec(openai, MODEL, { courseLabel, level: lesson.grade, title: lesson.title, outcomes: lesson.outcomes, evidence });
    usd += (planned.usage.input * 0.2 + planned.usage.output * 1.2) / 1e6;
    const document = lessonDocument(planned.spec, { request: { courseId: lesson.courseId, version: tree.build.builtAt, grade: lesson.grade, unitId: lesson.unitId, topicId: lesson.topicId, lessonId: lesson.lessonId }, framework: [tree.framework, tree.syllabusCode].filter(Boolean).join(" "), subject: tree.subject, sourceUrl: tree.source.urls[0] }, evidence);
    const input: ProgressiveLectureInput = { topic: `${courseLabel}: ${lesson.title}`, mood: "", sourceType: "suprnotes", mode: "standard", suprnotes: document, learnerProfile: profile };
    const canvas = await planCanvasLecture(input);
    usd += canvas.costUsd;
    const plan = canvas.plan.map((p) => p.canvas).filter((b): b is CanvasPlanBeat => Boolean(b));
    const earlier: Array<CanvasBoardSpec | undefined> = plan.map(() => undefined);
    // --all: every board of the lesson (still no narration audio), to see whole lectures.
    const picks = plan.map((b, i) => ({ b, i })).filter(({ b }) => ALL || VISUAL.has(b.stage)).slice(0, ALL ? 12 : 4);
    const beats: unknown[] = [];
    await Promise.all(picks.map(async ({ b, i }) => {
      const w = await writeCanvasBoard({ userId: "diagram-lab", sessionId: `dlab-${Date.now()}-${n}`, topic: input.topic, plan, index: i, earlier, notes: [], document });
      usd += w.costUsd;
      for (const line of (w as { log?: string[] }).log ?? []) if (/picture|textbook|not a picture/i.test(line)) console.log(`[lab] ${id} ${line.slice(0, 300)}`);
      const spec = canvasSpecOf(w.beat);
      if (spec) beats.push({ index: i, title: b.title, plannedStage: b.stage, script: b.script, draw: { ops: [{ kind: "canvasBoard", spec }] } });
    }));
    spent += usd;
    beats.sort((a, b) => (a as { index: number }).index - (b as { index: number }).index);
    writeFileSync(path.join(outDir, `${id}-snapshot.json`), JSON.stringify({ topic: `${tree.qualification} ${tree.subject}: ${lesson.title}`, usd, beats }, null, 1));
    summary.push(`${id} ${tree.qualification} ${tree.subject} — ${lesson.title}: ${beats.length} visual board(s) of ${plan.length}, $${usd.toFixed(3)}, ${Math.round((Date.now() - t0) / 1000)}s`);
  } catch (e) {
    spent += usd;
    summary.push(`${id} ${lesson.title}: FAILED ${(e as Error).message.slice(0, 160)}`);
  }
}));
console.log(summary.sort().join("\n"));
console.log(`total $${spent.toFixed(3)} (cap $${cap})`);

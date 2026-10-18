/**
 * COURSE BENCH — one course lesson through the real pipeline, as LearnPage builds it: POST
 * /api/curricula/lesson (official outcomes → LessonSpec → lesson document), then planCanvasLecture +
 * writeCanvasBoard with the document as a curriculum source. Saves a snapshot in the prompt-bench
 * format (render it with diagram-lab-render.mts; judge it with prompt-bench.mts --rescore).
 *
 *   NODE_OPTIONS=--conditions=react-server npx tsx --env-file=.env.local --tsconfig tsconfig.json \
 *     scripts/bench/course-bench.mts <outDir> <courseId> <grade> <unitId> <topicId> <lessonId> [profile]
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { signAccessToken } from "../../lib/auth.ts";
import { planCanvasLecture, writeCanvasBoard, canvasSpecOf } from "../../lib/canvas/progressive.ts";
import { curriculumDocumentOf } from "../../lib/canvas/lessonRequest.ts";
import type { CanvasBoardSpec, CanvasPlanBeat } from "../../lib/canvas/types.ts";
import type { ProgressiveLectureInput } from "../../lib/progressiveLectureTypes.ts";
import { buildStudentCard } from "../../lib/studentCard.ts";
import { PROFILES } from "./lectureChecks.mts";

const [outDir, courseId, grade, unitId, topicId, lessonId, profileId = "igcse"] = process.argv.slice(2);
const BASE = process.env.BENCH_BASE ?? "http://localhost:3000";
mkdirSync(path.join(outDir, "runs"), { recursive: true });
const p = PROFILES.find((x) => x.id === profileId) ?? PROFILES[1];
const t0 = Date.now();

const cookie = `aria_access=${await signAccessToken("course-bench", "bench@test.local")}`;
const res = await fetch(`${BASE}/api/curricula/lesson`, { method: "POST", headers: { "content-type": "application/json", cookie }, body: JSON.stringify({ courseId, version: "", grade, unitId, topicId, lessonId }) });
const data = (await res.json()) as { spec?: { lessonTitle: string }; document?: unknown; error?: string; costUsd?: number };
if (!res.ok || !data.document || !data.spec) throw new Error(`lesson ${res.status}: ${data.error ?? "no document"}`);
const title = data.spec.lessonTitle;
console.log(`course lesson: "${title}"`);

const card = buildStudentCard(p.basics, title, {}, p.support);
const input = { topic: title, mood: "", sourceType: "suprnotes", mode: "standard", suprnotes: data.document, learnerProfile: p.snapshot, ...(card ? { studentCard: card } : {}) } as unknown as ProgressiveLectureInput;
const document = curriculumDocumentOf(input);
if (!document) throw new Error("not a course lesson document");

let usd = Number(data.costUsd ?? 0);
const canvas = await planCanvasLecture(input);
usd += canvas.costUsd;
const plan = canvas.plan.map((x) => x.canvas).filter((b): b is CanvasPlanBeat => Boolean(b));
const earlier: Array<CanvasBoardSpec | undefined> = plan.map(() => undefined);
const specs: CanvasBoardSpec[] = [];
const logs: string[] = [];
for (let i = 0; i < plan.length; i += 3) {
  const done = await Promise.all(plan.slice(i, i + 3).map((_, j) => writeCanvasBoard({ userId: "course-bench", sessionId: `course-${Date.now()}`, topic: title, plan, index: i + j, earlier, notes: [], document })));
  for (const [j, w] of done.entries()) {
    usd += w.costUsd;
    const s = canvasSpecOf(w.beat);
    if (s) { specs[i + j] = s; earlier[i + j] = s; }
    logs.push(...((w as { log?: string[] }).log ?? []));
  }
}
const beats = plan.filter((_, i) => specs[i]);
const kept = specs.filter(Boolean);
const id = `C1-${p.id}`;
writeFileSync(path.join(outDir, "runs", `${id}-snapshot.json`), JSON.stringify({ topic: `${title} — ${courseId} — ${p.label}`, usd, beats: beats.map((b, i) => ({ title: b.title, plannedStage: b.stage, visualType: b.visualType, script: b.script, brief: b.brief, objects: b.objects, draw: { ops: [{ kind: "canvasBoard", spec: kept[i] }] } })) }, null, 1));
writeFileSync(path.join(outDir, "logs.txt"), logs.join("\n"));
console.log(`DONE ${id} "${title}" · ${kept.length} board(s) · $${usd.toFixed(3)} · ${Math.round((Date.now() - t0) / 1000)}s`);
console.log(kept.map((s, i) => `  b${i + 1} ${s.stage.kind}${s.interaction ? ` [${s.interaction.kind}${s.interaction.kind === "quiz" ? `:${s.interaction.mode ?? "choice"}` : ""}]` : ""} ${s.heading}`).join("\n"));

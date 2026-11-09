import { NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { lessonCaller } from "@/lib/auth";
import { wakeLectureWorker } from "@/lib/progressiveLectureQueue";
import { createOpenAI } from "@/lib/openaiClient";
import { curriculumLessons } from "@/lib/db/cosmos";
import { lessonDocument, lessonPartDocument, lessonSpecText, type CurriculumLessonRequest, type Evidence, type LessonSeries, type LessonSpec } from "@/lib/curriculum/lessonSpec";
import { lessonSeriesOn, splitIntoLessons } from "@/lib/series/split";
import { nextPart, readSeries } from "@/lib/series/store";
import { planLessonSpec } from "@/lib/curriculum/planSpec";
import { cacheId, type CachedLesson } from "@/lib/curriculum/lessonCache";
import { evidenceFor, gradeLabel } from "@/lib/curriculum/lessonSources";
import type { CurriculumTree } from "@/lib/curriculum/types";

/**
 * A curriculum lesson, from its address to a source-grounded lesson document
 * (lib/curriculum/lessonSpec.ts):
 *
 *   1. the lesson's official outcomes are read from the reviewed course tree — the request carries
 *      only ids, so nothing the browser sends can change what the curriculum says;
 *   2. its syllabus text is read from data/curricula/sources/<course>.json by address;
 *   3. a LessonSpec is planned under a strict JSON schema (re-asked once if it misses an outcome),
 *      and code makes sure every outcome is taught (completeSpec);
 *   4. it is cached per course version + lesson, so every later student gets it free.
 *
 * Signed-in students only (step 3 is a model call the first time).
 */
const MODEL = process.env.CURRICULUM_SPEC_MODEL ?? "gpt-5.6-luna";
const DATA = path.join(process.cwd(), "data/curricula");

export async function POST(req: Request) {
  const caller = await lessonCaller();
  if (!caller) return NextResponse.json({ error: "Sign in to start a course lesson." }, { status: 401 });
  // The lecture worker starts while this lesson is prepared, not after (lib/progressiveLectureQueue.ts).
  void wakeLectureWorker().catch(() => undefined);
  const body = (await req.json().catch(() => ({}))) as Partial<CurriculumLessonRequest> & { part?: unknown };
  // Which lesson of a series (lib/series/split.ts) to teach; by default the student's next one.
  const askedPart = Number.isInteger(body.part) ? Number(body.part) : null;
  const r: CurriculumLessonRequest = {
    courseId: String(body.courseId ?? ""), version: String(body.version ?? ""), grade: String(body.grade ?? ""),
    unitId: String(body.unitId ?? ""), topicId: String(body.topicId ?? ""), lessonId: String(body.lessonId ?? ""),
  };
  if (!/^[a-z0-9][a-z0-9-]{0,120}$/.test(r.courseId)) return NextResponse.json({ error: "Unknown course" }, { status: 404 });

  let tree: CurriculumTree;
  try {
    tree = JSON.parse(await readFile(path.join(DATA, "trees", `${r.courseId}.json`), "utf8"));
  } catch {
    return NextResponse.json({ error: "Unknown course" }, { status: 404 });
  }
  // The version is the tree build the student saw; a newer tree means a new lesson.
  r.version = tree.build.builtAt;
  const g = tree.grades.find((x) => x.grade === r.grade);
  const u = g?.units.find((x) => x.id === r.unitId);
  const t = u?.topics.find((x) => x.id === r.topicId);
  const s = t?.subtopics.find((x) => x.id === r.lessonId);
  if (!g || !u || !t || !s) return NextResponse.json({ error: "That lesson is not in this course any more." }, { status: 404 });

  const id = cacheId(r);
  let container: Awaited<ReturnType<typeof curriculumLessons>> | null = null;
  try {
    container = await curriculumLessons();
    const { resource } = await container.item(id, id).read<CachedLesson>();
    if (resource?.spec) {
      const verification = (resource.verification as { version?: number } | undefined)?.version === 3 ? resource.verification : undefined;
      return NextResponse.json(respond(resource.spec, r, tree, await evidenceFor(r), true, verification, await seriesFor(caller.userId, r, resource.spec, askedPart)));
    }
  } catch {
    // No cache reachable: build it fresh (the lesson still works).
  }

  const evidence = await evidenceFor(r);
  const courseLabel = [tree.board, tree.qualification, tree.subject, tree.syllabusCode].filter(Boolean).join(" ");
  const level = gradeLabel(tree, g.grade);
  const outcomes = s.outcomes.map((o) => ({ code: o.code, text: o.text }));
  try {
    const client = createOpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const { spec, modelGaps } = await planLessonSpec(client, MODEL, { courseLabel, level, title: s.title, outcomes, evidence });
    const doc: CachedLesson = { id, request: r, spec, createdAt: new Date().toISOString(), model: MODEL, modelGaps };
    try { await container?.items.upsert(doc); } catch { /* cache is best-effort */ }
    return NextResponse.json(respond(spec, r, tree, evidence, false, undefined, await seriesFor(caller.userId, r, spec, askedPart)));
  } catch {
    return NextResponse.json({ error: "Could not prepare this lesson — please try again." }, { status: 502 });
  }
}

/**
 * The lessons this course lesson is taught in (flag CANVAS_LESSON_SERIES=on), and which one to teach now:
 * the one asked for, else the student's next unfinished one. Off: null, and the lesson is built whole.
 */
async function seriesFor(userId: string, r: CurriculumLessonRequest, spec: LessonSpec, asked: number | null): Promise<(LessonSeries & { completed: number[]; split: ReturnType<typeof splitIntoLessons> }) | null> {
  if (!lessonSeriesOn() || !spec.boards.length) return null;
  const split = splitIntoLessons(spec.boards.map((b) => ({ title: b.title, outcomeRefs: b.outcomeRefs })));
  const titles = split.map((p) => p.titles);
  const progress = await readSeries(userId, r);
  const part = asked && asked >= 1 && asked <= split.length ? asked : nextPart(progress, titles);
  const sameSplit = progress && JSON.stringify(progress.titles) === JSON.stringify(titles);
  return { part, parts: split.length, titles, outcomeRefs: split[part - 1].outcomeRefs, completed: sameSplit ? progress.completed : [], split };
}

function respond(spec: LessonSpec, r: CurriculumLessonRequest, tree: CurriculumTree, evidence: Evidence[], cached: boolean, verification?: unknown, series?: Awaited<ReturnType<typeof seriesFor>>) {
  const meta = { request: r, framework: [tree.framework, tree.syllabusCode].filter(Boolean).join(" "), subject: tree.subject, sourceUrl: tree.source.urls[0] };
  const { split, ...shown } = series ?? { split: null };
  return {
    request: r,
    cached,
    spec,
    // A lesson checked whole says nothing about one lesson of its series: that one is checked by itself.
    verification: series && series.parts > 1 ? null : verification ?? null,
    document: series && split ? lessonPartDocument(spec, meta, evidence, split, series.part - 1) : lessonDocument(spec, meta, evidence),
    text: lessonSpecText(spec),
    series: series ? shown : null,
  };
}

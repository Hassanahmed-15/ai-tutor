import { NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { lessonCaller } from "@/lib/auth";
import { createOpenAI } from "@/lib/openaiClient";
import { curriculumLessons } from "@/lib/db/cosmos";
import { lessonDocument, lessonSpecText, type CurriculumLessonRequest, type Evidence, type LessonSpec } from "@/lib/curriculum/lessonSpec";
import { planLessonSpec } from "@/lib/curriculum/planSpec";
import { lessonKey } from "@/lib/curriculum/mastery";
import { cacheId, type CachedLesson } from "@/lib/curriculum/lessonCache";
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

function gradeLabel(tree: CurriculumTree, grade: string): string {
  if (grade === "all") return tree.qualification ?? tree.framework;
  if (/^\d+$/.test(grade)) return tree.region === "PK" ? `Class ${grade}` : `Grade ${grade}`;
  return grade;
}

export async function POST(req: Request) {
  if (!(await lessonCaller())) return NextResponse.json({ error: "Sign in to start a course lesson." }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as Partial<CurriculumLessonRequest>;
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
      return NextResponse.json(respond(resource.spec, r, tree, await evidenceFor(r), true, verification));
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
    return NextResponse.json(respond(spec, r, tree, evidence, false));
  } catch {
    return NextResponse.json({ error: "Could not prepare this lesson — please try again." }, { status: 502 });
  }
}

async function evidenceFor(r: CurriculumLessonRequest): Promise<Evidence[]> {
  try {
    const file = JSON.parse(await readFile(path.join(DATA, "sources", `${r.courseId}.json`), "utf8")) as { lessons: Record<string, Evidence[]> };
    const exact = file.lessons[lessonKey(r.grade, r.unitId, r.topicId, r.lessonId)] ?? [];
    if (exact.length) return exact;
    // A syllabus may split one tree subtopic into several source-sized lessons. The course tree
    // remains the stable student address; when its exact leaf is absent, use the source entries
    // for the same topic so the generated lesson still has official page evidence.
    return Object.entries(file.lessons)
      .filter(([key]) => key.split("/").includes(r.topicId))
      .flatMap(([, evidence]) => evidence);
  } catch {
    return [];
  }
}

function respond(spec: LessonSpec, r: CurriculumLessonRequest, tree: CurriculumTree, evidence: Evidence[], cached: boolean, verification?: unknown) {
  return {
    request: r,
    cached,
    spec,
    verification: verification ?? null,
    document: lessonDocument(spec, { request: r, framework: [tree.framework, tree.syllabusCode].filter(Boolean).join(" "), subject: tree.subject, sourceUrl: tree.source.urls[0] }, evidence),
    text: lessonSpecText(spec),
  };
}

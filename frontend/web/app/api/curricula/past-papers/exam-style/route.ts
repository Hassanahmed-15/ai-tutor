import { NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { lessonCaller } from "@/lib/auth";
import { lessonKey } from "@/lib/curriculum/mastery";
import { pastPapersOn } from "@/lib/curriculum/pastPapers";
import { examStyleId, forStudent, makeExamStyleSet } from "@/lib/curriculum/examStyle";
import type { CurriculumTree } from "@/lib/curriculum/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Aria's exam-style questions for one course lesson (lib/curriculum/examStyle.ts), for every student. */
export async function POST(req: Request) {
  const caller = await lessonCaller();
  if (!caller) return NextResponse.json({ error: "Sign in to practise." }, { status: 401 });
  if (!pastPapersOn()) return NextResponse.json({ available: false });
  const b = (await req.json().catch(() => ({}))) as { courseId?: string; grade?: string; unitId?: string; topicId?: string; lessonId?: string; part?: number };
  const courseId = String(b.courseId ?? "");
  if (!/^[a-z0-9-]{1,120}$/.test(courseId)) return NextResponse.json({ available: false });
  let tree: CurriculumTree;
  try { tree = JSON.parse(await readFile(path.join(process.cwd(), "data/curricula/trees", `${courseId}.json`), "utf8")); }
  catch { return NextResponse.json({ available: false }); }
  const g = tree.grades.find((x) => x.grade === b.grade);
  const u = g?.units.find((x) => x.id === b.unitId);
  const t = u?.topics.find((x) => x.id === b.topicId);
  const s = t?.subtopics.find((x) => x.id === b.lessonId);
  if (!g || !u || !t || !s) return NextResponse.json({ available: false });
  const id = examStyleId(courseId, tree.build.builtAt, lessonKey(g.grade, u.id, t.id, s.id), Math.max(1, Number(b.part) || 1));
  try {
    const set = await makeExamStyleSet(id, tree.subject, s.title, s.outcomes.map((o) => o.text));
    if (!set) return NextResponse.json({ available: false });
    return NextResponse.json({ available: true, setId: set.id, questions: forStudent(set) });
  } catch (error) {
    return NextResponse.json({ available: false, error: (error as Error).message });
  }
}

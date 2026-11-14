import { NextResponse } from "next/server";
import { lessonCaller } from "@/lib/auth";
import { lessonKey } from "@/lib/curriculum/mastery";
import { fullPastPaperAccess, pastPaperIndex, pastPaperQuestion, pastPapersOn, pickForLesson, pointerLabel } from "@/lib/curriculum/pastPapers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The past-paper practice for the end of one course lesson (lib/curriculum/pastPapers.ts).
 * Everyone: pointers to the real questions that test it. Accounts in PAST_PAPERS_FULL_USERS: the questions
 * themselves (page images + parts; the mark scheme only comes back after an answer is marked).
 */
export async function GET(req: Request) {
  const caller = await lessonCaller();
  if (!caller) return NextResponse.json({ error: "Sign in to practise." }, { status: 401 });
  if (!pastPapersOn()) return NextResponse.json({ available: false });
  const u = new URL(req.url);
  const courseId = u.searchParams.get("courseId") ?? "";
  const key = lessonKey(u.searchParams.get("grade") ?? "", u.searchParams.get("unitId") ?? "", u.searchParams.get("topicId") ?? "", u.searchParams.get("lessonId") ?? "");
  const part = Math.max(1, Number(u.searchParams.get("part")) || 1);
  const index = await pastPaperIndex(courseId);
  const all = index?.lessons[key] ?? [];
  if (!all.length) return NextResponse.json({ available: false });
  const picked = pickForLesson(all, part, 3);
  const full = fullPastPaperAccess(caller.userId, caller.email);
  // Pointers: the lesson's real questions, most relevant first (a student finds the paper through school).
  const pointers = pickForLesson(all, part, 6).map((p) => ({ label: pointerLabel(p), mcq: p.mcq, marks: p.marks, parts: p.parts }));
  if (!full) return NextResponse.json({ available: true, full: false, pointers, total: all.length });
  const questions = (await Promise.all(picked.map(async (p) => {
    const q = await pastPaperQuestion(p.ref);
    if (!q) return null;
    return {
      ref: p.ref, label: pointerLabel(p), mcq: q.mcq, marks: q.marks, lessonParts: p.parts,
      parts: q.parts.filter((x) => x.marks > 0).map((x) => ({ label: x.label, marks: x.marks })),
      images: q.images.map((_, k) => `/api/curricula/past-papers/image?ref=${encodeURIComponent(p.ref)}&k=${k}`),
    };
  }))).filter(Boolean);
  return NextResponse.json({ available: questions.length > 0, full: true, questions, pointers, total: all.length });
}

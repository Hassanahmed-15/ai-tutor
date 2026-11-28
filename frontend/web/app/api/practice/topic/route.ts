import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { lessonCaller } from "@/lib/auth";
import { pastPapersOn } from "@/lib/curriculum/pastPapers";
import { forStudent, makeExamStyleSet } from "@/lib/curriculum/examStyle";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * PRACTICE QUESTIONS ON A TYPED TOPIC (the front page's "Practice questions" mode): the same exam-style set a course
 * lesson ends with (lib/curriculum/examStyle.ts: one multiple choice + two structured questions, checked by a second
 * examiner, kept in blob storage), written for whatever the student typed. Marked by /api/curricula/past-papers/mark.
 */
export async function POST(req: Request) {
  const caller = await lessonCaller();
  if (!caller) return NextResponse.json({ error: "Sign in to practise." }, { status: 401 });
  if (!pastPapersOn()) return NextResponse.json({ available: false });
  const b = (await req.json().catch(() => ({}))) as { topic?: unknown; round?: unknown };
  const topic = String(b.topic ?? "").replace(/\s+/g, " ").trim().slice(0, 200);
  if (topic.length < 2) return NextResponse.json({ available: false });
  // One set per topic and round, shared by everyone who types the same words: a second "More questions" is round 2.
  const round = Math.max(1, Math.min(20, Number(b.round) || 1));
  const id = createHash("sha256").update(["typed-practice-1", topic.toLowerCase(), round].join("|")).digest("hex").slice(0, 32);
  try {
    const set = await makeExamStyleSet(id, "(the subject this topic belongs to)", topic, [`The student asked to practise: ${topic}`]);
    if (!set) return NextResponse.json({ available: false });
    return NextResponse.json({ available: true, setId: set.id, questions: forStudent(set) });
  } catch (error) {
    return NextResponse.json({ available: false, error: (error as Error).message });
  }
}

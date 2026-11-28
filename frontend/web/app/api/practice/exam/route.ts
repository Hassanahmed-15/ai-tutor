import { NextResponse } from "next/server";
import { lessonCaller } from "@/lib/auth";
import { ExamWriteError, writeExam } from "@/lib/practice/generate";
import { normalizePlan, practiceExamOn, studentExam } from "@/lib/practice/rules";
import { practiceSpend } from "@/lib/practice/spend";
import { saveExam } from "@/lib/practice/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * WRITE A PRACTICE EXAM (docs/practice-exam.md): questions and schemes written, checked by a second examiner, and
 * stored server-side for marking. The browser gets the questions only: no keys, schemes or working.
 */
export async function POST(req: Request) {
  if (!practiceExamOn()) return NextResponse.json({ error: "Not found." }, { status: 404 });
  const caller = await lessonCaller();
  if (!caller) return NextResponse.json({ error: "Sign in to practise." }, { status: 401 });
  const b = (await req.json().catch(() => ({}))) as { plan?: unknown };
  const checked = normalizePlan(b.plan);
  if ("error" in checked) return NextResponse.json({ error: checked.error }, { status: 400 });
  try {
    const exam = await practiceSpend(caller.userId, () => writeExam(checked.plan, caller.userId));
    await saveExam(exam);
    return NextResponse.json(studentExam(exam));
  } catch (error) {
    const message = error instanceof ExamWriteError ? error.message : "Aria could not write this test just now. Please try again.";
    console.warn("[practice-exam] writing failed:", (error as Error).message);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

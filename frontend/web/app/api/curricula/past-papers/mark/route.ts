import { NextResponse } from "next/server";
import { lessonCaller } from "@/lib/auth";
import { fullPastPaperAccess, pastPaperQuestion, pastPapersOn } from "@/lib/curriculum/pastPapers";
import { markWritten } from "@/lib/curriculum/pastPaperMarking";
import { examStyleSet } from "@/lib/curriculum/examStyle";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Marks one answer and returns the mark scheme with it.
 *   { ref, choice }            a real multiple-choice question (PAST_PAPERS_FULL_USERS only)
 *   { ref, answers }           a real written question, marked against Cambridge's scheme (PAST_PAPERS_FULL_USERS only)
 *   { setId, id, choice|answers }  one of Aria's exam-style questions (everyone)
 */
export async function POST(req: Request) {
  const caller = await lessonCaller();
  if (!caller) return NextResponse.json({ error: "Sign in to practise." }, { status: 401 });
  if (!pastPapersOn()) return NextResponse.json({ error: "Not available." }, { status: 404 });
  const body = (await req.json().catch(() => ({}))) as { ref?: string; setId?: string; id?: string; choice?: string; answers?: Record<string, string> };
  const answers = Object.fromEntries(Object.entries(body.answers ?? {}).map(([k, v]) => [String(k).slice(0, 20), String(v ?? "").slice(0, 4000)]));

  if (body.ref) {
    if (!fullPastPaperAccess(caller.userId, caller.email)) return NextResponse.json({ error: "Not available." }, { status: 403 });
    const q = await pastPaperQuestion(body.ref);
    if (!q) return NextResponse.json({ error: "No such question." }, { status: 404 });
    if (q.mcq) {
      const right = !!q.answer && String(body.choice ?? "").toUpperCase() === q.answer;
      return NextResponse.json({ awarded: right ? 1 : 0, max: 1, answer: q.answer, parts: [], feedback: "", scheme: [] });
    }
    try {
      const result = await markWritten({ parts: q.parts, scheme: q.ms }, answers);
      return NextResponse.json({ ...result, scheme: q.ms });
    } catch (error) {
      return NextResponse.json({ error: `Marking failed: ${(error as Error).message}` }, { status: 502 });
    }
  }

  if (body.setId && body.id) {
    const set = await examStyleSet(body.setId);
    const q = set?.questions.find((x) => x.id === body.id);
    if (!q) return NextResponse.json({ error: "No such question." }, { status: 404 });
    if (q.mcq) {
      const right = String(body.choice ?? "").toUpperCase() === q.answer;
      return NextResponse.json({ awarded: right ? 1 : 0, max: 1, answer: q.answer, parts: [], feedback: q.explain ?? "", scheme: [] });
    }
    try {
      const result = await markWritten({ parts: q.parts, scheme: q.scheme, context: q.stem }, answers);
      return NextResponse.json({ ...result, scheme: q.scheme });
    } catch (error) {
      return NextResponse.json({ error: `Marking failed: ${(error as Error).message}` }, { status: 502 });
    }
  }
  return NextResponse.json({ error: "Nothing to mark." }, { status: 400 });
}

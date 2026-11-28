import { NextResponse } from "next/server";
import { lessonCaller } from "@/lib/auth";
import { getDocumentImages } from "@/lib/pageImageStore";
import { gradeExam } from "@/lib/practice/grade";
import { answersOf, canGrade, practiceExamOn } from "@/lib/practice/rules";
import { practiceSpend } from "@/lib/practice/spend";
import { loadExam } from "@/lib/practice/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const MAX_PAGES = 10;
const MAX_IMAGE_CHARS = 8_000_000;

/**
 * MARK A PRACTICE EXAM (docs/practice-exam.md). Only the student who asked for the exam may mark it. Paper answers
 * come from the phone capture's pages (`documentId` from /api/capture/[id]/finish, kept in lib/pageImageStore).
 * `images` (data URLs of photos uploaded from the computer) is also accepted; they follow the capture's pages.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!practiceExamOn()) return NextResponse.json({ error: "Not found." }, { status: 404 });
  const caller = await lessonCaller();
  if (!caller) return NextResponse.json({ error: "Sign in to practise." }, { status: 401 });
  const { id } = await params;
  const exam = await loadExam(id);
  if (!exam || !canGrade(exam, caller.userId)) return NextResponse.json({ error: "No such test." }, { status: 404 });
  const b = (await req.json().catch(() => ({}))) as { answers?: unknown; documentId?: unknown; images?: unknown };
  const documentId = typeof b.documentId === "string" && b.documentId ? b.documentId : null;
  const stored = documentId ? getDocumentImages(documentId) : null;
  if (documentId && !stored) return NextResponse.json({ error: "Your scanned pages have expired. Please scan them again." }, { status: 410 });
  const uploaded = Array.isArray(b.images) ? b.images.filter((u): u is string => typeof u === "string" && /^data:image\/(jpeg|png|webp);base64,/.test(u) && u.length <= MAX_IMAGE_CHARS) : [];
  const pages = [...(stored?.pages ?? []).slice().sort((x, y) => x.pageNumber - y.pageNumber).map((p) => p.dataUrl), ...uploaded].slice(0, MAX_PAGES);
  try {
    const result = await practiceSpend(caller.userId, () => gradeExam(exam, answersOf(b.answers), pages));
    console.log(`[practice-exam] ${id.slice(0, 8)} marked: ${result.total}/${result.max} (${result.grade}), ${pages.length} page(s), $${result.costUsd.toFixed(4)}`);
    return NextResponse.json(result);
  } catch (error) {
    console.warn(`[practice-exam] ${id.slice(0, 8)} marking failed:`, (error as Error).message);
    return NextResponse.json({ error: "Aria could not mark this just now. Your answers are still here: please try again." }, { status: 502 });
  }
}

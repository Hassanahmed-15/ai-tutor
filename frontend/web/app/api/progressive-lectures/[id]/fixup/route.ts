import { NextResponse } from "next/server";
import { lessonCaller } from "@/lib/auth";
import { progressiveSession } from "@/lib/progressiveLectureStore";
import { writeFixupBoard } from "@/lib/canvas/fixupBoard";
import { readingGrade } from "@/lib/studentCard";
import type { Beat } from "@/lib/lessonContent";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * THE FIX-UP BOARD for a board's "Check it" question (lib/canvas/fixupBoard.ts). Asked by the player when that
 * board begins — before the student answers — so it is usually ready by the time they do; shown only after a
 * wrong answer. One per board: a second request for the same board waits on the first. Not in a strict lesson
 * (it would teach beyond the source).
 */
const KEY = Symbol.for("aria.fixupBoards");
const globalRef = globalThis as unknown as Record<symbol, Map<string, Promise<Beat | null>>>;
const making: Map<string, Promise<Beat | null>> = globalRef[KEY] ?? new Map();
globalRef[KEY] = making;

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await lessonCaller();
  if (!auth) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  const { id } = await params;
  const session = await progressiveSession(auth.userId, id);
  if (!session) return NextResponse.json({ error: "Progressive lecture not found." }, { status: 404 });
  if (session.boardEngine !== "canvas" || session.sourceFidelity === "strict") return NextResponse.json({ error: "No fix-up boards in this lesson." }, { status: 409 });
  const body = (await request.json().catch(() => ({}))) as { beatId?: unknown; question?: unknown; options?: unknown };
  const beatId = typeof body.beatId === "string" ? body.beatId : "";
  const question = typeof body.question === "string" ? body.question.slice(0, 600) : "";
  const options = Array.isArray(body.options)
    ? body.options.slice(0, 6).flatMap((o) => {
        const r = (o ?? {}) as Record<string, unknown>;
        return typeof r.text === "string" ? [{ text: r.text.slice(0, 300), correct: r.correct === true, feedback: typeof r.feedback === "string" ? r.feedback.slice(0, 400) : undefined }] : [];
      })
    : [];
  const planId = beatId.startsWith(`cv-${id}-`) ? beatId.slice(`cv-${id}-`.length) : "";
  const planned = session.plan.find((p) => p.canvas?.id === planId)?.canvas;
  if (!planned || !question || options.filter((o) => !o.correct).length === 0) return NextResponse.json({ error: "That board or question was not found." }, { status: 400 });

  const key = `${id}:${planId}`;
  let job = making.get(key);
  if (!job) {
    const lessonContext = session.plan.map((p, i) => `${i + 1}. ${p.title}`).join("\n");
    // The lecture's own reading level, measured on its narration: the fix-up board is worded no harder.
    const lessonGrade = readingGrade(session.plan.map((p) => p.canvas?.script ?? "").join(" "));
    job = writeFixupBoard({ userId: auth.userId, sessionId: id, topic: session.topic, board: { title: planned.title, script: planned.script }, question, options, lessonContext, subjectDomain: session.subjectDomain, ...(lessonGrade > 0 ? { readingGrade: lessonGrade } : {}) })
      .then((made) => {
        if (made) console.log(`[fixup] ${id.slice(0, 8)} after ${planId}: "${made.beat.title}" $${made.costUsd.toFixed(4)}`);
        return made?.beat ?? null;
      })
      .catch((error) => {
        console.warn(`[fixup] ${id.slice(0, 8)} after ${planId} failed: ${(error as Error).message.slice(0, 160)}`);
        return null;
      });
    making.set(key, job);
    // Kept 30 minutes, so a request for the same board while it is still being made, or soon after, shares it.
    setTimeout(() => making.delete(key), 30 * 60_000).unref?.();
  }
  const beat = await job;
  if (!beat) return NextResponse.json({ error: "The fix-up board could not be made." }, { status: 502 });
  return NextResponse.json({ beat });
}

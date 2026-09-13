import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { blobStorageConfigured } from "@/lib/blobStorage";
import { databaseConfigured } from "@/lib/db/cosmos";
import { normalizeLectureMode, normalizeLectureSourceType } from "@/lib/lectureArchive";
import { dispatchProgressiveTasks, progressiveQueueTransport } from "@/lib/progressiveLectureQueue";
import { createProgressiveLectureSession } from "@/lib/progressiveLectureStore";
import { isLearnerProfileSnapshot, shouldIncludeCodeExamples, type ProgressiveLectureInput } from "@/lib/progressiveLectureTypes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const auth = await currentUser();
  if (!auth) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  if (!databaseConfigured() || !blobStorageConfigured()) {
    return NextResponse.json({ error: "Lecture history storage is not configured." }, { status: 503 });
  }
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const topic = typeof body.topic === "string" ? body.topic.trim().slice(0, 200) : "";
  if (!topic) return NextResponse.json({ error: "topic is required" }, { status: 400 });
  if (!isLearnerProfileSnapshot(body.learnerProfile)) {
    return NextResponse.json({ error: "A confirmed learner profile is required." }, { status: 400 });
  }
  const rawOutline = body.outline && typeof body.outline === "object" ? body.outline as Record<string, unknown> : null;
  const outline = rawOutline && Array.isArray(rawOutline.subtopics) ? {
    topic: typeof rawOutline.topic === "string" ? rawOutline.topic.slice(0, 200) : topic,
    subtopics: rawOutline.subtopics
      .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
      .map((item) => ({
        title: typeof item.title === "string" ? item.title.slice(0, 100) : "",
        caption: typeof item.caption === "string" ? item.caption.slice(0, 240) : "",
        reason: typeof item.reason === "string" ? item.reason.slice(0, 240) : undefined,
      }))
      .filter((item) => item.title),
  } : undefined;
  const input: ProgressiveLectureInput = {
    topic,
    mood: typeof body.mood === "string" ? body.mood.slice(0, 500) : "",
    sourceType: normalizeLectureSourceType(body.sourceType),
    mode: normalizeLectureMode(body.mode),
    outline,
    context: text(body.context, 18_000),
    diagramHints: text(body.diagramHints, 2_000),
    slideImages: Array.isArray(body.slideImages) ? body.slideImages as ProgressiveLectureInput["slideImages"] : undefined,
    suprnotes: body.sourceDocument ?? body.suprnotes,
    transcript: text(body.transcript, 30_000),
    focus: text(body.focus, 1_000),
    documentId: text(body.documentId, 200),
    learnerProfile: {
      ...body.learnerProfile,
      codeExamples: shouldIncludeCodeExamples(body.learnerProfile),
      confirmedAt: body.learnerProfile.confirmedAt || new Date().toISOString(),
    },
  };

  try {
    const lecture = await createProgressiveLectureSession(auth.userId, input);
    await dispatchProgressiveTasks([{ version: 1, type: "plan", sessionId: lecture.id, userId: auth.userId }]);
    return NextResponse.json({
      sessionId: lecture.id,
      status: lecture.status,
      delivery: progressiveQueueTransport(),
    }, { status: 202 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not start progressive lecture generation.";
    console.error("[progressive-lectures] start failed:", error);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

function text(value: unknown, limit: number): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, limit) : undefined;
}

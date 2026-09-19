import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { blobStorageConfigured } from "@/lib/blobStorage";
import { databaseConfigured } from "@/lib/db/cosmos";
import { normalizeLectureMode, normalizeLectureSourceType } from "@/lib/lectureArchive";
import { dispatchProgressiveTasks, progressiveQueueTransport } from "@/lib/progressiveLectureQueue";
import { createProgressiveLectureSession } from "@/lib/progressiveLectureStore";
import { isLearnerProfileSnapshot, shouldIncludeCodeExamples, type ProgressiveLectureInput } from "@/lib/progressiveLectureTypes";
import { sanitizeLearnerProfile } from "@/lib/learnerProfile";
import { recordLesson, snapshotFrom } from "@/lib/learnerModel";
import { updateLearnerMemory } from "@/lib/learnerMemoryStore";

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
  // The full profile from the planning conversation, when the client sent one. The five-field
  // summary is then derived from it rather than guessed separately (lib/learnerModel.ts).
  const learner = body.learner && typeof body.learner === "object" ? sanitizeLearnerProfile(body.learner, topic) : undefined;
  const snapshot = isLearnerProfileSnapshot(body.learnerProfile) ? body.learnerProfile : learner ? snapshotFrom(learner) : null;
  if (!snapshot) {
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
      ...snapshot,
      codeExamples: shouldIncludeCodeExamples(snapshot),
      confirmedAt: snapshot.confirmedAt || new Date().toISOString(),
    },
    learner,
    learnerPersona: text(body.learnerPersona, 1_000),
  };

  try {
    const lecture = await createProgressiveLectureSession(auth.userId, input);
    // Every lesson is remembered, whatever the planning conversation did or did not establish.
    await updateLearnerMemory(auth.userId, (memory) => recordLesson(memory, topic, undefined, {
      codeExamples: input.learnerProfile.codeExamples,
      expertise: input.learnerProfile.expertise,
      goal: input.learnerProfile.goal,
    }))
      .catch((error) => console.error("[learner-memory] could not record the lesson:", error));
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

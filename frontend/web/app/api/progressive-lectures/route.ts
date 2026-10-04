import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { blobStorageConfigured } from "@/lib/blobStorage";
import { databaseConfigured } from "@/lib/db/cosmos";
import { normalizeLectureMode, normalizeLectureSourceType } from "@/lib/lectureArchive";
import { dispatchProgressiveTasks, progressiveQueueTransport } from "@/lib/progressiveLectureQueue";
import { createProgressiveLectureSession } from "@/lib/progressiveLectureStore";
import { isLearnerProfileSnapshot, shouldIncludeCodeExamples, type LearnerProfileSnapshot, type ProgressiveLectureInput } from "@/lib/progressiveLectureTypes";
import { sanitizeLearnerProfile } from "@/lib/learnerProfile";
import { recordLesson, snapshotFrom } from "@/lib/learnerModel";
import { updateLearnerMemory } from "@/lib/learnerMemoryStore";
import { learnFromLesson, studentCardFor } from "@/lib/learnerBasicsStore";
import { sanitizeSourceScope } from "@/lib/sourceScope";
import { isProgrammingTopic } from "@/lib/codeSpec";

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
    ...(rawOutline.scope === "question" || rawOutline.scope === "lesson" ? { scope: rawOutline.scope as "question" | "lesson" } : {}),
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
    sourceScope: sanitizeSourceScope(body.sourceScope),
    selection: parseSelection(body.selection),
    learnerProfile: {
      ...snapshot,
      // Words in the request ("quickly", "in depth") beat the saved preference, which beats the
      // profile's own depth. Depth buys words per board, never extra boards.
      depth: requestedDepth(rawOutline?.depth, body.teachingPreference) ?? snapshot.depth,
      // Code for an advanced professional, and for ANY programming topic ("explain for loops") —
      // a programming idea is taught by showing it, whatever the student's level.
      codeExamples: shouldIncludeCodeExamples(snapshot) || isProgrammingTopic(`${topic} ${typeof body.focus === "string" ? body.focus : ""}`),
      confirmedAt: snapshot.confirmedAt || new Date().toISOString(),
    },
    learner,
    learnerPersona: text(body.learnerPersona, 2_000),
  };
  // The student card: their grade, country, curriculum and subjects from the profile, as rules —
  // the grade applies to every subject, the subject list decides whether to follow their syllabus.
  const card = await studentCardFor(auth.userId, `${topic} ${input.focus ?? ""}`).catch(() => null);
  if (card) input.studentCard = card;

  try {
    const lecture = await createProgressiveLectureSession(auth.userId, input);
    // Every lesson is remembered, whatever the planning conversation did or did not establish.
    await updateLearnerMemory(auth.userId, (memory) => recordLesson(memory, topic, undefined, {
      codeExamples: input.learnerProfile.codeExamples,
      expertise: input.learnerProfile.expertise,
      goal: input.learnerProfile.goal,
    }))
      .catch((error) => console.error("[learner-memory] could not record the lesson:", error));
    // The profile learns this subject's level and curriculum from the request ("A-level physics").
    await learnFromLesson(auth.userId, `${topic} ${input.focus ?? ""}`, learner?.background)
      .catch((error) => console.error("[learner-profile] could not learn from the lesson:", error));
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

/** The dragged area the lecture is about, or undefined. Pages must be real page numbers. */
function parseSelection(value: unknown): ProgressiveLectureInput["selection"] {
  if (!value || typeof value !== "object") return undefined;
  const o = value as Record<string, unknown>;
  const pages = Array.isArray(o.pages)
    ? [...new Set(o.pages.map(Number).filter((n) => Number.isInteger(n) && n > 0 && n <= 500))].slice(0, 20)
    : [];
  const transcript = text(o.transcript, 8_000) ?? "";
  if (pages.length === 0 && !transcript) return undefined;
  return { pages, transcript, description: text(o.description, 200) ?? "" };
}

function requestedDepth(outlineDepth: unknown, preference: unknown): LearnerProfileSnapshot["depth"] | undefined {
  if (outlineDepth === "quick") return "concise";
  if (outlineDepth === "deep") return "deep";
  if (preference === "quick") return "concise";
  if (preference === "balanced") return "balanced";
  if (preference === "deep") return "deep";
  return undefined;
}

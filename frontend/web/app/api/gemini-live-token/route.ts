import { NextResponse } from "next/server";
import { buildGeminiLiveInstructions } from "@/lib/geminiLiveContract";
import { buildLessonDesignInstructions } from "@/lib/lessonDesignContract";

const GEMINI_LIVE_MODEL = process.env.GEMINI_LIVE_MODEL ?? "gemini-3.1-flash-live-preview";

export async function POST(request: Request) {
  const apiKey = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "GEMINI_API_KEY is not set. Add it to frontend/web/.env.local to enable Gemini Live." },
      { status: 503 },
    );
  }
  if (process.env.GEMINI_LIVE_ENABLED === "0") {
    return NextResponse.json({ error: "Gemini Live is disabled." }, { status: 404 });
  }

  const body = await request.json().catch(() => ({}));
  const topic = typeof body.topic === "string" ? body.topic.trim().slice(0, 200) : "";
  const beatContext = typeof body.beatContext === "string" ? body.beatContext.trim().slice(0, 4000) : "";
  const lessonContext = typeof body.lessonContext === "string" ? body.lessonContext.trim().slice(0, 20_000) : "";
  /*
   * The student's uploaded document. Capped like the lesson context: a Live session's instruction is
   * fixed for the life of its socket, so anything sent here is carried for the whole conversation.
   */
  const documentContext = typeof body.documentContext === "string" ? body.documentContext.trim().slice(0, 30_000) : "";
  const mood = typeof body.mood === "string" ? body.mood.trim().slice(0, 500) : "";
  const adhdMode = body.adhdMode === true;
  const checkinMode = body.checkinMode === true;
  const examMode = body.examMode === true;
  /**
   * The lesson-DESIGN session: the tutor who keeps the student company while their lesson is being
   * generated. Handled here rather than in the client so every persona in the app is built in one
   * place — the same reason checkinMode and examMode live here.
   */
  const designMode = body.designMode === true;
  const blindMode = body.blindMode === true;
  const sourceKind = ["pdf", "pptx", "pages", "topic"].includes(body.sourceKind) ? body.sourceKind : "topic";
  const studentName = typeof body.studentName === "string" ? body.studentName.trim().slice(0, 80) : "";
  const examQuestions = examMode && Array.isArray(body.examQuestions)
    ? body.examQuestions
        .filter((question: unknown): question is string => typeof question === "string" && question.trim().length > 0)
        .map((question: string) => question.trim().slice(0, 600))
        .slice(0, 12)
    : [];

  /**
   * `newSessionExpireTime` is the window in which the browser must actually OPEN the socket, and
   * it was 60 seconds. That is not enough in practice, which is what made Gemini Live feel
   * unreliable — working on one attempt and failing on the next with no obvious difference.
   *
   * Between minting the token and connecting, the client has to resolve the microphone permission
   * prompt (unbounded — it waits for a human to click), lazy-load the @google/genai chunk on a
   * cold cache, and create an AudioContext. Any one of those can eat a minute on a first run or a
   * slow machine; the token then expires and the connection is refused.
   *
   * Ten minutes is still short-lived — the token is single-use (`uses: 1`) and scoped to one
   * session — but it removes a race that had nothing to do with the student.
   */
  const expireTime = new Date(Date.now() + 30 * 60 * 1000).toISOString();
  const newSessionExpireTime = new Date(Date.now() + 10 * 60 * 1000).toISOString();

  try {
    const response = await fetch("https://generativelanguage.googleapis.com/v1beta/auth_tokens", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify({ uses: 1, expireTime, newSessionExpireTime }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || typeof data.name !== "string") {
      return NextResponse.json(
        { error: data?.error?.message ?? "Could not create a Gemini Live session token." },
        { status: 502 },
      );
    }

    return NextResponse.json(
      {
        token: data.name,
        model: GEMINI_LIVE_MODEL,
        // Design mode replaces the persona entirely; every other session keeps the tutor persona,
        // now including the whole-document context added upstream.
        instructions: designMode
          ? buildLessonDesignInstructions({ topic, sourceKind, mood, blindMode, studentName: studentName || undefined })
          : buildGeminiLiveInstructions({ topic, beatContext, lessonContext, documentContext, mood, adhdMode, checkinMode, examQuestions }),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not create a Gemini Live session token." },
      { status: 502 },
    );
  }
}

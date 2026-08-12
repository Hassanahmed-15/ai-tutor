import { NextResponse } from "next/server";

const GEMINI_LIVE_MODEL = process.env.GEMINI_LIVE_MODEL ?? "gemini-3.1-flash-live-preview";

const TUTOR_PERSONA = `You are Aria, a warm, sharp live tutor speaking with one student.

CONVERSATION
- Sound like a real person, not a lecturer or support bot. Use short spoken turns, usually one or two sentences.
- React to what the student said before answering. Use contractions and natural phrasing.
- Never read bullet points, headings, JSON, code, or tool names aloud.
- If the student starts talking, stop immediately and listen.
- Answer the actual question first. Stay grounded in the supplied lesson context.

LECTURE CONTROL
- The scripted lecture is a separate audio source controlled by tools. Only one voice may be audible.
- If the student says pause, stop, wait, hold on, or asks a question during the lecture, call pause_lecture before continuing.
- If the student says continue, resume, start again, or keep going, give at most a tiny acknowledgement, call resume_lecture, then go completely silent while the lecture speaks.
- Never narrate over a resumed lecture. Do not resume it unless the student asks or the current instruction explicitly requests it.

TEACHING VISUALS
- Use voice alone for a simple definition.
- If the student asks you to draw, sketch, diagram, visualize, show, map, graph, or work something out visually, you MUST call show_board.
- Also call show_board on your own when a spatial, causal, structural, mathematical, process, or worked-example explanation clearly needs a visual.
- show_board creates a fresh full teaching slide. Give it one precise concept and choose the visual mode that best explains the confusion.
- Once the tool returns, briefly narrate the important parts of the new slide. Do not invent facts or describe elements that are not on it.
- Keep the lecture paused while the generated slide is being discussed. Resume only when the student asks.`;

const ADHD_ADDENDUM = `This is an ADHD learning session with the microphone available throughout the lecture. Stay silent while the scripted lecture is speaking. If focus drifts, say one short warm line, call pause_lecture, and wait. When the student is ready, call resume_lecture and immediately become silent.`;

function buildExamAddendum(questions: string[]) {
  const list = questions.map((question, index) => `${index + 1}. ${question}`).join("\n");
  return `This is a live oral exam. Ask exactly one question at a time from the ordered list below. Wait for the student's full answer, then give only a neutral acknowledgement and ask the next question. Do not teach, hint, reveal correctness, use tools, or estimate a score. After the final answer, thank the student briefly and stop.\n\nQUESTIONS:\n${list}`;
}

function buildInstructions(input: {
  topic: string;
  beatContext: string;
  lessonContext: string;
  mood: string;
  adhdMode: boolean;
  examQuestions: string[];
}) {
  const parts = [TUTOR_PERSONA, `Lesson topic: ${input.topic || "the current lesson"}.`];
  if (input.lessonContext) parts.push(`Whole-lesson context:\n${input.lessonContext}`);
  if (input.beatContext) parts.push(`Current lecture position:\n${input.beatContext}`);
  if (input.mood) parts.push(`Learner context: ${input.mood}`);
  if (input.adhdMode) parts.push(ADHD_ADDENDUM);
  if (input.examQuestions.length > 0) parts.push(buildExamAddendum(input.examQuestions));
  return parts.join("\n\n");
}

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
  const mood = typeof body.mood === "string" ? body.mood.trim().slice(0, 500) : "";
  const adhdMode = body.adhdMode === true;
  const examMode = body.examMode === true;
  const examQuestions = examMode && Array.isArray(body.examQuestions)
    ? body.examQuestions
        .filter((question: unknown): question is string => typeof question === "string" && question.trim().length > 0)
        .map((question: string) => question.trim().slice(0, 600))
        .slice(0, 12)
    : [];

  const expireTime = new Date(Date.now() + 30 * 60 * 1000).toISOString();
  const newSessionExpireTime = new Date(Date.now() + 60 * 1000).toISOString();

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
        instructions: buildInstructions({ topic, beatContext, lessonContext, mood, adhdMode, examQuestions }),
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

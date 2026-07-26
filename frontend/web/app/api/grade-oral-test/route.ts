import { NextResponse } from "next/server";
import OpenAI from "openai";
import { GRADE_ANSWER_RUBRIC_INSTRUCTION, type TestQuestion } from "@/lib/testPrompt";
import { sanitizeGradeResults } from "@/lib/testSanitize";

/**
 * Grades a completed oral exam from its FULL transcript, in one post-session model call — the
 * exam persona (see EXAM_ADDENDUM in app/api/realtime-session/route.ts) asks questions in strict
 * order and never reveals correctness live, so grading is a separate pass over the finished
 * conversation rather than parsing the model's live spoken judgment (fragile — natural phrasing
 * varies too much to pattern-match reliably). Uses the SAME rubric-judgment philosophy as written
 * grading (GRADE_ANSWER_RUBRIC_INSTRUCTION) so both modes converge on identical judgment quality.
 */
const MODEL = process.env.OPENAI_TEST_MODEL ?? "gpt-4o";

export async function POST(req: Request) {
  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json({ error: "OPENAI_API_KEY not set." }, { status: 503 });
  }

  const body = await req.json().catch(() => ({}));
  const questions: TestQuestion[] = Array.isArray(body.questions) ? body.questions : [];
  const transcript: Array<{ role: string; text: string }> = Array.isArray(body.transcript)
    ? body.transcript.filter((t: unknown): t is { role: string; text: string } => !!t && typeof t === "object" && typeof (t as Record<string, unknown>).text === "string")
    : [];
  if (questions.length === 0 || transcript.length === 0) {
    return NextResponse.json({ error: "questions and transcript are required" }, { status: 400 });
  }

  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const transcriptText = transcript.map((t) => `${t.role === "you" || t.role === "student" ? "Student" : "Aria"}: ${t.text}`).join("\n");

  try {
    const completion = await client.chat.completions.create({
      model: MODEL,
      messages: [
        {
          role: "system",
          content:
            `You are grading a completed LIVE ORAL EXAM from its transcript. The examiner asked these questions, in this order, and the student answered by voice (the transcript may contain minor transcription errors — judge intent, not exact wording).\n` +
            `Return JSON only: { "results": [{ "id": string, "correct": boolean, "feedback": string }] }\n` +
            `${GRADE_ANSWER_RUBRIC_INSTRUCTION}\nMatch each question to the student's corresponding answer in the transcript by the order the questions were asked. "feedback" is one short sentence explaining the judgment, addressed to the student.`,
        },
        {
          role: "user",
          content: JSON.stringify({
            questions: questions.map((q) => ({ id: q.id, question: q.oralPhrasing || q.prompt, rubric: q.rubric })),
            transcript: transcriptText,
          }),
        },
      ],
      temperature: 0.2,
      max_tokens: 2000,
      response_format: { type: "json_object" },
    });
    const results = sanitizeGradeResults(JSON.parse(completion.choices[0]?.message?.content ?? "{}"), questions.map((q) => q.id));
    const usage = completion.usage;
    const costUsd = usage ? usage.prompt_tokens * (2.5 / 1_000_000) + usage.completion_tokens * (10.0 / 1_000_000) : 0;
    return NextResponse.json({ results, costUsd });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Grading failed" }, { status: 502 });
  }
}

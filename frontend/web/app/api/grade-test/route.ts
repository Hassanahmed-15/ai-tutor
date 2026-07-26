import { NextResponse } from "next/server";
import OpenAI from "openai";
import { GRADE_ANSWER_RUBRIC_INSTRUCTION, type TestQuestion } from "@/lib/testPrompt";
import { sanitizeGradeResults } from "@/lib/testSanitize";

/**
 * Batch grades a written test submission in one model call — every question/answer/rubric
 * triple judged together against a shared rubric-judgment philosophy (GRADE_ANSWER_RUBRIC_
 * INSTRUCTION), reused verbatim by the oral grading route so both modes score identically.
 * This is a genuine rubric judgment, not the app's existing lightweight keyword-set matching
 * used for mid-lecture checkpoints — the test questions are explicitly hard/open-ended.
 */
const MODEL = process.env.OPENAI_TEST_MODEL ?? "gpt-4o";

export async function POST(req: Request) {
  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json({ error: "OPENAI_API_KEY not set." }, { status: 503 });
  }

  const body = await req.json().catch(() => ({}));
  const questions: TestQuestion[] = Array.isArray(body.questions) ? body.questions : [];
  const answers: Record<string, string> = body.answers && typeof body.answers === "object" ? body.answers : {};
  if (questions.length === 0) {
    return NextResponse.json({ error: "questions are required" }, { status: 400 });
  }

  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const pairs = questions.map((q) => ({
    id: q.id,
    question: q.prompt,
    rubric: q.rubric,
    studentAnswer: typeof answers[q.id] === "string" ? answers[q.id].trim().slice(0, 1000) : "",
  }));

  try {
    const completion = await client.chat.completions.create({
      model: MODEL,
      messages: [
        {
          role: "system",
          content:
            `You are grading a hard short-answer test. Return JSON only: { "results": [{ "id": string, "correct": boolean, "feedback": string }] }\n` +
            `${GRADE_ANSWER_RUBRIC_INSTRUCTION}\n"feedback" is one short sentence explaining the judgment, addressed to the student.`,
        },
        { role: "user", content: JSON.stringify({ pairs }) },
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

import { NextResponse } from "next/server";
import { GRADE_ANSWER_RUBRIC_INSTRUCTION, GRADE_FEEDBACK_INSTRUCTION, MARK_SCHEME_INSTRUCTION, type TestQuestion } from "@/lib/testPrompt";
import { sanitizeGradeResults } from "@/lib/testSanitize";
import { createOpenAI } from "@/lib/openaiClient";
import { proofread } from "@/lib/text/proofread";

/**
 * Batch grades a written test submission in one model call — every question/answer/rubric
 * triple judged together against a shared rubric-judgment philosophy (GRADE_ANSWER_RUBRIC_
 * INSTRUCTION), reused verbatim by the oral grading route so both modes score identically.
 * This is a genuine rubric judgment, not the app's existing lightweight keyword-set matching
 * used for mid-lecture checkpoints — the test questions are explicitly hard/open-ended.
 */
const MODEL = process.env.OPENAI_TEST_MODEL ?? "gpt-5.6-luna";

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

  const client = createOpenAI({ apiKey: process.env.OPENAI_API_KEY });
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
            `You are grading a hard short-answer test. Return JSON only: { "results": [{ "id": string, "status": "correct" | "partial" | "misconception", "pointsEarned": number, "awarded": boolean[], "missingKeyPoints": string[], "misconception": string|null, "feedback": string }] }\nAward one point per rubric key point actually required by the question. "partial" means the accurate core is present but one or more explicitly requested key points are missing; report only those in missingKeyPoints. Optional enrichment is not a missing point. "misconception" means a specific factual error or contradictory model; name it in misconception and award zero for the contradicted point.\n` +
            `${GRADE_ANSWER_RUBRIC_INSTRUCTION}\n${MARK_SCHEME_INSTRUCTION}\n${GRADE_FEEDBACK_INSTRUCTION}`,
        },
        { role: "user", content: JSON.stringify({ pairs }) },
      ],
      temperature: 0.2,
      max_tokens: 2000,
      response_format: { type: "json_object" },
    });
    const results = sanitizeGradeResults(JSON.parse(completion.choices[0]?.message?.content ?? "{}"), questions.map((q) => q.id), questions, Object.fromEntries(pairs.map((p) => [p.id, p.studentAnswer])));
    const usage = completion.usage;
    let costUsd = usage ? usage.prompt_tokens * (2.5 / 1_000_000) + usage.completion_tokens * (10.0 / 1_000_000) : 0;
    // SPELLING AND WRONG WORDS (lib/text/proofread.ts; owner QA brief 2026-11-28): the feedback the student reads is
    // proofread once, at most 8 s; a correction is taken only when it is a proofreading change.
    const texts: Record<string, string> = {};
    for (const r of results) {
      if (r.feedback) texts[`${r.id}::feedback`] = r.feedback;
      if (r.misconception) texts[`${r.id}::misconception`] = r.misconception;
    }
    const checked = await Promise.race([
      proofread(async (system, user) => {
        const res = await client.chat.completions.create({ model: MODEL, messages: [{ role: "system", content: system }, { role: "user", content: user }], response_format: { type: "json_object" } });
        const u = res.usage;
        if (u) costUsd += u.prompt_tokens * (2.5 / 1_000_000) + u.completion_tokens * (10.0 / 1_000_000);
        return JSON.parse(res.choices[0]?.message?.content ?? "{}");
      }, texts),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 8_000)),
    ]);
    if (checked?.changed.length) {
      for (const c of checked.changed) console.info(`[grade-test] proofread: "${c.from}" -> "${c.to}"`);
      for (const r of results) {
        r.feedback = checked.texts[`${r.id}::feedback`] ?? r.feedback;
        if (r.misconception) r.misconception = checked.texts[`${r.id}::misconception`] ?? r.misconception;
      }
    }
    return NextResponse.json({ results, costUsd });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Grading failed" }, { status: 502 });
  }
}

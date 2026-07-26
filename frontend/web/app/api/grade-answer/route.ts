import { NextResponse } from "next/server";
import OpenAI from "openai";

/**
 * Grades a spoken answer to a question the TEACHER asked mid-lecture.
 *
 * Checkpoint beats carry `acceptableKeywords` and are graded locally by `checkAnswer` — free and
 * instant. This endpoint exists for the questions the teacher improvises when engagement dips, which
 * have no keyword list, so correctness needs an actual reading of what the student said.
 *
 * Deliberately generous: the student is speaking off the cuff and the transcript is imperfect. We
 * are checking whether the idea is there, not whether they recited the script.
 *
 * Honesty: costs one short gpt-4o-mini call per answer (~$0.0001).
 * Needs OPENAI_API_KEY in frontend/web/.env.local.
 */
const MODEL = process.env.OPENAI_GRADE_MODEL ?? "gpt-4o-mini";

const SYSTEM_PROMPT = `You are a warm, encouraging teacher checking whether a student understood what you just taught.

You are given the QUESTION you asked, the SOURCE MATERIAL you taught it from, and the student's SPOKEN answer (an imperfect speech-to-text transcript).

Grade generously and by MEANING:
- Correct if the student conveys the core idea, even in loose or informal words, even partially, even with wrong terminology — as long as the concept is right.
- Correct if the question merely asked whether they are following and they say yes / they get it.
- Incorrect only if the answer is clearly wrong, contradicts the material, is a plain "no"/"I don't understand"/"I'm lost", or is empty or unrelated.
- Do NOT penalise short answers, filler words, grammar, or transcription noise.

Reply with JSON only: {"correct": boolean, "feedback": string}
"feedback" is ONE short sentence, spoken aloud in your own voice, directly to the student ("you").
- If correct: confirm warmly and add the key point in a few words.
- If incorrect: stay kind, never say "wrong", and name the specific idea to revisit.`;

export async function POST(req: Request) {
  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json({ error: "OPENAI_API_KEY not set." }, { status: 503 });
  }

  const body = await req.json().catch(() => ({}));
  const question = typeof body.question === "string" ? body.question.trim() : "";
  const expected = typeof body.expected === "string" ? body.expected.trim() : "";
  const answer = typeof body.answer === "string" ? body.answer.trim() : "";
  if (!question) return NextResponse.json({ error: "question is required" }, { status: 400 });

  // Nothing said at all — no need to spend a call to know that isn't an answer.
  if (!answer) {
    return NextResponse.json({ correct: false, feedback: "I didn't catch an answer there — let's go over it again." });
  }

  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const userMsg =
    `QUESTION I asked: "${question}"\n\n` +
    (expected ? `SOURCE MATERIAL I taught it from: "${expected}"\n\n` : "") +
    `Student's spoken answer: "${answer}"`;

  try {
    const completion = await client.chat.completions.create({
      model: MODEL,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userMsg },
      ],
      temperature: 0.2,
      response_format: { type: "json_object" },
    });
    const parsed = JSON.parse(completion.choices[0]?.message?.content ?? "{}");
    return NextResponse.json({
      correct: parsed.correct === true,
      feedback:
        typeof parsed.feedback === "string" && parsed.feedback.trim()
          ? parsed.feedback.trim()
          : parsed.correct === true
            ? "That's it — nicely done."
            : "Let's take another look at that one.",
    });
  } catch (err) {
    // Never block the lesson on a grading failure: treat it as understood and keep teaching.
    console.error("[grade-answer]", err instanceof Error ? err.message : err);
    return NextResponse.json({ correct: true, feedback: "Good — let's keep going." });
  }
}

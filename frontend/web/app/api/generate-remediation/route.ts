import { NextResponse } from "next/server";
import OpenAI from "openai";
import { REMEDIATION_SYSTEM_PROMPT, type TestQuestion } from "@/lib/testPrompt";
import { sanitizeBeat } from "@/lib/drawSanitize";
import { fillImageOps } from "@/lib/imageGen";
import { fillBlackboardOps } from "@/lib/blackboardGen";
import type { Beat } from "@/lib/lessonContent";

/**
 * "Explain this again" — a short, targeted 1-3 beat remediation mini-lesson grounded in ONE
 * specific missed test question and the student's actual wrong answer, not a generic re-teach
 * of the whole topic. Reuses sanitizeBeat (the per-beat validator drawSanitize.ts already uses
 * internally for full lectures) directly, since a 1-3 beat remediation must NOT be subject to
 * sanitizeDrawLecture's whole-lecture 9-beat minimum. Small enough to fill assets and return
 * synchronously — no NDJSON streaming needed for 1-3 beats.
 *
 * Honesty: one gpt-4o call for the beat text, plus optional image/blackboard generation calls
 * (same kill switches as generate-lecture) — much cheaper than a full lecture since it's at
 * most 3 beats. Needs OPENAI_API_KEY in frontend/web/.env.local.
 */
const MODEL = process.env.OPENAI_LECTURE_MODEL ?? "gpt-4o";
const IMAGE_GENERATION_ENABLED = process.env.IMAGE_GENERATION_ENABLED === "1";
const BLACKBOARD_GEN_ENABLED = process.env.BLACKBOARD_GEN_ENABLED === "1";

export async function POST(req: Request) {
  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json({ error: "OPENAI_API_KEY not set." }, { status: 503 });
  }

  const body = await req.json().catch(() => ({}));
  const topic = typeof body.topic === "string" ? body.topic.trim().slice(0, 200) : "";
  const question: TestQuestion | null = body.question && typeof body.question === "object" ? body.question : null;
  const studentAnswer = typeof body.studentAnswer === "string" ? body.studentAnswer.trim().slice(0, 1000) : "";
  if (!topic || !question || !question.prompt) {
    return NextResponse.json({ error: "topic and question are required" }, { status: 400 });
  }

  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const userMsg = JSON.stringify({
    topic,
    question: question.prompt,
    studentAnswer: studentAnswer || "(no answer given)",
    rubric: question.rubric,
  });

  try {
    const completion = await client.chat.completions.create({
      model: MODEL,
      messages: [
        { role: "system", content: REMEDIATION_SYSTEM_PROMPT },
        { role: "user", content: userMsg },
      ],
      temperature: 0.5,
      max_tokens: 3000,
      response_format: { type: "json_object" },
    });
    const raw = JSON.parse(completion.choices[0]?.message?.content ?? "{}");
    const rawBeats: unknown[] = Array.isArray(raw.beats) ? raw.beats : [];
    const beats: Beat[] = rawBeats.map((b, i) => sanitizeBeat(b, i)).filter((b): b is Beat => b !== null);
    if (beats.length === 0) {
      return NextResponse.json({ error: "Could not generate a remediation lesson for this question." }, { status: 502 });
    }

    let assetCostUsd = 0;
    if (IMAGE_GENERATION_ENABLED) assetCostUsd += await fillImageOps(client, beats);
    if (BLACKBOARD_GEN_ENABLED) assetCostUsd += (await fillBlackboardOps(client, beats)).costUsd;

    const usage = completion.usage;
    const textCostUsd = usage ? usage.prompt_tokens * (2.5 / 1_000_000) + usage.completion_tokens * (10.0 / 1_000_000) : 0;
    return NextResponse.json({ beats, costUsd: textCostUsd + assetCostUsd });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Remediation generation failed" }, { status: 502 });
  }
}

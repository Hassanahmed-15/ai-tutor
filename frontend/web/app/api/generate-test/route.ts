import { NextResponse } from "next/server";
import OpenAI from "openai";
import { GENERATE_TEST_SYSTEM_PROMPT } from "@/lib/testPrompt";
import { sanitizeTestBank } from "@/lib/testSanitize";
import type { Beat } from "@/lib/lessonContent";

/**
 * Generates a hard, genuine short-answer test bank from a finished lecture's final beats —
 * called once when the student requests a test (not eagerly during lecture generation), so a
 * lecture the student never tests stays free. Both written and oral test modes draw from this
 * same bank (see lib/testPrompt.ts).
 *
 * Honesty: one gpt-4o call, beats compacted to text only (no images re-sent) — same cost class
 * as a single explain/route.ts call. Needs OPENAI_API_KEY in frontend/web/.env.local.
 */
const MODEL = process.env.OPENAI_TEST_MODEL ?? "gpt-4o";
const ATTEMPTS = 2;

function compactBeatsForTest(beats: Beat[]) {
  return beats
    .filter((b) => b.slideKind !== "checkpoint")
    .map((b) => ({ id: b.id, title: b.title, points: b.points, script: b.script }));
}

export async function POST(req: Request) {
  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json({ error: "OPENAI_API_KEY not set." }, { status: 503 });
  }

  const body = await req.json().catch(() => ({}));
  const topic = typeof body.topic === "string" ? body.topic.trim().slice(0, 200) : "";
  const beats: Beat[] = Array.isArray(body.beats) ? body.beats : [];
  if (!topic || beats.length === 0) {
    return NextResponse.json({ error: "topic and beats are required" }, { status: 400 });
  }

  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const userMsg = `Lecture topic: "${topic}"\nBeats taught (use these ids as beatId):\n${JSON.stringify(compactBeatsForTest(beats))}\n\nWrite the test now.`;

  let lastError = "Could not generate a test for this lecture.";
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    try {
      const completion = await client.chat.completions.create({
        model: MODEL,
        messages: [
          { role: "system", content: GENERATE_TEST_SYSTEM_PROMPT },
          { role: "user", content: userMsg },
        ],
        temperature: 0.6,
        max_tokens: 2500,
        response_format: { type: "json_object" },
      });
      const bank = sanitizeTestBank(JSON.parse(completion.choices[0]?.message?.content ?? "{}"), topic);
      if (bank.questions.length === 0) throw new Error("The model did not return usable questions.");

      const usage = completion.usage;
      const costUsd = usage ? usage.prompt_tokens * (2.5 / 1_000_000) + usage.completion_tokens * (10.0 / 1_000_000) : 0;
      return NextResponse.json({ ...bank, costUsd });
    } catch (err) {
      lastError = err instanceof Error ? err.message : "Test generation failed";
    }
  }
  return NextResponse.json({ error: lastError }, { status: 502 });
}

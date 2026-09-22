import { NextResponse } from "next/server";
import OpenAI from "openai";
import { createCostMeter } from "@/lib/costMeter";
import {
  LECTURE_SUMMARY_SYSTEM_PROMPT,
  parseLectureSummary,
  summaryTranscript,
  type SummaryBeatInput,
} from "@/lib/lectureSummary";

/**
 * The one-slide summary of a finished lecture (lib/lectureSummary.ts).
 *
 * The client only offers this once the lecture has been watched to the end; the route itself is
 * stateless and summarizes exactly the beats it is sent.
 */
const MODEL = process.env.OPENAI_SUMMARY_MODEL ?? process.env.OPENAI_EXPLAIN_MODEL ?? "gpt-4o";

export async function POST(req: Request) {
  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json({ error: "OPENAI_API_KEY not set." }, { status: 503 });
  }
  const body = await req.json().catch(() => ({}));
  const topic = typeof body.topic === "string" ? body.topic.trim().slice(0, 200) : "";
  const request = typeof body.request === "string" ? body.request.trim().slice(0, 300) : "";
  const beats: SummaryBeatInput[] = Array.isArray(body.beats)
    ? body.beats
        .filter((b: unknown): b is Record<string, unknown> => Boolean(b) && typeof b === "object")
        .map((b: Record<string, unknown>) => ({
          title: typeof b.title === "string" ? b.title : "",
          script: typeof b.script === "string" ? b.script : "",
          points: Array.isArray(b.points) ? b.points.filter((p): p is string => typeof p === "string") : [],
        }))
        .slice(0, 30)
    : [];
  const transcript = summaryTranscript(beats);
  if (!transcript) return NextResponse.json({ error: "beats are required" }, { status: 400 });

  const meter = createCostMeter();
  const client = meter.wrap(new OpenAI({ apiKey: process.env.OPENAI_API_KEY }));
  const userMsg = [
    `Lecture subject: "${topic || "this lecture"}".`,
    request ? `What the student originally asked: "${request}".` : "",
    "The lecture, beat by beat:",
    transcript,
  ].filter(Boolean).join("\n\n");

  let issue = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const completion = await client.chat.completions.create({
        model: MODEL,
        temperature: 0.3,
        max_tokens: 700,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: LECTURE_SUMMARY_SYSTEM_PROMPT },
          { role: "user", content: issue ? `${userMsg}\n\nYour previous answer was rejected: ${issue}. Fix exactly that.` : userMsg },
        ],
      });
      const parsed = parseLectureSummary(JSON.parse(completion.choices[0]?.message?.content ?? "{}"), topic || "Lecture summary");
      if (parsed.summary) return NextResponse.json({ summary: parsed.summary, costUsd: meter.totalUsd });
      issue = parsed.issue ?? "unusable summary";
    } catch (err) {
      issue = err instanceof Error ? err.message : "summary call failed";
    }
  }
  return NextResponse.json({ error: `Couldn't summarize the lecture: ${issue}`, costUsd: meter.totalUsd }, { status: 502 });
}

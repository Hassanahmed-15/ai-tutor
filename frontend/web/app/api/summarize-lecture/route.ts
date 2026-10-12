import { NextResponse } from "next/server";
import OpenAI from "openai";
import { createCostMeter } from "@/lib/costMeter";
import {
  LECTURE_SUMMARY_STRICT_RULES,
  LECTURE_SUMMARY_SYSTEM_PROMPT,
  groundLectureSummary,
  parseLectureSummary,
  summaryTranscript,
  type LectureSummary,
  type SummaryBeatInput,
} from "@/lib/lectureSummary";
import { sanitizeSourceScope } from "@/lib/sourceScope";

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
  /*
   * STRICT SOURCE. A strict lecture's summary is written against the document's own text (the blocks
   * its beats taught, sent by the client), not only against the scripts — a script that leaked would
   * otherwise be summarized as the lesson's crux. Reference mode sends no source and is unchanged.
   */
  const sourceScope = sanitizeSourceScope(body.sourceScope);
  const source = typeof body.source === "string" ? body.source.trim().slice(0, 16_000) : "";
  const strict = sourceScope?.fidelity === "strict" && Boolean(source);

  const meter = createCostMeter();
  const client = meter.wrap(new OpenAI({ apiKey: process.env.OPENAI_API_KEY }));
  const userMsg = [
    `Lecture subject: "${topic || "this lecture"}".`,
    request ? `What the student originally asked: "${request}".` : "",
    "The lecture, beat by beat:",
    transcript,
    strict ? `SOURCE — the student's own document, the text this lecture was taught from. The summary may state only what SOURCE states:\n${source}` : "",
  ].filter(Boolean).join("\n\n");

  let issue = "";
  // Strict: the best faithful summary seen so far, used when the second attempt still misses.
  let groundedFallback: LectureSummary | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const completion = await client.chat.completions.create({
        model: MODEL,
        temperature: strict ? 0.2 : 0.3,
        // Room for each point's slide number on top of the summary itself.
        max_tokens: 800,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: strict ? `${LECTURE_SUMMARY_SYSTEM_PROMPT}\n\n${LECTURE_SUMMARY_STRICT_RULES}` : LECTURE_SUMMARY_SYSTEM_PROMPT },
          { role: "user", content: issue ? `${userMsg}\n\nYour previous answer was rejected: ${issue}. Fix exactly that.` : userMsg },
        ],
      });
      const parsed = parseLectureSummary(JSON.parse(completion.choices[0]?.message?.content ?? "{}"), topic || "Lecture summary", beats.length);
      if (parsed.summary && strict) {
        const grounded = groundLectureSummary(parsed.summary, source, topic || "Lecture summary");
        if (grounded.summary && !grounded.issue) return NextResponse.json({ summary: grounded.summary, costUsd: meter.totalUsd });
        groundedFallback = grounded.summary ?? groundedFallback;
        issue = grounded.issue ?? "unusable summary";
        continue;
      }
      if (parsed.summary) return NextResponse.json({ summary: parsed.summary, costUsd: meter.totalUsd });
      issue = parsed.issue ?? "unusable summary";
    } catch (err) {
      issue = err instanceof Error ? err.message : "summary call failed";
    }
  }
  if (groundedFallback) return NextResponse.json({ summary: groundedFallback, costUsd: meter.totalUsd });
  return NextResponse.json({ error: `Couldn't summarize the lecture: ${issue}`, costUsd: meter.totalUsd }, { status: 502 });
}

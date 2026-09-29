import { NextResponse } from "next/server";
import OpenAI from "openai";
import { createCostMeter } from "@/lib/costMeter";

/**
 * ANSWER ON THE SLIDE THAT TAUGHT IT (lib/revisit.ts).
 *
 * The student asked about something an earlier slide already taught. That slide is back on screen;
 * this returns what Aria says over it, which of the words or parts on its board her pen rings, and
 * one short note the pen writes on it. The answer is drawn from what that slide taught — its title,
 * its narration and what its board shows — so it neither repeats the whole slide nor invents a new
 * one. Luna: a short, well-specified task, and the lecture is paused while it runs.
 */
const MODEL = process.env.OPENAI_REVISIT_MODEL ?? "gpt-5.6-luna";

const SYSTEM = `You are Aria, a warm, clear teacher. The student asked a question about something an EARLIER slide of this lecture already taught, and that slide is back on screen in front of them. Answer them ON that slide. Return JSON only:
{"script": string, "marks": [string], "note": string}

- "script": what you say, 2 to 4 short spoken sentences. Open by telling them where this was covered, naturally ("We covered this on slide 2 — let's look at it again."). Then answer their exact question from what the slide taught, pointing at what is on its board ("see the stroma here, around the stacks"). End by inviting them to say continue when they're ready. No lists, no markdown.
- "marks": up to 3 of the BOARD WORDS given (copied exactly) that your answer points at — the pen rings them. [] if none fits.
- "note": ONE short note the pen writes on the slide to answer the question — at most 5 words and 28 characters, a phrase not a sentence, no full stop ("fluid around the grana", "CO₂ fixed here"). It must not repeat a board word verbatim.
- Stay inside what the slide taught. If the slide does not answer the question, say briefly what it does show and answer from that; never invent facts beyond it.`;

export async function POST(req: Request) {
  if (!process.env.OPENAI_API_KEY) return NextResponse.json({ error: "OPENAI_API_KEY not set." }, { status: 503 });
  const body = await req.json().catch(() => ({}));
  const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
  const question = str(body.question, 500);
  const slideNumber = Number.isFinite(Number(body.slideNumber)) ? Math.max(1, Math.round(Number(body.slideNumber))) : 1;
  const slideTitle = str(body.slideTitle, 200);
  const slideScript = str(body.slideScript, 3000);
  const topic = str(body.topic, 200);
  const boardWords: string[] = Array.isArray(body.boardWords)
    ? body.boardWords.filter((w: unknown): w is string => typeof w === "string" && w.trim().length > 0).map((w: string) => w.trim().slice(0, 80)).slice(0, 40)
    : [];
  if (!question) return NextResponse.json({ error: "question is required" }, { status: 400 });

  const meter = createCostMeter();
  const client = meter.wrap(new OpenAI({ apiKey: process.env.OPENAI_API_KEY }));
  try {
    const res = await client.chat.completions.create({
      model: MODEL,
      response_format: { type: "json_object" },
      max_completion_tokens: 2500,
      reasoning_effort: "low",
      messages: [
        { role: "system", content: SYSTEM },
        {
          role: "user",
          content: `Lecture: ${topic || "this subject"}\nThe slide back on screen: slide ${slideNumber}, "${slideTitle}"\nWhat that slide said:\n${slideScript}\nBOARD WORDS (what is written or pictured on it): ${boardWords.join(" | ") || "(none)"}\n\nThe student's question: ${question}`,
        },
      ],
    } as OpenAI.Chat.ChatCompletionCreateParamsNonStreaming);
    const raw = JSON.parse(res.choices[0]?.message?.content ?? "{}") as { script?: unknown; marks?: unknown; note?: unknown };
    const script = str(raw.script, 900);
    if (!script) throw new Error("no answer");
    const known = new Map(boardWords.map((w) => [w.toLowerCase(), w]));
    const marks = (Array.isArray(raw.marks) ? raw.marks : [])
      .map((m) => (typeof m === "string" ? known.get(m.trim().toLowerCase()) : undefined))
      .filter((m, i, all): m is string => Boolean(m) && all.indexOf(m) === i)
      .slice(0, 3);
    const note = str(raw.note, 40).replace(/\.$/, "");
    return NextResponse.json({ script, marks, note, costUsd: meter.totalUsd });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "revisit failed", costUsd: meter.totalUsd }, { status: 502 });
  }
}

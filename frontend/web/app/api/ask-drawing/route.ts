import { NextResponse } from "next/server";
import OpenAI from "openai";
import { EXPLAIN_SYSTEM_PROMPT } from "@/lib/drawPrompt";
import { sanitizeExplanation } from "@/lib/drawSanitize";

/**
 * "Ask about my drawing" — the student sketches on the board (components/sketch/DrawOverlay.tsx)
 * and Aria LOOKS at it with GPT-4o vision, then answers about what they actually drew and draws a
 * fresh board back. Returns the same `{ script, draw }` shape as /api/explain, so the client can
 * render it through the existing liveBoard → <ExplainOverlay> path with no new display code.
 */

const MODEL = process.env.OPENAI_VISION_MODEL ?? "gpt-4o";
const MAX_TOKENS = 1_600;

export async function POST(req: Request) {
  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json({ error: "OPENAI_API_KEY not set." }, { status: 503 });
  }
  const body = await req.json().catch(() => ({}));
  const image = typeof body.image === "string" ? body.image : "";
  const topic = typeof body.topic === "string" ? body.topic.trim() : "";
  const beatContext = typeof body.beatContext === "string" ? body.beatContext.trim().slice(0, 2000) : "";
  const question = typeof body.question === "string" && body.question.trim()
    ? body.question.trim()
    : "Look at what I drew on the board and tell me about it.";

  if (!image.startsWith("data:image")) {
    return NextResponse.json({ error: "image (data URI) is required" }, { status: 400 });
  }

  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  // DESCRIBE-ONLY: just read the sketch and return what's on it, so the caller can feed it into the
  // live tutor's context. No answer, no board — the student then simply ASKS Aria out loud and she
  // already knows what they drew.
  if (body.describeOnly === true) {
    try {
      const completion = await client.chat.completions.create({
        model: MODEL,
        messages: [
          {
            role: "system",
            content:
              "Describe ONLY what is drawn/written in this student's sketch, in 1-2 plain sentences. " +
              "Name the concrete marks (a circled term, an arrow between two things, a written equation " +
              "or step, a shape or graph they attempted) and quote any legible text exactly. Do not " +
              "explain, teach, judge, or invent anything that isn't visibly there. If it's blank or " +
              "unreadable, reply exactly: NOTHING.",
          },
          {
            role: "user",
            content: [
              { type: "text", text: `Context: the lesson is on "${topic || "this topic"}".` },
              { type: "image_url", image_url: { url: image, detail: "low" } },
            ],
          },
        ],
        temperature: 0.2,
        max_tokens: 220,
      });
      const description = completion.choices[0]?.message?.content?.trim() ?? "";
      return NextResponse.json({ description: /^NOTHING/i.test(description) ? "" : description });
    } catch (err) {
      console.error(`[ask-drawing] describe failed: ${err instanceof Error ? err.message : "error"}`);
      return NextResponse.json({ description: "" });
    }
  }

  try {
    const completion = await client.chat.completions.create({
      model: MODEL,
      messages: [
        { role: "system", content: EXPLAIN_SYSTEM_PROMPT },
        {
          role: "user",
          content: [
            {
              type: "text",
              text:
                `Topic: "${topic || "this lesson"}".\n` +
                (beatContext ? `We are on this part of the lesson: "${beatContext}".\n` : "") +
                `The student drew the attached image ON the board. ${question}\n\n` +
                "FIRST read their drawing carefully and describe back what they actually drew (name the " +
                "specific marks — a circled term, an arrow, their attempt at a diagram, a written step). " +
                "If it shows a misunderstanding, say kindly what's off and correct it. If it's right, " +
                "confirm and build on it. Then draw ONE clean board that answers them. Ground everything " +
                "in what is genuinely visible in the image — never invent marks that aren't there.",
            },
            { type: "image_url", image_url: { url: image, detail: "high" } },
          ],
        },
      ],
      temperature: 0.6,
      max_tokens: MAX_TOKENS,
      response_format: { type: "json_object" },
    });

    const raw = completion.choices[0]?.message?.content ?? "";
    const result = sanitizeExplanation(JSON.parse(raw), { question });
    return NextResponse.json(result);
  } catch (err) {
    console.error(`[ask-drawing] failed: ${err instanceof Error ? err.message : "error"}`);
    return NextResponse.json({ error: "Couldn't read that drawing. Try again." }, { status: 502 });
  }
}

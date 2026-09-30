import { NextResponse } from "next/server";
import OpenAI from "openai";
import { costFor } from "@/lib/modelPricing";
import { canvasUser } from "../access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MODEL = process.env.CANVAS_CHECK_MODEL ?? "gpt-5.6-luna";

/**
 * "Draw it, and Aria checks it."
 *
 * The client sends a SCHEMATIC of the board (each element's box and name, the picture if there is
 * one) with the student's strokes in red on top, plus the list of element ids and their boxes. The
 * model judges the drawing against what a correct one shows and answers in the board's own terms:
 * corrections name element ids, so they are drawn by the board's pen exactly where they belong,
 * never at coordinates a vision model guessed.
 */
export type DrawingCheck = {
  correct: boolean;
  feedback: string;
  marks: Array<
    | { kind: "arrow"; from: string; to: string; label?: string }
    | { kind: "circle"; target: string; label?: string }
  >;
};

export async function POST(request: Request) {
  const who = await canvasUser();
  if ("error" in who) return NextResponse.json({ error: who.error }, { status: who.status });
  if (!process.env.OPENAI_API_KEY) return NextResponse.json({ error: "OPENAI_API_KEY is not set" }, { status: 500 });
  const body = (await request.json().catch(() => ({}))) as {
    image?: string;
    prompt?: string;
    expect?: string;
    topic?: string;
    elements?: Array<{ id: string; label: string; x: number; y: number; w: number; h: number }>;
  };
  if (!body.image?.startsWith("data:image/") || body.image.length > 2_000_000 || !body.prompt || !body.expect) {
    return NextResponse.json({ error: "image, prompt and expect are required" }, { status: 400 });
  }
  const elements = (body.elements ?? []).slice(0, 40);
  const ids = new Set(elements.map((e) => e.id));
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const res = await openai.chat.completions.create({
    model: MODEL,
    response_format: { type: "json_object" },
    max_completion_tokens: 3000,
    reasoning_effort: "low",
    messages: [
      {
        role: "system",
        content: `You are Aria, a warm, precise teacher checking a student's drawing on a lesson board. The image is a 1000 x 560 schematic of the board: grey boxes are the board's elements, each with its name; the RED strokes are what the student drew. Judge ONLY the red strokes against what a correct drawing shows. Be generous about neatness and exact placement — judge the idea (which things are connected, which way arrows point, what is circled). Return JSON only:
{"correct": boolean, "feedback": string, "marks": [{"kind": "arrow", "from": id, "to": id, "label": string} | {"kind": "circle", "target": id, "label": string}]}
- "feedback": 1 to 3 short spoken sentences to the student: first what they got right (specifically), then what is missing or wrong and why. No "Great job!" filler when it is wrong.
- "marks": the corrections Aria draws on the board, in her own colour: arrows or circles the correct answer needs that the student did NOT draw correctly. Empty when the drawing is correct. Each "label" is at most 3 words ("water out", "missing"). Use only these element ids: ${[...ids].join(", ")}.`,
      },
      {
        role: "user",
        content: [
          { type: "text", text: `Lesson: ${body.topic ?? ""}\nThe task was: ${body.prompt}\nA correct drawing shows: ${body.expect}\nElements (id: name, box):\n${elements.map((e) => `${e.id}: ${e.label} (${Math.round(e.x)},${Math.round(e.y)} ${Math.round(e.w)}x${Math.round(e.h)})`).join("\n")}` },
          { type: "image_url", image_url: { url: body.image } },
        ],
      },
    ],
  } as OpenAI.Chat.ChatCompletionCreateParamsNonStreaming);
  const cost = costFor(MODEL, res.usage);
  try {
    const raw = JSON.parse(res.choices[0]?.message?.content ?? "{}") as Partial<DrawingCheck>;
    const marks = (Array.isArray(raw.marks) ? raw.marks : [])
      .filter((m): m is DrawingCheck["marks"][number] =>
        Boolean(m) && ((m.kind === "arrow" && ids.has(m.from) && ids.has(m.to)) || (m.kind === "circle" && ids.has(m.target))),
      )
      .slice(0, 4)
      .map((m) => (m.label ? { ...m, label: m.label.split(/\s+/).slice(0, 3).join(" ").slice(0, 24) } : m));
    const check: DrawingCheck = { correct: raw.correct === true, feedback: String(raw.feedback ?? "").slice(0, 400), marks };
    console.log(`[canvas-check] correct=${check.correct} marks=${marks.length} $${cost.toFixed(4)}`);
    return NextResponse.json(check);
  } catch {
    return NextResponse.json({ correct: false, feedback: "I couldn't quite read that drawing — try drawing it once more.", marks: [] });
  }
}

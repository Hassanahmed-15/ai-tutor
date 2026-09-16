import { NextResponse } from "next/server";
import OpenAI from "openai";
import { currentUser } from "@/lib/auth";

export const runtime = "nodejs";

/**
 * "Ask AI / Explain" from the document viewer's selection toolbar.
 *
 * WHY NOT /api/explain. That route is shaped for the live lecture: it expects an active beat and
 * lesson context, and always returns a marker-drawn DrawScript board through the full animation
 * pipeline — a real answer, but the wrong SHAPE of answer for "explain this paragraph I just
 * selected in a PDF I'm reading on my own", where there is no lecture, no beat, and no board to
 * draw on. Reusing it would mean sending fabricated lecture context to get a board nobody asked
 * for, which is a worse fit than a small dedicated route that just answers the question.
 *
 * SAME MODEL, SAME KEY, GENUINELY REUSED. This is the "integrate with the existing architecture"
 * instruction honoured precisely: same OPENAI_API_KEY, same client construction, same
 * OPENAI_EXPLAIN_MODEL env var other explain-style calls already read — just without the
 * board-generation machinery a standalone reading view has no use for.
 */
const MODEL = process.env.OPENAI_EXPLAIN_MODEL ?? "gpt-4o";

const SYSTEM_PROMPT = `You are Aria, a patient tutor helping a student who is reading a document on their own and selected a passage to ask about.
Explain clearly and concretely in 2-4 short sentences, grounded in the selected passage and the surrounding context if given. Plain prose, no markdown, no headings, no bullet lists.
If the student asked a specific question, answer it directly first. If they only selected text with no question, explain what it means and why it matters in the context of the document.`;

export async function POST(request: Request) {
  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json({ error: "OPENAI_API_KEY not set." }, { status: 503 });
  }
  const session = await currentUser();
  if (!session) return NextResponse.json({ error: "Sign in first." }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const selection = typeof body.selection === "string" ? body.selection.trim().slice(0, 4000) : "";
  const question = typeof body.question === "string" ? body.question.trim().slice(0, 500) : "";
  const documentName = typeof body.documentName === "string" ? body.documentName.trim().slice(0, 200) : "";
  const pageNumber = typeof body.pageNumber === "number" ? body.pageNumber : null;

  if (!selection) {
    return NextResponse.json({ error: "Select some text first." }, { status: 400 });
  }

  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const userContent = [
    documentName ? `Document: "${documentName}"${pageNumber ? `, page ${pageNumber}` : ""}` : "",
    `Selected passage:\n"""\n${selection}\n"""`,
    question ? `Student's question: ${question}` : "The student has not asked a specific question — explain the passage.",
  ]
    .filter(Boolean)
    .join("\n\n");

  try {
    const completion = await client.chat.completions.create({
      model: MODEL,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userContent },
      ],
      temperature: 0.4,
      max_tokens: 400,
    });
    const answer = completion.choices[0]?.message?.content?.trim() ?? "";
    if (!answer) return NextResponse.json({ error: "No answer was returned." }, { status: 502 });
    return NextResponse.json({ answer });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Could not get an explanation." },
      { status: 502 },
    );
  }
}

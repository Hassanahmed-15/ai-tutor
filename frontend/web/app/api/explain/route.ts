import { NextResponse } from "next/server";
import OpenAI from "openai";
import { EXPLAIN_SYSTEM_PROMPT, EXPLAIN_TEXT_ONLY_SYSTEM_PROMPT } from "@/lib/drawPrompt";
import { sanitizeExplanation, sanitizeTextExplanation } from "@/lib/drawSanitize";
import { fillReactAnimationOps } from "@/lib/reactAnimationGen";
import type { Beat } from "@/lib/lessonContent";

/**
 * The side-chat "explain this further" endpoint. Returns one spoken explanation plus a fresh
 * marker-drawn DrawScript board answering the question. Visual answers use the same validated,
 * premium React/SVG pipeline as the main lecture instead of the old generic client diagram.
 * Needs OPENAI_API_KEY in frontend/web/.env.local.
 */
const MODEL = process.env.OPENAI_EXPLAIN_MODEL ?? "gpt-4o";

export async function POST(req: Request) {
  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json({ error: "OPENAI_API_KEY not set." }, { status: 503 });
  }

  const body = await req.json().catch(() => ({}));
  const topic = typeof body.topic === "string" ? body.topic.trim() : "";
  const beatContext = typeof body.beatContext === "string" ? body.beatContext.trim() : "";
  const question = typeof body.question === "string" ? body.question.trim() : "";
  // When true (ADHD live tutor), the board must be SIMPLE chalk text — never fill an image op.
  const textOnly = body.textOnly === true;
  const visualMode = typeof body.visualMode === "string" ? body.visualMode.trim() : "annotated_board";
  const reuseContext = body.reuseContext === true;
  if (!question) return NextResponse.json({ error: "question is required" }, { status: 400 });

  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const userMsg =
    `The lecture topic is "${topic || "this subject"}". ` +
    (beatContext ? `The student is on this part: "${beatContext}". ` : "") +
    `They asked: "${question}". ` +
    `Preferred visual mode: "${visualMode}". ` +
    (reuseContext ? "Keep useful visual context from the current board when it improves continuity. " : "Use a fresh board composition. ") +
    `Explain it and plan a precise visual answer.`;

  let lastError = "Couldn't generate an explanation.";
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const completion = await client.chat.completions.create({
        model: MODEL,
        messages: [
          { role: "system", content: textOnly ? EXPLAIN_TEXT_ONLY_SYSTEM_PROMPT : EXPLAIN_SYSTEM_PROMPT },
          { role: "user", content: userMsg },
        ],
        temperature: 0.7,
        response_format: { type: "json_object" },
      });
      const raw = completion.choices[0]?.message?.content ?? "";
      // TEXT-ONLY (ADHD tutor): dedicated sanitizer keeps ONLY label/note ops and never substitutes
      // the shape/scene diagram fallback — guaranteeing a clean chalk-text board.
      if (textOnly) {
        return NextResponse.json(sanitizeTextExplanation(JSON.parse(raw), { question }));
      }

      const result = sanitizeExplanation(JSON.parse(raw), { question });
      if (result.draw) {
        const syntheticBeat: Beat = {
          id: `explain-${Date.now()}-${attempt}`,
          title: topic || question,
          teacherMove: "Answer the student's follow-up with a focused visual explanation.",
          stepLabel: "Live explanation",
          slideKind: "definition",
          points: [],
          script: result.script,
          draw: result.draw,
        };
        const stats = await fillReactAnimationOps(client, [syntheticBeat]);
        const animation = syntheticBeat.draw?.ops.find((op) => op.kind === "reactAnimation");
        if (!animation?.code || stats.filled < 1) {
          throw new Error(stats.issues[0] || "The premium explanation board did not pass visual validation.");
        }
        result.draw = syntheticBeat.draw;
      }

      return NextResponse.json(result);
    } catch (err) {
      lastError = err instanceof Error ? err.message : "Explanation failed";
    }
  }
  return NextResponse.json({ error: lastError }, { status: 502 });
}

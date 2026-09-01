import { NextResponse } from "next/server";
import { getDocumentImages } from "@/lib/pageImageStore";
import { buildImageParts, type ContentPart } from "@/lib/fullDocumentContext";
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

  /**
   * The rest of the lesson, and the document it came from.
   *
   * WHAT THIS FIXES. The panel sent only the CURRENT beat, so the tutor answering a question knew
   * the sentence being spoken and nothing else. "What are we covering after this?" was unanswerable,
   * "you said earlier…" was unanswerable, and a question about the student's own uploaded PDF was
   * answered from the model's general knowledge rather than from their document — which is worse
   * than a refusal, because it looks like an answer.
   *
   * Both are capped. A whole lecture plus a parsed paper is far more than this call needs, and a
   * prompt that large costs latency on every question asked mid-lesson.
   */
  const lessonContext = typeof body.lessonContext === "string" ? body.lessonContext.trim().slice(0, 8000) : "";
  const documentContext = typeof body.documentContext === "string" ? body.documentContext.trim().slice(0, 30000) : "";
  /*
   * The question this whole lesson exists to answer.
   *
   * Without it the chat knows what is being taught but not what it is FOR, so "why are we covering
   * this?" has no answer and a reply that quietly drifts off the student's actual question still
   * reads as authoritative. Empty for a lecture built from a plain topic, where there was no
   * question in the first place.
   */
  const lessonQuestion = typeof body.lessonQuestion === "string" ? body.lessonQuestion.trim().slice(0, 500) : "";

  /**
   * The uploaded pages, so a mid-lesson question can be answered by LOOKING at the document.
   *
   * The text context above is the document's extracted words plus what OCR read; this is the pages
   * themselves. It matters for the same reason it mattered at generation time — a question about a
   * chart's values or a formula's subscripts cannot be answered from prose about them.
   *
   * A miss is ordinary and silent: no upload, an expired store, a restarted server. The answer then
   * comes from the text context alone, which is what this endpoint did before.
   */
  const documentId = typeof body.documentId === "string" ? body.documentId : "";
  const pageImages = getDocumentImages(documentId);

  if (!question) return NextResponse.json({ error: "question is required" }, { status: 400 });

  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const userMsg =
    `The lecture topic is "${topic || "this subject"}". ` +
    (lessonContext
      ? `The whole lesson, in order, so you can answer about what is coming or what has already been covered:\n${lessonContext}\n\n`
      : "") +
    (documentContext
      ? `The student's own uploaded document. Answer from THIS when the question is about their material — quote its wording rather than paraphrasing from general knowledge:\n${documentContext}\n\n`
      : "") +
    (lessonQuestion
      ? `This whole lesson was built to answer one question the student asked: "${lessonQuestion}". Keep that in view — if their new question relates to it, connect the two rather than answering in isolation.

`
      : "") +
    (beatContext ? `The student is on this part right now: "${beatContext}". ` : "") +
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
          {
            role: "user",
            /*
             * Text first, then the pages. One question is being asked about a document the student
             * is looking at, so the pictures are evidence for that question rather than a second
             * subject — and a model handed images before it is told what to do with them tends to
             * describe them instead of answering.
             */
            content: pageImages
              ? ([{ type: "text", text: userMsg }, ...buildImageParts(pageImages.pages, pageImages.regions, pageImages.unit)] as ContentPart[])
              : userMsg,
          },
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

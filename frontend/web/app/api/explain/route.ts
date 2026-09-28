import { NextResponse } from "next/server";
import { getDocumentImages } from "@/lib/pageImageStore";
import { buildImageParts, type ContentPart } from "@/lib/fullDocumentContext";
import OpenAI from "openai";
import { createCostMeter } from "@/lib/costMeter";
import { EXPLAIN_SYSTEM_PROMPT, EXPLAIN_TEXT_ONLY_SYSTEM_PROMPT, EXPLAIN_OFFER_SYSTEM_PROMPT } from "@/lib/drawPrompt";
import { sanitizeExplanation, sanitizeTextExplanation, sanitizeOfferedExplanation } from "@/lib/drawSanitize";
import { fillReactAnimationOps, type ReactAnimationFillOptions } from "@/lib/reactAnimationGen";
import { fillSpecBoardOps } from "@/lib/specBoardGen";
import { isCodeQuestion } from "@/lib/codeSpec";
import type { Beat } from "@/lib/lessonContent";
import { sanitizeSourceScope } from "@/lib/sourceScope";
import type { BeatSourceGrounding } from "@/lib/sourceGrounding";
import {
  STRICT_ANSWER_RULES,
  boardTextIsUngrounded,
  combinedSource,
  formatBeatSource,
  groundAnswer,
  readStrictSourceHeader,
  relevantSourceExcerpt,
  sanitizeBeatSourceGrounding,
} from "@/lib/strictSourceAnswers";

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
  /** What the board the student is looking at already explains (a live-voice follow-up). */
  const previousBoard = typeof body.previousBoard === "string" ? body.previousBoard.trim().slice(0, 1500) : "";
  /*
   * ANSWER FIRST, DRAW ON REQUEST.
   *
   * With `offer`, this returns words plus at most a one-line proposal, and never reaches the animation
   * pass below — which is where the tens of seconds go, with the lecture frozen behind it. The client
   * asks again without the flag once the student says yes, so the board pipeline is untouched and
   * every other caller (/api/ask-drawing, the ADHD text board, the viewer) behaves exactly as before.
   */
  const offer = body.offer === true;
  /** What she promised to draw, carried into the build so the board is the one that was offered. */
  const visualHint = typeof body.visualHint === "string" ? body.visualHint.trim().slice(0, 300) : "";

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
  /*
   * STRICT SOURCE. The typed ask box sends the scope and the current beat's source explicitly. The
   * live voice tutor's board requests cannot (its hook forwards a fixed set of strings), so its
   * player puts the same two things at the head of the document context instead — read back out
   * here (lib/strictSourceAnswers.ts). Explicit fields win; the header is always stripped so the
   * prompt calls only the document "the document".
   */
  const fidelityHeader = readStrictSourceHeader(typeof body.documentContext === "string" ? body.documentContext.trim() : "");
  const documentContext = fidelityHeader.document.trim().slice(0, 30000);
  const sourceScope = sanitizeSourceScope(body.sourceScope);
  const strictRequested = sourceScope ? sourceScope.fidelity === "strict" : fidelityHeader.strict;
  const beatSource: BeatSourceGrounding | null =
    sanitizeBeatSourceGrounding(body.beatSource, strictRequested) ??
    (fidelityHeader.beatSource ? { ...fidelityHeader.beatSource, strict: strictRequested } : null);
  /*
   * Strict needs something to be strict TO. With no document text and no beat source there is
   * nothing to answer from and nothing to check against, so the request is answered as before
   * rather than refusing every question.
   */
  const strict = strictRequested && Boolean(documentContext || beatSource?.text || beatSource?.labels.length);
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

  // Priced across every attempt, including failed ones and the animation built for the answer.
  const meter = createCostMeter();
  const client = meter.wrap(new OpenAI({ apiKey: process.env.OPENAI_API_KEY }));
  /*
   * A FOLLOW-UP DRAWING. "Now show the deletion" after a drawing of the tree continues THAT board —
   * the new section sits under the old one and must not draw it again; a different figure is a new
   * slide and should not repeat the previous one either. Without the previous board the model had
   * only the lecture's board to go on, and redrew what was already on screen.
   */
  const followUp = previousBoard && !offer
    ? reuseContext
      ? `\n\nThis continues the board the student is looking at, which already explains: "${previousBoard}". Add ONLY the next part, as a continuation of that drawing — do not redraw or re-explain what it already shows.`
      : `\n\nThe student just saw a board explaining: "${previousBoard}". This is a new slide: do not repeat that board.`
    : "";
  const baseUserMsg = strict
    ? strictUserMessage({ topic, lessonContext, documentContext, beatSource, lessonQuestion, beatContext, question, visualMode, reuseContext, offer, visualHint })
    : `The lecture topic is "${topic || "this subject"}". ` +
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
    (offer
      ? `Answer it in words. Propose a drawing only if the answer genuinely needs one.`
      : `Preferred visual mode: "${visualMode}". ` +
        (reuseContext ? "Keep useful visual context from the current board when it improves continuity. " : "Use a fresh board composition. ") +
        (visualHint ? `They have asked to see this drawn, and you offered: "${visualHint}". Draw that. ` : "") +
        `Explain it and plan a precise visual answer.`);
  const userMsg = baseUserMsg + followUp;

  let lastError = "Couldn't generate an explanation.";
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const completion = await client.chat.completions.create({
        model: MODEL,
        messages: [
          {
            role: "system",
            content: `${offer ? EXPLAIN_OFFER_SYSTEM_PROMPT : textOnly ? EXPLAIN_TEXT_ONLY_SYSTEM_PROMPT : EXPLAIN_SYSTEM_PROMPT}${strict ? `\n\n${STRICT_ANSWER_RULES}` : ""}`,
          },
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
        // Strict answers are restatements of the document, not compositions: low temperature keeps
        // the wording on the page (and the retries down). Reference mode keeps its old warmth.
        temperature: strict ? 0.2 : 0.7,
        response_format: { type: "json_object" },
      });
      const raw = completion.choices[0]?.message?.content ?? "";
      const parsed = JSON.parse(raw) as Record<string, unknown>;

      /*
       * THE STRICT CHECK. The rule in the prompt is a request; this is the guarantee. Every sentence
       * of the answer is checked against the document's own words (lib/sourceGrounding), and one that
       * brings in two or more words the document never uses is removed before anyone hears it. An
       * answer with nothing left — or one the model itself marked uncovered — becomes a plain "your
       * document doesn't cover that", and no board is drawn for it: an animated board illustrating a
       * non-answer costs 20-60 s and can only show material the document does not have.
       */
      let strictBoardSource: BeatSourceGrounding | null = null;
      if (strict) {
        const vocabulary = combinedSource(beatSource, documentContext);
        const grounded = groundAnswer(typeof parsed.script === "string" ? parsed.script : "", vocabulary, {
          modelCovered: parsed.covered === false ? false : undefined,
        });
        if (grounded.dropped.length > 0) {
          console.info(`[explain] strict: removed ${grounded.dropped.length} unsupported sentence(s): ${grounded.dropped.join(" | ").slice(0, 300)}`);
        }
        if (!grounded.covered) {
          return NextResponse.json({ script: grounded.script, covered: false, costUsd: meter.totalUsd });
        }
        parsed.script = grounded.script;
        if (textOnly) {
          // The chalk-text board is written by the model op by op; a line the document does not
          // support is dropped the same way a spoken sentence is.
          const draw = parsed.draw && typeof parsed.draw === "object" ? (parsed.draw as Record<string, unknown>) : null;
          if (draw && Array.isArray(draw.ops)) {
            draw.ops = draw.ops.filter((op: unknown) => {
              const text = op && typeof op === "object" ? (op as Record<string, unknown>).text : undefined;
              return typeof text !== "string" || !boardTextIsUngrounded(text, vocabulary);
            });
          }
        }
        /*
         * The board is held to the beat's own source plus the few document sentences this answer
         * is about — not the whole document, which would add seconds of prefill to every question.
         */
        const excerpt = relevantSourceExcerpt(documentContext, `${question} ${grounded.script}`, 2_500, beatSource?.text ?? "");
        strictBoardSource = {
          text: [beatSource?.text ?? "", excerpt].filter((part) => part.trim()).join("\n\n"),
          labels: beatSource?.labels ?? [],
          ...(beatSource?.caption ? { caption: beatSource.caption } : {}),
          strict: true,
        };
      }
      /*
       * The words-only answer returns here — after the strict check, so an offered answer is held to
       * the document like any other — and before the board pipeline exists at all. Nothing is
       * illustrated, so this path costs one model call instead of twenty.
       */
      if (offer) {
        return NextResponse.json({ ...sanitizeOfferedExplanation(parsed), ...(strict ? { covered: true } : {}), costUsd: meter.totalUsd });
      }
      // TEXT-ONLY (ADHD tutor): dedicated sanitizer keeps ONLY label/note ops and never substitutes
      // the shape/scene diagram fallback — guaranteeing a clean chalk-text board.
      if (textOnly) {
        return NextResponse.json({
          ...sanitizeTextExplanation(parsed, { question }),
          ...(strict ? { covered: true } : {}),
          costUsd: meter.totalUsd,
        });
      }

      const result = sanitizeExplanation(parsed, { question });
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
        /*
         * The model was told to answer code questions with a code board and, measured on a real
         * lecture, still drew a diagram for "explain to me working of remove function". Whether the
         * answer is code is decided here instead, from the question and the student's document.
         */
        if (
          !syntheticBeat.draw?.ops.some((op) => op.kind === "codeBoard") &&
          isCodeQuestion(question, documentContext, visualMode)
        ) {
          const brief = syntheticBeat.draw?.ops.find((op) => op.kind === "reactAnimation")?.teachingPoint ?? "";
          syntheticBeat.draw = {
            ...syntheticBeat.draw!,
            ops: [{ kind: "codeBoard", codeBrief: `${question} — ${brief}`.slice(0, 400), at: 0, endAt: 1 }],
          };
        }
        /*
         * A question about specific code gets the code itself. The board quotes the student's
         * document when the function is in it; if the listing cannot be produced, the brief is
         * handed to the illustrator instead, so the student still gets a visual answer.
         */
        const codeOp = syntheticBeat.draw?.ops.find((op) => op.kind === "codeBoard");
        if (codeOp?.kind === "codeBoard") {
          await fillSpecBoardOps(client, [syntheticBeat], {
            sourceByBeatId: documentContext ? new Map([[syntheticBeat.id, documentContext]]) : undefined,
            imagesByBeatId: pageImages
              ? new Map([[syntheticBeat.id, buildImageParts(pageImages.pages, pageImages.regions, pageImages.unit)]])
              : undefined,
          });
          if (codeOp.spec) {
            result.draw = { ...syntheticBeat.draw!, ops: [codeOp] };
            return NextResponse.json({ ...result, ...(strict ? { covered: true } : {}), costUsd: meter.totalUsd });
          }
          syntheticBeat.draw = {
            ...syntheticBeat.draw!,
            ops: [{ kind: "reactAnimation", teachingPoint: codeOp.codeBrief ?? question, at: 0, endAt: 1 }],
          };
        }
        /*
         * The answer board is drawn by the same generator as the lecture's boards, and held to the
         * same source: strict passes the rules above in board form; reference mode passes the beat's
         * source with strict:false, as context rather than a fence.
         */
        const boardSource = strictBoardSource ?? beatSource;
        const fillOptions: ReactAnimationFillOptions & { sourceByBeatId?: Record<string, BeatSourceGrounding> } = boardSource
          ? { sourceByBeatId: { [syntheticBeat.id]: boardSource } }
          : {};
        const stats = await fillReactAnimationOps(client, [syntheticBeat], fillOptions);
        const animation = syntheticBeat.draw?.ops.find((op) => op.kind === "reactAnimation");
        if (!animation?.code || stats.filled < 1) {
          throw new Error(stats.issues[0] || "The premium explanation board did not pass visual validation.");
        }
        result.draw = syntheticBeat.draw;
      }

      return NextResponse.json({ ...result, ...(strict ? { covered: true } : {}), costUsd: meter.totalUsd });
    } catch (err) {
      lastError = err instanceof Error ? err.message : "Explanation failed";
    }
  }
  return NextResponse.json({ error: lastError, costUsd: meter.totalUsd }, { status: 502 });
}

/**
 * The strict-mode question, laid out so the document is unmistakably the source.
 *
 * The reference-mode message says "answer from THIS when the question is about their material",
 * which licenses general knowledge for every question that is not. Here the current part's own text
 * comes first, then the document, each labelled as the only permitted material; the lesson outline
 * and what is on screen are labelled as the lesson's wording — useful for "what's next?", never a
 * source of facts, because a script can itself have leaked.
 */
function strictUserMessage(input: {
  topic: string;
  lessonContext: string;
  documentContext: string;
  beatSource: BeatSourceGrounding | null;
  lessonQuestion: string;
  beatContext: string;
  question: string;
  visualMode: string;
  reuseContext: boolean;
  offer: boolean;
  visualHint: string;
}): string {
  const parts = [`The lecture topic is "${input.topic || "this subject"}". The student chose to learn STRICTLY FROM THEIR DOCUMENT.`];
  if (input.beatSource) {
    parts.push(`CURRENT PART — the document's own text for the part on screen now:\n${formatBeatSource(input.beatSource)}`);
  }
  if (input.documentContext) {
    parts.push(`SOURCE — the student's own document. It is the ONLY material you may use:\n${input.documentContext}`);
  }
  if (input.lessonContext) {
    parts.push(`The lesson's outline, for questions about what comes next or what was covered. It is NOT a source of facts:\n${input.lessonContext}`);
  }
  if (input.lessonQuestion) {
    parts.push(`This lesson was built to answer: "${input.lessonQuestion}".`);
  }
  if (input.beatContext) {
    parts.push(`What is on screen now (the lesson's wording, NOT a source of facts): "${input.beatContext}".`);
  }
  parts.push(
    input.offer
      ? `They asked: "${input.question}". Answer it in words from SOURCE only. Propose a drawing only if the answer genuinely needs one, and only of what SOURCE contains.`
      : `They asked: "${input.question}". Preferred visual mode: "${input.visualMode}". ` +
        (input.reuseContext ? "Keep useful visual context from the current board when it improves continuity. " : "Use a fresh board composition. ") +
        (input.visualHint ? `They have asked to see this drawn, and you offered: "${input.visualHint}". Draw that. ` : "") +
        "Answer from SOURCE only, and plan a board that shows only what SOURCE contains.",
  );
  return parts.join("\n\n");
}

import { NextResponse } from "next/server";
import OpenAI from "openai";
import { GENERATE_TEST_SYSTEM_PROMPT } from "@/lib/testPrompt";
import { sanitizeTestBank } from "@/lib/testSanitize";
import type { Beat } from "@/lib/lessonContent";
import { sanitizeSourceScope } from "@/lib/sourceScope";
import { STRICT_TEST_RULES, groundTestQuestions } from "@/lib/strictSourceAnswers";

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

  /*
   * STRICT SOURCE. A strict lecture's test is written against the document's own text (sent by the
   * client), not only the scripts, and every question the document cannot answer is removed before
   * the student sees it — they would otherwise be graded against material their document lacks.
   * Reference mode sends no source and is unchanged.
   */
  const sourceScope = sanitizeSourceScope(body.sourceScope);
  const source = typeof body.source === "string" ? body.source.trim().slice(0, 16_000) : "";
  const strict = sourceScope?.fidelity === "strict" && Boolean(source);

  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const userMsg =
    `Lecture topic: "${topic}"\nBeats taught (use these ids as beatId):\n${JSON.stringify(compactBeatsForTest(beats))}\n\n` +
    (strict ? `SOURCE — the student's own document, the text this lecture was taught from. Test only what SOURCE states:\n${source}\n\n` : "") +
    "Write the test now.";

  let lastError = "Could not generate a test for this lecture.";
  let issue = "";
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    try {
      const completion = await client.chat.completions.create({
        model: MODEL,
        messages: [
          { role: "system", content: strict ? `${GENERATE_TEST_SYSTEM_PROMPT}\n\n${STRICT_TEST_RULES}` : GENERATE_TEST_SYSTEM_PROMPT },
          { role: "user", content: issue ? `${userMsg}\n\nYour previous test was rejected: ${issue}. Fix exactly that.` : userMsg },
        ],
        temperature: strict ? 0.3 : 0.6,
        max_tokens: 2500,
        response_format: { type: "json_object" },
      });
      const bank = sanitizeTestBank(JSON.parse(completion.choices[0]?.message?.content ?? "{}"), topic);
      if (bank.questions.length === 0) throw new Error("The model did not return usable questions.");

      const usage = completion.usage;
      const costUsd = usage ? usage.prompt_tokens * (2.5 / 1_000_000) + usage.completion_tokens * (10.0 / 1_000_000) : 0;
      if (strict) {
        const grounded = groundTestQuestions(bank.questions, source);
        if (grounded.dropped > 0) console.info(`[generate-test] strict: removed ${grounded.dropped} question(s) the source cannot answer`);
        // Ask once more only when too little survives to be a test; otherwise the faithful subset ships.
        if (grounded.kept.length < 3 && attempt < ATTEMPTS - 1) {
          issue = `${grounded.dropped} question(s) tested material SOURCE does not contain — write every question, keyPoint and modelAnswer from SOURCE alone`;
          lastError = "The test went beyond the source.";
          continue;
        }
        if (grounded.kept.length === 0) throw new Error("No question could be answered from the source alone.");
        return NextResponse.json({ ...bank, questions: grounded.kept, costUsd });
      }
      return NextResponse.json({ ...bank, costUsd });
    } catch (err) {
      lastError = err instanceof Error ? err.message : "Test generation failed";
    }
  }
  return NextResponse.json({ error: lastError }, { status: 502 });
}

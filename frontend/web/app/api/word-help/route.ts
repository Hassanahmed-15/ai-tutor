import { NextResponse } from "next/server";
import OpenAI from "openai";

/**
 * What one word means, in the sentence the student was actually reading.
 *
 * THE SENTENCE IS NOT OPTIONAL CONTEXT. "Plant" in a biology lecture and "plant" in a manufacturing
 * one are different words, and a definition that answers the wrong sense is worse than none — the
 * student trusted it. So the line is sent and the model is told to define the word AS USED.
 *
 * Syllables deliberately do not come from here. They arrive with the beat's rewrite from
 * /api/dyslexia-chunks, so a tap is one short request rather than two, and the split is already on
 * screen the moment the popover opens.
 */
const MODEL = process.env.OPENAI_WORD_HELP_MODEL ?? "gpt-4o-mini";

const SYSTEM_PROMPT =
  "A student with dyslexia tapped one word while a lesson was being read to them. Say what that " +
  "word means AS IT IS USED in the sentence they were reading.\n\n" +
  "Rules:\n" +
  "- One sentence. Fifteen words at most.\n" +
  "- Everyday language. Never define a hard word using another hard word.\n" +
  "- Define the sense used in this sentence, not the word's other meanings.\n" +
  "- No preamble, no quotation marks, no restating the word first.\n" +
  'Return JSON: {"meaning": string}';

export async function POST(req: Request) {
  if (!process.env.OPENAI_API_KEY) {
    // 503, not 500: the popover still shows the word and its syllables, and can speak it.
    return NextResponse.json({ error: "OPENAI_API_KEY not set." }, { status: 503 });
  }

  const body = await req.json().catch(() => ({}));
  const word = typeof body.word === "string" ? body.word.trim().slice(0, 60) : "";
  const sentence = typeof body.sentence === "string" ? body.sentence.trim().slice(0, 400) : "";
  if (!word) return NextResponse.json({ error: "word is required" }, { status: 400 });

  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  try {
    const completion = await client.chat.completions.create({
      model: MODEL,
      temperature: 0.2,
      max_tokens: 120,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: `Word: ${word}\nSentence: ${sentence || "(none given)"}` },
      ],
    });
    const parsed = JSON.parse(completion.choices[0]?.message?.content ?? "{}");
    const meaning = typeof parsed.meaning === "string" ? parsed.meaning.trim() : "";
    if (!meaning) return NextResponse.json({ error: "No meaning came back." }, { status: 502 });
    return NextResponse.json({ meaning });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Lookup failed." },
      { status: 502 },
    );
  }
}

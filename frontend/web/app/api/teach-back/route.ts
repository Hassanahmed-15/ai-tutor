import { NextResponse } from "next/server";
import OpenAI from "openai";
import { sanitizeTeachBackOpening, sanitizeTeachBackReply } from "@/lib/teachBack";

const MODEL = process.env.OPENAI_TEACH_BACK_MODEL ?? "gpt-4o";

const OPENING_PROMPT = `You are simulating a thoughtful learner so the real student can learn by teaching.
Use only the supplied lesson beat. Hold exactly one plausible misconception about a causal relationship in that beat, then ask the student for help in a natural first-person voice.

Return JSON only:
{"learnerLine":string,"hiddenMissingLink":string,"lessonAnchor":string}

Rules:
- learnerLine is 1-2 short sentences and sounds genuinely curious, not like an exam or a chatbot.
- The misconception must be plausible and resolvable from the supplied narration.
- hiddenMissingLink states the exact causal connection a good explanation must contain.
- lessonAnchor is the specific fact in the beat supporting that link.
- Do not invent facts, quantities, people, or sources. Do not ask vocabulary trivia.`;

const REPLY_PROMPT = `You are the same simulated learner. Judge whether the student's explanation repairs the supplied missing causal link, then respond naturally.

Return JSON only:
{"learnerReply":string,"understood":boolean,"missingLink":string,"nextQuestion":string,"teachingMove":string}

Rules:
- understood is true only if the explanation contains the causal bridge, not merely the right conclusion.
- learnerReply is a natural 1-2 sentence response from the learner. If understood, restate the idea accurately in your own words. If not, name the exact point still confusing you without giving a full answer.
- learnerReply may only paraphrase the student's submitted words and hiddenMissingLink. Do not add materials, mechanisms, examples, or facts that are absent from both.
- missingLink must preserve hiddenMissingLink exactly in meaning and scope; do not expand it with later lesson content.
- nextQuestion is empty when understood; otherwise it is one focused follow-up question.
- teachingMove names what the student did, such as "used a mechanism", "gave a concrete example", or "stated the result without the cause".
- Grade meaning, not writing style. Remain grounded in the supplied beat.`;

export async function POST(req: Request) {
  if (!process.env.OPENAI_API_KEY) return NextResponse.json({ error: "OPENAI_API_KEY not set." }, { status: 503 });
  const body = await req.json().catch(() => ({}));
  const action = body.action === "reply" ? "reply" : "start";
  const topic = typeof body.topic === "string" ? body.topic.trim().slice(0, 180) : "";
  const beat = body.beat && typeof body.beat === "object" ? body.beat as Record<string, unknown> : {};
  const title = typeof beat.title === "string" ? beat.title.trim().slice(0, 180) : "";
  const script = typeof beat.script === "string" ? beat.script.trim().slice(0, 2400) : "";
  const points = Array.isArray(beat.points) ? beat.points.filter((point): point is string => typeof point === "string").slice(0, 6) : [];
  if (!title || !script) return NextResponse.json({ error: "A complete lesson beat is required." }, { status: 400 });

  try {
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    if (action === "start") {
      const completion = await client.chat.completions.create({
        model: MODEL,
        messages: [
          { role: "system", content: OPENING_PROMPT },
          { role: "user", content: JSON.stringify({ topic, title, points, narration: script }) },
        ],
        temperature: 0.55,
        max_tokens: 650,
        response_format: { type: "json_object" },
      });
      const opening = sanitizeTeachBackOpening(JSON.parse(completion.choices[0]?.message?.content ?? "{}"));
      return opening
        ? NextResponse.json({ opening })
        : NextResponse.json({ error: "Could not create a grounded learner question." }, { status: 502 });
    }

    const answer = typeof body.answer === "string" ? body.answer.trim().slice(0, 1600) : "";
    const learnerLine = typeof body.learnerLine === "string" ? body.learnerLine.trim().slice(0, 400) : "";
    const hiddenMissingLink = typeof body.hiddenMissingLink === "string" ? body.hiddenMissingLink.trim().slice(0, 320) : "";
    const round = Math.max(1, Math.min(2, Number(body.round) || 1));
    if (!answer || !learnerLine || !hiddenMissingLink) return NextResponse.json({ error: "The learner context and answer are required." }, { status: 400 });
    const completion = await client.chat.completions.create({
      model: MODEL,
      messages: [
        { role: "system", content: REPLY_PROMPT },
        { role: "user", content: JSON.stringify({ topic, title, points, narration: script, learnerLine, hiddenMissingLink, studentExplanation: answer, round }) },
      ],
      temperature: 0.3,
      max_tokens: 700,
      response_format: { type: "json_object" },
    });
    const generatedReply = sanitizeTeachBackReply(JSON.parse(completion.choices[0]?.message?.content ?? "{}"));
    const reply = generatedReply ? { ...generatedReply, missingLink: hiddenMissingLink } : null;
    return reply
      ? NextResponse.json({ reply })
      : NextResponse.json({ error: "Could not evaluate the teaching explanation." }, { status: 502 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Teach-back failed." }, { status: 502 });
  }
}

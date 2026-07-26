import { NextResponse } from "next/server";
import OpenAI from "openai";
import { sanitizeConceptFork } from "@/lib/conceptFork";

const MODEL = process.env.OPENAI_FORK_MODEL ?? "gpt-4o";

const SYSTEM_PROMPT = `You design a short counterfactual learning experience called Parallel Worlds.
The student is in the middle of a lesson. Change exactly ONE condition that is explicitly present in the supplied beat, then make the student predict the first meaningful consequence.

Return JSON only with:
{
  "id": string,
  "change": string,
  "whyItMatters": string,
  "predictionQuestion": string,
  "choices": [string, string, string],
  "correctIndex": 0|1|2,
  "before": {"title": string, "chain": [2-4 short causal steps]},
  "after": {"title": string, "chain": [2-4 short causal steps]},
  "reveal": string,
  "transferQuestion": string
}

Rules:
- Ground every claim in the supplied lesson context or a direct elementary consequence of it.
- Change only one condition. Keep all other conditions constant.
- Prefer removing a named input, blocking a named step, or reversing an explicit relation. The changed condition and its first consequence must be unambiguous.
- Make the smallest local intervention possible. Change what happens to this system or example, not the laws of nature or the whole planet.
- Never substitute an undefined alternative such as "artificial", "different", "altered", "weaker", or "stronger" unless the lesson itself defines the relevant property. Those changes hide extra assumptions.
- Ask for a causal prediction, never a vocabulary definition or trivia question.
- Exactly one choice is correct. Wrong choices should expose plausible causal misconceptions.
- Each chain step is at most 9 words and should read left-to-right as cause -> effect.
- The reveal explains the decisive causal link in 2-3 sentences without praising or scolding.
- Avoid unsafe medical, legal, or personal advice. No invented measurements, sources, or historical claims.`;

export async function POST(req: Request) {
  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json({ error: "OPENAI_API_KEY not set." }, { status: 503 });
  }
  const body = await req.json().catch(() => ({}));
  const topic = typeof body.topic === "string" ? body.topic.trim().slice(0, 180) : "";
  const beat = body.beat && typeof body.beat === "object" ? body.beat as Record<string, unknown> : {};
  const title = typeof beat.title === "string" ? beat.title.trim().slice(0, 180) : "";
  const script = typeof beat.script === "string" ? beat.script.trim().slice(0, 2200) : "";
  const points = Array.isArray(beat.points)
    ? beat.points.filter((point): point is string => typeof point === "string").slice(0, 6)
    : [];
  if (!title || !script) return NextResponse.json({ error: "A complete lesson beat is required." }, { status: 400 });

  try {
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    let lastIssue = "The causal fork was not complete enough to use.";
    for (let attempt = 0; attempt < 2; attempt++) {
      const completion = await client.chat.completions.create({
        model: MODEL,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          {
            role: "user",
            content: JSON.stringify({
              topic,
              title,
              points,
              narration: script,
              retryInstruction: attempt ? `The previous proposal was rejected: ${lastIssue} Choose a binary, assumption-free change.` : undefined,
            }),
          },
        ],
        temperature: 0.35,
        max_tokens: 1100,
        response_format: { type: "json_object" },
      });
      const fork = sanitizeConceptFork(JSON.parse(completion.choices[0]?.message?.content ?? "{}"), title);
      if (!fork) {
        lastIssue = "missing or malformed causal fields";
        continue;
      }
      if (/\b(?:artificial|different|altered|alternative|weaker|stronger|more effective|less effective)\b/i.test(`${fork.change} ${fork.reveal}`)) {
        lastIssue = "the change depended on an undefined comparison or substitute";
        continue;
      }
      return NextResponse.json({ fork });
    }
    return NextResponse.json({ error: lastIssue }, { status: 502 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not create the causal fork." }, { status: 502 });
  }
}

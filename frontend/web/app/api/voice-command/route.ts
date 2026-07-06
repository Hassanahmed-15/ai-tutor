import { NextResponse } from "next/server";
import OpenAI from "openai";

/**
 * Natural-language voice command interpreter for the Blind lecture player. The student has
 * already said the wake-word ("Nova"); this endpoint receives whatever they said AFTER it and
 * decides what they meant — using the current beat as context — instead of matching fixed
 * keywords. So "go over the leaf part again" -> repeat, "I'm lost on the light bit" -> a fresh
 * spoken explanation, "wrap it up" -> exit, etc.
 *
 * Returns ONE of:
 *   { action: "stop"|"start"|"next"|"back"|"repeat"|"restart"|"exit" }   — a control command
 *   { action: "answer", answer: string }                                  — a spoken reply to a
 *                                                                            question/confusion,
 *                                                                            freshly written for
 *                                                                            what they asked
 *   { action: "none" }                                                    — nothing actionable
 *
 * Honesty: costs a small gpt-4o-mini call per command. Needs OPENAI_API_KEY in frontend/web/.env.local.
 */
const MODEL = process.env.OPENAI_VOICE_MODEL ?? "gpt-4o-mini";

const ACTIONS = ["stop", "start", "next", "back", "repeat", "restart", "exit", "answer", "none"] as const;
type VoiceAction = (typeof ACTIONS)[number];

const SYSTEM_PROMPT =
  "You are Nova, the voice controller for an audio-first lecture used by a blind student. " +
  "The student speaks naturally after saying your name. Decide what they want and reply with " +
  "JSON only: {\"action\": <action>, \"answer\"?: <string>}.\n\n" +
  "Actions:\n" +
  "- \"stop\": pause the lecture (stop, pause, hold on, be quiet, wait).\n" +
  "- \"start\": begin or resume playing (start, resume, keep going, continue, play).\n" +
  "- \"next\": skip forward to the next part (next, skip, move on, forward).\n" +
  "- \"back\": go to the previous part (back, previous, go back, last one).\n" +
  "- \"repeat\": say the current part again exactly (repeat, again, say that again, one more time).\n" +
  "- \"restart\": start the whole lecture over from the beginning.\n" +
  "- \"exit\": leave the lecture (exit, quit, close, I'm done, wrap it up).\n" +
  "- \"answer\": the student asked a QUESTION or expressed confusion about the material " +
  "(\"explain the light part\", \"what does that mean\", \"I don't get this\", \"why does that happen\"). " +
  "In this case ALSO include \"answer\": a warm, clear, spoken explanation (2-5 sentences, no markdown, " +
  "no lists) that answers exactly what they asked, grounded in the current part of the lecture. " +
  "Speak directly to the student.\n" +
  "- \"none\": you can't tell what they want, or it's unrelated chatter.\n\n" +
  "Prefer a control action when the request clearly maps to one. Use \"answer\" whenever the " +
  "student wants to understand something better. Return JSON only.";

export async function POST(req: Request) {
  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json({ error: "OPENAI_API_KEY not set." }, { status: 503 });
  }

  const body = await req.json().catch(() => ({}));
  const transcript = typeof body.transcript === "string" ? body.transcript.trim() : "";
  const topic = typeof body.topic === "string" ? body.topic.trim() : "";
  const beatContext = typeof body.beatContext === "string" ? body.beatContext.trim() : "";
  if (!transcript) return NextResponse.json({ error: "transcript is required" }, { status: 400 });

  const userMsg =
    `Lecture topic: "${topic || "this subject"}".\n` +
    (beatContext ? `Current part the student is on: "${beatContext.slice(0, 1200)}".\n` : "") +
    `The student said (after your wake-word): "${transcript.slice(0, 400)}".\n` +
    `What do they want?`;

  try {
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const completion = await client.chat.completions.create({
      model: MODEL,
      temperature: 0.3,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userMsg },
      ],
    });

    const raw = completion.choices[0]?.message?.content ?? "{}";
    const parsed = JSON.parse(raw) as { action?: string; answer?: string };
    const action: VoiceAction = ACTIONS.includes(parsed.action as VoiceAction)
      ? (parsed.action as VoiceAction)
      : "none";
    const answer = typeof parsed.answer === "string" ? parsed.answer.trim() : "";

    // If the model chose "answer" but gave no text, fall back to repeating the current part.
    if (action === "answer" && !answer) {
      return NextResponse.json({ action: "repeat" });
    }

    return NextResponse.json(action === "answer" ? { action, answer } : { action });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Voice command failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

import { NextResponse } from "next/server";
import OpenAI from "openai";

/**
 * Rewrite one lecture beat into short lines, at three reading levels, in a single call.
 *
 * WHY THE MODEL AND NOT A SPLITTER. `lib/dyslexiaChunking.ts` already breaks a script into short
 * lines with no network call, and that is what keeps the track playable offline. But splitting on
 * punctuation cannot change LANGUAGE — it cannot turn "synthesise nutrients" into "make food" — so
 * its three levels differ only in how much text they show. The reading-level dial is the strongest
 * idea in this track, and it is meaningless unless the levels genuinely say the same thing in
 * simpler words. That is a rewrite, and a rewrite needs a model.
 *
 * ALL THREE LEVELS IN ONE REQUEST. Roughly 600 output tokens, about $0.0004. Three separate calls
 * would triple the round trips and let the levels drift apart — level 1 and level 3 must be the same
 * explanation at different densities, not three different explanations. It also makes the dial
 * instant after the first fetch: switching level is a state read, never a request.
 *
 * SYLLABLES COME BACK TOO. Tap-a-word shows a word broken into syllables, and a client heuristic is
 * not good enough for that: a tuned vowel-group splitter I measured got 6/10, failing on exactly the
 * words a science lecture uses — chloroplast, glucose, dioxide. Wrong syllable breaks are worse than
 * none for students whose difficulty IS decoding. A lecture contains only ~22 distinct long words,
 * so the model returns splits for the handful it just used, at no extra round trip.
 *
 * Called lazily per beat by the player rather than at lecture-build time: build-time would add a
 * call per beat to EVERY lecture for a minority of students, and push generation further towards the
 * host's request ceiling.
 */
const MODEL = process.env.OPENAI_DYSLEXIA_MODEL ?? "gpt-4o-mini";

/**
 * A closed emoji vocabulary.
 *
 * Left open, the model reaches for decorative or near-duplicate emoji and a physics lecture ends up
 * captioned with 🔬 on every second line. A fixed list keeps the icons meaning-bearing, and lets the
 * server reject anything outside it rather than trusting the output.
 */
const ALLOWED_ICONS = [
  "☀️", "💧", "🌱", "💨", "⚡", "🍬", "🔬", "🔥", "🔢", "⏱️",
  "🏃", "⚖️", "➡️", "❓", "⭐", "📘", "🧩", "🔎", "🧠", "🔁",
  "📈", "📉", "🧪", "🌍", "🫀", "🔧", "💡", "📐", "🗺️", "🎯",
];

const SYSTEM_PROMPT =
  "You rewrite one part of a lesson for a student with dyslexia. Decoding dense text is slow and " +
  "effortful and eats the working memory they need to understand the idea, so your job is to carry " +
  "the SAME meaning in words that are easier to read.\n\n" +
  "Return JSON with exactly these keys: dense, simplest, simple, standard, syllables.\n\n" +
  "- dense: the single sentence that best states this beat's main idea, taken or lightly adapted " +
  "from the script. One sentence.\n" +
  "- simplest, simple, standard: arrays of short lines. Each line is {\"text\": string, \"icon\": string}.\n" +
  "    simplest — at most 5 lines, at most 6 words each, everyday words only, short common words " +
  "in place of technical ones wherever the meaning survives.\n" +
  "    simple   — at most 8 lines, at most 9 words each, plain language, technical terms allowed " +
  "when they are the point of the lesson.\n" +
  "    standard — at most 12 lines, at most 14 words each, full sentences, the real vocabulary.\n" +
  "  All three must teach the SAME content. They are one explanation at three densities, not three " +
  "different explanations. Never drop a fact from the lower levels — say it more plainly.\n" +
  "  Every line must be a complete, readable phrase. Never end a line on 'the', 'and', 'of', 'to' " +
  "or any word that leaves the reader mid-phrase.\n" +
  `    icon must be one of exactly these: ${ALLOWED_ICONS.join(" ")}\n` +
  "  Pick the icon for what the line is ABOUT. Do not repeat one icon down a whole level.\n" +
  "- syllables: an object mapping each word longer than six letters that you actually used to its " +
  "syllable split as an array of strings, e.g. {\"photosynthesis\": [\"pho\",\"to\",\"syn\",\"the\",\"sis\"]}. " +
  "The pieces must join back to the exact word. Include only genuinely hard words; an empty object " +
  "is fine.\n\n" +
  "Do not add facts the script does not contain. Do not add commentary or headings.";

type Line = { text: string; icon: string };

/** Keep only well-formed lines with an allowed icon, and cap the count. */
function sanitizeLines(value: unknown, maxLines: number): Line[] {
  if (!Array.isArray(value)) return [];
  const out: Line[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object") continue;
    const record = raw as Record<string, unknown>;
    const text = typeof record.text === "string" ? record.text.trim() : "";
    if (!text) continue;
    const icon = typeof record.icon === "string" ? record.icon.trim() : "";
    out.push({ text, icon: ALLOWED_ICONS.includes(icon) ? icon : "📘" });
    if (out.length >= maxLines) break;
  }
  return out;
}

/**
 * Keep only splits that actually reconstruct their word.
 *
 * A split that drops or adds a letter is worse than showing nothing — the student is being taught to
 * decode, and this is the part they would trust.
 */
function sanitizeSyllables(value: unknown): Record<string, string[]> {
  if (!value || typeof value !== "object") return {};
  const out: Record<string, string[]> = {};
  for (const [word, parts] of Object.entries(value as Record<string, unknown>)) {
    if (typeof word !== "string" || !Array.isArray(parts)) continue;
    const pieces = parts.filter((p): p is string => typeof p === "string" && p.length > 0);
    if (pieces.length < 2) continue;
    if (pieces.join("").toLowerCase() !== word.toLowerCase()) continue;
    out[word.toLowerCase()] = pieces;
  }
  return out;
}

export async function POST(req: Request) {
  if (!process.env.OPENAI_API_KEY) {
    // 503, not 500: the player falls back to its own splitter and the lesson continues.
    return NextResponse.json({ error: "OPENAI_API_KEY not set." }, { status: 503 });
  }

  const body = await req.json().catch(() => ({}));
  const script = typeof body.script === "string" ? body.script.trim() : "";
  const title = typeof body.title === "string" ? body.title.trim() : "";
  const points = Array.isArray(body.points)
    ? body.points.filter((p: unknown): p is string => typeof p === "string").slice(0, 8)
    : [];

  if (!script) return NextResponse.json({ error: "script is required" }, { status: 400 });

  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  try {
    const completion = await client.chat.completions.create({
      model: MODEL,
      temperature: 0.2,
      max_tokens: 1200,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content:
            `Beat title: ${title || "(untitled)"}\n` +
            (points.length ? `Key points: ${points.join("; ")}\n` : "") +
            `Script:\n${script}`,
        },
      ],
    });

    const parsed = JSON.parse(completion.choices[0]?.message?.content ?? "{}");
    const chunks = {
      simplest: sanitizeLines(parsed.simplest, 5),
      simple: sanitizeLines(parsed.simple, 8),
      standard: sanitizeLines(parsed.standard, 12),
    };

    // A level that came back empty is unusable; the caller keeps its own split for that level
    // rather than showing a blank stage.
    if (!chunks.simplest.length || !chunks.simple.length || !chunks.standard.length) {
      return NextResponse.json({ error: "The rewrite came back incomplete." }, { status: 502 });
    }

    return NextResponse.json({
      dense: typeof parsed.dense === "string" && parsed.dense.trim() ? parsed.dense.trim() : script.split(/(?<=[.!?])\s+/)[0],
      chunks,
      syllables: sanitizeSyllables(parsed.syllables),
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "The rewrite failed." },
      { status: 502 },
    );
  }
}

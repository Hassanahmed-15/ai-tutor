import { NextResponse } from "next/server";
import OpenAI from "openai";
import { currentUser } from "@/lib/auth";
import { countryName, customOption, sanitizeCountry, sanitizeOption, sanitizeOptions } from "@/lib/education";
import { costFor } from "@/lib/modelPricing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * AI SUGGESTIONS WHEN THE CATALOGUE HAS NOTHING (owner's choice, 2026-09-29: "curated list + AI for
 * gaps"). Onboarding calls this only after a search of lib/education.ts comes back empty or thin —
 * e.g. a Nigerian medical board exam, or a curriculum from a country the catalogue has no entries
 * for. Luna names real subjects, levels or exams/tracks for the learner's country, level and
 * subjects; the user can still type anything. Signed-in only, rate-limited per user, cached.
 */
const MODEL = process.env.OPENAI_EDUCATION_SUGGEST_MODEL ?? "gpt-5.6-luna";
const cache = new Map<string, { labels: string[]; at: number }>();
const usage = new Map<string, number[]>();

export async function POST(request: Request) {
  const session = await currentUser().catch(() => null);
  if (!session) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  if (!process.env.OPENAI_API_KEY) return NextResponse.json({ options: [] });

  const now = Date.now();
  const recent = (usage.get(session.userId) ?? []).filter((t) => now - t < 60_000);
  if (recent.length >= 20) return NextResponse.json({ options: [], limited: true });
  usage.set(session.userId, [...recent, now]);

  const body = await request.json().catch(() => ({}));
  const kind = body.kind === "subject" || body.kind === "level" || body.kind === "curriculum" ? body.kind : null;
  const query = typeof body.query === "string" ? body.query.trim().slice(0, 80) : "";
  if (!kind || query.length < 2) return NextResponse.json({ options: [] });
  const country = sanitizeCountry(body.country);
  const level = sanitizeOption(body.level);
  const subjects = sanitizeOptions(body.subjects, 8);

  const key = JSON.stringify([kind, query.toLowerCase(), country, level?.label, subjects.map((s) => s.label)]);
  const hit = cache.get(key);
  if (hit && now - hit.at < 7 * 24 * 60 * 60 * 1000) return NextResponse.json({ options: hit.labels.map(customOption) });

  const what = kind === "subject" ? "academic subjects" : kind === "level" ? "study levels (stages of education)" : "curricula, exams, qualifications or study tracks";
  try {
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const res = await client.chat.completions.create({
      model: MODEL,
      response_format: { type: "json_object" },
      max_completion_tokens: 1500,
      reasoning_effort: "low",
      messages: [
        {
          role: "system",
          content: `You suggest ${what} for a student's profile. Return JSON {"options": [string]} with up to 6 REAL, currently used names that match what the student typed, most likely first, using the official name as students in that country say it (e.g. "WAEC WASSCE", "Cambridge International AS & A Level", "FSc Pre-Medical"). Never invent a name. [] if nothing real matches.`,
        },
        {
          role: "user",
          content: `Typed: "${query}"\nCountry: ${country ? countryName(country) : "unknown"}\nStudy level: ${level?.label ?? "unknown"}\nSubjects: ${subjects.map((s) => s.label).join(", ") || "unknown"}`,
        },
      ],
    } as OpenAI.Chat.ChatCompletionCreateParamsNonStreaming);
    const raw = JSON.parse(res.choices[0]?.message?.content ?? "{}") as { options?: unknown };
    const labels = (Array.isArray(raw.options) ? raw.options : [])
      .filter((o): o is string => typeof o === "string" && o.trim().length > 1)
      .map((o) => o.trim().slice(0, 80))
      .slice(0, 6);
    cache.set(key, { labels, at: now });
    return NextResponse.json({ options: labels.map(customOption), costUsd: costFor(MODEL, res.usage) });
  } catch {
    return NextResponse.json({ options: [] });
  }
}

import { NextResponse } from "next/server";
import OpenAI from "openai";
import { currentUser } from "@/lib/auth";
import { databaseConfigured, migrateUserDoc, users, type UserDoc } from "@/lib/db/cosmos";
import { countryName } from "@/lib/education";
import { loadLearnerMemory } from "@/lib/learnerMemoryStore";
import { learnerProfileView } from "@/lib/learnerProfileView";
import { costFor } from "@/lib/modelPricing";
import { freshTilesFrom, promptTiles, type PromptTile } from "@/lib/promptTiles";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * THE HOMEPAGE'S LECTURE RECOMMENDATIONS (lib/promptTiles.ts). Reads the learner profile and memory
 * server-side — the page sends nothing — and has Luna suggest fresh lessons for their subjects,
 * level, curriculum and country, avoiding what they have mastered. Those fresh ideas are cached per
 * user per day (and per profile, so editing subjects in settings shows new ones straight away); the
 * tiles from memory are recomputed on every call, so a lesson just finished is reflected at once.
 * No model, no key, or a failure → the plain per-subject fallback; no profile → no tiles.
 */
const MODEL = process.env.OPENAI_PROMPT_TILES_MODEL ?? process.env.OPENAI_EDUCATION_SUGGEST_MODEL ?? "gpt-5.6-luna";
const cache = new Map<string, { tiles: PromptTile[]; at: number }>();
const DAY = 24 * 60 * 60 * 1000;

export async function GET() {
  if (!databaseConfigured()) return NextResponse.json({ tiles: [] });
  const session = await currentUser().catch(() => null);
  if (!session) return NextResponse.json({ error: "Sign in first." }, { status: 401 });

  const { resource: raw } = await users().item(session.userId, session.userId).read<UserDoc>().catch(() => ({ resource: undefined }));
  if (!raw) return NextResponse.json({ tiles: [] });
  const { doc: user } = migrateUserDoc(raw);
  const basics = user.profile?.learner ?? null;
  const memory = await loadLearnerMemory(session.userId).catch(() => null);
  const view = learnerProfileView(basics, memory);
  if (!basics?.subjects.length && view.subjects.length === 0) return NextResponse.json({ tiles: [] });

  const now = Date.now();
  const key = JSON.stringify([session.userId, new Date(now).toISOString().slice(0, 10), basics?.updatedAt ?? null]);
  let fresh = cache.get(key)?.tiles ?? null;
  let costUsd = 0;
  if (!fresh && basics?.subjects.length && process.env.OPENAI_API_KEY) {
    const mastered = view.subjects.flatMap((s) => s.mastered).map((c) => c.label).slice(0, 12);
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
            content:
              'You suggest short lesson requests a student could send to their AI tutor today. Return JSON {"tiles": [{"prompt": string, "subject": string}]} with 4 items, spread across their subjects. Each prompt is one concrete topic from their syllabus at their level, phrased as the student would ask it ("Explain how enzymes work", "Solve quadratic equations by factoring"), 3-9 words, using their curriculum\'s terminology. Nothing they have already mastered, nothing they are currently studying, no exam logistics.',
          },
          {
            role: "user",
            content: [
              `Country: ${basics.country ? countryName(basics.country) : "unknown"}`,
              `Study level: ${basics.studyLevel?.label ?? "unknown"}`,
              `Subjects: ${basics.subjects.map((s) => `${s.label}${basics.subjectLevels?.[s.id] ? ` (${basics.subjectLevels[s.id].label})` : ""}`).join(", ")}`,
              `Curriculum / exam / track: ${basics.curricula.map((c) => c.label).join(", ") || "not given"}`,
              `Already mastered: ${mastered.join(", ") || "nothing recorded yet"}`,
              `Currently studying: ${view.currentTopics.join(", ") || "nothing recorded yet"}`,
            ].join("\n"),
          },
        ],
      } as OpenAI.Chat.ChatCompletionCreateParamsNonStreaming);
      const parsed = JSON.parse(res.choices[0]?.message?.content ?? "{}") as { tiles?: unknown };
      fresh = freshTilesFrom(parsed.tiles);
      costUsd = costFor(MODEL, res.usage);
      if (fresh.length) cache.set(key, { tiles: fresh, at: now });
    } catch {
      fresh = null;
    }
  }
  for (const [k, v] of cache) if (now - v.at > DAY) cache.delete(k);

  return NextResponse.json({ tiles: promptTiles(view, fresh), ...(costUsd ? { costUsd } : {}) });
}

import { NextResponse } from "next/server";
import OpenAI from "openai";
import { DRAW_LECTURE_SYSTEM_PROMPT } from "@/lib/drawPrompt";
import { assertLectureDepth, lectureDepthStats, sanitizeDrawLecture, scriptWordCount } from "@/lib/drawSanitize";
import { fillImageOps } from "@/lib/imageGen";
import type { Beat } from "@/lib/lessonContent";

/**
 * Generates a full lecture for ANY typed topic using the DrawScript pipeline:
 *   Step 1 — gpt-4o writes the complete script, beat structure, and marker-drawn board
 *             layouts (including "image" op placeholders with a descriptive prompt per beat).
 *   Step 2 — the configured image model fills each image op placeholder with a real, topic-specific
 *             AI-generated illustration matched to that beat's content.
 *
 * The client then plays the enriched beats through LessonPlayer / the accessibility players —
 * the same shape as the curated photosynthesis demo, now generatable for any topic with
 * real contextual images and semantic live motion instead of generic fixed-template shapes.
 *
 * Honesty: costs a real gpt-4o call + several medium-quality image calls per lecture. Image
 * generation adds latency. Needs OPENAI_API_KEY in frontend/web/.env.local.
 */
const MODEL = process.env.OPENAI_LECTURE_MODEL ?? "gpt-4o";
const TEXT_ATTEMPTS = Math.max(1, Math.min(5, Number(process.env.OPENAI_LECTURE_ATTEMPTS ?? 4)));
const TEXT_MAX_TOKENS = Math.max(8_000, Math.min(16_000, Number(process.env.OPENAI_LECTURE_MAX_TOKENS ?? 14_000)));
const DEEPEN_ATTEMPTS = Math.max(1, Math.min(3, Number(process.env.OPENAI_LECTURE_DEEPEN_ATTEMPTS ?? 2)));

// gpt-4o pricing for the text-generation step (as of 2025, source: openai.com/api/pricing).
const TEXT_INPUT_PRICE  = 2.50 / 1_000_000;  // $2.50 per M input tokens
const TEXT_OUTPUT_PRICE = 10.0 / 1_000_000;  // $10.00 per M output tokens

function textCostUsd(usage: OpenAI.Chat.Completions.ChatCompletion["usage"] | undefined): number {
  return usage ? usage.prompt_tokens * TEXT_INPUT_PRICE + usage.completion_tokens * TEXT_OUTPUT_PRICE : 0;
}

function compactBeatsForDeepening(beats: Beat[]) {
  return beats.map((beat, index) => ({
    index,
    id: beat.id,
    title: beat.title,
    slideKind: beat.slideKind,
    points: beat.points,
    currentWords: scriptWordCount(beat.script),
    script: beat.script,
    checkpointPrompt: beat.checkpoint?.prompt,
  }));
}

function applyScriptPatchesToRawLecture(rawLecture: unknown, patches: unknown) {
  if (!rawLecture || typeof rawLecture !== "object") return;
  const rawBeats = (rawLecture as Record<string, unknown>).beats;
  if (!Array.isArray(rawBeats) || !Array.isArray(patches)) return;

  const byId = new Map<string, string>();
  for (const patch of patches) {
    if (!patch || typeof patch !== "object") continue;
    const p = patch as Record<string, unknown>;
    if (typeof p.id === "string" && typeof p.script === "string" && p.script.trim()) {
      byId.set(p.id, p.script.trim());
    }
  }

  for (const rawBeat of rawBeats) {
    if (!rawBeat || typeof rawBeat !== "object") continue;
    const beat = rawBeat as Record<string, unknown>;
    const id = typeof beat.id === "string" ? beat.id : "";
    const script = byId.get(id);
    if (script) beat.script = script;
  }
}

async function deepenLectureScripts(client: OpenAI, topic: string, mood: string, rawLecture: unknown, beats: Beat[]): Promise<number> {
  let extraCostUsd = 0;
  let lastError = "Could not deepen the generated lecture.";

  for (let attempt = 0; attempt < DEEPEN_ATTEMPTS; attempt++) {
    try {
      const stats = lectureDepthStats(beats);
      const completion = await client.chat.completions.create({
        model: MODEL,
        messages: [
          {
            role: "system",
            content:
              "You deepen AI tutor lecture scripts. Return JSON only: {\"beats\":[{\"id\":string,\"script\":string}]}. " +
              "Preserve every id exactly. Do not change titles, visuals, checkpoints, or order. " +
              "Rewrite only the spoken script. Teaching beats need 75-95 words each. Intro needs 60-80 words. " +
              "Checkpoint scripts need 25-45 words. Recap needs 85-105 words. Total output should create 900-1100 spoken words. " +
              "Use warm natural spoken language, concrete examples, misconception warnings, and smooth transitions. No markdown, no bullets.",
          },
          {
            role: "user",
            content: JSON.stringify({
              topic,
              mood,
              failedDepthStats: stats,
              instruction:
                "Expand these scripts so the lecture feels like a real 5-minute explanation. Keep the same beat ids and return one script per beat.",
              beats: compactBeatsForDeepening(beats),
            }),
          },
        ],
        temperature: 0.5,
        max_tokens: TEXT_MAX_TOKENS,
        response_format: { type: "json_object" },
      });

      extraCostUsd += textCostUsd(completion.usage);
      const parsed = JSON.parse(completion.choices[0]?.message?.content ?? "{}") as Record<string, unknown>;
      applyScriptPatchesToRawLecture(rawLecture, parsed.beats);
      const deepenedBeats = sanitizeDrawLecture(rawLecture, { enforceDepth: false });
      assertLectureDepth(deepenedBeats);
      return extraCostUsd;
    } catch (err) {
      lastError = err instanceof Error ? err.message : "Could not deepen the generated lecture.";
    }
  }

  throw new Error(lastError);
}

export async function POST(req: Request) {
  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json(
      { error: "OPENAI_API_KEY not set — add it to frontend/web/.env.local to generate lectures." },
      { status: 503 }
    );
  }

  const body = await req.json().catch(() => ({}));
  const topic = typeof body.topic === "string" ? body.topic.trim() : "";
  const mood = typeof body.mood === "string" ? body.mood.trim().slice(0, 160) : "";
  if (!topic) return NextResponse.json({ error: "topic is required" }, { status: 400 });
  if (topic.length > 200) return NextResponse.json({ error: "topic is too long — keep it to a short phrase" }, { status: 400 });

  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  // Step 1: generate script + beat structure + DrawScript op layouts (text only, fast).
  // Retry malformed/too-short JSON responses before image generation runs. These text-only
  // retries are cheap compared with generating images and prevent spending money on bad shapes.
  let lastError = "The model did not return a usable lecture.";
  for (let attempt = 0; attempt < TEXT_ATTEMPTS; attempt++) {
    try {
      const retryGuidance = attempt > 0 ? ` Previous attempt failed: ${lastError}. Fix that failure in this attempt.` : "";
      const completion = await client.chat.completions.create({
        model: MODEL,
        messages: [
          { role: "system", content: DRAW_LECTURE_SYSTEM_PROMPT },
          {
            role: "user",
            content: `Teach this topic live: "${topic}". ${
              mood ? `Lesson mode: ${mood}. ` : ""
            }Build the complete lecture now: teacher script, animated drawn boards with contextual image ops, and checkpoints.${retryGuidance}`,
          },
        ],
        temperature: 0.55,
        max_tokens: TEXT_MAX_TOKENS,
        response_format: { type: "json_object" },
      });
      const raw = completion.choices[0]?.message?.content ?? "";
      const rawLecture = JSON.parse(raw);
      let beats = sanitizeDrawLecture(rawLecture, { enforceDepth: false });

      // Tally the text-generation cost from actual token usage.
      let textCost = textCostUsd(completion.usage);

      try {
        assertLectureDepth(beats);
      } catch {
        textCost += await deepenLectureScripts(client, topic, mood, rawLecture, beats);
        beats = sanitizeDrawLecture(rawLecture, { enforceDepth: false });
        assertLectureDepth(beats);
      }

      // Step 2: fill each "image" op placeholder with a real generated image matched to
      // that beat's content. Runs in parallel; individual failures degrade gracefully.
      const imageCostUsd = await fillImageOps(client, beats);

      const costUsd = textCost + imageCostUsd;
      return NextResponse.json({ topic, beats, costUsd });
    } catch (err) {
      lastError = err instanceof Error ? err.message : "Lecture generation failed";
    }
  }
  return NextResponse.json({ error: lastError }, { status: 502 });
}

import { NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { currentUser } from "@/lib/auth";
import { createOpenAI } from "@/lib/openaiClient";
import { checkpointItems } from "@/lib/curriculum/mastery";
import type { CurriculumTree } from "@/lib/curriculum/types";
import type { TestQuestion } from "@/lib/testPrompt";

/**
 * A course checkpoint: short-answer questions on a unit's lessons (or a class assessment across
 * every unit), written from the syllabus goals of exactly those lessons and pitched at the
 * course's level. One question per lesson; each question's `beatId` is the lesson's key, so the
 * grade (/api/grade-test, unchanged) maps straight back to lesson mastery (lib/curriculum/mastery.ts).
 *
 * Signed-in students only — it is one model call. The page keeps the bank, so a retake is free.
 */
const MODEL = process.env.OPENAI_TEST_MODEL ?? "gpt-5.6-luna";

export async function POST(req: Request) {
  if (!(await currentUser())) return NextResponse.json({ error: "Sign in to take a checkpoint." }, { status: 401 });
  if (!process.env.OPENAI_API_KEY) return NextResponse.json({ error: "OPENAI_API_KEY not set." }, { status: 503 });

  const body = (await req.json().catch(() => ({}))) as { courseId?: string; grade?: string; unitId?: string | null };
  const courseId = String(body.courseId ?? "");
  if (!/^[a-z0-9][a-z0-9-]{0,120}$/.test(courseId)) return NextResponse.json({ error: "Unknown course" }, { status: 404 });
  let tree: CurriculumTree;
  try {
    tree = JSON.parse(await readFile(path.join(process.cwd(), "data/curricula/trees", `${courseId}.json`), "utf8"));
  } catch {
    return NextResponse.json({ error: "Unknown course" }, { status: 404 });
  }
  const block = tree.grades.find((g) => g.grade === body.grade) ?? tree.grades[0];
  const items = checkpointItems(block, body.unitId ?? null);
  if (!items.length) return NextResponse.json({ error: "Nothing to assess here yet." }, { status: 400 });

  const course = [tree.qualification, tree.board, tree.subject].filter(Boolean).join(" ");
  const level = block.grade === "all" ? "" : ` (${block.grade})`;
  const system = `You write a short checkpoint for a student taking ${course}${level}. For each numbered lesson, write ONE short-answer question that checks the lesson's goals — at exactly this course's level and in its terms (no harder, no easier), answerable in 1-3 sentences or a short calculation, with no multiple choice and nothing the goals do not cover.
Return JSON only: {"questions":[{"n": number, "prompt": string, "keyPoints": string[] (2-4 points a correct answer must contain), "modelAnswer": string, "commonMistake": string}]} — one per lesson, in order, n = the lesson's number.`;
  const user = items.map((it, i) => `${i + 1}. Lesson "${it.lessonTitle}" (unit: ${it.unitTitle}). Goals: ${it.goals.join("; ")}`).join("\n");

  try {
    const client = createOpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const completion = await client.chat.completions.create({
      model: MODEL,
      messages: [{ role: "system", content: system }, { role: "user", content: user }],
      response_format: { type: "json_object" },
    });
    const raw = JSON.parse(completion.choices[0]?.message?.content ?? "{}") as {
      questions?: Array<{ n?: number; prompt?: string; keyPoints?: string[]; modelAnswer?: string; commonMistake?: string }>;
    };
    const questions: TestQuestion[] = (raw.questions ?? []).flatMap((q, i) => {
      const item = items[(typeof q.n === "number" ? q.n : i + 1) - 1];
      if (!item || typeof q.prompt !== "string" || !q.prompt.trim()) return [];
      return [{
        id: `q${i + 1}`,
        beatId: item.lessonKey,
        prompt: q.prompt.trim().slice(0, 600),
        oralPhrasing: q.prompt.trim().slice(0, 600),
        rubric: {
          keyPoints: (q.keyPoints ?? []).filter((k) => typeof k === "string").slice(0, 4),
          modelAnswer: String(q.modelAnswer ?? "").slice(0, 800),
          commonMistake: q.commonMistake ? String(q.commonMistake).slice(0, 300) : undefined,
        },
      }];
    });
    if (!questions.length) return NextResponse.json({ error: "Could not write this checkpoint — try again." }, { status: 502 });
    return NextResponse.json({ questions, lessons: items.map((i) => ({ lessonKey: i.lessonKey, title: i.lessonTitle })) });
  } catch {
    return NextResponse.json({ error: "Could not write this checkpoint — try again." }, { status: 502 });
  }
}

import { NextResponse } from "next/server";
import { lessonCaller } from "@/lib/auth";
import { planOptions } from "@/lib/practice/generate";
import { practiceExamOn } from "@/lib/practice/rules";
import { practiceSpend } from "@/lib/practice/spend";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** PRACTICE EXAM PLANNING (docs/practice-exam.md): the subtopics, likely exams and a suggested paper for a typed topic. One cheap luna call. */
export async function POST(req: Request) {
  if (!practiceExamOn()) return NextResponse.json({ error: "Not found." }, { status: 404 });
  const caller = await lessonCaller();
  if (!caller) return NextResponse.json({ error: "Sign in to practise." }, { status: 401 });
  const b = (await req.json().catch(() => ({}))) as { topic?: unknown; level?: unknown };
  const topic = String(b.topic ?? "").replace(/\s+/g, " ").trim().slice(0, 200);
  const level = String(b.level ?? "").replace(/\s+/g, " ").trim().slice(0, 80) || undefined;
  if (topic.length < 2) return NextResponse.json({ error: "Type a topic to practise." }, { status: 400 });
  try {
    const { options, costUsd } = await practiceSpend(caller.userId, () => planOptions(topic, level));
    console.log(`[practice-exam] plan options for "${topic.slice(0, 60)}": ${options.subtopics.length} subtopics, $${costUsd.toFixed(4)}`);
    return NextResponse.json(options);
  } catch (error) {
    console.warn("[practice-exam] plan options failed:", (error as Error).message);
    return NextResponse.json({ error: "Aria could not plan this test just now. Please try again." }, { status: 502 });
  }
}

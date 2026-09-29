import { NextResponse } from "next/server";
import { complete, LAB_MODEL } from "../../../lib/openai";
import { PLAN_SYSTEM, planUser } from "../../../lib/prompts";
import type { Beat, Lecture } from "../../../lib/lecture";

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const prompt = typeof body.prompt === "string" ? body.prompt.trim().slice(0, 1000) : "";
  // Up to 10: production plans 6 (concise), 8 (standard) or 10 (deep) beats — beatCountForDepth.
  const count = Math.max(1, Math.min(10, Number(body.beats) || 8));
  if (!prompt) return NextResponse.json({ error: "prompt is required" }, { status: 400 });

  try {
    const res = await complete(PLAN_SYSTEM, planUser(prompt, count), { json: true, maxTokens: 14_000 });
    const parsed = JSON.parse(res.text) as { title?: string; beats?: Partial<Beat>[] };
    const beats: Beat[] = (parsed.beats ?? [])
      .filter((b) => b && typeof b.title === "string" && typeof b.script === "string")
      .slice(0, count)
      .map((b, i) => ({
        id: `b${i}`,
        title: String(b.title).slice(0, 200),
        teachingPoint: String(b.teachingPoint ?? b.title).slice(0, 600),
        script: String(b.script).slice(0, 2000),
      }));
    if (!beats.length) throw new Error(`planner returned no beats (finish=${res.finish})`);
    const lecture: Lecture = { title: parsed.title ?? prompt, prompt, beats };
    return NextResponse.json({ lecture, ms: res.ms, costUsd: res.costUsd, model: LAB_MODEL });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}

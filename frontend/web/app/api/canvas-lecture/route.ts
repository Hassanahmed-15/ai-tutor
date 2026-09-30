import { NextResponse } from "next/server";
import { generateCanvasLecture } from "@/lib/canvas/generate";
import { canvasLecturesToday, canvasStoreReady, listCanvasLectures, loadCanvasLecture } from "@/lib/canvas/store";
import { canvasDailyLimit, canvasUser } from "./access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** GET ?id=… opens one of the student's lectures; with no id, lists them (newest first). */
export async function GET(request: Request) {
  const who = await canvasUser();
  if ("error" in who) return NextResponse.json({ error: who.error }, { status: who.status });
  const id = new URL(request.url).searchParams.get("id");
  if (!id) {
    const limit = canvasDailyLimit();
    const used = limit ? await canvasLecturesToday(who.userId) : 0;
    return NextResponse.json({ lectures: await listCanvasLectures(who.userId), dailyLimit: limit, usedToday: used });
  }
  const lecture = await loadCanvasLecture(who.userId, id);
  return lecture ? NextResponse.json(lecture) : NextResponse.json({ error: "No such lecture." }, { status: 404 });
}

/** POST {topic} streams NDJSON: progress lines, then {type:"done", lecture} or {type:"error"}. */
export async function POST(request: Request) {
  const who = await canvasUser();
  if ("error" in who) return NextResponse.json({ error: who.error }, { status: who.status });
  if (!canvasStoreReady()) return NextResponse.json({ error: "Lecture storage is not configured." }, { status: 503 });
  const body = (await request.json().catch(() => ({}))) as { topic?: unknown };
  const topic = typeof body.topic === "string" ? body.topic.replace(/\s+/g, " ").trim().slice(0, 200) : "";
  if (topic.length < 3) return NextResponse.json({ error: "Tell me what you'd like to learn about." }, { status: 400 });
  const limit = canvasDailyLimit();
  if (limit && (await canvasLecturesToday(who.userId)) >= limit) {
    return NextResponse.json({ error: `You've made ${limit} canvas lectures today — that's the daily limit for the beta. Your saved lectures are below.` }, { status: 429 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (line: unknown) => controller.enqueue(encoder.encode(`${JSON.stringify(line)}\n`));
      try {
        const lecture = await generateCanvasLecture(topic, who.userId, (p) => send({ type: "progress", ...p }));
        console.log(`[canvas] ${lecture.id} "${lecture.title}" user=${who.userId} ${Math.round(lecture.ms / 1000)}s $${lecture.costUsd}\n  ${lecture.log.join("\n  ")}`);
        send({ type: "done", lecture });
      } catch (error) {
        console.error("[canvas] generation failed", error);
        send({ type: "error", error: "The lecture couldn't be made just now — please try again." });
      } finally {
        controller.close();
      }
    },
  });
  // No buffering between here and the browser: progress lines must arrive as they happen.
  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store", "X-Accel-Buffering": "no" } });
}

import { NextResponse } from "next/server";
import OpenAI from "openai";
import { fillReactAnimationOps } from "@/lib/reactAnimationGen";
import type { Beat } from "@/lib/lessonContent";

/**
 * Generates ONE sandbox board from a title + teaching point, for `/sandbox-lab`.
 *
 * WHY THIS EXISTS. Judging sandbox quality used to mean generating a whole lecture (90-260s, ~$0.2)
 * and hoping an animation beat appeared. Iterating on the prompt that way is so slow that it does
 * not get done — which is the real reason these boards stayed poor while everything around them
 * improved. This turns the loop into one call against one beat.
 *
 * Dev-only by construction: it takes a free-text brief, so it must never be reachable in a
 * deployment where that is a cost or abuse surface.
 */
export async function POST(req: Request) {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "sandbox-board is a development harness" }, { status: 404 });
  }
  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json({ error: "OPENAI_API_KEY not set." }, { status: 503 });
  }

  const body = await req.json().catch(() => ({}));
  const title = typeof body.title === "string" ? body.title.trim().slice(0, 200) : "";
  const teachingPoint = typeof body.teachingPoint === "string" ? body.teachingPoint.trim().slice(0, 600) : "";
  const script = typeof body.script === "string" ? body.script.trim().slice(0, 2000) : "";
  if (!title || !teachingPoint) {
    return NextResponse.json({ error: "title and teachingPoint are required" }, { status: 400 });
  }

  const beat: Beat = {
    id: "lab",
    title,
    script: script || teachingPoint,
    teacherMove: "explain",
    points: [],
    slideKind: "concept",
    draw: {
      caption: title,
      durationMs: 25_000,
      ops: [{ kind: "reactAnimation", teachingPoint, at: 0, endAt: 1 }],
    },
  } as unknown as Beat;

  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const stats = await fillReactAnimationOps(client, [beat]);

  const op = (beat.draw?.ops ?? []).find((o) => o.kind === "reactAnimation") as
    | { code?: string; assetIds?: string[]; status?: string; error?: string; critique?: unknown }
    | undefined;

  return NextResponse.json({
    code: op?.code ?? null,
    assetIds: op?.assetIds ?? [],
    status: op?.status ?? null,
    error: op?.error ?? null,
    critique: op?.critique ?? null,
    stats,
  });
}

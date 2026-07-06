import { NextResponse } from "next/server";
import { sanitizeDrawLecture } from "@/lib/drawSanitize";
import rawFixture from "./fixture.json";

export async function POST() {
  try {
    const beats = sanitizeDrawLecture(rawFixture, { enforceDepth: false });
    return NextResponse.json({ beats, topic: (rawFixture as Record<string, unknown>).topic ?? "fixture", costUsd: 0 });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

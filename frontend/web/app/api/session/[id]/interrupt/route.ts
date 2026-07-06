import { NextResponse } from "next/server";
import { getSessionRecord } from "@/lib/sessionStore";
import { renderSessionView } from "@/lib/render";

/** Implements the Living Lecture Engine interrupt flow (README 4.2): student interrupts mid-beat. */
export async function POST(req: Request, ctx: RouteContext<"/api/session/[id]/interrupt">) {
  const { id } = await ctx.params;
  const record = getSessionRecord(id);
  if (!record) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }
  const body = await req.json();
  const utterance = typeof body.utterance === "string" ? body.utterance : "";
  if (!utterance.trim()) {
    return NextResponse.json({ error: "utterance is required" }, { status: 400 });
  }

  const graph = await record.session.handleInterrupt(utterance);
  return NextResponse.json(renderSessionView(graph, record.lens));
}

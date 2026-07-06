import { NextResponse } from "next/server";
import { getSessionRecord } from "@/lib/sessionStore";
import { renderSessionView } from "@/lib/render";

/** Moves the session to the next teaching beat in the main sequence. */
export async function POST(_req: Request, ctx: RouteContext<"/api/session/[id]/advance">) {
  const { id } = await ctx.params;
  const record = getSessionRecord(id);
  if (!record) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }
  const graph = record.session.advanceToNextNode();
  return NextResponse.json(renderSessionView(graph, record.lens));
}

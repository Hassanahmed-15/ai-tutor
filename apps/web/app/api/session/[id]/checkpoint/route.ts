import { NextResponse } from "next/server";
import { getSession } from "@/lib/sessionStore";

/** Submits a student's response to the current checkpoint node for evaluation (README 4.3 Confusion Radar signal). */
export async function POST(req: Request, ctx: RouteContext<"/api/session/[id]/checkpoint">) {
  const { id } = await ctx.params;
  const session = getSession(id);
  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }
  const body = await req.json();
  const response = typeof body.response === "string" ? body.response : "";

  try {
    const result = await session.submitCheckpointResponse(response);
    return NextResponse.json(result);
  } catch {
    return NextResponse.json(
      { error: "The current beat is not a checkpoint — nothing to evaluate." },
      { status: 400 }
    );
  }
}

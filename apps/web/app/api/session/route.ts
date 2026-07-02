import { NextResponse } from "next/server";
import { createSession } from "@/lib/sessionStore";
import { renderSessionView } from "@/lib/render";
import type { ModalityLens } from "@aria/modality-lenses";

const VALID_LENS_IDS: ModalityLens["id"][] = ["default", "dyslexia"];

/** Creates a new tutoring session for a subject/topic/lens and starts the lesson plan. */
export async function POST(request: Request) {
  const body = await request.json();
  const subject = typeof body.subject === "string" ? body.subject : "cs-fundamentals";
  const topic = typeof body.topic === "string" ? body.topic : "binary-search";
  const requestedLens = typeof body.lens === "string" ? body.lens : "default";
  const lensId = (VALID_LENS_IDS as string[]).includes(requestedLens)
    ? (requestedLens as ModalityLens["id"])
    : "default";

  try {
    const { id, session, lens } = createSession(subject, topic, lensId);
    const graph = await session.start();
    return NextResponse.json({ sessionId: id, ...renderSessionView(graph, lens) });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to start lesson";
    // 400: caller asked for a topic we can't serve (no key / no corpus). 502: model/network failure.
    const status = message.includes("OPENAI_API_KEY") || message.includes("No content") ? 400 : 502;
    return NextResponse.json({ error: message }, { status });
  }
}

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

  const { id, session, lens } = createSession(subject, topic, lensId);
  const graph = await session.start();

  return NextResponse.json({ sessionId: id, ...renderSessionView(graph, lens) });
}

"use client";
/**
 * Dev-only: the REAL LessonPlayer with its seeded demo lecture.
 *
 * The app routes by component swap behind an auth gate, so the lecture UI cannot otherwise be
 * looked at without signing in — which is exactly how a board redesign got built, verified against
 * a harness, and shipped without ever touching the screen the student actually sees.
 */
import { useEffect, useState } from "react";
import { LessonPlayer } from "@/components/LessonPlayer";
import { PREVIEW_LECTURES, type PreviewKey } from "@/lib/board/previewLectures";

export default function PlayerPreview() {
  const [preview, setPreview] = useState<PreviewKey | null>(null);
  useEffect(() => {
    const requested = new URLSearchParams(window.location.search).get("topic");
    if (requested && requested in PREVIEW_LECTURES) queueMicrotask(() => setPreview(requested as PreviewKey));
  }, []);
  const lecture = preview ? PREVIEW_LECTURES[preview] : null;
  return <LessonPlayer key={preview ?? "demo"} beats={lecture?.beats} title={lecture?.title} autoVoiceAssistant={false} onExit={() => undefined} />;
}

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
import { PREVIEW_LECTURES, pendingBoardLecture, type PreviewKey } from "@/lib/board/previewLectures";

export default function PlayerPreview() {
  const [preview, setPreview] = useState<PreviewKey | null>(null);
  /*
   * `?pending=1` withholds the first board's content, reproducing a beat whose board is still
   * being generated. Every seeded lecture here ships fully filled, which is why this harness kept
   * passing while the real, progressively-generated lecture showed a blank board.
   */
  const [pending, setPending] = useState(false);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const requested = params.get("topic");
    if (params.get("pending") === "1") queueMicrotask(() => setPending(true));
    if (requested && requested in PREVIEW_LECTURES) queueMicrotask(() => setPreview(requested as PreviewKey));
  }, []);
  const lecture = pending ? pendingBoardLecture() : preview ? PREVIEW_LECTURES[preview] : null;
  return <LessonPlayer key={pending ? "pending" : preview ?? "demo"} beats={lecture?.beats} title={lecture?.title} autoVoiceAssistant={false} onExit={() => undefined} />;
}

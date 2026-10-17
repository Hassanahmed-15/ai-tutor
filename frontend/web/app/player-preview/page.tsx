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
import { PREVIEW_LECTURES, pendingBoardLecture, sandboxBoardLecture, type PreviewKey } from "@/lib/board/previewLectures";

export default function PlayerPreview() {
  const [preview, setPreview] = useState<PreviewKey | null>(null);
  /*
   * `?pending=1` withholds the first board's content, reproducing a beat whose board is still
   * being generated. Every seeded lecture here ships fully filled, which is why this harness kept
   * passing while the real, progressively-generated lecture showed a blank board.
   */
  const [pending, setPending] = useState(false);
  /* `?sandbox=1` gives the first beat a real generated-style animation, so the sandbox load,
     ready signal and sentence-by-sentence reveal — the path a real lecture takes — are exercised. */
  const [sandbox, setSandbox] = useState(false);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const requested = params.get("topic");
    if (params.get("pending") === "1") queueMicrotask(() => setPending(true));
    if (params.get("sandbox") === "1") queueMicrotask(() => setSandbox(true));
    if (requested && requested in PREVIEW_LECTURES) queueMicrotask(() => setPreview(requested as PreviewKey));
  }, []);
  /* `?session=<id>` plays a generated lecture (GET /api/progressive-lectures/<id>), `&start=<n>` from
     its n-th board — the real canvas lecture in the real player, for checking a board's task card. */
  const [session, setSession] = useState<{ beats: NonNullable<Parameters<typeof LessonPlayer>[0]["beats"]>; title: string; start: number } | null>(null);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const id = params.get("session");
    if (!id) return;
    const start = Math.max(0, Number(params.get("start") ?? 1) - 1);
    void fetch(`/api/progressive-lectures/${encodeURIComponent(id)}`)
      .then((r) => r.json())
      .then((snap) => setSession({ beats: (snap.beats ?? []).filter(Boolean), title: snap.topic ?? "Lecture", start }));
  }, []);
  if (session) return <LessonPlayer key="session" beats={session.beats} title={session.title} startIndex={session.start} autoVoiceAssistant={false} onExit={() => undefined} />;
  const lecture = sandbox ? sandboxBoardLecture() : pending ? pendingBoardLecture() : preview ? PREVIEW_LECTURES[preview] : null;
  return <LessonPlayer key={sandbox ? "sandbox" : pending ? "pending" : preview ?? "demo"} beats={lecture?.beats} title={lecture?.title} autoVoiceAssistant={false} onExit={() => undefined} />;
}

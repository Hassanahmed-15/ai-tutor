"use client";
/**
 * Dev-only: the REAL LessonPlayer with its seeded demo lecture.
 *
 * The app routes by component swap behind an auth gate, so the lecture UI cannot otherwise be
 * looked at without signing in — which is exactly how a board redesign got built, verified against
 * a harness, and shipped without ever touching the screen the student actually sees.
 */
import { LessonPlayer } from "@/components/LessonPlayer";

export default function PlayerPreview() {
  return <LessonPlayer onExit={() => undefined} />;
}

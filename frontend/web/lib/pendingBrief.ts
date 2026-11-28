/**
 * A one-shot handoff between the front page and the lesson builder.
 *
 * The app routes by swapping components on a `PageName`, not by URL, so there is no query string
 * or route param to carry a brief through. A topic could travel via sessionStorage, but a `File`
 * cannot be serialised — and asking the student to pick the same file twice because of an
 * implementation detail is not acceptable.
 *
 * So the file is held in a module variable for the moment between "chosen on the front page" and
 * "read by the builder". Deliberately consumed on read (`take`), so a later visit to the builder
 * cannot pick up a stale document from a lesson the student has already moved on from.
 *
 * This is not state anyone should subscribe to. It exists for exactly one hop.
 */
import type { CurriculumLessonRequest } from "@/lib/curriculum/lessonSpec";

export type PendingBrief = {
  topic: string;
  file: File | null;
  /** A YouTube link pasted into the prompt box: the lesson is a short version of that video. */
  videoUrl?: string;
  /** A course lesson by address: the builder fetches its spec + syllabus pages from the server. */
  curriculum?: CurriculumLessonRequest;
  /**
   * Pages photographed with the phone (the QR capture), already read and assembled into one document — the same
   * JSON /api/parse-pdf answers (app/api/capture/[id]/finish). The builder goes straight to reference/strict.
   */
  captured?: CapturedDocument;
  /**
   * "Explain my mistakes" after a practice test (components/practice, docs/practice-exam.md): a lecture with one
   * board per mistake, built straight from these (lib/practiceReview.ts), with no planning questions.
   */
  review?: PracticeReview;
};

export type PracticeMistake = {
  n: number;
  stem: string;
  studentAnswer: string;
  feedback: string;
  firstError?: { step: string; what: string; why: string };
  correctWorking: string[];
  subtopic: string;
};
export type PracticeReview = { title: string; mistakes: PracticeMistake[] };

/** The phone capture's assembled pages, in /api/parse-pdf's shape (plus the name shown for the "file"). */
export type CapturedDocument = Record<string, unknown> & { sourceDocument: unknown; fileName?: string; pageCount?: number; documentId?: string | null };

let pending: PendingBrief | null = null;

export function setPendingBrief(brief: PendingBrief): void {
  pending = brief;
}

/** Returns the pending brief and clears it. Null when there is nothing waiting. */
export function takePendingBrief(): PendingBrief | null {
  const held = pending;
  pending = null;
  return held;
}

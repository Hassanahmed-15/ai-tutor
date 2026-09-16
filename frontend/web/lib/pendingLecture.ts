import type { Beat } from "./lessonContent";
import type { LectureMode, LectureSourceType } from "./db/cosmos";

/** A one-shot replay handoff from the landing-page history into the lesson player. */
export type PendingLecture = {
  lectureId: string;
  topic: string;
  sourceType: LectureSourceType;
  mode: LectureMode;
  beats: Beat[];
};

let pending: PendingLecture | null = null;

export function setPendingLecture(lecture: PendingLecture): void {
  pending = lecture;
}

export function takePendingLecture(): PendingLecture | null {
  const held = pending;
  pending = null;
  return held;
}

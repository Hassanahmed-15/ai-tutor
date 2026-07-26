export type TeachBackOpening = {
  learnerLine: string;
  hiddenMissingLink: string;
  lessonAnchor: string;
};

export type TeachBackReply = {
  learnerReply: string;
  understood: boolean;
  missingLink: string;
  nextQuestion: string;
  teachingMove: string;
};

export type MemoryCapsule = {
  id: string;
  topic: string;
  beatId: string;
  beatTitle: string;
  explanation: string;
  keywords: string[];
  createdAt: string;
};

export const MEMORY_CAPSULE_STORAGE_KEY = "aria-past-you-v1";

const clean = (value: unknown, max: number) =>
  typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, max) : "";

export function sanitizeTeachBackOpening(raw: unknown): TeachBackOpening | null {
  const obj = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  const learnerLine = clean(obj.learnerLine, 320);
  const hiddenMissingLink = clean(obj.hiddenMissingLink, 240);
  const lessonAnchor = clean(obj.lessonAnchor, 140);
  return learnerLine && hiddenMissingLink && lessonAnchor ? { learnerLine, hiddenMissingLink, lessonAnchor } : null;
}

export function sanitizeTeachBackReply(raw: unknown): TeachBackReply | null {
  const obj = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  const learnerReply = clean(obj.learnerReply, 320);
  const missingLink = clean(obj.missingLink, 260);
  const nextQuestion = clean(obj.nextQuestion, 240);
  const teachingMove = clean(obj.teachingMove, 180);
  if (!learnerReply || !missingLink || !teachingMove) return null;
  return {
    learnerReply,
    understood: obj.understood === true,
    missingLink,
    nextQuestion,
    teachingMove,
  };
}


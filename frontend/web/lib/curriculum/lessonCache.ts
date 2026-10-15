import { createHash } from "node:crypto";
import type { CurriculumLessonRequest, LessonSpec } from "./lessonSpec";

/** A curriculum lesson spec as cached in Cosmos (container curriculum-lessons), with its latest check. */
export type CachedLesson = {
  id: string;
  request: CurriculumLessonRequest;
  spec: LessonSpec;
  createdAt: string;
  model: string;
  /** Outcomes the model's own plan left untaught (filled in by completeSpec) — a quality signal. */
  modelGaps: number[];
  verification?: unknown;
};

/** 2: depth rules, board floor by level, out-of-scope no longer excludes named studies (2026-10-15). */
export const SPEC_VERSION = "spec-2";

/** One cache entry per course version + lesson address. */
export function cacheId(r: CurriculumLessonRequest): string {
  // SPEC_VERSION: bump when what a spec contains changes, so lessons planned the old way are replanned.
  return createHash("sha256").update([r.courseId, r.version, r.grade, r.unitId, r.topicId, r.lessonId, SPEC_VERSION].join("|")).digest("hex").slice(0, 40);
}

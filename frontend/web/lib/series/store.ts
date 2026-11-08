import { createHash } from "node:crypto";
import { learnerProfiles } from "../db/cosmos";
import type { CurriculumLessonRequest } from "../curriculum/lessonSpec";
export { nextPart } from "./split";

/**
 * WHERE A STUDENT IS IN A LESSON SERIES (lib/series/split.ts): which lessons of a course lesson they have
 * started and finished, so the next visit opens the next lesson — or the unfinished one again.
 *
 * One small document per student and course lesson in the learner-profiles container (partition
 * /userId), beside their profile and learner memory: no new container. Keyed without the course tree's
 * build, so progress survives a rebuild; when a rebuild changes how many lessons there are, the
 * progress starts again rather than pointing at lessons that moved.
 */
export type SeriesProgress = {
  id: string;
  userId: string;
  kind: "lesson-series";
  course: Omit<CurriculumLessonRequest, "version">;
  parts: number;
  /** The lessons' idea titles when progress was saved, to notice a re-split. */
  titles: string[][];
  started: number[];
  completed: number[];
  sessions: Record<string, string>;
  updatedAt: string;
};

function seriesId(userId: string, r: CurriculumLessonRequest): string {
  return `series:${createHash("sha256").update([userId, r.courseId, r.grade, r.unitId, r.topicId, r.lessonId].join("|")).digest("hex").slice(0, 32)}`;
}

export async function readSeries(userId: string, r: CurriculumLessonRequest): Promise<SeriesProgress | null> {
  try {
    const id = seriesId(userId, r);
    const { resource } = await learnerProfiles().item(id, userId).read<SeriesProgress>();
    return resource ?? null;
  } catch {
    return null;
  }
}

/** Notes that a lesson was started (with its lecture session) or finished. Best effort. */
export async function recordSeries(userId: string, r: CurriculumLessonRequest, titles: string[][], part: number, status: "started" | "completed", sessionId?: string): Promise<SeriesProgress | null> {
  try {
    const old = await readSeries(userId, r);
    const same = old && old.parts === titles.length && JSON.stringify(old.titles) === JSON.stringify(titles);
    const { version: _version, ...course } = r;
    const doc: SeriesProgress = {
      id: seriesId(userId, r),
      userId,
      kind: "lesson-series",
      course,
      parts: titles.length,
      titles,
      started: [...new Set([...(same ? old.started : []), part])].sort((a, b) => a - b),
      completed: [...new Set([...(same ? old.completed : []), ...(status === "completed" ? [part] : [])])].sort((a, b) => a - b),
      sessions: { ...(same ? old.sessions : {}), ...(sessionId ? { [String(part)]: sessionId } : {}) },
      updatedAt: new Date().toISOString(),
    };
    await learnerProfiles().items.upsert(doc);
    return doc;
  } catch {
    return null;
  }
}

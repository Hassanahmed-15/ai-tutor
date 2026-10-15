import type { GradeBlock, Unit } from "./types";

/**
 * COURSE PROGRESS: which lessons a student has started and mastered, and how they did on each
 * checkpoint (owner, 2026-10-14: "add course-level assessment and mastery checkpoints").
 *
 * A lesson is "started" when the student opens it from a course, and "mastered" when every
 * checkpoint question written for it is answered correctly. Each unit ends with a checkpoint (one
 * question per lesson, up to eight) and each class has a course assessment (questions spread over
 * every unit). Pure functions here; tests: lib/anim/courseMastery.test.ts. The page keeps the
 * progress per course in the browser (components/courses/CourseBrowser.tsx).
 */

export type LessonState = "started" | "mastered";
export type CourseProgress = {
  lessons: Record<string, { state: LessonState; at: string }>;
  checkpoints: Record<string, { score: number; total: number; at: string }>;
};

export const emptyProgress = (): CourseProgress => ({ lessons: {}, checkpoints: {} });

/** One lesson's address inside a course: grade / unit / topic / lesson ids. */
export const lessonKey = (grade: string, unitId: string, topicId: string, lessonId: string) => `${grade}/${unitId}/${topicId}/${lessonId}`;
/** A checkpoint's address: a unit's, or the whole class's ("grade/*"). */
export const checkpointKey = (grade: string, unitId?: string | null) => `${grade}/${unitId ?? "*"}`;

export function markStarted(p: CourseProgress, key: string, at = new Date().toISOString()): CourseProgress {
  if (p.lessons[key]?.state === "mastered") return p;
  return { ...p, lessons: { ...p.lessons, [key]: { state: "started", at } } };
}

/** The lessons a checkpoint asks about, each with the goals it may draw on. */
export type CheckpointItem = { lessonKey: string; lessonTitle: string; unitTitle: string; goals: string[] };

/**
 * What a checkpoint covers. A unit checkpoint takes one item per lesson (up to `max`, spread evenly
 * when the unit has more); a class assessment (no unit) spreads `max` items across all units.
 */
export function checkpointItems(block: GradeBlock, unitId: string | null, max = unitId ? 8 : 12): CheckpointItem[] {
  const units: Unit[] = unitId ? block.units.filter((u) => u.id === unitId) : block.units;
  const all: CheckpointItem[] = [];
  for (const u of units) for (const t of u.topics) for (const s of t.subtopics) {
    all.push({ lessonKey: lessonKey(block.grade, u.id, t.id, s.id), lessonTitle: s.title, unitTitle: u.title, goals: s.outcomes.map((o) => o.text) });
  }
  if (all.length <= max) return all;
  // Evenly spaced, so every part of the unit / class is represented.
  return Array.from({ length: max }, (_, i) => all[Math.floor((i * all.length) / max)]);
}

/**
 * A checkpoint's results into progress: its score is recorded, and each lesson whose questions
 * were all answered correctly becomes mastered (a wrong answer never un-masters a lesson mastered
 * earlier — the student keeps what they showed they know).
 */
export function applyCheckpoint(
  p: CourseProgress,
  key: string,
  results: Array<{ lessonKey: string; correct: boolean }>,
  at = new Date().toISOString(),
): CourseProgress {
  const byLesson = new Map<string, boolean>();
  for (const r of results) byLesson.set(r.lessonKey, (byLesson.get(r.lessonKey) ?? true) && r.correct);
  const lessons = { ...p.lessons };
  for (const [k, ok] of byLesson) if (ok) lessons[k] = { state: "mastered", at };
  const score = results.filter((r) => r.correct).length;
  const prev = p.checkpoints[key];
  // Keep the best attempt, so a retake can only help.
  const best = prev && prev.total === results.length && prev.score > score ? prev : { score, total: results.length, at };
  return { lessons, checkpoints: { ...p.checkpoints, [key]: best } };
}

/** Mastered / started / total lessons of one unit (or the whole class block). */
export function progressOf(p: CourseProgress, block: GradeBlock, unitId?: string): { mastered: number; started: number; total: number } {
  let mastered = 0;
  let started = 0;
  let total = 0;
  for (const u of block.units) {
    if (unitId && u.id !== unitId) continue;
    for (const t of u.topics) for (const s of t.subtopics) {
      total++;
      const st = p.lessons[lessonKey(block.grade, u.id, t.id, s.id)]?.state;
      if (st === "mastered") mastered++;
      else if (st === "started") started++;
    }
  }
  return { mastered, started, total };
}

/** The next lesson in source order, used for a visible recommended sequence. */
export function nextLesson(block: GradeBlock, p: CourseProgress): { key: string; title: string; unitTitle: string } | null {
  for (const u of block.units) for (const t of u.topics) for (const s of t.subtopics) {
    const key = lessonKey(block.grade, u.id, t.id, s.id);
    if (p.lessons[key]?.state !== "mastered") return { key, title: s.title, unitTitle: u.title };
  }
  return null;
}

/** A course is complete only when every lesson is mastered and the class assessment reaches 80%. */
export function courseCompletion(p: CourseProgress, block: GradeBlock): { complete: boolean; mastered: number; total: number; assessmentScore: number; assessmentTotal: number } {
  const progress = progressOf(p, block);
  const assessment = p.checkpoints[checkpointKey(block.grade)];
  const assessmentScore = assessment?.score ?? 0;
  const assessmentTotal = assessment?.total ?? 0;
  return {
    complete: progress.total > 0 && progress.mastered === progress.total && assessmentTotal > 0 && assessmentScore / assessmentTotal >= 0.8,
    mastered: progress.mastered,
    total: progress.total,
    assessmentScore,
    assessmentTotal,
  };
}

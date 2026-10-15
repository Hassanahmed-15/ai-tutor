/**
 * A topic typed on the signed-out welcome page, kept until the visitor has an account.
 *
 * Unlike lib/pendingBrief.ts (a module variable for one in-page hop), this must survive a page
 * load: "Continue with Google" leaves the site and comes back. sessionStorage lives exactly as long
 * as the tab, so the topic follows the visitor through sign-up and onboarding and is gone if they
 * close the tab. Consumed on read, so it starts one lesson, once.
 */
import type { CurriculumLessonRequest } from "@/lib/curriculum/lessonSpec";

const KEY = "aria.pendingTopic";

export function savePendingTopic(topic: string): void {
  try {
    const t = topic.trim();
    if (t) window.sessionStorage.setItem(KEY, t.slice(0, 2000));
    else window.sessionStorage.removeItem(KEY);
  } catch {
    // Storage blocked (private mode): the visitor simply types it again after joining.
  }
}

export function peekPendingTopic(): string | null {
  try {
    return window.sessionStorage.getItem(KEY);
  } catch {
    return null;
  }
}

/** Returns the waiting topic and clears it. Null when there is none. */
export function takePendingTopic(): string | null {
  const t = peekPendingTopic();
  try {
    window.sessionStorage.removeItem(KEY);
  } catch {
    // Nothing to clear.
  }
  return t;
}

/**
 * A course lesson chosen in the course browser (/courses), by address. The course browser is its own
 * page, so this too must survive a page load; the lesson's content is read on the server from the
 * course tree and syllabus, never from anything the browser carries.
 */
const CURRICULUM_KEY = "aria.pendingCurriculum";

export function savePendingCurriculum(request: CurriculumLessonRequest): void {
  try {
    window.sessionStorage.setItem(CURRICULUM_KEY, JSON.stringify(request));
  } catch {
    // Storage blocked: the student picks the lesson again.
  }
}

export function peekPendingCurriculum(): CurriculumLessonRequest | null {
  try {
    const raw = window.sessionStorage.getItem(CURRICULUM_KEY);
    const r = raw ? (JSON.parse(raw) as CurriculumLessonRequest) : null;
    return r && r.courseId && r.lessonId ? r : null;
  } catch {
    return null;
  }
}

export function takePendingCurriculum(): CurriculumLessonRequest | null {
  const r = peekPendingCurriculum();
  try {
    window.sessionStorage.removeItem(CURRICULUM_KEY);
  } catch {
    // Nothing to clear.
  }
  return r;
}

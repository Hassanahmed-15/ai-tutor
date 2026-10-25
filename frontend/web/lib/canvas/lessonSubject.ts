import { isMathsTopic } from "./predictCard";
import { isCsTopic } from "./subjectLook";
import type { SuprnotesLessonInput } from "../suprnotes";

/**
 * A COURSE LESSON IS TAUGHT AS ITS COURSE'S SUBJECT (owner, 2026-10-23: "a maths and computer science
 * lecture is never treated as something different"). The Chemistry lesson "Formulae" was taught as
 * maths — the title counted one maths word and no science word — and got working boards with almost
 * nothing written. Across the course catalogue, guessing from titles put 7% of other subjects' lessons
 * (24% once board titles were read too) in the maths/CS style, and missed 39% of maths lessons and 82%
 * of computer-science lessons ("Straight lines", "Networks", "Operating Systems").
 *
 * A course lesson carries its course's subject (lesson.subject, lib/curriculum/lessonSpec.ts): that
 * subject decides, once, at planning, and is stamped on every planned board (`subject`). Every place
 * that used to guess asks the stamp first and guesses only when there is none — so a lecture from a
 * typed prompt or a PDF is decided exactly as before.
 */
export type LessonSubject = "maths" | "cs" | "other";

const MATHS_NAME = /\b(?:math(?:s|ematics)?|statistics|calculus|precalculus|algebra|geometry|trigonometry|numeracy|further pure)\b/i;
const CS_NAME = /\b(?:computer|computing|information (?:and communication )?technology|ict|programming|digital technologies|software|cybersecurity|artificial intelligence|robotics)\b/i;
// A science or humanities word that comes FIRST names the subject: "Physics 1: Algebra-Based" is physics,
// "Physics C: Mechanics" too; "Computer Studies for Pre-Home Economics" stays computing.
const OTHER_NAME = /\b(?:physics|chemistry|biology|science|econom\w*|business|accounting|geography|history|english|reading|writing|literature|language|arts?|music|design|engineering|health|psychology|sociology|philosophy|religio\w*|studies)\b/i;

/** One subject name to maths, CS or other, by the subject word that comes first in it. */
function kindOfName(name: string): LessonSubject {
  const hits = ([["maths", MATHS_NAME], ["cs", CS_NAME], ["other", OTHER_NAME]] as const)
    .map(([kind, re]) => ({ kind, at: name.search(re) }))
    .filter((h) => h.at >= 0)
    .sort((a, b) => a.at - b.at);
  return hits[0]?.kind ?? "other";
}

/**
 * A course's subject name as maths, computer science or another subject — or null when the name joins
 * several subjects of different kinds ("English; Mathematics; Reading; Science; Writing"), so no one
 * subject holds for all its lessons.
 */
export function courseSubjectKind(name: string | undefined | null): LessonSubject | null {
  const n = (name ?? "").trim();
  if (!n) return null;
  const parts = n.split(/[;,]/).map((p) => p.trim()).filter(Boolean);
  const kinds = new Set(parts.map(kindOfName));
  return kinds.size === 1 ? [...kinds][0] : null;
}

/**
 * The subject a course lesson is taught as: its course's subject; for a course that joins several
 * subjects, the lesson's own title decides (the title alone — the lesson's content words made one
 * lesson in four look like maths).
 */
export function courseLessonSubject(doc: SuprnotesLessonInput | null | undefined, title = ""): LessonSubject | null {
  if (!doc) return null;
  const known = courseSubjectKind(doc.lesson?.subject);
  if (known) return known;
  const t = title || doc.lesson?.title || "";
  return isMathsTopic(t) ? "maths" : isCsTopic(t) ? "cs" : "other";
}

/** The subject stamped on a lecture's planned boards; undefined when nothing decided it (not a course lesson). */
export function plannedSubject(plan: ReadonlyArray<{ subject?: LessonSubject }> | null | undefined): LessonSubject | undefined {
  return plan?.find((b) => b.subject)?.subject;
}

/** Maths? The stamp when there is one, else the old guess. */
export function asMaths(subject: LessonSubject | undefined, guess: () => boolean): boolean {
  return subject ? subject === "maths" : guess();
}

/** Computer science? The stamp when there is one, else the old guess. */
export function asCs(subject: LessonSubject | undefined, guess: () => boolean): boolean {
  return subject ? subject === "cs" : guess();
}

/** Taught the maths/CS way (marker look, working boards, structure)? The stamp when there is one, else the old guess. */
export function asMathsOrCs(subject: LessonSubject | undefined, guess: () => boolean): boolean {
  return subject ? subject !== "other" : guess();
}

/**
 * Code teaching (real code, line by line, traced) inside a computer-science lecture: only a lesson about
 * programming, algorithms or data structures. A CS course's "Networks" or "Ethics and Ownership" lesson
 * is computer science, but it is not taught through code.
 */
export function asCodeLesson(subject: LessonSubject | undefined, guess: () => boolean): boolean {
  return subject ? subject === "cs" && guess() : guess();
}

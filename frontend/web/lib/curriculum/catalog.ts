import type { CurriculumTree, Region } from "./types";

/**
 * THE CATALOGUE INDEX: one light line per curriculum tree, grouped the way a student looks for a
 * course (region → course family → subject → grade), like the "Select course" menu the owner liked
 * on Cognito. Built by scripts/curriculum/catalog.mts into data/curricula/catalog.json and served
 * by /api/curricula; each full tree is served by /api/curricula/<id>.
 */
export type CatalogEntry = {
  id: string;
  region: Region;
  family: string;
  subject: string;
  board: string | null;
  qualification: string | null;
  syllabusCode: string | null;
  framework: string;
  gradeSystem: CurriculumTree["gradeSystem"];
  grades: Array<{ grade: string; units: number; lessons: number }>;
  lessons: number;
  outcomes: number;
  coverage: number | null;
  /** Machine-checkable source coverage. Partial trees must not be presented as complete courses. */
  missingCodes: number;
  quality: "verified" | "review";
};

export const REGION_LABEL: Record<Region, string> = {
  PK: "Pakistan",
  US: "United States",
  UK: "United Kingdom",
  INTL: "International",
  IN: "India",
  AU: "Australia",
};

/** The course family a student would pick first ("GCSE · AQA", "Cambridge O Level", "AP"…). */
export function familyOf(t: Pick<CurriculumTree, "region" | "framework" | "board" | "qualification">): string {
  const q = t.qualification?.trim();
  const b = t.board?.trim();
  if (t.region === "INTL" && b === "Cambridge") return `Cambridge ${q ?? "curriculum"}`.replace(/Cambridge Cambridge/, "Cambridge");
  if (t.region === "INTL" && b === "IB") return q ? `IB ${q}`.replace(/IB IB/, "IB") : "IB";
  if (t.region === "UK" && b && q && /gcse|a level|as/i.test(q)) return `${q} · ${b}`;
  if (q && b && !q.includes(b)) return `${q} · ${b}`;
  return q || t.framework;
}

export function catalogEntry(t: CurriculumTree): CatalogEntry {
  let lessons = 0;
  let outcomes = 0;
  const grades = t.grades.map((g) => {
    let l = 0;
    for (const u of g.units) for (const tp of u.topics) {
      l += tp.subtopics.length;
      for (const s of tp.subtopics) outcomes += s.outcomes.length;
    }
    lessons += l;
    return { grade: g.grade, units: g.units.length, lessons: l };
  });
  const missingCodes = t.build.missingCodes.length;
  const quality = missingCodes === 0 && (t.build.coverage === null || t.build.coverage >= 0.999) ? "verified" : "review";
  return {
    id: t.id,
    region: t.region,
    family: familyOf(t),
    subject: t.subject,
    board: t.board,
    qualification: t.qualification,
    syllabusCode: t.syllabusCode,
    framework: t.framework,
    gradeSystem: t.gradeSystem,
    grades,
    lessons,
    outcomes,
    coverage: t.build.coverage,
    missingCodes,
    quality,
  };
}

/** The words a lesson request is made of: what to teach, for whom, and what it must cover. */
export function lessonBrief(t: Pick<CurriculumTree, "subject" | "framework" | "board" | "qualification" | "gradeSystem">, grade: string, unit: string, topic: string, lesson: { title: string; outcomes: Array<{ text: string }> }): string {
  const course = [t.qualification, t.board, t.subject].filter(Boolean).join(" ");
  const level = grade === "all" ? "" : ` (${t.gradeSystem} ${grade})`;
  const cover = lesson.outcomes.map((o) => o.text.replace(/\.$/, "")).join("; ");
  return `${studentLessonTitle(lesson.title, lesson.outcomes, topic)} — ${course}${level}, ${unit} › ${topic}. By the end the student should: ${cover}.`;
}

/**
 * Source extractors sometimes leave a benchmark label or a fragment as the lesson title. Those
 * labels are useful in the audit, but are not a usable student-facing lesson name. Prefer the
 * first approved outcome as a concise title while retaining the original id and outcome text.
 */
export function studentLessonTitle(title: string, outcomes: Array<{ text: string }> = [], context?: string): string {
  const clean = title.replace(/^\s*\[[^\]]*\]\s*/, "").replace(/\s+/g, " ").trim();
  const fragment = /(?:benchmark\s+[ivx\d]+\s*:\s*)?(?:use|apply|examine|critique|describe|explain|understand|identify|learning objective|essential knowledge)\s+(?:appropriate|a wide range of)?\s*$/i.test(clean)
    || /^(?:learning objective|essential knowledge|objective|benchmark(?:\s+[ivx\d]+)?)$/i.test(clean)
    || /(?:\b(?:of|to|for|and|or|with|in|on|appropriate)\s*)$/i.test(clean);
  if (fragment) {
    const source = outcomes.find((o) => typeof o.text === "string" && o.text.trim())?.text.trim();
    if (source) {
      const short = source.split(/[.;:]/)[0].trim();
      if (short.length <= 72) return short;
      const clipped = short.slice(0, 72).replace(/\s+\S*$/, "").trim();
      if (clipped) return `${clipped}…`;
    }
    if (context) return `${context} lesson`;
  }
  return clean || (context ? `${context} lesson` : "Lesson");
}

import { readFile } from "node:fs/promises";
import path from "node:path";
import type { CurriculumTree } from "./types";
import { lessonKey } from "./mastery";
import type { CurriculumLessonRequest, Evidence } from "./lessonSpec";

const DATA = path.join(process.cwd(), "data/curricula");

export function gradeLabel(tree: CurriculumTree, grade: string): string {
  if (grade === "all") return tree.qualification ?? tree.framework;
  if (/^\d+$/.test(grade)) return tree.region === "PK" ? `Class ${grade}` : `Grade ${grade}`;
  return grade;
}

export async function evidenceFor(r: CurriculumLessonRequest): Promise<Evidence[]> {
  try {
    const file = JSON.parse(await readFile(path.join(DATA, "sources", `${r.courseId}.json`), "utf8")) as { lessons: Record<string, Evidence[]> };
    const exact = file.lessons[lessonKey(r.grade, r.unitId, r.topicId, r.lessonId)] ?? [];
    if (exact.length) return exact;
    // A syllabus may split one tree subtopic into several source-sized lessons. The course tree
    // remains the stable student address; when its exact leaf is absent, use the source entries
    // for the same topic so the generated lesson still has official page evidence.
    return Object.entries(file.lessons)
      .filter(([key]) => key.split("/").includes(r.topicId))
      .flatMap(([, evidence]) => evidence);
  } catch {
    return [];
  }
}

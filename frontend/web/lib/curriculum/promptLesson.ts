/**
 * A TYPED PROMPT TAUGHT AS A COURSE LESSON (owner 2026-11-28: "the course lectures' teaching style … I want it to
 * teach the same way in prompting … only the things that are in courses, nothing extra"; every subject, maths and CS
 * too). After the prompt's own planning (its questions about the student and the approved outline), the topic
 * becomes a course LessonSpec — from the official syllabus when the student's course has this topic
 * (lib/curriculum/syllabusOutcomes.ts), else from the approved outline's parts — and then the same lesson
 * document a course lesson is (lessonDocument). From there the lecture is built exactly as a course lesson is:
 * the plan board, idea → worked example → your turn, course pictures, exam practice, the check board.
 * PROMPTS_AS_COURSES=on (app/api/prompt-lesson). Pure: no server code, so the tests can import it.
 */
import type { CurriculumLessonRequest, Evidence, SpecOutcome } from "./lessonSpec";

export type OutlinePart = { title?: string; caption?: string; status?: string };

const flat = (s: unknown, max = 300) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, max);

/** The outline's parts as course outcomes: "Title: what it teaches". At most 8 (a course lesson's size). */
export function outcomesFromOutline(parts: OutlinePart[], topic: string, request = ""): SpecOutcome[] {
  const out: SpecOutcome[] = [];
  const seen = new Set<string>();
  for (const p of parts) {
    const title = flat(p.title, 120);
    if (!title || seen.has(title.toLowerCase())) continue;
    seen.add(title.toLowerCase());
    const caption = flat(p.caption, 240);
    // A part the student said they already know is still a course outcome (the course teaches it), recapped briefly.
    const known = p.status === "known" ? " (the student already knows this: recap it briefly)" : "";
    out.push({ code: null, text: `${title}${caption && caption.toLowerCase() !== title.toLowerCase() ? `: ${caption}` : ""}${known}` });
    if (out.length >= 8) break;
  }
  if (!out.length) out.push({ code: null, text: flat(request || topic, 240) });
  return out;
}

/** The official syllabus text as the spec's one evidence page (the course route reads pages; a prompt has one). */
export function evidenceFromSyllabus(text: string | undefined): Evidence[] {
  const t = String(text ?? "").trim();
  return t ? [{ page: 1, code: null, text: t.slice(0, 6000) }] : [];
}

/** The lesson document's address: no course, so a stable id from the topic (never a real course id). */
export function promptLessonRequest(topic: string, level: string): CurriculumLessonRequest {
  const slug = flat(topic, 80).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "lesson";
  return { courseId: "typed-prompt", version: "", grade: flat(level, 40), unitId: "", topicId: "", lessonId: slug };
}

/** What the course label reads like for a topic outside the catalogue: "Cambridge IGCSE Biology", else "Biology". */
export function promptCourseLabel(curriculum: string | undefined, subject: string): string {
  const c = flat(curriculum, 80).replace(/\s*\(.*\)$/, "");
  const s = flat(subject, 60);
  if (!c || /general|none/i.test(c)) return s || "General";
  return c.toLowerCase().includes(s.toLowerCase()) ? c : `${c} ${s}`.trim();
}

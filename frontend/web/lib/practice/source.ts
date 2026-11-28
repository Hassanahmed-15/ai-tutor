/**
 * PRACTICE SHEETS (owner 2026-11-27): at the end of any lecture or course lesson, and from a saved lecture on the front
 * page, Aria writes 5–8 exam-style questions on what was taught. This turns what the browser already has (the
 * lecture's boards; a course lesson's spec) into the exam plan's `source`, and makes the sheet's ready-made plan.
 * Pure (no server code), so LearnPage, the front page and the tests share it.
 */
import type { ExamPlan, PracticeSource } from "../../components/practice/types";

/** What the boards of a lecture hold that says what was taught. */
export type BeatLike = { title?: string; keyClaims?: string[]; points?: string[]; script?: string; definitionTerm?: string; definitionMeaning?: string };

/** A course lesson's spec, as /api/curricula/lesson returns it (only the fields used here). */
export type CourseSpecLike = {
  courseLabel?: string;
  level?: string;
  lessonTitle?: string;
  outcomes?: Array<{ code?: string | null; text: string }>;
  requiredTerms?: string[];
  requiredMethods?: string[];
  examPractice?: Array<{ commandWord?: string; question: string; marks?: number }>;
};

export const SOURCE_MAX = 8000;
export const SHEET_COUNT = 6;

const flat = (s: unknown) => String(s ?? "").replace(/\s+/g, " ").trim();

/** One board → a few lines: its title, then its claims, definition and points (the script only when nothing else says it). */
function boardLines(b: BeatLike): string[] {
  const out: string[] = [];
  const title = flat(b.title);
  if (title) out.push(`## ${title}`);
  if (b.definitionTerm && b.definitionMeaning) out.push(`- ${flat(b.definitionTerm)}: ${flat(b.definitionMeaning)}`);
  for (const c of b.keyClaims ?? []) if (flat(c)) out.push(`- ${flat(c)}`);
  for (const p of b.points ?? []) if (flat(p)) out.push(`- ${flat(p)}`);
  if (out.length <= 1 && b.script) out.push(flat(b.script).slice(0, 600));
  return out;
}

/** The boards as a list, cut to `max` characters at a board's end (never mid-line). */
export function boardsDigest(beats: BeatLike[], max = SOURCE_MAX): string {
  const out: string[] = [];
  const seen = new Set<string>();
  let used = 0;
  for (const b of beats) {
    // A line already said (a claim repeated as a point, a board continued over two passes) is said once.
    const block = boardLines(b).filter((l) => { const k = l.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; }).join("\n");
    if (!block) continue;
    if (used + block.length + 1 > max) {
      // A board too long for what is left keeps its title and first lines.
      const room = max - used - 1;
      if (room > 80) out.push(block.slice(0, room).replace(/\n[^\n]*$/, ""));
      break;
    }
    out.push(block);
    used += block.length + 1;
  }
  return out.join("\n");
}

/** The distinct board titles, for the "which parts" step of the sheet's plan. */
export function boardTitles(beats: BeatLike[], max = 9): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const b of beats) {
    const t = flat(b.title).replace(/\s*[-—:]\s*(part|pass)\s*\d+.*$/i, "").slice(0, 80);
    const k = t.toLowerCase();
    if (!t || seen.has(k)) continue;
    seen.add(k);
    out.push(t);
    if (out.length >= max) break;
  }
  return out;
}

export function lectureSource(topic: string, beats: BeatLike[]): PracticeSource | null {
  const text = boardsDigest(beats);
  const title = flat(topic).slice(0, 200);
  return text.length >= 40 && title ? { kind: "lecture", title, text } : null;
}

/** A course lesson: its outcomes, terms and methods first (what the exam asks), then what the boards taught. */
export function courseSource(spec: CourseSpecLike, beats: BeatLike[]): PracticeSource | null {
  const head: string[] = [];
  const outcomes = (spec.outcomes ?? []).map((o) => `- ${o.code ? `${flat(o.code)} ` : ""}${flat(o.text)}`).filter((l) => l.length > 2);
  if (outcomes.length) head.push("Syllabus outcomes of this lesson:", ...outcomes);
  if (spec.requiredTerms?.length) head.push(`Terms: ${spec.requiredTerms.map(flat).join("; ")}`);
  if (spec.requiredMethods?.length) head.push(`Methods: ${spec.requiredMethods.map(flat).join("; ")}`);
  const headText = head.join("\n").slice(0, 3000);
  const boards = boardsDigest(beats, SOURCE_MAX - headText.length - 40);
  const text = [headText, boards ? `What the lesson's boards taught:\n${boards}` : ""].filter(Boolean).join("\n\n");
  const title = flat(spec.lessonTitle).slice(0, 200);
  if (text.length < 40 || !title) return null;
  const exam = [flat(spec.courseLabel), flat(spec.level)].filter(Boolean).join(" · ").slice(0, 160) || undefined;
  const examples = (spec.examPractice ?? []).slice(0, 4).map((e) => `${e.commandWord ? `[${flat(e.commandWord)}] ` : ""}${flat(e.question)}${e.marks ? ` [${e.marks} marks]` : ""}`.slice(0, 600)).filter((e) => e.length > 10);
  return { kind: "course", title, text, ...(exam ? { exam } : {}), ...(examples.length ? { examples } : {}) };
}

/** The sheet's plan: 6 questions, balanced (2 easy, 2 medium, 2 hard), every style, untimed, on all of the source. */
export function sheetPlan(source: PracticeSource, studyLevel = ""): ExamPlan {
  const level = source.exam || flat(studyLevel) || "General";
  return {
    topic: source.title,
    level,
    ...(source.exam ? { board: source.exam } : {}),
    subtopics: [],
    count: SHEET_COUNT,
    mix: { easy: 2, medium: 2, hard: 2 },
    styles: ["mcq", "short", "worked"],
    minutes: null,
    source,
  };
}

import { checkNumbers } from "../canvas/numberCheck";
import type { Answers, Difficulty, ExamPlan, OptionKey, PracticeSource, QuestionResult, StoredExam, StoredQuestion, StudentQuestion, Style } from "./types";

/**
 * THE PRACTICE EXAM'S RULES (pure, unit-tested in lib/anim/practiceExam.test.ts): what a plan may ask for, which
 * slot gets which difficulty and style, what a written question must have before it is kept, the code-marked
 * multiple choice, the grade bands, what the student may see, and who may grade an exam.
 */

export const STYLES: Style[] = ["mcq", "short", "worked"];
export const DIFFICULTIES: Difficulty[] = ["easy", "medium", "hard"];
export const OPTION_KEYS: OptionKey[] = ["A", "B", "C", "D"];
export const MIN_COUNT = 3;
export const MAX_COUNT = 15;
export const DEFAULT_COUNT = 8;

export function practiceExamOn(env: Record<string, string | undefined> = process.env): boolean {
  return env.PRACTICE_EXAM === "on";
}

const clean = (v: unknown, max: number) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);

/** Counts for a mix preset ("Mostly easy", "Balanced", "Exam-hard"), summing to `count`. */
export function mixFor(count: number, preset: "easy" | "balanced" | "hard" = "balanced"): ExamPlan["mix"] {
  const weights = preset === "easy" ? [0.5, 0.35, 0.15] : preset === "hard" ? [0.2, 0.4, 0.4] : [0.35, 0.4, 0.25];
  return scaleMix(count, { easy: weights[0], medium: weights[1], hard: weights[2] });
}

/** Rescales any non-negative weights to whole counts summing to `count` (largest remainder; never all in one band by rounding). */
export function scaleMix(count: number, raw: { easy?: unknown; medium?: unknown; hard?: unknown }): ExamPlan["mix"] {
  const w = DIFFICULTIES.map((d) => Math.max(0, Number(raw[d]) || 0));
  const sum = w.reduce((a, b) => a + b, 0);
  if (sum <= 0) return mixFor(count, "balanced");
  const exact = w.map((x) => (x / sum) * count);
  const out = exact.map(Math.floor);
  let left = count - out.reduce((a, b) => a + b, 0);
  const order = exact.map((x, i) => ({ i, r: x - Math.floor(x) })).sort((a, b) => b.r - a.r || a.i - b.i);
  for (let k = 0; left > 0; k = (k + 1) % 3, left--) out[order[k].i]++;
  return { easy: out[0], medium: out[1], hard: out[2] };
}

/**
 * A plan from the browser, made safe: topic and level required; count 3–15 (default 8); a mix that does not sum
 * to the count is rescaled to it; unknown styles dropped (none left = all three); minutes 5–180 or null.
 */
export function normalizePlan(raw: unknown): { plan: ExamPlan } | { error: string } {
  const b = (raw ?? {}) as Record<string, unknown>;
  const topic = clean(b.topic, 200);
  if (topic.length < 2) return { error: "Type a topic to practise." };
  const level = clean(b.level, 80) || "IGCSE";
  const board = clean(b.board, 80) || undefined;
  const subtopics = Array.isArray(b.subtopics) ? [...new Set(b.subtopics.map((s) => clean(s, 80)).filter(Boolean))].slice(0, 12) : [];
  const n = Math.round(Number(b.count));
  const count = Number.isFinite(n) && n > 0 ? Math.max(MIN_COUNT, Math.min(MAX_COUNT, n)) : DEFAULT_COUNT;
  const m = (b.mix ?? {}) as Record<string, unknown>;
  const given = DIFFICULTIES.map((d) => Math.max(0, Math.round(Number(m[d]) || 0)));
  const mix = given.reduce((a, c) => a + c, 0) === count ? { easy: given[0], medium: given[1], hard: given[2] } : scaleMix(count, { easy: given[0], medium: given[1], hard: given[2] });
  const styles = Array.isArray(b.styles) ? STYLES.filter((s) => (b.styles as unknown[]).includes(s)) : [];
  const mins = b.minutes === null || b.minutes === undefined || b.minutes === "" ? null : Math.round(Number(b.minutes));
  const minutes = mins === null || !Number.isFinite(mins) || mins <= 0 ? null : Math.max(5, Math.min(180, mins));
  const source = cleanSource(b.source);
  return { plan: { topic, level, board, subtopics, count, mix, styles: styles.length ? styles : [...STYLES], minutes, ...(source ? { source } : {}) } };
}

/** Line breaks kept (the taught text reads as a list), control characters and runs of blank lines removed. */
const cleanText = (v: unknown, max: number) => String(v ?? "").replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim().slice(0, max);
export const SOURCE_TEXT_MAX = 8000;

/** A practice sheet's source, from the browser: capped, and dropped unless it says something. */
export function cleanSource(raw: unknown): PracticeSource | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const text = cleanText(r.text, SOURCE_TEXT_MAX);
  const title = clean(r.title, 200);
  if (text.length < 40 || !title) return null;
  const exam = clean(r.exam, 160) || undefined;
  const examples = Array.isArray(r.examples) ? r.examples.map((e) => cleanText(e, 600)).filter((e) => e.length > 10).slice(0, 4) : [];
  return { kind: r.kind === "course" ? "course" : "lecture", title, text, ...(exam ? { exam } : {}), ...(examples.length ? { examples } : {}) };
}

export type Slot = { n: number; difficulty: Difficulty; style: Style; subtopic: string; marks: [number, number] };

/** The marks a slot may carry: a multiple choice is 1; written questions grow with difficulty. */
export function marksRange(style: Style, difficulty: Difficulty): [number, number] {
  if (style === "mcq") return [1, 1];
  if (style === "short") return difficulty === "easy" ? [1, 2] : difficulty === "medium" ? [2, 4] : [3, 5];
  return difficulty === "easy" ? [2, 4] : difficulty === "medium" ? [4, 6] : [5, 9];
}

/**
 * WHICH QUESTION IS WHICH, decided by code so the mix is exactly what the student chose: easy first, hard last;
 * multiple choice goes to the easiest slots, worked questions to the hardest, short answers in between; every
 * allowed style appears at least once when there are enough slots; subtopics are taken in turn.
 */
export function slotsFor(plan: ExamPlan): Slot[] {
  const diffs: Difficulty[] = [...Array(plan.mix.easy).fill("easy"), ...Array(plan.mix.medium).fill("medium"), ...Array(plan.mix.hard).fill("hard")];
  const n = diffs.length;
  const allowed = STYLES.filter((s) => plan.styles.includes(s));
  const share: Record<Style, number> = { mcq: 0.3, short: 0.4, worked: 0.3 };
  const total = allowed.reduce((a, s) => a + share[s], 0);
  const want = Object.fromEntries(allowed.map((s) => [s, Math.max(n >= allowed.length ? 1 : 0, Math.round((share[s] / total) * n))])) as Partial<Record<Style, number>>;
  // Trim or pad so the counts sum to n: the middle style (short when allowed) absorbs the difference.
  const order: Style[] = allowed.includes("short") ? ["short", ...allowed.filter((s) => s !== "short")] : allowed;
  let sum = allowed.reduce((a, s) => a + (want[s] ?? 0), 0);
  for (let k = 0; sum !== n && k < 100; k++) {
    const s = order[k % order.length];
    if (sum > n && (want[s] ?? 0) > 1) { want[s]! -= 1; sum--; }
    else if (sum < n) { want[s] = (want[s] ?? 0) + 1; sum++; }
  }
  const styles: Style[] = [...Array(want.mcq ?? 0).fill("mcq"), ...Array(want.short ?? 0).fill("short"), ...Array(want.worked ?? 0).fill("worked")];
  return diffs.map((difficulty, i) => {
    const style = styles[i] ?? allowed[allowed.length - 1];
    return { n: i + 1, difficulty, style, subtopic: plan.subtopics.length ? plan.subtopics[i % plan.subtopics.length] : "", marks: marksRange(style, difficulty) };
  });
}

/** Total marks a question is worth: 1 for multiple choice, else its parts. */
export function questionMarks(q: Pick<StudentQuestion, "style" | "parts">): number {
  return q.style === "mcq" ? 1 : q.parts.reduce((a, p) => a + p.marks, 0);
}

/** Every "calculation = number" in a scheme, recomputed by code; the wrong ones, as plain reasons. */
export function schemeNumberIssues(q: StoredQuestion): string[] {
  const text = [...q.scheme.working, ...q.scheme.points.map((p) => p.text)].join("\n");
  return [...new Set(checkNumbers(text).map((i) => `the scheme says ${i.calculation} = ${i.stated}, but it is ${Number(i.computed.toPrecision(4))}`))].slice(0, 4);
}

/**
 * WHAT A WRITTEN QUESTION MUST HAVE before anyone sees it (reasons, or [] when sound): the slot's style and marks;
 * four distinct options and a key for multiple choice; labelled parts whose scheme points add up to each part's
 * marks; worked steps (two at least for written questions) and a typical error; no diagram it cannot show.
 */
export function questionProblems(q: StoredQuestion, slot: Slot): string[] {
  const out: string[] = [];
  if (!q.stem?.trim()) out.push("empty stem");
  if (/\b(the|this) (diagram|figure|picture)\b|\bfig\.\s*\d|\bshown (below|above|in)\b|\b(table|graph|chart) (below|above)\b/i.test(`${q.stem} ${q.parts.map((p) => p.text).join(" ")}`)) {
    out.push("it refers to a diagram, graph or table the student cannot see: give every value in words");
  }
  if (q.style === "mcq") {
    const opts = OPTION_KEYS.map((k) => (q.options?.[k] ?? "").trim());
    if (opts.some((o) => !o)) out.push("a multiple choice needs four options A-D");
    else if (new Set(opts.map((o) => o.toLowerCase())).size < 4) out.push("two options are the same");
    if (!q.scheme.answer || !OPTION_KEYS.includes(q.scheme.answer as OptionKey)) out.push("no answer key A-D");
    if (q.parts.length) out.push("a multiple choice has no parts");
  } else {
    if (!q.parts.length) out.push("no parts");
    const labels = new Set<string>();
    for (const p of q.parts) {
      if (!p.text?.trim()) out.push(`part ${p.label} is empty`);
      if (!(p.marks >= 1 && p.marks <= 6)) out.push(`part ${p.label} has ${p.marks} marks`);
      if (labels.has(p.label)) out.push(`part label ${p.label} used twice`);
      labels.add(p.label);
      const got = q.scheme.points.filter((r) => r.label === p.label).reduce((a, r) => a + r.marks, 0);
      if (got !== p.marks) out.push(`part ${p.label} is worth ${p.marks} but its scheme points give ${got}`);
    }
    if (q.scheme.working.length < 2) out.push("the scheme needs the worked steps");
  }
  const marks = questionMarks(q);
  if (marks < slot.marks[0] || marks > slot.marks[1]) out.push(`it is worth ${marks} marks; a ${slot.difficulty} ${slot.style} question here is ${slot.marks[0]}–${slot.marks[1]}`);
  // A missing typical error is not a fault worth a rewrite (2026-11-28: it sent every question of a test back and
  // the test failed): a multiple choice's are written by the second examiner anyway; a written answer is marked without.
  return [...out, ...schemeNumberIssues(q)];
}

/** What the browser may see: no key, no scheme, no working. */
export function studentView(q: StoredQuestion): StudentQuestion {
  return {
    id: q.id,
    n: q.n,
    difficulty: q.difficulty,
    style: q.style,
    marks: q.marks,
    subtopic: q.subtopic,
    stem: q.stem,
    ...(q.style === "mcq" && q.options ? { options: { A: q.options.A, B: q.options.B, C: q.options.C, D: q.options.D } } : {}),
    parts: q.parts.map((p) => ({ label: p.label, marks: p.marks, text: p.text })),
    answerOn: q.answerOn,
  };
}

export function studentExam(exam: StoredExam): { examId: string; questions: StudentQuestion[]; minutes: number | null } {
  return { examId: exam.id, questions: exam.questions.map(studentView), minutes: exam.minutes };
}

/** Only the student who asked for an exam may have it marked. */
export function canGrade(exam: Pick<StoredExam, "userId"> | null | undefined, userId: string | null | undefined): boolean {
  return Boolean(exam && userId && exam.userId === userId);
}

export const EXAM_ID = /^[a-f0-9]{32}$/;

/** Percent → approximate Cambridge-style grade. */
export function gradeFor(percent: number): string {
  if (percent >= 90) return "A*";
  if (percent >= 80) return "A";
  if (percent >= 70) return "B";
  if (percent >= 60) return "C";
  if (percent >= 50) return "D";
  if (percent >= 40) return "E";
  return "U";
}

/** The chosen letter out of what the browser sent ("b", " B ", "B) 4 m/s"). */
export function choiceOf(raw: unknown): OptionKey | null {
  const m = /^\s*\(?([A-Da-d])\b/.exec(String(raw ?? ""));
  return m ? (m[1].toUpperCase() as OptionKey) : null;
}

/**
 * MULTIPLE CHOICE, MARKED BY CODE. The scheme's typical errors are written "C: <the mistake that gives C>", so a
 * wrong choice is told the exact misconception behind it.
 */
export function markMcq(q: StoredQuestion, rawChoice: unknown): QuestionResult {
  const key = (q.scheme.answer ?? "").toUpperCase() as OptionKey;
  const choice = choiceOf(rawChoice);
  const why = q.scheme.points[0]?.text?.replace(/^\s*[A-D]\s*[:\-–]\s*/, "").trim() ?? "";
  const base = { id: q.id, max: 1, correctWorking: q.scheme.working.length ? q.scheme.working : why ? [why] : [] };
  if (!choice) return { ...base, awarded: 0, correct: false, studentAnswer: "", feedback: `No option was chosen. The answer is ${key}.` };
  if (choice === key) return { ...base, awarded: 1, correct: true, studentAnswer: choice, feedback: `Correct: ${key}.${why ? ` ${firstSentence(why)}` : ""}` };
  const err = q.scheme.commonErrors.find((e) => new RegExp(`^\\s*\\(?${choice}\\)?\\s*[:\\-–]`).test(e));
  const misconception = err?.replace(/^\s*\(?[A-D]\)?\s*[:\-–]\s*/, "").trim();
  return {
    ...base,
    awarded: 0,
    correct: false,
    studentAnswer: choice,
    feedback: `You chose ${choice}; the answer is ${key}.${why ? ` ${firstSentence(why)}` : ""}`,
    // The reason is a likely slip, not a claim about what this student did (owner 2026-11-28: it "guesses at a reason").
    firstError: { step: "Choosing the option", what: `Chose ${choice}: ${q.options?.[choice] ?? ""}`.trim(), why: misconception ? `A common way to end up with ${choice}: ${/^[A-Z][a-z]/.test(misconception) ? misconception.charAt(0).toLowerCase() + misconception.slice(1) : misconception}${/[.!?]$/.test(misconception) ? "" : "."} If that isn't what you did, compare your thinking with the correct working.` : `${q.options?.[choice] ?? choice} does not fit what the question gives.` },
  };
}

function firstSentence(s: string): string {
  const m = /^.*?[.!?](\s|$)/.exec(s);
  const t = (m ? m[0] : s).trim().slice(0, 240);
  return t ? `${t[0].toUpperCase()}${t.slice(1)}${/[.!?]$/.test(t) ? "" : "."}` : "";
}

/** Totals, percent, grade and the list of mistakes, from the per-question results. */
export function summarizeResults(examId: string, results: QuestionResult[], costUsd: number) {
  const total = results.reduce((a, r) => a + r.awarded, 0);
  const max = results.reduce((a, r) => a + r.max, 0);
  const percent = max ? Math.round((total / max) * 1000) / 10 : 0;
  return { examId, total, max, percent, grade: gradeFor(percent), results, mistakes: results.filter((r) => r.awarded < r.max), costUsd: Math.round(costUsd * 1e5) / 1e5 };
}

/** Words a student must never read about their own work, and the kinder thing to say. */
export function kind(text: string): string {
  return text
    .replace(/\b(very |really )?(bad|terrible|awful|sloppy)\b( work| answer| attempt)?/gi, "not yet right")
    .replace(/\s+/g, " ")
    .trim();
}

/** The grade route's answers from the browser, kept to known question ids and strings of a sane size. */
export function answersOf(raw: unknown): Answers {
  const out: Answers = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [id, v] of Object.entries(raw as Record<string, unknown>).slice(0, 40)) {
    if (!/^q\d{1,2}$/.test(id) || !v || typeof v !== "object") continue;
    const a = v as { choice?: unknown; text?: unknown };
    out[id] = { ...(typeof a.choice === "string" ? { choice: a.choice.slice(0, 20) } : {}), ...(typeof a.text === "string" ? { text: a.text.slice(0, 4000) } : {}) };
  }
  return out;
}

/** Clamp a model's mark to a part's printed maximum. */
export function clampMark(v: unknown, max: number): number {
  return Math.max(0, Math.min(max, Math.round(Number(v) || 0)));
}

/**
 * A level or subtopic name as shown on a card: Latin letters, digits and ordinary punctuation only. The model once
 * wrote "Cambridge International A Level Chemistry (旧 9701)" (2026-11-27); the stray script is removed, not shown.
 */
export function cleanLabel(v: unknown, max: number): string {
  return String(v ?? "")
    .replace(/[^\p{Script=Latin}\p{N}\s&()/.,+'’:\-–—·]/gu, "")
    .replace(/\(\s+/g, "(").replace(/\s+\)/g, ")").replace(/\(\)/g, "")
    .replace(/\s+/g, " ").trim().slice(0, max);
}

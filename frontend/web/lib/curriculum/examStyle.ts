import "server-only";
import { createHash } from "node:crypto";
import { bounded, client, jsonCall } from "@/lib/canvas/generate";
import { downloadJsonBlob, uploadJsonBlob } from "@/lib/blobStorage";

/**
 * EXAM-STYLE QUESTIONS FOR EVERY STUDENT (the real Cambridge questions are not ours to publish): for one lesson,
 * one multiple-choice and two short structured questions written in Cambridge's style — command words, mark
 * allocations, a mark scheme in B1/M1/A1 form — strictly on the lesson's official learning points. Written once per
 * lesson and kept in blob storage (~$0.003 a lesson); checked before it is kept.
 */
export type ExamStyleQuestion = {
  id: string;
  mcq: boolean;
  stem: string;
  options?: Record<"A" | "B" | "C" | "D", string>;
  answer?: "A" | "B" | "C" | "D";
  explain?: string;
  parts: Array<{ label: string; marks: number; text: string }>;
  scheme: Array<{ label: string; answer: string; marks: number }>;
};
export type ExamStyleSet = { id: string; questions: ExamStyleQuestion[]; createdAt: string };

const MODEL = process.env.EXAM_STYLE_MODEL ?? "gpt-5.6-luna";
const BLOB = "pastpapers/exam-style";

const SYSTEM = `You are a senior Cambridge IGCSE examiner writing practice questions in the exact style of real Cambridge papers.
Write exactly 3 questions on ONLY the learning goals given (never anything outside them):
  Q1: multiple choice — one stem, four options A-D, exactly one correct; wrong options are the mistakes students really make.
  Q2 and Q3: short structured questions, each with parts (a), (b) and optionally (c), 1-3 marks a part, 3-6 marks in all; Cambridge command words (State, Describe, Explain, Calculate, Suggest), marks shown per part.
Every question must be answerable from text alone (no diagram). Plain words a 15-year-old understands; exact syllabus terms.
Mark scheme rows like Cambridge's: one row per part, the answer with each marking point, "any two from", "allow", "ignore", and B1/M1/A1/C1 notation; the row's marks equal the part's marks.
Return JSON only: {"questions":[{"mcq":true,"stem":"...","options":{"A":"...","B":"...","C":"...","D":"..."},"answer":"B","explain":"one sentence why B is right"},{"mcq":false,"stem":"context sentence","parts":[{"label":"(a)","marks":2,"text":"..."}],"scheme":[{"label":"(a)","answer":"... B1 ... B1","marks":2}]}, {...}]}`;

function valid(q: ExamStyleQuestion): boolean {
  if (q.mcq) return !!q.options && ["A", "B", "C", "D"].every((k) => typeof q.options?.[k as "A"] === "string" && q.options[k as "A"].trim()) && !!q.answer && "ABCD".includes(q.answer);
  if (!q.parts?.length || q.parts.some((p) => !(p.marks >= 1 && p.marks <= 4) || !p.text?.trim())) return false;
  return q.parts.every((p) => q.scheme?.some((r) => r.label === p.label && r.answer?.trim()));
}

export function examStyleId(courseId: string, version: string, lessonKey: string, part: number): string {
  return createHash("sha256").update([courseId, version, lessonKey, part, "exam-style-1"].join("|")).digest("hex").slice(0, 32);
}

export async function examStyleSet(id: string): Promise<ExamStyleSet | null> {
  if (!/^[a-f0-9]{32}$/.test(id)) return null;
  return downloadJsonBlob<ExamStyleSet>(`${BLOB}/${id}.json`).catch(() => null);
}

/**
 * THE SOLVER CHECK: a second examiner answers every question from its text alone and compares with the scheme.
 * A question that cannot be answered unambiguously from what it gives (first try: "is the speed constant from 0 to
 * 4 s?" with only two data points), or whose scheme or MCQ key is wrong, is named — and the set is written again.
 */
const SOLVER = `You are a second Cambridge examiner checking practice questions before students see them. For EACH question: answer it yourself using only the information it gives, then compare with the mark scheme or MCQ key. Flag a question if: it cannot be answered unambiguously from the information given; your answer differs from the key or scheme; a mark scheme row does not match its part's marks; or it tests something outside the learning goals. Return JSON only: {"problems":[{"id":"q2","part":"(c)","why":"..."}]} — an empty list when all three are sound.`;

async function solverProblems(questions: ExamStyleQuestion[], goals: string[]): Promise<string[]> {
  const user = `Learning goals:\n${goals.map((g, i) => `${i + 1}. ${g}`).join("\n")}\n\nQUESTIONS WITH KEYS AND SCHEMES:\n${JSON.stringify(questions.map((q) => ({ id: q.id, mcq: q.mcq, stem: q.stem, options: q.options, answer: q.answer, parts: q.parts, scheme: q.scheme })))}`;
  const { json } = await bounded(jsonCall(client(), MODEL, SOLVER, user, 3000), 45_000, "exam-style solver check");
  const list = ((json ?? {}) as { problems?: Array<{ id?: string; part?: string; why?: string }> }).problems ?? [];
  return list.map((p) => `${p.id ?? "?"}${p.part ? ` ${p.part}` : ""}: ${p.why ?? ""}`.slice(0, 300));
}

export async function makeExamStyleSet(id: string, subject: string, lessonTitle: string, goals: string[]): Promise<ExamStyleSet | null> {
  const cached = await examStyleSet(id);
  if (cached) return cached;
  const base = `Subject: Cambridge IGCSE ${subject}\nLesson: ${lessonTitle}\nLearning goals (official):\n${goals.map((g, i) => `${i + 1}. ${g}`).join("\n")}`;
  let user = base;
  for (let attempt = 0; attempt < 3; attempt++) {
    const { json } = await bounded(jsonCall(client(), MODEL, SYSTEM, user, 5000), 60_000, "exam-style questions");
    const raw = ((json ?? {}) as { questions?: ExamStyleQuestion[] }).questions ?? [];
    const questions = raw.slice(0, 3).map((q, i) => ({ ...q, id: `q${i + 1}`, mcq: !!q.mcq, parts: q.parts ?? [], scheme: q.scheme ?? [] }));
    if (questions.length !== 3 || !questions.every(valid)) continue;
    const problems = await solverProblems(questions, goals).catch(() => ["solver check failed"]);
    if (problems.length) {
      console.warn(`[exam-style] ${id}: rewritten after the solver check — ${problems.join(" | ")}`);
      user = `${base}\n\nA previous attempt had these problems; avoid them:\n${problems.map((p) => `- ${p}`).join("\n")}`;
      continue;
    }
    {
      const set: ExamStyleSet = { id, questions, createdAt: new Date().toISOString() };
      await uploadJsonBlob(`${BLOB}/${id}.json`, set).catch(() => undefined);
      return set;
    }
  }
  return null;
}

/** What the student sees before answering: no answers, no scheme. */
export function forStudent(set: ExamStyleSet) {
  return set.questions.map((q) => ({ id: q.id, mcq: q.mcq, stem: q.stem, options: q.options, parts: q.parts.map((p) => ({ label: p.label, marks: p.marks, text: p.text })), marks: q.mcq ? 1 : q.parts.reduce((n, p) => n + p.marks, 0) }));
}

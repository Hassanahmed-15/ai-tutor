import "server-only";
import type OpenAI from "openai";
import { practiceJson } from "./llm";
import { clampMark, kind, markMcq, summarizeResults } from "./rules";
import type { Answers, ExamResult, QuestionResult, StoredExam, StoredQuestion } from "./types";

/**
 * MARKING A PRACTICE EXAM (docs/practice-exam.md):
 *  - multiple choice by code (lib/practice/rules.ts markMcq);
 *  - every typed answer in ONE call, with lib/curriculum/pastPaperMarking.ts `markWritten`'s examiner rules,
 *    extended to name the first error;
 *  - every paper answer in ONE vision call over all the photographed pages: it finds each question by its number,
 *    copies down what the student wrote (never more), and marks it step by step against the scheme.
 * Every mark is clamped to its part's printed maximum. The right working shown back is the scheme's own (already
 * checked by the second examiner), never a fresh model guess.
 */

const RULES = `MARKING RULES (Cambridge):
- Award a mark only for a marking point the answer actually makes. B = independent mark. M = method mark: give it for a correct method even when an arithmetic slip makes the final answer wrong. A = accuracy mark: needs its M mark and the correct value. ERROR CARRIED FORWARD (ecf) — always apply it: when a later step or part uses the student's own wrong earlier value, but its method and arithmetic are right, award that later step's M AND A marks, unless the scheme says "no ecf". Never penalise the same mistake twice: one slip loses marks only where it was made.
- A correct final answer with the right unit and no working earns all the part's marks unless the part says "show" or "show that". A missing or wrong unit loses only the mark the scheme ties to it.
- "Any n from" lists: count at most n; a contradiction cancels a point. Ignore spelling unless it confuses two syllabus terms.
- Never award more than a part's maximum. A blank part scores 0.
FIRST ERROR (only when marks were lost): "step" = the exact step where the work first went wrong, quoting the student's own line or naming the part ("(b), the line a = 20 ÷ 4"); "what" = what they did, in a few words; "why" = the misconception behind it, in plain words a 15-year-old understands ("thought acceleration is final speed ÷ time, not change in speed ÷ time"). If they simply left it out, "what" says what was missing.
FEEDBACK: 1-2 short, kind sentences TO the student, in plain words: what they did right, then exactly what to fix to earn the missed mark. Never call the work bad, careless or poor; never say "Great job"; name the point.`;

const TYPED = `You are a Cambridge examiner marking a student's TYPED answers to practice questions, using each question's mark scheme.
The student typed one answer box per question; match their words to each part by its label, or by order when there are no labels.
${RULES}
Return JSON only: {"marks":[{"id":"q2","parts":[{"label":"(a)","awarded":1,"earned":["…"],"missed":["…"]}],"feedback":"…","firstError":{"step":"…","what":"…","why":"…"}}]} — "firstError": null when full marks.`;

const PAPER = `You are a Cambridge examiner marking a student's HANDWRITTEN answers from photos of their paper. The photos are the pages in order. You get the list of questions to look for, each with its mark scheme, model working and the errors students usually make.
For EACH question:
1. FIND its answer on the pages by the number the student wrote ("3", "Q3", "3(a)", "3 b)"). Without a number, match by content only when it is unmistakable. If it is not on any page: "found": false.
2. COPY what the student wrote for it into "studentAnswer", line by line separated by "\\n", exactly as written, keeping their numbers and their mistakes. Never correct, complete or add a step that is not on the page. Write [unclear] for any word or number you cannot read. Copy crossed-out work as [crossed out: …] and do not mark it, unless nothing replaces it (then mark it as Cambridge does).
3. MARK it part by part against the scheme. Marks that depend on something you could not read are NOT given.
4. "readConfidence": "low" if any part of your copy needed guessing or has [unclear]; else "high".
${RULES}
Return JSON only: {"marks":[{"id":"q4","found":true,"page":1,"studentAnswer":"…","readConfidence":"high","parts":[{"label":"(a)","awarded":2,"earned":["…"],"missed":["…"]}],"feedback":"…","firstError":{"step":"…","what":"…","why":"…"}}]} — "firstError": null when full marks.`;

type ModelMark = {
  id?: string;
  found?: boolean;
  studentAnswer?: string;
  readConfidence?: string;
  parts?: Array<{ label?: string; awarded?: number }>;
  feedback?: string;
  firstError?: { step?: string; what?: string; why?: string } | null;
};

const str = (v: unknown, max: number) => String(v ?? "").trim().slice(0, max);

function questionBrief(q: StoredQuestion): string {
  return [
    `QUESTION ${q.n} (id ${q.id}) [${q.marks} marks]: ${q.stem}`,
    ...q.parts.map((p) => `  ${p.label} [${p.marks}] ${p.text}`),
    "  MARK SCHEME:",
    ...q.scheme.points.map((p) => `    ${p.label} [${p.marks}] ${p.text}`),
    `  MODEL WORKING: ${q.scheme.working.join(" | ")}`,
    `  USUAL ERRORS: ${q.scheme.commonErrors.join(" | ")}`,
  ].join("\n");
}

/** A model's marks for one question, made safe: parts clamped to their maxima, the scheme's working shown back. */
function resultFrom(q: StoredQuestion, m: ModelMark | undefined, studentAnswer: string, photo: boolean): QuestionResult {
  const byLabel = new Map((m?.parts ?? []).map((p) => [str(p.label, 12), p]));
  const single = q.parts.length === 1 && (m?.parts?.length ?? 0) === 1 ? m!.parts![0] : undefined;
  const awarded = q.parts.reduce((a, p) => a + clampMark((byLabel.get(p.label) ?? single)?.awarded, p.marks), 0);
  const fe = m?.firstError;
  const firstError = awarded < q.marks && fe && (fe.step || fe.what) ? { step: kind(str(fe.step, 200)), what: kind(str(fe.what, 240)), why: kind(str(fe.why, 300)) } : undefined;
  return {
    id: q.id,
    awarded,
    max: q.marks,
    correct: awarded === q.marks,
    studentAnswer,
    feedback: kind(str(m?.feedback, 400)) || (awarded === q.marks ? "Full marks." : "Compare your steps with the correct working below."),
    ...(firstError ? { firstError } : {}),
    correctWorking: q.scheme.working,
    ...(photo ? { readConfidence: m?.readConfidence === "low" ? ("low" as const) : ("high" as const) } : {}),
  };
}

function notFound(q: StoredQuestion, why: string): QuestionResult {
  return { id: q.id, awarded: 0, max: q.marks, correct: false, studentAnswer: "", feedback: why, correctWorking: q.scheme.working };
}

async function markTyped(qs: Array<{ q: StoredQuestion; text: string }>): Promise<{ results: QuestionResult[]; costUsd: number }> {
  if (!qs.length) return { results: [], costUsd: 0 };
  const user = qs.map(({ q, text }) => `${questionBrief(q)}\n  STUDENT'S TYPED ANSWER: ${text}`).join("\n\n");
  const { json, costUsd } = await practiceJson<{ marks?: ModelMark[] }>(TYPED, user, { what: "practice exam typed marking", maxTokens: 3000 + 900 * qs.length, ms: 90_000 });
  const marks = json.marks ?? [];
  return { results: qs.map(({ q, text }) => resultFrom(q, marks.find((m) => m.id === q.id), text, false)), costUsd };
}

async function markPaper(qs: StoredQuestion[], pages: string[]): Promise<{ results: QuestionResult[]; costUsd: number }> {
  if (!qs.length) return { results: [], costUsd: 0 };
  if (!pages.length) return { results: qs.map((q) => notFound(q, "No photo of your paper answers was sent. Scan your pages to get these marked.")), costUsd: 0 };
  const content: OpenAI.Chat.ChatCompletionContentPart[] = [
    { type: "text", text: `QUESTIONS TO FIND AND MARK:\n\n${qs.map(questionBrief).join("\n\n")}\n\nThe student's ${pages.length} page(s) follow, in order.` },
    ...pages.flatMap((url, i) => [{ type: "text" as const, text: `Page ${i + 1}:` }, { type: "image_url" as const, image_url: { url, detail: "high" as const } }]),
  ];
  const { json, costUsd } = await practiceJson<{ marks?: ModelMark[] }>(PAPER, content, { what: "practice exam paper marking", maxTokens: 4000 + 1500 * qs.length, ms: 150_000, effort: "medium" });
  const marks = json.marks ?? [];
  return {
    results: qs.map((q) => {
      const m = marks.find((x) => x.id === q.id || x.id === `q${q.n}`);
      const answer = str(m?.studentAnswer, 3000);
      if (!m || m.found === false || !answer) return notFound(q, "No answer found on your pages.");
      return resultFrom(q, m, answer, true);
    }),
    costUsd,
  };
}

/**
 * The whole exam marked. `pages` are the paper's photos as data URLs (from lib/pageImageStore). Written questions
 * with nothing typed are looked for on the pages too, so a student who wrote a short answer on paper is still marked.
 */
export async function gradeExam(exam: StoredExam, answers: Answers, pages: string[]): Promise<ExamResult> {
  const results = new Map<string, QuestionResult>();
  const typed: Array<{ q: StoredQuestion; text: string }> = [];
  const paper: StoredQuestion[] = [];
  for (const q of exam.questions) {
    const a = answers[q.id] ?? {};
    if (q.style === "mcq") results.set(q.id, markMcq(q, a.choice ?? a.text));
    else if (q.answerOn === "screen" && str(a.text, 4000)) typed.push({ q, text: str(a.text, 4000) });
    else paper.push(q);
  }
  const [t, p] = await Promise.all([markTyped(typed), markPaper(paper, pages)]);
  for (const r of [...t.results, ...p.results]) results.set(r.id, r);
  // A short question left blank and not on the pages either: say it plainly.
  for (const q of paper) {
    const r = results.get(q.id);
    if (r && !r.studentAnswer && q.answerOn === "screen") results.set(q.id, notFound(q, pages.length ? "No answer typed or found on your pages." : "No answer was typed."));
  }
  return summarizeResults(exam.id, exam.questions.map((q) => results.get(q.id)!), t.costUsd + p.costUsd);
}

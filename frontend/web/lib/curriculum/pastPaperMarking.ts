import "server-only";
import { bounded, client, jsonCall } from "@/lib/canvas/generate";

/**
 * MARKING A STUDENT'S ANSWER AGAINST A MARK SCHEME (real Cambridge scheme, or an exam-style one Aria wrote).
 * One luna call as a Cambridge examiner (~$0.002). Every part's mark is clamped to its printed maximum, so a model
 * slip can never award more than the paper allows.
 */
export type MarkPart = { label: string; marks: number; text?: string };
export type SchemeRow = { label: string; answer: string; guidance?: string; marks?: number };
export type MarkedPart = { label: string; awarded: number; max: number; earned: string[]; missed: string[] };
export type MarkResult = { awarded: number; max: number; parts: MarkedPart[]; feedback: string; costUsd: number };

const MODEL = process.env.PAST_PAPER_MARK_MODEL ?? "gpt-5.6-luna";

const SYSTEM = `You are a Cambridge IGCSE examiner marking one student's answers with the official mark scheme. Rules:
- Award a mark only for a marking point the answer actually makes (B = independent point, M = method, A = accuracy that needs its M, C = compensatory: implied by correct later working).
- Correct final numerical answers with the right unit earn all the marks of that part unless the question says "show your working". Apply error carried forward (ecf) where the scheme allows it.
- "Any n from" lists: count at most n; a contradiction cancels a point. Ignore spelling unless it confuses two syllabus terms.
- Never award more than a part's maximum. A blank answer scores 0.
Then write "feedback": 1-2 short sentences TO the student, warm and specific, in plain words: what they got, and the exact words or step that would have earned the missed mark. Never say "Great job"; name the point.
Return JSON only: {"parts":[{"label":"1(a)","awarded":1,"earned":["..."],"missed":["..."]}],"feedback":"..."}`;

export async function markWritten(question: { parts: MarkPart[]; scheme: SchemeRow[]; context?: string }, answers: Record<string, string>): Promise<MarkResult> {
  const parts = question.parts.filter((p) => p.marks > 0);
  const user = [
    question.context ? `QUESTION CONTEXT: ${question.context}` : "",
    "QUESTION PARTS (label [max marks]: text):",
    ...parts.map((p) => `${p.label} [${p.marks}]: ${p.text ?? ""}`),
    "",
    "MARK SCHEME (label: answer || guidance [marks]):",
    ...question.scheme.map((r) => `${r.label}: ${r.answer}${r.guidance ? ` || ${r.guidance}` : ""}${r.marks ? ` [${r.marks}]` : ""}`),
    "",
    "STUDENT'S ANSWERS:",
    ...parts.map((p) => `${p.label}: ${(answers[p.label] ?? "").trim() || "(blank)"}`),
  ].filter(Boolean).join("\n");
  const { json, costUsd } = await bounded(jsonCall(client(), MODEL, SYSTEM, user, 4000), 45_000, "past-paper marking");
  const got = (json ?? {}) as { parts?: Array<{ label?: string; awarded?: number; earned?: string[]; missed?: string[] }>; feedback?: string };
  const byLabel = new Map((got.parts ?? []).map((p) => [String(p.label), p]));
  const marked: MarkedPart[] = parts.map((p) => {
    const g = byLabel.get(p.label);
    const blank = !(answers[p.label] ?? "").trim();
    const awarded = blank ? 0 : Math.max(0, Math.min(p.marks, Math.round(Number(g?.awarded) || 0)));
    return { label: p.label, awarded, max: p.marks, earned: (g?.earned ?? []).slice(0, 6).map(String), missed: (g?.missed ?? []).slice(0, 6).map(String) };
  });
  return {
    awarded: marked.reduce((n, p) => n + p.awarded, 0),
    max: marked.reduce((n, p) => n + p.max, 0),
    parts: marked,
    feedback: typeof got.feedback === "string" ? got.feedback.slice(0, 400) : "",
    costUsd,
  };
}

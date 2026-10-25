import type { LessonSubject } from "./lessonSubject";

/**
 * THE SUBJECT OF A TYPED, PDF OR VIDEO LECTURE, JUDGED ONCE (owner, 2026-10-23: "I want 100 percent
 * accuracy"). Guessing from words put 40 of 264 stored lectures in the wrong subject: one stray word
 * ("factors" in "Fall of the Roman Empire", "gradient" in a biology lesson, "vector" in "Vectorization")
 * made a history, poetry or biology lecture maths, and AES, semaphores and the Internet of Things were
 * not computer science. One small call reads what the lesson is ABOUT — the student's request, the
 * planned parts, a document's title, headings and opening — and decides. A course lesson never comes
 * here: its course names its subject (lib/canvas/lessonSubject.ts).
 */
export const SUBJECT_PROMPT = `You decide the SUBJECT of one lesson, so the right kind of teacher teaches it. Answer with exactly one:
- "maths": mathematics or statistics as the subject itself — number, algebra, equations, graphs of functions, geometry, trigonometry, vectors, matrices, sequences, calculus, probability, statistics, proofs, and mechanics taught as mathematics.
- "cs": computer science and computing — programming and code in any language, algorithms, data structures, complexity, computer systems and hardware, operating systems, networks and protocols, databases, cybersecurity and cryptography, how data is represented in a computer, logic gates, software engineering, artificial intelligence and machine learning (unless the lesson is purely the mathematics behind it).
- "other": every other subject — even when it uses numbers, equations, formulas, graphs or calculations: the natural sciences, earth sciences, geography, economics, business and accounting, history, languages, literature, music, art, design, architecture, psychology, health, and anything else.
A document ABOUT a product, an app, a proposal or report template, research methods or study skills is "other" unless the lesson teaches computing itself (its code, algorithms, systems or networks).
Decide from what the lesson is ABOUT as a whole, never from one word: a mathematical-sounding word inside another subject's lesson does not make it maths. A science lesson with calculations is that science. Return JSON only: {"subject": "maths" | "cs" | "other"}`;

/** What the call reads about a lesson. Everything optional but the topic. */
export type SubjectEvidence = { topic: string; request?: string; parts?: string[]; documentTitle?: string; headings?: string[]; excerpt?: string };

export function subjectUserPrompt(e: SubjectEvidence): string {
  const lines = [`Topic: ${e.topic.slice(0, 200)}`];
  if (e.request && e.request.trim().toLowerCase() !== e.topic.trim().toLowerCase()) lines.push(`The student asked: ${e.request.slice(0, 400)}`);
  if (e.parts?.length) lines.push(`Planned parts: ${e.parts.slice(0, 12).join("; ").slice(0, 600)}`);
  if (e.documentTitle) lines.push(`Document: ${e.documentTitle.slice(0, 160)}`);
  if (e.headings?.length) lines.push(`Its headings: ${e.headings.slice(0, 12).join("; ").slice(0, 500)}`);
  if (e.excerpt) lines.push(`It begins: ${e.excerpt.replace(/\s+/g, " ").slice(0, 700)}`);
  return lines.join("\n");
}

export function parseSubject(json: unknown): LessonSubject | null {
  const s = json && typeof json === "object" ? (json as { subject?: unknown }).subject : undefined;
  return s === "maths" || s === "cs" || s === "other" ? s : null;
}

/**
 * One call, asked once more if it fails or answers something else (a network stall left one lecture
 * undecided in the accuracy test); null after that, and the caller keeps the old guess.
 */
export async function classifySubject(
  call: (system: string, user: string, maxTokens: number) => Promise<{ json: unknown; costUsd: number }>,
  evidence: SubjectEvidence,
): Promise<{ subject: LessonSubject | null; costUsd: number }> {
  let costUsd = 0;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const answer = await call(SUBJECT_PROMPT, subjectUserPrompt(evidence), 400);
      costUsd += answer.costUsd;
      const subject = parseSubject(answer.json);
      if (subject) return { subject, costUsd };
    } catch {
      /* asked once more */
    }
  }
  return { subject: null, costUsd };
}

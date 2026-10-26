/**
 * One small model call: is this typed lesson computer science, maths, or neither? (lib/canvas/subjectDomain.ts)
 * Asked when a typed lesson is planned and created; the lecture builder reuses the answer for the lecture's
 * subject (lib/canvas/progressive.ts lectureSubject), which PDF and video lectures get from
 * lib/canvas/subjectClassifier.ts.
 * Answered once per request text and remembered in this process, so planning and creating the same
 * lecture ask once. A call that fails or takes too long falls back to the keyword checks.
 */
import { bounded, client, jsonCall, PLAN_MODEL } from "./generate";
import { isSubjectDomain, keywordDomain, type SubjectDomain } from "./subjectDomain";

const CLASSIFY_MODEL = process.env.CANVAS_SUBJECT_MODEL ?? PLAN_MODEL;

export const SUBJECT_DOMAIN_PROMPT = `You decide which subject a student's lesson request belongs to, so the lesson is taught by that subject's rules. Answer with exactly one:
- "cs": computer science — programming and code in any language, algorithms and their analysis (including "algo"), data structures, operating systems, networks and protocols, databases and SQL, distributed systems, compilers, automata and theory of computation, computer architecture, security and cryptography, artificial intelligence, machine learning, deep learning and reinforcement learning (policies, off-policy learning, importance sampling in RL, Q-learning, MDPs).
- "maths": mathematics — arithmetic, algebra, equations, functions, calculus, geometry and geometric proofs, trigonometry, vectors, matrices, probability, statistics, number theory, combinatorics.
- "none": any other subject — physics, chemistry, biology, economics, history, geography, languages, literature and the rest, even when they use some numbers.
A machine-learning or reinforcement-learning method is "cs" even when it is mathematical. Words that also have everyday meanings decide nothing on their own ("stacks" of rock, a "queue" at a bank, a family "tree"). Return JSON only: {"subject": "cs" | "maths" | "none"}.`;

const remembered = new Map<string, SubjectDomain>();

/** The subject of a typed lesson request. Never throws: on any failure, the keyword answer. */
export async function classifySubjectDomain(request: string): Promise<{ domain: SubjectDomain; source: "model" | "keywords" | "remembered"; costUsd: number }> {
  const key = request.trim().toLowerCase().replace(/\s+/g, " ").slice(0, 600);
  if (!key) return { domain: "none", source: "keywords", costUsd: 0 };
  const known = remembered.get(key);
  if (known) return { domain: known, source: "remembered", costUsd: 0 };
  try {
    const { json, costUsd } = await bounded(jsonCall(client(), CLASSIFY_MODEL, SUBJECT_DOMAIN_PROMPT, `The student's lesson request: "${request.slice(0, 600)}"`, 400), 8_000, "subject classification");
    const subject = (json as { subject?: unknown }).subject;
    if (!isSubjectDomain(subject)) throw new Error(`unexpected answer ${JSON.stringify(subject)}`);
    if (remembered.size > 500) remembered.delete(remembered.keys().next().value!);
    remembered.set(key, subject);
    return { domain: subject, source: "model", costUsd };
  } catch (error) {
    console.warn(`[subject] classification fell back to keywords: ${(error as Error).message}`);
    return { domain: keywordDomain(request), source: "keywords", costUsd: 0 };
  }
}

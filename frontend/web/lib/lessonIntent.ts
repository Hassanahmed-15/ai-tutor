import type { LessonBrief } from "./webSources";
import { examForLevel } from "./education";

/**
 * WHAT DOES THE STUDENT ACTUALLY WANT? — asked before planning, the way a good tutor (or Claude) would.
 *
 * A general prompt ("explain transport in animals igcse biology") says the topic but not the goal:
 * revising the whole IGCSE topic for an exam is a different lecture from understanding one idea in it.
 * The planner used to guess, and taught the minimum. Now one cheap call reads the request, the
 * student's profile and anything they have already answered, and either settles a brief — goal,
 * curriculum and level, scope — or asks ONE short question about the thing that would change the
 * lecture most, with suggested answers. It may ask again (at most MAX_INTENT_ROUNDS times in all),
 * and stops as soon as it knows enough. A specific question asks nothing.
 *
 * Research behind the shape (2026-10-14): ask only when the answer changes the output (CLAM, Kuhn et
 * al.; Zhang, Knox & Choi, ICLR 2025), let the model elicit what the user did not think to say (GATE,
 * ICLR 2025), and settle everything into ONE brief before planning — models planning through a
 * drip-fed conversation do markedly worse than from one complete request (Laban et al., ICLR 2026).
 */

export const MAX_INTENT_ROUNDS = 3;

export type IntentQuestion = { question: string; options: string[] };
export type IntentResult = { brief: LessonBrief; complete: boolean; question: IntentQuestion | null };

export const INTENT_SYSTEM_PROMPT = `You are Aria, a tutor about to plan a lecture for a student. Before planning, decide whether you know enough to plan the RIGHT lecture — the way a thoughtful teacher, or Claude, would before answering a vague request.

You need three things:
- "goal": "exam" (they need a syllabus topic covered for a course or exam), "understand" (they want to understand an idea), or "question" (they asked one specific, narrow question).
- "curriculum": the course, exam board or level the lecture is for ("Cambridge IGCSE Biology", "A Level Physics", "first-year university", "general interest").
- "scope": "the whole topic", or the part they want ("just the heart", "only the formulas").

Fill each ONLY from what the student's request, their profile or their answers actually say; leave it null when nothing says it — never guess a slot to avoid asking. A word like IGCSE, O level, A level, GCSE, IB, AP, SAT or MDCAT in the request names the curriculum, and with "exam", "revision" or "syllabus" means goal "exam". A specific, narrow question is goal "question": it is complete — ask nothing.

If something is still missing AND it would change what the lecture covers, ask ONE short, friendly question about the most important missing thing, with 2 to 4 suggested answers (each at most 7 words) the student can tap. Phrase it as a tutor would, in this student's own terms — for example "Is this for your <their curriculum> exam — the whole topic — or one part of it?" when the curriculum is known, or "Is this for a course or exam, or just to understand it?" when it is not. Never mention a curriculum the request or profile does not name. Never ask what the request or profile already says, never ask about prior knowledge, depth or teaching style (asked separately), and never ask more than one thing at a time. When the student's answer is vague, make the sensible assumption rather than asking again.

Return JSON only: {"brief": {"goal": "exam"|"understand"|"question"|null, "curriculum": string|null, "level": string|null, "scope": string|null}, "complete": boolean, "question": {"question": string, "options": string[]} | null}
"complete" is true when you can plan the right lecture now (then "question" is null).`;

function words(value: unknown, max: number): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "";
}

export function sanitizeBrief(raw: unknown): LessonBrief {
  const obj = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const goal = obj.goal === "exam" || obj.goal === "understand" || obj.goal === "question" ? obj.goal : undefined;
  const curriculum = words(obj.curriculum, 100);
  const level = words(obj.level, 80);
  const scope = words(obj.scope, 120);
  return {
    ...(goal ? { goal } : {}),
    ...(curriculum && !/^(?:null|none|unknown|n\/a)$/i.test(curriculum) ? { curriculum } : {}),
    ...(level && !/^(?:null|none|unknown|n\/a)$/i.test(level) ? { level } : {}),
    ...(scope && !/^(?:null|none|unknown|n\/a)$/i.test(scope) ? { scope } : {}),
  };
}

/**
 * The model's turn, made safe — and the stopping rules enforced HERE, not only in the prompt (a
 * model told to ask "only when needed" still asked a specific question what exam it was for):
 *  - a direct question (`directQuestion`, decided by lib/planPrompt.ts isDirectQuestion) asks nothing;
 *  - a brief whose goal, curriculum and scope are all known asks nothing;
 *  - after MAX_INTENT_ROUNDS answers the brief is complete with whatever is known.
 */
export function sanitizeIntent(raw: unknown, answered: number, directQuestion = false): IntentResult {
  const obj = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const brief = sanitizeBrief(obj.brief);
  if (directQuestion) return { brief: { ...brief, goal: "question" }, complete: true, question: null };
  const settled = briefSettled(brief);
  const q = obj.question && typeof obj.question === "object" ? (obj.question as Record<string, unknown>) : null;
  const question = q ? words(q.question, 220) : "";
  const options = q && Array.isArray(q.options) ? [...new Set(q.options.map((o) => words(o, 60)).filter(Boolean))].slice(0, 4) : [];
  const asks = !settled && !obj.complete && answered < MAX_INTENT_ROUNDS && question.length > 0;
  return { brief, complete: !asks, question: asks ? { question, options } : null };
}

/**
 * Enough to plan the right lecture without asking: one specific question, or the goal, the scope and
 * who it is for — a course, or the level from their profile (a university student has no syllabus;
 * asking them "for a course?" every time is asking what the profile already says).
 */
export function briefSettled(brief: LessonBrief): boolean {
  return brief.goal === "question" || Boolean(brief.goal && brief.scope && (brief.curriculum || brief.level));
}

/** Curricula named in the student's own words, as the planner should read them. */
const CURRICULA: Array<[RegExp, string]> = [
  [/\bigcse\b/i, "Cambridge IGCSE"],
  [/\bgcse\b/i, "GCSE"],
  [/\bo[- ]?levels?\b/i, "O Level"],
  [/\b(?:a|as)[- ]?levels?\b/i, "A Level"],
  [/\bib\b|\binternational baccalaureate\b/i, "IB Diploma"],
  [/\bap\b(?= [a-z])|\badvanced placement\b/i, "AP"],
  [/\bmdcat\b/i, "MDCAT"],
  [/\bfsc\b|\bhssc\b/i, "FSc (Pakistan)"],
  [/\bmatric\b|\bssc\b/i, "Matric (Pakistan)"],
  [/\bcbse\b/i, "CBSE"],
  [/\bjee\b/i, "JEE"],
  [/\bneet\b/i, "NEET"],
  [/\bsat\b/i, "SAT"],
];

/** "explain transport in animals igcse biology" → "Cambridge IGCSE". Null when no curriculum is named. */
export function curriculumInText(value: string): string | null {
  return CURRICULA.find(([re]) => re.test(value))?.[1] ?? null;
}

/**
 * THE STUDENT'S LEVEL, FROM THEIR PROFILE (owner's direction, 2026-10-14: "students will not say A
 * level in the prompt — get it from the user profile", Settings → Learner profile → Study level).
 *
 * Since 2026-10-15 the Study level IS the exam or track ("MDCAT", "O Level", "FSc Pre-Medical",
 * "Undergraduate") and is the one place the student says it: `examForLevel` (lib/education.ts) gives
 * the syllabus to search (`exam`, null for a level with none) and the words to search at (`level`).
 */
export type ProfileCardLike = {
  levelId?: string | null;
  level: string | null;
  topicSubject: string | null;
  /** The topic's subject when it is one of the student's own (lib/studentCard.ts). */
  inSubject?: string | null;
  /** The subjects the student listed. */
  subjects?: string[];
};

export function levelSearchTerms(card: ProfileCardLike): { level: string | null; exam: string | null } {
  const label = (card.level ?? "").trim();
  if (!label && !card.levelId) return { level: null, exam: null };
  const found = examForLevel({ id: card.levelId ?? "", label });
  return { level: found?.words ?? (label || null), exam: found?.exam ?? null };
}

/**
 * What the profile says this lesson is for: the level always, and — for a school exam level and a
 * topic that belongs to a school subject — the syllabus to read ("Cambridge International A Level
 * Biology"). A topic in no school subject ("transformers in AI") gets the level only.
 */
export function profileAudience(card: ProfileCardLike | null | undefined): { curriculum: string | null; level: string | null } | null {
  if (!card) return null;
  const { level, exam } = levelSearchTerms(card);
  // A syllabus only for a subject they study. A Computer Science student's "4 Operations in AES …
  // mathematical valuation" was guessed as Mathematics, got the IGCSE Mathematics syllabus, and the
  // lecture ended on six boards of arithmetic, indices and standard form (2026-10-17). A student
  // who listed no subjects still gets the guessed one.
  const listed = card.subjects ?? [];
  const subject = card.inSubject ?? (listed.length === 0 ? card.topicSubject : null);
  const curriculum = exam && subject ? `${exam} ${subject}` : null;
  return level || curriculum ? { curriculum, level } : null;
}

/**
 * The brief the lesson is planned for, by precedence: a curriculum named in the request, then what
 * the student answered, then their profile. Never loses what a higher source said.
 */
export function effectiveBrief(brief: LessonBrief | null | undefined, request: string, card: ProfileCardLike | null | undefined): LessonBrief | null {
  const named = curriculumInText(request);
  const fromProfile = profileAudience(card);
  const curriculum = named ? (fromProfile?.curriculum && fromProfile.curriculum.toLowerCase().includes(named.toLowerCase().replace(/^cambridge\s+/, "").replace(/\s*\(.*\)$/, "")) ? fromProfile.curriculum : named) : brief?.curriculum ?? fromProfile?.curriculum ?? undefined;
  const level = brief?.level ?? fromProfile?.level ?? undefined;
  const merged: LessonBrief = { ...(brief ?? {}), ...(curriculum ? { curriculum } : {}), ...(level ? { level } : {}) };
  return Object.keys(merged).length ? merged : null;
}

/** The brief as one line for the planners: what the student wants this lecture to be. */
export function briefLine(brief: LessonBrief | null | undefined): string {
  if (!brief) return "";
  const goal = brief.goal === "exam" ? "cover the syllabus topic for their course or exam" : brief.goal === "understand" ? "understand the idea" : brief.goal === "question" ? "an answer to one specific question" : "";
  const bits = [goal && `wants ${goal}`, brief.curriculum && `curriculum: ${brief.curriculum}`, brief.level && `level: ${brief.level}`, brief.scope && `scope: ${brief.scope}`].filter(Boolean);
  return bits.length ? `\nWHAT THE STUDENT WANTS (settled with them before planning): ${bits.join("; ")}.` : "";
}

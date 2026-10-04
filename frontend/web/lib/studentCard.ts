import { countryName, levelBand, subjectForTopic, SUBJECTS, type EduOption, type LevelBand } from "./education";
import type { LearnerBasics } from "./db/cosmos";

/**
 * THE STUDENT CARD — who the lesson is for, sent with every lecture to the planner, the lecture
 * writer and Aria. Pure, unit-tested in lib/anim/studentCard.test.ts.
 *
 * Built from the profile the student gave at onboarding (lib/learnerBasics.ts): their grade, their
 * country, their curriculum and their subjects. Three rules decide how it is used:
 *
 *   1. THE GRADE ALWAYS APPLIES, in every subject: it sets how simple the language is and what can be
 *      assumed. A Grade 8 student asking about history is still in Grade 8.
 *   2. THE SUBJECT LIST decides only whether the lesson follows their syllabus: a topic in one of
 *      their subjects is taught the way their curriculum teaches it at their grade; a topic outside
 *      them is new ground, in the same Grade 8 language.
 *   3. A GRADE LABEL IS NOT ENOUGH. Told "write for Grade 6", models wrote at about Grade 9 (Rooein
 *      et al.; EduAdapt). So the grade becomes concrete rules — sentence length, new words per board,
 *      what maths may be assumed — and every script is checked afterwards (readingGrade below).
 */

export type StudentCard = {
  /** "Grade 8" — the level as the student named it. */
  level: string | null;
  /** The reading grade the language is written for (US grade scale, 1-16+). */
  readingGrade: number;
  band: LevelBand | null;
  country: string | null;
  curricula: string[];
  subjects: string[];
  /** The topic's subject, when it is one the student studies. */
  inSubject: string | null;
  /** The topic's subject in general (it may not be one of theirs). */
  topicSubject: string | null;
  /** The level for THIS subject when the student set or showed one that differs from their main level. */
  subjectLevel: string | null;
  subjectCurricula: string[];
};

const BAND_GRADE: Record<LevelBand, number> = { primary: 4, middle: 7, secondary: 9, senior: 11, undergrad: 13, postgrad: 15, professional: 14 };

/** "Grade 8", "Year 9", "Class 10", "O Level" → a reading grade. */
export function readingGradeFor(level: EduOption | null | undefined): number | null {
  if (!level) return null;
  const n = /\b(?:grade|class|year|std\.?|standard)\s*(\d{1,2})\b/i.exec(level.label);
  if (n) return Math.max(1, Math.min(12, Number(n[1])));
  const band = levelBand(level);
  return band ? BAND_GRADE[band] : null;
}

/**
 * The card for one lesson. `signals` are the student's own tallies (lib/learnerModel.ts): asking for
 * "simpler" again and again moves the reading level down a grade, asking "deeper" moves it up.
 */
export function buildStudentCard(basics: LearnerBasics | null | undefined, topic: string, signals: { simpler?: number; deeper?: number } = {}): StudentCard | null {
  if (!basics) return null;
  const mine = subjectForTopic(topic, basics.subjects);
  const general = mine ?? subjectForTopic(topic, SUBJECTS.map((s) => ({ id: s.id, label: s.label })));
  const subjectLevel = mine ? basics.subjectLevels?.[mine.id] ?? null : null;
  const level = subjectLevel ?? basics.studyLevel;
  const base = readingGradeFor(level);
  if (base === null && !basics.country && basics.subjects.length === 0) return null;
  const lean = (signals.simpler ?? 0) - (signals.deeper ?? 0);
  const nudge = lean >= 2 ? -1 : lean <= -2 ? 1 : 0;
  return {
    level: level?.label ?? null,
    readingGrade: Math.max(2, (base ?? 9) + nudge),
    band: levelBand(level),
    country: basics.country ? countryName(basics.country) || basics.country : null,
    curricula: basics.curricula.map((c) => c.label),
    subjects: basics.subjects.map((s) => s.label),
    inSubject: mine?.label ?? null,
    topicSubject: general?.label ?? null,
    subjectLevel: subjectLevel?.label ?? null,
    subjectCurricula: mine ? (basics.subjectCurricula?.[mine.id] ?? []).map((c) => c.label) : [],
  };
}

/** The grade, as rules a writer can follow — not a label it will drift from. */
export function gradeRules(readingGrade: number): { sentenceWords: number; newTerms: number; assume: string; examples: string } {
  if (readingGrade <= 5) return { sentenceWords: 12, newTerms: 1, assume: "only everyday words and simple counting", examples: "home, family, food, animals, games" };
  if (readingGrade <= 8) return { sentenceWords: 16, newTerms: 2, assume: "basic arithmetic, fractions and simple percentages — no algebra beyond a single unknown, no formal proofs", examples: "school, home, sport, phones, shopping, their town" };
  if (readingGrade <= 10) return { sentenceWords: 20, newTerms: 3, assume: "school algebra and basic science vocabulary — no calculus", examples: "school life, technology they use, local news, sport" };
  if (readingGrade <= 12) return { sentenceWords: 24, newTerms: 3, assume: "secondary-school maths and science, including some functions and graphs", examples: "exams, technology, society, careers" };
  return { sentenceWords: 28, newTerms: 4, assume: "university-level background in their field", examples: "real research, industry and professional practice" };
}

/** What the lecture writers are told — the card in words, with the grade turned into rules. */
export function studentCardInstruction(card: StudentCard | null | undefined): string {
  if (!card) return "";
  const r = gradeRules(card.readingGrade);
  const where = card.country ? ` in ${card.country}` : "";
  const lines = [`THE STUDENT: ${card.level ? `${card.level}${where}` : `a student${where}`}${card.curricula.length ? ` (${card.curricula.join(", ")})` : ""}.`];
  if (card.inSubject) {
    const syllabus = card.subjectCurricula.length ? card.subjectCurricula.join(", ") : card.curricula.join(", ");
    lines.push(`This is ${card.inSubject}, one of their school subjects${card.subjectLevel ? `, which they study at ${card.subjectLevel}` : ""}: teach it the way ${syllabus ? `the ${syllabus} syllabus` : "their syllabus"} teaches it at their level — its scope, its terms, its usual examples — and nothing it leaves for later years.`);
  } else if (card.topicSubject) {
    lines.push(`${card.topicSubject} is not one of their school subjects, so treat it as new ground — but they are still ${card.level ?? "the same student"}: same language, same age.`);
  }
  lines.push(
    `WRITE FOR A READING LEVEL OF GRADE ${card.readingGrade}: sentences of at most ${r.sentenceWords} words; at most ${r.newTerms} new technical term${r.newTerms === 1 ? "" : "s"} per board, each explained in plain words the first time it appears; assume ${r.assume}.`,
    `Examples from their own life (${r.examples})${card.country ? `, set in ${card.country} — its places, its money, its everyday life — unless the topic is about somewhere else` : ""}.`,
  );
  return lines.join("\n");
}

/** What the outline planner is told: who the lesson is for and how far it should go — not how to write. */
export function studentCardPlanningLine(card: StudentCard | null | undefined): string {
  if (!card) return "";
  const who = `${card.level ?? "A student"}${card.country ? ` in ${card.country}` : ""}${card.curricula.length ? ` (${card.curricula.join(", ")})` : ""}`;
  const scope = card.inSubject
    ? `${card.inSubject} is one of their school subjects${card.subjectLevel ? ` (at ${card.subjectLevel})` : ""}: plan what their syllabus covers at this level, and nothing it leaves for later years.`
    : card.topicSubject
      ? `${card.topicSubject} is not one of their school subjects: plan it as new ground, pitched for their level.`
      : "Pitch the plan for their level.";
  return `\nWHO THE LESSON IS FOR: ${who}. ${scope}`;
}

/** Only the reading level — for a strict lesson, whose content is its source. */
export function studentReadingRule(card: StudentCard): string {
  const r = gradeRules(card.readingGrade);
  return `WRITE FOR A READING LEVEL OF GRADE ${card.readingGrade}${card.level ? ` (${card.level})` : ""}: sentences of at most ${r.sentenceWords} words; explain every technical term in plain words the first time it appears.`;
}

/** The one-line note the planning screen shows, so the student can see and change what Aria assumed. */
export function studentCardNote(card: StudentCard | null | undefined): string {
  if (!card || !card.level) return "";
  const parts = [card.level, card.country, card.inSubject ? card.subjectCurricula[0] ?? card.curricula[0] : null].filter(Boolean);
  return `Pitched for ${parts.join(" · ")}`;
}

/* ── checking the result ──────────────────────────────────────────────────────────────────── */

/** Syllables in an English word, by the usual vowel-group heuristic (good enough for a grade estimate). */
function syllables(word: string): number {
  const w = word.toLowerCase().replace(/[^a-z]/g, "");
  if (!w) return 0;
  if (w.length <= 3) return 1;
  const groups = w.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, "").replace(/^y/, "").match(/[aeiouy]{1,2}/g);
  return Math.max(1, groups?.length ?? 1);
}

/**
 * The Flesch-Kincaid grade of a text: how many years of school its sentences and words ask for.
 * Used to CHECK a script against the student's grade after it is written — the step the research
 * says matters, because a model told a grade still overshoots it.
 */
export function readingGrade(text: string): number {
  const sentences = text.split(/(?<=[.!?])\s+/).filter((s) => /[a-z]/i.test(s));
  const words = text.split(/\s+/).map((w) => w.replace(/[^A-Za-z'-]/g, "")).filter(Boolean);
  if (sentences.length === 0 || words.length === 0) return 0;
  const syl = words.reduce((t, w) => t + syllables(w), 0);
  return Math.round((0.39 * (words.length / sentences.length) + 11.8 * (syl / words.length) - 15.59) * 10) / 10;
}

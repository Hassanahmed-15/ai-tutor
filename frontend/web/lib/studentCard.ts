import { countryName, levelBand, subjectForTopic, SUBJECTS, type EduOption, type LevelBand } from "./education";
import type { AccessibilityProfile, LearnerBasics } from "./db/cosmos";
import type { LearningPreferences } from "./learningPreferences";

/**
 * THE STUDENT CARD — who the lesson is for, sent with every lecture to the planner, the lecture
 * writer and Aria. Pure, unit-tested in lib/anim/studentCard.test.ts.
 *
 * Built from the profile the student gave at onboarding (lib/learnerBasics.ts): their grade, their
 * country, their curriculum and their subjects, plus how they like to learn and the support they
 * chose. The card is the FACTS; lib/teachingPolicy.ts turns them into how to teach, and is the only
 * thing that writes them into a prompt. Three rules decide how the grade is used:
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
  /** How they like to learn (onboarding's preferences screen), when they answered it. */
  preferences: LearningPreferences | null;
  /** Support chosen on the accessibility screen that changes how a lesson is WRITTEN. */
  support: StudentSupport;
  /** How many times they have asked for more examples (lib/learnerModel.ts signals). */
  moreExamples: number;
};

export type StudentSupport = { simplerLanguage: boolean; slowerPace: boolean; accessibility: AccessibilityProfile | null };

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
export function buildStudentCard(
  basics: LearnerBasics | null | undefined,
  topic: string,
  signals: { simpler?: number; deeper?: number; moreExamples?: number } = {},
  support: { simplerLanguage?: boolean | null; slowerPace?: boolean | null; accessibility?: AccessibilityProfile | null } | null = null,
): StudentCard | null {
  if (!basics) return null;
  const mine = subjectForTopic(topic, basics.subjects);
  const general = mine ?? subjectForTopic(topic, SUBJECTS.map((s) => ({ id: s.id, label: s.label })));
  const subjectLevel = mine ? basics.subjectLevels?.[mine.id] ?? null : null;
  const level = subjectLevel ?? basics.studyLevel;
  const base = readingGradeFor(level);
  const preferences = basics.preferences ?? null;
  const helped: StudentSupport = {
    simplerLanguage: support?.simplerLanguage === true,
    slowerPace: support?.slowerPace === true,
    accessibility: support?.accessibility ?? null,
  };
  const anySupport = helped.simplerLanguage || helped.slowerPace || (helped.accessibility !== null && helped.accessibility !== "none");
  if (base === null && !basics.country && basics.subjects.length === 0 && !preferences?.completedAt && !anySupport) return null;
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
    preferences,
    support: helped,
    moreExamples: signals.moreExamples ?? 0,
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

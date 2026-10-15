import type { LearnerBasics, LearnerOption } from "./db/cosmos";
import { sanitizePreferences } from "./learningPreferences";
import { examForLevel, levelBand, sanitizeCountry, sanitizeOption, sanitizeOptions, subjectForTopic, type LevelBand } from "./education";

/**
 * The learner profile's basics as a client may send them (onboarding screen 1, or settings), made
 * safe and merged over what is stored. Fields not sent are kept. `complete: true` marks screen 1 as
 * done, and only when the required fields are there (owner's choice, 2026-09-29): a name, a study
 * level and at least one subject — they drive every suggestion that follows.
 */
export class LearnerBasicsError extends Error {}

export function mergeLearnerBasics(raw: unknown, existing: LearnerBasics | null | undefined, displayName: string | null, now = new Date().toISOString()): LearnerBasics {
  const body = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const has = (k: string) => Object.hasOwn(body, k);
  const countrySource = body.countrySource === "ip" || body.countrySource === "language" || body.countrySource === "user" ? body.countrySource : null;
  const subjectLevels: Record<string, LearnerOption> = {};
  if (has("subjectLevels") && body.subjectLevels && typeof body.subjectLevels === "object") {
    for (const [subjectId, level] of Object.entries(body.subjectLevels as Record<string, unknown>).slice(0, 20)) {
      const clean = sanitizeOption(level);
      // A learned level the student left as it was stays marked as learned.
      const kept = existing?.subjectLevels?.[subjectId];
      if (clean && /^[a-z0-9:_-]{1,90}$/i.test(subjectId)) subjectLevels[subjectId] = kept?.learned && kept.id === clean.id ? kept : clean;
    }
  }
  const subjectCurricula: Record<string, LearnerOption[]> = {};
  if (has("subjectCurricula") && body.subjectCurricula && typeof body.subjectCurricula === "object") {
    for (const [subjectId, list] of Object.entries(body.subjectCurricula as Record<string, unknown>).slice(0, 20)) {
      const kept = existing?.subjectCurricula?.[subjectId] ?? [];
      const clean = sanitizeOptions(list, 4).map((c) => kept.find((k) => k.learned && k.id === c.id) ?? c);
      if (clean.length && /^[a-z0-9:_-]{1,90}$/i.test(subjectId)) subjectCurricula[subjectId] = clean;
    }
  }
  const next: LearnerBasics = {
    country: has("country") ? sanitizeCountry(body.country) : existing?.country ?? null,
    countrySource: has("country") ? countrySource ?? "user" : existing?.countrySource ?? null,
    studyLevel: has("studyLevel") ? sanitizeOption(body.studyLevel) : existing?.studyLevel ?? null,
    subjects: has("subjects") ? sanitizeOptions(body.subjects, 12) : existing?.subjects ?? [],
    curricula: has("curricula") ? sanitizeOptions(body.curricula, 8) : existing?.curricula ?? [],
    subjectLevels: has("subjectLevels") ? subjectLevels : existing?.subjectLevels ?? {},
    subjectCurricula: has("subjectCurricula") ? subjectCurricula : existing?.subjectCurricula ?? {},
    // "How do you like to learn?" — merged field by field, so settings can change one answer.
    ...(has("preferences") || existing?.preferences ? { preferences: has("preferences") ? sanitizePreferences(body.preferences, existing?.preferences, now) : existing?.preferences ?? null } : {}),
    completedAt: existing?.completedAt ?? null,
    updatedAt: now,
  };
  if (body.complete === true) {
    const missing = [!displayName && "your name", !next.studyLevel && "a study level", next.subjects.length === 0 && "at least one subject"].filter(Boolean);
    if (missing.length) throw new LearnerBasicsError(`Please add ${missing.join(", ")}.`);
    next.completedAt = existing?.completedAt ?? now;
  }
  return next;
}

/** How far into a subject each study-level band is, on the planning conversation's 1-5 scale. */
const BAND_DEPTH: Record<LevelBand, 1 | 2 | 3 | 4 | 5> = { primary: 1, middle: 1, secondary: 2, senior: 3, undergrad: 3, postgrad: 4, professional: 4 };

/**
 * The study level Aria ALREADY KNOWS for a lesson topic — or null, and then she asks.
 *
 * Known means: the topic belongs to one of the student's subjects, and they have a study level. A
 * topic outside their subjects is a genuinely
 * new question — a postgraduate in Computer Science asking about photosynthesis is a beginner there.
 */
export function knownLevelForTopic(basics: LearnerBasics | null | undefined, topic: string): { depth: 1 | 2 | 3 | 4 | 5; level: LearnerOption; subject: LearnerOption } | null {
  if (!basics || basics.subjects.length === 0) return null;
  const subject = subjectForTopic(topic, basics.subjects);
  if (!subject) return null;
  const level = basics.studyLevel;
  const band = levelBand(level);
  return level && band ? { depth: BAND_DEPTH[band], level, subject } : null;
}

/**
 * The level to pitch ANY topic at: their study level, with the subject when the topic is one of
 * theirs (knownLevelForTopic) — a Grade 8 student is in Grade 8 in every
 * subject. `subject` is null when the topic is outside their subjects (new ground, same grade).
 */
export function profileLevelForTopic(basics: LearnerBasics | null | undefined, topic: string): { depth: 1 | 2 | 3 | 4 | 5; level: LearnerOption; subject: LearnerOption | null } | null {
  const known = knownLevelForTopic(basics, topic);
  if (known) return known;
  const level = basics?.studyLevel;
  const band = levelBand(level);
  return level && band ? { depth: BAND_DEPTH[band], level, subject: null } : null;
}

/**
 * THE PROFILE AS EVERYTHING ELSE READS IT (2026-10-15). Study level is the one place a student says
 * what they study for — its exam is their curriculum ("MDCAT" → "MDCAT (Pakistan medical entry
 * test)"). The separate curriculum list and the per-subject levels and curricula — including the
 * ones lessons used to fill in silently — are still stored, but no longer read: a value the student
 * cannot see must not change how they are taught.
 */
export function effectiveLearner(basics: LearnerBasics): LearnerBasics {
  const exam = examForLevel(basics.studyLevel)?.exam;
  return {
    ...basics,
    curricula: exam && basics.studyLevel ? [{ id: `level:${basics.studyLevel.id}`, label: exam }] : [],
    subjectLevels: {},
    subjectCurricula: {},
  };
}

import type { LearnerBasics, LearnerOption } from "./db/cosmos";
import { allCurricula, levelBand, sanitizeCountry, sanitizeOption, sanitizeOptions, studyLevelOptions, subjectForTopic, type LevelBand } from "./education";

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

/* ------------------------------------------------------------------ learning from lessons */

/**
 * Curricula and exams named distinctly enough to recognise in a request. Generic tracks ("Self-study",
 * "Undergraduate course") are never inferred — only a name a student would actually say.
 */
const CURRICULUM_PATTERNS: Array<[RegExp, string]> = [
  [/\bigcse\b/, "igcse"], [/\bgcse\b/, "gcse"], [/\bo[- ]?levels?\b/, "o-level"], [/\bcambridge (?:international )?a[- ]?levels?\b/, "cambridge-a-level"],
  [/\b(?:a|as)[- ]?levels?\b/, "a-level"], [/\bib\b|\binternational baccalaureate\b/, "ib-dp"], [/\bap\b(?= [a-z])|\badvanced placement\b/, "ap"],
  [/\bsat\b/, "sat"], [/\bact\b(?= (?:math|test|exam|prep|science|english))/, "act"], [/\bmcat\b/, "mcat"], [/\busmle\b/, "usmle"], [/\bplab\b/, "plab"],
  [/\bucat\b/, "ucat"], [/\bmdcat\b/, "mdcat"], [/\becat\b/, "ecat"], [/\bfsc\b|\bhssc\b/, "pk-fsc"], [/\bmatric\b|\bssc\b/, "pk-matric"],
  [/\bjee\b/, "jee"], [/\bneet\b/, "neet"], [/\bcbse\b/, "cbse"], [/\bicse\b/, "icse"], [/\bgre\b/, "gre"], [/\bgmat\b/, "gmat"],
  [/\blsat\b/, "lsat"], [/\bnclex\b/, "nclex"], [/\bacca\b/, "acca"], [/\bcfa\b/, "cfa"], [/\bcpa\b/, "cpa"], [/\bielts\b/, "ielts"], [/\btoefl\b/, "toefl"],
  [/\bbtec\b/, "btec"], [/\bwaec\b|\bwassce\b/, "waec"], [/\bhsc\b(?! \()/, "au-hsc"], [/\bvce\b/, "au-vce"], [/\bncea\b/, "ncea"], [/\babitur\b/, "abitur"],
];

/** Study-level words a student uses about themselves, mapped to a band. Deliberately explicit: no guessing from "university" in a topic name. */
const LEVEL_PATTERNS: Array<[RegExp, LevelBand]> = [
  [/\b(?:gcse|o[- ]?levels?|igcse|matric|ssc|year (?:10|11)|grade (?:9|10)|class (?:9|10))\b/, "secondary"],
  [/\b(?:a[- ]?levels?|as[- ]?levels?|sixth form|fsc|hssc|ib|high school|year (?:12|13)|grade (?:11|12)|class (?:11|12))\b/, "senior"],
  [/\b(?:middle school|year [7-9]|grade [6-8]|class [6-8])\b/, "middle"],
  [/\b(?:primary school|elementary school|grade [1-5])\b/, "primary"],
  [/\b(?:undergrad(?:uate)?|bachelor'?s|first[- ]year uni(?:versity)?|freshman|sophomore|mbbs|med school|medical school)\b/, "undergrad"],
  [/\b(?:postgrad(?:uate)?|master'?s|msc|mphil|phd|doctoral|residency)\b/, "postgrad"],
];

/**
 * What a lesson says about the student's level and curriculum IN ONE OF THEIR SUBJECTS.
 *
 * The owner's spec (2026-09-30): the profile "should continuously evolve based on the user's
 * interaction with Aria", subject by subject. The signal is the request itself and what the student
 * told Aria about themselves in the planning conversation — "A-level physics: projectile motion",
 * "I'm revising for the MCAT". Only a lesson that clearly belongs to one of their subjects updates
 * anything, only an explicit level or exam name counts, and a level or curriculum the STUDENT chose
 * for that subject is never replaced by a learned one. Returns null when nothing new was learned.
 */
export function learnSubjectContext(basics: LearnerBasics | null | undefined, topic: string, background?: string | null): LearnerBasics | null {
  if (!basics || basics.subjects.length === 0) return null;
  const text = `${topic} ${background ?? ""}`.toLowerCase();
  const subject = subjectForTopic(text, basics.subjects);
  if (!subject) return null;

  let changed = false;
  const subjectLevels = { ...(basics.subjectLevels ?? {}) };
  const subjectCurricula = { ...(basics.subjectCurricula ?? {}) };

  const band = LEVEL_PATTERNS.find(([re]) => re.test(text))?.[1];
  const currentLevel = subjectLevels[subject.id];
  if (band && (!currentLevel || currentLevel.learned)) {
    const level = studyLevelOptions(basics.country, [subject]).find((l) => l.band === band);
    const already = (currentLevel ?? basics.studyLevel)?.id === level?.id;
    if (level && !already) {
      subjectLevels[subject.id] = { id: level.id, label: level.label, learned: true };
      changed = true;
    }
  }

  const curriculumId = CURRICULUM_PATTERNS.find(([re]) => re.test(text))?.[1];
  const current = subjectCurricula[subject.id];
  if (curriculumId && (!current || current.every((c) => c.learned))) {
    const known = allCurricula().find((c) => c.id === curriculumId);
    const already = (current ?? basics.curricula).some((c) => c.id === curriculumId);
    if (known && !already) {
      subjectCurricula[subject.id] = [{ id: known.id, label: known.label, learned: true }];
      changed = true;
    }
  }
  return changed ? { ...basics, subjectLevels, subjectCurricula, updatedAt: new Date().toISOString() } : null;
}

/** How far into a subject each study-level band is, on the planning conversation's 1-5 scale. */
const BAND_DEPTH: Record<LevelBand, 1 | 2 | 3 | 4 | 5> = { primary: 1, middle: 1, secondary: 2, senior: 3, undergrad: 3, postgrad: 4, professional: 4 };

/**
 * The study level Aria ALREADY KNOWS for a lesson topic — or null, and then she asks.
 *
 * Known means: the topic belongs to one of the student's subjects, and there is a level for it
 * (that subject's own, else their main study level). A topic outside their subjects is a genuinely
 * new question — a postgraduate in Computer Science asking about photosynthesis is a beginner there.
 */
export function knownLevelForTopic(basics: LearnerBasics | null | undefined, topic: string): { depth: 1 | 2 | 3 | 4 | 5; level: LearnerOption; subject: LearnerOption } | null {
  if (!basics || basics.subjects.length === 0) return null;
  const subject = subjectForTopic(topic, basics.subjects);
  if (!subject) return null;
  const level = basics.subjectLevels?.[subject.id] ?? basics.studyLevel;
  const band = levelBand(level);
  return level && band ? { depth: BAND_DEPTH[band], level, subject } : null;
}

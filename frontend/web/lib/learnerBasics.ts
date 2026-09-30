import type { LearnerBasics } from "./db/cosmos";
import { sanitizeCountry, sanitizeOption, sanitizeOptions } from "./education";

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
  const subjectLevels: Record<string, { id: string; label: string; custom?: boolean }> = {};
  if (has("subjectLevels") && body.subjectLevels && typeof body.subjectLevels === "object") {
    for (const [subjectId, level] of Object.entries(body.subjectLevels as Record<string, unknown>).slice(0, 20)) {
      const clean = sanitizeOption(level);
      if (clean && /^[a-z0-9:_-]{1,90}$/i.test(subjectId)) subjectLevels[subjectId] = clean;
    }
  }
  const next: LearnerBasics = {
    country: has("country") ? sanitizeCountry(body.country) : existing?.country ?? null,
    countrySource: has("country") ? countrySource ?? "user" : existing?.countrySource ?? null,
    studyLevel: has("studyLevel") ? sanitizeOption(body.studyLevel) : existing?.studyLevel ?? null,
    subjects: has("subjects") ? sanitizeOptions(body.subjects, 12) : existing?.subjects ?? [],
    curricula: has("curricula") ? sanitizeOptions(body.curricula, 8) : existing?.curricula ?? [],
    subjectLevels: has("subjectLevels") ? subjectLevels : existing?.subjectLevels ?? {},
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

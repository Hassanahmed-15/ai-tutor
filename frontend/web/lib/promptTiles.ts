import type { LearnerProfileView } from "./learnerProfileView";

/**
 * THE HOMEPAGE PROMPT TILES — lecture recommendations from the learner profile (owner's spec,
 * 2026-09-29: the profile exists "for more relevant lecture recommendations (prompt tiles on the
 * homepage)").
 *
 * What Aria already knows comes first, because it is the most personal: an idea they are weak on,
 * one that needs review, the next step after what they studied this fortnight. The rest are fresh
 * lessons for their subjects at their level and curriculum — written by a model once a day
 * (/api/learner-profile/tiles) and, when that is unavailable, a plain line per subject so the row is
 * never empty for someone with a profile.
 *
 * A tile is a whole request: pressing it starts the lesson exactly as if the student had typed it.
 *
 * Pure: unit-tested in lib/anim/promptTiles.test.ts.
 */

export type PromptTileKind = "weak" | "review" | "continue" | "fresh";

export type PromptTile = {
  id: string;
  kind: PromptTileKind;
  /** What goes to Aria — the same text as if the student had typed it. */
  prompt: string;
  /** Why this tile is here, in a few words ("You found this tricky"). */
  reason: string;
};

export const MAX_TILES = 4;
/** No more than this many tiles come from memory, so fresh lessons always get room. */
const MAX_FROM_MEMORY = 2;

const REASONS: Record<PromptTileKind, string> = {
  weak: "You found this tricky",
  review: "Due for a refresher",
  continue: "Pick up where you left off",
  fresh: "For your studies",
};

const tile = (kind: PromptTileKind, prompt: string, reason = REASONS[kind]): PromptTile => ({
  id: `${kind}:${prompt.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 60)}`,
  kind,
  prompt: prompt.replace(/\s+/g, " ").trim().slice(0, 160),
  reason,
});

/** Tiles from what Aria remembers: weak ideas, then ones due for review, then the next step. */
export function memoryTiles(view: LearnerProfileView): PromptTile[] {
  const out: PromptTile[] = [];
  const weak = view.subjects.flatMap((s) => s.weakConcepts).sort((a, b) => a.mastery - b.mastery);
  const review = view.subjects.flatMap((s) => s.needsReview).sort((a, b) => a.mastery - b.mastery);
  if (weak[0]) out.push(tile("weak", `Help me really understand ${weak[0].label}`));
  if (review[0]) out.push(tile("review", `Quick refresher on ${review[0].label}`));
  const current = view.currentTopics[0];
  if (current) out.push(tile("continue", `What comes after ${current}?`));
  return dedupe(out).slice(0, MAX_FROM_MEMORY);
}

/** One plain line per subject — the fallback when no model wrote fresh ideas. */
export function fallbackFreshTiles(view: LearnerProfileView): PromptTile[] {
  const b = view.basics;
  if (!b) return [];
  const level = b.studyLevel?.label;
  const curriculum = b.curricula[0]?.label;
  return b.subjects.map((subject) => {
    const levelFor = b.subjectLevels?.[subject.id]?.label ?? level;
    const scope = curriculum ? `${curriculum} ${subject.label}` : levelFor ? `${subject.label} at ${levelFor} level` : subject.label;
    return tile("fresh", `The key ideas in ${scope}`, subject.label);
  });
}

/**
 * The row: memory tiles, then fresh ideas (a model's, else the fallback), deduplicated, and never
 * one on something they have already mastered.
 */
export function promptTiles(view: LearnerProfileView, fresh: PromptTile[] | null): PromptTile[] {
  const mastered = new Set(view.subjects.flatMap((s) => s.mastered).map((c) => c.label.toLowerCase()));
  const notMastered = (t: PromptTile) => ![...mastered].some((m) => m && t.prompt.toLowerCase().includes(m));
  const fromMemory = memoryTiles(view);
  const ideas = (fresh && fresh.length ? fresh : fallbackFreshTiles(view)).filter(notMastered);
  return dedupe([...fromMemory, ...ideas]).slice(0, MAX_TILES);
}

function dedupe(tiles: PromptTile[]): PromptTile[] {
  const seen = new Set<string>();
  return tiles.filter((t) => {
    const key = t.prompt.toLowerCase();
    if (!t.prompt || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Model output → tiles: strings or {prompt, subject}; anything else is dropped. */
export function freshTilesFrom(raw: unknown): PromptTile[] {
  const list = Array.isArray(raw) ? raw : [];
  const out: PromptTile[] = [];
  for (const item of list) {
    const prompt = typeof item === "string" ? item : typeof item?.prompt === "string" ? item.prompt : "";
    const subject = typeof item?.subject === "string" ? item.subject.trim().slice(0, 40) : "";
    if (prompt.trim().length < 6) continue;
    out.push(tile("fresh", prompt, subject || REASONS.fresh));
  }
  return dedupe(out).slice(0, MAX_TILES);
}

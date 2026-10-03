import { boundMemory, MASTERY_TARGETS, MEMORY_LIMITS, type ConceptMemory, type LearnerMemory } from "../learnerModel";
import { bktUpdate, implicitCredit, nextStability, reviewDueAt } from "./graph";

/**
 * THE STUDENT'S LAYER of the knowledge graph: how evidence from a lecture moves their memory.
 * Pure — lib/learnerMemoryStore.ts saves it; unit-tested in lib/anim/knowledgeGraph.test.ts.
 *
 * Concepts here are keyed exactly as the shared graph keys them (graph.ts canonicalKey), so a
 * concept a student met in one lecture is the same star when another lecture teaches it.
 */

export type TaughtAt = { lectureId: string; sequence: number; beatId: string; title: string; topic: string };

function concept(memory: LearnerMemory, key: string, label: string, now: string): ConceptMemory {
  const existing = memory.concepts[key];
  if (existing) return existing;
  const fresh: ConceptMemory = { key, label: label.slice(0, 120), mastery: 0, evidence: [], lastSeen: now, topics: [], firstSeen: now };
  memory.concepts[key] = fresh;
  return fresh;
}

/**
 * The student watched a board to the end: each concept on it has now been TAUGHT. Exposure, not
 * understanding, so mastery settles toward "covered" and never drops; the board is remembered as
 * where it was taught, and a first review is scheduled a day out.
 */
export function recordTaught(memory: LearnerMemory, items: Array<{ key: string; label: string; at: TaughtAt }>, now = new Date().toISOString()): LearnerMemory {
  if (items.length === 0) return memory;
  const next: LearnerMemory = structuredClone(memory);
  for (const { key, label, at } of items) {
    if (!key) continue;
    const c = concept(next, key, label, now);
    const isNew = c.evidence.length === 0;
    c.mastery = Math.max(c.mastery, isNew ? MASTERY_TARGETS.covered : c.mastery + 0.5 * (MASTERY_TARGETS.covered - c.mastery));
    c.evidence = [...c.evidence, { source: "lecture" as const, at: now, note: `taught in the lesson "${at.topic}"` }].slice(-MEMORY_LIMITS.evidencePerConcept);
    c.lastSeen = now;
    c.topics = [...new Set([...c.topics, at.topic].filter(Boolean))].slice(-8);
    c.firstSeen = c.firstSeen ?? now;
    const taught = (c.taught ?? []).filter((t) => !(t.lectureId === at.lectureId && t.sequence === at.sequence));
    c.taught = [...taught, { ...at, at: now }].slice(-4);
    if (!c.reviewDue) {
      c.stability = nextStability(c.stability, "taught");
      c.lastPracticed = now;
      c.reviewDue = reviewDueAt(now, c.stability);
    }
  }
  next.updatedAt = now;
  return boundMemory(next);
}

/**
 * The student answered something that tests these concepts — a Predict-it question, a drawing Aria
 * checked, a review. Knowledge tracing moves each concept's mastery; a correct answer also credits
 * the prerequisites the graph knows of (FIRe), and the review schedule stretches or shrinks.
 */
export function recordAnswer(
  memory: LearnerMemory,
  answer: {
    concepts: Array<{ key: string; label: string }>;
    correct: boolean;
    /** The chance of getting it right by luck: 1/3 for a three-option question. */
    guess: number;
    topic: string;
    source: "quiz" | "drawing" | "review";
    prerequisites?: Array<{ key: string; confidence: number }>;
  },
  now = new Date().toISOString(),
): LearnerMemory {
  if (answer.concepts.length === 0) return memory;
  const next: LearnerMemory = structuredClone(memory);
  const what = answer.source === "drawing" ? "a drawing Aria checked" : answer.source === "review" ? "a review" : "a prediction question";
  for (const { key, label } of answer.concepts) {
    if (!key) continue;
    const c = concept(next, key, label, now);
    // A concept never taught or tested starts from "unknown" for the update, not from zero.
    const prior = c.evidence.length === 0 ? 0.3 : c.mastery;
    c.mastery = bktUpdate(prior, answer.correct, { guess: answer.guess });
    c.evidence = [...c.evidence, { source: "checkpoint" as const, at: now, note: `${answer.correct ? "got" : "missed"} ${what} in "${answer.topic}"` }].slice(-MEMORY_LIMITS.evidencePerConcept);
    c.lastSeen = now;
    c.topics = [...new Set([...c.topics, answer.topic].filter(Boolean))].slice(-8);
    c.firstSeen = c.firstSeen ?? now;
    c.stability = nextStability(c.stability, answer.correct ? "correct" : "wrong");
    c.lastPracticed = now;
    c.reviewDue = reviewDueAt(now, c.stability);
  }
  if (answer.correct) {
    const tested = new Set(answer.concepts.map((c) => c.key));
    for (const p of answer.prerequisites ?? []) {
      const c = next.concepts[p.key];
      if (!c || tested.has(p.key)) continue;
      c.mastery = implicitCredit(c.mastery, p.confidence);
      // Practising what builds on it is practice of it too: its review moves out a little.
      if (c.stability && c.lastPracticed) {
        c.stability = Math.min(180, c.stability * (1 + 0.5 * p.confidence));
        c.reviewDue = reviewDueAt(c.lastPracticed, c.stability);
      }
    }
  }
  next.updatedAt = now;
  return boundMemory(next);
}

/** The student's own rating on the map ("I know this" / "not sure") — shown beside Aria's estimate. */
export function rateConcept(memory: LearnerMemory, key: string, rating: "know" | "unsure" | null, now = new Date().toISOString()): LearnerMemory {
  const c = memory.concepts[key];
  if (!c) return memory;
  const next: LearnerMemory = structuredClone(memory);
  if (rating) next.concepts[key].selfRating = rating;
  else delete next.concepts[key].selfRating;
  next.updatedAt = now;
  return next;
}

/** Concepts due for review now, most overdue first. */
export function dueForReview(memory: LearnerMemory, now = Date.now(), limit = 8): ConceptMemory[] {
  return Object.values(memory.concepts)
    .filter((c) => c.reviewDue && Date.parse(c.reviewDue) <= now && (c.taught?.length ?? 0) > 0)
    .sort((a, b) => Date.parse(a.reviewDue!) - Date.parse(b.reviewDue!))
    .slice(0, limit);
}

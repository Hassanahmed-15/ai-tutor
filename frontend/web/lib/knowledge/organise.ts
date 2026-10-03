import "server-only";

import { bounded, client, jsonCall } from "../canvas/generate";
import { loadLearnerMemory, updateLearnerMemory } from "../learnerMemoryStore";
import type { LearnerMemory } from "../learnerModel";
import { canonicalKey, validateLectureKnowledge } from "./graph";
import { reorganiseConcepts } from "./overlay";
import { conceptsMatching, mergeLectureIntoGraph } from "./store";

/**
 * Puts a student's OLDER memories on the knowledge map: concepts recorded before the graph existed
 * were board titles and fragments, with no subject and no links. One small call (~$0.01) groups
 * them into real concepts, names their subjects and the links between them, and marks what was
 * never a concept; the graph learns the concepts and links, the student's memory is re-keyed
 * (lib/knowledge/overlay.ts reorganiseConcepts). It runs when the map opens and finds enough
 * unorganised entries, so a student who never opens the map never pays for it.
 */

const MODEL = process.env.KNOWLEDGE_MODEL ?? "gpt-5.6-luna";
/** Below this many unorganised entries the map is drawn as it is. */
export const ORGANISE_THRESHOLD = 8;

const SYSTEM = `You organise a student's study history into a knowledge graph. You get a numbered list of things recorded as "concepts" — many are lesson or slide titles, phrasings of the same idea, or not concepts at all. Return JSON only:
{"concepts": [{"key": string, "label": string, "aliases": [string], "subject": string, "summary": string}],
 "map": [{"i": number, "key": string | null}],
 "edges": [{"from": string, "to": string, "type": "needs" | "part-of" | "related"}]}

- A concept is one idea a student can know or not know ("overfitting", "while loop", "glucose", "Calvin cycle"). "key": its plain common name, lower case, singular, 1 to 3 words. "label": how to show it. "subject": one word ("biology", "machine learning", "computing", "chemistry", "economics", "maths", ...). "summary": what it is, at most 15 words.
- "map": for EVERY numbered entry, the key of the concept it is about. Different phrasings of one idea map to the same key ("Why Overfitting Happens", "Understanding overfitting", "Defining Overfitting" → "overfitting"). An entry that is not a concept — a figure or page reference, a publisher, a heading like "Learning Objectives", a stray formula or fragment — maps to null.
- "edges": only links a teacher would agree with. "needs": {"from": A, "to": B} means B must be understood before A. "part-of": A is part or kind of B. "related": closely connected. Point from the harder idea to what it builds on.`;

export function unorganised(memory: LearnerMemory, inGraph: Set<string>): string[] {
  return Object.values(memory.concepts).filter((c) => !c.offMap && !inGraph.has(c.key) && !(c.taught?.length)).map((c) => c.key);
}

export async function organiseMemory(userId: string): Promise<{ organised: number; costUsd: number }> {
  const memory = await loadLearnerMemory(userId);
  const keys = Object.keys(memory.concepts);
  const inGraph = new Set((await conceptsMatching(keys)).map((c) => c.id));
  const pending = unorganised(memory, inGraph);
  if (pending.length < ORGANISE_THRESHOLD) return { organised: 0, costUsd: 0 };
  const list = pending.slice(0, 200).map((k, i) => `${i}. ${memory.concepts[k].label}${memory.concepts[k].topics[0] ? ` (from a lesson on "${memory.concepts[k].topics[0]}")` : ""}`);
  const { json, costUsd } = await bounded(jsonCall(client(), MODEL, SYSTEM, list.join("\n"), 12000), 90_000, "organise");
  const knowledge = validateLectureKnowledge(json, 0);
  if (!knowledge) return { organised: 0, costUsd };
  // The graph learns the concepts and links (counted once, as this student's history).
  const merged = await mergeLectureIntoGraph(`history-${userId.slice(0, 8)}`, knowledge);
  const remap = new Map(knowledge.concepts.map((c, i) => [c.key, merged.concepts[i]]));
  const mapping: Record<string, { key: string; label: string } | null> = {};
  const raw = (json && typeof json === "object" ? (json as Record<string, unknown>).map : null) as unknown;
  for (const entry of Array.isArray(raw) ? raw : []) {
    const e = (entry && typeof entry === "object" ? entry : {}) as Record<string, unknown>;
    const i = Math.floor(Number(e.i));
    const oldKey = pending[i];
    if (!oldKey) continue;
    if (e.key === null) {
      mapping[oldKey] = null;
      continue;
    }
    const target = remap.get(canonicalKey(String(e.key ?? "")));
    if (target) mapping[oldKey] = { key: target.key, label: target.label };
  }
  // An entry the model was shown but did not place is treated as not a concept, so the same entries
  // never send the map back to the model on the next visit.
  for (const k of pending.slice(0, 200)) if (!(k in mapping)) mapping[k] = null;
  await updateLearnerMemory(userId, (m) => reorganiseConcepts(m, mapping));
  console.log(`[knowledge] organised ${Object.keys(mapping).length}/${pending.length} older memories for ${userId} into ${merged.concepts.length} concepts, $${costUsd.toFixed(4)}`);
  return { organised: Object.keys(mapping).length, costUsd };
}

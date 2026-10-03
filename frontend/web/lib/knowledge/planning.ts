import "server-only";

import { effectiveMastery } from "../learnerModel";
import { loadLearnerMemory } from "../learnerMemoryStore";
import type { ProgressiveLectureInput } from "../progressiveLectureTypes";
import { shakyPrerequisites, type PlanningKnowledge } from "./graph";
import { conceptsInText, conceptsMatching, edgesTouching } from "./store";

/**
 * What the planner should know about THIS student and THIS topic, from the graph and their memory:
 *
 *   - what they have already mastered (refer back to it, do not re-teach it);
 *   - the prerequisites they are shaky on (the lesson may open with one short refresher);
 *   - what they learned in earlier lectures that this one connects to (say so: "remember glucose?").
 *
 * Empty for a new student or a topic the graph has not met — the lecture is then planned exactly as
 * before. Bounded and best effort: planning never waits long on it and never fails because of it.
 */
export type { PlanningKnowledge };

export const NO_PLANNING_KNOWLEDGE: PlanningKnowledge = { mastered: [], shaky: [], earlier: [] };

export async function knowledgeForPlanning(userId: string, input: ProgressiveLectureInput): Promise<PlanningKnowledge> {
  const text = [input.topic, input.focus ?? "", ...(input.outline?.subtopics ?? []).map((s) => s.title)].join(" . ");
  const [memory, topical, central] = await Promise.all([loadLearnerMemory(userId), conceptsInText(text), conceptsInText(`${input.topic} . ${input.focus ?? ""}`)]);
  if (topical.length === 0) return NO_PLANNING_KNOWLEDGE;
  const keys = topical.map((c) => c.id);
  // A refresher is for what the TOPIC builds on — not for everything its outline mentions in passing
  // (a lesson on respiration that compares it with photosynthesis should not refresh chloroplasts).
  const centralKeys = central.map((c) => c.id);
  const edges = await edgesTouching(keys);
  const now = Date.now();
  const mastery = (key: string) => {
    const c = memory.concepts[key];
    return c ? effectiveMastery(c, now) : undefined;
  };
  // A prerequisite the student never met is only worth a refresher when several lectures agree it
  // is one; one they met and are shaky on always is.
  const shakyRaw = shakyPrerequisites(centralKeys, edges, mastery, 4).filter((s) => s.mastery !== undefined || s.confidence >= 0.64);
  const neighbours = [...new Set([...edges.map((e) => e.from), ...edges.map((e) => e.to)])];
  const graphConcepts = await conceptsMatching([...shakyRaw.map((s) => s.key), ...neighbours]);
  const label = (key: string) => memory.concepts[key]?.label ?? graphConcepts.find((c) => c.id === key)?.label ?? topical.find((c) => c.id === key)?.label ?? key;

  const relevant = [...new Set([...keys, ...neighbours])];
  // Only what the topic builds on — never the topic itself, which they asked to learn (again).
  const mastered = neighbours.filter((k) => !keys.includes(k) && (mastery(k) ?? 0) >= 0.7).slice(0, 6).map(label);
  const earlier = relevant
    .map((k) => memory.concepts[k])
    .filter((c) => c && (c.taught?.length ?? 0) > 0 && (mastery(c.key) ?? 0) >= 0.4)
    .slice(0, 4)
    .map((c) => ({ label: c!.label, topic: c!.taught![0].topic }));
  const shaky = shakyRaw.slice(0, 2).map((s) => ({ label: label(s.key), for: label(s.for) }));
  return { mastered, shaky, earlier };
}

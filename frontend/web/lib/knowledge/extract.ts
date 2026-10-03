import "server-only";

import { bounded, client, jsonCall } from "../canvas/generate";
import type { ProgressiveBeatPlan } from "../progressiveLectureTypes";
import { validateLectureKnowledge, type LectureKnowledge } from "./graph";

/**
 * One lecture's concepts and links, read off its plan by one small model call (~$0.002, a few
 * seconds). Runs in the worker right after the plan is made, beside the boards, never before them —
 * so it costs the student no time. It also names the PREREQUISITES the lecture assumes but does not
 * teach, which is how the shared graph learns what comes before what.
 */

const MODEL = process.env.KNOWLEDGE_MODEL ?? "gpt-5.6-luna";

const SYSTEM = `You map a lesson onto a knowledge graph of concepts. Return JSON only:
{"concepts": [{"key": string, "label": string, "aliases": [string], "subject": string, "summary": string, "taught": boolean}],
 "edges": [{"from": string, "to": string, "type": "needs" | "part-of" | "related"}],
 "beats": [{"sequence": number, "concepts": [string], "elements": {"<element id>": "<concept key>"}}]}

CONCEPTS
- A concept is one idea a student can know or not know: "glucose", "chloroplast", "limiting factor", "balanced equation" — never a whole lesson title ("why plants need light") and never a sentence.
- "key": the plain common name, lower case, singular, 1 to 3 words ("carbon dioxide", not "CO2" or "carbon dioxide gas"). "label": how to show it ("Carbon dioxide"). "aliases": other names and symbols ("co2"). "subject": one word ("biology", "chemistry", "physics", "maths", "history", "computing", ...). "summary": what it is, in at most 15 words.
- "taught": true for what this lesson teaches (4 to 14 concepts); also list 1 to 5 concepts the lesson ASSUMES the student already knows but does not teach ("taught": false) — what a student would need first.

LINKS — only ones a teacher would agree with
- "needs": {"from": A, "to": B} means you must understand B before you can understand A (photosynthesis needs chlorophyll; a balanced equation needs atoms). Point from the harder idea to the one it builds on.
- "part-of": A is a part or kind of B (chloroplast part-of plant cell).
- "related": closely connected, neither needs the other. Use sparingly.
- Every concept that is taught should have at least one link. No link to itself.

BOARDS
- For every board: "sequence" as given, "concepts": the 1 to 4 concepts that board teaches (keys), and "elements": for each of the board's drawn objects listed, the concept key it stands for — only when the object IS that concept.`;

export async function extractLectureKnowledge(topic: string, plan: ProgressiveBeatPlan[]): Promise<{ knowledge: LectureKnowledge | null; costUsd: number }> {
  const boards = plan.map((p) => {
    const c = p.canvas;
    const objects = c?.objects?.length ? `\n  drawn objects (element ids): ${c.objects.join(", ")}` : "";
    const said = c?.script ? `\n  Aria says: ${c.script.slice(0, 420)}` : "";
    return `Board ${p.sequence}: ${p.title} — ${p.objective}${objects}${said}`;
  });
  const user = `Lesson: ${topic}\n\n${boards.join("\n\n")}`;
  let costUsd = 0;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const { json, costUsd: c } = await bounded(jsonCall(client(), MODEL, SYSTEM, user, 5000), 60_000, "knowledge");
      costUsd += c;
      const knowledge = validateLectureKnowledge(json, plan.length);
      if (knowledge) return { knowledge, costUsd };
    } catch (error) {
      costUsd += (error as { costUsd?: number }).costUsd ?? 0;
      console.warn(`[knowledge] extraction attempt ${attempt} failed: ${(error as Error).message}`);
    }
  }
  return { knowledge: null, costUsd };
}

import OpenAI from "openai";
import { applyPersonaResult, personaEvidence, type LearnerMemory } from "./learnerModel";
import { costFor } from "./modelPricing";

/**
 * Writing "what Aria thinks about you".
 *
 * The memory holds evidence — concepts with mastery numbers, lessons, checkpoint results, the
 * student's own words. None of that reads as a person. This asks one small model to write the
 * portrait a good teacher would give after those lessons, and to tidy the concept list that the
 * lecture titles left behind ("Why explain me hill cipher" is a beat title, not a concept).
 *
 * The model is told what it may and may not say: only what the evidence supports, naming it; no
 * flattery; nothing guessed about the student's life; and whatever the student wrote about
 * themselves is the truth. What comes back is validated by applyPersonaResult, which trusts none
 * of it structurally: a bad answer leaves memory as it was.
 */

const MODEL = process.env.OPENAI_PERSONA_MODEL ?? "gpt-4o-mini";

export const PERSONA_SYSTEM_PROMPT = `You are Aria, a tutor who has taught ONE student many times. Write your private read of WHO THEY ARE, for the student to see and for you to plan their next lesson with.

This is a persona inferred from what they do, not a report of what they studied. Read the pattern: the topics they choose across all their lessons, whether they ask for code, whether they push deeper or ask for simpler, what they say in their own words. From that, say who they probably are — their world (e.g. software, medicine, school maths), their likely role or stage (a working developer, a student before an exam, a curious generalist), how they like to be taught — and name the clue for each inference ("nearly every topic is ML or security and you asked for code in most lessons, so you're probably a developer moving into ML"). Hedge inferences ("probably", "it looks like"); never invent facts about their life. If the evidence is thin, say only what it supports.

BRIEF. The summary is 2-3 sentences, at most 70 words, every sentence carrying an inference or a fact. No praise of their effort, commitment or consistency; no "you have engaged with a variety of topics"; do not list topics or concepts in the summary — the chips do that. Address the student as "you". If THE STUDENT'S OWN DESCRIPTION is present, it is the truth: build on it and never contradict it.

CONCEPT CLEAN-UP (required, be decisive). Each concept is shown as [key] Label. Many labels are lecture-beat titles recorded as if they were concepts, often truncated to "<lesson title>: <one word>" — these are NOT concepts and must not be left as they are, and must never appear in interests, strengths or growthAreas. For every such key do exactly one of: RENAME it to the concept that beat evidently taught (e.g. "Vaccines Train the Immune: Memory" → "Immune memory"); MERGE it with the other keys from the same lesson into one real concept (e.g. into "How vaccines train the immune system"); or DROP it when the label is a question, a filler word ("Try", "a", "How", "Common", "Compare", "Core") or an activity. Keys that already name a real concept ("Markov chains", "Memory cells") stay as they are. Use only keys that appear in the evidence, exactly as written.

Return JSON only:
{
  "summary": "2-3 sentences, at most 70 words: who they probably are and how they learn, each inference tied to its clue",
  "interests": ["up to 5 DOMAINS they gravitate to (e.g. machine learning, cryptography), not lesson titles"],
  "strengths": ["up to 5 real concepts or skills they have shown"],
  "growthAreas": ["up to 5 real concepts still settling, or misconceptions to fix — never a beat title"],
  "learningStyle": "one short sentence on how they like to be taught, from what they do (asks for code, pushes deeper, wants it simpler), or empty",
  "teachingPlan": "one sentence: how you will teach this person next time, given who they are",
  "concepts": {
    "merge": [{ "into": "Real concept name", "keys": ["key a", "key b"] }],
    "rename": [{ "key": "existing key", "label": "Real concept name" }],
    "drop": ["existing key"]
  }
}`;

export type PersonaGeneration = { memory: LearnerMemory; costUsd: number; changed: boolean };

/** Writes the portrait from everything in memory. Returns memory unchanged when the model fails. */
export async function generatePersona(memory: LearnerMemory, client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })): Promise<PersonaGeneration> {
  const evidence = personaEvidence(memory);
  if (!evidence) return { memory, costUsd: 0, changed: false };
  const completion = await client.chat.completions.create({
    model: MODEL,
    temperature: 0.3,
    max_tokens: 900,
    messages: [
      { role: "system", content: PERSONA_SYSTEM_PROMPT },
      { role: "user", content: `EVIDENCE ABOUT THE STUDENT\n\n${evidence}` },
    ],
    response_format: { type: "json_object" },
  });
  let raw: unknown = null;
  try {
    raw = JSON.parse(completion.choices[0]?.message?.content ?? "");
  } catch {
    raw = null;
  }
  const next = applyPersonaResult(memory, raw);
  return { memory: next, costUsd: costFor(MODEL, completion.usage), changed: next !== memory };
}

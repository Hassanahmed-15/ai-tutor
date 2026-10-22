/**
 * STRUCTURE AUDIT (concept ladder, lib/canvas/conceptLadder.ts): an independent reviewer reads every
 * board's script with what the student told Aria (the intake's parts and statuses) and checks the
 * lesson's STRUCTURE, citing board numbers for every fault so each claim can be verified by hand.
 *   NODE_OPTIONS=--conditions=react-server npx tsx --env-file=.env.local --tsconfig tsconfig.json scripts/bench/structure-audit.mts <snapshot.json>...
 */
import { readFileSync } from "node:fs";
import { client, jsonCall, PLAN_MODEL } from "../../lib/canvas/generate.ts";

const SYSTEM = `You are a strict, unbiased reviewer of how a narrated lesson is STRUCTURED (not its visuals). Before the lesson, the student marked the topic's parts: NEW (never met), SHAKY (half known, or failed a basic check) or KNOWN (confirmed by a basic check). The lesson was supposed to:
- build every NEW part from scratch, in this order: why it matters, the new words defined BEFORE they are used, the simplest concrete case, the name with one non-example, how it works in small steps, a worked example, the common mistake (when one exists), and a link to the next part;
- re-teach every SHAKY part properly but more briefly;
- give every KNOWN part only a short recap where it is needed, never a re-teach;
- teach prerequisites before what depends on them, define every term before using it, repeat nothing, and (for a beginner) open with a map of the parts.
Judge what the scripts ACTUALLY do. Do not give credit for intentions or titles: read the sentences. Cite board ids (b1, b2…) for every fault. Be specific and fair: name what is good too.
Return JSON only: {"perPart": [{"part": string, "status": "new"|"shaky"|"known", "boards": string[], "ladderSteps": {"why": boolean, "wordsFirst": boolean, "simpleCase": boolean, "named": boolean, "stepByStep": boolean, "workedExample": boolean, "mistake": boolean, "link": boolean}, "verdict": string}], "usedBeforeDefined": [{"term": string, "board": string}], "repeats": [{"what": string, "boards": string[]}], "orderProblems": string[], "knownRetaught": string[], "scores": {"fromScratch": number, "order": number, "fitToWhatTheyKnow": number, "noRepetition": number, "pacing": number, "overall": number}, "summary": string}
Scores are 1-10. "fitToWhatTheyKnow": does the depth per part match NEW/SHAKY/KNOWN?`;

let total = 0;
for (const file of process.argv.slice(2)) {
  const snap = JSON.parse(readFileSync(file, "utf8")) as { topic?: string; intake?: { profile?: { parts?: Array<{ label: string; status: string }> } }; beats: Array<{ title: string; script: string; stage?: string; plannedStage?: string }> };
  const parts = snap.intake?.profile?.parts ?? [];
  const user = `Lesson: ${snap.topic ?? file}\nWhat the student marked (in teaching order):\n${parts.map((p, i) => `${i + 1}. ${p.label}: ${p.status.toUpperCase()}`).join("\n") || "(not recorded)"}\n\nTHE LESSON, board by board:\n${snap.beats.map((b, i) => `b${i + 1}. ${b.title}\n${b.script}`).join("\n\n")}`;
  const { json, costUsd } = await jsonCall(client(), PLAN_MODEL, SYSTEM, user, 6000);
  total += costUsd;
  console.log(`\n===== ${snap.topic ?? file} ($${costUsd.toFixed(3)})`);
  console.log(JSON.stringify(json, null, 1));
}
console.log(`\ntotal $${total.toFixed(3)}`);

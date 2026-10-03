/**
 * CAN THE CHAT ANSWER FROM ANYWHERE IN THE VIDEO — INCLUDING ITS LAST MINUTES?
 *
 * A video lesson's chat is given the whole transcript (lib/lessonChatContext.ts), where a document
 * is cut at 30,000 characters — about half an hour of speech. This sends real questions through the
 * chat route with the document context the player builds, and checks each answer against a pattern
 * only the video can supply. Ask about something said near the END of a video longer than half an
 * hour: under the old cap that part of the transcript never reached the model.
 *
 *   node scripts/test-youtube-chat.mjs <ingest.json> "<question>" "<regex the answer must match>" [more pairs…]
 *
 *   ingest.json  from scripts/test-youtube-ingest.mts
 *
 * Also asserts the answer cites a moment in the video when it draws on it ("around 38:10"). Prefix a
 * regex with "beyond:" for a question the video does NOT answer: it must still be answered, and no
 * moment is expected.
 *
 * COST: one chat call per question on the chat model, each carrying the transcript (about 13,000
 * input tokens per hour of video): a few cents per question.
 */
import fs from "node:fs";

const BASE = process.env.LAB_URL ?? "http://localhost:3000";
const [ingestFile, ...pairs] = process.argv.slice(2);
if (!ingestFile || pairs.length < 2 || pairs.length % 2) {
  console.error('usage: node scripts/test-youtube-chat.mjs <ingest.json> "<question>" "<regex>" [more pairs…]');
  process.exit(2);
}
const ingest = JSON.parse(fs.readFileSync(ingestFile, "utf8"));
const transcript = String(ingest.fullDocumentText ?? "");
const beats = ingest.document?.lessonPlan?.beats ?? [];
const log = (...parts) => console.log(...parts);
const problems = [];

log(`"${ingest.title}": transcript ${transcript.length} characters${transcript.length > 30_000 ? " (past the 30,000 a document is cut at)" : " (inside a document's cap: use a longer video to test the cap)"}`);
const lessonContext = beats.map((beat, i) => `${i + 1}. ${beat.title}${i === 0 ? " ← PLAYING NOW" : " (still to come)"}`).join("\n");

for (let i = 0; i < pairs.length; i += 2) {
  const question = pairs[i];
  const beyond = pairs[i + 1].startsWith("beyond:");
  const expected = new RegExp(pairs[i + 1].replace(/^beyond:/, ""), "i");
  const startedAt = Date.now();
  const response = await fetch(`${BASE}/api/explain`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      topic: ingest.title,
      question,
      // Words only: the question is whether the answer is RIGHT, not whether a board can be drawn.
      offer: true,
      beatContext: beats[0] ? `${beats[0].title}: ${beats[0].objective}` : "",
      lessonContext,
      documentContext: transcript,
      // What the player sends for a video lesson: the lecture is strict, the conversation is not.
      sourceScope: { fidelity: "reference", breadth: { kind: "whole" }, documentLabels: [] },
    }),
  });
  const data = await response.json().catch(() => ({}));
  const answer = String(data.script ?? data.answer ?? data.text ?? JSON.stringify(data)).replace(/\s+/g, " ");
  const ok = response.ok && expected.test(answer);
  const cites = /\b\d{1,2}:\d{2}\b|minutes? in|mark\b/.test(answer);
  log(`\nQ: ${question}\nA: ${answer.slice(0, 600)}\n   ${ok ? "matches" : "DOES NOT MATCH"} /${pairs[i + 1]}/ · ${cites ? "cites a moment" : "no moment cited"} · ${((Date.now() - startedAt) / 1000).toFixed(1)}s · $${Number(data.costUsd ?? 0).toFixed(4)}`);
  if (!ok) problems.push(`"${question}" was not answered from the video (expected /${pairs[i + 1]}/)`);
  else if (!cites && !beyond) problems.push(`"${question}" was answered without saying when in the video`);
}

if (problems.length) {
  log(`\nFAILED:\n  - ${problems.join("\n  - ")}`);
  process.exit(1);
}
log("\nOK");

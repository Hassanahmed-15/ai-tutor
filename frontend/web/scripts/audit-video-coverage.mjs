/**
 * HOW MUCH OF THE VIDEO IS IN THE LECTURE, AND IS ANYTHING IN THE LECTURE NOT IN THE VIDEO?
 *
 * A video lecture promises to be shorter than its video without leaving anything out. The pipeline
 * checks that against its OWN notes (lib/youtube/videoCoverage.ts), which proves nothing if the
 * notes themselves missed something. This audit does not use the notes at all. A judge model reads
 * the transcript on its own, in stretches of about five minutes, and lists the key facts a student
 * should come away with; a second pass then looks for each of those facts in the finished lecture.
 * That is the completeness measure of FineSurE (Song et al., ACL 2024): key facts taken from the
 * source, aligned against the summary.
 *
 * The same judge then reads each board's script against the transcript and lists anything the
 * lecture states that the video does not (faithfulness).
 *
 *   node scripts/audit-video-coverage.mjs <ingest.json> <lecture.json> [out.json]
 *
 *   ingest.json   from scripts/test-youtube-ingest.mts (its fullDocumentText is the transcript)
 *   lecture.json  from scripts/test-youtube-lecture.mjs --generate
 *
 * Reports: key facts covered / partly covered / missing, with the missing ones listed; unsupported
 * lecture statements; and how long the lecture is next to the video.
 *
 * COST: two judge calls per five minutes of video plus one per board, on gpt-4o. A 20-minute video
 * is about 15 calls: a few cents. Nothing is generated.
 */
import fs from "node:fs";
import OpenAI from "openai";

const [ingestFile, lectureFile, outFile] = process.argv.slice(2);
if (!ingestFile || !lectureFile) {
  console.error("usage: node scripts/audit-video-coverage.mjs <ingest.json> <lecture.json> [out.json]");
  process.exit(2);
}
for (const line of fs.readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const m = line.match(/^(OPENAI_API_KEY)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
}
const MODEL = process.env.AUDIT_MODEL ?? "gpt-4o";
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const log = (...parts) => console.log(...parts);

const ingest = JSON.parse(fs.readFileSync(ingestFile, "utf8"));
const lecture = JSON.parse(fs.readFileSync(lectureFile, "utf8"));
const beats = (lecture.beats ?? []).filter((beat) => String(beat.script ?? "").trim());
const lectureText = beats.map((beat, i) => `BOARD ${i + 1}: ${beat.title}\n${beat.transitionIn ? `${beat.transitionIn} ` : ""}${beat.script}`).join("\n\n");

const seconds = (label) => label.split(":").reduce((total, part) => total * 60 + Number(part), 0);
const lines = String(ingest.fullDocumentText ?? "").split("\n").slice(1).map((line) => {
  const m = line.match(/^\[([\d:]+)\]\s*(.*)$/);
  return m ? { at: seconds(m[1]), text: m[2], line } : null;
}).filter(Boolean);
if (!lines.length || !beats.length) {
  console.error("the ingest has no transcript or the lecture has no scripts");
  process.exit(2);
}

/** The transcript in stretches of about five minutes, cut at line boundaries. */
const STRETCH_SEC = 300;
const stretches = [];
for (const entry of lines) {
  const index = Math.floor(entry.at / STRETCH_SEC);
  (stretches[index] ??= []).push(entry.line);
}

async function ask(system, user) {
  const completion = await client.chat.completions.create({
    model: MODEL,
    temperature: 0,
    response_format: { type: "json_object" },
    messages: [{ role: "system", content: system }, { role: "user", content: user }],
  });
  return JSON.parse(completion.choices[0]?.message?.content ?? "{}");
}

const FACTS_PROMPT = `You are given one stretch of the transcript of a lecture video, with notes of what was on screen. List the key facts a student must come away with from THIS stretch: the definitions, claims, formulas, steps, numbers and examples that carry the teaching. Each is one self-contained sentence. Leave out greetings, housekeeping, sponsor messages, jokes, previews of other videos and repetition. Aim for the facts a careful examiner would test: usually 6 to 12 for five minutes of dense teaching, fewer for a thin stretch, none for a stretch that teaches nothing.
Return JSON: {"facts":["..."]}`;

const ALIGN_PROMPT = `You are given a list of key facts from a lecture video and the full script of a shorter lecture made from that video. For each fact decide whether the shorter lecture teaches it.
- "covered": the lecture states the fact, in any wording, with its essential detail (the number, the name, the condition).
- "partial": the lecture touches the idea but drops the essential detail, or states only part of it.
- "missing": the lecture does not teach it.
Judge only what the lecture's words say. Return JSON: {"results":[{"fact":"...","verdict":"covered|partial|missing","where":"BOARD n, or empty"}]} with one entry per fact, in order.`;

const FAITH_PROMPT = `You are given the transcript of a lecture video (with notes of what was on screen) and the script of one board of a shorter lecture made from it. List every statement in the board's script that asserts something the video does NOT say or show: an added fact, number, example, analogy, cause or claim. Plain explaining words, rephrasing, and connecting sentences are fine. Return JSON: {"unsupported":["the exact sentence from the script"]}, empty when everything is supported.`;

log(`auditing "${lecture.topic ?? ingest.title}" — ${stretches.filter(Boolean).length} stretches of transcript, ${beats.length} boards, judge ${MODEL}`);

const facts = [];
for (const [index, stretch] of stretches.entries()) {
  if (!stretch?.length) continue;
  const found = await ask(FACTS_PROMPT, stretch.join("\n"));
  const list = (Array.isArray(found.facts) ? found.facts : []).filter((fact) => typeof fact === "string" && fact.trim());
  log(`  ${String(Math.floor((index * STRETCH_SEC) / 60)).padStart(2)}-${Math.floor(((index + 1) * STRETCH_SEC) / 60)} min: ${list.length} key facts`);
  for (const fact of list) facts.push({ stretch: index, fact });
}

const results = [];
for (let start = 0; start < facts.length; start += 15) {
  const batch = facts.slice(start, start + 15);
  const judged = await ask(ALIGN_PROMPT, `KEY FACTS:\n${batch.map((item, i) => `${i + 1}. ${item.fact}`).join("\n")}\n\nTHE SHORTER LECTURE:\n${lectureText}`);
  const verdicts = Array.isArray(judged.results) ? judged.results : [];
  batch.forEach((item, i) => {
    const verdict = ["covered", "partial", "missing"].includes(verdicts[i]?.verdict) ? verdicts[i].verdict : "missing";
    results.push({ ...item, verdict, where: verdicts[i]?.where ?? "" });
  });
}

const transcript = lines.map((entry) => entry.line).join("\n");
const unsupported = [];
for (const [index, beat] of beats.entries()) {
  const judged = await ask(FAITH_PROMPT, `TRANSCRIPT:\n${transcript.slice(0, 200_000)}\n\nBOARD ${index + 1} ("${beat.title}") SCRIPT:\n${beat.script}`);
  for (const sentence of Array.isArray(judged.unsupported) ? judged.unsupported : []) {
    if (typeof sentence === "string" && sentence.trim()) unsupported.push({ board: index + 1, sentence: sentence.trim() });
  }
}

const count = (verdict) => results.filter((item) => item.verdict === verdict).length;
const total = results.length;
const lectureWords = beats.reduce((n, beat) => n + String(beat.script).split(/\s+/).filter(Boolean).length, 0);
const spokenWords = lines.filter((entry) => !entry.text.startsWith("(on screen,")).reduce((n, entry) => n + entry.text.split(/\s+/).length, 0);
const sentences = beats.reduce((n, beat) => n + String(beat.script).split(/(?<=[.!?])\s+/).filter(Boolean).length, 0);
const videoMin = (ingest.durationSec ?? lines[lines.length - 1].at) / 60;

log("");
log(`COMPLETENESS  ${count("covered")}/${total} key facts covered (${Math.round((100 * count("covered")) / total)}%), ${count("partial")} partial, ${count("missing")} missing`);
log(`              counting a partial as half: ${Math.round((100 * (count("covered") + count("partial") / 2)) / total)}%`);
for (const item of results.filter((entry) => entry.verdict !== "covered")) log(`   [${item.verdict}] ${item.fact}`);
log(`FAITHFULNESS  ${sentences - unsupported.length}/${sentences} lecture sentences supported by the video (${unsupported.length} not)`);
for (const item of unsupported) log(`   [board ${item.board}] ${item.sentence}`);
log(`LENGTH        lecture ${lectureWords} words (about ${(lectureWords / 150).toFixed(1)} min) from a ${videoMin.toFixed(1)} min video of ${spokenWords} spoken words: ${Math.round((100 * lectureWords) / spokenWords)}% of the words, about ${Math.round((100 * (lectureWords / 150)) / videoMin)}% of the time`);

if (outFile) {
  fs.writeFileSync(outFile, JSON.stringify({ topic: lecture.topic, results, unsupported, lectureWords, spokenWords, videoMin }, null, 1));
  log(`saved to ${outFile}`);
}

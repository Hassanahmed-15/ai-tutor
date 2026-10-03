/**
 * DOES THE VOICE TUTOR KNOW THE WHOLE VIDEO?
 *
 * The voice tutor's instruction is fixed when its socket opens, and the document it carries used to
 * be cut at 30,000 characters. For a video lesson the token route now sends the whole transcript
 * (app/api/gemini-live-token/route.ts) under rules written for a video (lib/geminiLiveContract.ts).
 * This asks the real route for the instruction a video lesson would get, opens a real Gemini Live
 * session with it, asks questions as text, and checks what the tutor SAYS against a pattern only
 * the video can supply.
 *
 *   node scripts/test-youtube-voice.mjs <ingest.json> "<question>" "<regex>" [more pairs…]
 *
 *   ingest.json  from scripts/test-youtube-ingest.mts
 *
 * Checks: the instruction holds the END of the transcript and the video rules, not the document
 * ones; the session opens with an instruction that size; each spoken answer matches its pattern.
 * It also prints the prompt tokens each turn was billed, because that is what a long video costs
 * by voice: the whole instruction is counted again on every turn.
 *
 * COST: one short Live session, a few turns of audio out. Cents.
 */
import fs from "node:fs";
import { GoogleGenAI, Modality } from "@google/genai";

const BASE = process.env.LAB_URL ?? "http://localhost:3000";
const [ingestFile, ...pairs] = process.argv.slice(2);
if (!ingestFile || pairs.length < 2 || pairs.length % 2) {
  console.error('usage: node scripts/test-youtube-voice.mjs <ingest.json> "<question>" "<regex>" [more pairs…]');
  process.exit(2);
}
for (const line of fs.readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const m = line.match(/^(GEMINI_API_KEY)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
}
const log = (...parts) => console.log(...parts);
const problems = [];

const ingest = JSON.parse(fs.readFileSync(ingestFile, "utf8"));
const transcript = String(ingest.fullDocumentText ?? "");
const lastLine = transcript.split("\n").filter(Boolean).pop() ?? "";

const tokenResponse = await fetch(`${BASE}/api/gemini-live-token`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ topic: ingest.title, documentContext: transcript, beatContext: "", lessonContext: "" }),
});
const token = await tokenResponse.json().catch(() => ({}));
if (!tokenResponse.ok || typeof token.instructions !== "string") {
  console.error(`the token route failed: ${tokenResponse.status} ${token.error ?? ""}`);
  process.exit(1);
}
const instructions = token.instructions;
log(`"${ingest.title}": transcript ${transcript.length} characters, instruction ${instructions.length} characters, model ${token.model}`);
if (!instructions.includes(lastLine.slice(0, 80))) problems.push("the instruction does not reach the end of the transcript");
if (!instructions.includes("THE VIDEO THIS LESSON WAS MADE FROM")) problems.push("the instruction does not carry the video rules");
if (instructions.includes("uploaded document")) problems.push('the instruction still calls the video an "uploaded document"');

const client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY, httpOptions: { apiVersion: "v1alpha" } });
let turn = null;
let closed = "";
const session = await client.live.connect({
  model: token.model,
  config: {
    responseModalities: [Modality.AUDIO],
    outputAudioTranscription: {},
    speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: "Kore" } } },
    systemInstruction: { parts: [{ text: instructions }] },
  },
  callbacks: {
    onmessage: (message) => {
      if (!turn) return;
      const said = message.serverContent?.outputTranscription?.text;
      if (said) turn.said += said;
      if (message.usageMetadata?.promptTokenCount) turn.promptTokens = message.usageMetadata.promptTokenCount;
      if (message.serverContent?.turnComplete) turn.done = true;
    },
    onerror: (event) => { closed = `error: ${event?.message ?? "socket error"}`; },
    onclose: (event) => { closed = closed || `closed ${event?.code ?? ""} ${String(event?.reason ?? "").slice(0, 160)}`; },
  },
});

for (let i = 0; i < pairs.length; i += 2) {
  const question = pairs[i];
  const expected = new RegExp(pairs[i + 1], "i");
  turn = { said: "", done: false, promptTokens: 0 };
  const startedAt = Date.now();
  session.sendClientContent({ turns: question, turnComplete: true });
  while (!turn.done && !closed && Date.now() - startedAt < 60_000) await new Promise((resolve) => setTimeout(resolve, 250));
  // Usage arrives just after the turn completes.
  await new Promise((resolve) => setTimeout(resolve, 1200));
  const said = turn.said.replace(/\s+/g, " ").trim();
  const ok = expected.test(said);
  log(`\nQ: ${question}\nA (spoken): ${said.slice(0, 500) || "(nothing)"}\n   ${ok ? "matches" : "DOES NOT MATCH"} /${pairs[i + 1]}/ · ${((Date.now() - startedAt) / 1000).toFixed(1)}s · ${turn.promptTokens} prompt tokens billed this turn`);
  if (closed && !turn.done) problems.push(`the session ended before answering: ${closed}`);
  else if (!ok) problems.push(`"${question}" was not answered from the video (expected /${pairs[i + 1]}/)`);
  if (closed) break;
}
try { session.close(); } catch { /* already closed */ }

if (problems.length) {
  log(`\nFAILED:\n  - ${problems.join("\n  - ")}`);
  process.exit(1);
}
log("\nOK");
process.exit(0);

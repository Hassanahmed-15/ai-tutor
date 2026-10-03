/**
 * DOES A YOUTUBE LINK BECOME A LESSON SOURCE THAT HOLDS THE WHOLE VIDEO?
 *
 * Runs the real ingest (lib/youtube/ingestVideo.ts — the same code the page runs) against a running
 * dev server: open the video, read every clip, find the chapters, take notes on each, build the
 * source. It stops before a lecture is generated.
 *
 *   node --import tsx scripts/test-youtube-ingest.mts [url] [out.json]
 *
 * What it checks:
 *   1. the clips cover the video and every one of them came back with speech;
 *   2. the transcript for the chat reaches the END of the video (its last label is in the final 10%);
 *   3. every chapter produced key points, and every block is in exactly one beat;
 *   4. the notes are a fraction of the transcript — the lecture is short because of them.
 * and prints what it measured: clips, chapters, points, the projected lecture length, and the cost.
 *
 * COST: one read of the video (about 55,000 Gemini input tokens per ten minutes; free on a
 * free-tier key, about $0.05 per ten minutes on a paid one) plus one chapter call and two notes
 * calls per chapter on the notes model (cents). A video that has been read before costs only the
 * notes: clips are cached per video.
 *
 * The routes need a session. An access token is minted from AUTH_SECRET rather than logging in, so
 * no account is needed and nothing is left in the database.
 */
import fs from "node:fs";
import { SignJWT } from "jose";
import { ingestYouTubeVideo } from "../lib/youtube/ingestVideo";
import { parseTimestamp } from "../lib/youtube/videoUrl";

const BASE = process.env.LAB_URL ?? "http://localhost:3000";
const args = process.argv.slice(2);
const url = args.find((arg) => /^https?:\/\//.test(arg)) ?? "https://www.youtube.com/watch?v=aircAruvnKk";
const outFile = args.find((arg) => arg.endsWith(".json"));

const env: Record<string, string> = {};
for (const line of fs.readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (match) env[match[1]] = match[2].trim().replace(/^["']|["']$/g, "");
}
if (!env.AUTH_SECRET) throw new Error("AUTH_SECRET is not set in .env.local");
const token = await new SignJWT({ email: "youtube-ingest-test@example.com" })
  .setProtectedHeader({ alg: "HS256" })
  .setSubject("youtube-ingest-test")
  .setIssuedAt()
  .setExpirationTime("2h")
  .sign(new TextEncoder().encode(env.AUTH_SECRET));

// The ingest calls its routes by path, as the page does; here they are sent to the dev server.
const realFetch = globalThis.fetch;
globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) =>
  realFetch(typeof input === "string" && input.startsWith("/") ? `${BASE}${input}` : input, {
    ...init,
    headers: { ...(init?.headers as Record<string, string> | undefined), Cookie: `aria_access=${token}` },
  })) as typeof fetch;

const log = (...parts: unknown[]) => console.log(new Date().toISOString().slice(11, 19), ...parts);
const problems: string[] = [];
const startedAt = Date.now();
let lastLabel = "";

log(`ingesting ${url}`);
const result = await ingestYouTubeVideo(url, {
  onProgress: (progress) => {
    if (progress.label !== lastLabel) log(`  ${Math.round(progress.fraction * 100)}%  ${progress.label}`);
    lastLabel = progress.label;
  },
});
const seconds = Math.round((Date.now() - startedAt) / 1000);

const blocks = result.document.contentBlocks ?? [];
const plan = result.document.lessonPlan as { beats: Array<{ title: string; sourceBlockIds: string[] }> };
const transcriptLines = result.fullDocumentText.split("\n").slice(1);
const transcriptWords = transcriptLines.filter((line) => !line.includes("(on screen,")).join(" ").split(/\s+/).length;
const lastLabelSec = parseTimestamp(transcriptLines[transcriptLines.length - 1]?.match(/^\[([\d:]+)\]/)?.[1] ?? "") ?? 0;

if (lastLabelSec < result.durationSec * 0.9) problems.push(`the transcript stops at ${lastLabelSec}s of a ${result.durationSec}s video`);
const used = plan.beats.flatMap((beat) => beat.sourceBlockIds);
if (new Set(used).size !== used.length) problems.push("a block is in more than one beat");
if (used.length !== blocks.length) problems.push(`${blocks.length - used.length} blocks are in no beat`);
if (blocks.some((block) => (block.text ?? "").length > 1400)) problems.push("a block is long enough to be truncated by the script writer");
if (result.noteWords > transcriptWords * 0.6) problems.push(`the notes (${result.noteWords} words) are not much shorter than the transcript (${transcriptWords})`);

log("");
log(`"${result.title}"  ${Math.round(result.durationSec / 60)} min video, ingested in ${seconds}s (${result.cachedWindows} clips from cache)`);
log(`transcript: ${transcriptWords} spoken words, ${transcriptLines.length} lines, ${result.fullDocumentText.length} chars, last label at ${lastLabelSec}s`);
log(`notes: ${result.pointCount} key points, ${result.noteWords} words (${Math.round((100 * result.noteWords) / Math.max(1, transcriptWords))}% of the speech) in ${result.blockCount} blocks`);
log(`plan: ${result.beatCount} boards, about ${result.document.lesson?.estimatedTeachingMinutes} min of lecture (${Math.round((100 * (result.document.lesson?.estimatedTeachingMinutes ?? 0) * 60) / result.durationSec)}% of the video)`);
for (const beat of plan.beats) {
  const words = beat.sourceBlockIds.reduce((n, id) => n + (blocks.find((block) => block.id === id)?.text ?? "").split(/\s+/).length, 0);
  log(`  - ${beat.title}  (${beat.sourceBlockIds.length} blocks, ${words} words of notes)`);
}
const leftOut = (result.document.source as { leftOut?: string[] }).leftOut ?? [];
log(`left out on purpose: ${leftOut.length ? leftOut.join(" | ") : "nothing"}`);
log(`cost: $${result.costUsd.toFixed(4)}`);
if (outFile) {
  fs.writeFileSync(outFile, JSON.stringify(result, null, 1));
  log(`saved to ${outFile}`);
}
if (problems.length) {
  log(`FAILED:\n  - ${problems.join("\n  - ")}`);
  process.exit(1);
}
log("OK");

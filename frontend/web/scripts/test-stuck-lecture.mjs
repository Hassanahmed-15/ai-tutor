/**
 * "Pause on the button, nothing heard, and Pause/Resume cannot help" — reproduced in a real browser.
 * Needs `npm run dev` and a test account with a finished lecture. Replays it from history, so it
 * generates nothing.
 *
 *   node scripts/test-stuck-lecture.mjs <out-dir> <email> <password-file> <lecture-id> [topic]
 *
 * What it does:
 *   1. Starts the lecture and lets beat one narrate past its opening line onto its board.
 *   2. Calls the development-only `window.__ariaLecture.restartNarration()`, which does exactly what
 *      the mode effect's old fallback did when Aria still held the channel: re-runs the narration
 *      effect, whose cleanup cancels the beat that is playing. On a bridged beat whose board was
 *      showing, nothing could ever start it again.
 *   3. Measures whether narration comes back, and how fast.
 *   4. Pause, then Resume: the audio must stop, then continue.
 *
 * Audio is observed directly: every media element the page plays is recorded, and "audible" means one
 * of them is playing with its clock advancing.
 */
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";

const BASE = process.env.LAB_URL ?? "http://localhost:3000";
const [outDir, email, pwFile, lectureId, topicArg] = process.argv.slice(2);
if (!outDir || !email || !pwFile || !lectureId) {
  console.error("usage: test-stuck-lecture.mjs <out-dir> <email> <password-file> <lecture-id> [topic]");
  process.exit(1);
}
fs.mkdirSync(outDir, { recursive: true });
const password = fs.readFileSync(pwFile, "utf8").trim();
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

const browser = await chromium.launch({ args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--autoplay-policy=no-user-gesture-required"] });
const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 }, permissions: ["microphone"] });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.addInitScript(() => {
  window.__audios = [];
  const play = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function (...args) {
    if (!window.__audios.includes(this)) window.__audios.push(this);
    return play.apply(this, args);
  };
});

/** True while some recorded media element is playing and its clock is moving. */
async function audibleOver(ms = 700) {
  const before = await page.evaluate(() => window.__audios.map((a) => (a.paused || a.ended ? -1 : a.currentTime)));
  await page.waitForTimeout(ms);
  const after = await page.evaluate(() => window.__audios.map((a) => (a.paused || a.ended ? -1 : a.currentTime)));
  return after.some((t, i) => t >= 0 && t > (before[i] ?? -1));
}
/** Watches for up to `ms`, returning the first moment audio was heard, or null. */
async function firstAudibleWithin(ms) {
  const started = Date.now();
  while (Date.now() - started < ms) {
    if (await audibleOver(500)) return Date.now() - started;
  }
  return null;
}

await page.request.post(`${BASE}/api/auth/login`, { data: { email, password } });
await page.goto(`${BASE}/?lecture=${lectureId}`);
await page.waitForTimeout(4000);
if (topicArg) {
  const card = page.getByText(topicArg, { exact: false }).first();
  if (await card.isVisible().catch(() => false)) { await card.click().catch(() => {}); await page.waitForTimeout(4000); }
}
const play = page.getByRole("button", { name: /Play the lecture|Start lecture|Start lesson/ }).first();
await play.waitFor({ timeout: 60_000 });
await play.click();
log("started the lecture");

// Past the opening line and onto beat one's board: narration has been running for a while.
const firstHeard = await firstAudibleWithin(20_000);
if (firstHeard === null) {
  log("RESULT narration never started at all — cannot test the stall");
  await browser.close();
  process.exit(2);
}
await page.waitForTimeout(8000);
const stillPlaying = await audibleOver(1000);
log(`narrating on the board: ${stillPlaying}`);
await page.screenshot({ path: path.join(outDir, "00-narrating.png") });

// The exact restart the old fallback performed.
const hook = await page.evaluate(() => Boolean(window.__ariaLecture?.restartNarration));
if (!hook) {
  log("RESULT the development handle is missing — is this a dev build?");
  await browser.close();
  process.exit(2);
}
await page.evaluate(() => window.__ariaLecture.restartNarration());
log("performed the restart that used to strand the lecture");
const recoveredAfterMs = await firstAudibleWithin(12_000);
log(`narration after the restart: ${recoveredAfterMs === null ? "NEVER came back (stuck)" : `back after ${(recoveredAfterMs / 1000).toFixed(1)} s`}`);
await page.screenshot({ path: path.join(outDir, "01-after-restart.png") });

// Pause, then Resume — tried even when stuck, because "Pause/Resume does not rescue it" is the
// student's own report.
let pauseStops = null;
let resumeRestarts = null;
{
  await page.getByRole("button", { name: "Pause the lecture" }).click();
  await page.waitForTimeout(1500);
  pauseStops = !(await audibleOver(1200));
  await page.getByRole("button", { name: "Play the lecture" }).click();
  const resumedMs = await firstAudibleWithin(8000);
  resumeRestarts = resumedMs !== null;
  log(`Pause silences: ${pauseStops}; Resume continues: ${resumeRestarts}${resumedMs !== null ? ` (${(resumedMs / 1000).toFixed(1)} s)` : ""}`);
}

const summary = { lectureId, narratingBeforeRestart: stillPlaying, recoveredAfterMs, pauseStops, resumeRestarts, pageErrors: errors.slice(0, 5) };
fs.writeFileSync(path.join(outDir, "summary.json"), JSON.stringify(summary, null, 2));
log("RESULT", JSON.stringify(summary));
await browser.close();

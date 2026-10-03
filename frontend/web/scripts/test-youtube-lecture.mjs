/**
 * DOES PASTING A YOUTUBE LINK ON THE FRONT PAGE PRODUCE A LECTURE OF THAT VIDEO?
 *
 * Drives the real front page in a browser, as a student does: paste the link, press Enter, and
 * watch what happens. This is the check the unit tests and scripts/test-youtube-ingest.mts cannot
 * make — they exercise the ingest and the adapter, never the screen that hands a link to them, the
 * request the page then sends, or the lecture that comes back.
 *
 *   node scripts/test-youtube-lecture.mjs <youtube-url> <email> <password-file> [out-dir] [--generate] [--signup] [--headed]
 *
 * Always asserts:
 *   1. the link is recognised: the page shows the video being read, and never the page picker, the
 *      strict-or-reference question or the planning conversation;
 *   2. the lecture request carries the video as its source: sourceType "youtube", the video adapter,
 *      strict + whole scope, no document id (so nothing can crop a page image), and a plan in which
 *      every block is in exactly one beat.
 * By default the lecture request is then stopped, so no lecture is generated.
 *
 * --generate lets the request through and follows the lecture to the end, moving the playhead so
 * every board is written without waiting for narration. It then asserts:
 *   3. every planned board was generated, in the plan's order, with a script and a drawn board;
 *   4. no board holds an image (a video lecture is drawn by the animation engine only);
 * and saves payload.json and lecture.json for scripts/audit-video-coverage.mjs, plus screenshots.
 *
 * --signup creates the account first when it does not exist (a new account's onboarding is skipped
 * with the defaults).
 *
 * COST. Without --generate: reading the video (free once cached, see lib/youtube/videoCache.ts) and
 * the notes calls — cents. With --generate: ONE real lecture, about $1.00-$1.50 depending on how
 * many boards the video needs.
 */
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const BASE = process.env.LAB_URL ?? "http://localhost:3000";
const args = process.argv.slice(2);
const positional = args.filter((arg) => !arg.startsWith("--"));
const [videoUrl, email, pwFile, outDir = path.resolve("youtube-lecture-out")] = positional;
if (!videoUrl || !email || !pwFile) {
  console.error("usage: node scripts/test-youtube-lecture.mjs <youtube-url> <email> <password-file> [out-dir] [--generate] [--signup] [--headed]");
  process.exit(2);
}
const generate = args.includes("--generate");
fs.mkdirSync(outDir, { recursive: true });
const password = fs.readFileSync(pwFile, "utf8").trim();

const browser = await chromium.launch({ headless: !args.includes("--headed"), args: ["--autoplay-policy=no-user-gesture-required"] });
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
const page = await ctx.newPage();
const pageErrors = [];
page.on("pageerror", (error) => pageErrors.push(error.message.slice(0, 200)));
const log = (...parts) => console.log(new Date().toISOString().slice(11, 19), ...parts);
const problems = [];
const shot = (name) => page.screenshot({ path: path.join(outDir, `${name}.png`) }).catch(() => {});

let login = await page.request.post(`${BASE}/api/auth/login`, { data: { email, password } });
if (!login.ok() && args.includes("--signup")) {
  const username = `yt${email.replace(/[^a-z0-9]/gi, "").toLowerCase().slice(0, 18)}`;
  const signup = await page.request.post(`${BASE}/api/auth/signup`, { data: { email, password, username } });
  if (!signup.ok()) throw new Error(`signup failed: ${signup.status()} ${await signup.text()}`);
  log(`signed up ${email}`);
  login = signup;
}
if (!login.ok()) throw new Error(`login failed: ${login.status()} (pass --signup to create the account)`);

await page.goto(BASE, { waitUntil: "domcontentloaded" });
// A new account meets onboarding once: the learner profile, then the accessibility question.
for (let i = 0; i < 12 && !(await page.locator("#brief").isVisible().catch(() => false)); i++) {
  await page.waitForTimeout(2500);
  if (await page.locator("#learner-subjects").isVisible().catch(() => false)) {
    await page.locator("#name").fill("Video Test");
    await page.getByRole("button", { name: "Undergraduate", exact: true }).first().click().catch(() => {});
    await page.locator("#learner-subjects").fill("Computer Science");
    await page.keyboard.press("Enter");
  }
  const none = page.getByText("None of these", { exact: true }).first();
  if (await none.isVisible().catch(() => false)) await none.click().catch(() => {});
  for (const name of [/no, continue/i, /start learning/i, /^continue/i]) {
    const button = page.getByRole("button", { name }).first();
    if (await button.isVisible().catch(() => false) && await button.isEnabled().catch(() => false)) {
      await button.click().catch(() => {});
      break;
    }
  }
}
if (!(await page.locator("#brief").isVisible().catch(() => false))) {
  await shot("stuck-before-front-page");
  throw new Error(`never reached the front page; see ${path.join(outDir, "stuck-before-front-page.png")}`);
}

/* The lecture request, read as it leaves the page. Stopped there unless --generate. */
let payload = null;
let sessionId = null;
await page.route("**/api/progressive-lectures", async (route) => {
  if (route.request().method() !== "POST") return route.continue();
  payload = route.request().postDataJSON();
  if (!generate) return route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "Stopped by the test before generation." }) });
  const response = await route.fetch();
  const body = await response.json().catch(() => ({}));
  sessionId = typeof body.sessionId === "string" ? body.sessionId : null;
  return route.fulfill({ response, json: body });
});

const startedAt = Date.now();
await page.locator("#brief").fill(videoUrl);
await page.keyboard.press("Enter");
log("link pasted; waiting for the video to be read");

const reading = page.getByText(/Opening the video|Watching the video|Finding the topics|Taking notes/).first();
const wrongTurn = page.getByText(/Use all pages|strictly from the selected source|How deep do you want to go/i).first();
let sawReading = false;
let lastLabel = "";
for (let i = 0; i < 900 && !payload; i++) {
  await page.waitForTimeout(1000);
  if (await reading.isVisible().catch(() => false)) {
    sawReading = true;
    const label = (await page.locator("h1").first().innerText().catch(() => "")).trim();
    if (label && label !== lastLabel) log(`  ${label}`);
    lastLabel = label;
    if (i === 3) await shot("reading");
  }
  if (await wrongTurn.isVisible().catch(() => false)) {
    problems.push(`the page asked "${(await wrongTurn.innerText()).slice(0, 60)}" — a video link must go straight from reading to building`);
    break;
  }
  const failed = page.getByText(/could not be read|could not be opened/i).first();
  if (await failed.isVisible().catch(() => false)) {
    await shot("read-failed");
    problems.push(`reading failed: ${(await page.locator("p.text-rose-300").first().innerText().catch(() => "")).slice(0, 200)}`);
    break;
  }
}
const ingestSeconds = Math.round((Date.now() - startedAt) / 1000);
if (!sawReading) problems.push("the page never showed the video being read");

if (!payload) {
  problems.push("no lecture request was sent within 15 minutes");
} else {
  fs.writeFileSync(path.join(outDir, "payload.json"), JSON.stringify(payload, null, 1));
  const doc = payload.suprnotes ?? {};
  const blocks = Array.isArray(doc.contentBlocks) ? doc.contentBlocks : [];
  const beats = Array.isArray(doc.lessonPlan?.beats) ? doc.lessonPlan.beats : [];
  const used = beats.flatMap((beat) => beat.sourceBlockIds ?? []);
  log(`lecture request after ${ingestSeconds}s: "${payload.topic}", ${blocks.length} blocks, ${beats.length} planned boards`);
  if (payload.sourceType !== "youtube") problems.push(`sourceType is "${payload.sourceType}", not "youtube"`);
  if (doc.source?.adapter !== "youtube-video") problems.push(`the source adapter is "${doc.source?.adapter}"`);
  if (payload.sourceScope?.fidelity !== "strict" || payload.sourceScope?.breadth?.kind !== "whole") problems.push(`the scope is ${JSON.stringify(payload.sourceScope)}, not strict + whole`);
  if (payload.documentId) problems.push("a documentId was sent: page images could reach the lecture");
  if ((doc.assets ?? []).length) problems.push("the source carries image assets");
  if (payload.focus) problems.push(`a focus was sent ("${payload.focus}"): it would narrow the lecture to part of the video`);
  if (!blocks.length || !beats.length) problems.push("the source has no blocks or no plan");
  if (new Set(used).size !== used.length || used.length !== blocks.length) problems.push("the plan does not use every block exactly once");
}

// The request is read the moment it leaves the page; its answer, with the session id, follows.
for (let i = 0; generate && payload && !sessionId && i < 60; i++) await page.waitForTimeout(1000);
if (generate && payload && !sessionId) problems.push("the lecture request was sent but no session started within a minute");

if (generate && sessionId && problems.length === 0) {
  log(`lecture session ${sessionId}; following it to the end`);
  let snapshot = null;
  let shots = 0;
  for (let i = 0; i < 360; i++) {
    await page.waitForTimeout(5000);
    // A slow poll (a busy dev server) is skipped, not fatal: the next one will see the same session.
    const response = await page.request.get(`${BASE}/api/progressive-lectures/${encodeURIComponent(sessionId)}`, { timeout: 60_000 }).catch(() => null);
    if (!response?.ok()) continue;
    snapshot = await response.json();
    const ready = snapshot.contiguousReadyCount ?? 0;
    if (i % 6 === 0) log(`  ${ready}/${snapshot.plannedBeatCount} boards ready, $${(snapshot.costUsd ?? 0).toFixed(2)} so far, status ${snapshot.status}`);
    // Boards are written a couple ahead of the playhead; moving it writes the rest without the wait.
    if (ready > 0) {
      await page.request.post(`${BASE}/api/progressive-lectures/${encodeURIComponent(sessionId)}/interaction`, { data: { kind: "playhead", playhead: ready - 1 } }).catch(() => {});
    }
    if (ready >= 1 && shots < 3 && i % 8 === 4) await shot(`player-${++shots}`);
    if (snapshot.error) {
      problems.push(`the lecture failed: ${snapshot.error}`);
      break;
    }
    const boardsDrawn = (snapshot.beats ?? []).every((beat) => (beat.draw?.ops ?? []).every((op) => op.kind !== "reactAnimation" || op.status));
    if (snapshot.complete && ready >= snapshot.plannedBeatCount && boardsDrawn) break;
  }
  if (!snapshot) {
    problems.push("the lecture session could not be read");
  } else {
    fs.writeFileSync(path.join(outDir, "lecture.json"), JSON.stringify(snapshot, null, 1));
    const beats = snapshot.beats ?? [];
    const words = beats.reduce((n, beat) => n + String(beat.script ?? "").split(/\s+/).filter(Boolean).length, 0);
    log(`lecture: ${beats.length}/${snapshot.plannedBeatCount} boards, ${words} spoken words (about ${Math.round(words / 150)} min), cost $${(snapshot.costUsd ?? 0).toFixed(2)}, ${Math.round((Date.now() - startedAt) / 1000)}s in all`);
    if (beats.length < snapshot.plannedBeatCount) problems.push(`only ${beats.length} of ${snapshot.plannedBeatCount} planned boards were generated`);
    const planned = payload.suprnotes.lessonPlan.beats;
    for (const [index, beat] of beats.entries()) {
      const ops = beat.draw?.ops ?? [];
      const kinds = ops.map((op) => op.kind).join(",") || "none";
      const state = ops.map((op) => op.status).filter(Boolean).join(",");
      log(`  ${index + 1}. ${beat.title}  [${kinds}${state ? ` ${state}` : ""}]  ${String(beat.script ?? "").split(/\s+/).filter(Boolean).length} words`);
      if (!String(beat.script ?? "").trim()) problems.push(`board ${index + 1} has no script`);
      if (ops.length === 0) problems.push(`board ${index + 1} ("${beat.title}") has nothing drawn`);
      if (ops.some((op) => op.kind === "image")) problems.push(`board ${index + 1} holds an image: a video lecture is drawn, never illustrated from the source`);
      const expected = planned[index]?.sourceBlockIds ?? [];
      if (JSON.stringify(beat.sourceBlockIds ?? []) !== JSON.stringify(expected)) problems.push(`board ${index + 1} was written from ${JSON.stringify(beat.sourceBlockIds)}, the plan says ${JSON.stringify(expected)}`);
    }
  }
  await shot("player-final");
}

if (pageErrors.length) log(`page errors: ${[...new Set(pageErrors)].join(" | ")}`);
await page.unrouteAll({ behavior: "ignoreErrors" });
await browser.close();
if (problems.length) {
  log(`FAILED:\n  - ${problems.join("\n  - ")}`);
  process.exit(1);
}
log(`OK${generate ? "" : " (stopped before generation; pass --generate for a real lecture)"} — output in ${outDir}`);

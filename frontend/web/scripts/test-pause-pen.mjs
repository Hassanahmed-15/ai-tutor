/**
 * DOES PAUSE STOP THE BOARD'S PEN?
 *
 * Reported 2026-10-03: "when I pause, the marker keeps running for a few seconds before it stops".
 * The board's pen has a pause switch (ReactAnimationSandbox `settled`, lib/anim/sandboxMotion.ts
 * PEN.pause) that the player never turned on, so a paused lesson kept writing every line already
 * revealed until it ran out of text.
 *
 * Replays a saved lecture from history (nothing is generated), presses Play, waits until the pen is
 * writing, presses Pause, and reads the pen's position inside the board over the next few seconds.
 * The pen may finish the word it is on (a frozen "chlo" is worse), so the first 0.6 s are allowed;
 * after that it must not move. Then Play, and the pen must move again.
 *
 *   node scripts/test-pause-pen.mjs <email> <password-file> "<history card text>" [out-dir]
 *
 * COST: narration for the seconds the lecture plays (TTS). Under a cent.
 */
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";

const BASE = process.env.LAB_URL ?? "http://localhost:3000";
const [email, pwFile, cardText = "What is a Neural Network?", outDir = path.resolve("pause-pen-out")] = process.argv.slice(2);
if (!email || !pwFile) {
  console.error('usage: node scripts/test-pause-pen.mjs <email> <password-file> "<history card text>" [out-dir]');
  process.exit(2);
}
fs.mkdirSync(outDir, { recursive: true });
const log = (...parts) => console.log(new Date().toISOString().slice(11, 19), ...parts);
const problems = [];

const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
const page = await ctx.newPage();
const login = await ctx.request.post(`${BASE}/api/auth/login`, { data: { email, password: fs.readFileSync(pwFile, "utf8").trim() } });
if (!login.ok()) throw new Error(`login failed: ${login.status()}`);
await page.goto(BASE, { waitUntil: "domcontentloaded" });
await page.locator("#brief").waitFor({ timeout: 60_000 });
const card = page.locator("button, a, [role=button]").filter({ hasText: cardText }).filter({ hasText: /Video|PDF|Prompt|Presentation/ }).first();
await card.waitFor({ timeout: 60_000 });
await card.click();
const play = page.getByRole("button", { name: /Play/ }).first();
await play.waitFor({ timeout: 120_000 });
await play.click();
log("playing");

/** The pen inside the board: where it is and whether it is shown. Null until a board is writing. */
async function penState() {
  for (const frame of page.frames()) {
    const state = await frame.evaluate(() => {
      const pen = document.querySelector("g[data-board-pen]");
      if (!pen) return null;
      const box = pen.getBoundingClientRect();
      return { x: Math.round(box.x * 10) / 10, y: Math.round(box.y * 10) / 10, shown: getComputedStyle(pen).opacity !== "0" };
    }).catch(() => null);
    if (state) return state;
  }
  return null;
}

// Wait for the pen to be visibly writing: shown, and moving between two looks.
let writing = false;
for (let i = 0; i < 120 && !writing; i++) {
  await page.waitForTimeout(500);
  const a = await penState();
  await page.waitForTimeout(200);
  const b = await penState();
  writing = Boolean(a?.shown && b?.shown && (a.x !== b.x || a.y !== b.y));
}
if (!writing) {
  await page.screenshot({ path: path.join(outDir, "no-pen.png") });
  await browser.close();
  console.error("the pen never started writing within a minute; see no-pen.png");
  process.exit(1);
}
log("the pen is writing; pressing Pause");
await page.getByRole("button", { name: /Pause/ }).first().click();
const pausedAt = Date.now();

await page.waitForTimeout(600);
const settled = await penState();
await page.screenshot({ path: path.join(outDir, "paused-0.6s.png") });
const samples = [];
for (let i = 0; i < 6; i++) {
  await page.waitForTimeout(500);
  samples.push(await penState());
}
await page.screenshot({ path: path.join(outDir, "paused-3.6s.png") });
const moved = samples.filter((s) => s && settled && (s.x !== settled.x || s.y !== settled.y)).length;
log(`after Pause: pen at (${settled?.x}, ${settled?.y}) at 0.6 s; moved in ${moved} of ${samples.length} looks over the next 3 s`);
if (moved > 0) problems.push(`the pen kept moving after Pause (${moved} of ${samples.length} looks between 0.6 s and ${((Date.now() - pausedAt) / 1000).toFixed(1)} s)`);

await page.getByRole("button", { name: /Play/ }).first().click();
let resumed = false;
for (let i = 0; i < 20 && !resumed; i++) {
  await page.waitForTimeout(400);
  const s = await penState();
  resumed = Boolean(s && settled && (s.x !== settled.x || s.y !== settled.y));
}
log(resumed ? "after Play: the pen writes again" : "after Play: the pen did not move");
if (!resumed) problems.push("the pen did not resume after Play");

await browser.close();
if (problems.length) {
  log(`FAILED:\n  - ${problems.join("\n  - ")}`);
  process.exit(1);
}
log(`OK — screenshots in ${outDir}`);

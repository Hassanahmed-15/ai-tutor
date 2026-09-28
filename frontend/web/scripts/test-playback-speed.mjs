/**
 * DOES THE SPEED CONTROL CHANGE THE VOICE WITHOUT RESTARTING THE BEAT?
 *
 * Drives the real player on /player-preview (dev-only, seeded lecture, no sign-in).
 *
 *   node scripts/test-playback-speed.mjs [out-dir] [--headed]
 *
 * The narration's <audio> is created in code and never attached to the page, so `window.Audio` is
 * wrapped before the app loads to keep a handle on every element made. That also detects a restart:
 * every narration builds its own element, so a speed change that restarted the beat would create one.
 *
 * Asserted:
 *   1. choosing 2x sets the playing element's playbackRate to 2, and no new narration starts;
 *   2. choosing 0.25x sets it to 0.25, likewise;
 *   3. after a reload, the control shows the remembered speed.
 * Costs a few seconds of cloud TTS.
 */
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const BASE = process.env.LAB_URL ?? "http://localhost:3000";
const ROOT = path.resolve(import.meta.dirname, "..");
const args = process.argv.slice(2);
const [outDir = path.join(ROOT, "playback-speed-out")] = args.filter((a) => !a.startsWith("--"));
fs.mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({ headless: !args.includes("--headed"), args: ["--autoplay-policy=no-user-gesture-required"] });
const ctx = await browser.newContext({ viewport: { width: 1500, height: 940 } });
await ctx.addInitScript(() => {
  const Original = window.Audio;
  const made = [];
  window.__narrationAudios = made;
  function Tracked(...a) {
    const el = new Original(...a);
    made.push(el);
    return el;
  }
  Tracked.prototype = Original.prototype;
  window.Audio = Tracked;
});
const page = await ctx.newPage();
page.on("pageerror", (e) => console.log("  [pageerror]", e.message.slice(0, 160)));
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const problems = [];

const audios = () => page.evaluate(() => window.__narrationAudios.map((a) => ({ rate: a.playbackRate, playing: !a.paused, src: Boolean(a.src) })));
const speedButton = page.locator("[data-speed-button]");

async function choose(rate) {
  await speedButton.click();
  await page.locator(`[data-speed-choice="${rate}"]`).click();
  await page.waitForTimeout(600);
}

await page.goto(`${BASE}/player-preview`, { waitUntil: "domcontentloaded" });
await speedButton.waitFor({ state: "visible", timeout: 90_000 });
log(`speed control visible, reading "${(await speedButton.innerText()).trim()}"`);
await page.getByRole("button", { name: /play the lecture/i }).click();

// Wait for narration to actually be playing.
let before = [];
for (let i = 0; i < 60; i++) {
  await page.waitForTimeout(1000);
  before = await audios();
  if (before.some((a) => a.playing)) break;
}
if (!before.some((a) => a.playing)) {
  problems.push("narration never started playing, so the speed could not be tested");
} else {
  log(`narration playing (${before.length} element(s), rate ${before.at(-1).rate})`);
  for (const rate of [2, 0.25]) {
    const count = (await audios()).length;
    await choose(rate);
    const now = await audios();
    const live = now.at(-1);
    log(`chose ${rate}x -> playing element rate ${live.rate}, elements ${count} -> ${now.length}`);
    if (live.rate !== rate) problems.push(`choosing ${rate}x left the narration at ${live.rate}x`);
    if (now.length !== count) problems.push(`choosing ${rate}x started a new narration — the beat restarted`);
    if ((await speedButton.innerText()).trim() !== `${rate}×`) problems.push(`the button does not show ${rate}×`);
  }
  await page.screenshot({ path: path.join(outDir, "speed-menu.png") });
}

// Remembered across a reload.
await page.reload({ waitUntil: "domcontentloaded" });
await speedButton.waitFor({ state: "visible", timeout: 90_000 });
await page.waitForTimeout(800);
const remembered = (await speedButton.innerText()).trim();
log(`after reload the control reads "${remembered}"`);
if (remembered !== "0.25×") problems.push(`the speed was not remembered — control reads "${remembered}" after reload`);
await page.screenshot({ path: path.join(outDir, "after-reload.png") });
await browser.close();

console.log(`screenshots in ${outDir}`);
if (problems.length) {
  console.error("\nPROBLEMS:");
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
console.log("\nSpeed changes the voice live, never restarts the beat, and is remembered.");

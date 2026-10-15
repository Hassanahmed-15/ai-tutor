/**
 * PAUSE, SPEED AND THE END OF A LECTURE — what the student hears and sees (2026-10-14).
 *
 *   node scripts/probe-voice-controls.mjs "<prompt>" <email> <password-file> [out-dir] [--end-only]
 *   (--end-only skips 1 and 2: a quick check of the end of a short lecture)
 *
 * Starts a typed-prompt lecture, then, while Aria is speaking:
 *   1. pauses and resumes three times — after each resume her voice must be playing again, through
 *      cloud audio (never the browser's speech engine: a different voice), and her mouth moving;
 *   2. changes speed 1x → 1.5x → 0.5x → 1x — the clip playing must change speed at once, and every
 *      clip after must start at the new speed; the menu must offer only 0.5x, 1x and 1.5x;
 *   3. lets the lecture finish — once "Lecture complete" shows, nothing may be speaking for 15 s:
 *      no audio element playing, no browser speech, no live-tutor socket open.
 * LAB_URL sets the target (default http://localhost:3000). One real lecture per run.
 */
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const BASE = process.env.LAB_URL ?? "http://localhost:3000";
const argv = process.argv.slice(2);
const skipControls = argv.includes("--end-only");
// --fail-first-clip: every request for the lecture's first sentence fails, as an overloaded /api/tts would.
const failFirstClip = argv.includes("--fail-first-clip");
const [prompt, email, pwFile, outDir = path.resolve("voice-controls-out")] = argv.filter((a) => !a.startsWith("--"));
if (!prompt || !email || !pwFile) {
  console.error('usage: node scripts/probe-voice-controls.mjs "<prompt>" <email> <password-file> [out-dir]');
  process.exit(2);
}
fs.mkdirSync(outDir, { recursive: true });
const t0 = Date.now();
const log = (line) => console.log(`[${String(Math.round((Date.now() - t0) / 1000)).padStart(4)}s] ${line}`);
const problems = [];

const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.addInitScript(() => {
  try {
    localStorage.setItem("aria.guide.seen", "1");
    localStorage.setItem("aria.lecture.rate", "1");
  } catch {}
  const w = window;
  w.__probe = { plays: [], speaks: 0, contexts: 0, sockets: [], el: null };
  // Every clip that starts, with the speed it starts at; the live element for sampling.
  const play = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function (...args) {
    w.__probe.el = this;
    w.__probe.plays.push({ t: Date.now(), rate: this.playbackRate });
    return play.apply(this, args);
  };
  // The browser's own speech engine = a different voice. The zero-volume unlock blip is not speech.
  if (w.speechSynthesis) {
    const speak = w.speechSynthesis.speak.bind(w.speechSynthesis);
    w.speechSynthesis.speak = (u) => {
      if (u && u.text && u.text.trim() && u.volume !== 0) w.__probe.speaks += 1;
      return speak(u);
    };
  }
  const Ctx = w.AudioContext;
  if (Ctx) {
    w.AudioContext = class extends Ctx {
      constructor(...a) {
        super(...a);
        w.__probe.contexts += 1;
      }
    };
  }
  // Live-tutor sockets (Gemini Live), to prove none outlives the lecture.
  const WS = w.WebSocket;
  w.WebSocket = class extends WS {
    constructor(...a) {
      super(...a);
      if (String(a[0]).includes("generativelanguage")) w.__probe.sockets.push(this);
    }
  };
});
const login = await ctx.request.post(`${BASE}/api/auth/login`, { data: { email, password: fs.readFileSync(pwFile, "utf8").trim() } });
if (!login.ok()) throw new Error(`login failed: ${login.status()}`);
const page = await ctx.newPage();
let failedText = null;
let failedCount = 0;
if (failFirstClip) {
  await page.route("**/api/tts", async (route) => {
    const text = JSON.parse(route.request().postData() ?? "{}").text ?? "";
    // The PLAYER's own first clip request (not a warm-up), and every request for that sentence after.
    const warm = route.request().headers()["x-tts-priority"] === "warm";
    if (failedText === null && sessionIdSeen() && !warm) failedText = text;
    if (text && text === failedText) {
      failedCount += 1;
      return route.fulfill({ status: 502, contentType: "application/json", body: JSON.stringify({ error: "forced by probe" }) });
    }
    return route.continue();
  });
}
function sessionIdSeen() { return Boolean(sessionId); }
let sessionId = null;
page.on("response", async (r) => {
  if (r.request().method() === "POST" && r.url().endsWith("/api/progressive-lectures")) sessionId = (await r.json().catch(() => ({}))).sessionId ?? null;
});

await page.goto(BASE, { waitUntil: "domcontentloaded" });
await page.locator("#brief").waitFor({ timeout: 120_000 });
await page.locator("#brief").fill(prompt);
await page.locator("#brief").press("Enter");
log(`typed "${prompt}"`);
const build = page.getByRole("button", { name: /^\s*(?:Build lesson|Start)\s*$/i }).first();
for (let i = 0; i < 300 && !sessionId; i++) {
  await page.waitForTimeout(1000);
  if (await build.isVisible().catch(() => false) && await build.isEnabled().catch(() => false) && !(await page.getByText("Planning…").isVisible().catch(() => false))) {
    await build.click();
    break;
  }
  const option = page.locator("button:has(span:text-is('A'))").first();
  if (await option.isVisible().catch(() => false) && await option.isEnabled().catch(() => false)) {
    await option.click().catch(() => {});
    await page.waitForTimeout(1500);
  }
}
for (let i = 0; i < 120 && !sessionId; i++) await page.waitForTimeout(1000);
if (!sessionId) throw new Error("no lecture started");
log(`lecture ${sessionId}`);

const state = () => page.evaluate(() => {
  const p = window.__probe;
  const mouth = document.querySelector('svg[aria-label="Aria"] path[data-k="mouth"]')?.getAttribute("d") ?? "";
  return { speaks: p.speaks, contexts: p.contexts, plays: p.plays.length, playing: Boolean(p.el && !p.el.paused && !p.el.ended), rate: p.el?.playbackRate ?? null, mouth, browserSpeaking: Boolean(window.speechSynthesis?.speaking), openSockets: p.sockets.filter((s) => s.readyState === 0 || s.readyState === 1).length };
});
const dock = (label) => page.locator(`button[aria-label="${label}"]`).first();
async function waitPlaying(ms = 90_000) {
  for (let waited = 0; waited < ms; waited += 500) {
    const play = page.getByRole("button", { name: /^Play the lecture$/ }).first();
    if (await play.isVisible().catch(() => false)) {
      const s = await state();
      if (!s.playing) await play.click().catch(() => {});
    }
    if ((await state()).playing) return true;
    await page.waitForTimeout(500);
  }
  return false;
}
/** Distinct mouth shapes over `ms` — a moving mouth changes shape many times a second. */
async function mouthShapes(ms = 1500) {
  const seen = new Set();
  for (let i = 0; i < ms / 100; i++) {
    seen.add((await state()).mouth);
    await page.waitForTimeout(100);
  }
  return seen.size;
}

if (!(await waitPlaying())) throw new Error("narration never started");
log("narration playing");
await page.waitForTimeout(3000);
const before = await state();
log(`before: contexts=${before.contexts} browserSpeaks=${before.speaks} mouthShapes=${await mouthShapes()}`);

/* ── 1. pause / resume ×3 ─────────────────────────────────────────────────────────────────── */
for (const [holdMs, label] of skipControls ? [] : [[3000, "short"], [8000, "long"], [500, "instant"]]) {
  await dock("Pause the lecture").click();
  await page.waitForTimeout(holdMs);
  const paused = await state();
  await dock("Play the lecture").click();
  let back = false;
  for (let i = 0; i < 20 && !back; i++) {
    await page.waitForTimeout(250);
    back = (await state()).playing;
  }
  const shapes = back ? await mouthShapes() : 0;
  const after = await state();
  log(`pause ${label} (${holdMs} ms): paused playing=${paused.playing} → resumed playing=${back}, mouth shapes ${shapes}, browserSpeaks=${after.speaks}`);
  if (paused.playing) problems.push(`audio kept playing during the ${label} pause`);
  if (!back) problems.push(`no voice within 5 s of resuming (${label})`);
  else if (shapes < 4) problems.push(`mouth not moving after the ${label} resume (${shapes} shapes)`);
  if (after.speaks > before.speaks) problems.push(`the browser voice spoke after the ${label} pause`);
  await page.waitForTimeout(2500);
}

/* ── 2. speed ─────────────────────────────────────────────────────────────────────────────── */
if (!skipControls) {
await page.locator("[data-speed-button]").first().click();
const choices = await page.locator("[data-speed-choice]").evaluateAll((els) => els.map((e) => e.getAttribute("data-speed-choice")));
log(`speed menu: ${choices.join(", ")}`);
if (JSON.stringify(choices) !== JSON.stringify(["0.5", "1", "1.5"])) problems.push(`speed menu offers ${choices.join(", ")}`);
await page.keyboard.press("Escape").catch(() => {});
for (const rate of [1.5, 0.5, 1]) {
  if (!(await waitPlaying(30_000))) break;
  const playsBefore = (await state()).plays;
  await page.locator("[data-speed-button]").first().click();
  await page.locator(`[data-speed-choice="${rate}"]`).first().click();
  const changedAt = Date.now();
  let liveRate = null;
  for (let i = 0; i < 10; i++) {
    await page.waitForTimeout(100);
    liveRate = (await state()).rate;
    if (liveRate === rate) break;
  }
  const lag = Date.now() - changedAt;
  await page.waitForTimeout(9000);
  const later = await page.evaluate((n) => window.__probe.plays.slice(n).map((p) => p.rate), playsBefore);
  const wrong = later.filter((r) => Math.abs(r - rate) > 0.01);
  log(`speed ${rate}x: playing clip at ${liveRate} after ${lag} ms; next ${later.length} clip(s) started at [${later.join(", ")}]`);
  if (liveRate !== rate) problems.push(`the playing clip did not change to ${rate}x`);
  if (wrong.length) problems.push(`${wrong.length} clip(s) after the change to ${rate}x started at the old speed`);
}
}

/* ── 3. to the end ────────────────────────────────────────────────────────────────────────── */
let complete = false;
for (let i = 0; i < 900 && !complete; i++) {
  await page.waitForTimeout(1000);
  complete = await page.getByText("Lecture complete").isVisible().catch(() => false);
  if (complete) break;
  const goOn = page.getByRole("button", { name: /^(?:Continue the lesson|Skip and continue|Continue anyway|Continue)$/ }).first();
  if (await goOn.isVisible().catch(() => false)) await goOn.click().catch(() => {});
  await page.evaluate(() => {
    const label = [...document.querySelectorAll("*")].find((el) => /^s*predict its*$/i.test(el.textContent ?? "") && el.children.length === 0);
    let panel = label?.parentElement ?? null;
    while (panel && panel.querySelectorAll("button").length < 2) panel = panel.parentElement;
    const buttons = panel ? [...panel.querySelectorAll("button")].filter((b) => !b.disabled) : [];
    if (buttons.length) buttons[0].click();
    // Then the panel's own submit ("Choose an answer" becomes enabled once an answer is picked).
    setTimeout(() => {
      const all = panel ? [...panel.querySelectorAll("button")].filter((b) => !b.disabled) : [];
      if (all.length > 1) all[all.length - 1].click();
    }, 400);
  }).catch(() => {});
  const play = page.getByRole("button", { name: /^Play the lecture$/ }).first();
  if (await play.isVisible().catch(() => false) && !(await state()).playing) await play.click().catch(() => {});
}
if (!complete) problems.push("the lecture never reached Lecture complete");
else {
  log("Lecture complete — listening for 15 s");
  let heard = 0;
  for (let i = 0; i < 30; i++) {
    const s = await state();
    if (s.playing || s.browserSpeaking || s.openSockets) {
      heard += 1;
      if (heard === 1) log(`  sound after completion: element=${s.playing} browserSpeech=${s.browserSpeaking} sockets=${s.openSockets}`);
    }
    await page.waitForTimeout(500);
  }
  if (heard) problems.push(`something was still speaking ${heard * 0.5} s into the completion screen`);
}
const end = await state();
log(`totals: audio contexts created ${end.contexts}, browser-voice utterances ${end.speaks}, clips ${end.plays}`);
if (failFirstClip) {
  log(`forced failures: ${failedCount} request(s) for "${(failedText ?? "").slice(0, 60)}"`);
  if (!failedCount) problems.push("the forced failure never happened");
}
if (end.speaks > 0) problems.push(`the browser voice was used ${end.speaks} time(s)`);
await page.screenshot({ path: path.join(outDir, "end.png") });
await browser.close();
log(problems.length ? `PROBLEMS:\n  - ${problems.join("\n  - ")}` : "ALL CHECKS PASSED");
process.exit(problems.length ? 1 : 0);

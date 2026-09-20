/**
 * Two things, one lecture:
 *   1. each animated beat's tier, the model it bought, and what the lecture cost;
 *   2. how long from pressing Start to the first spoken word.
 *
 *   node test-tier-and-start.mjs <out-dir> <email> <password-file>
 *
 * The lecture is started through the API (so the planning conversation is not re-tested here),
 * then a browser opens it and presses Start, timing the first /api/tts response and the first
 * audio element that actually plays.
 */
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";

const BASE = process.env.LAB_URL ?? "http://localhost:3000";
const [outDir, email, pwFile] = process.argv.slice(2);
fs.mkdirSync(outDir, { recursive: true });
const password = fs.readFileSync(pwFile, "utf8").trim();
const TOPIC = process.env.TIER_TOPIC ?? "How a hash table handles collisions";
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

let cookie = "";
async function call(method, url, body) {
  const res = await fetch(`${BASE}${url}`, { method, headers: { "Content-Type": "application/json", cookie }, body: body ? JSON.stringify(body) : undefined });
  const set = res.headers.getSetCookie?.() ?? [];
  if (set.length) cookie = set.map((c) => c.split(";")[0]).join("; ");
  return { status: res.status, data: await res.json().catch(() => ({})) };
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

await call("POST", "/api/auth/login", { email, password });
const existing = process.env.SESSION_ID ?? null;
const start = existing ? { data: { sessionId: existing } } : await call("POST", "/api/progressive-lectures", {
  topic: TOPIC, sourceType: "prompt",
  learnerProfile: { expertise: "intermediate", depth: "balanced", goal: "practical", codeExamples: true, preferredExamples: "visual" },
});

const id = start.data.sessionId;
if (!id) throw new Error(`could not start: ${JSON.stringify(start.data)}`);
log("lecture", id);

/* ── wait for the whole lecture, so every tier is decided ─────────────────── */
const t0 = Date.now();
let snap = null;
let seen = "";
while (Date.now() - t0 < 16 * 60_000) {
  ({ data: snap } = await call("GET", `/api/progressive-lectures/${id}`));
  const states = (snap.beatStatus ?? []).map((b) => b.state[0]).join("");
  if (states !== seen) { log(`status=${snap.status} beats=${states}`); seen = states; }
  if (snap.status === "complete" || snap.status === "failed") break;
  await sleep(5000);
}

const tiers = (snap.beatStatus ?? []).map((b) => ({
  sequence: b.sequence + 1,
  title: b.title,
  board: b.timing?.visualKind,
  tier: b.timing?.animationTier ?? null,
  reason: b.timing?.animationTierReason ?? null,
  model: b.timing?.animation?.attempts?.[0]?.model ?? null,
  drawMs: Math.round(b.timing?.animation?.modelMs ?? b.timing?.premiumMs ?? 0),
}));
log("tiers:");
for (const t of tiers) log(`  beat ${t.sequence}: ${t.board}${t.tier ? ` · ${t.tier} → ${t.model} (${Math.round(t.drawMs / 1000)} s)` : ""}${t.reason ? ` — ${t.reason}` : ""}`);
log(`lecture cost $${(snap.costUsd ?? 0).toFixed(2)}, status ${snap.status}, in history: ${Boolean(snap.lectureId)}`);
const openingLine = snap.beats?.[0]?.transitionIn ?? null;
log("opening line:", openingLine);

/* ── the start of the lecture, in a browser ───────────────────────────────── */
const browser = await chromium.launch({ args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--autoplay-policy=no-user-gesture-required"] });
const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 }, permissions: ["microphone"] });
const page = await ctx.newPage();
await page.request.post(`${BASE}/api/auth/login`, { data: { email, password } });
const ttsCalls = [];
page.on("response", async (res) => {
  if (res.url().endsWith("/api/tts")) ttsCalls.push({ at: Date.now(), cache: res.headers()["x-tts-cache"] ?? "miss", status: res.status() });
});
// Timestamp the first audio that actually starts playing.
await page.addInitScript(() => {
  window.__firstPlay = null;
  const play = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function (...args) {
    if (window.__firstPlay === null) window.__firstPlay = Date.now();
    return play.apply(this, args);
  };
});
await page.goto(`${BASE}/?lecture=${id}`);
await page.waitForTimeout(3000);
// Open the lecture from history if the deep link did not.
const historyCard = page.getByText(TOPIC, { exact: false }).first();
if (await historyCard.isVisible().catch(() => false)) { await historyCard.click().catch(() => {}); await page.waitForTimeout(4000); }
await page.screenshot({ path: path.join(outDir, "00-before-start.png"), fullPage: true });

const startButton = page.getByRole("button", { name: /Start lecture|Start lesson|Start/ }).first();
let startToAudioMs = null;
if (await startButton.isVisible().catch(() => false)) {
  const pressedAt = Date.now();
  await startButton.click();
  for (let i = 0; i < 60; i += 1) {
    const at = await page.evaluate(() => window.__firstPlay);
    if (at) { startToAudioMs = at - pressedAt; break; }
    await page.waitForTimeout(250);
  }
  log(`Start → first audio: ${startToAudioMs === null ? "never played" : `${(startToAudioMs / 1000).toFixed(2)} s`}`);
  await page.waitForTimeout(3000);
  await page.screenshot({ path: path.join(outDir, "01-playing.png"), fullPage: true });
} else {
  log("no Start button found — the player may not have opened");
}

const summary = {
  sessionId: id, topic: TOPIC, status: snap.status, inHistory: Boolean(snap.lectureId),
  costUsd: snap.costUsd, openingLine, tiers,
  startToAudioMs,
  ttsCalls: ttsCalls.slice(0, 6),
  firstTtsWasCached: ttsCalls[0]?.cache ?? null,
};
fs.writeFileSync(path.join(outDir, "summary.json"), JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));
await browser.close();

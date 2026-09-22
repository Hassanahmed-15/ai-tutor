/**
 * The silence between one beat and the next — measured, not guessed. Replays a finished lecture from
 * history (no generation cost) and plays it through real beat changes.
 *
 *   node scripts/measure-slide-gaps.mjs <out-dir> <email> <password-file> <lecture-id> [topic] [beats]
 *
 * For every beat change it reports: how long the lecture was silent, what the first words of the new
 * beat were (was the transition sentence spoken?), and whether that first clip was a cache miss.
 */
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";

const BASE = process.env.LAB_URL ?? "http://localhost:3000";
const [outDir, email, pwFile, lectureId, topicArg, beatsArg] = process.argv.slice(2);
fs.mkdirSync(outDir, { recursive: true });
const password = fs.readFileSync(pwFile, "utf8").trim();
const BEATS = Number(beatsArg ?? 3);
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required", "--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"] });
const page = await (await browser.newContext({ viewport: { width: 1366, height: 800 }, permissions: ["microphone"] })).newPage();

// Every narration clip: when it was asked for, its text, cache hit or miss.
const clips = [];
page.on("request", (req) => {
  if (req.url().endsWith("/api/tts") && req.method() === "POST") {
    try { clips.push({ requestedAt: Date.now(), text: JSON.parse(req.postData() ?? "{}").text ?? "", cache: null }); } catch { /* not JSON */ }
  }
});
page.on("response", (res) => {
  if (!res.url().endsWith("/api/tts")) return;
  const text = (() => { try { return JSON.parse(res.request().postData() ?? "{}").text ?? ""; } catch { return ""; } })();
  const clip = [...clips].reverse().find((c) => c.text === text && c.cache === null);
  if (clip) { clip.cache = res.headers()["x-tts-cache"] ?? "miss"; clip.respondedAt = Date.now(); }
});
// Every moment audio starts and stops, from the page's own media elements.
await page.addInitScript(() => {
  window.__audioLog = [];
  const play = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function (...args) {
    if (!this.__logged) {
      this.__logged = true;
      this.addEventListener("playing", () => window.__audioLog.push({ t: Date.now(), e: "playing" }));
      this.addEventListener("ended", () => window.__audioLog.push({ t: Date.now(), e: "ended" }));
      this.addEventListener("pause", () => window.__audioLog.push({ t: Date.now(), e: "pause" }));
    }
    return play.apply(this, args);
  };
});

await page.request.post(`${BASE}/api/auth/login`, { data: { email, password } });
await page.goto(`${BASE}/?lecture=${lectureId}`);
await page.waitForTimeout(4000);
if (topicArg) {
  const card = page.getByText(topicArg, { exact: false }).first();
  if (await card.isVisible().catch(() => false)) { await card.click().catch(() => {}); await page.waitForTimeout(4000); }
}
await page.getByRole("button", { name: /Play the lecture/ }).first().click();
log("playing");

// Watch the "Part N of M" label to know when each beat begins.
const partText = async () => (await page.getByText(/Part \d+ of \d+/).first().innerText().catch(() => "")).trim();
const changes = [];
let current = await partText();
const deadline = Date.now() + BEATS * 150_000;
while (Date.now() < deadline && changes.length < BEATS) {
  await page.waitForTimeout(250);
  const now = await partText();
  if (now && now !== current) {
    changes.push({ at: Date.now(), from: current, to: now });
    log(`beat change: ${current} -> ${now}`);
    await page.screenshot({ path: path.join(outDir, `change-${changes.length}.png`) });
    current = now;
  }
}
await page.waitForTimeout(6000);
const audio = await page.evaluate(() => window.__audioLog);

// For each beat change: the last audio before it ended, the first after it started, and the words.
const report = changes.map((change) => {
  const lastEnd = [...audio].reverse().find((a) => (a.e === "ended" || a.e === "pause") && a.t <= change.at + 1500);
  const firstPlay = audio.find((a) => a.e === "playing" && a.t > change.at - 500);
  const firstClip = clips.find((c) => c.requestedAt >= change.at - 3000);
  return {
    change: `${change.from} -> ${change.to}`,
    silenceMs: lastEnd && firstPlay ? firstPlay.t - lastEnd.t : null,
    firstWords: firstClip?.text?.slice(0, 120) ?? null,
    firstClipCache: firstClip?.cache ?? null,
    firstClipFetchMs: firstClip?.respondedAt ? firstClip.respondedAt - firstClip.requestedAt : null,
  };
});
for (const r of report) log(JSON.stringify(r));
fs.writeFileSync(path.join(outDir, "gaps.json"), JSON.stringify({ report, clips: clips.slice(0, 40), audio: audio.slice(0, 200) }, null, 2));
await browser.close();

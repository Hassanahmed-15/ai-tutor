/**
 * WHERE DOES A LECTURE GO QUIET? — a playback probe for "the lecture gets stuck for a moment, or stops".
 *
 *   node scripts/probe-playback-stalls.mjs "<prompt>" <email> <password-file> [out-dir] [--max-min 15]
 *
 * Starts a typed-prompt lecture as a student (first suggested answer to every planning question),
 * presses Play, and watches it to the end while recording, in the page:
 *   - every narration clip's audio events (play, playing, pause, ended, waiting, stalled, error),
 *   - every /api/tts request (start, end, status, ms) and every lecture-snapshot poll,
 *   - the player's own [playback] trace (dev builds) and console errors,
 *   - once a second: the part shown, whether Play/Pause is offered, and any wait or task on screen.
 * Then lists every SILENCE — no narration playing for 2 s or more while the lecture is not waiting
 * on the student — with what was going on at the time, so each one has a cause.
 * LAB_URL sets the target (default http://localhost:3000). Each run generates one real lecture.
 */
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const BASE = process.env.LAB_URL ?? "http://localhost:3000";
const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = argv.indexOf(name);
  if (i < 0) return fallback;
  const v = argv[i + 1];
  argv.splice(i, 2);
  return v;
};
const maxMinutes = Number(flag("--max-min", "15"));
const [prompt, email, pwFile, outDir = path.resolve("playback-probe-out")] = argv;
if (!prompt || !email || !pwFile) {
  console.error('usage: node scripts/probe-playback-stalls.mjs "<prompt>" <email> <password-file> [out-dir] [--max-min 15]');
  process.exit(2);
}
fs.mkdirSync(outDir, { recursive: true });
const t0 = Date.now();
const log = (line) => console.log(`[${String(Math.round((Date.now() - t0) / 1000)).padStart(4)}s] ${line}`);

const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.addInitScript(() => {
  try {
    localStorage.setItem("aria.guide.seen", "1");
  } catch {}
  const w = window;
  w.__probe = { events: [] };
  const push = (kind, detail = {}) => w.__probe.events.push({ t: Date.now(), kind, ...detail });
  // Every narration clip: the element is created with new Audio() and never attached to the page.
  const seen = new WeakSet();
  const play = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function (...args) {
    if (!seen.has(this)) {
      seen.add(this);
      for (const type of ["playing", "pause", "ended", "waiting", "stalled", "error"]) {
        this.addEventListener(type, () => push(`audio-${type}`, { at: Math.round(this.currentTime * 10) / 10, dur: Math.round((this.duration || 0) * 10) / 10 }));
      }
    }
    push("audio-play-call");
    return play.apply(this, args);
  };
  // Network the lecture depends on.
  const realFetch = w.fetch;
  w.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input?.url ?? "";
    const tracked = /\/api\/tts\b|\/api\/progressive-lectures\/[^/?]+(\?|$)/.test(url);
    const id = Math.random().toString(36).slice(2, 8);
    const start = Date.now();
    if (tracked) push("fetch-start", { id, url: url.replace(/^https?:\/\/[^/]+/, "").slice(0, 60) });
    try {
      const res = await realFetch(input, init);
      if (tracked) push("fetch-end", { id, status: res.status, ms: Date.now() - start });
      return res;
    } catch (error) {
      if (tracked) push("fetch-fail", { id, ms: Date.now() - start, error: String(error).slice(0, 80) });
      throw error;
    }
  };
});
const login = await ctx.request.post(`${BASE}/api/auth/login`, { data: { email, password: fs.readFileSync(pwFile, "utf8").trim() } });
if (!login.ok()) throw new Error(`login failed: ${login.status()}`);
const page = await ctx.newPage();
const consoleLines = [];
page.on("console", (m) => {
  const text = m.text();
  if (text.startsWith("[playback]") || m.type() === "error") consoleLines.push({ t: Date.now(), type: m.type(), text: text.slice(0, 300) });
});
page.on("pageerror", (e) => consoleLines.push({ t: Date.now(), type: "pageerror", text: String(e).slice(0, 300) }));

let sessionId = null;
page.on("response", async (response) => {
  if (response.request().method() === "POST" && response.url().endsWith("/api/progressive-lectures")) sessionId = (await response.json().catch(() => ({}))).sessionId ?? null;
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
    log("pressed Start");
    break;
  }
  const option = page.locator("button:has(span:text-is('A'))").first();
  if (await option.isVisible().catch(() => false) && await option.isEnabled().catch(() => false)) {
    await option.click().catch(() => {});
    await page.waitForTimeout(1500);
  }
}
for (let i = 0; i < 120 && !sessionId; i++) await page.waitForTimeout(1000);
if (!sessionId) {
  await page.screenshot({ path: path.join(outDir, "stuck-start.png") });
  throw new Error("no lecture started");
}
log(`lecture ${sessionId}`);

// Watch it play to the end, the way a student would: Play when offered, carry on past tasks.
const samples = [];
const startedAt = Date.now();
let lastPart = "";
for (let i = 0; i < maxMinutes * 60; i++) {
  await page.waitForTimeout(1000);
  const play = page.getByRole("button", { name: /^Play the lecture$/ }).first();
  const playOffered = await play.isVisible().catch(() => false);
  if (playOffered && await play.isEnabled().catch(() => false)) await play.click().catch(() => {});
  const goOn = page.getByRole("button", { name: /^(?:Continue the lesson|Skip and continue|Continue anyway|Continue)$/ }).first();
  const taskOpen = await goOn.isVisible().catch(() => false);
  const quizOption = page.locator("[data-quiz-option], button:has-text('A)')").first();
  const state = await page.evaluate(() => {
    const text = document.body.innerText;
    const part = text.match(/Part (\d+) of (\d+)/)?.[0] ?? "";
    const waiting = text.match(/(Preparing[^\n]{0,60}|Drawing the next[^\n]{0,60}|Writing the next[^\n]{0,60}|next (?:drawing|writing)…|Loading[^\n]{0,40}|Reconnecting[^\n]{0,40}|Connecting[^\n]{0,20}|Aria is speaking|Lecture complete)/g) ?? [];
    return { part, waiting: [...new Set(waiting)].slice(0, 4), paused: Boolean([...document.querySelectorAll("button")].find((b) => /^\s*Play\s*$/.test(b.innerText))) };
  });
  samples.push({ t: Date.now(), ...state, playOffered, taskOpen });
  if (state.part !== lastPart) { log(`${state.part} ${state.waiting.join(" | ")}`); lastPart = state.part; }
  if (taskOpen) {
    await page.waitForTimeout(1500);
    await goOn.click().catch(() => {});
  } else if (await quizOption.isVisible().catch(() => false)) {
    await quizOption.click().catch(() => {});
  }
  if (state.waiting.includes("Lecture complete")) { log("Lecture complete"); break; }
}
const events = await page.evaluate(() => window.__probe.events);
await page.screenshot({ path: path.join(outDir, "end.png") });
await browser.close();

/* ── analysis: every silence of 2 s or more, and what was happening ─────────────────────────── */
const rel = (t) => Math.round((t - startedAt) / 100) / 10;
const audioOn = []; // [start, end] intervals with narration playing
let on = null;
for (const e of events) {
  if (e.kind === "audio-playing" && on === null) on = e.t;
  if ((e.kind === "audio-pause" || e.kind === "audio-ended" || e.kind === "audio-error") && on !== null) { audioOn.push([on, e.t]); on = null; }
}
if (on !== null) audioOn.push([on, Date.now()]);
const firstVoice = audioOn[0]?.[0] ?? startedAt;
const lastVoice = audioOn.at(-1)?.[1] ?? Date.now();
const silences = [];
for (let i = 1; i < audioOn.length; i++) {
  const gap = audioOn[i][0] - audioOn[i - 1][1];
  if (gap >= 2000) silences.push([audioOn[i - 1][1], audioOn[i][0]]);
}
const tts = new Map();
for (const e of events) {
  if (e.kind === "fetch-start" && e.url.startsWith("/api/tts")) tts.set(e.id, { start: e.t });
  if ((e.kind === "fetch-end" || e.kind === "fetch-fail") && tts.has(e.id)) Object.assign(tts.get(e.id), { end: e.t, ms: e.ms, status: e.status ?? "FAIL" });
}
const ttsList = [...tts.values()].filter((x) => x.ms !== undefined);
const report = [];
report.push(`narration from ${rel(firstVoice)}s to ${rel(lastVoice)}s; ${audioOn.length} clips; ${ttsList.length} /api/tts calls — median ${median(ttsList.map((x) => x.ms))} ms, max ${Math.max(0, ...ttsList.map((x) => x.ms))} ms, slow(>4s) ${ttsList.filter((x) => x.ms > 4000).length}, failed ${ttsList.filter((x) => x.status === "FAIL" || x.status >= 400).length}`);
report.push(`silences of 2 s or more between clips: ${silences.length}`);
for (const [a, b] of silences) {
  const during = samples.filter((s) => s.t >= a - 500 && s.t <= b + 500);
  const task = during.some((s) => s.taskOpen);
  const parts = [...new Set(during.map((s) => s.part))].join(" → ");
  const waits = [...new Set(during.flatMap((s) => s.waiting))].join(" | ");
  const pendingTts = ttsList.filter((x) => x.start < b && x.end > a).map((x) => `${x.ms}ms${x.status !== 200 ? `(${x.status})` : ""}`);
  const trace = consoleLines.filter((c) => c.t >= a - 300 && c.t <= b + 300).map((c) => c.text.slice(0, 90));
  report.push(`- ${((b - a) / 1000).toFixed(1)} s at ${rel(a)}s [${parts}]${task ? " TASK/QUIZ ON SCREEN (student's turn)" : ""}${waits ? ` screen: ${waits}` : ""}${pendingTts.length ? ` tts in flight: ${pendingTts.join(", ")}` : ""}${trace.length ? `\n    trace: ${trace.slice(0, 5).join(" || ")}` : ""}`);
}
const errors = consoleLines.filter((c) => c.type !== "log");
if (errors.length) report.push(`console errors (${errors.length}): ${errors.slice(0, 6).map((c) => c.text.slice(0, 120)).join(" || ")}`);
fs.writeFileSync(path.join(outDir, "events.json"), JSON.stringify({ events, samples, consoleLines }, null, 1));
fs.writeFileSync(path.join(outDir, "report.txt"), report.join("\n"));
console.log(report.join("\n"));

function median(xs) {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

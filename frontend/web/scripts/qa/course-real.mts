/**
 * ONE REAL COURSE LESSON, END TO END, the way a student meets it: the course flow opens it, the app builds it
 * with real pictures and real voice, and it plays to the end. PAID (a full lecture, about $0.70).
 * Saves screenshots of each board; measures each piece against the real audio; checks word positions
 * against a transcription of her real voice; then goes on through the end screens to the Next button.
 *
 *   node --env-file=.env.local --conditions=react-server --import tsx scripts/qa/course-real.mts "<lesson title>" <outDir> [rate]
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { chromium } from "playwright";
import OpenAI, { toFile } from "openai";
import { curriculumLessons } from "../../lib/db/cosmos";
import type { CachedLesson } from "../../lib/curriculum/lessonCache";
import { signAccessToken } from "../../lib/auth";
import { canvasSentences } from "../../lib/canvas/plan";
import { wordPositions } from "../../lib/canvas/blocks";

const [match, out, rateArg = "1.25"] = process.argv.slice(2);
const RATE = Number(rateArg);
mkdirSync(out, { recursive: true });
const c = await curriculumLessons();
const { resources } = await c.items.query<CachedLesson>({ query: "SELECT TOP 300 * FROM c WHERE IS_DEFINED(c.spec) ORDER BY c._ts DESC" }).fetchAll();
const hit = resources.find((r) => r.spec.lessonTitle === match);
if (!hit) throw new Error("no cached lesson");
const user = "local-dev-canvas";
const token = await signAccessToken(user, "local-dev-canvas@example.com");
const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.addCookies([{ name: "aria_access", value: token, domain: "localhost", path: "/" }]);
await ctx.route("**/api/auth/me", (r) => r.fulfill({ json: { databaseConfigured: true, user: { id: user, email: "local-dev-canvas@example.com", username: "QA", onboarded: true, needsLearnerProfile: false, needsPreferences: false, hasPassword: true }, profile: null } }));
// REUSE=<sessionId>: the same course flow plays a lecture already built, so nothing new is paid for.
const reuse = process.env.REUSE;
if (reuse) {
  await ctx.route("**/api/progressive-lectures", (r) => (r.request().method() === "POST" ? r.fulfill({ json: { sessionId: reuse, status: "generating", delivery: "in-process-development" }, status: 202 }) : r.continue()));
  await ctx.route("**/api/curricula/verify", (r) => r.fulfill({ status: 503, json: {} }));
}
const page = await ctx.newPage();
const clips = new Map<string, Buffer>();
const bySize = new Map<number, string>();
// The real clip, kept as it passes through (a streamed response cannot be read back afterwards).
await ctx.route("**/api/tts", async (route) => {
  const res = await route.fetch();
  const body = await res.body();
  if (res.ok()) {
    const text = String((route.request().postDataJSON() as { text?: string })?.text ?? "");
    clips.set(text, body);
    bySize.set(body.length, text);
  }
  await route.fulfill({ response: res, body });
});
let sessionId = reuse ?? "";
const errors: string[] = [];
page.on("pageerror", (e) => errors.push(e.message.slice(0, 200)));
page.on("response", async (res) => {
  const url = res.url();
  try {
    if (/\/api\/progressive-lectures$/.test(url) && res.request().method() === "POST") {
      sessionId = ((await res.json()) as { sessionId?: string }).sessionId ?? sessionId;
      console.log("session", sessionId);
    }
  } catch { /* a response cancelled while the page moved on */ }
});
await ctx.addInitScript(([request, rate]: [unknown, number]) => {
  const w = window as unknown as Record<string, unknown>;
  w.__name = (f: unknown) => f;
  w.__sync = [];
  localStorage.setItem("aria.lecture.rate", String(rate));
  localStorage.setItem("aria.syncDebug", "1");
  localStorage.setItem("aria.guide.seen", "1");
  if (!sessionStorage.getItem("aria.startedOnce")) { sessionStorage.setItem("aria.startedOnce", "1"); sessionStorage.setItem("aria.pendingCurriculum", JSON.stringify(request)); }
  const sizes: Record<string, number> = {};
  const make = URL.createObjectURL.bind(URL);
  URL.createObjectURL = (o: Blob | MediaSource) => { const u = make(o); if (o instanceof Blob) sizes[u] = o.size; return u; };
  const Original = window.Audio;
  function Tracked(this: unknown, ...x: unknown[]) {
    const el = new (Original as unknown as new (...y: unknown[]) => HTMLAudioElement)(...x);
    for (const ev of ["playing", "pause", "ended"]) el.addEventListener(ev, () => (w.__sync as unknown[]).push({ t: performance.now(), ev, size: sizes[el.src], at: el.currentTime, rate: el.playbackRate, dur: el.duration }));
    return el;
  }
  Tracked.prototype = Original.prototype;
  (window as unknown as { Audio: unknown }).Audio = Tracked;
}, [{ ...hit.request, version: "", ...(reuse ? { part: 1 } : {}) }, RATE] as [unknown, number]);
await page.goto("http://localhost:3000/", { waitUntil: "domcontentloaded", timeout: 180000 });

const started = Date.now();
const shot = (name: string) => page.screenshot({ path: `${out}/${name}.png` }).catch(() => undefined);
let lastHeading = "";
let boardNo = 0;
let notesShot = false;
let lastChange = Date.now();
let title = "";
const finishedAt = Date.now() + 45 * 60_000;
for (;;) {
  if (Date.now() > finishedAt) { console.log("gave up waiting"); break; }
  await page.waitForTimeout(1500);
  const state = await page.evaluate(() => ({
    heading: document.querySelector('g[data-live="true"] text')?.textContent ?? "",
    offer: /I.m done for now/.test(document.body.innerText),
    finished: /It will not run/.test(document.body.innerText),
    pieces: ((window as unknown as { __blockLog?: unknown[] }).__blockLog ?? []).length,
  })).catch(() => null);
  if (!state) continue;
  // A question card is closed so the lesson carries on.
  await page.locator('[aria-label="Close question"]').first().click({ timeout: 300, force: true }).catch(() => undefined);
  // A lecture already built opens paused, waiting for Play.
  const playButton = page.getByRole("button", { name: /play the lecture/i }).first();
  if (await playButton.isVisible().catch(() => false)) await playButton.click({ timeout: 500 }).catch(() => undefined);
  // A "try it yourself" task waits for the student.
  await page.getByRole("button", { name: /continue the lesson/i }).first().click({ timeout: 300 }).catch(() => undefined);
  if (state.heading && state.heading !== lastHeading) {
    lastHeading = state.heading;
    lastChange = Date.now();
    boardNo++;
    console.log(`board ${boardNo}: ${state.heading} (${Math.round((Date.now() - started) / 1000)} s, ${state.pieces} pieces)`);
    const n = boardNo;
    setTimeout(() => void shot(`board-${String(n).padStart(2, "0")}`), 16000);
    if (n === 1) title = await page.title().catch(() => "");
  }
  if (boardNo === 4 && !notesShot && Date.now() - lastChange > 20000) {
    notesShot = true;
    await page.locator("[data-notes-toggle]").first().click().catch(() => undefined);
    await page.waitForTimeout(1200);
    await shot("notes-panel");
    await page.locator('[aria-label="Close lesson notes"]').first().click().catch(() => undefined);
  }
  if (Date.now() - lastChange > 150000 && boardNo > 0) { await shot(`stall-${boardNo}`); console.log(`stalled on board ${boardNo}`); lastChange = Date.now(); const play = page.getByRole("button", { name: /play the lecture/i }).first(); if (await play.isVisible().catch(() => false)) await play.click().catch(() => undefined); }
  if (state.offer || state.finished) { console.log("lecture over:", state.finished ? "finished screen" : "test offer"); break; }
}
await page.waitForTimeout(2000);
await shot("end-1");
const log = (await page.evaluate(() => (window as unknown as { __blockLog?: unknown[] }).__blockLog ?? [])) as Array<{ section: string; key: string; at: number; t: number }>;
const sync = (await page.evaluate(() => (window as unknown as { __sync: unknown[] }).__sync)) as Array<{ t: number; ev: string; size: number; at: number; rate: number; dur: number }>;
// Past the offer to the finished screen: is the Next button there?
const next = await page.locator("[data-next-lesson]").first().textContent({ timeout: 4000 }).catch(() => null);
console.log("next-lesson button on the end screen:", next);
// And it really opens Lesson 2 (the plan is cached; only the page changes, no build is paid for).
let openedNext = "";
if (next) {
  await ctx.unroute("**/api/progressive-lectures").catch(() => undefined);
  await ctx.route("**/api/progressive-lectures", (r) => (r.request().method() === "POST" ? r.abort() : r.continue()));
  const asked = page.waitForRequest((r) => r.url().endsWith("/api/curricula/lesson") && r.method() === "POST", { timeout: 30000 }).catch(() => null);
  const answered = page.waitForResponse((r) => r.url().endsWith("/api/curricula/lesson"), { timeout: 40000 }).catch(() => null);
  await page.locator("[data-next-lesson]").first().click();
  const request = await asked;
  const res = await answered;
  const data = res ? ((await res.json().catch(() => ({}))) as { series?: { part: number; parts: number } }) : {};
  openedNext = `asked for part ${(request?.postDataJSON() as { part?: number } | undefined)?.part}, server opened lesson ${data.series?.part} of ${data.series?.parts}`;
  console.log("pressing Next:", openedNext);
}

const snap = (await (await fetch(`http://localhost:3000/api/progressive-lectures/${sessionId}`, { headers: { cookie: `aria_access=${token}` } })).json()) as { beats: Array<{ id: string; script: string; title?: string; draw?: { ops: Array<{ kind: string; spec?: { blocks?: Array<{ kind: string; section_id: string }>; stage: { kind: string } } }> } } | null>; costUsd?: number; status?: string };
const beats = snap.beats.filter(Boolean) as NonNullable<(typeof snap.beats)[number]>[];
const specs = beats.map((b) => ({ b, spec: b.draw?.ops.find((o) => o.kind === "canvasBoard")?.spec }));
const kinds: Record<string, number> = {};
specs.forEach(({ spec }) => spec?.blocks?.forEach((x) => (kinds[x.kind] = (kinds[x.kind] ?? 0) + 1)));
console.log(`boards ${beats.length}, stages ${specs.map(({ spec }) => spec?.stage.kind).join(" ")}, with blocks ${specs.filter(({ spec }) => spec?.blocks?.length).length}, block kinds ${JSON.stringify(kinds)}, build cost $${(snap.costUsd ?? 0).toFixed(3)}`);

// 1. Each piece against the audio that was really playing.
const plays = new Map<string, Array<{ t: number; at: number; rate: number; dur: number }>>();
for (const e of sync) if (e.ev === "playing") { const text = bySize.get(e.size); if (text) (plays.get(text) ?? plays.set(text, []).get(text)!).push(e); }
const late: number[] = [];
for (const row of log) {
  const beat = specs.find(({ spec }) => spec?.blocks?.[0]?.section_id === row.section)?.b;
  if (!beat) continue;
  const sentences = canvasSentences(beat.script);
  const s = Math.min(sentences.length - 1, Math.floor(row.at));
  const list = plays.get(sentences[s]);
  if (!list?.length) continue;
  const audioAt = (row.at - s) * list[0].dur;
  const seg = [...list].reverse().find((p) => p.at <= audioAt + 0.01) ?? list[0];
  late.push(row.t - (seg.t + ((audioAt - seg.at) / (seg.rate || RATE)) * 1000));
}
const q = (xs: number[], p: number) => { const a = [...xs].sort((x, y) => x - y); return Math.round(a[Math.min(a.length - 1, Math.floor(a.length * p))] ?? NaN); };
console.log(`pieces appeared: ${log.length}, shown twice ${log.length - new Set(log.map((r) => r.section + r.key)).size}; vs the playing audio (${late.length} measured): median ${q(late, 0.5)} ms, 90th ${q(late, 0.9)} ms, worst ${q(late, 0.999)} ms`);

// 2. Where each word really starts in her voice (a transcription of 14 real clips) against the estimate.
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const errs: number[] = [];
const sample = [...clips.entries()].filter(([t]) => t.split(/\s+/).length >= 6).filter((_, i) => i % 5 === 0).slice(0, 14);
for (const [text, body] of sample) {
  const r = (await openai.audio.transcriptions.create({ model: "whisper-1", file: await toFile(body, "c.mp3"), response_format: "verbose_json", timestamp_granularities: ["word"] })) as unknown as { duration: number; words: Array<{ word: string; start: number }> };
  const est = wordPositions(text);
  let j = 0;
  for (const w of r.words) {
    const norm = w.word.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
    for (let k = j; k < Math.min(est.length, j + 3); k++) if (est[k].word.replace(/[^\p{L}\p{N}]/gu, "") === norm) { errs.push(Math.abs(est[k].at * r.duration - w.start) * 1000); j = k + 1; break; }
  }
}
console.log(`word position vs her real voice (${sample.length} clips, ${errs.length} words): median ${q(errs, 0.5)} ms, 90th ${q(errs, 0.9)} ms, worst ${q(errs, 0.999)} ms`);
writeFileSync(`${out}/result.json`, JSON.stringify({ sessionId, title, kinds, errors: errors.slice(0, 20), late, errs }, null, 1));
console.log("page errors:", errors.length, errors.slice(0, 3));
await browser.close();
process.exit(0);

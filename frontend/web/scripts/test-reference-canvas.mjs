/**
 * IS A PDF USED "AS A REFERENCE" TAUGHT LIKE A TYPED PROMPT — on the canvas, from the whole document?
 *
 * Reported 2026-10-10: the AVL chapter uploaded with "explain me AVL code" (reference) explained the
 * insertion code and nothing else, the board showed one thing while Aria talked about another, and
 * the boards looked worse than a typed prompt's. Reference-mode PDFs now go to the lesson canvas with
 * the whole document as context (lib/canvas/documentContext.ts).
 *
 * Drives the real front page: attaches the PDF, asks the question in the page picker (or none), uses
 * all pages, picks "Use it as a reference", answers each planning question with its first option,
 * builds the outline it is shown — then WATCHES the lecture play, a screenshot every few seconds,
 * while the snapshot API reports the boards as they are written.
 *
 *   node scripts/test-reference-canvas.mjs <pdf> "<question or ''>" <email> <password-file> [out-dir]
 *        [--expect "insert,balance,remove"]   every name must appear in some code board's code
 *        [--watch 600]                        seconds of playback to watch (default: the whole lecture)
 *        [--strict]                           strict mode ("Strictly from source"): still canvas boards,
 *                                             plus the PDF panel boxing the passage being spoken
 *        [--pages 4,5,6]                      tick these pages in the picker instead of using all
 *   A YouTube URL in place of <pdf> runs a video lecture (the header's YouTube launcher).
 *
 * Asserts: every board is a canvas board; Aria's face is nowhere on the page; each
 * --expect name is in a code board's code; every code step and cue lands on a real sentence of its
 * board's script, the steps follow the script in order, and most steps' sentence names something on
 * the lines it lights (the board follows the voice).
 *
 * COST: the PDF parse and planning calls (cents) and ONE real lecture (about $1).
 */
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";

const BASE = process.env.LAB_URL ?? "http://localhost:3000";
const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const at = args.indexOf(name);
  if (at < 0) return fallback;
  const [, value] = args.splice(at, 2);
  return value;
};
const strict = args.includes("--strict") ? (args.splice(args.indexOf("--strict"), 1), true) : false;
const expect = flag("--expect", "").split(",").map((s) => s.trim()).filter(Boolean);
const watchSeconds = Number(flag("--watch", "0")) || 0;
const tickPages = flag("--pages", "").split(",").map((n) => Number(n.trim())).filter((n) => n > 0);
const [pdf, question, email, pwFile, outDir = path.resolve("reference-canvas-out")] = args;
if (!pdf || question === undefined || !email || !pwFile) {
  console.error('usage: node scripts/test-reference-canvas.mjs <pdf> "<question or \'\'>" <email> <password-file> [out-dir] [--expect a,b] [--watch s] [--strict]');
  process.exit(2);
}
fs.mkdirSync(outDir, { recursive: true });
const isVideo = /^https?:\/\//.test(pdf);
// "prompt:<topic>" runs a typed-prompt lecture — the baseline the document modes are compared with.
const promptTopic = pdf.startsWith("prompt:") ? pdf.slice("prompt:".length).trim() : "";
const log = (...parts) => console.log(new Date().toISOString().slice(11, 19), ...parts);
const problems = [];

const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
/*
 * WHAT ARIA IS SAYING, AND WHAT THE BOARD SHOWS AT THAT MOMENT. lib/voice.ts fetches each sentence's
 * clip from /api/tts, makes it an object URL and plays it on an <audio>; hooking those three steps
 * names the sentence actually playing (not one prefetched ahead). Every 700 ms the page records it
 * beside the live canvas board: its heading, the code lines lit, the note beside them.
 */
await ctx.addInitScript(() => {
  const blobText = new WeakMap();
  const urlText = new Map();
  window.__spoken = null;
  window.__sync = [];
  const realFetch = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const res = await realFetch(input, init);
    const url = typeof input === "string" ? input : input?.url ?? "";
    if (url.includes("/api/tts") && init?.body) {
      let text = "";
      try { text = JSON.parse(String(init.body)).text ?? ""; } catch { /* not ours */ }
      const blob = res.blob.bind(res);
      res.blob = async () => { const b = await blob(); blobText.set(b, text); return b; };
    }
    return res;
  };
  const realUrl = URL.createObjectURL.bind(URL);
  URL.createObjectURL = (obj) => { const url = realUrl(obj); if (blobText.has(obj)) urlText.set(url, blobText.get(obj)); return url; };
  const realPlay = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function play() {
    // `src`, not `currentSrc`: currentSrc still names the PREVIOUS clip until the new one loads, which
    // made every sentence look one behind the board.
    const text = urlText.get(this.src) ?? urlText.get(this.currentSrc);
    if (text) window.__spoken = { text, at: Math.round(performance.now()) };
    return realPlay.call(this);
  };
  setInterval(() => {
    const panel = document.querySelector('[data-live="true"]');
    if (!panel || !window.__spoken) return;
    const lit = [...panel.querySelectorAll('text[fill="#e6e9f0"]')]
      .filter((t) => /^\d+$/.test((t.textContent ?? "").trim()))
      .map((t) => ({ n: Number(t.textContent), code: [...(t.parentElement?.querySelectorAll("text") ?? [])].slice(1).map((x) => x.textContent).join(" ") }));
    const notes = [...panel.querySelectorAll('text[fill="#fbbf24"]')].map((t) => t.textContent ?? "");
    const heading = panel.getAttribute("data-panel") ?? "";
    // Strict mode: the passage the PDF panel boxes right now.
    const pointer = document.querySelector("[data-pointer-block]")?.getAttribute("data-pointer-block") ?? null;
    // Passages the panel can box at all (a passage with no place on the page cannot be).
    const boxable = [...document.querySelectorAll("[data-pointer-block],[data-source-highlight]")].map((el) => el.getAttribute("data-pointer-block") ?? el.getAttribute("data-source-highlight"));
    const last = window.__sync.at(-1);
    const row = { t: Math.round(performance.now()), panel: heading, spoken: window.__spoken.text, lit, notes, pointer, boxable };
    if (!last || last.spoken !== row.spoken || JSON.stringify(last.lit) !== JSON.stringify(row.lit) || last.panel !== row.panel || last.pointer !== row.pointer) window.__sync.push(row);
  }, 700);
});
const page = await ctx.newPage();
const login = await ctx.request.post(`${BASE}/api/auth/login`, { data: { email, password: fs.readFileSync(pwFile, "utf8").trim() } });
if (!login.ok()) throw new Error(`login failed: ${login.status()}`);

let payload = null;
let sessionId = null;
page.on("request", (request) => {
  if (request.url().endsWith("/api/progressive-lectures") && request.method() === "POST") payload = request.postDataJSON();
});
page.on("response", async (response) => {
  if (response.url().endsWith("/api/progressive-lectures") && response.request().method() === "POST") {
    sessionId = (await response.json().catch(() => ({}))).sessionId ?? null;
  }
});

await page.goto(BASE, { waitUntil: "domcontentloaded" });
await page.locator("#brief").waitFor({ timeout: 90_000 });
if (promptTopic) {
  await page.locator("#brief").fill(promptTopic);
  await page.locator("#brief").press("Enter");
  log(`typed prompt "${promptTopic}"`);
} else if (isVideo) {
  // The header's YouTube launcher: paste the link, Summarize, and accept a long video's warning.
  await page.getByRole("button", { name: /Summarize a YouTube lecture/ }).first().click();
  await page.locator("#youtube-url").fill(pdf);
  await page.getByRole("button", { name: /^Summarize$/ }).click();
  await page.waitForTimeout(4000);
  const anyway = page.getByRole("button", { name: /Continue anyway/ });
  if (await anyway.isVisible().catch(() => false)) await anyway.click();
  log(`video ${pdf}`);
} else {
  await page.locator('input[type="file"]').first().setInputFiles(pdf);
  const box = page.locator("#page-prompt");
  await box.waitFor({ timeout: 180_000 });
  // Pages to tick, before anything is asked (a question with no pages ticked means the whole file).
  for (const n of tickPages) {
    await page.getByRole("button", { name: new RegExp(`^Select page ${n}$`) }).first().click({ timeout: 60_000 });
  }
  if (question) {
    await box.fill(question);
    const ask = page.locator("button[data-ask-question]");
    if (await ask.isEnabled().catch(() => false)) await ask.click();
    else await box.press("Enter");
  }
  log(`attached ${path.basename(pdf)}${tickPages.length ? ` (pages ${tickPages.join(", ")})` : ""}${question ? ` and asked "${question}"` : " with no question"}`);

  const useAll = page.getByRole("button", { name: /use all pages|use \d+ pages?|ask · all pages/i }).first();
  const choice = page.getByRole("button", { name: strict ? /strict source/i : /use it as a reference/i }).first();
  for (let i = 0; i < 120; i++) {
    if (await choice.isVisible().catch(() => false)) break;
    if (await useAll.isVisible().catch(() => false)) await useAll.click().catch(() => {});
    await page.waitForTimeout(1500);
  }
  await choice.click({ timeout: 60_000 }).catch(async (error) => {
    await page.screenshot({ path: path.join(outDir, "stuck-choice.png") });
    throw error;
  });
  log(`chose ${strict ? "STRICT" : "REFERENCE"}`);
}

if ((!strict && !isVideo) || promptTopic) {
  // The outline's go button: "Start" since the redesign ("Build lesson" before).
  const build = page.getByRole("button", { name: /^\s*(?:Build lesson|Start)\s*$/i }).first();
  for (let i = 0; i < 200 && !payload; i++) {
    await page.waitForTimeout(1000);
    if (await build.isVisible().catch(() => false) && await build.isEnabled().catch(() => false) && !(await page.getByText("Planning…").isVisible().catch(() => false))) {
      await page.screenshot({ path: path.join(outDir, "outline.png") });
      await build.click();
      break;
    }
    const option = page.locator("button:has(span:text-is('A'))").first();
    if (await option.isVisible().catch(() => false) && await option.isEnabled().catch(() => false)) {
      await option.click().catch(() => {});
      await page.waitForTimeout(1500);
    }
  }
}

// A video is read before its lecture starts (several minutes for a long one).
for (let i = 0; i < (isVideo ? 900 : 180) && !sessionId; i++) await page.waitForTimeout(1000);
if (!payload || !sessionId) {
  await page.screenshot({ path: path.join(outDir, "stuck.png") });
  throw new Error("no lecture was started; see stuck.png");
}
fs.writeFileSync(path.join(outDir, "payload.json"), JSON.stringify({ ...payload, suprnotes: undefined }, null, 1));
const titles = (payload.outline?.subtopics ?? []).map((part) => part.title);
log(`outline (${titles.length}): ${titles.map((title) => `"${title}"`).join(", ")}`);
fs.writeFileSync(path.join(outDir, "outline.txt"), titles.join("\n"));
log(`lecture ${sessionId}: scope ${JSON.stringify(payload.sourceScope)}, focus "${payload.focus ?? ""}", outline ${payload.outline ? payload.outline.subtopics.length + " part(s)" : "none"}`);

/* ── watch it play, and follow the snapshot ───────────────────────────────────────────────── */
let snapshot = null;
let shot = 0;
const started = Date.now();
const timeline = [];
let finishedAt = 0;
for (let i = 0; i < 720; i++) {
  await page.waitForTimeout(5000);
  const response = await page.request.get(`${BASE}/api/progressive-lectures/${encodeURIComponent(sessionId)}`, { timeout: 60_000 }).catch(() => null);
  if (response?.ok()) snapshot = await response.json();
  if (snapshot?.error) { problems.push(`the lecture failed: ${snapshot.error}`); break; }
  // The browser holds the lecture until someone presses Play (autoplay needs a gesture); a student
  // would, so the test does — and again whenever the player is paused, e.g. after a task.
  const play = page.getByRole("button", { name: /^Play the lecture$/ }).first();
  if (await play.isVisible().catch(() => false) && await play.isEnabled().catch(() => false)) {
    await play.click().catch(() => {});
    log("pressed Play");
  }
  // A board with a task holds the lecture until the student moves on: answer a quiz with its first
  // option, and skip a "try it" or "draw it" — a student who does nothing would stall the test.
  const goOn = page.getByRole("button", { name: /^(?:Continue the lesson|Skip and continue|Continue anyway)$/ }).first();
  const choose = page.getByRole("button", { name: /^Choose an answer$/ }).first();
  if (await goOn.isVisible().catch(() => false)) {
    await goOn.click().catch(() => {});
    log("continued past a task");
  } else if (await choose.isVisible().catch(() => false)) {
    const option = choose.locator("xpath=ancestor::div[2]//button").first();
    await option.click().catch(() => {});
    await page.waitForTimeout(1500);
    await page.getByRole("button", { name: /^(?:Continue the lesson|Continue anyway)$/ }).first().click().catch(() => {});
    log("answered a quiz");
  }
  // What is on screen: the board's heading in the dock ("Part 2 of 6"), the caption, and a picture.
  const state = await page.evaluate(() => {
    const text = (sel) => document.querySelector(sel)?.textContent?.replace(/\s+/g, " ").trim() ?? "";
    return {
      part: [...document.querySelectorAll("*")].map((el) => el.childElementCount === 0 ? el.textContent ?? "" : "").find((t) => /^Part \d+ of \d+/.test(t.trim()))?.trim() ?? "",
      canvas: Boolean(document.querySelector('[aria-label="Lesson canvas"]')),
      faceButton: [...document.querySelectorAll("button")].some((b) => /Aria's face/i.test(`${b.getAttribute("aria-label") ?? ""} ${b.title ?? ""} ${b.textContent ?? ""}`)),
      webglCanvases: [...document.querySelectorAll("canvas")].filter((c) => { try { return Boolean(c.getContext("webgl2") || c.getContext("webgl")); } catch { return false; } }).length,
      ended: /lecture complete|what you learned|mind map|test yourself/i.test(text("main")),
    };
  }).catch(() => null);
  if (state) {
    timeline.push({ t: Math.round((Date.now() - started) / 1000), ...state });
    if (state.faceButton) problems.push("the dock still has the Show/Hide Aria's face button");
    if (state.webglCanvases > 0) problems.push(`a WebGL canvas (Aria's face renders with one) is on the page at ${Math.round((Date.now() - started) / 1000)}s`);
  }
  if (i % 2 === 0) await page.screenshot({ path: path.join(outDir, `play-${String(shot++).padStart(3, "0")}.png`) }).catch(() => {});
  const done = snapshot && (snapshot.complete || (snapshot.plannedBeatCount > 0 && (snapshot.contiguousReadyCount ?? 0) >= snapshot.plannedBeatCount));
  if (done && !finishedAt) finishedAt = Date.now();
  const watched = (Date.now() - started) / 1000;
  if (state?.ended) break;
  if (done && watchSeconds && watched >= watchSeconds) break;
  if (done && !watchSeconds && finishedAt && Date.now() - finishedAt > 45 * 60_000) break;
}
fs.writeFileSync(path.join(outDir, "timeline.json"), JSON.stringify(timeline, null, 1));
const sync = await page.evaluate(() => window.__sync ?? []).catch(() => []);
fs.writeFileSync(path.join(outDir, "sync.json"), JSON.stringify(sync, null, 1));
await page.screenshot({ path: path.join(outDir, "final.png") }).catch(() => {});
await browser.close();
if (!snapshot) throw new Error("the lecture could not be read");
fs.writeFileSync(path.join(outDir, "lecture.json"), JSON.stringify(snapshot, null, 1));

/* ── what was taught ─────────────────────────────────────────────────────────────────────────── */
const sentencesOf = (script) => String(script ?? "").split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean);
const words = (text) => new Set(String(text).replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase().match(/[a-z]{3,}/g) ?? []);
const CODE_STOP = new Set(["the", "and", "for", "int", "void", "const", "return", "else", "nullptr", "null", "this", "that", "with", "new", "auto", "struct", "static"]);
const beats = snapshot.beats ?? [];
const specOf = (beat) => beat?.draw?.ops?.find((op) => op.kind === "canvasBoard")?.spec;
log(`lecture: ${beats.length}/${snapshot.plannedBeatCount} boards, $${(snapshot.costUsd ?? 0).toFixed(2)}`);
const allCode = [];
let steps = 0;
let followed = 0;
// How much each board draws and how often it changes with the voice — compared across modes
// (strict must not be thinner than a typed prompt: the student's rule, 2026-10-10).
const quality = [];
for (const [index, beat] of beats.entries()) {
  const spec = specOf(beat);
  const sentences = sentencesOf(beat.script);
  log(`  ${index + 1}. ${beat.title} — ${spec ? spec.stage.kind : `NOT CANVAS (${beat.draw?.ops?.map((op) => op.kind).join(",") || "no draw"})`}, ${sentences.length} sentences`);
  log(`     says: ${String(beat.script ?? "").replace(/\s+/g, " ").slice(0, 220)}…`);
  if (!spec) {
    problems.push(`board ${index + 1} ("${beat.title}") is not a canvas board`);
    continue;
  }
  const st = spec.stage;
  const elements = [...(spec.notes ?? []), ...(st.nodes ?? []), ...(st.arrows ?? []), ...(st.items ?? []), ...(st.tokens ?? []), ...(st.curves ?? []), ...(st.markers ?? []), ...(st.parts ?? []), ...(st.steps ?? []), ...(st.left?.items ?? []), ...(st.right?.items ?? [])];
  const reveals = new Set([...elements.map((e) => e.s), ...(spec.cues ?? []).map((c) => c.s)].filter((v) => typeof v === "number"));
  quality.push({ board: index + 1, stage: st.kind, elements: elements.length, cues: (spec.cues ?? []).length, revealShare: sentences.length ? Math.min(1, reveals.size / sentences.length) : 0, interaction: spec.interaction?.kind ?? null });
  if (strict && !(beat.sourceBlockIds ?? []).length) problems.push(`strict board ${index + 1} names no passage of the PDF to box`);
  for (const cue of spec.cues ?? []) if (cue.s >= sentences.length) problems.push(`board ${index + 1}: a pen cue is on sentence ${cue.s}, past the script's ${sentences.length}`);
  if (st.kind !== "code") continue;
  allCode.push(st.lines.join("\n"));
  log(`     ${st.language}, ${st.lines.length} lines: ${st.lines.slice(0, 3).map((l) => l.trim()).join(" | ")} …`);
  let last = -1;
  for (const step of st.steps) {
    steps++;
    if (step.s >= sentences.length) problems.push(`board ${index + 1}: a code step is on sentence ${step.s}, past the script's ${sentences.length}`);
    if (step.s < last) problems.push(`board ${index + 1}: code steps go back in time (${last} → ${step.s})`);
    last = step.s;
    const lit = words(step.lines.map((n) => st.lines[n - 1] ?? "").join(" "));
    const said = words(sentences[step.s] ?? "");
    if ([...lit].some((w) => !CODE_STOP.has(w) && said.has(w)) || (step.note && [...words(step.note)].some((w) => said.has(w)))) followed++;
  }
}
fs.writeFileSync(path.join(outDir, "quality.json"), JSON.stringify(quality, null, 1));
if (quality.length) {
  const avg = (k) => (quality.reduce((t, q) => t + q[k], 0) / quality.length).toFixed(2);
  const mix = Object.entries(quality.reduce((m, q) => ((m[q.stage] = (m[q.stage] ?? 0) + 1), m), {})).map(([k, v]) => `${k}×${v}`).join(" ");
  log(`board quality — stages ${mix}; per board: ${avg("elements")} elements, ${avg("cues")} pen cues, ${Math.round(Number(avg("revealShare")) * 100)}% of sentences reveal something; interactions ${quality.filter((q) => q.interaction).length}`);
}
const code = allCode.join("\n");
for (const name of expect) if (!code.includes(name)) problems.push(`no code board shows "${name}"`);
if (steps) {
  const share = followed / steps;
  log(`code steps whose sentence names what they light: ${followed}/${steps} (${Math.round(share * 100)}%)`);
  if (share < 0.6) problems.push(`only ${Math.round(share * 100)}% of code steps light lines their sentence talks about`);
}
if (beats.length === 0) problems.push("no boards were generated");

/* ── live sync: while each sentence played, did the lit lines belong to it? ──────────────────── */
// One verdict per spoken sentence: the board state it was heard with (the last sample for it).
const bySentence = new Map();
for (const row of sync) if (row.lit.length) bySentence.set(row.spoken, row);
let heard = 0;
let matched = 0;
const lines = [];
for (const [spoken, row] of bySentence) {
  heard++;
  const said = words(spoken);
  const board = words(`${row.lit.map((l) => l.code).join(" ")} ${row.notes.join(" ")}`);
  const ok = [...board].some((w) => !CODE_STOP.has(w) && said.has(w));
  if (ok) matched++;
  lines.push(`${ok ? "OK  " : "MISS"} [${row.lit.map((l) => l.n).join(",")}] ${row.lit.map((l) => l.code.trim()).join(" / ").slice(0, 90)}\n      said: ${spoken.slice(0, 160)}`);
}
fs.writeFileSync(path.join(outDir, "sync.txt"), lines.join("\n"));
if (steps) {
  log(`live sync — sentences heard on a code board whose lit lines or note name what was said: ${matched}/${heard}`);
  if (heard === 0) log("code boards were not reached while watching — live code sync not measured");
  else if (matched / heard < 0.6) problems.push(`live sync: only ${matched}/${heard} sentences were heard with lines about them lit (see sync.txt)`);
}
if (!sync.length) problems.push("no narration was heard at all (did the lecture play?)");

/* ── strict: is the box on the PDF the passage being spoken? ────────────────────────────────────── */
if (strict) {
  const owner = (spoken) => {
    for (const beat of beats) {
      const i = sentencesOf(beat.script).findIndex((s) => s === spoken.trim());
      if (i >= 0) return { beat, i };
    }
    return null;
  };
  let checked = 0;
  let boxed = 0;
  let right = 0;
  const report = [];
  const lastBySentence = new Map();
  for (const row of sync) lastBySentence.set(row.spoken, row);
  for (const [spoken, row] of lastBySentence) {
    const found = owner(spoken);
    if (!found) continue;
    const expected = found.beat.sentenceBlockIds?.[found.i] ?? null;
    // A passage the parse could not place on the page cannot be boxed: reported, not counted.
    if (expected && row.boxable && !row.boxable.includes(expected)) {
      report.push(`UNBOXABLE expected=${expected} (box=${row.pointer})\n      said: ${spoken.slice(0, 150)}`);
      continue;
    }
    checked++;
    if (row.pointer) boxed++;
    if (row.pointer && row.pointer === expected) right++;
    report.push(`${row.pointer === expected ? "OK  " : row.pointer ? "MOVE" : "NONE"} box=${row.pointer} expected=${expected}\n      said: ${spoken.slice(0, 150)}`);
  }
  fs.writeFileSync(path.join(outDir, "pdf-box.txt"), report.join("\n"));
  log(`PDF box — sentences heard with a passage boxed: ${boxed}/${checked}; boxed on exactly the passage tied to that sentence: ${right}/${checked}`);
  if (checked === 0) problems.push("strict: no spoken sentence could be matched to a board (did the lecture play?)");
  else {
    if (boxed / checked < 0.8) problems.push(`strict: only ${boxed}/${checked} sentences were heard with a passage boxed on the PDF (see pdf-box.txt)`);
    if (right / checked < 0.7) problems.push(`strict: the box followed the voice for only ${right}/${checked} sentences (see pdf-box.txt)`);
  }
}

if (problems.length) {
  log(`FAILED:\n  - ${[...new Set(problems)].join("\n  - ")}`);
  process.exit(1);
}
log(`OK. Output in ${outDir}`);

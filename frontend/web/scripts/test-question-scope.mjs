/**
 * DOES A QUESTION TYPED WITH A PDF GET ONLY ITS ANSWER?
 *
 * Reported 2026-10-03: tree del.pdf, strict, "explain me insertion process in bst" — and the lecture
 * had a slide on deletion as well. Drives the real front page: types the question, attaches the
 * PDF, uses all pages, picks the mode (reference also answers the planning questions with the first
 * option and builds the outline it is shown), then follows the lecture to the end and reads every
 * slide.
 *
 *   node scripts/test-question-scope.mjs <pdf> "<question>" <strict|reference> <email> <password-file> [out-dir] [--avoid regex]
 *
 * Asserts: the lecture was planned from the question (scope "section" with the question as focus),
 * and no slide's title or script matches --avoid (default: deletion/removal, for the reported case).
 * Prints every slide's title, source blocks and opening words.
 *
 * COST: the PDF parse and planning calls (cents) and ONE real lecture (about $1).
 */
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";

const BASE = process.env.LAB_URL ?? "http://localhost:3000";
const args = process.argv.slice(2);
const avoidAt = args.indexOf("--avoid");
const avoid = new RegExp(avoidAt >= 0 ? args.splice(avoidAt, 2)[1] : "\\b(?:delet\\w*|remov\\w*)\\b", "i");
const [pdf, question, mode, email, pwFile, outDir = path.resolve("question-scope-out")] = args;
if (!pdf || !question || !["strict", "reference"].includes(mode) || !email || !pwFile) {
  console.error('usage: node scripts/test-question-scope.mjs <pdf> "<question>" <strict|reference> <email> <password-file> [out-dir] [--avoid regex]');
  process.exit(2);
}
fs.mkdirSync(outDir, { recursive: true });
const log = (...parts) => console.log(new Date().toISOString().slice(11, 19), ...parts);
async function askInPicker(page, question) {
  const box = page.locator("#page-prompt");
  await box.waitFor({ timeout: 180_000 });
  await box.fill(question);
  const ask = page.locator("button[data-ask-question]");
  if (await ask.isEnabled().catch(() => false)) await ask.click();
  else await box.press("Enter");
}

const problems = [];

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
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
await page.locator("#brief").waitFor({ timeout: 60_000 });
await page.locator('input[type="file"]').first().setInputFiles(pdf);
await askInPicker(page, question);
log(`attached ${path.basename(pdf)} and asked "${question}" in the page picker`);

// The page picker appears unless the question skips it; then the strict-or-reference choice.
const useAll = page.getByRole("button", { name: /use all pages|use \d+ pages?/i }).first();
const choice = page.getByRole("button", { name: mode === "strict" ? /strict source/i : /use it as a reference/i }).first();
for (let i = 0; i < 120; i++) {
  if (await choice.isVisible().catch(() => false)) break;
  if (await useAll.isVisible().catch(() => false)) await useAll.click().catch(() => {});
  await page.waitForTimeout(1500);
}
await choice.click({ timeout: 60_000 });
log(`chose ${mode.toUpperCase()}`);

if (mode === "reference") {
  // Answer each planning question with option A until the outline's Build button is there.
  const build = page.getByRole("button", { name: /Build lesson/i }).first();
  let depthAsked = "";
  for (let i = 0; i < 150 && !payload; i++) {
    await page.waitForTimeout(1000);
    // What the planning screen calls the lesson: it must be the question's subject, not a line of the PDF.
    if (!depthAsked) {
      depthAsked = (await page.getByText(/How deep do you want to go with/i).first().innerText().catch(() => "")).replace(/\s+/g, " ").trim();
      if (depthAsked) {
        log(`planning screen: "${depthAsked}"`);
        if (/\text|hardest operation|^How deep do you want to go with (?:Page|Slide) \d/i.test(depthAsked)) problems.push(`the planning screen named the lesson from the PDF's body text: "${depthAsked}"`);
      }
    }
    if (await build.isVisible().catch(() => false) && await build.isEnabled().catch(() => false) && !(await page.getByText("Planning…").isVisible().catch(() => false))) {
      const titles = await page.locator('input[aria-label^="Topic "][aria-label$=" title"]').evaluateAll((inputs) => inputs.map((input) => input.value));
      log(`outline (${titles.length}): ${titles.map((title) => `"${title}"`).join(", ")}`);
      fs.writeFileSync(path.join(outDir, `${mode}-outline.txt`), titles.join("\n"));
      await page.screenshot({ path: path.join(outDir, `${mode}-outline.png`) });
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

for (let i = 0; i < 120 && !sessionId; i++) await page.waitForTimeout(1000);
if (!payload || !sessionId) {
  await page.screenshot({ path: path.join(outDir, `${mode}-stuck.png`) });
  throw new Error(`no lecture was started; see ${mode}-stuck.png`);
}
const sourceBlocks = payload.suprnotes?.contentBlocks ?? [];
fs.writeFileSync(path.join(outDir, `${mode}-payload.json`), JSON.stringify({ ...payload, suprnotes: undefined }, null, 1));
log(`lecture request: scope ${JSON.stringify(payload.sourceScope?.breadth)}, focus "${payload.focus ?? ""}", outline ${payload.outline ? payload.outline.subtopics.length + " subtopic(s)" : "none"}`);
if (payload.sourceScope?.breadth?.kind === "whole") problems.push("the lecture was planned for the whole document, not the question");

let snapshot = null;
for (let i = 0; i < 160; i++) {
  await page.waitForTimeout(5000);
  const response = await page.request.get(`${BASE}/api/progressive-lectures/${encodeURIComponent(sessionId)}`, { timeout: 60_000 }).catch(() => null);
  if (!response?.ok()) continue;
  snapshot = await response.json();
  const ready = snapshot.contiguousReadyCount ?? 0;
  if (ready > 0) await page.request.post(`${BASE}/api/progressive-lectures/${encodeURIComponent(sessionId)}/interaction`, { data: { kind: "playhead", playhead: ready - 1 } }).catch(() => {});
  if (snapshot.error) { problems.push(`the lecture failed: ${snapshot.error}`); break; }
  if (snapshot.complete || (snapshot.plannedBeatCount > 0 && ready >= snapshot.plannedBeatCount)) break;
}
await browser.close();
if (!snapshot) throw new Error("the lecture could not be read");
fs.writeFileSync(path.join(outDir, `${mode}-lecture.json`), JSON.stringify(snapshot, null, 1));

const beats = snapshot.beats ?? [];
const blockText = new Map((sourceBlocks ?? []).map((block) => [block.id, String(block.text ?? "").replace(/\s+/g, " ")]));
log(`lecture: ${beats.length}/${snapshot.plannedBeatCount} slides, $${(snapshot.costUsd ?? 0).toFixed(2)}`);
for (const [index, beat] of beats.entries()) {
  const sentences = `${beat.transitionIn ?? ""} ${beat.script ?? ""}`.split(/(?<=[.!?])\s+/).filter(Boolean);
  // A passing word ("searching, adding and removing") is not teaching it; a title or several sentences are.
  const offSentences = sentences.filter((sentence) => avoid.test(sentence));
  const offTitle = avoid.test(String(beat.title));
  const offSources = (beat.sourceBlockIds ?? []).filter((id) => avoid.test(blockText.get(id) ?? ""));
  log(`  ${index + 1}. ${beat.title}`);
  for (const id of beat.sourceBlockIds ?? []) log(`     source ${id}: "${(blockText.get(id) ?? "?").slice(0, 110)}"`);
  log(`     says: ${String(beat.script ?? "").replace(/\s+/g, " ").slice(0, 200)}…`);
  if (offTitle) problems.push(`slide ${index + 1} is titled "${beat.title}": it is not about the question`);
  if (offSentences.length >= 2) problems.push(`slide ${index + 1} ("${beat.title}") teaches beyond the question in ${offSentences.length} sentences, e.g. "${offSentences[0].slice(0, 100)}"`);
  if (offSources.length) problems.push(`slide ${index + 1} is taught from a block that is not about the question: "${(blockText.get(offSources[0]) ?? "").slice(0, 90)}"`);
}
if (beats.length === 0) problems.push("no slides were generated");

if (problems.length) {
  log(`FAILED:\n  - ${problems.join("\n  - ")}`);
  process.exit(1);
}
log(`OK — the lecture answers only "${question}". Output in ${outDir}`);

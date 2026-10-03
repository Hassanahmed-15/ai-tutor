/**
 * A DEEP TYPED-PROMPT LECTURE: are the board titles real titles, and do the passes over one concept
 * open differently? A REAL lecture (costs one lecture).
 *
 * Types the prompt on the front page, answers the planning questions with the first option, picks
 * the "deep" depth where it is offered, builds, then reads every board back from the session API:
 * no title may be a sentence fragment, and no continuation pass may open the way its concept's
 * first board opened.
 *
 *   node scripts/test-prompt-passes.mjs <email> <password-file> "<prompt>" [out-dir]
 */
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";

const BASE = process.env.LAB_URL ?? "http://localhost:3000";
const [email, pwFile, prompt, outDir = path.resolve("prompt-passes-out")] = process.argv.slice(2);
fs.mkdirSync(outDir, { recursive: true });
const password = fs.readFileSync(pwFile, "utf8").trim();
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const problems = [];

const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
const ctx = await browser.newContext({ viewport: { width: 1600, height: 950 } });
const page = await ctx.newPage();
const login = await page.request.post(`${BASE}/api/auth/login`, { data: { email, password } });
if (!login.ok()) throw new Error(`login failed: ${login.status()}`);
await page.goto(BASE, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(4000);
await page.locator("#brief").fill(prompt);
await page.locator("#brief").press("Enter");

// Planning: prefer a "deep" option where one is offered, else the first option, until Build appears.
const buildButton = page.getByRole("button", { name: /Build lesson/i }).first();
const titleInputs = page.locator('input[aria-label^="Topic "][aria-label$=" title"]');
for (let i = 0; i < 150; i++) {
  await page.waitForTimeout(1000);
  if (await buildButton.isVisible().catch(() => false) && await titleInputs.count() && !(await page.getByText("Planning…").isVisible().catch(() => false))) break;
  const deep = page.getByRole("button", { name: /deep|in depth|thorough|advanced/i }).first();
  const option = page.locator("button:has(span:text-is('A'))").first();
  const pick = await deep.isVisible().catch(() => false) ? deep : option;
  if (await pick.isVisible().catch(() => false) && await pick.isEnabled().catch(() => false)) {
    await pick.click().catch(() => {});
    await page.waitForTimeout(1500);
  }
}
const outline = [];
for (let i = 0; i < await titleInputs.count(); i++) outline.push(await titleInputs.nth(i).inputValue());
log(`outline (${outline.length}): ${outline.map((t) => `"${t}"`).join(", ")}`);
await buildButton.click();

// The build screen lists every planned board; wait for all of them to be ready, then read them back.
let sessionId = null;
page.on("response", (res) => {
  const m = res.url().match(/\/api\/progressive-lectures\/([0-9a-f-]{36})(?:\/|\?|$)/);
  if (m) sessionId = m[1];
});
for (let i = 0; i < 120 && !sessionId; i++) await page.waitForTimeout(1000);
if (!sessionId) throw new Error("no progressive session seen");
log(`session ${sessionId}; waiting for every board to be written`);
let snapshot = null;
for (let i = 0; i < 900; i++) {
  await page.waitForTimeout(2000);
  const res = await page.request.get(`${BASE}/api/progressive-lectures/${sessionId}`);
  snapshot = await res.json().catch(() => null);
  const beats = snapshot?.beats ?? [];
  if (snapshot?.complete || (beats.length > 0 && beats.length >= (snapshot?.plannedBeatCount ?? Infinity) && beats.every((b) => b?.script))) break;
}
await page.screenshot({ path: path.join(outDir, "build.png"), fullPage: true });
fs.writeFileSync(path.join(outDir, "session.json"), JSON.stringify(snapshot, null, 2));
await browser.close();

const beats = snapshot?.beats ?? [];
const status = snapshot?.beatStatus ?? [];
log(`boards written: ${beats.length} of ${snapshot?.plannedBeatCount ?? "?"} (status: ${snapshot?.status})`);
const firstSentence = (s) => (s ?? "").split(/(?<=[.!?])\s+/)[0]?.trim() ?? "";
const stems = (t) => new Set((t.toLowerCase().match(/[a-z]{4,}/g) ?? []).map((w) => w.replace(/(?:ing|es|s)$/, "")));
const byConcept = new Map();
beats.forEach((beat, i) => { beat.sequence = beat.sequence ?? i; });
for (const beat of beats) {
  const plan = status.find((s) => s.sequence === beat.sequence) ?? {};
  const concept = beat.conceptId ?? plan.conceptId ?? `beat-${beat.sequence}`;
  byConcept.set(concept, [...(byConcept.get(concept) ?? []), beat]);
}
for (const beat of beats) {
  const title = beat.title ?? "";
  const open = firstSentence(beat.script);
  log(`#${beat.sequence + 1} "${title}" — opens: "${open.slice(0, 110)}"`);
  if (/\b(?:is|are) how\b|\bconverts?$|\bis the$|\bthat$/i.test(title) || /\b(?:is|are)\s+\w+/i.test(title) && title.split(/\s+/).length >= 5) problems.push(`title "${title}" reads as a sentence fragment`);
  if (/^(?:what|why|how)\b/i.test(title) || /\?$/.test(title)) problems.push(`title "${title}" is a question`);
}
for (const [concept, group] of byConcept) {
  if (group.length < 2) continue;
  const first = firstSentence(group[0].script);
  for (const later of group.slice(1)) {
    const a = stems(first); const b = stems(firstSentence(later.script));
    const shared = [...b].filter((w) => a.has(w)).length;
    if (a.size && b.size && shared / Math.min(a.size, b.size) >= 0.6) problems.push(`concept ${concept}: board #${later.sequence + 1} opens like board #${group[0].sequence + 1}`);
  }
}
if (!beats.length) problems.push("no boards were written");
if (problems.length) { console.error(`\n${problems.length} PROBLEM(S):\n  - ${problems.join("\n  - ")}`); process.exit(1); }
console.log("\nTitles are real titles; passes over one concept open differently.");

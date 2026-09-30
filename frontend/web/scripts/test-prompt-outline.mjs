/**
 * TYPED-PROMPT OUTLINES: noun-phrase titles, each topic once, a question in one or two topics.
 *
 * Types each prompt on the front page, answers the planning questions with the first option until
 * the outline appears, and checks its titles. Stops before Build — planning calls only (cents).
 *
 *   node scripts/test-prompt-outline.mjs <email> <password-file> [out-dir]
 */
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";

const BASE = process.env.LAB_URL ?? "http://localhost:3000";
const [email, pwFile, outDir = path.resolve("prompt-outline-out")] = process.argv.slice(2);
fs.mkdirSync(outDir, { recursive: true });
const password = fs.readFileSync(pwFile, "utf8").trim();
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const problems = [];

const CASES = [
  { prompt: "Teach me photosynthesis", question: false },
  { prompt: "Why do leaves look green?", question: true },
  { prompt: "difference between TCP and UDP", question: true },
];

const words = (t) => (t.toLowerCase().match(/[a-z]{4,}/g) ?? []).map((w) => w.replace(/(?:ing|es|s)$/, ""));
const browser = await chromium.launch({ headless: !process.argv.includes("--headed") });
for (const [n, c] of CASES.entries()) {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
  const page = await ctx.newPage();
  const login = await page.request.post(`${BASE}/api/auth/login`, { data: { email, password } });
  if (!login.ok()) throw new Error(`login failed: ${login.status()}`);
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(4000);
  await page.locator("#brief").fill(c.prompt);
  await page.locator("#brief").press("Enter");

  const buildButton = page.getByRole("button", { name: /Build lesson/i }).first();
  const titleInputs = page.locator('input[aria-label^="Topic "][aria-label$=" title"]');
  for (let i = 0; i < 150; i++) {
    await page.waitForTimeout(1000);
    if (await buildButton.isVisible().catch(() => false) && await titleInputs.count() && !(await page.getByText("Planning…").isVisible().catch(() => false))) break;
    const option = page.locator("button:has(span:text-is('A'))").first();
    if (await option.isVisible().catch(() => false) && await option.isEnabled().catch(() => false)) {
      await option.click().catch(() => {});
      await page.waitForTimeout(1500);
    }
  }
  await page.waitForTimeout(2000);
  const titles = [];
  for (let i = 0; i < await titleInputs.count(); i++) titles.push(await titleInputs.nth(i).inputValue());
  await page.screenshot({ path: path.join(outDir, `${n + 1}-outline.png`), fullPage: true });
  log(`"${c.prompt}" → ${titles.length} topic(s): ${titles.map((t) => `"${t}"`).join(", ")}`);

  const fail = (m) => { problems.push(`"${c.prompt}": ${m}`); log(`  FAIL ${m}`); };
  if (!titles.length) fail("no outline appeared");
  for (const t of titles) {
    if (/\?/.test(t)) fail(`"${t}" is a question`);
    if (/^(?:why|how|what|when|where|which|who)\b/i.test(t)) fail(`"${t}" starts like a question`);
    if (/\b(?:explained|overview|introduction|basics)\b/i.test(t)) fail(`"${t}" uses filler`);
    if (t.split(/\s+/).length > 6) fail(`"${t}" is a sentence, not a noun phrase`);
  }
  for (let i = 0; i < titles.length; i++) for (let j = 0; j < i; j++) {
    const a = new Set(words(titles[i])); const b = new Set(words(titles[j]));
    const shared = [...a].filter((w) => b.has(w)).length;
    if (a.size && b.size && shared / Math.min(a.size, b.size) >= 0.8 && Math.min(a.size, b.size) >= 2) fail(`"${titles[i]}" repeats "${titles[j]}"`);
  }
  if (c.question && titles.length > 2) fail(`a question got ${titles.length} topics (max 2)`);
  await ctx.close();
}
await browser.close();
console.log(`\nscreenshots in ${outDir}`);
if (problems.length) { console.error(`\n${problems.length} PROBLEM(S):\n  - ${problems.join("\n  - ")}`); process.exit(1); }
console.log("\nTitles are noun phrases, topics are not repeated, questions stay within two topics.");

/**
 * DOES "USE IT AS A REFERENCE" GET THE TYPED-TOPIC PLANNING CONVERSATION?
 *
 * Drives the real landing page in a browser: upload a PDF, "Use all pages", pick a source mode, and
 * watch what happens next. This is the check the unit tests could not make — they exercised the plan
 * builder with an outline supplied, never the screen that decides whether an outline is asked for.
 *
 *   node scripts/test-reference-planning.mjs <pdf|pptx> <email> <password-file> [out-dir] [--strict] [--headed]
 *        [--subject "camera sensor"] [--expect word,word,...] [--question]
 *
 * Reference (default) asserts:
 *   1. the depth question appears — "How deep do you want to go with …?", the typed flow's first step;
 *   2. the topic it names is the PDF's FIRST-PAGE title, not the typed words;
 *   3. no lecture build started.
 * --strict asserts the opposite: no depth question, the build starts straight away.
 *
 * --subject types words on the front page before attaching, as a student does. With --expect (content
 * words from the document) the script answers the planning questions and reads the OUTLINE: its
 * topics must come from the document, not from the typed words — the "camera sensor" deck bug. With
 * --question the subject is a question, and the outline must be a 1-2 topic answer instead.
 * Costs the PDF parse and the naming/clarify calls — cents. It stops before a lecture is generated.
 */
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const BASE = process.env.LAB_URL ?? "http://localhost:3000";
const args = process.argv.slice(2);
const valueFlags = new Set(["--subject", "--expect"]);
const flagValue = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] ?? "" : ""; };
const positional = args.filter((a, i) => !a.startsWith("--") && !valueFlags.has(args[i - 1]));
const subject = flagValue("--subject");
const expectWords = flagValue("--expect").split(",").map((w) => w.trim().toLowerCase()).filter(Boolean);
const questionRun = args.includes("--question");
const [pdf, email, pwFile, outDir = path.resolve("reference-planning-out")] = positional;
if (!pdf || !email || !pwFile) {
  console.error("usage: node scripts/test-reference-planning.mjs <pdf> <email> <password-file> [out-dir] [--strict]");
  process.exit(2);
}
const strictRun = args.includes("--strict");
fs.mkdirSync(outDir, { recursive: true });
const password = fs.readFileSync(pwFile, "utf8").trim();

const browser = await chromium.launch({ headless: !args.includes("--headed") });
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
const page = await ctx.newPage();
page.on("pageerror", (e) => console.log("  [pageerror]", e.message.slice(0, 160)));
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const problems = [];

const login = await page.request.post(`${BASE}/api/auth/login`, { data: { email, password } });
if (!login.ok()) throw new Error(`login failed: ${login.status()}`);
await page.goto(BASE, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(4000);
// A new account is asked about accessibility once.
if (await page.getByRole("button", { name: /start learning/i }).count()) {
  await page.getByText("None of these", { exact: true }).first().click();
  await page.getByRole("button", { name: /start learning/i }).click();
  await page.waitForTimeout(3000);
}

await page.locator('input[type="file"]').first().setInputFiles(pdf);
if (subject) await askInPicker(page, subject);
else await page.getByRole("button", { name: /use all pages/i }).click({ timeout: 90_000 });
log("pages accepted; waiting for the parse and the source-mode choice");

const choice = strictRun ? /strictly from source|strict/i : /use it as a reference/i;
await page.getByRole("button", { name: choice }).first().click({ timeout: 240_000 });
log(`chose ${strictRun ? "STRICT" : "REFERENCE"}`);

// Whichever comes first: the depth question, or a build starting.
const depth = page.getByText(/How deep do you want to go with/i).first();
const building = page.getByText(/Building from your uploaded|Writing the lecture|building your lecture|Preparing/i).first();
let outcome = "neither";
for (let i = 0; i < 90; i++) {
  await page.waitForTimeout(1000);
  if (await depth.isVisible().catch(() => false)) { outcome = "depth"; break; }
  if (await building.isVisible().catch(() => false)) { outcome = "build"; break; }
}
await page.screenshot({ path: path.join(outDir, `${strictRun ? "strict" : "reference"}.png`) });

const question = outcome === "depth" ? (await depth.innerText()).trim() : "";
const titled = question.replace(/^How deep do you want to go with\s*/i, "").replace(/\?\s*$/, "");
log(`outcome: ${outcome}${question ? ` — "${question}"` : ""}`);

if (strictRun) {
  if (outcome === "depth") problems.push("strict mode asked the depth question — strict must go straight to building");
  if (outcome === "neither") problems.push("strict mode neither built nor asked anything within 90 s");
} else {
  if (outcome !== "depth") problems.push(`reference mode did not start the planning conversation (outcome: ${outcome})`);
  else {
    log(`lecture titled: "${titled}"`);
    fs.writeFileSync(path.join(outDir, "reference-title.txt"), titled);
    if (/^(slides?|pages?)\s*\d+/i.test(titled)) problems.push(`the title "${titled}" is a parser placeholder, not the document's subject`);
    if (!questionRun && /camera|sensor|explain|teach me/i.test(titled)) problems.push(`the title "${titled}" came from typed words, not the document`);
  }
}

// Answer the planning conversation with the first offered option until the outline is ready.
if (!strictRun && outcome === "depth" && (expectWords.length || questionRun)) {
  const buildButton = page.getByRole("button", { name: /Build lesson/i }).first();
  const titleInputs = page.locator('input[aria-label^="Topic "][aria-label$=" title"]');
  for (let i = 0; i < 120; i++) {
    await page.waitForTimeout(1000);
    if (await buildButton.isVisible().catch(() => false) && await titleInputs.count() && !(await page.getByText("Planning…").isVisible().catch(() => false))) break;
    const option = page.locator("button:has(span:text-is('A'))").first();
    if (await option.isVisible().catch(() => false) && await option.isEnabled().catch(() => false)) {
      await option.click().catch(() => {});
      log("answered a planning question with option A");
      await page.waitForTimeout(1500);
    }
  }
  await page.waitForTimeout(2000);
  const titles = [];
  for (let i = 0; i < await titleInputs.count(); i++) titles.push(await titleInputs.nth(i).inputValue());
  await page.screenshot({ path: path.join(outDir, "reference-outline.png"), fullPage: true });
  fs.writeFileSync(path.join(outDir, "reference-outline.txt"), titles.join("\n"));
  log(`outline (${titles.length}): ${titles.map((t) => `"${t}"`).join(", ")}`);
  if (!titles.length) problems.push("no outline appeared after answering the planning questions");
  else if (questionRun) {
    if (titles.length > 2) problems.push(`a question got a ${titles.length}-topic outline; it should be a 1-2 topic answer`);
  } else {
    const typed = subject.toLowerCase().split(/\s+/).filter((w) => w.length > 3);
    const fromTyped = titles.filter((t) => typed.some((w) => t.toLowerCase().includes(w)));
    if (fromTyped.length) problems.push(`outline topics came from the typed words "${subject}": ${fromTyped.join(" | ")}`);
    const fromDoc = titles.filter((t) => expectWords.some((w) => t.toLowerCase().includes(w)));
    if (fromDoc.length * 2 < titles.length) problems.push(`only ${fromDoc.length}/${titles.length} outline topics name the document's content (${expectWords.join(", ")})`);
  }
}
await browser.close();

console.log(`screenshots in ${outDir}`);
if (problems.length) {
  console.error("\nPROBLEMS:");
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
console.log(strictRun ? "\nStrict goes straight to building, as before." : "\nReference mode plans like a typed topic, titled from the PDF's first page.");

/** The uploader is separate from the prompt box: a question about the document is asked in the page picker. */
async function askInPicker(page, question) {
  const box = page.locator("#page-prompt");
  await box.waitFor({ timeout: 180_000 });
  await box.fill(question);
  const ask = page.locator("button[data-ask-question]");
  if (await ask.isEnabled().catch(() => false)) await ask.click();
  else await box.press("Enter");
}

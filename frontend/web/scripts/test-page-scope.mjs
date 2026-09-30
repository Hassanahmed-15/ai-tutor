/**
 * WHICH PAGES A LECTURE USES, AND WHAT THE CHAT SEES — through the real upload screen.
 *
 *   node scripts/test-page-scope.mjs <pdf> <pptx> <email> <password-file> [out-dir] [--long-deck <21-slide.pptx>]
 *
 * Rules checked (each run stops at the Strict/Reference choice — no lecture is generated):
 *   1. a question typed on the front page skips the page picker and reads every page;
 *   2. a question typed in the picker reads every page, even with a page ticked ("Use all pages");
 *   3. a ticked page with no question reads only that page — but the chat's text has every page;
 *   4. a deck with slides ticked is built from those slides only — the chat's text has every slide;
 *   5. no box can be drawn on a page, and no "Get a lecture from this area" button exists;
 *   6. (--long-deck) a deck over 20 slides is refused with the limit message.
 * Costs one or two parses per case (cents).
 */
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";

const BASE = process.env.LAB_URL ?? "http://localhost:3000";
const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : ""; };
const positional = args.filter((a, i) => !a.startsWith("--") && args[i - 1] !== "--long-deck");
const [pdf, pptx, email, pwFile, outDir = path.resolve("page-scope-out")] = positional;
const longDeck = flag("--long-deck");
fs.mkdirSync(outDir, { recursive: true });
const password = fs.readFileSync(pwFile, "utf8").trim();
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const problems = [];
const check = (ok, message) => { log(`${ok ? "PASS" : "FAIL"}  ${message}`); if (!ok) problems.push(message); };

const browser = await chromium.launch({ headless: !args.includes("--headed") });

/** A fresh signed-in page that records every parse response. */
async function session() {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
  const page = await ctx.newPage();
  const login = await page.request.post(`${BASE}/api/auth/login`, { data: { email, password } });
  if (!login.ok()) throw new Error(`login failed: ${login.status()}`);
  const parses = [];
  page.on("request", (req) => {
    if (!/\/api\/parse-(pdf|pptx)/.test(req.url()) || req.method() !== "POST") return;
    // The request body (multipart, with the file) cannot be read back; the response is the evidence.
    parses.push({ url: req.url(), response: null });
  });
  page.on("response", async (res) => {
    if (!/\/api\/parse-(pdf|pptx)/.test(res.url()) || res.request().method() !== "POST") return;
    const entry = [...parses].reverse().find((p) => p.response === null);
    try { if (entry) entry.response = await res.json(); } catch { /* not JSON */ }
  });
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(4000);
  return { ctx, page, parses };
}

// AblationStudy_V3.pdf has 7 pages.
const ALL_PDF_PAGES = [1, 2, 3, 4, 5, 6, 7];
const sourceMode = (page) => page.getByRole("button", { name: /use it as a reference/i }).first();
const pagesOf = (resp) => [...new Set((resp?.sourceDocument?.contentBlocks ?? []).map((b) => b.pageNumber))].sort((a, b) => a - b);
const labelsIn = (text, unit) => [...new Set([...String(text ?? "").matchAll(new RegExp(`\\[${unit} (\\d+)\\]`, "g"))].map((m) => Number(m[1])))].sort((a, b) => a - b);
async function waitForParse(parses) {
  for (let i = 0; i < 240 && !(parses.at(-1)?.response); i++) await new Promise((r) => setTimeout(r, 500));
  return parses.at(-1);
}

// ── 1. Front-page question: the picker is skipped and every page is read.
{
  const { ctx, page, parses } = await session();
  await page.locator("#brief").fill("Why does SMOTE help the minority class?");
  await page.locator('input[type="file"]').first().setInputFiles(pdf);
  let pickerClicked = false;
  await sourceMode(page).waitFor({ timeout: 240_000 });
  const parse = await waitForParse(parses);
  await page.screenshot({ path: path.join(outDir, "1-front-question.png") });
  check(!pickerClicked && parses.length === 1, "1. front-page question: reached the Strict/Reference choice without pressing anything in the page picker");
  check(JSON.stringify(pagesOf(parse?.response)) === JSON.stringify(ALL_PDF_PAGES), `1. front-page question: the lecture's document holds every page (${pagesOf(parse?.response).join(",")})`);
  await ctx.close();
}

// ── 2. Picker question with page 2 ticked: "Use all pages", every page read.
{
  const { ctx, page, parses } = await session();
  await page.locator('input[type="file"]').first().setInputFiles(pdf);
  await page.getByRole("button", { name: /^Select page \d/ }).nth(1).click({ timeout: 120_000 });
  await page.locator("#page-prompt").fill("How do the correction strategies compare?");
  const use = page.getByRole("button", { name: /^Use / }).first();
  const label = (await use.innerText()).trim();
  check(/Use all pages/i.test(label), `2. picker question + page 2 ticked: button reads "${label}"`);
  await use.click();
  await sourceMode(page).waitFor({ timeout: 240_000 });
  const parse = await waitForParse(parses);
  check(JSON.stringify(pagesOf(parse?.response)) === JSON.stringify(ALL_PDF_PAGES), `2. picker question: the lecture's document holds every page (${pagesOf(parse?.response).join(",")}), not just ticked page 2`);
  // ── 5. No box-drawing on the page previews.
  check(await page.locator("img[data-page-area-image], [data-use-region]").count() === 0, "5. no box-drawing image or \"Get a lecture from this area\" button on the page (checked after the parse)");
  await ctx.close();
}

// ── 3. Page 2 ticked, no question: only page 2 for the lecture; the chat text has every page.
{
  const { ctx, page, parses } = await session();
  await page.locator('input[type="file"]').first().setInputFiles(pdf);
  await page.getByRole("button", { name: /^Select page \d/ }).nth(1).click({ timeout: 120_000 });
  check(await page.locator("img[data-page-area-image], [data-use-region]").count() === 0, "5. page picker shows plain page images: no box can be drawn");
  await page.screenshot({ path: path.join(outDir, "3-picker.png") });
  const use = page.getByRole("button", { name: /^Use / }).first();
  check(/Use 1 page/i.test((await use.innerText()).trim()), `3. page 2 ticked, no question: button reads "${(await use.innerText()).trim()}"`);
  await use.click();
  await sourceMode(page).waitFor({ timeout: 240_000 });
  const parse = await waitForParse(parses);
  check(JSON.stringify(pagesOf(parse?.response)) === "[2]", `3. the lecture's document holds page(s) ${pagesOf(parse?.response).join(",")}`);
  const chatPages = labelsIn(parse?.response?.fullDocumentText, "page");
  check(chatPages.length > 2 && chatPages.includes(1), `3. the chat's text covers page(s) ${chatPages.join(",")}`);
  await ctx.close();
}

// ── 4. Deck: slides 2-3 ticked → lecture from those slides; chat text has every slide.
{
  const { ctx, page, parses } = await session();
  await page.locator('input[type="file"]').first().setInputFiles(pptx);
  const select = page.getByRole("button", { name: /^Select slide \d/ });
  await select.nth(1).click({ timeout: 120_000 });
  await page.getByRole("button", { name: /^Select slide \d/ }).nth(1).click();
  await page.screenshot({ path: path.join(outDir, "4-deck-picker.png") });
  await page.getByRole("button", { name: /^Use / }).first().click();
  await sourceMode(page).waitFor({ timeout: 240_000 });
  const parse = await waitForParse(parses);
  const lecture = pagesOf(parse?.response);
  const chat = labelsIn(parse?.response?.fullDocumentText, "slide");
  check(JSON.stringify(lecture) === "[2,3]", `4. deck: the lecture's document holds slide(s) ${lecture.join(",")}`);
  check(JSON.stringify(chat) === "[1,2,3,4,5]", `4. deck: the chat's text covers slide(s) ${chat.join(",")}`);
  await ctx.close();
}

// ── 6. A deck over the limit is refused with the limit message.
if (longDeck) {
  const { ctx, page } = await session();
  await page.locator('input[type="file"]').first().setInputFiles(longDeck);
  const message = page.getByText(/up to 20 can be taught at once/i).first();
  await message.waitFor({ timeout: 120_000 }).catch(() => {});
  const shown = await message.isVisible().catch(() => false);
  await page.screenshot({ path: path.join(outDir, "6-long-deck.png") });
  check(shown, `6. a 21-slide deck shows the limit message${shown ? `: "${(await message.innerText()).slice(0, 90)}…"` : ""}`);
  await ctx.close();
}

await browser.close();
console.log(`\nscreenshots in ${outDir}`);
if (problems.length) {
  console.error(`\n${problems.length} PROBLEM(S):\n  - ${problems.join("\n  - ")}`);
  process.exit(1);
}
console.log("\nAll page-scope rules hold.");

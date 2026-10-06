/**
 * Drives the REAL app end to end for one PDF, as a student does, and records what they see.
 * Needs `npm run dev` running and a signed-up account.
 *
 *   AUDIT_EMAIL=you@example.com node scripts/audit-pdf-e2e.mjs <pdf> <pages e.g. 3,4> <out-prefix> <password-file>
 *
 * Upload -> pick pages -> strict source -> wait for the player -> Play -> watch part 1 for 80 s.
 * Writes <out-prefix>.json (page errors, console errors, part titles, and a sample every 4 s of the
 * board's visible steps, the source box, the arrow and the figure panel) and three screenshots.
 * Every PDF claim in this project should be made from one of these runs, on several kinds of PDF.
 */
import { chromium } from "playwright";
import fs from "node:fs";

const [pdfPath, pagesArg, outPrefix, pwFile] = process.argv.slice(2);
const wantPages = pagesArg.split(",").map(Number); // 1-based
const pw = fs.readFileSync(pwFile, "utf8").trim();
const report = { pdf: pdfPath, pages: wantPages, steps: [], errors: [], consoleErrors: [], samples: [], titles: [], shots: [] };
const step = (s) => { report.steps.push(`${new Date().toISOString().slice(11, 19)} ${s}`); console.log(s); };

const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
const ctx = await browser.newContext({ viewport: { width: 1600, height: 950 } });
const page = await ctx.newPage();
page.on("pageerror", (e) => report.errors.push(e.message.slice(0, 300)));
page.on("console", (m) => { if (m.type() === "error") report.consoleErrors.push(m.text().slice(0, 300)); });
try {
  await ctx.request.post("http://localhost:3000/api/auth/login", { data: { email: process.env.AUDIT_EMAIL ?? "pdf-audit@aria-test.local", password: pw } });
  await page.goto("http://localhost:3000/", { waitUntil: "domcontentloaded" });
  await page.locator("input[type=file]").first().waitFor({ state: "attached", timeout: 60000 });
  await page.locator("input[type=file]").first().setInputFiles(pdfPath);
  step("uploaded");
  const selectButtons = page.locator("button").filter({ hasText: "Select page" });
  await selectButtons.first().waitFor({ timeout: 120000 });
  const total = await selectButtons.count();
  step(`page picker shows ${total} pages`);
  // Descending, so earlier indices do not shift as buttons change label.
  // The picker renders pages lazily: scroll until the page's own "Page N" label exists, then press
  // the Select button in that label's row.
  await page.mouse.move(750, 500);
  for (const p of [...wantPages].sort((a, b) => a - b)) {
    const label = page.getByText(`Page ${p}`, { exact: true });
    for (let k = 0; k < 300 && !(await label.count()); k++) {
      await page.mouse.wheel(0, 1200);
      await page.waitForTimeout(200);
    }
    await label.first().scrollIntoViewIfNeeded();
    await label.first().locator("xpath=..").locator("button").filter({ hasText: "Select page" }).first().click();
    await page.waitForTimeout(300);
  }
  const use = page.locator("button").filter({ hasText: /^Use / }).first();
  step(`clicking "${await use.innerText()}"`);
  await use.click();
  await page.locator("button").filter({ hasText: "strict source" }).first().click({ timeout: 180000 });
  step("chose strict");
  const t0 = Date.now();
  // Wait for the player (Part 1 of N), clicking through anything that asks to start.
  while (Date.now() - t0 < 420000) {
    if (await page.getByText(/Part 1 of \d+/).count()) break;
    const error = await page.locator("text=/couldn.t|failed|error|Nothing could be read/i").first().textContent({ timeout: 500 }).catch(() => null);
    if (error && /couldn.t|failed|Nothing could be read/i.test(error)) { report.errors.push(`UI: ${error.slice(0, 200)}`); }
    await page.waitForTimeout(3000);
  }
  if (!(await page.getByText(/Part 1 of \d+/).count())) throw new Error("the lecture never reached the player");
  step(`player reached after ${Math.round((Date.now() - t0) / 1000)} s`);
  // Headless Chromium has no user gesture for audio, so the player waits on Play exactly as a
  // browser that blocked autoplay would. Press it, as the student does.
  const play = page.locator("button").filter({ hasText: /^\s*Play\s*$/ }).first();
  if (await play.count()) { await play.click(); step("pressed Play"); }
  const t1 = Date.now();
  for (let i = 0; Date.now() - t1 < 80000; i++) {
    const sample = await page.evaluate(() => {
      const text = document.body.innerText;
      return {
        part: text.match(/Part \d+ of \d+/)?.[0] ?? null,
        speaking: /Aria is speak/i.test(text),
        figurePanel: /From your source/.test(text),
        teachingHere: /Aria is teaching here/.test(text),
        sourceBox: document.querySelectorAll("[data-source-highlight][style*='left']").length,
        arrow: Boolean(document.querySelector("svg path[stroke-dasharray], svg line[stroke-dasharray]")),
        unavailable: /Board unavailable|Source preview unavailable|could not/i.test(text) ? text.match(/(Board unavailable|Source preview unavailable)[^\n]*/)?.[0] ?? "some unavailable text" : null,
      };
    });
    let board = null;
    for (const frame of page.frames()) {
      if (frame === page.mainFrame()) continue;
      const r = await frame.evaluate(() => {
        const steps = [...document.querySelectorAll("[data-teach-order]")];
        if (!steps.length) return null;
        const visible = steps.filter((el) => Number(getComputedStyle(el).opacity) > 0.05 && getComputedStyle(el).display !== "none");
        return { visible: visible.length, total: steps.length };
      }).catch(() => null);
      if (r) board = r;
    }
    report.samples.push({ t: Math.round((Date.now() - t1) / 1000), ...sample, board });
    if (i === 2 || i === 9 || i === 18) {
      const shot = `${outPrefix}-${i}.png`;
      await page.screenshot({ path: shot });
      report.shots.push(shot);
    }
    await page.waitForTimeout(4000);
  }
  report.titles = await page.evaluate(() => [...new Set((document.body.innerText.match(/Part \d+ of \d+\s*\n?\s*[^\n]+/g) ?? []).map((s) => s.replace(/\s+/g, " ")))]);
} catch (error) {
  report.errors.push(`SCRIPT: ${error instanceof Error ? error.message.split("\n")[0] : String(error)}`);
  await page.screenshot({ path: `${outPrefix}-fail.png` }).catch(() => {});
  report.shots.push(`${outPrefix}-fail.png`);
}
fs.writeFileSync(`${outPrefix}.json`, JSON.stringify(report, null, 2));
await browser.close();

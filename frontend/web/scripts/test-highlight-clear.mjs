/**
 * DOES CLOSING THE MARKUP TOOLS CLEAR THE HIGHLIGHT — AND ONLY THEN?
 *
 * Drives the real player on /player-preview (dev-only, seeded lecture, no sign-in).
 *
 *   node scripts/test-highlight-clear.mjs [out-dir] [--headed]
 *
 * Marks are painted on a <canvas>, so the test counts inked pixels across the page's canvases:
 *   1. drawing a highlight adds ink;
 *   2. toggling the highlighter OFF inside the popover keeps it — the student has not asked yet;
 *   3. the dock's X removes it.
 */
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const BASE = process.env.LAB_URL ?? "http://localhost:3000";
const ROOT = path.resolve(import.meta.dirname, "..");
const args = process.argv.slice(2);
const [outDir = path.join(ROOT, "highlight-clear-out")] = args.filter((a) => !a.startsWith("--"));
fs.mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({ headless: !args.includes("--headed") });
const page = await (await browser.newContext({ viewport: { width: 1500, height: 940 } })).newPage();
page.on("pageerror", (e) => console.log("  [pageerror]", e.message.slice(0, 160)));
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

/** Inked pixels on the annotation canvas — the one marked aria-hidden inside the board. */
const ink = () =>
  page.evaluate(() => {
    let total = 0;
    for (const canvas of document.querySelectorAll('canvas[aria-hidden="true"]')) {
      const ctx = canvas.getContext("2d");
      if (!ctx || !canvas.width || !canvas.height) continue;
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      for (let i = 3; i < data.length; i += 4) if (data[i] > 0) total++;
    }
    return total;
  });

await page.goto(`${BASE}/player-preview`, { waitUntil: "domcontentloaded" });
const markup = page.getByRole("button", { name: /mark up the board/i });
await markup.waitFor({ state: "visible", timeout: 90_000 });
await page.waitForTimeout(1500);

const blank = await ink();
await markup.click();
await page.getByRole("button", { name: "Highlighter" }).click();

// Drag across the middle of the board.
const board = await page.locator("section").first().boundingBox();
const y = board.y + board.height * 0.45;
await page.mouse.move(board.x + board.width * 0.25, y);
await page.mouse.down();
for (let i = 1; i <= 20; i++) await page.mouse.move(board.x + board.width * (0.25 + i * 0.02), y);
await page.mouse.up();
await page.waitForTimeout(500);
const drawn = await ink();
await page.screenshot({ path: path.join(outDir, "1-highlighted.png") });

// Turn the highlighter off INSIDE the popover — what a student does before asking.
await page.getByRole("button", { name: "Highlighter" }).click();
await page.waitForTimeout(400);
const toggledOff = await ink();

// Now close the tools with the X.
await page.getByRole("button", { name: /marking up|mark up the board/i }).click();
await page.waitForTimeout(500);
const closed = await ink();
await page.screenshot({ path: path.join(outDir, "2-closed.png") });
await browser.close();

log(`inked pixels: blank ${blank} -> highlighted ${drawn} -> toggled off ${toggledOff} -> closed ${closed}`);
const problems = [];
if (drawn <= blank) problems.push("the highlight never appeared, so the test could not run");
if (toggledOff < drawn) problems.push("turning the highlighter off inside the popover removed the mark — too early, the student had not asked yet");
if (closed > blank) problems.push("the highlight is still on the board after the X");
console.log(`screenshots in ${outDir}`);
if (problems.length) {
  console.error("\nPROBLEMS:");
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
console.log("\nThe highlight stays while it is being asked about, and the X clears it.");

/**
 * Screenshots the teaching board. Needs `npm run dev`.
 *   node scripts/shoot-board.mjs <out-dir>
 *
 * Every claim in this redesign is a claim about what a person sees — that controls never cover the
 * teaching content, that the states are legible, that a first-time user can tell what is clickable.
 * A typecheck cannot see any of that.
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const BASE = process.env.LAB_URL ?? "http://localhost:3000";
const [outDir = "/tmp/board-shots"] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch();
const results = [];

for (const vp of [
  { name: "desktop", width: 1600, height: 900 },
  { name: "laptop", width: 1280, height: 720 },
  { name: "small-laptop", width: 1180, height: 700 },
]) {
  const page = await browser.newPage({ viewport: { width: vp.width, height: vp.height } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`${BASE}/board-preview`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForTimeout(1500);

  // Does any control sit ON TOP of the board content? That is the core layout claim.
  const geom = await page.evaluate(() => {
    const board = document.querySelector('[aria-label="Teaching board"]');
    const dock = document.querySelector('[aria-label="Pause the lecture"], [aria-label="Play the lecture"]')?.closest("div");
    if (!board || !dock) return null;
    const b = board.getBoundingClientRect();
    const d = dock.getBoundingClientRect();
    return {
      boardArea: Math.round((b.width * b.height) / (window.innerWidth * window.innerHeight) * 100),
      dockOverlapsBoard: d.top < b.bottom - 1,
      overflow: document.body.scrollWidth > window.innerWidth + 1,
    };
  });

  await page.screenshot({ path: `${outDir}/board-${vp.name}.png` });
  results.push({ viewport: vp.name, ...geom, errors: errors.slice(0, 2) });
  await page.close();
}

// The states, at one size.
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
await page.goto(`${BASE}/board-preview`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(1200);
for (const state of ["generating", "paused", "error"]) {
  await page.getByRole("button", { name: state, exact: true }).click();
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${outDir}/state-${state}.png` });
}
// The markup tools, open.
await page.getByRole("button", { name: "ready", exact: true }).click();
await page.getByRole("button", { name: "Mark up the board" }).click();
await page.waitForTimeout(400);
await page.screenshot({ path: `${outDir}/tools-open.png` });
await browser.close();

for (const r of results) console.log(JSON.stringify(r));
const bad = results.filter((r) => !r || r.dockOverlapsBoard || r.overflow || r.errors.length);
console.log(bad.length ? `FAIL (${bad.length})` : "PASS: controls never cover the board, no overflow, no errors");
process.exit(bad.length ? 1 : 0);

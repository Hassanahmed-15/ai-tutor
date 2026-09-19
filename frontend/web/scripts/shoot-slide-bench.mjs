/**
 * Screenshots the slide bench. Needs `npm run dev` running.
 *   node scripts/shoot-slide-bench.mjs <out-dir>
 *
 * The bench's central claim is that six generated boards can be compared side by side while
 * moving. Only a picture can check that the grid actually lays out, that the live sandboxes mount,
 * and that the metrics line up under each board.
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const BASE = process.env.LAB_URL ?? "http://localhost:3000";
const [outDir = "/tmp/bench-shots"] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 1200 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => { if (m.type() === "error") errors.push(`console: ${m.text().slice(0, 140)}`); });

await page.goto(`${BASE}/slide-bench`, { waitUntil: "domcontentloaded", timeout: 60_000 });
await page.waitForTimeout(9_000);

const shot = `${outDir}/slide-bench.png`;
await page.screenshot({ path: shot, fullPage: false });

const metrics = await page.evaluate(() => ({
  cards: document.querySelectorAll("article").length,
  iframes: document.querySelectorAll("article iframe").length,
  overflow: document.body.scrollWidth > window.innerWidth + 1,
  text: (document.body.innerText || "").replace(/\s+/g, " ").slice(0, 300),
}));

await browser.close();
console.log(JSON.stringify({ shot, ...metrics, errors: errors.slice(0, 4) }, null, 2));
process.exit(metrics.cards >= 6 && !metrics.overflow ? 0 : 1);

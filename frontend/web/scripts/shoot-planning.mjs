/**
 * Screenshots the pre-lecture planning screen. Needs `npm run dev` running.
 *
 *   node scripts/shoot-planning.mjs <out-dir> [topic]
 *
 * The planning layout is a claim about what fits on a screen at once — that the profile, the
 * teaching angle and the lesson structure can all be taken in without scrolling, and that the
 * conversation with Aria is reachable without a second column. A type check cannot see any of
 * that, and neither can a passing build. Only a picture can, which is the same reason
 * shoot-sandbox.mjs exists.
 *
 * Shoots three widths, because the failure this is guarding against is specifically a layout one:
 * a three-column dashboard that silently stacks back into the tall strip it replaced, and a docked
 * composer that covers the approve button on a short screen.
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const BASE = process.env.LAB_URL ?? "http://localhost:3000";
const [outDir = "/tmp/planning-shots", topic = "how a neural network learns"] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });

const VIEWPORTS = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "laptop", width: 1180, height: 720 },
  { name: "phone", width: 390, height: 844 },
];

const browser = await chromium.launch();
const results = [];

for (const vp of VIEWPORTS) {
  const page = await browser.newPage({ viewport: { width: vp.width, height: vp.height } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(`console: ${m.text().slice(0, 160)}`);
  });

  try {
    await page.goto(`${BASE}/?topic=${encodeURIComponent(topic)}`, { waitUntil: "domcontentloaded", timeout: 45_000 });
    // The planning screen is reached by asking for a lesson; wait for whatever settles.
    await page.waitForTimeout(6_000);
    const shot = `${outDir}/planning-${vp.name}.png`;
    await page.screenshot({ path: shot, fullPage: false });

    /*
     * The structural assertions. `document.body.scrollWidth` beyond the viewport means something
     * is forcing a horizontal scrollbar, which on a phone is the difference between a usable page
     * and a broken one.
     */
    const metrics = await page.evaluate(() => ({
      scrollWidth: document.body.scrollWidth,
      innerWidth: window.innerWidth,
      // The side rail that was removed: a 360px fixed column should no longer exist anywhere.
      hasLegacyRail: Boolean(document.querySelector('[class*="360px"]')),
      text: (document.body.innerText || "").slice(0, 400),
    }));

    results.push({
      viewport: vp.name,
      shot,
      overflowsHorizontally: metrics.scrollWidth > metrics.innerWidth + 1,
      hasLegacyRail: metrics.hasLegacyRail,
      errors: errors.slice(0, 3),
      preview: metrics.text.replace(/\s+/g, " ").slice(0, 120),
    });
  } catch (error) {
    results.push({ viewport: vp.name, error: String(error).slice(0, 200) });
  }
  await page.close();
}

await browser.close();
for (const r of results) console.log(JSON.stringify(r));
const bad = results.filter((r) => r.error || r.overflowsHorizontally || r.hasLegacyRail || (r.errors?.length ?? 0) > 0);
console.log(bad.length ? `FAIL (${bad.length}/${results.length})` : `PASS (${results.length} viewports)`);
process.exit(bad.length ? 1 : 0);

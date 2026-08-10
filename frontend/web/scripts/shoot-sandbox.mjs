/**
 * Screenshots generated sandbox boards. Needs `npm run dev` running.
 *
 *   node scripts/shoot-sandbox.mjs <out-dir> <tag> [topic ...]
 *
 * Every sandbox quality claim in this project has to be made from a picture. The measured history
 * is unambiguous: the deterministic checks passed on boards that were three grey ellipses, and the
 * vision critic once reported 5/5 while its rasteriser was returning null. Looking is the only
 * check that has never lied.
 */
import { chromium } from "playwright";

const BASE = process.env.LAB_URL ?? "http://localhost:3000";
const [outDir, tag, ...topicArgs] = process.argv.slice(2);
const TOPICS = topicArgs.length ? topicArgs : ["respiration", "airways", "neuron", "heart", "volcano"];

const browser = await chromium.launch();
const results = [];

for (const topic of TOPICS) {
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));

  await page.goto(`${BASE}/sandbox-lab?topic=${topic}&p=1&auto=1`, { waitUntil: "domcontentloaded" });

  // Generation is a real model call behind a critic loop; give it room but never hang forever.
  let ok = true;
  try {
    await page.waitForSelector("[data-stage] iframe", { timeout: 300_000 });
  } catch {
    ok = false;
  }
  // The board draws inside an iframe; let its own mount and the reveal settle.
  await page.waitForTimeout(4_000);

  const stage = await page.locator("[data-stage]");
  await stage.screenshot({ path: `${outDir}/${tag}-${topic}.png` });

  const meta = await page.locator("[data-meta]").textContent().catch(() => null);
  let score = null;
  let status = null;
  if (meta) {
    try {
      const parsed = JSON.parse(meta);
      score = parsed?.critique?.score ?? null;
      status = parsed?.status ?? null;
    } catch { /* meta is advisory only */ }
  }

  results.push({ topic, ok, score, status, errors: errors.length });
  console.log(`${ok ? "drew" : "FAILED"}  ${topic.padEnd(12)} score=${score ?? "-"} status=${status ?? "-"} pageerrors=${errors.length}`);
  await page.close();
}

await browser.close();
const scored = results.filter((r) => typeof r.score === "number");
if (scored.length) {
  console.log(`\nmean critic score ${(scored.reduce((s, r) => s + r.score, 0) / scored.length).toFixed(2)}/5 across ${scored.length}`);
}

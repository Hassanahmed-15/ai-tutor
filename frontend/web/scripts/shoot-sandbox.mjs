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

  // Where did every rendered label actually land? x=440..740 is the drawing band.
  //
  // Queried through a FRAME handle, not the parent document: the board renders in a srcDoc iframe
  // and `iframe.contentDocument` is not reachable from page.evaluate, which silently returned null
  // and reported "?" for every board — a check that cannot see is indistinguishable from a pass.
  const boardFrame = page.frames().find((f) => f !== page.mainFrame());
  const strayText = boardFrame
    ? await boardFrame.evaluate(() => {
        const svg = document.querySelector("svg");
        if (!svg) return null;
        const box = svg.getBoundingClientRect();
        const scale = box.width ? 1000 / box.width : 1;
        return [...svg.querySelectorAll("text")]
          .filter((t) => (t.textContent ?? "").trim().length > 2)
          .map((t) => {
            const r = t.getBoundingClientRect();
            return { text: t.textContent.trim().slice(0, 24), x: Math.round((r.left - box.left) * scale) };
          })
          .filter((t) => t.x > 440 && t.x < 740);
      }).catch(() => null)
    : null;

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

  results.push({ topic, ok, score, status, errors: errors.length, stray: strayText?.length ?? 0 });
  console.log(`${ok ? "drew" : "FAILED"}  ${topic.padEnd(12)} score=${score ?? "-"} status=${status ?? "-"} pageerrors=${errors.length} textOnDrawing=${strayText?.length ?? "?"}`);
  if (strayText?.length) console.log("        on the drawing: " + strayText.map((t) => `"${t.text}"@x${t.x}`).join(", "));
  await page.close();
}

await browser.close();
const scored = results.filter((r) => typeof r.score === "number");
if (scored.length) {
  console.log(`\nmean critic score ${(scored.reduce((s, r) => s + r.score, 0) / scored.length).toFixed(2)}/5 across ${scored.length}`);
}


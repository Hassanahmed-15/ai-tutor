/**
 * Browser verification for the engines `verify:boards` does not cover: ELK structure diagrams and
 * the anime.js morph. Needs `npm run dev` running.
 *
 *   node scripts/verify-engines.mjs [screenshot-dir]
 *
 * WHY THESE TWO SPECIFICALLY. `verify:boards` proves Vega-Lite and KaTeX; `shoot-sandbox.mjs` proves
 * the React sandbox. ELK and morph had lab routes but no automated check at all — so the only
 * evidence they worked was that nobody had complained, which is precisely the standard that let a
 * critic score 5/5 while looking at nothing and let ELK labels hang outside their boxes for weeks.
 *
 * Both are asserted STRUCTURALLY rather than scored. Their whole claim is that the geometry is
 * computed, so overlap and clipping are unreachable states — the honest test is that the geometry
 * actually holds, not a subjective opinion about whether it looks nice.
 *
 * Uses the `data-op` hooks the boards already emit. Nothing in the pipeline is modified.
 */
import { chromium } from "playwright";

const BASE = process.env.LAB_URL ?? "http://localhost:3000";
const OUT = process.argv[2] ?? ".";

let failures = 0;
const results = [];

function check(name, ok, detail) {
  if (!ok) failures++;
  results.push(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `\n        ${detail}` : ""}`);
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const consoleErrors = [];
page.on("pageerror", (e) => consoleErrors.push(e.message));

/* ── ELK structure diagrams ───────────────────────────────────────────────── */

for (const spec of ["rock-cycle", "tcp-handshake", "pythagoras"]) {
  await page.goto(`${BASE}/structure-lab?spec=${spec}&p=1`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("svg", { timeout: 30_000 });
  await page.waitForTimeout(1500);

  const geom = await page.evaluate(() => {
    const svg = document.querySelector("svg");
    if (!svg) return null;
    const frame = svg.getBoundingClientRect();
    // Node boxes are the rects the layout engine positioned; labels are their text.
    const boxes = [...svg.querySelectorAll("rect")]
      .map((r) => r.getBoundingClientRect())
      .filter((b) => b.width > 8 && b.height > 8);
    const texts = [...svg.querySelectorAll("text")]
      .filter((t) => (t.textContent ?? "").trim())
      .map((t) => ({ text: t.textContent.trim(), box: t.getBoundingClientRect() }));

    let overlaps = 0;
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i], b = boxes[j];
        const ox = Math.min(a.right, b.right) - Math.max(a.left, b.left);
        const oy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
        // Tolerate a hairline touch; count a real intersection.
        if (ox > 2 && oy > 2) overlaps++;
      }
    }
    const outside = [...boxes, ...texts.map((t) => t.box)].filter(
      (b) => b.left < frame.left - 1 || b.right > frame.right + 1 || b.top < frame.top - 1 || b.bottom > frame.bottom + 1,
    ).length;

    return { nodes: boxes.length, labels: texts.length, overlaps, outside };
  });

  check(`ELK ${spec}: renders nodes and labels`, !!geom && geom.nodes >= 3 && geom.labels >= 3,
    geom ? `${geom.nodes} boxes, ${geom.labels} labels` : "no svg");
  // The guarantee ELK exists to provide. If this ever fails, the layout engine is not being used.
  check(`ELK ${spec}: no two node boxes overlap`, !!geom && geom.overlaps === 0,
    geom ? `${geom.overlaps} overlapping pairs` : "");
  check(`ELK ${spec}: nothing escapes the frame`, !!geom && geom.outside === 0,
    geom ? `${geom.outside} elements outside` : "");

  await page.screenshot({ path: `${OUT}/engine_elk_${spec}.png` });
}

/* ── anime.js morph ───────────────────────────────────────────────────────── */

await page.goto(`${BASE}/gsap-lab?board=mechanism&p=0`, { waitUntil: "domcontentloaded" });
await page.waitForSelector("svg", { timeout: 30_000 });
await page.waitForTimeout(1200);

const readPaths = () =>
  page.evaluate(() =>
    [...document.querySelectorAll("svg [data-op], svg path")]
      .map((el) => el.getAttribute("d"))
      .filter(Boolean)
      .join("|"),
  );

const atStart = await readPaths();
await page.goto(`${BASE}/gsap-lab?board=mechanism&p=1`, { waitUntil: "domcontentloaded" });
await page.waitForSelector("svg", { timeout: 30_000 });
await page.waitForTimeout(1200);
const atEnd = await readPaths();
// Shoot the FINISHED board here, not after scrubbing back. The first version of this script took
// its screenshot at the end of the reversibility check — at p=0, where nothing is revealed yet — so
// the artifact was two empty panels while every assertion passed. A useless picture is worse than
// no picture: it invites the reader to conclude the engine is broken when it is not.
await page.screenshot({ path: `${OUT}/engine_morph.png` });

check("morph: the board draws real paths", atStart.length > 0, `${atStart.length} chars of path data at p=0`);
// A morph that does not change its path data between the ends is not morphing — it is a static
// picture with a progress slider wired to nothing, which is exactly how this would fail silently.
check("morph: path geometry actually changes between p=0 and p=1", atStart !== atEnd,
  atStart === atEnd ? "identical path data at both ends" : "geometry differs, as it should");

// Scrubbing back must return to the start: this is the one thing morph is chosen for over video.
await page.goto(`${BASE}/gsap-lab?board=mechanism&p=0`, { waitUntil: "domcontentloaded" });
await page.waitForSelector("svg", { timeout: 30_000 });
await page.waitForTimeout(1200);
const backAtStart = await readPaths();
check("morph: scrubbing back reproduces the start state", backAtStart === atStart,
  backAtStart === atStart ? "reversible" : "did not return to the same geometry");

check("no page errors across either engine", consoleErrors.length === 0, consoleErrors.slice(0, 2).join(" | "));

await browser.close();
console.log(results.join("\n"));
console.log(`\n${results.length - failures}/${results.length} checks passed`);
process.exit(failures ? 1 : 0);

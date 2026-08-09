/**
 * Browser verification for the two spec-driven boards. Needs `npm run dev` already running.
 *
 *   node scripts/verify-spec-boards.mjs [screenshot-dir]
 *
 * WHY THIS EXISTS SEPARATELY FROM THE UNIT TESTS. `npm run test:anim` proves a spec validates and
 * that Vega-Lite/KaTeX accept it. Neither of those is the claim that matters, which is that a
 * student SEES a chart with real axes and a derivation with typeset maths. Every silent failure
 * this project has hit — the white sandbox board, the inert vision critic, labels outside their
 * boxes — passed every check that stopped short of looking at rendered pixels.
 *
 * So these assertions read the DOM the browser actually produced: mark elements inside the Vega
 * SVG, `.katex` nodes with real content, the progress reveal changing what is visible, and text
 * staying inside its frame.
 */
import { chromium } from "playwright";

const BASE = process.env.LAB_URL ?? "http://localhost:3000";
const OUT = process.argv[2] ?? ".";

let failures = 0;
const results = [];

function check(name, condition, detail) {
  if (!condition) failures++;
  results.push(`${condition ? "PASS" : "FAIL"}  ${name}${detail ? `\n        ${detail}` : ""}`);
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

const consoleErrors = [];
page.on("console", (m) => m.type() === "error" && consoleErrors.push(m.text()));
page.on("pageerror", (e) => consoleErrors.push(`PAGEERROR: ${e.message}`));

async function open(board, p = 1) {
  await page.goto(`${BASE}/board-lab?board=${board}&p=${p}`, { waitUntil: "domcontentloaded" });
  // Vega embeds asynchronously and KaTeX typesets on mount; wait for the board itself, not a timer.
  await page.waitForSelector('[data-lab-stage] section', { timeout: 30_000 });
  await page.waitForTimeout(1200);
}

/* ── Vega-Lite ────────────────────────────────────────────────────────────── */

await open("compound-interest");

const plotSvg = await page.locator('[data-board="plot"] svg').count();
check("the chart renders an SVG at all", plotSvg > 0, `${plotSvg} svg elements`);

// Marks, not just a frame: a Vega chart that failed to bind data still draws axes.
const marks = await page.evaluate(() => {
  const svg = document.querySelector('[data-board="plot"] svg');
  if (!svg) return { paths: 0, texts: 0, ticks: 0 };
  return {
    paths: svg.querySelectorAll("path").length,
    texts: [...svg.querySelectorAll("text")].filter((t) => (t.textContent ?? "").trim()).length,
    ticks: svg.querySelectorAll("line").length,
  };
});
check("the chart draws real marks", marks.paths >= 2, `${marks.paths} paths`);
check("the chart draws axis labels", marks.texts >= 6, `${marks.texts} non-empty text nodes`);

// The axis titles come from the spec, so this proves the spec reached the renderer intact.
// Read via textContent on the individual nodes: `innerText` is a layout concept for HTML and comes
// back empty for SVG <text>, which reads as "the chart has no labels" when it is full of them.
const axisText = await page.evaluate(() =>
  [...document.querySelectorAll('[data-board="plot"] svg text')].map((t) => t.textContent ?? "").join(" "),
);
check(
  "the axis titles from the spec are on screen",
  /Years/.test(axisText) && /Balance/.test(axisText),
  JSON.stringify(axisText.replace(/\s+/g, " ").slice(0, 90)),
);

// Real computed values, not a placeholder ramp: 1000 * 1.08^20 = 4660.96, so the y axis has to
// reach into the thousands. Vega formats large ticks as "4,000" or "4000" depending on locale.
check(
  "the chart plots the real computed numbers",
  /[34][,.]?\d{3}/.test(axisText),
  `y-axis ticks read: ${JSON.stringify(axisText.replace(/\s+/g, " ").slice(0, 80))}`,
);

// Progress drives the reveal. At p=0 most of the plotting area is covered; at p=1 none of it is.
const wipeAt = async (p) => {
  await open("compound-interest", p);
  return page.evaluate(() => {
    const el = document.querySelector("[data-plot-wipe]");
    return el ? (el).getBoundingClientRect().width : -1;
  });
};
const wipeStart = await wipeAt(0);
const wipeEnd = await wipeAt(1);
check(
  "progress reveals the chart rather than re-rendering it",
  wipeStart > wipeEnd + 40,
  `wipe width ${Math.round(wipeStart)}px at p=0 -> ${Math.round(wipeEnd)}px at p=1`,
);

await open("rainfall-by-month");
const bars = await page.evaluate(
  () => document.querySelectorAll('[data-board="plot"] svg path, [data-board="plot"] svg rect').length,
);
check("a bar chart renders its bars", bars >= 12, `${bars} bar/rect marks for 12 months`);

// Category ORDER, not just presence. A nominal axis sorts alphabetically by default, so months
// render as "Apr, Aug, Dec, Feb…" unless the spec says otherwise — a chart in the wrong order
// looks like a rendering bug and teaches the wrong thing.
const monthOrder = await page.evaluate(() =>
  [...document.querySelectorAll('[data-board="plot"] svg text')]
    .map((t) => (t.textContent ?? "").trim())
    .filter((s) => /^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)$/.test(s)),
);
check(
  "categories render in their real order, not alphabetically",
  monthOrder[0] === "Jan" && monthOrder[11] === "Dec",
  monthOrder.join(" "),
);
await page.screenshot({ path: `${OUT}/board_plot.png` });

/* ── KaTeX ────────────────────────────────────────────────────────────────── */

await open("pythagoras");

const katexNodes = await page.locator('[data-board="equation"] .katex').count();
check("the derivation is typeset by KaTeX", katexNodes >= 4, `${katexNodes} .katex nodes`);

// Typeset, not printed: KaTeX emits real markup for a radical, so the source string must be gone.
const equationText = await page.locator('[data-board="equation"]').innerText();
check(
  "the maths is rendered, not shown as TeX source",
  !equationText.includes("\\sqrt") && !equationText.includes("^2}"),
  JSON.stringify(equationText.replace(/\s+/g, " ").slice(0, 100)),
);
check(
  "each step keeps its justification",
  /Pythagoras/.test(equationText) && /substitute/.test(equationText),
  "expected the `why` lines beside the steps",
);

// Steps accumulate with progress: a derivation whose earlier lines vanish cannot be checked.
const visibleSteps = async (p) => {
  await open("pythagoras", p);
  return page.evaluate(() =>
    [...document.querySelectorAll('[data-board="equation"] li')].filter(
      (li) => Number(getComputedStyle(li).opacity) > 0.5,
    ).length,
  );
};
const early = await visibleSteps(0.25);
const late = await visibleSteps(1);
check("steps accumulate as narration advances", late > early, `${early} steps at p=0.25 -> ${late} at p=1`);

await open("quadratic");
const quadratic = await page.locator('[data-board="equation"] .katex').count();
check("a fraction-heavy derivation typesets too", quadratic >= 4, `${quadratic} .katex nodes`);

// Nothing may overflow the board — the failure that made ELK labels hang out of their boxes.
const overflow = await page.evaluate(() => {
  const board = document.querySelector('[data-board="equation"]');
  if (!board) return -1;
  const box = board.getBoundingClientRect();
  return [...board.querySelectorAll(".katex")].filter((n) => {
    const r = n.getBoundingClientRect();
    return r.right > box.right + 1 || r.left < box.left - 1;
  }).length;
});
check("no typeset line overflows the board", overflow === 0, `${overflow} lines outside the frame`);
await page.screenshot({ path: `${OUT}/board_equation.png` });

/* ── An unknown board must say so, not render blank ───────────────────────── */

await page.goto(`${BASE}/board-lab?board=does-not-exist`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(600);
check(
  "a missing or invalid spec reports itself instead of rendering an empty frame",
  (await page.locator("[data-lab-error]").count()) === 1,
);

check("no console errors on any board", consoleErrors.length === 0, consoleErrors.slice(0, 2).join(" | "));

await browser.close();
console.log(results.join("\n"));
console.log(`\n${results.length - failures}/${results.length} checks passed`);
process.exit(failures ? 1 : 0);

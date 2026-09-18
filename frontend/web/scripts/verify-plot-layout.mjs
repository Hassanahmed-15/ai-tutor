/**
 * Geometry verification for the Vega-Lite chart board. Needs `npm run dev` already running.
 *
 *   node scripts/verify-plot-layout.mjs [screenshot-dir]
 *
 * WHY THIS EXISTS SEPARATELY FROM verify-spec-boards.mjs. That script asserts a chart EXISTS with
 * the right numbers in it, and a top-anchored 260px chart floating in a 900px board passes every
 * one of its assertions — which is exactly how the layout bug reached production. "There is an SVG
 * and it contains 92" was true the entire time the chart was visibly broken.
 *
 * So these assertions measure the chart's BOX rather than its contents: does it fill the frame it
 * was given, is it centred in that frame, are its labels horizontal, does it use the palette that
 * was validated for it. Each one is a property that was false before and must stay true.
 *
 * The tall stage matters. `?h=` drives the lab's frame height, and every case here runs at 860px
 * because the bug was proportional — at the lab's old fixed 460 the dead space was half as large
 * and easy to read as intentional padding.
 */
import { chromium } from "playwright";

const BASE = process.env.LAB_URL ?? "http://localhost:3000";
const OUT = process.argv[2] ?? ".";
/** Close to a real lesson board, and tall enough that top-anchoring is unmistakable. */
const TALL = 860;

let failures = 0;
const results = [];

function check(name, condition, detail) {
  if (!condition) failures++;
  results.push(`${condition ? "PASS" : "FAIL"}  ${name}${detail ? `\n        ${detail}` : ""}`);
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });

const consoleErrors = [];
page.on("console", (m) => m.type() === "error" && consoleErrors.push(m.text()));
page.on("pageerror", (e) => consoleErrors.push(`PAGEERROR: ${e.message}`));

async function open(board, height = TALL) {
  await page.goto(`${BASE}/board-lab?board=${board}&p=1&h=${height}`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-board="plot"][data-plot-ready="true"]', { timeout: 30_000 });
  // The ready flag flips one rAF after embed resolves; give layout a frame to settle before
  // measuring, or the first measurement can read a pre-layout box.
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
}

/** The chart's rendered box, its frame, and where it sits inside it. */
async function geometry() {
  return page.evaluate(() => {
    const section = document.querySelector('[data-board="plot"]');
    const svg = section.querySelector("svg");
    const frame = section.getBoundingClientRect();
    const chart = svg.getBoundingClientRect();
    const style = getComputedStyle(section);
    const padTop = parseFloat(style.paddingTop);
    const padBottom = parseFloat(style.paddingBottom);
    // The usable interior, i.e. the frame minus the padding that deliberately clears the caption.
    const innerTop = frame.top + padTop;
    const innerBottom = frame.bottom - padBottom;
    const innerHeight = innerBottom - innerTop;
    return {
      frameHeight: frame.height,
      innerHeight,
      chartHeight: chart.height,
      chartWidth: chart.width,
      frameWidth: frame.width,
      gapAbove: chart.top - innerTop,
      gapBelow: innerBottom - chart.bottom,
      padBottom,
    };
  });
}

const BOARDS = ["overfitting-gap", "rainfall-by-month", "compound-interest"];

for (const board of BOARDS) {
  await open(board);
  const g = await geometry();

  /*
   * THE BUG ITSELF. The chart was a fixed 260px tall inside a frame of any height, so on a tall
   * board it occupied a third of the space and left the rest white. Requiring most of the interior
   * is what a hardcoded height can never satisfy.
   */
  const fill = g.chartHeight / g.innerHeight;
  check(
    `${board}: chart fills its frame vertically`,
    fill > 0.85,
    `chart ${Math.round(g.chartHeight)}px of ${Math.round(g.innerHeight)}px usable (${(fill * 100).toFixed(0)}%)`,
  );

  /*
   * Centred, not top-anchored. Kept as a separate assertion from the fill check because they fail
   * independently: a chart can fill the frame and still be pushed off-centre, and a short chart can
   * be centred without filling anything.
   */
  const skew = Math.abs(g.gapAbove - g.gapBelow);
  check(
    `${board}: chart is centred, not top-anchored`,
    skew < 40,
    `gap above ${Math.round(g.gapAbove)}px vs below ${Math.round(g.gapBelow)}px`,
  );

  // The caption bar floats over the bottom of the board; the chart must not run under it.
  check(
    `${board}: bottom padding reserves the caption strip`,
    g.padBottom >= 48,
    `padding-bottom ${g.padBottom}px`,
  );

  check(
    `${board}: chart uses the full width`,
    g.chartWidth / g.frameWidth > 0.9,
    `chart ${Math.round(g.chartWidth)}px of ${Math.round(g.frameWidth)}px`,
  );

  /*
   * Labels stay horizontal. Vega rotates axis labels to 90° when they collide, which is what turned
   * the two-category axis in the report into vertical text. The theme pins labelAngle to 0 and lets
   * Vega drop colliding labels instead, so any rotation here is a regression.
   */
  const rotated = await page.evaluate(() => {
    /*
     * TICK LABELS ONLY — `role-axis-label`, never `role-axis-title`.
     *
     * A vertical axis TITLE is supposed to be rotated 90°; that is how every y-axis in the world is
     * drawn. An earlier version of this check looked at all `<text>` and flagged "Rainfall (mm)",
     * which was the test being wrong rather than the chart. What must never rotate is the tick
     * labels, which is what Vega turns sideways when categories collide.
     */
    const labels = [...document.querySelectorAll('[data-board="plot"] svg .role-axis-label text')];
    return labels.filter((t) => {
      const tr = t.getAttribute("transform") ?? "";
      const m = tr.match(/rotate\(\s*(-?[\d.]+)/);
      return m && Math.abs(parseFloat(m[1])) > 15 && Math.abs(Math.abs(parseFloat(m[1])) - 180) > 15;
    }).length;
  });
  check(`${board}: no rotated axis tick labels`, rotated === 0, `${rotated} rotated tick labels`);

  /*
   * Nothing clipped at the edges.
   *
   * `autosize: fit` sizes the plot to the container but does not reserve room for a tick label that
   * overhangs the plot's own edge, so the first category's label had half of itself outside the
   * SVG. The geometry checks above all passed while that was true — the chart filled its frame and
   * was centred, it was simply cut off — which is why this needs its own assertion.
   */
  const clipped = await page.evaluate(() => {
    const svg = document.querySelector('[data-board="plot"] svg').getBoundingClientRect();
    return [...document.querySelectorAll('[data-board="plot"] svg text')]
      .filter((t) => t.textContent.trim())
      .filter((t) => {
        const r = t.getBoundingClientRect();
        return r.left < svg.left - 0.5 || r.right > svg.right + 0.5;
      })
      .map((t) => t.textContent.trim());
  });
  check(`${board}: no text clipped at the frame edge`, clipped.length === 0, `clipped: ${clipped.join(", ")}`);

  // The validated palette, not Vega's stock #4c78a8.
  const usesTheme = await page.evaluate(() => {
    const fills = [...document.querySelectorAll('[data-board="plot"] svg path, [data-board="plot"] svg rect')]
      .map((el) => (el.getAttribute("fill") ?? "").toLowerCase())
      .filter(Boolean);
    return {
      stock: fills.some((f) => f === "#4c78a8"),
      themed: fills.some((f) => ["#2a78d6", "#eb6834", "#1baf7a"].includes(f)),
    };
  });
  check(`${board}: uses the validated palette`, usesTheme.themed && !usesTheme.stock,
    `themed=${usesTheme.themed} stockVegaBlue=${usesTheme.stock}`);

  await page.screenshot({ path: `${OUT}/plot_${board}.png` });
}

/*
 * The chart must track its frame rather than a constant. Two heights, one spec: if the rendered
 * height does not move with the board, `height` is hardcoded again.
 */
await open("rainfall-by-month", 500);
const short = await geometry();
await open("rainfall-by-month", 1000);
const tall = await geometry();
check(
  "chart height tracks the board height",
  tall.chartHeight > short.chartHeight + 300,
  `500px board → ${Math.round(short.chartHeight)}px chart; 1000px board → ${Math.round(tall.chartHeight)}px chart`,
);

/*
 * Chart-relevant console errors only.
 *
 * The dev server emits a React "Only plain objects can be passed to Client Components" warning on
 * every page of this app, unrelated to charts — verified by checking out the pre-change tree and
 * reproducing it there. Failing on it would make this script red regardless of the chart, which is
 * how a noisy check stops being read. Anything from Vega, or any real page error, still fails.
 */
const relevant = consoleErrors.filter(
  (e) => !e.includes("Only plain objects can be passed to Client Components"),
);
check("no chart-related console errors", relevant.length === 0, relevant.slice(0, 4).join("\n        "));

await browser.close();

console.log(results.join("\n"));
console.log(failures === 0 ? "\nAll plot layout checks passed." : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);

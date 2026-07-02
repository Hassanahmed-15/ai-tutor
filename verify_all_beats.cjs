/**
 * verify_all_beats.cjs — Captures every lecture beat at 50% (mid-draw) and 90% (nearly complete).
 * Run: node verify_all_beats.cjs
 * Output: /private/tmp/.../scratchpad/verify/<beat#>_<title>_mid.png
 *                                              verify/<beat#>_<title>_full.png
 *
 * Uses the debug fixture route (no API cost).
 * Prerequisites: dev server running on localhost:3000 with NEXT_PUBLIC_USE_FIXTURE=1
 */
const { chromium } = require("./node_modules/playwright");
const fs = require("fs");
const path = require("path");

const SHOTS_DIR = "/private/tmp/claude-501/-Users-hassanahmed-ai-tutor/1e027143-56da-4fdf-b528-01bf78a59e6e/scratchpad/paid_beats";
if (!fs.existsSync(SHOTS_DIR)) fs.mkdirSync(SHOTS_DIR, { recursive: true });

// Read fixture to know how many beats and their titles/types
const fixture = JSON.parse(fs.readFileSync("./apps/web/app/api/generate-lecture-debug/fixture.json", "utf8"));
const BEATS = fixture.beats;
const BEAT_COUNT = BEATS.length;

console.log(`Verifying ${BEAT_COUNT} beats...`);
BEATS.forEach((b, i) => {
  const ops = b.draw?.ops || [];
  const kinds = [...new Set(ops.map(o => o.kind))];
  const hasImg = kinds.includes("image");
  const hasScene = kinds.includes("scene");
  const hasMotion = kinds.includes("motion");
  const type = b.slideKind === "checkpoint" ? "CHECKPOINT"
    : hasImg ? "IMAGE"
    : (hasScene && hasMotion) ? "ANIM"
    : kinds.includes("label") && kinds.includes("arrow") ? "BLACKBOARD"
    : "OTHER";
  console.log(`  ${i}: [${type}] ${b.title} — ops: ${ops.length} {${kinds.join(",")}}`);
});

const slug = (i, title) => `${String(i).padStart(2,"0")}_${title.toLowerCase().replace(/[^a-z0-9]+/g,"_").slice(0,30)}`;

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1400, height: 900 });

  // Navigate and start the fixture lecture
  await page.goto("http://localhost:3000");
  await page.waitForTimeout(1200);

  // Click through the landing flow
  await page.locator("button").filter({ hasText: /teach me anything/i }).first().click().catch(async () => {
    await page.locator("button").filter({ hasText: /begin|start/i }).first().click().catch(() => {});
  });
  await page.waitForTimeout(600);
  await page.locator("button").filter({ hasText: /standard/i }).first().click().catch(() => {});
  await page.waitForTimeout(300);
  await page.locator("button").filter({ hasText: /continue/i }).first().click().catch(() => {});
  await page.waitForTimeout(600);
  await page.fill("input", "Supply and demand");
  await page.waitForTimeout(200);
  await page.locator("button").filter({ hasText: /set topic/i }).first().click().catch(() => {});
  await page.waitForTimeout(300);
  await page.locator("button").filter({ hasText: /build lesson/i }).first().click().catch(() => {});
  await page.waitForTimeout(3500);

  // Click Start Lecture if present
  const startBtn = page.locator("button").filter({ hasText: /start lecture/i }).first();
  if (await startBtn.isVisible().catch(() => false)) {
    await startBtn.click();
    await page.waitForTimeout(1200);
  }

  // For each beat: wait for mid-point, screenshot, wait to near-end, screenshot, skip
  for (let i = 0; i < BEAT_COUNT; i++) {
    const beat = BEATS[i];
    const isCheckpoint = beat.slideKind === "checkpoint";
    const durationMs = beat.draw?.durationMs ?? 20000;

    // Mid-point capture: ~50% through the beat
    const midWait = isCheckpoint ? 2000 : Math.round(durationMs * 0.52);
    await page.waitForTimeout(midWait);

    const name = slug(i, beat.title);
    await page.screenshot({ path: path.join(SHOTS_DIR, `${name}_mid.png`) });
    console.log(`beat ${i} mid captured (${midWait}ms)`);

    if (!isCheckpoint) {
      // Full capture: wait to ~90% point
      const remaining = Math.round(durationMs * 0.38);
      await page.waitForTimeout(remaining);
      await page.screenshot({ path: path.join(SHOTS_DIR, `${name}_full.png`) });
      console.log(`beat ${i} full captured`);
    }

    // Skip to next beat
    const skip = page.locator("button").filter({ hasText: /skip/i }).first();
    await skip.click({ timeout: 4000 }).catch(() => {});
    await page.waitForTimeout(800);
  }

  await browser.close();
  console.log(`\nAll screenshots saved to: ${SHOTS_DIR}`);
  console.log("Files:");
  fs.readdirSync(SHOTS_DIR).sort().forEach(f => console.log(" ", f));
})();

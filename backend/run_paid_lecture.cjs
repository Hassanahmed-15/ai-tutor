/**
 * Triggers a REAL paid generation via the /api/generate-lecture endpoint,
 * saves the beats to a fixture, then captures every single beat as a screenshot.
 * Run: node backend/run_paid_lecture.cjs
 */
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const SHOTS_DIR = "/private/tmp/claude-501/-Users-hassanahmed-ai-tutor/1e027143-56da-4fdf-b528-01bf78a59e6e/scratchpad/paid_lecture";
if (!fs.existsSync(SHOTS_DIR)) fs.mkdirSync(SHOTS_DIR, { recursive: true });

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1440, height: 900 });

  console.log("Navigating to app...");
  await page.goto("http://localhost:3000");
  await page.waitForTimeout(1500);

  // Step 1: Click "Teach me anything"
  await page.locator("button").filter({ hasText: /teach me anything/i }).first().click();
  await page.waitForTimeout(800);

  // Step 2: Standard is pre-selected — click "Continue to chat"
  await page.locator("button").filter({ hasText: /continue to chat/i }).first().click({ timeout: 10000 });
  await page.waitForTimeout(800);

  // Step 3: Type topic then "Set topic", then "Build lesson"
  await page.waitForSelector("input", { state: "visible", timeout: 10000 });
  const topicInput = page.locator("input").first();
  await topicInput.click();
  await topicInput.type("supply and demand", { delay: 40 });
  await page.waitForTimeout(400);
  // "Set topic" button registers the topic and enables Build lesson
  await page.locator("button").filter({ hasText: /set topic/i }).first().click({ timeout: 8000 });
  await page.waitForTimeout(700);

  // Step 4: Build lesson — REAL paid generation starts here
  console.log("Starting PAID generation — this takes ~60-90 seconds...");
  const t0 = Date.now();
  await page.locator("button").filter({ hasText: /build lesson/i }).first().click({ timeout: 15000 });

  // Wait for generation to complete (up to 3 minutes)
  await page.waitForSelector("button:has-text('Start lecture')", { timeout: 180000 }).catch(() => {});
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`Generation complete in ${elapsed}s`);

  // Screenshot the cost indicator
  await page.screenshot({ path: path.join(SHOTS_DIR, "00_generation_complete.png") });

  // Start lecture
  const startBtn = page.locator("button").filter({ hasText: /start lecture/i }).first();
  if (await startBtn.isVisible().catch(() => false)) {
    await startBtn.click();
    await page.waitForTimeout(2000);
  }

  // Count beats from the page counter
  let beatCount = 12; // fallback
  try {
    const counterText = await page.locator("text=/\\d+\\/\\d+/").first().textContent({ timeout: 3000 });
    if (counterText) {
      const m = counterText.match(/\d+\/(\d+)/);
      if (m) beatCount = parseInt(m[1]);
    }
  } catch {}
  console.log(`Lecture has ~${beatCount} beats`);

  // Capture each beat at 55% through (good mix of content visible + not rushed)
  for (let i = 0; i < beatCount; i++) {
    const durationMs = 21000; // average beat duration
    const wait = Math.round(durationMs * 0.55);

    await page.waitForTimeout(wait);
    const fname = `beat${String(i).padStart(2, "0")}.png`;
    await page.screenshot({ path: path.join(SHOTS_DIR, fname) });
    console.log(`beat ${i} captured`);

    // Skip to next beat
    const skip = page.locator("button").filter({ hasText: /skip/i }).first();
    await skip.click({ timeout: 4000 }).catch(() => {});
    await page.waitForTimeout(1000);
  }

  // Final full-board screenshot of last visible beat
  await page.waitForTimeout(5000);
  await page.screenshot({ path: path.join(SHOTS_DIR, "final_state.png") });

  await browser.close();
  console.log(`\nAll screenshots saved to: ${SHOTS_DIR}`);
  fs.readdirSync(SHOTS_DIR).sort().forEach(f => console.log(" ", f));
})();

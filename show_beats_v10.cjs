const { chromium } = require("./node_modules/playwright");
const path = require("path");
const SHOTS_DIR = "/private/tmp/claude-501/-Users-hassanahmed-ai-tutor/1e027143-56da-4fdf-b528-01bf78a59e6e/scratchpad/shots10";
(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1366, height: 860 });
  await page.goto("http://localhost:3000");
  await page.waitForTimeout(1000);
  await page.locator('button').filter({ hasText: /teach me anything/i }).first().click().catch(async () => {
    await page.locator('button').filter({ hasText: /begin|start/i }).first().click();
  });
  await page.waitForTimeout(600);
  await page.locator('button').filter({ hasText: /standard/i }).first().click().catch(() => {});
  await page.waitForTimeout(300);
  await page.locator('button').filter({ hasText: /continue/i }).first().click().catch(() => {});
  await page.waitForTimeout(600);
  await page.fill('input', "Supply and demand");
  await page.waitForTimeout(200);
  await page.locator('button').filter({ hasText: /set topic/i }).first().click().catch(() => {});
  await page.waitForTimeout(300);
  await page.locator('button').filter({ hasText: /build lesson/i }).first().click().catch(() => {});
  await page.waitForTimeout(3000);
  const startBtn = page.locator('button').filter({ hasText: /start lecture/i }).first();
  if (await startBtn.isVisible().catch(() => false)) { await startBtn.click(); await page.waitForTimeout(1000); }
  for (let i = 0; i < 9; i++) {
    const capture = i === 2;
    await page.waitForTimeout(capture ? 17000 : 3500);
    if (capture) { await page.screenshot({ path: path.join(SHOTS_DIR, "beat" + i + ".png") }); console.log("beat " + i + " captured"); }
    const skip = page.locator('button').filter({ hasText: /skip/i }).first();
    await skip.click({ timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(700);
  }
  await browser.close();
  console.log("Done");
})();

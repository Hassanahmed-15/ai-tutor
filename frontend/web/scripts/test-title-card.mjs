/**
 * DOES THE TITLE CARD GET OUT OF THE WAY WITHOUT PRESSING PLAY?
 *
 * A reopened lecture mounts paused, and the section title card used to sit over the board until
 * the student found Play — both dismissal effects were gated on `lesson.playing`. This opens the
 * real player on /player-preview (dev-only, seeded lecture, no sign-in), presses NOTHING, and
 * watches the card.
 *
 *   node scripts/test-title-card.mjs [out-dir] [--headed]
 *
 * Asserted: the `.board-title-card` element is gone (or marked leaving) within the board ceiling,
 * with the lecture still paused. Before the fix it stayed for as long as you cared to wait.
 */
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const BASE = process.env.LAB_URL ?? "http://localhost:3000";
const ROOT = path.resolve(import.meta.dirname, "..");
const args = process.argv.slice(2);
const [outDir = path.join(ROOT, "title-card-out")] = args.filter((a) => !a.startsWith("--"));
const headed = args.includes("--headed");
/** BOARD_WAIT_MAX_MS in LessonPlayer is the ceiling; allow it plus a little for page load. */
const CEILING_MS = Number(process.env.CARD_CEILING_MS ?? 15_000);

fs.mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch({ headless: !headed });
const page = await (await browser.newContext({ viewport: { width: 1500, height: 940 } })).newPage();
page.on("pageerror", (e) => console.log("  [pageerror]", e.message.slice(0, 160)));
// The Next dev overlay counts console errors as "issues"; name them rather than leave a red badge unexplained.
page.on("console", (m) => { if (m.type() === "error") console.log("  [console.error]", m.text().slice(0, 220)); });
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

await page.goto(`${BASE}/player-preview`, { waitUntil: "domcontentloaded" });
const card = page.locator(".board-title-card");
await card.first().waitFor({ state: "attached", timeout: 60_000 });
log("title card is up; not pressing Play");
await page.screenshot({ path: path.join(outDir, "1-card-up.png") });

const started = Date.now();
let gone = false;
while (Date.now() - started < CEILING_MS) {
  await page.waitForTimeout(500);
  const count = await card.count();
  const leaving = count ? await card.first().getAttribute("data-leaving") : null;
  if (count === 0 || leaving === "true") { gone = true; break; }
}
const elapsed = Date.now() - started;
await page.screenshot({ path: path.join(outDir, "2-after-wait.png") });
// Still paused? Tested as "no Pause control is on offer" — the Play button's accessible name carries
// its icon, so matching it by exact name failed on a lecture that was visibly paused.
const pauseVisible = await page.getByRole("button", { name: /pause/i }).first().isVisible().catch(() => false);
const playVisible = !pauseVisible && (await page.getByText("Play", { exact: true }).first().isVisible().catch(() => false));
await browser.close();

log(`card gone: ${gone} after ${elapsed} ms; lecture still paused: ${playVisible}`);
console.log(`screenshots in ${outDir}`);
if (!gone) { console.error("\nPROBLEM: the title card stayed over the board without Play being pressed."); process.exit(1); }
if (!playVisible) { console.error("\nPROBLEM: the lecture started on its own — the card should leave WITHOUT playback beginning."); process.exit(1); }
console.log("\nThe title card yields on its own; the lecture waits for Play.");

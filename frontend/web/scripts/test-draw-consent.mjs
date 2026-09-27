/**
 * DOES SHE STOP DRAWING? — the lecture chat, driven through a real browser.
 *
 * The unit tests pin who counts as having asked for a picture, and the route can be curled directly,
 * but neither shows the thing that was actually wrong: that typing an ordinary question into the chat
 * mid-lecture produced an animation nobody asked for. This opens the real LessonPlayer on
 * /player-preview (dev-only, seeded demo lecture, no sign-in) and types into the real chat.
 *
 *   node scripts/test-draw-consent.mjs [out-dir] [--headed] [--accept]
 *
 * Asserted:
 *   1. a plain question is answered with WORDS — no board, and no offer;
 *   2. a structural question is answered with words PLUS a "Want me to draw it?" offer;
 *   3. declining leaves the answer standing and opens no board;
 *   4. with --accept, accepting does open the board (a separate run, because building one costs
 *      ~20 s and about 1.6 cents).
 */
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const BASE = process.env.LAB_URL ?? "http://localhost:3000";
const ROOT = path.resolve(import.meta.dirname, "..");
const args = process.argv.slice(2);
const [outDir = path.join(ROOT, "draw-consent-out")] = args.filter((a) => !a.startsWith("--"));
const headed = args.includes("--headed");
const testAccept = args.includes("--accept");

const PLAIN = "what does dp stand for?";
const STRUCTURAL = "what happens to the tree when I delete a node that has two children?";

fs.mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch({ headless: !headed, args: ["--autoplay-policy=no-user-gesture-required"] });
const ctx = await browser.newContext({ viewport: { width: 1500, height: 940 } });
const page = await ctx.newPage();
page.on("pageerror", (error) => console.log("  [pageerror]", error.message.slice(0, 200)));
page.on("console", (m) => { if (m.type() === "error") console.log("  [browser]", m.text().slice(0, 160)); });

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const problems = [];

await page.goto(`${BASE}/player-preview`, { waitUntil: "domcontentloaded" });
const input = page.locator("#lesson-chat-input");
await input.waitFor({ state: "visible", timeout: 120_000 });
log("player up");

/** Aria's bubbles, as rendered. */
const ariaTurns = async () => page.locator("div", { has: page.locator("span", { hasText: /^Aria$/ }) }).allInnerTexts();
const offerVisible = () => page.getByText("Want me to draw it?").isVisible().catch(() => false);
/** The explanation overlay only exists once a board has been produced. */
const boardVisible = () => page.locator("canvas, svg").first().isVisible().catch(() => false);

async function ask(question, label) {
  const before = (await ariaTurns()).length;
  await input.fill(question);
  await input.press("Enter");
  // The words-only path is one model call; allow generously for a cold route.
  for (let i = 0; i < 90; i++) {
    await page.waitForTimeout(1000);
    if ((await ariaTurns()).length > before) break;
  }
  await page.screenshot({ path: path.join(outDir, `${label}.png`), fullPage: true });
  const turns = await ariaTurns();
  return turns[turns.length - 1] ?? "";
}

/* 1 + 2 — a plain question gets words and nothing else. */
const plainAnswer = await ask(PLAIN, "1-plain");
log(`plain answer: ${plainAnswer.replace(/\s+/g, " ").slice(0, 110)}`);
if (!plainAnswer.trim()) problems.push("the plain question was never answered");
if (await offerVisible()) problems.push("the plain question produced an offer to draw — it should not");
const drawCount = await page.locator("[data-explain-overlay]").count();
if (drawCount > 0) problems.push("the plain question opened an explanation board");

/* 3 — a structural question gets words plus an offer. */
const structuralAnswer = await ask(STRUCTURAL, "2-structural");
log(`structural answer: ${structuralAnswer.replace(/\s+/g, " ").slice(0, 110)}`);
const offered = await offerVisible();
log(`offer shown: ${offered}`);
if (!structuralAnswer.trim()) problems.push("the structural question was never answered");
if (!offered) problems.push("the structural question did not offer a drawing (the model may have judged it unnecessary — rerun, and check the prompt if it persists)");

if (offered && !testAccept) {
  /* 4 — declining keeps the words and draws nothing. */
  await page.getByRole("button", { name: "No, thanks" }).click();
  await page.waitForTimeout(2500);
  await page.screenshot({ path: path.join(outDir, "3-declined.png"), fullPage: true });
  if (await page.locator("[data-explain-overlay]").count()) problems.push("declining still opened a board");
  const disabled = await page.getByRole("button", { name: "No, thanks" }).isDisabled().catch(() => false);
  if (!disabled) problems.push("the chips stayed live after being answered");
  log("declined: no board, chips disabled");
} else if (offered) {
  /* 4b — accepting builds the board that was offered. */
  log("accepting the offer — this builds a real animation, ~20 s");
  await page.getByRole("button", { name: /Yes, draw it/ }).click();
  let drew = false;
  for (let i = 0; i < 120; i++) {
    await page.waitForTimeout(1000);
    if (await page.locator("[data-explain-overlay]").count()) { drew = true; break; }
  }
  await page.screenshot({ path: path.join(outDir, "4-accepted.png"), fullPage: true });
  if (!drew) problems.push("accepting the offer did not open a board");
  log(`accepted: board opened = ${drew}`);
}

await browser.close();

console.log(`\nscreenshots in ${outDir}`);
if (problems.length) {
  console.error("\nPROBLEMS:");
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
console.log("\nOrdinary questions are answered in words; a complicated one offers a drawing and only draws if asked.");

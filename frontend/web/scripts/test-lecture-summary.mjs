/**
 * No recap beats, and the one-slide summary that replaced them — in a real browser.
 * Needs `npm run dev` and a test account. Generates one lecture plus one summary.
 *
 *   node scripts/test-lecture-summary.mjs <out-dir> <email> <password-file> ["topic"]
 *
 * Checks:
 *   1. The lecture plan contains no recap/summary beat.
 *   2. The dock's "Summarize" button exists and is DISABLED while the lecture is unfinished.
 *   3. After the last beat plays to its end, the summary is offered and opens one slide with a
 *      crux and 3-6 points.
 */
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";

const BASE = process.env.LAB_URL ?? "http://localhost:3000";
const [outDir, email, pwFile, topicArg] = process.argv.slice(2);
if (!outDir || !email || !pwFile) {
  console.error('usage: test-lecture-summary.mjs <out-dir> <email> <password-file> ["topic"]');
  process.exit(1);
}
const TOPIC = topicArg ?? "explain me cryptography";
fs.mkdirSync(outDir, { recursive: true });
const password = fs.readFileSync(pwFile, "utf8").trim();
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const RECAP = /\b(?:recap|summary|review|wrap[- ]?up|conclusion|putting it (?:all )?together|key takeaways?)\b/i;

const browser = await chromium.launch({ args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--autoplay-policy=no-user-gesture-required"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, permissions: ["microphone"] });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
let sessionId = null;
page.on("response", async (res) => {
  if (res.url().endsWith("/api/progressive-lectures") && res.request().method() === "POST") {
    sessionId = (await res.json().catch(() => ({}))).sessionId ?? null;
  }
});
let shot = 0;
const snap = async (name) => page.screenshot({ path: path.join(outDir, `${String(shot++).padStart(2, "0")}-${name}.png`) });

await page.request.post(`${BASE}/api/auth/login`, { data: { email, password } });
await page.goto(BASE);
await page.waitForTimeout(3000);
const topicBox = page.getByPlaceholder(/Krebs cycle/).first();
await topicBox.fill(TOPIC);
await topicBox.press("Enter");
log("typed topic:", TOPIC);

/* ── planning: take the first chip / answer briefly until the plan can be accepted ── */
const accept = () => page.getByRole("button", { name: "Accept and start" }).last();
for (let turn = 0; turn < 10; turn++) {
  const until = Date.now() + 150_000;
  let state = "timeout";
  while (Date.now() < until) {
    const busy = await page.getByText(/Aria is thinking…|Planning…|Drafting subtopic|Updating…/).first().isVisible().catch(() => false);
    if (!busy && (await accept().isEnabled().catch(() => false))) { state = "plan"; break; }
    const box = page.getByPlaceholder(/Answer out loud, or type here…/).first();
    if (!busy && (await box.isVisible().catch(() => false)) && (await box.isEnabled().catch(() => false))) { state = "question"; break; }
    await page.waitForTimeout(800);
  }
  log("planning turn", turn, state);
  if (state === "plan") break;
  if (state !== "question") break;
  await page.waitForTimeout(1200);
  const box = page.getByPlaceholder(/Answer out loud, or type here…/).first();
  await box.fill(turn === 0 ? "Intermediate — I know the basics." : "I know a little about encryption keys, keep it focused.");
  await box.press("Enter");
  await page.waitForTimeout(2500);
}
await snap("plan");
await accept().click();
log("accepted plan");

/* ── 1. the plan has no recap beat ── */
for (let i = 0; i < 60 && !sessionId; i++) await page.waitForTimeout(1000);
let snapshot = null;
for (let i = 0; i < 60; i++) {
  snapshot = await (await page.request.get(`${BASE}/api/progressive-lectures/${sessionId}`)).json().catch(() => null);
  if (snapshot?.beatStatus?.length) break;
  await page.waitForTimeout(2000);
}
const plan = (snapshot?.beatStatus ?? []).map((b) => b.title);
log("plan:", JSON.stringify(plan));

/* ── wait until every beat is written, so the lecture can be played to its end ── */
const until = Date.now() + Number(process.env.LECTURE_WAIT_MS ?? 15 * 60_000);
while (Date.now() < until) {
  snapshot = await (await page.request.get(`${BASE}/api/progressive-lectures/${sessionId}`)).json().catch(() => snapshot);
  log(`ready ${snapshot?.contiguousReadyCount}/${snapshot?.plannedBeatCount} status ${snapshot?.status}`);
  if (snapshot?.status === "complete") break;
  await page.waitForTimeout(15_000);
}
const slideKinds = (snapshot?.beats ?? []).map((b) => b.slideKind);

/* ── 2. mid-lecture, the summary button is there but locked ── */
const play = page.getByRole("button", { name: "Play the lecture" });
if (await play.isVisible().catch(() => false)) await play.click().catch(() => {});
await page.waitForTimeout(4000);
const dockButton = page.locator('button[data-summarize-lecture]').first();
const midLecture = {
  present: await dockButton.isVisible().catch(() => false),
  disabled: await dockButton.isDisabled().catch(() => null),
  title: await dockButton.getAttribute("title").catch(() => null),
};
log("mid-lecture summarize button:", JSON.stringify(midLecture));
await snap("mid-lecture");

/* ── 3. jump to the last beat and let it finish ── */
const next = page.getByRole("button", { name: /Next concept/ });
for (let i = 0; i < 20 && (await next.isEnabled().catch(() => false)); i++) {
  await next.click();
  await page.waitForTimeout(1500);
}
log("on the last beat; letting it play to the end");
let offered = false;
const endBy = Date.now() + 8 * 60_000;
while (Date.now() < endBy) {
  // The end screens render an enabled button of their own once the lecture is complete.
  const buttons = page.locator("button[data-summarize-lecture]:not([disabled])");
  if ((await buttons.count()) > 0 && !(await page.getByRole("button", { name: /Next concept/ }).isVisible().catch(() => false))) {
    offered = true;
    break;
  }
  if (!(await page.getByRole("button", { name: "Pause the lecture" }).isVisible().catch(() => false))) {
    await page.getByRole("button", { name: "Play the lecture" }).click().catch(() => {});
  }
  await page.waitForTimeout(5000);
}
await snap("lecture-ended");
log("summary offered after the lecture:", offered);

let slide = null;
if (offered) {
  await page.locator("button[data-summarize-lecture]:not([disabled])").first().click();
  await page.locator("[data-summary-slide]").waitFor({ timeout: 90_000 }).catch(() => {});
  slide = await page.evaluate(() => {
    const el = document.querySelector("[data-summary-slide]");
    if (!el) return null;
    return {
      title: el.querySelector("h2")?.textContent ?? "",
      crux: el.querySelector("[data-summary-crux]")?.textContent ?? "",
      points: [...el.querySelectorAll("[data-summary-point]")].map((p) => p.textContent?.trim() ?? ""),
    };
  });
  await snap("summary-slide");
}

const summary = {
  plan,
  recapBeats: plan.filter((t) => RECAP.test(t)),
  recapSlideKinds: slideKinds.filter((k) => k === "recap").length,
  midLecture,
  offeredAfterEnd: offered,
  slide,
  pageErrors: errors.slice(0, 5),
};
fs.writeFileSync(path.join(outDir, "summary.json"), JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));
await browser.close();

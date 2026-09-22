/**
 * "Get a lecture from this area" — is the lecture about the AREA, and does the chat know it?
 * Real run: needs `npm run dev` and a test account. One parse, one lecture, two chat answers.
 *
 *   node scripts/test-region-lecture.mjs <out-dir> <email> <password-file> <pdf> <page> <x,y,w,h>
 *
 * The box is in page fractions (0-1). Checks:
 *   1. The lecture request carries `selection` (pages + what was read off the area).
 *   2. Beat titles and scripts are about the area (ONTOPIC terms) and not about the rest (OFFTOPIC).
 *   3. The chat is sent what is ON the board, and answers "what did I select?" from the selection.
 */
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";

const BASE = process.env.LAB_URL ?? "http://localhost:3000";
const [outDir, email, pwFile, pdf, pageArg, boxArg] = process.argv.slice(2);
if (!outDir || !email || !pwFile || !pdf || !pageArg || !boxArg) {
  console.error("usage: test-region-lecture.mjs <out-dir> <email> <password-file> <pdf> <page> <x,y,w,h>");
  process.exit(1);
}
const [bx, by, bw, bh] = boxArg.split(",").map(Number);
const ONTOPIC = (process.env.ONTOPIC ?? "").split(",").map((t) => t.trim().toLowerCase()).filter(Boolean);
const OFFTOPIC = (process.env.OFFTOPIC ?? "").split(",").map((t) => t.trim().toLowerCase()).filter(Boolean);
fs.mkdirSync(outDir, { recursive: true });
const password = fs.readFileSync(pwFile, "utf8").trim();
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

const browser = await chromium.launch({ args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--autoplay-policy=no-user-gesture-required"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, permissions: ["microphone"] });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
let sessionId = null;
let lectureRequest = null;
const explains = [];
page.on("request", (req) => {
  if (req.url().endsWith("/api/progressive-lectures") && req.method() === "POST") lectureRequest = JSON.parse(req.postData() ?? "{}");
  if (req.url().endsWith("/api/explain")) explains.push({ request: JSON.parse(req.postData() ?? "{}") });
});
page.on("response", async (res) => {
  if (res.url().endsWith("/api/progressive-lectures") && res.request().method() === "POST") {
    sessionId = (await res.json().catch(() => ({}))).sessionId ?? null;
  }
  if (res.url().endsWith("/api/explain")) {
    const data = await res.json().catch(() => null);
    const pending = explains.find((e) => !e.response);
    if (pending) pending.response = data;
  }
});
let shot = 0;
const snap = async (name) => page.screenshot({ path: path.join(outDir, `${String(shot++).padStart(2, "0")}-${name}.png`) });

await page.request.post(`${BASE}/api/auth/login`, { data: { email, password } });
await page.goto(BASE);
await page.waitForTimeout(3000);
await page.locator('input[type="file"]').first().setInputFiles(pdf);
log("pdf chosen");

/* ── drag the box on the page, then "Get a lecture from this area" ── */
const image = page.locator(`[data-page-number="${pageArg}"] img[data-page-area-image]`);
await image.waitFor({ timeout: 90_000 });
await image.scrollIntoViewIfNeeded();
await page.waitForTimeout(800);
const r = await image.boundingBox();
if (!r) throw new Error("page image has no box");
await page.mouse.move(r.x + r.width * bx, r.y + r.height * by);
await page.mouse.down();
await page.mouse.move(r.x + r.width * (bx + bw / 2), r.y + r.height * (by + bh / 2), { steps: 6 });
await page.mouse.move(r.x + r.width * (bx + bw), r.y + r.height * (by + bh), { steps: 6 });
await page.mouse.up();
await page.waitForTimeout(600);
await snap("area-drawn");
await page.locator("[data-use-region]").click();
log("clicked: Get a lecture from this area");

/* ── planning: accept once a plan is offered, answering chips/questions briefly ── */
const accept = () => page.getByRole("button", { name: "Accept and start" }).last();
for (let turn = 0; turn < 10; turn++) {
  const until = Date.now() + 180_000;
  let state = "timeout";
  while (Date.now() < until) {
    const busy = await page.getByText(/Aria is thinking…|Planning…|Drafting subtopic|Updating…|Reading those pages…/).first().isVisible().catch(() => false);
    if (!busy && (await accept().isEnabled().catch(() => false))) { state = "plan"; break; }
    const chips = page.locator("h2 + div button");
    if (!busy && (await page.getByText(/Planning from your source ·/i).isVisible().catch(() => false)) && (await chips.count()) > 0) { state = "chips"; break; }
    const box = page.getByPlaceholder(/Answer out loud, or type here…/).first();
    if (!busy && (await box.isVisible().catch(() => false)) && (await box.isEnabled().catch(() => false))) { state = "question"; break; }
    await page.waitForTimeout(800);
  }
  log("planning turn", turn, state);
  if (state === "plan") break;
  if (state === "chips") { await page.locator("h2 + div button").first().click(); await page.waitForTimeout(2500); continue; }
  if (state !== "question") break;
  const box = page.getByPlaceholder(/Answer out loud, or type here…/).first();
  await box.fill("Intermediate — I know basic trees.");
  await box.press("Enter");
  await page.waitForTimeout(2500);
}
await snap("plan");
const outline = await page.locator("[data-planning-chat]").innerText().catch(() => "");
await accept().click();
log("accepted plan");

/* ── the lecture ── */
for (let i = 0; i < 60 && !sessionId; i++) await page.waitForTimeout(1000);
log("session", sessionId);
let snapshot = null;
const until = Date.now() + Number(process.env.LECTURE_WAIT_MS ?? 10 * 60_000);
while (Date.now() < until) {
  snapshot = await (await page.request.get(`${BASE}/api/progressive-lectures/${sessionId}`)).json().catch(() => snapshot);
  log(`ready ${snapshot?.contiguousReadyCount}/${snapshot?.plannedBeatCount} ${snapshot?.status}`);
  const planned = snapshot?.plannedBeatCount ?? 0;
  // A plan of 0 beats means planning is still running — not "all zero beats are ready".
  if (snapshot?.status === "failed" || snapshot?.status === "complete" || (planned > 0 && (snapshot?.contiguousReadyCount ?? 0) >= Math.min(3, planned))) break;
  await page.waitForTimeout(15_000);
}
const beats = (snapshot?.beats ?? []).map((b) => ({ title: b.title, script: String(b.script ?? "") }));
const allText = beats.map((b) => `${b.title} ${b.script}`).join(" ").toLowerCase();
fs.writeFileSync(path.join(outDir, "scripts.txt"), beats.map((b) => `## ${b.title}\n${b.script}`).join("\n\n"));

/* ── the chat: what is on the board, and what did I select? ── */
const play = page.getByRole("button", { name: "Play the lecture" });
if (await play.isVisible().catch(() => false)) await play.click().catch(() => {});
await page.waitForTimeout(8000);
const chatInput = page.locator("#lesson-chat-input");
const answers = [];
for (const question of ["what is on the board right now?", "what part of the pdf did I select?"]) {
  if (!(await chatInput.isVisible().catch(() => false))) break;
  const before = explains.length;
  await chatInput.fill(question);
  await chatInput.press("Enter");
  for (let t = 0; t < 120 && !(explains.length > before && explains[explains.length - 1].response); t++) await page.waitForTimeout(1000);
  const last = explains[explains.length - 1];
  answers.push({
    question,
    beatContextHasBoard: /ON THE BOARD|Points on screen/.test(String(last?.request?.beatContext ?? "")),
    documentContextNamesSelection: /SELECTED on page/.test(String(last?.request?.documentContext ?? "")),
    answer: String(last?.response?.script ?? last?.response?.error ?? "").slice(0, 400),
  });
  await page.waitForTimeout(3000);
  // Close the answer board so the next question can be asked.
  await page.getByRole("button", { name: /Return to the lesson board/ }).click().catch(() => {});
  await page.waitForTimeout(1500);
}
await snap("chat");

const result = {
  sessionId,
  status: snapshot?.status ?? null,
  error: snapshot?.error ?? null,
  selectionSent: lectureRequest?.selection ?? null,
  outlineExcerpt: outline.slice(0, 600),
  plan: (snapshot?.beatStatus ?? []).map((b) => b.title),
  onTopic: Object.fromEntries(ONTOPIC.map((t) => [t, allText.includes(t)])),
  offTopic: Object.fromEntries(OFFTOPIC.map((t) => [t, allText.includes(t)])),
  chat: answers,
  pageErrors: errors.slice(0, 5),
};
fs.writeFileSync(path.join(outDir, "summary.json"), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
await browser.close();

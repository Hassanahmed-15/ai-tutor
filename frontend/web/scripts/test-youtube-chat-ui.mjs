/**
 * DOES THE CHAT PANEL OF A VIDEO LECTURE KNOW THE VIDEO AND THE WHOLE SHORT LECTURE?
 *
 * Reported 2026-10-03: "I asked him video questions, it had no idea", and "what's in the last
 * slide" was answered wrongly. Three faults lay behind it: a question that shared words with an
 * earlier slide was answered from that slide's script alone (lib/revisit.ts), "last slide" meant the
 * previous one, and a lecture reopened from history came back without its video.
 *
 * Opens a saved video lecture from history, as a student does, presses Play, and types questions
 * into the real chat panel. It reads the answer Aria writes in the panel, and the requests the panel
 * sends (so a question sent to /api/revisit instead of /api/explain is caught).
 *
 *   node scripts/test-youtube-chat-ui.mjs <email> <password-file> "<history card text>" "<question>" "<regex>" [more pairs…] [--out dir]
 *
 * Prefix a regex with "notime:" when the answer is not expected to cite a moment of the video.
 *
 * COST: one chat call per question, each carrying the transcript and the lecture: cents.
 */
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";

const BASE = process.env.LAB_URL ?? "http://localhost:3000";
const args = process.argv.slice(2);
const outAt = args.indexOf("--out");
const outDir = outAt >= 0 ? args.splice(outAt, 2)[1] : path.resolve("youtube-chat-ui-out");
const [email, pwFile, cardText, ...pairs] = args;
if (!email || !pwFile || !cardText || pairs.length < 2 || pairs.length % 2) {
  console.error('usage: node scripts/test-youtube-chat-ui.mjs <email> <password-file> "<history card text>" "<question>" "<regex>" [more pairs…]');
  process.exit(2);
}
fs.mkdirSync(outDir, { recursive: true });
const log = (...parts) => console.log(new Date().toISOString().slice(11, 19), ...parts);
const problems = [];

const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
const page = await ctx.newPage();
const login = await ctx.request.post(`${BASE}/api/auth/login`, { data: { email, password: fs.readFileSync(pwFile, "utf8").trim() } });
if (!login.ok()) throw new Error(`login failed: ${login.status()}`);

const sent = [];
page.on("request", (request) => {
  const url = request.url();
  if (/\/api\/(explain|revisit)$/.test(url) && request.method() === "POST") {
    const body = request.postDataJSON() ?? {};
    sent.push({ route: url.split("/api/")[1], question: body.question, documentChars: String(body.documentContext ?? "").length, lessonChars: String(body.lessonContext ?? "").length, lessonHead: String(body.lessonContext ?? "").slice(0, 40) });
  }
});

const replies = [];
page.on("response", async (response) => {
  if (!/\/api\/(explain|revisit)$/.test(response.url()) || response.request().method() !== "POST") return;
  const body = await response.json().catch(() => ({}));
  replies.push({ question: response.request().postDataJSON()?.question, script: String(body.script ?? body.error ?? "").replace(/\s+/g, " ") });
});

await page.goto(BASE, { waitUntil: "domcontentloaded" });
await page.locator("#brief").waitFor({ timeout: 60_000 });
const card = page.locator("button, a, [role=button]").filter({ hasText: cardText }).filter({ hasText: "Video" }).first();
await card.waitFor({ timeout: 60_000 });
await card.click();
const play = page.getByRole("button", { name: /Play/ }).first();
await play.waitFor({ timeout: 120_000 });
await play.click();
log(`opened "${cardText}" from history and pressed Play`);
await page.waitForTimeout(6_000);

const input = page.getByPlaceholder(/Speak anytime, or type/i).first();
for (let i = 0; i < pairs.length; i += 2) {
  const question = pairs[i];
  const noTime = pairs[i + 1].startsWith("notime:");
  const expected = new RegExp(pairs[i + 1].replace(/^notime:/, ""), "i");
  const before = sent.length;
  await input.fill(question);
  await page.getByRole("button", { name: /^Ask$/ }).first().click();
  // Aria's answer, read from the chat route's reply (what the panel then shows and speaks).
  let answer = "";
  for (let t = 0; t < 90 && !answer; t++) {
    await page.waitForTimeout(1000);
    answer = replies.find((reply) => reply.question === question)?.script ?? "";
  }
  const request = sent[before];
  const cites = /\b\d{1,2}:\d{2}\b|minutes? in/.test(answer);
  const ok = expected.test(answer);
  log(`\nQ: ${question}\n   sent to /api/${request?.route ?? "?"} (transcript ${request?.documentChars ?? 0} chars, lecture ${request?.lessonChars ?? 0} chars: "${request?.lessonHead ?? ""}")\nA: ${answer.slice(0, 500)}\n   ${ok ? "matches" : "DOES NOT MATCH"} /${pairs[i + 1]}/ · ${cites ? "cites a moment" : "no moment cited"}`);
  await page.screenshot({ path: path.join(outDir, `q${i / 2 + 1}.png`) });
  if (request?.route === "revisit") problems.push(`"${question}" was sent back to one slide instead of the chat that holds the whole video`);
  if (!request?.documentChars) problems.push(`"${question}" was asked with no video transcript`);
  if (!ok) problems.push(`"${question}" was not answered as expected (/${pairs[i + 1]}/)`);
  else if (!cites && !noTime) problems.push(`"${question}" was answered without saying when in the video`);
}

await browser.close();
if (problems.length) {
  log(`\nFAILED:\n  - ${problems.join("\n  - ")}`);
  process.exit(1);
}
log(`\nOK — screenshots in ${outDir}`);

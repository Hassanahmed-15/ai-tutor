/**
 * Answer Aria OUT LOUD during planning, and check the spoken answer joins the conversation.
 * Needs `npm run dev` running and a test account.
 *
 *   node scripts/test-planning-voice.mjs <out-dir> <email> <password-file> <spoken-answer.wav>
 *
 * Chrome plays the WAV as the microphone (--use-file-for-fake-audio-capture). Nothing on screen is
 * clicked or typed: if the conversation moves on, it moved on because Aria heard the student.
 * Checks that the spoken answer appears as the student's bubble, that it answered the question on
 * screen (the next question arrives), and that Aria's spoken copy of a question is not printed twice.
 */
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";

const BASE = process.env.LAB_URL ?? "http://localhost:3000";
const [outDir, email, pwFile, wav] = process.argv.slice(2);
fs.mkdirSync(outDir, { recursive: true });
const password = fs.readFileSync(pwFile, "utf8").trim();
const TOPIC = process.env.CHAT_TOPIC ?? "policy iteration in reinforcement learning";

const browser = await chromium.launch({
  args: [
    "--use-fake-ui-for-media-stream",
    "--use-fake-device-for-media-stream",
    `--use-file-for-fake-audio-capture=${wav}`,
    "--autoplay-policy=no-user-gesture-required",
  ],
});
const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 }, permissions: ["microphone"] });
const page = await ctx.newPage();
page.on("console", (m) => { if (m.text().includes("planning-voice") || m.type() === "error") console.log("  [browser]", m.text().slice(0, 160)); });
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
await page.request.post(`${BASE}/api/auth/login`, { data: { email, password } });
await page.goto(BASE);
await page.waitForTimeout(3000);
const box = page.getByPlaceholder(/Krebs cycle/).first();
await box.fill(TOPIC);
await box.press("Enter");
log("topic submitted; now only listening");

async function transcript() {
  const rows = page.locator("[data-planning-chat] [data-chat-role]");
  const n = await rows.count();
  const out = [];
  for (let i = 0; i < n; i += 1) {
    out.push({ role: await rows.nth(i).getAttribute("data-chat-role"), text: (await rows.nth(i).locator("p").first().innerText().catch(() => "")).trim() });
  }
  return out;
}

let spokenAnswer = null;
let nextQuestionAfterVoice = null;
const until = Date.now() + 120_000;
let last = [];
while (Date.now() < until) {
  await page.waitForTimeout(3000);
  last = await transcript();
  const youIndex = last.findIndex((b) => b.role === "you");
  if (youIndex >= 0 && !spokenAnswer) {
    spokenAnswer = last[youIndex].text;
    log("student bubble appeared:", spokenAnswer);
    await page.screenshot({ path: path.join(outDir, "voice-answer.png") });
  }
  if (spokenAnswer) {
    const later = last.slice(last.findIndex((b) => b.role === "you") + 1).find((b) => b.role === "aria" && /\?/.test(b.text));
    if (later) {
      nextQuestionAfterVoice = later.text;
      log("next question arrived:", later.text.slice(0, 100));
      break;
    }
  }
}
await page.waitForTimeout(2000);
last = await transcript();
await page.screenshot({ path: path.join(outDir, "voice-final.png") });
const voiceStatus = await page.locator("[data-planning-chat]").first().innerText().catch(() => "");
const ariaLines = last.filter((b) => b.role === "aria").map((b) => b.text);
const summary = {
  spokenAnswerShownAsStudentBubble: spokenAnswer,
  conversationMovedOnFromVoice: nextQuestionAfterVoice,
  duplicateAriaLines: ariaLines.filter((t, i) => ariaLines.indexOf(t) !== i),
  voiceStatusShown: /Aria is speaking|Listening/.test(voiceStatus),
  transcript: last,
};
fs.writeFileSync(path.join(outDir, "voice-summary.json"), JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));
await browser.close();

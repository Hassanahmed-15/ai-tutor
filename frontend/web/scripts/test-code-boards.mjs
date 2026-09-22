/**
 * Does an uploaded PDF with code in it produce CODE BOARDS — in the lecture and in a chat answer?
 * Real run: needs `npm run dev` and a test account. Generates one lecture plus one chat answer.
 *
 *   node scripts/test-code-boards.mjs <out-dir> <email> <password-file> <pdf>
 *
 * What it checks:
 *   1. Uploading from the front page lands in the builder (not bounced back to the landing page).
 *   2. The lecture plan marks the beats built from the code pages as `code`.
 *   3. Those beats come back with a filled `codeBoard` whose listing is quoted from the PDF.
 *   4. The player actually renders the code board ([data-board="code"]).
 *   5. Typing "explain to me working of remove function" answers with a code board too.
 */
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";

const BASE = process.env.LAB_URL ?? "http://localhost:3000";
const [outDir, email, pwFile, pdf] = process.argv.slice(2);
if (!outDir || !email || !pwFile || !pdf) {
  console.error("usage: test-code-boards.mjs <out-dir> <email> <password-file> <pdf>");
  process.exit(1);
}
fs.mkdirSync(outDir, { recursive: true });
const password = fs.readFileSync(pwFile, "utf8").trim();
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

const browser = await chromium.launch({ args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--autoplay-policy=no-user-gesture-required"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, permissions: ["microphone"] });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
// Aria's voice sessions log when they are shown the document's pages.
const consoleLines = [];
page.on("console", (m) => { if (/gemini-live|planning-voice/.test(m.text())) consoleLines.push(m.text().slice(0, 200)); });
// FOCUS: the question typed into the page chooser; GROUND: comma-separated facts only the pages hold.
const FOCUS = process.env.FOCUS ?? "";
const GROUND = (process.env.GROUND ?? "").split(",").map((t) => t.trim().toLowerCase()).filter(Boolean);
let sessionId = null;
let explain = null;
page.on("response", async (res) => {
  const url = res.url();
  if (url.endsWith("/api/progressive-lectures") && res.request().method() === "POST") {
    sessionId = (await res.json().catch(() => ({}))).sessionId ?? null;
  }
  if (url.endsWith("/api/explain")) explain = await res.json().catch(() => null);
});
let shot = 0;
const snap = async (name) => page.screenshot({ path: path.join(outDir, `${String(shot++).padStart(2, "0")}-${name}.png`) });

const login = await page.request.post(`${BASE}/api/auth/login`, { data: { email, password } });
log("login", login.status());
await page.goto(BASE);
await page.waitForTimeout(3000);
if (await page.getByText("Before we start.").isVisible().catch(() => false)) {
  await page.getByPlaceholder("Your name").fill("Sam");
  await page.getByText("None of these", { exact: true }).click();
  await page.getByRole("button", { name: /Start learning/ }).click();
  await page.waitForTimeout(3000);
}

/* ── 1. upload from the front page — or, with pdf "-", type FOCUS as the topic ── */
let bounced = false;
if (pdf === "-") {
  const topicBox = page.getByPlaceholder(/Krebs cycle/).first();
  await topicBox.fill(FOCUS);
  await topicBox.press("Enter");
  log("typed topic:", FOCUS);
  await page.waitForTimeout(4000);
  bounced = await page.getByPlaceholder(/Krebs cycle/).first().isVisible().catch(() => false);
  log("left the landing page:", !bounced);
} else {
  await page.locator('input[type="file"]').first().setInputFiles(pdf);
  log("pdf chosen");
  const useAll = page.getByRole("button", { name: /^Use (all pages|\d+ pages?)$/ });
  try {
    await useAll.waitFor({ timeout: 60_000 });
  } catch {
    bounced = await page.getByPlaceholder(/Krebs cycle/).first().isVisible().catch(() => false);
  }
  await snap("after-upload");
  log("page chooser shown:", !bounced);
  if (!bounced) {
    if (FOCUS) {
      await page.locator("textarea").last().fill(FOCUS);
      log("typed focus question:", FOCUS);
    }
    await useAll.click();
    log("using all pages");
  }
}
if (bounced) {
  console.log(JSON.stringify({ bouncedToLanding: true, errors }, null, 2));
  process.exit(1);
}

/* ── planning: answer whatever Aria asks, then accept ────────────────────── */
const ANSWER = "I want to understand exactly how the remove function in these notes works, walking through its code.";
const accept = () => page.getByRole("button", { name: "Accept and start" }).last();
const answerBox = () =>
  page.getByPlaceholder(/Answer out loud, or type here…|What should the lesson focus on\?|What do you want from this document|type here/i).first();
let planned = false;
for (let turn = 0; turn < 12 && !planned; turn += 1) {
  const until = Date.now() + 150_000;
  let state = "timeout";
  while (Date.now() < until) {
    const busy = await page.getByText(/Aria is thinking…|Planning…|Drafting subtopic|Updating…|Reading those pages…/).first().isVisible().catch(() => false);
    if (!busy && (await accept().isEnabled().catch(() => false))) { state = "plan"; break; }
    // A document's scope questions are answered with their option chips; typing is ignored there.
    const chips = page.locator("h2 + div button");
    if (!busy && (await page.getByText(/Planning from your source ·/i).isVisible().catch(() => false)) && (await chips.count()) > 0) {
      state = "chips";
      break;
    }
    const box = answerBox();
    if (!busy && (await box.isVisible().catch(() => false)) && (await box.isEnabled().catch(() => false))) { state = "question"; break; }
    await page.waitForTimeout(800);
  }
  log("planning turn", turn, state);
  if (state === "plan") { planned = true; break; }
  if (state === "chips") {
    const chips = page.locator("h2 + div button");
    const labels = await chips.allInnerTexts();
    const pick = labels.findIndex((l) => /delet|remov|code|implement|walk|intermediate|faithful|step/i.test(l));
    const index = pick >= 0 ? pick : 0;
    log(`  question: ${(await page.locator("h2").first().innerText()).slice(0, 90)} -> ${labels[index]}`);
    await chips.nth(index).click();
    await page.waitForTimeout(2500);
    continue;
  }
  if (state !== "question") break;
  await page.waitForTimeout(1200);
  const box = answerBox();
  await box.fill(turn === 0 ? ANSWER : "Intermediate. I know basic trees and pointers in C++.");
  await box.press("Enter");
  await page.waitForTimeout(2500);
}
await snap("plan");
// What Aria actually said while planning — her questions must name the SUBJECT, not the prompt.
const planningChat = await page.locator("[data-planning-chat] [data-chat-role]").evaluateAll((els) =>
  els.map((el) => `${el.getAttribute("data-chat-role")}: ${(el.textContent ?? "").trim().slice(0, 200)}`),
).catch(() => []);
log("planning chat:", JSON.stringify(planningChat.slice(0, 6), null, 1));
if (!planned) {
  console.log(JSON.stringify({ planned: false, errors }, null, 2));
  await browser.close();
  process.exit(1);
}
await accept().click();
log("accepted plan");

/* ── 2-3. the lecture: which beats are code, and are their boards filled? ── */
for (let i = 0; i < 60 && !sessionId; i += 1) await page.waitForTimeout(1000);
log("session", sessionId);
let lecture = null;
const until = Date.now() + Number(process.env.LECTURE_WAIT_MS ?? 20 * 60_000);
while (Date.now() < until && sessionId) {
  const s = await (await page.request.get(`${BASE}/api/progressive-lectures/${sessionId}`)).json().catch(() => null);
  if (s) {
    const codeBeats = s.beats.filter((b) => b.draw?.ops?.some((op) => op.kind === "codeBoard" && op.spec));
    lecture = {
      planned: s.plannedBeatCount,
      ready: s.contiguousReadyCount,
      status: s.status,
      plan: s.beatStatus.map((b) => `${b.sequence}:${b.visualKind}:${b.state} ${b.title}`),
      codeBoards: codeBeats.map((b) => {
        const op = b.draw.ops.find((o) => o.kind === "codeBoard");
        return { beat: b.title, language: op.spec.language, fromSource: op.spec.fromSource ?? false, lines: op.spec.code.split("\n").length, steps: op.spec.steps.length, code: op.spec.code };
      }),
      costUsd: s.costUsd,
    };
    log(`ready ${lecture.ready}/${lecture.planned} code boards ${codeBeats.length} status ${s.status}`);
    const allCodePlanned = s.beatStatus.filter((b) => b.visualKind === "code").map((b) => b.sequence);
    const lastCode = allCodePlanned.length ? Math.max(...allCodePlanned) : -1;
    if (s.status === "complete" || s.status === "failed" || (lastCode >= 0 && s.contiguousReadyCount > lastCode)) break;
  }
  await page.waitForTimeout(15_000);
}
fs.writeFileSync(path.join(outDir, "lecture.json"), JSON.stringify(lecture, null, 2));

/* ── 4. the player renders the code board ────────────────────────────────── */
let rendered = null;
const play = page.getByRole("button", { name: "Play the lecture" });
if (await play.isVisible().catch(() => false)) await play.click().catch(() => {});
for (let step = 0; step < 14 && !rendered; step += 1) {
  // Each beat's board appears after its title card; give it a moment, then move on.
  for (let t = 0; t < 12; t += 1) {
    if (await page.locator('[data-board="code"]').first().isVisible().catch(() => false)) {
      rendered = await page.evaluate(() => {
        const board = document.querySelector('[data-board="code"]');
        return {
          lines: board.querySelectorAll("[data-line]").length,
          highlighted: [...board.querySelectorAll('[data-state="active"]')].map((l) => Number(l.dataset.line)),
          keywords: board.querySelectorAll(".hljs-keyword").length,
          fromDocumentChip: board.textContent.includes("From your document"),
          footer: board.querySelector("footer")?.textContent ?? "",
        };
      });
      await page.waitForTimeout(6000);
      await snap("lecture-code-board");
      break;
    }
    await page.waitForTimeout(1500);
  }
  if (rendered) break;
  const next = page.getByRole("button", { name: /Next concept/ });
  if (!(await next.isEnabled().catch(() => false))) break;
  await next.click();
  log("next beat");
}
log("rendered in player:", Boolean(rendered));

/* ── 5. a chat question about the code ───────────────────────────────────── */
let chatAnswer = null;
const chatInput = page.locator("#lesson-chat-input");
if (await chatInput.isVisible().catch(() => false)) {
  await chatInput.fill(process.env.CHAT_Q ?? "explain to me working of remove function");
  await chatInput.press("Enter");
  log("asked in chat");
  for (let t = 0; t < 120 && !explain; t += 1) await page.waitForTimeout(1000);
  await page.waitForTimeout(4000);
  const op = explain?.draw?.ops?.find((o) => o.kind === "codeBoard");
  chatAnswer = {
    boardKinds: explain?.draw?.ops?.map((o) => o.kind) ?? [],
    codeBoard: op?.spec ? { fromSource: op.spec.fromSource ?? false, lines: op.spec.code.split("\n").length, steps: op.spec.steps.length } : null,
    overlayShowsCode: await page.locator('[data-board="code"]').first().isVisible().catch(() => false),
    script: String(explain?.script ?? "").slice(0, 300),
    costUsd: explain?.costUsd ?? null,
  };
  await snap("chat-answer");
}

// Is the lecture about what the PAGES say? Facts that exist only in the page images.
let grounding = null;
if (GROUND.length && sessionId) {
  const s = await (await page.request.get(`${BASE}/api/progressive-lectures/${sessionId}`)).json().catch(() => null);
  const all = (s?.beats ?? []).map((b) => `${b.title} ${b.script}`).join(" ").toLowerCase();
  grounding = Object.fromEntries(GROUND.map((t) => [t, all.includes(t)]));
  fs.writeFileSync(path.join(outDir, "scripts.txt"), (s?.beats ?? []).map((b) => `## ${b.title}\n${b.script}`).join("\n\n"));
}

const summary = { grounding, voicePageSharing: consoleLines.slice(0, 10), bouncedToLanding: bounced, sessionId, lecture: lecture && { ...lecture, codeBoards: lecture.codeBoards.map(({ code, ...rest }) => rest) }, renderedInPlayer: rendered, chatAnswer, pageErrors: errors.slice(0, 5) };
fs.writeFileSync(path.join(outDir, "summary.json"), JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));
await browser.close();

/**
 * Plays a student through the planning conversation with Aria, end to end, and checks the result.
 * Needs `npm run dev` running and a test account.
 *
 *   node scripts/test-planning-chat.mjs <out-dir> <email> <password-file> [fake-mic.wav]
 *
 * What it checks, in the real app:
 *   - Aria's questions and the student's answers form ONE transcript; each question appears once.
 *   - Answers by chip and by typing both advance the conversation.
 *   - A profile and a plan are proposed IN the chat, with Accept / Change / Focus.
 *   - "Focus on…" revises the plan; "Accept and start" starts the lecture (no preview screen).
 *   - Afterwards: the learner memory holds what the conversation established, and the generated
 *     beats carry a board brief pitched for this student.
 *
 * A fake microphone (Chrome's --use-file-for-fake-audio-capture) lets Aria's live voice run; pass
 * a WAV of a spoken answer to test answering out loud.
 */
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";

const BASE = process.env.LAB_URL ?? "http://localhost:3000";
const [outDir, email, pwFile, micWav] = process.argv.slice(2);
if (!outDir || !email || !pwFile) {
  console.error("usage: test-planning-chat.mjs <out-dir> <email> <password-file> [fake-mic.wav]");
  process.exit(1);
}
fs.mkdirSync(outDir, { recursive: true });
const password = fs.readFileSync(pwFile, "utf8").trim();
const TOPIC = process.env.CHAT_TOPIC ?? "the difference between a Markov chain and an MDP";

/** The student's side of the conversation. Consistent with one person, so the profile can be checked. */
const ANSWERS = [
  "I know Markov chains well: states, transition matrices and stationary distributions. I have never studied MDPs or reinforcement learning.",
  "I think an MDP is basically just a Markov chain with more states.",
  "I'm not sure what a reward or a policy is, honestly.",
  "I want to understand it for my machine learning course.",
];

const args = ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--autoplay-policy=no-user-gesture-required"];
if (micWav) args.push(`--use-file-for-fake-audio-capture=${micWav}`);
const browser = await chromium.launch({ args });
const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 }, permissions: ["microphone"] });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
// The lecture this conversation starts, so its beats can be inspected afterwards.
let sessionId = null;
page.on("response", async (res) => {
  if (res.url().endsWith("/api/progressive-lectures") && res.request().method() === "POST") {
    sessionId = (await res.json().catch(() => ({}))).sessionId ?? null;
  }
});
let shot = 0;
const snap = async (name) => page.screenshot({ path: path.join(outDir, `${String(shot++).padStart(2, "0")}-${name}.png`) });
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

const login = await page.request.post(`${BASE}/api/auth/login`, { data: { email, password } });
log("login", login.status());
await page.goto(BASE);
await page.waitForTimeout(3000);

/* ── first-time setup, if shown ──────────────────────────────────────────── */
if (await page.getByText("Before we start.").isVisible().catch(() => false)) {
  await page.getByPlaceholder("Your name").fill("Sam");
  await page.getByText("None of these", { exact: true }).click();
  await page.getByRole("button", { name: /Start learning/ }).click();
  await page.waitForTimeout(3000);
  log("onboarding done");
}
await snap("home");

/* ── the topic ───────────────────────────────────────────────────────────── */
const topicBox = page.getByPlaceholder(/Krebs cycle/).first();
await topicBox.fill(TOPIC);
await topicBox.press("Enter");
log("topic submitted");

const chat = page.locator("[data-planning-chat]").first();
const bubbles = () => page.locator("[data-planning-chat] [data-chat-role]");
async function transcript() {
  const n = await bubbles().count();
  const out = [];
  for (let i = 0; i < n; i += 1) {
    const b = bubbles().nth(i);
    out.push({ role: await b.getAttribute("data-chat-role"), text: (await b.locator("p").first().innerText().catch(() => "")).trim() });
  }
  return out;
}
/** Wait for Aria to finish thinking and for a chip that can be pressed, or the plan. */
async function waitForTurn(timeout = 120_000) {
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    const busy = await page.getByText(/Aria is thinking…|Planning…|Drafting subtopic|Updating…/).first().isVisible().catch(() => false);
    const plan = await page.getByRole("button", { name: "Accept and start" }).last().isEnabled().catch(() => false);
    if (plan && !busy) return "plan";
    const input = page.getByPlaceholder(/Answer out loud, or type here…|What should the lesson focus on\?|Ask Aria to change the lesson…/).first();
    if (!busy && (await input.isEnabled().catch(() => false)) && (await chat.isVisible().catch(() => false))) {
      await page.waitForTimeout(800);
      return "question";
    }
    await page.waitForTimeout(700);
  }
  return "timeout";
}

/* ── the conversation ────────────────────────────────────────────────────── */
await chat.waitFor({ timeout: 90_000 });
await page.waitForTimeout(2500);
await snap("first-question");

// Question 1 is the depth question: answer with a chip, as a student would.
const depthChip = page.getByRole("button", { name: /^Intermediate/ }).first();
await depthChip.click({ timeout: 30_000 });
log("answered depth by chip: Intermediate");

let answered = 0;
for (let turn = 0; turn < 8; turn += 1) {
  const state = await waitForTurn();
  log("turn", turn, state);
  if (state !== "question") break;
  await snap(`question-${turn + 1}`);
  const answer = ANSWERS[Math.min(answered, ANSWERS.length - 1)];
  const input = page.getByPlaceholder("Answer out loud, or type here…");
  if (!(await input.isVisible().catch(() => false))) break;
  await input.fill(answer);
  await input.press("Enter");
  answered += 1;
  log("typed answer:", answer.slice(0, 60));
}

/* ── the plan, proposed in the chat ──────────────────────────────────────── */
const planState = await waitForTurn(240_000);
log("plan state", planState);
await snap("plan-proposed");

let revised = false;
if (planState === "plan") {
  const plansBefore = await page.getByRole("button", { name: "Accept and start" }).count();
  await page.getByRole("button", { name: "Focus on…" }).last().click();
  await page.waitForTimeout(800);
  const focusBox = page.getByPlaceholder("What should the lesson focus on?");
  await focusBox.fill("how actions and rewards turn a Markov chain into an MDP");
  await focusBox.press("Enter");
  log("asked to focus on actions and rewards");
  // A revised plan arrives as a NEW plan bubble; the old one's buttons are still on screen.
  const until = Date.now() + 240_000;
  while (Date.now() < until) {
    if ((await page.getByRole("button", { name: "Accept and start" }).count()) > plansBefore) {
      revised = true;
      break;
    }
    await page.waitForTimeout(1000);
  }
  await page.waitForTimeout(1500);
  log("revised plan arrived:", revised);
  await snap("plan-revised");
}

const finalTranscript = await transcript();
fs.writeFileSync(path.join(outDir, "transcript.json"), JSON.stringify(finalTranscript, null, 2));

/* ── accept: the lecture starts, with no preview screen in between ───────── */
let started = false;
if (revised || planState === "plan") {
  await page.getByRole("button", { name: "Accept and start" }).last().click();
  log("accepted the plan");
  for (let i = 0; i < 40; i += 1) {
    await page.waitForTimeout(3000);
    const onPlanning = await chat.isVisible().catch(() => false);
    if (!onPlanning) {
      started = true;
      break;
    }
  }
  await snap("after-accept");
}

/* ── the lecture: first beats only, each pitched for this student ─────────── */
let lecture = null;
if (sessionId) {
  log("lecture session", sessionId);
  const until = Date.now() + Number(process.env.LECTURE_WAIT_MS ?? 8 * 60_000);
  while (Date.now() < until) {
    const snap = await (await page.request.get(`${BASE}/api/progressive-lectures/${sessionId}`)).json().catch(() => null);
    if (snap && snap.beats?.length >= 2) {
      lecture = {
        plannedBeats: snap.plannedBeatCount,
        readyBeats: snap.contiguousReadyCount,
        beats: snap.beats.map((b) => ({
          title: b.title,
          words: String(b.script ?? "").split(/\s+/).length,
          boardBrief: b.learnerBrief ?? null,
          scriptStart: String(b.script ?? "").slice(0, 220),
        })),
      };
      break;
    }
    await page.waitForTimeout(10_000);
  }
  await snap("lecture");
}

/* ── what the system now knows about the student ─────────────────────────── */
await page.waitForTimeout(3000);
const memory = await (await page.request.get(`${BASE}/api/learner-memory`)).json();

const duplicateQuestions = finalTranscript
  .filter((b) => b.role === "aria")
  .map((b) => b.text)
  .filter((t, i, all) => all.indexOf(t) !== i);
const summary = {
  onePlanningChat: await chat.isVisible().catch(() => false) || started,
  ariaBubbles: finalTranscript.filter((b) => b.role === "aria").length,
  studentBubbles: finalTranscript.filter((b) => b.role === "you").length,
  duplicateAriaLines: duplicateQuestions,
  typedAnswers: answered,
  planProposedInChat: planState === "plan",
  profileSentence: finalTranscript.find((b) => /understood about you/.test(b.text))?.text.slice(0, 200) ?? null,
  focusRevisedPlan: revised,
  lectureStartedWithoutPreview: started,
  rememberedAtStart: finalTranscript.find((b) => /earlier lessons I remember/.test(b.text))?.text ?? null,
  lecture,
  memory: {
    concepts: Object.values(memory.memory?.concepts ?? {}).map((c) => `${c.label} ${c.mastery.toFixed(2)}`),
    misconceptions: (memory.memory?.misconceptions ?? []).map((m) => m.text),
    lastLevel: memory.memory?.lastLevel ?? null,
  },
  pageErrors: errors.slice(0, 5),
};
fs.writeFileSync(path.join(outDir, "summary.json"), JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));
await browser.close();

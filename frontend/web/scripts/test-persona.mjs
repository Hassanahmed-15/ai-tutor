/**
 * "What Aria thinks about you", end to end, in the real app. Needs `npm run dev` and a test account.
 *
 *   node scripts/test-persona.mjs <out-dir> <email> <password-file>
 *
 * What it checks:
 *   - The portrait is written and shown at the top of "What Aria remembers", from the database.
 *   - The student can rewrite it; the text survives a reload (it came back from the database) and a
 *     Refresh (Aria builds on it — it is still marked "In your own words").
 *   - Lessons and concepts sit below it, collapsed, and expand.
 *   - During planning, the portrait reaches the diagnose request, every outline request and the
 *     lecture request; the generated beats' board briefs carry its teaching plan.
 *   - Afterwards, the planning answers are in memory as the student's own words, and the portrait
 *     was refreshed from them.
 *
 * Starts one lecture; only its opening beats are generated (the student never advances).
 */
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";

const BASE = process.env.LAB_URL ?? "http://localhost:3000";
const [outDir, email, pwFile] = process.argv.slice(2);
if (!outDir || !email || !pwFile) {
  console.error("usage: test-persona.mjs <out-dir> <email> <password-file>");
  process.exit(1);
}
fs.mkdirSync(outDir, { recursive: true });
const password = fs.readFileSync(pwFile, "utf8").trim();
const TOPIC = process.env.CHAT_TOPIC ?? "value iteration in MDPs";
const NOTE = "I am a physics student. I like proofs and I want every idea tied to an equation I can derive.";
const ANSWERS = [
  "I know Markov chains and transition matrices well from my physics courses. I have never seen the Bellman equation.",
  "I think a policy is just the transition matrix of the chain.",
  "I want the derivation, not just the intuition — I am preparing for a machine learning exam.",
];

const browser = await chromium.launch({ args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--autoplay-policy=no-user-gesture-required"] });
const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 }, permissions: ["microphone"] });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
let shot = 0;
const snap = async (name) => page.screenshot({ path: path.join(outDir, `${String(shot++).padStart(2, "0")}-${name}.png`), fullPage: true });
// The settings sheet scrolls inside itself, so the memory panel is shot as an element.
const snapMemory = async (name) => page.locator("[data-learner-memory]").screenshot({ path: path.join(outDir, `${String(shot++).padStart(2, "0")}-${name}.png`) }).catch(() => snap(name));
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

/* ── what the page sends: does the portrait reach every step? ─────────────── */
const requests = [];
let sessionId = null;
page.on("request", (req) => {
  const url = req.url();
  // The lecture the page is watching, read off its event stream (surer than parsing the POST's reply).
  const watching = url.match(/\/api\/progressive-lectures\/([^/?]+)\/events/);
  if (watching) sessionId = decodeURIComponent(watching[1]);
  if (req.method() !== "POST") return;
  if (url.endsWith("/api/plan-lesson") || url.endsWith("/api/progressive-lectures") || url.endsWith("/api/learner-memory/session") || url.endsWith("/api/learner-memory/persona")) {
    let body = {};
    try { body = JSON.parse(req.postData() ?? "{}"); } catch { /* not JSON */ }
    requests.push({
      url: url.slice(BASE.length),
      mode: body.mode ?? null,
      hasPersona: typeof body.learnerPersona === "string" && body.learnerPersona.length > 0,
      personaChars: typeof body.learnerPersona === "string" ? body.learnerPersona.length : 0,
      conversation: Array.isArray(body.conversation) ? body.conversation.length : undefined,
    });
  }
});
page.on("response", async (res) => {
  if (res.url().endsWith("/api/progressive-lectures") && res.request().method() === "POST") {
    sessionId = (await res.json().catch(() => ({}))).sessionId ?? null;
  }
});

const login = await page.request.post(`${BASE}/api/auth/login`, { data: { email, password } });
log("login", login.status());
const memoryBefore = (await (await page.request.get(`${BASE}/api/learner-memory`)).json()).memory;

/* ── the panel: portrait on top, from the database ───────────────────────── */
async function openMemory() {
  await page.goto(BASE);
  // The account button appears once /api/auth/me answers, which the dev server can take seconds over.
  const settings = page.locator("button.absolute.right-5.top-5");
  await settings.waitFor({ timeout: 90_000 });
  await settings.click();
  await page.locator("[data-learner-memory]").waitFor({ timeout: 30_000 });
  // A stale portrait is rewritten on sight; wait for that to settle.
  for (let i = 0; i < 60; i += 1) {
    const busy = await page.getByText(/Updating|writing what she thinks/).first().isVisible().catch(() => false);
    if (!busy) break;
    await page.waitForTimeout(1000);
  }
  await page.waitForTimeout(500);
}
await openMemory();
const persona = page.locator("[data-persona]");
const shownFirst = await persona.isVisible().catch(() => false);
const summaryFirst = shownFirst ? (await persona.locator("p").first().innerText()).trim() : null;
log("portrait shown:", shownFirst, "|", summaryFirst?.slice(0, 120));
await snapMemory("memory-portrait");

// Lessons and concepts are below, collapsed; they open.
const lessonsToggle = page.getByRole("button", { name: /Lessons with Aria/ });
const conceptsToggle = page.getByRole("button", { name: /What you.ve covered/ });
const collapsed = (await lessonsToggle.getAttribute("aria-expanded").catch(() => null)) === "false" && (await conceptsToggle.getAttribute("aria-expanded").catch(() => null)) === "false";
await lessonsToggle.click().catch(() => {});
await conceptsToggle.click().catch(() => {});
await page.waitForTimeout(400);
const conceptLabels = await page.locator("[data-learner-memory] li span[title]").allInnerTexts().catch(() => []);
await snapMemory("memory-expanded");

/* ── the student rewrites it; it survives a reload and a refresh ─────────── */
await page.getByRole("button", { name: "Edit", exact: true }).click();
await page.getByLabel("What Aria thinks about you, in your own words").fill(NOTE);
await page.getByRole("button", { name: "Save", exact: true }).click();
await page.waitForTimeout(2000);
const afterEdit = (await persona.locator("p").first().innerText()).trim();
await snapMemory("memory-edited");
await openMemory();
const afterReload = (await persona.locator("p").first().innerText()).trim();
const ownWordsAfterReload = await page.getByText(/In your own words/).isVisible().catch(() => false);
log("edit kept after reload:", afterReload === NOTE, "| in your own words:", ownWordsAfterReload);
await page.getByRole("button", { name: "Refresh", exact: true }).click();
for (let i = 0; i < 60; i += 1) {
  await page.waitForTimeout(1000);
  if (!(await page.getByText(/Updating/).first().isVisible().catch(() => false))) break;
}
await page.waitForTimeout(500);
const afterRefresh = (await persona.locator("p").first().innerText()).trim();
const ownWordsAfterRefresh = await page.getByText(/In your own words/).isVisible().catch(() => false);
log("after refresh:", afterRefresh.slice(0, 140), "| still in own words:", ownWordsAfterRefresh);
await snapMemory("memory-refreshed");
await page.getByRole("button", { name: "Close" }).first().click().catch(() => {});

/* ── planning: the portrait goes to every step ───────────────────────────── */
await page.goto(BASE);
await page.waitForTimeout(2000);
const topicBox = page.getByPlaceholder(/Krebs cycle/).first();
await topicBox.fill(TOPIC);
await topicBox.press("Enter");
log("topic submitted");
const chat = page.locator("[data-planning-chat]").first();
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
await chat.waitFor({ timeout: 90_000 });
await page.waitForTimeout(2500);
await page.getByRole("button", { name: /^Intermediate/ }).first().click({ timeout: 30_000 });
let answered = 0;
for (let turn = 0; turn < 8; turn += 1) {
  const state = await waitForTurn();
  log("turn", turn, state);
  if (state !== "question") break;
  const input = page.getByPlaceholder("Answer out loud, or type here…");
  if (!(await input.isVisible().catch(() => false))) break;
  await input.fill(ANSWERS[Math.min(answered, ANSWERS.length - 1)]);
  await input.press("Enter");
  answered += 1;
}
const planState = await waitForTurn(240_000);
log("plan state", planState);
await snap("plan-proposed");
let started = false;
if (planState === "plan") {
  await page.getByRole("button", { name: "Accept and start" }).last().click();
  for (let i = 0; i < 40; i += 1) {
    await page.waitForTimeout(3000);
    if (!(await chat.isVisible().catch(() => false))) { started = true; break; }
  }
  await snap("after-accept");
}

/* ── the lecture's opening beats carry the teaching plan on their board brief ─ */
let lecture = null;
if (sessionId) {
  log("lecture session", sessionId);
  const until = Date.now() + Number(process.env.LECTURE_WAIT_MS ?? 6 * 60_000);
  while (Date.now() < until) {
    const s = await (await page.request.get(`${BASE}/api/progressive-lectures/${sessionId}`)).json().catch(() => null);
    if (s && s.beats?.length >= 2) {
      lecture = {
        plannedBeats: s.plannedBeatCount,
        beats: s.beats.map((b) => ({ title: b.title, boardBrief: b.learnerBrief ?? null, scriptStart: String(b.script ?? "").slice(0, 200) })),
      };
      break;
    }
    await page.waitForTimeout(8000);
  }
  await snap("lecture");
}

/* ── memory afterwards: the answers are the student's words; the portrait moved on ─ */
await page.waitForTimeout(6000);
const memoryAfter = (await (await page.request.get(`${BASE}/api/learner-memory`)).json()).memory;

const summary = {
  portraitShownFirst: shownFirst,
  summaryFirst,
  lessonsAndConceptsCollapsed: collapsed,
  conceptLabels,
  editApplied: afterEdit === NOTE,
  editKeptAfterReload: afterReload === NOTE,
  ownWordsAfterReload,
  refreshBuiltOnNote: afterRefresh !== NOTE && ownWordsAfterRefresh,
  afterRefresh,
  requests,
  personaReached: {
    diagnose: requests.some((r) => r.mode === "diagnose" && r.hasPersona),
    outline: requests.some((r) => (r.mode === "outline" || r.mode === "document-question") && r.hasPersona),
    lecture: requests.some((r) => r.url === "/api/progressive-lectures" && r.hasPersona),
    sessionConversationLines: requests.find((r) => r.url === "/api/learner-memory/session")?.conversation ?? 0,
  },
  lectureStarted: started,
  lecture,
  boardBriefsCarryTeachingPlan: lecture ? lecture.beats.every((b) => /From earlier lessons with this student/.test(b.boardBrief ?? "")) : null,
  memory: {
    excerptsBefore: (memoryBefore?.excerpts ?? []).length,
    excerptsAfter: (memoryAfter?.excerpts ?? []).length,
    excerpts: (memoryAfter?.excerpts ?? []).slice(-5).map((e) => `[${e.source}] ${e.text.slice(0, 80)}`),
    personaGeneratedAtBefore: memoryBefore?.persona?.generatedAt ?? null,
    personaGeneratedAtAfter: memoryAfter?.persona?.generatedAt ?? null,
    studentNoteKept: memoryAfter?.persona?.studentNote === NOTE,
    personaSummaryAfter: memoryAfter?.persona?.summary ?? null,
    concepts: Object.values(memoryAfter?.concepts ?? {}).map((c) => c.label),
  },
  pageErrors: errors.slice(0, 5),
};
fs.writeFileSync(path.join(outDir, "summary.json"), JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));
await browser.close();

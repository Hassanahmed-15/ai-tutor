/**
 * END-TO-END CHECK OF "ASK, READ UP, TEACH, CITE" (lib/lessonIntent.ts, lib/webResearch.ts,
 * lib/webSources.ts) on a running app, as a real student.
 *
 *   node scripts/test-intent-research.mjs "<prompt>" <email> <password-file> [out-dir] [--expect a,b,c] [--boards n]
 *
 * Types the prompt on the home page, answers every question Aria asks with its first suggested
 * answer (logging each), records what the research found and how much of the syllabus the outline
 * covers, presses Start, then waits for the first boards and checks that every slide carries its
 * sources — and screenshots one, so the "Sources:" line can be seen under the board.
 *
 * --expect: terms the OUTLINE must name (case-insensitive), e.g. "vena cava,aorta,double circulation".
 * --boards: how many written boards to wait for before checking (default 3).
 * LAB_URL sets the target (default http://localhost:3000). Each run generates one real lecture.
 */
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const BASE = process.env.LAB_URL ?? "http://localhost:3000";
const argv = process.argv.slice(2);
const flag = (name) => {
  const i = argv.indexOf(name);
  if (i < 0) return null;
  const value = argv[i + 1];
  argv.splice(i, 2);
  return value;
};
const expect = (flag("--expect") ?? "").split(",").map((t) => t.trim().toLowerCase()).filter(Boolean);
const wantBoards = Number(flag("--boards") ?? 3);
const [prompt, email, pwFile, outDir = path.resolve("intent-research-out")] = argv;
if (!prompt || !email || !pwFile) {
  console.error('usage: node scripts/test-intent-research.mjs "<prompt>" <email> <password-file> [out-dir] [--expect a,b] [--boards n]');
  process.exit(2);
}
fs.mkdirSync(outDir, { recursive: true });
const started = Date.now();
const log = (line) => console.log(`[${String(Math.round((Date.now() - started) / 1000)).padStart(4)}s] ${line}`);
const problems = [];

const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.addInitScript(() => {
  try {
    localStorage.setItem("aria.guide.seen", "1");
    localStorage.setItem("aria.theme", "light");
  } catch {}
});
const login = await ctx.request.post(`${BASE}/api/auth/login`, { data: { email, password: fs.readFileSync(pwFile, "utf8").trim() } });
if (!login.ok()) throw new Error(`login failed: ${login.status()}`);
const page = await ctx.newPage();

// What the planner was asked and answered, read off the network.
let payload = null;
let sessionId = null;
let outlineEvent = null;
const thoughts = [];
page.on("response", async (response) => {
  const url = response.url();
  const request = response.request();
  if (request.method() !== "POST") return;
  if (url.endsWith("/api/plan-lesson")) {
    const body = JSON.parse(request.postData() ?? "{}");
    if (body.mode === "intent") {
      const json = await response.json().catch(() => ({}));
      log(`intent round ${(body.exchanges ?? []).length + 1}: brief ${JSON.stringify(json.brief ?? {})}${json.question ? ` — asks "${json.question.question}" [${(json.question.options ?? []).join(" | ")}]` : " — complete"}`);
    } else if (body.mode === "outline") {
      log(`outline requested: research=${Boolean(body.research)} brief=${JSON.stringify(body.brief ?? null)}`);
      const text = await response.text().catch(() => "");
      for (const line of text.split("\n").filter(Boolean)) {
        const event = JSON.parse(line);
        if ((event.type === "thought" || event.type === "status") && event.text) thoughts.push(event.text);
        if (event.type === "outline") outlineEvent = event;
      }
    } else if (body.mode === "diagnose" || body.mode === "clarify" || body.mode === "subject") {
      log(`${body.mode}`);
    }
  }
  if (url.endsWith("/api/progressive-lectures")) {
    payload = JSON.parse(request.postData() ?? "{}");
    sessionId = (await response.json().catch(() => ({}))).sessionId ?? null;
  }
});

await page.goto(BASE, { waitUntil: "domcontentloaded" });
await page.locator("#brief").waitFor({ timeout: 90_000 });
await page.locator("#brief").fill(prompt);
await page.locator("#brief").press("Enter");
log(`typed "${prompt}"`);

// Answer every question with its first suggestion until the outline's Start button is ready.
const build = page.getByRole("button", { name: /^\s*(?:Build lesson|Start)\s*$/i }).first();
let answered = 0;
for (let i = 0; i < 300 && !payload; i++) {
  await page.waitForTimeout(1000);
  if (outlineEvent && await build.isVisible().catch(() => false) && await build.isEnabled().catch(() => false) && !(await page.getByText("Planning…").isVisible().catch(() => false))) {
    const summary = page.locator("[data-outline-research] summary");
    if (await summary.isVisible().catch(() => false)) {
      await summary.click();
      await page.waitForTimeout(400);
    }
    await page.screenshot({ path: path.join(outDir, "outline.png"), fullPage: true });
    await build.click();
    break;
  }
  const option = page.locator("button:has(span:text-is('A'))").first();
  if (await option.isVisible().catch(() => false) && await option.isEnabled().catch(() => false)) {
    const label = (await option.innerText().catch(() => "")).replace(/^A\s*/, "").replace(/\s+/g, " ").trim();
    await option.click().catch(() => {});
    answered++;
    log(`answered: "${label}"`);
    await page.waitForTimeout(1500);
  }
}
if (!outlineEvent) {
  await page.screenshot({ path: path.join(outDir, "stuck.png") });
  throw new Error("no outline arrived; see stuck.png");
}

// The outline: what it teaches, what the research found, how much of the syllabus it covers.
const titles = (outlineEvent.subtopics ?? []).map((s) => `${s.title} — ${s.caption}`);
log(`thoughts: ${thoughts.map((t) => `"${t}"`).join(" | ")}`);
log(`outline (${titles.length} parts):\n    ${titles.join("\n    ")}`);
const research = outlineEvent.research;
if (research) {
  log(`research: ${research.sources.length} sources, ${research.points.length} points, curriculum ${research.curriculum ?? "-"}`);
  for (const s of research.sources) log(`    [${s.id}] ${s.site} — ${s.title} <${s.url}>`);
  log(`checklist (${research.checklist.length}): ${research.checklist.join("; ")}`);
} else problems.push("the outline came without web research");
if (outlineEvent.coverage) log(`coverage: ${outlineEvent.coverage.covered}/${outlineEvent.coverage.total}${outlineEvent.coverage.missing.length ? ` — missing: ${outlineEvent.coverage.missing.join("; ")}` : ""}`);
const outlineText = titles.join(" ").toLowerCase();
const missingTerms = expect.filter((term) => !outlineText.includes(term));
if (expect.length) log(`expected terms in the outline: ${expect.length - missingTerms.length}/${expect.length}${missingTerms.length ? ` — missing: ${missingTerms.join(", ")}` : ""}`);
if (missingTerms.length) problems.push(`outline misses: ${missingTerms.join(", ")}`);
fs.writeFileSync(path.join(outDir, "outline.json"), JSON.stringify(outlineEvent, null, 1));

for (let i = 0; i < 120 && !sessionId; i++) await page.waitForTimeout(1000);
if (!payload || !sessionId) {
  await page.screenshot({ path: path.join(outDir, "stuck-start.png") });
  throw new Error("no lecture was started");
}
log(`lecture ${sessionId}: webSources ${payload.webSources ? `${payload.webSources.sources.length} sources` : "NONE"}`);
if (!payload.webSources) problems.push("the lecture was built without its web sources");

// Wait for the first boards and check each carries its sources.
let snapshot = null;
for (let i = 0; i < 160; i++) {
  await page.waitForTimeout(5000);
  const response = await page.request.get(`${BASE}/api/progressive-lectures/${encodeURIComponent(sessionId)}`, { timeout: 60_000 }).catch(() => null);
  if (response?.ok()) snapshot = await response.json();
  if (snapshot?.error) { problems.push(`the lecture failed: ${snapshot.error}`); break; }
  const written = (snapshot?.beats ?? []).filter((b) => b?.draw);
  if (written.length >= wantBoards) break;
  const play = page.getByRole("button", { name: /^Play the lecture$/ }).first();
  if (await play.isVisible().catch(() => false) && await play.isEnabled().catch(() => false)) await play.click().catch(() => {});
}
const boards = (snapshot?.beats ?? []).filter((b) => b?.draw);
log(`${boards.length} board(s) written`);
for (const beat of boards) {
  const cited = beat.sources ?? [];
  log(`  "${beat.title}": ${cited.length ? cited.map((s) => `${s.site} — ${s.title}`).join(" · ") : "NO SOURCES"}`);
  if (!cited.length) problems.push(`board "${beat.title}" has no sources`);
}

// The "Sources:" line under the board the student is looking at.
const play = page.getByRole("button", { name: /^Play the lecture$/ }).first();
if (await play.isVisible().catch(() => false)) await play.click().catch(() => {});
const line = page.locator("[data-slide-sources]").first();
await line.waitFor({ timeout: 120_000 }).catch(() => {});
if (await line.isVisible().catch(() => false)) {
  log(`on screen: ${(await line.innerText()).replace(/\s+/g, " ")}`);
  const links = await line.locator("a").evaluateAll((as) => as.map((a) => ({ href: a.href, target: a.target })));
  if (!links.every((l) => /^https?:/.test(l.href) && l.target === "_blank")) problems.push("a source link is not a real link opening in a new tab");
} else problems.push("no Sources line on screen");
await page.waitForTimeout(3000);
await page.screenshot({ path: path.join(outDir, "slide.png") });

await browser.close();
log(problems.length ? `PROBLEMS:\n  - ${problems.join("\n  - ")}` : "ALL CHECKS PASSED");
process.exit(problems.length ? 1 : 0);

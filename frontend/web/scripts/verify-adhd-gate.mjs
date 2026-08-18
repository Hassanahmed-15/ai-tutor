/**
 * End-to-end verification that the ADHD track is driven by the SAVED PROFILE and by nothing else.
 * Needs `npm run dev` running with COSMOS_CONNECTION_STRING set.
 *
 *   node scripts/verify-adhd-gate.mjs [screenshot-dir]
 *
 * WHY THIS EXISTS. The bug being fixed was not "the code looks wrong" — the code looked fine. An
 * account carried `accessibility: "adhd"` in Cosmos and still got the standard lecture, because the
 * value was written at onboarding and read by nothing. Unit tests cannot catch that class of fault:
 * `trackForProfile` was correct in isolation the whole time; the page simply never called it.
 *
 * So this drives the real stack — real signup, real Cosmos write, real session cookie, real render —
 * and asserts on what a learner would actually see.
 *
 * BOTH DIRECTIONS. The interesting failure is not "an ADHD learner got nothing". It is "everyone
 * else got ADHD UI they never asked for", which is invisible if you only ever test the happy path.
 *
 * Test accounts are created with an obvious prefix and DELETED at the end — the Cosmos account is
 * shared with the team, so leaving debris in `users` is not acceptable.
 */
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { CosmosClient } from "@azure/cosmos";

const BASE = process.env.LAB_URL ?? "http://localhost:3000";
const OUT = process.argv[2] ?? ".";
const STAMP = Date.now();
/**
 * Obvious, greppable, and unmistakably not a real learner — while fitting the username rules the
 * signup route enforces: 3-24 chars of letters, numbers, hyphen or underscore. The full millisecond
 * stamp blew that limit, so only its tail is used; it still only has to be unique within one run.
 */
const PREFIX = `zzgate-${String(STAMP).slice(-8)}`;

let failures = 0;
const results = [];
function check(name, ok, detail) {
  if (!ok) failures++;
  results.push(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `\n        ${detail}` : ""}`);
}

/** Sign up through the real API and set the profile through the real onboarding route. */
async function makeLearner(page, suffix, accessibility) {
  const email = `${PREFIX}-${suffix}@example.invalid`;
  // Hyphens are legal here, so they are kept rather than stripped — stripping them was what pushed
  // the name past 24 characters and got every signup rejected.
  const username = `${PREFIX}-${suffix}`.slice(0, 24);
  const password = `Test-${STAMP}-pw!`;

  const signup = await page.request.post(`${BASE}/api/auth/signup`, {
    data: { email, password, username },
  });
  if (!signup.ok()) throw new Error(`signup ${suffix} failed: ${signup.status()} ${await signup.text()}`);

  const onboard = await page.request.post(`${BASE}/api/onboarding`, {
    data: { displayName: `Gate ${suffix}`, age: 20, accessibility },
  });
  if (!onboard.ok()) throw new Error(`onboarding ${suffix} failed: ${onboard.status()} ${await onboard.text()}`);

  return { email, username, password };
}

/** What the server believes about the signed-in learner. */
async function readProfile(page) {
  const res = await page.request.get(`${BASE}/api/auth/me`);
  return res.ok() ? await res.json() : null;
}


/**
 * The decisive assertion, and it costs nothing.
 *
 * The landing page is the topic-entry screen and is IDENTICAL for every profile — the ADHD player
 * only exists once a lecture is generated. A first version of this script asserted ADHD copy on that
 * landing page and failed for that reason, and its "the two pages differ" check passed only because
 * the two accounts had different display names. Both were testing nothing.
 *
 * `LearnPage` builds `mood` from the RESOLVED track (`${selectedMode.name} learning mode: ...`) and
 * sends it to /api/generate-lecture. So intercepting that request reveals exactly which track
 * `trackForProfile` returned — through the real page, the real profile and the real session — and
 * the request is then aborted, so nothing is generated and nothing is billed.
 */
async function resolvedTrackFor(page) {
  let mood = null;
  // Every API POST is recorded, not just the one expected. When `mood` came back null the first
  // time there was no way to tell whether the request was never made, made to a different route, or
  // made after the wait expired — three very different bugs that look identical from one null.
  const seen = [];
  page.on("request", (r) => {
    if (r.method() === "POST" && r.url().includes("/api/")) seen.push(r.url().replace(BASE, ""));
  });

  await page.route("**/api/generate-lecture", async (route) => {
    try {
      mood = JSON.parse(route.request().postData() || "{}").mood ?? null;
    } catch { mood = "(unparseable body)"; }
    // Abort rather than fulfil: a real lecture is ~4 minutes and ~$1, and the answer is already in
    // the request body.
    await route.abort();
  });

  // A <textarea>, not an <input> — the first selector here assumed input[type=text] and simply
  // timed out, which is the failure mode of guessing at a selector instead of reading the markup.
  const topic = page.locator("textarea").first();
  await topic.waitFor({ state: "visible", timeout: 30_000 });
  await topic.fill("the water cycle");
  await page.keyboard.press("Enter");
  // Generation is kicked off from LearnPage after the landing hand-off, so allow for the route
  // change before concluding the request was never made.
  await page.waitForTimeout(12_000);
  if (mood === null) console.log(`        [diagnostic] API POSTs seen: ${seen.join(", ") || "(none)"}`);
  return mood;
}

const browser = await chromium.launch();
const created = [];

try {
  /* ── 1. An ADHD profile reaches the ADHD player ────────────────────────── */
  const adhdCtx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const adhd = await adhdCtx.newPage();
  const adhdErrors = [];
  adhd.on("pageerror", (e) => adhdErrors.push(e.message));

  await adhd.goto(BASE, { waitUntil: "domcontentloaded" });
  const adhdUser = await makeLearner(adhd, "yes", "adhd");
  created.push(adhdUser);

  const adhdMe = await readProfile(adhd);
  check(
    "the adhd profile actually persisted to Cosmos",
    adhdMe?.profile?.accessibility === "adhd",
    `/api/auth/me reports: ${JSON.stringify(adhdMe?.profile?.accessibility)}`,
  );

  await adhd.goto(BASE, { waitUntil: "domcontentloaded" });
  await adhd.waitForTimeout(3500);
  await adhd.screenshot({ path: `${OUT}/adhd-gate-open.png`, fullPage: false });

  const adhdMood = await resolvedTrackFor(adhd);
  check(
    "an adhd profile resolves to the ADHD track",
    typeof adhdMood === "string" && adhdMood.startsWith("ADHD learning mode"),
    `mood sent to generation: ${JSON.stringify(adhdMood)}`,
  );
  check("no page errors on the ADHD path", adhdErrors.length === 0, adhdErrors.slice(0, 2).join(" | "));

  /* ── 2. A NON-ADHD profile must see none of it ─────────────────────────── */
  const plainCtx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const plain = await plainCtx.newPage();
  const plainErrors = [];
  plain.on("pageerror", (e) => plainErrors.push(e.message));

  await plain.goto(BASE, { waitUntil: "domcontentloaded" });
  const plainUser = await makeLearner(plain, "no", "none");
  created.push(plainUser);

  const plainMe = await readProfile(plain);
  check(
    "the 'none' profile persisted as 'none', not as null",
    plainMe?.profile?.accessibility === "none",
    `/api/auth/me reports: ${JSON.stringify(plainMe?.profile?.accessibility)}`,
  );

  await plain.goto(BASE, { waitUntil: "domcontentloaded" });
  await plain.waitForTimeout(3500);
  await plain.screenshot({ path: `${OUT}/adhd-gate-closed.png`, fullPage: false });

  // The leak direction — the failure that only shows up if you test it deliberately.
  const plainMood = await resolvedTrackFor(plain);
  check(
    "a 'none' profile does NOT get the ADHD track",
    typeof plainMood === "string" && !plainMood.startsWith("ADHD learning mode"),
    `mood sent to generation: ${JSON.stringify(plainMood)}`,
  );
  check(
    "and lands on Standard instead",
    typeof plainMood === "string" && plainMood.startsWith("Standard learning mode"),
    `mood sent to generation: ${JSON.stringify(plainMood)}`,
  );
  check("no page errors on the standard path", plainErrors.length === 0, plainErrors.slice(0, 2).join(" | "));

  /* ── 3. The two learners genuinely diverged ────────────────────────────── */
  // Guards against the suite passing because both paths resolve to the same thing. The earlier
  // version of this compared page TEXT, which differed only by display name and would have passed
  // even with the gate deleted entirely.
  check(
    "the two profiles resolve to genuinely different tracks",
    adhdMood !== plainMood && typeof adhdMood === "string" && typeof plainMood === "string",
    `adhd: ${JSON.stringify(adhdMood)}
        none: ${JSON.stringify(plainMood)}`,
  );

  await adhdCtx.close();
  await plainCtx.close();
} finally {
  await browser.close();

  /* ── Clean up: the Cosmos account is shared. ───────────────────────────── */
  try {
    const env = readFileSync(".env.local", "utf8");
    const conn = (env.match(/^COSMOS_CONNECTION_STRING=(.+)$/m) || [])[1];
    if (conn) {
      const users = new CosmosClient(conn.trim()).database("aria").container("users");
      const { resources } = await users.items
        .query({ query: "SELECT c.id FROM c WHERE STARTSWITH(c.username, @p)", parameters: [{ name: "@p", value: PREFIX }] })
        .fetchAll();
      for (const r of resources) await users.item(r.id, r.id).delete();
      console.log(`\ncleaned up ${resources.length} test account(s)`);
    }
  } catch (e) {
    console.log(`\n⚠ cleanup failed — remove accounts starting "${PREFIX}" by hand: ${e.message}`);
  }
}

console.log(results.join("\n"));
console.log(`\n${results.length - failures}/${results.length} checks passed`);
process.exit(failures ? 1 : 0);

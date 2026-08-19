/**
 * Browser verification for the ADHD surface. Needs `npm run dev` with Cosmos configured.
 *
 *   node scripts/verify-adhd-ui.mjs <screenshot-dir>
 *
 * WHY BOUNDING BOXES AND NOT JUST SCREENSHOTS. Every layout defect in this feature so far — the score
 * chip clipping the board frame, the park button cut in half by the dev bubble, the companion landing
 * inside the Ask-Aria sidebar — shipped with a fully green test suite and was found by a human
 * looking at a picture. So the layout assertions here MEASURE overlap rather than trusting that it
 * looks fine, and screenshots are kept for what measurement cannot judge.
 *
 * Test accounts are prefixed and deleted at the end: the Cosmos instance is shared with the team.
 */
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { CosmosClient } from "@azure/cosmos";

const BASE = process.env.LAB_URL ?? "http://localhost:3000";
const OUT = process.argv[2] ?? ".";
const STAMP = Date.now();
const PREFIX = `zzui-${String(STAMP).slice(-8)}`;

let failures = 0;
const results = [];
const check = (name, ok, detail) => {
  if (!ok) failures++;
  results.push(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `\n        ${detail}` : ""}`);
};

const TITLES = ["What bonding is", "Ionic bonds", "Covalent bonds", "Electronegativity",
                "Lattice energy", "Bond polarity", "Metallic bonds", "Recap"];
const BEATS = TITLES.map((title, i) => ({
  id: `b${i}`, title,
  script: "Atoms join by sharing or giving up electrons, and the balance decides the bond.",
  slideKind: "concept", points: [], teacherMove: "explain",
  draw: { caption: "b", durationMs: 12000, ops: [{ kind: "label", text: "Bonding", x: 50, y: 40, at: 0 }] },
}));

async function makeLearner(page, suffix, accessibility) {
  const email = `${PREFIX}-${suffix}@example.invalid`;
  const username = `${PREFIX}-${suffix}`.slice(0, 24);
  const r = await page.request.post(`${BASE}/api/auth/signup`, {
    data: { email, password: `Test-${STAMP}-pw!`, username },
  });
  if (!r.ok()) throw new Error(`signup ${suffix}: ${r.status()} ${await r.text()}`);
  const o = await page.request.post(`${BASE}/api/onboarding`, {
    data: { displayName: `UI ${suffix}`, age: 20, accessibility },
  });
  if (!o.ok()) throw new Error(`onboarding ${suffix}: ${o.status()} ${await o.text()}`);
}

/** Drive landing -> outline -> steering -> consent. Returns the consent button. */
async function intoLecture(page) {
  await page.route("**/api/generate-lecture", (r) =>
    r.fulfill({ status: 200, contentType: "application/json",
                body: JSON.stringify({ topic: "demo", costUsd: 0, beats: BEATS }) }));
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2500);
  const ta = page.locator("textarea").first();
  await ta.waitFor({ state: "visible", timeout: 30000 });
  await ta.fill("explain me ionic and covalent bonds");
  await page.keyboard.press("Enter");
  const build = page.getByRole("button", { name: /build lesson/i });
  await build.waitFor({ state: "visible", timeout: 180000 });
  await build.click();
  const aria = page.getByRole("button", { name: /use aria.s choice/i });
  await aria.waitFor({ state: "visible", timeout: 180000 });
  await aria.click();
  const consent = page.getByRole("button", { name: /not now/i });
  await consent.waitFor({ state: "visible", timeout: 180000 });
  return consent;
}

const browser = await chromium.launch({
  // Without this Chromium blocks narration from starting, and the lip-sync check below would fail
  // for a reason that has nothing to do with lip sync.
  args: ["--autoplay-policy=no-user-gesture-required"],
});
try {
  const ctx = await browser.newContext({ viewport: { width: 1320, height: 820 } });
  const page = await ctx.newPage();
  const errs = [];
  /*
   * KNOWN, and each one verified to be pre-existing rather than assumed:
   *  - GEMINI_API_KEY / Connection failed: the key is unset in this environment, by arrangement.
   *  - "Only plain objects…": reproduced on a SIGNED-OUT landing page with no ADHD code mounted,
   *    so it belongs to the app's existing server/client boundary, not to this feature.
   *  - "Failed to load resource": the URL is not in the console text, so it is checked properly
   *    through the response listener below instead of being pattern-matched here.
   */
  const KNOWN = /GEMINI_API_KEY|Connection failed|Only plain objects can be passed|Failed to load resource/;
  const badResponses = [];
  page.on("response", (r) => {
    // The Gemini token route 503s without a key — the one expected failure.
    if (r.status() >= 400 && !/gemini-live-token/.test(r.url())) {
      badResponses.push(`${r.status()} ${r.url().replace(BASE, "")}`);
    }
  });
  page.on("pageerror", (e) => { if (!KNOWN.test(e.message)) errs.push(`uncaught: ${e.message}`); });
  /*
   * Console errors too, not just uncaught exceptions.
   *
   * The suite watched `pageerror` alone and reported the page clean while Next's dev overlay showed
   * "2 Issues" — because React logs invalid DOM, duplicate keys and hydration mismatches through
   * console.error, which never becomes an uncaught exception. That is exactly how two avatars
   * sharing the gradient id "av-face" went unnoticed by a green run.
   */
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    const t = m.text();
    if (!KNOWN.test(t)) errs.push(`console: ${t.slice(0, 200)}`);
  });

  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await makeLearner(page, "yes", "adhd");

  const consent = await intoLecture(page);
  await page.screenshot({ path: `${OUT}/ui-1-consent.png` });
  check("camera consent is asked before the lecture", (await consent.count()) === 1);
  await consent.click(); // decline — this path must stay first-class

  const start = page.getByRole("button", { name: /start lecture/i });
  if (await start.count()) await start.click();
  await page.waitForTimeout(30000);
  await page.screenshot({ path: `${OUT}/ui-2-playing.png` });

  const geom = await page.evaluate(() => {
    const txt = (el) => (el?.textContent ?? "").trim();
    const all = [...document.querySelectorAll("div,button,span")];
    const chip = all.find((e) => /\d+\s*XP/.test(txt(e)) && txt(e).length < 60);
    const park = all.find((e) => e.tagName === "BUTTON" && /park a thought/i.test(txt(e)));
    const caption = all.find((e) => /electrons/i.test(txt(e)) && txt(e).length < 400);
    // Pip by its title, not its emoji: the face changes with focus state, the title does not.
    const pip = all.find((e) => /^Pip is /.test(e.getAttribute("title") ?? ""));
    // The board's renderer badge ("SVG", "React · SVG", ...) — standard chrome the ADHD row must
    // not cover. Selected by its distinctive tracking class, since its text varies by renderer.
    const badge = document.querySelector('[class*="tracking-[0.14em]"]');
    const board = document.querySelector("section");
    const box = (e) => {
      if (!e) return null;
      const b = e.getBoundingClientRect();
      return { x: b.x, y: b.y, right: b.right, bottom: b.bottom, w: b.width, h: b.height };
    };
    return { chip: box(chip), park: box(park), caption: box(caption), board: box(board),
             pip: box(pip), badge: box(badge), chipText: txt(chip).slice(0, 40) };
  });

  const overlaps = (a, b) => !!a && !!b && a.x < b.right && a.right > b.x && a.y < b.bottom && a.bottom > b.y;

  check("the score chip renders", !!geom.chip, geom.chipText || "not found");
  check("the score chip does NOT overlap the board", !overlaps(geom.chip, geom.board),
        geom.chip ? `chip.bottom=${Math.round(geom.chip.bottom)} board.y=${Math.round(geom.board?.y ?? 0)}` : "");
  /**
   * Assert the POSITION, not the absence of a collision with a transient element.
   *
   * The first version compared the park button against the caption bar and reported "no caption on
   * screen" as a PASS — so it went green precisely when it could not see the thing it was checking,
   * which is a check that cannot fail rather than one that passed.
   *
   * The overlays were deliberately moved to the board's TOP half, because the bottom belongs to the
   * caption bar and the quiz panel. That is a fixed, checkable claim.
   */
  const boardMid = geom.board ? geom.board.y + geom.board.h / 2 : 0;
  check("the park button exists and sits in the board's top half, clear of the caption and quiz",
        !!geom.park && !!geom.board && geom.park.bottom < boardMid,
        geom.park ? `park.bottom=${Math.round(geom.park.bottom)} boardMid=${Math.round(boardMid)}` : "park button not found");
  check("the park button is fully on screen, not clipped",
        !!geom.park && geom.park.x >= 0 && geom.park.y >= 0 && geom.park.w > 80,
        geom.park ? `x=${Math.round(geom.park.x)} w=${Math.round(geom.park.w)}` : "");
  // Pip and the park button were two independently hand-placed absolutes at left-6 and left-[74px] —
  // magic numbers tuned against each other, which held only while Pip stayed exactly one avatar
  // wide. They are one flex row now; this pins that they stay laid out.
  check("Pip renders and does NOT overlap the park button", !!geom.pip && !overlaps(geom.pip, geom.park),
        geom.pip && geom.park ? `pip.right=${Math.round(geom.pip.right)} park.x=${Math.round(geom.park.x)}` : "Pip not found");
  // The ADHD overlay must not damage the standard lesson chrome. An 88px Pip at top-[108px] sat
  // squarely on the board's renderer badge and hid it.
  check("the ADHD row does NOT cover the board's renderer badge", !overlaps(geom.pip, geom.badge),
        geom.badge && geom.pip ? `badge.bottom=${Math.round(geom.badge.bottom)} pip.y=${Math.round(geom.pip.y)}` : "badge not found");
  check("nothing is positioned off-screen", !geom.chip || (geom.chip.x >= 0 && geom.chip.y >= 0));

  /**
   * Read the HEADER CHIP, not the page text.
   *
   * The first version matched /(\d+)\s*XP/ against document.body.innerText and picked up the toast
   * "Skipped — −25 XP" instead of the score. It reported 144 -> 25 and passed, while the chip
   * actually read 119. A test that can pass by reading the wrong element is worse than no test.
   */
  const xpNow = () => page.evaluate(() => {
    const chip = [...document.querySelectorAll("header span")]
      .find((e) => /^\d+\s*XP$/.test((e.textContent ?? "").trim()));
    const m = (chip?.textContent ?? "").match(/(\d+)/);
    return m ? Number(m[1]) : null;
  });
  /*
   * PAUSE BEFORE MEASURING.
   *
   * This read 144 -> 183 on one run and 208 -> 183 on another, from identical code: a beat
   * completed in the gap between reading `before` and clicking skip, so the delta was
   * +64 (beat) -25 (skip) = +39 instead of -25. Both runs were "correct"; the measurement was not.
   * Pausing stops the lecture advancing, which makes the skip the only thing that can move the
   * score — the difference between measuring one rule and measuring a race.
   */
  const pause = page.getByRole("button", { name: /^pause$/i });
  if (await pause.count()) { await pause.click(); await page.waitForTimeout(1500); }

  // Read the part number either side of the skip. A skip advances EXACTLY one part, so if the
  // lecture also completed a beat on its own, this shows it — which is the confound that made the
  // delta read +39 instead of -25. Checking the part counter measures that directly, rather than
  // inferring it from whatever the pause button happens to be labelled.
  const partNow = () => page.evaluate(() => {
    const m = document.body.innerText.match(/Part (\d+) of/);
    return m ? Number(m[1]) : null;
  });
  const part0 = await partNow();
  const before = await xpNow();
  const skip = page.getByRole("button", { name: /skip to next part/i });
  if (await skip.count()) { await skip.click(); await page.waitForTimeout(3000); }
  const after = await xpNow();
  const part1 = await partNow();
  check("exactly one part elapsed, so the skip is the only thing that moved the score",
        part0 !== null && part1 !== null && part1 - part0 === 1,
        `part ${part0} -> ${part1}${part1 - part0 > 1 ? " — a beat also completed; the delta below is contaminated" : ""}`);
  check("skipping a beat reduces XP", before !== null && after !== null && after < before, `${before} -> ${after}`);
  // Pin the SIZE of the drop too. "went down" was satisfied by reading the wrong element entirely,
  // and a skip that cost 119 instead of 25 would also have passed.
  check("and by roughly the skip penalty, not an arbitrary amount",
        before !== null && after !== null && before - after >= 20 && before - after <= 30,
        `dropped ${before !== null && after !== null ? before - after : "?"}`);
  await page.screenshot({ path: `${OUT}/ui-3-after-skip.png` });

  /**
   * LIP SYNC — sampled from the rendered avatar, in the running app.
   *
   * This is the check whose absence let lip sync ship completely dead: `attachMouthAnalyser` was
   * imported by lib/voice.ts and never called by anything, so `mouthShape()` stayed at zero for the
   * whole lecture and the mouth was a static 1.4px slit. Five unit tests passed the whole time,
   * because they call the analyser themselves — they verified the module and never the caller.
   *
   * A mouth stuck open and a mouth stuck shut both render. Only a MOVING one is working, so this
   * samples the real <ellipse> over real narration and asserts the geometry actually changes.
   */
  const lip = await page.evaluate(async () => {
    const mouth = () => document.querySelector('ellipse[fill="#7c2d12"]');
    if (!mouth()) return { found: false };
    const ry = [];
    const rx = [];
    /*
     * "Is the teacher speaking" is read from the MOUTH GEOMETRY, which is the app's own answer.
     *
     * Two earlier detectors were wrong. Counting `document.querySelectorAll("audio")` returned zero
     * while the mouth was visibly moving, because lib/voice.ts builds its element with
     * `new Audio(objectUrl)` and never appends it to the document. Matching the header text
     * "Teacher speaking" missed the window between beats.
     *
     * `ry` settles this without either: TeacherAvatar renders `ry = speaking ? 1.4 + open * 6.4 : 0`,
     * so ry > 0 means the app considers itself speaking, and that separates the two failure modes
     * this check exists to tell apart:
     *   - every sample 0.00  -> nothing ever spoke; the run proves nothing
     *   - every sample 1.40  -> speaking with a DEAD analyser; this is the original bug
     */
    let spoke = false;
    for (let i = 0; i < 30; i++) {
      const m = mouth();
      ry.push(Number(m?.getAttribute("ry") ?? -1).toFixed(2));
      rx.push(Number(m?.getAttribute("rx") ?? -1).toFixed(2));
      if (Number(m?.getAttribute("ry") ?? 0) > 0) spoke = true;
      await new Promise((r) => setTimeout(r, 100));
    }
    return { found: true, ry: [...new Set(ry)], rx: [...new Set(rx)], spoke };
  });

  const ryVals = lip.ry ?? [];
  const frozenAtRest = ryVals.length === 1 && ryVals[0] === "1.40";
  const lipWhy = !lip.found
    ? "no mouth ellipse in the DOM"
    : !lip.spoke
      ? "the mouth stayed at 0 the whole window — nothing ever spoke, so this proves nothing"
      : frozenAtRest
        ? "mouth frozen at its 1.40 resting height while speaking — the analyser is not attached"
        : `${ryVals.length} distinct ry values, ${ryVals.slice(0, 6).join(", ")}...`;
  check("the avatar's mouth MOVES while narration plays (lip sync is actually wired up)",
        !!lip.found && !!lip.spoke && (lip.ry ?? []).length >= 3, lipWhy);
  check("and the lips change shape, not just the jaw",
        !!lip.found && !!lip.spoke && (lip.rx ?? []).length >= 3,
        `${(lip.rx ?? []).length} distinct rx values, ${(lip.rx ?? []).slice(0, 6).join(", ")}...`);

  check("no page or console errors (excluding known pre-existing ones)", errs.length === 0,
        errs.slice(0, 3).join(" | "));
  check("no failed network requests (other than the keyless Gemini token route)",
        badResponses.length === 0, [...new Set(badResponses)].slice(0, 4).join(" | "));

  /**
   * THE APP ITSELF must post the score when the session ends — checked before anything posts by hand.
   *
   * This is the check that was missing, and its absence hid a feature that did not exist. The GET
   * was wired, the POST route was written and tested through `page.request.post`, and NOTHING IN
   * THE APP EVER CALLED IT: every real learner finished a lecture and saw an empty board forever.
   * Driving the endpoint directly proved the endpoint worked and silently skipped the caller, which
   * was the only broken part.
   *
   * So: leave the lecture the way a learner does, then read the board back. No manual POST above
   * this line, or it proves nothing.
   */
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(4000);
  const auto = await (await page.request.get(`${BASE}/api/adhd/leaderboard`)).json();
  const mine = (auto.entries ?? []).find((e) => e.isYou);
  check("leaving a lecture posts the session score WITHOUT any manual API call",
        !!mine && mine.xp > 0, mine ? `auto-posted ${mine.xp} xp` : "no row — the app never posted");

  const post = await page.request.post(`${BASE}/api/adhd/leaderboard`, { data: { xp: 250 } });
  check("an ADHD learner can post a score", post.ok(), `status ${post.status()}`);
  const board = await (await page.request.get(`${BASE}/api/adhd/leaderboard`)).json();
  check("and appears on the board", (board.entries ?? []).some((e) => e.isYou && e.xp >= 250),
        JSON.stringify((board.entries ?? []).slice(0, 3)));

  /**
   * The board must actually RENDER on the prompt page, with the top scorer first.
   *
   * Every check above this point exercised the API. An endpoint that returns correctly sorted JSON
   * into a panel that never mounts satisfies all of them and ships nothing the learner can see, so
   * the ordering is read back out of the DOM.
   *
   * A second ADHD learner with a LOWER score is seeded first: with one row, any sort order looks
   * correct.
   */
  const ctx3 = await browser.newContext({ viewport: { width: 1320, height: 820 } });
  const rival = await ctx3.newPage();
  await rival.goto(BASE, { waitUntil: "domcontentloaded" });
  await makeLearner(rival, "rival", "adhd");
  await rival.request.post(`${BASE}/api/adhd/leaderboard`, { data: { xp: 90 } });
  await ctx3.close();

  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(4000);
  await page.screenshot({ path: `${OUT}/ui-5-adhd-landing.png` });

  const rows = await page.evaluate(() => {
    const names = [...document.querySelectorAll("li,tr,div")]
      .filter((e) => /UI (yes|rival)/.test(e.textContent ?? "") && (e.textContent ?? "").length < 80)
      .map((e) => (e.textContent ?? "").replace(/\s+/g, " ").trim());
    // De-duplicate ancestors that contain the same row text.
    return [...new Set(names)];
  });
  check("the leaderboard RENDERS on the prompt page for an ADHD learner", rows.length >= 2,
        JSON.stringify(rows));
  const yesAt = rows.findIndex((r) => /UI yes/.test(r));
  const rivalAt = rows.findIndex((r) => /UI rival/.test(r));
  check("and the top scorer is listed ABOVE the lower one",
        yesAt !== -1 && rivalAt !== -1 && yesAt < rivalAt,
        `250xp at index ${yesAt}, 90xp at index ${rivalAt}`);

  const ctx2 = await browser.newContext({ viewport: { width: 1320, height: 820 } });
  const plain = await ctx2.newPage();
  await plain.goto(BASE, { waitUntil: "domcontentloaded" });
  await makeLearner(plain, "no", "none");

  const rejected = await plain.request.post(`${BASE}/api/adhd/leaderboard`, { data: { xp: 9999 } });
  check("a non-ADHD learner is REJECTED server-side, not merely hidden in the UI",
        rejected.status() === 403, `status ${rejected.status()}`);

  const plainBoard = await (await plain.request.get(`${BASE}/api/adhd/leaderboard`)).json();
  check("and is shown no board", (plainBoard.entries ?? []).length === 0, `reason=${plainBoard.reason}`);

  await plain.goto(BASE, { waitUntil: "domcontentloaded" });
  await plain.waitForTimeout(3000);
  await plain.screenshot({ path: `${OUT}/ui-4-non-adhd-landing.png` });
  check("the prompt page shows no leaderboard for a non-ADHD learner",
        !/focus leaderboard/i.test(await plain.locator("body").innerText()));

  await ctx.close();
  await ctx2.close();
} finally {
  await browser.close();
  try {
    const conn = (readFileSync(".env.local", "utf8").match(/^COSMOS_CONNECTION_STRING=(.+)$/m) || [])[1].trim();
    const db = new CosmosClient(conn).database("aria");
    for (const [name, pk] of [["users", null], ["leaderboard", "adhd"]]) {
      const c = db.container(name);
      const { resources } = await c.items
        .query({ query: "SELECT c.id, c.username FROM c WHERE STARTSWITH(c.username, @p)",
                 parameters: [{ name: "@p", value: PREFIX }] })
        .fetchAll();
      for (const r of resources) await c.item(r.id, pk ?? r.id).delete();
      if (resources.length) console.log(`cleaned ${resources.length} row(s) from ${name}`);
    }
  } catch (e) {
    console.log(`cleanup failed — remove rows starting "${PREFIX}": ${e.message}`);
  }
}

console.log(results.join("\n"));
console.log(`\n${results.length - failures}/${results.length} checks passed`);
process.exit(failures ? 1 : 0);

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
/*
 * Kinds and fields matching what the GENERATOR emits, not a simplified stand-in.
 *
 * This fixture used `slideKind: "concept"` — not one of the kinds the app defines or the model is
 * asked for — and carried no `points`. Game mode would have found nothing playable in it and the
 * button would have sat disabled, so the whole mode would have tested as "renders nothing".
 */
const KINDS = ["definition", "mechanism", "example", "compare", "application", "misconception", "definition", "recap"];
const BEATS = TITLES.map((title, i) => ({
  id: `b${i}`, title,
  script: "Atoms join by sharing or giving up electrons, and the balance decides the bond.",
  slideKind: KINDS[i], teacherMove: "explain",
  points: [`${title} point one`, `${title} point two`, `${title} point three`],
  definitionTerm: title,
  definitionMeaning: `${title} means the way atoms end up sharing or trading their outer electrons.`,
  compareLeft: { label: "Ionic", points: ["transfers electrons", "forms a lattice"] },
  compareRight: { label: "Covalent", points: ["shares electrons", "forms molecules"] },
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
  args: [
    "--autoplay-policy=no-user-gesture-required",
    // The game renders through WebGL. Headless Chromium has no GPU, so without a software
    // rasteriser it would report no context and the suite would test the DOM fallback while
    // believing it tested the game.
    "--use-gl=swiftshader",
    "--enable-unsafe-swiftshader",
  ],
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
    const avatars = [...document.querySelectorAll("[data-teacher-avatar]")];
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
             avatar: box(avatars[0]), avatarCount: avatars.length,
             badge: box(badge), chipText: txt(chip).slice(0, 40) };
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
  /*
   * EXACTLY ONE teacher on screen.
   *
   * The track briefly rendered two — a 52px one in the header and an 88px one on the board — which
   * made it ambiguous which was the teacher, and the board copy covered the slide title. The header
   * slot keeps its exit BUTTON but drops the face, so this number is the whole fix in one assertion.
   */
  check("exactly ONE teacher avatar is on screen", geom.avatarCount === 1,
        `found ${geom.avatarCount}`);
  // It lives in the 340px sidebar now, so it cannot cover the board, the caption bar or the quiz.
  check("the avatar does NOT overlap the lesson board", !overlaps(geom.avatar, geom.board),
        geom.avatar && geom.board ? `avatar.x=${Math.round(geom.avatar.x)} board.right=${Math.round(geom.board.right)}` : "avatar not found");
  check("the avatar is big enough to actually notice", !!geom.avatar && geom.avatar.w >= 120,
        geom.avatar ? `${Math.round(geom.avatar.w)}px wide` : "avatar not found");
  check("the ADHD row does NOT cover the board's renderer badge", !overlaps(geom.park, geom.badge),
        geom.badge && geom.park ? `badge.bottom=${Math.round(geom.badge.bottom)} park.y=${Math.round(geom.park.y)}` : "badge not found");
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
  let skippedAt = 0;
  if (await skip.count()) {
    await skip.click();
    skippedAt = Date.now();
    await page.waitForTimeout(3000);
  }
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
    const mouth = () => document.querySelector('ellipse[fill="#8d2f2f"]');
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
     * `ry` settles this without either: TeacherAvatar renders `ry = speaking ? 1.6 + open * 7.2 : 0`,
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
  const frozenAtRest = ryVals.length === 1 && ryVals[0] === "1.60";
  const lipWhy = !lip.found
    ? "no mouth ellipse in the DOM"
    : !lip.spoke
      ? "the mouth stayed at 0 the whole window — nothing ever spoke, so this proves nothing"
      : frozenAtRest
        ? "mouth frozen at its 1.60 resting height while speaking — the analyser is not attached"
        : `${ryVals.length} distinct ry values, ${ryVals.slice(0, 6).join(", ")}...`;
  check("the avatar's mouth MOVES while narration plays (lip sync is actually wired up)",
        !!lip.found && !!lip.spoke && (lip.ry ?? []).length >= 3, lipWhy);
  check("and the lips change shape, not just the jaw",
        !!lip.found && !!lip.spoke && (lip.rx ?? []).length >= 3,
        `${(lip.rx ?? []).length} distinct rx values, ${(lip.rx ?? []).slice(0, 6).join(", ")}...`);

  /*
   * She holds the furious face AND says why.
   *
   * The reaction used to clear after a flat 2200ms, so this is checked shortly after the skip and
   * again later: the point of the change is the DURATION, and a check that only sampled once could
   * not tell a 9-second reaction from a 2-second one.
   */
  const reproachNow = () => page.evaluate(() => {
    const el = document.querySelector("[data-reproach]");
    const av = document.querySelector("[data-teacher-avatar]");
    return { line: el?.textContent?.trim() ?? null, face: av?.getAttribute("data-teacher-avatar") ?? null };
  });
  const justAfter = await reproachNow();
  check("she says something when a beat is skipped", !!justAfter.line, justAfter.line ?? "no bubble");
  check("and the face is furious, not merely surprised", justAfter.face === "furious",
        `face=${justAfter.face}`);

  /*
   * Measure ELAPSED TIME, do not assume it.
   *
   * The first version waited a fixed 4000ms and reported "after ~7s", but the screenshot and three
   * `evaluate` round trips in between added over a second — so it sampled at ~9s against a 9s hold
   * and reported a failure that was really a stopwatch error. The hold is read from the clock now,
   * and the screenshot moved after the sample so it cannot push the measurement past the deadline.
   */
  await page.waitForTimeout(4000);
  const stillCross = await reproachNow();
  const heldFor = Date.now() - skippedAt;
  check("the reaction HOLDS — still cross seconds later, not gone in a blink",
        stillCross.face === "furious" && !!stillCross.line,
        `${(heldFor / 1000).toFixed(1)}s after the skip: face=${stillCross.face} line=${stillCross.line ? "shown" : "gone"}`);
  await page.screenshot({ path: `${OUT}/ui-3-after-skip.png` });

  // ...and it still ENDS. A face that never resets is a verdict, not a reaction.
  await page.waitForTimeout(Math.max(0, 16_000 - (Date.now() - skippedAt)));
  const recovered = await reproachNow();
  check("and it ends — the face recovers rather than glaring forever",
        recovered.face !== "furious" && !recovered.line,
        `${((Date.now() - skippedAt) / 1000).toFixed(1)}s after the skip: face=${recovered.face}`);

  check("no page or console errors (excluding known pre-existing ones)", errs.length === 0,
        errs.slice(0, 3).join(" | "));
  check("no failed network requests (other than the keyless Gemini token route)",
        badResponses.length === 0, [...new Set(badResponses)].slice(0, 4).join(" | "));

  /*
   * GAME MODE — the button, and that the board really becomes playable.
   *
   * Asserted against the rendered board rather than the router, because the router already has unit
   * tests and that is exactly the gap that let the leaderboard POST and the lip-sync analyser ship
   * dead: the module was verified and nothing called it.
   */
  const gameBtn = page.getByRole("button", { name: /play this lesson as games/i });
  check("the games button is offered to an ADHD learner", (await gameBtn.count()) === 1);
  if (await gameBtn.count()) await gameBtn.click();
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${OUT}/ui-7-game-mode.png` });

  /*
   * THE REAL GAME — a Phaser canvas, not a multiple-choice list.
   *
   * A canvas cannot be inspected the way DOM can: there is nothing to query inside it, and the
   * scoring lives in a render loop. So the component mirrors its progress into an `sr-only` element
   * (`data-sorter-state`), which is the same handle a screen reader gets — if a test cannot see the
   * run, neither can an assistive user, so this is worth having for its own sake.
   *
   * The rules themselves are covered by the pure reducer in lib/anim/adhdSorter.test.ts. What is
   * checked HERE is only what unit tests structurally cannot: that the thing mounts, plays, and
   * reports back into the lesson.
   */
  // Phaser boots asynchronously (dynamic import + sprite load), so wait for the canvas rather than
  // sampling the instant the button was pressed.
  await page.locator("[data-sorter-start]").waitFor({ state: "visible", timeout: 20000 }).catch(() => {});
  const mounted = await page.evaluate(() => ({
    sorter: !!document.querySelector("[data-sorter-game]"),
    canvas: !!document.querySelector("[data-sorter-game] canvas") || !!document.querySelector("[data-sorter-start]"),
    quiz: document.querySelector("[data-game-round]")?.getAttribute("data-game-round") ?? null,
    state: document.querySelector("[data-sorter-state]")?.textContent ?? null,
    backdrop: document.querySelector("[data-sorter-backdrop]")?.getAttribute("data-sorter-backdrop") ?? null,
  }));
  check("the board becomes a real game, not a question list",
        mounted.sorter && mounted.canvas,
        mounted.sorter
          ? `sorter mounted, canvas=${mounted.canvas}`
          : `no sorter — fell back to the ${mounted.quiz ?? "slide"}`);
  /*
   * The backdrop is DECORATION and the game must never wait for it. Generating one takes ten to
   * twenty seconds; an earlier version gated the Phaser start on that fetch, and the learner sat
   * looking at an empty box for the duration. So this asserts the game is playable regardless of
   * whether the art has landed — "off" here is a pass, not a failure.
   */
  check("the game is playable whether or not the backdrop has arrived",
        mounted.sorter && mounted.canvas,
        `backdrop ${mounted.backdrop ?? "element missing"} — play must not depend on it`);
  check("and it reports its progress somewhere a test and a screen reader can both read",
        typeof mounted.state === "string" && /sorted|finished/.test(mounted.state),
        mounted.state ?? "no sr-only state");

  const xpBeforeGame = await xpNow();
  const partBeforeGame = await partNow();
  const parts = await page.evaluate(() => {
    const m = document.body.innerText.match(/Part (\d+) of (\d+)/);
    return m ? { at: Number(m[1]), total: Number(m[2]) } : null;
  });
  const onLastPart = !!parts && parts.at >= parts.total;

  /*
   * Play it by steering. Moving the pointer across the canvas is the actual input the game takes, so
   * this exercises the real control path rather than reaching past it into internals.
   */
  /*
   * Press start BEFORE looking for the canvas.
   *
   * The scene only mounts once the round begins — the start card names the two bins and the WebGL
   * context is not created until it is dismissed. Measuring the canvas first timed out against a
   * game that was waiting to be told to begin.
   */
  const startBtn = page.locator("[data-sorter-start]");
  if (await startBtn.count()) await startBtn.click();
  await page.locator("[data-sorter-game] canvas").waitFor({ state: "attached", timeout: 25000 }).catch(() => {});

  const box = await page.locator("[data-sorter-game] canvas").boundingBox().catch(() => null);
  const finish = page.locator("[data-sorter-continue]");
  if (box) {
    await page.waitForTimeout(1200);
    await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.45);
    await page.waitForTimeout(900);
    // Mid-play, before the end card veils the board.
    await page.screenshot({ path: `${OUT}/ui-9-game-playing.png` });
    for (let i = 0; i < 90 && (await finish.count()) === 0; i++) {
      await page.mouse.move(box.x + box.width * (i % 2 === 0 ? 0.25 : 0.75), box.y + box.height * 0.5);
      await page.waitForTimeout(220);
    }
  }
  await page.screenshot({ path: `${OUT}/ui-7-game-mode.png` });
  check("the run reaches an end card within a sensible time", (await finish.count()) > 0,
        (await finish.count()) > 0 ? "end card shown" : "still playing after ~20s — the run never resolves");

  if (await finish.count()) {
    await finish.click();
    await page.waitForTimeout(2500);
  }
  const partAfterGame = await partNow();
  const afterText = (await page.locator("body").innerText()).replace(/\s+/g, " ").trim();
  const endedLesson = partAfterGame === null && /end of lecture|finished|what actually stuck/i.test(afterText);
  check("finishing the game advances the lesson (or ends it, on the last beat)",
        (partAfterGame !== null && partBeforeGame !== null && partAfterGame > partBeforeGame)
        || (onLastPart && endedLesson),
        `part ${partBeforeGame} -> ${partAfterGame ?? "left the lecture"}` +
          `${onLastPart ? ` (was on the last of ${parts?.total})` : ""}${endedLesson ? ", lesson ended" : ""}`);
  const xpAfterGame = await xpNow();
  check("and the result reaches the lesson score",
        xpAfterGame === null ? endedLesson : xpAfterGame !== xpBeforeGame,
        `xp ${xpBeforeGame} -> ${xpAfterGame ?? "n/a (lesson ended)"}`);

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

  /*
   * NON-ADHD PARITY. ADHD mode empties the header avatar slot to keep exactly one teacher on
   * screen; the standard player must be untouched by that. The exit button is the same element, so
   * a change that removed the face for everyone would still pass every ADHD check above.
   */
  const plainConsent = await intoLecture(plain).catch(() => null);
  if (plainConsent && (await plainConsent.count())) await plainConsent.click();
  const plainStart = plain.getByRole("button", { name: /start lecture/i });
  if (await plainStart.count()) await plainStart.click();
  await plain.waitForTimeout(6000);
  await plain.screenshot({ path: `${OUT}/ui-6-non-adhd-lecture.png` });
  const plainAvatars = await plain.evaluate(() => ({
    avatars: document.querySelectorAll("[data-teacher-avatar]").length,
    exit: !!document.querySelector('button[aria-label="Exit lecture"]'),
  }));
  check("the STANDARD player still renders its header avatar", plainAvatars.avatars === 1,
        `found ${plainAvatars.avatars}`);
  check("and the exit button survives in both modes", plainAvatars.exit === true);

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

// Runs the screen-mark overlay (screen.js) off screen with a stand-in picture of the screen: the mark,
// the tiny board's words, the pencil board (or with ARIA_SCREEN_DRAW=manim the slide video), and a second mark replacing the first. Free: mock mode.
// Run: ARIA_URL=http://localhost:3000 npm run test:screen   (a local Aria dev server must be running)
process.env.ARIA_SCREEN_SELFTEST = "1";
process.env.ARIA_SCREEN_MOCK = "1";
const electron = require("electron");
const { app, nativeImage } = electron;
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");

const shots = path.join(os.homedir(), "aria-qa-images", "desktop-app");
fs.mkdirSync(shots, { recursive: true });
electron.shell.openExternal = async () => {};
const results = [];
const errors = [];
const check = (name, ok, detail = "") => results.push(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

app.on("web-contents-created", (_e, contents) => {
  contents.on("console-message", (event) => {
    if (event.level === "error") errors.push(`${event.message}`.slice(0, 240));
  });
});

require("../main.js");
const marks = require("../screen.js");

/** A stand-in screen: a dark page with a formula on it, drawn in a hidden window. */
async function standInScreen(width, height) {
  const { BrowserWindow } = electron;
  const w = new BrowserWindow({ show: false, width, height, webPreferences: { offscreen: true } });
  await w.loadURL(`data:text/html,${encodeURIComponent('<body style="margin:0;background:#fff;font:64px Georgia;color:#111"><p style="position:absolute;left:120px;top:300px;margin:0">a² + b² = c²</p></body>')}`);
  await wait(300);
  const image = await w.webContents.capturePage();
  w.destroy();
  return image;
}

app.whenReady().then(async () => {
  let overlay = null;
  for (let i = 0; i < 40 && !(overlay = marks.overlayWindow()); i++) await wait(250);
  try {
    check("overlay window exists", Boolean(overlay));
    const contents = overlay.webContents;
    if (contents.isLoading()) await new Promise((r) => contents.once("did-finish-load", r));
    const url = contents.getURL();
    check("overlay page comes from the Aria website", url.includes("/screen/overlay.html"), url);
    const js = (code) => contents.executeJavaScript(code);
    check("overlay page is see-through", (await js("getComputedStyle(document.body).backgroundColor")) === "rgba(0, 0, 0, 0)");

    const bounds = overlay.getBounds();
    const picture = (await standInScreen(bounds.width, bounds.height)).toDataURL();
    contents.send("mark:prepare");
    await wait(300);
    contents.send("mark:start", { image: picture, scale: 1 });
    await wait(500);
    check("mark mode shows its hint", await js(`!document.querySelector("#hint").hidden && document.body.classList.contains("marking")`));
    const ring = Array.from({ length: 41 }, (_, i) => {
      const a = (i / 40) * Math.PI * 2;
      return [330 + 250 * Math.cos(a), 340 + 60 * Math.sin(a)];
    });
    const frozen = await js(`(() => { const f = document.querySelector("#freeze"); return { shown: !f.hidden, w: f.getBoundingClientRect().width, full: innerWidth, loaded: f.complete && f.naturalWidth > 0 }; })()`);
    check("the screen shows frozen while marking", frozen.shown && frozen.loaded && Math.abs(frozen.w - frozen.full) < 2, JSON.stringify(frozen));
    check("a circle is taken as a mark", await js(`window.__testMark(${JSON.stringify(ring)})`));
    check("the live screen is back after the mark", await js(`document.querySelector("#freeze").hidden`));

    const manim = process.env.ARIA_SCREEN_DRAW === "manim";
    let state = null;
    for (let i = 0; i < 60; i++) {
      state = await js("window.__testState()");
      if (manim ? state.video : state.sketch?.drawn > 3) break;
      await wait(500);
    }
    check("board opens beside the mark", Boolean(state.boardBox), JSON.stringify(state.boardBox && { x: Math.round(state.boardBox.x), y: Math.round(state.boardBox.y) }));
    check("board names the idea", state.title === "Pythagoras' theorem", state.title);
    check("Aria's words stream in", state.text.length > 60, state.text.slice(0, 60));
    if (manim) {
      check("slide video arrives from the server", /^\/api\/screen\/media\/.+\/slide-1\.mp4$/.test(state.video ?? ""), state.video);
      // Playing means its clock moves (it may have only just started when it arrived).
      const clock = `(() => { const v = document.querySelector(".b-slide video"); return { t: v.currentTime, ready: v.readyState, w: v.videoWidth }; })()`;
      await wait(1500);
      const first = await js(clock);
      await wait(1200);
      const playing = await js(clock);
      check("slide video plays", playing.t > first.t + 0.5 && playing.w > 0, `${first.t.toFixed(2)} s → ${playing.t.toFixed(2)} s, ${playing.w} px wide`);
    } else {
      check("pencil board starts drawing", state.sketch?.drawn > 3, JSON.stringify(state.sketch));
      // It keeps drawing as she speaks: wait for the rest, then check nothing overlaps or sits off the board.
      for (let i = 0; i < 40; i++) {
        await wait(500);
        const now = await js("window.__testState()");
        if (now.sketch?.drawn === state.sketch?.drawn && i > 6) break;
        state = now;
      }
      const box = state.boardBox;
      check("pencil board keeps drawing", state.sketch?.drawn > 6, `${state.sketch?.drawn} strokes and words`);
      check("pencil board layout is clean", state.sketch?.report && !state.sketch.report.overlaps?.length && !state.sketch.report.outside?.length, JSON.stringify(state.sketch?.report));
      check("pencil board fits on the screen", box && box.x >= 0 && box.y >= 0 && box.x + box.width <= bounds.width && box.y + box.height <= bounds.height, JSON.stringify(box && { x: box.x, y: box.y, w: box.width, h: box.height }));
    }
    const png = (await contents.capturePage()).toPNG();
    fs.writeFileSync(path.join(shots, "screen-mark.png"), png);

    // Try it: once she has finished, the sheet becomes a challenge solved by dragging.
    let play = null;
    for (let i = 0; i < 80 && !manim; i++) {
      play = (await js("window.__testState()")).play;
      if (play.shown) break;
      await wait(500);
    }
    if (!manim) {
      check("Try it appears after she explains", play?.shown && play.ask.length > 10, play?.ask);
      const solvedIt = await js("window.__testSolvePlay()");
      await wait(600);
      const after = (await js("window.__testState()")).play;
      check("Try it judges the answer and praises it", solvedIt && after.solved && /twenty-five/.test(after.say), after.say);
      fs.writeFileSync(path.join(shots, "screen-try-it.png"), (await contents.capturePage()).toPNG());
    }

    // A spoken follow-up ("Aria, …"): asked about the same mark and drawn again.
    const drawnBefore = state.sketch?.drawn ?? 0;
    await js(`window.__testHeard("Hey Aria, why is c the longest side?")`);
    let follow = null;
    for (let i = 0; i < 30; i++) {
      await wait(500);
      follow = await js("window.__testState()");
      if (follow.sketch?.drawn > 3 && follow.text.length > 60) break;
    }
    check("“Aria, …” asks a follow-up", follow.title === "why is c the longest side?", follow.title);
    check("the follow-up is drawn again", manim || (follow.sketch?.drawn > 3 && follow.sketch.drawn <= drawnBefore + 40), JSON.stringify(follow.sketch));
    await js(`window.__testHeard("I think the area is twelve")`);
    await wait(800);
    check("talk not addressed to Aria is ignored", (await js("window.__testState()")).title === follow.title);
    fs.writeFileSync(path.join(shots, "screen-followup.png"), (await contents.capturePage()).toPNG());

    // One click marks what is under it (the formula on the stand-in screen).
    contents.send("mark:prepare");
    await wait(300);
    contents.send("mark:start", { image: picture, scale: 1 });
    await wait(400);
    const clicked = await js(`window.__testMark([[260, 340]])`);
    const markBox = await js("window.__testMarkBox()");
    const fits = markBox && markBox.left < 140 && markBox.right > 380 && markBox.right < 700 && markBox.top > 250 && markBox.bottom < 420;
    check("a click marks the thing under it", clicked && fits, JSON.stringify(markBox && { l: Math.round(markBox.left), t: Math.round(markBox.top), r: Math.round(markBox.right), b: Math.round(markBox.bottom) }));
    await wait(1500);
    // A click on empty space marks nothing and keeps mark mode on.
    contents.send("mark:prepare");
    await wait(300);
    contents.send("mark:start", { image: picture, scale: 1 });
    await wait(400);
    const empty = await js(`window.__testMark([[${Math.round(bounds.width * 0.8)}, ${Math.round(bounds.height * 0.8)}]])`);
    check("a click on empty space marks nothing", !empty && (await js(`document.body.classList.contains("marking")`)));
    await js(`window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }))`);
    await wait(300);

    // A second mark replaces the first board.
    contents.send("mark:prepare");
    await wait(300);
    contents.send("mark:start", { image: picture, scale: 1 });
    await wait(300);
    check("a second mark opens a fresh board", await js(`window.__testMark(${JSON.stringify(ring)})`));
    await wait(1200);
    const second = await js("window.__testState()");
    check("second board starts over", second.text.length < state.text.length, second.text.slice(0, 40));
    // Esc closes the board.
    await js(`window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }))`);
    await wait(300);
    check("Esc closes the board", (await js("window.__testState()")).boardBox === null);
  } catch (err) {
    check("self-test ran", false, err instanceof Error ? err.message : String(err));
  }
  results.push(`INFO  console errors: ${errors.length}`);
  for (const e of [...new Set(errors)].slice(0, 10)) results.push(`      ${e}`);
  console.log("\n" + results.join("\n"));
  console.log(`\nscreenshot: ${path.join(shots, "screen-mark.png")}`);
  app.exit(results.some((r) => r.startsWith("FAIL")) ? 1 : 0);
});

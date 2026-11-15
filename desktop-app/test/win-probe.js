// Screen marks on REAL Windows (run on a GitHub Windows machine by .github/workflows/windows-screen-probe.yml):
// the real app (main.js + screen.js, real overlay window, not off screen), the real Ctrl+Alt+A key
// press and a real mouse circle through user32 (test/win-input.ps1). Prints what happened at each
// step and saves screenshots of the whole desktop, so a Windows-only fault shows where it is.
//   npx electron test/win-probe.js     (ARIA_URL defaults to the live site; nobody is signed in, so
//                                       the board answers "Sign in…", which is enough to see the mark work)
process.env.ARIA_SCREEN_MOCK = "1";
const electron = require("electron");
const { app, desktopCapturer, screen } = electron;
const path = require("node:path");
const fs = require("node:fs");
const { execFile } = require("node:child_process");

const out = path.join(__dirname, "..", "probe-out");
fs.mkdirSync(out, { recursive: true });
const log = (...a) => console.log("[probe]", ...a);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const input = (...args) =>
  new Promise((resolve) => execFile("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", path.join(__dirname, "win-input.ps1"), ...args.map(String)], (err, so, se) => resolve(err ? `error ${se || err.message}` : "ok")));
const errors = [];
app.on("web-contents-created", (_e, contents) => contents.on("console-message", (e) => (e.level === "error" || /\[listen\]|\[voice\]/.test(e.message)) && errors.push(e.message.slice(0, 200))));

require("../main.js");
const marks = require("../screen.js");

async function desktopShot(name) {
  const d = screen.getPrimaryDisplay();
  const sources = await desktopCapturer.getSources({ types: ["screen"], thumbnailSize: { width: d.size.width * d.scaleFactor, height: d.size.height * d.scaleFactor } });
  const s = sources[0];
  if (s) fs.writeFileSync(path.join(out, `${name}.png`), s.thumbnail.toPNG());
  log(`shot ${name}: ${s ? `${s.thumbnail.getSize().width}x${s.thumbnail.getSize().height}, display_id "${s.display_id}"` : "NO SOURCE"}`);
}

app.whenReady().then(async () => {
  let overlay = null;
  for (let i = 0; i < 60 && !(overlay = marks.overlayWindow()); i++) await wait(250);
  const d = screen.getPrimaryDisplay();
  log(`display ${JSON.stringify(d.bounds)} scale ${d.scaleFactor}; displays ${screen.getAllDisplays().length}`);
  log(`hotkey registered: "${marks.hotkeyAccelerator()}"`);
  if (!overlay) return log("NO OVERLAY WINDOW"), app.exit(1);
  const contents = overlay.webContents;
  for (let i = 0; i < 80 && contents.isLoading(); i++) await wait(250);
  await wait(3000);
  const js = (code) => contents.executeJavaScript(code).catch((e) => `js error: ${e.message}`);
  log(`overlay url ${contents.getURL()}`);
  log(`overlay visible ${overlay.isVisible()} bounds ${JSON.stringify(overlay.getBounds())} alwaysOnTop ${overlay.isAlwaysOnTop()}`);
  log(`page has board: ${await js(`Boolean(document.querySelector("#board"))`)}, aria bridge: ${await js(`typeof window.aria`)}`);
  // Count what the page hears from the mouse.
  await js(`window.__heard = { down: 0, move: 0, up: 0 }; for (const t of ["down", "move", "up"]) window.addEventListener("pointer" + t, () => window.__heard[t]++, true); true`);
  await desktopShot("0-start");

  // 1. The real key press.
  log(`keys: ${await input("keys")}`);
  await wait(4000);
  let marking = await js(`document.body.classList.contains("marking")`);
  log(`after Ctrl+Alt+A: marking=${marking}, hint="${await js(`document.querySelector("#hint").hidden ? "(hidden)" : document.querySelector("#hint").textContent`)}"`);
  await desktopShot("1-after-keys");
  if (marking !== true) {
    log("the key press did not start marking: starting it directly (as the menu item does)");
    marks.startMark();
    await wait(4000);
    marking = await js(`document.body.classList.contains("marking")`);
    log(`after startMark(): marking=${marking}, hint="${await js(`document.querySelector("#hint").hidden ? "(hidden)" : document.querySelector("#hint").textContent`)}"`);
    await desktopShot("1b-after-startMark");
  }
  log(`overlay ignoring mouse? focused=${overlay.isFocused()} visible=${overlay.isVisible()}`);

  // 2. A real mouse circle in the middle of the screen.
  const cx = Math.round(d.bounds.x + d.bounds.width * 0.45);
  const cy = Math.round(d.bounds.y + d.bounds.height * 0.45);
  log(`circle: ${await input("circle", Math.round(cx * d.scaleFactor), Math.round(cy * d.scaleFactor), Math.round(160 * d.scaleFactor))}`);
  await wait(500);
  log(`page heard ${await js(`JSON.stringify(window.__heard)`)}`);
  await wait(4000);
  const board = await js(`(() => { const b = document.querySelector("#board"); return b.hidden ? "hidden" : document.querySelector(".b-title").textContent + " | " + document.querySelector(".b-text").textContent.slice(0, 80); })()`);
  log(`board after the circle: ${board}`);
  log(`still marking: ${await js(`document.body.classList.contains("marking")`)}`);
  await desktopShot("2-after-circle");
  fs.writeFileSync(path.join(out, "2-overlay-page.png"), (await contents.capturePage()).toPNG());

  // 3. Esc, then a one-click mark.
  await js(`window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }))`);
  await wait(800);
  marks.startMark();
  await wait(4000);
  log(`click: ${await input("click", Math.round(cx * d.scaleFactor), Math.round(cy * d.scaleFactor))}`);
  await wait(3000);
  log(`page heard ${await js(`JSON.stringify(window.__heard)`)}; board after the click: ${await js(`document.querySelector("#board").hidden ? "hidden" : document.querySelector(".b-title").textContent`)}`);
  await desktopShot("3-after-click");
  log(`console: ${errors.slice(0, 12).join(" || ") || "(none)"}`);
  app.exit(0);
});

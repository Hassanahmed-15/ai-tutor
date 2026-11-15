// Mark anything on the screen: Ctrl+Alt+A (⌃⌥A on a Mac) captures the screen under the cursor, the
// student circles or underlines anything in any app, and Aria explains it on a tiny blackboard beside
// the mark, then plays a one-slide video for it (first built as screen-lab/desktop).
//
// The overlay is a see-through, always-on-top window over the whole screen; clicks fall through to
// the apps underneath except while marking or over the board. Its page comes from the Aria website
// (frontend/web/public/screen/), so it uses the app's own Aria sign-in and changes when the website
// does; this file only captures the screen and passes the mouse to it.
const { app, BrowserWindow, desktopCapturer, globalShortcut, ipcMain, screen, shell, systemPreferences } = require("electron");
const path = require("node:path");
const fs = require("node:fs");

const isMac = process.platform === "darwin";
const HOTKEYS = ["Control+Alt+A", "Control+Alt+M"]; // the second only if something else holds the first
const PRIVACY_PANE = "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture";

let overlay = null;
let overlayUrl = "";
let marking = false;
let hotkey = null;
let watching = null;
let selfTest = false;
let onTrouble = () => {};

// A short log of every mark (userData/screen-marks.log), so a fault on a computer we cannot test
// on (Windows) can be read afterwards: the app's menu and tray icon open it.
const logFile = () => path.join(app.getPath("userData"), "screen-marks.log");
function logLine(text) {
  try {
    const file = logFile();
    if (fs.existsSync(file) && fs.statSync(file).size > 300_000) fs.renameSync(file, `${file}.old`);
    fs.appendFileSync(file, `${new Date().toISOString()}  ${text}\n`);
  } catch {
    // A log that cannot be written is never worth an error.
  }
}

/** Says something went wrong where the student can see it, even while the overlay is hidden. */
function trouble(message) {
  logLine(`TROUBLE: ${message}`);
  if (overlay && !overlay.isDestroyed()) {
    if (!overlay.isVisible()) overlay.showInactive();
    overlay.webContents.send("notice", message);
  }
  onTrouble(message);
}

function isOverlay(contents) {
  return Boolean(overlay && !overlay.isDestroyed() && overlay.webContents === contents);
}

function createOverlay() {
  overlay = new BrowserWindow({
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
    hasShadow: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    focusable: true,
    skipTaskbar: true,
    // On a Mac a "panel" takes the mouse and keys without making Aria the front app, so marking
    // over Chrome never brings Aria's own window up in front of it.
    ...(isMac && !selfTest ? { type: "panel" } : {}),
    acceptFirstMouse: true,
    enableLargerThanScreen: true,
    webPreferences: {
      preload: path.join(__dirname, "overlay-preload.js"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      backgroundThrottling: false,
      autoplayPolicy: "no-user-gesture-required",
      offscreen: selfTest, // the self-test never puts a window on the screen
    },
  });
  overlay.setAlwaysOnTop(true, "screen-saver");
  overlay.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  overlay.setIgnoreMouseEvents(true, { forward: true });
  overlay.setBounds(screen.getPrimaryDisplay().bounds);
  overlay.webContents.on("did-finish-load", () => logLine(`overlay page loaded: ${overlay?.webContents.getURL()}`));
  overlay.on("closed", () => {
    overlay = null;
    marking = false;
  });
  overlay.loadURL(overlayUrl).catch(() => {});
  if (!selfTest) overlay.once("ready-to-show", () => overlay?.showInactive());
}

function ensureOverlay() {
  if (!overlay || overlay.isDestroyed()) createOverlay();
  return overlay;
}

function clickThrough(on) {
  overlay?.setIgnoreMouseEvents(on, { forward: true });
}

/** The page clears the old mark and board first, so they are not in the picture. */
function prepare() {
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(() => {
      ipcMain.removeListener("mark:prepared", done);
      resolve();
    }, 400);
    ipcMain.once("mark:prepared", done);
    overlay.webContents.send("mark:prepare");
  });
}

async function captureDisplay(display) {
  // Full detail first; some Windows graphics drivers return an empty picture at that size, so then
  // the screen's own size, then a smaller one.
  const full = { width: Math.round(display.size.width * display.scaleFactor), height: Math.round(display.size.height * display.scaleFactor) };
  const sizes = [full, { width: display.size.width, height: display.size.height }, { width: 1600, height: Math.round((1600 * display.size.height) / display.size.width) }];
  for (const size of sizes) {
    const sources = await desktopCapturer.getSources({ types: ["screen"], thumbnailSize: size });
    const source = sources.find((s) => s.display_id === String(display.id)) ?? sources[0];
    const got = source && !source.thumbnail.isEmpty() ? source.thumbnail.getSize() : null;
    logLine(`capture ${size.width}x${size.height}: ${sources.length} screens, display_id "${source?.display_id ?? ""}" (want ${display.id}), picture ${got ? `${got.width}x${got.height}` : "EMPTY"}`);
    if (got) return { image: `data:image/jpeg;base64,${source.thumbnail.toJPEG(92).toString("base64")}`, scale: got.width / display.size.width };
  }
  return null;
}

/** Ctrl+Alt+A: picture of the screen under the cursor, then mark mode. Pressed again, it cancels. */
async function startMark() {
  try {
    await startMarkSteps();
  } catch (err) {
    marking = false;
    trouble(`Marking failed: ${err instanceof Error ? err.message : err}. Try again.`);
  }
}

async function startMarkSteps() {
  logLine("mark: shortcut or menu pressed");
  ensureOverlay();
  if (marking) return overlay.webContents.send("mark:cancel");
  if (overlay.webContents.isLoading()) {
    // The page comes from the website: with no internet it never finishes, so give up after a while.
    const loaded = await Promise.race([new Promise((r) => overlay.webContents.once("did-finish-load", () => r(true))), new Promise((r) => setTimeout(() => r(false), 15000))]);
    if (!loaded) return trouble("Aria can't reach the internet, so marking can't start. Check the connection and try again.");
  }
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  logLine(`mark: display ${JSON.stringify(display.bounds)} scale ${display.scaleFactor}`);
  overlay.setBounds(display.bounds);
  if (isMac && systemPreferences.getMediaAccessStatus("screen") !== "granted") {
    // Asking once puts Aria in the Screen Recording list.
    await desktopCapturer.getSources({ types: ["screen"], thumbnailSize: { width: 1, height: 1 } }).catch(() => {});
    if (systemPreferences.getMediaAccessStatus("screen") !== "granted") return askPermission();
  }
  await prepare();
  const shot = await captureDisplay(display).catch((err) => {
    logLine(`capture error: ${err?.message ?? err}`);
    return null;
  });
  if (!shot) return isMac ? askPermission() : trouble("Aria could not take a picture of the screen. Try again, or restart Aria.");
  marking = true;
  overlay.webContents.send("mark:start", { image: shot.image, scale: shot.scale });
  logLine(`mark: marking (overlay visible ${overlay.isVisible()}, bounds ${JSON.stringify(overlay.getBounds())})`);
  clickThrough(false);
  if (!overlay.isVisible()) overlay.showInactive();
  escapeCancels(true);
  if (isMac) {
    // Never app.focus() here: on a Mac it raises every Aria window over the app being marked.
    overlay.moveTop();
  } else {
    app.focus({ steal: true });
    overlay.focus();
  }
}

/** While marking, Esc cancels even though the overlay may not have the keyboard. */
function escapeCancels(on) {
  if (on && !globalShortcut.isRegistered("Escape")) globalShortcut.register("Escape", () => marking && overlay?.webContents.send("mark:cancel"));
  if (!on && globalShortcut.isRegistered("Escape")) globalShortcut.unregister("Escape");
}

/**
 * Says so on the screen at once, and on a Mac restarts Aria by itself the moment the permission is
 * on (macOS's own "Quit & Reopen" works too, but the student would have to find it).
 */
function askPermission() {
  overlay?.webContents.send("notice", isMac ? "Aria needs permission to see your screen: turn on Aria in the settings that just opened. Aria restarts by itself." : "Aria could not see the screen. Try again.");
  if (!isMac) return;
  // Straight to the switch, with no Aria dialog: a dialog would bring Aria's window over the screen.
  shell.openExternal(PRIVACY_PANE);
  watching ??= setInterval(() => {
    if (systemPreferences.getMediaAccessStatus("screen") !== "granted") return;
    clearInterval(watching);
    app.relaunch({ args: process.argv.slice(1) });
    app.exit(0);
  }, 1500);
}

ipcMain.on("overlay:interactive", (event, on) => {
  if (isOverlay(event.sender) && !marking) pointerOnBoard(Boolean(on));
});
ipcMain.on("mark:ended", (event) => {
  if (!isOverlay(event.sender)) return;
  marking = false;
  overBoard = false;
  escapeCancels(false);
  clickThrough(true);
});

// On a Mac, while another app is in front, the click-through overlay hears only some mouse moves,
// so it cannot tell when the pointer comes onto the board. Watch the pointer here instead and let
// clicks reach the board (its question box, buttons) whenever the pointer is over it.
let overBoard = false;
let lastPoint = "";

/**
 * The pointer came onto the board (or left it). On a Mac the panel also takes the keyboard then:
 * until it does, clicks on the board are dropped. A panel takes it without making Aria the front
 * app, so Aria's own window stays behind the app being marked.
 */
function pointerOnBoard(on) {
  overBoard = on;
  clickThrough(!on);
  if (on && isMac && !overlay.isFocused()) overlay.focus();
}
function watchPointer() {
  setInterval(async () => {
    if (!overlay || overlay.isDestroyed() || marking || !overlay.isVisible()) return;
    const p = screen.getCursorScreenPoint();
    const at = `${p.x},${p.y}`;
    if (at === lastPoint) return;
    lastPoint = at;
    // Measured from the page's own place on the screen (the window's reported bounds can be off by
    // the menu bar's height).
    const over = await overlay.webContents
      .executeJavaScript(
        `(() => { const x = ${p.x} - window.screenX, y = ${p.y} - window.screenY; const big = document.querySelector("#big"); if (big && !big.hidden) return true; const board = document.querySelector("#board"); if (!board || board.hidden) return false; const r = board.getBoundingClientRect(); return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom; })()`,
      )
      .catch(() => false);
    if (!marking && over !== overBoard && overlay && !overlay.isDestroyed()) pointerOnBoard(over);
  }, 60);
}

/**
 * Sets up the hotkey and the overlay. `ariaUrl` is the website the overlay page comes from.
 * ARIA_SCREEN_MOCK=1 runs every mark with no paid call (canned words, a fixed pencil board or the
 * sample slide). ARIA_SCREEN_DRAW=manim brings back the Manim slide instead of the pencil board.
 */
function setUpScreenMarks({ ariaUrl, test = false }) {
  selfTest = test;
  const query = [process.env.ARIA_SCREEN_MOCK === "1" && "mock=1", process.env.ARIA_SCREEN_DRAW === "manim" && "draw=manim", test && "selftest=1"].filter(Boolean).join("&");
  overlayUrl = `${new URL("/screen/overlay.html", ariaUrl).href}${query ? `?${query}` : ""}`;
  createOverlay();
  if (!test) hotkey = HOTKEYS.find((accel) => globalShortcut.register(accel, startMark)) ?? null;
  logLine(`start: ${process.platform} app ${app.getVersion()}, ${screen.getAllDisplays().length} display(s), shortcut ${hotkey ?? "NONE (another app holds Ctrl+Alt+A and Ctrl+Alt+M)"}`);
  if (isMac && !test) watchPointer();
  screen.on("display-removed", () => overlay?.setBounds(screen.getPrimaryDisplay().bounds));
  app.on("will-quit", () => globalShortcut.unregisterAll());
}

/** The overlay page failed to load (offline): try again in a while, never show the offline page in it. */
function overlayLoadFailed() {
  setTimeout(() => overlay && !overlay.isDestroyed() && overlay.loadURL(overlayUrl).catch(() => {}), 15000);
}

/** The hotkey as an Electron accelerator ("Control+Alt+A"), or "" when another app holds both. */
function hotkeyAccelerator() {
  return hotkey ?? "";
}

module.exports = {
  setUpScreenMarks,
  startMark,
  isOverlay,
  overlayLoadFailed,
  hotkeyAccelerator,
  screenSettings: () => shell.openExternal(PRIVACY_PANE),
  overlayWindow: () => overlay,
  /** Where trouble is also told (the tray balloon on Windows). */
  setTroubleHandler: (fn) => (onTrouble = fn),
  openLog: () => shell.openPath(logFile()),
  logLine,
};

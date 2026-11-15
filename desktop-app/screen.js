// Mark anything on the screen: Ctrl+Alt+A (⌃⌥A on a Mac) captures the screen under the cursor, the
// student circles or underlines anything in any app, and Aria explains it on a tiny blackboard beside
// the mark, then plays a one-slide video for it (first built as screen-lab/desktop).
//
// The overlay is a see-through, always-on-top window over the whole screen; clicks fall through to
// the apps underneath except while marking or over the board. Its page comes from the Aria website
// (frontend/web/public/screen/), so it uses the app's own Aria sign-in and changes when the website
// does; this file only captures the screen and passes the mouse to it.
const { app, BrowserWindow, desktopCapturer, dialog, globalShortcut, ipcMain, screen, shell, systemPreferences } = require("electron");
const path = require("node:path");

const isMac = process.platform === "darwin";
const HOTKEYS = ["Control+Alt+A", "Control+Alt+M"]; // the second only if something else holds the first
const PRIVACY_PANE = "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture";

let overlay = null;
let overlayUrl = "";
let marking = false;
let hotkey = null;
let watching = null;
let selfTest = false;

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
  const size = { width: Math.round(display.size.width * display.scaleFactor), height: Math.round(display.size.height * display.scaleFactor) };
  const sources = await desktopCapturer.getSources({ types: ["screen"], thumbnailSize: size });
  const source = sources.find((s) => s.display_id === String(display.id)) ?? sources[0];
  if (!source || source.thumbnail.isEmpty()) return null;
  return `data:image/jpeg;base64,${source.thumbnail.toJPEG(92).toString("base64")}`;
}

/** Ctrl+Alt+A: picture of the screen under the cursor, then mark mode. Pressed again, it cancels. */
async function startMark() {
  ensureOverlay();
  if (marking) return overlay.webContents.send("mark:cancel");
  if (overlay.webContents.isLoading()) await new Promise((r) => overlay.webContents.once("did-finish-load", r));
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  overlay.setBounds(display.bounds);
  if (isMac && systemPreferences.getMediaAccessStatus("screen") !== "granted") {
    // Asking once puts Aria in the Screen Recording list.
    await desktopCapturer.getSources({ types: ["screen"], thumbnailSize: { width: 1, height: 1 } }).catch(() => {});
    if (systemPreferences.getMediaAccessStatus("screen") !== "granted") return askPermission();
  }
  await prepare();
  const image = await captureDisplay(display).catch(() => null);
  if (!image) return askPermission();
  marking = true;
  overlay.webContents.send("mark:start", { image, scale: display.scaleFactor });
  clickThrough(false);
  if (!overlay.isVisible()) overlay.showInactive();
  app.focus({ steal: true });
  overlay.focus();
}

/**
 * Says so on the screen at once, and on a Mac restarts Aria by itself the moment the permission is
 * on (macOS's own "Quit & Reopen" works too, but the student would have to find it).
 */
function askPermission() {
  overlay?.webContents.send("notice", isMac ? "Aria needs permission to see your screen. Turn on Aria in System Settings." : "Aria could not see the screen. Try again.");
  if (!isMac) return;
  app.focus({ steal: true });
  dialog
    .showMessageBox({
      type: "info",
      message: "Aria needs to see your screen",
      detail: "In System Settings → Privacy & Security → Screen & System Audio Recording, turn on Aria.\n\nAria restarts by itself as soon as the switch is on.",
      buttons: ["Open System Settings", "Not now"],
    })
    .then(({ response }) => response === 0 && shell.openExternal(PRIVACY_PANE));
  watching ??= setInterval(() => {
    if (systemPreferences.getMediaAccessStatus("screen") !== "granted") return;
    clearInterval(watching);
    app.relaunch({ args: process.argv.slice(1) });
    app.exit(0);
  }, 1500);
}

ipcMain.on("overlay:interactive", (event, on) => {
  if (isOverlay(event.sender) && !marking) clickThrough(!on);
});
ipcMain.on("mark:ended", (event) => {
  if (!isOverlay(event.sender)) return;
  marking = false;
  clickThrough(true);
});

/**
 * Sets up the hotkey and the overlay. `ariaUrl` is the website the overlay page comes from.
 * ARIA_SCREEN_MOCK=1 runs every mark with no paid call (canned words, the sample slide).
 */
function setUpScreenMarks({ ariaUrl, test = false }) {
  selfTest = test;
  const query = [process.env.ARIA_SCREEN_MOCK === "1" && "mock=1", test && "selftest=1"].filter(Boolean).join("&");
  overlayUrl = `${new URL("/screen/overlay.html", ariaUrl).href}${query ? `?${query}` : ""}`;
  createOverlay();
  if (!test) hotkey = HOTKEYS.find((accel) => globalShortcut.register(accel, startMark)) ?? null;
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

module.exports = { setUpScreenMarks, startMark, isOverlay, overlayLoadFailed, hotkeyAccelerator, screenSettings: () => shell.openExternal(PRIVACY_PANE), overlayWindow: () => overlay };

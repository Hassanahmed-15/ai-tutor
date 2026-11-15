// Aria desktop: a window onto the live Aria website. Nothing of Aria's own code is copied in,
// so the app always shows exactly what the website shows, and updates when the website does.
const { app, BrowserWindow, Menu, Notification, Tray, nativeImage, shell, session, systemPreferences } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const marks = require("./screen");

const ARIA_URL = process.env.ARIA_URL || "https://aria-tutor.jollyfield-0fda1d9b.westus2.azurecontainerapps.io";
const ARIA_ORIGIN = new URL(ARIA_URL).origin;
const isMac = process.platform === "darwin";
// Windows (and Linux) keep Aria running by the clock when its window is closed, so the screen-mark
// shortcut still works over other apps. ARIA_FORCE_TRAY=1 tries that on a Mac.
const useTray = !isMac || process.env.ARIA_FORCE_TRAY === "1";
let tray = null;
let quitting = false;
let toldAboutTray = false;

// "Continue with Google/Apple/Microsoft" leaves Aria for the provider's page and comes back.
// Those pages stay inside the app so the sign-in cookie lands in the app, not in a browser.
const SIGN_IN_DOMAINS = ["google.com", "gstatic.com", "apple.com", "microsoftonline.com", "live.com", "microsoft.com", "msauth.net", "msftauth.net"];

// Browser features Aria uses: microphone and camera, copy/paste, full screen, sound output.
const ALLOWED_PERMISSIONS = new Set(["media", "clipboard-read", "clipboard-sanitized-write", "fullscreen", "speaker-selection", "notifications"]);

function originOf(url) {
  try {
    return new URL(url).origin;
  } catch {
    return "";
  }
}

function isAria(url) {
  return originOf(url) === ARIA_ORIGIN;
}

function isSignIn(url) {
  try {
    const { protocol, hostname } = new URL(url);
    return protocol === "https:" && SIGN_IN_DOMAINS.some((d) => hostname === d || hostname.endsWith(`.${d}`));
  } catch {
    return false;
  }
}

function openInBrowser(url) {
  if (/^(https?|mailto):/i.test(url)) shell.openExternal(url);
}

// Google refuses to sign people in from anything that calls itself an embedded app,
// so the app introduces itself as the Chrome it is built on.
app.userAgentFallback = app.userAgentFallback.replace(/ Electron\/\S+/, "").replace(/ (aria-desktop|Aria)\/\S+/g, "");

// ---- window size and place, remembered between launches ----

const stateFile = () => path.join(app.getPath("userData"), "window-state.json");

function loadWindowState() {
  try {
    return JSON.parse(fs.readFileSync(stateFile(), "utf8"));
  } catch {
    return { width: 1440, height: 900 };
  }
}

function saveWindowState(win) {
  try {
    const state = { ...win.getNormalBounds(), maximized: win.isMaximized() };
    fs.writeFileSync(stateFile(), JSON.stringify(state));
  } catch {
    // Not being able to remember the window size is never worth an error.
  }
}

// ---- the window ----

let mainWindow = null;

function webPreferences() {
  return {
    preload: path.join(__dirname, "preload.js"),
    contextIsolation: true,
    sandbox: true,
    nodeIntegration: false,
    spellcheck: true,
    // A lesson keeps talking and drawing when the window is behind another one.
    backgroundThrottling: false,
  };
}

function showOffline(win, failedUrl) {
  const target = isAria(failedUrl) ? failedUrl : ARIA_URL;
  win.loadFile(path.join(__dirname, "offline.html"), { query: { u: target } });
}

function guardNavigation(contents) {
  // Links to other websites (sources, syllabus pages) open in the normal browser.
  contents.setWindowOpenHandler(({ url }) => {
    if (isAria(url) || url.startsWith("blob:") || url === "about:blank") {
      return { action: "allow", overrideBrowserWindowOptions: { backgroundColor: "#0A0A14", webPreferences: webPreferences() } };
    }
    openInBrowser(url);
    return { action: "deny" };
  });

  contents.on("will-navigate", (event, url) => {
    if (isAria(url) || isSignIn(url) || url.startsWith("file:")) return;
    event.preventDefault();
    openInBrowser(url);
  });

  contents.on("did-fail-load", (_event, errorCode, _description, url, isMainFrame) => {
    // -3 is a load that was replaced by another one, not a failure.
    if (!isMainFrame || errorCode === -3) return;
    // The see-through screen overlay never shows the offline page: it tries again quietly.
    if (marks.isOverlay(contents)) return marks.overlayLoadFailed();
    const win = BrowserWindow.fromWebContents(contents);
    if (win) showOffline(win, url);
  });

  contents.on("render-process-gone", (_event, details) => {
    if (details.reason === "clean-exit") return;
    if (marks.isOverlay(contents)) return marks.overlayLoadFailed();
    const win = BrowserWindow.fromWebContents(contents);
    if (win) win.loadURL(ARIA_URL);
  });
}

function createWindow() {
  const state = loadWindowState();
  const win = new BrowserWindow({
    x: state.x,
    y: state.y,
    width: state.width || 1440,
    height: state.height || 900,
    minWidth: 900,
    minHeight: 600,
    title: "Aria",
    backgroundColor: "#0A0A14",
    icon: path.join(__dirname, "build", "icon.png"),
    autoHideMenuBar: true,
    webPreferences: webPreferences(),
  });
  if (state.maximized) win.maximize();

  win.on("close", () => saveWindowState(win));
  win.on("closed", () => {
    if (mainWindow === win) mainWindow = null;
    // Closing the window does not quit: Aria stays by the clock (or in the Dock on a Mac) so the
    // screen-mark shortcut keeps working over other apps. Quit from the tray icon or the menu.
    if (useTray && !quitting && !mainWindow && !toldAboutTray) {
      toldAboutTray = true;
      notify("Aria is still running", `Press ${shortcutWords()} anywhere to mark your screen. To quit, right-click the Aria icon by the clock.`);
    }
  });

  win.loadURL(ARIA_URL);
  mainWindow = win;
  return win;
}

// ---- permissions ----

async function askMac(mediaTypes) {
  if (!isMac) return true;
  const wanted = [];
  if (mediaTypes.includes("audio")) wanted.push("microphone");
  if (mediaTypes.includes("video")) wanted.push("camera");
  for (const kind of wanted) {
    if (systemPreferences.getMediaAccessStatus(kind) === "granted") continue;
    if (!(await systemPreferences.askForMediaAccess(kind))) return false;
  }
  return true;
}

function setUpPermissions(ses) {
  ses.setPermissionRequestHandler((contents, permission, callback, details) => {
    // Full screen is also asked for by embedded videos (YouTube), so it is allowed from anywhere.
    if (permission === "fullscreen") return callback(true);
    const origin = originOf(details.requestingUrl || contents.getURL());
    if (origin !== ARIA_ORIGIN || !ALLOWED_PERMISSIONS.has(permission)) return callback(false);
    if (permission === "media") {
      askMac(details.mediaTypes || []).then(callback, () => callback(false));
      return;
    }
    callback(true);
  });

  ses.setPermissionCheckHandler((_contents, permission, requestingOrigin) => {
    if (permission === "fullscreen") return true;
    // The origin arrives as "https://host/" here, with a trailing slash.
    return originOf(requestingOrigin) === ARIA_ORIGIN && ALLOWED_PERMISSIONS.has(permission);
  });
}

// ---- menu ----

function goHome() {
  const win = BrowserWindow.getFocusedWindow() || mainWindow;
  if (win) win.loadURL(ARIA_URL);
}

function buildMenu() {
  const hotkey = marks.hotkeyAccelerator();
  // Shown beside the menu item but not registered by the menu: the hotkey works from any app (screen.js).
  const markItem = { label: "Mark Something on Screen", ...(hotkey ? { accelerator: hotkey, registerAccelerator: false } : {}), click: () => marks.startMark() };
  const template = [
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [
              { role: "about" },
              { type: "separator" },
              markItem,
              { label: "Screen Recording Settings…", click: () => marks.screenSettings() },
              { type: "separator" },
              { role: "services" },
              { type: "separator" },
              { role: "hide" },
              { role: "hideOthers" },
              { role: "unhide" },
              { type: "separator" },
              { role: "quit" },
            ],
          },
        ]
      : [{ label: "File", submenu: [markItem, { label: "Screen-mark log (for help)", click: () => marks.openLog() }, { type: "separator" }, { role: "quit" }] }]),
    // Without an Edit menu, copy and paste shortcuts do nothing on a Mac.
    { role: "editMenu" },
    {
      label: "View",
      submenu: [
        { role: "reload" },
        { role: "forceReload" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
        { type: "separator" },
        { role: "toggleDevTools" },
      ],
    },
    {
      label: "Go",
      submenu: [
        { label: "Home", accelerator: "CmdOrCtrl+Shift+H", click: goHome },
        {
          label: "Back",
          accelerator: isMac ? "Cmd+[" : "Alt+Left",
          click: (_item, win) => win?.webContents.navigationHistory.canGoBack() && win.webContents.navigationHistory.goBack(),
        },
        {
          label: "Forward",
          accelerator: isMac ? "Cmd+]" : "Alt+Right",
          click: (_item, win) => win?.webContents.navigationHistory.canGoForward() && win.webContents.navigationHistory.goForward(),
        },
      ],
    },
    { role: "windowMenu" },
    {
      role: "help",
      submenu: [
        {
          label: "Open Aria in the Browser",
          click: (_item, win) => shell.openExternal(win && isAria(win.webContents.getURL()) ? win.webContents.getURL() : ARIA_URL),
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ---- the icon by the clock (Windows) ----

function shortcutWords() {
  const hk = marks.hotkeyAccelerator();
  if (!hk) return "the Aria icon by the clock → Mark something on screen";
  return isMac ? hk.replace("Control", "Control").replace("Alt", "Option").replace(/\+/g, " + ") : hk.replace("Control", "Ctrl").replace(/\+/g, " + ");
}

function notify(title, body) {
  marks.logLine(`told the student: ${title}: ${body}`);
  if (tray && process.platform === "win32") return tray.displayBalloon({ title, content: body, iconType: "info" });
  if (Notification.isSupported()) new Notification({ title, body }).show();
}

function openAria() {
  if (!mainWindow) return createWindow();
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function makeTray() {
  const icon = nativeImage.createFromPath(path.join(__dirname, "build", "icon.png")).resize({ width: 32, height: 32 });
  tray = new Tray(icon);
  tray.setToolTip(`Aria: ${shortcutWords()} marks your screen`);
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: `Mark something on screen${marks.hotkeyAccelerator() ? `   (${shortcutWords()})` : ""}`, click: () => marks.startMark() },
      { label: "Open Aria", click: openAria },
      { type: "separator" },
      { label: "Screen-mark log (for help)", click: () => marks.openLog() },
      { label: "Quit Aria", click: () => app.quit() },
    ]),
  );
  tray.on("click", openAria);
  tray.on("double-click", openAria);
}

// ---- start ----

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", openAria);
  app.on("before-quit", () => (quitting = true));

  app.on("web-contents-created", (_event, contents) => guardNavigation(contents));

  app.whenReady().then(() => {
    setUpPermissions(session.defaultSession);
    if (process.platform === "win32") app.setAppUserModelId("com.aria.tutor.desktop");
    marks.setUpScreenMarks({ ariaUrl: ARIA_URL, test: process.env.ARIA_SCREEN_SELFTEST === "1" });
    marks.setTroubleHandler((message) => notify("Aria", message));
    if (useTray && process.env.ARIA_SCREEN_SELFTEST !== "1") makeTray();
    buildMenu();
    createWindow();
    // Another app already holds both shortcuts: say so once, and how to mark instead.
    if (!marks.hotkeyAccelerator() && process.env.ARIA_SCREEN_SELFTEST !== "1") {
      setTimeout(() => notify("Aria's screen shortcut is taken", "Another app uses Ctrl + Alt + A and Ctrl + Alt + M. Use the Aria icon by the clock → Mark something on screen."), 4000);
    }

    app.on("activate", () => {
      if (!mainWindow) createWindow();
    });
  });

  app.on("window-all-closed", () => {
    // With the tray icon Aria keeps running; it quits from the icon or the menu.
    if (!isMac && !useTray) app.quit();
  });
}

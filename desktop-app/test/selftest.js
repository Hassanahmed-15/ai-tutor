// Launches the real app (main.js) against live Aria and checks it from the inside.
// Run: npm test   (ARIA_URL=http://127.0.0.1:59999 npm test  checks the offline screen)
const electron = require("electron");
const { app, BrowserWindow, systemPreferences } = electron;
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");

const shots = path.join(os.homedir(), "aria-qa-images", "desktop-app");
fs.mkdirSync(shots, { recursive: true });
const opened = [];
electron.shell.openExternal = async (url) => void opened.push(url); // never really open the browser
const errors = [];
const results = [];
const check = (name, ok, detail = "") => results.push(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

app.on("web-contents-created", (_e, contents) => {
  contents.on("console-message", (event) => {
    if (event.level === "error") errors.push(`${event.message}`.slice(0, 240));
  });
});

require("../main.js");

async function waitForLoad(win, ms = 90000) {
  const started = Date.now();
  while (Date.now() - started < ms) {
    if (!win.webContents.isLoading() && win.webContents.getURL()) return Date.now() - started;
    await wait(250);
  }
  return -1;
}

async function shot(win, name) {
  const image = await win.webContents.capturePage();
  fs.writeFileSync(path.join(shots, name), image.toPNG());
}

app.whenReady().then(async () => {
  await wait(500);
  // The see-through screen overlay is a window too (screen.js): test Aria's own window.
  const marks = require("../screen.js");
  const win = BrowserWindow.getAllWindows().find((w) => !marks.isOverlay(w.webContents));
  const offlineRun = (process.env.ARIA_URL || "").includes("127.0.0.1:59999");
  const ms = await waitForLoad(win);
  check("page finished loading", ms >= 0, `${ms} ms`);
  await wait(offlineRun ? 1500 : 6000);
  const url = win.webContents.getURL();
  const js = (code) => win.webContents.executeJavaScript(code);

  if (offlineRun) {
    check("offline screen shown when Aria cannot be reached", url.startsWith("file:") && url.includes("offline.html"), url.slice(0, 80));
    check("offline screen text", (await js("document.body.innerText")).includes("can't connect"));
    await shot(win, "offline.png");
  } else {
    const info = await js(`({
      title: document.title,
      text: document.body.innerText.slice(0, 300),
      ua: navigator.userAgent,
      speech: typeof window.webkitSpeechRecognition + "/" + typeof window.SpeechRecognition,
      media: !!navigator.mediaDevices?.getUserMedia,
      secure: window.isSecureContext,
      synth: typeof speechSynthesis,
      audio: typeof AudioContext,
      wasm: typeof WebAssembly,
      worklet: typeof AudioWorkletNode,
      storage: (() => { try { localStorage.setItem("aria-desktop-test", "1"); localStorage.removeItem("aria-desktop-test"); return true; } catch { return false; } })(),
    })`);
    check("Aria page is showing", url.startsWith("https://aria-tutor") && info.text.length > 20, `${info.title} | ${info.text.replace(/\s+/g, " ").slice(0, 90)}`);
    check("app introduces itself as Chrome (Google sign-in works)", !/Electron|Aria\//.test(info.ua), info.ua);
    check("broken Chrome speech recognition hidden", info.speech === "undefined/undefined", info.speech);
    check("microphone API available", info.media && info.secure);
    check("voice/audio features available", info.synth === "object" && info.audio === "function" && info.worklet === "function" && info.wasm === "object");
    check("local storage works", info.storage);
    const perm = await js(`navigator.permissions.query({ name: "microphone" }).then(p => p.state, e => String(e))`);
    check("microphone permission is not blocked", perm === "granted" || perm === "prompt", perm);
    const macMic = process.platform === "darwin" ? systemPreferences.getMediaAccessStatus("microphone") : "n/a";
    results.push(`INFO  macOS microphone access for this Electron binary: ${macMic}`);
    if (macMic === "granted") {
      const gum = await js(`navigator.mediaDevices.getUserMedia({ audio: true }).then(s => { const n = s.getAudioTracks().length; s.getTracks().forEach(t => t.stop()); return "tracks:" + n; }, e => e.name + ": " + e.message)`);
      check("microphone opens", gum.startsWith("tracks:1"), gum);
    }
    await shot(win, "home.png");

    // Links to other sites go to the normal browser, the app stays on Aria.
    const before = opened.length;
    await js(`(() => { const a = document.createElement("a"); a.href = "https://example.com/source"; a.target = "_blank"; document.body.appendChild(a); a.click(); a.remove(); })()`);
    await wait(800);
    check("new-tab link opens in the browser", opened.slice(before).includes("https://example.com/source"), opened.slice(before).join(","));
    await js(`location.href = "https://example.org/elsewhere"`);
    await wait(1500);
    check("leaving Aria opens the browser instead", win.webContents.getURL().startsWith("https://aria-tutor") && opened.includes("https://example.org/elsewhere"), win.webContents.getURL().slice(0, 60));

    // Other Aria pages load inside the app.
    for (const page of ["/courses", "/player-preview"]) {
      win.loadURL(new URL(page, url).href).catch(() => {});
      await wait(1000);
      const pageMs = await waitForLoad(win, 60000);
      results.push(`INFO  ${page} load time: ${pageMs} ms`);
      await wait(7000);
      const t = (await js("document.body.innerText")).replace(/\s+/g, " ");
      check(`page ${page} shows`, t.length > 20 && win.webContents.getURL().includes(page), t.slice(0, 90));
      await shot(win, `page${page.replace(/\//g, "-")}.png`);
    }
  }

  results.push(`INFO  console errors: ${errors.length}`);
  for (const e of [...new Set(errors)].slice(0, 15)) results.push(`      ${e}`);
  console.log("\n" + results.join("\n"));
  console.log(`\nscreenshots: ${shots}`);
  app.exit(results.some((r) => r.startsWith("FAIL")) ? 1 : 0);
});

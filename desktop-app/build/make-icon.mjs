// Renders build/icon.svg to the 1024 px build/icon.png the installers are made from.
// Run with `npm run icon`; it uses Electron's own Chromium so the SVG draws exactly as in a browser.
import { app, BrowserWindow } from "electron";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const dir = path.dirname(fileURLToPath(import.meta.url));
const svg = readFileSync(path.join(dir, "icon.svg"), "utf8");
const html = `<html><body style="margin:0;background:transparent">${svg}</body></html>`;

app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 1024, height: 1024, show: false, transparent: true, frame: false, useContentSize: true, webPreferences: { offscreen: true } });
  win.webContents.setZoomFactor(1);
  await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  await new Promise((r) => setTimeout(r, 300));
  const image = await win.webContents.capturePage({ x: 0, y: 0, width: 1024, height: 1024 });
  writeFileSync(path.join(dir, "icon.png"), image.resize({ width: 1024, height: 1024 }).toPNG());
  console.log("build/icon.png written", image.getSize());
  app.quit();
});

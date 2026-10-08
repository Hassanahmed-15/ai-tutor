import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const browser = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--autoplay-policy=no-user-gesture-required", "--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"] });
const context = await browser.newContext({ viewport: { width: 1000, height: 900 }, colorScheme: "dark", permissions: ["microphone"] });
const page = await context.newPage();
page.on("console", (m) => { const t = m.text(); if (/mouth|script|rules|viseme|\[gemini|error/i.test(t) && !/GL Driver|Compiled|Download the React/.test(t)) console.log("console:", t.slice(0, 180)); });
page.on("pageerror", (e) => console.log("pageerror:", String(e).slice(0, 200)));
await page.goto("http://localhost:3000/avatar-lab?head=none", { waitUntil: "domcontentloaded", timeout: 120000 });
await page.waitForSelector("text=Avatar lab", { timeout: 120000 });
await page.waitForTimeout(1500);
await page.getByRole("button", { name: "Start Gemini" }).click();
for (let i = 0; i < 40; i++) { const t = await page.locator("[data-gemini]").innerText(); if (/· live/.test(t)) break; await page.waitForTimeout(500); }
console.log("gemini:", (await page.locator("[data-gemini]").innerText()).split("\n")[0]);
await page.getByRole("button", { name: "Say the sentence" }).click();
const rows = []; const tile = page.locator('[role="img"][aria-label="Aria"]'); let shots = 0; let lastTop = "";
for (let i = 0; i < 140; i++) {
  const m = await page.evaluate(() => { const lab = window.__ariaLab; const d = lab?.track?.(); const v = lab?.visemes ? Object.entries(lab.visemes()).filter(([, w]) => w > 0.2).map(([k, w]) => `${k}:${w.toFixed(2)}`).join(" ") : ""; return `${(document.querySelector("[data-mouth]")?.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 60)} | track ${d ? `${d.frames}f ${d.units}u ${d.segments.length}s` : "-"} | ${v}`; });
  const g = await page.evaluate(() => (document.querySelector("[data-gemini]")?.textContent ?? "").includes("speaking"));
  rows.push(`${(i * 0.1).toFixed(1)}s ${g ? "SPK" : "   "} ${m.slice(0, 150)}`);
  const top = (m.split("visemes")[0] && m.match(/(PP|FF|TH|aa|O|U|I|E|SS|DD|kk|nn|RR|CH) 0\.\d+/)?.[1]) ?? "";
  await page.waitForTimeout(100);
}
const speaking = rows.filter((r) => r.includes("SPK"));
console.log("speaking frames:", speaking.length, "of", rows.length);
console.log(speaking.filter((_, i) => i % 2 === 0).slice(0, 40).join("\n"));
await browser.close();

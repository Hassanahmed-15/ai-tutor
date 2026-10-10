import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const WAV = new URL("./fixtures/sentence-24k.wav", import.meta.url).pathname;
const raw = readFileSync(WAV); const di = raw.indexOf("data"); const pcm = new Int16Array(raw.buffer.slice(raw.byteOffset + di + 8));
const sr = 24000, hop = Math.round(sr * 0.016); const env = [];
for (let i = 0; i + hop <= pcm.length; i += hop) { let s = 0; for (let j = i; j < i + hop; j++) s += (pcm[j] / 32768) ** 2; env.push(Math.sqrt(s / hop)); }
const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
const page = await browser.newPage({ viewport: { width: 900, height: 760 }, colorScheme: "dark" });
page.on("console", (m) => { if (!/HMR|DevTools/.test(m.text())) console.log("[page]", m.text()); });
await page.goto("http://localhost:3000/avatar-lab?head=none", { waitUntil: "domcontentloaded", timeout: 120000 });
await page.waitForSelector("text=Avatar lab", { timeout: 120000 });
await page.waitForTimeout(1500);
await page.locator("[data-speech-file]").setInputFiles(WAV);
await page.waitForTimeout(800);
const r = await page.evaluate(async () => {
  const lab = window.__ariaLab; const d = lab.track();
  const samples = [];
  for (let i = 0; i < 300; i++) { const L = lab.loop(); samples.push({ t: +(L.clock - lab.startAt).toFixed(3), v: Object.entries(lab.visemes()).filter(([, w]) => w > 0.2).map(([k, w]) => `${k}:${w.toFixed(2)}`).join(" "), open: +lab.mouth().open.toFixed(2) }); await new Promise((r) => setTimeout(r, 25)); }
  return { d, samples };
});
await browser.close();
console.log(`frames ${r.d.frames} units ${r.d.units} segments ${r.d.segments.length}`);
const line = r.d.segments.map((s) => `${(s.start * 0.016).toFixed(2)}-${(s.end * 0.016).toFixed(2)} ${s.viseme} e=${(env.slice(s.start, s.end).reduce((a, b) => a + b, 0) / Math.max(1, s.end - s.start)).toFixed(3)}`);
console.log(line.join("\n"));
console.log("--- live visemes (clock vs published)");
console.log(r.samples.filter((_, i) => i % 4 === 0).map((s) => `${s.t} open ${s.open} ${s.v}`).join("\n"));

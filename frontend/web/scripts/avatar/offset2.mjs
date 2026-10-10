import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
import { readFileSync } from "node:fs";
const WAV = new URL("./fixtures/sentence-24k.wav", import.meta.url).pathname;
const raw = readFileSync(WAV); const di = raw.indexOf("data"); const pcm = new Int16Array(raw.buffer.slice(raw.byteOffset + di + 8));
const sr = 24000, hop = Math.round(sr * 0.02); const env = [];
for (let i = 0; i + hop <= pcm.length; i += hop) { let s = 0; for (let j = i; j < i + hop; j++) s += (pcm[j] / 32768) ** 2; env.push(Math.sqrt(s / hop)); }
const browser = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--autoplay-policy=no-user-gesture-required"] });
const page = await browser.newPage({ viewport: { width: 900, height: 760 }, colorScheme: "dark" });
await page.goto("http://localhost:3000/avatar-lab?head=none", { waitUntil: "domcontentloaded", timeout: 120000 });
await page.waitForSelector("text=Avatar lab", { timeout: 120000 });
await page.waitForTimeout(1500);
await page.locator("[data-speech-file]").setInputFiles(WAV);
await page.waitForTimeout(300);
const samples = await page.evaluate(async () => {
  const lab = window.__ariaLab; const out = []; const rafs = []; let last = performance.now();
  const tick = () => { const n = performance.now(); rafs.push(n - last); last = n; if (rafs.length < 400) requestAnimationFrame(tick); }; requestAnimationFrame(tick);
  await new Promise((r) => setTimeout(r, 100));
  let ol = 0; for (let i = 0; i < 400; i++) { const t = lab.now(); const L = lab.loop(); ol = L.now - L.clock + 0.06; const f = lab.frameAt(L.clock); out.push({ t: t - ol - lab.startAt, open: lab.mouth().open, direct: f ? f.open : 0 }); await new Promise((r) => setTimeout(r, 20)); }
  rafs.sort((a, b) => a - b);
  return { out, outputLatency: ol, rafMedian: rafs[rafs.length >> 1], rafMax: rafs[rafs.length - 1] };
});
await browser.close();
const grid = (key) => { const j = new Array(env.length).fill(0); for (const s of samples.out) { const k = Math.round(s.t / 0.02); if (k >= 0 && k < j.length) j[k] = Math.max(j[k], s[key]); } for (let i = 1; i < j.length; i++) if (j[i] === 0 && j[i-1] > 0 && !samples.out.some(s => Math.round(s.t/0.02) === i)) j[i] = j[i-1]; return j; };
const norm = (a) => { const m = a.reduce((x, y) => x + y, 0) / a.length; const sd = Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / a.length) || 1; return a.map((v) => (v - m) / sd); };
const E = norm(env);
for (const key of ["open", "direct"]) {
  const J = norm(grid(key)); let best = { lag: 0, r: -1 }; let r0 = 0;
  for (let lag = -30; lag <= 30; lag++) { let r = 0, n = 0; for (let i = 0; i < E.length; i++) { const j = i + lag; if (j >= 0 && j < J.length) { r += E[i] * J[j]; n++; } } r /= n || 1; if (lag === 0) r0 = r; if (r > best.r) best = { lag, r }; }
  console.log(`${key}: r0=${r0.toFixed(2)} best r=${best.r.toFixed(2)} at lag ${best.lag * 20} ms`);
}
console.log(`rAF median ${samples.rafMedian.toFixed(0)} ms, max ${samples.rafMax.toFixed(0)} ms, outputLatency ${samples.outputLatency}`);

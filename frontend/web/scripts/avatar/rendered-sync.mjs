// The honest lip-sync measurement: the jaw the RENDERER is handed each frame (performance.now) against
// the narration audio as it PLAYS (each clip's start on the same clock), during real lecture narration
// in /player-preview. Needs `npm run dev`, ffmpeg.
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const SECONDS = Number(process.argv[2] ?? 40);
const work = mkdtempSync(join(tmpdir(), "aria-rsync-"));
const b = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist", "--autoplay-policy=no-user-gesture-required"] });
const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
await p.route("**/api/auth/me", (r) => r.fulfill({ json: { databaseConfigured: true, user: { id: "u1", email: "s@x.com", username: "sana", onboarded: true, needsLearnerProfile: false, needsPreferences: false, hasPassword: true, providers: [] }, profile: { displayName: "Sana", age: 15, accessibility: "none", reducedMotion: null, captions: null, slowerPace: null, simplerLanguage: null, notes: null, learner: null, updatedAt: "" } } }));
await p.addInitScript(() => {
  const blobs = new Map(); window.__blobs = blobs; window.__plays = [];
  const create = URL.createObjectURL;
  URL.createObjectURL = function (obj) { const url = create.call(URL, obj); if (obj instanceof Blob) blobs.set(url, obj.arrayBuffer().then((buf) => { const u = new Uint8Array(buf); let s = ""; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s); })); return url; };
  // When each clip actually starts sounding: the first `playing` event, on the page clock.
  const play = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function (...a) {
    const src = this.src, el = this;
    const onPlaying = () => { el.removeEventListener("playing", onPlaying); window.__plays.push({ src, at: performance.now() - el.currentTime * 1000 }); };
    el.addEventListener("playing", onPlaying);
    return play.apply(this, a);
  };
});
await p.goto("http://localhost:3000/player-preview", { waitUntil: "domcontentloaded", timeout: 120000 });
await p.waitForTimeout(15000);
await p.evaluate(() => { window.__ariaRendered = []; });
await p.getByRole("button", { name: /^(Play|Start)/i }).first().click();
await p.waitForTimeout(SECONDS * 1000);
const { rendered, plays, outputLatency } = await p.evaluate(() => ({ rendered: window.__ariaRendered, plays: window.__plays, outputLatency: 0 }));
const clips = await p.evaluate(async (srcs) => Promise.all(srcs.map(async (s) => (window.__blobs.has(s) ? await window.__blobs.get(s) : null))), plays.map((x) => x.src));
await b.close();

// The audio timeline on the page clock: each clip's envelope placed where it started.
const HOP = 20, t0 = Math.min(...plays.map((x) => x.at)), t1 = rendered[rendered.length - 1].at;
const n = Math.ceil((t1 - t0) / HOP), env = new Float64Array(n);
plays.forEach((pl, k) => {
  if (!clips[k]) return;
  const mp3 = join(work, `c${k}.mp3`), raw = join(work, `c${k}.f32`);
  writeFileSync(mp3, Buffer.from(clips[k], "base64"));
  execFileSync("ffmpeg", ["-v", "error", "-y", "-i", mp3, "-ac", "1", "-ar", "16000", "-f", "f32le", raw]);
  const buf = readFileSync(raw), pcm = new Float32Array(buf.buffer, buf.byteOffset, buf.length / 4), hop = 16000 * HOP / 1000;
  for (let i = 0; i + hop <= pcm.length; i += hop) { let s = 0; for (let j = i; j < i + hop; j++) s += pcm[j] * pcm[j]; const f = Math.round((pl.at - t0 + (i / 16000) * 1000) / HOP); if (f >= 0 && f < n) env[f] = Math.max(env[f], Math.sqrt(s / hop)); }
});
const jaw = new Float64Array(n), seal = new Float64Array(n);
for (const r of rendered) { const f = Math.round((r.at - t0) / HOP); if (f >= 0 && f < n) { jaw[f] = r.jaw; seal[f] = r.close; } }
for (let i = 1; i < n; i++) if (jaw[i] === 0 && jaw[i - 1] > 0 && !rendered.length) jaw[i] = jaw[i - 1];
const norm = (x) => { const a = Array.from(x), m = a.reduce((p, q) => p + q, 0) / a.length, sd = Math.sqrt(a.reduce((p, q) => p + (q - m) ** 2, 0) / a.length) || 1; return a.map((v) => (v - m) / sd); };
const E = norm(env), J = norm(jaw);
let best = { lag: 0, r: -2 }, r0 = 0;
for (let lag = -25; lag <= 25; lag++) { let r = 0, c = 0; for (let i = 0; i < n; i++) { const j = i + lag; if (j >= 0 && j < n) { r += E[i] * J[j]; c++; } } r /= c; if (lag === 0) r0 = r; if (r > best.r) best = { lag, r }; }
const speaking = Array.from(env).filter((v) => v > 0.02).length;
const openWhileSilent = Array.from(env).filter((v, i) => v < 0.005 && jaw[i] > 0.15).length;
const closedWhileLoud = Array.from(env).filter((v, i) => v > 0.06 && jaw[i] < 0.05).length;
console.log(`clips ${plays.length}, rendered frames ${rendered.length}, ${(n * HOP / 1000).toFixed(1)}s`);
console.log(`RENDERED jaw vs PLAYED audio: r at 0 = ${r0.toFixed(2)}; best r = ${best.r.toFixed(2)} at jaw lag ${best.lag * HOP} ms (+ = jaw after sound)`);
console.log(`jaw open while silent: ${openWhileSilent} frames; jaw shut while loud: ${closedWhileLoud} of ${Array.from(env).filter((v) => v > 0.06).length} loud frames`);
const from = Math.round(3000 / HOP);
let l1 = "", l2 = "";
for (let f = from; f < from + 150 && f < n; f++) { l1 += env[f] > 0.05 ? "#" : env[f] > 0.015 ? "+" : "."; l2 += jaw[f] > 0.35 ? "#" : jaw[f] > 0.12 ? "+" : "."; }
console.log(`sound 3-6s: ${l1}`); console.log(`jaw   3-6s: ${l2}`);

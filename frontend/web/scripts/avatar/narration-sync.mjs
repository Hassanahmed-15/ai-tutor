// Measures lecture-narration lip-sync in /player-preview: for each sentence, the jaw against that
// sentence's own audio (lag + correlation), and where the sealed-lip frames (p/b/m) fall relative to
// the audio's quiet frames. Needs `npm run dev`, ffmpeg, and TTS keys in .env.local.
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const SECONDS = Number(process.argv[2] ?? 45);
const work = mkdtempSync(join(tmpdir(), "aria-sync-"));

const b = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist", "--autoplay-policy=no-user-gesture-required"] });
const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
await p.route("**/api/auth/me", (r) => r.fulfill({ json: { databaseConfigured: true, user: { id: "u1", email: "s@x.com", username: "sana", onboarded: true, needsLearnerProfile: false, needsPreferences: false, hasPassword: true, providers: [] }, profile: { displayName: "Sana", age: 15, accessibility: "none", reducedMotion: null, captions: null, slowerPace: null, simplerLanguage: null, notes: null, learner: null, updatedAt: "" } } }));
await p.addInitScript(() => {
  const blobs = new Map();
  window.__blobs = blobs;
  const create = URL.createObjectURL;
  URL.createObjectURL = function (obj) { const url = create.call(URL, obj); if (obj instanceof Blob) blobs.set(url, obj.arrayBuffer().then((buf) => { const u = new Uint8Array(buf); let s = ""; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s); })); return url; };
  const play = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function (...a) { window.__el = this; return play.apply(this, a); };
});
await p.goto("http://localhost:3000/player-preview", { waitUntil: "domcontentloaded", timeout: 120000 });
await p.waitForTimeout(14000);
await p.getByRole("button", { name: /^(Play|Start)/i }).first().click();
// Sample at every animation frame inside the page: which clip, its time, the jaw, the top shape.
const samples = await p.evaluate(async (seconds) => {
  const out = [];
  const end = performance.now() + seconds * 1000;
  await new Promise((resolve) => {
    const tick = () => {
      const el = window.__el, m = window.__ariaMouth;
      if (el && m && !el.paused) {
        const v = m.visemes() || {};
        const top = Object.entries(v).sort((a, b) => b[1] - a[1])[0];
        out.push({ src: el.currentSrc, t: el.currentTime, open: m.shape().open, top: top && top[1] > 0.25 ? top[0] : "", sealed: (v.PP ?? 0) >= 0.7, clip: m.clip() });
      }
      if (performance.now() < end) requestAnimationFrame(tick); else resolve();
    };
    requestAnimationFrame(tick);
  });
  return out;
}, SECONDS);
const srcs = [...new Set(samples.map((s) => s.src))];
const clips = await p.evaluate(async (srcs) => Promise.all(srcs.map(async (s) => (window.__blobs.has(s) ? await window.__blobs.get(s) : null))), srcs);
await b.close();

const HOP = 0.016;
const results = [];
srcs.forEach((src, k) => {
  if (!clips[k]) return;
  const mp3 = join(work, `c${k}.mp3`), raw = join(work, `c${k}.f32`);
  writeFileSync(mp3, Buffer.from(clips[k], "base64"));
  execFileSync("ffmpeg", ["-v", "error", "-y", "-i", mp3, "-ac", "1", "-ar", "24000", "-f", "f32le", raw]);
  const buf = readFileSync(raw); const pcm = new Float32Array(buf.buffer, buf.byteOffset, buf.length / 4);
  const hop = Math.round(HOP * 24000), env = [];
  for (let i = 0; i + hop <= pcm.length; i += hop) { let s = 0; for (let j = i; j < i + hop; j++) s += pcm[j] * pcm[j]; env.push(Math.sqrt(s / hop)); }
  const mine = samples.filter((s) => s.src === src);
  const jaw = new Array(env.length).fill(null), top = new Array(env.length).fill(""), sealed = new Array(env.length).fill(null);
  for (const s of mine) { const f = Math.round(s.t / HOP); if (f >= 0 && f < env.length) { jaw[f] = s.open; top[f] = s.top; sealed[f] = s.sealed; } }
  for (let i = 1; i < jaw.length; i++) if (jaw[i] === null) { jaw[i] = jaw[i - 1]; top[i] = top[i - 1]; sealed[i] = sealed[i - 1]; }
  const J = jaw.map((v) => v ?? 0);
  const norm = (a) => { const m = a.reduce((x, y) => x + y, 0) / a.length; const sd = Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / a.length) || 1; return a.map((v) => (v - m) / sd); };
  const E = norm(env), Jn = norm(J);
  let best = { lag: 0, r: -2 };
  for (let lag = -15; lag <= 15; lag++) { let r = 0, n = 0; for (let i = 0; i < E.length; i++) { const j = i + lag; if (j >= 0 && j < Jn.length) { r += E[i] * Jn[j]; n++; } } r /= n || 1; if (r > best.r) best = { lag, r }; }
  const median = [...env].sort((a, b) => a - b)[Math.floor(env.length / 2)];
  // Frames where the lips are fully sealed (p/b/m at 0.7+ of the track's 0.8 scale), not easing in or out.
  const pp = sealed.map((t, i) => (t ? i : -1)).filter((i) => i >= 0);
  const ppQuiet = pp.length ? pp.filter((i) => env[i] <= median).length / pp.length : null;
  const method = mine.find((s) => s.clip)?.clip?.method ?? "none";
  results.push({ k, dur: (pcm.length / 24000).toFixed(1), method, lagMs: best.lag * HOP * 1000, r: best.r, ppFrames: pp.length, ppQuiet, shapes: [...new Set(top.filter(Boolean))].join(" ") });
});
for (const r of results) console.log(`sentence ${r.k}: ${r.dur}s method=${r.method} jaw lag ${r.lagMs.toFixed(0)} ms r=${r.r.toFixed(2)} | p/b/m frames ${r.ppFrames}, in quiet audio ${r.ppQuiet === null ? "-" : Math.round(r.ppQuiet * 100) + "%"} | shapes: ${r.shapes}`);
const ok = results.filter((r) => r.method === "aligned");
if (ok.length) console.log(`\n${ok.length}/${results.length} sentences aligned; median lag ${ok.map((r) => r.lagMs).sort((a, b) => a - b)[Math.floor(ok.length / 2)]} ms; median r ${ok.map((r) => r.r).sort((a, b) => a - b)[Math.floor(ok.length / 2)].toFixed(2)}`);

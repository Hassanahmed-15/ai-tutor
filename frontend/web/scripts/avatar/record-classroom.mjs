// Records the classroom demo (/classroom) as an MP4 with Aria's narration, for sharing.
//
//   node scripts/avatar/record-classroom.mjs [seconds=180] [out=~/Downloads/aria-classroom-demo.mp4]
//
// Needs `npm run dev` and ffmpeg. Frames come from Chrome's screencast on the real GPU (Playwright's
// own video is soft and silent); each narration clip is captured as it starts playing, with its
// start time, and ffmpeg lays the clips onto the timeline.
import { createRequire } from "node:module";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const SECONDS = Number(process.argv[2] ?? 180);
const OUT = process.argv[3] ?? join(homedir(), "Downloads", "aria-classroom-demo.mp4");
const W = 1440, H = 900, FPS = 30;
const work = join(tmpdir(), `aria-record-${process.pid}`);
rmSync(work, { recursive: true, force: true });
mkdirSync(join(work, "frames"), { recursive: true });

const browser = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist", "--autoplay-policy=no-user-gesture-required"] });
const page = await browser.newPage({ viewport: { width: W, height: H }, colorScheme: "dark" });
page.on("pageerror", (e) => console.log("pageerror:", String(e).slice(0, 200)));

// Every narration clip, as it starts: when (wall clock) and its bytes. The bytes are taken when the
// clip's blob becomes a URL — the player frees each URL right after use, so reading it at play time
// loses the race.
await page.addInitScript(() => {
  const toB64 = (buf) => {
    const bytes = new Uint8Array(buf);
    let s = "";
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s);
  };
  const blobs = new Map();
  const clips = [];
  window.__clips = clips;
  window.__blobs = blobs;
  const create = URL.createObjectURL;
  URL.createObjectURL = function (obj) {
    const url = create.call(URL, obj);
    if (obj instanceof Blob) blobs.set(url, obj.arrayBuffer().then(toB64));
    return url;
  };
  const play = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function (...args) {
    clips.push({ at: Date.now(), from: this.currentTime || 0, src: this.currentSrc || this.src });
    return play.apply(this, args);
  };
});

await page.goto("http://localhost:3000/classroom", { waitUntil: "domcontentloaded", timeout: 120000 });
await page.waitForFunction(() => window.__ariaClassroom, null, { timeout: 120000 });
await page.waitForTimeout(1500);

// Frames.
const cdp = await page.context().newCDPSession(page);
const frames = [];
let n = 0;
cdp.on("Page.screencastFrame", async ({ data, metadata, sessionId }) => {
  const file = join(work, "frames", `${String(n++).padStart(6, "0")}.jpg`);
  writeFileSync(file, Buffer.from(data, "base64"));
  frames.push({ file, t: metadata.timestamp * 1000 });
  try { await cdp.send("Page.screencastFrameAck", { sessionId }); } catch {}
});
await cdp.send("Page.startScreencast", { format: "jpeg", quality: 92, maxWidth: W, maxHeight: H, everyNthFrame: 1 });
const t0 = Date.now();

// The room before the lesson: Aria in the middle, then Play.
await page.waitForTimeout(3500);
await page.getByRole("button", { name: /^(Play|Start)/i }).first().click();
await page.mouse.move(W - 6, H / 2); // no hover tooltips in the shot
const step = 15;
for (let s = 0; s < SECONDS; s += step) {
  await page.waitForTimeout(step * 1000);
  console.log(`recorded ${Math.min(SECONDS, s + step)}s / ${SECONDS}s, frames ${frames.length}`);
}
await cdp.send("Page.stopScreencast");
const tEnd = Date.now();
await page.waitForTimeout(500);
const clips = await page.evaluate(async () => Promise.all(window.__clips.map(async (c) => ({ at: c.at, from: c.from, b64: window.__blobs.has(c.src) ? await window.__blobs.get(c.src) : null }))));
await browser.close();

// Video: each frame held until the next one, resampled to a steady 30 fps.
const lines = [];
for (let i = 0; i < frames.length; i++) {
  const dur = ((frames[i + 1]?.t ?? tEnd) - frames[i].t) / 1000;
  lines.push(`file '${frames[i].file}'`, `duration ${Math.max(0.001, dur).toFixed(4)}`);
}
lines.push(`file '${frames[frames.length - 1].file}'`);
writeFileSync(join(work, "frames.txt"), lines.join("\n"));
const videoStart = frames[0].t;

// Audio: each clip placed where it started playing.
const audioInputs = [];
const filters = [];
let k = 0;
for (const c of clips) {
  if (!c.b64) continue;
  const delay = Math.max(0, Math.round(c.at - videoStart));
  if (delay > tEnd - videoStart) continue;
  const f = join(work, `clip-${k}.mp3`);
  writeFileSync(f, Buffer.from(c.b64, "base64"));
  audioInputs.push("-i", f);
  filters.push(`[${k + 1}:a]atrim=start=${c.from.toFixed(3)},asetpts=PTS-STARTPTS,adelay=${delay}|${delay}[a${k}]`);
  k++;
}
console.log(`frames ${frames.length} (${((tEnd - videoStart) / 1000).toFixed(1)}s), narration clips ${k} of ${clips.length}`);

const args = ["-y", "-f", "concat", "-safe", "0", "-i", join(work, "frames.txt"), ...audioInputs];
if (k > 0) {
  const mix = filters.join(";") + ";" + Array.from({ length: k }, (_, i) => `[a${i}]`).join("") + `amix=inputs=${k}:normalize=0:dropout_transition=0,volume=1.6[aout]`;
  args.push("-filter_complex", mix, "-map", "0:v", "-map", "[aout]", "-c:a", "aac", "-b:a", "160k");
}
args.push("-vf", `fps=${FPS},format=yuv420p`, "-c:v", "libx264", "-preset", "slow", "-crf", "20", "-movflags", "+faststart", "-t", ((tEnd - videoStart) / 1000).toFixed(2), OUT);
execFileSync("ffmpeg", args, { stdio: ["ignore", "ignore", "inherit"] });
rmSync(work, { recursive: true, force: true });
console.log(`wrote ${OUT}`);

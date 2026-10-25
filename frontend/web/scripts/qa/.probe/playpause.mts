// The play/pause button in the REAL player (free; silent stand-in voice): pressed mid-sentence, her voice
// stops and the board does not move on; pressed again, both carry on from there.
//   node --import tsx scripts/qa/.probe/playpause.mts <sessionId> [board number]
import { readFileSync } from "node:fs";
import { chromium } from "playwright";
import { SignJWT } from "jose";
const env = Object.fromEntries(readFileSync(".env.local", "utf8").split("\n").filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^"|"$/g, "")]));
const [id, boardArg] = process.argv.slice(2);
const sub = process.env.QA_USER ?? "local-dev-canvas";
const token = await new SignJWT({ email: `${sub}@example.com` }).setProtectedHeader({ alg: "HS256" }).setSubject(sub).setIssuedAt().setExpirationTime("1h").sign(new TextEncoder().encode(env.AUTH_SECRET));
const snap = await (await fetch(`http://localhost:3000/api/progressive-lectures/${id}`, { headers: { cookie: `aria_access=${token}` } })).json() as { topic?: string; beats?: Array<{ id: string; script: string } | null> };
const all = (snap.beats ?? []).filter((b): b is { id: string; script: string } => Boolean(b));
const start = Math.max(0, Number(boardArg ?? 1) - 1);
const beats = all.slice(start, start + 1);
function wav(seconds: number, extra: number): Buffer {
  const samples = Math.round(seconds * 8000) + extra;
  const b = Buffer.alloc(44 + samples * 2);
  b.write("RIFF", 0); b.writeUInt32LE(36 + samples * 2, 4); b.write("WAVE", 8); b.write("fmt ", 12);
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(8000, 24); b.writeUInt32LE(16000, 28);
  b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write("data", 36); b.writeUInt32LE(samples * 2, 40);
  return b;
}
const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
let n = 0;
await page.route("**/api/tts", async (route) => {
  const text = String((route.request().postDataJSON() as { text?: string })?.text ?? "");
  await route.fulfill({ status: 200, contentType: "audio/wav", body: wav(Math.max(0.9, text.split(/\s+/).length / 2.6 + 0.2), ++n) }).catch(() => undefined);
});
await ctx.addInitScript(() => {
  const w = window as unknown as Record<string, unknown>;
  w.__name = (f: unknown) => f;
  const log: Array<Record<string, unknown>> = [];
  w.__ev = log;
  const plain = console.log.bind(console);
  console.log = (...a: unknown[]) => { if (typeof a[0] === "string" && a[0].startsWith("[playback] sentence ")) log.push({ t: performance.now(), ev: "sentence" }); plain(...a); };
  const Original = window.Audio;
  const els: HTMLAudioElement[] = [];
  w.__audios = els;
  function Tracked(this: unknown, ...x: unknown[]) {
    const el = new (Original as unknown as new (...y: unknown[]) => HTMLAudioElement)(...x);
    els.push(el);
    for (const ev of ["playing", "pause", "ended"]) el.addEventListener(ev, () => log.push({ t: performance.now(), ev: `audio-${ev}` }));
    return el;
  }
  Tracked.prototype = Original.prototype;
  (window as unknown as { Audio: unknown }).Audio = Tracked;
});
await page.goto("http://localhost:3000/playback-lab", { waitUntil: "domcontentloaded", timeout: 90_000 });
await page.evaluate((lecture) => ((window as unknown as { __PLAYBACK_BEATS__: unknown }).__PLAYBACK_BEATS__ = lecture), { title: snap.topic ?? id, beats });
const button = (name: RegExp) => page.getByRole("button", { name }).first();
await button(/(play|pause) the lecture/i).waitFor({ state: "visible", timeout: 90_000 });
await page.waitForTimeout(1500);
if (await button(/play the lecture/i).isVisible().catch(() => false)) await button(/play the lecture/i).click();
// Into the board's second sentence, then pause.
for (let i = 0; i < 60; i++) { const k = await page.evaluate(() => ((window as any).__ev as any[]).filter((e) => e.ev === "sentence").length); if (k >= 2) break; await page.waitForTimeout(500); }
await page.waitForTimeout(700);
const speaking = () => page.evaluate(() => ((window as any).__audios as HTMLAudioElement[]).some((a) => !a.paused && !a.ended));
const sentences = () => page.evaluate(() => ((window as any).__ev as any[]).filter((e) => e.ev === "sentence").length);
const before = { speaking: await speaking(), sentences: await sentences() };
await button(/pause the lecture/i).click();
await page.waitForTimeout(400);
const paused0 = { speaking: await speaking(), sentences: await sentences() };
await page.waitForTimeout(5000);
const paused5 = { speaking: await speaking(), sentences: await sentences(), playVisible: await button(/play the lecture/i).isVisible().catch(() => false) };
await button(/play the lecture/i).click();
await page.waitForTimeout(600);
const resumed = { speaking: await speaking() };
await page.waitForTimeout(9000);
const after = { sentences: await sentences() };
console.log(`board ${start + 1}: before pause — voice ${before.speaking ? "speaking" : "silent"}, sentence ${before.sentences}`);
console.log(`  pressed pause — voice ${paused0.speaking ? "STILL SPEAKING" : "stopped"}; 5 s later voice ${paused5.speaking ? "STILL SPEAKING" : "stopped"}, board ${paused5.sentences === paused0.sentences ? "did not move on" : `MOVED ON ${paused5.sentences - paused0.sentences} sentence(s)`}, Play button ${paused5.playVisible ? "shown" : "MISSING"}`);
console.log(`  pressed play — voice ${resumed.speaking ? "speaking again" : "SILENT"}; 9 s later the board moved on ${after.sentences - paused5.sentences} sentence(s)`);
const pass = !paused0.speaking && !paused5.speaking && paused5.sentences === paused0.sentences && paused5.playVisible && resumed.speaking && after.sentences > paused5.sentences;
console.log(pass ? "PAUSE/PLAY: PASS" : "PAUSE/PLAY: FAIL");
await browser.close();
process.exit(0);

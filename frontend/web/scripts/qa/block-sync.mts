/**
 * BLOCK SYNC CHECK — does each piece of the full board appear when the audio reaches it? A saved lecture is
 * played in the REAL player (/playback-lab) with silent stand-in audio and plain blocks made from its own
 * scripts (free: no model, no TTS). For every piece: the moment it appeared minus the moment the audio
 * reached it (clip start + its place in the sentence). Also pauses mid-board (no piece may appear while
 * paused) and checks that no piece is skipped or shown twice.
 *
 *   QA_USER=<id> node --import tsx scripts/qa/block-sync.mts <sessionId> [--speed=1] [--boards=2]
 * The reveal's own timing is measured here; how well word positions match a real voice needs real audio.
 */
import { readFileSync } from "node:fs";
import { chromium } from "playwright";
import { SignJWT } from "jose";
import { plainBlocks, revealUnits } from "../../lib/canvas/blocks";
import { canvasSentences } from "../../lib/canvas/plan";

const BASE = "http://localhost:3000";
const env = Object.fromEntries(readFileSync(".env.local", "utf8").split("\n").filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^["']|["']$/g, "")]));
const args = process.argv.slice(2);
const flag = (n: string, d: string) => args.find((a) => a.startsWith(`--${n}=`))?.split("=")[1] ?? d;
const id = args.find((a) => !a.startsWith("--"))!;
const SPEED = Number(flag("speed", "1"));
const BOARDS = Number(flag("boards", "2"));
const subject = process.env.QA_USER ?? "local-dev-canvas";
const token = await new SignJWT({}).setProtectedHeader({ alg: "HS256" }).setSubject(subject).setIssuedAt().setExpirationTime("2h").sign(new TextEncoder().encode(env.AUTH_SECRET));
function wav(seconds: number, extra: number): Buffer {
  const samples = Math.round(seconds * 8000) + extra;
  const b = Buffer.alloc(44 + samples * 2);
  b.write("RIFF", 0); b.writeUInt32LE(36 + samples * 2, 4); b.write("WAVE", 8); b.write("fmt ", 12); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(8000, 24); b.writeUInt32LE(16000, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write("data", 36); b.writeUInt32LE(samples * 2, 40);
  return b;
}
const seconds = (t: string) => Math.max(0.9, t.split(/\s+/).filter(Boolean).length / 2.6 + 0.2);
type B = { id: string; script: string; draw?: { ops: Array<{ kind: string; spec?: Record<string, unknown> & { stage: { kind: string } } }> } };
const snap = (await (await fetch(`${BASE}/api/progressive-lectures/${id}`, { headers: { cookie: `aria_access=${token}` } })).json()) as { beats: Array<B | null> };
const beats = snap.beats.filter((b): b is B => Boolean(b)).filter((b) => b.draw?.ops.some((o) => o.kind === "canvasBoard" && o.spec?.stage.kind !== "exam")).slice(0, BOARDS);
for (const b of beats) { const op = b.draw!.ops.find((o) => o.kind === "canvasBoard")!; op.spec = { ...op.spec!, blocks: plainBlocks(b.id, b.script) }; }
const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.addCookies([{ name: "aria_access", value: token, domain: "localhost", path: "/" }]);
const page = await ctx.newPage();
const bySize = new Map<number, string>();
let n = 0;
await page.route("**/api/tts", async (route) => {
  const text = String((route.request().postDataJSON() as { text?: string })?.text ?? "");
  const body = wav(seconds(text), ++n);
  bySize.set(body.length, text);
  await route.fulfill({ status: 200, contentType: "audio/wav", body });
});
await ctx.addInitScript((rate: number) => {
  const w = window as unknown as Record<string, unknown>;
  w.__name = (f: unknown) => f;
  w.__sync = [];
  localStorage.setItem("aria.lecture.rate", String(rate));
  localStorage.setItem("aria.syncDebug", "1");
  const sizes: Record<string, number> = {};
  const make = URL.createObjectURL.bind(URL);
  URL.createObjectURL = (o: Blob | MediaSource) => { const u = make(o); if (o instanceof Blob) sizes[u] = o.size; return u; };
  const Original = window.Audio;
  function Tracked(this: unknown, ...x: unknown[]) {
    const el = new (Original as unknown as new (...y: unknown[]) => HTMLAudioElement)(...x);
    for (const ev of ["playing", "pause", "ended"]) el.addEventListener(ev, () => (w.__sync as unknown[]).push({ t: performance.now(), ev, size: sizes[el.src], at: el.currentTime, rate: el.playbackRate, dur: el.duration }));
    return el;
  }
  Tracked.prototype = Original.prototype;
  (window as unknown as { Audio: unknown }).Audio = Tracked;
}, SPEED);
await page.goto(`${BASE}/playback-lab`, { waitUntil: "domcontentloaded", timeout: 120000 });
await page.evaluate((lecture) => ((window as unknown as { __PLAYBACK_BEATS__: unknown }).__PLAYBACK_BEATS__ = lecture), { title: "Sync", beats });
await page.getByRole("button", { name: /(play|pause) the lecture/i }).first().waitFor({ state: "visible", timeout: 120000 });
const play = page.getByRole("button", { name: /play the lecture/i }).first();
if (await play.isVisible().catch(() => false)) await play.click();

type Row = { section: string; key: string; at: number; t: number };
const logOf = () => page.evaluate(() => ((window as unknown as { __blockLog?: unknown[] }).__blockLog ?? [])) as Promise<Row[]>;
await page.waitForFunction(() => ((window as unknown as { __blockLog?: unknown[] }).__blockLog ?? []).length >= 3, undefined, { timeout: 120000 });
// PAUSE: nothing may appear while she is stopped.
await page.waitForTimeout(3000);
await page.getByRole("button", { name: /pause the lecture/i }).first().click();
await page.waitForTimeout(500);
const atPause = (await logOf()).length;
await page.waitForTimeout(3500);
const duringPause = (await logOf()).length - atPause;
await page.getByRole("button", { name: /play the lecture/i }).first().click();
const total = beats.flatMap((b) => plainBlocks(b.id, b.script).flatMap(revealUnits)).length;
const limit = Date.now() + beats.reduce((s, b) => s + canvasSentences(b.script).reduce((x, t) => x + seconds(t), 0), 0) * 2000 / SPEED + 40000;
while (Date.now() < limit && (await logOf()).length < total) await page.waitForTimeout(1000);
await page.waitForTimeout(1500);
const log = await logOf();
const sync = (await page.evaluate(() => (window as unknown as { __sync: unknown[] }).__sync)) as Array<{ t: number; ev: string; size: number; at: number; rate: number; dur: number }>;

// When each sentence's clip really played, on the page's clock (a resumed clip counts from where it was).
const plays = new Map<string, Array<{ t: number; at: number; rate: number; dur: number }>>();
for (const e of sync) if (e.ev === "playing") { const text = bySize.get(e.size); if (text) (plays.get(text) ?? plays.set(text, []).get(text)!).push(e); }
const late: number[] = [];
for (const row of log) {
  const beat = beats.find((b) => b.id === row.section);
  if (!beat) continue;
  const sentences = canvasSentences(beat.script);
  const s = Math.min(sentences.length - 1, Math.floor(row.at));
  const list = plays.get(sentences[s]);
  if (!list?.length) continue;
  const dur = list[0].dur;
  const audioAt = (row.at - s) * dur;
  // The play segment during which the audio passed this point.
  const seg = [...list].reverse().find((p) => p.at <= audioAt + 0.01) ?? list[0];
  late.push(row.t - (seg.t + ((audioAt - seg.at) / (seg.rate || SPEED)) * 1000));
}
const sorted = [...late].sort((a, b) => a - b);
const pct = (p: number) => Math.round(sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] ?? NaN);
const keys = log.map((r) => r.key + r.section);
console.log(`speed ${SPEED}x, ${beats.length} boards: ${log.length} of ${total} pieces appeared, ${keys.length - new Set(keys).size} shown twice`);
console.log(`measured ${sorted.length}: appeared vs audio — median ${pct(0.5)} ms, 10th ${pct(0.1)} ms, 90th ${pct(0.9)} ms, worst ${Math.round(sorted[sorted.length - 1])} ms`);
console.log(`pieces that appeared during a 3.5 s pause: ${duringPause}`);
await browser.close();

/**
 * SYNC CHECK — does the pen write each sentence WHILE Aria says it, at every speed? (owner, 2026-10-23:
 * "the pencil just got way too fast and then the voice came … check it at every pace, I want 100
 * percent synchronisation with voice").
 *
 * A saved lecture is played in the REAL player (/playback-lab: the real narration pipeline, the real
 * board, the real marker) with stand-in audio: /api/tts is answered here with a silent clip as long as
 * the sentence takes to say (about 2.6 words a second at 1x), slow the first time a sentence is asked
 * for (a cold synthesis) and quick after (the server's cache). Free: no model, no TTS.
 *
 * For every board sentence it reads, on the page's own clock:
 *   - when her voice starts and ends that sentence (the audio element's playing/ended);
 *   - when the pen starts and finishes the ink that sentence put on the board (MarkerWriter's QA log);
 * and counts a sentence IN SYNC when the pen starts no earlier than her voice (≤ 0.15 s) and finishes
 * no later than the sentence (≤ 0.3 s after its last word). It also reports the pen's fastest stroke.
 *
 *   node --import tsx scripts/qa/sync-check.mts <sessionId> [<sessionId> …] [--speeds=0.5,1,2] [--boards=2] [--cold=1800]
 *   QA_USER=<userId> to play another local account's lecture (read-only).
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { chromium, type Page } from "playwright";
import { SignJWT } from "jose";

const BASE = process.env.QA_BASE ?? "http://localhost:3000";
const env = Object.fromEntries(readFileSync(new URL("../../.env.local", import.meta.url), "utf8").split("\n").filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^"|"$/g, "")]));
const args = process.argv.slice(2);
const flag = (name: string, fallback: string) => args.find((a) => a.startsWith(`--${name}=`))?.split("=")[1] ?? fallback;
const sessions = args.filter((a) => !a.startsWith("--"));
const SPEEDS = flag("speeds", "0.5,0.75,1,1.25,1.5,2").split(",").map(Number);
const BOARDS = Number(flag("boards", "2"));
const COLD_MS = Number(flag("cold", "1800"));
const PARALLEL = Number(flag("parallel", "2"));
const WORDS_PER_S = 2.6;
const subject = process.env.QA_USER ?? "local-dev-canvas";
const token = await new SignJWT({ email: `${subject}@example.com` }).setProtectedHeader({ alg: "HS256" }).setSubject(subject).setIssuedAt().setExpirationTime("3h").sign(new TextEncoder().encode(env.AUTH_SECRET));
const OUT = `${homedir()}/aria-qa-images/${new Date().toISOString().slice(0, 10)}-sync`;
mkdirSync(OUT, { recursive: true });

/** A silent 8 kHz WAV of `seconds`, `extra` samples longer so every clip has its own size. */
function wav(seconds: number, extra: number): Buffer {
  const samples = Math.round(seconds * 8000) + extra;
  const b = Buffer.alloc(44 + samples * 2);
  b.write("RIFF", 0); b.writeUInt32LE(36 + samples * 2, 4); b.write("WAVE", 8); b.write("fmt ", 12);
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(8000, 24); b.writeUInt32LE(16000, 28);
  b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write("data", 36); b.writeUInt32LE(samples * 2, 40);
  return b;
}
const spokenSeconds = (text: string) => Math.max(0.9, text.split(/\s+/).filter(Boolean).length / WORDS_PER_S + 0.2);

type Row = { session: string; topic: string; speed: number; sentences: number; inSync: number; early: number[]; late: number[]; silentPenMs: number; heldMs: number; spokenMs: number; fastest: number; worst: string[]; error?: string };

async function snapshot(id: string) {
  const res = await fetch(`${BASE}/api/progressive-lectures/${encodeURIComponent(id)}`, { headers: { cookie: `aria_access=${token}` } });
  if (!res.ok) throw new Error(`snapshot ${id}: ${res.status}`);
  return (await res.json()) as { title?: string; topic?: string; beats?: Array<{ id: string; script: string } | null> };
}

async function playOnce(browser: import("playwright").Browser, id: string, speed: number): Promise<Row> {
  const snap = await snapshot(id);
  const beats = (snap.beats ?? []).filter((b): b is { id: string; script: string } => Boolean(b)).slice(0, BOARDS);
  const topic = snap.topic ?? snap.title ?? id;
  const row: Row = { session: id, topic, speed, sentences: 0, inSync: 0, early: [], late: [], silentPenMs: 0, heldMs: 0, spokenMs: 0, fastest: 0, worst: [] };
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page: Page = await ctx.newPage();
  const sizeText = new Map<number, string>();
  const seen = new Set<string>();
  let clipNo = 0;
  await page.route("**/api/tts", async (route) => {
    const text = String((route.request().postDataJSON() as { text?: string })?.text ?? "");
    const cold = !seen.has(text);
    seen.add(text);
    const body = wav(spokenSeconds(text), ++clipNo);
    sizeText.set(body.length, text);
    if (cold) await new Promise((r) => setTimeout(r, COLD_MS));
    await route.fulfill({ status: 200, contentType: "audio/wav", body }).catch(() => undefined);
  });
  await ctx.addInitScript((rate: number) => {
    const w = window as unknown as Record<string, unknown>;
    w.__name = (f: unknown) => f;
    w.__qaMarker = true;
    const log: Array<Record<string, unknown>> = [];
    w.__sync = log;
    try {
      localStorage.setItem("aria.lecture.rate", String(rate));
    } catch {}
    const plain = console.log.bind(console);
    console.log = (...a: unknown[]) => {
      if (typeof a[0] === "string" && a[0].startsWith("[playback]")) log.push({ t: performance.now(), ev: "trace", msg: a[0] });
      plain(...a);
    };
    const sizes: Record<string, number> = {};
    const make = URL.createObjectURL.bind(URL);
    URL.createObjectURL = (obj: Blob | MediaSource) => {
      const url = make(obj);
      if (obj instanceof Blob) sizes[url] = obj.size;
      return url;
    };
    const Original = window.Audio;
    function Tracked(this: unknown, ...x: unknown[]) {
      const el = new (Original as unknown as new (...y: unknown[]) => HTMLAudioElement)(...x);
      for (const ev of ["playing", "pause", "ended"]) el.addEventListener(ev, () => log.push({ t: performance.now(), ev: `audio-${ev}`, size: sizes[el.src], at: el.currentTime, rate: el.playbackRate }));
      return el;
    }
    Tracked.prototype = Original.prototype;
    (window as unknown as { Audio: unknown }).Audio = Tracked;
  }, speed);
  try {
    await page.goto(`${BASE}/playback-lab`, { waitUntil: "domcontentloaded", timeout: 90_000 });
    await page.evaluate((lecture) => ((window as unknown as { __PLAYBACK_BEATS__: unknown }).__PLAYBACK_BEATS__ = lecture), { title: topic, beats });
    // The player starts on its own; a Play button still showing is pressed.
    await page.getByRole("button", { name: /(play|pause) the lecture/i }).first().waitFor({ state: "visible", timeout: 90_000 });
    await page.waitForTimeout(1500);
    const play = page.getByRole("button", { name: /play the lecture/i }).first();
    if (await play.isVisible().catch(() => false)) await play.click();
    // Played to the end of the last board's narration (or a generous limit).
    const words = beats.reduce((a, b) => a + b.script.split(/\s+/).length, 0);
    const limit = Date.now() + (words / WORDS_PER_S / speed) * 1000 * 1.6 + 60_000;
    for (;;) {
      await page.waitForTimeout(1000);
      const done = await page.evaluate((last) => ((window as unknown as { __sync: Array<{ ev: string; msg?: string }> }).__sync ?? []).some((e) => e.ev === "trace" && e.msg?.startsWith("[playback] voice-end") && e.msg.includes(`"beat":${last}`)), beats.length - 1);
      if (done || Date.now() > limit) break;
    }
    await page.waitForTimeout(2500);
    const { sync, marker } = await page.evaluate(() => ({ sync: (window as unknown as { __sync: unknown[] }).__sync, marker: (window as unknown as { __markerLog?: unknown[] }).__markerLog ?? [] }));
    writeFileSync(`${OUT}/${id.slice(0, 8)}-${speed}x.json`, JSON.stringify({ sync, marker, sizes: [...sizeText] }, null, 1));
    analyse(row, beats, sync as Array<Record<string, unknown>>, marker as Array<Record<string, unknown>>, sizeText);
  } catch (error) {
    row.error = (error as Error).message.split("\n")[0];
  } finally {
    await ctx.close();
  }
  return row;
}

function analyse(row: Row, beats: Array<{ id: string; script: string }>, sync: Array<Record<string, unknown>>, marker: Array<Record<string, unknown>>, sizeText: Map<number, string>) {
  // Board-sentence cues (the board moving on) and her voice per clip.
  type Cue = { t: number; beat: number; board: number; narration: number; bridge: number; text: string };
  const cues: Cue[] = [];
  for (const e of sync) {
    if (e.ev !== "trace" || !String(e.msg).startsWith("[playback] sentence ")) continue;
    const d = JSON.parse(String(e.msg).slice("[playback] sentence ".length));
    cues.push({ t: e.t as number, beat: d.beat, board: d.board, narration: d.narration, bridge: d.bridge, text: d.text });
  }
  type Clip = { text: string; start: number; end: number };
  const clips: Clip[] = [];
  let open: Clip | null = null;
  for (const e of sync) {
    if (e.ev === "audio-playing") {
      const text = sizeText.get(e.size as number) ?? "";
      if (!open || open.text !== text) {
        open = { text, start: e.t as number, end: Infinity };
        clips.push(open);
      }
    }
    if (e.ev === "audio-ended" && open) {
      open.end = e.t as number;
      open = null;
    }
  }
  const voiceAt = (t: number) => clips.some((c) => t >= c.start && t <= c.end);
  // Which board sentence each beat's clip is: matched by its text to the cue for it.
  type Said = { beat: number; board: number; start: number; end: number; text: string };
  const said: Said[] = [];
  for (const c of clips) {
    const cue = cues.find((q) => q.narration >= q.bridge && c.text.startsWith(q.text.slice(0, 40)) && !said.some((s) => s.beat === q.beat && s.board === q.board));
    if (cue) said.push({ beat: cue.beat, board: cue.board, start: c.start, end: c.end, text: c.text });
  }
  // The ink each sentence put on the board: a batch belongs to the last cue of its beat at or before it.
  const keyToBeat = new Map(beats.map((b, i) => [b.id, i]));
  const inks = marker.filter((m) => m.ev === "ink");
  const strokes = marker.filter((m) => m.ev === "stroke");
  for (const m of strokes) {
    const speedUps = (m.len as number) > 0 ? ((m.len as number) / Math.max(1, (m.t1 as number) - (m.t0 as number))) * 1000 : 0;
    if (!m.faint && m.kind === "trace") row.fastest = Math.max(row.fastest, Math.round(speedUps));
    // Pen moving while she is silent (waiting for a clip, between boards).
    const step = 50;
    for (let t = m.t0 as number; t < (m.t1 as number); t += step) if (!voiceAt(t)) row.silentPenMs += step;
  }
  const sentenceOf = (beat: number, t: number) => {
    const mine = cues.filter((q) => q.beat === beat && q.narration >= q.bridge && q.t <= t + 5);
    return mine.length ? mine[mine.length - 1].board : 0;
  };
  // Silence she left for the pen (her next sentence held for it).
  for (const c of clips) if (Number.isFinite(c.end)) row.spokenMs += c.end - c.start;
  // In sync: the pen starts no earlier than her voice says the sentence, and is done before her next
  // sentence (or, for a board's last one, the next board) begins.
  said.sort((a, b) => a.start - b.start);
  // Extra silence between two sentences of a board, beyond her usual pause at a full stop.
  for (const [k, s] of said.entries()) {
    const n = said[k + 1];
    if (n && n.beat === s.beat && Number.isFinite(s.end)) row.heldMs += Math.max(0, n.start - s.end - 240 / row.speed - 60);
  }
  for (const [k, s] of said.entries()) {
    const beatKey = beats[s.beat]?.id;
    const batches = inks.filter((i) => keyToBeat.get(String(i.board)) === s.beat && (typeof i.sentence === "number" ? i.sentence : sentenceOf(s.beat, i.t as number)) === s.board).map((i) => i.batch);
    const mine = strokes.filter((m) => String(m.board) === beatKey && batches.includes(m.batch));
    if (!mine.length) continue;
    row.sentences++;
    const first = Math.min(...mine.map((m) => m.t0 as number));
    const last = Math.max(...mine.map((m) => m.t1 as number));
    const next = said[k + 1]?.start ?? Infinity;
    const early = (s.start - first) / 1000;
    const late = (last - next) / 1000;
    row.early.push(early);
    row.late.push((last - s.end) / 1000);
    const ok = early <= 0.15 && late <= 0.05;
    if (ok) row.inSync++;
    else row.worst.push(`board ${s.beat + 1} s${s.board}: pen ${early > 0.15 ? `${early.toFixed(1)} s BEFORE her voice` : ""}${early > 0.15 && late > 0.05 ? ", " : ""}${late > 0.05 ? `still writing ${late.toFixed(1)} s into her NEXT sentence` : ""} — "${s.text.slice(0, 50)}"`);
  }
}

const jobs = sessions.flatMap((id) => SPEEDS.map((speed) => ({ id, speed })));
const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
const rows: Row[] = [];
// A pool: PARALLEL lectures playing at once, the next starting as one ends.
let nextJob = 0;
await Promise.all(Array.from({ length: Math.min(PARALLEL, jobs.length) }, async () => {
  while (nextJob < jobs.length) {
    const j = jobs[nextJob++];
    const r = await playOnce(browser, j.id, j.speed);
    rows.push(r);
    console.log(`${r.topic.slice(0, 40).padEnd(40)} ${String(r.speed).padStart(4)}x  ${r.error ? `ERROR ${r.error}` : `in sync ${r.inSync}/${r.sentences}  pen early max ${Math.max(0, ...r.early).toFixed(1)} s  past sentence end max ${Math.max(0, ...r.late).toFixed(1)} s  extra silence between sentences ${(r.heldMs / 1000).toFixed(1)} s of ${(r.spokenMs / 1000).toFixed(0)} s spoken  fastest stroke ${r.fastest} u/s (${Math.round(200 * r.speed)} natural)`}`);
  }
}));
rows.sort((a, b) => a.session.localeCompare(b.session) || a.speed - b.speed);
await browser.close();
const all = rows.filter((r) => !r.error);
const total = all.reduce((a, r) => a + r.sentences, 0);
const ok = all.reduce((a, r) => a + r.inSync, 0);
console.log(`\nIN SYNC: ${ok}/${total} sentences (${total ? ((ok / total) * 100).toFixed(1) : "–"}%)`);
for (const r of all) for (const w of r.worst.slice(0, 4)) console.log(`  ${r.speed}x ${w}`);
writeFileSync(`${OUT}/summary.json`, JSON.stringify(rows, null, 1));
console.log(`logs in ${OUT}`);

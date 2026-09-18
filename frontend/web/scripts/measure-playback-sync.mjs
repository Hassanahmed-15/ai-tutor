/**
 * Plays a real cached lecture in the real LessonPlayer and measures whether the board keeps pace
 * with the voice, sentence by sentence. Needs `npm run dev` running.
 *
 *   node scripts/measure-playback-sync.mjs <out-dir> [cache-file-substring] [beat-count]
 *
 * scripts/measure-sentence-sync.mjs measured the old ESTIMATOR offline. This measures the thing a
 * student experiences: the browser plays the narration and the board draws, and the script watches
 * both. For every sentence clip it records:
 *
 *   - which sentence the audio actually is (the clip's text, matched back to the script);
 *   - LAG: from the clip starting to the first board step tagged with that sentence becoming visible;
 *   - AHEAD: any moment in the clip when a step tagged with a LATER sentence is already visible —
 *     the board drawing what the teacher has not said yet;
 *   - a screenshot shortly after the clip starts, so the claim can be checked by eye.
 *
 * Costs only narration (gpt-4o-mini-tts, roughly $0.015 per spoken minute); no model is called.
 */
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const BASE = process.env.LAB_URL ?? "http://localhost:3000";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const [outDir, cacheMatch = "", beatCountArg = "3"] = process.argv.slice(2);
if (!outDir) {
  console.error("usage: node scripts/measure-playback-sync.mjs <out-dir> [cache-file-substring] [beat-count]");
  process.exit(1);
}
fs.mkdirSync(outDir, { recursive: true });

const split = (text) => text.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean);
const isAnimated = (beat) => (beat.draw?.ops ?? []).some((op) => op.kind === "reactAnimation" && op.code);
const firstLabel = (code) => {
  for (const m of code.matchAll(/<text\b[^>]*>([\s\S]*?)<\/text>/g)) {
    const t = m[1].replace(/\{[^{}]*\}/g, " ").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
    if (t.length >= 4) return t;
  }
  return null;
};

/* ── choose the lecture ─────────────────────────────────────────────────── */

const cacheDir = path.join(ROOT, ".lecture-cache");
const file = fs.readdirSync(cacheDir).find((f) => f.includes(cacheMatch) && (() => {
  const d = JSON.parse(fs.readFileSync(path.join(cacheDir, f), "utf8"));
  return (d.beats ?? []).filter((b) => isAnimated(b) && split(b.script).length >= 4).length >= Number(beatCountArg);
})());
if (!file) throw new Error(`no cached lecture matching "${cacheMatch}" with ${beatCountArg} animated beats`);
const lecture = JSON.parse(fs.readFileSync(path.join(cacheDir, file), "utf8"));
const beats = lecture.beats
  .filter((b) => b.slideKind !== "checkpoint" && isAnimated(b) && split(b.script).length >= 4)
  .slice(0, Number(beatCountArg));
const plan = beats.map((b, i) => ({
  i,
  id: b.id,
  sentences: split(b.script),
  label: firstLabel(b.draw.ops.find((op) => op.kind === "reactAnimation").code),
}));
const totalSentences = plan.reduce((n, b) => n + b.sentences.length, 0);
console.log(`lecture ${file} "${String(lecture.topic).slice(0, 50)}": ${beats.length} beats, ${totalSentences} sentences`);

/* ── instrument the page ────────────────────────────────────────────────── */

const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const pageErrors = [];
page.on("pageerror", (e) => pageErrors.push(e.message));
// What the server said each narration clip cost, to check the badge adds up to exactly this.
const ttsCosts = [];
page.on("response", (res) => {
  if (!res.url().includes("/api/tts")) return;
  const cost = res.headers()["x-cost-usd"];
  ttsCosts.push({ cache: res.headers()["x-tts-cache"] ?? null, cost: cost === undefined ? null : Number(cost) });
});

await page.addInitScript((payload) => {
  if (window.top !== window) return;
  window.__PLAYBACK_BEATS__ = payload;
  // Clip text is tracked by object identity — response → blob → object URL — not by byte size:
  // two MP3s of similar length can be exactly the same size, which mislabelled clips on the first run.
  const sync = { plays: [], urls: {} };
  window.__sync = sync;
  const textOfResponse = new WeakMap();
  const textOfBlob = new WeakMap();
  const origFetch = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input.url;
    const res = await origFetch(input, init);
    if (url.includes("/api/tts") && init?.body) {
      try {
        textOfResponse.set(res, JSON.parse(init.body).text);
      } catch {}
    }
    return res;
  };
  const origBlob = Response.prototype.blob;
  Response.prototype.blob = async function () {
    const b = await origBlob.call(this);
    if (textOfResponse.has(this)) textOfBlob.set(b, textOfResponse.get(this));
    return b;
  };
  const origCreate = URL.createObjectURL.bind(URL);
  URL.createObjectURL = (obj) => {
    const u = origCreate(obj);
    if (obj instanceof Blob && textOfBlob.has(obj)) sync.urls[u] = textOfBlob.get(obj);
    return u;
  };
  const origPlay = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function () {
    const rec = { requested: Date.now(), src: this.src };
    sync.plays.push(rec);
    const p = origPlay.call(this);
    Promise.resolve(p).then(() => { rec.started = Date.now(); }, (e) => { rec.error = String(e); });
    return p;
  };
}, { title: String(lecture.topic ?? "Lecture"), beats });

await page.goto(`${BASE}/playback-lab`, { waitUntil: "domcontentloaded" });
// The player waits for the student, exactly as in the app.
await page.getByRole("button", { name: /start lecture/i }).click({ timeout: 120_000 });

/* ── sample the board and shoot each sentence ──────────────────────────── */

const samples = [];
const shots = new Set();
const deadline = Date.now() + Number(process.env.PLAYBACK_TIMEOUT_MS ?? 12 * 60_000);
let lastPlayCount = 0;
let quietSince = null;

while (Date.now() < deadline) {
  const now = Date.now();
  for (const frame of page.frames()) {
    if (frame === page.mainFrame()) continue;
    const board = await frame.evaluate(() => {
      const svg = document.querySelector("svg");
      if (!svg) return null;
      const steps = [...svg.querySelectorAll("[data-teach-order]")];
      if (!steps.length) return null;
      return {
        text: (svg.textContent ?? "").replace(/\s+/g, " ").slice(0, 4000),
        visible: steps
          .filter((s) => s.style.opacity === "1")
          .map((s) => Number(s.getAttribute("data-teach-sentence"))),
      };
    }).catch(() => null);
    if (board) samples.push({ t: now, ...board });
  }

  const plays = await page.evaluate(() => window.__sync.plays.map((p) => ({ ...p }))).catch(() => []);
  for (let k = 0; k < plays.length; k += 1) {
    if (plays[k].started && !shots.has(k) && Date.now() - plays[k].started > 900) {
      shots.add(k);
      await page.screenshot({ path: path.join(outDir, `clip-${String(k).padStart(2, "0")}.png`) });
    }
  }
  if (plays.length !== lastPlayCount) {
    lastPlayCount = plays.length;
    quietSince = null;
  } else if (plays.length > 0) {
    quietSince ??= now;
    // Every sentence played and nothing new for a while: the selected beats are done.
    if (plays.length >= totalSentences && now - quietSince > 15_000) break;
    if (now - quietSince > 90_000) break;
  }
  await page.waitForTimeout(80);
}

const sync = await page.evaluate(() => window.__sync);
const badgeText = await page.locator("text=This lecture").locator("..").innerText().catch(() => null);
await browser.close();

/* ── analyse ────────────────────────────────────────────────────────────── */

const events = sync.plays
  .map((p, k) => ({ p, k }))
  .filter(({ p }) => p.started)
  .map(({ p, k }) => {
    const text = sync.urls[p.src];
    let beat = -1;
    let sentence = -1;
    plan.forEach((b) => {
      const s = b.sentences.indexOf(text);
      if (s >= 0 && beat < 0) {
        beat = b.i;
        sentence = s;
      }
    });
    return { k, started: p.started, text, beat, sentence };
  });

const rows = [];
events.forEach((ev, n) => {
  if (ev.beat < 0) {
    rows.push({ ...ev, note: "clip text not matched to the script" });
    return;
  }
  const b = plan[ev.beat];
  const until = events[n + 1]?.started ?? ev.started + 20_000;
  // Only samples of THIS beat's board: the previous board can linger for a moment after a change.
  const own = samples.filter((s) => s.t >= ev.started && s.t < until && (!b.label || s.text.includes(b.label)));
  const appeared = own.find((s) => s.visible.includes(ev.sentence));
  const aheadSamples = own.filter((s) => s.visible.some((v) => v > ev.sentence));
  const tagged = own.some((s) => s.visible.length) || own.length > 0;
  rows.push({
    beat: ev.beat,
    sentence: ev.sentence,
    shot: `clip-${String(ev.k).padStart(2, "0")}.png`,
    samples: own.length,
    lagMs: appeared ? appeared.t - ev.started : null,
    aheadMs: aheadSamples.length ? aheadSamples[aheadSamples.length - 1].t - aheadSamples[0].t : 0,
    aheadTags: [...new Set(aheadSamples.flatMap((s) => s.visible.filter((v) => v > ev.sentence)))],
    text: ev.text.slice(0, 70),
    tagged,
  });
});

const matched = rows.filter((r) => r.beat >= 0);
const lags = matched.map((r) => r.lagMs).filter((v) => v !== null).sort((a, b) => a - b);
const pct = (q) => (lags.length ? lags[Math.min(lags.length - 1, Math.floor(q * lags.length))] : null);
const summary = {
  lecture: file,
  beats: plan.length,
  sentencesInScript: totalSentences,
  clipsPlayed: events.length,
  clipsMatchedToScript: matched.length,
  inOrder: matched.every((r, n) => n === 0 || r.beat > matched[n - 1].beat || (r.beat === matched[n - 1].beat && r.sentence === matched[n - 1].sentence + 1)),
  lagMedianMs: pct(0.5),
  lagP90Ms: pct(0.9),
  lagMaxMs: lags.length ? lags[lags.length - 1] : null,
  sentencesWithNoStepOfTheirOwn: matched.filter((r) => r.lagMs === null).length,
  sentencesWhereBoardRanAhead: matched.filter((r) => r.aheadMs > 0).length,
  pageErrors: pageErrors.slice(0, 5),
  narrationCost: {
    responses: ttsCosts.length,
    misses: ttsCosts.filter((c) => c.cache === "miss").length,
    unpriced: ttsCosts.filter((c) => c.cost === null).length,
    serverReportedUsd: Number(ttsCosts.reduce((sum, c) => sum + (c.cost ?? 0), 0).toFixed(6)),
    badge: badgeText?.replace(/\s+/g, " ") ?? null,
  },
};
fs.writeFileSync(path.join(outDir, "playback-sync.json"), JSON.stringify({ summary, rows }, null, 2));
console.log(JSON.stringify(summary, null, 2));
for (const r of rows) console.log(JSON.stringify(r));

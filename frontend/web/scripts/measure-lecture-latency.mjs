/**
 * Where does a lecture's build time go? Starts a real progressive lecture and plays the student.
 * Needs `npm run dev` running and a test account.
 *
 *   node scripts/measure-lecture-latency.mjs <out-dir> <email> <password-file> [topic]
 *
 * The "student" starts watching once the lecture says it is playable, moves to the next beat only
 * when that beat is ready AND the current one has played for its length, and reports the playhead
 * as the app does — so later beats are generated the way they are for a real viewer, and every time
 * the next beat is not ready is a measured stall. At the end it reads every beat's measured timing
 * (lib/progressiveLectureTypes.ts BeatTiming) and writes latency.json.
 */
import fs from "node:fs";
import path from "node:path";

const BASE = process.env.LAB_URL ?? "http://localhost:3000";
const [outDir, email, pwFile, topicArg] = process.argv.slice(2);
fs.mkdirSync(outDir, { recursive: true });
const password = fs.readFileSync(pwFile, "utf8").trim();
const topic = topicArg ?? "How vaccines train the immune system";
const BEAT_PLAY_MS = Number(process.env.BEAT_PLAY_MS ?? 40_000);

let cookie = "";
async function call(method, url, body) {
  const res = await fetch(`${BASE}${url}`, {
    method,
    headers: { "Content-Type": "application/json", cookie },
    body: body ? JSON.stringify(body) : undefined,
  });
  const set = res.headers.getSetCookie?.() ?? [];
  if (set.length) cookie = set.map((c) => c.split(";")[0]).join("; ");
  return { status: res.status, data: await res.json().catch(() => ({})) };
}
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

await call("POST", "/api/auth/login", { email, password });
let t0 = Date.now();
// SESSION_ID attaches to a lecture already running; its clock then starts at the session's creation.
let id = process.env.SESSION_ID ?? null;
if (!id) {
  const start = await call("POST", "/api/progressive-lectures", {
    topic,
    sourceType: "prompt",
    learnerProfile: { expertise: "beginner", depth: "balanced", goal: "curiosity", codeExamples: false, preferredExamples: "visual" },
  });
  id = start.data.sessionId;
  if (!id) throw new Error(`could not start: ${start.status} ${JSON.stringify(start.data)}`);
}
log("lecture", id, "topic:", topic);

const events = [];
let playhead = -1;
let playStartedAt = null;
let playableAt = null;
const readyAt = {};
let last = null;
const deadline = Date.now() + Number(process.env.MAX_MS ?? 20 * 60_000);
while (Date.now() < deadline) {
  const { data: snap } = await call("GET", `/api/progressive-lectures/${id}`);
  // Until the plan exists there is nothing to measure — and "every beat ready" is vacuously true.
  if (!snap?.beatStatus || !snap.plannedBeatCount) {
    await new Promise((r) => setTimeout(r, 2000));
    continue;
  }
  last = snap;
  if (process.env.SESSION_ID && snap.createdAt && t0 > Date.parse(snap.createdAt)) t0 = Date.parse(snap.createdAt);
  const now = Date.now();
  for (const b of snap.beatStatus) {
    if (b.state === "ready" && readyAt[b.sequence] === undefined) {
      // The worker's own finish time, so a beat that finished before we looked is not credited late.
      readyAt[b.sequence] = (b.timing?.readyAt ? Date.parse(b.timing.readyAt) : now) - t0;
      log(`beat ${b.sequence + 1} ready at ${((now - t0) / 1000).toFixed(0)} s`);
    }
  }
  if (playableAt === null && snap.starterReady) {
    // Playable from the moment the opening beats were all ready, per the worker's own clock.
    const opening = [0, 1].filter((i) => i < snap.plannedBeatCount).map((i) => readyAt[i]);
    playableAt = opening.every((ms) => ms !== undefined) ? Math.max(...opening) : now - t0;
    playhead = 0;
    // The student started watching when it became playable, even if we noticed later.
    playStartedAt = t0 + playableAt;
    log(`PLAYABLE at ${(playableAt / 1000).toFixed(1)} s — student starts beat 1`);
    await call("POST", `/api/progressive-lectures/${id}/interaction`, { kind: "playhead", playhead: 0 });
  }
  // The student finishes a beat after its playing time, then needs the next one.
  if (playhead >= 0 && playhead < snap.plannedBeatCount - 1 && now - playStartedAt >= BEAT_PLAY_MS) {
    const next = playhead + 1;
    if (readyAt[next] !== undefined) {
      const waited = now - playStartedAt - BEAT_PLAY_MS;
      if (waited > 2500) events.push({ kind: "stall", beat: next + 1, waitedMs: waited });
      playhead = next;
      playStartedAt = now;
      log(`student moves to beat ${next + 1}${waited > 2500 ? ` after waiting ${(waited / 1000).toFixed(0)} s` : ""}`);
      await call("POST", `/api/progressive-lectures/${id}/interaction`, { kind: "playhead", playhead: next });
    }
  }
  if (snap.beatStatus.every((b) => b.state === "ready") && playhead >= snap.plannedBeatCount - 1) break;
  await new Promise((r) => setTimeout(r, 2000));
}

const result = {
  topic,
  sessionId: id,
  plannedBeats: last?.plannedBeatCount,
  playableAtMs: playableAt,
  stalls: events,
  totalStallMs: events.reduce((s, e) => s + e.waitedMs, 0),
  beats: (last?.beatStatus ?? []).map((b) => ({ ...b, readyAtMs: readyAt[b.sequence] ?? null })),
  costUsd: last?.costUsd,
};
fs.writeFileSync(path.join(outDir, "latency.json"), JSON.stringify(result, null, 2));
log(`done. playable ${(playableAt / 1000).toFixed(1)} s, ${events.length} stalls, total stall ${(result.totalStallMs / 1000).toFixed(0)} s, cost $${result.costUsd?.toFixed(2)}`);

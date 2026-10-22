/**
 * THE MATHS LECTURE BENCHMARK (owner, 2026-10-21: "be a maths professor, run 10 different maths
 * lectures, judge every small thing, fix everything after each batch; maths lectures must be perfect").
 *
 * For each topic (or saved session): generate the lecture through the real app path, then
 *   1. the still-frame checker (scripts/qa/lecture-qa.mts): numbers, equations, structures, overlap,
 *      lines through writing, writing off the board;
 *   2. the playback recorder (scripts/qa/playback-qa.mts): writing on writing while it PLAYS, the
 *      camera's moves, the pen on or off screen, stroke speed;
 *   3. teaching structure, scored from the scripts (MATHS_CS_TEACHING in lib/canvas/lessonRequest.ts):
 *      each board says what it is for, steps carry their reasons, it ends on what we now know;
 *   4. a lecture.md per lecture — every board's numbered narration and what is drawn — for the
 *      professor's reading (the rubric is docs/maths-lecture-benchmark.md);
 * and the AI spend of the batch (the app's own spend log).
 *
 *   node --import tsx scripts/bench/maths-bench.mts --batch 1 "Topic one" "Topic two"
 *   node --import tsx scripts/bench/maths-bench.mts --batch 1 --session <id> …   (re-check, free)
 *
 * Output: ~/aria-qa-images/maths-bench/batch-<n>/ (lecture.md, auto.json, the checkers' logs).
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { SignJWT } from "jose";
import { canvasSentences } from "../../lib/canvas/plan";
import { describeCanvasSpec } from "../../lib/canvas/describe";
import type { CanvasBoardSpec } from "../../lib/canvas/types";

const BASE = process.env.QA_BASE ?? "http://localhost:3000";
const env = Object.fromEntries(readFileSync(new URL("../../.env.local", import.meta.url), "utf8").split("\n").filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^"|"$/g, "")]));
const token = await new SignJWT({ email: "local-dev-canvas@example.com" }).setProtectedHeader({ alg: "HS256" }).setSubject("local-dev-canvas").setIssuedAt().setExpirationTime("3h").sign(new TextEncoder().encode(env.AUTH_SECRET));
const headers = { "content-type": "application/json", cookie: `aria_access=${token}` };

type Beat = { id: string; title: string; script: string; draw?: { ops: Array<{ kind: string; spec?: CanvasBoardSpec }> } };
type Snapshot = { topic: string; status: string; costUsd?: number; beats: Array<Beat | null> };

const args = process.argv.slice(2);
const batch = args.includes("--batch") ? args[args.indexOf("--batch") + 1] : "x";
const OUT = `${homedir()}/aria-qa-images/maths-bench/batch-${batch}`;
mkdirSync(OUT, { recursive: true });

async function spendToday(): Promise<number> {
  const r = (await (await fetch(`${BASE}/api/spend?day=today`, { headers })).json()) as { day?: { totalUsd?: number } };
  return r.day?.totalUsd ?? NaN;
}
async function load(session: string): Promise<Snapshot> {
  return (await (await fetch(`${BASE}/api/progressive-lectures/${session}`, { headers })).json()) as Snapshot;
}

/** Teaching structure, from the narration alone (the planner's MATHS_CS_TEACHING rules). */
function structure(script: string, kind: string) {
  const s = canvasSentences(script);
  const first = s[0] ?? "";
  const last = s[s.length - 1] ?? "";
  const intention = /\b(we (will|now|'ll|are going to|want|need|begin|start)|to (begin|start)|let'?s|now (we|let)|next|first,? we|to (find|prove|see|show|solve|work out|get|check|decide|understand)|our (goal|aim|job|task)|this board|here we)\b/i.test(first);
  const takeaway = /\b(we now (know|have|see|can)|so (we|the|this|that|now)|therefore|this (shows|means|gives|proves|is why|tells)|that is why|which (proves|shows|means)|in short|hence|so,)\b/i.test(last);
  const reasons = s.filter((x) => /\b(because|since|so that|which means|this is why|in order to|as (the|a|both|each)|to (get|make|find|remove|isolate|clear|cancel|keep))\b/i.test(x)).length;
  const numbers = s.filter((x) => /\d/.test(x)).length;
  const proof = /\b(prove|proof|show that|why .* (true|works))\b/i.test(script);
  return { sentences: s.length, intention, takeaway, reasons, numbers, proof, kind };
}

// 1. Generate (or take the sessions given), through the still-frame checker.
const topics = args.filter((a, i) => !a.startsWith("--") && args[i - 1] !== "--batch" && args[i - 1] !== "--session");
const given = args.flatMap((a, i) => (args[i - 1] === "--session" ? [a] : []));
const before = await spendToday();
console.log(`spend today before: $${before.toFixed(4)}`);
const qaArgs = [...topics, ...given.flatMap((s) => ["--session", s])];
const qa = execFileSync("node", ["--import", "tsx", "scripts/qa/lecture-qa.mts", ...qaArgs], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, timeout: 60 * 60_000 });
writeFileSync(`${OUT}/still-frames.log`, qa);
console.log(qa);
const sessions = [...qa.matchAll(/^== .* \(([0-9a-f-]{36})\)/gm)].map((m) => m[1]);
const after = await spendToday();
console.log(`spend today after generation: $${after.toFixed(4)} (this batch: $${(after - before).toFixed(4)})`);

// 2. Playback.
// Playback is measured when the machine can (a page that never loads under load is reported, and the
// lecture reports are still written): `--no-playback` skips it.
if (!args.includes("--no-playback")) {
  try {
    const pb = execFileSync("node", ["--import", "tsx", "scripts/qa/playback-qa.mts", ...sessions], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, timeout: 60 * 60_000 });
    writeFileSync(`${OUT}/playback.log`, pb);
    console.log(pb);
  } catch (error) {
    const out = String((error as { stdout?: unknown }).stdout ?? "");
    writeFileSync(`${OUT}/playback.log`, `${out}\nPLAYBACK FAILED: ${(error as Error).message.slice(0, 300)}`);
    console.log(`${out}\nplayback failed (reported, not passed): ${(error as Error).message.slice(0, 200)}`);
  }
}

// 3–4. Structure and the professor's reading copy.
const summary: unknown[] = [];
for (const session of sessions) {
  const snap = await load(session);
  const beats = (snap.beats ?? []).filter((b): b is Beat => Boolean(b));
  const lines = [`# ${snap.topic}`, ``, `session ${session} · ${beats.length} boards · $${(snap.costUsd ?? 0).toFixed(4)}`, ``];
  const boards = beats.map((b, i) => {
    const spec = b.draw?.ops.find((o) => o.kind === "canvasBoard")?.spec;
    const st = structure(b.script, spec?.stage.kind ?? "?");
    lines.push(`## ${i + 1}. ${b.title} — ${spec?.stage.kind ?? "?"}${spec?.stage.kind === "figure" ? ` (${(spec.stage as { component?: string }).component})` : ""}`);
    lines.push(`structure: intention ${st.intention ? "✓" : "✗"} · takeaway ${st.takeaway ? "✓" : "✗"} · ${st.reasons} reasoned step(s) · ${st.numbers}/${st.sentences} sentences with numbers${st.proof ? " · PROOF" : ""}`);
    lines.push(``, ...canvasSentences(b.script).map((x, k) => `${k}. ${x}`), ``);
    if (spec) lines.push("```", describeCanvasSpec(spec).slice(0, 2500), "```", ``);
    return { title: b.title, ...st };
  });
  const dir = `${OUT}/${snap.topic.replace(/[^A-Za-z0-9]+/g, "-").slice(0, 40)}-${session.slice(0, 6)}`;
  mkdirSync(dir, { recursive: true });
  writeFileSync(`${dir}/lecture.md`, lines.join("\n"));
  const n = boards.length || 1;
  const auto = {
    topic: snap.topic,
    session,
    boards: boards.length,
    costUsd: snap.costUsd ?? 0,
    intention: boards.filter((b) => b.intention).length / n,
    takeaway: boards.filter((b) => b.takeaway).length / n,
    reasonsPerBoard: boards.reduce((a, b) => a + b.reasons, 0) / n,
  };
  writeFileSync(`${dir}/auto.json`, JSON.stringify({ ...auto, boards }, null, 1));
  summary.push(auto);
  console.log(`${snap.topic}: ${boards.length} boards · intention ${(auto.intention * 100).toFixed(0)}% · takeaway ${(auto.takeaway * 100).toFixed(0)}% · ${auto.reasonsPerBoard.toFixed(1)} reasoned steps/board → ${dir}/lecture.md`);
}
writeFileSync(`${OUT}/summary.json`, JSON.stringify({ batch, spend: { before, after, batchUsd: after - before }, lectures: summary }, null, 1));

/**
 * PROMPT BENCH — the typed-prompt lecture ("Ask anything") checked from every side, for different
 * students (owner, 2026-10-17: "check the prompting part from every perspective — teaching depth,
 * narration sync, diagrams, animations, labels, voice — from different levels and personalization
 * settings").
 *
 * Each prompt runs through the real pipeline once per student profile:
 *   outline (POST /api/plan-lesson, mode "outline", with web research, as the app does)
 *   → lesson plan (planCanvasLecture) → every board (writeCanvasBoard, pictures included)
 * then every board is checked by code (free) and, with --judge, the whole lecture is scored by a
 * judge on the audit's 11 criteria (lib/bench/rubric.ts). With --voice the first sentences of each
 * lecture are sent to the real /api/tts. No narration is bought for the rest and nothing is played.
 *
 *   NODE_OPTIONS=--conditions=react-server npx tsx --env-file=.env.local --tsconfig tsconfig.json \
 *     scripts/bench/prompt-bench.mts <outDir> --prompts prompts.json [--profiles grade6,olevel,...] [--judge] [--voice] [--maxUsd 3]
 *
 * prompts.json: ["What is photosynthesis?", "Explain Newton's second law", ...]
 * Needs the dev server on :3000 (outline and voice go through it). Render the boards afterwards:
 *   NODE_OPTIONS="--require <css stub>" npx tsx --tsconfig tsconfig.json scripts/bench/diagram-lab-render.mts <outDir>/runs
 * and open <outDir>/report.html.
 */
import { readFileSync, writeFileSync, mkdirSync, statSync } from "node:fs";
import path from "node:path";
import { signAccessToken } from "../../lib/auth.ts";
import { planCanvasLecture, writeCanvasBoard, canvasSpecOf } from "../../lib/canvas/progressive.ts";
import type { CanvasBoardSpec, CanvasPlanBeat } from "../../lib/canvas/types.ts";
import type { LearnerProfileSnapshot, ProgressiveLectureInput } from "../../lib/progressiveLectureTypes.ts";
import type { LearnerBasics, AccessibilityProfile } from "../../lib/db/cosmos.ts";
import type { LearningPreferences } from "../../lib/learningPreferences.ts";
import { buildStudentCard, gradeRules, readingGrade, type StudentCard } from "../../lib/studentCard.ts";
import { canvasSentences } from "../../lib/canvas/plan.ts";
import { unshownSentences } from "../../lib/canvas/narrationSync.ts";
import { quizIssues } from "../../lib/canvas/quizLint.ts";
import { auditBoardForRelease } from "../../lib/canvas/releaseAudit.ts";
import { layoutPanel, takeLayoutDrops } from "../../lib/canvas/layout.ts";
import { takeFigureCutItems } from "../../lib/figures/cuts.ts";
import { figureComponent } from "../../lib/figures/registry.ts";
import { labelMatchesPart } from "../../lib/canvas/labelMatch.ts";
import { rubricLines } from "../../lib/bench/rubric.ts";
import { BENCH_CRITERIA } from "../../lib/bench/criteria.ts";
import { createOpenAI } from "../../lib/openaiClient.ts";
import { PROFILES, checkBoard, scorecard, voiceCheck, repeats, type Profile, type BoardReport, type VoiceResult } from "./lectureChecks.mts";

/* ── the students ─────────────────────────────────────────────────────────────────────────────── */

/* ── arguments ────────────────────────────────────────────────────────────────────────────────── */

const WEB = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
const args = process.argv.slice(2);
const outDir = path.resolve(args[0] ?? "prompt-bench-out");
const opt = (name: string) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
// --rescore <dir>: check lectures already saved (bench runs or Diagram Lab snapshots) again, for free.
const rescore = opt("--rescore");
// Each entry is a prompt (run for every --profiles student) or {"prompt", "profiles": ["grade6"]}.
type PromptEntry = string | { prompt: string; profiles?: string[] };
const entries: PromptEntry[] = rescore ? [] : JSON.parse(readFileSync(opt("--prompts") ?? path.join(outDir, "prompts.json"), "utf8"));
const prompts = entries.map((e) => (typeof e === "string" ? e : e.prompt));
const wanted = (opt("--profiles") ?? "grade6,olevel").split(",").map((s) => s.trim());
const profiles = PROFILES.filter((p) => wanted.includes(p.id));
const judge = args.includes("--judge");
const voice = args.includes("--voice");
const maxUsd = Number(opt("--maxUsd") ?? 3);
// NOT IN THE TOTALS: the outline's web research (about $0.08 a question, $0 when cached) is billed by
// the server and logged there ("[research] … $0.0775"), not returned with the outline.
console.log("note: web research is not in these totals (~$0.08 per new question; see the server log)");
const BASE = process.env.BENCH_BASE ?? "http://localhost:3000";
mkdirSync(path.join(outDir, "runs"), { recursive: true });

// A fresh login for every request: the access token lasts 15 minutes, and after that the outline was
// planned for an anonymous student — no level, no syllabus (lectures 10-13 of the 2026-10-18 run).
const freshCookie = async () => `aria_access=${await signAccessToken("prompt-bench", "bench@test.local")}`;
const openai = createOpenAI();
let spent = 0;

/* ── one lecture ──────────────────────────────────────────────────────────────────────────────── */

// What the planning conversation would have learnt about this student (lib/learnerProfile.ts), on
// the study level's 1-5 depth scale (lib/learnerBasics.ts BAND_DEPTH).
const DEPTH: Record<string, number> = { grade6: 1, olevel: 2, igcse: 2, alevel: 3, undergrad: 3, postgrad: 4 };
function diagnosis(p: Profile) {
  const pr = p.basics.preferences;
  return {
    topic: "", claimedLevel: DEPTH[p.id] ?? 3, confidence: p.snapshot.expertise === "beginner" ? "low" : p.snapshot.expertise === "advanced" ? "high" : "medium",
    objective: pr?.goal === "exams" ? "exam" : pr?.goal === "curious" ? "curiosity" : "fundamentals",
    preferredStyle: [pr?.helps.length ? `learns best with ${pr.helps.join(", ")}` : "", pr?.challenge ? `${pr.challenge} challenge` : "", pr?.english === "learning" ? "still learning English" : ""].filter(Boolean).join("; "),
    masteredConcepts: [], weakConcepts: [], misconceptions: [], prerequisiteGaps: [],
  };
}

type OutlineResult = { outline: ProgressiveLectureInput["outline"]; research?: unknown; costUsd: number; checklist: string[]; coverage?: { covered: number; total: number; missing: string[] }; thoughts: string[]; secs: number };
async function outlineFor(prompt: string, p: Profile): Promise<OutlineResult> {
  const t0 = Date.now();
  const res = await fetch(`${BASE}/api/plan-lesson`, {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie: await freshCookie() },
    body: JSON.stringify({ mode: "outline", topic: prompt.slice(0, 200), request: prompt, clarifications: [], depth: diagnosis(p).claimedLevel, research: !args.includes("--no-research"), learnerBasics: p.basics, learnerProfile: diagnosis(p) }),
  });
  const lines = (await res.text()).split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean) as Array<Record<string, unknown>>;
  const done = lines.find((l) => l.type === "outline");
  if (!done) throw new Error(`no outline: ${JSON.stringify(lines.find((l) => l.type === "error") ?? lines.slice(-1)).slice(0, 200)}`);
  const subtopics = (done.subtopics as Array<{ title: string; caption: string; reason?: string }>) ?? [];
  return {
    outline: { topic: String(done.topic ?? prompt), scope: done.scope as "question" | "lesson" | undefined, subtopics },
    research: done.research, costUsd: Number(done.costUsd ?? 0),
    checklist: ((done.research as { checklist?: string[] } | undefined)?.checklist ?? []),
    coverage: done.coverage as OutlineResult["coverage"],
    thoughts: lines.filter((l) => l.type === "thought").map((l) => String(l.text)).filter((t) => /syllabus|read \d+ source/i.test(t)),
    secs: Math.round((Date.now() - t0) / 1000),
  };
}

type Judged = { scores: Record<string, number>; notes: string; costUsd: number; syllabus?: Array<{ point: string; taught: string }>; repetition?: string | null; forcedExamples?: string[] };
async function judgeLecture(prompt: string, p: Profile, beats: CanvasPlanBeat[], specs: CanvasBoardSpec[], checklist: string[] = []): Promise<Judged | null> {
  const lesson = beats.map((b, i) => {
    const s = specs[i];
    const st = s.stage as Record<string, unknown> & { kind: string };
    const shows = st.kind === "figure" ? `figure ${String(st.component)} labelled ${((st.parts as Array<{ name: string }>) ?? []).map((x) => x.name).join(", ")}` : st.kind === "illustration" ? `picture: ${String(st.subject)} — labelled ${((st.parts as Array<{ id: string; name: string }>) ?? []).filter((x) => ((st.labels as string[] | undefined) ?? []).includes(x.id)).map((x) => x.name).join(", ")}` : st.kind;
    return `BOARD ${i + 1}: ${b.title}\nSHOWS: ${shows}; notes: ${s.notes.map((n) => n.text).join(" | ")}${s.interaction ? `; card: ${JSON.stringify(s.interaction)}` : ""}\nARIA SAYS: ${b.script}`;
  }).join("\n\n");
  const system = `You audit one AI-taught lecture as a demanding but fair teacher. The student: ${p.label}. They asked: "${prompt}". Score each criterion 1-10 for THIS student:\n${rubricLines()}\nAlso judge "personalization": does the lecture fit this student's level and preferences? ${checklist.length ? `\nThe syllabus points this lecture must teach:\n${checklist.map((c, i) => `${i + 1}. ${c}`).join("\n")}\nFor each, say whether the lecture TEACHES it — "yes" (explained, not just named), "partly" or "no".` : ""}\nAlso: does any board repeat what another board already taught? Is any everyday example forced, untrue or tacked onto a fact where it does not belong? Return JSON only: {"scores": {${[...BENCH_CRITERIA, "personalization"].map((c) => `"${c}": number`).join(", ")}}, "notes": "the 3 biggest problems, one line each", "syllabus": [{"point": string, "taught": "yes" | "partly" | "no"}], "repetition": string | null, "forcedExamples": [string]}.`;
  try {
    const res = await openai.chat.completions.create({ model: process.env.BENCH_JUDGE_MODEL ?? "gpt-5.6-luna", response_format: { type: "json_object" }, max_tokens: 16000, messages: [{ role: "system", content: system }, { role: "user", content: lesson.slice(0, 60_000) }] } as never);
    const json = JSON.parse((res as { choices: Array<{ message: { content: string } }> }).choices[0].message.content);
    const usage = (res as { usage?: { prompt_tokens: number; completion_tokens: number } }).usage;
    return { scores: json.scores ?? {}, notes: String(json.notes ?? ""), costUsd: usage ? (usage.prompt_tokens * 0.2 + usage.completion_tokens * 1.2) / 1e6 : 0, syllabus: Array.isArray(json.syllabus) ? json.syllabus : [], repetition: json.repetition ?? null, forcedExamples: Array.isArray(json.forcedExamples) ? json.forcedExamples : [] };
  } catch (e) { return { scores: {}, notes: `judge failed: ${(e as Error).message}`, costUsd: 0 }; }
}

// The outline's web research is billed by the server and only logged there; read it back so the cap is real.
const SERVER_LOG = opt("--serverLog");
function serverLogSize(): number { try { return SERVER_LOG ? statSync(SERVER_LOG).size : 0; } catch { return 0; } }
function researchCost(prompt: string, from: number): number {
  if (!SERVER_LOG) return 0;
  try {
    const fresh = readFileSync(SERVER_LOG).subarray(from).toString("utf8");
    const want = `[research] "${prompt.slice(0, 200).trim()}"`;
    const line = fresh.split("\n").find((l) => l.includes(want));
    const usd = line ? Number(line.match(/\$(\d+(?:\.\d+)?)\s*$/)?.[1] ?? 0) : 0;
    return Number.isFinite(usd) ? usd : 0;
  } catch { return 0; }
}

async function runOne(prompt: string, pi: number, p: Profile) {
  const id = `P${pi + 1}-${p.id}`;
  const t0 = Date.now();
  let usd = 0;
  try {
    const card = buildStudentCard(p.basics, prompt, {}, p.support);
    const logFrom = serverLogSize();
    const o = await outlineFor(prompt, p);
    usd += o.costUsd + researchCost(prompt, logFrom);
    const input: ProgressiveLectureInput = { topic: o.outline?.topic ?? prompt, mood: "", sourceType: "prompt", mode: "standard", outline: o.outline, learnerProfile: p.snapshot, ...(card ? { studentCard: card } : {}), ...(o.research ? { webSources: o.research as ProgressiveLectureInput["webSources"] } : {}) };
    const canvas = await planCanvasLecture(input);
    usd += canvas.costUsd;
    const plan = canvas.plan.map((x) => x.canvas).filter((b): b is CanvasPlanBeat => Boolean(b));
    const earlier: Array<CanvasBoardSpec | undefined> = plan.map(() => undefined);
    const specs: CanvasBoardSpec[] = [];
    const logs: string[] = [];
    for (let i = 0; i < plan.length; i += 3) {
      const done = await Promise.all(plan.slice(i, i + 3).map((_, j) => writeCanvasBoard({ userId: "prompt-bench", sessionId: `pbench-${Date.now()}-${pi}`, topic: input.topic, plan, index: i + j, earlier, notes: [] })));
      for (const [j, w] of done.entries()) { usd += w.costUsd; const s = canvasSpecOf(w.beat); if (s) { specs[i + j] = s; earlier[i + j] = s; } logs.push(...((w as { log?: string[] }).log ?? [])); }
    }
    const beats = plan.filter((_, i) => specs[i]);
    const kept = specs.filter(Boolean);
    const boards = beats.map((b, i) => checkBoard(b, kept[i]));
    const voiceRes = voice ? await voiceCheck(beats.filter((b) => b.stage !== "exam").flatMap((b) => canvasSentences(b.script)), BASE, freshCookie) : null;
    if (voiceRes?.ok) usd += 0.003;
    const scores = scorecard(boards, card, p, voiceRes);
    const judged = judge ? await judgeLecture(prompt, p, beats, kept, o.checklist) : null;
    usd += judged?.costUsd ?? 0;
    spent += usd;
    writeFileSync(path.join(outDir, "runs", `${id}-snapshot.json`), JSON.stringify({ topic: `${prompt} — ${p.label}`, usd, beats: beats.map((b, i) => ({ title: b.title, plannedStage: b.stage, visualType: b.visualType, script: b.script, brief: b.brief, objects: b.objects, draw: { ops: [{ kind: "canvasBoard", spec: kept[i] }] } })) }, null, 1));
    const labelsShown = kept.map((sp) => { const st = sp.stage as { kind: string; parts?: Array<{ id: string; name: string }>; labels?: string[] }; return st.kind === "illustration" ? (st.parts ?? []).filter((x) => (st.labels ?? []).includes(x.id)).map((x) => x.name) : st.kind === "figure" || st.kind === "diagram" ? (st.parts ?? []).map((x) => x.name) : []; });
    return { id, prompt, profile: p.id, profileLabel: p.label, usd: Math.round(usd * 1000) / 1000, secs: Math.round((Date.now() - t0) / 1000), scope: o.outline?.scope, outline: o.outline?.subtopics.map((s) => s.title), checklist: o.checklist, coverage: o.coverage, planThoughts: o.thoughts, boards, scores, judge: judged, pictures: logs.filter((l) => /textbook diagram|picture failed/.test(l)).map((l) => l.slice(0, 200)), pen: logs.filter((l) => /pen cues/.test(l)), labelsShown, repeats: repeats(beats), voice: voiceRes };
  } catch (e) {
    spent += usd;
    return { id, prompt, profile: p.id, profileLabel: p.label, usd, error: (e as Error).message.slice(0, 300) };
  }
}

const results: Array<Awaited<ReturnType<typeof runOne>>> = [];

/* ── run the matrix, a few at a time, within the budget ──────────────────────────────────────── */

if (rescore) {
  const { readdirSync } = await import("node:fs");
  const p = profiles[0] ?? PROFILES[1];
  for (const f of readdirSync(rescore).filter((x) => x.endsWith("-snapshot.json")).sort()) {
    const snapFile = JSON.parse(readFileSync(path.join(rescore, f), "utf8")) as { topic: string; usd?: number; beats: Array<{ title: string; plannedStage?: string; script: string; brief?: string; objects?: string[]; visualType?: string; draw: { ops: Array<{ spec: CanvasBoardSpec }> } }> };
    const beats = snapFile.beats.map((b, i) => ({ id: `b${i + 1}`, title: b.title, script: b.script, brief: b.brief ?? "", objects: b.objects ?? [], visualType: b.visualType, stage: b.plannedStage ?? "", kind: "teach" }) as unknown as CanvasPlanBeat);
    const specs = snapFile.beats.map((b) => b.draw.ops[0].spec);
    const boards = beats.map((b, i) => checkBoard(b, specs[i]));
    const id = f.replace("-snapshot.json", "");
    writeFileSync(path.join(outDir, "runs", f), JSON.stringify(snapFile));
    const before = (() => { try { return (JSON.parse(readFileSync(path.join(rescore, "..", "results.json"), "utf8")) as Array<{ id: string; checklist?: string[] }>).find((r) => r.id === id); } catch { return undefined; } })();
    const judged = judge ? await judgeLecture(snapFile.topic, p, beats, specs, before?.checklist ?? []) : null;
    spent += judged?.costUsd ?? 0;
    results.push({ id, prompt: snapFile.topic, profile: p.id, profileLabel: p.label, usd: snapFile.usd ?? 0, secs: 0, scope: undefined, outline: [], checklist: [], coverage: undefined, planThoughts: [], pen: [], labelsShown: [], repeats: repeats(beats), boards, scores: scorecard(boards, buildStudentCard(p.basics, snapFile.topic, {}, p.support), p, null), judge: judged, pictures: [], voice: null });
    console.log(`${id}: rescored ${boards.length} boards`);
  }
}
const outlinesOnly = args.includes("--outlines");
if (outlinesOnly) {
  const p = profiles[0] ?? PROFILES[1];
  const rows = [];
  for (let i = 0; i < prompts.length; i += 4) {
    const batch = await Promise.all(prompts.slice(i, i + 4).map(async (prompt) => { try { return { prompt, ...(await outlineFor(prompt, p)) }; } catch (e) { return { prompt, error: (e as Error).message }; } }));
    for (const r of batch) {
      rows.push(r);
      if ("error" in r) { console.log(`${r.prompt}\n   ERROR ${r.error}`); continue; }
      spent += r.costUsd;
      console.log(`${r.prompt}\n   ${r.outline?.scope ?? "?"} · ${r.outline?.subtopics.length} board(s) · $${r.costUsd.toFixed(4)} · ${r.secs}s${r.coverage ? ` · syllabus ${r.coverage.covered}/${r.coverage.total}${r.coverage.missing.length ? ` missing: ${r.coverage.missing.join("; ")}` : ""}` : ""}`);
      for (const s of r.outline?.subtopics ?? []) console.log(`     - ${s.title} — ${s.caption}`);
      if (r.checklist.length) console.log(`     points: ${r.checklist.join(" | ")}`);
      for (const t of r.thoughts) console.log(`     (${t})`);
    }
  }
  writeFileSync(path.join(outDir, "outlines.json"), JSON.stringify(rows, null, 1));
  console.log(`total $${spent.toFixed(3)}`);
  process.exit(0);
}
// --only P10-alevel,P13-alevel: run just these lectures of the list (the rest of a stopped run).
const only = opt("--only")?.split(",").map((x) => x.trim());
const jobs = rescore ? [] : entries.flatMap((e, pi) => {
  const own = typeof e === "string" ? undefined : e.profiles;
  return (own ? PROFILES.filter((p) => own.includes(p.id)) : profiles).map((p) => ({ prompt: prompts[pi], pi, p }));
}).filter((j) => !only || only.includes(`P${j.pi + 1}-${j.p.id}`));
// A lecture starts only when what is spent, plus what is running, plus one more, still fits the cap.
const PER_LECTURE = Number(opt("--perLecture") ?? 0.4);
const PARALLEL = Number(opt("--parallel") ?? 2);
await new Promise<void>((resolve) => {
  let next = 0;
  let running = 0;
  const launch = () => {
    while (running < PARALLEL && next < jobs.length && spent + (running + 1) * PER_LECTURE <= maxUsd) {
      const job = jobs[next++];
      running++;
      void runOne(job.prompt, job.pi, job.p).then((r) => {
        running--;
        results.push(r);
        writeFileSync(path.join(outDir, "results.json"), JSON.stringify(results, null, 1));
        if ("error" in r && r.error) console.log(`DONE ${results.length}/${jobs.length} ${r.id} ERROR ${r.error} · total $${spent.toFixed(2)}`);
        else if ("boards" in r && r.boards) {
          const js = Object.values(r.judge?.scores ?? {}).map(Number).filter(Number.isFinite);
          const mean = js.length ? (js.reduce((a, b) => a + b, 0) / js.length).toFixed(1) : "–";
          const low = Object.entries(r.judge?.scores ?? {}).filter(([, v]) => Number(v) < 7).map(([k, v]) => `${k} ${v}`).join(", ");
          const taught = r.judge?.syllabus?.length ? ` · syllabus ${r.judge.syllabus.filter((x) => x.taught === "yes").length}/${r.judge.syllabus.length}` : "";
          const bad = r.boards.reduce((n, b) => n + b.badCues + b.wrongLabels + b.cuts, 0);
          console.log(`DONE ${results.length}/${jobs.length} ${r.id} "${r.prompt}" · ${r.scope ?? "?"} · ${r.boards.length} board(s) · judge ${mean}${low ? ` (below 7: ${low})` : ""} · personalization ${r.judge?.scores?.personalization ?? "–"} · reads grade ${r.scores.readingGrade}/${r.scores.targetGrade}${taught} · pen/label/cut problems ${bad} · pictures ${r.pictures.filter((x) => /located/.test(x)).length}/${r.pictures.length} · voice ${r.voice ? (r.voice.ok ? "ok" : "FAILED") : "–"} · $${r.usd} · ${r.secs}s · total $${spent.toFixed(2)}`);
          console.log(`   judge: ${(r.judge?.notes ?? "").replace(/\s*\n\s*/g, " / ")}`);
        }
        if (running === 0 && (next >= jobs.length || spent + PER_LECTURE > maxUsd)) resolve();
        else launch();
      });
    }
    if (running === 0) resolve();
  };
  launch();
});
const skipped = jobs.length - results.length;
if (skipped > 0) console.log(`stopped at $${spent.toFixed(2)} (cap $${maxUsd}): ${skipped} lecture(s) not started`);

writeFileSync(path.join(outDir, "results.json"), JSON.stringify(results, null, 1));

/* ── report ───────────────────────────────────────────────────────────────────────────────────── */

const DIMS = ["teachingDepth", "levelFit", "personalization", "narrationSync", "diagrams", "labels", "animation", "voice", "interaction"] as const;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const tone = (v: number) => (v >= 8 ? "#16a34a" : v >= 6.5 ? "#ca8a04" : "#dc2626");
const cell = (v: number | undefined) => (v === undefined ? "<td>–</td>" : `<td style="color:${tone(v)};font-weight:600">${v}</td>`);
const ok = results.filter((r): r is Extract<typeof r, { scores: unknown }> => "scores" in r);
const avg = (xs: number[]) => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10 : 0);
let html = `<!doctype html><meta charset=utf-8><title>Prompt bench</title><style>body{font:14px system-ui;background:#0f1117;color:#e5e7eb;padding:24px}table{border-collapse:collapse;margin:12px 0}td,th{border:1px solid #2a2f3a;padding:6px 9px;text-align:center}th{background:#1b2030}td.l{text-align:left}h2{margin-top:34px}.g{display:grid;grid-template-columns:repeat(auto-fill,minmax(420px,1fr));gap:10px}figure{margin:0;background:#1b2030;padding:6px;border-radius:8px}img{width:100%}figcaption{font-size:12px;color:#9ca3af}details{margin:6px 0}</style>`;
html += `<h1>Prompt bench</h1><p>${ok.length} lectures · ${prompts.length} prompts × ${profiles.length} students · $${spent.toFixed(2)}</p>`;
html += `<h2>Code checks (0–10)</h2><table><tr><th>Lecture</th><th>Student</th>${DIMS.map((d) => `<th>${d}</th>`).join("")}<th>FK grade / target</th><th>$</th></tr>`;
for (const r of ok) html += `<tr><td class=l><a href="#${r.id}" style="color:#93c5fd">${esc(r.prompt.slice(0, 50))}</a></td><td class=l>${esc(r.profile)}</td>${DIMS.map((d) => cell(r.scores[d])).join("")}<td>${r.scores.readingGrade} / ${r.scores.targetGrade}</td><td>${r.usd}</td></tr>`;
html += `<tr><th colspan=2>Average</th>${DIMS.map((d) => cell(avg(ok.map((r) => r.scores[d])))).join("")}<td></td><td></td></tr></table>`;
if (judge) {
  const crit = [...BENCH_CRITERIA, "personalization"];
  html += `<h2>Judge — the audit's criteria (1–10)</h2><table><tr><th>Lecture</th><th>Student</th>${crit.map((c) => `<th>${c}</th>`).join("")}<th>Mean</th></tr>`;
  for (const r of ok) { const s = r.judge?.scores ?? {}; const vals = crit.map((c) => Number(s[c])).filter(Number.isFinite); html += `<tr><td class=l>${esc(r.prompt.slice(0, 40))}</td><td class=l>${esc(r.profile)}</td>${crit.map((c) => cell(Number.isFinite(Number(s[c])) ? Number(s[c]) : undefined)).join("")}${cell(avg(vals))}</tr>`; }
  html += `</table>`;
}
for (const r of results) {
  html += `<h2 id="${r.id}">${esc(r.prompt)} — ${esc(r.profileLabel)}</h2>`;
  if ("error" in r && r.error) { html += `<p style="color:#f87171">${esc(r.error)}</p>`; continue; }
  if (!r.boards || !r.scores || !r.pictures) continue;
  if (r.judge?.notes) html += `<p><b>Judge:</b> ${esc(r.judge.notes)}</p>`;
  if ("scope" in r) html += `<p><b>Plan:</b> ${esc(String(r.scope ?? "?"))}, ${r.boards.length} board(s)${r.coverage ? ` · syllabus check at plan time ${r.coverage.covered}/${r.coverage.total}` : ""}${r.checklist?.length ? `<br><b>Points it must teach:</b> ${esc(r.checklist.join(" | "))}` : ""}</p>`;
  if (r.judge?.syllabus?.length) html += `<p><b>Taught (judge):</b> ${r.judge.syllabus.map((x) => `${x.taught === "yes" ? "✅" : x.taught === "partly" ? "⚠️" : "❌"} ${esc(x.point)}`).join("<br>")}</p>`;
  if ("pen" in r) html += `<p><b>Labels shown:</b> ${r.labelsShown.map((l, i) => (l.length ? `b${i + 1}: ${esc(l.join(", "))}` : "")).filter(Boolean).join(" · ") || "none"}<br><b>Pen repairs:</b> ${esc(r.pen.join(" · ") || "none needed")}<br><b>Most-alike boards:</b> ${r.repeats ? `b${r.repeats.a} & b${r.repeats.b} share ${Math.round(r.repeats.overlap * 100)}% of words` : "–"}${r.judge?.repetition ? ` · judge: ${esc(String(r.judge.repetition))}` : ""}<br><b>Forced examples (judge):</b> ${esc((r.judge?.forcedExamples ?? []).join(" | ") || "none")}</p>`;
  html += `<p>Outline: ${esc((r.outline ?? []).join(" · "))}<br>Personalization checks: ${esc(JSON.stringify(r.scores.checks))} · Pictures: ${esc(r.pictures.join(" | ") || "none")}</p>${r.voice ? `<p><b>Voice</b> (${r.voice.ok ? "ok" : "FAILED"}, ${r.voice.ms} ms) — written: <i>${esc(r.voice.said)}</i><br>heard: <i>${esc(r.voice.heard)}</i></p>` : ""}`;
  html += `<table><tr><th>#</th><th>Board</th><th>Shows</th><th>Sent.</th><th>FK</th><th>Notes (words each)</th><th>Unshown</th><th>Reveal steps</th><th>Cues (bad)</th><th>Labels (wrong)</th><th>Cut / dropped</th><th>Card</th><th>Problems</th></tr>`;
  r.boards.forEach((b, i) => { html += `<tr><td>${i + 1}</td><td class=l>${esc(b.title)}</td><td>${b.stage}${b.figure ? `:${b.figure}` : ""}${b.fallback ? " ⚠" : ""}</td><td>${b.sentences}</td><td>${b.fk}</td><td>${b.notes} (${b.noteWords})${b.noteOverlap ? " ⚠overlap" : ""}</td><td>${b.unshown}</td><td>${b.revealSteps}</td><td>${b.cues} (${b.badCues})</td><td>${b.labels} (${b.wrongLabels})</td><td>${b.cuts} / ${b.drops}</td><td>${b.interaction ?? ""}</td><td class=l>${esc([...b.release, ...b.quiz].join("; ").slice(0, 300))}</td></tr>`; });
  html += `</table><div class=g>${r.boards.map((b, i) => `<figure><a href="runs/${r.id}-b${i + 1}.png" target=_blank><img loading=lazy src="runs/${r.id}-b${i + 1}.png"></a><figcaption>${i + 1}. ${esc(b.title)}</figcaption></figure>`).join("")}</div>`;
}
writeFileSync(path.join(outDir, "report.html"), html);
console.log(`total $${spent.toFixed(3)} · report: ${path.join(outDir, "report.html")}`);
void WEB;

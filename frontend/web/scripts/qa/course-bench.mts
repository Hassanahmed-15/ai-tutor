/**
 * COURSE BENCHMARK (owner, 2026-10-24: "run three lectures, one each from biology, chemistry and
 * mathematics … check in every detail everything my manager shared … give me a complete report of all
 * the parameters; run the lectures in parallel").
 *
 * 1. Generate (paid): a random course lesson in biology, chemistry and maths — picked from the catalogue,
 *    prepared by /api/curricula/lesson and built by /api/progressive-lectures exactly as the Courses page
 *    does — all three at once, through the running app.
 * 2. Check every board of the new lessons AND of a "before" baseline (the manager's own course lessons):
 *    - the manager's points: said-is-written, speeds, headings and points, diagrams (a vision examiner
 *      on each board, new lessons only), simpler wording, pause, heading-to-point placement;
 *    - everything else built since: subject stamps, course pictures (gpt-image-2, labels, picture context,
 *      label mentions, the tutor's description), no ready-made picture figures in courses, the release
 *      audit, numbers, cost and time.
 *    Pixel checks, pause and sync run separately (scripts/qa/lecture-qa.mts --session, sync-check.mts) and
 *    are merged in when their reports exist.
 * 3. Report: ~/aria-qa-images/<date>-course-bench/index.html
 *
 *   node --conditions=react-server --import tsx scripts/qa/course-bench.mts            generate + check
 *   node --conditions=react-server --import tsx scripts/qa/course-bench.mts --check    check the last run again (vision examiner skipped unless --look)
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { SignJWT } from "jose";
import { CosmosClient } from "@azure/cosmos";
import { layoutPanel } from "../../lib/canvas/layout";
import { canvasSentences } from "../../lib/canvas/plan";
import { auditBoardForRelease } from "../../lib/canvas/releaseAudit";
import { unshownSentences } from "../../lib/canvas/narrationSync";
import { unsaidLabels } from "../../lib/canvas/labelMentions";
import { describeCanvasSpec } from "../../lib/canvas/describe";
import { PICTURE_FIGURES } from "../../lib/canvas/courseFigures";
import { PLAYBACK_RATES } from "../../lib/playbackPrefs";
import type { CanvasBoardSpec } from "../../lib/canvas/types";

const env = Object.fromEntries(readFileSync(new URL("../../.env.local", import.meta.url), "utf8").split("\n").filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^"|"$/g, "")]));
for (const [k, v] of Object.entries(env)) process.env[k] ??= v as string;
const BASE = process.env.QA_BASE ?? "http://localhost:3000";
const OUT = `${homedir()}/aria-qa-images/${new Date().toLocaleDateString("en-CA")}-course-bench`;
mkdirSync(`${OUT}/boards`, { recursive: true });
const args = process.argv.slice(2);
const CHECK_ONLY = args.includes("--check");
// The owner switched the board look off (2026-10-24: "this is just trash"): the examiner runs only on request.
const LOOK = args.includes("--look");
const ONLY = args.find((a) => a.startsWith("--subjects="))?.split("=")[1]?.split(",");
const RUN_NAME = args.find((a) => a.startsWith("--run="))?.split("=")[1] ?? "run";
// --lesson=<subject>:<courseId>:<grade>/<unit>/<topic>/<lesson> runs that exact lesson (the manager's, say) instead of a random one.
const LESSON = args.find((a) => a.startsWith("--lesson="))?.slice("--lesson=".length);
// --match=<regex> picks only lessons whose unit, topic or title matches (organic chemistry, say); --avoid=<regex>
// leaves those out; --count=N picks N lessons per subject.
const MATCH = args.find((a) => a.startsWith("--match="))?.slice("--match=".length);
const AVOID = args.find((a) => a.startsWith("--avoid="))?.slice("--avoid=".length);
const COUNT = Number(args.find((a) => a.startsWith("--count="))?.split("=")[1] ?? 1);
const db = new CosmosClient(env.COSMOS_CONNECTION_STRING).database("aria-shared");
const USER = "local-dev-canvas";
const token = async (sub: string) => new SignJWT({ email: `${sub}@example.com` }).setProtectedHeader({ alg: "HS256" }).setSubject(sub).setIssuedAt().setExpirationTime("3h").sign(new TextEncoder().encode(env.AUTH_SECRET));
const headers = async (sub = USER) => ({ "content-type": "application/json", cookie: `aria_access=${await token(sub)}` });
let spent = 0;

/* ── 1. generate ──────────────────────────────────────────────────────────────────────────────── */

type Picked = { subject: string; courseId: string; course: string; framework: string; grade: string; unitId: string; topicId: string; lessonId: string; lessonTitle: string };
const SUBJECTS: Array<{ key: string; match: RegExp }> = [
  // One-subject courses only: "Biology, Chemistry, Physics, English, Logical Reasoning" (MDCAT) gave a
  // logical-reasoning lesson as the "biology" pick (2026-10-24).
  { key: "biology", match: /^biology\b(?!,)|^biology [a-z(]/i },
  { key: "chemistry", match: /^chemistry\b(?!,)/i },
  { key: "physics", match: /^physics\b(?!,)/i },
  { key: "maths", match: /^(mathematics|maths)\b(?! *-? *further)/i },
];

function pick(key: string, match: RegExp): Picked {
  const catalog = JSON.parse(readFileSync("data/curricula/catalog.json", "utf8")) as { entries: Array<{ id: string; subject: string; framework: string; quality?: string }> };
  const courses = catalog.entries.filter((e) => match.test(e.subject) && e.quality !== "review" && existsSync(`data/curricula/trees/${e.id}.json`));
  for (let tries = 0; tries < 40; tries++) {
    const c = courses[Math.floor(Math.random() * courses.length)];
    const tree = JSON.parse(readFileSync(`data/curricula/trees/${c.id}.json`, "utf8")) as { grades: Array<{ grade: string; units: Array<{ id: string; title?: string; topics: Array<{ id: string; title?: string; subtopics: Array<{ id: string; title: string; outcomes?: unknown[] }> }> }> }> };
    const wanted = (text: string) => (!MATCH || new RegExp(MATCH, "i").test(text)) && (!AVOID || !new RegExp(AVOID, "i").test(text));
    const lessons = tree.grades.flatMap((g) => g.units.flatMap((u) => u.topics.flatMap((t) => t.subtopics.filter((s) => (s.outcomes?.length ?? 0) > 0 && wanted(`${u.title ?? u.id} | ${t.title ?? t.id} | ${s.title}`)).map((s) => ({ g, u, t, s })))));
    if (!lessons.length) continue;
    const l = lessons[Math.floor(Math.random() * lessons.length)];
    return { subject: key, courseId: c.id, course: c.subject, framework: c.framework, grade: l.g.grade, unitId: l.u.id, topicId: l.t.id, lessonId: l.s.id, lessonTitle: l.s.title };
  }
  throw new Error(`no ${key} course found`);
}

function exact(address: string): Picked {
  const [subject, courseId, path] = address.split(":");
  const [grade, unitId, topicId, lessonId] = path.split("/");
  const c = (JSON.parse(readFileSync("data/curricula/catalog.json", "utf8")) as { entries: Array<{ id: string; subject: string; framework: string }> }).entries.find((e) => e.id === courseId);
  if (!c) throw new Error(`no course ${courseId}`);
  return { subject, courseId, course: c.subject, framework: c.framework, grade, unitId, topicId, lessonId, lessonTitle: lessonId };
}

async function generate(p: Picked): Promise<{ session: string; seconds: number; status: string; title: string }> {
  const t0 = Date.now();
  const h = await headers();
  const lesson = await fetch(`${BASE}/api/curricula/lesson`, { method: "POST", headers: h, body: JSON.stringify({ courseId: p.courseId, version: "", grade: p.grade, unitId: p.unitId, topicId: p.topicId, lessonId: p.lessonId }) });
  const data = (await lesson.json()) as { error?: string; spec?: { lessonTitle: string }; document?: unknown };
  if (!lesson.ok || !data.document || !data.spec) throw new Error(`${p.subject}: lesson could not be prepared: ${data.error ?? lesson.status}`);
  const title = data.spec.lessonTitle;
  const start = await fetch(`${BASE}/api/progressive-lectures`, {
    method: "POST", headers: h,
    body: JSON.stringify({ topic: title, mood: "Standard learning mode.", sourceType: "suprnotes", mode: "standard", suprnotes: data.document, sourceScope: { fidelity: "reference", breadth: { kind: "whole" }, documentLabels: [] }, learner: { claimedLevel: 3 } }),
  });
  const started = (await start.json()) as { sessionId?: string; error?: string };
  if (!started.sessionId) throw new Error(`${p.subject}: lecture did not start: ${started.error ?? start.status}`);
  console.log(`${p.subject}: "${title}" (${p.course}, ${p.framework}) → session ${started.sessionId}`);
  for (;;) {
    await new Promise((r) => setTimeout(r, 8000));
    const snap = (await (await fetch(`${BASE}/api/progressive-lectures/${started.sessionId}`, { headers: h })).json()) as { status: string; beats?: unknown[] };
    if (["complete", "completed", "failed", "error"].includes(snap.status) || Date.now() - t0 > 30 * 60_000) {
      console.log(`${p.subject}: ${snap.status} after ${Math.round((Date.now() - t0) / 1000)} s, ${(snap.beats ?? []).filter(Boolean).length} boards`);
      return { session: started.sessionId, seconds: Math.round((Date.now() - t0) / 1000), status: snap.status, title };
    }
  }
}

/* ── 2. check ─────────────────────────────────────────────────────────────────────────────────── */

type Board = { n: number; title: string; kind: string; component?: string; subject?: string; sentences: number; shown: number; layout: Record<string, unknown>; audit: string[]; picture?: Record<string, unknown>; look?: { ok: boolean; problems: Array<{ kind: string; detail: string }> } | null; photo?: string };
type Lecture = { group: "new" | "before"; subject: string; title: string; course?: string; session: string; userId: string; status?: string; seconds?: number; costUsd?: number; boards: Board[]; narration: Record<string, unknown> };

const words = (t: string) => t.split(/\s+/).filter(Boolean);
const syllables = (w: string) => Math.max(1, (w.toLowerCase().replace(/[^a-z]/g, "").replace(/e$/, "").match(/[aeiouy]+/g) ?? []).length);

/** Flesch reading ease of a script: higher is easier (60–70 plain English; 80+ easy). */
function readability(text: string): { flesch: number; wordsPerSentence: number; longSentences: number } {
  const sentences = canvasSentences(text);
  const w = words(text);
  const syl = w.reduce((a, x) => a + syllables(x), 0);
  const wps = w.length / Math.max(1, sentences.length);
  return { flesch: Math.round(206.835 - 1.015 * wps - 84.6 * (syl / Math.max(1, w.length))), wordsPerSentence: Math.round(wps * 10) / 10, longSentences: sentences.filter((s) => words(s).length > 25).length };
}

/** Headings and points (manager points 3 and 7): every note in one column, under or beside its heading. */
function layoutCheck(spec: CanvasBoardSpec): Record<string, unknown> {
  const marks = layoutPanel(spec).marks;
  const heading = marks.find((m) => m.type === "heading") as { x: number; y: number; size: number } | undefined;
  const notes = marks.filter((m) => m.type === "note") as Array<{ x: number; y: number; size: number }>;
  if (!heading || !notes.length) return { notes: notes.length, heading: Boolean(heading), ok: Boolean(heading) };
  const xs = notes.map((n) => n.x);
  const spread = Math.max(...xs) - Math.min(...xs);
  const first = [...notes].sort((a, b) => a.y - b.y)[0];
  const dx = Math.round(first.x - heading.x), dy = Math.round(first.y - heading.y);
  const below = notes.every((n) => n.y > heading.y);
  const ok = spread <= 24 && below && dy <= 420 && (Math.abs(dx) <= 60 || dy <= 140);
  return { notes: notes.length, columnSpread: Math.round(spread), firstNoteDx: dx, firstNoteDy: dy, allBelowHeading: below, ok };
}

function pictureCheck(spec: CanvasBoardSpec, script: string): Record<string, unknown> | undefined {
  const st = spec.stage as Record<string, any>;
  if (spec.stage.kind === "figure") return { readyMadeComponent: st.component, pictureFigureInCourse: PICTURE_FIGURES.has(st.component) || Boolean(st.asset), library: Boolean(st.asset) };
  if (spec.stage.kind !== "illustration") return undefined;
  const tutor = describeCanvasSpec(spec);
  return {
    gptImage2: Boolean(st.coursePicture),
    labelsInPicture: st.labelsInPicture ?? null,
    labelsByBoard: st.labels?.length ?? 0,
    partsPointed: (st.parts ?? []).filter((p: any) => Number.isFinite(p.x) && Number.isFinite(p.y)).length,
    description: st.description ?? null,
    tutorKnowsPicture: /What the picture shows/.test(tutor),
    unsaidLabels: unsaidLabels(spec, script).flatMap((m) => m.labels),
    src: st.src ?? null,
  };
}

async function loadLecture(session: string): Promise<{ topic: string; userId: string; status: string; costUsd?: number; plan: any[]; beats: Array<{ sequence: number; beat: any }> }> {
  const s = (await db.container("progressive-lecture-sessions").items.query({ query: "SELECT c.topic, c.userId, c.status, c.costUsd, c.plan FROM c WHERE c.id = @id", parameters: [{ name: "@id", value: session }] }).fetchAll()).resources[0] as any;
  const beats = (await db.container("progressive-lecture-beats").items.query({ query: "SELECT c.sequence, c.beat FROM c WHERE c.sessionId = @id", parameters: [{ name: "@id", value: session }] }).fetchAll()).resources as any[];
  return { topic: s?.topic ?? "", userId: s?.userId ?? USER, status: s?.status ?? "", costUsd: s?.costUsd, plan: (s?.plan ?? []).map((p: any) => p.canvas), beats: beats.sort((a, b) => a.sequence - b.sequence) };
}

/** The release audit's findings on a board, read against the board's own plan (as the writer used it). */
function releaseNotes(spec: CanvasBoardSpec, planned: any): string[] {
  if (!planned) return [];
  try {
    return auditBoardForRelease(spec, planned).map((i: any) => (typeof i === "string" ? i : i.message ?? JSON.stringify(i))).slice(0, 6);
  } catch (error) {
    return [`(audit could not run: ${(error as Error).message.slice(0, 60)})`];
  }
}

async function rateNarration(openai: any, topic: string, scripts: string[]): Promise<Record<string, unknown>> {
  const { costFor } = await import("../../lib/modelPricing");
  const res = await openai.chat.completions.create({
    model: "gpt-5.6-luna", response_format: { type: "json_object" }, max_completion_tokens: 2500, reasoning_effort: "low",
    messages: [
      { role: "system", content: "You judge a tutor's spoken lesson for a 15-year-old. Return JSON {\"simplicity\": 1-10, \"friendliness\": 1-10, \"jargonUnexplained\": [up to 5 terms used without saying what they mean], \"overcomplicated\": [up to 3 sentences that are harder than they need to be], \"verdict\": one sentence}." },
      { role: "user", content: `Lesson: ${topic}\n\n${scripts.join("\n\n").slice(0, 9000)}` },
    ],
  });
  spent += costFor("gpt-5.6-luna", res.usage);
  return JSON.parse(res.choices[0]?.message?.content ?? "{}");
}

async function check(group: "new" | "before", subject: string, session: string, extra: Partial<Lecture> = {}): Promise<Lecture> {
  const { boardPhoto, lookAtBoard } = await import("../../lib/canvas/boardLook");
  const { client } = await import("../../lib/canvas/generate");
  const openai = client();
  const lec = await loadLecture(session);
  const boards: Board[] = [];
  for (const b of lec.beats) {
    const spec = b.beat?.draw?.ops?.find((o: any) => o.kind === "canvasBoard")?.spec as CanvasBoardSpec | undefined;
    if (!spec) continue;
    const script = b.beat.script ?? "";
    const sentences = canvasSentences(script).length;
    const unshown = spec.stage.kind === "exam" ? [] : unshownSentences(spec, { script });
    const board: Board = {
      n: b.sequence + 1, title: b.beat.title, kind: spec.stage.kind, component: (spec.stage as any).component, subject: spec.subject,
      sentences, shown: sentences ? Math.round(((sentences - unshown.length) / sentences) * 100) : 100,
      layout: layoutCheck(spec), audit: releaseNotes(spec, lec.plan[b.sequence]),
      picture: pictureCheck(spec, script),
    };
    if (LOOK && group === "new" && spec.stage.kind !== "exam") {
      const photo = await boardPhoto(spec, { userId: lec.userId, topic: lec.topic });
      if (photo) {
        const name = `${session.slice(0, 8)}-${board.n}.png`;
        writeFileSync(`${OUT}/boards/${name}`, photo);
        board.photo = `boards/${name}`;
        const v = await lookAtBoard(openai, photo, { topic: lec.topic, title: b.beat.title, script, stageKind: spec.stage.kind });
        spent += v?.costUsd ?? 0;
        board.look = v ? { ok: v.ok, problems: v.problems } : null;
      }
    } else if (existsSync(`${OUT}/boards/${session.slice(0, 8)}-${board.n}.png`)) board.photo = `boards/${session.slice(0, 8)}-${board.n}.png`;
    boards.push(board);
  }
  const scripts = lec.beats.map((b) => b.beat?.script ?? "").filter(Boolean);
  const narration = { ...readability(scripts.join(" ")), rating: await rateNarration(openai, lec.topic, scripts).catch((e) => ({ error: String(e).slice(0, 120) })) };
  return { group, subject, title: lec.topic, session, userId: lec.userId, status: lec.status, costUsd: lec.costUsd, boards, narration, ...extra };
}

/* ── run ──────────────────────────────────────────────────────────────────────────────────────── */

const RUN = `${OUT}/${RUN_NAME}.json`;
let run: { picked: Picked[]; made: Array<{ subject: string; session: string; seconds: number; status: string; title: string; course: string }> };
if (CHECK_ONLY && existsSync(RUN)) {
  // Every run of the day checked together (run.json, run-chem.json …).
  const runs = readdirSync(OUT).filter((f) => /^run.*\.json$/.test(f)).map((f) => JSON.parse(readFileSync(`${OUT}/${f}`, "utf8")) as typeof run);
  run = { picked: runs.flatMap((r) => r.picked), made: runs.flatMap((r) => r.made) };
}
else {
  const picked = LESSON ? [exact(LESSON)] : SUBJECTS.filter((s) => !ONLY || ONLY.includes(s.key)).flatMap((s) => Array.from({ length: COUNT }, () => pick(s.key, s.match)));
  const made = await Promise.all(picked.map(async (p) => ({ ...(await generate(p)), subject: p.subject, course: `${p.course} — ${p.framework}` })));
  run = { picked, made };
  writeFileSync(RUN, JSON.stringify(run, null, 1));
}

// The "before" baseline: the manager's own course lessons (made before today's fixes).
const manager = (await db.container("progressive-lecture-sessions").items.query({ query: "SELECT c.id, c.topic, c.userId FROM c WHERE STARTSWITH(c.userId, '20448e02') AND c.sourceType = 'suprnotes' AND c.status = 'complete' ORDER BY c._ts DESC" }).fetchAll()).resources as Array<{ id: string; topic: string; userId: string }>;
const baselineSubject = (t: string) => (/probab|algebra|equation|graph|fraction|number/i.test(t) ? "maths" : /formula|atomic|molecul|mole|reaction|electrol|bond|acid/i.test(t) ? "chemistry" : "biology");
const before = manager.slice(0, 6);

const lectures: Lecture[] = [];
for (const m of run.made) lectures.push(await check("new", m.subject, m.session, { seconds: m.seconds, course: m.course }));
for (const b of before) lectures.push(await check("before", baselineSubject(b.topic), b.id, { course: "the manager's lesson" }));
writeFileSync(`${OUT}/bench.json`, JSON.stringify({ run, lectures, spent, speeds: PLAYBACK_RATES }, null, 1));

// Pixel, pause and sync reports from the separate free checks, when present.
const qaDir = `${homedir()}/aria-qa-images/${new Date().toISOString().slice(0, 10)}-lecture-qa`;
const qaReports = existsSync(qaDir) ? readdirSync(qaDir).filter((f) => /^report-\d+\.json$/.test(f)).flatMap((f) => JSON.parse(readFileSync(`${qaDir}/${f}`, "utf8")) as any[]) : [];

/* ── 3. report ────────────────────────────────────────────────────────────────────────────────── */

const esc = (s: unknown) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 100);
function summary(l: Lecture) {
  const bs = l.boards.filter((b) => b.kind !== "exam");
  const sent = bs.reduce((a, b) => a + b.sentences, 0), shownSent = bs.reduce((a, b) => a + Math.round((b.shown / 100) * b.sentences), 0);
  const laid = bs.filter((b) => b.layout.notes !== 0);
  const looked = bs.filter((b) => b.look);
  const pics = bs.filter((b) => b.kind === "illustration");
  const figuresInCourse = bs.filter((b) => b.picture && (b.picture as any).pictureFigureInCourse);
  const qa = qaReports.find((r) => r.session === l.session);
  const pixel = qa ? qa.boards.reduce((a: number, b: any) => a + (b.issues ?? []).filter((i: any) => typeof i === "object" && ["overlap", "ink-through-text", "off-board"].includes(i.kind)).length, 0) : null;
  return {
    said: pct(shownSent, sent),
    layout: pct(laid.filter((b) => b.layout.ok).length, laid.length),
    look: looked.length ? `${looked.filter((b) => b.look!.ok).length}/${looked.length}` : "—",
    pictures: pics.length,
    gptImage2: pics.filter((b) => (b.picture as any)?.gptImage2).length,
    pictureContext: pics.filter((b) => (b.picture as any)?.tutorKnowsPicture).length,
    unsaid: pics.reduce((a, b) => a + ((b.picture as any)?.unsaidLabels?.length ?? 0), 0),
    figuresInCourse: figuresInCourse.length,
    subjects: [...new Set(bs.map((b) => b.subject ?? "none"))].join(", "),
    audit: bs.reduce((a, b) => a + b.audit.length, 0),
    pixel,
  };
}
const rows = lectures.map((l) => ({ l, s: summary(l) }));
const head = `<tr><th>Lesson</th><th>Boards</th><th>Said is written</th><th>Headings &amp; points in place</th><th>Vision examiner passed</th><th>Pictures (gpt-image-2)</th><th>Picture known to tutor</th><th>Labels never said</th><th>Ready-made picture figures</th><th>Overlaps (pixels)</th><th>Release-audit notes</th><th>Subject stamp</th><th>Readability</th><th>Simplicity / friendliness</th><th>Cost · time</th></tr>`;
const tr = ({ l, s }: (typeof rows)[number]) => `<tr class="${l.group}"><td><b>${esc(l.title)}</b><br><small>${esc(l.subject)} · ${esc(l.course ?? "")}</small></td><td>${l.boards.length}</td><td>${s.said}%</td><td>${s.layout}%</td><td>${s.look}</td><td>${s.pictures} (${s.gptImage2})</td><td>${s.pictureContext}/${s.pictures}</td><td>${s.unsaid}</td><td>${s.figuresInCourse}</td><td>${s.pixel ?? "—"}</td><td>${s.audit}</td><td>${esc(s.subjects)}</td><td>Flesch ${(l.narration as any).flesch} · ${(l.narration as any).wordsPerSentence} w/s</td><td>${(l.narration as any).rating?.simplicity ?? "—"} / ${(l.narration as any).rating?.friendliness ?? "—"}</td><td>${l.costUsd !== undefined ? `$${Number(l.costUsd).toFixed(3)}` : "—"}${l.seconds ? ` · ${Math.round(l.seconds / 60)} min` : ""}</td></tr>`;
const boardsHtml = lectures.filter((l) => l.group === "new").map((l) => `<section><h2>${esc(l.title)} <small>${esc(l.subject)} · ${esc(l.course ?? "")}</small></h2><p><b>Narration:</b> ${esc((l.narration as any).rating?.verdict ?? "")} ${((l.narration as any).rating?.jargonUnexplained ?? []).length ? `<br>Unexplained terms: ${esc((l.narration as any).rating.jargonUnexplained.join(", "))}` : ""}</p>${l.boards.map((b) => `<div class="board"><div>${b.photo ? `<img src="${b.photo}">` : ""}</div><div><h3>${b.n}. ${esc(b.title)} <small>${b.kind}${b.component ? ` (${esc(b.component)})` : ""}</small></h3><p>Said is written: <b>${b.shown}%</b> of ${b.sentences} sentences · layout ${b.layout.ok ? "✓" : "✗"} <small>${esc(JSON.stringify(b.layout))}</small></p>${b.look ? `<p>Vision examiner: ${b.look.ok ? "✓ passed" : `<span class=bad>✗ ${esc(b.look.problems.map((p) => `${p.kind}: ${p.detail}`).join("; "))}</span>`}</p>` : ""}${b.picture ? `<p>Picture: <small>${esc(JSON.stringify(b.picture))}</small></p>` : ""}${b.audit.length ? `<p class=bad>Audit: ${esc(b.audit.join("; "))}</p>` : ""}</div></div>`).join("")}</section>`).join("");
writeFileSync(`${OUT}/index.html`, `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Course benchmark</title><style>:root{color-scheme:light dark;--bg:#f6f7f9;--fg:#15171a;--card:#fff;--line:#d8dce2}@media (prefers-color-scheme:dark){:root{--bg:#111316;--fg:#e8eaed;--card:#1b1e22;--line:#30353c}}body{margin:0;padding:24px 16px;background:var(--bg);color:var(--fg);font:14px/1.45 system-ui,sans-serif}main{max-width:1400px;margin:auto}table{border-collapse:collapse;width:100%;background:var(--card);font-size:13px}th,td{border:1px solid var(--line);padding:6px;vertical-align:top}tr.before{opacity:.75}section{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:14px;margin:16px 0}.board{display:grid;grid-template-columns:1.2fr 1fr;gap:12px;border-top:1px solid var(--line);padding:10px 0}.board img{width:100%;border-radius:6px}.bad{color:#d9480f}small{opacity:.75}@media (max-width:800px){.board{grid-template-columns:1fr}}</style><main><h1>Course benchmark</h1><p>New lessons (generated today) and the manager's lessons from before the fixes. Speeds offered: ${PLAYBACK_RATES.join("×, ")}×. Benchmark checks spent $${spent.toFixed(2)}.</p><div style="overflow-x:auto"><table>${head}${rows.map(tr).join("")}</table></div>${boardsHtml}</main>`);
console.log(`\n${rows.map(({ l, s }) => `${l.group.padEnd(6)} ${l.subject.padEnd(9)} ${l.title.slice(0, 40).padEnd(40)} said ${s.said}% · layout ${s.layout}% · look ${s.look} · pictures ${s.pictures} (gpt-image-2 ${s.gptImage2}) · figures-in-course ${s.figuresInCourse} · audit ${s.audit} · subject ${s.subjects}`).join("\n")}\nchecks spent $${spent.toFixed(2)}\nreport: ${OUT}/index.html`);
process.exit(0);

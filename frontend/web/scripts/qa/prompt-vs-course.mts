/**
 * PROMPT vs COURSE (owner, 2026-11-20: "compare two or three lessons that are present in courses, test them in
 * prompting and see the difference"). PAID: each run is one real lecture through the running app (:3000).
 *
 *   node --env-file=.env.local --import tsx scripts/qa/prompt-vs-course.mts course <label> <courseId> <grade> <unitId> <topicId> <lessonId>
 *   node --env-file=.env.local --import tsx scripts/qa/prompt-vs-course.mts prompt <label> "<what the student types>"
 *
 * A course run is built as the Courses page builds it (/api/curricula/lesson → /api/progressive-lectures).
 * A prompt run is built as "Ask anything" builds it: the outline (/api/plan-lesson, research on) for an IGCSE
 * student (scripts/bench/lectureChecks.mts PROFILES), then the lecture with that outline and profile.
 * Whether the prompt is taught like a course is the dev server's CANVAS_PROMPTS_LIKE_COURSES.
 * Each finished run is added to ~/aria-qa-images/2026-11-20-prompt-vs-course/runs.json.
 */
import { appendFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { SignJWT } from "jose";
import { PROFILES } from "../bench/lectureChecks.mts";

const BASE = process.env.QA_BASE ?? "http://localhost:3000";
const OUT = `${homedir()}/aria-qa-images/2026-11-20-prompt-vs-course`;
mkdirSync(OUT, { recursive: true });
const USER = "local-dev-canvas";
const cookie = async () => `aria_access=${await new SignJWT({ email: `${USER}@example.com` }).setProtectedHeader({ alg: "HS256" }).setSubject(USER).setIssuedAt().setExpirationTime("3h").sign(new TextEncoder().encode(process.env.AUTH_SECRET!))}`;
const headers = async () => ({ "content-type": "application/json", cookie: await cookie() });

const [kind, label, ...rest] = process.argv.slice(2);
const t0 = Date.now();

async function waitFor(session: string): Promise<{ status: string; boards: number }> {
  for (;;) {
    await new Promise((r) => setTimeout(r, 8000));
    const snap = (await (await fetch(`${BASE}/api/progressive-lectures/${session}`, { headers: await headers() })).json()) as { status: string; beats?: unknown[] };
    if (["complete", "completed", "failed", "error"].includes(snap.status) || Date.now() - t0 > 30 * 60_000) return { status: snap.status, boards: (snap.beats ?? []).filter(Boolean).length };
  }
}

let started: { sessionId?: string; error?: string };
let topic: string;
if (kind === "course") {
  const [courseId, grade, unitId, topicId, lessonId] = rest;
  const lesson = await fetch(`${BASE}/api/curricula/lesson`, { method: "POST", headers: await headers(), body: JSON.stringify({ courseId, version: "", grade, unitId, topicId, lessonId }) });
  const data = (await lesson.json()) as { error?: string; spec?: { lessonTitle: string }; document?: unknown };
  if (!lesson.ok || !data.document || !data.spec) throw new Error(`lesson could not be prepared: ${data.error ?? lesson.status}`);
  topic = data.spec.lessonTitle;
  started = await (await fetch(`${BASE}/api/progressive-lectures`, {
    method: "POST", headers: await headers(),
    body: JSON.stringify({ topic, mood: "Standard learning mode.", sourceType: "suprnotes", mode: "standard", suprnotes: data.document, sourceScope: { fidelity: "reference", breadth: { kind: "whole" }, documentLabels: [] }, learner: { claimedLevel: 2 } }),
  })).json();
} else if (kind === "prompt") {
  const prompt = rest.join(" ");
  const p = PROFILES.find((x) => x.id === "igcse")!;
  const pr = p.basics.preferences!;
  const learner = { topic: "", claimedLevel: 2, confidence: "medium", objective: "exam", preferredStyle: [`learns best with ${pr.helps.join(", ")}`, `${pr.challenge} challenge`].join("; "), masteredConcepts: [], weakConcepts: [], misconceptions: [], prerequisiteGaps: [] };
  const res = await fetch(`${BASE}/api/plan-lesson`, { method: "POST", headers: await headers(), body: JSON.stringify({ mode: "outline", topic: prompt.slice(0, 200), request: prompt, clarifications: [], depth: 2, research: true, learnerBasics: p.basics, learnerProfile: learner }) });
  const lines = (await res.text()).split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean) as Array<Record<string, unknown>>;
  const done = lines.find((l) => l.type === "outline");
  if (!done) throw new Error(`no outline: ${JSON.stringify(lines.slice(-1)).slice(0, 300)}`);
  topic = String(done.topic ?? prompt);
  const outline = { topic, scope: done.scope, subtopics: done.subtopics, research: done.research };
  console.log(`outline: ${(done.subtopics as Array<{ title: string }>).map((s) => s.title).join(" | ")}`);
  started = await (await fetch(`${BASE}/api/progressive-lectures`, {
    method: "POST", headers: await headers(),
    body: JSON.stringify({ topic, focus: prompt, mood: "Standard learning mode.", sourceType: "prompt", mode: "standard", outline, learner, learnerProfile: p.snapshot }),
  })).json();
} else if (kind === "prompt-as-course") {
  // As the page now builds a typed topic (PROMPTS_AS_COURSES=on, 2026-11-28): the prompt's own outline, then
  // /api/prompt-lesson turns it into a course lesson document, built exactly as a course lesson.
  const prompt = rest.join(" ");
  const p = PROFILES.find((x) => x.id === "igcse")!;
  const pr = p.basics.preferences!;
  const learner = { topic: "", claimedLevel: 2, confidence: "medium", objective: "exam", preferredStyle: [`learns best with ${pr.helps.join(", ")}`, `${pr.challenge} challenge`].join("; "), masteredConcepts: [], weakConcepts: [], misconceptions: [], prerequisiteGaps: [] };
  const res = await fetch(`${BASE}/api/plan-lesson`, { method: "POST", headers: await headers(), body: JSON.stringify({ mode: "outline", topic: prompt.slice(0, 200), request: prompt, clarifications: [], depth: 2, research: true, learnerBasics: p.basics, learnerProfile: learner }) });
  const lines = (await res.text()).split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean) as Array<Record<string, unknown>>;
  const done = lines.find((l) => l.type === "outline");
  if (!done) throw new Error(`no outline: ${JSON.stringify(lines.slice(-1)).slice(0, 300)}`);
  topic = String(done.topic ?? prompt);
  console.log(`outline: ${(done.subtopics as Array<{ title: string }>).map((s) => s.title).join(" | ")}`);
  const lesson = await fetch(`${BASE}/api/prompt-lesson`, { method: "POST", headers: await headers(), body: JSON.stringify({ topic, request: prompt, outline: { subtopics: done.subtopics }, learnerBasics: p.basics }) });
  const data = (await lesson.json()) as { off?: boolean; error?: string; spec?: { lessonTitle: string; courseLabel: string; level: string; boards: unknown[] }; document?: unknown };
  if (!lesson.ok || !data.document || !data.spec) throw new Error(`prompt lesson: ${data.off ? "PROMPTS_AS_COURSES is off" : data.error ?? lesson.status}`);
  console.log(`course lesson: ${data.spec.courseLabel} · ${data.spec.level} · ${data.spec.boards.length} boards`);
  started = await (await fetch(`${BASE}/api/progressive-lectures`, {
    method: "POST", headers: await headers(),
    body: JSON.stringify({ topic, mood: "Standard learning mode.", sourceType: "suprnotes", mode: "standard", suprnotes: data.document, sourceScope: { fidelity: "reference", breadth: { kind: "whole" }, documentLabels: [] }, learner, learnerProfile: p.snapshot }),
  })).json();
} else throw new Error("first argument: course | prompt | prompt-as-course");

if (!started.sessionId) throw new Error(`lecture did not start: ${started.error}`);
console.log(`${label}: "${topic}" → session ${started.sessionId}`);
const end = await waitFor(started.sessionId);
const row = { label, kind, topic, session: started.sessionId, user: USER, ...end, seconds: Math.round((Date.now() - t0) / 1000), at: new Date().toISOString() };
appendFileSync(`${OUT}/runs.json`, `${JSON.stringify(row)}\n`);
console.log(JSON.stringify(row));

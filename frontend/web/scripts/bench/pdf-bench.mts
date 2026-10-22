/**
 * PDF BENCH — REFERENCE MODE. Real PDFs through the real pipeline, as the app runs them (owner,
 * 2026-10-18: "test reference mode … they don't teach extra if a question is asked, synchronisation,
 * context, coding perspective"):
 *   POST /api/parse-pdf (cached per PDF) → POST /api/plan-lesson "outline" with the document and a
 *   reference sourceScope (whole, or a question as breadth "section" — what LearnPage sends) →
 *   planCanvasLecture → writeCanvasBoard with the document (referenceDocumentOf).
 * Each lecture is checked by code (grounding in the document, its numbers, size of a question's
 * answer, sections and pages covered, code listings copied faithfully, plus every board check of
 * lectureChecks.mts) and, with --judge, by a judge who reads the DOCUMENT and the lecture.
 *
 *   NODE_OPTIONS="--conditions=react-server --require <css stub>" npx tsx --env-file=.env.local \
 *     --tsconfig tsconfig.json scripts/bench/pdf-bench.mts <outDir> --plan plan.json [--judge] [--voice] \
 *     [--maxUsd 3] [--parallel 2] [--only bio-whole,trunk-q1]
 *
 * plan.json: [{"id": "bio", "pdf": "/abs/file.pdf", "pages": "1,2,3" (optional), "profile": "olevel",
 *   "runs": [{"id": "whole"}, {"id": "q1", "question": "…", "expect": "in" | "out"}]}]
 *   "expect": "out" marks a question the document does not answer — the lecture should say so and stay
 *   short rather than teach a new topic.
 * Needs the dev server on :3000. Render the boards afterwards with diagram-lab-render.mts on <outDir>/runs.
 */
import { runIntake, intakeReport, type Student, type IntakeRun } from "./intakeSim.mts";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import path from "node:path";
import { signAccessToken } from "../../lib/auth.ts";
import { planCanvasLecture, writeCanvasBoard, canvasSpecOf } from "../../lib/canvas/progressive.ts";
import { referenceDocumentOf, strictDocumentOf } from "../../lib/canvas/lessonRequest.ts";
import { documentListings } from "../../lib/canvas/documentContext.ts";
import type { CanvasBoardSpec, CanvasPlanBeat } from "../../lib/canvas/types.ts";
import type { ProgressiveLectureInput } from "../../lib/progressiveLectureTypes.ts";
import type { SuprnotesLessonInput } from "../../lib/suprnotes.ts";
import type { SourceScope } from "../../lib/sourceScope.ts";
import { buildStudentCard } from "../../lib/studentCard.ts";
import { canvasSentences } from "../../lib/canvas/plan.ts";
import { createOpenAI } from "../../lib/openaiClient.ts";
import { PROFILES, checkBoard, scorecard, voiceCheck, repeats, type Profile, type BoardReport } from "./lectureChecks.mts";

// "mode": "strict" teaches only from the pages (lib/canvas/sourceLessons.ts); the default is "reference".
// "student": the intake runs first (lib/intake.ts, scripts/bench/intakeSim.mts) and the lesson is built from it.
type Run = { id: string; question?: string; expect?: "in" | "out"; mode?: "reference" | "strict"; student?: Student };
// "doc" instead of "pdf": an already-parsed document (a saved parse, e.g. lib/anim/fixtures/avlCodePages.json) — no parse cost.
type PdfPlan = { id: string; pdf?: string; doc?: string; pages?: string; profile: string; runs: Run[] };

const args = process.argv.slice(2);
const outDir = path.resolve(args[0] ?? "pdf-bench-out");
const opt = (name: string) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const plan: PdfPlan[] = JSON.parse(readFileSync(opt("--plan") ?? path.join(outDir, "plan.json"), "utf8"));
const judge = args.includes("--judge");
const voice = args.includes("--voice");
const maxUsd = Number(opt("--maxUsd") ?? 3);
const PARALLEL = Number(opt("--parallel") ?? 2);
const PER_LECTURE = Number(opt("--perLecture") ?? 0.35);
const only = opt("--only")?.split(",").map((x) => x.trim());
const BASE = process.env.BENCH_BASE ?? "http://localhost:3000";
for (const d of ["runs", "parsed"]) mkdirSync(path.join(outDir, d), { recursive: true });
// A fresh login for every request: an access token lasts 15 minutes.
const freshCookie = async () => `aria_access=${await signAccessToken("pdf-bench", "bench@test.local")}`;
const openai = createOpenAI();
let spent = 0;

/* ── parse (once per PDF, cached) ─────────────────────────────────────────────────────────────── */

type Parsed = { doc: SuprnotesLessonInput; documentId?: string; text: string; pageCount: number; blockCount: number; costUsd: number; warnings: string[] };
async function parsePdf(p: PdfPlan): Promise<Parsed> {
  const cache = path.join(outDir, "parsed", `${p.id}.json`);
  if (existsSync(cache)) return { ...(JSON.parse(readFileSync(cache, "utf8")) as Parsed), costUsd: 0 };
  if (p.doc) {
    const saved = JSON.parse(readFileSync(p.doc, "utf8")) as SuprnotesLessonInput & { sourceDocument?: SuprnotesLessonInput };
    const doc = (saved.sourceDocument ?? saved) as SuprnotesLessonInput;
    // The planner reads a document whole only when it came from a PDF upload.
    doc.source = { ...(doc.source ?? {}), adapter: "pdf-upload" } as SuprnotesLessonInput["source"];
    const blocks = doc.contentBlocks ?? [];
    const pages = new Set(blocks.map((b) => b.pageNumber).filter((n) => typeof n === "number"));
    const parsed: Parsed = { doc, text: blocks.map((b) => [b.heading, b.text, ...(b.items ?? [])].filter(Boolean).join(" ")).join("\n"), pageCount: pages.size, blockCount: blocks.length, costUsd: 0, warnings: [] };
    writeFileSync(cache, JSON.stringify(parsed));
    return parsed;
  }
  if (!p.pdf) throw new Error(`${p.id}: neither "pdf" nor "doc" given`);
  const form = new FormData();
  form.append("file", new Blob([readFileSync(p.pdf)], { type: "application/pdf" }), path.basename(p.pdf));
  if (p.pages) form.append("pages", p.pages);
  const res = await fetch(`${BASE}/api/parse-pdf`, { method: "POST", headers: { cookie: await freshCookie() }, body: form });
  const json = (await res.json()) as Record<string, unknown>;
  if (!res.ok || !json.sourceDocument) throw new Error(`parse-pdf ${res.status}: ${JSON.stringify(json).slice(0, 200)}`);
  const doc = json.sourceDocument as SuprnotesLessonInput;
  const text = typeof json.fullDocumentText === "string" && json.fullDocumentText ? json.fullDocumentText : (doc.contentBlocks ?? []).map((b) => [b.heading, b.text, ...(b.items ?? [])].filter(Boolean).join(" ")).join("\n");
  const parsed: Parsed = { doc, documentId: typeof json.documentId === "string" ? json.documentId : undefined, text, pageCount: Number(json.pageCount ?? 0), blockCount: (doc.contentBlocks ?? []).length, costUsd: Number(json.costUsd ?? 0), warnings: (json.warnings as string[] | undefined) ?? [] };
  writeFileSync(cache, JSON.stringify(parsed));
  return parsed;
}

/* ── outline, as LearnPage asks for it ────────────────────────────────────────────────────────── */

const scopeFor = (run: Run): SourceScope => ({ fidelity: run.mode ?? "reference", breadth: run.question ? { kind: "section", focus: run.question.slice(0, 240) } : { kind: "whole" }, documentLabels: [] });

async function outlineFor(parsed: Parsed, run: Run, p: Profile, learner?: Record<string, unknown>) {
  const topic = String(parsed.doc.lesson?.title ?? "This document").slice(0, 200);
  const res = await fetch(`${BASE}/api/plan-lesson`, {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie: await freshCookie() },
    body: JSON.stringify({ mode: "outline", topic, clarifications: [], angle: "standard", sourceDocument: parsed.doc, sourceScope: scopeFor(run), ...(parsed.documentId ? { documentId: parsed.documentId } : {}), ...(run.question ? { request: run.question } : {}), learnerBasics: p.basics, ...(learner ? { learnerProfile: learner, depth: learner.claimedLevel } : {}) }),
  });
  const lines = (await res.text()).split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean) as Array<Record<string, unknown>>;
  const done = lines.find((l) => l.type === "outline");
  if (!done) throw new Error(`no outline: ${JSON.stringify(lines.find((l) => l.type === "error") ?? lines.slice(-1)).slice(0, 200)}`);
  return { topic: String(done.topic ?? topic), outline: { topic: String(done.topic ?? topic), scope: done.scope as "question" | "lesson" | undefined, subtopics: (done.subtopics as Array<{ title: string; caption: string; reason?: string }>) ?? [] }, costUsd: Number(done.costUsd ?? 0) };
}

/* ── what only a document lecture is checked for ─────────────────────────────────────────────── */

const STOP = new Set("about above after again against because been before being below between both could does doing down during each from further have having here into itself just more most must once only other over same should some such than that their them then there these they this those through under until very were what when where which while will with would your also make makes made uses used using like well want into onto upon them they".split(" "));
const stemsOf = (t: string) => (t.toLowerCase().match(/[a-z][a-z-]{3,}/g) ?? []).filter((w) => !STOP.has(w)).map((w) => w.replace(/(?:ies|es|s|ing|ed)$/, ""));
const numbersOf = (t: string) => (t.match(/\d+(?:[.,]\d+)?/g) ?? []).map((n) => n.replace(/,/g, "")).filter((n) => n.length > 1 || Number(n) > 9);

function documentChecks(parsed: Parsed, beats: CanvasPlanBeat[], specs: CanvasBoardSpec[]) {
  const docStems = new Set(stemsOf(parsed.text));
  const docNumbers = new Set(numbersOf(parsed.text));
  const sentences = beats.filter((b) => b.stage !== "exam").flatMap((b) => canvasSentences(b.script));
  // A sentence is grounded when most of its content words are the document's own.
  const grounding = sentences.map((s) => { const w = stemsOf(s); return { s, share: w.length ? w.filter((x) => docStems.has(x)).length / w.length : 1 }; });
  const grounded = grounding.filter((g) => g.share >= 0.6).length;
  const numbers = sentences.flatMap(numbersOf);
  const headings = [...new Set((parsed.doc.contentBlocks ?? []).map((b) => (b.heading ?? "").trim()).filter((h) => h.length > 3 && h.length < 80))];
  const lectureText = beats.map((b) => `${b.title} ${b.script}`).join(" ");
  const lectureStems = new Set(stemsOf(lectureText));
  const headingsCovered = headings.filter((h) => { const w = stemsOf(h); return w.length > 0 && w.filter((x) => lectureStems.has(x)).length / w.length >= 0.6; });
  const pages = new Set(beats.flatMap((b) => ((b as { source?: { pages?: number[] } }).source?.pages ?? [])));
  // Code: the document's listings, the code boards, and how many of their lines are the document's own.
  const listings = documentListings(parsed.doc);
  const flat = (t: string) => t.replace(/\s+/g, "");
  const docFlat = flat(parsed.text);
  const codeBoards = specs.filter((s) => s.stage.kind === "code").map((s) => { const lines = ((s.stage as { lines?: string[] }).lines ?? []).filter((l) => l.trim()); return { lines: lines.length, faithful: lines.filter((l) => docFlat.includes(flat(l))).length }; });
  return {
    sentences: sentences.length,
    groundedShare: sentences.length ? Math.round((grounded / sentences.length) * 100) : 100,
    outside: grounding.filter((g) => g.share < 0.4).map((g) => g.s).slice(0, 8),
    numbersInDoc: numbers.length ? `${numbers.filter((n) => docNumbers.has(n)).length}/${numbers.length}` : "–",
    headings: headings.length,
    headingsCovered: headingsCovered.length,
    headingsMissed: headings.filter((h) => !headingsCovered.includes(h)).slice(0, 10),
    pagesCited: pages.size,
    pageCount: parsed.pageCount,
    listings: listings.length,
    codeBoards: codeBoards.length,
    codeFaithful: codeBoards.length ? `${codeBoards.reduce((n, c) => n + c.faithful, 0)}/${codeBoards.reduce((n, c) => n + c.lines, 0)}` : "–",
    words: beats.reduce((n, b) => n + b.script.split(/\s+/).filter(Boolean).length, 0),
  };
}

/* ── the judge reads the document ─────────────────────────────────────────────────────────────── */

const PDF_CRITERIA = ["faithfulness", "scopeDiscipline", "coverage", "usesDocumentMaterial", "codeFidelity", "narrationBoardSync", "visualClarity", "levelFit", "overallUsefulness"] as const;
type PdfJudged = { scores: Record<string, number | null>; notes: string; extraContent: string[]; missing: string[]; contradictions: string[]; costUsd: number };

async function judgeLecture(parsed: Parsed, run: Run, p: Profile, beats: CanvasPlanBeat[], specs: CanvasBoardSpec[]): Promise<PdfJudged> {
  const task = run.question
    ? `The student asked about this document: "${run.question}". ${run.expect === "out" ? "The document does NOT really cover this. Reference mode MAY answer from general knowledge — that is allowed — but the right lecture stays concise (a short answer, not a new lecture), says lightly that this goes beyond the student's document, and uses whatever the document does say. Do not mark it down for using outside knowledge itself." : "The right lecture answers exactly this, from the document (explaining beyond it only to make the answer clear), with nothing the question did not ask."}`
    : "The student asked to be taught this whole document. The right lecture covers its main sections in its order, with its own examples, numbers, figures and code.";
  const lesson = beats.map((b, i) => {
    const s = specs[i];
    const st = s.stage as Record<string, unknown> & { kind: string };
    const shows = st.kind === "code" ? `code:\n${((st.lines as string[]) ?? []).join("\n")}` : st.kind === "illustration" ? `picture: ${String(st.subject)}` : st.kind === "figure" ? `figure ${String(st.component)}` : st.kind;
    return `BOARD ${i + 1}: ${b.title}\nSHOWS: ${shows}; notes: ${s.notes.map((n) => n.text).join(" | ")}${s.interaction ? `; card: ${JSON.stringify(s.interaction)}` : ""}\nARIA SAYS: ${b.script}`;
  }).join("\n\n");
  const strictRules = `You audit one lecture an AI tutor taught FROM A STUDENT'S PDF, in "strict" mode: it may teach, draw and label ONLY what the document's pages say — every fact, example, number and term must be on its pages; any outside knowledge is a fault (faithfulness and scopeDiscipline go down for each one), and a question the document does not cover must be met by saying so plainly, with no answer from outside. The student: ${p.label}. ${run.question ? `The student asked: "${run.question}".${run.expect === "out" ? " The document does NOT cover this: the right lecture says so and stops." : " The right lecture answers it from the pages alone."}` : "The student asked to be taught the selected pages: every page, in order, from the pages alone."}`;
  const system = run.mode === "strict" ? `${strictRules}
Score 1-10 (null when it does not apply): faithfulness (nothing beyond or against the document), scopeDiscipline, coverage, usesDocumentMaterial, codeFidelity (null without code), narrationBoardSync, visualClarity, levelFit, overallUsefulness.
Return JSON only: {"scores": {${PDF_CRITERIA.map((c) => `"${c}": number | null`).join(", ")}}, "notes": "the 3 biggest problems, one line each", "extraContent": ["each statement NOT in the document, quoting it"], "missing": ["each page point left out"], "contradictions": ["each statement that contradicts the document"]}.` : `You audit one lecture an AI tutor taught FROM A STUDENT'S PDF, in "reference" mode: the document is the main source — taught in its order, with its own examples — and the tutor MAY add outside knowledge to explain or to answer what the document does not cover, mentioning lightly when it goes beyond the document; it must never contradict the document, never swap its example for another, and never add topics the student did not ask for. The student: ${p.label}. ${task}
Score 1-10 (null when it does not apply): faithfulness (nothing contradicts the document), scopeDiscipline (nothing taught that was not asked; for a whole-document lecture, no detours off the document), coverage (a question answered completely; a whole document's main sections all taught), usesDocumentMaterial (its own examples, numbers, figures and wording), codeFidelity (the document's code shown exactly and explained line by line — null if the document has no code or none was asked), narrationBoardSync, visualClarity (from the description of what each board shows), levelFit (for this student), overallUsefulness.
Return JSON only: {"scores": {${PDF_CRITERIA.map((c) => `"${c}": number | null`).join(", ")}}, "notes": "the 3 biggest problems, one line each", "extraContent": ["each thing taught that was not asked / not in the document, quoting it"], "missing": ["each main point of the document (or of the answer) left out"], "contradictions": ["each statement that contradicts the document, quoting both"]}.`;
  const user = `THE DOCUMENT (${parsed.pageCount} pages):\n${parsed.text.slice(0, 30_000)}\n\n===== THE LECTURE =====\n${lesson.slice(0, 40_000)}`;
  try {
    const res = await openai.chat.completions.create({ model: process.env.BENCH_JUDGE_MODEL ?? "gpt-5.6-luna", response_format: { type: "json_object" }, max_tokens: 16000, messages: [{ role: "system", content: system }, { role: "user", content: user }] } as never);
    const json = JSON.parse((res as { choices: Array<{ message: { content: string } }> }).choices[0].message.content);
    const usage = (res as { usage?: { prompt_tokens: number; completion_tokens: number } }).usage;
    const list = (v: unknown) => (Array.isArray(v) ? v.map(String) : []);
    return { scores: json.scores ?? {}, notes: String(json.notes ?? ""), extraContent: list(json.extraContent), missing: list(json.missing), contradictions: list(json.contradictions), costUsd: usage ? (usage.prompt_tokens * 0.2 + usage.completion_tokens * 1.2) / 1e6 : 0 };
  } catch (e) {
    return { scores: {}, notes: `judge failed: ${(e as Error).message}`, extraContent: [], missing: [], contradictions: [], costUsd: 0 };
  }
}

/* ── one lecture ──────────────────────────────────────────────────────────────────────────────── */

async function runOne(pp: PdfPlan, run: Run) {
  const id = `${pp.id}-${run.id}`;
  const p = PROFILES.find((x) => x.id === pp.profile) ?? PROFILES[1];
  const t0 = Date.now();
  let usd = 0;
  try {
    const parsed = await parsePdf(pp);
    usd += parsed.costUsd;
    // THE INTAKE: the PDF's sections as parts, a scripted student's marks and checks (intakeSim.mts).
    let intake: IntakeRun | null = null;
    if (run.student) {
      const topic = String(parsed.doc.lesson?.title ?? "This document").slice(0, 200);
      intake = await runIntake(BASE, await freshCookie(), { topic, doc: parsed.doc, strict: run.mode === "strict" }, run.student);
      usd += intake.costUsd;
      console.log(`[intake] ${id} (${intake.secs}s, $${intake.costUsd.toFixed(4)})\n${intakeReport(intake)}`);
    }
    // A strict lesson has no outline in the app: it goes from the intake straight to the build.
    const o = intake && run.mode === "strict"
      ? { topic: String(parsed.doc.lesson?.title ?? "This document").slice(0, 200), outline: undefined, costUsd: 0 }
      : await outlineFor(parsed, run, p, intake ? { ...intake.profile } : undefined);
    usd += o.costUsd;
    if (intake && o.outline) console.log(`[outline] ${id}\n${o.outline.subtopics.map((s, i) => `   ${i + 1}. ${s.title} [${(s as { status?: string }).status ?? "no status"}] — ${s.caption}`).join("\n")}`);
    const card = buildStudentCard(p.basics, o.topic, {}, p.support);
    const input: ProgressiveLectureInput = {
      topic: o.topic, mood: "", sourceType: "pdf", mode: "standard", suprnotes: parsed.doc, sourceScope: scopeFor(run), outline: o.outline,
      learnerProfile: p.snapshot, ...(card ? { studentCard: card } : {}), ...(intake ? { learner: intake.profile } : {}), ...(run.question ? { focus: run.question } : {}), ...(parsed.documentId ? { documentId: parsed.documentId } : {}),
    } as ProgressiveLectureInput;
    const document = referenceDocumentOf(input);
    const strictDoc = strictDocumentOf(input);
    const strictSource = strictDoc ? { mode: "strict" as const, doc: strictDoc } : null;
    if (!document && !strictSource) throw new Error("not a reference or strict PDF lecture");
    const canvas = await planCanvasLecture(input);
    usd += canvas.costUsd;
    const beatsPlan = canvas.plan.map((x) => x.canvas).filter((b): b is CanvasPlanBeat => Boolean(b));
    if (intake) console.log(`[plan] ${id} ${beatsPlan.length} board(s)\n${beatsPlan.map((b) => `   ${b.id} ${b.title} (${b.stage}, ${canvasSentences(b.script).length} sentences)`).join("\n")}`);
    const earlier: Array<CanvasBoardSpec | undefined> = beatsPlan.map(() => undefined);
    const specs: CanvasBoardSpec[] = [];
    const logs: string[] = [];
    const boxed: number[] = [];
    for (let i = 0; i < beatsPlan.length; i += 3) {
      const done = await Promise.all(beatsPlan.slice(i, i + 3).map((_, j) => writeCanvasBoard({ userId: "pdf-bench", sessionId: `pdfbench-${Date.now()}-${id}`, topic: input.topic, plan: beatsPlan, index: i + j, earlier, notes: [], document, strictSource })));
      for (const [j, w] of done.entries()) { usd += w.costUsd; const s = canvasSpecOf(w.beat); if (s) { specs[i + j] = s; earlier[i + j] = s; boxed[i + j] = ((w.beat as { sentenceBlockIds?: Array<string | null> }).sentenceBlockIds ?? []).filter(Boolean).length; } logs.push(...((w as { log?: string[] }).log ?? [])); }
    }
    const beats = beatsPlan.filter((_, i) => specs[i]);
    const kept = specs.filter(Boolean);
    const boards: BoardReport[] = beats.map((b, i) => checkBoard(b, kept[i]));
    const voiceRes = voice ? await voiceCheck(beats.filter((b) => b.stage !== "exam").flatMap((b) => canvasSentences(b.script)), BASE, freshCookie) : null;
    if (voiceRes?.ok) usd += 0.003;
    const docCheck = { ...documentChecks(parsed, beats, kept), ...(strictSource ? { boxedSentences: `${beatsPlan.reduce((n, _, i) => n + (specs[i] ? boxed[i] ?? 0 : 0), 0)}/${beats.reduce((n, b) => n + canvasSentences(b.script).length, 0)}` } : {}) };
    const judged = judge ? await judgeLecture(parsed, run, p, beats, kept) : null;
    usd += judged?.costUsd ?? 0;
    spent += usd;
    writeFileSync(path.join(outDir, "runs", `${id}-snapshot.json`), JSON.stringify({ topic: `${run.question ?? "Whole document"} — ${path.basename(pp.pdf ?? pp.doc ?? pp.id)} — ${p.label}`, usd, intake, beats: beats.map((b, i) => ({ title: b.title, plannedStage: b.stage, script: b.script, brief: b.brief, objects: b.objects, draw: { ops: [{ kind: "canvasBoard", spec: kept[i] }] } })) }, null, 1));
    return { id, pdf: path.basename(pp.pdf ?? pp.doc ?? pp.id), profile: p.id, question: run.question ?? null, expect: run.expect ?? (run.question ? "in" : "whole"), scope: o.outline?.scope, outline: (o.outline?.subtopics ?? []).map((s) => s.title), usd: Math.round(usd * 1000) / 1000, secs: Math.round((Date.now() - t0) / 1000), boards, scores: scorecard(boards, card, p, voiceRes), doc: docCheck, judge: judged, pictures: logs.filter((l) => /textbook diagram|picture failed/.test(l)).map((l) => l.slice(0, 200)), pen: logs.filter((l) => /pen cues/.test(l)), repeats: repeats(beats), voice: voiceRes, parseWarnings: parsed.warnings.slice(0, 5) };
  } catch (e) {
    spent += usd;
    return { id, pdf: path.basename(pp.pdf ?? pp.doc ?? pp.id), profile: p.id, question: run.question ?? null, usd, error: (e as Error).message.slice(0, 300) };
  }
}

/* ── run within the budget, reporting each lecture as it lands ────────────────────────────────── */

const jobs = plan.flatMap((pp) => pp.runs.map((run) => ({ pp, run }))).filter((j) => !only || only.includes(`${j.pp.id}-${j.run.id}`));
// A PDF is parsed once before its lectures run in parallel, so two lectures never pay to parse it twice.
for (const pp of [...new Set(jobs.map((j) => j.pp))]) {
  try { const parsed = await parsePdf(pp); spent += parsed.costUsd; console.log(`parsed ${pp.id}: ${parsed.pageCount} page(s), ${parsed.blockCount} block(s), $${parsed.costUsd.toFixed(3)}${parsed.warnings.length ? ` — ${parsed.warnings.slice(0, 2).join("; ")}` : ""}`); }
  catch (e) { console.log(`parse FAILED ${pp.id}: ${(e as Error).message}`); }
}
const results: Array<Awaited<ReturnType<typeof runOne>>> = [];
await new Promise<void>((resolve) => {
  let next = 0, running = 0;
  const launch = () => {
    while (running < PARALLEL && next < jobs.length && spent + (running + 1) * PER_LECTURE <= maxUsd) {
      const job = jobs[next++];
      running++;
      void runOne(job.pp, job.run).then((r) => {
        running--;
        results.push(r);
        writeFileSync(path.join(outDir, "results.json"), JSON.stringify(results, null, 1));
        if ("error" in r && r.error) console.log(`DONE ${results.length}/${jobs.length} ${r.id} ERROR ${r.error} · total $${spent.toFixed(2)}`);
        else if ("boards" in r && r.boards) {
          const js = Object.values(r.judge?.scores ?? {}).map(Number).filter((v) => Number.isFinite(v) && v > 0);
          const mean = js.length ? (js.reduce((a, b) => a + b, 0) / js.length).toFixed(1) : "–";
          const low = Object.entries(r.judge?.scores ?? {}).filter(([, v]) => v !== null && Number(v) < 7).map(([k, v]) => `${k} ${v}`).join(", ");
          console.log(`DONE ${results.length}/${jobs.length} ${r.id} ${r.question ? `"${r.question}"` : "(whole document)"} · ${r.scope ?? "?"} · ${r.boards.length} board(s), ${r.doc.words} words · judge ${mean}${low ? ` (below 7: ${low})` : ""} · grounded ${r.doc.groundedShare}% · numbers from doc ${r.doc.numbersInDoc} · sections ${r.doc.headingsCovered}/${r.doc.headings} · code ${r.doc.codeBoards} board(s), lines faithful ${r.doc.codeFaithful} · sync ${r.scores.narrationSync} · $${r.usd} · ${r.secs}s · total $${spent.toFixed(2)}`);
          if (r.judge?.notes) console.log(`   judge: ${r.judge.notes.replace(/\s*\n\s*/g, " / ")}`);
          if (r.judge?.extraContent.length) console.log(`   extra: ${r.judge.extraContent.slice(0, 3).join(" | ")}`);
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
console.log(`total $${spent.toFixed(3)} · results: ${path.join(outDir, "results.json")}`);

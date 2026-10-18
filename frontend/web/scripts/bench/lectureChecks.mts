/**
 * The checks every lecture bench runs on a generated lecture, board by board (prompt-bench.mts,
 * pdf-bench.mts): the student profiles, what each board shows and how it is timed, the scorecard,
 * the voice heard back, and how much two boards repeat each other. Free — no model calls, except
 * voiceCheck (one TTS sentence and one transcription, about $0.003).
 */
import type { CanvasBoardSpec, CanvasPlanBeat } from "../../lib/canvas/types.ts";
import type { LearnerProfileSnapshot } from "../../lib/progressiveLectureTypes.ts";
import type { LearnerBasics, AccessibilityProfile } from "../../lib/db/cosmos.ts";
import type { LearningPreferences } from "../../lib/learningPreferences.ts";
import { gradeRules, readingGrade, type StudentCard } from "../../lib/studentCard.ts";
import { canvasSentences } from "../../lib/canvas/plan.ts";
import { unshownSentences } from "../../lib/canvas/narrationSync.ts";
import { quizIssues } from "../../lib/canvas/quizLint.ts";
import { auditBoardForRelease } from "../../lib/canvas/releaseAudit.ts";
import { layoutPanel, takeLayoutDrops } from "../../lib/canvas/layout.ts";
import { takeFigureCutItems } from "../../lib/figures/cuts.ts";
import { figureComponent } from "../../lib/figures/registry.ts";
import { labelMatchesPart } from "../../lib/canvas/labelMatch.ts";

export type Profile = { id: string; label: string; basics: LearnerBasics; support: { simplerLanguage?: boolean; slowerPace?: boolean; accessibility?: AccessibilityProfile }; snapshot: LearnerProfileSnapshot };

const prefs = (p: Partial<LearningPreferences>): LearningPreferences => ({ goal: null, helps: [], challenge: null, interests: [], english: null, completedAt: "2026-10-17T00:00:00Z", ...p });
const basics = (level: { id: string; label: string }, country: string, preferences: LearningPreferences, subjects: Array<{ id: string; label: string }> = []): LearnerBasics =>
  ({ country, countrySource: "user", studyLevel: level, subjects, curricula: [], preferences } as unknown as LearnerBasics);
const snap = (s: Partial<LearnerProfileSnapshot>): LearnerProfileSnapshot => ({ expertise: "intermediate", depth: "balanced", goal: "school", codeExamples: false, preferredExamples: "mixed", rationale: "prompt bench", confirmedAt: "2026-10-17T00:00:00Z", ...s });

export const PROFILES: Profile[] = [
  { id: "grade6", label: "Grade 6 · pictures + try-it · gentle · learning English · simpler language",
    basics: basics({ id: "grade-6", label: "Grade 6" }, "US", prefs({ goal: "understand", helps: ["pictures", "try-it"], challenge: "gentle", english: "learning", interests: ["sports", "animals"] })),
    support: { simplerLanguage: true }, snapshot: snap({ expertise: "beginner", depth: "concise", goal: "school", preferredExamples: "visual" }) },
  { id: "olevel", label: "O Level · exams · worked examples + short notes · steady",
    basics: basics({ id: "o-level", label: "O Level" }, "GB", prefs({ goal: "exams", helps: ["worked-examples", "short-notes"], challenge: "steady", english: "first" })),
    support: {}, snapshot: snap({ expertise: "intermediate", depth: "balanced", goal: "exam", preferredExamples: "worked" }) },
  { id: "igcse", label: "IGCSE · exams · worked examples + short notes · steady",
    basics: basics({ id: "igcse", label: "IGCSE" }, "GB", prefs({ goal: "exams", helps: ["worked-examples", "short-notes"], challenge: "steady", english: "first" })),
    support: {}, snapshot: snap({ expertise: "intermediate", depth: "balanced", goal: "exam", preferredExamples: "worked" }) },
  { id: "alevel", label: "A Level · exams · worked examples · stretch",
    basics: basics({ id: "cambridge-a-level", label: "AS & A Level" }, "GB", prefs({ goal: "exams", helps: ["worked-examples"], challenge: "stretch", english: "first" })),
    support: {}, snapshot: snap({ expertise: "advanced", depth: "deep", goal: "exam", preferredExamples: "worked" }) },
  { id: "undergrad", label: "Undergraduate · understand · real-life + pictures · steady",
    basics: basics({ id: "undergrad", label: "Undergraduate" }, "US", prefs({ goal: "understand", helps: ["real-life", "pictures"], challenge: "steady", english: "first", interests: ["technology"] })),
    support: {}, snapshot: snap({ expertise: "intermediate", depth: "balanced", goal: "curiosity", preferredExamples: "real-world" }) },
  { id: "postgrad", label: "Postgraduate · curious · worked examples · stretch",
    basics: basics({ id: "postgrad", label: "Postgraduate" }, "US", prefs({ goal: "curious", helps: ["worked-examples"], challenge: "stretch", english: "first" })),
    support: {}, snapshot: snap({ expertise: "advanced", depth: "deep", goal: "professional", preferredExamples: "mixed" }) },
];


export const TTS_HAZARD = /\\[a-z]+|[_^]{|\*\*|#{2,}|`|\$[^$]+\$|[≤≥≠∑∫√]|\^|\b[a-z]\([a-z0-9+\-*/ ]+\)/g;
export type VoiceResult = { ok: boolean; ms: number; said: string; heard: string };

/** The lecture's hardest sentence to read aloud, spoken by the real /api/tts and heard back by a transcriber. */
export async function voiceCheck(sentences: string[], base: string, cookie: () => Promise<string>): Promise<VoiceResult | null> {
  const said = [...sentences].sort((a, b) => (b.match(TTS_HAZARD)?.length ?? 0) - (a.match(TTS_HAZARD)?.length ?? 0))[0];
  if (!said) return null;
  const t0 = Date.now();
  try {
    const res = await fetch(`${base}/api/tts`, { method: "POST", headers: { "Content-Type": "application/json", cookie: await cookie() }, body: JSON.stringify({ text: said }) });
    const buf = Buffer.from(await res.arrayBuffer());
    const ms = Date.now() - t0;
    if (!res.ok || buf.length < 2000) return { ok: false, ms, said, heard: `tts failed (${res.status})` };
    const { default: OpenAI, toFile } = await import("openai");
    const heard = await new OpenAI().audio.transcriptions.create({ model: "gpt-4o-mini-transcribe", file: await toFile(buf, "said.mp3", { type: "audio/mpeg" }) });
    return { ok: true, ms, said, heard: heard.text };
  } catch (e) { return { ok: false, ms: Date.now() - t0, said, heard: (e as Error).message.slice(0, 120) }; }
}

export type BoardReport = { title: string; stage: string; visualType?: string; noteWords: number; workedExample: boolean; figure?: string; sentences: number; words: number; fk: number; notes: number; unshown: number; revealSteps: number; cues: number; badCues: number; labels: number; wrongLabels: number; cuts: number; drops: number; noteOverlap: boolean; release: string[]; quiz: string[]; interaction?: string; fallback: boolean; ttsHazards: number };

export function checkBoard(beat: CanvasPlanBeat, spec: CanvasBoardSpec): BoardReport {
  const sentences = canvasSentences(beat.script);
  const st = spec.stage as Record<string, unknown> & { kind: string };
  takeFigureCutItems(); takeLayoutDrops();
  const layout = layoutPanel(spec);
  const cuts = takeFigureCutItems().length;
  const drops = takeLayoutDrops().length;
  // Notes drawn on the same spot at the same moment (the overlap the owner saw, 2026-10-17).
  let noteOverlap = false;
  for (let at = 0; at <= sentences.length; at++) {
    const vis = layout.marks.filter((m) => m.type === "note" && m.s <= at && !(m.until !== undefined && at >= m.until)).map((m) => (m.type === "note" ? `${Math.round(m.x)},${Math.round(m.y)}` : ""));
    if (new Set(vis).size !== vis.length) noteOverlap = true;
  }
  const items = layout.marks.filter((m) => m.type !== "heading" && m.type !== "note");
  const revealSteps = new Set(items.map((m) => m.s)).size;
  const cues = spec.cues ?? [];
  // A cue the pen cannot find points at nothing (it may also land on a graph marker).
  const markers = new Set(layout.marks.flatMap((m) => (m.type === "graph" ? (m.spec.markers ?? []).map((k) => k.id) : [])));
  const badCues = cues.filter((c) => c.target && !layout.targets[c.target] && !markers.has(c.target)).length;
  // Labels: a figure's part written with a name that is not that part's own.
  let labels = 0, wrongLabels = 0;
  if (st.kind === "figure" || st.kind === "illustration" || st.kind === "diagram") {
    const parts = (st.parts as Array<{ id: string; name: string }> | undefined) ?? [];
    labels = st.kind === "illustration" ? ((st.labels as string[] | undefined) ?? []).length : parts.length;
    const comp = st.kind === "figure" && typeof st.component === "string" ? figureComponent(st.component) : undefined;
    // A chart or table names its parts by the text it draws ("July Crisis" in a cause-and-consequence
    // chart): a label that is the figure's own drawn text is right by definition.
    const drawnText = JSON.stringify(st.params ?? {}).toLowerCase();
    if (comp) for (const p of parts) { const own = comp.parts.find((q) => q.id === p.id); if (own && !drawnText.includes(p.name.toLowerCase()) && !labelMatchesPart(p.name, own)) wrongLabels++; }
  }
  const words = beat.script.split(/\s+/).filter(Boolean).length;
  // What a voice reads badly: LaTeX, markdown, raw symbols.
  const ttsHazards = (beat.script.match(TTS_HAZARD) ?? []).length;
  return {
    title: beat.title, stage: st.kind, visualType: beat.visualType,
    noteWords: spec.notes.length ? Math.round((spec.notes.reduce((n, x) => n + x.text.split(/\s+/).length, 0) / spec.notes.length) * 10) / 10 : 0,
    workedExample: st.kind === "equation" || /\b(worked example|let'?s (try|work)|suppose|for example,? if)\b/i.test(beat.script) && /\d/.test(beat.script), figure: typeof st.component === "string" ? st.component : undefined,
    sentences: sentences.length, words, fk: readingGrade(beat.script), notes: spec.notes.length,
    unshown: unshownSentences(spec, beat).length, revealSteps, cues: cues.length, badCues, labels, wrongLabels, cuts, drops, noteOverlap,
    release: auditBoardForRelease(spec, beat).map((f) => `${f.gate}: ${f.message}`.slice(0, 160)),
    quiz: spec.interaction ? quizIssues(spec.interaction, `${beat.title} ${beat.script}`) : [],
    interaction: spec.interaction?.kind, fallback: Boolean(spec.visualFallback), ttsHazards,
  };
}

// What a student counts as a visual. A scene is half a visual; equations are THE visual of a maths board.
export const VISUAL = new Set(["figure", "illustration", "graph", "molecule", "atom-map", "structure", "code"]);
export const visualWeight = (b: BoardReport) => (VISUAL.has(b.stage) || (b.stage === "equation" && b.visualType !== "thing") ? 1 : b.stage === "scene" ? 0.5 : 0);
export const BUILT_ELSEWHERE = new Set(["atom-map", "illustration", "molecule"]); // they animate inside, not by marks
export const clamp = (n: number) => Math.max(0, Math.min(10, Math.round(n * 10) / 10));

/** Each perspective as a 0–10 score from the code checks (the judge adds the 11 audit criteria). */
export function scorecard(boards: BoardReport[], card: StudentCard | null, p: Profile, voiceRes: VoiceResult | null) {
  const teaching = boards.filter((b) => b.stage !== "exam");
  const n = Math.max(1, teaching.length);
  const target = card?.readingGrade ?? 9;
  const rules = gradeRules(target);
  const fk = teaching.reduce((s, b) => s + b.fk, 0) / n;
  const longSentences = teaching.reduce((s, b) => s + (b.words / Math.max(1, b.sentences) > rules.sentenceWords ? 1 : 0), 0) / n;
  const helps = p.basics.preferences?.helps ?? [];
  const visualShare = teaching.reduce((s, b) => s + visualWeight(b), 0) / n;
  const checks: Array<[string, boolean]> = helps.map((h) => [h, h === "pictures" ? visualShare >= 0.5
    : h === "worked-examples" ? teaching.some((b) => b.workedExample)
    : h === "real-life" ? true
    : h === "short-notes" ? teaching.every((b) => b.noteWords <= 8)
    : h === "try-it" ? boards.some((b) => b.interaction === "try" || b.interaction === "quiz")
    : true]);
  if (p.support.simplerLanguage || p.support.accessibility === "dyslexia") checks.push(["plain language", fk <= target + 1]);
  return {
    teachingDepth: clamp(10 - Math.abs(teaching.reduce((s, b) => s + b.sentences, 0) / n - 8) * 0.6 - teaching.filter((b) => b.sentences < 4).length * 1.5),
    levelFit: clamp(10 - Math.max(0, fk - (target + 1)) * 1.5 - Math.max(0, target - 3 - fk) * 0.8 - longSentences * 3),
    personalization: clamp(checks.length ? (10 * checks.filter(([, ok]) => ok).length) / checks.length : 10),
    narrationSync: clamp(10 - (teaching.reduce((s, b) => s + b.unshown / Math.max(1, b.sentences), 0) / n) * 10 - boards.filter((b) => b.noteOverlap).length * 3),
    diagrams: clamp(4 + visualShare * 6 - boards.filter((b) => b.fallback).length * 1.5 - boards.filter((b) => b.stage === "diagram").length * 2),
    labels: clamp(10 - boards.reduce((s, b) => s + b.wrongLabels * 2 + Math.max(0, b.labels - 5) + b.cuts * 0.5 + b.drops * 0.5, 0)),
    animation: clamp(10 - teaching.filter((b) => b.revealSteps < 3 && !BUILT_ELSEWHERE.has(b.stage)).length * 2 - boards.reduce((s, b) => s + b.badCues, 0)),
    voice: clamp((voiceRes ? (voiceRes.ok ? 10 : 2) - (voiceRes.ms > 6000 ? 2 : 0) : 10) - boards.reduce((s, b) => s + b.ttsHazards, 0) * 0.5),
    interaction: clamp(boards.some((b) => b.interaction) ? 10 - boards.reduce((s, b) => s + b.quiz.length, 0) * 2 : 6),
    checks: Object.fromEntries(checks),
    readingGrade: Math.round(fk * 10) / 10,
    targetGrade: target,
  };
}


/** The two boards whose narration shares the most content words, and how much (0-1 of the shorter). */
export function repeats(beats: CanvasPlanBeat[]): { a: number; b: number; overlap: number } | null {
  const stems = (t: string) => new Set((t.toLowerCase().match(/[a-z]{5,}/g) ?? []).map((w) => w.replace(/(?:ing|ed|es|s)$/, "")));
  let best: { a: number; b: number; overlap: number } | null = null;
  const sets = beats.map((b) => stems(b.script));
  for (let i = 0; i < sets.length; i++) for (let j = i + 1; j < sets.length; j++) {
    const shared = [...sets[i]].filter((w) => sets[j].has(w)).length / Math.max(1, Math.min(sets[i].size, sets[j].size));
    if (!best || shared > best.overlap) best = { a: i + 1, b: j + 1, overlap: Math.round(shared * 100) / 100 };
  }
  return best;
}


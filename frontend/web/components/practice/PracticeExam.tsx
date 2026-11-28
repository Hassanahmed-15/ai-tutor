"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft } from "lucide-react";
import type { PageName } from "@/components/hud/HudKit";
import { useAuth } from "@/components/auth/AuthGate";
import { setPendingBrief, type PracticeMistake, type PracticeReview } from "@/lib/pendingBrief";
import { ensureSpendTag } from "@/lib/spendTag";
import { FocusQuestion, type FocusOption } from "./FocusQuestion";
import { ExamPaper, type Pages } from "./ExamPaper";
import { ExamResults } from "./ExamResults";
import { Waiting } from "./bits";
import type { Answers, ExamPlan, ExamResult, PlanOptions, Style, StudentQuestion } from "./types";

/**
 * THE PRACTICE EXAM (docs/practice-exam.md), the front page's Practice mode when NEXT_PUBLIC_PRACTICE_EXAM=on.
 * Plan (4 questions, drawn like typed-prompt planning) → Aria writes the test → the student answers it, photographs
 * the paper answers → Aria marks it → results, and "Explain my mistakes" hands a lecture brief to LearnPage.
 */

/** On when the build has NEXT_PUBLIC_PRACTICE_EXAM=on. In development, `localStorage["aria.practiceExam"] = "on"` also turns it on, so it can be tried without restarting the dev server. */
export function practiceExamOn(): boolean {
  if (process.env.NEXT_PUBLIC_PRACTICE_EXAM === "on") return true;
  if (process.env.NODE_ENV === "production" || typeof window === "undefined") return false;
  try { return window.localStorage.getItem("aria.practiceExam") === "on"; } catch { return false; }
}

type StepId = "level" | "topics" | "count" | "difficulty" | "styles" | "time";
const ORDER: StepId[] = ["level", "topics", "count", "difficulty", "styles", "time"];
/** Which of the four dashes each step belongs to: questions 3 and 4 are asked in two parts. */
const DASH: Record<StepId, number> = { level: 0, topics: 1, count: 2, difficulty: 2, styles: 3, time: 3 };
const EVERYTHING = "Everything";
/** School classes, for students not studying for one exam board (owner 2026-11-27: "class 1-5 or 5 onwards"). lib/practice/generate.ts WRITER has their rules. */
const CLASS_LEVELS: FocusOption[] = [
  { label: "Class 1–5 (primary school)", hint: "Simple questions for young children" },
  { label: "Class 6 and above (secondary school)", hint: "School-test questions, not one exam board" },
];
/** A level name shown on a card: Latin letters, digits and ordinary punctuation (the model once added "旧"). */
const cleanLevel = (l: string) => l.replace(/[^\p{Script=Latin}\p{N}\s&()/.,+'’:\-–—·]/gu, "").replace(/\(\s+/g, "(").replace(/\s+\)/g, ")").replace(/\(\)/g, "").replace(/\s+/g, " ").trim();
const STYLE_LABEL: Record<Style, string> = { mcq: "Multiple choice", short: "Short answers", worked: "Long worked questions" };
const STYLE_HINT: Record<Style, string> = { mcq: "Pick A, B, C or D", short: "A word, a number or a sentence, typed", worked: "Full working on paper, then a photo" };
const DIFFICULTY: FocusOption[] = [
  { label: "Mostly easy", hint: "Warm up: mostly straightforward questions" },
  { label: "Balanced", hint: "Easy, medium and hard, like a real paper" },
  { label: "Exam-hard", hint: "Mostly the questions that separate the top grades" },
];
const SHARES: Record<string, [number, number, number]> = { "Mostly easy": [0.6, 0.3, 0.1], Balanced: [0.3, 0.4, 0.3], "Exam-hard": [0.15, 0.35, 0.5] };
const TIMED = /^Timed like the exam/;
const BOARD = /\b(IGCSE|GCSE|O Level|A Level|AS Level|AP|IB|SAT|ACT|Cambridge|Edexcel|AQA|OCR|WJEC|CBSE|ICSE|Matric|FSc|HSSC|SSC|MCAT|USMLE)\b/i;

type Phase = "plan" | "summary" | "writing" | "test" | "marking" | "results" | "error";
type Exam = { examId: string; questions: StudentQuestion[]; minutes: number | null };

const post = async <T,>(url: string, body: unknown): Promise<T> => {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(data.error || (res.status === 404 ? "Practice tests aren't switched on here yet." : "Something went wrong. Please try again."));
  return data;
};

function countOf(labels: string[] | undefined): number {
  const n = Number.parseInt(String(labels?.[0] ?? ""), 10);
  return Number.isFinite(n) ? Math.max(3, Math.min(15, n)) : 8;
}

function mixOf(count: number, label: string | undefined): ExamPlan["mix"] {
  const share = SHARES[label ?? ""] ?? SHARES.Balanced;
  const easy = Math.round(count * share[0]);
  const hard = Math.round(count * share[2]);
  return { easy, medium: Math.max(0, count - easy - hard), hard };
}

/**
 * A PRACTICE SHEET (2026-11-27): the test made from a lecture or course lesson (lib/practice/source.ts). It opens on the
 * summary with its plan already chosen (6 questions, balanced, every style, untimed) — the student can still edit any
 * row — and its questions are written from `plan.source`. `subtopics` are the lecture's board titles.
 */
export type PracticePreset = { plan: ExamPlan; subtopics?: string[] };

function presetAnswers(plan: ExamPlan): Partial<Record<StepId, string[]>> {
  return {
    level: [plan.level],
    topics: plan.subtopics.length ? plan.subtopics : [EVERYTHING],
    count: [`${plan.count} questions`],
    difficulty: ["Balanced"],
    styles: plan.styles.map((st) => STYLE_LABEL[st]),
    time: [plan.minutes ? `${plan.minutes}` : "Untimed"],
  };
}

export function PracticeExam({ topic, go, onDone, preset, onReview }: {
  topic: string;
  go: (p: PageName) => void;
  onDone: () => void;
  preset?: PracticePreset;
  /** Where "Explain my mistakes" goes when the caller teaches it itself (LearnPage); else a brief to the learn page. */
  onReview?: (topic: string, review: PracticeReview) => void;
}) {
  const { profile } = useAuth();
  const studyLevel = profile?.learner?.studyLevel?.label?.trim() || "";
  const [phase, setPhase] = useState<Phase>(preset ? "summary" : "plan");
  const [options, setOptions] = useState<PlanOptions | null>(() => preset ? { subtopics: preset.subtopics ?? [], levels: [preset.plan.level], suggestion: { count: preset.plan.count, mix: preset.plan.mix, styles: preset.plan.styles, minutes: null } } : null);
  const [optionsNote, setOptionsNote] = useState<string | null>(null);
  const [step, setStep] = useState<StepId>("level");
  /** Set while changing one answer from the summary: after its question (both parts) the summary comes back. */
  const [editing, setEditing] = useState(false);
  const [answers, setAnswers] = useState<Partial<Record<StepId, string[]>>>(() => (preset ? presetAnswers(preset.plan) : {}));
  const [extraTopics, setExtraTopics] = useState<string[]>([]);
  const [exam, setExam] = useState<Exam | null>(null);
  const [plan, setPlan] = useState<ExamPlan | null>(null);
  const [result, setResult] = useState<ExamResult | null>(null);
  const [error, setError] = useState<{ text: string; back: Phase } | null>(null);
  /** How many fewer questions than asked passed Aria's checks (said on the paper, never hidden). */
  const [shortBy, setShortBy] = useState(0);
  const advanceTimer = useRef<number | null>(null);

  // The planning options: subtopics and likely exams for this topic, one cheap call.
  const asked = useRef(false);
  useEffect(() => {
    if (asked.current) return;
    asked.current = true;
    ensureSpendTag();
    // A practice sheet already knows its parts and exam: no planning call.
    if (preset) return;
    post<PlanOptions>("/api/practice/plan-options", { topic, ...(studyLevel ? { level: studyLevel } : {}) })
      .then((o) => {
        setOptions(o);
        setAnswers((a) => ({ ...a, styles: a.styles ?? (o.suggestion?.styles?.length ? o.suggestion.styles.map((s) => STYLE_LABEL[s]) : undefined) }));
      })
      .catch((e: Error) => {
        setOptions({ subtopics: [], levels: [], suggestion: { count: 8, mix: { easy: 3, medium: 3, hard: 2 }, styles: ["mcq", "short", "worked"], minutes: null } });
        setOptionsNote(`${e.message} You can still type your own answers.`);
      });
  }, [topic, studyLevel, preset]);
  useEffect(() => () => { if (advanceTimer.current) window.clearTimeout(advanceTimer.current); }, []);

  const count = countOf(answers.count);
  /** The exam's time for this many questions: the suggestion's minutes scaled to the count, else 3 minutes a question. */
  const examMinutes = useMemo(() => {
    const s = options?.suggestion;
    if (s?.minutes && s.count) return Math.max(5, Math.round((s.minutes * count) / s.count / 5) * 5);
    return Math.max(10, Math.round((count * 3) / 5) * 5);
  }, [options, count]);
  const timedLabel = `Timed like the exam (${examMinutes} min)`;

  const stepOptions = (id: StepId): FocusOption[] => {
    if (id === "level") {
      const seen = new Set<string>();
      const list = [studyLevel, ...(options?.levels ?? []).map(cleanLevel)].filter((l) => {
        const k = l.trim().toLowerCase();
        if (!k || seen.has(k)) return false;
        seen.add(k);
        return true;
      });
      // Up to 5 exams (the profile's level first), then the two school classes.
      const exams = list.slice(0, 5).map((label) => ({ label, hint: label === studyLevel ? "From your profile" : undefined }));
      return [...exams, ...CLASS_LEVELS.filter((c) => !seen.has(c.label.toLowerCase()))];
    }
    if (id === "topics") {
      const subs = [...extraTopics, ...(options?.subtopics ?? [])].filter((s, i, all) => all.findIndex((x) => x.toLowerCase() === s.toLowerCase()) === i);
      return [{ label: EVERYTHING, hint: `All of ${topic}` }, ...subs.map((label) => ({ label, hint: extraTopics.includes(label) ? "You missed marks here" : undefined }))];
    }
    if (id === "count") return (preset ? [5, 6, 8, 10] : [5, 8, 10]).map((n) => ({ label: `${n} questions`, hint: n === options?.suggestion?.count ? "Aria suggests this" : undefined }));
    if (id === "difficulty") return DIFFICULTY;
    if (id === "styles") return (Object.keys(STYLE_LABEL) as Style[]).map((s) => ({ label: STYLE_LABEL[s], hint: STYLE_HINT[s] }));
    return [{ label: "Untimed", hint: "Take as long as you need" }, { label: timedLabel, hint: "A countdown, as in the exam room" }];
  };

  const QUESTION: Record<StepId, string> = {
    level: "Which exam or level is this for?",
    topics: `Which parts of ${topic} should the test cover?`,
    count: "How many questions?",
    difficulty: "And how hard?",
    styles: "Which kinds of question?",
    time: "Timed, or at your own pace?",
  };

  function onward(from: StepId) {
    const i = ORDER.indexOf(from);
    const nextStep = ORDER[i + 1];
    // Editing from the summary: back to it once both parts of that question are answered.
    if (!nextStep || (editing && DASH[nextStep] !== DASH[from])) { setEditing(false); setPhase("summary"); return; }
    setStep(nextStep);
  }
  function pick(id: StepId, labels: string[], multi: boolean) {
    setAnswers((a) => ({ ...a, [id]: labels }));
    if (!multi && labels.length) {
      if (advanceTimer.current) window.clearTimeout(advanceTimer.current);
      advanceTimer.current = window.setTimeout(() => onward(id), 160);
    }
  }
  function back() {
    const i = ORDER.indexOf(step);
    if (i > 0) setStep(ORDER[i - 1]);
  }
  function edit(id: StepId) {
    setEditing(true);
    setStep(id);
    setPhase("plan");
  }

  function buildPlan(): ExamPlan {
    const level = answers.level?.[0] || studyLevel || "General";
    const topics = (answers.topics ?? []).filter((t) => t !== EVERYTHING);
    const styleLabels = answers.styles ?? [];
    const styles = (Object.keys(STYLE_LABEL) as Style[]).filter((s) => styleLabels.includes(STYLE_LABEL[s]));
    const time = answers.time?.[0] ?? "Untimed";
    // "Timed like the exam (N min)" follows the count: picked at 8 questions, it still means the exam's time at 6.
    const typedMinutes = TIMED.test(time) ? examMinutes : time === "Untimed" ? null : Number.parseInt(time, 10);
    return {
      topic,
      level,
      ...(preset?.plan.board && level === preset.plan.level ? { board: preset.plan.board } : BOARD.test(level) ? { board: level } : {}),
      subtopics: topics,
      count,
      mix: mixOf(count, answers.difficulty?.[0]),
      styles: styles.length ? styles : ["mcq", "short", "worked"],
      minutes: typedMinutes && Number.isFinite(typedMinutes) ? Math.max(5, Math.min(180, typedMinutes)) : null,
      ...(preset?.plan.source ? { source: preset.plan.source } : {}),
    };
  }

  async function start() {
    const p = buildPlan();
    setPlan(p);
    setPhase("writing");
    try {
      const made = await post<Exam>("/api/practice/exam", { plan: p });
      if (!made.questions?.length) throw new Error("Aria couldn't write a test on this. Try another topic or fewer questions.");
      setExam({ ...made, questions: [...made.questions].sort((a, b) => a.n - b.n), minutes: made.minutes ?? p.minutes });
      setShortBy(Math.max(0, p.count - made.questions.length));
      setPhase("test");
    } catch (e) {
      setError({ text: (e as Error).message, back: "summary" });
      setPhase("error");
    }
  }

  async function submit(given: Answers, pages: Pages | null) {
    if (!exam) return;
    setPhase("marking");
    try {
      const marked = await post<ExamResult>(`/api/practice/exam/${encodeURIComponent(exam.examId)}/grade`, { answers: given, ...(pages?.documentId ? { documentId: pages.documentId } : {}), ...(pages?.images?.length ? { images: pages.images } : {}) });
      setResult(marked);
      setPhase("results");
      window.scrollTo({ top: 0 });
    } catch (e) {
      setError({ text: (e as Error).message, back: "test" });
      setPhase("error");
    }
  }

  function explainMistakes() {
    if (!exam || !result) return;
    const byId = new Map(exam.questions.map((q) => [q.id, q]));
    const mistakes: PracticeMistake[] = result.mistakes.flatMap((r) => {
      const q = byId.get(r.id);
      if (!q) return [];
      const stem = [q.stem, ...q.parts.map((p) => `${p.label} ${p.text}`)].join("\n").trim();
      return [{ n: q.n, stem, studentAnswer: r.studentAnswer, feedback: r.feedback, ...(r.firstError ? { firstError: r.firstError } : {}), correctWorking: r.correctWorking, subtopic: q.subtopic }];
    }).sort((a, b) => a.n - b.n);
    const review: PracticeReview = { title: `Your mistakes: ${topic}`, mistakes };
    if (onReview) {
      window.dispatchEvent(new CustomEvent("aria:practice-review", { detail: { topic, review } }));
      onReview(topic, review);
      return;
    }
    setPendingBrief({ topic, file: null, review });
    // Test seam (free): the UI probe listens for this to check the hand-off without building a lecture.
    window.dispatchEvent(new CustomEvent("aria:practice-review", { detail: { topic, review } }));
    go("learn");
  }

  function retryMissed() {
    if (!exam || !result) return;
    const byId = new Map(exam.questions.map((q) => [q.id, q]));
    const missed = [...new Set(result.mistakes.map((r) => byId.get(r.id)?.subtopic).filter((s): s is string => Boolean(s)))];
    setExtraTopics(missed);
    setAnswers((a) => ({ ...a, topics: missed.length ? missed : [EVERYTHING] }));
    setExam(null);
    setResult(null);
    setEditing(true);
    setStep("topics");
    setPhase("plan");
    window.scrollTo({ top: 0 });
  }

  // ── The screens ────────────────────────────────────────────────────────────────────────────────
  if (phase === "plan") {
    if (!options) {
      return (
        <main className="hud-canvas hud-grain min-h-screen px-4 sm:px-6" data-practice-phase="plan">
          <div className="mx-auto flex min-h-[calc(100vh-8rem)] w-full max-w-2xl flex-col justify-center py-10">
            <div className="mb-8 flex items-center gap-3">
              <div className="flex items-center gap-1.5" aria-hidden>
                {ORDER.map((_, i) => <span key={i} className={`h-1.5 rounded-full ${i === 0 ? "w-10 bg-[var(--hud-cyan)]/70" : "w-6 bg-[var(--hud-surface-2)]"}`} />)}
              </div>
              <span className="truncate font-[family-name:var(--font-hud-mono)] text-[0.6875rem] uppercase tracking-[0.1em] text-[var(--hud-text-faint)]">Practice test · {topic}</span>
            </div>
            <div className="flex items-center gap-3 py-8 text-[var(--hud-text-dim)]" role="status">
              <span className="aria-breathe size-2.5 rounded-full bg-[var(--hud-cyan)]" />
              <span className="font-display text-[1.6rem] italic">Thinking…</span>
            </div>
          </div>
        </main>
      );
    }
    const multi = step === "topics" || step === "styles";
    return (
      <main className="hud-canvas hud-grain min-h-screen px-4 sm:px-6" data-practice-phase="plan" data-step={step}>
        <FocusQuestion
          key={step}
          topic={topic}
          // One dash per step (six), so the bar fills as the student goes, not two steps early.
          dashes={ORDER.length}
          at={ORDER.indexOf(step)}
          question={QUESTION[step]}
          remark={step === "level" ? optionsNote ?? undefined : step === "topics" && extraTopics.length ? "The parts you missed marks on are ticked. Add or remove any." : undefined}
          options={stepOptions(step)}
          picked={(answers[step] ?? []).map((l) => (step === "time" && TIMED.test(l) ? timedLabel : l))}
          multi={multi}
          exclusive={step === "topics" ? EVERYTHING : undefined}
          otherPlaceholder={step === "level" ? "Type your exam, e.g. Cambridge 0620" : step === "topics" ? "Type a part of the topic" : step === "count" ? "Type a number from 3 to 15" : step === "time" ? "Type the minutes, e.g. 30" : "Type your own answer"}
          otherInput={step === "count" || step === "time" ? "number" : "text"}
          onPick={(labels) => pick(step, labels, multi)}
          onContinue={multi ? () => onward(step) : undefined}
          onBack={step !== "level" ? back : undefined}
          onExit={onDone}
        />
      </main>
    );
  }

  if (phase === "summary") {
    const p = buildPlan();
    const rows: Array<{ id: StepId | null; label: string; value: string }> = [
      ...(p.source ? [{ id: null, label: p.source.kind === "course" ? "From your course lesson" : "From your lecture", value: p.source.title }] : []),
      { id: "level", label: "Exam and level", value: p.level },
      { id: "topics", label: "Topics", value: p.subtopics.length ? p.subtopics.join(", ") : `All of ${topic}` },
      { id: "count", label: "Questions", value: `${p.count} questions · ${answers.difficulty?.[0] ?? "Balanced"} (${p.mix.easy} easy, ${p.mix.medium} medium, ${p.mix.hard} hard)` },
      { id: "styles", label: "Style and time", value: `${p.styles.map((s) => STYLE_LABEL[s].toLowerCase()).join(", ")} · ${p.minutes ? `${p.minutes} minutes` : "untimed"}` },
    ];
    return (
      <main className="hud-canvas hud-grain min-h-screen px-4 sm:px-6" data-practice-phase="summary">
        <div className="mx-auto flex min-h-[calc(100vh-8rem)] w-full max-w-2xl flex-col justify-center py-10">
          <div className="mb-8 flex items-center gap-3">
            <div className="flex items-center gap-1.5" aria-label="Every step answered">
              {ORDER.map((_, i) => <span key={i} className="h-1.5 w-6 rounded-full bg-[var(--hud-cyan)]" />)}
            </div>
            <span className="truncate font-[family-name:var(--font-hud-mono)] text-[0.6875rem] uppercase tracking-[0.1em] text-[var(--hud-text-faint)]">{preset ? "Practice sheet" : "Practice test"} · {topic}</span>
          </div>
          <h2 className="beat-fade-in font-display text-balance text-[2.1rem] leading-[1.1] tracking-[-0.01em] text-[var(--hud-text)] sm:text-[2.7rem]">{preset ? "Your practice sheet" : "Your test"}</h2>
          {preset && <p className="beat-fade-in mt-3 text-[1rem] leading-relaxed text-[var(--hud-text-dim)]">Exam-style questions on what you just learned: easy, medium and hard. Answer the long ones on paper, then scan your pages with your phone and Aria marks them.</p>}
          <section className="beat-fade-in mt-8 overflow-hidden rounded-[14px] border border-[var(--hud-line)] bg-[var(--hud-surface)]" aria-label="Test plan">
            <dl className="divide-y divide-[var(--hud-line)]">
              {rows.map((r) => (
                <div key={r.label} className="flex items-start gap-4 px-4 py-3.5">
                  <div className="min-w-0 flex-1">
                    <dt className="font-[family-name:var(--font-hud-mono)] text-[0.6875rem] uppercase tracking-[0.1em] text-[var(--hud-text-faint)]">{r.label}</dt>
                    <dd className="mt-0.5 text-[1rem] font-medium text-[var(--hud-text)]">{r.value}</dd>
                  </div>
                  {r.id && (
                    <button type="button" onClick={() => edit(r.id as StepId)} aria-label={`Edit ${r.label.toLowerCase()}`} className="shrink-0 rounded-full px-3 py-1.5 text-[0.8125rem] font-medium text-[var(--hud-cyan)] transition hover:bg-[var(--hud-surface-2)]">
                      Edit
                    </button>
                  )}
                </div>
              ))}
            </dl>
          </section>
          <div className="mt-8 flex flex-wrap items-center justify-between gap-3">
            <button type="button" onClick={() => { if (preset) { onDone(); return; } setStep("time"); setPhase("plan"); }} className="flex items-center gap-1 rounded-full px-3 py-2 text-[0.8125rem] font-medium text-[var(--hud-text-dim)] transition hover:bg-[var(--hud-surface-2)] hover:text-[var(--hud-text)]">
              <ChevronLeft size={15} aria-hidden /> Back
            </button>
            <button type="button" onClick={() => void start()} className="hud-btn-primary rounded-full px-7 py-3 text-[0.95rem] font-semibold" data-start-test="">
              Start test
            </button>
          </div>
        </div>
      </main>
    );
  }

  if (phase === "writing") return <Waiting line="Aria is writing your test…" note="She checks every answer twice, so this takes about a minute." slowAfterMs={60_000} />;

  if (phase === "results" && exam && result) {
    return <ExamResults topic={topic} questions={exam.questions} result={result} onExplain={explainMistakes} onRetry={retryMissed} onExit={onDone} />;
  }

  // The paper stays mounted (hidden) while it is marked, so a failed marking goes back to it with every answer kept.
  const keepPaper = Boolean(exam && plan) && (phase === "test" || phase === "marking" || (phase === "error" && error?.back === "test"));
  const paper = keepPaper && exam && plan ? (
    <div hidden={phase !== "test"}>
      {shortBy > 0 && (
        <p className="mx-auto mt-4 max-w-3xl rounded-[12px] border border-[var(--hud-line)] bg-[var(--hud-surface)] px-4 py-2.5 text-[0.875rem] text-[var(--hud-text-dim)]" role="status" data-practice-short="">
          {exam?.questions.length} questions instead of {plan?.count}: {shortBy === 1 ? "one" : shortBy} didn&apos;t pass Aria&apos;s answer check, so she left {shortBy === 1 ? "it" : "them"} out rather than give you a wrong one.
        </p>
      )}
      <ExamPaper plan={plan} questions={exam.questions} minutes={exam.minutes} onSubmit={(a, p) => void submit(a, p)} onExit={onDone} />
    </div>
  ) : null;
  if (phase === "test") return paper;
  if (phase === "marking") return <>{paper}<Waiting line="Aria is marking your answers…" note="Step by step, against the mark scheme." slowAfterMs={60_000} slowNote="This is taking longer than usual. Reading handwriting can take a while, so hold on a little longer." /></>;

  return (
    <>
    {paper}
    <main className="hud-canvas hud-grain flex min-h-screen items-center justify-center px-4 sm:px-6" data-practice-phase="error">
      <div className="w-full max-w-2xl">
        <h2 className="font-display text-[1.9rem] leading-tight text-[var(--hud-text)]">That didn&apos;t work</h2>
        <p role="alert" className="mt-3 text-[1rem] text-[var(--hud-text-dim)]">{error?.text ?? "Something went wrong."}</p>
        <div className="mt-8 flex flex-wrap gap-3">
          <button type="button" onClick={() => { if (error?.back === "test" && exam) setPhase("test"); else void start(); }} className="hud-btn-primary rounded-full px-6 py-2.5 text-[0.9rem] font-semibold" data-practice-retry="">
            {error?.back === "test" ? "Back to the test" : "Try again"}
          </button>
          {error?.back === "summary" && (
            <button type="button" onClick={() => setPhase("summary")} className="rounded-full border border-[var(--hud-line)] px-6 py-2.5 text-[0.9rem] font-medium text-[var(--hud-text)]">Change the plan</button>
          )}
          <button type="button" onClick={onDone} className="rounded-full border border-[var(--hud-line)] px-6 py-2.5 text-[0.9rem] font-medium text-[var(--hud-text)]">Back to home</button>
        </div>
      </div>
    </main>
    </>
  );
}

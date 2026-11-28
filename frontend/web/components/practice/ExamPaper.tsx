"use client";

import { useEffect, useRef, useState } from "react";
import { Check, ChevronLeft, Clock, ImageUp, Loader2, PenLine, Smartphone, TriangleAlert } from "lucide-react";
import { PhoneCapturePanel } from "@/components/upload/PhoneCapturePanel";
import type { CapturedDocument } from "@/lib/pendingBrief";
import { DifficultyTag, EXACT, ExamMath } from "./bits";
import { uploadPhotos, type UploadProgress } from "./uploadPhotos";
import type { Answers, ExamPlan, StudentQuestion } from "./types";

/**
 * THE TEST PAPER: numbered questions, marks in brackets on the right, a difficulty tag on each, maths in KaTeX and a
 * timer when the test is timed. Multiple choice and short answers are answered here; worked questions on paper,
 * photographed with the phone scanner or uploaded from the computer before "Submit for marking".
 */
/** Paper answers: phone-scanned pages live on the server (`documentId`); computer photos travel as `images`. */
export type Pages = { documentId?: string; images?: string[]; pageCount: number; via: "phone" | "upload" };

const LETTERS = ["A", "B", "C", "D"] as const;

function clock(seconds: number): string {
  const s = Math.max(0, seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** What a short answer's parts become as one text: "(a) … (b) …" when it has parts. */
function joinParts(q: StudentQuestion, byPart: Record<string, string>): string {
  if (!q.parts.length) return (byPart[""] ?? "").trim();
  return q.parts.map((p) => ((byPart[p.label] ?? "").trim() ? `${p.label} ${(byPart[p.label] ?? "").trim()}` : "")).filter(Boolean).join("\n");
}

export function ExamPaper({
  plan,
  questions,
  minutes,
  onSubmit,
  onExit,
}: {
  plan: ExamPlan;
  questions: StudentQuestion[];
  minutes: number | null;
  onSubmit: (answers: Answers, pages: Pages | null) => void;
  onExit: () => void;
}) {
  const [choices, setChoices] = useState<Record<string, string>>({});
  const [texts, setTexts] = useState<Record<string, Record<string, string>>>({});
  const [pages, setPages] = useState<Pages | null>(null);
  const [scanOpen, setScanOpen] = useState(false);
  const [upload, setUpload] = useState<UploadProgress | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [confirmNoPages, setConfirmNoPages] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const [left, setLeft] = useState(minutes ? minutes * 60 : 0);
  useEffect(() => {
    if (!minutes) return;
    const ends = Date.now() + minutes * 60_000;
    const t = window.setInterval(() => setLeft(Math.round((ends - Date.now()) / 1000)), 1000);
    return () => window.clearInterval(t);
  }, [minutes]);

  const totalMarks = questions.reduce((s, q) => s + q.marks, 0);
  const paper = questions.filter((q) => q.answerOn === "paper");
  const onScreen = questions.filter((q) => q.answerOn !== "paper");
  const answeredOnScreen = onScreen.filter((q) => (q.style === "mcq" ? Boolean(choices[q.id]) : joinParts(q, texts[q.id] ?? {}).length > 0)).length;

  function answers(): Answers {
    const out: Answers = {};
    for (const q of onScreen) {
      if (q.style === "mcq") { if (choices[q.id]) out[q.id] = { choice: choices[q.id] }; continue; }
      const text = joinParts(q, texts[q.id] ?? {});
      if (text) out[q.id] = { text };
    }
    return out;
  }
  function submit() {
    if (paper.length && !pages && !confirmNoPages) { setConfirmNoPages(true); return; }
    onSubmit(answers(), pages);
  }
  async function uploadChosen(files: File[]) {
    if (!files.length) return;
    setUploadError(null);
    setUpload({ stage: "sending", done: 0, of: Math.min(files.length, 6) });
    try {
      const got = await uploadPhotos(files, setUpload);
      setPages({ ...got, via: "upload" });
      setConfirmNoPages(false);
    } catch (e) {
      setUploadError((e as Error).message);
    } finally {
      setUpload(null);
    }
  }
  function scanned(doc: CapturedDocument) {
    setScanOpen(false);
    if (!doc.documentId) { setUploadError("The scanned pages could not be kept. Please scan them again."); return; }
    setPages({ documentId: doc.documentId, pageCount: Number(doc.pageCount ?? 0) || 1, via: "phone" });
    setConfirmNoPages(false);
    setUploadError(null);
  }

  const uploading = upload !== null;
  const progressLine = upload
    ? upload.stage === "sending" ? `Preparing photo ${Math.min(upload.done + 1, upload.of)} of ${upload.of}…`
      : upload.stage === "reading" ? `Reading your pages (${upload.done} of ${upload.of})…`
      : "Getting your photos ready…"
    : null;

  return (
    <main className="hud-canvas hud-grain min-h-screen px-4 pb-48 pt-4 sm:px-6 sm:pb-36" data-practice-phase="test" style={EXACT}>
      {/* The top line: back, and the timer when the test is timed. */}
      <div className="sticky top-0 z-20 -mx-4 mb-4 bg-[var(--hud-bg)]/90 px-4 py-2 backdrop-blur sm:-mx-6 sm:px-6">
        <div className="mx-auto flex w-full max-w-3xl items-center justify-between gap-3">
        <button type="button" onClick={onExit} className="flex items-center gap-1 rounded-full px-2 py-1.5 text-[0.8125rem] font-medium text-[var(--hud-text-dim)] transition hover:bg-[var(--hud-surface-2)] hover:text-[var(--hud-text)]">
          <ChevronLeft size={15} aria-hidden /> Leave test
        </button>
        {minutes ? (
          <span
            role="timer"
            aria-label={left > 0 ? `Time left ${clock(left)}` : "Time is up"}
            className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 font-[family-name:var(--font-hud-mono)] text-[0.875rem] tabular-nums ${
              left <= 0 ? "border-[var(--danger)] text-[var(--danger)]" : left <= 300 ? "border-[var(--warning)] text-[var(--warning)]" : "border-[var(--hud-line)] text-[var(--hud-text)]"
            }`}
          >
            <Clock size={14} aria-hidden /> {left > 0 ? clock(left) : "Time is up"}
          </span>
        ) : (
          <span className="text-[0.8125rem] text-[var(--hud-text-faint)]">Untimed</span>
        )}
        </div>
      </div>

      <article className="mx-auto w-full max-w-3xl rounded-[var(--radius-lg)] border border-[var(--hud-line)] bg-[var(--hud-surface)] shadow-[var(--elev-2)]" aria-label="Test paper">
        <header className="border-b border-[var(--hud-line)] px-5 py-6 sm:px-10 sm:py-8">
          <p className="font-[family-name:var(--font-hud-mono)] text-[0.6875rem] uppercase tracking-[0.12em] text-[var(--hud-text-faint)]">Practice test{plan.board && plan.board !== plan.level ? ` · ${plan.board}` : ""} · {plan.level}</p>
          <h1 className="mt-2 font-display text-[1.9rem] leading-[1.1] tracking-[-0.01em] text-[var(--hud-text)] sm:text-[2.3rem]">{plan.topic}</h1>
          <p className="mt-3 text-[0.9rem] text-[var(--hud-text-dim)]">
            {questions.length} questions · {totalMarks} marks{minutes ? ` · ${minutes} minutes` : ""}. Answer all the questions.
            {paper.length > 0 && ` Answer ${paper.length === 1 ? "question" : "questions"} ${paper.map((q) => q.n).join(", ")} on paper and show your working.`}
          </p>
        </header>

        <ol className="divide-y divide-[var(--hud-line)]">
          {questions.map((q) => (
            <li key={q.id} className="px-5 py-6 sm:px-10 sm:py-7" data-question={q.n}>
              <div className="flex gap-3 sm:gap-5">
                <span className="w-6 shrink-0 font-display text-[1.25rem] font-semibold leading-[1.5rem] text-[var(--hud-text)] sm:w-8">{q.n}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <DifficultyTag level={q.difficulty} />
                      <span className="text-[0.75rem] text-[var(--hud-text-faint)]">{q.subtopic}</span>
                    </div>
                    <span className="shrink-0 whitespace-nowrap text-[0.875rem] font-semibold text-[var(--hud-text-dim)]" aria-label={`${q.marks} marks`}>[{q.marks}]</span>
                  </div>
                  <div className="mt-2.5 text-[1rem] leading-relaxed text-[var(--hud-text)]"><ExamMath text={q.stem} /></div>

                  {q.style !== "mcq" && q.parts.length > 0 && (
                    <ul className="mt-3 space-y-2.5">
                      {q.parts.map((p) => (
                        <li key={p.label} className="flex gap-3 text-[0.98rem] leading-relaxed text-[var(--hud-text)]">
                          <span className="w-7 shrink-0 font-semibold">{p.label}</span>
                          <span className="min-w-0 flex-1"><ExamMath text={p.text} /></span>
                          <span className="shrink-0 whitespace-nowrap text-[0.8125rem] text-[var(--hud-text-dim)]">[{p.marks}]</span>
                        </li>
                      ))}
                    </ul>
                  )}

                  {/* Answering it. */}
                  {q.style === "mcq" && q.options ? (
                    <div className="mt-4 grid gap-2 sm:grid-cols-2" role="group" aria-label={`Question ${q.n} options`}>
                      {LETTERS.filter((k) => q.options?.[k] !== undefined).map((k) => {
                        const on = choices[q.id] === k;
                        return (
                          <button
                            key={k}
                            type="button"
                            aria-pressed={on}
                            aria-label={`Option ${k}: ${q.options![k]}`}
                            onClick={() => setChoices((c) => ({ ...c, [q.id]: k }))}
                            className={`group flex items-center gap-3 rounded-[12px] border px-3.5 py-2.5 text-left transition hover:border-[var(--hud-cyan)] ${
                              on ? "border-[var(--hud-cyan)] bg-[var(--hud-cyan)]/[0.14]" : "border-[var(--hud-line)] bg-[var(--hud-bg)]"
                            }`}
                          >
                            <span className={`grid size-7 shrink-0 place-items-center rounded-md border text-xs font-semibold ${on ? "border-[var(--hud-cyan)] bg-[var(--hud-cyan)] text-[var(--hud-bg)]" : "border-[var(--hud-line-strong)] text-[var(--hud-text-faint)] group-hover:border-[var(--hud-cyan)] group-hover:text-[var(--hud-cyan)]"}`}>{k}</span>
                            <span className="min-w-0 text-[0.95rem] text-[var(--hud-text)]"><ExamMath text={q.options![k]} /></span>
                          </button>
                        );
                      })}
                    </div>
                  ) : q.answerOn === "paper" ? (
                    <div className="mt-4 flex gap-3 rounded-[12px] border border-dashed border-[var(--hud-line-strong)] px-4 py-3">
                      <PenLine size={18} className="mt-0.5 shrink-0 text-[var(--hud-cyan)]" aria-hidden />
                      <div className="text-[0.875rem] leading-relaxed text-[var(--hud-text-dim)]">
                        <p className="font-semibold text-[var(--hud-text)]">Answer on paper</p>
                        <p>
                          Write &ldquo;Q{q.n}&rdquo; at the top and show every step{q.parts.length > 1 ? `, labelling each part ${q.parts.map((p) => p.label).join(", ")}` : ""}: what you start from, each line of working, and your final answer (with its unit, if it has one). Marks are given for the working, not just the answer.
                        </p>
                      </div>
                    </div>
                  ) : (
                    <div className="mt-4 space-y-3">
                      {(q.parts.length ? q.parts : [{ label: "", marks: q.marks, text: "" }]).map((p) => (
                        <label key={p.label} className="block">
                          <span className="text-[0.8125rem] font-semibold text-[var(--hud-text-dim)]">{p.label ? `Answer ${p.label}` : "Your answer"}</span>
                          <textarea
                            value={texts[q.id]?.[p.label] ?? ""}
                            onChange={(e) => setTexts((t) => ({ ...t, [q.id]: { ...(t[q.id] ?? {}), [p.label]: e.target.value } }))}
                            rows={p.marks > 2 ? 3 : 2}
                            className="mt-1 w-full resize-y rounded-[12px] border border-[var(--hud-line)] bg-[var(--hud-bg)] px-3.5 py-2.5 text-[0.98rem] text-[var(--hud-text)] outline-none transition placeholder:text-[var(--hud-text-faint)] focus:border-[var(--hud-cyan)]"
                            placeholder="Type your answer"
                          />
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ol>
        <p className="border-t border-[var(--hud-line)] px-5 py-4 text-center font-[family-name:var(--font-hud-mono)] text-[0.6875rem] uppercase tracking-[0.12em] text-[var(--hud-text-faint)] sm:px-10">End of test</p>
      </article>

      {/* The bar along the bottom: photos of the paper answers, then "Submit for marking". */}
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-[var(--hud-line)] bg-[var(--hud-surface)]/95 backdrop-blur" data-practice-bar="">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-2.5 px-4 py-3 sm:flex-row sm:items-center sm:px-6">
          <div className="min-w-0 flex-1 text-[0.8125rem] leading-snug" aria-live="polite">
            {progressLine ? (
              <span className="flex items-center gap-1.5 text-[var(--hud-text-dim)]"><Loader2 size={14} className="animate-spin" aria-hidden /> {progressLine}</span>
            ) : uploadError ? (
              <span role="alert" className="flex items-center gap-1.5 text-[var(--danger)]"><TriangleAlert size={14} aria-hidden /> {uploadError}</span>
            ) : confirmNoPages ? (
              <span className="flex items-center gap-1.5 text-[var(--warning)]"><TriangleAlert size={14} className="shrink-0" aria-hidden /> Your paper answers aren&apos;t scanned, so they will get 0. Submit anyway?</span>
            ) : pages ? (
              <span className="flex items-center gap-1.5 text-[var(--success)]" data-pages-ready={pages.pageCount}><Check size={14} aria-hidden /> {pages.pageCount} page{pages.pageCount === 1 ? "" : "s"} of working ready</span>
            ) : (
              <span className="text-[var(--hud-text-dim)]">{answeredOnScreen} of {onScreen.length} answered here{paper.length ? ` · ${paper.length} on paper` : ""}</span>
            )}
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            {paper.length > 0 && (
              <>
                <button
                  type="button"
                  onClick={() => setScanOpen(true)}
                  disabled={uploading}
                  className="inline-flex h-10 flex-1 items-center justify-center gap-1.5 rounded-full border border-[var(--hud-line)] px-3.5 text-[0.85rem] font-medium text-[var(--hud-text)] transition hover:border-[var(--hud-cyan)] disabled:opacity-50 sm:flex-none"
                >
                  <Smartphone size={15} aria-hidden /> {pages?.via === "phone" ? "Scan again" : "Scan my paper answers"}
                </button>
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  disabled={uploading}
                  className="inline-flex h-10 flex-1 items-center justify-center gap-1.5 rounded-full border border-[var(--hud-line)] px-3.5 text-[0.85rem] font-medium text-[var(--hud-text)] transition hover:border-[var(--hud-cyan)] disabled:opacity-50 sm:flex-none"
                >
                  <ImageUp size={15} aria-hidden /> {pages?.via === "upload" ? "Upload again" : "Upload photos"}
                </button>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/jpeg,image/png"
                  multiple
                  hidden
                  aria-label="Photos of your paper answers"
                  data-practice-upload=""
                  onChange={(e) => { const files = Array.from(e.target.files ?? []); e.target.value = ""; void uploadChosen(files); }}
                />
              </>
            )}
            <button
              type="button"
              onClick={submit}
              disabled={uploading}
              className="hud-btn-primary inline-flex h-10 w-full items-center justify-center rounded-full px-5 text-[0.9rem] font-semibold disabled:opacity-50 sm:w-auto"
            >
              {confirmNoPages ? "Submit anyway" : "Submit for marking"}
            </button>
          </div>
        </div>
      </div>

      {scanOpen && <PhoneCapturePanel purpose="answers" onClose={() => setScanOpen(false)} onDocument={scanned} />}
    </main>
  );
}

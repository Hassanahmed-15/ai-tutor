"use client";

import React, { useEffect, useRef, useState } from "react";
import { playNarration, type NarrationHandle } from "@/lib/voice";

/**
 * PAST-PAPER PRACTICE AT THE END OF A COURSE LESSON (lib/curriculum/pastPapers.ts).
 * Accounts with full access answer the REAL Cambridge questions (page images) and are marked against the official
 * mark scheme; everyone else answers Aria's exam-style questions and sees which real past-paper questions test the
 * lesson. Aria reads the opening line and her feedback in her own voice. Skippable at every step.
 */
type Request = { courseId: string; grade: string; unitId: string; topicId: string; lessonId: string };
type Pointer = { label: string; mcq: boolean; marks: number; parts: string[] };
type RealQ = { kind: "real"; ref: string; label: string; mcq: boolean; marks: number; parts: Array<{ label: string; marks: number }>; images: string[] };
type StyleQ = { kind: "style"; setId: string; id: string; label: string; mcq: boolean; marks: number; stem: string; options?: Record<string, string>; parts: Array<{ label: string; marks: number; text: string }> };
type Q = RealQ | StyleQ;
/** The app font turns "(c)" into "©" with a ligature: off here, where part labels and working must read exactly. */
const EXACT: React.CSSProperties = { fontVariantLigatures: "none", fontFeatureSettings: '"liga" 0, "clig" 0, "calt" 0, "dlig" 0' };

type Marked = { awarded: number; max: number; answer?: string; feedback: string; parts: Array<{ label: string; awarded: number; max: number; earned: string[]; missed: string[] }>; scheme: Array<{ label: string; answer: string; guidance?: string; marks?: number }> };

export function PastPaperPractice({ request, part, onDone }: { request: Request; part: number; onDone: () => void }) {
  const [stage, setStage] = useState<"loading" | "question" | "summary">("loading");
  const [qs, setQs] = useState<Q[]>([]);
  const [pointers, setPointers] = useState<Pointer[]>([]);
  const [i, setI] = useState(0);
  const [choice, setChoice] = useState<string | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [marked, setMarked] = useState<Marked | null>(null);
  const [marking, setMarking] = useState(false);
  const [showScheme, setShowScheme] = useState(false);
  const [score, setScore] = useState({ got: 0, of: 0 });
  const [error, setError] = useState<string | null>(null);
  const voice = useRef<NarrationHandle | null>(null);

  const say = (text: string) => {
    voice.current?.cancel();
    if (!text.trim()) return;
    try { voice.current = playNarration(text, { onStart: () => {}, onEnd: () => {}, onBlocked: () => {} }); } catch { /* voice is a nicety */ }
  };
  useEffect(() => () => { voice.current?.cancel(); }, []);

  useEffect(() => {
    let gone = false;
    (async () => {
      const qsParams = new URLSearchParams({ ...request, part: String(part) });
      const res = await fetch(`/api/curricula/past-papers?${qsParams}`).then((r) => (r.ok ? r.json() : null)).catch(() => null);
      if (gone) return;
      const ptrs: Pointer[] = res?.pointers ?? [];
      setPointers(ptrs);
      let list: Q[] = [];
      if (res?.full && res.questions?.length) {
        list = (res.questions as Omit<RealQ, "kind">[]).map((q) => ({ ...q, kind: "real" as const }));
      } else {
        const st = await fetch("/api/curricula/past-papers/exam-style", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...request, part }) })
          .then((r) => (r.ok ? r.json() : null)).catch(() => null);
        if (gone) return;
        if (st?.available) list = (st.questions as Array<Omit<StyleQ, "kind" | "setId" | "label">>).map((q, k) => ({ ...q, kind: "style" as const, setId: st.setId, label: `Exam-style question ${k + 1}` }));
      }
      if (!list.length && !ptrs.length) { onDone(); return; }
      setQs(list);
      setStage(list.length ? "question" : "summary");
      say(list.length ? "Now let's see how this comes up in the exam." : "");
    })();
    return () => { gone = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const q = qs[i];
  const resetAnswer = () => { setChoice(null); setAnswers({}); setMarked(null); setShowScheme(false); setError(null); };

  async function check() {
    if (!q || marking) return;
    setMarking(true); setError(null);
    const body = q.kind === "real" ? { ref: q.ref, choice, answers } : { setId: q.setId, id: q.id, choice, answers };
    const r = await fetch("/api/curricula/past-papers/mark", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
      .then(async (x) => ({ ok: x.ok, data: await x.json().catch(() => null) })).catch(() => ({ ok: false, data: null }));
    setMarking(false);
    if (!r.ok || !r.data) { setError(r.data?.error ?? "Could not mark that one. Try again."); return; }
    const m = r.data as Marked;
    setMarked(m);
    setScore((s) => ({ got: s.got + m.awarded, of: s.of + m.max }));
    if (q.mcq) say(m.awarded ? `That's right, ${m.answer}.` : `Not quite. The answer is ${m.answer}. ${m.feedback ?? ""}`);
    else say(m.feedback || `You got ${m.awarded} out of ${m.max}.`);
  }

  function next() {
    resetAnswer();
    if (i + 1 < qs.length) { setI(i + 1); return; }
    setStage("summary");
    say(score.of ? `That's ${score.got} out of ${score.of} marks. ` + (score.got / score.of >= 0.7 ? "Good work." : "Have another look at the parts you missed.") : "");
  }

  if (stage === "loading") {
    return (
      <main className="hud-canvas hud-grain flex min-h-screen items-center justify-center px-6" data-past-papers="loading">
        <p className="text-[var(--hud-text-dim)]">Finding exam questions on this lesson…</p>
      </main>
    );
  }

  if (stage === "summary" || !q) {
    return (
      <main className="hud-canvas hud-grain flex min-h-screen items-center justify-center px-6" data-past-papers="summary" style={EXACT}>
        <section className="mx-auto w-full max-w-2xl">
          <p className="text-xs font-bold uppercase tracking-[0.14em] text-[var(--hud-text-dim)]">Past paper practice</p>
          {score.of > 0 && <h1 className="font-display mt-3 text-[2.6rem] leading-none tracking-[-0.03em] text-[var(--hud-text)]">{score.got} / {score.of} marks</h1>}
          {pointers.length > 0 && (
            <div className="mt-8">
              <p className="text-sm font-semibold text-[var(--hud-text)]">Real past-paper questions on this lesson</p>
              <ul className="mt-3 space-y-2" data-past-paper-pointers="">
                {pointers.map((p) => (
                  <li key={p.label} className="rounded-[var(--radius)] border border-[var(--hud-line,rgba(255,255,255,0.12))] px-4 py-3 text-sm text-[var(--hud-text-dim)]">
                    <span className="font-semibold text-[var(--hud-text)]">{p.label}</span>
                    {p.mcq ? " · multiple choice" : p.parts.length ? ` · parts ${p.parts.join(", ")}` : ""} · {p.marks} mark{p.marks === 1 ? "" : "s"}
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-xs text-[var(--hud-text-dim)]">Your school or teacher has these papers.</p>
            </div>
          )}
          <button onClick={onDone} className="hud-btn-primary mt-10 rounded-[var(--radius)] px-9 py-4 text-[0.95rem]" data-past-papers-done="">Continue</button>
        </section>
      </main>
    );
  }

  const markedParts = q.parts.filter((p) => p.marks > 0);
  return (
    <main className="hud-canvas hud-grain flex min-h-screen justify-center overflow-y-auto px-4 py-10 sm:px-6" data-past-papers="question" style={EXACT}>
      <section className="mx-auto w-full max-w-3xl">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <p className="text-xs font-bold uppercase tracking-[0.14em] text-[var(--hud-text-dim)]">Past paper practice · question {i + 1} of {qs.length}</p>
          <p className="text-xs font-semibold text-[var(--hud-text-dim)]">{q.marks} mark{q.marks === 1 ? "" : "s"}</p>
        </div>
        <h2 className="mt-2 text-lg font-bold text-[var(--hud-text)]" data-past-paper-label="">{q.label}</h2>

        <div className="mt-4 overflow-hidden rounded-[var(--radius)] bg-white">
          {q.kind === "real" ? (
            // min-height while the page image loads from storage, so the card never looks empty
            q.images.map((src) => <img key={src} src={src} alt={`${q.label}, page of the question paper`} className="block min-h-[160px] w-full bg-white" loading="eager" />)
          ) : (
            <div className="space-y-3 p-5 text-[0.98rem] leading-relaxed text-neutral-900">
              {q.stem && <p>{q.stem}</p>}
              {q.mcq && q.options && Object.entries(q.options).map(([k, v]) => <p key={k}><b className="mr-3">{k}</b>{v}</p>)}
              {!q.mcq && q.parts.map((p) => <p key={p.label}><b className="mr-2">{p.label}</b>{p.text} <span className="whitespace-nowrap text-neutral-500">[{p.marks}]</span></p>)}
            </div>
          )}
        </div>

        {!marked && (
          <div className="mt-5">
            {q.mcq ? (
              <div className="flex flex-wrap gap-3" data-mcq-options="">
                {["A", "B", "C", "D"].map((k) => (
                  <button key={k} onClick={() => setChoice(k)} className={`${choice === k ? "hud-btn-primary" : "hud-btn-ghost"} h-14 w-14 rounded-full text-lg font-bold`}>{k}</button>
                ))}
              </div>
            ) : (
              <div className="space-y-3">
                {markedParts.map((p) => (
                  <label key={p.label} className="block">
                    <span className="text-sm font-semibold text-[var(--hud-text)]">{p.label} <span className="font-normal text-[var(--hud-text-dim)]">[{p.marks}]</span></span>
                    <textarea
                      value={answers[p.label] ?? ""}
                      onChange={(e) => setAnswers((a) => ({ ...a, [p.label]: e.target.value }))}
                      rows={p.marks > 2 ? 4 : 2}
                      className="mt-1 w-full rounded-[var(--radius)] border border-[var(--hud-line,rgba(255,255,255,0.14))] bg-transparent p-3 text-[var(--hud-text)]"
                      placeholder="Your answer"
                    />
                  </label>
                ))}
              </div>
            )}
            {error && <p className="mt-3 text-sm text-red-400">{error}</p>}
            <div className="mt-5 flex flex-wrap items-center gap-5">
              <button onClick={check} disabled={marking || (q.mcq ? !choice : !Object.values(answers).some((v) => v.trim()))} className="hud-btn-primary rounded-[var(--radius)] px-8 py-3 text-[0.95rem] disabled:opacity-50" data-check-answer="">
                {marking ? "Marking…" : "Check my answer"}
              </button>
              <button onClick={next} className="text-sm text-[var(--hud-text-dim)] hover:text-[var(--hud-text)]">Skip</button>
            </div>
          </div>
        )}

        {marked && (
          <div className="mt-5 rounded-[var(--radius)] border border-[var(--hud-line,rgba(255,255,255,0.14))] p-5" data-past-paper-result="">
            <p className="text-xl font-bold text-[var(--hud-text)]">You got {marked.awarded} / {marked.max}</p>
            {q.mcq && <p className="mt-1 text-sm text-[var(--hud-text-dim)]">Answer: <b className="text-[var(--hud-text)]">{marked.answer}</b>{choice ? ` · you chose ${choice}` : ""}</p>}
            {marked.parts.length > 0 && (
              <ul className="mt-3 space-y-2 text-sm">
                {marked.parts.map((p) => (
                  <li key={p.label}>
                    <span className="font-semibold text-[var(--hud-text)]">{p.label}: {p.awarded}/{p.max}</span>
                    {p.earned.map((e) => <span key={e} className="ml-2 text-emerald-400">✓ {e}</span>)}
                    {p.missed.map((e) => <span key={e} className="ml-2 text-amber-300">✗ {e}</span>)}
                  </li>
                ))}
              </ul>
            )}
            {marked.feedback && <p className="mt-3 text-[0.95rem] text-[var(--hud-text)]">{marked.feedback}</p>}
            {marked.scheme.length > 0 && (
              <button onClick={() => setShowScheme((s) => !s)} className="mt-4 text-sm font-semibold text-[var(--hud-text)] underline-offset-4 hover:underline" data-show-scheme="">
                {showScheme ? "Hide" : "Show"} {q.kind === "real" ? "official mark scheme" : "mark scheme"}
              </button>
            )}
            {showScheme && (
              <table className="mt-3 w-full text-left text-sm text-[var(--hud-text-dim)]">
                <tbody>
                  {marked.scheme.map((r, k) => (
                    <tr key={`${r.label}-${k}`} className="border-t border-[var(--hud-line,rgba(255,255,255,0.1))] align-top">
                      <td className="py-2 pr-3 font-semibold text-[var(--hud-text)]">{r.label}</td>
                      <td className="py-2 pr-3">{r.answer}{r.guidance ? <span className="block text-xs opacity-80">{r.guidance}</span> : null}</td>
                      <td className="py-2 text-right">{r.marks ?? ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <button onClick={next} className="hud-btn-primary mt-5 rounded-[var(--radius)] px-8 py-3 text-[0.95rem]" data-next-question="">
              {i + 1 < qs.length ? "Next question" : "Finish"}
            </button>
          </div>
        )}
      </section>
    </main>
  );
}

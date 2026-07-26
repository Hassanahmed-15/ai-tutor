"use client";

import { useEffect, useRef, useState } from "react";
import { HudButton, HudCorners, HudEyebrow } from "@/components/hud/HudKit";
import { LiveTutorPanel } from "@/components/lesson-chat/LiveTutorPanel";
import { useRealtimeTutor } from "@/lib/useRealtimeTutor";
import type { TestBank, TestGradeResult } from "@/lib/testPrompt";

/** Live oral exam: reuses the realtime voice tutor infra in "examMode" (see EXAM_ADDENDUM in
 *  app/api/realtime-session/route.ts) — Aria asks bank.questions in order, the student answers
 *  by voice, and grading happens in a SEPARATE post-session pass over the full transcript
 *  (/api/grade-oral-test) rather than parsing live spoken judgment (see testPrompt.ts /
 *  grade-oral-test/route.ts for why). A "grading" phase is layered on top of the hook's own
 *  connection status since grading only starts after the session has fully ended. */
export function TestOralView({
  topic,
  bank,
  onGraded,
  onBack,
}: {
  topic: string;
  bank: TestBank;
  onGraded: (results: TestGradeResult[]) => void;
  onBack: () => void;
}) {
  const [phase, setPhase] = useState<"idle" | "live" | "grading" | "error">("idle");
  const [gradeError, setGradeError] = useState<string | null>(null);
  const transcriptRef = useRef<Array<{ role: "student" | "tutor"; text: string }>>([]);
  const [transcript, setTranscript] = useState<Array<{ role: "student" | "tutor"; text: string }>>([]);
  const studentTurnsRef = useRef(0);
  const [studentTurns, setStudentTurns] = useState(0);
  const gradedRef = useRef(false);

  async function gradeAndFinish() {
    if (gradedRef.current) return;
    gradedRef.current = true;
    if (transcriptRef.current.length === 0 || studentTurnsRef.current === 0) {
      setGradeError("I couldn't capture any spoken answers. Check microphone permission and try the oral exam again.");
      setPhase("error");
      return;
    }
    setPhase("grading");
    try {
      const res = await fetch("/api/grade-oral-test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ questions: bank.questions, transcript: transcriptRef.current }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !Array.isArray(data.results)) throw new Error(data.error || "Grading failed.");
      onGraded(data.results as TestGradeResult[]);
    } catch (err) {
      setGradeError(err instanceof Error ? err.message : "Grading failed.");
      setPhase("error");
    }
  }

  const tutor = useRealtimeTutor({
    topic,
    getBeatContext: () => "",
    examMode: true,
    examQuestions: bank.questions.map((q) => q.oralPhrasing),
    onBoardRequest: () => {},
    onTranscript: (role, text, final) => {
      if (!final) return;
      transcriptRef.current = [...transcriptRef.current, { role, text }];
      setTranscript(transcriptRef.current);
      if (role === "student") {
        studentTurnsRef.current += 1;
        setStudentTurns(studentTurnsRef.current);
      }
    },
    onSessionEnded: (reason) => {
      // Only grade if the exam actually ran (at least one student turn was captured) — a
      // mic-denied/connection-error teardown before the exam started has nothing to grade.
      if (reason === "error" && studentTurnsRef.current === 0) {
        setGradeError(tutor.errorMessage || "The oral exam connection failed before any answer was captured.");
        setPhase("error");
        return;
      }
      void gradeAndFinish();
    },
  });

  useEffect(() => {
    return () => {
      if (tutor.status !== "idle") tutor.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function start() {
    gradedRef.current = false;
    transcriptRef.current = [];
    studentTurnsRef.current = 0;
    setTranscript([]);
    setStudentTurns(0);
    setGradeError(null);
    setPhase("live");
    void tutor.start();
  }

  function endExam() {
    if (phase !== "live") return;
    tutor.stop();
  }

  const questionCount = bank.questions.length;
  const progressLabel = phase === "live" ? `Question ${Math.min(studentTurns + 1, questionCount)} of ${questionCount}` : undefined;

  return (
    <section className="relative z-10 grid min-h-screen w-full place-items-center overflow-y-auto bg-gradient-to-b from-[#05040c] via-[#0a0810] to-[#05040c] p-6 lg:p-10">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_20%,rgba(99,102,241,0.15),transparent_50%)]" />

      <div className="relative z-20 w-full max-w-2xl rounded-[2.5rem] border border-[var(--hud-line)]/50 bg-gradient-to-br from-white/[0.04] to-white/[0.02] p-10">
        <HudCorners />
        <div className="relative z-10">
          <HudEyebrow>Oral exam</HudEyebrow>
          <h1 className="mt-4 font-display text-3xl font-light leading-tight sm:text-4xl">
            Testing <span className="hud-text-glow italic">{topic}</span> — live with Aria
          </h1>

          {phase === "idle" && (
            <>
              <p className="mt-5 text-base leading-7 text-[var(--hud-text-dim)]">
                Aria will ask you {questionCount} questions out loud, one at a time. Answer by speaking — she won&apos;t
                tell you if you&apos;re right or wrong during the exam; you&apos;ll see your full results at the end.
              </p>
              <div className="mt-8 flex items-center justify-between">
                <button onClick={onBack} className="hud-btn-ghost rounded-full px-6 py-3 text-sm font-bold">
                  Back
                </button>
                <HudButton onClick={start}>Start the exam →</HudButton>
              </div>
            </>
          )}

          {phase === "grading" && <p className="mt-8 text-lg font-semibold text-[var(--hud-text-dim)]">Grading your answers…</p>}

          {phase === "error" && (
            <>
              <p className="mt-8 text-sm font-semibold text-rose-300">⚠️ {gradeError}</p>
              <div className="mt-6 flex flex-wrap gap-3">
                <button onClick={onBack} className="hud-btn-ghost rounded-full px-6 py-3 text-sm font-bold">
                  Back
                </button>
                <HudButton onClick={start}>Try oral again →</HudButton>
              </div>
            </>
          )}
        </div>
      </div>

      {phase === "live" && (
        <LiveTutorPanel
          status={tutor.status}
          speaking={tutor.speaking}
          muted={tutor.muted}
          errorMessage={tutor.errorMessage}
          transcript={transcript}
          onMuteToggle={tutor.toggleMute}
          onEnd={endExam}
          progressLabel={progressLabel}
        />
      )}
    </section>
  );
}

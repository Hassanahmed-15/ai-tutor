"use client";

import { useState } from "react";
import Image from "next/image";
import type { Beat } from "@/lib/lessonContent";

/**
 * A short section card shown before the board for each beat. Teaching content belongs on the
 * animated board, so ordinary section cards deliberately contain the title and nothing else.
 * Checkpoint beats remain interactive because the question is the purpose of that beat.
 */
interface CheckpointResultData {
  correct: boolean;
  feedback: string;
  revealed?: boolean;
}

export function SlideStage({
  beat,
  onCheckpointAnswer,
  checkpointResult,
  checkpointAttempts = 0,
  maxAttempts = 2,
  onRevealAnswer,
  suppressCheckpoint = false,
}: {
  beat: Beat;
  onCheckpointAnswer?: (answer: string) => void;
  checkpointResult?: CheckpointResultData | null;
  checkpointAttempts?: number;
  maxAttempts?: number;
  onRevealAnswer?: () => void;
  /**
   * Render a checkpoint beat as an ordinary slide, with no question and no answer box.
   *
   * Set by the ADHD track, where the only question is the flown one every third beat. Without it the
   * beat still printed "Type your answer" — the exact typed form that track is meant to have none of.
   */
  suppressCheckpoint?: boolean;
}) {
  // Only a real, unsuppressed checkpoint renders the question form; everything else is a title.
  const isCheckpointForm = beat.slideKind === "checkpoint" && Boolean(beat.checkpoint) && !suppressCheckpoint;
  return (
    <section className="beat-fade-in relative grid h-full min-h-0 place-items-center overflow-hidden rounded-[2rem] bg-[#0c0a09] p-6 text-white lg:p-10">
      {beat.photoBackdrop && (
        <Image
          src={beat.photoBackdrop}
          alt=""
          fill
          priority
          className="absolute inset-0 object-contain"
          sizes="100vw"
        />
      )}
      {/* One faint warm wash, the same backdrop the board itself uses. The predecessor layered a
          cyan radial, a violet radial and a blue diagonal gradient — a busy, differently-coloured
          surface from the board it introduces, so every section change flashed a purple slide into
          the middle of a calm dark lecture. */}
      <div
        className={`absolute inset-0 ${beat.photoBackdrop ? "" : "opacity-90"}`}
        style={{
          backgroundImage: beat.photoBackdrop
            ? "linear-gradient(180deg, rgba(2,6,23,0.48) 0%, rgba(2,6,23,0.78) 75%, rgba(2,6,23,0.95) 100%)"
            : "radial-gradient(circle at 50% 0%, rgba(232,168,124,0.07), transparent 60%), linear-gradient(180deg,#0c0a09,#080605)",
        }}
      />
      {/* A checkpoint is a form and earns a panel to sit in. A plain section title does not: the
          old card nested a bordered, blurred panel inside a bordered frame inside a gradient, three
          boxes deep for one line of text. */}
      {isCheckpointForm && <div className="pointer-events-none absolute inset-6 rounded-[1.7rem] border border-white/10" />}
      <div
        className={
          isCheckpointForm
            ? "relative w-full max-w-4xl rounded-[1.75rem] border border-white/10 bg-slate-950/46 p-6 shadow-[0_30px_100px_rgba(0,0,0,0.28)] backdrop-blur-md lg:p-10"
            : "relative w-full max-w-3xl px-2"
        }
      >
        <SlideBody
          beat={beat}
          onCheckpointAnswer={onCheckpointAnswer}
          checkpointResult={checkpointResult}
          checkpointAttempts={checkpointAttempts}
          maxAttempts={maxAttempts}
          onRevealAnswer={onRevealAnswer}
          suppressCheckpoint={suppressCheckpoint}
        />
      </div>
    </section>
  );
}

function SlideBody({
  beat,
  onCheckpointAnswer,
  checkpointResult,
  checkpointAttempts,
  maxAttempts,
  onRevealAnswer,
  suppressCheckpoint = false,
}: {
  beat: Beat;
  onCheckpointAnswer?: (answer: string) => void;
  checkpointResult?: CheckpointResultData | null;
  checkpointAttempts: number;
  maxAttempts: number;
  onRevealAnswer?: () => void;
  /**
   * Render a checkpoint beat as an ordinary slide, with no question and no answer box.
   *
   * Set by the ADHD track, where the only question is the flown one every third beat. Without it the
   * beat still printed "Type your answer" — the exact typed form that track is meant to have none of.
   */
  suppressCheckpoint?: boolean;
}) {
  // Tracks with their own checkpoint cadence still get the same title-only section card, never a
  // second question or a preview of the teaching content.
  if (beat.slideKind === "checkpoint" && suppressCheckpoint) {
    return <BeatTitleCard title={beat.title} />;
  }

  if (beat.slideKind === "checkpoint" && beat.checkpoint && !suppressCheckpoint) {
    return (
      <CheckpointSlide
        checkpointPrompt={beat.checkpoint.prompt}
        onAnswer={onCheckpointAnswer}
        result={checkpointResult}
        attempts={checkpointAttempts}
        maxAttempts={maxAttempts}
        onRevealAnswer={onRevealAnswer}
      />
    );
  }

  return <BeatTitleCard title={beat.title} />;
}

/**
 * The title of a section, on a checkpoint beat.
 *
 * Matched to `SectionCard` in components/board/BoardStage.tsx: left-aligned, balanced weight, a
 * thin amber rule. The predecessor set this at text-7xl black and centred, which on a real title
 * ("Wht Is Linear Regression") filled the screen edge to edge and read as a splash screen rather
 * than as a heading in a lesson. `text-balance` keeps a wrapped title from leaving one orphan word
 * on the last line.
 */
function BeatTitleCard({ title }: { title: string }) {
  return (
    <div className="w-full">
      <h2 className="text-balance text-3xl font-bold leading-[1.12] tracking-[-0.01em] text-white/95 sm:text-4xl lg:text-[2.9rem]">
        {title}
      </h2>
      <div className="mt-5 h-px w-16 bg-gradient-to-r from-amber-300/60 to-transparent" />
    </div>
  );
}

function CheckpointSlide({
  checkpointPrompt,
  onAnswer,
  result,
  attempts,
  maxAttempts,
  onRevealAnswer,
}: {
  checkpointPrompt: string;
  onAnswer?: (answer: string) => void;
  result?: CheckpointResultData | null;
  attempts: number;
  maxAttempts: number;
  onRevealAnswer?: () => void;
  /**
   * Render a checkpoint beat as an ordinary slide, with no question and no answer box.
   *
   * Set by the ADHD track, where the only question is the flown one every third beat. Without it the
   * beat still printed "Type your answer" — the exact typed form that track is meant to have none of.
   */
  suppressCheckpoint?: boolean;
}) {
  const [value, setValue] = useState("");
  // A wrong answer shows feedback but does NOT lock the form — the student can retry.
  // Only a correct (or revealed) result is final.
  const isFinal = Boolean(result?.correct);
  const exhausted = !isFinal && attempts >= maxAttempts;

  return (
    <div className="text-center">
      <Chip tone="amber">Checkpoint{attempts > 0 && !isFinal ? ` · attempt ${attempts + 1}` : ""}</Chip>
      <h2 className="mx-auto mt-7 max-w-2xl text-4xl font-black leading-tight">{checkpointPrompt}</h2>

      {!isFinal && (
        <form
          className="mx-auto mt-8 flex max-w-lg flex-col gap-3 sm:flex-row"
          onSubmit={(e) => {
            e.preventDefault();
            if (value.trim()) {
              onAnswer?.(value.trim());
              setValue("");
            }
          }}
        >
          <input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="Type your answer…"
            autoFocus
            className="flex-1 rounded-2xl border border-white/15 bg-white/5 px-5 py-3.5 text-lg font-semibold text-white placeholder:text-white/30 focus:border-indigo-400 focus:outline-none"
          />
          <button
            type="submit"
            className="rounded-2xl bg-gradient-to-r from-indigo-500 to-fuchsia-500 px-7 py-3.5 text-lg font-black shadow-[0_0_30px_rgba(129,140,248,0.4)]"
          >
            Check
          </button>
        </form>
      )}

      {result && (
        <p
          className={`beat-fade-in mx-auto mt-5 max-w-lg rounded-2xl px-5 py-3.5 text-lg font-bold ${
            result.correct ? "bg-emerald-500/15 text-emerald-200" : "bg-amber-500/15 text-amber-200"
          }`}
        >
          {result.feedback}
        </p>
      )}
      {!result && <p className="mt-5 text-sm font-bold uppercase tracking-[0.18em] text-white/30">Aria is waiting for your answer</p>}

      {exhausted && (
        <button
          onClick={onRevealAnswer}
          className="beat-fade-in mt-5 rounded-full border border-white/15 bg-white/5 px-6 py-2.5 text-sm font-bold text-white/70 transition hover:bg-white/10"
        >
          Show me the answer
        </button>
      )}
    </div>
  );
}

function Chip({ children, tone = "indigo" }: { children: React.ReactNode; tone?: "indigo" | "amber" }) {
  return (
    <span
      className={`inline-flex rounded-full border px-4 py-1.5 text-xs font-black uppercase tracking-[0.2em] ${
        tone === "amber" ? "border-amber-400/30 bg-amber-500/10 text-amber-200" : "border-indigo-400/30 bg-indigo-500/10 text-indigo-200"
      }`}
    >
      {children}
    </span>
  );
}

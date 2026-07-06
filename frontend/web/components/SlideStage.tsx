"use client";

import { useState } from "react";
import Image from "next/image";
import type { Beat } from "@/lib/lessonContent";

/**
 * Teacher slides — five distinct layouts a real teacher actually uses, not one
 * title+bullets template repeated forever:
 *  - intro: sets up the next idea (title + a couple of supporting points)
 *  - definition: one term, one meaning, big and isolated (vocabulary-first teaching)
 *  - checkpoint: an actual question with a text input + checked feedback
 *  - compare: two columns side by side (contrast reinforces understanding)
 *  - recap: a checklist summary of the whole lecture
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
}: {
  beat: Beat;
  onCheckpointAnswer?: (answer: string) => void;
  checkpointResult?: CheckpointResultData | null;
  checkpointAttempts?: number;
  maxAttempts?: number;
  onRevealAnswer?: () => void;
}) {
  return (
    <section className="beat-fade-in relative grid h-full min-h-0 place-items-center overflow-hidden rounded-[2rem] bg-[#07101f] p-6 text-white lg:p-10">
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
      <div
        className={`absolute inset-0 ${beat.photoBackdrop ? "" : "opacity-90"}`}
        style={{
          backgroundImage: beat.photoBackdrop
            ? "linear-gradient(180deg, rgba(2,6,23,0.48) 0%, rgba(2,6,23,0.78) 75%, rgba(2,6,23,0.95) 100%)"
            : "radial-gradient(circle at 18% 20%, rgba(34,211,238,0.34), transparent 44%), radial-gradient(circle at 82% 78%, rgba(168,85,247,0.26), transparent 50%), linear-gradient(135deg,#07101f,#020617)",
        }}
      />
      <div className="pointer-events-none absolute inset-6 rounded-[1.7rem] border border-white/10" />
      <div className="relative w-full max-w-4xl rounded-[1.75rem] border border-white/10 bg-slate-950/46 p-6 shadow-[0_30px_100px_rgba(0,0,0,0.28)] backdrop-blur-md lg:p-10">
        <SlideBody
          beat={beat}
          onCheckpointAnswer={onCheckpointAnswer}
          checkpointResult={checkpointResult}
          checkpointAttempts={checkpointAttempts}
          maxAttempts={maxAttempts}
          onRevealAnswer={onRevealAnswer}
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
}: {
  beat: Beat;
  onCheckpointAnswer?: (answer: string) => void;
  checkpointResult?: CheckpointResultData | null;
  checkpointAttempts: number;
  maxAttempts: number;
  onRevealAnswer?: () => void;
}) {
  if (beat.slideKind === "definition") {
    return (
      <div className="text-center">
        <Chip>{beat.stepLabel}</Chip>
        <h2 className="mt-8 text-7xl font-black tracking-tight">{beat.definitionTerm}</h2>
        <p className="mx-auto mt-6 max-w-xl text-2xl font-bold leading-snug text-white/75">{beat.definitionMeaning}</p>
      </div>
    );
  }

  if (beat.slideKind === "compare" && beat.compareLeft && beat.compareRight) {
    return (
      <div className="text-center">
        <Chip>{beat.stepLabel}</Chip>
        <h2 className="mt-6 text-4xl font-black tracking-tight">{beat.title}</h2>
        <div className="mt-8 grid gap-5 sm:grid-cols-2">
          {[beat.compareLeft, beat.compareRight].map((col) => (
            <div key={col.label} className="rounded-2xl border border-white/10 bg-white/5 p-6 text-left">
              <p className="text-sm font-black uppercase tracking-wide text-indigo-300">{col.label}</p>
              <div className="mt-4 flex flex-col gap-2.5">
                {col.points.map((p) => (
                  <p key={p} className="flex items-center gap-2.5 text-lg font-bold text-white/80">
                    <span className="size-1.5 shrink-0 rounded-full bg-fuchsia-400" />
                    {p}
                  </p>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (beat.slideKind === "checkpoint" && beat.checkpoint) {
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

  if (beat.slideKind === "recap") {
    return (
      <div className="text-center">
        <Chip>{beat.stepLabel}</Chip>
        <h2 className="mt-6 text-5xl font-black tracking-tight">{beat.title}</h2>
        <div className="mx-auto mt-8 flex max-w-xl flex-col gap-3 text-left">
          {beat.points.map((p, i) => (
            <p
              key={p}
              className="beat-fade-in flex items-center gap-3 rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-lg font-bold text-white/85"
              style={{ animationDelay: `${200 + i * 160}ms` }}
            >
              <span className="grid size-6 shrink-0 place-items-center rounded-full bg-gradient-to-br from-indigo-400 to-fuchsia-400 text-xs font-black text-white">
                {i + 1}
              </span>
              {p}
            </p>
          ))}
        </div>
      </div>
    );
  }

  // intro (default)
  return (
    <div className="text-center">
      <Chip>{beat.stepLabel}</Chip>
      <h2 className="mt-7 text-6xl font-black leading-[1.02] tracking-tight">{beat.title}</h2>
      {beat.points.length > 0 && (
        <div className="mt-9 flex flex-col items-center gap-3">
          {beat.points.map((p, i) => (
            <p
              key={p}
              className="beat-fade-in flex items-center gap-3 text-2xl font-bold text-white/75"
              style={{ animationDelay: `${250 + i * 220}ms` }}
            >
              <span className="size-2 rounded-full bg-gradient-to-r from-indigo-400 to-fuchsia-400" />
              {p}
            </p>
          ))}
        </div>
      )}
      <p className="mt-10 text-sm font-bold uppercase tracking-[0.2em] text-white/30">Watch me draw it →</p>
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

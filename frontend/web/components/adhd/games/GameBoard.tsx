"use client";

import { useState } from "react";
import type { GameRound } from "@/lib/adhd/gameRouting";

/**
 * The playable board for one round of game mode.
 *
 * EVERYTHING IS CLICK-BASED. No drag-and-drop anywhere, including the sort round where dragging is
 * the obvious choice: drag is fiddly on a trackpad, unusable by keyboard, invisible to a screen
 * reader without a pile of extra work, and effectively untestable in Playwright. Two labelled
 * buttons per item say the same thing and can be asserted.
 *
 * A WRONG ANSWER IS NEVER PUNISHED. It shows what the right answer was and moves on, matching the
 * rule the rest of the track enforces in `score.ts`: the cost lands on disengaging, never on getting
 * something wrong. That is also why there is no timer on any of these — a countdown converts a
 * question into a stress response, which is the opposite of what this mode is for.
 */
export function GameBoard({
  round,
  onDone,
}: {
  round: GameRound;
  /** Called once the learner has seen the verdict and chosen to continue. */
  onDone: (correct: boolean) => void;
}) {
  const [verdict, setVerdict] = useState<null | { correct: boolean; detail?: string }>(null);

  return (
    <div
      data-game-round={round.kind}
      className="flex h-full w-full flex-col items-center justify-center gap-5 p-6"
    >
      <p className="text-center text-[0.72rem] font-black uppercase tracking-[0.18em] text-teal-300">
        {round.kind === "order" ? "Put it in order" : round.kind === "sort" ? "Sort these" : "Your turn"}
      </p>

      {!verdict && <RoundBody round={round} onAnswer={setVerdict} />}

      {verdict && (
        <div className="flex max-w-lg flex-col items-center gap-3 text-center">
          <p className={`text-lg font-black ${verdict.correct ? "text-emerald-300" : "text-amber-300"}`}>
            {verdict.correct ? "Correct" : "Not quite"}
          </p>
          {/* Always show the answer on a miss. A round that only says "wrong" teaches nothing. */}
          {verdict.detail && <p className="text-sm leading-relaxed text-white/70">{verdict.detail}</p>}
          <button
            data-game-continue
            onClick={() => onDone(verdict.correct)}
            className="rounded-full bg-teal-400/15 px-5 py-2 text-sm font-bold text-teal-200 ring-1 ring-teal-400/30 transition hover:bg-teal-400/25"
          >
            Continue →
          </button>
        </div>
      )}
    </div>
  );
}

type Answer = (v: { correct: boolean; detail?: string }) => void;

function RoundBody({ round, onAnswer }: { round: GameRound; onAnswer: Answer }) {
  switch (round.kind) {
    case "match":
      return <MatchRound round={round} onAnswer={onAnswer} />;
    case "sort":
      return <SortRound round={round} onAnswer={onAnswer} />;
    case "recall":
      return <RecallRound round={round} onAnswer={onAnswer} />;
    case "order":
      return <OrderRound round={round} onAnswer={onAnswer} />;
  }
}

function MatchRound({ round, onAnswer }: { round: Extract<GameRound, { kind: "match" }>; onAnswer: Answer }) {
  return (
    <>
      <h2 className="text-center text-3xl font-black text-white">{round.prompt}</h2>
      <p className="text-sm text-white/50">{round.ask ?? "Which one is it?"}</p>
      <div className="flex w-full max-w-2xl flex-col gap-2">
        {round.options.map((option, i) => (
          <button
            key={option}
            data-game-option
            onClick={() =>
              onAnswer({
                correct: i === round.answer,
                detail: i === round.answer ? undefined : round.options[round.answer],
              })
            }
            className="rounded-xl border border-white/12 bg-white/[0.04] px-4 py-3 text-left text-sm leading-relaxed text-white/85 transition hover:border-teal-400/40 hover:bg-teal-400/10"
          >
            {option}
          </button>
        ))}
      </div>
    </>
  );
}

function SortRound({ round, onAnswer }: { round: Extract<GameRound, { kind: "sort" }>; onAnswer: Answer }) {
  // Index -> chosen bucket. Undefined until the learner assigns it.
  const [picked, setPicked] = useState<Record<number, 0 | 1>>({});
  const done = round.items.every((_, i) => picked[i] !== undefined);

  const submit = () => {
    const wrong = round.items.filter((item, i) => picked[i] !== item.bucket);
    onAnswer({
      correct: wrong.length === 0,
      detail: wrong.length
        ? `${wrong.length} in the wrong place — ${wrong.map((w) => `"${w.text}" is ${round.buckets[w.bucket]}`).join("; ")}`
        : undefined,
    });
  };

  return (
    <>
      <h2 className="text-center text-xl font-black text-white">{round.prompt}</h2>
      <div className="flex w-full max-w-2xl flex-col gap-2">
        {round.items.map((item, i) => (
          <div key={item.text} className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] p-2">
            <span className="min-w-0 flex-1 truncate px-2 text-sm text-white/85">{item.text}</span>
            {[0, 1].map((b) => (
              <button
                key={b}
                data-game-option
                onClick={() => setPicked((p) => ({ ...p, [i]: b as 0 | 1 }))}
                className={`shrink-0 rounded-lg px-3 py-1.5 text-[0.7rem] font-bold transition ${
                  picked[i] === b
                    ? "bg-teal-400/25 text-teal-100 ring-1 ring-teal-400/50"
                    : "bg-white/[0.05] text-white/55 hover:bg-white/10"
                }`}
              >
                {round.buckets[b]}
              </button>
            ))}
          </div>
        ))}
      </div>
      <button
        data-game-submit
        disabled={!done}
        onClick={submit}
        className="rounded-full bg-teal-400/15 px-5 py-2 text-sm font-bold text-teal-200 ring-1 ring-teal-400/30 transition enabled:hover:bg-teal-400/25 disabled:opacity-35"
      >
        Check
      </button>
    </>
  );
}

function RecallRound({ round, onAnswer }: { round: Extract<GameRound, { kind: "recall" }>; onAnswer: Answer }) {
  const [text, setText] = useState("");

  const submit = () => {
    // Same rule the lecture's own checkpoints use: any ONE keyword set fully present counts. Graded
    // on meaning rather than wording, so a right answer phrased differently is still right.
    const lower = text.toLowerCase();
    const correct = round.acceptable.some((set) => set.every((k) => lower.includes(k.toLowerCase())));
    onAnswer({ correct, detail: correct ? undefined : round.reveal || undefined });
  };

  return (
    <>
      <h2 className="max-w-2xl text-center text-xl font-black leading-snug text-white">{round.prompt}</h2>
      <input
        data-game-input
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter" && text.trim()) submit(); }}
        placeholder="In your own words…"
        className="w-full max-w-xl rounded-xl border border-white/12 bg-black/40 px-4 py-3 text-sm text-white outline-none focus:border-teal-400/50"
      />
      <button
        data-game-submit
        disabled={!text.trim()}
        onClick={submit}
        className="rounded-full bg-teal-400/15 px-5 py-2 text-sm font-bold text-teal-200 ring-1 ring-teal-400/30 transition enabled:hover:bg-teal-400/25 disabled:opacity-35"
      >
        Answer
      </button>
    </>
  );
}

function OrderRound({ round, onAnswer }: { round: Extract<GameRound, { kind: "order" }>; onAnswer: Answer }) {
  const [built, setBuilt] = useState<string[]>([]);
  const remaining = round.shuffled.filter((t) => !built.includes(t));

  const submit = (final: string[]) =>
    onAnswer({
      correct: final.every((t, i) => t === round.correct[i]),
      detail: final.every((t, i) => t === round.correct[i]) ? undefined : round.correct.join("  →  "),
    });

  return (
    <>
      <h2 className="text-center text-xl font-black text-white">{round.prompt}</h2>
      <ol className="flex min-h-[2.5rem] w-full max-w-2xl flex-col gap-1.5">
        {built.map((t, i) => (
          <li key={t} className="rounded-lg bg-teal-400/12 px-3 py-2 text-sm text-teal-100 ring-1 ring-teal-400/25">
            {i + 1}. {t}
          </li>
        ))}
      </ol>
      <div className="flex w-full max-w-2xl flex-wrap justify-center gap-2">
        {remaining.map((t) => (
          <button
            key={t}
            data-game-option
            onClick={() => {
              const next = [...built, t];
              setBuilt(next);
              // Auto-submit on the last pick: an extra "Check" click after placing the final item is
              // a step with no decision in it.
              if (next.length === round.correct.length) submit(next);
            }}
            className="rounded-lg border border-white/12 bg-white/[0.04] px-3 py-2 text-sm text-white/85 transition hover:border-teal-400/40 hover:bg-teal-400/10"
          >
            {t}
          </button>
        ))}
      </div>
      {built.length > 0 && remaining.length > 0 && (
        <button onClick={() => setBuilt([])} className="text-[0.72rem] text-white/40 underline hover:text-white/70">
          start over
        </button>
      )}
    </>
  );
}

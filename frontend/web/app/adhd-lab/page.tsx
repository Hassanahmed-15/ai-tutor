"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { TeacherAvatar } from "@/components/TeacherAvatar";
import { FACE_SHAPES, expressionFor, type Expression } from "@/lib/adhd/expression";
import { initialFocus, type FocusTracker } from "@/lib/adhd/focusState";
import { FlappyGates } from "@/components/adhd/games/FlappyGates";
import { mcqForCheckpoint } from "@/lib/adhd/games/mcq";
import { beats } from "@/lib/lessonContent";

/**
 * `/adhd-lab` — every teacher expression at full size, with no camera and no lecture.
 *
 * The route's README reserved this page for "the first feature that needs it", and the avatar
 * redesign is it. Judging whether a face actually reads as furious rather than merely sleepy is
 * something only a person looking at it can decide, and reaching those states through a real
 * lecture means waiting for a real drift or deliberately skipping beats — slow, and not
 * reproducible.
 *
 * Deterministic: no model call, no webcam, no audio. A Playwright run screenshots this and
 * measures the renderer and nothing else.
 *
 *   ?size=220     render larger, for judging line weights
 *   ?game=1       fly a real checkpoint question, with no lecture around it
 *
 * The game section is here for the same reason as the faces: whether a round FEELS good — whether
 * the tiles fall at a readable speed, whether the bins are legible, whether a miss stings — is not
 * something any assertion can settle, and reaching it through a live lecture means sitting through
 * eight beats first.
 */

/** Every expression, with the state that produces it — so the mapping is visible, not just the art. */
const CASES: { expression: Expression; when: string }[] = [
  { expression: "happy", when: "engagement high (hyperfocus)" },
  { expression: "delighted", when: "flash: answered correctly" },
  { expression: "pleased", when: "streak of 3+, no camera" },
  { expression: "neutral", when: "resting" },
  { expression: "bored", when: "focus drifting" },
  { expression: "tired", when: "crashed out of hyperfocus" },
  { expression: "sad", when: "flash: left a checkpoint unanswered" },
  { expression: "furious", when: "flash: skipped a beat" },
];

/** The three the brief names explicitly, checked through the real mapping rather than by hand. */
const MAPPING_CHECKS: { label: string; got: Expression; want: Expression }[] = [
  {
    label: "engagement high",
    got: expressionFor({ focus: { ...initialFocus(), state: "hyperfocus" } as FocusTracker, streak: 0 }),
    want: "happy",
  },
  {
    label: "question unanswered",
    got: expressionFor({ focus: initialFocus(), streak: 0, flash: "unanswered" }),
    want: "sad",
  },
  {
    label: "beat skipped",
    got: expressionFor({ focus: initialFocus(), streak: 0, flash: "skipped" }),
    want: "furious",
  },
];

function AdhdLab() {
  const [speaking, setSpeaking] = useState(false);
  const [lastResult, setLastResult] = useState<string | null>(null);
  // via useSearchParams, not window.location: reading location during render makes the server and
  // client disagree about `size`, which React reports as a hydration mismatch.
  const params = useSearchParams();
  const size = Number(params.get("size") || 150);
  const showGame = params.get("game") === "1";
  /*
   * Prefer a `compare` beat: it produces two genuinely named bins ("Photosynthesis (plant)" vs
   * "Respiration (you)") rather than the topic-vs-"Elsewhere" fallback, so the lab shows the
   * mechanic at its best rather than at its most degraded. Falls back to whatever is playable.
   */
  // The first fixture beat that carries a real checkpoint — the same call the player makes.
  const gameMcq = beats.map((b, i) => mcqForCheckpoint(b, beats, i + 1)).find(Boolean) ?? null;

  return (
    <main className="min-h-screen bg-slate-950 p-8 text-slate-200">
      <h1 className="text-xl font-black">ADHD lab — teacher expressions</h1>
      <p className="mt-1 text-sm text-slate-400">
        Deterministic. No camera, no lecture, no model call.
      </p>

      <label className="mt-4 inline-flex cursor-pointer items-center gap-2 text-sm">
        <input type="checkbox" checked={speaking} onChange={(e) => setSpeaking(e.target.checked)} />
        speaking (mouth follows live audio, so it rests open here)
      </label>

      {/*
        The mapping the brief actually specified, run through `expressionFor` rather than restated.
        A lab page that hardcoded the faces could look perfect while the real mapping was wrong.
      */}
      <ul className="mt-4 flex flex-wrap gap-3 text-xs">
        {MAPPING_CHECKS.map((c) => (
          <li
            key={c.label}
            className={`rounded-full px-3 py-1 font-bold ${
              c.got === c.want ? "bg-emerald-500/15 text-emerald-300" : "bg-red-500/20 text-red-300"
            }`}
          >
            {c.label} → {c.got}
            {c.got !== c.want && ` (expected ${c.want})`}
          </li>
        ))}
      </ul>

      {showGame && (
        <section className="mt-8">
          <h2 className="text-sm font-black uppercase tracking-[0.15em] text-teal-300">Flappy Gates</h2>
          <p className="mt-1 text-[12px] text-slate-400">
            Built by <code>mcqForCheckpoint</code> from a real lesson beat — the same call the player makes.
            Tap or press space to fly.
          </p>
          <div className="mt-4 h-[560px] w-full max-w-[900px] overflow-hidden rounded-2xl border border-white/10">
            {gameMcq ? (
              <FlappyGates mcq={gameMcq} onDone={(correct) => setLastResult(correct ? "correct" : "wrong")} />
            ) : (
              <p className="p-6 text-slate-400">No beat in the fixture carries a checkpoint.</p>
            )}
          </div>
          <p className="mt-2 text-[12px] text-slate-500" data-lab-game-result>
            last run: {lastResult ?? "—"}
          </p>
        </section>
      )}

      <div className="mt-8 flex flex-wrap gap-6">
        {CASES.map(({ expression, when }) => (
          <figure
            key={expression}
            data-expression={expression}
            className="flex w-[190px] flex-col items-center rounded-2xl border border-white/10 bg-slate-900/60 p-4"
          >
            <TeacherAvatar speaking={speaking} size={size} expression={expression} />
            <figcaption className="mt-3 text-center">
              <p className="text-sm font-black">{expression}</p>
              <p className="text-[11px] leading-tight text-slate-400">{when}</p>
              <p className="mt-1 text-[10px] text-slate-600">
                tilt {FACE_SHAPES[expression].tilt}° · specs +{FACE_SHAPES[expression].glasses}
              </p>
            </figcaption>
          </figure>
        ))}
      </div>
    </main>
  );
}

export default function Page() {
  return (
    <Suspense fallback={null}>
      <AdhdLab />
    </Suspense>
  );
}

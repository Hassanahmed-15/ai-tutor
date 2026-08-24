"use client";

import { useEffect, useState } from "react";

/**
 * The check-in. Shown when a run of skipped beats says the learner has stopped watching.
 *
 * WHY THERE IS NO DISMISS BUTTON. This is the one overlay in the app that the learner cannot click
 * past, and that is the entire feature: someone who has skipped three beats in a row will skip a
 * fourth thing, and a "not now" button is a fourth thing. The lecture comes back when they say so
 * OUT LOUD, to Aria, which is a lower bar than it sounds — "yeah, okay" clears it — but it is a bar
 * that requires them to actually be here.
 *
 * WHY IT IS STILL NOT A TRAP. Two escapes exist and both are deliberate:
 *   - `fallback` renders a manual button. It is shown only when the live session could not be
 *     established at all (no key, mic refused, socket dead). Without it a broken microphone would
 *     brick the lesson behind an overlay that can never be satisfied, which is not a design choice,
 *     it is a bug with a rationale attached.
 *   - Nothing here traps the browser. Reload, back, and closing the tab all work, and the lecture
 *     does not resume itself on a timer either way.
 *
 * WHY THE TIMER IS NOT A COUNTDOWN TO A BUTTON. `phase` goes "chatting" then "closing", and the
 * visible difference is only what the caption says. The two minutes gate when ARIA is allowed to
 * invite them back, not when the overlay unlocks — a visible countdown to a dismiss control would
 * just be watched instead of talked through.
 *
 * The motion here is a single one-shot fade, matching FocusPauseOverlay: no ambient or looping
 * animation, which would compete with the attention monitor's gaze signal.
 */
export function CheckinOverlay({
  phase,
  fallback,
  speaking,
  transcript,
  muted,
  onToggleMute,
  onManualResume,
  accentVar = "var(--accent-adhd)",
  accentBrightVar = "var(--accent-adhd-bright)",
  accentGlowVar = "var(--accent-adhd-glow)",
}: {
  /** "chatting" while the two-minute floor runs; "closing" once Aria may invite them back. */
  phase: "chatting" | "closing";
  /** The live session is unavailable — offer the manual way back instead of soft-locking forever. */
  fallback: boolean;
  speaking: boolean;
  /** The last thing either of them said, so the learner can see the mic is actually working. */
  transcript: string | null;
  /**
   * Mute lives HERE and nowhere else during a check-in.
   *
   * The lesson's own mute button is behind this overlay, and it was never safe anyway: muting
   * removes the only exit — speaking to Aria — while the overlay stays un-dismissable, and the
   * fallback never fires because the session is still healthily `live`. Offering it here keeps the
   * learner in control of their microphone without that becoming a way to get stuck.
   */
  muted: boolean;
  onToggleMute: () => void;
  onManualResume: () => void;
  accentVar?: string;
  accentBrightVar?: string;
  accentGlowVar?: string;
}) {
  return (
    <div className="beat-fade-in absolute inset-0 z-[80] grid place-items-center bg-slate-950/95 p-10 text-center backdrop-blur-md">
      <div className="max-w-xl">
        <p className="hud-eyebrow text-[0.7rem] tracking-[0.2em]" style={{ color: accentVar }}>
          {fallback ? "Taking a break" : speaking ? "Aria is talking" : "Aria is listening"}
        </p>

        <p className="mx-auto mt-5 text-4xl font-black leading-tight text-white">
          {fallback
            ? "Let’s take a breather."
            : phase === "chatting"
              ? "Let’s talk about something else for a minute."
              : "Whenever you’re ready."}
        </p>

        <p className="mt-6 text-lg font-bold text-white/55">
          {fallback
            ? "The lecture is paused. Take a moment, then pick it back up whenever you want."
            : phase === "chatting"
              ? "The lecture’s paused — no rush. Just talk to Aria."
              : "Tell Aria when you want to carry on and the lecture picks up where it left off."}
        </p>

        {!fallback && (
          <>
            <Dots active={!speaking} accentVar={accentVar} />
            {transcript && (
              <p className="mx-auto mt-5 max-w-lg text-base font-semibold italic text-white/40">“{transcript}”</p>
            )}
            {/* The ONLY control here. Nothing that ends the session or touches the lecture — the way
                out is agreeing out loud, and a button would just be a fourth thing to skip. */}
            <button
              onClick={onToggleMute}
              aria-pressed={muted}
              className={`mt-7 rounded-full border px-5 py-2 text-sm font-bold transition ${
                muted
                  ? "border-rose-400/40 bg-rose-500/15 text-rose-200"
                  : "border-white/15 bg-white/5 text-white/60 hover:text-white/85"
              }`}
            >
              {muted ? "🔇 Mic off — tap to talk" : "🎙 Mic on"}
            </button>
          </>
        )}

        {/* Only ever rendered when the conversation itself is impossible. See the header note. */}
        {fallback && (
          <button
            onClick={onManualResume}
            className="mt-8 rounded-full px-9 py-3.5 text-lg font-black text-slate-950 transition"
            style={{
              background: `linear-gradient(to right, ${accentBrightVar}, ${accentVar})`,
              boxShadow: `0 0 36px ${accentGlowVar}`,
            }}
          >
            Resume lecture ▶
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * Three dots that fill in sequence — the "your mic is on and nothing is broken" signal.
 *
 * Driven by a 420ms interval rather than a CSS keyframe loop because it must STOP while Aria is
 * speaking: a listening indicator that animates through her turn is telling the learner to talk over
 * her, which is exactly the collision the whole voice pipeline exists to prevent.
 */
function Dots({ active, accentVar }: { active: boolean; accentVar: string }) {
  const [lit, setLit] = useState(0);

  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setLit((n) => (n + 1) % 4), 420);
    return () => clearInterval(id);
  }, [active]);

  return (
    <div className="mt-8 flex justify-center gap-2.5" aria-hidden>
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="h-2.5 w-2.5 rounded-full transition-opacity duration-300"
          style={{
            background: accentVar,
            opacity: active ? (i < lit ? 1 : 0.2) : 0.55,
          }}
        />
      ))}
    </div>
  );
}

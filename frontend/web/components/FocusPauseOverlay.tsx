"use client";

/**
 * Shown when sustained attention drift is detected: freezes the board behind a dimming overlay.
 * During the hold ("stopped") it just says the lecture paused; once the hold elapses ("ready") it
 * offers a Resume button — the lecture only continues on an explicit click, never automatically.
 *
 * A single one-shot fade-in is fine here (it plays once per pause, not on a loop) — no ambient or
 * infinite motion, which would compete with the attention monitor's gaze/blink signal.
 */
export function FocusPauseOverlay({
  state,
  onResume,
  accentVar = "var(--accent-adhd)",
  accentBrightVar = "var(--accent-adhd-bright)",
  accentGlowVar = "var(--accent-adhd-glow)",
}: {
  state: "stopped" | "ready";
  onResume: () => void;
  accentVar?: string;
  accentBrightVar?: string;
  accentGlowVar?: string;
}) {
  return (
    <div className="beat-fade-in absolute inset-0 z-50 grid place-items-center bg-[var(--hud-surface)] p-10 text-center backdrop-blur-md">
      <div>
        <p className="hud-eyebrow text-[0.7rem] tracking-[0.2em]" style={{ color: accentVar }}>
          Focus check
        </p>
        <p className="mx-auto mt-5 max-w-xl text-4xl font-black leading-tight text-[var(--hud-text)]">
          Looks like your focus drifted — the lecture is paused.
        </p>
        {state === "stopped" ? (
          <p className="mt-6 text-lg font-bold text-[var(--hud-text-dim)]">Take a breather… hang tight for a moment.</p>
        ) : (
          <button
            onClick={onResume}
            className="mt-8 rounded-full px-9 py-3.5 text-lg font-black text-[var(--accent-on)] transition"
            style={{
              background: accentVar,
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

"use client";

/**
 * The real entry point to the platform now: before anything else, ask who's here.
 * "Blind" routes to a genuinely different, audio-first player (BlindLessonPlayer). "ADHD"
 * routes to the same visual lecture plus real camera-based attention monitoring
 * (AdhdLessonPlayer). "Autism" routes to a predictability/structure track
 * (AutismLessonPlayer: Now/Next/Later schedule, literal breakdowns, sensory warnings).
 * "Dyslexia" routes to a reading-light track (DyslexiaLessonPlayer: dyslexia-friendly font,
 * short-chunk rewrites with icons, audio-led delivery). "Dysgraphia" routes to a
 * speak-don't-write track (DysgraphiaLessonPlayer: voice input + AI scribe that organizes
 * spoken answers into clean written notes). All five disability tracks are now built.
 */
export type DisabilityChoice = "none" | "blind" | "adhd" | "autism" | "dyslexia" | "dysgraphia";

const OPTIONS: { value: DisabilityChoice; label: string; hint: string; ready: boolean }[] = [
  { value: "none", label: "No disabilities", hint: "The full visual experience", ready: true },
  { value: "blind", label: "Blind", hint: "Audio-first: spoken visuals, sonic cues, full keyboard control", ready: true },
  { value: "adhd", label: "ADHD", hint: "Camera-based attention tracking: auto-pauses and re-chunks content when focus drifts", ready: true },
  { value: "autism", label: "Autism", hint: "Predictable structure: Now/Next/Later schedule, literal step-by-step breakdowns, sensory warnings", ready: true },
  { value: "dyslexia", label: "Dyslexia", hint: "Reading-light: dyslexia-friendly font, short-chunk rewrites with icons, audio-led delivery", ready: true },
  { value: "dysgraphia", label: "Dysgraphia", hint: "Speak, don't write: an AI scribe organizes your spoken answers into clean notes", ready: true },
];

export function DisabilitySelect({ onSelect }: { onSelect: (choice: DisabilityChoice) => void }) {
  return (
    <main className="relative min-h-screen overflow-hidden bg-[#05040c] text-white">
      <div
        className="pointer-events-none absolute -left-40 -top-40 h-[560px] w-[560px] rounded-full opacity-60 blur-3xl"
        style={{ background: "radial-gradient(circle, rgba(99,102,241,0.55), transparent 65%)" }}
      />
      <div
        className="pointer-events-none absolute -bottom-52 -right-32 h-[600px] w-[600px] rounded-full opacity-50 blur-3xl"
        style={{ background: "radial-gradient(circle, rgba(217,70,239,0.42), transparent 65%)" }}
      />

      <div className="relative z-10 mx-auto flex min-h-screen max-w-4xl flex-col items-center justify-center px-6 py-16 text-center">
        <span className="grid size-12 place-items-center rounded-2xl bg-gradient-to-br from-indigo-500 to-fuchsia-500 text-lg font-black">A</span>
        <h1 className="mt-6 text-4xl font-black tracking-tight sm:text-5xl">Before we start — how should Aria teach you?</h1>
        <p className="mt-4 max-w-xl text-lg font-medium text-white/60">
          Tell us if you have a disability so the lesson can be built around how you actually learn best.
        </p>

        <div
          role="radiogroup"
          aria-label="Select a disability, or none, to personalize how the lesson is taught"
          className="mt-10 grid w-full gap-3 sm:grid-cols-2"
        >
          {OPTIONS.map((opt) => (
            <button
              key={opt.value}
              role="radio"
              aria-checked="false"
              onClick={() => onSelect(opt.value)}
              className="group relative flex flex-col items-start gap-1 rounded-2xl border border-white/10 bg-white/[0.04] p-5 text-left transition hover:border-indigo-400/50 hover:bg-white/[0.08] focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-400"
            >
              <span className="flex w-full items-center justify-between">
                <span className="text-lg font-black">{opt.label}</span>
                {opt.ready && (
                  <span className="rounded-full bg-emerald-500/15 px-2.5 py-0.5 text-[10px] font-black uppercase tracking-wide text-emerald-300">
                    Built
                  </span>
                )}
                {!opt.ready && (
                  <span className="rounded-full bg-white/10 px-2.5 py-0.5 text-[10px] font-black uppercase tracking-wide text-white/40">Soon</span>
                )}
              </span>
              <span className="text-sm font-semibold text-white/50">{opt.hint}</span>
            </button>
          ))}
        </div>

        <p className="mt-8 text-sm font-semibold text-white/35">You can change this later — nothing here is permanent.</p>
      </div>
    </main>
  );
}

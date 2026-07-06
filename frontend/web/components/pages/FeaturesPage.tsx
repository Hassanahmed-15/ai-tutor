"use client";

import { HudPage, HudEyebrow, HudButton, HudPanel, type PageName } from "@/components/hud/HudKit";

/**
 * How it works — a walkthrough of the real capabilities (live whiteboard, warm voice,
 * attention camera, AI scribe, etc.), each as an alternating editorial section. Content only.
 */
const FEATURES: { eyebrow: string; title: string; body: string; glyph: string; accent: string }[] = [
  {
    eyebrow: "The board",
    title: "Drawn live, stroke by stroke",
    body: "Concepts aren't dropped onscreen as finished slides — they're sketched in real time on a hand-drawn whiteboard, each shape appearing exactly as the teacher describes it, so the picture builds in your mind as fast as it builds on the screen.",
    glyph: "✎",
    accent: "#c9a86a",
  },
  {
    eyebrow: "The voice",
    title: "A teacher, not a reader",
    body: "Narration is warm and paced — it pauses at the right moments, emphasizes what matters, and carries the lesson the way a person would. When the device's own voice fails, a cloud voice steps in seamlessly so the lesson never goes silent.",
    glyph: "♪",
    accent: "#818cf8",
  },
  {
    eyebrow: "The camera",
    title: "Attention, noticed gently",
    body: "For the ADHD mode, a face-tracking model runs entirely on your device and watches engagement in real time. The instant focus drifts below threshold, the lesson stops and waits — no penalty, no lost place, just a calm pause until you're back.",
    glyph: "◎",
    accent: "#f472b6",
  },
  {
    eyebrow: "The scribe",
    title: "Speak it; it gets written",
    body: "For dysgraphia, the hard part isn't knowing the answer — it's getting it onto the page. So you just talk it through, rambling and all, and an AI scribe restructures your spoken thought into a clean, organized written note, removing filler and fixing the order.",
    glyph: "✦",
    accent: "#c084fc",
  },
  {
    eyebrow: "The translation",
    title: "Every sense, served",
    body: "A diagram becomes spoken structure and sonic cues for a blind learner; a dense paragraph becomes short icon-paired lines in a dyslexia-friendly font; a vague instruction becomes a literal checklist with a Now / Next / Later schedule. The same lesson, rendered for the channel that reaches you.",
    glyph: "❧",
    accent: "#34d399",
  },
];

export function FeaturesPage({ go, onStart }: { go: (p: PageName) => void; onStart: () => void }) {
  return (
    <HudPage current="features" go={go} onStart={onStart}>
      <section className="mx-auto max-w-5xl px-6 pt-12">
        <div className="text-center">
          <HudEyebrow>How it works</HudEyebrow>
          <h1 className="mt-5 font-display text-5xl font-light leading-tight sm:text-6xl">
            Five quiet pieces of <span className="hud-text-glow italic">craft.</span>
          </h1>
          <p className="mx-auto mt-5 max-w-xl text-[var(--hud-text-dim)]">
            Underneath the calm surface, Aria is doing real work — drawing, speaking, watching,
            writing, and translating the same lesson into whatever form fits you.
          </p>
        </div>

        <div className="mt-20 space-y-20">
          {FEATURES.map((f, i) => (
            <div
              key={f.title}
              className={`hud-materialize grid items-center gap-10 md:grid-cols-2 ${i % 2 === 1 ? "md:[&>*:first-child]:order-2" : ""}`}
            >
              {/* text */}
              <div>
                <p className="hud-eyebrow" style={{ color: f.accent }}>{f.eyebrow}</p>
                <h2 className="mt-4 font-display text-3xl leading-tight text-[var(--hud-text)] sm:text-4xl">{f.title}</h2>
                <p className="mt-5 leading-8 text-[var(--hud-text-dim)]">{f.body}</p>
              </div>
              {/* ornament */}
              <HudPanel className="grid aspect-[4/3] place-items-center overflow-hidden">
                <div
                  className="pointer-events-none absolute inset-0 opacity-30 blur-2xl"
                  style={{ background: `radial-gradient(circle at 50% 40%, ${f.accent}, transparent 65%)` }}
                />
                <span className="hud-float relative text-7xl" style={{ color: f.accent }}>{f.glyph}</span>
                <span className="absolute bottom-4 right-5 font-display text-7xl text-white/5">{i + 1}</span>
              </HudPanel>
            </div>
          ))}
        </div>

        <div className="mt-24 text-center">
          <HudButton onClick={() => go("tracks")} className="px-9 py-4 text-base">
            Try it yourself →
          </HudButton>
        </div>
      </section>
    </HudPage>
  );
}

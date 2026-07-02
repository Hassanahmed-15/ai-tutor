"use client";

import { HudPage, HudEyebrow, HudButton, HudDivider, HudPanel, type PageName } from "@/components/hud/HudKit";

/**
 * The manifesto — an editorial, soulful page on why Aria exists. Big serif, generous
 * whitespace, gold rules. Pure content; no app logic.
 */
export function AboutPage({ go, onStart }: { go: (p: PageName) => void; onStart: () => void }) {
  return (
    <HudPage current="about" go={go} onStart={onStart}>
      <article className="mx-auto max-w-3xl px-6 pt-12">
        <header className="text-center">
          <HudEyebrow>The manifesto</HudEyebrow>
          <h1 className="mt-6 font-display text-5xl font-light leading-[1.05] sm:text-6xl">
            One lesson.
            <br />
            <span className="hud-text-glow italic">Many minds.</span>
          </h1>
        </header>

        <HudDivider />

        <div className="mt-10 space-y-8 text-lg font-light leading-9 text-[var(--hud-text-dim)]">
          <p className="hud-materialize">
            <span className="float-left mr-3 font-display text-6xl leading-[0.8] text-[var(--hud-cyan)]">F</span>
            or most of history, education has had one shape, and the learner was expected to fit it.
            Read the dense paragraph. Watch the busy slide. Keep up with the pace. Write it down
            neatly. If that shape didn&rsquo;t fit your mind, the gap was treated as your problem to
            solve.
          </p>
          <p className="hud-materialize" style={{ animationDelay: "0.1s" }}>
            We think that&rsquo;s backwards. A difference in how you process text, or sound, or
            attention, or motor control is not a deficit in understanding. The understanding is
            already there. What&rsquo;s missing is a lesson willing to meet it.
          </p>

          <blockquote className="hud-materialize border-l-2 border-[var(--hud-cyan)] pl-6 font-display text-2xl italic leading-snug text-[var(--hud-text)]">
            Aria is built on one belief: the lesson should bend to the learner — not the other way
            around.
          </blockquote>

          <p className="hud-materialize" style={{ animationDelay: "0.1s" }}>
            So we built a single lesson that can become six different experiences without losing its
            soul. For a blind student, every drawing is spoken as a structural picture and marked
            with sound. For someone with ADHD, a camera quietly notices when focus slips and gives a
            gentle, judgment-free pause. For dyslexia, dense text dissolves into short spoken lines.
            For dysgraphia, you simply talk, and a scribe writes it down, organized.
          </p>
          <p className="hud-materialize" style={{ animationDelay: "0.15s" }}>
            None of these are separate apps or watered-down versions. They are the same teacher,
            the same content, the same care — rendered through whichever channel reaches you best.
          </p>
        </div>

        <div className="mt-16 grid gap-6 sm:grid-cols-3">
          {[
            { k: "Dignity", v: "Adaptation without condescension. The full lesson, never a lesser one." },
            { k: "On-device", v: "The attention camera and voice processing stay on your machine." },
            { k: "Honesty", v: "We tell you what's real, what's simulated, and what it costs to run." },
          ].map((v, i) => (
            <div key={v.k} className="hud-materialize" style={{ animationDelay: `${i * 0.08}s` }}>
              <HudPanel className="p-6">
                <p className="font-display text-xl text-[var(--hud-cyan)]">{v.k}</p>
                <p className="mt-2 text-sm leading-6 text-[var(--hud-text-dim)]">{v.v}</p>
              </HudPanel>
            </div>
          ))}
        </div>

        <div className="mt-16 text-center">
          <HudButton onClick={() => go("tracks")} className="px-9 py-4 text-base">
            Choose your mode →
          </HudButton>
        </div>
      </article>
    </HudPage>
  );
}

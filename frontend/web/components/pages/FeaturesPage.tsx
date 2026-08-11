"use client";

import { HudPage, HudButton, type PageName } from "@/components/hud/HudKit";

/**
 * THE CRAFT — five specimen lines.
 *
 * The predecessor ran five sections in five accent colours with a paragraph each, two of them
 * describing mode-only behaviour that is no longer reachable. This is the same information at a
 * tenth of the length: what it is, and the one technical fact that makes it true.
 */
const CRAFT = [
  ["01", "Four engines", "Chart, proof, graph, or drawing — chosen per idea, not per lecture."],
  ["02", "Drawn, not shown", "Each stroke lands as its sentence is spoken."],
  ["03", "A critic that looks", "Boards are rendered, examined as images, and refused if unclear."],
  ["04", "Your document", "Figures cropped from your pages, not invented from memory."],
  ["05", "A real examination", "Marked against meaning. Rubric, not string-match."],
];

export function FeaturesPage({ go, onStart }: { go: (p: PageName) => void; onStart: () => void }) {
  return (
    <HudPage current="features" go={go} onStart={onStart}>
      <section className="mx-auto max-w-4xl px-6 pt-24">
        <h1 className="hud-materialize font-display text-[3rem] leading-[0.94] tracking-[-0.035em] text-[var(--hud-text-dim)] sm:text-[4.6rem]">
          Five decisions that
          <br />
          took the <span className="text-[var(--hud-text)]">longest.</span>
        </h1>
      </section>

      <section className="mx-auto max-w-4xl px-6 pt-16">
        {CRAFT.map(([n, title, body], i) => (
          <article
            key={n}
            className="hud-materialize grid grid-cols-[3.5rem_1fr] gap-6 border-t border-[var(--hud-line)] py-9"
            style={{ animationDelay: `${0.05 * i}s` }}
          >
            <span className="hud-eyebrow pt-2 text-[var(--hud-cyan)]">{n}</span>
            <div>
              <h2 className="font-display text-[1.9rem] leading-tight tracking-[-0.015em]">{title}</h2>
              <p className="mt-2.5 max-w-lg text-[0.95rem] leading-[1.7] text-[var(--hud-text-dim)]">{body}</p>
            </div>
          </article>
        ))}
        <hr className="hud-rule" />
      </section>

      <section className="mx-auto max-w-4xl px-6 pt-16">
        <HudButton onClick={() => go("learn")} className="px-9 py-4">
          Begin
        </HudButton>
      </section>
    </HudPage>
  );
}

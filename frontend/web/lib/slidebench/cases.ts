/**
 * THE TEST CASES, and the one prompt every model is given.
 *
 * COMPARABILITY IS THE WHOLE POINT. The production rotation gives different beats to different
 * models, so a model can look good by drawing easy ones — that is exactly why
 * `scripts/compare-animation-models.mjs` exists in head-to-head form. This harness inherits that
 * rule and tightens it: every contestant receives a byte-identical prompt for a given case, built
 * by `slidePrompt()` below, with no per-provider wording. If a provider needs different framing to
 * do well, that is a finding about the provider, not a reason to change its prompt.
 *
 * The cases deliberately span the axes a slide generator is actually judged on:
 *   - PHYSICAL vs ABSTRACT, because the vision judge only scores physical subjects (an abstract
 *     timeline is wrongly condemned for not looking like a thing) — see reactAnimationVisionCritic.
 *   - SEQUENCE vs STATE, because an animation that must show a process over time is a different
 *     problem from one that must show a labelled arrangement.
 */

export interface SlideBenchCase {
  id: string;
  title: string;
  /** What the slide must teach. The single most important string in the harness. */
  teachingPoint: string;
  /** The narration the board is drawn against, sentence by sentence. */
  script: string;
  /** Physical subjects get a vision score; abstract ones are judged on the other axes only. */
  physical: boolean;
  /** Why this case is in the set, for the report's methodology section. */
  rationale: string;
}

export const SLIDE_BENCH_CASES: SlideBenchCase[] = [
  {
    id: "photosynthesis",
    title: "How a leaf turns light into sugar",
    teachingPoint:
      "Sunlight hits the chloroplast, water arrives from the roots and carbon dioxide from the air, and the leaf builds sugar while releasing oxygen.",
    script:
      "A leaf is a factory that runs on light. Sunlight strikes the chloroplasts packed inside the leaf's cells. Water climbs in through the roots and carbon dioxide slips in through tiny pores on the underside. Inside the chloroplast those three are rearranged into sugar, and oxygen is left over and pushed back out.",
    physical: true,
    rationale: "Physical, multi-input process. Tests whether parts are recognisable AND correctly connected.",
  },
  {
    id: "binary-search",
    title: "Why binary search halves the problem",
    teachingPoint:
      "Each comparison discards half the remaining range, so a sorted list of a million items is searched in about twenty steps.",
    script:
      "Binary search looks at the middle of a sorted range. If the target is smaller, the whole upper half is gone. If it is larger, the lower half is gone. Every single comparison throws away half of what is left, which is why a million items take only about twenty steps.",
    physical: false,
    rationale: "Abstract and sequential. Tests layout of a repeating process with no real-world shape to copy.",
  },
  {
    id: "heart-circulation",
    title: "The two loops of the heart",
    teachingPoint:
      "The right side pumps blood to the lungs to collect oxygen, and the left side pumps that oxygenated blood to the rest of the body.",
    script:
      "The heart is two pumps side by side. The right side takes blood returning from the body and sends it to the lungs. There it drops carbon dioxide and picks up oxygen. It comes back to the left side, which pushes it out to every other organ. Two loops, one muscle, beating together.",
    physical: true,
    rationale: "Physical with a strict spatial relationship — a swapped left/right is a content error a pretty board can hide.",
  },
];

/**
 * The prompt. One function, so every model provably receives the same text.
 *
 * Returns the full instruction rather than a fragment, because a harness that assembles prompts
 * differently per provider cannot claim its comparison is fair. The React contract described here
 * mirrors what `lib/reactAnimationGen.ts` asks of production models, so a bench result means
 * something about how the model would behave in the real pipeline.
 */
export function slidePrompt(testCase: SlideBenchCase): string {
  return [
    "Write a single self-contained React component that teaches one idea as an animated lecture slide.",
    "",
    `TITLE: ${testCase.title}`,
    `WHAT IT MUST TEACH: ${testCase.teachingPoint}`,
    `NARRATION IT IS DRAWN AGAINST: ${testCase.script}`,
    "",
    "HARD REQUIREMENTS:",
    "1. Export default a function component named Animation taking a single prop { progress }, a number from 0 to 1.",
    "2. Drive EVERY motion from `progress`. No setState, no useEffect, no timers, no requestAnimationFrame — the caller owns the clock and scrubs it backwards as well as forwards.",
    "3. Render inline SVG with viewBox=\"0 0 1000 560\". No external images, no network, no imports beyond React.",
    "4. Label the parts with <text>. A viewer who cannot hear the narration must still be able to name what they are looking at.",
    "5. The drawing must be recognisable as the real subject, in correct proportion and arrangement — not abstract boxes standing in for it.",
    "6. Reveal progressively: at progress=0 almost nothing is drawn, at progress=1 the whole picture is complete and readable.",
    "",
    "Return ONLY the component source code. No markdown fences, no prose, no explanation.",
  ].join("\n");
}

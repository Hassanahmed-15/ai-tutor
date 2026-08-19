import type { Beat } from "../../lessonContent";

/**
 * The contract between lesson content and the game engine.
 *
 * THIS IS THE "CONSTRAINED API" THE DESIGN RESTS ON. The evidence on LLM-authored games is that the
 * state of the art reaches roughly 20% actually-playable in three attempts, because a model cannot
 * run what it writes. So the model never writes game code: it fills in a small, validated JSON shape
 * and a hand-built engine plays it. Variety comes from the model, quality stays ours.
 *
 * For now the spec is DERIVED from fields the generator already emits — no model call at all. That
 * keeps the format honest: if it cannot be built from real lesson content it is the wrong format,
 * and finding that out costs nothing today rather than a prompt-tuning cycle later.
 */

export type SorterSpec = {
  mechanic: "sorter";
  beatId: string;
  /** Shown on the start card, so the learner knows what they are sorting before it starts falling. */
  title: string;
  /** Exactly two, because a paddle has two sides. */
  bins: [string, string];
  /** Every item must belong to one bin; the engine never invents one. */
  items: { text: string; bin: 0 | 1 }[];
};

export type GameSpec = SorterSpec;

export const SPEC_RULES = {
  /** Below this there is no run, just a couple of taps. */
  MIN_ITEMS: 4,
  /** Above this the round outlasts the learner's patience and the beat it belongs to. */
  MAX_ITEMS: 10,
  /** An item longer than this cannot be read while it is falling. */
  MAX_ITEM_CHARS: 46,
  /*
   * 30, measured against the real fixture rather than guessed.
   *
   * At 22 only 1 of 12 beats stayed playable: actual titles run 11-38 characters and perfectly good
   * labels like "Where the cooking happens" (25) were being rejected. 30 keeps those and still
   * rejects "Why this one kitchen matters this much" (38), which is a heading, not a category.
   */
  MAX_BIN_CHARS: 30,
} as const;

/** Mulberry32, matching gameRouting.ts — a seeded round is a round a test can replay. */
function rng(seed: number): () => number {
  let a = seed || 1;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(items: T[], next: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

const clean = (s: string | undefined): string => (s ?? "").replace(/\s+/g, " ").trim();

/** Trim a label to something readable on a falling tile, on a word boundary where possible. */
function fit(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const space = cut.lastIndexOf(" ");
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

/**
 * Build a playable spec for `beat`, or null when its content will not support one.
 *
 * NULL IS A FIRST-CLASS RESULT and the most important behaviour here — the same call
 * `gameRouting.ts` makes. A round with two items, or with one empty bin, is not a hard game; it is a
 * broken one, and it is worse than falling back to the narrated slide the lesson already renders.
 */
export function specForBeat(beat: Beat, allBeats: Beat[], seed: number): GameSpec | null {
  const next = rng(seed);

  /* A `compare` beat is already two labelled sides — the shape this mechanic was built around. */
  const left = beat.compareLeft;
  const right = beat.compareRight;
  if (left && right) {
    const leftPts = left.points.map(clean).filter(Boolean);
    const rightPts = right.points.map(clean).filter(Boolean);
    // BOTH sides must be populated. One empty side means every item belongs to the same bin, which
    // is not a sort — the learner would win by holding the paddle still.
    if (leftPts.length && rightPts.length) {
      const items = shuffle(
        [
          ...leftPts.map((text) => ({ text: fit(text, SPEC_RULES.MAX_ITEM_CHARS), bin: 0 as const })),
          ...rightPts.map((text) => ({ text: fit(text, SPEC_RULES.MAX_ITEM_CHARS), bin: 1 as const })),
        ],
        next,
      ).slice(0, SPEC_RULES.MAX_ITEMS);

      // Slicing can leave a bin empty, which would silently recreate the exact problem guarded
      // against above.
      if (items.length >= SPEC_RULES.MIN_ITEMS && items.some((i) => i.bin === 0) && items.some((i) => i.bin === 1)) {
        return {
          mechanic: "sorter",
          beatId: beat.id,
          title: clean(beat.title) || "Sort these",
          bins: [fit(clean(left.label) || "Left", SPEC_RULES.MAX_BIN_CHARS),
                 fit(clean(right.label) || "Right", SPEC_RULES.MAX_BIN_CHARS)],
          items,
        };
      }
    }
  }

  /*
   * Otherwise: this beat's own points against points borrowed from elsewhere in the lesson.
   *
   * "Belongs to this topic / does not" works for any beat that has points at all, which is what
   * gives the mechanic coverage across a real lecture rather than only its one `compare` beat. The
   * decoys are real sentences from the same lesson, which is what makes them plausible — a
   * generically wrong option is obvious on sight and teaches nothing.
   */
  /*
   * The bin label for this path is the beat's own title, so the title has to work AS a label.
   *
   * Found by looking at a screenshot: a beat titled "Why a leaf doesn't burn up in the sun" produced
   * a bin reading "Why a leaf doesn't…" against "Not this", which tells the learner nothing about
   * where anything belongs. A question is a heading, not a category. When the title cannot label a
   * bin, this returns null and the beat falls back to a round that does not need one.
   */
  const topic = clean(beat.title);
  if (!topic || topic.length > SPEC_RULES.MAX_BIN_CHARS || /[?]$/.test(topic)) return null;

  const mine = [...new Set(beat.points.map(clean).filter(Boolean))];
  if (mine.length < 2) return null;

  const elsewhere = [...new Set(
    allBeats
      .filter((b) => b.id !== beat.id)
      .flatMap((b) => b.points.map(clean))
      .filter((p) => p.length > 0 && !mine.includes(p)),
  )];
  if (elsewhere.length < 2) return null;

  const half = Math.floor(SPEC_RULES.MAX_ITEMS / 2);
  const items = shuffle(
    [
      ...shuffle(mine, next).slice(0, half).map((text) => ({ text: fit(text, SPEC_RULES.MAX_ITEM_CHARS), bin: 0 as const })),
      ...shuffle(elsewhere, next).slice(0, half).map((text) => ({ text: fit(text, SPEC_RULES.MAX_ITEM_CHARS), bin: 1 as const })),
    ],
    next,
  );
  if (items.length < SPEC_RULES.MIN_ITEMS) return null;
  // Defensive, and honestly unreachable as written: both bins are built from separate non-empty
  // sources above and nothing slices them afterwards, so no mutation of this line can fail a test.
  // Kept as a cheap invariant against a future edit that adds a slice here — which is exactly how
  // the compare path above got the same bug.
  if (!items.some((i) => i.bin === 0) || !items.some((i) => i.bin === 1)) return null;

  return {
    mechanic: "sorter",
    beatId: beat.id,
    title: clean(beat.title) || "Sort these",
    // "Elsewhere" rather than "Not this": the learner is deciding which part of the LESSON a line
    // came from, and the opposite of a named topic is another topic, not a negation.
    bins: [topic, "Elsewhere"],
    items,
  };
}

/** How many beats of a lesson this mechanic can actually play. Used to gate the games button. */
export function playableSpecCount(beats: Beat[], seed = 1): number {
  return beats.filter((b, i) => specForBeat(b, beats, seed + i) !== null).length;
}

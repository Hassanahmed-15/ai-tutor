/**
 * HOW MANY BOARDS A LECTURE HAS, AND HOW DEEPLY EACH ONE TEACHES.
 *
 * The old rule was `beatCountForDepth`: 6 beats for "concise", 8 for "balanced", 10 for "deep",
 * decided from a slider before anyone had looked at the topic. Three mechanisms then forced the
 * plan to hit that number, and together they are the whole reason lectures came out shallow and
 * repetitive:
 *
 *   1. A PADDING LOOP invented beats to reach the count — `"${subject}: idea 2"`, `"idea 3"` —
 *      each carrying the IDENTICAL objective string "Explain a distinct, useful part of X with a
 *      concrete example." Three beats, one instruction, three near-identical scripts.
 *   2. `polishBeatPlan` then renamed those duplicates to "Worked Example", "Common Pitfalls",
 *      "Concept Connections" — cosmetically distinct headings over byte-identical teaching
 *      instructions. That is why the repetition was hard to see: the titles diverge, the content
 *      does not.
 *   3. A `.slice(0, requested)` truncated genuinely good outlines, while the outline prompt was
 *      telling the planner "There is no maximum subtopic count". The two halves disagreed.
 *
 * And "deep" meant MORE BEATS rather than deeper ones — the exact inversion of what the word means
 * to a student, who gets ten shallow sections when they asked to go deep.
 *
 * THE RULE NOW: the topic decides how many concepts there are; the depth setting decides how long
 * we spend on each. A narrow topic gets three boards and teaches them thoroughly. A broad one gets
 * eight. Nothing is padded, and nothing is truncated to hit a number.
 */

/** What a depth setting buys: time on each concept, never more concepts. */
export interface DepthBudget {
  /**
   * Spoken words per board.
   *
   * The old ceiling was 95-130 words for "balanced" — about 40 seconds of speech, into which a
   * worked example plus its setup plus its interpretation does not fit. No instruction about depth
   * survives that ceiling; the model's only move inside it is to state a claim and restate it.
   *
   * Board dwell time is a pure function of this number (the player advances when narration ends
   * and has no other timer), so this doubles as the "keep a concept on the board for 30-90s"
   * control: 300 words is ~2 minutes at normal narration pace.
   */
  wordRange: [number, number];
  /** How many movements one board develops — intuition, mechanism, example, pitfall… */
  movements: [number, number];
  /** Roughly how long one board should hold, for the drawing timeline. */
  boardMs: number;
}

export type DepthLevelName = "concise" | "balanced" | "deep";

export function depthBudget(depth: string | undefined): DepthBudget {
  if (depth === "deep") {
    // ~2.5-3.5 minutes on one concept: intuition, mechanism, worked example, edge case, recap.
    return { wordRange: [380, 520], movements: [4, 6], boardMs: 150_000 };
  }
  if (depth === "concise") {
    // Still a real teaching unit — an idea, why it works, and one concrete instance.
    return { wordRange: [170, 240], movements: [2, 3], boardMs: 75_000 };
  }
  return { wordRange: [260, 360], movements: [3, 4], boardMs: 110_000 };
}

/**
 * The number of boards, from the concepts the planner actually found.
 *
 * `planned` is however many distinct concepts the outline identified. This function does not
 * invent, pad or truncate — it only guards against a planner that returned something absurd, and
 * the bounds are wide enough that a real plan always passes through untouched.
 */
export function boardCountFor(plannedConcepts: number): number {
  if (!Number.isFinite(plannedConcepts) || plannedConcepts <= 0) return 3;
  // A lecture of one board is a fragment; past a dozen nobody finishes. Neither bound is reached
  // by a sane plan — they exist so a malformed outline cannot produce a 40-board lecture.
  return Math.max(2, Math.min(12, Math.round(plannedConcepts)));
}

/**
 * Is this planned board actually a DIFFERENT concept from the ones before it?
 *
 * The cheap, deterministic half of anti-repetition: compare the significant words of the title and
 * objective against every earlier board. Two boards whose teaching instructions overlap this
 * heavily are the same concept wearing different headings, which is precisely what the padding
 * loop plus cosmetic renaming used to produce.
 *
 * Deliberately a SIGNAL, not a filter — it returns the overlap so the caller can merge or flag,
 * rather than silently dropping a board and leaving a hole in the lecture.
 */
export function conceptOverlap(
  candidate: { title: string; objective: string },
  earlier: Array<{ title: string; objective: string }>,
): { overlap: number; with: number } {
  const words = (entry: { title: string; objective: string }) =>
    new Set(
      `${entry.title} ${entry.objective}`
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((w) => w.length >= 4 && !STOPWORDS.has(w)),
    );
  const mine = words(candidate);
  if (mine.size === 0) return { overlap: 0, with: -1 };
  let worst = 0;
  let index = -1;
  earlier.forEach((other, i) => {
    const theirs = words(other);
    if (theirs.size === 0) return;
    let shared = 0;
    for (const w of mine) if (theirs.has(w)) shared += 1;
    // Jaccard-ish, normalised by the smaller set so a short title is not advantaged.
    const score = shared / Math.min(mine.size, theirs.size);
    if (score > worst) {
      worst = score;
      index = i;
    }
  });
  return { overlap: worst, with: index };
}

const STOPWORDS = new Set([
  "the", "and", "that", "this", "with", "from", "have", "what", "when", "where", "which", "there",
  "their", "about", "would", "could", "should", "into", "then", "than", "them", "they", "your",
  "just", "like", "also", "very", "really", "some", "more", "most", "such", "only", "over", "here",
  "does", "did", "was", "were", "been", "being", "will", "you", "for", "are", "not", "but", "all",
  "explain", "understand", "learn", "teach", "show", "using", "used", "make", "made", "part",
  "idea", "concept", "topic", "lesson", "section", "beat", "board",
]);

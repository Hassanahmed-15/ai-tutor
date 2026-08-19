import type { Beat } from "../lessonContent";

/**
 * Turns a lecture beat into a playable round.
 *
 * WHY THERE IS NO MODEL CALL HERE. The lesson generator already emits structured content — a
 * `definition` beat carries `definitionTerm` and `definitionMeaning`, a `compare` beat carries two
 * labelled sides, a `checkpoint` beat carries a prompt and acceptable answers. Every game below is
 * assembled from fields that already exist, so game mode adds no generation step, no latency and no
 * cost to a pipeline that reports its spend to the learner.
 *
 * PURE AND SEEDED, like `loot.ts` and `score.ts`. A round is a function of `(beat, allBeats, seed)`,
 * so a test can replay an exact round instead of clicking through a lecture and hoping.
 *
 * RETURNING NULL IS A FIRST-CLASS RESULT, and the most important behaviour in this file. A generated
 * lesson can ship a `definition` beat with no `definitionMeaning`, or a `compare` beat with one
 * empty side. When the content will not support a real round this returns null and the caller
 * renders the ordinary narrated slide. A half-built game — two options where one is blank, a sort
 * with nothing to sort — is worse than no game, and it is the likeliest way game mode breaks on a
 * lesson nobody tested it against.
 */

export type GameRound =
  /** Match a term to its meaning, among meanings borrowed from other beats. */
  | { kind: "match"; beatId: string; prompt: string; options: string[]; answer: number; ask?: string }
  /** Drop each point into the side it belongs to. */
  | { kind: "sort"; beatId: string; prompt: string; buckets: [string, string]; items: { text: string; bucket: 0 | 1 }[] }
  /** The beat's own checkpoint, played as a round. */
  | { kind: "recall"; beatId: string; prompt: string; acceptable: string[][]; reveal: string }
  /** Put the lesson's steps back in order. */
  | { kind: "order"; beatId: string; prompt: string; correct: string[]; shuffled: string[] };

export const GAME_RULES = {
  /** A match round needs the answer plus at least this many decoys, or it is a free point. */
  MIN_DECOYS: 1,
  /** More than this and the options stop being readable at a glance. */
  MAX_OPTIONS: 4,
  /** Ordering fewer than this is not a puzzle. */
  MIN_ORDER_ITEMS: 3,
} as const;

/**
 * Mulberry32. `loot.ts` carries its own copy because it threads the seed through reducer state;
 * here the seed is consumed once per round, so a plain generator is the simpler shape.
 */
function rng(seed: number): () => number {
  let a = seed || 1;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fisher-Yates against a seeded generator, so a shuffle is reproducible. */
function shuffle<T>(items: T[], next: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

const clean = (s: string | undefined): string => (s ?? "").trim();

/**
 * Build a round for `beat`, or null when its content will not support one.
 *
 * `allBeats` is needed for decoys: a "match the meaning" round is only a question if the wrong
 * options come from somewhere real. Borrowing them from other beats in the same lesson also keeps
 * them plausible, which a generic wrong answer never is.
 */
export function roundForBeat(beat: Beat, allBeats: Beat[], seed: number): GameRound | null {
  const next = rng(seed);

  switch (beat.slideKind) {
    case "definition": {
      const term = clean(beat.definitionTerm);
      const meaning = clean(beat.definitionMeaning);
      if (!term || !meaning) return null;

      const decoys = allBeats
        .filter((b) => b.id !== beat.id)
        .map((b) => clean(b.definitionMeaning))
        // Excluding the answer by VALUE, not just by beat id: two beats can legitimately carry the
        // same wording, and a decoy identical to the answer makes the round unanswerable.
        .filter((m) => m.length > 0 && m !== meaning);

      const unique = [...new Set(decoys)];
      if (unique.length < GAME_RULES.MIN_DECOYS) return null;

      const options = shuffle(
        [meaning, ...shuffle(unique, next).slice(0, GAME_RULES.MAX_OPTIONS - 1)],
        next,
      );
      return {
        kind: "match", beatId: beat.id, prompt: term, options,
        answer: options.indexOf(meaning), ask: "Which one is it?",
      };
    }

    case "compare": {
      const left = beat.compareLeft;
      const right = beat.compareRight;
      const leftPoints = (left?.points ?? []).map(clean).filter(Boolean);
      const rightPoints = (right?.points ?? []).map(clean).filter(Boolean);
      // BOTH sides must have something. One empty side is not a sort, it is a list.
      if (!left || !right || leftPoints.length === 0 || rightPoints.length === 0) return null;

      const items = shuffle(
        [
          ...leftPoints.map((text) => ({ text, bucket: 0 as const })),
          ...rightPoints.map((text) => ({ text, bucket: 1 as const })),
        ],
        next,
      );
      return {
        kind: "sort",
        beatId: beat.id,
        prompt: `Which side does each belong to?`,
        buckets: [clean(left.label) || "Left", clean(right.label) || "Right"],
        items,
      };
    }

    case "checkpoint": {
      const cp = beat.checkpoint;
      const acceptable = (cp?.acceptableKeywords ?? []).filter((set) => set.length > 0);
      if (!cp || !clean(cp.prompt) || acceptable.length === 0) return null;
      return {
        kind: "recall",
        beatId: beat.id,
        prompt: clean(cp.prompt),
        acceptable,
        reveal: clean(cp.revealAnswer),
      };
    }

    case "recap": {
      // The lesson's own running order is the answer. Titles rather than the recap's bullet points:
      // points are often fragments, whereas every beat has a title that reads as a step.
      const upto = allBeats.slice(0, allBeats.findIndex((b) => b.id === beat.id));
      const correct = upto.map((b) => clean(b.title)).filter(Boolean);
      if (correct.length < GAME_RULES.MIN_ORDER_ITEMS) return null;

      const trimmed = correct.slice(0, 6); // more than six is a chore, not a game
      let shuffled = shuffle(trimmed, next);
      // A shuffle that happens to land in the right order hands out a free point. Rotate rather than
      // reshuffle so this terminates for any seed.
      if (trimmed.length > 1 && shuffled.every((t, i) => t === trimmed[i])) {
        shuffled = [...shuffled.slice(1), shuffled[0]];
      }
      return { kind: "order", beatId: beat.id, prompt: "Put the lesson back in order", correct: trimmed, shuffled };
    }

    // `intro` deliberately has no game. It is the hook — a title and a promise, with no content to
    // test yet, and inventing decoy topics for it would mean generating content, which is the whole
    // thing this router avoids.
    case "intro":
      return null;

    /*
     * EVERYTHING ELSE — and that is most of a real lesson.
     *
     * The `SlideKind` union lists five kinds, but the generator's own prompt asks the model for
     * "definition, mechanism, example, compare, application, misconception, or recap"
     * (app/api/generate-lecture/route.ts:282). So a generated lecture is mostly `mechanism`,
     * `example`, `application` and `misconception` beats — none of which the five typed cases
     * above match. Without this branch, game mode would quietly fall back to slides on the
     * majority of a real lesson while looking correct on the hand-written fixture.
     *
     * Every beat carries `points[]`, so those become an odd-one-out: three of this beat's points
     * against one borrowed from a different beat. Still no generated content — the decoy is a real
     * sentence from the same lesson, which is what makes it plausible rather than obviously wrong.
     */
    default: {
      const mine = beat.points.map(clean).filter(Boolean);
      if (mine.length < 2) return null;

      const elsewhere = [...new Set(
        allBeats
          .filter((b) => b.id !== beat.id)
          .flatMap((b) => b.points.map(clean))
          .filter((pt) => pt.length > 0 && !mine.includes(pt)),
      )];
      if (elsewhere.length === 0) return null;

      const decoy = shuffle(elsewhere, next)[0];
      const options = shuffle([...shuffle(mine, next).slice(0, GAME_RULES.MAX_OPTIONS - 1), decoy], next);
      return {
        kind: "match",
        beatId: beat.id,
        prompt: clean(beat.title),
        options,
        answer: options.indexOf(decoy),
        ask: "Which of these does NOT belong?",
      };
    }
  }
}

/** How many beats of a lesson game mode can actually play. Used to warn before the mode starts. */
export function playableCount(beats: Beat[], seed = 1): number {
  return beats.filter((b, i) => roundForBeat(b, beats, seed + i) !== null).length;
}

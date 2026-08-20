import type { Beat } from "../../lessonContent";

/**
 * The question a checkpoint asks, as three choices.
 *
 * WHY OPTIONS ARE GENERATED, NOT DERIVED. A checkpoint used to carry only a prompt, some acceptable
 * keywords and one reveal answer — which is enough to grade free text and not nearly enough to build
 * a choice worth making. Distractors have to be plausible against the actual content, so the model
 * now writes them (`options` / `correctOption` in the checkpoint schema; see lib/drawPrompt.ts).
 *
 * The derivation below is a FALLBACK, not the plan: every lecture generated before that field
 * existed has none, and a model can always omit one. Borrowed distractors are visibly weaker — they
 * come from a different part of the lesson and often read as obviously wrong — so this is what keeps
 * an old lesson playable, not what makes a good question.
 *
 * Pure and seeded like every other rule module here, so option order and validation can be checked
 * without rendering anything.
 */

export type Mcq = {
  beatId: string;
  question: string;
  /** Exactly three, distinct, non-empty. */
  options: [string, string, string];
  /** Index into `options`. */
  answer: 0 | 1 | 2;
  /** Shown after a wrong pick. A round that only says "wrong" teaches nothing. */
  reveal: string;
};

export const MCQ_RULES = {
  OPTIONS: 3,
  /** Longer than this cannot be read on a gate while the bird is moving toward it. */
  MAX_OPTION_CHARS: 62,
  MAX_QUESTION_CHARS: 150,
} as const;

/** Mulberry32 — a seeded question is a question a test can replay. */
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

function fit(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const space = cut.lastIndexOf(" ");
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

/**
 * Build the question for a checkpoint, or null when there is not enough to ask one.
 *
 * `allBeats` is only needed by the fallback, which borrows distractors from elsewhere in the lesson.
 */
export function mcqForCheckpoint(beat: Beat, allBeats: Beat[], seed: number): Mcq | null {
  const next = rng(seed);
  const cp = beat.checkpoint;

  /*
   * NO CHECKPOINT SPEC — build one from what the beat does have.
   *
   * "A question every three beats" is only true if a question can always be made. This used to
   * return null whenever the model had put its checkpoints somewhere other than the cadence points,
   * so the cadence silently passed and the learner was asked nothing at all.
   */
  if (!cp) return fromBeatContent(beat, allBeats, next);

  const question = fit(clean(cp.prompt), MCQ_RULES.MAX_QUESTION_CHARS);
  if (!question) return fromBeatContent(beat, allBeats, next);

  const reveal = clean(cp.revealAnswer);

  /* The model wrote them. Validate rather than trust: a bad index or a duplicated option makes the
     question unanswerable, and it is generated content. */
  const authored = (cp.options ?? []).map(clean).filter(Boolean);
  const idx = cp.correctOption;
  if (
    authored.length === MCQ_RULES.OPTIONS &&
    new Set(authored).size === MCQ_RULES.OPTIONS &&
    typeof idx === "number" &&
    Number.isInteger(idx) &&
    idx >= 0 &&
    idx < MCQ_RULES.OPTIONS
  ) {
    const correct = authored[idx];
    // Shuffled so the right answer is not always where the model happened to put it.
    const options = shuffle(authored, next);
    return {
      beatId: beat.id,
      question,
      options: options.map((o) => fit(o, MCQ_RULES.MAX_OPTION_CHARS)) as [string, string, string],
      answer: options.indexOf(correct) as 0 | 1 | 2,
      reveal: reveal || correct,
    };
  }

  /* Fallback: the reveal answer against borrowed lines. */
  if (!reveal) return fromBeatContent(beat, allBeats, next);
  const pool = [...new Set(
    allBeats
      .filter((b) => b.id !== beat.id)
      .flatMap((b) => [clean(b.checkpoint?.revealAnswer), clean(b.definitionMeaning), ...b.points.map(clean)])
      .filter((t) => t.length > 8 && t !== reveal),
  )];
  if (pool.length < MCQ_RULES.OPTIONS - 1) return fromBeatContent(beat, allBeats, next);
  const picked = shuffle(pool, next).slice(0, MCQ_RULES.OPTIONS - 1);
  const options = shuffle([reveal, ...picked], next);
  return {
    beatId: beat.id,
    question,
    options: options.map((o) => fit(o, MCQ_RULES.MAX_OPTION_CHARS)) as [string, string, string],
    answer: options.indexOf(reveal) as 0 | 1 | 2,
    reveal,
  };
}

/**
 * Build a question out of an ordinary beat.
 *
 * A definition beat asks what the term means; anything else asks which line belongs to it, against
 * lines borrowed from elsewhere in the lesson. Weaker than a question the model wrote for the
 * content — but a weaker question is a great deal better than the cadence passing in silence.
 */
function fromBeatContent(beat: Beat, allBeats: Beat[], next: () => number): Mcq | null {
  const term = clean(beat.definitionTerm);
  const meaning = clean(beat.definitionMeaning);
  const title = clean(beat.title);

  const borrow = (exclude: string[]) => [...new Set(
    allBeats
      .filter((b) => b.id !== beat.id)
      .flatMap((b) => [clean(b.definitionMeaning), ...b.points.map(clean)])
      .filter((t) => t.length > 8 && !exclude.includes(t)),
  )];

  if (term && meaning) {
    const pool = borrow([meaning]);
    if (pool.length >= MCQ_RULES.OPTIONS - 1) {
      const options = shuffle([meaning, ...shuffle(pool, next).slice(0, MCQ_RULES.OPTIONS - 1)], next);
      return {
        beatId: beat.id,
        question: fit(`What does "${term}" mean?`, MCQ_RULES.MAX_QUESTION_CHARS),
        options: options.map((o) => fit(o, MCQ_RULES.MAX_OPTION_CHARS)) as [string, string, string],
        answer: options.indexOf(meaning) as 0 | 1 | 2,
        reveal: meaning,
      };
    }
  }

  const mine = [...new Set(beat.points.map(clean).filter((p) => p.length > 8))];
  if (!title || mine.length === 0) return null;
  const correct = shuffle(mine, next)[0];
  const pool = borrow(mine);
  if (pool.length < MCQ_RULES.OPTIONS - 1) return null;

  const options = shuffle([correct, ...shuffle(pool, next).slice(0, MCQ_RULES.OPTIONS - 1)], next);
  return {
    beatId: beat.id,
    question: fit(`Which of these is part of "${title}"?`, MCQ_RULES.MAX_QUESTION_CHARS),
    options: options.map((o) => fit(o, MCQ_RULES.MAX_OPTION_CHARS)) as [string, string, string],
    answer: options.indexOf(correct) as 0 | 1 | 2,
    reveal: correct,
  };
}

/**
 * The beat a checkpoint should ask about, given where the lecture has reached.
 *
 * Every third beat, per the brief. A generated `checkpoint` beat at or just before that point is
 * preferred — it carries a real question written for this content — and otherwise the most recent
 * beat that can supply one is used, so the cadence holds even when the model placed its checkpoints
 * somewhere else entirely.
 */
export const CHECKPOINT_EVERY = 3;

export function checkpointDueAt(index: number): boolean {
  return index > 0 && index % CHECKPOINT_EVERY === 0;
}

export function questionSourceFor(index: number, beats: Beat[]): Beat | null {
  // Look back over the beats just taught, nearest first: the question should be about what the
  // learner has this moment finished, not something from the start of the lecture.
  const from = Math.max(0, index - CHECKPOINT_EVERY);
  for (let i = index; i >= from; i--) {
    if (beats[i]?.checkpoint) return beats[i];
  }
  /*
   * No checkpoint spec nearby — fall back to the most recent beat that has something to ask ABOUT.
   *
   * "The most recent beat" was not enough: a checkpoint beat stripped of its spec carries no points
   * and no definition (its title is literally "Quick check"), so the cadence landed on it and
   * produced nothing. Usable content is the requirement, not recency.
   */
  const usable = (b: Beat | undefined) =>
    !!b && ((!!b.definitionTerm && !!b.definitionMeaning) || b.points.length > 0);
  for (let i = index; i >= from; i--) {
    if (usable(beats[i])) return beats[i];
  }
  // Widen beyond the window rather than ask nothing at all.
  for (let i = index; i >= 0; i--) {
    if (usable(beats[i])) return beats[i];
  }
  return null;
}

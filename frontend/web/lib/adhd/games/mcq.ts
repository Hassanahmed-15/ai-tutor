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
  const cp = beat.checkpoint;
  if (!cp) return null;
  const question = fit(clean(cp.prompt), MCQ_RULES.MAX_QUESTION_CHARS);
  if (!question) return null;

  const reveal = clean(cp.revealAnswer);
  const next = rng(seed);

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
  if (!reveal) return null;
  const pool = [...new Set(
    allBeats
      .filter((b) => b.id !== beat.id)
      .flatMap((b) => [clean(b.checkpoint?.revealAnswer), clean(b.definitionMeaning), ...b.points.map(clean)])
      .filter((t) => t.length > 8 && t !== reveal),
  )];
  if (pool.length < MCQ_RULES.OPTIONS - 1) return null;

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
  for (let i = index; i >= Math.max(0, index - CHECKPOINT_EVERY); i--) {
    if (beats[i]?.checkpoint) return beats[i];
  }
  return null;
}

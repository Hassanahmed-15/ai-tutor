import type { ScoreEvent } from "./score";

/**
 * A one-line bus for score events the LESSON knows about but the ADHD layer owns.
 *
 * `LessonPlayer` is where a skip happens and where a quiz verdict lands; `AdhdLayer` is where the
 * score lives. They are parent and child, so this could have been prop drilling — but that would
 * mean `LessonPlayer` holding ADHD callbacks in its own signature and passing them down through a
 * component it only renders conditionally. The emitter keeps the ADHD concern entirely inside the
 * ADHD module: the player emits, and if nothing is listening the call costs a `Set` iteration over
 * nothing.
 *
 * Deliberately fire-and-forget with no replay. A score event that arrives before the layer mounts is
 * an event for a session that has not started, and queueing it would credit the next session.
 */

type Listener = (event: ScoreEvent) => void;

const listeners = new Set<Listener>();

export function onAdhdEvent(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Safe to call from anywhere, including when no ADHD learner is present. */
export function emitAdhdEvent(event: ScoreEvent): void {
  for (const fn of listeners) fn(event);
}

/* ── The teacher's face ───────────────────────────────────────────────────────
 * Published the same way and for the same reason: the avatar is rendered by the header, ABOVE the
 * ADHD layer that knows which face to wear. Passing it would mean `LessonPlayer` holding ADHD state
 * it otherwise has no reason to know about.
 */
import type { Expression } from "./expression";

type FaceListener = (face: Expression) => void;
const faceListeners = new Set<FaceListener>();
let currentFace: Expression = "neutral";

export function adhdFace(): Expression {
  return currentFace;
}

export function onAdhdFace(fn: FaceListener): () => void {
  faceListeners.add(fn);
  // Deliver the current value immediately: a subscriber that mounts mid-session should not sit on
  // "neutral" until the next change.
  fn(currentFace);
  return () => faceListeners.delete(fn);
}

export function publishAdhdFace(face: Expression): void {
  currentFace = face;
  for (const fn of faceListeners) fn(face);
}

/* ── What the teacher says out loud ───────────────────────────────────────────
 * Same structural reason as the face: the ADHD layer knows WHAT to say (it holds the skip count and
 * the reaction), while `LessonPlayer` is the only place that owns the voice director and renders
 * the avatar the bubble hangs off. So the layer publishes the line and the player performs it.
 *
 * `null` clears the bubble — the reaction has to end.
 */
type SpeechListener = (line: string | null) => void;
const speechListeners = new Set<SpeechListener>();

export function onAdhdSpeech(fn: SpeechListener): () => void {
  speechListeners.add(fn);
  return () => speechListeners.delete(fn);
}

export function publishAdhdSpeech(line: string | null): void {
  for (const fn of speechListeners) fn(line);
}

/* ── The score snapshot ───────────────────────────────────────────────────────
 * Published for the same structural reason as the face: the chip renders in the lesson header,
 * above the layer that owns the numbers.
 */
export type AdhdScoreSnapshot = {
  xp: number;
  coins: number;
  combo: number;
  streak: number;
  cards: number;
  locked: boolean;
  lockedMins: number;
};

type ScoreListener = (s: AdhdScoreSnapshot) => void;
const scoreListeners = new Set<ScoreListener>();
let currentScore: AdhdScoreSnapshot | null = null;

export function onAdhdScore(fn: ScoreListener): () => void {
  scoreListeners.add(fn);
  if (currentScore) fn(currentScore);
  return () => scoreListeners.delete(fn);
}

export function publishAdhdScore(s: AdhdScoreSnapshot): void {
  currentScore = s;
  for (const fn of scoreListeners) fn(s);
}

/** Called when a session ends so the next lecture does not open showing the last one's total. */
export function resetAdhdScore(): void {
  currentScore = null;
}

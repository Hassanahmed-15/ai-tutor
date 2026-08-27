import type { LessonMode } from "@/lib/lessonMachine";

/**
 * "The lecture is supposed to be audible, and it is not." — the one decision behind that.
 *
 * WHY THIS EXISTS. Everything that takes the floor over a running lecture freezes it through the
 * voice director WITHOUT the lesson machine leaving `teaching`: the chatbot taking the channel, a
 * comprehension question, an ADHD reproach line. Every path back was `lesson.requestResume()`, and
 * `go("teaching")` FROM `teaching` sets both pieces of state to the values they already hold — React
 * bails out, `[lesson.mode]` never changes, the players' resume effect never re-runs, and the frozen
 * audio is never continued. The lecture sat on the whiteboard until the student pressed Pause and
 * then Resume, which un-stuck it precisely because that is two real mode transitions.
 *
 * So the invariant is asserted centrally instead of trusted to each caller. It lives here, free of
 * React, because the players cannot be rendered in this repo's `node:test` suite and this is the
 * part that has to be pinned.
 */

export type ChannelSnapshot = {
  /** `lesson.mode`. Only `teaching` means the scripted narration is supposed to be playing. */
  mode: LessonMode;
  /** The chatbot holds the audio channel — `voice.owner === "chatbot"` or the synchronous ref read. */
  chatbotHoldsChannel: boolean;
  /**
   * A transient interjection (a question, a verdict, a reproach) is mid-flight.
   *
   * It is in flight from the instant it is requested, NOT from when it makes sound — cloud TTS
   * fetches for seconds first. Resuming the lecture during that window is exactly how it ends up
   * playing underneath a question that is about to speak.
   */
  utteranceInFlight: boolean;
  /** `voice.hasFrozenTeacher()` — there is a lecture frozen in place, waiting to be continued. */
  lectureFrozen: boolean;
  /** `speakAsTeacher` REFUSED to start this beat (the chatbot had the floor) and nothing retried. */
  startRefused: boolean;
};

export type NarrationAction =
  /** Nothing to do — either the lecture is fine, or something is legitimately holding it. */
  | "none"
  /** Continue the frozen lecture from the exact position it stopped at. */
  | "resume"
  /** Nothing to continue: start this beat's narration again from its first sentence. */
  | "restart";

/**
 * `resume` is safe unconditionally: `resumeTeacher()` on a lecture that is already playing finds
 * nothing frozen and returns false. `restart` REPLAYS the beat from the top, so it is gated behind
 * an explicit refusal — a beat merely waiting on something (a checkpoint answer, an MCQ, a narration
 * that has already ended) never sets that flag and so is never disturbed.
 */
export function narrationRecovery(snapshot: ChannelSnapshot): NarrationAction {
  if (snapshot.mode !== "teaching") return "none";
  if (snapshot.chatbotHoldsChannel) return "none";
  if (snapshot.utteranceInFlight) return "none";
  if (snapshot.lectureFrozen) return "resume";
  if (snapshot.startRefused) return "restart";
  return "none";
}

/**
 * WHO CLOSES A STUDENT'S TURN — and why it is not always the same door.
 *
 * With automatic activity detection disabled, the server only transcribes inside an
 * activityStart/activityEnd bracket, so the client owns both ends of every turn. Two different
 * things open that bracket:
 *
 *   1. The interruption gate committing (stage 3), which also calls `beginStudentSpeech` and sets
 *      the playback mute `suppressCurrentTurnRef` — the student is talking over the tutor, so the
 *      tutor's audio is cut immediately.
 *   2. The mic callback holding it open while the tutor is SILENT, which bypasses the gate entirely
 *      so a quiet question is never lost.
 *
 * Only case 1 sets the mute, and only `endStudentSpeech` clears it. So the end-of-utterance close
 * cannot simply call `closeActivity`: doing that in case 1 ends the turn with the mute still
 * latched, and the model's answer arrives and is discarded chunk by chunk. The symptom is brutal to
 * debug because everything looks healthy — transcripts flow, the socket is open, the tutor "speaks"
 * — and not one sample reaches the speakers for the rest of the session.
 *
 * This lives in its own module rather than inline in the hook because `useGeminiLiveTutor` is a
 * React hook that cannot be loaded by the CommonJS test build (the same reason `beatSourceScope.ts`
 * is separate from `progressiveLectureWorker.ts`).
 */

/** What the mic callback should do when the utterance has ended. */
export type TurnCloseAction =
  /** The gate committed: clear the playback mute on the way out, which also closes the bracket. */
  | "end-student-speech"
  /** The bracket was held open without a commit: just close it. Nothing to unmute. */
  | "close-activity"
  /** Nothing is open, or the student is still talking — do not touch the bracket. */
  | "none";

export interface TurnCloseInput {
  /** Is an activity bracket currently open with the server? */
  activityOpen: boolean;
  /** Did the gate commit this turn (i.e. did `beginStudentSpeech` run and set the mute)? */
  studentSpeaking: boolean;
  /** performance.now() when voice-like audio was last heard. 0 means "not currently speaking". */
  lastVoiceHeardAt: number;
  /** Now, in the same clock as `lastVoiceHeardAt`. */
  now: number;
  /** Silence required before the turn is considered finished. */
  endOfUtteranceMs: number;
}

export function turnCloseAction(input: TurnCloseInput): TurnCloseAction {
  if (!input.activityOpen) return "none";
  if (input.lastVoiceHeardAt <= 0) return "none";
  if (input.now - input.lastVoiceHeardAt < input.endOfUtteranceMs) return "none";
  /*
   * The whole point of this module. A committed turn MUST leave through `endStudentSpeech`,
   * because that is the only path that clears the playback mute.
   */
  return input.studentSpeaking ? "end-student-speech" : "close-activity";
}

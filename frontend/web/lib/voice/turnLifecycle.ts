/**
 * WHAT MUST BE TRUE AT EACH EDGE OF A VOICE TURN.
 *
 * Both voice faults reported from the deployed app were the same shape: state that is correct for
 * ONE turn and was left set into the next one.
 *
 *   1. The accumulated student transcript was cleared only when the tutor actually replied
 *      (`finishTutorTurn`). A gated turn often ends with no reply — an answer acknowledged
 *      silently, a turn the gate discarded, a command handled locally — so the next utterance was
 *      appended to the last. Three separate things the student said arrived as one run-on
 *      sentence, and the addressing classifier judged the concatenation instead of what was just
 *      spoken. Visible in the product as a merged message; invisible as an error.
 *
 *   2. `contextOnlyTurnRef` mutes the model's reply to a DISCARDED turn and clears itself on that
 *      turn's `turnComplete`. When the discarded turn produced no reply at all, no `turnComplete`
 *      arrived, the flag stayed set, and the student's next genuine question was answered in
 *      silence — socket healthy, transcript flowing, no audio.
 *
 * The rules live here, separately from the hook, because `useGeminiLiveTutor` is a React hook the
 * CommonJS test build cannot load — the same reason `lib/beatSourceScope.ts` exists apart from the
 * progressive worker. The hook applies exactly these.
 */

/** Everything a turn boundary can change. */
export interface TurnFlags {
  /** Words accumulated from the transcriber for the current utterance. */
  studentTranscript: string;
  /** Suppresses playback of the model's reply to a turn that was not for Aria. */
  contextOnlyTurn: boolean;
  /** The hard playback mute set when the gate commits a barge-in. */
  suppressCurrentTurn: boolean;
}

export type TurnEdge =
  /** The gate opened a turn: audio starts flowing to the model. */
  | "listen"
  /** The turn ended normally — the model may answer. */
  | "turn-end"
  /** The turn was not for Aria — close it and throw the answer away. */
  | "discard"
  /** The server finished a model turn. */
  | "turn-complete";

export function applyTurnEdge(flags: TurnFlags, edge: TurnEdge): TurnFlags {
  switch (edge) {
    case "listen":
      /*
       * Clearing the suppression HERE, rather than trusting a turnComplete that may never come, is
       * what bounds it to a single turn whatever the server does. The transcript also starts empty:
       * a turn's words are its own.
       */
      return { ...flags, contextOnlyTurn: false, studentTranscript: "" };
    case "turn-end":
      // Flushed (delivered to the caller, then emptied) so the next turn starts clean.
      return { ...flags, studentTranscript: "" };
    case "discard":
      // Dropped rather than flushed: nobody should be shown the neighbour's sentence.
      return { ...flags, contextOnlyTurn: true, studentTranscript: "" };
    case "turn-complete":
      return { ...flags, contextOnlyTurn: false };
  }
}

export const FRESH_TURN: TurnFlags = {
  studentTranscript: "",
  contextOnlyTurn: false,
  suppressCurrentTurn: false,
};

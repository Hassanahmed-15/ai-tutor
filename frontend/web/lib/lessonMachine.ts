"use client";

import { useCallback, useRef, useState } from "react";
import type { VoiceDirector } from "@/lib/useVoiceDirector";

/**
 * The lesson state machine — one value that answers "should the teacher be talking right now?".
 *
 * This replaces nine independent booleans (`playing`, `waitingOnCheckpoint`, `focusPause`,
 * `drawMode`, `askingCamera`, …) that each separately gated audio, and eighteen scattered
 * `setPlaying(true)` calls that could each restart the lecture at the wrong moment.
 *
 * Rules that fall out of the design rather than being policed by hand:
 *   - the teacher narrates only in `teaching`;
 *   - `requestResume()` is the ONLY way back into `teaching`, so there is one place to audit;
 *   - resuming while the chatbot is speaking is deferred, never layered on top of her;
 *   - nothing here resumes on a timer. The lecture continues because the student pressed the button
 *     or said so — never because a timeout elapsed.
 */

export type LessonMode =
  /** Not started yet. */
  | "idle"
  /** Teacher narrating, mic open. The only mode in which scripted narration plays. */
  | "teaching"
  /** Student asked something; the chatbot has the floor. Manual resume only. */
  | "chatting"
  /** Teacher asked a question and is waiting for the student's answer. */
  | "quizzing"
  /** Stopped for a specific reason; see `pauseReason`. */
  | "paused";

export type PauseReason =
  | "user" // pressed pause
  | "engagement" // dropped below the critical band
  | "focus" // sustained attention drift
  | "draw" // drawing on the board
  | "checkpoint" // waiting on a checkpoint answer
  | "checkin" // a run of skipped beats — the companion has the floor until the learner comes back
  | "complete"; // lesson finished

export type LessonState = {
  mode: LessonMode;
  pauseReason: PauseReason | null;
  /** Derived: the narration effect gates on this. */
  playing: boolean;
  startTeaching: () => void;
  enterChat: (opts?: { resumeAfterAnswer?: boolean; preserveResumeIntent?: boolean }) => void;
  enterQuiz: () => void;
  pause: (reason: PauseReason) => void;
  /**
   * The single door back into `teaching`. Refuses (and defers) while the chatbot is speaking.
   * Returns true if the lecture is running as a result of this call.
   */
  requestResume: () => boolean;
  /** Call when the chatbot finishes a turn — flushes a resume the student already asked for. */
  flushDeferredResume: () => void;
  /** Drop any deferred resume (e.g. the student interrupted again). */
  cancelDeferredResume: () => void;
  /** Synchronous mode read for use inside event handlers. */
  modeRef: React.RefObject<LessonMode>;
};

export function useLessonMachine(voice: VoiceDirector): LessonState {
  const [mode, setMode] = useState<LessonMode>("idle");
  const [pauseReason, setPauseReason] = useState<PauseReason | null>(null);
  const modeRef = useRef<LessonMode>("idle");
  // Set when the student asked to resume while the chatbot was still talking. It is honoured when
  // she finishes — this is a DEFERRED EXPLICIT request, not an automatic one.
  const deferredResumeRef = useRef(false);

  const go = useCallback((next: LessonMode, reason: PauseReason | null) => {
    modeRef.current = next;
    setMode(next);
    setPauseReason(reason);
  }, []);

  const startTeaching = useCallback(() => {
    deferredResumeRef.current = false;
    go("teaching", null);
  }, [go]);

  const enterChat = useCallback(
    (opts?: { resumeAfterAnswer?: boolean; preserveResumeIntent?: boolean }) => {
      // The student is talking: everything the teacher was saying stops and the floor is hers.
      voice.stopUtterance();
      voice.pauseTeacher();
      // "Cater to the question first, THEN continue": when the student interrupts to ask something,
      // arm a resume so the lecture picks back up on its own the moment she finishes answering. The
      // director makes this safe — it can't start under her voice. Aria talking unprompted (a drift
      // nudge, the opening greeting) passes nothing here, so those correctly stay paused.
      if (!opts?.preserveResumeIntent) deferredResumeRef.current = opts?.resumeAfterAnswer === true;
      go("chatting", null);
    },
    [voice, go]
  );

  /**
   * The teacher has asked something and is waiting. This freezes the LECTURE but deliberately leaves
   * her question playing — the question is the whole point, and it is speaking over the frozen beat.
   */
  const enterQuiz = useCallback(() => {
    deferredResumeRef.current = false;
    voice.pauseTeacher();
    go("quizzing", null);
  }, [voice, go]);

  const pause = useCallback(
    (reason: PauseReason) => {
      deferredResumeRef.current = false;
      voice.stopUtterance();
      voice.pauseTeacher();
      go("paused", reason);
    },
    [voice, go]
  );

  /**
   * Into `teaching`, and ACTUALLY audible.
   *
   * `go("teaching")` from `teaching` sets both pieces of state to values React already holds, so it
   * re-renders nothing and the players' `[lesson.mode]` effect — the only thing that continues frozen
   * narration — never runs. But a lecture CAN be frozen while the mode never left `teaching`: the
   * chatbot taking the channel, or the teacher's own question playing over the top of it. Every
   * "carry on now" in the app went through here, so every one of them silently did nothing, and the
   * lecture sat frozen while the UI still said it was playing. Skipping the quick question was the
   * clearest case — a guaranteed lock.
   *
   * So resume the audio explicitly rather than hoping a mode transition happens. Safe at every call
   * site: they all intend the lecture to run, and `resumeTeacher()` no-ops when there is nothing
   * frozen (and refuses outright while the chatbot holds the channel).
   */
  const goTeaching = useCallback(() => {
    if (modeRef.current === "teaching") voice.resumeTeacher();
    go("teaching", null);
  }, [voice, go]);

  const requestResume = useCallback(() => {
    if (voice.isChatbotSpeaking()) {
      // Remember the request and honour it the moment she stops — never talk over her.
      deferredResumeRef.current = true;
      return false;
    }
    deferredResumeRef.current = false;
    goTeaching();
    return true;
  }, [voice, goTeaching]);

  /**
   * Honour a resume the student already asked for, now that the answer is finished.
   *
   * Deliberately does NOT re-check `isChatbotSpeaking()`. The caller IS the "she has finished"
   * signal, and it fires synchronously from the realtime event handler — before React has
   * re-rendered, so the director's mirror of `speaking` is still stale-true at this instant.
   * Consulting it here is what left the lecture paused forever after every answered question.
   */
  const flushDeferredResume = useCallback(() => {
    if (!deferredResumeRef.current) return;
    deferredResumeRef.current = false;
    goTeaching();
  }, [goTeaching]);

  const cancelDeferredResume = useCallback(() => {
    deferredResumeRef.current = false;
  }, []);

  return {
    mode,
    pauseReason,
    playing: mode === "teaching",
    startTeaching,
    enterChat,
    enterQuiz,
    pause,
    requestResume,
    flushDeferredResume,
    cancelDeferredResume,
    modeRef,
  };
}

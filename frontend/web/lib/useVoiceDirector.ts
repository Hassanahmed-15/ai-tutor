"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { playNarration, cancelActiveNarrations, unlockAudio, type NarrationCallbacks, type NarrationHandle } from "@/lib/voice";

/**
 * The voice director — the single owner of every sound the lesson makes.
 *
 * There are exactly two things that can talk: the TEACHER (scripted narration through
 * `playNarration`) and the CHATBOT (the realtime tutor's own WebRTC audio). They must never be
 * audible at the same time. Previously that was enforced by a dozen scattered guards across two big
 * components, and a new overlap appeared every time one of them was touched.
 *
 * Now there is one rule, enforced here and nowhere else:
 *
 *     the teacher may only start or resume while the chatbot is silent.
 *
 * `speakAsTeacher` and `resumeTeacher` REFUSE (return false) when the chatbot holds the channel, and
 * the moment the chatbot starts speaking the teacher is frozen in place. Nothing here ever resumes
 * the lecture on its own — resuming is always someone else's explicit decision (see `lessonMachine`).
 *
 * The teacher gets two slots, because she says two different kinds of thing:
 *   - the LECTURE: the beat's script. Freezable and resumable, so an interruption never costs you
 *     the section you were half-way through.
 *   - an UTTERANCE: a short interjection (a comprehension question, its verdict, a re-explanation).
 *     Transient — it plays over a frozen lecture without discarding it, and is never resumed.
 * Only one of the two is ever audible: starting an utterance freezes the lecture, and resuming the
 * lecture cancels any utterance first.
 */

export type VoiceOwner = "none" | "teacher" | "chatbot";

/** Which slot a piece of teacher speech belongs to. */
export type TeacherSlot = "lecture" | "utterance";

export type VoiceDirector = {
  /** Who currently holds the audio channel. Render-safe (React state). */
  owner: VoiceOwner;
  /**
   * Speak as the teacher, cutting off any chatbot tail first.
   * Returns false — and plays NOTHING — if the chatbot is speaking; the caller decides what to do.
   */
  speakAsTeacher: (text: string, callbacks: NarrationCallbacks, slot?: TeacherSlot) => boolean;
  /**
   * Freeze the lecture where it is (keeps sentence cue and board progress) and drop any utterance.
   * Returns false when the lecture can't be frozen (browser-TTS fallback), in which case it is
   * cancelled instead and the caller must restart the beat to continue.
   */
  pauseTeacher: () => boolean;
  /** Continue the frozen lecture. Refuses while the chatbot is speaking. */
  resumeTeacher: () => boolean;
  /** Cancel everything the teacher is saying — nothing to resume afterwards. */
  stopTeacher: () => void;
  /** Cancel just a transient utterance, leaving a frozen lecture intact. */
  stopUtterance: () => void;
  /** True when there is a frozen lecture that `resumeTeacher` could continue. */
  hasFrozenTeacher: () => boolean;
  /**
   * True while a transient utterance is in flight — from the moment it is REQUESTED, not from the
   * moment it makes sound. Cloud TTS fetches for seconds before `onStart`, and `owner` says nothing
   * during that window; anything reconciling "should the lecture be audible?" has to see the
   * interjection that is about to speak, or it resumes the lecture underneath it.
   */
  hasPendingUtterance: () => boolean;
  /** Synchronous read of whether the chatbot holds the channel (for use inside event handlers). */
  isChatbotSpeaking: () => boolean;
};

export function useVoiceDirector({
  tutorSpeaking,
  isChatbotSpeakingNow,
}: {
  /** `speaking` from useRealtimeTutor — React state, drives the freeze reaction. */
  tutorSpeaking: boolean;
  /** `isSpeaking` from useRealtimeTutor — a SYNCHRONOUS ref read, with no render lag. This is the
   *  authority for "may the teacher start right now?"; the state prop above only triggers effects.
   *  The teacher WAITS for the chatbot rather than cutting her off, so no silence hook is needed. */
  isChatbotSpeakingNow: () => boolean;
}): VoiceDirector {
  const [owner, setOwner] = useState<VoiceOwner>("none");
  const ownerRef = useRef<VoiceOwner>("none");
  const lectureRef = useRef<NarrationHandle | null>(null);
  const utteranceRef = useRef<NarrationHandle | null>(null);
  const frozenRef = useRef(false);
  // The single "does the chatbot hold the channel?" test used by every gate below. It reads ONLY the
  // synchronous getter — a ref inside the tutor hook, updated the instant her audio starts/stops.
  //
  // It deliberately does NOT consult a mirror of the `speaking` React STATE: that state lags a
  // render, so at the exact tick a turn completes it is still stale-true — which was silently
  // refusing every legitimate resume and every teacher question the moment she stopped talking.
  const chatbotHoldsChannel = useCallback(() => isChatbotSpeakingNow(), [isChatbotSpeakingNow]);

  const claim = useCallback((next: VoiceOwner) => {
    ownerRef.current = next;
    setOwner(next);
  }, []);

  const release = useCallback(() => {
    if (ownerRef.current === "teacher") claim("none");
  }, [claim]);

  const stopUtterance = useCallback(() => {
    utteranceRef.current?.cancel();
    utteranceRef.current = null;
  }, []);

  const stopTeacher = useCallback(() => {
    stopUtterance();
    lectureRef.current?.cancel();
    lectureRef.current = null;
    frozenRef.current = false;
    release();
  }, [stopUtterance, release]);

  const pauseTeacher = useCallback(() => {
    // NOTE: deliberately does NOT touch a transient utterance. Freezing the lecture is exactly what
    // has to happen so the teacher can ASK something over the top of it; callers that want silence
    // (a deliberate pause, the chatbot taking over) call stopUtterance() as well.
    const lecture = lectureRef.current;
    if (!utteranceRef.current) release();
    if (!lecture) return false;
    if (frozenRef.current) return true; // already frozen
    const froze = lecture.pause();
    if (froze) {
      frozenRef.current = true;
    } else {
      // Can't be frozen (browser-TTS fallback) — cancelling is the only way to stop the voice.
      lecture.cancel();
      lectureRef.current = null;
      frozenRef.current = false;
    }
    return froze;
  }, [release]);

  const resumeTeacher = useCallback(() => {
    if (chatbotHoldsChannel()) return false; // the chatbot has the floor
    stopUtterance(); // never let an interjection run under the lecture
    const lecture = lectureRef.current;
    if (!lecture || !frozenRef.current) return false;
    const resumed = lecture.resume();
    if (resumed) {
      frozenRef.current = false;
      claim("teacher");
    }
    return resumed;
  }, [chatbotHoldsChannel, stopUtterance, claim]);

  const speakAsTeacher = useCallback(
    (text: string, callbacks: NarrationCallbacks, slot: TeacherSlot = "lecture") => {
      if (chatbotHoldsChannel()) return false; // the chatbot has the floor — play nothing
      unlockAudio();

      const wrapped: NarrationCallbacks = {
        ...callbacks,
        onStart: () => {
          claim("teacher");
          callbacks.onStart();
        },
        onEnd: () => {
          if (slot === "lecture") {
            lectureRef.current = null;
            frozenRef.current = false;
          } else {
            utteranceRef.current = null;
          }
          release();
          callbacks.onEnd();
        },
      };

      if (slot === "utterance") {
        // Freeze the lecture rather than discarding it, and keep it out of playNarration's global
        // cancel so it survives to be resumed after this interjection.
        stopUtterance();
        const lecture = lectureRef.current;
        if (lecture && !frozenRef.current && lecture.pause()) frozenRef.current = true;
        utteranceRef.current = playNarration(text, { ...wrapped, preserveActive: true });
      } else {
        stopUtterance();
        frozenRef.current = false;
        lectureRef.current = playNarration(text, wrapped);
      }
      return true;
    },
    [chatbotHoldsChannel, claim, release, stopUtterance]
  );

  // The chatbot taking or releasing the floor. Taking it freezes the teacher IMMEDIATELY; releasing
  // it frees the channel but deliberately resumes nothing — that is always an explicit decision.
  useEffect(() => {
    if (tutorSpeaking) {
      // She has the floor: everything the teacher was saying stops. The lecture freezes so it can be
      // continued later; an interjection is simply dropped.
      stopUtterance();
      pauseTeacher();
      claim("chatbot");
    } else if (ownerRef.current === "chatbot") {
      claim("none");
    }
  }, [tutorSpeaking, pauseTeacher, stopUtterance, claim]);

  // The invariant, made loud — but checked against REALITY, not this render's snapshot. When the
  // chatbot starts, the effect above freezes the teacher synchronously, yet `owner` state lags a
  // render; checking it directly would false-fire on every hand-off. So confirm on the next tick
  // using the live refs: a real violation is the lecture actually PLAYING (owner teacher, not frozen)
  // while she is actually making sound. If this fires, two voices are genuinely overlapping.
  useEffect(() => {
    if (process.env.NODE_ENV === "production") return;
    if (!(owner === "teacher" && tutorSpeaking)) return;
    const id = setTimeout(() => {
      if (ownerRef.current === "teacher" && !frozenRef.current && isChatbotSpeakingNow()) {
        console.error("[voice-director] INVARIANT VIOLATED: teacher and chatbot hold the channel at once.");
      }
    }, 80);
    return () => clearTimeout(id);
  }, [owner, tutorSpeaking, isChatbotSpeakingNow]);

  useEffect(() => () => cancelActiveNarrations(), []);

  const hasFrozenTeacher = useCallback(() => frozenRef.current, []);
  // `utteranceRef` is assigned SYNCHRONOUSLY by playNarration (it returns its handle before any
  // audio exists), which is what makes this true across the whole fetch.
  const hasPendingUtterance = useCallback(() => utteranceRef.current !== null, []);
  const isChatbotSpeaking = useCallback(() => chatbotHoldsChannel(), [chatbotHoldsChannel]);

  return {
    owner,
    speakAsTeacher,
    pauseTeacher,
    resumeTeacher,
    stopTeacher,
    stopUtterance,
    hasFrozenTeacher,
    hasPendingUtterance,
    isChatbotSpeaking,
  };
}

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { captureVoice, isSpeechSupported, type VoiceCaptureHandle } from "@/lib/speech";
import type { VoiceDirector } from "@/lib/useVoiceDirector";

/**
 * The teacher's mid-lecture question — asked in the TEACHER's voice, never the chatbot's.
 *
 * The whole point is that this is the teacher stopping to check on you, exactly as they would in a
 * classroom: she asks, she waits for you to actually answer, and what happens next depends on the
 * answer. Two things trigger it (see the players): engagement sitting in the 30-50 band, and a
 * periodic "is this landing?" every few sections.
 *
 * The chatbot's mic is disabled for the entire exchange, so she cannot hear a question meant for the
 * student and answer it herself. That mic is restored on EVERY exit path, including failures — get
 * that wrong and the student is left unable to interrupt for the rest of the lesson.
 */

export type QuizKind = "comprehension" | "understanding";
export type QuizPhase = "idle" | "asking" | "listening" | "grading" | "feedback";

/** How long a pause in speech ends the answer, and the hard cap on one answer. */
const ANSWER_SILENCE_MS = 2000;
const ANSWER_MAX_MS = 25_000;

export type QuizRequest = {
  kind: QuizKind;
  /** Spoken aloud by the teacher. */
  question: string;
  /** The material the answer is judged against (the beat's script). */
  expected: string;
  /**
   * Local keyword grading for checkpoint beats (`checkAnswer`). When it returns a result we use it
   * and skip the API call entirely; when it returns null we fall back to the grader endpoint.
   */
  localGrade?: (answer: string) => { correct: boolean; feedback: string } | null;
};

export type TeacherQuiz = {
  phase: QuizPhase;
  kind: QuizKind | null;
  /** The question currently on screen. */
  question: string;
  /** Live transcript of what the student is saying. */
  heard: string;
  /** The teacher's spoken verdict, once graded. */
  feedback: string;
  /** False when the browser has no speech recognition — the caller shows a typed box instead. */
  supportsVoice: boolean;
  /** Start a quiz. Returns false (and does nothing) if the chatbot currently holds the channel. */
  ask: (request: QuizRequest) => boolean;
  /** Submit a typed answer (fallback path). */
  submitAnswer: (text: string) => void;
  /** Abandon the quiz without grading — always restores the mic. */
  cancel: () => void;
};

export function useTeacherQuiz({
  voice,
  setMicEnabled,
  rate,
  onPassed,
  onFailed,
}: {
  voice: VoiceDirector;
  /** `setMicEnabled` from useRealtimeTutor. */
  setMicEnabled: (on: boolean) => void;
  /** Narration speed, so the question is spoken at the lesson's pace. */
  rate: number;
  /** The student got it — carry on with the lecture. */
  onPassed: () => void;
  /** The student missed it — stay paused and offer to go over it again. */
  onFailed: () => void;
}): TeacherQuiz {
  const [phase, setPhase] = useState<QuizPhase>("idle");
  const [kind, setKind] = useState<QuizKind | null>(null);
  const [question, setQuestion] = useState("");
  const [heard, setHeard] = useState("");
  const [feedback, setFeedback] = useState("");
  const [supportsVoice, setSupportsVoice] = useState(true);

  const requestRef = useRef<QuizRequest | null>(null);
  const captureRef = useRef<VoiceCaptureHandle | null>(null);
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const maxTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const settledRef = useRef(false);
  // Callbacks are read through a ref so the quiz functions never go stale mid-exchange.
  const cbRef = useRef({ onPassed, onFailed });
  cbRef.current = { onPassed, onFailed };

  useEffect(() => setSupportsVoice(isSpeechSupported()), []);

  const clearTimers = useCallback(() => {
    if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
    if (maxTimerRef.current) clearTimeout(maxTimerRef.current);
    silenceTimerRef.current = null;
    maxTimerRef.current = null;
  }, []);

  /** The single teardown. Every exit — graded, cancelled, unmounted — goes through here. */
  const teardown = useCallback(() => {
    clearTimers();
    captureRef.current?.stop();
    captureRef.current = null;
    setMicEnabled(true); // the student must always be able to interrupt again
  }, [clearTimers, setMicEnabled]);

  const finish = useCallback(
    (correct: boolean, spoken: string) => {
      if (settledRef.current) return;
      settledRef.current = true;
      teardown();
      setFeedback(spoken);
      setPhase("feedback");
      const done = () => {
        setPhase("idle");
        setKind(null);
        if (correct) cbRef.current.onPassed();
        else cbRef.current.onFailed();
      };
      // The verdict is the teacher's voice too. If she can't take the channel (the student started
      // talking to the chatbot instead) just hand control back without speaking it.
      const spoke = voice.speakAsTeacher(
        spoken,
        { onStart: () => {}, onEnd: done, onBlocked: done, rate },
        "utterance",
      );
      if (!spoke) done();
    },
    [teardown, voice, rate]
  );

  const grade = useCallback(
    async (answer: string) => {
      const request = requestRef.current;
      if (!request) return;
      setPhase("grading");

      // Checkpoint beats already carry acceptable answers — grade locally, free and instant.
      const local = request.localGrade?.(answer) ?? null;
      if (local) {
        finish(local.correct, local.feedback);
        return;
      }

      try {
        const res = await fetch("/api/grade-answer", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ question: request.question, expected: request.expected, answer }),
        });
        const data = await res.json().catch(() => ({}));
        finish(data.correct === true, typeof data.feedback === "string" && data.feedback ? data.feedback : "Let's keep going.");
      } catch {
        // Never strand the student on a network failure — treat it as understood and move on.
        finish(true, "Good — let's keep going.");
      }
    },
    [finish]
  );

  const submitAnswer = useCallback(
    (text: string) => {
      clearTimers();
      captureRef.current?.stop();
      captureRef.current = null;
      setHeard(text);
      void grade(text.trim());
    },
    [clearTimers, grade]
  );

  const startListening = useCallback(() => {
    // The question's utterance fires this on end (and on blocked), so it can arrive AFTER the
    // student has already skipped. Without this guard, skipping mid-question set the phase to
    // "idle" and then the finishing utterance dragged it straight back to "listening" — the
    // card reappeared and the mic reopened, which is exactly the "skip doesn't skip" bug.
    if (settledRef.current) return;
    setPhase("listening");
    setHeard("");

    // `captureVoice` runs continuously, so it won't end on its own. End the answer after a real
    // pause in speech, and cap the whole thing so a silent student isn't stuck waiting forever.
    const armSilenceTimer = () => {
      if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = setTimeout(() => captureRef.current?.stop(), ANSWER_SILENCE_MS);
    };

    const handle = captureVoice({
      onInterim: (text) => {
        setHeard(text);
        armSilenceTimer();
      },
      onFinal: (text) => {
        clearTimers();
        captureRef.current = null;
        setHeard(text);
        void grade(text.trim());
      },
      onError: () => {
        clearTimers();
        captureRef.current = null;
        // Heard nothing usable. Not understanding is the safe assumption — offer to go over it.
        finish(false, "I didn't catch that — let's go back over this one together.");
      },
    });

    captureRef.current = handle;
    if (!handle) {
      // No speech recognition in this browser: the caller shows a typed box, so just wait for it.
      setSupportsVoice(false);
      return;
    }
    maxTimerRef.current = setTimeout(() => captureRef.current?.stop(), ANSWER_MAX_MS);
  }, [clearTimers, grade, finish]);

  const ask = useCallback(
    (request: QuizRequest) => {
      // Deafen the chatbot BEFORE the question is spoken, so she can never treat it as her cue.
      setMicEnabled(false);

      // "utterance": the question plays OVER the frozen beat without discarding it, so continuing
      // afterwards picks up mid-sentence instead of replaying the whole section.
      const spoke = voice.speakAsTeacher(
        request.question,
        {
          onStart: () => {},
          onEnd: startListening,
          onBlocked: startListening, // audio blocked — still take the answer
          rate,
        },
        "utterance",
      );
      if (!spoke) {
        // The chatbot has the floor; a question now would collide with her. Abandon cleanly.
        setMicEnabled(true);
        return false;
      }

      requestRef.current = request;
      settledRef.current = false;
      setKind(request.kind);
      setQuestion(request.question);
      setHeard("");
      setFeedback("");
      setPhase("asking");
      return true;
    },
    [setMicEnabled, voice, rate, startListening]
  );

  const cancel = useCallback(() => {
    if (settledRef.current) return;
    // Set FIRST: stopping the utterance can synchronously fire its onEnd, and the guard in
    // startListening is what stops that callback reopening the quiz.
    settledRef.current = true;
    // Skipping has to silence the teacher too. Previously cancel only tore down the mic and
    // timers, so if the student skipped while she was still reading the question aloud she
    // simply carried on asking it.
    voice.stopUtterance();
    teardown();
    setPhase("idle");
    setKind(null);
    setHeard("");
    setFeedback("");
  }, [teardown, voice]);

  useEffect(() => () => teardown(), [teardown]);

  return { phase, kind, question, heard, feedback, supportsVoice, ask, submitAnswer, cancel };
}

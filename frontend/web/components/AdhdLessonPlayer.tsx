"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { SlideStage } from "./SlideStage";
import { TeacherAvatar } from "./TeacherAvatar";
import { Board, AvatarRing, checkAnswer, MAX_ATTEMPTS, type CheckpointResult } from "./LessonPlayer";
import { beats as demoBeats, type Beat } from "@/lib/lessonContent";
import { unlockAudio } from "@/lib/voice";
import { useAttentionMonitor } from "@/lib/useAttentionMonitor";
import { useEngagementScore } from "@/lib/useEngagementScore";
import { useVoiceDirector } from "@/lib/useVoiceDirector";
import { useLessonMachine } from "@/lib/lessonMachine";
import { useTeacherQuiz } from "@/lib/useTeacherQuiz";
import { QuizPrompt } from "./QuizPrompt";
import { EngagementMeter } from "./EngagementMeter";
import { FocusPauseOverlay } from "./FocusPauseOverlay";
import { useLessonChat, ChatPanel, ExplainOverlay } from "./lesson-chat/LessonChat";
import { useRealtimeTutor, type RealtimeBoard } from "@/lib/useRealtimeTutor";
import { HudCorners } from "./hud/HudKit";
import { HighlightOverlay } from "./sketch/HighlightOverlay";

// Client mirror of REALTIME_TUTOR_ENABLED — gates the live conversational tutor on the chat mic.
const REALTIME_TUTOR_ENABLED = process.env.NEXT_PUBLIC_REALTIME_TUTOR_ENABLED === "1";

/**
 * The ADHD track: the SAME visual lecture experience as the sighted LessonPlayer (same
 * SlideStage, same Board/VisualDirector, same templates) — ADHD doesn't change what's
 * being shown, it changes what happens when attention drifts. A real camera-based
 * attention monitor (lib/useAttentionMonitor.ts, MediaPipe Face Landmarker, fully
 * client-side) watches engagement; when it detects a sustained drift, the lecture
 * auto-pauses, speaks a short recovery line, re-presents the current beat's content as
 * short punchy chunks (lib/rechunk.ts) one at a time, then resumes exactly where it left
 * off — matching the user-supplied spec's trigger -> auto-pause -> micro-chunk -> resume
 * pipeline.
 */
const SLIDE_MS = 1500;
const FOCUS_HOLD_MS = 5000; // how long the lecture stays frozen after a focus drop, before the Resume button appears
const DRIFT_HOLD_MS = 2000; // drift must persist this long before the tutor/pause reacts (avoids a fleeting glance)
/** The teacher breaks off to check the room roughly this often, the way a real one would. */
const UNDERSTANDING_CHECK_EVERY = 4;
type Stage = "slide" | "board";

export function AdhdLessonPlayer({ onExit, beats = demoBeats, title = "Photosynthesis", mood = "" }: { onExit?: () => void; beats?: Beat[]; title?: string; mood?: string }) {
  const [cameraEnabled, setCameraEnabled] = useState(false);
  // Camera is ASKED FOR explicitly (consent-gated). Until the student decides we don't touch it,
  // and if they decline the engagement score simply runs on behavioural signals instead.
  const [cameraDecision, setCameraDecision] = useState<null | "granted" | "declined">(null);
  const [askingCamera, setAskingCamera] = useState(false);
  // Behavioural engagement signals (used with OR without the camera).
  const [driftEvents, setDriftEvents] = useState(0);
  const [questionsAsked, setQuestionsAsked] = useState(0);
  const [lastInteractionAt, setLastInteractionAt] = useState(() => Date.now());
  const [comprehensionAsked, setComprehensionAsked] = useState(false);
  const [index, setIndex] = useState(0);
  const [speaking, setSpeaking] = useState(false);
  const [stage, setStage] = useState<Stage>("slide");
  const [voiceBlocked, setVoiceBlocked] = useState(false);
  const [checkpointResult, setCheckpointResult] = useState<CheckpointResult>(null);
  const [waitingOnCheckpoint, setWaitingOnCheckpoint] = useState(false);
  const [checkpointAttempts, setCheckpointAttempts] = useState(0);
  const [sentenceCue, setSentenceCue] = useState({ index: 0, total: 1, text: "" });
  const [drawProgress, setDrawProgress] = useState(0);
  // Highlighter: sweep the marker over board text, then ask Aria to explain THAT in detail.
  const [highlightMode, setHighlightMode] = useState(false);
  const [highlightExplaining, setHighlightExplaining] = useState(false);
  const highlightedTextRef = useRef("");

  // Focus-pause flow: when attention drops to/below the threshold, the lecture STOPS
  // immediately, holds frozen for FOCUS_HOLD_MS (nothing happens), then shows a Resume
  // button — the lecture only continues when the student clicks it. `null` = running
  // normally, "stopped" = frozen during the hold, "ready" = hold elapsed, awaiting click.
  const [focusPause, setFocusPause] = useState<null | "stopped" | "ready">(null);

  const slideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Bumped to (re)start narration for the current beat when there's nothing to resume. */
  const [startNonce, setStartNonce] = useState(0);
  const beat = beats[index];
  const isCheckpoint = beat.slideKind === "checkpoint";

  const attention = useAttentionMonitor(cameraEnabled);

  const chat = useLessonChat({
    topic: title,
    getBeatContext: () => `${beat.title}: ${beat.script}`,
    pausePlayer: () => machine.pause("user"),
    onVoiceBlocked: () => setVoiceBlocked(true),
  });

  // ── Live voice tutor (full-duplex realtime) — same wiring as the standard LessonPlayer ──
  const [liveBoard, setLiveBoard] = useState<RealtimeBoard | null>(null);
  const [sessionActive, setSessionActive] = useState(false);
  const beatRef = useRef(beat);
  useEffect(() => {
    beatRef.current = beat;
  }, [beat]);
  /** Mirrors focusPause for reads inside callbacks. */
  const focusPauseRef = useRef<null | "stopped" | "ready">(null);
  useEffect(() => {
    focusPauseRef.current = focusPause;
  }, [focusPause]);

  const tutor = useRealtimeTutor({
    topic: title,
    getBeatContext: () => `${beatRef.current.title}: ${beatRef.current.script}`,
    mood,
    // ADHD: mic stays open the whole lecture, board is simple chalk text, tutor can pause/resume.
    alwaysOn: true,
    boardTextOnly: true,
    lectureControlTools: true,
    onBoardRequest: (board) => setLiveBoard(board),
    // The MOMENT the student starts speaking, the lecture freezes — and it STAYS frozen until they
    // press Resume or say so. Nothing auto-resumes when the tutor finishes.
    onStudentSpeechStarted: () => {
      quiz.cancel(); // a question of the teacher's is moot once they've started asking their own
      // Freeze the lecture and cater to the question; resume on her own once she's answered.
      machine.enterChat({ resumeAfterAnswer: true });
      // An engaged student interrupts and asks — feed both signals into the engagement score.
      setQuestionsAsked((n) => n + 1);
      setLastInteractionAt(Date.now());
    },
    // Aria stopped talking. The lecture does NOT restart here — the only thing honoured is a resume
    // the student already asked for while she was mid-sentence.
    onTutorTurnComplete: () => {
      if (focusPauseRef.current) return;
      machine.flushDeferredResume();
    },
    onTranscript: (role, text, final) => {
      if (!final || !text.trim()) return;
      chat.appendTurn(role === "student" ? "you" : "aria", text);
    },
    // The tutor's pause_lecture / resume_lecture tools control the scripted lecture.
    onPauseLecture: () => machine.pause("user"),
    onResumeLecture: () => {
      if (holdTimer.current) clearTimeout(holdTimer.current);
      setFocusPause(null);
      // She usually says a quick "sure!" and then calls this, so the request is deferred until her
      // turn ends rather than starting the lecture over the top of her voice.
      machine.requestResume();
    },
    onSessionEnded: () => {
      // In always-on mode this only fires on error or explicit end; don't force-resume.
      setSessionActive(false);
      setLiveBoard(null);
    },
  });

  // ── The voice director and the lesson state machine ──────────────────────
  // Same two pieces as the standard player: the director guarantees the teacher and Aria are never
  // audible together, and the machine guarantees the lecture only restarts through `requestResume`.
  const voice = useVoiceDirector({
    tutorSpeaking: tutor.speaking,
    isChatbotSpeakingNow: tutor.isSpeaking,
  });
  const machine = useLessonMachine(voice);
  const playing = machine.playing;

  // ONE engagement number, always multi-factor. The camera (when granted and healthy) is blended
  // with behavioural signals — drift, missed checkpoints, questions asked, idle time — so the score
  // still works if the student declines the camera, and never depends on the camera alone.
  const engagement = useEngagementScore({
    cameraEngagement: attention.engagement,
    cameraDrifting: attention.drifting,
    cameraActive: cameraEnabled && attention.ready && !attention.error,
    driftEvents,
    questionsAsked,
    checkpointAttempts,
    lastInteractionAt,
    active: playing,
  });

  const quiz = useTeacherQuiz({
    voice,
    setMicEnabled: tutor.setMicEnabled,
    rate: 1,
    onPassed: () => {
      setLastInteractionAt(Date.now());
      machine.requestResume();
    },
    onFailed: () => {
      setLastInteractionAt(Date.now());
      machine.pause("wrong-answer");
    },
  });

  const liveMicLabel =
    tutor.status === "connecting"
      ? "Connecting…"
      : tutor.status === "drawing"
        ? "Drawing…"
        : tutor.speaking
          ? "Aria speaking…"
          : tutor.muted
            ? "Mic muted"
            : sessionActive
              ? "Mic on — say anything"
              : "";

  // In ADHD the mic is always-on and auto-started with the lecture, so the chat "mic" button is a
  // MUTE toggle. If the session isn't up yet (e.g. lecture not started), pressing it opens it.
  function toggleLiveMic() {
    if (!sessionActive) {
      unlockAudio();
      setSessionActive(true);
      void tutor.start();
      return;
    }
    tutor.toggleMute();
  }

  // Effect 1: slide -> board timing (identical to LessonPlayer's). `playing` goes false
  // during a focus pause, so this naturally halts then.
  useEffect(() => {
    // In ADHD the mic is always open (sessionActive) but the lecture keeps playing in the
    // background — only an actual pause (drift / pause_lecture / tutor speaking) sets playing=false.
    if (!playing || stage !== "slide" || isCheckpoint) return;
    if (slideTimer.current) clearTimeout(slideTimer.current);
    slideTimer.current = setTimeout(() => setStage("board"), SLIDE_MS);
    return () => {
      if (slideTimer.current) clearTimeout(slideTimer.current);
    };
  }, [index, playing, stage, isCheckpoint]);

  // Effect 2: normal narration. `playing` goes false during a focus pause, halting this.
  useEffect(() => {
    // NOTE: the lesson mode is deliberately NOT a dependency here. If it were, pausing would run the
    // cleanup and CANCEL the narration, so resuming replayed the beat from the top. Pause/resume is
    // handled by the effect below, which freezes the audio in place instead.
    if (machine.modeRef.current !== "teaching" || chat.busy) return;
    const narrateOnBoard = !isCheckpoint && stage === "board";
    const narrateOnCheckpointSlide = isCheckpoint && stage === "slide";
    if (!narrateOnBoard && !narrateOnCheckpointSlide) return;

    window.setTimeout(() => setDrawProgress(0.06), 0);
    voice.speakAsTeacher(beat.script, {
      onStart: () => setSpeaking(true),
      onSentenceStart: (sentenceIndex, sentence, total) => setSentenceCue({ index: sentenceIndex, text: sentence, total }),
      onProgress: (progress) => setDrawProgress(Math.max(0.06, progress)),
      onEnd: () => {
        setSpeaking(false);
        if (machine.modeRef.current !== "teaching") return;
        setDrawProgress(1);
        if (isCheckpoint) {
          setWaitingOnCheckpoint(true);
        } else {
          setIndex((i) => (i < beats.length - 1 ? i + 1 : i));
          setStage("slide");
        }
      },
      onBlocked: () => setVoiceBlocked(true),
    });

    return () => {
      voice.stopTeacher();
      setSpeaking(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, stage, isCheckpoint, beat.script, beats.length, chat.busy, startNonce]);

  // Pause/resume IN PLACE, driven by the ONE mode value — the ADHD track used to cancel narration
  // outright, which is why resuming replayed the whole section.
  useEffect(() => {
    if (machine.mode === "teaching") {
      if (!voice.resumeTeacher()) setStartNonce((n) => n + 1);
    } else {
      voice.pauseTeacher();
      setSpeaking(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [machine.mode]);

  // Aria took the floor while the lecture was running. Freeze it behind her AND arm auto-resume, so
  // the lecture continues on its own once she finishes rather than staying stranded paused. (A drift
  // nudge pauses the lecture first, so modeRef is no longer "teaching" and this doesn't reach it.)
  useEffect(() => {
    if (tutor.speaking && machine.modeRef.current === "teaching") machine.enterChat({ resumeAfterAnswer: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tutor.speaking]);


  // Effect 3: the ADHD focus mechanism. After DRIFT_HOLD_MS of SUSTAINED drift:
  //  - If the live tutor mic is open (sessionActive): the tutor VERBALLY nudges the student and
  //    pauses the lecture (via its pause_lecture tool / our onPauseLecture). The student can say
  //    "I'm ready" to resume, or use the Resume button.
  //  - Otherwise: the original silent freeze + hold + Resume-button flow.
  useEffect(() => {
    if (!playing || focusPause || isCheckpoint || !attention.drifting) return;
    setDriftEvents((n) => n + 1);
    // Require the drift to persist for DRIFT_HOLD_MS before reacting (avoids reacting to a glance).
    const trigger = setTimeout(() => {
      machine.pause("focus");
      if (sessionActive && tutor.status !== "idle") {
        // Tutor handles it out loud, then pauses the lecture itself.
        tutor.say(
          "The student's attention just drifted. Say ONE short, warm line telling them their focus " +
            "is drifting so you're pausing the lecture, and to let you know when they want to resume " +
            "(e.g. \"Looks like your focus is drifting — I'll pause here. Just tell me when you want " +
            "to keep going.\"). Do NOT offer a recap or ask any other question. Then call pause_lecture."
        );
        setFocusPause("ready"); // show a Resume affordance immediately; no silent hold needed
      } else {
        setFocusPause("stopped");
        if (holdTimer.current) clearTimeout(holdTimer.current);
        holdTimer.current = setTimeout(() => setFocusPause("ready"), FOCUS_HOLD_MS);
      }
    }, DRIFT_HOLD_MS);
    return () => clearTimeout(trigger);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attention.drifting, playing, focusPause, isCheckpoint, sessionActive]);

  // Clean up the hold timer on unmount.
  useEffect(() => () => {
    if (holdTimer.current) clearTimeout(holdTimer.current);
  }, []);

  function resumeFromFocusPause() {
    if (holdTimer.current) clearTimeout(holdTimer.current);
    unlockAudio();
    setLastInteractionAt(Date.now());
    setFocusPause(null);
    machine.requestResume(); // guarded: never starts under Aria's voice
  }

  function advanceFromCheckpoint() {
    setCheckpointResult(null);
    setCheckpointAttempts(0);
    setSentenceCue({ index: 0, total: 1, text: "" });
    setDrawProgress(0);
    setIndex((i) => (i < beats.length - 1 ? i + 1 : i));
    setStage("slide");
  }

  function handleCheckpointAnswer(answer: string) {
    const result = checkAnswer(beat, answer);
    setCheckpointResult(result);
    if (result?.correct) {
      window.setTimeout(advanceFromCheckpoint, 2200);
    } else {
      setCheckpointAttempts((n) => n + 1);
    }
  }

  function revealCheckpointAnswer() {
    if (!beat.checkpoint) return;
    setCheckpointResult({ correct: true, feedback: beat.checkpoint.revealAnswer, revealed: true });
    window.setTimeout(advanceFromCheckpoint, 2800);
  }

  function startLesson() {
    unlockAudio();
    // ALWAYS open the always-on mic on this click, BEFORE the camera prompt's early return — this
    // click is the gesture getUserMedia needs, and gating the mic behind the prompt broke it.
    if (REALTIME_TUTOR_ENABLED && !sessionActive) {
      setSessionActive(true);
      void tutor.start();
    }
    // Ask for the camera explicitly the first time. The lesson does NOT start until they choose;
    // either answer is fine — declining just means engagement runs on behavioural signals.
    if (cameraDecision === null) {
      setAskingCamera(true);
      return;
    }
    setVoiceBlocked(false);
    setLastInteractionAt(Date.now());
    machine.startTeaching();
  }
  /** Resolve the camera consent prompt, then actually begin the lesson either way. */
  function decideCamera(granted: boolean) {
    setCameraDecision(granted ? "granted" : "declined");
    setCameraEnabled(granted);
    setAskingCamera(false);
    setVoiceBlocked(false);
    setLastInteractionAt(Date.now());
    machine.startTeaching();
    if (REALTIME_TUTOR_ENABLED && !sessionActive) {
      setSessionActive(true);
      void tutor.start();
    }
  }

  /**
   * A short spoken check-in that does NOT stop the lecture. The "utterance" slot freezes the running
   * narration for just the ~3s the line takes, then `resumeTeacher()` continues it from where it
   * froze — a gentle nudge, never a blocking wait, so it can't strand the lecture paused. Returns
   * false (and does nothing) if Aria holds the channel.
   */
  const speakCheckIn = useCallback(
    (text: string) =>
      voice.speakAsTeacher(
        text,
        {
          onStart: () => setSpeaking(true),
          onEnd: () => { setSpeaking(false); voice.resumeTeacher(); },
          onBlocked: () => { setSpeaking(false); voice.resumeTeacher(); },
        },
        "utterance",
      ),
    [voice],
  );

  /**
   * The two engagement bands:
   *   below 30 — properly checked out. Fully pause the lecture; nothing continues until they resume.
   *   30 to 50 — still here but drifting. The TEACHER gives a quick spoken nudge and the lecture
   *              KEEPS GOING (it only pauses for the ~3s line), never a blocking question.
   */
  useEffect(() => {
    if (!engagement.low || !playing || comprehensionAsked || isCheckpoint || focusPause) return;
    if (voice.isChatbotSpeaking()) return; // she has the floor — we'll catch it on the next tick

    if (engagement.critical) {
      // Below 30: properly checked out — pause the video automatically.
      setComprehensionAsked(true);
      machine.pause("engagement");
      return;
    }
    // 30-50: a quick nudge that keeps the lecture going. Only mark it "done" if it actually spoke.
    if (speakCheckIn(`Quick check — are you still following this? Let's stay with it, this part matters.`)) {
      setComprehensionAsked(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engagement.low, engagement.critical, playing, comprehensionAsked, isCheckpoint, focusPause]);

  // The periodic "is this landing?" — every few sections, the way a real teacher checks the room.
  useEffect(() => {
    if (!playing || isCheckpoint || comprehensionAsked || focusPause) return;
    if (index === 0 || (index + 1) % UNDERSTANDING_CHECK_EVERY !== 0) return;
    if (stage !== "board" || drawProgress < 0.85) return; // wait until the section has been taught
    if (voice.isChatbotSpeaking()) return;
    if (speakCheckIn(`Quick check — is this making sense so far? Let's keep going.`)) {
      setComprehensionAsked(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, stage, drawProgress, playing, isCheckpoint, comprehensionAsked, focusPause]);

  // Re-arm the check-in when the lesson moves on.
  useEffect(() => {
    setComprehensionAsked(false);
  }, [beat.id]);

  function togglePlay() {
    setLastInteractionAt(Date.now());
    if (playing) {
      machine.pause("user");
    } else {
      unlockAudio();
      machine.requestResume();
    }
  }
  function retryVoice() {
    unlockAudio();
    if (holdTimer.current) clearTimeout(holdTimer.current);
    setFocusPause(null);
    setVoiceBlocked(false);
    setStage("slide");
    machine.requestResume();
  }

  /** Enter/leave highlight mode. Entering pauses the lecture so the board is still while marking. */
  function toggleHighlightMode() {
    setHighlightMode((on) => {
      if (!on) machine.pause("draw");
      else highlightedTextRef.current = "";
      return !on;
    });
  }
  /** Keep Aria's live context current so the highlighted text can be asked about by voice. */
  function handleHighlightChange(text: string) {
    highlightedTextRef.current = text;
    if (text.trim()) {
      tutor.addContext(
        `[Board note — the student just highlighted this on the board: "${text}"] ` +
          "If they ask you to explain it, explain THAT specifically, in detail.",
      );
    }
  }
  /**
   * Explain the highlighted text by VOICE using the live chatbot's context — no new board/animation.
   * The chatbot is handed the highlighted text and explains THAT in its own voice; the lecture stays
   * paused while she talks, and the student resumes when ready.
   */
  async function explainHighlighted(text: string) {
    const focus = text.trim();
    if (!focus || highlightExplaining) return;
    setHighlightMode(false);
    machine.pause("draw");
    tutor.addContext(`The student highlighted this on the board: "${focus}".`);
    if (REALTIME_TUTOR_ENABLED && sessionActive && tutor.status !== "idle") {
      tutor.say(
        `The student highlighted "${focus}" on the board and wants it explained in detail. Explain ` +
          `THAT specifically and clearly, out loud — what it means, why it matters, and a quick ` +
          `example. Do NOT draw a board or call any tools; just explain it in your voice.`,
      );
      return;
    }
    // Fallback (no live session): speak a focused explanation, still WITHOUT drawing a board.
    setHighlightExplaining(true);
    try {
      const res = await fetch("/api/explain", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          topic: title,
          beatContext: `${beat.title}: ${beat.script}`,
          textOnly: true,
          question:
            `Explain this specific thing the student highlighted, in detail but briefly, in plain ` +
            `spoken words — what it means, why it matters, a quick example: "${focus}".`,
        }),
      });
      if (!res.ok) throw new Error("explain failed");
      const board = (await res.json()) as RealtimeBoard;
      if (board?.script) {
        voice.speakAsTeacher(
          board.script,
          {
            onStart: () => setSpeaking(true),
            onEnd: () => setSpeaking(false),
            onBlocked: () => setVoiceBlocked(true),
          },
          "utterance",
        );
      }
    } catch {
      /* leave the lecture paused; the student can resume manually */
    } finally {
      setHighlightExplaining(false);
    }
  }
  function restart() {
    quiz.cancel();
    voice.stopTeacher();
    if (holdTimer.current) clearTimeout(holdTimer.current);
    setFocusPause(null);
    setWaitingOnCheckpoint(false);
    setCheckpointResult(null);
    setCheckpointAttempts(0);
    setSentenceCue({ index: 0, total: 1, text: "" });
    setIndex(0);
    setStage("slide");
    machine.startTeaching();
  }

  const hasStarted = playing || index > 0 || stage === "board";
  const progressPct = ((index + (stage === "board" ? 0.5 : 0)) / beats.length) * 100;
  const statusText = focusPause
    ? "paused — focus check"
    : speaking
      ? "explaining"
      : waitingOnCheckpoint
        ? "waiting on you"
        : stage === "slide"
          ? "setting up"
          : "drawing";

  return (
    <main className="hud-canvas hud-grain relative h-screen overflow-hidden">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_15%_0%,rgba(249,168,212,0.18),transparent_32%),radial-gradient(circle_at_88%_18%,rgba(96,165,250,0.18),transparent_34%),linear-gradient(180deg,#06080d_0%,#020617_72%)]" />

      <div className="absolute inset-0">
        <div className="absolute inset-2 grid gap-2 pt-[84px] lg:inset-4 lg:gap-3 lg:pt-[92px] xl:grid-cols-[minmax(0,1fr)_340px]">
          {/* Static corner brackets only — no .hud-scan/animated sweep on this player.
              Continuous ambient motion directly competes with useAttentionMonitor's
              gaze/blink signal, so it's a hard rule for this file: brackets are fine,
              animation is not. */}
          <section className="relative min-h-0 overflow-hidden rounded-xl border border-[var(--hud-line)] bg-slate-950/80 shadow-[0_32px_110px_rgba(0,0,0,0.34)]">
            <HudCorners accent="var(--accent-adhd)" />
            {stage === "slide" || isCheckpoint ? (
              <SlideStage
                beat={beat}
                onCheckpointAnswer={handleCheckpointAnswer}
                checkpointResult={checkpointResult}
                checkpointAttempts={checkpointAttempts}
                maxAttempts={MAX_ATTEMPTS}
                onRevealAnswer={revealCheckpointAnswer}
              />
            ) : (
              <div className="beat-fade-in relative h-full">
                <Board key={beat.id} beat={beat} sentenceCue={sentenceCue} drawProgress={drawProgress} />
                {highlightMode && (
                  <HighlightOverlay
                    onHighlight={handleHighlightChange}
                    onExplain={(text) => void explainHighlighted(text)}
                    onClose={() => setHighlightMode(false)}
                    busy={highlightExplaining}
                  />
                )}
                <div className="pointer-events-none absolute inset-x-0 bottom-0 z-40 p-3 lg:p-5">
                  <div className="mx-auto max-w-5xl rounded-2xl border border-white/10 bg-slate-950/86 px-5 py-3 text-center text-base font-bold leading-snug text-white shadow-2xl backdrop-blur-md">
                    {sentenceCue.text || beat.script}
                  </div>
                </div>
              </div>
            )}

            {chat.explainBoard && (
              <ExplainOverlay board={chat.explainBoard} progress={chat.drawProgress} onClose={chat.closeExplanation} />
            )}

            {/* Live-tutor / explanation board. Closing it must ALSO cut whatever narrates it — the
                chatbot's audio and any teacher utterance — so audio doesn't linger after you exit. */}
            {liveBoard && (
              <ExplainOverlay
                board={liveBoard}
                progress={1}
                onClose={() => { tutor.silence(); voice.stopUtterance(); setLiveBoard(null); }}
              />
            )}

            {/* Focus-pause overlay: freezes the board, holds 5s, then offers Resume. */}
            {focusPause && (
              <FocusPauseOverlay state={focusPause} onResume={resumeFromFocusPause} />
            )}

            {/* Camera consent — asked explicitly before the lesson starts. Declining is a first-class
                choice: engagement then runs purely on behavioural signals. */}
            {askingCamera && (
              <div className="absolute inset-0 z-50 grid place-items-center bg-slate-950/85 p-8 text-center backdrop-blur-md">
                <div className="max-w-lg">
                  <p className="hud-eyebrow text-[0.7rem] tracking-[0.2em] text-accent-adhd">Before we start</p>
                  <h2 className="mt-4 text-3xl font-black leading-tight text-white">
                    Can I use your camera to notice when your focus drifts?
                  </h2>
                  <p className="mx-auto mt-4 max-w-md text-sm font-medium leading-6 text-white/60">
                    It runs <strong className="text-white/80">entirely on your device</strong> — no video is ever
                    uploaded or stored. It only helps me spot when you&rsquo;ve zoned out so I can pause and check in.
                    You can say no; I&rsquo;ll track engagement from how you interact instead.
                  </p>
                  <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
                    <button
                      onClick={() => decideCamera(true)}
                      className="rounded-full px-6 py-3 text-sm font-black"
                      style={{ background: "linear-gradient(180deg, var(--accent-adhd-bright), var(--accent-adhd))", color: "#2b0a1a" }}
                    >
                      Allow camera
                    </button>
                    <button
                      onClick={() => decideCamera(false)}
                      className="rounded-full border border-white/20 bg-white/5 px-6 py-3 text-sm font-bold text-white/80 transition hover:bg-white/10"
                    >
                      Continue without it
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* The teacher's own question, on screen while she waits for the answer. */}
            <QuizPrompt
              quiz={quiz}
              accentVar="var(--accent-adhd)"
              onSkip={() => {
                setLastInteractionAt(Date.now());
                quiz.cancel();
                machine.requestResume();
              }}
            />

            {/* Missed her question: the lecture stays STOPPED until the student says to continue. */}
            {machine.pauseReason === "wrong-answer" && quiz.phase === "idle" && !focusPause && (
              <div className="absolute bottom-4 left-4 right-4 z-30 mx-auto flex max-w-xl flex-wrap items-center justify-center gap-3 rounded-2xl border border-amber-300/30 bg-slate-950/90 px-5 py-3 text-center shadow-xl backdrop-blur">
                <p className="w-full text-sm font-black text-amber-100">
                  Let&rsquo;s go over {beat.title.toLowerCase()} again — ask me anything about it.
                </p>
                <button
                  onClick={() => { setLastInteractionAt(Date.now()); machine.requestResume(); }}
                  className="rounded-full bg-emerald-400/20 px-3 py-1 text-xs font-black text-emerald-100 transition hover:bg-emerald-400/30"
                >
                  I&rsquo;ve got it — keep going
                </button>
              </div>
            )}
          </section>

          <div className="hidden min-h-0 xl:block [&>*]:h-full">
            <ChatPanel
              chat={chat.chat}
              explaining={chat.explaining}
              listening={chat.listening}
              interim={chat.interim}
              voiceSupported={REALTIME_TUTOR_ENABLED ? true : chat.voiceSupported}
              onAsk={chat.ask}
              // Mic is always-on in ADHD; the button toggles it/mute rather than ending a call.
              onVoice={REALTIME_TUTOR_ENABLED ? toggleLiveMic : chat.startVoice}
              liveActive={sessionActive}
              liveStatusLabel={liveMicLabel}
              liveMuted={tutor.muted}
              onLiveMute={tutor.toggleMute}
              liveError={tutor.errorMessage}
              liveAlwaysOn
            />
          </div>
        </div>

        <header className="absolute left-4 right-4 top-4 z-50 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--hud-line)] bg-slate-950/76 px-5 py-3.5 shadow-[0_24px_80px_rgba(0,0,0,0.34)] backdrop-blur-xl lg:left-6 lg:right-6 lg:top-6">
          <HudCorners accent="var(--accent-adhd)" />
          <div className="flex items-center gap-4">
            <button onClick={onExit} className="group relative" aria-label="Exit lecture">
              <AvatarRing progress={progressPct} speaking={speaking}>
                <TeacherAvatar speaking={speaking} size={52} />
              </AvatarRing>
            </button>
            <div>
              <p className="hud-eyebrow text-[11px] tracking-[0.16em] text-accent-adhd">
                {hasStarted ? <span className="capitalize">{statusText}…</span> : "ADHD-aware tutor"} · beat {index + 1}/{beats.length}
              </p>
              <h1 className="max-w-[36ch] truncate text-xl font-black tracking-tight">{title}</h1>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <EngagementMeter engagement={engagement} />
            <button
              onClick={hasStarted ? togglePlay : startLesson}
              className="rounded-full px-6 py-2.5 text-sm font-black"
              style={{ background: "linear-gradient(180deg, var(--accent-adhd-bright), var(--accent-adhd))", color: "#2b0a1a", boxShadow: "0 0 24px var(--accent-adhd-glow)" }}
            >
              {!hasStarted ? "Start lecture ▶" : playing ? "Pause ❙❙" : "Resume ▶"}
            </button>
            {hasStarted && (
              <button
                onClick={toggleHighlightMode}
                title="Highlight a term and have Aria explain it in detail"
                className={`rounded-full border px-5 py-2.5 text-sm font-bold transition ${
                  highlightMode ? "border-amber-300/50 bg-amber-300/15 text-amber-100" : "border-white/15 bg-white/5 text-white/80 hover:bg-white/10"
                }`}
              >
                {highlightMode ? "Stop highlight" : "Highlight"}
              </button>
            )}
            <button onClick={restart} className="rounded-full border border-white/15 bg-white/5 px-5 py-2.5 text-sm font-bold text-white/80 transition hover:bg-white/10">
              Restart
            </button>
            {onExit && (
              <button onClick={onExit} className="rounded-full border border-white/15 bg-white/5 px-5 py-2.5 text-sm font-bold text-white/80 transition hover:bg-white/10">
                Exit
              </button>
            )}
          </div>
        </header>

        {!hasStarted && (
          <div className="absolute left-4 right-4 top-28 z-50 rounded-2xl border border-accent-adhd/25 bg-accent-adhd/10 px-5 py-3.5 backdrop-blur-xl lg:left-6 lg:right-6">
            <p className="text-sm font-bold text-accent-adhd-bright">
              This track uses your camera only to detect attention drift in real time — nothing leaves your device. If you
              skip camera permission, the lecture still plays normally, just without auto-pause.
            </p>
          </div>
        )}

        {attention.error && hasStarted && (
          <div className="absolute left-4 right-4 top-28 z-50 rounded-2xl border border-amber-400/30 bg-amber-500/10 px-5 py-3.5 backdrop-blur-xl lg:left-6 lg:right-6">
            <p className="text-sm font-bold text-amber-200">{attention.error} Auto-pause is unavailable — the lecture still plays normally.</p>
          </div>
        )}

        {voiceBlocked && (
          <div className="absolute left-4 right-4 top-28 z-50 flex items-center justify-between gap-4 rounded-2xl border border-amber-400/30 bg-amber-500/10 px-5 py-3.5 backdrop-blur-xl lg:left-6 lg:right-6">
            <p className="text-sm font-bold text-amber-200">Your browser blocked the teacher&rsquo;s voice. Tap to enable sound.</p>
            <button onClick={retryVoice} className="shrink-0 rounded-full bg-amber-400 px-5 py-2 text-sm font-black text-amber-950">
              Enable sound
            </button>
          </div>
        )}
      </div>
    </main>
  );
}



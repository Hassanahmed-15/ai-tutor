"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { SlideStage } from "./SlideStage";
import { TeacherAvatar } from "./TeacherAvatar";
import { Board, AvatarRing, checkAnswer, MAX_ATTEMPTS, type CheckpointResult } from "./LessonPlayer";
import { beats as demoBeats, type Beat } from "@/lib/lessonContent";
import { unlockAudio } from "@/lib/voice";
import { useVoiceDirector } from "@/lib/useVoiceDirector";
import { useLessonMachine } from "@/lib/lessonMachine";
import { useTeacherQuiz } from "@/lib/useTeacherQuiz";
import { QuizPrompt } from "./QuizPrompt";
import { useAttentionMonitor } from "@/lib/useAttentionMonitor";
import { useLessonChat, ChatPanel, ExplainOverlay } from "./lesson-chat/LessonChat";
import { useRealtimeTutor, type RealtimeBoard } from "@/lib/useRealtimeTutor";
import { DrawOverlay } from "./sketch/DrawOverlay";
import { HighlightOverlay } from "./sketch/HighlightOverlay";
import { HudCorners } from "./hud/HudKit";

const UNDERSTANDING_CHECK_EVERY = 4;

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
type Stage = "slide" | "board";

export function AdhdLessonPlayer({ onExit, onComplete, beats = demoBeats, title = "Photosynthesis", mood = "" }: { onExit?: () => void; onComplete?: () => void; beats?: Beat[]; title?: string; mood?: string }) {
  const [cameraEnabled, setCameraEnabled] = useState(false);
  const [index, setIndex] = useState(0);
  const [speaking, setSpeaking] = useState(false);
  const [stage, setStage] = useState<Stage>("slide");
  const [voiceBlocked, setVoiceBlocked] = useState(false);
  const [checkpointResult, setCheckpointResult] = useState<CheckpointResult>(null);
  const [waitingOnCheckpoint, setWaitingOnCheckpoint] = useState(false);
  const [checkpointAttempts, setCheckpointAttempts] = useState(0);
  const [sentenceCue, setSentenceCue] = useState({ index: 0, total: 1, text: "" });
  const [drawProgress, setDrawProgress] = useState(0);
  const [rate] = useState(1);

  // Focus-pause flow: when attention drops to/below the threshold, the lecture STOPS
  // immediately, holds frozen for FOCUS_HOLD_MS (nothing happens), then shows a Resume
  // button — the lecture only continues when the student clicks it. `null` = running
  // normally, "stopped" = frozen during the hold, "ready" = hold elapsed, awaiting click.
  const [focusPause, setFocusPause] = useState<null | "stopped" | "ready">(null);
  // Two-way board: freehand sketch + highlighter (same as the standard LessonPlayer).
  const [drawMode, setDrawMode] = useState(false);
  const [askingDrawing, setAskingDrawing] = useState(false);
  const [highlightMode, setHighlightMode] = useState(false);
  const [highlightExplaining, setHighlightExplaining] = useState(false);
  const [drawingContext, setDrawingContext] = useState("");
  const [exportingPdf, setExportingPdf] = useState(false);
  const comprehensionAskedForRef = useRef(-1);

  const slideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const beat = beats[index];
  const isCheckpoint = beat.slideKind === "checkpoint";

  const attention = useAttentionMonitor(cameraEnabled);

  const chat = useLessonChat({
    topic: title,
    getBeatContext: () => `${beat.title}: ${beat.script}`,
    // Same unification as the standard LessonPlayer: a chat question pauses/resumes in place via
    // the lesson machine instead of destroying and restarting the beat's narration.
    pausePlayer: () => lesson.enterChat({ resumeAfterAnswer: true }),
    onVoiceBlocked: () => setVoiceBlocked(true),
  });

  // ── Live voice tutor (full-duplex realtime) — same wiring as the standard LessonPlayer ──
  const [liveBoard, setLiveBoard] = useState<RealtimeBoard | null>(null);
  const [sessionActive, setSessionActive] = useState(false);
  const beatRef = useRef(beat);
  useEffect(() => {
    beatRef.current = beat;
  }, [beat]);

  const tutor = useRealtimeTutor({
    topic: title,
    getBeatContext: () => `${beatRef.current.title}: ${beatRef.current.script}`,
    mood,
    // ADHD: mic stays open the whole lecture, board is simple chalk text, tutor can pause/resume.
    alwaysOn: true,
    boardTextOnly: true,
    lectureControlTools: true,
    onBoardRequest: (board) => setLiveBoard(board),
    // The MOMENT the student starts speaking, pause the lecture — and it STAYS paused until the
    // student explicitly asks to resume (no auto-resume when the tutor finishes, unlike the
    // standard LessonPlayer's enterChat({resumeAfterAnswer:true}) — ADHD's design is deliberately
    // "stays paused until YOU say so", so this uses a plain pause(), not enterChat()).
    onStudentSpeechStarted: () => lesson.pause("user"),
    // NO auto-resume by default — but if the tutor was still mid-sentence when resume_lecture was
    // called, requestResume() deferred it; this is the ONLY thing that flushes that deferred
    // resume. It does nothing if no resume was ever requested (the common ADHD case).
    onTutorTurnComplete: () => lesson.flushDeferredResume(),
    onTranscript: (role, text, final) => {
      if (!final || !text.trim()) return;
      chat.appendTurn(role === "student" ? "you" : "aria", text);
    },
    // The tutor's pause_lecture / resume_lecture tools control the scripted lecture.
    onPauseLecture: () => lesson.pause("user"),
    onResumeLecture: () => {
      if (holdTimer.current) clearTimeout(holdTimer.current);
      setFocusPause(null);
      // requestResume() itself defers to flushDeferredResume() if the tutor is still mid-sentence
      // (isChatbotSpeaking()), so the lecture never starts over the tutor's voice.
      lesson.requestResume();
    },
    onSessionEnded: () => {
      // In always-on mode this only fires on error or explicit end; don't force-resume.
      setSessionActive(false);
      setLiveBoard(null);
    },
  });

  const voice = useVoiceDirector({ tutorSpeaking: tutor.speaking, isChatbotSpeakingNow: tutor.isSpeaking });
  const lesson = useLessonMachine(voice);

  const stopVoice = useCallback(() => {
    voice.stopTeacher();
    setSpeaking(false);
  }, [voice]);

  const quiz = useTeacherQuiz({
    voice,
    setMicEnabled: tutor.setMicEnabled,
    rate,
    onPassed: () => lesson.requestResume(),
    onFailed: () => lesson.pause("wrong-answer"),
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

  // Effect 1: slide -> board timing (identical to LessonPlayer's). `lesson.playing` goes false
  // during a focus pause, so this naturally halts then.
  useEffect(() => {
    // In ADHD the mic is always open (sessionActive) but the lecture keeps playing in the
    // background — only an actual pause (drift / pause_lecture / tutor speaking) halts it.
    if (!lesson.playing || stage !== "slide" || isCheckpoint) return;
    if (slideTimer.current) clearTimeout(slideTimer.current);
    slideTimer.current = setTimeout(() => setStage("board"), SLIDE_MS);
    return () => {
      if (slideTimer.current) clearTimeout(slideTimer.current);
    };
  }, [index, lesson.playing, stage, isCheckpoint]);

  // Effect 2: normal narration, through the voice director (single audio owner) instead of calling
  // playNarration directly — the director already freezes the teacher the instant the chatbot
  // speaks, which is what the old belt-and-suspenders "tutor speaking pauses" effect did by hand.
  useEffect(() => {
    if (!lesson.playing || chat.busy) return;
    const narrateOnBoard = !isCheckpoint && stage === "board";
    const narrateOnCheckpointSlide = isCheckpoint && stage === "slide";
    if (!narrateOnBoard && !narrateOnCheckpointSlide) return;

    window.setTimeout(() => setDrawProgress(0), 0);
    const started = voice.speakAsTeacher(
      beat.script,
      {
        onStart: () => setSpeaking(true),
        onSentenceStart: (sentenceIndex, sentence, total) => setSentenceCue({ index: sentenceIndex, text: sentence, total }),
        onProgress: (progress) => setDrawProgress(Math.max(0, progress)),
        onEnd: () => {
          setSpeaking(false);
          if (!lesson.playing) return;
          setDrawProgress(1);
          if (isCheckpoint) {
            setWaitingOnCheckpoint(true);
          } else {
            setIndex((i) => {
              if (i < beats.length - 1) return i + 1;
              onComplete?.();
              return i;
            });
            setStage("slide");
          }
        },
        onBlocked: () => setVoiceBlocked(true),
        rate,
      },
      "lecture"
    );
    if (!started) return;

    return () => {
      voice.stopTeacher();
      setSpeaking(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, lesson.playing, stage, isCheckpoint, beat.script, rate, beats.length, chat.busy, onComplete]);

  // Effect 3: the ADHD focus mechanism. After DRIFT_HOLD_MS of SUSTAINED drift:
  //  - If the live tutor mic is open (sessionActive): the tutor VERBALLY nudges the student and
  //    pauses the lecture (via its pause_lecture tool / our onPauseLecture). The student can say
  //    "I'm ready" to resume, or use the Resume button.
  //  - Otherwise: the original silent freeze + hold + Resume-button flow.
  useEffect(() => {
    if (!lesson.playing || focusPause || isCheckpoint || !attention.drifting) return;
    // Require the drift to persist for DRIFT_HOLD_MS before reacting (avoids reacting to a glance).
    const trigger = setTimeout(() => {
      stopVoice();
      lesson.pause("focus");
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
  }, [attention.drifting, lesson.playing, focusPause, isCheckpoint, sessionActive]);

  // Clean up the hold timer on unmount.
  useEffect(() => () => {
    if (holdTimer.current) clearTimeout(holdTimer.current);
  }, []);

  // The teacher's own periodic comprehension check (same cadence as the standard LessonPlayer),
  // on top of the camera-based drift detection above — a real teacher checks in occasionally even
  // when attention looks fine.
  useEffect(() => {
    if (!lesson.playing || comprehensionAskedForRef.current === index || isCheckpoint || waitingOnCheckpoint) return;
    const due = index > 0 && index % UNDERSTANDING_CHECK_EVERY === 0 && stage === "board" && !speaking;
    if (!due) return;
    comprehensionAskedForRef.current = index;
    quiz.ask({
      kind: "comprehension",
      question: `Quick check — in your own words, what's the main idea of "${beat.title}" so far?`,
      expected: beat.script,
    });
  }, [lesson.playing, isCheckpoint, waitingOnCheckpoint, index, stage, speaking, quiz, beat.title, beat.script]);

  function resumeFromFocusPause() {
    if (holdTimer.current) clearTimeout(holdTimer.current);
    unlockAudio();
    setFocusPause(null);
    lesson.requestResume();
  }

  function advanceFromCheckpoint() {
    setCheckpointResult(null);
    setCheckpointAttempts(0);
    setSentenceCue({ index: 0, total: 1, text: "" });
    setDrawProgress(0);
    setIndex((i) => {
      if (i < beats.length - 1) return i + 1;
      onComplete?.();
      return i;
    });
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
    setCameraEnabled(true);
    setVoiceBlocked(false);
    lesson.startTeaching();
    // ADHD: open the always-on tutor mic in the background so the student can talk anytime and the
    // tutor can nudge on drift. The lecture keeps playing; the tutor only speaks when needed.
    if (REALTIME_TUTOR_ENABLED && !sessionActive) {
      setSessionActive(true);
      void tutor.start();
    }
  }
  function togglePlay() {
    if (lesson.playing) {
      stopVoice();
      lesson.pause("user");
    } else {
      unlockAudio();
      lesson.requestResume();
    }
  }
  function retryVoice() {
    unlockAudio();
    if (holdTimer.current) clearTimeout(holdTimer.current);
    setFocusPause(null);
    setVoiceBlocked(false);
    setStage("slide");
    lesson.startTeaching();
  }
  function restart() {
    stopVoice();
    if (holdTimer.current) clearTimeout(holdTimer.current);
    setFocusPause(null);
    setWaitingOnCheckpoint(false);
    setCheckpointResult(null);
    setCheckpointAttempts(0);
    setSentenceCue({ index: 0, total: 1, text: "" });
    setIndex(0);
    setStage("slide");
    lesson.startTeaching();
  }

  const hasStarted = lesson.mode !== "idle" || index > 0 || stage === "board";
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

            {/* Live-tutor board drawn by the realtime show_board tool. Closing it clears the board
                only — the live session stays active. */}
            {liveBoard && (
              <ExplainOverlay board={liveBoard} progress={1} autoReveal onClose={() => setLiveBoard(null)} />
            )}

            {/* Focus-pause overlay: freezes the board, holds 5s, then offers Resume. */}
            {focusPause && (
              <FocusPauseOverlay state={focusPause} onResume={resumeFromFocusPause} />
            )}

            {drawMode && (
              <DrawOverlay
                busy={askingDrawing}
                seenLabel={drawingContext ? "Aria can see this — just ask" : undefined}
                onClose={() => setDrawMode(false)}
                onDrawingChange={(dataUrl) => {
                  setAskingDrawing(true);
                  fetch("/api/ask-drawing", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      image: dataUrl,
                      topic: title,
                      beatContext: `${beat.title}: ${beat.script}`,
                      describeOnly: true,
                    }),
                  })
                    .then((res) => res.json().catch(() => ({})))
                    .then((data) => {
                      const description = typeof data.description === "string" ? data.description : "";
                      setDrawingContext(description);
                      if (description && description !== "NOTHING") {
                        tutor.addContext(`The student drew this on the board: ${description}`);
                      }
                    })
                    .catch(() => {})
                    .finally(() => setAskingDrawing(false));
                }}
              />
            )}

            {highlightMode && (
              <HighlightOverlay
                busy={highlightExplaining}
                onClose={() => setHighlightMode(false)}
                onHighlight={(text) => {
                  if (text) tutor.addContext(`The student highlighted this on the board: "${text}"`);
                }}
                onExplain={(text) => {
                  setHighlightExplaining(true);
                  voice.speakAsTeacher(
                    `Let's look at that more closely — ${text}.`,
                    { onStart: () => {}, onEnd: () => setHighlightExplaining(false), onBlocked: () => setHighlightExplaining(false), rate },
                    "utterance"
                  );
                }}
              />
            )}

            {quiz.phase !== "idle" && <QuizPrompt quiz={quiz} onSkip={() => { quiz.cancel(); lesson.requestResume(); }} />}
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
            <EngagementMeter attention={attention} cameraEnabled={cameraEnabled} />
            <button
              onClick={() => {
                setHighlightMode(false);
                setDrawMode((v) => !v);
              }}
              aria-label="Draw on the board"
              title="Sketch on the board, then ask Aria about it"
              className={`rounded-full border px-3 py-2.5 text-sm font-black transition lg:px-4 ${
                drawMode ? "border-cyan-300/50 bg-cyan-300/15 text-cyan-100" : "border-white/15 bg-white/5 text-white/80 hover:bg-white/10"
              }`}
            >
              <span aria-hidden="true">✎</span><span className="hidden lg:inline"> Draw</span>
            </button>
            <button
              onClick={() => {
                setDrawMode(false);
                setHighlightMode((v) => !v);
              }}
              aria-label="Highlight the board"
              title="Sweep the marker over anything on the board to ask about it"
              className={`rounded-full border px-3 py-2.5 text-sm font-black transition lg:px-4 ${
                highlightMode ? "border-amber-300/50 bg-amber-300/15 text-amber-100" : "border-white/15 bg-white/5 text-white/80 hover:bg-white/10"
              }`}
            >
              <span aria-hidden="true">▧</span><span className="hidden lg:inline"> Highlight</span>
            </button>
            <button
              onClick={async () => {
                setExportingPdf(true);
                try {
                  const res = await fetch("/api/export-pdf", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ topic: title, beats }),
                  });
                  if (!res.ok) throw new Error("export failed");
                  const blob = await res.blob();
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement("a");
                  a.href = url;
                  a.download = `${title.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.pdf`;
                  a.click();
                  URL.revokeObjectURL(url);
                } catch {
                  /* PDF export failures shouldn't interrupt the lesson */
                } finally {
                  setExportingPdf(false);
                }
              }}
              disabled={exportingPdf}
              title="Export this lesson as a PDF"
              className="rounded-full border border-white/15 bg-white/5 px-4 py-2.5 text-sm font-black text-white/80 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {exportingPdf ? "Exporting…" : "Export PDF"}
            </button>
            <button
              onClick={hasStarted ? togglePlay : startLesson}
              className="rounded-full px-6 py-2.5 text-sm font-black"
              style={{ background: "linear-gradient(180deg, var(--accent-adhd-bright), var(--accent-adhd))", color: "#2b0a1a", boxShadow: "0 0 24px var(--accent-adhd-glow)" }}
            >
              {!hasStarted ? "Start lecture ▶" : lesson.playing ? "Pause ❙❙" : "Resume ▶"}
            </button>
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

function EngagementMeter({ attention, cameraEnabled }: { attention: ReturnType<typeof useAttentionMonitor>; cameraEnabled: boolean }) {
  if (!cameraEnabled || attention.error) return null;
  const pct = Math.round(attention.engagement * 100);
  return (
    <div className="flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3.5 py-2" title="Live engagement (camera-based, processed on-device)">
      <span className={`size-2 rounded-full ${attention.drifting ? "bg-amber-400" : "bg-accent-adhd"}`} />
      <span className="text-xs font-black tabular-nums text-white/75">{attention.ready ? `${pct}% engaged` : "starting…"}</span>
    </div>
  );
}

/** Shown when attention dropped to/below the threshold: freezes the lecture with a dimming
 *  overlay. During the 5s hold ("stopped") it just says it paused; once the hold elapses
 *  ("ready") it offers a Resume button — the lecture only continues on click. A single
 *  one-shot fade-in (beat-fade-in) is fine here since it plays once per pause, not on a loop —
 *  no ambient/infinite motion is added, consistent with this player's no-new-motion rule. */
function FocusPauseOverlay({ state, onResume }: { state: "stopped" | "ready"; onResume: () => void }) {
  return (
    <div className="beat-fade-in absolute inset-0 z-50 grid place-items-center bg-slate-950/80 p-10 text-center backdrop-blur-md">
      <div>
        <p className="hud-eyebrow text-[0.7rem] tracking-[0.2em] text-accent-adhd">Focus check</p>
        <p className="mx-auto mt-5 max-w-xl text-4xl font-black leading-tight text-white">
          Looks like your focus drifted — the lecture is paused.
        </p>
        {state === "stopped" ? (
          <p className="mt-6 text-lg font-bold text-white/55">Take a breather… hang tight for a moment.</p>
        ) : (
          <button
            onClick={onResume}
            className="mt-8 rounded-full px-9 py-3.5 text-lg font-black text-slate-950 shadow-[0_0_36px_var(--accent-adhd-glow)] transition hover:shadow-[0_0_52px_var(--accent-adhd-glow)]"
            style={{ background: "linear-gradient(to right, var(--accent-adhd-bright), var(--accent-adhd))" }}
          >
            Resume lecture ▶
          </button>
        )}
      </div>
    </div>
  );
}

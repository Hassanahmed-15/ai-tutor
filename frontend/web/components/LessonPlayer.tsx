"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { SlideStage } from "./SlideStage";
import { TeacherAvatar } from "./TeacherAvatar";
import { beats as demoBeats, type Beat } from "@/lib/lessonContent";
import { playNarration, unlockAudio, splitNarrationSentences, type NarrationHandle } from "@/lib/voice";
import { LiveSketch } from "./sketch/LiveSketch";
import { ReactAnimationSandbox } from "./sketch/ReactAnimationSandbox";
import { useLessonChat, ChatPanel, ExplainOverlay } from "./lesson-chat/LessonChat";
import { HudCorners } from "./hud/HudKit";
import { useRealtimeTutor, type RealtimeBoard } from "@/lib/useRealtimeTutor";
import { LearningExperienceOverlay, PastYouEcho } from "./experience/LearningExperiences";

// Client mirror of the server's REALTIME_TUTOR_ENABLED flag — gates the "Talk to tutor" button.
const REALTIME_TUTOR_ENABLED = process.env.NEXT_PUBLIC_REALTIME_TUTOR_ENABLED === "1";

// Client-side mirror of the server's REACT_ANIMATIONS_ENABLED kill switch (see
// app/api/generate-lecture/route.ts). When off, beats never carry filled `code` anyway (the
// server never generates it), so this only guards against rendering stale cached beats.
const REACT_ANIMATIONS_ENABLED = process.env.NEXT_PUBLIC_REACT_ANIMATIONS_ENABLED === "1";
// Client mirror of the server's BLACKBOARD_GEN_ENABLED (see app/api/generate-lecture/route.ts).
const BLACKBOARD_GEN_ENABLED = process.env.NEXT_PUBLIC_BLACKBOARD_GEN_ENABLED === "1";

/**
 * The live tutor: each beat opens on a slide (sets up the idea), auto-flips into the
 * live hand-drawn board once the teacher starts talking, and — for checkpoint beats —
 * stops and waits for the student to actually answer before continuing. Real lecture
 * pacing (~5 min, 15 beats with definitions, 3 checkpoints, a comparison, and a recap),
 * not five disconnected facts.
 */
const SLIDE_MS = 1500;
export const MAX_ATTEMPTS = 2; // wrong answers allowed before "show me the answer" appears
type Stage = "slide" | "board";
export type CheckpointResult = { correct: boolean; feedback: string; revealed?: boolean } | null;

const PHOTOSYNTHESIS_SCENE_IDS = new Set([
  "hook",
  "define-photosynthesis",
  "ingredients-fast",
  "chloroplast",
  "mechanism",
  "outputs",
  "compare-respiration",
  "why-it-matters",
  "recap",
]);

export function checkAnswer(beat: Beat, answer: string): CheckpointResult {
  if (!beat.checkpoint) return null;
  const lower = answer.toLowerCase();
  const matched = beat.checkpoint.acceptableKeywords.some((set) => set.every((kw) => lower.includes(kw)));
  return matched
    ? { correct: true, feedback: beat.checkpoint.correctFeedback }
    : { correct: false, feedback: beat.checkpoint.hintFeedback };
}

function findReactAnimationOp(beat: Beat) {
  return beat.draw?.ops.find((op) => op.kind === "reactAnimation");
}

function isReactAnimationPending(beat: Beat) {
  const op = findReactAnimationOp(beat);
  return Boolean(op && REACT_ANIMATIONS_ENABLED && !op.code && op.status !== "failed");
}

function findChalkBoardOp(beat: Beat) {
  return beat.draw?.ops.find((op) => op.kind === "chalkBoard");
}

function isChalkBoardPending(beat: Beat) {
  const op = findChalkBoardOp(beat);
  return Boolean(op && BLACKBOARD_GEN_ENABLED && (!op.ops || op.ops.length === 0) && op.status !== "failed");
}


export function LessonPlayer({
  onExit,
  onComplete,
  beats = demoBeats,
  title = "Photosynthesis",
  mode = "standard",
  mood = "",
  autoVoiceAssistant = true,
}: {
  onExit?: () => void;
  /** Fired once, when the last beat finishes playing (natural end of lecture) — distinct from
   *  onExit, which fires on a manual exit at any point. */
  onComplete?: () => void;
  beats?: Beat[];
  title?: string;
  mode?: "standard" | "deaf";
  /** Freeform learner-mode string fed into the live tutor's session instructions. */
  mood?: string;
  /** Disable only for nested remediation players so one lesson never opens two mic sessions. */
  autoVoiceAssistant?: boolean;
}) {
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [stage, setStage] = useState<Stage>("slide");
  const [voiceBlocked, setVoiceBlocked] = useState(false);
  const [checkpointResult, setCheckpointResult] = useState<CheckpointResult>(null);
  const [waitingOnCheckpoint, setWaitingOnCheckpoint] = useState(false);
  const [checkpointAttempts, setCheckpointAttempts] = useState(0);
  const [sentenceCue, setSentenceCue] = useState({ index: 0, total: 1, text: "" });
  const [captionLog, setCaptionLog] = useState<string[]>([]);
  const [drawProgress, setDrawProgress] = useState(0);
  const [rate, setRate] = useState(1);
  const [learningExperience, setLearningExperience] = useState<"fork" | "twin" | "teach" | null>(null);
  const resumeAfterExperience = useRef(false);
  const cancelRef = useRef<NarrationHandle | null>(null);
  const slideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Mirror `playing` into a ref so async narration callbacks (which capture the value at the time
  // playback started) can read the LIVE pause state — otherwise a narration's onEnd that fires
  // right as the user pauses would still auto-advance the beat using a stale playing=true.
  const playingRef = useRef(playing);
  const conversationActiveRef = useRef(false);
  useEffect(() => {
    playingRef.current = playing;
  }, [playing]);
  const beat = beats[index];
  const isCheckpoint = beat.slideKind === "checkpoint";
  const currentAnimationPending = isReactAnimationPending(beat) || isChalkBoardPending(beat);
  const deafMode = mode === "deaf";

  const stopVoice = useCallback(() => {
    cancelRef.current?.cancel();
    cancelRef.current = null;
    setSpeaking(false);
  }, []);

  // Shared side-chat. Asking a question pauses the lecture; closing the explanation lets the
  // narration effect re-run (chat.busy flips false) and resume the current beat.
  const chat = useLessonChat({
    topic: title,
    getBeatContext: () => `${beat.title}: ${beat.script}`,
    pausePlayer: stopVoice,
    onVoiceBlocked: () => setVoiceBlocked(true),
  });

  // ── Live voice tutor (full-duplex realtime) ──────────────────────────────
  // A board the realtime tutor draws via its show_board tool. Kept SEPARATE from chat.explainBoard
  // because the realtime model narrates the board itself — we must NOT run playNarration for it,
  // which would violate the single-speaker invariant.
  const [liveBoard, setLiveBoard] = useState<RealtimeBoard | null>(null);
  // `sessionActive` means the realtime tutor currently owns the floor. The underlying WebRTC
  // session can remain connected and privacy-muted while the scripted lecture continues.
  const [sessionActive, setSessionActive] = useState(false);
  const beatRef = useRef(beat);
  useEffect(() => {
    beatRef.current = beat;
  }, [beat]);

  const tutor = useRealtimeTutor({
    topic: title,
    getBeatContext: () => `${beatRef.current.title}: ${beatRef.current.script}`,
    mood,
    onBoardRequest: (board) => setLiveBoard(board),
    onTranscript: (role, text, final) => {
      // Finalized lines flow into the chat log so the live conversation shows up in the chat
      // panel (not a separate bottom bar). student -> "you", tutor -> "aria".
      if (!final || !text.trim()) return;
      chat.appendTurn(role === "student" ? "you" : "aria", text);
    },
    onSessionEnded: () => {
      conversationActiveRef.current = false;
      setSessionActive(false);
      setLiveBoard(null);
      cancelRef.current?.resume();
      setPlaying(true);
    },
    onStudentSpeechStarted: () => {
      if (!playingRef.current) return;
      conversationActiveRef.current = true;
      setSessionActive(true);
      cancelRef.current?.pause();
      if (slideTimer.current) {
        clearTimeout(slideTimer.current);
        slideTimer.current = null;
      }
    },
    onTutorTurnComplete: () => {
      if (!conversationActiveRef.current) return;
      conversationActiveRef.current = false;
      setSessionActive(false);
      if (!tutor.muted) tutor.toggleMute();
      cancelRef.current?.resume();
      if (!cancelRef.current && playingRef.current && stage === "slide" && !isCheckpoint) {
        setStage("board");
      }
    },
    startMuted: true,
    alwaysOn: autoVoiceAssistant,
  });

  // Short label for the chat mic button while a live session is active/connecting.
  const liveMicLabel =
    tutor.status === "connecting"
      ? "Connecting…"
      : tutor.status === "drawing"
        ? "Drawing…"
        : tutor.speaking
          ? "Aria speaking…"
          : sessionActive
            ? "Listening — tap to end"
            : "";

  function startLiveTutor() {
    // The session is normally preconnected and muted. Taking the floor pauses the existing media
    // object, preserving its timestamp so it can continue exactly after the tutor's response.
    conversationActiveRef.current = true;
    cancelRef.current?.pause();
    if (slideTimer.current) {
      clearTimeout(slideTimer.current);
      slideTimer.current = null;
    }
    setSessionActive(true);
    if (tutor.status === "idle" || tutor.status === "error" || tutor.status === "mic-denied") {
      void tutor.start();
    } else if (tutor.muted) {
      tutor.toggleMute();
    }
  }
  function endLiveTutor() {
    tutor.stop(); // onSessionEnded resumes the lecture in the normal case
    // Safety net: if the realtime session errored out earlier and its internal teardown guard
    // already fired once (silently, e.g. on a dropped connection), tutor.stop() here is a no-op
    // and onSessionEnded never re-fires — leaving the lecture paused forever. Force the same
    // resume state directly so pressing "end call" always works, even in that edge case.
    setSessionActive(false);
    conversationActiveRef.current = false;
    setLiveBoard(null);
    cancelRef.current?.resume();
    setPlaying(true);
  }

  // Drives each beat: show its slide briefly, then (for normal beats) flip to the board
  // and narrate; on voice end, advance. Checkpoint beats narrate the question on the slide
  // itself and then STOP — they wait for submitCheckpoint() instead of auto-advancing.
  // Effect 1: while a beat is on its intro slide, count down then flip to "board" (skipped
  // for checkpoints, which narrate right on the slide). This effect ONLY sets `stage` — it
  // never starts narration itself, so it can't race with the narration effect's cleanup.
  useEffect(() => {
    if (!playing || conversationActiveRef.current || stage !== "slide" || isCheckpoint || currentAnimationPending) return;
    if (slideTimer.current) clearTimeout(slideTimer.current);
    slideTimer.current = setTimeout(() => setStage("board"), SLIDE_MS);
    return () => {
      if (slideTimer.current) clearTimeout(slideTimer.current);
    };
  }, [index, playing, stage, isCheckpoint, currentAnimationPending]);

  // Effect 2: start narration exactly once per (beat, stage) — when a checkpoint's slide
  // appears, or once a normal beat reaches "board". Separate from effect 1 so flipping
  // `stage` here doesn't retrigger effect 1 and cancel narration mid-start.
  useEffect(() => {
    if (!playing || chat.busy || conversationActiveRef.current) return;
    const narrateOnBoard = !isCheckpoint && stage === "board";
    const narrateOnCheckpointSlide = isCheckpoint && stage === "slide";
    if (!narrateOnBoard && !narrateOnCheckpointSlide) return;
    if (narrateOnBoard && currentAnimationPending) return;
    window.setTimeout(() => setDrawProgress(0), 0);
    const handle = playNarration(beat.script, {
      onStart: () => setSpeaking(true),
      onSentenceStart: (sentenceIndex, sentence, total) => {
        setSentenceCue({ index: sentenceIndex, text: sentence, total });
        if (deafMode) {
          const caption = sentence.trim();
          setCaptionLog((lines) => {
            if (!caption || lines[lines.length - 1] === caption) return lines;
            return [...lines, caption].slice(-9);
          });
        }
      },
      // The media element's clock is the source of truth for board progress. This keeps the
      // live marker, generated SVG progress, and beat advancement pinned to the actual voice.
      onProgress: (progress) => setDrawProgress(Math.max(0, progress)),
      onEnd: () => {
        setSpeaking(false);
        cancelRef.current = null;
        // If playback was paused between the last cue and this onEnd firing, do NOT advance —
        // freeze on the current beat. Resuming re-runs the narration effect for this beat.
        if (!playingRef.current) return;
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
    });
    cancelRef.current = handle;

    return () => {
      handle.cancel();
      cancelRef.current = null;
      setSpeaking(false);
    };
  }, [index, playing, stage, isCheckpoint, beat.script, rate, beats.length, chat.busy, deafMode, onComplete, currentAnimationPending]);

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

  // A checkpoint is REAL now: a wrong answer shows a hint and lets the student try again —
  // it does not advance the lecture. Only a correct answer (or explicitly giving up after
  // MAX_ATTEMPTS) moves on. This is the actual difference between a teaching checkpoint and
  // a quiz popup that continues regardless of what you typed.
  function handleCheckpointAnswer(answer: string) {
    const result = checkAnswer(beat, answer);
    setCheckpointResult(result);
    if (result?.correct) {
      window.setTimeout(advanceFromCheckpoint, 2200);
    } else {
      setCheckpointAttempts((n) => n + 1);
      // stays on the checkpoint — waitingOnCheckpoint remains true, input re-opens for retry
    }
  }

  function revealCheckpointAnswer() {
    if (!beat.checkpoint) return;
    setCheckpointResult({ correct: true, feedback: beat.checkpoint.revealAnswer, revealed: true });
    window.setTimeout(advanceFromCheckpoint, 2800);
  }

  function startLesson() {
    unlockAudio(); // must run inside this click handler — that's what satisfies the autoplay gate
    setVoiceBlocked(false);
    setPlaying(true);
    if (REALTIME_TUTOR_ENABLED && autoVoiceAssistant && tutor.status === "idle") {
      // The click is a browser permission gesture: initialize once, keep the outgoing track muted,
      // and leave the lecture playing until the learner explicitly unmutes or starts a conversation.
      void tutor.start();
    }
  }
  function togglePlay() {
    if (playing) {
      // Pausing: stop narration immediately so audio + the sentence-cue timeline halt at once,
      // and cancel the slide→board timer so the beat can't flip stage while paused.
      stopVoice();
      if (slideTimer.current) {
        clearTimeout(slideTimer.current);
        slideTimer.current = null;
      }
    } else {
      unlockAudio();
    }
    setPlaying((p) => !p);
  }
  function retryVoice() {
    unlockAudio();
    setVoiceBlocked(false);
    setStage("slide");
    setPlaying(true);
  }
  function goTo(i: number) {
    stopVoice();
    if (slideTimer.current) clearTimeout(slideTimer.current);
    setWaitingOnCheckpoint(false);
    setCheckpointResult(null);
    setCheckpointAttempts(0);
    setSentenceCue({ index: 0, total: 1, text: "" });
    setDrawProgress(0);
    if (deafMode) setCaptionLog([]);
    setIndex(i);
    setStage("slide");
    setPlaying(true);
  }
  function restart() {
    stopVoice();
    setWaitingOnCheckpoint(false);
    setCheckpointResult(null);
    setCheckpointAttempts(0);
    setSentenceCue({ index: 0, total: 1, text: "" });
    setDrawProgress(0);
    if (deafMode) setCaptionLog([]);
    setIndex(0);
    setStage("slide");
    setPlaying(true);
  }
  function skipForward() {
    if (index < beats.length - 1) goTo(index + 1);
  }
  function cycleRate() {
    setRate((r) => (r >= 1.5 ? 0.85 : r === 0.85 ? 1 : 1.25));
  }

  function openLearningExperience(experience: "fork" | "twin" | "teach") {
    resumeAfterExperience.current = playing;
    stopVoice();
    if (slideTimer.current) {
      clearTimeout(slideTimer.current);
      slideTimer.current = null;
    }
    setPlaying(false);
    setLearningExperience(experience);
  }

  function closeLearningExperience() {
    setLearningExperience(null);
    if (resumeAfterExperience.current) {
      unlockAudio();
      setPlaying(true);
    }
    resumeAfterExperience.current = false;
  }

  const hasStarted = playing || index > 0 || stage === "board";
  const progressPct = ((index + (stage === "board" ? 0.5 : 0)) / beats.length) * 100;

  const statusText = speaking ? "explaining" : waitingOnCheckpoint ? "waiting on you" : stage === "slide" ? "setting up" : "drawing";
  const accent = deafMode ? "var(--accent-deaf)" : "var(--hud-cyan)";
  const currentCaption = sentenceCue.text || beat.script;

  return (
    <main className="relative h-screen overflow-hidden bg-[var(--hud-bg)] text-[var(--hud-text)]">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_15%_0%,rgba(94,234,212,0.14),transparent_36%),radial-gradient(circle_at_88%_18%,rgba(94,234,212,0.07),transparent_34%),linear-gradient(180deg,#06080d_0%,#030407_72%)]" />
      <div className="pointer-events-none absolute inset-0 opacity-[0.06]" style={{ backgroundImage: "linear-gradient(rgba(120,200,255,0.1) 1px, transparent 1px), linear-gradient(90deg, rgba(120,200,255,0.1) 1px, transparent 1px)", backgroundSize: "44px 44px" }} />

      <div className="absolute inset-0">
        {/* Board + side chat, with room at top for the floating header */}
        <div className="absolute inset-2 grid gap-2 pt-[150px] lg:inset-4 lg:gap-3 lg:pt-[150px] xl:grid-cols-[minmax(0,1fr)_340px] xl:pt-[92px]">
          <section className="relative min-h-0 overflow-hidden rounded-xl border border-[var(--hud-line)] bg-slate-950/80 shadow-[0_32px_110px_rgba(0,0,0,0.34)]">
            <HudCorners />
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
                <PastYouEcho key={`past-you-${beat.id}`} topic={title} beat={beat} />
                {deafMode && (
                  <div className="pointer-events-none absolute left-3 top-3 z-40 flex flex-wrap items-center gap-2 lg:left-5 lg:top-5">
                    <div className="flex items-center gap-2 rounded-full border border-[var(--accent-deaf)]/35 bg-black/70 px-3.5 py-2 text-xs font-black uppercase tracking-[0.14em] text-[var(--accent-deaf)] shadow-[0_0_28px_var(--accent-deaf-glow)] backdrop-blur-md">
                      <span className={`size-2.5 rounded-full ${speaking ? "animate-pulse bg-[var(--accent-deaf)]" : waitingOnCheckpoint ? "bg-amber-300" : "bg-white/35"}`} />
                      {speaking ? "Teacher speaking" : waitingOnCheckpoint ? "Checkpoint" : "Visual cue"}
                    </div>
                    <div className="rounded-full border border-white/10 bg-white/[0.08] px-3.5 py-2 text-xs font-bold text-white/70 backdrop-blur-md">
                      {sentenceCue.total > 1 ? `Caption ${Math.min(sentenceCue.index + 1, sentenceCue.total)}/${sentenceCue.total}` : "Caption ready"}
                    </div>
                  </div>
                )}
                <div className="pointer-events-none absolute inset-x-0 bottom-0 z-40 p-3 lg:p-5">
                  <div
                    className={`mx-auto max-w-5xl rounded-2xl border px-5 py-3 font-bold leading-snug text-white shadow-2xl backdrop-blur-md ${
                      deafMode
                        ? "border-[var(--accent-deaf)]/35 bg-slate-950/95 text-left text-lg lg:px-6 lg:py-4 lg:text-xl"
                        : "border-white/10 bg-slate-950/86 text-center text-base"
                    }`}
                  >
                    {deafMode && (
                      <div className="mb-2 flex items-center justify-between gap-3 text-[0.65rem] font-black uppercase tracking-[0.16em] text-[var(--accent-deaf)]">
                        <span>Live caption</span>
                        <span className="text-white/45">{speaking ? "On screen" : "Paused"}</span>
                      </div>
                    )}
                    {currentCaption}
                  </div>
                </div>
              </div>
            )}

            {/* Fresh explanation board for a chat question */}
            {chat.explainBoard && (
              <ExplainOverlay board={chat.explainBoard} progress={chat.drawProgress} onClose={chat.closeExplanation} />
            )}

            {/* Live-tutor board (drawn by the realtime show_board tool). Closing it just clears the
                board — the live session stays active and the tutor keeps talking. */}
            {liveBoard && (
              <ExplainOverlay board={liveBoard} progress={1} autoReveal onClose={() => setLiveBoard(null)} />
            )}
          </section>

          <div className="hidden min-h-0 xl:block [&>*]:h-full">
            {deafMode ? (
              <DeafAccessPanel
                beat={beat}
                caption={currentCaption}
                captionLog={captionLog}
                speaking={speaking}
                waitingOnCheckpoint={waitingOnCheckpoint}
                stage={stage}
              />
            ) : (
              <ChatPanel
                chat={chat.chat}
                explaining={chat.explaining}
                listening={chat.listening}
                interim={chat.interim}
                voiceSupported={REALTIME_TUTOR_ENABLED ? true : chat.voiceSupported}
                onAsk={chat.ask}
                // The mic now toggles the live full-duplex tutor (real conversation) instead of a
                // one-shot transcription. Falls back to one-shot voice if realtime is disabled.
                onVoice={REALTIME_TUTOR_ENABLED ? (sessionActive ? endLiveTutor : startLiveTutor) : chat.startVoice}
                liveActive={sessionActive}
                liveReady={REALTIME_TUTOR_ENABLED && tutor.status !== "idle" && !sessionActive}
                liveStatusLabel={liveMicLabel}
                liveMuted={tutor.muted}
                onLiveMute={tutor.toggleMute}
                liveError={tutor.errorMessage}
              />
            )}
          </div>
        </div>

        {/* Header: avatar w/ progress ring, status, title — and the new controls (speed, skip) */}
        <header className="absolute left-4 right-4 top-4 z-50 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--hud-line)] bg-slate-950/76 px-5 py-3.5 shadow-[0_24px_80px_rgba(0,0,0,0.34)] backdrop-blur-xl lg:left-6 lg:right-6 lg:top-6">
          <HudCorners />
          <div className="flex items-center gap-4">
            <button onClick={onExit} className="group relative" aria-label="Exit lecture">
              <AvatarRing progress={progressPct} speaking={speaking}>
                <TeacherAvatar speaking={speaking} size={52} />
              </AvatarRing>
            </button>
            <div>
              <p className="hud-eyebrow text-[11px] tracking-[0.16em]" style={{ color: accent }}>
                {deafMode ? "Caption-first" : hasStarted ? <span className="capitalize">{statusText}…</span> : "Live tutor"} · beat {index + 1}/{beats.length}
              </p>
              <h1 className="max-w-[44ch] truncate text-xl font-black tracking-tight">{title}</h1>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={cycleRate}
              title="Playback speed"
              className="rounded-full border border-white/15 bg-white/5 px-4 py-2.5 text-sm font-black tabular-nums text-white/80 transition hover:bg-white/10"
            >
              {rate}×
            </button>
            <button
              onClick={() => openLearningExperience("fork")}
              disabled={isCheckpoint}
              aria-label="Fork this idea"
              title="Change one rule and predict what happens"
              className="rounded-full border border-amber-300/25 bg-amber-300/[0.06] px-3 py-2.5 text-sm font-black text-amber-200 transition hover:bg-amber-300/10 disabled:cursor-not-allowed disabled:opacity-30 lg:px-4"
            >
              <span aria-hidden="true">⎇</span><span className="hidden lg:inline"> Fork</span>
            </button>
            <button
              onClick={() => openLearningExperience("twin")}
              aria-label="Open learning twin"
              title="Open your learning twin"
              className="rounded-full border border-[var(--hud-cyan)]/25 bg-[var(--hud-cyan)]/[0.06] px-3 py-2.5 text-sm font-black text-[var(--hud-cyan)] transition hover:bg-[var(--hud-cyan)]/10 lg:px-4"
            >
              <span aria-hidden="true">◉</span><span className="hidden lg:inline"> Twin</span>
            </button>
            <button
              onClick={() => openLearningExperience("teach")}
              disabled={isCheckpoint}
              aria-label="Teach this idea"
              title="Teach this idea to an AI learner"
              className="rounded-full border border-blue-300/25 bg-blue-300/[0.06] px-3 py-2.5 text-sm font-black text-blue-200 transition hover:bg-blue-300/10 disabled:cursor-not-allowed disabled:opacity-30 lg:px-4"
            >
              <span aria-hidden="true">◇</span><span className="hidden lg:inline"> Teach</span>
            </button>
            <button
              onClick={skipForward}
              disabled={index >= beats.length - 1}
              title="Skip to next beat"
              className="rounded-full border border-white/15 bg-white/5 px-4 py-2.5 text-sm font-black text-white/80 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-30"
            >
              Skip ⏭
            </button>
            <button
              onClick={hasStarted ? togglePlay : startLesson}
              className="hud-btn-primary rounded-full px-6 py-2.5 text-sm font-black"
            >
              {!hasStarted ? "Start lecture ▶" : playing ? "Pause ❙❙" : "Resume ▶"}
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

        {voiceBlocked && (
          <div className="absolute left-4 right-4 top-28 z-50 flex items-center justify-between gap-4 rounded-2xl border border-amber-400/30 bg-amber-500/10 px-5 py-3.5 backdrop-blur-xl lg:left-6 lg:right-6">
            <p className="text-sm font-bold text-amber-200">
              Your browser blocked the teacher&rsquo;s voice (autoplay is muted until you interact). Tap to enable sound.
            </p>
            <button onClick={retryVoice} className="shrink-0 rounded-full bg-amber-400 px-5 py-2 text-sm font-black text-amber-950">
              Enable sound
            </button>
          </div>
        )}

        {learningExperience && (
          <LearningExperienceOverlay
            experience={learningExperience}
            topic={title}
            beat={beat}
            onClose={closeLearningExperience}
          />
        )}
      </div>
    </main>
  );
}

function DeafAccessPanel({
  beat,
  caption,
  captionLog,
  speaking,
  waitingOnCheckpoint,
  stage,
}: {
  beat: Beat;
  caption: string;
  captionLog: string[];
  speaking: boolean;
  waitingOnCheckpoint: boolean;
  stage: Stage;
}) {
  const visualState = waitingOnCheckpoint ? "Checkpoint waiting" : speaking ? "Caption live" : stage === "slide" ? "Visual setup" : "Board drawing";
  const terms = deafKeywords(beat.title, caption);
  const lines = captionLog.length ? captionLog : [caption];

  return (
    <aside className="relative flex h-full min-h-0 flex-col gap-3 overflow-hidden rounded-xl border border-[var(--accent-deaf)]/25 bg-slate-950/86 p-4 shadow-[0_32px_110px_rgba(0,0,0,0.34)] backdrop-blur-xl">
      <HudCorners accent="var(--accent-deaf)" />

      <div className="rounded-lg border border-[var(--accent-deaf)]/25 bg-[var(--accent-deaf-glow)] px-4 py-3">
        <p className="text-[0.65rem] font-black uppercase tracking-[0.18em] text-[var(--accent-deaf)]">Deaf mode</p>
        <h2 className="mt-1 text-lg font-black text-white">Caption-first lesson</h2>
      </div>

      <div className="rounded-lg border border-white/10 bg-black/30 p-4">
        <p className="text-[0.65rem] font-black uppercase tracking-[0.16em] text-white/40">Visual sound cue</p>
        <div className="mt-3 flex items-center gap-3">
          <span className={`size-4 rounded-full ${speaking ? "animate-pulse bg-[var(--accent-deaf)] shadow-[0_0_20px_var(--accent-deaf)]" : waitingOnCheckpoint ? "bg-amber-300" : "bg-white/30"}`} />
          <p className="text-base font-black text-white">{visualState}</p>
        </div>
      </div>

      <div className="rounded-lg border border-white/10 bg-black/30 p-4">
        <p className="text-[0.65rem] font-black uppercase tracking-[0.16em] text-white/40">Current caption</p>
        <p className="mt-3 text-base font-bold leading-snug text-white">{caption}</p>
      </div>

      <div className="rounded-lg border border-white/10 bg-black/30 p-4">
        <p className="text-[0.65rem] font-black uppercase tracking-[0.16em] text-white/40">Key terms</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {terms.map((term) => (
            <span key={term} className="rounded-full border border-[var(--accent-deaf)]/25 bg-[var(--accent-deaf-glow)] px-3 py-1.5 text-xs font-black text-[var(--accent-deaf)]">
              {term}
            </span>
          ))}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-hidden rounded-lg border border-white/10 bg-black/30 p-4">
        <p className="text-[0.65rem] font-black uppercase tracking-[0.16em] text-white/40">Recent transcript</p>
        <div className="mt-3 flex max-h-full flex-col gap-2 overflow-y-auto pr-1">
          {lines.map((line, i) => (
            <p key={`${i}-${line}`} className="rounded-lg bg-white/[0.05] px-3 py-2 text-sm font-semibold leading-snug text-white/80">
              {line}
            </p>
          ))}
        </div>
      </div>
    </aside>
  );
}

function deafKeywords(title: string, caption: string) {
  const stop = new Set(["about", "after", "again", "because", "before", "being", "between", "could", "every", "from", "have", "into", "like", "make", "means", "more", "that", "their", "there", "these", "this", "through", "when", "where", "which", "with", "your"]);
  const words = `${title} ${caption}`
    .toLowerCase()
    .replace(/[^a-z0-9\s-]+/g, " ")
    .split(/\s+/)
    .map((word) => word.trim())
    .filter((word) => word.length > 3 && !stop.has(word));

  return [...new Set(words)].slice(0, 5);
}

/** A progress ring around the avatar — the lecture's progress bar, built into the header
 *  instead of living as a separate strip. Exported for reuse by other tracks' headers. */
export function AvatarRing({ progress, speaking, children }: { progress: number; speaking: boolean; children: React.ReactNode }) {
  const r = 28;
  const c = 2 * Math.PI * r;
  const offset = c * (1 - Math.min(1, Math.max(0, progress / 100)));
  return (
    <div className="relative grid size-[60px] place-items-center">
      <svg viewBox="0 0 60 60" className="absolute inset-0 -rotate-90">
        <circle cx="30" cy="30" r={r} fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth="3" />
        <circle
          cx="30"
          cy="30"
          r={r}
          fill="none"
          stroke="url(#avatar-ring-grad)"
          strokeWidth="3"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={offset}
          style={{ transition: "stroke-dashoffset 400ms ease" }}
        />
        <defs>
          <linearGradient id="avatar-ring-grad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#aef5ec" />
            <stop offset="100%" stopColor="#1f9e92" />
          </linearGradient>
        </defs>
      </svg>
      {speaking && <span className="absolute inset-0 rounded-full ring-2 ring-[var(--hud-cyan)]/40 av-ring" />}
      <div className="relative">{children}</div>
    </div>
  );
}

/** Exported so other tracks (e.g. AdhdLessonPlayer) can render the visual board.
 *  AI-generated topic beats render either sandboxed React animations or normal LiveSketch
 *  boards with narration-synced progress. For the hardcoded photosynthesis demo beats, the
 *  bespoke per-id scene components run unchanged — no regression. */
export function Board({
  beat,
  sentenceCue,
  drawProgress,
}: {
  beat: Beat;
  sentenceCue: { index: number; total: number; text: string };
  drawProgress?: number;
}) {
  return (
    <div className="absolute inset-0 bg-slate-950">
      <VisualDirector key={beat.id} beat={beat} sentenceCue={sentenceCue} drawProgress={drawProgress} />
    </div>
  );
}

function VisualDirector({
  beat,
  sentenceCue,
  drawProgress,
}: {
  beat: Beat;
  sentenceCue: { index: number; total: number; text: string };
  drawProgress?: number;
}) {
  const text = sentenceCue.text;
  const cue = sentenceCue.index;
  const sentenceTiming = narrationSentenceTiming(beat.script, cue, drawProgress ?? 0);
  const bespokeScene = isCuratedPhotosynthesisBeat(beat) ? photosynthesisSceneForBeat(beat.id, cue) : null;
  // Once the sandboxed animation fails for this beat (transpile error, runtime throw, watchdog
  // timeout), show an explicit unavailable board for the rest of this beat's lifetime. Resets
  // naturally: Board renders VisualDirector with `key={beat.id}`, so this state is fresh per beat.
  const [sandboxFailed, setSandboxFailed] = useState(false);

  if (bespokeScene) {
    return (
      <section className="relative h-full min-h-0 overflow-hidden bg-slate-950 p-3 text-white lg:p-4">
        <div className="pointer-events-none absolute inset-0 opacity-80" style={{ backgroundImage: "radial-gradient(circle at 20% 16%, rgba(16,185,129,0.24), transparent 38%), radial-gradient(circle at 78% 78%, rgba(59,130,246,0.22), transparent 42%)" }} />
        <div className="relative flex h-full flex-col">
          <div className="relative min-h-0 flex-1 pb-16">{bespokeScene}</div>
          <div className="relative hidden">
            <p className="text-xs font-black uppercase tracking-[0.16em] text-white/35">Visual is responding to</p>
            <p className="mt-1 text-sm font-bold leading-snug text-white/80">{text || "Teacher cue will appear here as narration starts."}</p>
          </div>
        </div>
      </section>
    );
  }

  // If a beat declares a React animation, never mask a missing or failed animation with the old
  // line-diagram fallback. Normal DrawScript boards still render through LiveSketch.
  if (beat.draw) {
    // A chalkBoard beat: its real chalk ops are authored server-side; unwrap them into LiveSketch
    // (chalk rendering). Pending → preparing card; failed → unavailable card (never the old
    // template board, per the design).
    const chalkOp = findChalkBoardOp(beat);
    if (chalkOp?.kind === "chalkBoard") {
      if (chalkOp.ops && chalkOp.ops.length > 0 && BLACKBOARD_GEN_ENABLED) {
        return (
          <section className="relative h-full min-h-0 overflow-hidden bg-slate-950 p-2 text-white lg:p-3">
            <LiveSketch key={beat.id} script={{ ...beat.draw, ops: chalkOp.ops }} progress={sentenceTiming.alignedProgress} />
          </section>
        );
      }
      if (isChalkBoardPending(beat)) {
        return <AnimationStatusBoard title={beat.title} teachingPoint={chalkOp.boardBrief} eyebrow="Preparing board" />;
      }
      const boardReason = !BLACKBOARD_GEN_ENABLED
        ? "Blackboard generation is turned off."
        : chalkOp.error ?? "Blackboard was not available.";
      return <AnimationStatusBoard title={beat.title} teachingPoint={chalkOp.boardBrief} eyebrow="Board unavailable" reason={boardReason} />;
    }

    const animationOp = findReactAnimationOp(beat);
    if (animationOp?.kind === "reactAnimation" && animationOp.code && REACT_ANIMATIONS_ENABLED && !sandboxFailed) {
      return (
        <section className="relative h-full min-h-0 overflow-hidden bg-slate-950 p-2 text-white lg:p-3">
          <ReactAnimationSandbox
            key={beat.id}
            code={animationOp.code}
            progress={drawProgress}
            sentenceIndex={sentenceTiming.index}
            sentenceProgress={sentenceTiming.progress}
            sentenceTotal={sentenceTiming.total}
            onError={() => setSandboxFailed(true)}
          />
        </section>
      );
    }
    if (animationOp?.kind === "reactAnimation") {
      const reason = !REACT_ANIMATIONS_ENABLED
        ? "React animations are turned off."
        : sandboxFailed
          ? "Generated animation failed to run safely."
          : animationOp.error ?? "Generated animation code was not available.";
      return <AnimationUnavailableBoard title={beat.title} teachingPoint={animationOp.teachingPoint} reason={reason} />;
    }
    return (
      <section className="relative h-full min-h-0 overflow-hidden bg-slate-950 p-2 text-white lg:p-3">
        <LiveSketch key={beat.id} script={beat.draw} progress={drawProgress} />
      </section>
    );
  }

  return (
    <section className="relative h-full min-h-0 overflow-hidden bg-slate-950 p-3 text-white lg:p-4">
      <div className="pointer-events-none absolute inset-0 opacity-80" style={{ backgroundImage: "radial-gradient(circle at 20% 16%, rgba(16,185,129,0.24), transparent 38%), radial-gradient(circle at 78% 78%, rgba(59,130,246,0.22), transparent 42%)" }} />
      <div className="relative flex h-full flex-col">
        <div className="relative min-h-0 flex-1 pb-16">
          {/* Hardcoded photosynthesis demo — bespoke per-id scenes, kept as-is. */}
          {beat.id === "hook" && <LeafKitchenVisual cue={cue} />}
          {beat.id === "define-photosynthesis" && <WordBreakVisual cue={cue} />}
          {beat.id === "ingredients-fast" && <IngredientDeliveryVisual cue={cue} />}
          {beat.id === "chloroplast" && <ChloroplastVisual cue={cue} />}
          {beat.id === "mechanism" && <MechanismVisual cue={cue} />}
          {beat.id === "outputs" && <OutputsVisual cue={cue} />}
          {beat.id === "compare-respiration" && <MirrorRecipeVisual cue={cue} />}
          {beat.id === "why-it-matters" && <EarthSystemVisual cue={cue} />}
          {beat.id === "recap" && <RecapVisual cue={cue} />}
        </div>
        <div className="relative hidden">
          <p className="text-xs font-black uppercase tracking-[0.16em] text-white/35">Visual is responding to</p>
          <p className="mt-1 text-sm font-bold leading-snug text-white/80">{text || "Teacher cue will appear here as narration starts."}</p>
        </div>
      </div>
    </section>
  );
}

function narrationSentenceTiming(script: string, cueIndex: number, beatProgress: number) {
  const sentences = splitNarrationSentences(script);
  const total = Math.max(1, sentences.length);
  const weights = sentences.length
    ? sentences.map((sentence) => Math.max(1.35, sentence.length / 13))
    : [1];
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  const index = Math.max(0, Math.min(total - 1, cueIndex));
  const startWeight = weights.slice(0, index).reduce((sum, weight) => sum + weight, 0);
  const start = startWeight / totalWeight;
  const end = (startWeight + weights[index]) / totalWeight;
  const progress = Math.max(0, Math.min(1, (beatProgress - start) / Math.max(0.001, end - start)));
  return {
    index,
    total,
    progress,
    alignedProgress: (index + progress) / total,
  };
}

function AnimationStatusBoard({
  title,
  teachingPoint,
  eyebrow,
  reason,
}: {
  title: string;
  teachingPoint?: string;
  eyebrow: string;
  reason?: string;
}) {
  const displayPoint = publicTeachingPoint(teachingPoint);
  return (
    <section className="relative grid h-full min-h-0 place-items-center overflow-hidden bg-slate-950 p-4 text-white">
      <div className="pointer-events-none absolute inset-0 opacity-80" style={{ backgroundImage: "radial-gradient(circle at 50% 42%, rgba(45,212,191,0.18), transparent 34%), radial-gradient(circle at 22% 78%, rgba(59,130,246,0.12), transparent 30%)" }} />
      <div className="pointer-events-none absolute inset-0 opacity-20" style={{ backgroundImage: "linear-gradient(rgba(148,163,184,0.08) 1px, transparent 1px), linear-gradient(90deg, rgba(148,163,184,0.08) 1px, transparent 1px)", backgroundSize: "46px 46px" }} />
      <div className="relative max-w-2xl rounded-3xl border border-cyan-200/20 bg-slate-950/70 px-8 py-7 text-center shadow-[0_0_60px_rgba(45,212,191,0.10)]">
        <p className="text-xs font-black uppercase tracking-[0.2em] text-cyan-200/70">{eyebrow}</p>
        <h3 className="mt-3 font-display text-3xl font-black text-white">{title}</h3>
        {displayPoint && <p className="mt-4 text-sm font-semibold leading-6 text-white/60">{displayPoint}</p>}
        {reason ? (
          <p className="mt-4 text-xs font-bold uppercase tracking-[0.12em] text-rose-200/70">{reason}</p>
        ) : (
          <div className="mx-auto mt-7 h-1.5 w-56 overflow-hidden rounded-full bg-white/10">
            <div className="hud-shimmer h-full w-full" />
          </div>
        )}
      </div>
    </section>
  );
}

function AnimationUnavailableBoard({
  title,
  teachingPoint,
  reason,
}: {
  title: string;
  teachingPoint?: string;
  reason: string;
}) {
  return (
    <AnimationStatusBoard
      title={title}
      teachingPoint={teachingPoint}
      eyebrow="Animation unavailable"
      reason={reason}
    />
  );
}

function publicTeachingPoint(teachingPoint?: string) {
  if (!teachingPoint) return undefined;
  if (teachingPoint.includes("SUPRNOTES_WHITEBOARD_SVG_BOARD")) return "Aria is preparing a clean whiteboard diagram for this idea.";
  const compact = teachingPoint.replace(/\s+/g, " ").trim();
  if (!compact) return undefined;
  if (compact.length > 180) return "Aria is preparing a clean whiteboard diagram for this idea.";
  return compact;
}

function isCuratedPhotosynthesisBeat(beat: Beat) {
  if (!PHOTOSYNTHESIS_SCENE_IDS.has(beat.id)) return false;
  return demoBeats.some((demo) => demo.id === beat.id && demo.title === beat.title && demo.script === beat.script);
}

function photosynthesisSceneForBeat(id: string, cue: number) {
  switch (id) {
    case "hook":
      return <LeafKitchenVisual cue={cue} />;
    case "define-photosynthesis":
      return <WordBreakVisual cue={cue} />;
    case "ingredients-fast":
      return <IngredientDeliveryVisual cue={cue} />;
    case "chloroplast":
      return <ChloroplastVisual cue={cue} />;
    case "mechanism":
      return <MechanismVisual cue={cue} />;
    case "outputs":
      return <OutputsVisual cue={cue} />;
    case "compare-respiration":
      return <MirrorRecipeVisual cue={cue} />;
    case "why-it-matters":
      return <EarthSystemVisual cue={cue} />;
    case "recap":
      return <RecapVisual cue={cue} />;
    default:
      return null;
  }
}

function ScienceFrame({ children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="science-frame relative h-full min-h-0 overflow-hidden rounded-[1.75rem] bg-[#07110c] text-slate-950 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.12),0_24px_90px_rgba(0,0,0,0.34)]">
      <div className="science-stage-glow" />
      <div className="relative h-full min-h-0">{children}</div>
      <div className="science-vignette" />
      <div className="science-grain" />
    </div>
  );
}

function ScienceArrowDefs() {
  return (
    <defs>
      <marker id="science-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
        <path d="M0 0 L10 5 L0 10z" fill="currentColor" />
      </marker>
    </defs>
  );
}

function LeafKitchenVisual({ cue }: { cue: number }) {
  return (
    <ScienceFrame title="Energy flow: sunlight powers food production">
      <svg viewBox="0 0 900 560" className="h-full min-h-0 w-full">
        <defs>
          <filter id="leaf-macro-blur">
            <feGaussianBlur stdDeviation="1.2" />
          </filter>
          <filter id="cinema-soft-glow" x="-35%" y="-35%" width="170%" height="170%">
            <feGaussianBlur stdDeviation="10" result="blur" />
            <feColorMatrix in="blur" type="matrix" values="1 0 0 0 0.18 0 1 0 0 0.72 0 0 1 0 0.34 0 0 0 0.72 0" result="glow" />
            <feMerge>
              <feMergeNode in="glow" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <linearGradient id="cell-panel" x1="0" x2="1">
            <stop offset="0%" stopColor="#062117" stopOpacity="0.92" />
            <stop offset="58%" stopColor="#0f3d28" stopOpacity="0.78" />
            <stop offset="100%" stopColor="#052e16" stopOpacity="0.9" />
          </linearGradient>
          <linearGradient id="gold-beam" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#fef3c7" stopOpacity="0.95" />
            <stop offset="48%" stopColor="#f59e0b" stopOpacity="0.58" />
            <stop offset="100%" stopColor="#f59e0b" stopOpacity="0" />
          </linearGradient>
          <radialGradient id="live-chloroplast" cx="34%" cy="28%" r="72%">
            <stop offset="0%" stopColor="#ecfccb" />
            <stop offset="40%" stopColor="#84cc16" />
            <stop offset="100%" stopColor="#315c13" />
          </radialGradient>
          <marker id="science-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0 0 L10 5 L0 10z" fill="currentColor" />
          </marker>
        </defs>
        <image href="/lecture-assets/photosynthesis-leaf-lab.png" x="0" y="0" width="900" height="560" preserveAspectRatio="xMidYMid meet" opacity="0.42" filter="url(#leaf-macro-blur)" className="science-camera-drift" />
        <rect width="900" height="560" rx="34" fill="#02140d" opacity="0.64" />
        <path d="M54 70 C232 18 552 20 842 92 L842 488 C584 526 240 528 56 470Z" fill="url(#cell-panel)" stroke="#a7f3d0" strokeWidth="2" opacity="0.92" />
        <path d="M96 342 C238 148 646 140 812 314 C652 470 242 482 96 342Z" fill="#1ba65b" opacity="0.34" filter="url(#cinema-soft-glow)" className="science-breathe" />
        <path d="M126 340 C302 302 540 294 774 322" stroke="#d9f99d" strokeWidth="10" strokeLinecap="round" opacity="0.34" className="leaf-vein-flow" />
        <path d="M520 28 L750 488 L642 500 L424 48Z" fill="url(#gold-beam)" opacity="0.5" className="leaf-sunbeam" />
        <text x="450" y="138" textAnchor="middle" className="fill-emerald-50 text-[24px] font-black">inside a photosynthetic cell</text>
        <g className={cue >= 1 ? "diagram-pop" : "opacity-25"}>
          <circle cx="184" cy="278" r="50" fill="#facc15" filter="url(#cinema-soft-glow)" />
          {Array.from({ length: 10 }).map((_, i) => (
            <line key={i} x1="184" y1="208" x2="184" y2="170" stroke="#fde68a" strokeWidth="6" strokeLinecap="round" transform={`rotate(${i * 36} 184 278)`} opacity="0.82" />
          ))}
          <text x="184" y="372" textAnchor="middle" className="fill-amber-50 text-[28px] font-black">sunlight</text>
        </g>
        <g className={cue >= 3 ? "diagram-pop" : "opacity-20"} color="#facc15">
          <path d="M250 278 C330 244 410 238 494 260" fill="none" stroke="currentColor" strokeWidth="9" strokeLinecap="round" markerEnd="url(#science-arrow)" strokeDasharray="18 14" className="photon-stream" />
          <text x="365" y="226" textAnchor="middle" className="fill-amber-100 text-[24px] font-black">light energy</text>
        </g>
        <g className={cue >= 4 ? "diagram-pop" : "opacity-20"}>
          <ellipse cx="548" cy="282" rx="128" ry="78" fill="url(#live-chloroplast)" stroke="#d9f99d" strokeWidth="4" filter="url(#cinema-soft-glow)" className="chloroplast-cell" />
          {[0, 1, 2, 3].map((i) => (
            <path key={i} d={`M476 ${250 + i * 20} C512 ${238 + i * 20} 584 ${238 + i * 20} 620 ${250 + i * 20}`} stroke="#ecfccb" strokeWidth="11" strokeLinecap="round" fill="none" opacity="0.82" />
          ))}
          <text x="548" y="384" textAnchor="middle" className="fill-lime-50 text-[27px] font-black">chloroplast</text>
        </g>
        <g className={cue >= 6 ? "diagram-pop" : "opacity-0"}>
          <path d="M670 282 C705 282 724 282 752 282" fill="none" stroke="#fbbf24" strokeWidth="8" markerEnd="url(#science-arrow)" className="photon-stream" />
          <polygon points="782,238 830,266 830,322 782,350 734,322 734,266" fill="#f59e0b" stroke="#fed7aa" strokeWidth="6" filter="url(#cinema-soft-glow)" />
          <text x="782" y="298" textAnchor="middle" className="fill-white text-[25px] font-black">glucose</text>
        </g>
      </svg>
    </ScienceFrame>
  );
}

function WordBreakVisual({ cue }: { cue: number }) {
  return (
    <ScienceFrame title="Term breakdown: the word explains the process">
      <svg viewBox="0 0 900 560" className="h-full min-h-0 w-full">
        <ScienceArrowDefs />
        <defs>
          <radialGradient id="word-sun" cx="40%" cy="35%" r="70%">
            <stop offset="0%" stopColor="#fef3c7" />
            <stop offset="55%" stopColor="#fbbf24" />
            <stop offset="100%" stopColor="#b45309" />
          </radialGradient>
          <linearGradient id="word-brick" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#86efac" />
            <stop offset="100%" stopColor="#16a34a" />
          </linearGradient>
          <filter id="word-shadow" x="-30%" y="-30%" width="160%" height="160%">
            <feDropShadow dx="0" dy="14" stdDeviation="14" floodColor="#1e293b" floodOpacity="0.22" />
          </filter>
        </defs>
        <rect width="900" height="560" rx="34" fill="#07111f" />

        {/* PHOTO = light: a sun with rays */}
        <g className={cue >= 1 ? "diagram-pop" : "opacity-25"}>
          <circle cx="200" cy="190" r="56" fill="url(#word-sun)" filter="url(#word-shadow)" />
          {Array.from({ length: 10 }).map((_, i) => (
            <line key={i} x1="200" y1="118" x2="200" y2="92" stroke="#f59e0b" strokeWidth="7" strokeLinecap="round" transform={`rotate(${i * 36} 200 190)`} />
          ))}
          <text x="200" y="282" textAnchor="middle" className="fill-amber-100 text-[34px] font-black">PHOTO</text>
          <text x="200" y="318" textAnchor="middle" className="fill-amber-200 text-[22px] font-bold">= light</text>
        </g>

        {/* + */}
        <text x="450" y="208" textAnchor="middle" className="fill-white text-[64px] font-black" opacity="0.25">+</text>

        {/* SYNTHESIS = building: stacked bricks assembling */}
        <g className={cue >= 2 ? "diagram-pop" : "opacity-25"}>
          {[0, 1, 2].map((i) => (
            <rect
              key={i}
              x={650 - 70 + (i % 2) * 14}
              y={232 - i * 38}
              width="140"
              height="34"
              rx="9"
              fill="url(#word-brick)"
              stroke="#14532d"
              strokeWidth="3"
              filter="url(#word-shadow)"
            />
          ))}
          <text x="650" y="282" textAnchor="middle" className="fill-emerald-100 text-[34px] font-black">SYNTHESIS</text>
          <text x="650" y="318" textAnchor="middle" className="fill-emerald-200 text-[22px] font-bold">= building</text>
        </g>

        {/* arrow down into the combined meaning + a glucose hexagon, echoing the other scenes */}
        <g className={cue >= 4 ? "diagram-pop" : "opacity-0"}>
          <path d="M200 340 C260 392 340 412 420 416" fill="none" stroke="#f59e0b" strokeWidth="6" markerEnd="url(#science-arrow)" strokeDasharray="14 12" />
          <path d="M650 340 C590 392 510 412 430 416" fill="none" stroke="#16a34a" strokeWidth="6" markerEnd="url(#science-arrow)" strokeDasharray="14 12" />
          <rect x="220" y="436" width="460" height="92" rx="28" fill="#ecfdf5" fillOpacity="0.92" stroke="#34d399" strokeWidth="4" />
          <text x="450" y="472" textAnchor="middle" className="fill-emerald-950 text-[30px] font-black">using light to build sugar</text>
          <text x="450" y="504" textAnchor="middle" className="fill-emerald-700 text-[19px] font-bold">not memorizing a word — decoding it</text>
        </g>
      </svg>
    </ScienceFrame>
  );
}

function IngredientDeliveryVisual({ cue }: { cue: number }) {
  return (
    <ScienceFrame title="Three inputs enter through three different routes">
      <svg viewBox="0 0 900 560" className="h-full min-h-0 w-full">
        <ScienceArrowDefs />
        <defs>
          <filter id="delivery-photo-soft">
            <feGaussianBlur stdDeviation="1.1" />
          </filter>
          <radialGradient id="leaf-real" cx="48%" cy="48%" r="72%">
            <stop offset="0%" stopColor="#86efac" />
            <stop offset="45%" stopColor="#22c55e" />
            <stop offset="100%" stopColor="#065f46" />
          </radialGradient>
          <linearGradient id="leaf-vein" x1="0" x2="1">
            <stop offset="0%" stopColor="#064e3b" />
            <stop offset="50%" stopColor="#bbf7d0" />
            <stop offset="100%" stopColor="#064e3b" />
          </linearGradient>
          <filter id="soft-shadow" x="-30%" y="-30%" width="160%" height="160%">
            <feDropShadow dx="0" dy="18" stdDeviation="18" floodColor="#064e3b" floodOpacity="0.24" />
          </filter>
        </defs>
        <image href="/lecture-assets/photosynthesis-leaf-lab.png" x="0" y="0" width="900" height="560" preserveAspectRatio="xMidYMid meet" opacity="0.5" filter="url(#delivery-photo-soft)" className="science-camera-drift" />
        <rect width="900" height="560" rx="34" fill="#03140e" opacity="0.58" />
        <rect x="54" y="96" width="792" height="380" rx="42" fill="#092016" opacity="0.58" stroke="#a7f3d0" strokeOpacity="0.22" />
        <path d="M92 314 C230 146 652 142 812 306 C650 466 244 474 92 314Z" fill="url(#leaf-real)" filter="url(#soft-shadow)" opacity="0.82" className="science-breathe" />
        <path d="M142 314 C310 286 548 286 762 314" stroke="url(#leaf-vein)" strokeWidth="15" strokeLinecap="round" opacity="0.88" className="leaf-vein-flow" />
        <path d="M238 262 C310 284 360 298 442 308" stroke="#bbf7d0" strokeWidth="5" strokeLinecap="round" opacity="0.55" />
        <path d="M346 378 C420 344 528 324 660 310" stroke="#bbf7d0" strokeWidth="5" strokeLinecap="round" opacity="0.46" />
        <g className={cue >= 1 ? "delivery-drop" : "opacity-20"}>
          <circle cx="120" cy="104" r="46" fill="#facc15" className="lecture-pulse-glow" />
          <path d="M174 144 C265 178 338 220 420 272" stroke="#fbbf24" strokeWidth="8" fill="none" markerEnd="url(#science-arrow)" className="photon-stream" />
          <text x="120" y="182" textAnchor="middle" className="fill-amber-50 text-[24px] font-black">sunlight</text>
        </g>
        <g className={cue >= 2 ? "delivery-drop" : "opacity-20"} color="#2563eb">
          <path d="M246 526 C250 450 292 410 368 364 C428 328 452 306 458 280" fill="none" stroke="#7dd3fc" strokeWidth="14" strokeLinecap="round" markerEnd="url(#science-arrow)" opacity="0.92" />
          <text x="250" y="500" className="fill-sky-100 text-[26px] font-black">water from roots</text>
          <circle cx="244" cy="456" r="9" fill="#38bdf8" className="water-rise" />
          <circle cx="300" cy="412" r="7" fill="#bae6fd" className="water-rise" style={{ animationDelay: "220ms" }} />
          <circle cx="374" cy="358" r="6" fill="#e0f2fe" className="water-rise" style={{ animationDelay: "420ms" }} />
        </g>
        <g className={cue >= 3 ? "delivery-drop" : "opacity-20"} color="#334155">
          <text x="744" y="112" textAnchor="middle" className="fill-slate-100 text-[32px] font-black co2-float">CO₂</text>
          <path d="M732 132 C696 178 662 222 620 286" fill="none" stroke="#cbd5e1" strokeWidth="8" strokeLinecap="round" markerEnd="url(#science-arrow)" strokeDasharray="14 14" className="gas-drift" />
          <ellipse cx="606" cy="342" rx="62" ry="21" fill="#064e3b" opacity="0.9" />
          <ellipse cx="582" cy="342" rx="23" ry="8" fill="#bbf7d0" />
          <ellipse cx="630" cy="342" rx="23" ry="8" fill="#bbf7d0" />
          <path d="M606 326 C596 338 596 348 606 360 C616 348 616 338 606 326Z" fill="#052e16" opacity="0.7" />
          <text x="680" y="366" className="fill-emerald-50 text-[22px] font-black">stomata pore</text>
        </g>
        <g className={cue >= 5 ? "diagram-pop" : "opacity-0"}>
          <rect x="322" y="74" width="260" height="78" rx="24" fill="#052e16" stroke="#bbf7d0" strokeOpacity="0.22" />
          <text x="452" y="122" textAnchor="middle" className="fill-white text-[30px] font-black">all inputs delivered</text>
        </g>
      </svg>
    </ScienceFrame>
  );
}

function ChloroplastVisual({ cue }: { cue: number }) {
  return (
    <ScienceFrame title="Microscope zoom: cell → chloroplast → thylakoids">
      <svg viewBox="0 0 900 560" className="h-full min-h-0 w-full">
        <ScienceArrowDefs />
        <defs>
          <filter id="microscope-grain" x="-20%" y="-20%" width="140%" height="140%">
            <feTurbulence type="fractalNoise" baseFrequency="0.018 0.045" numOctaves="3" seed="7" result="noise" />
            <feDisplacementMap in="SourceGraphic" in2="noise" scale="6" />
          </filter>
          <filter id="cell-depth-shadow" x="-30%" y="-30%" width="160%" height="160%">
            <feDropShadow dx="0" dy="24" stdDeviation="22" floodColor="#020617" floodOpacity="0.34" />
          </filter>
          <radialGradient id="cell-bg" cx="45%" cy="45%" r="65%">
            <stop offset="0%" stopColor="#d9f99d" />
            <stop offset="52%" stopColor="#4ade80" />
            <stop offset="100%" stopColor="#047857" />
          </radialGradient>
          <radialGradient id="chloroplast-body" cx="35%" cy="30%" r="75%">
            <stop offset="0%" stopColor="#bef264" />
            <stop offset="55%" stopColor="#65a30d" />
            <stop offset="100%" stopColor="#365314" />
          </radialGradient>
          <radialGradient id="scope-bg" cx="50%" cy="45%" r="72%">
            <stop offset="0%" stopColor="#12321f" />
            <stop offset="58%" stopColor="#071d13" />
            <stop offset="100%" stopColor="#020617" />
          </radialGradient>
          <filter id="cell-shadow" x="-25%" y="-25%" width="150%" height="150%">
            <feDropShadow dx="0" dy="20" stdDeviation="20" floodColor="#14532d" floodOpacity="0.22" />
          </filter>
        </defs>
        <rect width="900" height="560" rx="34" fill="url(#scope-bg)" />
        <circle cx="450" cy="280" r="232" fill="#dcfce7" opacity="0.06" />
        <circle cx="450" cy="280" r="190" fill="none" stroke="#bbf7d0" strokeOpacity="0.18" strokeWidth="2" />
        <ellipse cx="338" cy="292" rx="274" ry="182" fill="url(#cell-bg)" stroke="#bbf7d0" strokeWidth="5" filter="url(#cell-depth-shadow)" opacity="0.94" className="microscope-float" />
        <ellipse cx="338" cy="292" rx="242" ry="158" fill="none" stroke="#ecfccb" strokeWidth="2" opacity="0.28" filter="url(#microscope-grain)" />
        {Array.from({ length: 28 }).map((_, i) => (
          <circle
            key={i}
            cx={140 + ((i * 53) % 390)}
            cy={170 + ((i * 37) % 230)}
            r={2 + (i % 4)}
            fill={i % 3 === 0 ? "#ecfccb" : "#064e3b"}
            opacity={i % 3 === 0 ? 0.22 : 0.18}
            className="cell-drift"
            style={{ animationDelay: `${i * 90}ms` }}
          />
        ))}
        <path d="M156 292 C236 220 416 194 560 250" stroke="#ffffff" strokeWidth="10" strokeLinecap="round" opacity="0.22" />
        <text x="330" y="112" textAnchor="middle" className="fill-emerald-50 text-[28px] font-black">leaf cell under microscope</text>
        <g className={cue >= 2 ? "diagram-pop" : "opacity-25"}>
          <ellipse cx="358" cy="300" rx="132" ry="82" fill="url(#chloroplast-body)" stroke="#ecfccb" strokeWidth="5" filter="url(#cell-depth-shadow)" className="chloroplast-orbit" />
          <ellipse cx="358" cy="300" rx="104" ry="58" fill="none" stroke="#d9f99d" strokeWidth="4" opacity="0.7" />
          <text x="358" y="410" textAnchor="middle" className="fill-lime-50 text-[26px] font-black">chloroplast</text>
          {[0, 1, 2, 3, 4].map((i) => (
            <g key={i}>
              <path d={`M292 ${260 + i * 18} C326 ${246 + i * 18} 390 ${246 + i * 18} 424 ${260 + i * 18}`} stroke="#d9f99d" strokeWidth="10" strokeLinecap="round" fill="none" />
              <path d={`M310 ${262 + i * 18} C340 ${256 + i * 18} 380 ${256 + i * 18} 406 ${262 + i * 18}`} stroke="#4d7c0f" strokeWidth="3" strokeLinecap="round" fill="none" opacity="0.7" />
            </g>
          ))}
        </g>
        <g className={cue >= 4 ? "diagram-pop" : "opacity-20"}>
          <rect x="614" y="144" width="218" height="268" rx="32" fill="#f0fdf4" fillOpacity="0.92" stroke="#86efac" strokeWidth="5" filter="url(#cell-depth-shadow)" />
          <text x="723" y="194" textAnchor="middle" className="fill-emerald-950 text-[27px] font-black">chlorophyll</text>
          <text x="723" y="232" textAnchor="middle" className="fill-emerald-700 text-[20px] font-bold">pigment in thylakoids</text>
          <path d="M184 116 C326 144 474 168 604 220" stroke="#f59e0b" strokeWidth="8" fill="none" markerEnd="url(#science-arrow)" strokeDasharray="18 12" />
          <circle cx="686" cy="308" r="24" fill="#84cc16" />
          <circle cx="728" cy="308" r="24" fill="#65a30d" />
          <circle cx="770" cy="308" r="24" fill="#4d7c0f" />
          <text x="728" y="364" textAnchor="middle" className="fill-slate-700 text-[18px] font-bold">light-harvesting stack</text>
        </g>
      </svg>
    </ScienceFrame>
  );
}

function MechanismVisual({ cue }: { cue: number }) {
  return (
    <ScienceFrame title="Mechanism: water + CO₂ → glucose">
      <svg viewBox="0 0 900 560" className="h-full min-h-0 w-full">
        <ScienceArrowDefs />
        <defs>
          <radialGradient id="reaction-bg" cx="50%" cy="44%" r="76%">
            <stop offset="0%" stopColor="#172554" />
            <stop offset="48%" stopColor="#0f172a" />
            <stop offset="100%" stopColor="#020617" />
          </radialGradient>
          <filter id="atom-glow" x="-45%" y="-45%" width="190%" height="190%">
            <feGaussianBlur stdDeviation="8" result="blur" />
            <feColorMatrix in="blur" type="matrix" values="0 0 0 0 0.4 0 0 0 0 0.78 0 0 0 0 1 0 0 0 0.72 0" result="glow" />
            <feMerge>
              <feMergeNode in="glow" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <radialGradient id="oxygen-sphere" cx="35%" cy="30%" r="70%">
            <stop offset="0%" stopColor="#e0f2fe" />
            <stop offset="45%" stopColor="#38bdf8" />
            <stop offset="100%" stopColor="#0369a1" />
          </radialGradient>
          <radialGradient id="hydrogen-sphere" cx="35%" cy="30%" r="70%">
            <stop offset="0%" stopColor="#ffffff" />
            <stop offset="100%" stopColor="#bae6fd" />
          </radialGradient>
          <radialGradient id="carbon-sphere" cx="35%" cy="30%" r="70%">
            <stop offset="0%" stopColor="#e2e8f0" />
            <stop offset="100%" stopColor="#64748b" />
          </radialGradient>
          <filter id="mol-shadow" x="-35%" y="-35%" width="170%" height="170%">
            <feDropShadow dx="0" dy="16" stdDeviation="12" floodColor="#000000" floodOpacity="0.35" />
          </filter>
        </defs>
        <rect width="900" height="560" rx="34" fill="url(#reaction-bg)" />
        <g opacity="0.22">
          {Array.from({ length: 42 }).map((_, i) => (
            <circle key={i} cx={(i * 83) % 900} cy={70 + ((i * 47) % 420)} r={i % 5 === 0 ? 2.4 : 1.2} fill="#bfdbfe" className="cell-drift" style={{ animationDelay: `${i * 80}ms` }} />
          ))}
        </g>
        <rect x="86" y="112" width="728" height="354" rx="34" fill="#0f172a" fillOpacity="0.72" stroke="#93c5fd" strokeOpacity="0.16" strokeWidth="3" />
        <g className={cue >= 1 ? "diagram-pop molecule-float" : "opacity-25"}>
          <text x="190" y="118" textAnchor="middle" className="fill-sky-200 text-[24px] font-black">water</text>
          <circle cx="190" cy="190" r="31" fill="url(#oxygen-sphere)" filter="url(#atom-glow)" />
          <circle cx="130" cy="226" r="21" fill="url(#hydrogen-sphere)" filter="url(#mol-shadow)" />
          <circle cx="250" cy="226" r="21" fill="url(#hydrogen-sphere)" filter="url(#mol-shadow)" />
          <line x1="164" y1="204" x2="146" y2="217" stroke="#7dd3fc" strokeWidth="7" />
          <line x1="216" y1="204" x2="234" y2="217" stroke="#7dd3fc" strokeWidth="7" />
          <text x="190" y="199" textAnchor="middle" className="fill-sky-950 text-[22px] font-black">O</text>
          <text x="130" y="234" textAnchor="middle" className="fill-sky-950 text-[16px] font-black">H</text>
          <text x="250" y="234" textAnchor="middle" className="fill-sky-950 text-[16px] font-black">H</text>
        </g>
        <g className={cue >= 2 ? "diagram-pop" : "opacity-20"}>
          <circle cx="450" cy="190" r="74" fill="#facc15" opacity="0.14" />
          <path d="M426 112 L486 112 L462 178 L524 178 L392 326 L432 212 L374 212Z" fill="#facc15" filter="url(#atom-glow)" className="photon-bolt" />
          <path d="M450 236 C386 270 310 278 246 292" fill="none" stroke="#facc15" strokeWidth="5" strokeLinecap="round" strokeDasharray="12 12" opacity="0.78" className="photon-stream" />
          <path d="M468 236 C536 270 604 278 654 292" fill="none" stroke="#facc15" strokeWidth="5" strokeLinecap="round" strokeDasharray="12 12" opacity="0.78" className="photon-stream" />
          <text x="450" y="292" textAnchor="middle" className="fill-amber-200 text-[22px] font-black">light energy</text>
        </g>
        <g className={cue >= 3 ? "diagram-pop molecule-float" : "opacity-25"} style={{ animationDelay: "240ms" }}>
          <text x="710" y="118" textAnchor="middle" className="fill-slate-200 text-[24px] font-black">carbon dioxide</text>
          <circle cx="710" cy="190" r="29" fill="url(#carbon-sphere)" filter="url(#atom-glow)" />
          <circle cx="650" cy="190" r="22" fill="#e2e8f0" filter="url(#mol-shadow)" />
          <circle cx="770" cy="190" r="22" fill="#e2e8f0" filter="url(#mol-shadow)" />
          <line x1="672" y1="190" x2="681" y2="190" stroke="#cbd5e1" strokeWidth="7" />
          <line x1="739" y1="190" x2="748" y2="190" stroke="#cbd5e1" strokeWidth="7" />
          <text x="710" y="199" textAnchor="middle" className="fill-slate-950 text-[22px] font-black">C</text>
          <text x="650" y="198" textAnchor="middle" className="fill-slate-950 text-[16px] font-black">O</text>
          <text x="770" y="198" textAnchor="middle" className="fill-slate-950 text-[16px] font-black">O</text>
        </g>
        <g className={cue >= 4 ? "diagram-pop" : "opacity-0"} color="#f8fafc">
          <path d="M246 292 C330 344 390 364 450 372" fill="none" stroke="#bae6fd" strokeWidth="6" markerEnd="url(#science-arrow)" strokeDasharray="16 14" className="reaction-path" />
          <path d="M654 292 C570 344 510 364 450 372" fill="none" stroke="#cbd5e1" strokeWidth="6" markerEnd="url(#science-arrow)" strokeDasharray="16 14" className="reaction-path" />
          <rect x="300" y="316" width="300" height="48" rx="18" fill="#0f172a" stroke="#93c5fd" strokeOpacity="0.24" strokeWidth="2" />
          <text x="450" y="348" textAnchor="middle" className="fill-white text-[20px] font-black">atoms move and recombine</text>
        </g>
        <g className={cue >= 6 ? "sugar-pop" : "opacity-0"}>
          <polygon points="450,386 510,420 510,488 450,522 390,488 390,420" fill="#f59e0b" stroke="#fed7aa" strokeWidth="7" filter="url(#atom-glow)" />
          <polygon points="450,404 492,428 492,476 450,500 408,476 408,428" fill="#fbbf24" opacity="0.26" />
          <text x="450" y="448" textAnchor="middle" className="fill-white text-[30px] font-black">glucose</text>
          <text x="450" y="480" textAnchor="middle" className="fill-amber-100 text-[24px] font-black">C₆H₁₂O₆</text>
        </g>
      </svg>
    </ScienceFrame>
  );
}

function OutputsVisual({ cue }: { cue: number }) {
  return (
    <ScienceFrame title="Outputs: glucose stays, oxygen exits through stomata">
      <svg viewBox="0 0 900 560" className="h-full min-h-0 w-full">
        <ScienceArrowDefs />
        <defs>
          <filter id="output-photo-soft">
            <feGaussianBlur stdDeviation="1" />
          </filter>
          <radialGradient id="leaf-output" cx="48%" cy="42%" r="72%">
            <stop offset="0%" stopColor="#4ade80" />
            <stop offset="62%" stopColor="#16a34a" />
            <stop offset="100%" stopColor="#047857" />
          </radialGradient>
          <radialGradient id="oxygen-glass" cx="32%" cy="28%" r="72%">
            <stop offset="0%" stopColor="#ffffff" stopOpacity="0.94" />
            <stop offset="42%" stopColor="#7dd3fc" stopOpacity="0.8" />
            <stop offset="100%" stopColor="#0284c7" stopOpacity="0.78" />
          </radialGradient>
          <filter id="output-shadow" x="-30%" y="-30%" width="160%" height="160%">
            <feDropShadow dx="0" dy="20" stdDeviation="18" floodColor="#064e3b" floodOpacity="0.24" />
          </filter>
        </defs>
        <image href="/lecture-assets/photosynthesis-leaf-lab.png" x="0" y="0" width="900" height="560" preserveAspectRatio="xMidYMid meet" opacity="0.44" filter="url(#output-photo-soft)" className="science-camera-drift" />
        <rect width="900" height="560" rx="34" fill="#03140e" opacity="0.56" />
        <rect x="64" y="108" width="772" height="370" rx="42" fill="#0a1f17" opacity="0.68" stroke="#bae6fd" strokeOpacity="0.18" />
        <path d="M100 348 C246 198 638 198 800 340 C624 462 282 468 100 348Z" fill="url(#leaf-output)" filter="url(#output-shadow)" opacity="0.88" className="science-breathe" />
        <path d="M160 348 C326 318 544 318 748 348" stroke="#064e3b" strokeWidth="14" strokeLinecap="round" opacity="0.76" className="leaf-vein-flow" />
        <ellipse cx="462" cy="350" rx="60" ry="20" fill="#064e3b" />
        <ellipse cx="438" cy="350" rx="22" ry="8" fill="#bbf7d0" />
        <ellipse cx="486" cy="350" rx="22" ry="8" fill="#bbf7d0" />
        <g className={cue >= 1 ? "diagram-pop" : "opacity-25"}>
          <polygon points="236,292 292,324 292,388 236,420 180,388 180,324" fill="#f59e0b" stroke="#fed7aa" strokeWidth="6" filter="url(#output-shadow)" />
          <polygon points="236,312 274,334 274,378 236,400 198,378 198,334" fill="#fbbf24" opacity="0.26" />
          <text x="236" y="366" textAnchor="middle" className="fill-white text-[28px] font-black">glucose</text>
          <text x="236" y="450" textAnchor="middle" className="fill-amber-50 text-[22px] font-black">stored as plant food</text>
        </g>
        <g className={cue >= 4 ? "diagram-pop" : "opacity-0"} color="#2563eb">
          {[0, 1, 2, 3, 4].map((i) => (
            <g key={i} className="oxygen-bubble" style={{ animationDelay: `${i * 140}ms` }}>
              <circle cx={520 + i * 50} cy={310 - i * 36} r="20" fill="url(#oxygen-glass)" opacity="0.88" />
              <circle cx={512 + i * 50} cy={302 - i * 36} r="6" fill="#e0f2fe" opacity="0.9" />
              <text x={520 + i * 50} y={318 - i * 36} textAnchor="middle" className="fill-blue-950 text-[16px] font-black">O₂</text>
            </g>
          ))}
          <path d="M500 336 C570 286 636 222 722 116" fill="none" stroke="#7dd3fc" strokeWidth="7" markerEnd="url(#science-arrow)" className="gas-drift" />
          <text x="724" y="92" textAnchor="middle" className="fill-sky-100 text-[28px] font-black">oxygen exits</text>
        </g>
      </svg>
    </ScienceFrame>
  );
}

function MirrorRecipeVisual({ cue }: { cue: number }) {
  return (
    <div className="relative h-full min-h-0 overflow-hidden rounded-[1.75rem] bg-[#07111f] p-6 text-white">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_24%_26%,rgba(34,197,94,0.28),transparent_38%),radial-gradient(circle_at_78%_22%,rgba(56,189,248,0.24),transparent_38%)]" />
      <div className="relative grid h-full min-h-0 gap-4 md:grid-cols-2">
        <RecipeCard active={cue >= 1} title="Plant" input="Light + H₂O + CO₂" output="Sugar + O₂" tone="green" />
        <RecipeCard active={cue >= 3} title="You" input="Sugar + O₂" output="Energy + CO₂" tone="blue" />
        <div className={`md:col-span-2 rounded-3xl border border-white/10 bg-white/10 p-5 text-center text-2xl font-black text-white shadow-2xl backdrop-blur transition ${cue >= 6 ? "diagram-pop" : "opacity-25"}`}>Opposite recipes. Shared air.</div>
      </div>
    </div>
  );
}

function RecipeCard({ active, title, input, output, tone }: { active: boolean; title: string; input: string; output: string; tone: "green" | "blue" }) {
  return (
    <div className={`grid place-items-center rounded-3xl border border-white/10 p-6 text-center shadow-2xl backdrop-blur transition ${active ? "diagram-pop opacity-100" : "opacity-25"} ${tone === "green" ? "bg-emerald-400/20" : "bg-sky-400/20"}`}>
      <div>
        <p className="text-4xl font-black text-white">{title}</p>
        <p className="mt-8 rounded-2xl border border-white/10 bg-white/90 p-4 text-xl font-black text-slate-950 shadow-xl">{input}</p>
        <p className="my-5 text-4xl font-black text-white/55">↓</p>
        <p className="rounded-2xl border border-white/10 bg-white/90 p-4 text-xl font-black text-slate-950 shadow-xl">{output}</p>
      </div>
    </div>
  );
}

function EarthSystemVisual({ cue }: { cue: number }) {
  return (
    <ScienceFrame title="Global impact: food chains and breathable oxygen">
      <svg viewBox="0 0 900 560" className="h-full min-h-0 w-full">
        <ScienceArrowDefs />
        <defs>
          <filter id="earth-glow" x="-45%" y="-45%" width="190%" height="190%">
            <feGaussianBlur stdDeviation="12" result="blur" />
            <feColorMatrix in="blur" type="matrix" values="0 0 0 0 0.16 0 0 0 0 0.54 0 0 0 0 1 0 0 0 0.68 0" result="glow" />
            <feMerge>
              <feMergeNode in="glow" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <radialGradient id="earth-grad" cx="42%" cy="35%" r="70%">
            <stop offset="0%" stopColor="#93c5fd" />
            <stop offset="55%" stopColor="#2563eb" />
            <stop offset="100%" stopColor="#1e3a8a" />
          </radialGradient>
        </defs>
        <rect width="900" height="560" rx="34" fill="#020617" />
        <g opacity="0.55">
          {Array.from({ length: 48 }).map((_, i) => (
            <circle key={i} cx={(i * 79) % 900} cy={28 + ((i * 41) % 500)} r={i % 7 === 0 ? 2 : 1} fill="#dbeafe" className="cell-drift" style={{ animationDelay: `${i * 70}ms` }} />
          ))}
        </g>
        <circle cx="450" cy="288" r="154" fill="url(#earth-grad)" filter="url(#earth-glow)" className="earth-drift" />
        <path d="M334 254 C388 218 430 228 468 262 C512 302 572 286 604 326 C542 380 436 390 338 334Z" fill="#22c55e" opacity="0.9" className="earth-cloud-drift" />
        <path d="M486 166 C548 182 600 220 628 278" stroke="#bfdbfe" strokeWidth="10" strokeLinecap="round" opacity="0.45" className="earth-cloud-drift" />
        <circle cx="450" cy="288" r="190" fill="none" stroke="#93c5fd" strokeWidth="2" opacity="0.25" />
        <circle cx="450" cy="288" r="178" fill="#38bdf8" opacity="0.05" />
        <g className={cue >= 1 ? "diagram-pop" : "opacity-25"}>
          <rect x="98" y="350" width="230" height="84" rx="26" fill="#ffffff" fillOpacity="0.92" />
          <text x="213" y="402" textAnchor="middle" className="fill-slate-950 text-[28px] font-black">food chains</text>
          <path d="M328 386 C366 352 392 330 420 306" stroke="#ffffff" strokeWidth="7" fill="none" markerEnd="url(#science-arrow)" />
        </g>
        <g className={cue >= 3 ? "diagram-pop" : "opacity-25"} color="#38bdf8">
          <rect x="588" y="350" width="230" height="84" rx="26" fill="#bae6fd" />
          <text x="703" y="402" textAnchor="middle" className="fill-blue-950 text-[28px] font-black">atmosphere O₂</text>
          <path d="M588 386 C540 356 510 330 480 306" stroke="currentColor" strokeWidth="7" fill="none" markerEnd="url(#science-arrow)" />
        </g>
      </svg>
    </ScienceFrame>
  );
}

function RecapVisual({ cue }: { cue: number }) {
  const steps = [
    { label: "Delivery", detail: "sunlight + water + CO2", color: "#38bdf8", x: 126, y: 360 },
    { label: "Kitchen", detail: "chloroplast", color: "#22c55e", x: 300, y: 244 },
    { label: "Cooking", detail: "light energy rearranges atoms", color: "#f59e0b", x: 480, y: 360 },
    { label: "Meal", detail: "glucose stored", color: "#f97316", x: 650, y: 244 },
    { label: "Exhaust", detail: "oxygen exits", color: "#60a5fa", x: 780, y: 360 },
  ];

  return (
    <ScienceFrame title="Final recap: the whole photosynthesis system">
      <svg viewBox="0 0 900 560" className="h-full min-h-0 w-full">
        <ScienceArrowDefs />
        <defs>
          <radialGradient id="recap-board-bg" cx="50%" cy="45%" r="78%">
            <stop offset="0%" stopColor="#f8fafc" />
            <stop offset="62%" stopColor="#ecfeff" />
            <stop offset="100%" stopColor="#d1fae5" />
          </radialGradient>
          <radialGradient id="recap-leaf" cx="42%" cy="36%" r="72%">
            <stop offset="0%" stopColor="#86efac" />
            <stop offset="58%" stopColor="#22c55e" />
            <stop offset="100%" stopColor="#047857" />
          </radialGradient>
          <filter id="recap-shadow" x="-30%" y="-30%" width="160%" height="160%">
            <feDropShadow dx="0" dy="18" stdDeviation="16" floodColor="#0f172a" floodOpacity="0.18" />
          </filter>
          <filter id="recap-photo-soft">
            <feGaussianBlur stdDeviation="1.2" />
          </filter>
        </defs>

        <image href="/lecture-assets/photosynthesis-leaf-lab.png" x="0" y="0" width="900" height="560" preserveAspectRatio="xMidYMid meet" opacity="0.44" filter="url(#recap-photo-soft)" className="science-camera-drift" />
        <rect width="900" height="560" rx="34" fill="#03140e" opacity="0.62" />
        <rect x="52" y="118" width="796" height="344" rx="46" fill="#ffffff" fillOpacity="0.9" stroke="#dbeafe" strokeWidth="4" />
        <text x="450" y="164" textAnchor="middle" className="fill-slate-900 text-[34px] font-black">
          Photosynthesis in one picture
        </text>
        <text x="450" y="198" textAnchor="middle" className="fill-slate-500 text-[18px] font-bold">
          delivery → chloroplast kitchen → atom rearrangement → glucose + oxygen
        </text>

        <path d="M104 340 C240 210 616 206 802 334 C618 456 270 464 104 340Z" fill="url(#recap-leaf)" filter="url(#recap-shadow)" opacity="0.96" className="science-breathe" />
        <path d="M150 340 C318 310 542 310 760 340" stroke="#064e3b" strokeWidth="12" strokeLinecap="round" opacity="0.75" />
        <path d="M318 292 C390 312 458 326 550 336" stroke="#bbf7d0" strokeWidth="5" strokeLinecap="round" opacity="0.48" />
        <path d="M370 390 C452 358 540 344 668 336" stroke="#bbf7d0" strokeWidth="5" strokeLinecap="round" opacity="0.4" />

        <g color="#0f172a" opacity="0.7">
          {steps.slice(0, -1).map((step, i) => {
            const next = steps[i + 1];
            return (
              <path
                key={`${step.label}-${next.label}`}
                d={`M${step.x + 58} ${step.y} C${step.x + 108} ${step.y - 86} ${next.x - 108} ${next.y + 86} ${next.x - 58} ${next.y}`}
                fill="none"
                stroke="currentColor"
                strokeWidth="5"
                strokeDasharray="12 12"
                markerEnd="url(#science-arrow)"
              />
            );
          })}
        </g>

        {steps.map((step, i) => {
          const active = cue >= i;
          return (
            <g key={step.label} className={active ? "diagram-pop" : "opacity-20"}>
              <circle cx={step.x} cy={step.y} r="58" fill="#ffffff" stroke={step.color} strokeWidth="7" filter="url(#recap-shadow)" />
              <circle cx={step.x} cy={step.y} r="34" fill={step.color} opacity="0.18" />
              <text x={step.x} y={step.y - 6} textAnchor="middle" className="fill-slate-950 text-[18px] font-black">
                {i + 1}
              </text>
              <text x={step.x} y={step.y + 19} textAnchor="middle" className="fill-slate-950 text-[17px] font-black">
                {step.label}
              </text>
              <rect x={step.x - 80} y={step.y + 72} width="160" height="44" rx="16" fill="#ffffff" stroke="#e2e8f0" strokeWidth="2" />
              <text x={step.x} y={step.y + 100} textAnchor="middle" className="fill-slate-600 text-[12px] font-bold">
                {step.detail}
              </text>
            </g>
          );
        })}

        <g className={cue >= 5 ? "diagram-pop" : "opacity-0"}>
          <rect x="270" y="470" width="360" height="58" rx="20" fill="#052e16" />
          <text x="450" y="507" textAnchor="middle" className="fill-white text-[22px] font-black">
            light becomes stored chemical energy
          </text>
        </g>
      </svg>
    </ScienceFrame>
  );
}

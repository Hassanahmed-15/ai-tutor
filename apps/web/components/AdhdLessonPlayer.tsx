"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { SlideStage } from "./SlideStage";
import { TeacherAvatar } from "./TeacherAvatar";
import { Board, AvatarRing, checkAnswer, MAX_ATTEMPTS, type CheckpointResult } from "./LessonPlayer";
import { beats as demoBeats, type Beat } from "@/lib/lessonContent";
import { playNarration, unlockAudio, type NarrationHandle } from "@/lib/voice";
import { useAttentionMonitor } from "@/lib/useAttentionMonitor";
import { useLessonChat, ChatPanel, ExplainOverlay } from "./lesson-chat/LessonChat";
import { HudCorners } from "./hud/HudKit";

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
type Stage = "slide" | "board";

export function AdhdLessonPlayer({ onExit, beats = demoBeats, title = "Photosynthesis" }: { onExit?: () => void; beats?: Beat[]; title?: string }) {
  const [cameraEnabled, setCameraEnabled] = useState(false);
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [stage, setStage] = useState<Stage>("slide");
  const [voiceBlocked, setVoiceBlocked] = useState(false);
  const [checkpointResult, setCheckpointResult] = useState<CheckpointResult>(null);
  const [waitingOnCheckpoint, setWaitingOnCheckpoint] = useState(false);
  const [checkpointAttempts, setCheckpointAttempts] = useState(0);
  const [sentenceCue, setSentenceCue] = useState({ index: 0, total: 1, text: "" });

  // Focus-pause flow: when attention drops to/below the threshold, the lecture STOPS
  // immediately, holds frozen for FOCUS_HOLD_MS (nothing happens), then shows a Resume
  // button — the lecture only continues when the student clicks it. `null` = running
  // normally, "stopped" = frozen during the hold, "ready" = hold elapsed, awaiting click.
  const [focusPause, setFocusPause] = useState<null | "stopped" | "ready">(null);
  // Bumped by resumeFromFocusPause() to force effect 2 to start fresh narration for the current
  // beat: the focus-pause path fully cancels the handle (unlike a manual pause, which effect 3
  // just pauses in place), so there's nothing left to resume — this beat has to restart.
  const [narrationRestartTick, setNarrationRestartTick] = useState(0);

  const cancelRef = useRef<NarrationHandle | null>(null);
  const slideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const playingRef = useRef(playing);
  const beat = beats[index];
  const isCheckpoint = beat.slideKind === "checkpoint";

  useEffect(() => {
    playingRef.current = playing;
  }, [playing]);

  const attention = useAttentionMonitor(cameraEnabled);

  const stopVoice = useCallback(() => {
    cancelRef.current?.cancel();
    cancelRef.current = null;
    setSpeaking(false);
  }, []);

  const chat = useLessonChat({
    topic: title,
    getBeatContext: () => `${beat.title}: ${beat.script}`,
    pausePlayer: stopVoice,
    onVoiceBlocked: () => setVoiceBlocked(true),
  });

  // Effect 1: slide -> board timing (identical to LessonPlayer's). `playing` goes false
  // during a focus pause, so this naturally halts then.
  useEffect(() => {
    if (!playing || stage !== "slide" || isCheckpoint) return;
    if (slideTimer.current) clearTimeout(slideTimer.current);
    slideTimer.current = setTimeout(() => setStage("board"), SLIDE_MS);
    return () => {
      if (slideTimer.current) clearTimeout(slideTimer.current);
    };
  }, [index, playing, stage, isCheckpoint]);

  // Effect 2: normal narration. Deliberately does NOT depend on `playing` — a manual pause or
  // a focus-pause must not tear down and recreate this narration (that reset the board to
  // blank and restarted the voice from the top). Effect 3 below pauses/resumes the SAME
  // handle in place instead, so both stopping and resuming happen exactly where they left off.
  useEffect(() => {
    if (!playingRef.current || chat.busy) return;
    const narrateOnBoard = !isCheckpoint && stage === "board";
    const narrateOnCheckpointSlide = isCheckpoint && stage === "slide";
    if (!narrateOnBoard && !narrateOnCheckpointSlide) return;

    const handle = playNarration(beat.script, {
      onStart: () => setSpeaking(true),
      onSentenceStart: (sentenceIndex, sentence, total) => setSentenceCue({ index: sentenceIndex, text: sentence, total }),
      onEnd: () => {
        setSpeaking(false);
        cancelRef.current = null;
        if (isCheckpoint) {
          setWaitingOnCheckpoint(true);
        } else {
          setIndex((i) => (i < beats.length - 1 ? i + 1 : i));
          setStage("slide");
        }
      },
      onBlocked: () => setVoiceBlocked(true),
    });
    cancelRef.current = handle;

    return () => {
      handle.cancel();
      cancelRef.current = null;
      setSpeaking(false);
    };
  }, [index, stage, isCheckpoint, beat.script, beats.length, chat.busy, narrationRestartTick]);

  // Effect 3: the ONLY thing that reacts to pause/resume (manual button OR focus-pause) —
  // freezes/continues the SAME narration handle in place rather than tearing it down.
  useEffect(() => {
    if (!cancelRef.current) return;
    if (playing) cancelRef.current.resume();
    else cancelRef.current.pause();
  }, [playing]);

  // Effect 4: the ADHD mechanism. The instant attention drops to/below the threshold
  // (engagement <= 70%), STOP immediately — cancel narration, pause the lecture, freeze the
  // board — then hold for FOCUS_HOLD_MS before surfacing a Resume button. Nothing
  // auto-resumes; the student must click Resume to continue (handled in resumeFromFocusPause).
  // The actual state changes run on a 0ms timer so they're not synchronous in the effect
  // body (which would trip the cascading-render lint) — still effectively instant.
  useEffect(() => {
    if (!playing || focusPause || isCheckpoint || !attention.drifting) return;
    const trigger = setTimeout(() => {
      stopVoice();
      setPlaying(false);
      setFocusPause("stopped");
      if (holdTimer.current) clearTimeout(holdTimer.current);
      holdTimer.current = setTimeout(() => setFocusPause("ready"), FOCUS_HOLD_MS);
    }, 0);
    return () => clearTimeout(trigger);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attention.drifting, playing, focusPause, isCheckpoint]);

  // Clean up the hold timer on unmount.
  useEffect(() => () => { if (holdTimer.current) clearTimeout(holdTimer.current); }, []);

  function resumeFromFocusPause() {
    if (holdTimer.current) clearTimeout(holdTimer.current);
    unlockAudio();
    setFocusPause(null);
    setPlaying(true);
    setNarrationRestartTick((t) => t + 1); // stopVoice() fully cancelled the handle — restart this beat's narration
  }

  function advanceFromCheckpoint() {
    setCheckpointResult(null);
    setCheckpointAttempts(0);
    setSentenceCue({ index: 0, total: 1, text: "" });
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
    setCameraEnabled(true);
    setVoiceBlocked(false);
    setPlaying(true);
  }
  function togglePlay() {
    if (!playing) unlockAudio();
    setPlaying((p) => !p);
  }
  function retryVoice() {
    unlockAudio();
    if (holdTimer.current) clearTimeout(holdTimer.current);
    setFocusPause(null);
    setVoiceBlocked(false);
    setStage("slide");
    setPlaying(true);
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
    setPlaying(true);
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
                <Board key={beat.id} beat={beat} sentenceCue={sentenceCue} paused={!playing} />
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

            {/* Focus-pause overlay: freezes the board, holds 5s, then offers Resume. */}
            {focusPause && (
              <FocusPauseOverlay state={focusPause} onResume={resumeFromFocusPause} />
            )}
          </section>

          <div className="hidden min-h-0 xl:block [&>*]:h-full">
            <ChatPanel
              chat={chat.chat}
              explaining={chat.explaining}
              listening={chat.listening}
              interim={chat.interim}
              voiceSupported={chat.voiceSupported}
              onAsk={chat.ask}
              onVoice={chat.startVoice}
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
              onClick={hasStarted ? togglePlay : startLesson}
              className="rounded-full px-6 py-2.5 text-sm font-black"
              style={{ background: "linear-gradient(180deg, var(--accent-adhd-bright), var(--accent-adhd))", color: "#2b0a1a", boxShadow: "0 0 24px var(--accent-adhd-glow)" }}
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

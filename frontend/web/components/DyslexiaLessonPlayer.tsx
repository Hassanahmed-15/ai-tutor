"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SlideStage } from "./SlideStage";
import { TeacherAvatar } from "./TeacherAvatar";
import { Board, AvatarRing, checkAnswer, MAX_ATTEMPTS, type CheckpointResult } from "./LessonPlayer";
import { beats as demoBeats, type Beat } from "@/lib/lessonContent";
import { playNarration, unlockAudio, type NarrationHandle } from "@/lib/voice";
import {
  dyslexiaBeatContent,
  READING_LEVELS,
  READING_LEVEL_LABELS,
  type DyslexiaChunk,
  type ReadingLevel,
} from "@/lib/dyslexiaLectureContent";
import { heuristicChunks } from "@/lib/dyslexiaChunking";
import { prefsToCssVars, TINT_COLORS, useDyslexiaPrefs } from "@/lib/dyslexiaPrefs";
import { ComfortControls } from "./dyslexia/ComfortControls";
import { KaraokeLine } from "./dyslexia/KaraokeLine";
import { cachedRewrite, fetchRewrite } from "@/lib/dyslexiaChunkCache";
import { useLessonChat, ChatPanel, ExplainOverlay } from "./lesson-chat/LessonChat";
import { HudCorners } from "./hud/HudKit";

/**
 * The Dyslexia track — built to the supplied spec exactly. Decoding dense text is slow and
 * effortful and eats the working memory needed for comprehension, so this track removes the
 * reading load entirely:
 *
 *  - Everything renders in a dyslexia-friendly font (OpenDyslexic) by default — no setup.
 *  - Each beat's dense teacher sentence is rewritten into short, standalone lines that
 *    preserve the meaning (live difficulty-aware simplification).
 *  - The rewrite is calibrated to the student's measured reading level via a "read level"
 *    dial that briefly calibrates before the simplified version locks in.
 *  - Delivery is audio-led: narration carries most of the meaning, each short line is paired
 *    with a simple icon, and the student barely needs to read.
 *
 * The five animation beats from the spec play per lecture beat: dense sentence appears ->
 * splits into short lines as the font morphs -> each line gets an icon as it's narrated ->
 * the read-level dial calibrates -> final state of short lines + icons, audio-led.
 */
/**
 * How long the opening dense/calibrating moment may wait for the model's rewrite.
 *
 * Matched to the 3s the screen already spends there, so nothing is slower than before — the pause
 * simply stops being decorative.
 */
const REWRITE_GRACE_MS = 2800;
type Phase = "dense" | "calibrating" | "chunks";

export function DyslexiaLessonPlayer({ onExit, onComplete, beats = demoBeats, title = "Photosynthesis" }: { onExit?: () => void; onComplete?: () => void; beats?: Beat[]; title?: string }) {
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [voiceBlocked, setVoiceBlocked] = useState(false);
  const [checkpointResult, setCheckpointResult] = useState<CheckpointResult>(null);
  const [checkpointAttempts, setCheckpointAttempts] = useState(0);

  /**
   * Reading level and comfort settings, from one persisted store.
   *
   * The level used to live in its own localStorage key. It now shares the comfort preferences —
   * they are all "how this student wants to read", and two keys for one idea is how they drift.
   */
  const { prefs, update: updatePrefs, reset: resetPrefs } = useDyslexiaPrefs();
  const readLevel = prefs.readLevel;
  // Per-beat reveal: dense sentence -> calibrating dial -> chunked lines.
  const [phase, setPhase] = useState<Phase>("dense");
  // Which chunk lines are currently revealed/narrated (0..n).
  const [revealed, setRevealed] = useState(0);
  /**
   * The word being spoken, as {line, word}.
   *
   * The narration is one string of every chunk joined, and the voice engine reports position as
   * (word, sentence) within that string — and each chunk is exactly one sentence, so the sentence
   * index IS the line index. Kept as a pair rather than a global counter so a line only ever
   * highlights when it is the line being read.
   */
  const [spokenWord, setSpokenWord] = useState<{ line: number; word: number }>({ line: -1, word: -1 });

  /**
   * Mirror of `revealed` for the rewrite effect.
   *
   * That effect is registered once per beat, so reading `revealed` from its closure would give the
   * value at registration time — always 0 — and a rewrite arriving mid-narration would be swapped in
   * exactly when it must not be.
   */
  const revealedRef = useRef(0);
  /** Beats whose opening grace window has already been spent, so it runs at most once each. */
  const rewriteWaitedRef = useRef<Set<string>>(new Set());

  const cancelRef = useRef<NarrationHandle | null>(null);
  const phaseTimers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const beat = beats[index];
  const isCheckpoint = beat.slideKind === "checkpoint";
  /**
   * Lines for this beat, from the best source available.
   *
   * THE FREEZE THIS FIXES. This used to be `dyslexiaBeatContent[beat.id]` alone — a hand-authored
   * map keyed by the twelve demo beat ids. A generated lecture has ids like `pdf-1`, so the lookup
   * returned undefined, the narration effect below returned early on `!content`, and the lesson sat
   * on beat one with no audio and no way forward. The student saw a title on an empty panel and a
   * header that read "making it simpler…" indefinitely.
   *
   * So the map becomes an override rather than the only source: it is still preferred where it
   * exists, because those twelve beats are hand-tuned, and everything else falls back to splitting
   * the beat's own script. That fallback needs no network and cannot fail, which is what makes the
   * freeze structurally impossible rather than merely less likely.
   */
  const authored = dyslexiaBeatContent[beat.id];

  /**
   * The model's rewrite for this beat, once it arrives.
   *
   * Held in state rather than read from the cache during render so that a rewrite landing mid-beat
   * re-renders the stage. `rewriteGeneration` exists only to force that re-read — the cache itself
   * is not reactive.
   */
  const [rewriteGeneration, setRewriteGeneration] = useState(0);
  const rewrite = useMemo(
    () => (authored ? null : cachedRewrite(beat.id)),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- rewriteGeneration is the cache signal
    [authored, beat.id, rewriteGeneration],
  );

  const chunks: DyslexiaChunk[] = useMemo(() => {
    if (authored) return authored.chunks[readLevel];
    if (rewrite?.chunks[readLevel]?.length) return rewrite.chunks[readLevel];
    return heuristicChunks(beat.script ?? "", readLevel);
  }, [authored, rewrite, beat.script, readLevel]);

  /** The dense line shown before the split. Falls back to the beat's own opening sentence. */
  const dense =
    authored?.dense ?? rewrite?.dense ?? (beat.script ?? "").split(/(?<=[.!?])\s+/)[0] ?? beat.title;
  const hasLines = chunks.length > 0;

  useEffect(() => {
    revealedRef.current = revealed;
  }, [revealed]);

  const clearTimers = useCallback(() => {
    phaseTimers.current.forEach((t) => clearTimeout(t));
    phaseTimers.current = [];
  }, []);

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

  /**
   * Fetch this beat's rewrite, and warm the next one.
   *
   * ONLY SWAPPED IN BEFORE NARRATION STARTS. A rewrite that lands mid-beat would change the lines
   * under a student who is part-way through hearing them, and would re-run the narration effect
   * against different text — so an arriving rewrite is only allowed to take effect while nothing has
   * been revealed yet. Otherwise it stays in the cache and is used the next time the beat is shown.
   *
   * Prefetching the following beat is what makes that almost always true: narration runs 15-40s and
   * a rewrite takes 1-2s, so by the time the student arrives the lines are already there. In
   * practice only the very first beat is ever taught from the local split.
   */
  useEffect(() => {
    if (authored) return;
    const controller = new AbortController();
    let cancelled = false;

    void fetchRewrite(
      { beatId: beat.id, title: beat.title, script: beat.script ?? "", points: beat.points },
      controller.signal,
    ).then((result) => {
      if (cancelled || !result) return;
      // Only upgrade the text before narration has revealed anything. Mid-beat the student is
      // part-way through hearing these exact lines, and swapping them would also re-run the
      // narration effect against different text.
      if (revealedRef.current === 0) setRewriteGeneration((n) => n + 1);
    });

    /**
     * Re-read the cache on every beat change, even when nothing was fetched.
     *
     * The prefetch above means beat N+1's rewrite usually lands while beat N is still being taught —
     * so by the time the student arrives it is sitting in the cache with no request in flight, and
     * nothing would otherwise tell the component to look. Without this the rewrite is fetched,
     * cached, and never shown, which is exactly what the first run did: two successful calls and
     * heuristic lines on screen.
     */
    setRewriteGeneration((n) => n + 1);

    const next = beats[index + 1];
    if (next && !dyslexiaBeatContent[next.id]) {
      void fetchRewrite({
        beatId: next.id,
        title: next.title,
        script: next.script ?? "",
        points: next.points,
      });
    }

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [authored, beat.id, beat.title, beat.script, beat.points, beats, index]);

  // Reset the per-beat reveal whenever the beat changes. The state writes run on a 0ms
  // timer so they're not synchronous in the effect body (avoids the cascading-render lint).
  useEffect(() => {
    clearTimers();
    const t = setTimeout(() => {
      setPhase("dense");
      setRevealed(0);
    }, 0);
    return () => clearTimeout(t);
  }, [index, clearTimers]);

  // Drives a non-checkpoint beat: show the dense sentence briefly, run the read-level dial,
  // then split into short chunk lines narrated one at a time. Audio-led: each line is spoken,
  // and revealing the next line follows the narration. Advances to the next beat at the end.
  useEffect(() => {
    // `hasLines`, not `content`: a beat with no authored entry is now playable from its own script,
    // and gating on the authored map is precisely what froze every generated lecture.
    if (!playing || isCheckpoint || !hasLines || chat.busy) return;
    let pendingGrace = false;

    /**
     * Hold the opening moment until the rewrite lands.
     *
     * The screen already pauses here — a dense line appears, then the reading-level dial animates —
     * and that window used to be pure theatre, claiming to "check your reading level" while
     * measuring nothing. It is now the window in which the model's rewrite arrives, so the wait buys
     * something real and the student is taught from simplified language rather than a punctuation
     * split of the original.
     *
     * Bounded, and only for a beat that has nothing cached: if the rewrite is slow or fails, the
     * local split is already on screen and the lesson proceeds on time. Never applied once narration
     * has begun.
     */
    if (!authored && !rewrite && revealedRef.current === 0 && !rewriteWaitedRef.current.has(beat.id)) {
      rewriteWaitedRef.current.add(beat.id);
      pendingGrace = true;
    }

    clearTimers();
    if (pendingGrace) {
      phaseTimers.current.push(setTimeout(() => setRewriteGeneration((n) => n + 1), REWRITE_GRACE_MS));
    }

    // Beat 1: dense sentence appears. Beat 4: read-level dial calibrates. Then chunks.
    phaseTimers.current.push(setTimeout(() => setPhase("calibrating"), 1500));
    phaseTimers.current.push(setTimeout(() => setPhase("chunks"), 3000));

    // Narrate the whole simplified version (the spec's audio-led delivery), and reveal each
    // short line in time with it.
    const fullText = chunks.map((c) => c.text).join(" ");
    const startNarration = setTimeout(() => {
      const handle = playNarration(fullText, {
        onStart: () => setSpeaking(true),
        onSentenceStart: (sentenceIndex) => setRevealed(sentenceIndex + 1),
        onWordStart: (wordIndex, sentenceIndex) => setSpokenWord({ line: sentenceIndex, word: wordIndex }),
        onEnd: () => {
          setSpeaking(false);
          // Clear the highlight — a word left lit after the voice stops reads as stuck.
          setSpokenWord({ line: -1, word: -1 });
          cancelRef.current = null;
          setRevealed(chunks.length);
          phaseTimers.current.push(
            setTimeout(() => {
              setIndex((i) => {
                if (i < beats.length - 1) return i + 1;
                onComplete?.();
                return i;
              });
            }, 900)
          );
        },
        onBlocked: () => setVoiceBlocked(true),
      });
      cancelRef.current = handle;
    }, 3000);
    phaseTimers.current.push(startNarration);

    return () => {
      clearTimers();
      cancelRef.current?.cancel();
      cancelRef.current = null;
      setSpeaking(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, playing, isCheckpoint, hasLines, chunks, readLevel, chat.busy]);

  // Checkpoint beats: narrate the question, then wait for an answer (same as other tracks).
  useEffect(() => {
    if (!playing || !isCheckpoint) return;
    const handle = playNarration(beat.script, {
      onStart: () => setSpeaking(true),
      onEnd: () => {
        setSpeaking(false);
        cancelRef.current = null;
      },
      onBlocked: () => setVoiceBlocked(true),
    });
    cancelRef.current = handle;
    return () => {
      handle.cancel();
      cancelRef.current = null;
      setSpeaking(false);
    };
  }, [index, playing, isCheckpoint, beat.script]);

  function advanceFromCheckpoint() {
    setCheckpointResult(null);
    setCheckpointAttempts(0);
    setIndex((i) => {
      if (i < beats.length - 1) return i + 1;
      onComplete?.();
      return i;
    });
  }
  function handleCheckpointAnswer(answer: string) {
    const result = checkAnswer(beat, answer);
    setCheckpointResult(result);
    if (result?.correct) window.setTimeout(advanceFromCheckpoint, 2200);
    else setCheckpointAttempts((n) => n + 1);
  }
  function revealCheckpointAnswer() {
    if (!beat.checkpoint) return;
    setCheckpointResult({ correct: true, feedback: beat.checkpoint.revealAnswer, revealed: true });
    window.setTimeout(advanceFromCheckpoint, 2800);
  }

  function startLesson() {
    unlockAudio();
    setVoiceBlocked(false);
    setPlaying(true);
  }
  function togglePlay() {
    if (!playing) unlockAudio();
    setPlaying((p) => !p);
  }
  function retryVoice() {
    unlockAudio();
    setVoiceBlocked(false);
    setPhase("dense");
    setRevealed(0);
    setPlaying(true);
  }
  function repeatBeat() {
    unlockAudio();
    stopVoice();
    const fullText = chunks.map((c) => c.text).join(" ");
    if (!fullText) return;
    const handle = playNarration(fullText, {
      onStart: () => setSpeaking(true),
      onSentenceStart: (i) => setRevealed(i + 1),
      onEnd: () => {
        setSpeaking(false);
        cancelRef.current = null;
      },
      onBlocked: () => setVoiceBlocked(true),
    });
    cancelRef.current = handle;
  }
  function restart() {
    stopVoice();
    clearTimers();
    setCheckpointResult(null);
    setCheckpointAttempts(0);
    setPhase("dense");
    setRevealed(0);
    setIndex(0);
    setPlaying(true);
  }

  function changeReadLevel(level: ReadingLevel) {
    updatePrefs({ readLevel: level });
    // Re-run the current beat at the new level so the effect re-chunks.
    stopVoice();
    clearTimers();
    setPhase("dense");
    setRevealed(0);
  }

  const hasStarted = playing || index > 0;
  const progressPct = (index / beats.length) * 100;
  const statusText = speaking ? "reading to you" : isCheckpoint ? "your turn" : phase === "calibrating" ? "checking your reading level" : "making it simpler";

  return (
    <main
      className="font-dyslexic hud-canvas hud-grain relative h-screen overflow-hidden"
      style={prefsToCssVars(prefs)}
    >
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_14%_0%,rgba(251,146,60,0.16),transparent_34%),radial-gradient(circle_at_88%_14%,rgba(217,119,87,0.14),transparent_34%),linear-gradient(180deg,#100a06_0%,#0a0603_74%)]" />

      <div className="absolute inset-0 flex flex-col gap-3 p-3 lg:p-5">
        {/* Header */}
        <header className="relative flex flex-wrap items-center justify-between gap-3 rounded-[1.6rem] border border-white/10 bg-stone-950/76 px-5 py-3.5 shadow-[0_24px_80px_rgba(0,0,0,0.34)] backdrop-blur-xl">
          <HudCorners accent="var(--accent-dyslexia)" />
          <div className="flex items-center gap-4">
            <button onClick={onExit} className="group relative" aria-label="Exit lecture">
              <AvatarRing progress={progressPct} speaking={speaking}>
                <TeacherAvatar speaking={speaking} size={48} />
              </AvatarRing>
            </button>
            <div>
              <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-accent-dyslexia">
                {hasStarted ? <span className="capitalize">{statusText}…</span> : "Reading-light tutor"} · step {index + 1}/{beats.length}
              </p>
              <h1 className="max-w-[34ch] truncate text-xl font-black tracking-tight">{title}</h1>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button onClick={repeatBeat} title="Read this part to me again" className="rounded-full border border-white/15 bg-white/5 px-4 py-2.5 text-sm font-bold text-white/85 transition hover:bg-white/10">
              🔁 Read again
            </button>
            <button
              onClick={hasStarted ? togglePlay : startLesson}
              className="rounded-full px-6 py-2.5 text-sm font-black"
              style={{ background: "linear-gradient(180deg, var(--accent-dyslexia-bright), var(--accent-dyslexia))", color: "#241004", boxShadow: "0 0 24px var(--accent-dyslexia-glow)" }}
            >
              {!hasStarted ? "Start lecture ▶" : playing ? "Pause ❙❙" : "Resume ▶"}
            </button>
            <button onClick={restart} className="rounded-full border border-white/15 bg-white/5 px-5 py-2.5 text-sm font-bold text-white/85 transition hover:bg-white/10">
              Restart
            </button>
            {onExit && (
              <button onClick={onExit} className="rounded-full border border-white/15 bg-white/5 px-5 py-2.5 text-sm font-bold text-white/85 transition hover:bg-white/10">
                Exit
              </button>
            )}
          </div>
        </header>

        {/* Read-level dial — student-controllable, also auto-calibrates per beat. The comfort
            controls sit beside it: both answer "how do you want to read this?", so separating them
            would mean hunting in two places. */}
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <ReadLevelDial level={readLevel} calibrating={phase === "calibrating"} onChange={changeReadLevel} />
          </div>
          <div className="shrink-0 pt-1">
            <ComfortControls prefs={prefs} update={updatePrefs} reset={resetPrefs} />
          </div>
        </div>

        {voiceBlocked && (
          <div className="flex items-center justify-between gap-4 rounded-2xl border border-amber-400/30 bg-amber-500/10 px-5 py-3">
            <p className="text-sm font-bold text-amber-200">The voice was blocked. Tap to turn on sound.</p>
            <button onClick={retryVoice} className="shrink-0 rounded-full bg-amber-400 px-5 py-2 text-sm font-black text-amber-950">
              Turn on sound
            </button>
          </div>
        )}

        {/* Main stage + chat */}
        <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[minmax(0,1fr)_320px]">
          <section className="relative grid min-h-0 overflow-hidden rounded-[1.6rem] border border-white/10 bg-stone-950/80 shadow-[0_24px_80px_rgba(0,0,0,0.3)]">
            {isCheckpoint ? (
              <div className="grid place-items-center p-6 lg:p-10">
                <div className="w-full">
                  <SlideStage
                    beat={beat}
                    onCheckpointAnswer={handleCheckpointAnswer}
                    checkpointResult={checkpointResult}
                    checkpointAttempts={checkpointAttempts}
                    maxAttempts={MAX_ATTEMPTS}
                    onRevealAnswer={revealCheckpointAnswer}
                  />
                </div>
              </div>
            ) : !hasStarted ? (
              <div className="grid place-items-center p-6 lg:p-10">
                <div className="max-w-xl text-center">
                  <p className="text-2xl font-black leading-relaxed text-white/85">No walls of text here.</p>
                  <p className="mt-4 text-lg font-bold leading-relaxed text-white/55">
                    I read everything out loud, in short lines, with pictures — so you barely need to read at all.
                  </p>
                </div>
              </div>
            ) : hasLines ? (
              <BeatStage beat={beat} dense={dense} chunks={chunks} phase={phase} revealed={revealed} speaking={speaking} spokenWord={spokenWord} />
            ) : (
              <div className="grid place-items-center p-6 lg:p-10">
                <p className="text-center text-2xl font-black text-white/80">{beat.title}</p>
              </div>
            )}

            {/* Page tint.
                Scoped to the lesson stage rather than <main>, so it never washes out the chat panel
                or the hand-drawn board — those are not what anyone is decoding. `multiply` keeps the
                text darker than the wash instead of veiling it, and pointer-events-none means the
                overlay cannot swallow a click meant for the stage. */}
            {prefs.tint !== "none" && (
              <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 z-20"
                style={{
                  background: TINT_COLORS[prefs.tint],
                  opacity: prefs.tintOpacity,
                  mixBlendMode: "multiply",
                }}
              />
            )}

            {chat.explainBoard && (
              <ExplainOverlay board={chat.explainBoard} progress={chat.drawProgress} onClose={chat.closeExplanation} />
            )}
          </section>

          <div className="hidden min-h-0 lg:block [&>*]:h-full">
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
      </div>
    </main>
  );
}

/** The per-beat stage: dense sentence -> (during chunks) the whiteboard diagram alongside
 *  short icon-paired lines. The diagram gives a visual anchor WITHOUT adding more text to
 *  read — it's the same hand-drawn board the other tracks use, reused as-is. */
function BeatStage({
  beat,
  dense,
  chunks,
  phase,
  revealed,
  speaking,
  spokenWord,
}: {
  spokenWord: { line: number; word: number };
  beat: Beat;
  dense: string;
  chunks: DyslexiaChunk[];
  phase: Phase;
  revealed: number;
  speaking: boolean;
}) {
  if (phase !== "chunks") {
    // Animation beat 1: the teacher's original dense sentence, shown as dense text. No
    // diagram yet here — keep this moment calm, one thing at a time.
    return (
      <div className="grid h-full place-items-center p-6 lg:p-10">
        <div className="max-w-3xl text-center">
          <p className="text-[11px] font-black uppercase tracking-[0.2em] text-accent-dyslexia/70">The teacher said</p>
          <p className={`mt-4 text-2xl font-medium leading-relaxed text-white/55 transition-all duration-500 ${phase === "calibrating" ? "scale-95 blur-[1px] opacity-40" : "opacity-100"}`}>
            {dense}
          </p>
          {phase === "calibrating" && <p className="mt-8 text-sm font-bold text-accent-dyslexia">Making this simpler for you…</p>}
        </div>
      </div>
    );
  }

  // Animation beats 2-3 & 5: the whiteboard on one side, short icon-paired lines on the
  // other, revealed in time with the narration. Audio still carries most of the meaning —
  // the diagram is a visual anchor, not more text.
  const boardCue = { index: Math.max(0, revealed - 1), total: Math.max(1, chunks.length), text: chunks[revealed - 1]?.text ?? "" };
  return (
    <div className="grid h-full min-h-0 lg:grid-cols-[1.1fr_1fr]">
      <div className="relative flex min-h-[420px] items-center justify-center overflow-hidden border-b border-white/10 bg-slate-950 lg:min-h-[480px] lg:border-b-0 lg:border-r">
        {/* Capped to the diagrams' native ~900:560 ratio so the hand-drawn scenes (which
         *  stretch to fill their box on both axes) don't distort in this split-panel. */}
        <div className="aspect-[900/560] h-full max-h-full w-full max-w-full">
          <Board key={beat.id} beat={beat} sentenceCue={boardCue} />
        </div>
      </div>
      <div className="flex min-h-0 flex-col justify-center gap-3 overflow-y-auto p-5 lg:p-7">
        <p className="text-center text-[11px] font-black uppercase tracking-[0.2em] text-accent-dyslexia/70">In short</p>
        {chunks.map((chunk, i) => {
          const shown = i < revealed;
          const current = i === revealed - 1 && speaking;
          return (
            <div
              key={i}
              className={`flex items-center gap-4 rounded-2xl border px-5 py-4 transition-all ${
                shown
                  ? current
                    ? "chunk-line-in border-accent-dyslexia/60 bg-accent-dyslexia/15"
                    : "chunk-line-in border-white/12 bg-white/[0.05]"
                  : "border-white/5 bg-white/[0.01] opacity-25"
              }`}
            >
              <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-stone-900/80 text-2xl" aria-hidden>
                {chunk.icon}
              </span>
              <KaraokeLine
                text={chunk.text}
                // Only the line actually being narrated tracks a word; the rest render plainly.
                activeWord={spokenWord.line === i && speaking ? spokenWord.word : -1}
                className="text-xl font-bold leading-snug text-white"
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** The "read level" dial — three steps, lowest = fewest words. Calibrates (pulses) at the
 *  start of each beat, and the student can set it themselves at any time. */
function ReadLevelDial({ level, calibrating, onChange }: { level: ReadingLevel; calibrating: boolean; onChange: (l: ReadingLevel) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-[1.6rem] border border-white/10 bg-stone-950/60 px-4 py-3 backdrop-blur-xl">
      <span className={`text-[11px] font-black uppercase tracking-[0.16em] ${calibrating ? "text-accent-dyslexia av-ring-dot" : "text-white/45"}`}>
        {calibrating ? "Checking your reading level…" : "Reading level"}
      </span>
      <div className="flex items-center gap-1.5">
        {READING_LEVELS.map((l) => (
          <button
            key={l}
            onClick={() => onChange(l)}
            aria-pressed={level === l}
            title={READING_LEVEL_LABELS[l]}
            className={`rounded-full px-4 py-1.5 text-xs font-black transition ${
              level === l ? "bg-gradient-to-r from-accent-dyslexia-bright to-accent-dyslexia text-stone-950" : "border border-white/15 bg-white/5 text-white/70 hover:bg-white/10"
            }`}
          >
            {READING_LEVEL_LABELS[l]}
          </button>
        ))}
      </div>
    </div>
  );
}

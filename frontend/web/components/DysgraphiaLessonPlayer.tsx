"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { SlideStage } from "./SlideStage";
import { TeacherAvatar } from "./TeacherAvatar";
import { Board, AvatarRing, MAX_ATTEMPTS } from "./LessonPlayer";
import { beats as demoBeats, type Beat } from "@/lib/lessonContent";
import { playNarration, unlockAudio, type NarrationHandle } from "@/lib/voice";
import { getSpeechRecognition, type SpeechRecognitionLike } from "@/lib/speech";
import { useLessonChat, ChatPanel, ExplainOverlay } from "./lesson-chat/LessonChat";
import { HudCorners } from "./hud/HudKit";

/**
 * The Dysgraphia track — built to the supplied spec exactly. The friction here is the
 * motor/cognitive process of WRITING, not thinking or speaking — the student knows the
 * answer but struggles to get it onto the page in an organized way. So every checkpoint in
 * this track replaces the typed-answer box with a mic: the student speaks their answer,
 * rambling and unstructured is fine, and an AI scribe restructures it into a clean,
 * organized written paragraph — fixing ordering, removing filler, grouping related ideas.
 * This goes beyond transcription on purpose; the spec is explicit that the assistant
 * "restructures the spoken thought," not just cleans up the wording.
 *
 * The non-checkpoint beats use the same visual board as the other tracks — dysgraphia does
 * not affect reading or listening, only the output side of writing.
 */
const SLIDE_MS = 1500;
type Stage = "slide" | "board";
type ScribePhase = "idle" | "listening" | "processing" | "result";

const FILLER_WORDS = ["um", "uh", "like", "so basically", "you know", "kind of", "sort of", "basically", "actually"];

export function DysgraphiaLessonPlayer({ onExit, onComplete, beats = demoBeats, title = "Photosynthesis" }: { onExit?: () => void; onComplete?: () => void; beats?: Beat[]; title?: string }) {
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [stage, setStage] = useState<Stage>("slide");
  const [voiceBlocked, setVoiceBlocked] = useState(false);
  const [sentenceCue, setSentenceCue] = useState({ index: 0, total: 1, text: "" });

  // The scribe flow: listening (mic capturing speech) -> processing (AI restructures it) ->
  // result (clean note shown). `rawWords` are the live, messy spoken words for the
  // animation; `cleanNote` is the AI's organized rewrite.
  const [scribePhase, setScribePhase] = useState<ScribePhase>("idle");
  const [rawWords, setRawWords] = useState<string[]>([]);
  const [cleanNote, setCleanNote] = useState("");
  const [scribeError, setScribeError] = useState<string | null>(null);
  // Lazily checked once at mount (client-only component) rather than in an effect.
  const [micSupported, setMicSupported] = useState<boolean>(() => getSpeechRecognition() !== null);

  const cancelRef = useRef<NarrationHandle | null>(null);
  const slideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const beat = beats[index];
  const isCheckpoint = beat.slideKind === "checkpoint";

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

  // Reset the scribe flow whenever the beat changes. The writes run on a 0ms timer so
  // they're not synchronous in the effect body (avoids the cascading-render lint).
  useEffect(() => {
    const t = setTimeout(() => {
      setScribePhase("idle");
      setRawWords([]);
      setCleanNote("");
      setScribeError(null);
    }, 0);
    return () => clearTimeout(t);
  }, [index]);

  // Effect 1: slide -> board timing (non-checkpoint beats only — checkpoints stay on the
  // scribe UI, not the slide/board split).
  useEffect(() => {
    if (!playing || stage !== "slide" || isCheckpoint) return;
    if (slideTimer.current) clearTimeout(slideTimer.current);
    slideTimer.current = setTimeout(() => setStage("board"), SLIDE_MS);
    return () => {
      if (slideTimer.current) clearTimeout(slideTimer.current);
    };
  }, [index, playing, stage, isCheckpoint]);

  // Effect 2: narration for non-checkpoint beats. Checkpoints narrate their question once
  // when reached, then hand off to the mic — no auto-advance.
  useEffect(() => {
    if (!playing || chat.busy) return;
    const narrateOnBoard = !isCheckpoint && stage === "board";
    const narrateOnCheckpointArrival = isCheckpoint && scribePhase === "idle";
    if (!narrateOnBoard && !narrateOnCheckpointArrival) return;

    const handle = playNarration(beat.script, {
      onStart: () => setSpeaking(true),
      onSentenceStart: (sentenceIndex, sentence, total) => setSentenceCue({ index: sentenceIndex, text: sentence, total }),
      onEnd: () => {
        setSpeaking(false);
        cancelRef.current = null;
        if (!isCheckpoint) {
          setIndex((i) => {
            if (i < beats.length - 1) return i + 1;
            onComplete?.();
            return i;
          });
          setStage("slide");
        }
        // Checkpoints: stay put. The mic is available as soon as the question is asked.
      },
      onBlocked: () => setVoiceBlocked(true),
    });
    cancelRef.current = handle;

    return () => {
      handle.cancel();
      cancelRef.current = null;
      setSpeaking(false);
    };
  }, [index, playing, stage, isCheckpoint, beat.script, beats.length, scribePhase, chat.busy, onComplete]);

  // Starts listening: captures speech (interim + final) for the messy-soundwave animation,
  // and on stop sends the full transcript to the AI scribe for restructuring.
  function startListening() {
    const recognition = getSpeechRecognition();
    if (!recognition) {
      setMicSupported(false);
      return;
    }
    unlockAudio();
    stopVoice();
    setScribeError(null);
    setRawWords([]);
    setScribePhase("listening");

    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-US";

    let finalTranscript = "";
    recognition.onresult = (ev) => {
      let interim = "";
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const result = ev.results[i];
        const transcript = result[0]?.transcript ?? "";
        if (result.isFinal) finalTranscript += `${transcript} `;
        else interim += transcript;
      }
      const words = `${finalTranscript} ${interim}`.trim().split(/\s+/).filter(Boolean);
      setRawWords(words.slice(-40)); // cap the floating-word animation to the most recent words
    };
    recognition.onerror = () => {
      setScribeError("I couldn't hear you clearly — let's try again.");
      setScribePhase("idle");
    };
    recognition.onend = () => {
      const text = finalTranscript.trim();
      if (text) void restructure(text);
      else setScribePhase("idle");
    };

    recognitionRef.current = recognition;
    recognition.start();
  }

  function stopListening() {
    recognitionRef.current?.stop();
  }

  async function restructure(messyText: string) {
    setScribePhase("processing");
    try {
      const res = await fetch("/api/restructure", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: messyText }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.restructured) {
        throw new Error(data.error || "The AI scribe is unavailable right now.");
      }
      setCleanNote(data.restructured);
      setScribePhase("result");
      const handle = playNarration("I heard what you meant — here's your answer, cleaned up and organized.", {
        onStart: () => setSpeaking(true),
        onEnd: () => {
          setSpeaking(false);
          cancelRef.current = null;
        },
        onBlocked: () => setVoiceBlocked(true),
      });
      cancelRef.current = handle;
    } catch (err) {
      setScribeError(err instanceof Error ? err.message : "Something went wrong.");
      setScribePhase("idle");
    }
  }

  function advanceFromCheckpoint() {
    setScribePhase("idle");
    setRawWords([]);
    setCleanNote("");
    setIndex((i) => {
      if (i < beats.length - 1) return i + 1;
      onComplete?.();
      return i;
    });
    setStage("slide");
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
    setStage("slide");
    setPlaying(true);
  }
  function restart() {
    stopVoice();
    recognitionRef.current?.stop();
    setScribePhase("idle");
    setRawWords([]);
    setCleanNote("");
    setScribeError(null);
    setSentenceCue({ index: 0, total: 1, text: "" });
    setIndex(0);
    setStage("slide");
    setPlaying(true);
  }

  const hasStarted = playing || index > 0 || stage === "board";
  const progressPct = ((index + (stage === "board" ? 0.5 : 0)) / beats.length) * 100;
  const statusText = speaking
    ? "explaining"
    : isCheckpoint
      ? scribePhase === "listening"
        ? "listening to you"
        : scribePhase === "processing"
          ? "organizing your answer"
          : scribePhase === "result"
            ? "here's your note"
            : "ready when you are"
      : stage === "slide"
        ? "setting up"
        : "drawing";

  return (
    <main className="hud-canvas hud-grain relative h-screen overflow-hidden">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_14%_0%,rgba(192,132,252,0.16),transparent_34%),radial-gradient(circle_at_88%_16%,rgba(167,139,250,0.14),transparent_34%),linear-gradient(180deg,#06080d_0%,#030407_74%)]" />

      <div className="absolute inset-0 flex flex-col gap-3 p-3 lg:p-5">
        <header className="relative flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--hud-line)] bg-violet-950/30 px-5 py-3.5 shadow-[0_24px_80px_rgba(0,0,0,0.34)] backdrop-blur-xl">
          <HudCorners accent="var(--accent-dysgraphia)" />
          <div className="flex items-center gap-4">
            <button onClick={onExit} className="group relative" aria-label="Exit lecture">
              <AvatarRing progress={progressPct} speaking={speaking}>
                <TeacherAvatar speaking={speaking} size={48} />
              </AvatarRing>
            </button>
            <div>
              <p className="hud-eyebrow text-[11px] tracking-[0.14em] text-accent-dysgraphia">
                {hasStarted ? <span className="capitalize">{statusText}…</span> : "Speak it, don't write it"} · step {index + 1}/{beats.length}
              </p>
              <h1 className="max-w-[34ch] truncate text-xl font-black tracking-tight">{title}</h1>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={hasStarted ? togglePlay : startLesson}
              className="rounded-full px-6 py-2.5 text-sm font-black"
              style={{ background: "linear-gradient(180deg, var(--accent-dysgraphia-bright), var(--accent-dysgraphia))", color: "#1d0a33", boxShadow: "0 0 24px var(--accent-dysgraphia-glow)" }}
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

        {voiceBlocked && (
          <div className="flex items-center justify-between gap-4 rounded-2xl border border-amber-400/30 bg-amber-500/10 px-5 py-3">
            <p className="text-sm font-bold text-amber-200">The teacher&rsquo;s voice was blocked. Tap to enable sound.</p>
            <button onClick={retryVoice} className="shrink-0 rounded-full bg-amber-400 px-5 py-2 text-sm font-black text-amber-950">
              Enable sound
            </button>
          </div>
        )}

        <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[minmax(0,1fr)_320px]">
          <section className="relative min-h-0 overflow-hidden rounded-[1.6rem] border border-white/10 bg-stone-950/80 shadow-[0_24px_80px_rgba(0,0,0,0.3)]">
            {isCheckpoint ? (
              <ScribeStage
                beat={beat}
                phase={scribePhase}
                rawWords={rawWords}
                cleanNote={cleanNote}
                error={scribeError}
                micSupported={micSupported}
                onStartListening={startListening}
                onStopListening={stopListening}
                onReviseByVoice={startListening}
                onContinue={advanceFromCheckpoint}
              />
            ) : stage === "slide" ? (
              <SlideStage beat={beat} maxAttempts={MAX_ATTEMPTS} />
            ) : (
              <div className="beat-fade-in relative h-full">
                <Board key={beat.id} beat={beat} sentenceCue={sentenceCue} />
                <div className="pointer-events-none absolute inset-x-0 bottom-0 z-40 p-3 lg:p-4">
                  <div className="mx-auto max-w-4xl rounded-2xl border border-white/10 bg-slate-950/86 px-5 py-3 text-center text-base font-bold leading-snug text-white shadow-2xl backdrop-blur-md">
                    {sentenceCue.text || beat.script}
                  </div>
                </div>
              </div>
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

/** The scribe stage: mic -> messy soundwave with floating filler words -> filtering/
 *  reordering animation -> clean organized note card -> "Edit by voice" to revise. */
function ScribeStage({
  beat,
  phase,
  rawWords,
  cleanNote,
  error,
  micSupported,
  onStartListening,
  onStopListening,
  onReviseByVoice,
  onContinue,
}: {
  beat: Beat;
  phase: ScribePhase;
  rawWords: string[];
  cleanNote: string;
  error: string | null;
  micSupported: boolean;
  onStartListening: () => void;
  onStopListening: () => void;
  onReviseByVoice: () => void;
  onContinue: () => void;
}) {
  return (
    <div className="grid h-full place-items-center p-6 lg:p-10">
      <div className="w-full max-w-2xl text-center">
        <p className="text-xs font-black uppercase tracking-[0.2em] text-accent-dysgraphia">{beat.checkpoint?.prompt ?? beat.title}</p>

        {!micSupported && (
          <p className="mt-6 rounded-2xl border border-amber-400/30 bg-amber-500/10 px-5 py-3 text-sm font-bold text-amber-200">
            Voice input isn&rsquo;t supported in this browser. Try Chrome to use the mic.
          </p>
        )}

        {micSupported && phase === "idle" && (
          <>
            <button
              onClick={onStartListening}
              className="mx-auto mt-8 grid size-24 place-items-center rounded-full bg-gradient-to-br from-accent-dysgraphia to-violet-600 text-4xl shadow-[0_0_50px_var(--accent-dysgraphia-glow)] transition hover:scale-105"
              aria-label="Start speaking your answer"
            >
              🎙️
            </button>
            <p className="mt-4 text-base font-bold text-white/60">Tap the mic and just talk — ramble all you want. I&rsquo;ll organize it for you.</p>
          </>
        )}

        {phase === "listening" && (
          <>
            <MessySoundwave words={rawWords} />
            <button
              onClick={onStopListening}
              className="mx-auto mt-6 rounded-full bg-gradient-to-r from-rose-400 to-red-500 px-8 py-3 text-base font-black text-white shadow-[0_0_30px_rgba(244,63,94,0.4)]"
            >
              ⏹ I&rsquo;m done — organize it
            </button>
          </>
        )}

        {phase === "processing" && (
          <div className="mt-8">
            <FilterAnimation words={rawWords} />
            <p className="mt-6 text-base font-bold text-accent-dysgraphia">Organizing your thoughts…</p>
          </div>
        )}

        {phase === "result" && (
          <>
            <div className="beat-fade-in mt-7 rounded-3xl border border-accent-dysgraphia/30 bg-white p-7 text-left shadow-2xl">
              <p className="text-[10px] font-black uppercase tracking-[0.18em] text-violet-500">Your note, organized</p>
              <p className="mt-3 text-lg font-medium leading-relaxed text-slate-900">{cleanNote}</p>
            </div>
            <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
              <button
                onClick={onReviseByVoice}
                className="rounded-full border border-white/15 bg-white/5 px-5 py-2.5 text-sm font-bold text-white/85 transition hover:bg-white/10"
              >
                🎙️ Edit by voice
              </button>
              <button
                onClick={onContinue}
                className="rounded-full bg-gradient-to-r from-accent-dysgraphia-bright to-violet-400 px-7 py-2.5 text-sm font-black text-violet-950 shadow-[0_0_30px_var(--accent-dysgraphia-glow)]"
              >
                Looks good — continue ▶
              </button>
            </div>
          </>
        )}

        {error && <p className="mt-5 rounded-xl border border-rose-400/30 bg-rose-500/10 px-4 py-3 text-sm font-bold text-rose-200">{error}</p>}
      </div>
    </div>
  );
}

/** Animation beat 1: a jagged messy soundwave with scattered filler/spoken words floating
 *  around it while the student talks. */
function MessySoundwave({ words }: { words: string[] }) {
  const bars = Array.from({ length: 24 });
  return (
    <div className="relative mt-8 flex h-28 items-center justify-center gap-1">
      {bars.map((_, i) => {
        const isFiller = FILLER_WORDS.some((f) => words[words.length - 1 - (i % words.length)]?.toLowerCase().includes(f));
        // Deterministic per-bar base height (pure — no Date.now()); the jittery, "live"
        // motion comes from the soundwave-bar CSS animation, not from recomputing on render.
        const h = 14 + Math.abs(Math.sin(i * 1.7)) * 70;
        return (
          <span
            key={i}
            className={`soundwave-bar w-1.5 rounded-full ${isFiller ? "bg-rose-400/50" : "bg-accent-dysgraphia"}`}
            style={{ height: `${h}%`, animationDelay: `${(i % 5) * 70}ms`, animationDuration: `${0.3 + (i % 5) * 0.05}s` }}
          />
        );
      })}
      <div className="pointer-events-none absolute inset-0">
        {words.slice(-8).map((w, i) => (
          <span
            key={`${w}-${i}`}
            className="chunk-line-in absolute text-xs font-bold text-white/40"
            style={{
              left: `${10 + ((i * 37) % 80)}%`,
              top: `${(i * 23) % 100}%`,
              animationDelay: `${i * 60}ms`,
            }}
          >
            {w}
          </span>
        ))}
      </div>
    </div>
  );
}

/** Animation beat 2: words visibly get filtered (filler fades out) and the remaining key
 *  phrases settle into a grid before snapping into the organized paragraph. */
function FilterAnimation({ words }: { words: string[] }) {
  const kept = words.filter((w) => !FILLER_WORDS.some((f) => w.toLowerCase().includes(f)));
  return (
    <div className="flex flex-wrap items-center justify-center gap-2">
      {words.slice(0, 18).map((w, i) => {
        const isFiller = FILLER_WORDS.some((f) => w.toLowerCase().includes(f));
        return (
          <span
            key={`${w}-${i}`}
            className={`rounded-lg px-2.5 py-1 text-sm font-bold transition-all duration-700 ${
              isFiller ? "scale-75 opacity-0" : "scale-100 bg-accent-dysgraphia/20 text-accent-dysgraphia-bright opacity-100"
            }`}
          >
            {w}
          </span>
        );
      })}
      {kept.length === 0 && <span className="text-sm font-bold text-white/40">…</span>}
    </div>
  );
}

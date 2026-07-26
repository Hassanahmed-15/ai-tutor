"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { SlideStage } from "./SlideStage";
import { TeacherAvatar } from "./TeacherAvatar";
import { Board, AvatarRing, checkAnswer, MAX_ATTEMPTS, type CheckpointResult } from "./LessonPlayer";
import { beats as demoBeats, type Beat } from "@/lib/lessonContent";
import { playNarration, unlockAudio, type NarrationHandle } from "@/lib/voice";
import { autismBeatContent, DEFAULT_AUTISM_BEAT, lectureIdioms } from "@/lib/autismLectureContent";
import { useLessonChat, ChatPanel, ExplainOverlay } from "./lesson-chat/LessonChat";
import { HudCorners } from "./hud/HudKit";

/**
 * The Autism track — built to the supplied spec exactly. ASD friction here is structure
 * and ambiguity, not comprehension, so this track gives the student PREDICTABILITY and
 * CONTROL on top of the same visual lecture:
 *
 *  - A live transcript of the lecture, kept in the background the whole time.
 *  - "Explain Simply": rewrites the teacher's vague/implicit phrasing into an explicit,
 *    literal, step-by-step task breakdown (the spec's "Just summarize your thoughts" ->
 *    3-step checklist).
 *  - A visual "Now / Next / Later" schedule strip so the student always knows what is
 *    happening now and what is coming.
 *  - Direct control buttons — "Explain Simply", "Show Picture", "Need Break" — so a need
 *    never has to be verbally negotiated with the teacher.
 *  - Sensory pre-warnings: scans the upcoming beat and warns before a likely
 *    sensory-overload moment (fast animation / loud media) happens.
 */
const SLIDE_MS = 1500;
type Stage = "slide" | "board";

/** Sensory / calm preferences — all default to the most regulated, lowest-stimulation state
 *  is NOT assumed; we keep the normal rich experience by default and let the student dial it
 *  down. Persisted to localStorage so choices survive reloads (predictability across sessions). */
interface SensorySettings {
  reduceMotion: boolean; // turn off animations — instant reveals instead of movement
  dimColors: boolean; // mute the bright background gradients
  highContrast: boolean; // simpler, higher-contrast text surfaces
  largerText: boolean; // bump caption/transcript text size
}
const DEFAULT_SETTINGS: SensorySettings = { reduceMotion: false, dimColors: false, highContrast: false, largerText: false };
const SETTINGS_KEY = "aria.autism.sensory";
const DECODE_KEY = "aria.autism.decode";

function loadSettings(): SensorySettings {
  if (typeof window === "undefined") return DEFAULT_SETTINGS;
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    return raw ? { ...DEFAULT_SETTINGS, ...JSON.parse(raw) } : DEFAULT_SETTINGS;
  } catch {
    return DEFAULT_SETTINGS;
  }
}
function loadDecode(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return localStorage.getItem(DECODE_KEY) === "1";
  } catch {
    return false;
  }
}

export function AutismLessonPlayer({ onExit, onComplete, beats = demoBeats, title = "Photosynthesis" }: { onExit?: () => void; onComplete?: () => void; beats?: Beat[]; title?: string }) {
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [stage, setStage] = useState<Stage>("slide");
  const [voiceBlocked, setVoiceBlocked] = useState(false);
  const [checkpointResult, setCheckpointResult] = useState<CheckpointResult>(null);
  const [waitingOnCheckpoint, setWaitingOnCheckpoint] = useState(false);
  const [checkpointAttempts, setCheckpointAttempts] = useState(0);
  const [sentenceCue, setSentenceCue] = useState({ index: 0, total: 1, text: "" });

  // Live transcript — accumulates each sentence as it's spoken, kept the whole time.
  const [transcript, setTranscript] = useState<string[]>([]);
  // Student-controlled panels. Only one open at a time; opening one pauses the lecture.
  const [panel, setPanel] = useState<null | "explain" | "picture" | "break">(null);
  // Sensory pre-warning toast for the upcoming beat.
  const [sensoryWarning, setSensoryWarning] = useState<string | null>(null);
  const warnedRef = useRef<Set<number>>(new Set());

  // Sensory / calm settings, persisted so the student's preferences survive reloads.
  // Lazily initialized from localStorage (client-only component, so this is safe and avoids
  // a setState-in-effect hydration pattern).
  const [settings, setSettings] = useState<SensorySettings>(loadSettings);
  const [settingsOpen, setSettingsOpen] = useState(false);
  // Idiom decoder: when on, figures of speech in the caption/transcript are flagged and
  // tapping one shows its plain literal meaning.
  const [decodeIdioms, setDecodeIdioms] = useState<boolean>(loadDecode);

  const updateSetting = useCallback((patch: Partial<SensorySettings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      try {
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);
  const toggleDecode = useCallback(() => {
    setDecodeIdioms((d) => {
      const next = !d;
      try {
        localStorage.setItem(DECODE_KEY, next ? "1" : "0");
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  const cancelRef = useRef<NarrationHandle | null>(null);
  const slideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const transcriptEndRef = useRef<HTMLDivElement | null>(null);
  const beat = beats[index];
  const isCheckpoint = beat.slideKind === "checkpoint";
  const content = autismBeatContent[beat.id] ?? DEFAULT_AUTISM_BEAT;
  const paused = panel !== null;

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

  // Sensory pre-warning: before a flagged beat starts, surface the warning toast once.
  useEffect(() => {
    if (!playing || paused) return;
    const warning = content.sensoryWarning;
    if (warning && !warnedRef.current.has(index)) {
      warnedRef.current.add(index);
      setSensoryWarning(warning);
      const t = setTimeout(() => setSensoryWarning(null), 7000);
      return () => clearTimeout(t);
    }
  }, [index, playing, paused, content.sensoryWarning]);

  // Effect 1: slide -> board timing. Halts while a control panel is open (paused).
  useEffect(() => {
    if (!playing || paused || stage !== "slide" || isCheckpoint) return;
    if (slideTimer.current) clearTimeout(slideTimer.current);
    slideTimer.current = setTimeout(() => setStage("board"), SLIDE_MS);
    return () => {
      if (slideTimer.current) clearTimeout(slideTimer.current);
    };
  }, [index, playing, paused, stage, isCheckpoint]);

  // Effect 2: narration. Halts while a control panel is open (paused).
  useEffect(() => {
    if (!playing || paused || chat.busy) return;
    const narrateOnBoard = !isCheckpoint && stage === "board";
    const narrateOnCheckpointSlide = isCheckpoint && stage === "slide";
    if (!narrateOnBoard && !narrateOnCheckpointSlide) return;

    const handle = playNarration(beat.script, {
      onStart: () => setSpeaking(true),
      onSentenceStart: (sentenceIndex, sentence, total) => {
        setSentenceCue({ index: sentenceIndex, text: sentence, total });
        setTranscript((prev) => (prev[prev.length - 1] === sentence ? prev : [...prev, sentence]));
      },
      onEnd: () => {
        setSpeaking(false);
        cancelRef.current = null;
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
    });
    cancelRef.current = handle;

    return () => {
      handle.cancel();
      cancelRef.current = null;
      setSpeaking(false);
    };
  }, [index, playing, paused, stage, isCheckpoint, beat.script, beats.length, chat.busy, onComplete]);

  // Keep the transcript scrolled to the newest line.
  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [transcript]);

  function advanceFromCheckpoint() {
    setCheckpointResult(null);
    setCheckpointAttempts(0);
    setSentenceCue({ index: 0, total: 1, text: "" });
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

  // Control buttons. Opening a panel stops narration and pauses the lecture; closing it
  // resumes from the current beat. No verbal negotiation with the teacher needed.
  function openPanel(which: "explain" | "picture" | "break") {
    unlockAudio();
    stopVoice();
    setPanel(which);
  }
  function closePanel() {
    unlockAudio();
    setPanel(null);
    // Resume narration of the current beat by nudging the stage so Effect 2 re-fires.
    setStage((s) => s);
    setPlaying(true);
  }

  // Re-hear a specific line on demand — supports processing at your own pace, with no
  // social pressure to keep up. Speaks just that line; the lecture stays where it is.
  function speakOnce(text: string) {
    if (!text) return;
    cancelRef.current?.cancel();
    const handle = playNarration(text, {
      onStart: () => setSpeaking(true),
      onEnd: () => {
        setSpeaking(false);
        cancelRef.current = null;
      },
      onBlocked: () => setVoiceBlocked(true),
    });
    cancelRef.current = handle;
  }
  function repeatCurrent() {
    unlockAudio();
    speakOnce(sentenceCue.text || beat.script);
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
    setPanel(null);
    setTranscript([]);
    warnedRef.current = new Set();
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
  const statusText = paused
    ? panel === "break"
      ? "break time"
      : "showing you more"
    : speaking
      ? "explaining"
      : waitingOnCheckpoint
        ? "waiting on you"
        : stage === "slide"
          ? "setting up"
          : "drawing";

  // Now / Next / Later schedule, derived live from the beat list.
  const schedule = {
    now: scheduleLabelFor(beats, index),
    next: scheduleLabelFor(beats, index + 1),
    later: scheduleLabelFor(beats, index + 2),
  };

  // Predictable-progress values: how many steps are left and roughly how long, so the
  // student always knows where the lesson ends — unpredictability is a common ASD stressor.
  const stepsLeft = beats.length - 1 - index;
  const thisStepSeconds = content.seconds;
  const secondsLeft = beats.slice(index + 1).reduce((sum, b) => sum + (autismBeatContent[b.id] ?? DEFAULT_AUTISM_BEAT).seconds, 0);

  // Sensory settings drive the visual treatment of the whole player.
  const rootBg = settings.dimColors || settings.highContrast ? "bg-[#050505]" : "bg-[#0a0a0c]";
  const captionTextSize = settings.largerText ? "text-xl lg:text-2xl" : "text-base";

  return (
    <main className={`hud-grain relative h-screen overflow-hidden text-[var(--hud-text)] ${rootBg} ${settings.reduceMotion ? "[&_*]:!animate-none [&_*]:!transition-none" : ""}`}>
      {!settings.dimColors && !settings.highContrast && (
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_12%_0%,rgba(94,234,212,0.14),transparent_34%),radial-gradient(circle_at_90%_16%,rgba(52,211,153,0.1),transparent_34%),linear-gradient(180deg,#0a0a0c_0%,#050505_74%)]" />
      )}

      <div className="absolute inset-0 flex flex-col gap-3 p-3 lg:p-4">
        {/* Header */}
        <header className="relative flex flex-wrap items-center justify-between gap-3 rounded-[1.6rem] border border-white/10 bg-slate-950/76 px-5 py-3 shadow-[0_24px_80px_rgba(0,0,0,0.34)] backdrop-blur-xl">
          <HudCorners accent="var(--accent-autism)" />
          <div className="flex items-center gap-4">
            <button onClick={onExit} className="group relative" aria-label="Exit lecture">
              <AvatarRing progress={progressPct} speaking={speaking}>
                <TeacherAvatar speaking={speaking} size={48} />
              </AvatarRing>
            </button>
            <div>
              <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-accent-autism">
                {hasStarted ? <span className="capitalize">{statusText}…</span> : "Calm, predictable tutor"} · step {index + 1}/{beats.length}
              </p>
              <h1 className="max-w-[34ch] truncate text-xl font-black tracking-tight">{title}</h1>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={repeatCurrent}
              title="Hear the current line again"
              className="rounded-full border border-white/15 bg-white/5 px-4 py-2.5 text-sm font-bold text-white/80 transition hover:bg-white/10"
            >
              🔁 Say again
            </button>
            <button
              onClick={toggleDecode}
              aria-pressed={decodeIdioms}
              title="Show the plain meaning of figures of speech"
              className={`rounded-full px-4 py-2.5 text-sm font-bold transition ${decodeIdioms ? "bg-accent-autism/90 text-slate-950" : "border border-white/15 bg-white/5 text-white/80 hover:bg-white/10"}`}
            >
              🔤 Plain words
            </button>
            <button
              onClick={() => setSettingsOpen(true)}
              title="Calm & sensory settings"
              className="rounded-full border border-white/15 bg-white/5 px-4 py-2.5 text-sm font-bold text-white/80 transition hover:bg-white/10"
            >
              ⚙️ Calm settings
            </button>
            <button
              onClick={hasStarted ? togglePlay : startLesson}
              className="rounded-full px-6 py-2.5 text-sm font-black"
              style={{ background: "linear-gradient(180deg, var(--accent-autism-bright), var(--accent-autism))", color: "#04140c", boxShadow: "0 0 24px var(--accent-autism-glow)" }}
            >
              {!hasStarted ? "Start lecture ▶" : playing && !paused ? "Pause ❙❙" : "Resume ▶"}
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

        {/* Now / Next / Later schedule strip + predictable progress */}
        <ScheduleStrip schedule={schedule} stepsLeft={stepsLeft} thisStepSeconds={thisStepSeconds} secondsLeft={secondsLeft} />

        {voiceBlocked && (
          <div className="flex items-center justify-between gap-4 rounded-2xl border border-amber-400/30 bg-amber-500/10 px-5 py-3">
            <p className="text-sm font-bold text-amber-200">The teacher&rsquo;s voice was blocked. Tap to enable sound.</p>
            <button onClick={retryVoice} className="shrink-0 rounded-full bg-amber-400 px-5 py-2 text-sm font-black text-amber-950">
              Enable sound
            </button>
          </div>
        )}

        {/* Main area: board + a live transcript side panel */}
        <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[minmax(0,1fr)_320px]">
          <section className="relative min-h-0 overflow-hidden rounded-[1.6rem] border border-white/10 bg-slate-950/80 shadow-[0_24px_80px_rgba(0,0,0,0.3)]">
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
                <Board key={beat.id} beat={beat} sentenceCue={sentenceCue} />
                <div className="absolute inset-x-0 bottom-0 z-40 p-3 lg:p-4">
                  <div className={`mx-auto max-w-4xl rounded-2xl border border-white/10 bg-slate-950/86 px-5 py-3 text-center font-bold leading-snug text-white shadow-2xl backdrop-blur-md ${captionTextSize}`}>
                    <DecodedText text={sentenceCue.text || beat.script} decode={decodeIdioms} />
                  </div>
                </div>
              </div>
            )}

            {/* Sensory pre-warning toast */}
            {sensoryWarning && (
              <div className="beat-fade-in absolute left-4 top-4 z-50 flex max-w-sm items-start gap-3 rounded-2xl border border-amber-400/40 bg-amber-500/15 px-4 py-3 backdrop-blur-md">
                <span className="mt-0.5 text-xl" aria-hidden>🔊</span>
                <div>
                  <p className="text-[11px] font-black uppercase tracking-wide text-amber-300">Heads up</p>
                  <p className="text-sm font-bold text-amber-100">{sensoryWarning}</p>
                </div>
              </div>
            )}

            {chat.explainBoard && (
              <ExplainOverlay board={chat.explainBoard} progress={chat.drawProgress} onClose={chat.closeExplanation} />
            )}

            {/* Control-button panel overlay */}
            {panel && (
              <ControlPanel
                panel={panel}
                beat={beat}
                content={content}
                onClose={closePanel}
              />
            )}
          </section>

          {/* Right column: live transcript on top, chat below */}
          <div className="hidden min-h-0 grid-rows-[1fr_minmax(0,0.9fr)] gap-3 lg:grid">
            <aside className="flex min-h-0 flex-col rounded-[1.6rem] border border-white/10 bg-slate-950/76 p-4 backdrop-blur-xl">
              <p className="text-[11px] font-black uppercase tracking-[0.18em] text-accent-autism">Live transcript</p>
              <p className="mt-1 text-[11px] font-semibold text-white/35">Tap any line to hear it again.</p>
              <div className="mt-3 min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
                {transcript.length === 0 ? (
                  <p className="text-sm font-semibold text-white/35">The teacher&rsquo;s words will appear here as they speak.</p>
                ) : (
                  transcript.map((line, i) => (
                    <button
                      key={i}
                      onClick={() => { unlockAudio(); speakOnce(line); }}
                      className={`w-full rounded-lg bg-white/[0.04] px-3 py-2 text-left font-medium leading-snug text-white/80 transition hover:bg-white/[0.1] ${settings.largerText ? "text-base" : "text-sm"}`}
                    >
                      <DecodedText text={line} decode={decodeIdioms} />
                    </button>
                  ))
                )}
                <div ref={transcriptEndRef} />
              </div>
            </aside>
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

        {/* Direct control buttons — no verbal negotiation needed */}
        <div className="flex flex-wrap items-center justify-center gap-3 rounded-[1.6rem] border border-white/10 bg-slate-950/76 px-4 py-3 backdrop-blur-xl">
          <ControlButton label="Explain Simply" icon="📋" active={panel === "explain"} onClick={() => openPanel("explain")} />
          <ControlButton label="Show Picture" icon="🖼️" active={panel === "picture"} onClick={() => openPanel("picture")} />
          <ControlButton label="Need Break" icon="⏸️" active={panel === "break"} onClick={() => openPanel("break")} />
        </div>
      </div>

      {/* Calm & sensory settings — student can dial down motion, brightness, contrast, size */}
      {settingsOpen && (
        <SensorySettingsModal
          settings={settings}
          decodeIdioms={decodeIdioms}
          onToggleDecode={toggleDecode}
          onChange={updateSetting}
          onClose={() => setSettingsOpen(false)}
        />
      )}
    </main>
  );
}

function SensorySettingsModal({
  settings,
  decodeIdioms,
  onToggleDecode,
  onChange,
  onClose,
}: {
  settings: SensorySettings;
  decodeIdioms: boolean;
  onToggleDecode: () => void;
  onChange: (patch: Partial<SensorySettings>) => void;
  onClose: () => void;
}) {
  const rows: { key: keyof SensorySettings; label: string; hint: string }[] = [
    { key: "reduceMotion", label: "Reduce motion", hint: "Turn off animations. Things appear instantly instead of moving." },
    { key: "dimColors", label: "Dim the colors", hint: "Remove the bright glowing background. Calmer, darker screen." },
    { key: "highContrast", label: "High contrast", hint: "Plainer, sharper text on a darker background." },
    { key: "largerText", label: "Larger text", hint: "Make the captions and transcript bigger and easier to read." },
  ];
  return (
    <div className="absolute inset-0 z-[60] grid place-items-center bg-slate-950/85 p-6 backdrop-blur-md" role="dialog" aria-label="Calm and sensory settings">
      <div className="w-full max-w-lg rounded-3xl border border-white/10 bg-slate-900/90 p-7">
        <p className="text-xs font-black uppercase tracking-[0.2em] text-accent-autism">Calm &amp; sensory settings</p>
        <h2 className="mt-2 text-2xl font-black">Make the screen feel right for you</h2>
        <p className="mt-1 text-sm font-semibold text-white/50">These stay saved for next time.</p>

        <div className="mt-6 space-y-2.5">
          {rows.map((r) => (
            <ToggleRow key={r.key} label={r.label} hint={r.hint} on={settings[r.key]} onToggle={() => onChange({ [r.key]: !settings[r.key] })} />
          ))}
          <ToggleRow label="Plain words" hint="Show the simple meaning of figures of speech, like 'kitchen' or 'stove'." on={decodeIdioms} onToggle={onToggleDecode} />
        </div>

        <button onClick={onClose} className="mt-7 w-full rounded-full bg-gradient-to-r from-accent-autism-bright to-accent-autism py-3 text-base font-black text-slate-950">
          Done
        </button>
      </div>
    </div>
  );
}

function ToggleRow({ label, hint, on, onToggle }: { label: string; hint: string; on: boolean; onToggle: () => void }) {
  return (
    <button
      onClick={onToggle}
      role="switch"
      aria-checked={on}
      className="flex w-full items-center justify-between gap-4 rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 text-left transition hover:bg-white/[0.07]"
    >
      <span>
        <span className="block text-base font-black text-white">{label}</span>
        <span className="mt-0.5 block text-sm font-medium text-white/50">{hint}</span>
      </span>
      <span className={`relative h-7 w-12 shrink-0 rounded-full transition ${on ? "bg-accent-autism" : "bg-white/15"}`}>
        <span className={`absolute top-1 size-5 rounded-full bg-white transition-all ${on ? "left-6" : "left-1"}`} />
      </span>
    </button>
  );
}

/** Renders text, optionally flagging known idioms/metaphors. When `decode` is on, each
 *  matched phrase becomes a tappable chip showing its plain literal meaning. */
function DecodedText({ text, decode }: { text: string; decode: boolean }) {
  const [open, setOpen] = useState<string | null>(null);
  if (!decode || !text) return <>{text}</>;

  // Build a single regex of all idiom phrases (longest first so multi-word phrases win).
  const sorted = [...lectureIdioms].sort((a, b) => b.phrase.length - a.phrase.length);
  const pattern = new RegExp(`(${sorted.map((i) => escapeRegExp(i.phrase)).join("|")})`, "gi");
  const parts = text.split(pattern);

  return (
    <>
      {parts.map((part, i) => {
        const match = sorted.find((idiom) => idiom.phrase.toLowerCase() === part.toLowerCase());
        if (!match) return <span key={i}>{part}</span>;
        const isOpen = open === `${i}`;
        return (
          <span key={i} className="relative inline-block">
            <button
              onClick={(e) => { e.stopPropagation(); setOpen(isOpen ? null : `${i}`); }}
              className="rounded bg-accent-autism/20 px-1 font-black text-accent-autism underline decoration-accent-autism/50 decoration-dotted underline-offset-2"
            >
              {part}
            </button>
            {isOpen && (
              <span className="absolute bottom-full left-1/2 z-50 mb-2 w-56 -translate-x-1/2 rounded-xl border border-accent-autism/30 bg-slate-900 px-3 py-2 text-left text-xs font-semibold leading-snug text-white shadow-2xl">
                <span className="block text-[10px] font-black uppercase tracking-wide text-accent-autism">This means</span>
                {match.literal}
              </span>
            )}
          </span>
        );
      })}
    </>
  );
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Now / Next / Later strip + predictable progress (steps left, time estimates) so the
 *  student always knows what's happening, what's coming, and how long until the end. */
function ScheduleStrip({
  schedule,
  stepsLeft,
  thisStepSeconds,
  secondsLeft,
}: {
  schedule: { now: string; next: string; later: string };
  stepsLeft: number;
  thisStepSeconds: number;
  secondsLeft: number;
}) {
  const cells: { tag: string; label: string; active?: boolean }[] = [
    { tag: "Now", label: schedule.now, active: true },
    { tag: "Next", label: schedule.next },
    { tag: "Later", label: schedule.later },
  ];
  return (
    <div className="rounded-[1.6rem] border border-white/10 bg-slate-950/60 p-2 backdrop-blur-xl">
      <div className="grid grid-cols-3 gap-2">
        {cells.map((c, i) => (
          <div
            key={c.tag}
            className={`flex items-center gap-3 rounded-2xl px-4 py-2.5 transition ${
              c.active ? "border border-accent-autism/50 bg-accent-autism/12" : "border border-white/8 bg-white/[0.02]"
            }`}
          >
            <span className={`text-[10px] font-black uppercase tracking-wider ${c.active ? "text-accent-autism" : "text-white/35"}`}>{c.tag}</span>
            <span className={`truncate text-sm font-bold ${c.active ? "text-white" : "text-white/55"}`}>{c.label || "—"}</span>
            {i < cells.length - 1 && <span className="ml-auto text-white/20">→</span>}
          </div>
        ))}
      </div>
      {/* Predictable progress */}
      <div className="mt-2 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 px-2 text-xs font-bold text-white/45">
        <span>This step: about {formatSeconds(thisStepSeconds)}</span>
        <span className="text-white/20">·</span>
        <span>{stepsLeft > 0 ? `${stepsLeft} step${stepsLeft === 1 ? "" : "s"} left` : "Last step"}</span>
        <span className="text-white/20">·</span>
        <span>{secondsLeft > 0 ? `about ${formatSeconds(secondsLeft)} to the end` : "almost done"}</span>
      </div>
    </div>
  );
}

function formatSeconds(s: number): string {
  if (s < 60) return `${s} seconds`;
  const m = Math.round(s / 60);
  return `${m} minute${m === 1 ? "" : "s"}`;
}

function ControlButton({ label, icon, active, onClick }: { label: string; icon: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={`flex items-center gap-2.5 rounded-full px-6 py-3 text-base font-black transition ${
        active
          ? "bg-gradient-to-r from-accent-autism-bright to-accent-autism text-slate-950"
          : "border border-white/15 bg-white/5 text-white/85 hover:bg-white/10"
      }`}
    >
      <span aria-hidden className="text-lg">{icon}</span>
      {label}
    </button>
  );
}

/** The panel that opens when a control button is tapped. "Explain Simply" performs the
 *  spec's core animation: the teacher's vague phrasing visibly rewrites into a literal,
 *  numbered checklist. */
function ControlPanel({
  panel,
  beat,
  content,
  onClose,
}: {
  panel: "explain" | "picture" | "break";
  beat: Beat;
  content: import("@/lib/autismLectureContent").AutismBeatContent;
  onClose: () => void;
}) {
  return (
    <div className="beat-fade-in absolute inset-0 z-50 grid place-items-center bg-slate-950/88 p-6 backdrop-blur-md lg:p-10">
      <div className="w-full max-w-2xl">
        {panel === "explain" && <ExplainSimply beat={beat} content={content} />}
        {panel === "picture" && (
          <div className="rounded-3xl border border-white/10 bg-slate-900/70 p-7 text-center">
            <p className="text-xs font-black uppercase tracking-[0.2em] text-accent-autism">Show Picture</p>
            <p className="mt-4 text-2xl font-black leading-snug text-white">Here is the picture for this step.</p>
            <div className="mt-6 overflow-hidden rounded-2xl border border-white/10">
              <Board key={`pic-${beat.id}`} beat={beat} sentenceCue={{ index: 99, total: 99, text: "" }} />
            </div>
          </div>
        )}
        {panel === "break" && (
          <div className="rounded-3xl border border-white/10 bg-slate-900/70 p-10 text-center">
            <p className="text-xs font-black uppercase tracking-[0.2em] text-accent-autism">Need a break</p>
            <p className="mt-5 text-3xl font-black leading-tight text-white">Take all the time you need.</p>
            <p className="mt-4 text-lg font-semibold text-white/55">The lecture is paused and waiting. Nothing will change until you come back.</p>
          </div>
        )}
        <button
          onClick={onClose}
          className="mx-auto mt-7 block rounded-full bg-gradient-to-r from-accent-autism-bright to-accent-autism px-8 py-3 text-base font-black text-slate-950 shadow-[0_0_32px_var(--accent-autism-glow)]"
        >
          {panel === "break" ? "I'm ready — continue ▶" : "Got it — continue ▶"}
        </button>
      </div>
    </div>
  );
}

/** The vague instruction visibly rewrites into a literal numbered checklist. */
function ExplainSimply({ beat, content }: { beat: Beat; content: import("@/lib/autismLectureContent").AutismBeatContent }) {
  const [rewritten, setRewritten] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setRewritten(true), 900);
    return () => clearTimeout(t);
  }, []);

  const original = beat.checkpoint?.prompt ?? beat.title;
  const steps = content.literalSteps;

  return (
    <div className="rounded-3xl border border-white/10 bg-slate-900/70 p-7">
      <p className="text-xs font-black uppercase tracking-[0.2em] text-accent-autism">Explain simply</p>

      {/* The original (possibly vague) instruction, as a speech bubble */}
      <div className={`mt-4 rounded-2xl rounded-bl-sm border border-white/10 bg-white/[0.06] px-5 py-4 transition-all duration-500 ${rewritten ? "scale-95 opacity-40" : "scale-100 opacity-100"}`}>
        <p className="text-[10px] font-black uppercase tracking-wide text-white/40">The teacher said</p>
        <p className="mt-1 text-lg font-bold text-white/90">&ldquo;{original}&rdquo;</p>
      </div>

      {/* The literal rewrite */}
      <div className={`transition-all duration-500 ${rewritten ? "mt-5 max-h-[420px] opacity-100" : "mt-0 max-h-0 overflow-hidden opacity-0"}`}>
        <p className="text-[10px] font-black uppercase tracking-wide text-accent-autism">This means, step by step</p>
        {steps && steps.length > 0 ? (
          <ol className="mt-3 space-y-2.5">
            {steps.map((step, i) => (
              <li key={i} className="flex items-start gap-3 rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3">
                <span className="grid size-6 shrink-0 place-items-center rounded-full bg-gradient-to-br from-accent-autism-bright to-accent-autism text-xs font-black text-slate-950">{i + 1}</span>
                <span className="text-base font-bold leading-snug text-white/85">{step}</span>
              </li>
            ))}
          </ol>
        ) : (
          <p className="mt-3 rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3 text-base font-medium leading-relaxed text-white/85">
            {content.explainSimply}
          </p>
        )}
      </div>
    </div>
  );
}

/** Short schedule label for a beat index, for the Now / Next / Later strip. */
function scheduleLabelFor(beats: Beat[], i: number): string {
  if (i < 0 || i >= beats.length) return "";
  const b = beats[i];
  return (autismBeatContent[b.id] ?? DEFAULT_AUTISM_BEAT).scheduleLabel;
}

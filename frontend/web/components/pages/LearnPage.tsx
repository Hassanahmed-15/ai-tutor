"use client";

import React, { useEffect, useRef, useState } from "react";
import { HudCorners, HudEyebrow, type PageName } from "@/components/hud/HudKit";
import { LessonPlayer } from "@/components/LessonPlayer";
import { BlindLessonPlayer } from "@/components/BlindLessonPlayer";
import { AdhdLessonPlayer } from "@/components/AdhdLessonPlayer";
import { DyslexiaLessonPlayer } from "@/components/DyslexiaLessonPlayer";
import { TRACKS, type TrackMeta } from "@/components/hud/tracks";
import { getSpeechRecognition, type SpeechRecognitionLike } from "@/lib/speech";
import type { Beat } from "@/lib/lessonContent";

/**
 * The "teach me anything" entry. After the user picks a mode, this asks what they want to
 * learn, generates a full demo-shaped lecture for that topic (/api/generate-lecture), then
 * mounts the same LessonPlayer used by the curated demo. Hud-styled chat-style intro.
 */
const SUGGESTIONS = ["How vaccines work", "Why the sky is blue", "How a black hole forms", "Supply and demand", "How memory works"];

type ModeId = TrackMeta["id"];

export function LearnPage({ go, onExit }: { go: (p: PageName) => void; onExit: () => void }) {
  const [topic, setTopic] = useState("");
  const [input, setInput] = useState("");
  const [mode, setMode] = useState<ModeId>("none");
  const [modeLocked, setModeLocked] = useState(false);
  const [phase, setPhase] = useState<"ask" | "building" | "teaching" | "error">("ask");
  const [beats, setBeats] = useState<Beat[]>([]);
  const [builtTopic, setBuiltTopic] = useState("");
  const [costUsd, setCostUsd] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const selectedMode = TRACKS.find((m) => m.id === mode) ?? TRACKS[0];

  async function build(t: string) {
    const trimmed = t.trim();
    if (!trimmed) return;
    setPhase("building");
    setError(null);
    try {
      const endpoint =
        process.env.NODE_ENV === "development" && process.env.NEXT_PUBLIC_USE_FIXTURE === "1"
          ? "/api/generate-lecture-debug"
          : "/api/generate-lecture";
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic: trimmed, mood: `${selectedMode.name} learning mode: ${selectedMode.detail}` }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !Array.isArray(data.beats)) {
        throw new Error(data.error || "Couldn't build that lecture. Try a different topic.");
      }
      setBeats(data.beats);
      setBuiltTopic(data.topic ?? trimmed);
      if (typeof data.costUsd === "number") setCostUsd(data.costUsd);
      setPhase("teaching");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Generation failed.");
      setPhase("error");
    }
  }

  if (phase === "teaching") {
    let player: React.ReactNode;
    switch (selectedMode.page) {
      case "blind-demo":
        player = <BlindLessonPlayer beats={beats} title={builtTopic} onExit={onExit} autoStart />;
        break;
      case "adhd-demo":
        player = <AdhdLessonPlayer beats={beats} title={builtTopic} onExit={onExit} />;
        break;
      case "dyslexia-demo":
        player = <DyslexiaLessonPlayer beats={beats} title={builtTopic} onExit={onExit} />;
        break;
      case "deaf-demo":
        player = <LessonPlayer beats={beats} title={builtTopic} onExit={onExit} mode="deaf" />;
        break;
      case "demo":
      default:
        player = <LessonPlayer beats={beats} title={builtTopic} onExit={onExit} />;
    }
    return (
      <div className="relative">
        {player}
        {costUsd !== null && (
          <div className="pointer-events-none absolute left-0 right-0 top-0 z-[60] flex justify-center pt-2">
            <div className="hud-eyebrow flex items-center gap-1.5 rounded-full border border-[var(--hud-line-strong)] bg-black/70 px-3.5 py-1.5 text-[0.65rem] backdrop-blur-md">
              <span className="text-[var(--hud-text-faint)] normal-case tracking-normal font-semibold">This lecture cost</span>
              <span className="text-[var(--hud-cyan)]">${costUsd.toFixed(4)}</span>
            </div>
          </div>
        )}
      </div>
    );
  }

  function submitTopic(value = input) {
    const trimmed = value.trim();
    if (!trimmed) return;
    setTopic(trimmed);
    setInput("");
    setError(null);
    setPhase("ask");
  }

  return (
    <main className="hud-canvas hud-grain relative min-h-screen overflow-x-hidden text-[var(--hud-text)]">
      {phase === "building" ? (
        <BuildingState topic={topic} mode={selectedMode.name} />
      ) : !modeLocked ? (
        <MoodSelect
          mode={mode}
          onMode={setMode}
          onContinue={() => setModeLocked(true)}
          go={go}
        />
      ) : selectedMode.page === "blind-demo" ? (
        <BlindTopicCapture
          mode={selectedMode}
          topic={topic}
          input={input}
          error={error}
          onInput={setInput}
          onChangeMode={() => setModeLocked(false)}
          onTopic={submitTopic}
          onBuild={build}
        />
      ) : (
        <section className="relative z-10 min-h-screen w-full overflow-y-auto bg-gradient-to-b from-[#05040c] via-[#0a0810] to-[#05040c] p-6 lg:p-10">
          {/* Background glow */}
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_20%,rgba(99,102,241,0.15),transparent_50%)]" />

          {/* Top nav bar */}
          <div className="relative z-20 mx-auto mb-16 flex max-w-7xl items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="grid size-10 place-items-center rounded-xl text-xl font-black" style={{ background: selectedMode.glow, color: selectedMode.accent }}>
                {selectedMode.glyph}
              </span>
              <div>
                <HudEyebrow>Step 2</HudEyebrow>
                <p className="font-display text-lg font-bold">{selectedMode.name} mode</p>
              </div>
            </div>
            <button onClick={() => setModeLocked(false)} className="hud-btn-ghost rounded-full px-5 py-2 text-sm font-bold">
              Change mode
            </button>
          </div>

          <div className="relative z-20 mx-auto max-w-7xl">
            <div className="grid gap-12 lg:grid-cols-[1.2fr_1fr]">
              {/* Main content */}
              <div className="flex flex-col justify-start">
                <div className="mb-12">
                  <h1 className="font-display text-6xl font-light leading-tight sm:text-7xl">
                    What should we <span className="hud-text-glow italic">teach?</span>
                  </h1>
                  <p className="mt-6 max-w-lg text-lg leading-relaxed text-[var(--hud-text-dim)]">
                    Give Aria one topic. Aria designs a full lesson with voice, visuals, checkpoints, and recap — all customized for {selectedMode.name} mode.
                  </p>
                </div>

                {/* Input section */}
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (topic && !input.trim()) build(topic);
                    else submitTopic();
                  }}
                  className="mb-12"
                >
                  <div className="flex flex-col gap-4 sm:flex-row sm:gap-3">
                    <input
                      value={input}
                      onChange={(e) => setInput(e.target.value)}
                      placeholder="e.g. how photosynthesis works"
                      autoFocus
                      className="min-w-0 flex-1 rounded-full border border-[var(--hud-line)] bg-white/[0.05] px-7 py-4 text-xl font-semibold text-[var(--hud-text)] placeholder:text-[var(--hud-text-faint)] backdrop-blur-sm transition focus:border-[var(--hud-cyan)]/60 focus:outline-none focus:ring-0"
                    />
                    <button
                      type="submit"
                      disabled={!(topic || input).trim()}
                      className="shrink-0 rounded-full bg-gradient-to-r from-indigo-500 to-fuchsia-500 px-8 py-4 text-base font-black shadow-[0_0_40px_rgba(129,140,248,0.3)] transition hover:shadow-[0_0_60px_rgba(129,140,248,0.5)] disabled:opacity-40"
                    >
                      {topic && !input.trim() ? "Build lesson" : "Set topic"}
                    </button>
                  </div>
                </form>

                {/* Popular suggestions */}
                <div>
                  <p className="mb-4 text-xs font-black uppercase tracking-[0.16em] text-[var(--hud-text-faint)]">Popular topics to try</p>
                  <div className="grid gap-3 sm:grid-cols-2">
                    {SUGGESTIONS.map((s) => (
                      <button
                        key={s}
                        onClick={() => submitTopic(s)}
                        className="rounded-2xl border border-[var(--hud-line)] bg-white/[0.03] px-5 py-4 text-left text-base font-semibold text-[var(--hud-text-dim)] transition hover:border-[var(--hud-cyan)]/60 hover:bg-white/[0.08] hover:text-[var(--hud-text)]"
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Error message */}
                {phase === "error" && error && (
                  <div className="mt-8 rounded-3xl border border-rose-400/40 bg-rose-500/[0.08] px-6 py-5 text-base font-semibold text-rose-200">
                    ⚠️ {error}
                  </div>
                )}
              </div>

              {/* Right sidebar preview */}
              <div className="relative rounded-[2.5rem] border border-[var(--hud-line)]/50 bg-gradient-to-br from-white/[0.04] to-white/[0.02] p-8 backdrop-blur-xl lg:h-max lg:sticky lg:top-10">
                <HudCorners accent={selectedMode.accent} />
                <div className="relative z-10 space-y-8">
                  <div>
                    <HudEyebrow color={selectedMode.accent}>Build preview</HudEyebrow>
                  </div>

                  {/* Mode display */}
                  <div className="rounded-2xl border border-[var(--hud-line)] bg-black/30 p-5">
                    <p className="text-xs font-black uppercase tracking-[0.14em] text-[var(--hud-text-faint)]">Mode</p>
                    <p className="mt-3 font-display text-2xl">{selectedMode.name}</p>
                    <p className="mt-2 text-sm font-medium text-[var(--hud-text-dim)]">{selectedMode.detail}</p>
                  </div>

                  {/* Topic display */}
                  <div className="rounded-2xl border border-[var(--hud-line)] bg-black/30 p-5">
                    <p className="text-xs font-black uppercase tracking-[0.14em] text-[var(--hud-text-faint)]">Topic</p>
                    <p className="mt-3 text-2xl font-black text-[var(--hud-text)]">{topic || "Not set yet"}</p>
                  </div>

                  {/* What you get */}
                  <div className="space-y-3 pt-4">
                    <p className="text-xs font-black uppercase tracking-[0.14em] text-[var(--hud-text-faint)]">Included</p>
                    <div className="space-y-2 text-base text-[var(--hud-text-dim)]">
                      <p className="flex items-center gap-3"><span className="text-lg">✓</span> Teacher script</p>
                      <p className="flex items-center gap-3"><span className="text-lg">✓</span> Hand-drawn visuals</p>
                      <p className="flex items-center gap-3"><span className="text-lg">✓</span> Interactive checkpoints</p>
                      <p className="flex items-center gap-3"><span className="text-lg">✓</span> Full recap</p>
                    </div>
                  </div>

                  {/* Build button */}
                  <button
                    onClick={() => build(topic)}
                    disabled={!topic.trim()}
                    className="hud-btn-primary w-full rounded-full py-4 text-base font-black disabled:opacity-40"
                  >
                    Build lesson →
                  </button>
                </div>
              </div>
            </div>
          </div>
        </section>
      )}
    </main>
  );
}

function BlindTopicCapture({
  mode,
  topic,
  input,
  error,
  onInput,
  onChangeMode,
  onTopic,
  onBuild,
}: {
  mode: TrackMeta;
  topic: string;
  input: string;
  error: string | null;
  onInput: (value: string) => void;
  onChangeMode: () => void;
  onTopic: (value: string) => void;
  onBuild: (topic: string) => void;
}) {
  const [micOn, setMicOn] = useState(false);
  const [micSupported, setMicSupported] = useState<boolean>(() => getSpeechRecognition() !== null);
  const [micBlocked, setMicBlocked] = useState(false);
  const [heard, setHeard] = useState("");
  const [status, setStatus] = useState('Microphone starting. Say "Nova, teach me supply and demand."');
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const wantedRef = useRef(false);
  const lastTopicRef = useRef("");

  function stopMic() {
    wantedRef.current = false;
    setMicOn(false);
    const recognition = recognitionRef.current;
    recognitionRef.current = null;
    if (recognition) {
      recognition.onend = null;
      try { recognition.stop(); } catch { /* already stopped */ }
    }
  }

  function handleSpokenTopic(raw: string) {
    const parsed = parseBlindTopicCommand(raw);
    if (!parsed) {
      setStatus('Ignored. Start with "Nova", for example: "Nova, teach me photosynthesis."');
      return;
    }
    if (parsed.action === "build") {
      const selected = topic || lastTopicRef.current;
      if (!selected.trim()) {
        setStatus('I need a topic first. Say "Nova, teach me..." followed by the topic.');
        return;
      }
      setStatus(`Building ${selected}.`);
      stopMic();
      onBuild(selected);
      return;
    }
    lastTopicRef.current = parsed.topic;
    onTopic(parsed.topic);
    setStatus(`Building ${parsed.topic}.`);
    stopMic();
    onBuild(parsed.topic);
  }

  function startMic() {
    if (wantedRef.current) return;
    const recognition = getSpeechRecognition();
    if (!recognition) {
      setMicSupported(false);
      setMicBlocked(false);
      setStatus("Voice input is not supported in this browser.");
      return;
    }
    setMicBlocked(false);
    wantedRef.current = true;
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-US";
    recognition.onresult = (ev) => {
      let interim = "";
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const result = ev.results[i];
        const transcript = result[0]?.transcript ?? "";
        if (result.isFinal) {
          setHeard(transcript);
          handleSpokenTopic(transcript);
        } else {
          interim += transcript;
        }
      }
      if (interim) setHeard(interim);
    };
    recognition.onerror = (ev) => {
      if (ev.error === "not-allowed" || ev.error === "service-not-allowed") {
        wantedRef.current = false;
        setMicOn(false);
        setMicBlocked(true);
        setStatus("Microphone permission is blocked. Use the mic button and allow access.");
        return;
      }
      setStatus('Still listening. Say "Nova, teach me..." and your topic.');
    };
    recognition.onend = () => {
      if (!wantedRef.current) return;
      try { recognition.start(); } catch { /* already starting */ }
    };
    recognitionRef.current = recognition;
    try {
      recognition.start();
      setMicOn(true);
      setStatus('Listening now. Say "Nova, teach me..." and your topic.');
    } catch {
      setStatus("Tap Start microphone, then speak your topic.");
    }
  }

  useEffect(() => {
    const t = window.setTimeout(startMic, 250);
    return () => {
      window.clearTimeout(t);
      stopMic();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <section className="relative z-10 min-h-screen w-full overflow-y-auto bg-gradient-to-b from-[#05040c] via-[#0a0810] to-[#05040c] p-6 lg:p-10">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_20%,rgba(129,140,248,0.2),transparent_50%)]" />

      <div className="relative z-20 mx-auto mb-10 flex max-w-7xl items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="grid size-10 place-items-center rounded-xl text-xl font-black" style={{ background: mode.glow, color: mode.accent }}>
            {mode.glyph}
          </span>
          <div>
            <HudEyebrow>Step 2</HudEyebrow>
            <p className="font-display text-lg font-bold">Blind voice setup</p>
          </div>
        </div>
        <button onClick={onChangeMode} className="hud-btn-ghost rounded-full px-5 py-2 text-sm font-bold">
          Change mode
        </button>
      </div>

      <div className="relative z-20 mx-auto grid max-w-7xl gap-10 lg:grid-cols-[1fr_0.9fr]">
        <div className="flex min-h-[620px] flex-col justify-center">
          <HudEyebrow color={mode.accent}>Voice-first topic capture</HudEyebrow>
          <h1 className="mt-5 max-w-4xl font-display text-5xl font-light leading-tight sm:text-7xl">
            Tell Nova what to <span className="hud-text-glow italic">teach.</span>
          </h1>
          <p className="mt-6 max-w-2xl text-xl leading-8 text-[var(--hud-text-dim)]">
            The microphone is the main input here. Start with Nova&apos;s name so background speech is ignored.
          </p>

          <div className="mt-10 rounded-[2rem] border border-accent-blind/30 bg-accent-blind/10 p-6 shadow-[0_0_60px_rgba(129,140,248,0.12)]">
            <div className="flex flex-col gap-6 sm:flex-row sm:items-center">
              <button
                onClick={micOn ? stopMic : startMic}
                className={`grid size-24 shrink-0 place-items-center rounded-full border text-4xl transition ${
                  micOn
                    ? "border-emerald-300/50 bg-emerald-400/20 text-emerald-100 shadow-[0_0_35px_rgba(52,211,153,0.25)]"
                    : "border-white/15 bg-white/10 text-white/70"
                }`}
                aria-label={micOn ? "Turn microphone off" : "Start microphone"}
              >
                {micOn ? "🎙" : "♪"}
              </button>
              <div className="min-w-0">
                <p className="text-sm font-black uppercase tracking-[0.16em] text-accent-blind/80">
                  {micOn ? "Listening" : micBlocked ? "Permission needed" : micSupported ? "Microphone ready" : "Microphone unavailable"}
                </p>
                <p aria-live="polite" className="mt-2 text-2xl font-bold leading-snug text-white">
                  {status}
                </p>
                {heard && (
                  <p className="mt-3 text-base font-semibold text-white/50">
                    Heard: <span className="text-white/75">{heard}</span>
                  </p>
                )}
              </div>
            </div>
          </div>

          <div className="mt-8 grid gap-3 text-base font-semibold text-[var(--hud-text-dim)] sm:grid-cols-2">
            <p className="rounded-2xl border border-white/10 bg-white/[0.04] px-5 py-4">Say: <span className="text-white">Nova, teach me photosynthesis</span></p>
            <p className="rounded-2xl border border-white/10 bg-white/[0.04] px-5 py-4">Nova starts building as soon as she hears the topic.</p>
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              const selected = input.trim() || topic;
              if (!selected) return;
              onTopic(selected);
              onBuild(selected);
            }}
            className="mt-8"
          >
            <p className="mb-3 text-xs font-black uppercase tracking-[0.16em] text-[var(--hud-text-faint)]">Fallback typed topic</p>
            <div className="flex flex-col gap-4 sm:flex-row sm:gap-3">
              <input
                value={input}
                onChange={(e) => onInput(e.target.value)}
                placeholder="Only if voice is unavailable"
                className="min-w-0 flex-1 rounded-full border border-[var(--hud-line)] bg-white/[0.05] px-7 py-4 text-xl font-semibold text-[var(--hud-text)] placeholder:text-[var(--hud-text-faint)] backdrop-blur-sm transition focus:border-accent-blind focus:outline-none focus:ring-0"
              />
              <button
                type="submit"
                disabled={!(topic || input).trim()}
                className="shrink-0 rounded-full bg-gradient-to-r from-indigo-500 to-fuchsia-500 px-8 py-4 text-base font-black shadow-[0_0_40px_rgba(129,140,248,0.3)] transition hover:shadow-[0_0_60px_rgba(129,140,248,0.5)] disabled:opacity-40"
              >
                Build fallback
              </button>
            </div>
          </form>

          {error && (
            <div className="mt-8 rounded-3xl border border-rose-400/40 bg-rose-500/[0.08] px-6 py-5 text-base font-semibold text-rose-200">
              {error}
            </div>
          )}
        </div>

        <div className="relative rounded-[2.5rem] border border-[var(--hud-line)]/50 bg-gradient-to-br from-white/[0.04] to-white/[0.02] p-8 backdrop-blur-xl lg:h-max lg:sticky lg:top-10">
          <HudCorners accent={mode.accent} />
          <div className="relative z-10 space-y-8">
            <div>
              <HudEyebrow color={mode.accent}>Audio build preview</HudEyebrow>
              <p className="mt-3 text-sm font-semibold leading-6 text-[var(--hud-text-dim)]">
                This step is voice-led. The visual form is only a backup; Nova waits for her name, then builds when she hears a topic.
              </p>
            </div>

            <div className="rounded-2xl border border-[var(--hud-line)] bg-black/30 p-5">
              <p className="text-xs font-black uppercase tracking-[0.14em] text-[var(--hud-text-faint)]">Topic</p>
              <p className="mt-3 text-2xl font-black text-[var(--hud-text)]">{topic || "Waiting for voice"}</p>
            </div>

            <div className="space-y-3 pt-4">
              <p className="text-xs font-black uppercase tracking-[0.14em] text-[var(--hud-text-faint)]">Blind lesson includes</p>
              <div className="space-y-2 text-base text-[var(--hud-text-dim)]">
                <p className="flex items-center gap-3"><span className="text-lg">✓</span> Spoken visual structure</p>
                <p className="flex items-center gap-3"><span className="text-lg">✓</span> Sonic cues</p>
                <p className="flex items-center gap-3"><span className="text-lg">✓</span> Voice commands</p>
                <p className="flex items-center gap-3"><span className="text-lg">✓</span> Spoken checkpoints</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function parseBlindTopicCommand(raw: string): { action: "topic"; topic: string } | { action: "build" } | null {
  const normalized = raw
    .toLowerCase()
    .replace(/[“”]/g, '"')
    .replace(/[’]/g, "'")
    .replace(/[^a-z0-9'\s]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const wakeMatch = /(^|\s)(hey nova|okay nova|ok nova|nova)(?=$|\s)/i.exec(normalized);
  if (!wakeMatch) return null;
  let command = normalized.slice(wakeMatch.index + wakeMatch[0].length).trim();
  command = command.replace(/^(please\s+)?/, "").trim();
  if (!command) return null;
  if (/^(build|start|begin|make|create)(\s+(the\s+)?lesson)?$/.test(command)) return { action: "build" };
  const topic = cleanupSpokenTopic(command)
    .replace(/\s+(please)$/i, "")
    .trim();
  return topic ? { action: "topic", topic } : null;
}

function cleanupSpokenTopic(command: string): string {
  return command
    .replace(/^(can you\s+)?(please\s+)?(teach me about|teach me|teach|i want you to teach me|i want to learn about|i want to learn|help me learn about|help me learn|make a lesson about|create a lesson about|lesson on|about|topic is|set topic to)\s+/i, "")
    .replace(/^(can you\s+)?(please\s+)?(explain me what is|explain me what are|explain what is|explain what are|explain me|explain|tell me what is|tell me about|what is|what are|who is|who are)\s+/i, "")
    .replace(/^(can you\s+)?(please\s+)?(help me understand|help me with|i need to understand|i want to understand)\s+/i, "")
    .replace(/\s+(please)$/i, "")
    .trim();
}

function MoodSelect({
  mode,
  onMode,
  onContinue,
  go,
}: {
  mode: ModeId;
  onMode: (mode: ModeId) => void;
  onContinue: () => void;
  go: (p: PageName) => void;
}) {
  return (
    <section className="relative z-10 min-h-screen w-full overflow-y-auto bg-gradient-to-b from-[#05040c] via-[#0a0810] to-[#05040c] px-4 py-6 sm:px-6 lg:px-8 lg:py-7">
      {/* Background glow */}
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_20%,rgba(99,102,241,0.15),transparent_50%)]" />

      <div className="relative z-10 mx-auto max-w-7xl">
        {/* Header */}
        <div className="mb-8 text-center lg:mb-10">
          <HudEyebrow>Step 1</HudEyebrow>
          <h1 className="mx-auto mt-4 max-w-5xl font-display text-4xl font-light leading-tight sm:text-5xl xl:text-6xl">
            Choose the <span className="hud-text-glow italic">learning mode</span>.
          </h1>
          <p className="mx-auto mt-4 max-w-2xl text-base leading-relaxed text-[var(--hud-text-dim)]">
            Every brain learns differently. Pick your style — we’ll customize the lesson to match how you learn best.
          </p>
        </div>

        {/* Mode grid */}
        <div className="mb-8 grid auto-rows-fr gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:gap-5">
          {TRACKS.map((m) => {
            const active = mode === m.id;
            return (
              <button
                key={m.id}
                onClick={() => onMode(m.id)}
                className={`group relative flex min-h-[236px] flex-col overflow-hidden rounded-3xl border p-5 text-left transition-all duration-300 lg:min-h-[250px] lg:p-6 ${
                  active
                    ? "border-transparent bg-white/[0.06] shadow-[0_0_70px_rgba(94,234,212,0.12)] -translate-y-1"
                    : "border-[var(--hud-line)] bg-white/[0.025] hover:-translate-y-1 hover:border-white/20 hover:bg-white/[0.05]"
                }`}
              >
                {/* Accent top bar */}
                <div
                  className={`pointer-events-none absolute inset-x-0 top-0 h-1 transition-opacity duration-300 ${active ? "opacity-100" : "opacity-30 group-hover:opacity-70"}`}
                  style={{ background: `linear-gradient(90deg, transparent, ${m.accent}, transparent)` }}
                />
                {/* Selection ring */}
                {active && (
                  <div className="pointer-events-none absolute inset-0 rounded-[2rem] ring-2 ring-inset" style={{ boxShadow: `inset 0 0 0 2px ${m.accent}` }} />
                )}
                {/* Ambient glow behind icon */}
                <div className="pointer-events-none absolute -left-10 -top-10 size-40 rounded-full opacity-0 blur-3xl transition-opacity duration-300 group-hover:opacity-40" style={{ background: m.accent }} />

                <div className="relative z-10 flex h-full flex-col">
                  {/* Icon */}
                  <div className="grid size-12 place-items-center rounded-2xl text-2xl font-black shadow-lg transition-transform duration-300 group-hover:scale-105" style={{ background: m.glow, color: m.accent }}>
                    {m.glyph}
                  </div>

                  {/* Title + tagline */}
                  <div className="mt-5">
                    <h3 className="font-display text-2xl font-semibold tracking-tight">{m.name}</h3>
                    <p className="mt-2 text-sm font-bold" style={{ color: m.accent }}>
                      {m.tagline}
                    </p>
                  </div>

                  {/* Description */}
                  <p className="mt-3 text-sm leading-6 text-[var(--hud-text-dim)]">{m.description}</p>

                  {/* Footer: selected state pinned to bottom */}
                  <div className="mt-auto pt-5">
                    {active ? (
                      <span className="inline-flex items-center gap-2 rounded-full px-4 py-2 text-[11px] font-black uppercase tracking-[0.12em]" style={{ background: m.glow, color: m.accent }}>
                        <span>✓</span> Selected
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 text-sm font-bold text-[var(--hud-text-faint)] transition-colors group-hover:text-[var(--hud-text-dim)]">
                        Select this mode <span className="transition-transform group-hover:translate-x-1">→</span>
                      </span>
                    )}
                  </div>
                </div>
              </button>
            );
          })}
        </div>

        {/* Action buttons */}
        <div className="flex flex-col-reverse gap-4 sm:flex-row sm:justify-center">
          <button
            onClick={() => go("tracks")}
            className="hud-btn-ghost rounded-full px-8 py-4 text-base font-bold transition"
          >
            Back
          </button>
          <button
            onClick={onContinue}
            className="rounded-full bg-gradient-to-r from-indigo-500 to-fuchsia-500 px-10 py-4 text-base font-black shadow-[0_0_40px_rgba(129,140,248,0.3)] transition hover:shadow-[0_0_60px_rgba(129,140,248,0.5)]"
          >
            Continue to chat →
          </button>
        </div>
      </div>
    </section>
  );
}

/** The "building your lecture" state — a calm, luxurious wait. */
function BuildingState({ topic, mode }: { topic: string; mode: string }) {
  return (
    <div className="relative z-10 grid h-screen place-items-center p-6 text-center">
      <HudCorners />
      <div className="flex max-w-xl flex-col items-center">
      <div className="relative grid size-28 place-items-center">
        <div className="hud-halo absolute inset-0 rounded-full border border-[var(--hud-cyan)]/40" />
        <div className="pointer-events-none absolute inset-0 rounded-full opacity-40 blur-2xl" style={{ background: "radial-gradient(circle, rgba(94,234,212,0.6), transparent 70%)" }} />
        <span className="relative font-display text-4xl hud-text-glow">✦</span>
      </div>
      <HudEyebrow>Composing your lecture</HudEyebrow>
      <h2 className="mt-4 max-w-lg font-display text-3xl font-light leading-tight">
        Designing a live lesson on <span className="hud-text-glow italic">{topic}</span>…
      </h2>
      <p className="mt-5 max-w-md text-sm leading-7 text-[var(--hud-text-dim)]">
        Mode: {mode}. Designing the script, choosing the analogy, building related visuals,
        and setting the animation beats. This takes a moment — good teaching is worth the wait.
      </p>
      <div className="mt-8 h-1 w-56 overflow-hidden rounded-full bg-white/10">
        <div className="hud-shimmer h-full w-full" />
      </div>
      </div>
    </div>
  );
}

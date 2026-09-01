"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { LiveSketch, type DrawScript } from "@/components/sketch/LiveSketch";
import { ReactAnimationSandbox } from "@/components/sketch/ReactAnimationSandbox";
import { playNarration, unlockAudio, type NarrationHandle } from "@/lib/voice";
import { captureVoice, isSpeechSupported, type VoiceCaptureHandle } from "@/lib/speech";
import { HudPanel, HudEyebrow } from "@/components/hud/HudKit";

/**
 * The shared lesson chat + "Is this clear?" gate. Used by every player so they all behave
 * the same way: after each section the lecture pauses to check understanding, and the
 * student can ask a follow-up question (by typing OR by voice) which Aria answers on a fresh
 * marker-drawn board (/api/explain). The Blind player passes `voiceOnly` so only the mic is
 * shown.
 *
 * The hook owns ALL the chat state and the explain call/narration; it never touches the
 * player's beat loop — it only pauses the player's narration via the `stopVoice` callback.
 */

export interface ChatTurn {
  role: "you" | "aria";
  text: string;
}

export interface LessonChatState {
  chat: ChatTurn[];
  explaining: boolean;
  explainBoard: { script: string; draw?: DrawScript } | null;
  drawProgress: number;
  listening: boolean;
  interim: string;
  voiceSupported: boolean;
  ask: (question: string) => void;
  startVoice: () => void;
  stopVoice: () => void;
  closeExplanation: () => void;
  /** Append a finished conversation turn directly (used by the live voice tutor transcript). */
  appendTurn: (role: "you" | "aria", text: string) => void;
  /** True while either explaining or an explanation board is open — the lecture should hold. */
  busy: boolean;
}

export function useLessonChat(opts: {
  topic: string;
  getBeatContext: () => string;
  /**
   * The whole lesson and the student's document, read at ask time.
   *
   * Functions rather than values because the lecture moves: reading them when the question is asked
   * gives the beat the student is actually on, where a captured value would be whichever beat was
   * playing when the panel first mounted.
   *
   * Optional so every existing caller keeps working — a player that supplies neither asks exactly
   * the question it asked before.
   */
  getLessonContext?: () => string;
  getDocumentContext?: () => string;
  /**
   * Handle for the uploaded document's page images, parked server-side at parse time.
   *
   * A plain string rather than a getter because it does not change while a lecture plays. Empty for
   * a prompted lesson, and empty once the store has expired — the endpoint treats both as "no
   * pictures" and answers from text, so a stale handle costs nothing.
   */
  documentId?: string;
  /** The question the lecture was built to answer, when it was built from one. */
  lessonQuestion?: string;
  /** Pause the player's own narration when a question starts. */
  pausePlayer: () => void;
  /** Called when the explanation closes, so the player can re-open its clarity gate. */
  onExplanationClosed?: () => void;
  /** Surface autoplay-blocked so the player can show its banner. */
  onVoiceBlocked?: () => void;
}): LessonChatState {
  const [chat, setChat] = useState<ChatTurn[]>([]);
  const [explaining, setExplaining] = useState(false);
  const [explainBoard, setExplainBoard] = useState<{ script: string; draw?: DrawScript } | null>(null);
  const [drawProgress, setDrawProgress] = useState(0);
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");
  const cancelRef = useRef<NarrationHandle | null>(null);
  const voiceRef = useRef<VoiceCaptureHandle | null>(null);
  const voiceSupported = isSpeechSupported();

  const stopNarration = useCallback(() => {
    cancelRef.current?.cancel();
    cancelRef.current = null;
  }, []);

  const ask = useCallback(
    async (question: string) => {
      const trimmed = question.trim();
      if (!trimmed || explaining) return;
      unlockAudio();
      opts.pausePlayer();
      stopNarration();
      setChat((c) => [...c, { role: "you", text: trimmed }]);
      setExplaining(true);
      try {
        const res = await fetch("/api/explain", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            topic: opts.topic,
            beatContext: opts.getBeatContext(),
            lessonContext: opts.getLessonContext?.() ?? "",
            documentContext: opts.getDocumentContext?.() ?? "",
            // Lets the endpoint attach the page images themselves; see app/api/explain/route.ts.
            documentId: opts.documentId ?? "",
            lessonQuestion: opts.lessonQuestion ?? "",
            question: trimmed,
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.script) throw new Error(data.error || "Couldn't explain that right now.");
        setChat((c) => [...c, { role: "aria", text: data.script }]);
        setExplainBoard({ script: data.script, draw: data.draw });
        setDrawProgress(0);
        const handle = playNarration(data.script, {
          onStart: () => {},
          onSentenceStart: (si, _s, st) => setDrawProgress(st > 1 ? Math.min(1, (si + 1) / st) : 1),
          onEnd: () => {
            cancelRef.current = null;
            setDrawProgress(1);
          },
          onBlocked: () => opts.onVoiceBlocked?.(),
        });
        cancelRef.current = handle;
      } catch (err) {
        setChat((c) => [...c, { role: "aria", text: err instanceof Error ? err.message : "Something went wrong." }]);
      } finally {
        setExplaining(false);
      }
    },
    [explaining, opts, stopNarration]
  );

  const startVoice = useCallback(() => {
    if (listening) {
      voiceRef.current?.stop();
      return;
    }
    unlockAudio();
    setInterim("");
    setListening(true);
    voiceRef.current = captureVoice({
      onInterim: (t) => setInterim(t),
      onFinal: (text) => {
        setListening(false);
        setInterim("");
        void ask(text);
      },
      onError: () => {
        setListening(false);
        setInterim("");
      },
    });
    if (!voiceRef.current) setListening(false);
  }, [listening, ask]);

  const stopVoiceCapture = useCallback(() => {
    voiceRef.current?.stop();
    setListening(false);
  }, []);

  const closeExplanation = useCallback(() => {
    stopNarration();
    setExplainBoard(null);
    setDrawProgress(0);
    opts.onExplanationClosed?.();
  }, [stopNarration, opts]);

  // Push a completed turn straight into the chat log. The live voice tutor calls this with each
  // finalized transcript line so the conversation shows up in the chat panel, not a separate bar.
  const appendTurn = useCallback((role: "you" | "aria", text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    setChat((c) => {
      // Guard against duplicate final lines the realtime API can emit.
      const last = c[c.length - 1];
      if (last && last.role === role && last.text === trimmed) return c;
      return [...c, { role, text: trimmed }];
    });
  }, []);

  return {
    chat,
    explaining,
    explainBoard,
    drawProgress,
    listening,
    interim,
    voiceSupported,
    ask,
    startVoice,
    stopVoice: stopVoiceCapture,
    closeExplanation,
    appendTurn,
    busy: explaining || explainBoard !== null,
  };
}

/* ───────────────────────── UI pieces ───────────────────────── */

/** The fresh explanation board overlay (marker draws the answer to the question). */
export function ExplainOverlay({
  board,
  progress,
  autoReveal = false,
  onClose,
}: {
  board: { script: string; draw?: DrawScript };
  progress: number;
  autoReveal?: boolean;
  onClose: () => void;
}) {
  const [automaticProgress, setAutomaticProgress] = useState(0);
  const animationOp = board.draw?.ops.find(
    (op): op is Extract<typeof op, { kind: "reactAnimation" }> =>
      op.kind === "reactAnimation" && typeof op.code === "string"
  );

  useEffect(() => {
    if (!autoReveal) return;
    let frame = 0;
    const startedAt = performance.now();
    const duration = Math.max(12_000, Math.min(24_000, board.draw?.durationMs ?? 18_000));
    const tick = (now: number) => {
      const next = Math.min(1, (now - startedAt) / duration);
      setAutomaticProgress(next);
      if (next < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [autoReveal, board]);

  const effectiveProgress = autoReveal ? automaticProgress : progress;

  return (
    <div className="hud-materialize absolute inset-0 z-40 flex flex-col bg-black/95 p-3 backdrop-blur-md lg:p-5">
      <div className="mb-2 flex items-center justify-between">
        <div>
          <HudEyebrow>Blackboard explanation</HudEyebrow>
          <p className="mt-1 text-xs font-semibold text-[var(--hud-text-faint)]">Aria is drawing the answer as a fresh diagram.</p>
        </div>
        <button onClick={onClose} className="hud-btn-ghost rounded-full px-4 py-1.5 text-xs font-bold">
          Got it — back to lecture
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto" aria-live="polite">
        {animationOp?.code ? (
          <ReactAnimationSandbox
            key={board.script.slice(0, 24)}
            code={animationOp.code}
            assetIds={animationOp.assetIds}
            progress={effectiveProgress}
            sentenceProgress={effectiveProgress}
          />
        ) : board.draw ? (
          <LiveSketch key={board.script.slice(0, 24)} script={board.draw} progress={effectiveProgress} />
        ) : (
          <div className="grid h-full place-items-center p-8 text-center">
            <p className="max-w-lg text-lg font-medium text-[var(--hud-text-dim)]">{board.script}</p>
          </div>
        )}
      </div>
    </div>
  );
}

/** The side chat panel. `voiceOnly` (Blind) hides the text input and shows only the mic. */
export function ChatPanel({
  chat,
  explaining,
  listening,
  interim,
  voiceSupported,
  voiceOnly,
  onAsk,
  onVoice,
  liveActive = false,
  liveReady = false,
  liveStatusLabel = "",
  liveMuted = false,
  onLiveMute,
  liveError = null,
  liveAlwaysOn = false,
}: {
  chat: ChatTurn[];
  explaining: boolean;
  listening: boolean;
  interim: string;
  voiceSupported: boolean;
  voiceOnly?: boolean;
  onAsk: (q: string) => void;
  onVoice: () => void;
  /** True while a live full-duplex tutor session is running (the mic toggles the call). */
  liveActive?: boolean;
  /** The realtime session is preconnected but may be privacy-muted while the lecture plays. */
  liveReady?: boolean;
  /** Status text shown while a live session is active (e.g. "Aria speaking…"). */
  liveStatusLabel?: string;
  /** Live-session mic muted state + toggle (shown only while live). */
  liveMuted?: boolean;
  onLiveMute?: () => void;
  /** Live-session error message (mic denied / connection dropped). */
  liveError?: string | null;
  /** Always-on mode (ADHD): the mic stays open; the button toggles mute instead of ending a call. */
  liveAlwaysOn?: boolean;
}) {
  const [question, setQuestion] = useState("");
  const endRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [chat.length, explaining, listening, interim]);

  return (
    <HudPanel className="flex min-h-0 flex-col overflow-hidden !rounded-[1.5rem] [&>div]:flex [&>div]:h-full [&>div]:min-h-0 [&>div]:flex-col">
      <div className="flex items-center gap-2.5 border-b border-[var(--hud-line)] px-5 py-4">
        <span className="grid size-8 shrink-0 place-items-center rounded-full bg-[var(--hud-cyan)]/15 text-sm">💬</span>
        <div>
          <p className="text-sm font-bold text-[var(--hud-text)]">Ask Aria anything</p>
          <p className="text-[11px] leading-tight text-[var(--hud-text-faint)]">
            {voiceOnly ? "Speak — she'll explain aloud." : "Type or speak — she explains on a fresh board."}
          </p>
        </div>
      </div>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
        {chat.length === 0 ? (
          <div className="h-full" aria-hidden="true" />
        ) : (
          chat.map((t, i) => (
            <div
              key={i}
              className={`max-w-[90%] rounded-2xl px-4 py-3 text-sm leading-relaxed shadow-sm ${
                t.role === "you"
                  ? "ml-auto rounded-br-md bg-[var(--hud-cyan)]/20 text-[var(--hud-text)]"
                  : "rounded-bl-md border border-white/5 bg-white/[0.05] text-[var(--hud-text-dim)]"
              }`}
            >
              <span className={`mb-1 block text-[10px] font-black uppercase tracking-wider ${t.role === "you" ? "text-[var(--hud-cyan)]" : "text-[var(--hud-text-faint)]"}`}>
                {t.role === "you" ? "You" : "Aria"}
              </span>
              {t.text}
            </div>
          ))
        )}
        {listening && (
          <div className="flex items-center gap-2 rounded-2xl bg-rose-500/10 px-4 py-3 text-sm font-medium text-rose-200">
            <span className="size-2 animate-pulse rounded-full bg-rose-400" /> Listening… {interim && <span className="text-[var(--hud-text-dim)]">{interim}</span>}
          </div>
        )}
        {explaining && (
          <div className="flex items-center gap-2 rounded-2xl bg-[var(--hud-cyan)]/10 px-4 py-3 text-sm font-medium text-[var(--hud-cyan)]">
            <span className="size-2 animate-pulse rounded-full bg-[var(--hud-cyan)]" /> Drawing an explanation…
          </div>
        )}
        <div ref={endRef} />
      </div>

      <div className="mt-auto border-t border-[var(--hud-line)] p-3">
        {(liveActive || liveReady) && (
          <div className="mb-2 flex items-center justify-between gap-2">
            <div className={`flex items-center gap-2 rounded-full px-3 py-1.5 text-[11px] font-black uppercase tracking-[0.14em] ${liveActive ? "bg-rose-500/15 text-rose-300" : "bg-cyan-400/10 text-cyan-200"}`}>
              <span className={`size-2 rounded-full ${liveActive ? "animate-pulse bg-rose-400" : "bg-cyan-300"}`} />
              {liveActive ? liveStatusLabel || "Live — costs apply" : "Voice ready · muted"}
            </div>
            {onLiveMute && (
              <button
                type="button"
                onClick={onLiveMute}
                className="shrink-0 rounded-full border border-white/15 bg-white/5 px-3 py-1.5 text-[11px] font-bold text-white/80 transition hover:bg-white/10"
              >
                {liveMuted ? "🔇 Unmute" : "🎙 Mute"}
              </button>
            )}
          </div>
        )}
        {liveError && <p className="mb-2 text-xs font-semibold text-rose-300">{liveError}</p>}
        {voiceOnly ? (
          <button
            onClick={onVoice}
            disabled={(explaining || !voiceSupported) && !liveActive}
            className={`w-full rounded-full py-3 text-sm font-black transition disabled:opacity-40 ${
              liveActive || listening ? "bg-rose-500 text-white" : "hud-btn-primary"
            }`}
          >
            {liveActive
              ? "⏹ End live conversation"
              : !voiceSupported
                ? "Voice not supported here"
                : listening
                  ? "⏹ Stop & ask"
                  : "🎙 Talk to Aria live"}
          </button>
        ) : (
          <form
            className="flex items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (question.trim()) {
                onAsk(question);
                setQuestion("");
              }
            }}
          >
            {voiceSupported && (
              <button
                type="button"
                onClick={onVoice}
                disabled={explaining && !liveActive}
                title={
                  liveAlwaysOn
                    ? liveMuted
                      ? "Unmute your mic"
                      : "Mute your mic"
                    : liveActive
                      ? "End live conversation"
                      : liveReady
                        ? "Unmute and talk to Aria"
                        : "Talk live with Aria"
                }
                className={`shrink-0 rounded-full px-3 py-2.5 text-sm font-black transition disabled:opacity-40 ${
                  liveAlwaysOn
                    ? liveMuted
                      ? "bg-rose-500 text-white"
                      : "hud-btn-ghost"
                    : liveActive || listening
                      ? "bg-rose-500 text-white"
                      : "hud-btn-ghost"
                }`}
              >
                {liveAlwaysOn ? (liveMuted ? "🔇" : "🎙") : liveActive ? "⏹" : liveReady && liveMuted ? "🔇" : "🎙"}
              </button>
            )}
            <input
              id="lesson-chat-input"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder={
                liveAlwaysOn
                  ? "Speak anytime, or type here…"
                  : liveActive
                    ? "Live conversation — just speak…"
                    : "Ask about this part…"
              }
              disabled={explaining || (liveActive && !liveAlwaysOn)}
              className="min-w-0 flex-1 rounded-full border border-[var(--hud-line-strong)] bg-black/40 px-4 py-2.5 text-sm text-[var(--hud-text)] placeholder:text-[var(--hud-text-faint)] focus:border-[var(--hud-cyan)] focus:outline-none disabled:opacity-50"
            />
            <button type="submit" disabled={explaining || (liveActive && !liveAlwaysOn) || !question.trim()} className="hud-btn-primary shrink-0 rounded-full px-4 py-2.5 text-sm font-black disabled:opacity-40">
              Ask
            </button>
          </form>
        )}
      </div>
    </HudPanel>
  );
}

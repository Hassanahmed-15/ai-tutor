"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useGeminiLiveTutor } from "@/lib/useGeminiLiveTutor";
import { sileroStatus, type SileroStatus } from "@/lib/voice/sileroVad";

/**
 * TALK TO ARIA FROM ANYWHERE — a floating control on the main screen, for exploring the voice
 * architecture in the real app rather than on a diagnostics page.
 *
 * It is deliberately a thin shell over `useGeminiLiveTutor`, with no voice logic of its own: the
 * same session machine, the same turn-taking gate and the same playback path the lecture player
 * uses, so what is exercised here is what ships. `voiceSurface: "shared"` labels it in diagnostics
 * without changing policy, and `gateProfile: "dedicated"` is the right bar for an open chat —
 * nothing is being narrated, so a plain sentence should reach her without needing her name.
 *
 * WHAT IT SHOWS. Connection state, whether she is speaking, whether the microphone is live, and a
 * running transcript of both sides. That is the minimum needed to tell a working session from a
 * broken one by looking: a session that is "live" but never transcribes the student is a
 * microphone problem, while one that transcribes and never answers is a model problem, and those
 * two failures are indistinguishable from a button that only lights up.
 *
 * It does not auto-start. A session that opens a microphone on page load is both a privacy
 * surprise and a way to spend the Live quota by leaving a tab open.
 */

type Line = { role: "student" | "tutor"; text: string; final: boolean; at: number };

export function VoiceExploreButton({ position = "top-right" }: { position?: "top-right" | "top-left" }) {
  const [open, setOpen] = useState(false);
  const [lines, setLines] = useState<Line[]>([]);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const tutor = useGeminiLiveTutor({
    topic: "Open conversation with Aria",
    /*
     * There is no lesson here, so the context says so plainly. Without it the tutor is briefed for
     * a board it cannot see and opens by describing a lecture that does not exist.
     */
    getBeatContext: () =>
      "There is no lecture running. This is an open conversation: the student wants to talk, ask questions and explore what you can do. Answer naturally and briefly, and ask what they would like to learn.",
    onBoardRequest: () => undefined,
    /*
     * A session the student opened on purpose. "conversation" still required a question form or
     * her name, so "hello", "hey" and "explain linear regression" were filtered out and the panel
     * sat on "Listening" forever. Here anything the student says is for her; noise and other
     * people are still rejected by the acoustic and speaker layers, and a hail to someone else or
     * household side-talk is still rejected by the words.
     */
    gateProfile: "dedicated",
    voiceSurface: "shared",
    alwaysOn: true,
    onTranscript: (role, text, final) => {
      if (!text.trim()) return;
      setLines((current) => {
        const last = current[current.length - 1];
        // Interim results replace the previous interim line from the same speaker rather than
        // stacking, so a sentence being transcribed does not print once per word.
        if (last && last.role === role && !last.final) {
          return [...current.slice(0, -1), { role, text, final, at: Date.now() }];
        }
        return [...current, { role, text, final, at: Date.now() }].slice(-40);
      });
    },
  });

  const { status, speaking, muted, reconnecting, errorMessage, start, stop, toggleMute } = tutor;
  const live = status === "live";

  /*
   * Show whether the neural detector is available.
   *
   * This panel previously showed "Listening" whether the neural VAD had loaded or had silently
   * fallen back to the acoustic heuristic, and for one deploy it was the heuristic for everyone:
   * the runtime WASM 404'd, every turn died at the acoustic layer, and the only outward sign was
   * that nothing ever answered.
   *
   * Read from the loader, not from the gate's last verdict. The gate reports whichever detector
   * judged the most recent frame, which is the heuristic for the first seconds of every cold
   * session while the model downloads — reading that flagged "degraded" on a perfectly healthy
   * startup, which is worse than no indicator, because a warning that is usually wrong gets
   * ignored on the one occasion it is right.
   */
  const [vadStatus, setVadStatus] = useState<SileroStatus>("idle");
  /*
   * The gate's own reason for the last decision, shown only while nothing has been accepted yet.
   *
   * Audio reaches Gemini exclusively through the gate's sendFrame callback, between activityStart
   * and activityEnd, so a gate that never opens means the model receives nothing and the student
   * sees an empty transcript with no explanation. The gate always records why it rejected a frame;
   * printing it turns "she isn't responding" into a specific, reportable reason.
   */
  const [gateReason, setGateReason] = useState<string | null>(null);
  const { getVoiceDiagnostics } = tutor;
  useEffect(() => {
    if (!live) return;
    const id = window.setInterval(() => {
      setVadStatus(sileroStatus());
      setGateReason(getVoiceDiagnostics().gate?.reason ?? null);
    }, 1000);
    return () => {
      window.clearInterval(id);
      setVadStatus("idle");
      setGateReason(null);
    };
  }, [live, getVoiceDiagnostics]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines]);

  const handleToggle = useCallback(async () => {
    if (live || status === "connecting") {
      stop();
      setOpen(false);
      return;
    }
    setOpen(true);
    setLines([]);
    await start();
  }, [live, status, start, stop]);

  // Leaving the page must not leave a microphone open and a socket billing.
  useEffect(() => () => stop(), [stop]);

  const label = reconnecting
    ? "Reconnecting…"
    : status === "connecting"
      ? "Connecting…"
      : live
        ? speaking
          ? "Aria is speaking"
          : "Listening — just talk"
        : "Talk to Aria";

  const dot = reconnecting || status === "connecting" ? "#fbbf24" : live ? (speaking ? "#a78bfa" : "#34d399") : "#64748b";
  const side = position === "top-left" ? { left: 16 } : { right: 16 };

  return (
    <div style={{ position: "fixed", top: 16, ...side, zIndex: 9999 }} className="flex flex-col items-stretch gap-2">
      <div className="flex items-center gap-2" style={{ justifyContent: position === "top-left" ? "flex-start" : "flex-end" }}>
        {live && (
          <button
            onClick={toggleMute}
            aria-label={muted ? "Unmute the microphone" : "Mute the microphone"}
            className="rounded-full border border-white/15 bg-black/70 px-3 py-2 text-xs font-semibold text-white/80 backdrop-blur-md transition hover:bg-black/85"
          >
            {muted ? "🔇 Unmute" : "🎙 Mute"}
          </button>
        )}
        <button
          onClick={() => void handleToggle()}
          aria-label={live ? "End the voice session" : "Start talking to Aria"}
          className="flex items-center gap-2 rounded-full border border-white/15 bg-black/70 px-4 py-2 text-sm font-semibold text-white shadow-2xl backdrop-blur-md transition hover:bg-black/85"
        >
          <span
            aria-hidden="true"
            style={{ background: dot, width: 9, height: 9, borderRadius: "50%", display: "inline-block" }}
            className={live && !speaking ? "animate-pulse" : ""}
          />
          {label}
        </button>
      </div>

      {open && (live || status === "connecting" || reconnecting || errorMessage) && (
        <div className="w-[min(86vw,360px)] rounded-2xl border border-white/10 bg-[#0b0d12]/95 p-3 shadow-2xl backdrop-blur-xl">
          {errorMessage && <p className="mb-2 text-xs font-medium text-rose-300">{errorMessage}</p>}
          <div ref={scrollRef} className="max-h-[42vh] overflow-auto pr-1">
            {lines.length === 0 ? (
              <p className="text-xs text-white/45">
                {status === "connecting" ? "Opening the session…" : "Say hello — she is listening. Ask her anything, or ask her to teach you something."}
              </p>
            ) : (
              lines.map((line, index) => (
                <p key={index} className={`mb-1.5 text-[13px] leading-snug ${line.role === "tutor" ? "text-violet-200" : "text-white/85"}`}>
                  <span className="mr-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-white/35">
                    {line.role === "tutor" ? "Aria" : "You"}
                  </span>
                  {line.text}
                  {!line.final && <span className="text-white/30"> …</span>}
                </p>
              ))
            )}
          </div>
          <p className="mt-2 border-t border-white/10 pt-2 text-[10px] text-white/35">
            {muted ? "Microphone muted." : "Interrupt her any time — just start talking."}{" "}
            {vadStatus === "loading" && <span className="text-white/45">Loading speech model… </span>}
            {vadStatus === "failed" && (
              <span className="text-amber-300/80">Neural VAD unavailable — speech detection degraded. </span>
            )}
            {vadStatus === "ready" && <span className="text-emerald-300/60">Neural VAD active. </span>}
            Diagnostics at /voice-lab.
            {/* Only while she has heard nothing yet — once a turn lands, the transcript says more. */}
            {lines.length === 0 && gateReason && (
              <span className="mt-1 block font-mono text-[9px] text-white/30">gate: {gateReason}</span>
            )}
          </p>
        </div>
      )}
    </div>
  );
}

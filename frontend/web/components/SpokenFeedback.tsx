"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Square, Volume2 } from "lucide-react";
import { playNarration, splitNarrationSentences, unlockAudio, type NarrationHandle } from "@/lib/voice";
import { usePlaybackRate } from "@/lib/playbackPrefs";
import { clearTextStart, logSentenceCue, logSentenceVoice, markTextStart, textStartOf, voiceWaitMs } from "@/lib/canvas/textLead";

/**
 * ARIA SAYS THE FEEDBACK (owner's QA brief, 2026-11-28, item 4h): on the test results, a wrong or partly
 * right answer's feedback can be heard in her voice — in the lecture's own order, TEXT FIRST, VOICE RIGHT
 * AFTER (lib/canvas/textLead.ts). Each sentence is written into the panel when it is cued, and her voice
 * for it starts TEXT_LEAD_MS (scaled by speed) after the frame it was painted on, never before.
 */
export function SpokenFeedback({ id, text }: { id: string; text: string }) {
  const [rate] = usePlaybackRate();
  const rateRef = useRef(rate);
  useEffect(() => { rateRef.current = rate; }, [rate]);
  const [sentences] = useState(() => splitNarrationSentences(text));
  /** How many sentences are written (cued); -1 = not speaking. */
  const [shown, setShown] = useState(-1);
  const [speaking, setSpeaking] = useState(false);
  const handle = useRef<NarrationHandle | null>(null);
  const cuedAt = useRef<number[]>([]);
  const key = `test-feedback:${id}`;

  // The frame a sentence is painted on is its writing's start.
  useLayoutEffect(() => {
    if (shown < 1) return;
    const index = shown - 1;
    const raf = requestAnimationFrame(() => markTextStart(key, index, performance.now()));
    return () => cancelAnimationFrame(raf);
  }, [shown, key]);

  useEffect(() => () => handle.current?.cancel(), []);

  const stop = useCallback(() => {
    handle.current?.cancel();
    handle.current = null;
    setSpeaking(false);
  }, []);

  const start = useCallback(() => {
    unlockAudio();
    handle.current?.cancel();
    sentences.forEach((_, i) => clearTextStart(key, i));
    cuedAt.current = [];
    setShown(0);
    setSpeaking(true);
    handle.current = playNarration(text, {
      onStart: () => {},
      onEnd: () => {
        setSpeaking(false);
        setShown(sentences.length);
        handle.current = null;
      },
      onBlocked: () => setSpeaking(false),
      rate: rateRef.current,
      voiceFallback: "silent",
      onSentenceStart: (i) => {
        cuedAt.current[i] = performance.now();
        logSentenceCue(key, i, cuedAt.current[i]);
        setShown(i + 1);
      },
      textLeadWait: (i) => voiceWaitMs({ now: performance.now(), cuedAt: cuedAt.current[i] ?? performance.now(), textStart: textStartOf(key, i), expectsText: true, speed: rateRef.current }),
      onSentenceVoiced: (i) => logSentenceVoice(key, i, performance.now(), rateRef.current),
    });
  }, [key, sentences, text]);

  if (!sentences.length) return null;
  return (
    <div className="mt-3" data-spoken-feedback={id}>
      <button
        type="button"
        onClick={speaking ? stop : start}
        aria-pressed={speaking}
        className="hud-btn-ghost inline-flex items-center gap-1.5 rounded-full px-4 py-1.5 text-xs font-bold"
      >
        {speaking ? <Square size={12} aria-hidden="true" /> : <Volume2 size={13} aria-hidden="true" />}
        {speaking ? "Stop" : "Hear Aria explain"}
      </button>
      {shown > 0 && (
        <p className="mt-2 rounded-xl border border-[var(--hud-border,rgba(255,255,255,0.12))] px-3 py-2 text-sm leading-6 text-[var(--hud-text)]" aria-live="polite">
          {sentences.slice(0, shown).map((sentence, i) => (
            <span key={i} data-feedback-sentence={i} className={i === shown - 1 && speaking ? "font-semibold" : "text-[var(--hud-text-dim)]"}>
              {i > 0 ? " " : ""}
              {sentence}
            </span>
          ))}
        </p>
      )}
    </div>
  );
}

/** What she says for a result: its feedback, the misconception, and (for a misconception) the full answer. */
export function feedbackScript(result: { feedback: string; misconception?: string | null; missingKeyPoints: string[]; status: string }, modelAnswer?: string): string {
  const end = (s: string) => (/[.!?]$/.test(s.trim()) ? s.trim() : `${s.trim()}.`);
  const parts = [result.feedback ? end(result.feedback) : ""];
  if (result.missingKeyPoints.length) parts.push(end(`Still needed: ${result.missingKeyPoints.join("; ")}`));
  if (result.misconception) parts.push(end(`The misconception to fix: ${result.misconception}`));
  if (result.status === "misconception" && modelAnswer) parts.push(end(`A full answer: ${modelAnswer}`));
  return parts.filter(Boolean).join(" ");
}

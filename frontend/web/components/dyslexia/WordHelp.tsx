"use client";

import { useEffect, useRef, useState } from "react";
import { playNarration } from "@/lib/voice";

/**
 * What one tapped word means, how it breaks into syllables, and what it sounds like.
 *
 * Decoding is the core difficulty in dyslexia, so this targets it directly: the word is shown split
 * at its syllables, spoken on demand, and glossed in the sense the sentence was using.
 *
 * SYLLABLES COME FROM THE SERVER, NOT A LOCAL SPLITTER. I measured a tuned vowel-group heuristic at
 * 6/10 on the words a science lecture actually uses — chloroplast became "chlo-rop-last", glucose
 * "glu-co-se". Showing a student the wrong breaks is worse than showing none, because this is the
 * part they would trust and practise. They arrive with the beat's rewrite, so the split is already
 * there when the popover opens; a word with no split simply shows no split.
 */

const meaningCache = new Map<string, string>();

export type WordHelpTarget = { word: string; sentence: string };

export function WordHelp({
  target,
  syllables,
  onClose,
}: {
  target: WordHelpTarget;
  syllables: string[] | undefined;
  onClose: () => void;
}) {
  const [meaning, setMeaning] = useState<string | null>(() => meaningCache.get(target.word.toLowerCase()) ?? null);
  const [loading, setLoading] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    const key = target.word.toLowerCase();
    if (!key || meaningCache.has(key)) return;
    let cancelled = false;
    setLoading(true);
    void fetch("/api/word-help", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ word: target.word, sentence: target.sentence }),
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled) return;
        if (data?.meaning) {
          meaningCache.set(key, data.meaning);
          setMeaning(data.meaning);
        }
      })
      .catch(() => {
        // The word and its syllables are the useful part; a missing gloss is not worth an error.
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [target.word, target.sentence]);

  /**
   * Speak the word.
   *
   * `preserveActive` matters here: without it `playNarration` cancels every running narration, which
   * would kill the lecture outright with no way back to the position. The caller has already paused
   * the beat; this plays over the top of a paused narration and leaves it resumable.
   */
  function speak() {
    playNarration(target.word, {
      onStart: () => {},
      onEnd: () => {},
      onBlocked: () => {},
      preserveActive: true,
      cloudTts: true,
    });
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Help with the word ${target.word}`}
      className="fixed inset-0 z-[70] grid place-items-center p-6"
      style={{ background: "rgba(0,0,0,0.55)" }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="w-full max-w-md rounded-[1.6rem] border border-white/15 p-6 text-center"
        style={{ background: "#14151c" }}
      >
        <p className="text-[0.72rem] uppercase tracking-[0.18em] text-white/40">The word</p>
        <p className="mt-2 text-[2.1rem] font-black leading-tight text-white">{target.word}</p>

        {syllables && syllables.length > 1 && (
          <p className="mt-3 text-[1.4rem] font-bold text-accent-dyslexia">
            {syllables.map((piece, i) => (
              <span key={i}>
                {i > 0 && <span className="text-white/30"> · </span>}
                {piece}
              </span>
            ))}
          </p>
        )}

        <button
          type="button"
          onClick={speak}
          className="mt-4 rounded-full border border-white/20 px-5 py-2 text-[0.95rem] text-white hover:bg-white/10"
        >
          🔊 Hear it
        </button>

        <div className="mt-5 min-h-[3rem]">
          {loading && !meaning && <p className="text-[0.95rem] text-white/40">Looking it up…</p>}
          {meaning && <p className="text-[1.05rem] leading-relaxed text-white/85">{meaning}</p>}
          {!loading && !meaning && (
            <p className="text-[0.95rem] text-white/40">No description available — but you can hear it above.</p>
          )}
        </div>

        <button
          ref={closeRef}
          type="button"
          onClick={onClose}
          className="mt-5 w-full rounded-[var(--radius)] bg-white/90 py-2.5 text-[0.95rem] font-bold text-black"
        >
          Back to the lesson
        </button>
      </div>
    </div>
  );
}

import type { FingerSpellingUnit } from "./types";

const DIGIT_WORDS: Record<string, string> = {
  "0": "ZERO",
  "1": "ONE",
  "2": "TWO",
  "3": "THREE",
  "4": "FOUR",
  "5": "FIVE",
  "6": "SIX",
  "7": "SEVEN",
  "8": "EIGHT",
  "9": "NINE",
};

/**
 * The upstream expressive pipeline falls back to A-Z landmark clips when its semantic database
 * has no close match. That database is not published, so this adapter keeps the fallback exact and
 * explicit instead of pretending fingerspelling is a full ASL translation.
 */
export function transcriptWords(text: string): string[] {
  return (text.toUpperCase().match(/[A-Z]+|[0-9]+/g) ?? []).flatMap((token) => {
    if (/^[0-9]+$/.test(token)) return [...token].map((digit) => DIGIT_WORDS[digit]);
    return token;
  });
}

export function buildFingerSpellingPlan(text: string): FingerSpellingUnit[] {
  return transcriptWords(text).flatMap((word, wordIndex) =>
    [...word].map((letter, letterIndex) => ({ word, letter, wordIndex, letterIndex })),
  );
}

export function playbackDelayMs(speed: number, wordChanged: boolean): number {
  const safeSpeed = Math.max(0.6, Math.min(1.6, speed));
  const letterMs = 360 / safeSpeed;
  return Math.round(letterMs + (wordChanged ? 170 / safeSpeed : 0));
}


"use client";

import { useMemo } from "react";

/**
 * One chunk line, with the word currently being spoken lit up.
 *
 * WHY READ ALONG AT ALL. Hearing a word while seeing it is the support with the strongest evidence
 * behind it for dyslexic readers — it keeps the eye on the place the voice has reached, which is
 * exactly what is hard to hold when decoding is effortful.
 *
 * WHY THE HIGHLIGHT IS SOFT. The position is interpolated from an audio clock, not measured from
 * word timings the model does not provide, so mid-sentence it can be a word or two out. A hard box
 * around the wrong word looks broken; a gradient that fades behind the current word absorbs the same
 * error invisibly. The trailing words stay dimmed rather than resetting, so the line reads as
 * "here is where we are" rather than flashing.
 *
 * Every word is also a button, because tap-a-word hangs off these same spans — building the two
 * separately would mean two passes over identical markup.
 */
export function KaraokeLine({
  text,
  activeWord,
  onWordTap,
  className,
}: {
  text: string;
  /** Index of the word being spoken, or -1 when this line is not the one being narrated. */
  activeWord: number;
  onWordTap?: (word: string, sentence: string) => void;
  className?: string;
}) {
  // Split so punctuation travels with its word — tapping "sugar." must look up "sugar".
  const words = useMemo(() => text.split(/(\s+)/), [text]);

  let wordCounter = -1;

  return (
    <span className={className}>
      {words.map((piece, i) => {
        if (/^\s+$/.test(piece)) return <span key={i}>{piece}</span>;
        wordCounter += 1;
        const index = wordCounter;
        const distance = activeWord - index;
        // Current word full strength; the two behind it fade out; everything else is plain.
        const spoken = activeWord >= 0 && distance >= 0;
        const opacity = !spoken ? 1 : distance === 0 ? 1 : distance <= 2 ? 0.85 : 0.72;
        const isCurrent = activeWord === index;

        if (!onWordTap) {
          return (
            <span
              key={i}
              style={{
                opacity,
                background: isCurrent ? "var(--accent-dyslexia-glow, rgba(255,214,102,0.28))" : "transparent",
                borderRadius: isCurrent ? "0.28em" : undefined,
                transition: "background 140ms linear, opacity 140ms linear",
              }}
            >
              {piece}
            </span>
          );
        }

        return (
          <button
            key={i}
            type="button"
            onClick={() => onWordTap(piece.replace(/[^A-Za-z'-]/g, ""), text)}
            // Inherits type and spacing from the line: a button here is a tap target, not a control
            // with its own look.
            className="cursor-pointer border-0 bg-transparent p-0 font-[inherit] text-[inherit] leading-[inherit] tracking-[inherit]"
            style={{
              opacity,
              background: isCurrent ? "var(--accent-dyslexia-glow, rgba(255,214,102,0.28))" : "transparent",
              borderRadius: isCurrent ? "0.28em" : undefined,
              transition: "background 140ms linear, opacity 140ms linear",
            }}
          >
            {piece}
          </button>
        );
      })}
    </span>
  );
}

"use client";

import { useEffect, useId, useState } from "react";
import { onMouthShape, type MouthShape } from "@/lib/adhd/mouth";
import { FACE_SHAPES, type Expression } from "@/lib/adhd/expression";

/**
 * Aria — an illustrated teacher character (pure SVG, no external assets). The mouth
 * animates open/closed while speaking so it reads as "someone is teaching me"; eyes blink
 * on idle. Tuned for the dark premium theme with a soft glow halo when active.
 */
export function TeacherAvatar({
  speaking,
  size = 120,
  expression = "neutral",
}: {
  speaking: boolean;
  size?: number;
  /** Drives the eyes, brows and mouth curve. See lib/adhd/expression.ts. */
  expression?: Expression;
}) {
  /**
   * Mouth openness, sampled from the live audio rather than from a CSS animation.
   *
   * The previous mouth was a class that flapped at a fixed rate whenever `speaking` was true, which
   * reads as a puppet: it kept moving through pauses and stopped mid-word at the end. Following the
   * actual loudness envelope is what makes it read as speech — it opens on stressed syllables and
   * closes in the gaps, because that is literally what the voice is doing.
   *
   * Subscribed rather than lifted into React state: this changes ~60 times a second, and
   * re-rendering the player at that rate to move one ellipse would be indefensible.
   */
  /**
   * Per-instance gradient ids.
   *
   * These were the literals "av-face" and "av-hair". That was fine while exactly one avatar existed;
   * the ADHD track now renders a second one on the same page, which made the ids duplicate. Two
   * elements with one id is invalid HTML, and every `url(#av-face)` on the page resolves to
   * whichever came first in document order — so the two avatars silently shared one paint, and
   * would visibly diverge the moment their fills differed.
   */
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const faceId = `av-face-${uid}`;
  const hairId = `av-hair-${uid}`;

  const [mouth, setMouth] = useState<MouthShape>({ open: 0, width: 0.5 });
  // Subscribe unconditionally. The earlier version branched on `speaking` and called setLevel(0) in
  // the effect body, which is a synchronous setState during commit — the exact pattern that caused
  // cascading renders in AdhdLayer. It is also unnecessary: `open` below already gates on
  // `speaking`, and `detachMouthAnalyser()` publishes 0 when the clip ends, so the level reaches
  // rest through the subscription rather than through a second source of truth.
  useEffect(() => onMouthShape(setMouth), []);

  const face = FACE_SHAPES[expression] ?? FACE_SHAPES.neutral;
  // Never fully shut while speaking: a mouth that closes completely between syllables reads as a
  // stutter, so it rests slightly open and opens further with volume.
  const open = speaking ? 1.4 + mouth.open * 6.4 : 0;
  /*
   * Lip spread. `mouth.width` is 0 (rounded, "oo") to 1 (spread, "ee"), 0.5 neutral — so the mouth
   * narrows to a pucker and widens to a grin around the same 6.5 resting radius. This is what turns
   * a jaw that opens and shuts into something that reads as forming words.
   */
  const wide = speaking ? 4.6 + mouth.width * 4.2 : 6.5;

  return (
    <div className="relative grid place-items-center" style={{ width: size, height: size }}>
      {/* glow halo when speaking */}
      <div
        className={`absolute inset-0 rounded-full blur-xl transition-opacity duration-500 ${speaking ? "opacity-90" : "opacity-30"}`}
        style={{ background: "radial-gradient(circle, rgba(129,140,248,0.7), transparent 70%)" }}
      />
      {speaking && (
        <span className="absolute inset-[-6px] rounded-full ring-2 ring-indigo-400/50 av-ring" />
      )}
      <svg viewBox="0 0 120 120" width={size} height={size} className="relative">
        <defs>
          <radialGradient id={faceId} cx="50%" cy="42%" r="65%">
            <stop offset="0%" stopColor="#fce7d4" />
            <stop offset="100%" stopColor="#f3c9a6" />
          </radialGradient>
          <linearGradient id={hairId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#4338ca" />
            <stop offset="100%" stopColor="#312e81" />
          </linearGradient>
        </defs>

        {/* shoulders / collar */}
        <path d="M18 120 Q60 86 102 120 Z" fill="#1e1b4b" />
        <path d="M52 96 L60 108 L68 96 Z" fill="#6366f1" />

        {/* neck */}
        <rect x="52" y="78" width="16" height="16" rx="7" fill="#f0bd97" />

        {/* head */}
        <circle cx="60" cy="52" r="30" fill={`url(#${faceId})`} />

        {/* hair */}
        <path d="M30 50 Q32 20 60 20 Q88 20 90 50 Q86 36 60 34 Q34 36 30 50 Z" fill={`url(#${hairId})`} />
        <path d="M30 50 Q28 64 33 70 Q31 54 38 46 Z" fill={`url(#${hairId})`} />
        <path d="M90 50 Q92 64 87 70 Q89 54 82 46 Z" fill={`url(#${hairId})`} />

        {/* eyes (blink on idle via CSS) */}
        <g className={speaking ? "" : "av-blink"}>
          {/* Height carries the expression: heavy lids when bored, wide when delighted. Width is
              left alone so the face never looks stretched, only more or less awake. */}
          <ellipse cx="50" cy="50" rx="3.4" ry={4.2 * face.eye} fill="#1f2937" />
          <ellipse cx="70" cy="50" rx="3.4" ry={4.2 * face.eye} fill="#1f2937" />
          <circle cx="51.1" cy="48.6" r="1.1" fill="#fff" />
          <circle cx="71.1" cy="48.6" r="1.1" fill="#fff" />
        </g>

        {/* brows */}
        {/* brows — raised when delighted or surprised, lowered when bored */}
        <path d={`M45 ${42 + face.brow} Q50 ${39 + face.brow} 55 ${42 + face.brow}`} stroke="#6b4b3a" strokeWidth="2" fill="none" strokeLinecap="round" />
        <path d={`M65 ${42 + face.brow} Q70 ${39 + face.brow} 75 ${42 + face.brow}`} stroke="#6b4b3a" strokeWidth="2" fill="none" strokeLinecap="round" />

        {/* cheeks */}
        <circle cx="44" cy="60" r="4" fill="#f4a98a" opacity="0.5" />
        <circle cx="76" cy="60" r="4" fill="#f4a98a" opacity="0.5" />

        {/* Mouth. Speaking: an ellipse whose height follows the voice. Idle: a curve whose shape is
            the expression. Both are the same anchor point, so the face does not jump between them. */}
        {speaking ? (
          <ellipse cx="60" cy="64" rx={wide} ry={open} fill="#7c2d12" />
        ) : (
          <path
            d={`M53 63 Q60 ${63 + face.curve} 67 63`}
            stroke="#7c2d12"
            strokeWidth="2.4"
            fill="none"
            strokeLinecap="round"
          />
        )}
      </svg>
    </div>
  );
}

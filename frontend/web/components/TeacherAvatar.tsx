"use client";

import { useEffect, useId, useState } from "react";
import { onMouthShape, type MouthShape } from "@/lib/adhd/mouth";
import { FACE_SHAPES, type Expression } from "@/lib/adhd/expression";

/**
 * Aria — the teacher character, pure SVG with no external assets.
 *
 * DRAWN AS AN OLDER TEACHER WITH GLASSES, and the glasses are the load-bearing part: they are the
 * one feature that reads instantly at any size, and they give the face an expression channel a
 * plain cartoon does not have. Peering OVER them is the entire "I saw that" look, which is how the
 * furious face stays legible without relying on a scowl alone.
 *
 * SIZED FOR ~150px, not 52px. It now renders large in the ADHD sidebar, so stroke weights, the
 * pupil highlights and the brows are tuned to hold up at that scale rather than merely to survive
 * being shrunk into a header.
 */
export function TeacherAvatar({
  speaking,
  size = 120,
  expression = "neutral",
}: {
  speaking: boolean;
  size?: number;
  /** Drives eyes, brows, glasses and the mouth curve. See lib/adhd/expression.ts. */
  expression?: Expression;
}) {
  /**
   * Per-instance gradient ids.
   *
   * These were the literals "av-face" and "av-hair". That was fine while exactly one avatar existed;
   * the standard player still renders its own, so the ids must not collide. Two elements sharing an
   * id is invalid HTML, and every `url(#av-face)` on the page resolves to whichever came first in
   * document order — so two avatars silently shared one paint.
   */
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const faceId = `av-face-${uid}`;
  const hairId = `av-hair-${uid}`;
  const knitId = `av-knit-${uid}`;

  /**
   * Mouth shape, sampled from the live audio rather than from a CSS animation.
   *
   * A fixed-rate flap reads as a puppet: it keeps moving through pauses and stops mid-word.
   * Following the actual envelope is what makes it read as speech.
   *
   * Subscribed rather than lifted into player state: this changes ~60 times a second.
   */
  const [mouth, setMouth] = useState<MouthShape>({ open: 0, width: 0.5 });
  // Subscribe unconditionally — branching on `speaking` and calling setState in the effect body is
  // a synchronous setState during commit, the pattern that caused cascading renders in AdhdLayer.
  useEffect(() => onMouthShape(setMouth), []);

  const face = FACE_SHAPES[expression] ?? FACE_SHAPES.neutral;
  // Never fully shut while speaking: a mouth that closes completely between syllables reads as a
  // stutter, so it rests slightly open and opens further with volume.
  const open = speaking ? 1.6 + mouth.open * 7.2 : 0;
  /*
   * Lip spread. `mouth.width` is 0 (rounded, "oo") to 1 (spread, "ee"), 0.5 neutral — so the mouth
   * narrows to a pucker and widens around the same resting radius. This is what turns a jaw that
   * opens and shuts into something that reads as forming words.
   */
  const wide = speaking ? 5 + mouth.width * 4.6 : 7;
  const g = face.glasses; // how far the specs have slid down the nose

  return (
    // data-teacher-avatar is a test hook, and a deliberate one: "how many teachers are on screen"
    // is an assertion worth making cheaply, and counting anonymous <svg> elements would silently
    // match any other 120x120 drawing on the page.
    <div
      data-teacher-avatar={expression}
      className="relative grid place-items-center"
      style={{ width: size, height: size }}
    >
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
            <stop offset="0%" stopColor="#fde3cd" />
            <stop offset="100%" stopColor="#eec09a" />
          </radialGradient>
          <linearGradient id={hairId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#e7e5e4" />
            <stop offset="100%" stopColor="#a8a29e" />
          </linearGradient>
          <linearGradient id={knitId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#7e5a86" />
            <stop offset="100%" stopColor="#4c3357" />
          </linearGradient>
        </defs>

        {/* bun, behind everything — the single strongest cue for the character */}
        <circle cx="60" cy="17" r="11.5" fill={`url(#${hairId})`} />
        <circle cx="60" cy="17" r="11.5" fill="none" stroke="#78716c" strokeWidth="0.8" opacity="0.5" />

        {/* cardigan shoulders + collar */}
        <path d="M14 120 Q60 84 106 120 Z" fill={`url(#${knitId})`} />
        <path d="M50 94 L60 108 L70 94 Z" fill="#3b2545" />
        {/* a string of pearls */}
        <g fill="#fdf4e3">
          <circle cx="49" cy="99" r="1.7" />
          <circle cx="55" cy="102" r="1.7" />
          <circle cx="60" cy="103.4" r="1.7" />
          <circle cx="65" cy="102" r="1.7" />
          <circle cx="71" cy="99" r="1.7" />
        </g>

        {/* neck */}
        <rect x="52" y="78" width="16" height="16" rx="7" fill="#e8b491" />

        {/* head */}
        <circle cx="60" cy="53" r="29" fill={`url(#${faceId})`} />

        {/* hair: swept sides, framing the face */}
        <path d="M31 52 Q31 21 60 21 Q89 21 89 52 Q84 35 60 33 Q36 35 31 52 Z" fill={`url(#${hairId})`} />
        <path d="M31 52 Q28 66 33 73 Q31 56 38 47 Z" fill={`url(#${hairId})`} />
        <path d="M89 52 Q92 66 87 73 Q89 56 82 47 Z" fill={`url(#${hairId})`} />

        {/* earrings */}
        <circle cx="31.5" cy="60" r="2.3" fill="#fbbf24" />
        <circle cx="88.5" cy="60" r="2.3" fill="#fbbf24" />

        {/* eyes (blink on idle via CSS) */}
        <g className={speaking ? "" : "av-blink"}>
          {/* Height carries the expression: heavy lids when bored, narrowed when furious. Width is
              left alone so the face never looks stretched, only more or less awake. */}
          <ellipse cx="50" cy="51" rx="3.6" ry={4.4 * face.eye} fill="#1f2937" />
          <ellipse cx="70" cy="51" rx="3.6" ry={4.4 * face.eye} fill="#1f2937" />
          <circle cx="51.2" cy="49.5" r="1.2" fill="#fff" />
          <circle cx="71.2" cy="49.5" r="1.2" fill="#fff" />
        </g>

        {/*
          GLASSES. `face.glasses` slides them down the nose, so the furious face looks over the top
          of them — the most readable "I saw that" expression this character has.
        */}
        <g stroke="#8a5a2b" strokeWidth="1.9" fill="none" strokeLinecap="round">
          <ellipse cx="50" cy={51 + g} rx="10" ry={8 - g * 0.4} fill="#ffffff" fillOpacity="0.08" />
          <ellipse cx="70" cy={51 + g} rx="10" ry={8 - g * 0.4} fill="#ffffff" fillOpacity="0.08" />
          <path d={`M60.4 ${50.4 + g} H59.6`} strokeWidth="2.2" />
          <path d={`M40 ${50 + g} L32 ${48 + g}`} />
          <path d={`M80 ${50 + g} L88 ${48 + g}`} />
        </g>

        {/*
          BROWS. Rotated, not merely raised: lowered-but-flat brows read as sleepy rather than
          cross, and it is the inward tilt the eye actually reads as a scowl. Mirrored outward
          (a negative tilt) it reads as worried, which is what separates `sad` from `tired`.
        */}
        <g stroke="#57534e" strokeWidth="3.1" fill="none" strokeLinecap="round">
          <path
            d={`M43.5 ${41.5 + face.brow} Q50 ${38.2 + face.brow} 56.5 ${41.5 + face.brow}`}
            transform={`rotate(${face.tilt} 50 ${40.5 + face.brow})`}
          />
          <path
            d={`M63.5 ${41.5 + face.brow} Q70 ${38.2 + face.brow} 76.5 ${41.5 + face.brow}`}
            transform={`rotate(${-face.tilt} 70 ${40.5 + face.brow})`}
          />
        </g>

        {/* nose */}
        <path d="M60 56 Q57.6 62 60.6 62.6" stroke="#d69a72" strokeWidth="1.7" fill="none" strokeLinecap="round" />

        {/* cheeks */}
        <circle cx="41" cy="63" r="4.6" fill="#f08a7a" opacity="0.42" />
        <circle cx="79" cy="63" r="4.6" fill="#f08a7a" opacity="0.42" />

        {/* Mouth. Speaking: an ellipse whose height follows the voice. Idle: a curve whose shape is
            the expression. Both share an anchor, so the face does not jump between them. */}
        {speaking ? (
          <ellipse cx="60" cy="70" rx={wide} ry={open} fill="#8d2f2f" />
        ) : (
          <path
            d={`M50.5 69 Q60 ${69 + face.curve} 69.5 69`}
            stroke="#8d2f2f"
            strokeWidth="3.2"
            fill="none"
            strokeLinecap="round"
          />
        )}
      </svg>
    </div>
  );
}

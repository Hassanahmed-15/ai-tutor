"use client";

import { useLayoutEffect, useRef } from "react";
import { createTimeline, stagger, svg } from "animejs";
import { clamp01, smooth } from "./rate";

/**
 * A scrubbable anime.js timeline for a DrawScript.
 *
 * WHY THIS EXISTS. LiveSketch drives animation by calling `setElapsed(t)` inside a rAF loop,
 * so React re-renders ~60 times a second and every op's visibility is recomputed by filtering.
 * The actual stroke-in is a CSS keyframe, which means the board CANNOT be scrubbed backwards —
 * keyframes only run forward.
 *
 * A GSAP timeline inverts that: React renders every op ONCE as static structure, the timeline
 * owns all animation, and one call sets the whole board's state:
 *
 *     tl.progress(drawProgress)
 *
 * That is the contract this app already runs on. Nothing re-renders during playback, and
 * dragging progress backwards un-draws the board.
 *
 * PEDAGOGY IS BAKED IN, NOT DECORATION. Marks accumulate and never disappear — the transient
 * information effect is the main way animated instruction hurts learning, and a board where
 * nothing is erased is immune to it. Emphasis is the one exception: it yoyos back, because a
 * highlight that stays is no longer a highlight.
 *
 * ENGINE: anime.js v4 (was GSAP — the previous implementation is kept commented out at the
 * bottom of this file). The contract above is unchanged; only the library underneath moved.
 * Differences that actually matter when reading this code:
 *
 *   - anime.js works in MILLISECONDS. GSAP's build used seconds, so every position/duration
 *     here is `* durationMs`, not `* durationSeconds`.
 *   - `svg.morphTo()` needs a DOM ELEMENT to morph towards, where GSAP's morphSVG accepted a
 *     raw path `d` string. GsapSketch therefore renders each morph's destination path inside
 *     <defs> tagged `data-morph-to="<index>"`, and this file looks it up.
 *   - Scrubbing is `tl.seek(ms)` rather than `tl.progress(fraction)`.
 */

/**
 * anime.js accepts a plain `(t) => number` easing function (EasingParam includes EasingFunction),
 * so the board keeps exactly the same feel as lib/anim/rate.ts — no bezier approximation needed.
 */
const EASE = (t: number) => smooth(t);

export interface TimelineOp {
  kind: string;
  at: number;
  endAt?: number;
  /** `data-op` index — how the tween finds its element inside the SVG root. */
  index: number;
  /**
   * Target path `d` for a morph. anime.js cannot consume this string directly — it morphs
   * towards a DOM node — so GsapSketch also renders it as a hidden `[data-morph-to]` path and
   * this module morphs towards that. The string stays here because the renderer needs it to
   * build that element, and because it documents what the morph is aiming at.
   */
  morphTo?: string;
  /** Path `d` to travel along for a motion, rendered as a hidden `[data-motion-path]` element. */
  motionPath?: string;
}

type AnimeTimeline = ReturnType<typeof createTimeline>;

/**
 * Builds the timeline. `durationMs` is the DrawScript's own length in milliseconds; every op is
 * placed at `at * durationMs` so video-free playback keeps the same time axis the rest of the
 * pipeline assumes.
 */

function buildTimeline(root: SVGSVGElement, ops: TimelineOp[], durationMs: number): AnimeTimeline {
  const tl = createTimeline({ autoplay: false });
  // A zero-length timeline cannot be scrubbed; a bare timer child fixes the full span up front
  // so `seek(progress * duration)` maps onto the narration clock even before any op is placed.
  tl.add({ duration: durationMs }, 0);

  const el = (index: number) => root.querySelector<SVGElement>(`[data-op="${index}"]`);

  // Everything starts hidden. Without this an element is on screen from frame 0 — which
  // showed up immediately as an arrow whose head was visible long before the arrow was drawn.
  for (const op of ops) {
    const target = el(op.index);
    if (target) tl.set(target, { opacity: 0 }, 0);
  }

  for (const op of ops) {
    const target = el(op.index);
    if (!target) continue;
    const start = clamp01(op.at) * durationMs;
    // Emphasis manages its own opacity (it yoyos back to invisible); everything else becomes
    // visible when its moment arrives and then stays — marks must accumulate, never vanish.
    if (!["indicate", "circumscribe", "flash"].includes(op.kind)) {
      tl.set(target, { opacity: 1 }, start);
    }
    const end = typeof op.endAt === "number" ? clamp01(op.endAt) * durationMs : start + 700;
    const span = Math.max(250, end - start);

    switch (op.kind) {
      case "shape":
      case "arrow":
      case "underline":
      case "circleHighlight": {
        // Stroke draws itself on, then any fill settles after the outline — an outline that
        // fills before it closes reads as a blob appearing, not as something being drawn.
        const strokes = target.querySelectorAll<SVGElement>("path, line, polyline, polygon, circle, ellipse, rect");
        const drawables = svg.createDrawable(strokes.length ? Array.from(strokes) : [target]);
        tl.add(
          drawables,
          { draw: ["0 0", "0 1"], duration: span, ease: EASE, delay: stagger(span * 0.08) },
          start,
        );
        // Settle to the fill the markup ASKED for, not to 1. Animating to full opacity made
        // every shape a solid block, which swallowed any label sitting on top of it.
        const authoredFill = Number(target.getAttribute("fill-opacity") ?? "0.14") || 0.14;
        tl.add(
          target,
          { fillOpacity: [0, authoredFill], duration: span * 0.5, ease: EASE },
          start + span * 0.5,
        );
        break;
      }

      case "label":
      case "note":
      case "callout": {
        // Word-by-word, so text arrives at the pace it is spoken rather than as a block.
        const words = target.querySelectorAll<SVGElement>("[data-word]");
        const parts = words.length ? Array.from(words) : [target];
        tl.add(
          parts,
          {
            opacity: [0, 1],
            duration: span * 0.6,
            ease: EASE,
            delay: stagger((span * 0.4) / Math.max(1, parts.length)),
          },
          start,
        );
        break;
      }

      case "morph": {
        // The reason this port is worth doing: morphTo interpolates the PATH, extrapolating
        // points as needed, so a shape genuinely becomes another. The DrawScript `morph` op has
        // only ever moved things. anime.js morphs towards a NODE, so the destination lives in
        // the SVG's <defs> (rendered by GsapSketch) rather than being passed as a `d` string.
        const dest = root.querySelector<SVGPathElement>(`[data-morph-to="${op.index}"]`);
        if (dest) {
          tl.add(target, { d: svg.morphTo(dest), duration: span, ease: EASE }, start);
        }
        // Cross-fade the before/after labels across the change. Without this the silhouette
        // morphs in silence — the viewer sees a box become another box and is told nothing about
        // WHICH expression became which, and that text is the entire teaching point of the beat.
        const fromText = root.querySelector<SVGElement>(`[data-morph-text-from="${op.index}"]`);
        const toText = root.querySelector<SVGElement>(`[data-morph-text-to="${op.index}"]`);
        if (fromText) {
          tl.add(fromText, { opacity: [0, 1], duration: span * 0.25, ease: EASE }, start);
          tl.add(fromText, { opacity: [1, 0], duration: span * 0.4, ease: EASE }, start + span * 0.4);
        }
        if (toText) {
          tl.add(toText, { opacity: [0, 1], duration: span * 0.35, ease: EASE }, start + span * 0.6);
        }
        break;
      }

      case "motion": {
        const path = root.querySelector<SVGPathElement>(`[data-motion-path="${op.index}"]`);
        if (path) {
          tl.add(target, { ...svg.createMotionPath(path), duration: span, ease: EASE }, start);
        }
        break;
      }

      case "indicate":
      case "circumscribe":
      case "flash": {
        // Out and BACK. A signal that stays becomes noise: after three permanent highlights
        // nothing on the board is highlighted any more.
        //
        // transform-box/origin are set on the node rather than tweened: they are static CSS the
        // scale needs in order to grow from the shape's own centre, and on SVG the default
        // origin is the viewBox corner, which would fling the mark across the board.
        target.style.transformBox = "fill-box";
        target.style.transformOrigin = "center";
        tl.add(
          target,
          {
            opacity: [0, 1],
            scale: op.kind === "indicate" ? [1, 1.18] : 1,
            duration: span / 2,
            ease: EASE,
            alternate: true,
            loop: 1,
          },
          start,
        );
        break;
      }

      default:
        // Unknown kinds simply appear; better a plain reveal than nothing.
        tl.add(target, { opacity: [0, 1], duration: span, ease: EASE }, start);
    }
  }

  return tl;
}

/**
 * Wires a DrawScript to a scrubbable timeline.
 *
 * `progress` is the narration clock. Everything else — what is visible, how far a stroke has
 * drawn, whether a morph is half-way — is derived from it by GSAP.
 */
export function useDrawTimeline(
  rootRef: React.RefObject<SVGSVGElement | null>,
  ops: TimelineOp[],
  durationMs: number,
  progress: number,
) {
  const tlRef = useRef<AnimeTimeline | null>(null);
  // Rebuild only when the script's shape changes, not on every progress tick.
  const key = ops.map((o) => `${o.kind}:${o.at}:${o.index}`).join("|");

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    const tl = buildTimeline(root, ops, Math.max(500, durationMs));
    tlRef.current = tl;

    return () => {
      // revert() restores every property this timeline touched — including the stroke-dasharray
      // createDrawable writes onto each path — so StrictMode's double-invoke rebuilds from clean
      // markup instead of from a half-drawn board.
      tl.revert();
      tlRef.current = null;
    };
    // `key` stands in for the op list; the array identity changes every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, durationMs]);

  useLayoutEffect(() => {
    const tl = tlRef.current;
    if (!tl) return;
    // anime.js seeks in milliseconds, where GSAP took a 0-1 fraction.
    tl.seek(clamp01(progress) * tl.duration);
  }, [progress, key]);
}

/* ───────────────────────────────────────────────────────────────────────────────
 * PREVIOUS ENGINE — GSAP. Kept commented out rather than deleted.
 *
 * This project has no git history, so this block is the only way back if anime.js
 * disappoints on morph fidelity. `gsap` stays in package.json and /gsap-lab still
 * renders through the version of this file that shipped with it, so the two engines
 * can be compared side by side against the same three-morph fixture.
 *
 * To restore: swap the imports back to gsap/DrawSVGPlugin/MorphSVGPlugin/
 * MotionPathPlugin, restore ensurePlugins(), and note that the GSAP build works in
 * SECONDS (durationMs / 1000) and scrubs with tl.progress(fraction) rather than
 * tl.seek(milliseconds).
 *
 * import gsap from "gsap";
 * import { DrawSVGPlugin } from "gsap/DrawSVGPlugin";
 * import { MorphSVGPlugin } from "gsap/MorphSVGPlugin";
 * import { MotionPathPlugin } from "gsap/MotionPathPlugin";
 *
 * let registered = false;
 * function ensurePlugins() {
 *   // Plugins touch window; register lazily on the client only.
 *   if (registered || typeof window === "undefined") return;
 *   gsap.registerPlugin(DrawSVGPlugin, MorphSVGPlugin, MotionPathPlugin);
 *   registered = true;
 * }
 *
 * function buildTimeline(root: SVGSVGElement, ops: TimelineOp[], duration: number): gsap.core.Timeline {
 *   const tl = gsap.timeline({ paused: true });
 *   tl.to({}, { duration });
 *   const el = (index: number) => root.querySelector<SVGElement>(`[data-op="${index}"]`);
 *   for (const op of ops) {
 *     const target = el(op.index);
 *     if (target) tl.set(target, { opacity: 0 }, 0);
 *   }
 *   for (const op of ops) {
 *     const target = el(op.index);
 *     if (!target) continue;
 *     const start = clamp01(op.at) * duration;
 *     if (!["indicate", "circumscribe", "flash"].includes(op.kind)) {
 *       tl.set(target, { opacity: 1 }, start);
 *     }
 *     const end = typeof op.endAt === "number" ? clamp01(op.endAt) * duration : start + 0.7;
 *     const span = Math.max(0.25, end - start);
 *     switch (op.kind) {
 *       case "shape":
 *       case "arrow":
 *       case "underline":
 *       case "circleHighlight": {
 *         const strokes = target.querySelectorAll<SVGElement>("path, line, polyline, polygon, circle, ellipse, rect");
 *         const drawables = strokes.length ? Array.from(strokes) : [target];
 *         tl.fromTo(drawables, { drawSVG: "0%" }, { drawSVG: "100%", duration: span, ease: EASE, stagger: span * 0.08 }, start);
 *         const authoredFill = Number(target.getAttribute("fill-opacity") ?? "0.14") || 0.14;
 *         tl.fromTo(target, { fillOpacity: 0 }, { fillOpacity: authoredFill, duration: span * 0.5, ease: EASE }, start + span * 0.5);
 *         break;
 *       }
 *       case "label":
 *       case "note":
 *       case "callout": {
 *         const words = target.querySelectorAll<SVGElement>("[data-word]");
 *         const parts = words.length ? Array.from(words) : [target];
 *         tl.fromTo(parts, { opacity: 0 }, { opacity: 1, duration: span * 0.6, ease: EASE, stagger: (span * 0.4) / Math.max(1, parts.length) }, start);
 *         break;
 *       }
 *       case "morph": {
 *         // GSAP accepted the destination as a raw path `d` string — no DOM node needed.
 *         if (op.morphTo) tl.to(target, { morphSVG: op.morphTo, duration: span, ease: EASE }, start);
 *         break;
 *       }
 *       case "motion": {
 *         if (op.motionPath) tl.to(target, { motionPath: { path: op.motionPath, align: op.motionPath }, duration: span, ease: EASE }, start);
 *         break;
 *       }
 *       case "indicate":
 *       case "circumscribe":
 *       case "flash": {
 *         tl.fromTo(target, { opacity: 0, scale: 1 }, { opacity: 1, scale: op.kind === "indicate" ? 1.18 : 1, duration: span / 2, ease: EASE, yoyo: true, repeat: 1, transformOrigin: "center center" }, start);
 *         break;
 *       }
 *       default:
 *         tl.fromTo(target, { opacity: 0 }, { opacity: 1, duration: span, ease: EASE }, start);
 *     }
 *   }
 *   return tl;
 * }
 *
 * // Hook body, for reference:
 * //   const ctx = gsap.context(() => {
 * //     tlRef.current = buildTimeline(root, ops, Math.max(0.5, durationMs / 1000));
 * //   }, root);
 * //   return () => { ctx.revert(); tlRef.current = null; };
 * //   ...
 * //   tlRef.current?.progress(clamp01(progress));
 * ─────────────────────────────────────────────────────────────────────────────── */

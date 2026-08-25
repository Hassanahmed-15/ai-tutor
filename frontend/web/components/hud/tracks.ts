import type { PageName } from "./HudKit";

/**
 * ── Only the standard lecture is offered. ──
 *
 * The accessibility modes are defined below in `PLANNED_TRACKS` but deliberately excluded from
 * the exported `TRACKS`. Every mode surface in the app maps over `TRACKS`, so this one array is
 * the whole switch — no page needs a conditional and no player component was touched. The players
 * (BlindLessonPlayer, AdhdLessonPlayer, DyslexiaLessonPlayer, DysgraphiaLessonPlayer,
 * AutismLessonPlayer) remain on disk and functional.
 *
 * To re-enable a mode in the PICKER: move its entry from PLANNED_TRACKS into TRACKS and restore its
 * route case in app/page.tsx.
 *
 * ── ADHD is different, and deliberately so. ──
 *
 * It is PROFILE-ROUTED, NOT PICKER-LISTED. `ADHD_TRACK` is exported on its own below and is
 * intentionally absent from `TRACKS`, because every mode surface maps over `TRACKS` and adding it
 * there would offer the track to everyone. It must appear only for a learner whose saved profile is
 * `accessibility === "adhd"` — see `lib/adhd/gate.ts`, which owns that decision.
 */
export interface TrackMeta {
  id: string;
  name: string;
  tagline: string;
  description: string;
  detail: string;
  accent: string; // var(--accent-{mode}) — the solid emissive accent color
  glow: string; // var(--accent-{mode}-glow) — the same accent as a translucent glow, for tinted backgrounds
  glyph: string;
  page: PageName;
}

export const TRACKS: TrackMeta[] = [
  {
    id: "none",
    name: "Standard",
    tagline: "The full cinematic lecture",
    description: "Voice, a live hand-drawn whiteboard, synced visuals, checkpoints and recap.",
    detail:
      "The complete experience — a warm teacher voice narrating while concepts are drawn stroke by stroke, with real comprehension checkpoints along the way.",
    accent: "var(--accent-standard)",
    glow: "var(--accent-standard-glow)",
    glyph: "✦",
    page: "demo",
  },
];

/**
 * Built and working, but not currently offered in the UI. Kept rather than deleted so the copy,
 * accents and route names survive intact for when they are switched back on.
 */
export const PLANNED_TRACKS: TrackMeta[] = [
  {
    id: "blind",
    name: "Blind",
    tagline: "Audio-first, sound-rendered",
    description: "Spoken visuals, non-speech sonic cues, full keyboard control — usable with eyes closed.",
    detail:
      "Every diagram is described aloud as a structural picture, distinct sonic cues mark each moment, and the whole lecture is driven by keyboard alone — built to be fully usable without ever seeing the screen.",
    accent: "var(--accent-blind)",
    glow: "var(--accent-blind-glow)",
    glyph: "♪",
    page: "blind-demo",
  },
  {
    id: "deaf",
    name: "Deaf",
    tagline: "Caption-first, fully visual",
    description: "Every word captioned on screen, visual sound cues, and a hand-drawn board — no audio needed.",
    detail:
      "Nothing important lives in sound. The narration is captioned live under the board, non-speech audio cues become visual flashes, and the whole lesson is built to be followed with the volume off.",
    accent: "var(--accent-deaf)",
    glow: "var(--accent-deaf-glow)",
    glyph: "✋",
    page: "deaf-demo",
  },
  {
    id: "dyslexia",
    name: "Dyslexia",
    tagline: "Reading-light, audio-led",
    description: "Dyslexia-friendly font, dense text rewritten into short icon-paired lines, read aloud.",
    detail:
      "No walls of text. Every dense sentence is split into short, standalone lines paired with a simple icon, set in a dyslexia-friendly typeface, with audio carrying most of the meaning — calibrated to your reading level.",
    accent: "var(--accent-dyslexia)",
    glow: "var(--accent-dyslexia-glow)",
    glyph: "❧",
    page: "dyslexia-demo",
  },
];

/**
 * The ADHD track. Reached only through the profile (`lib/adhd/gate.ts`), never through a picker —
 * see the note at the top of this file. Exported separately from both TRACKS and PLANNED_TRACKS so
 * that its absence from the picker list cannot be "fixed" by someone who assumes it was an oversight.
 */
export const ADHD_TRACK: TrackMeta = {
    id: "adhd",
    name: "ADHD",
    tagline: "Attention-aware, camera-guided",
    description: "Real camera-based focus tracking that pauses the lesson the moment attention drifts.",
    detail:
      "A face-tracking model watches engagement in real time (entirely on your device). The instant focus drops below threshold, the lecture stops, holds, and waits for you to come back — no penalty, no lost place.",
    accent: "var(--accent-adhd)",
    glow: "var(--accent-adhd-glow)",
    glyph: "◎",
    /**
     * The STANDARD player, deliberately — not the separate `adhd-demo` one.
     *
     * ADHD does not change what a lecture looks like; it changes what happens around it. Routing to
     * a second player meant a visually different lesson AND a second component to keep in step,
     * and it silently cost the ADHD learner the Gemini Live tutor, which only LessonPlayer wires up.
     *
     * So the ADHD track renders the ordinary lesson and layers its own behaviour on top —
     * see components/adhd/AdhdLayer.tsx. AdhdLessonPlayer stays on disk and reachable, but nothing
     * routes to it.
     */
    page: "demo",
};

/** Shared between server and client: the lecture shape and the sentence clock every engine follows. */

export type Beat = { id: string; title: string; teachingPoint: string; script: string };
export type Lecture = { title: string; prompt: string; beats: Beat[] };

export const ENGINES = ["sandbox", "motion", "gsap", "remotion", "lottie"] as const;
export type Engine = (typeof ENGINES)[number];

export const ENGINE_INFO: Record<Engine, { label: string; blurb: string }> = {
  sandbox: { label: "React sandbox (production)", blurb: "Current pipeline: planner + generator + critic/refine loop, rendered by the real ReactAnimationSandbox." },
  motion: { label: "Motion (Framer Motion)", blurb: "One-shot React component; motion.* elements animate declaratively as the sentence index changes." },
  gsap: { label: "GSAP", blurb: "One-shot SVG + a paused GSAP timeline with a label per sentence; the host scrubs it." },
  remotion: { label: "Remotion", blurb: "One-shot frame-pure composition shown in @remotion/player (same frames an MP4 render would give)." },
  lottie: { label: "Lottie", blurb: "The model writes raw Lottie (Bodymovin) JSON; played by lottie-web." },
};

export type BoardResult = {
  engine: Engine;
  code: string | null;
  error: string | null;
  ms: number;
  costUsd: number;
  model: string;
  /** Extra production detail (critic score, refine rounds) for the sandbox column. */
  meta?: unknown;
};

export type Run = {
  id: string;
  createdAt: string;
  lecture: Lecture;
  boards: Record<string, Partial<Record<Engine, BoardResult>>>;
  /** The user's pick of the best board per beat (beat id → engine). */
  votes?: Record<string, Engine>;
};

/** Measured per board in the first runs (2026-09-29) — for the estimate shown before generating. */
export const TYPICAL: Record<Engine, { usd: number; s: number }> = {
  sandbox: { usd: 0.03, s: 60 },
  motion: { usd: 0.004, s: 20 },
  gsap: { usd: 0.004, s: 25 },
  remotion: { usd: 0.004, s: 25 },
  lottie: { usd: 0.007, s: 28 },
};

/** At most this many boards per engine are generated at once (the sandbox runs on the main dev server). */
export const CONCURRENCY: Record<Engine, number> = { sandbox: 3, motion: 4, gsap: 4, remotion: 4, lottie: 4 };

/** Remotion/Lottie frames per sentence (30 fps → 4 s), and the GSAP seconds the prompt asks for. */
export const FRAMES_PER_SENTENCE = 120;
export const FPS = 30;

/**
 * Splits exactly the way the production lab counts: one sentence per [.!?] run. Every engine
 * reveals by this index, so all columns stay on the same beat of the narration.
 */
export function sentences(script: string): string[] {
  const parts = script.match(/[^.!?]+[.!?]+["')\]]*/g)?.map((s) => s.trim()).filter(Boolean) ?? [];
  return parts.length ? parts : [script.trim()];
}

/** Mirrors sentenceStateFor in frontend/web/app/sandbox-lab/page.tsx. */
export function sentenceState(progress: number, total: number) {
  const scaled = Math.min(progress, 0.999999) * total;
  return {
    sentenceTotal: total,
    sentenceIndex: Math.min(total - 1, Math.floor(scaled)),
    sentenceProgress: progress >= 1 ? 1 : scaled - Math.floor(scaled),
  };
}

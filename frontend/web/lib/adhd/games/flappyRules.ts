/**
 * Flappy Gates — the physics and the course, with no canvas anywhere in this file.
 *
 * Same split as every rule module here, and for the same reason: a game whose behaviour lives inside
 * a render loop can only be checked by playing it and squinting, which means it never gets checked
 * again. The loop owns pixels; this owns everything that can be wrong.
 *
 * THE COURSE IS SEEDED FROM THE BEAT ID, so every checkpoint in a lesson is a different flight and
 * the same checkpoint replays identically. "Different each time" is a requirement, and a requirement
 * that depends on `Math.random()` is one nobody can test.
 *
 * FAILING IS NOT LOSING. Hitting an obstacle costs altitude and a moment, never the question: the
 * bird is nudged back and the flight continues. The learner is being asked what they know, and a
 * game that ends the question because their thumb was late is measuring the wrong thing.
 */

export type FlappyState = {
  /** Vertical position, 0 (top) to 1 (bottom), in field units. */
  y: number;
  /** Vertical velocity, field units per second. */
  vy: number;
  /** How far along the course, 0 to 1. At 1 the bird reaches the gates. */
  progress: number;
  /** Obstacles clipped this flight. Reported at the end, costs nothing. */
  bumps: number;
  /** Set once the bird has passed the gate line. */
  chosen: 0 | 1 | 2 | null;
  started: boolean;
};

export const FLAPPY_RULES = {
  GRAVITY: 1.9,
  /** Upward impulse from one flap. */
  FLAP: -0.62,
  /** Terminal velocities, so the bird never becomes unrecoverable in either direction. */
  MAX_FALL: 1.15,
  MAX_RISE: -0.9,
  /** Course length in seconds at normal pace. Long enough to read three gates, short enough to keep. */
  DURATION_S: 11,
  /** A clipped obstacle pushes the bird back toward the middle rather than ending the run. */
  BUMP_RECOVER: 0.35,
  /** Obstacle half-height, in field units. */
  GAP_HALF: 0.17,
} as const;

export function initialFlappy(): FlappyState {
  return { y: 0.5, vy: 0, progress: 0, bumps: 0, chosen: null, started: false };
}

export type FlappyEvent =
  | { type: "flap" }
  | { type: "tick"; dt: number; obstacles: Obstacle[] }
  | { type: "start" };

/** A wall with a hole in it, at a point along the course. */
export type Obstacle = {
  /** Position along the course, 0-1. */
  at: number;
  /** Centre of the gap, 0-1 vertically. */
  gap: number;
};

/**
 * Mulberry32 again. Deliberately the same generator as the other modules — a course is a payout
 * table by another name, and both need to replay exactly under a fixed seed.
 */
function rng(seed: number): () => number {
  let a = seed || 1;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Turn a beat id into a stable number, so the same checkpoint always flies the same course. */
export function seedFrom(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * Build the course.
 *
 * Obstacles stop well before the gates so the final approach is clear — the last thing a learner
 * should be doing before choosing an answer is reading, not dodging. Gaps are kept away from the
 * extremes because a gap at the very top or bottom is a reflex test, not a course.
 */
export function courseFor(seed: number, count = 6): Obstacle[] {
  const next = rng(seed);
  const out: Obstacle[] = [];
  for (let i = 0; i < count; i++) {
    // Spread across 0.12-0.72 so there is room to settle before the gates at 1.0.
    const at = 0.12 + (i / Math.max(1, count - 1)) * 0.6;
    out.push({ at, gap: 0.22 + next() * 0.56 });
  }
  return out;
}

export function applyFlappy(prev: FlappyState, event: FlappyEvent): FlappyState {
  if (prev.chosen !== null) return prev; // the flight is over; nothing can change the answer

  switch (event.type) {
    case "start":
      return { ...prev, started: true };

    case "flap":
      if (!prev.started) return { ...prev, started: true, vy: FLAPPY_RULES.FLAP };
      return { ...prev, vy: FLAPPY_RULES.FLAP };

    case "tick": {
      if (!prev.started) return prev;
      const dt = Math.min(event.dt, 0.05); // a backgrounded tab must not teleport the bird
      let vy = prev.vy + FLAPPY_RULES.GRAVITY * dt;
      vy = Math.max(FLAPPY_RULES.MAX_RISE, Math.min(FLAPPY_RULES.MAX_FALL, vy));
      let y = prev.y + vy * dt;

      // The ceiling and floor stop the bird rather than ending it.
      if (y < 0.03) { y = 0.03; vy = 0; }
      if (y > 0.97) { y = 0.97; vy = 0; }

      const progress = Math.min(1, prev.progress + dt / FLAPPY_RULES.DURATION_S);

      // A clipped obstacle: nudge back toward its gap and count it. Never fatal.
      let bumps = prev.bumps;
      for (const o of event.obstacles) {
        const crossing = prev.progress < o.at && progress >= o.at;
        if (crossing && Math.abs(y - o.gap) > FLAPPY_RULES.GAP_HALF) {
          bumps += 1;
          y = y + (o.gap - y) * FLAPPY_RULES.BUMP_RECOVER;
          vy = 0;
        }
      }

      // At the end of the course the bird's height picks the gate: thirds, top to bottom.
      const chosen = progress >= 1 ? ((y < 1 / 3 ? 0 : y < 2 / 3 ? 1 : 2) as 0 | 1 | 2) : null;
      return { ...prev, y, vy, progress, bumps, chosen };
    }
  }
}

/** Which gate a given height would choose. Exposed so the UI can highlight the one in reach. */
export function gateAt(y: number): 0 | 1 | 2 {
  return (y < 1 / 3 ? 0 : y < 2 / 3 ? 1 : 2) as 0 | 1 | 2;
}

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
 * THE TILES ARE GUIDE RAILS, NOT GROUND. Three trails fan out toward the three answers; flying over
 * a tile lights it, so the learner can SEE which answer they are committing to and correct early.
 * Drifting off a trail costs nothing but the light. Nothing here can fail a learner who knew the
 * answer and tapped late — that would measure dexterity, and the question is about the content.
 */

export type FlappyState = {
  /** Vertical position, 0 (top) to 1 (bottom), in field units. */
  y: number;
  /** Vertical velocity, field units per second. */
  vy: number;
  /** How far along the course, 0 to 1. At 1 the bird reaches the gates. */
  progress: number;
  /** Tiles lit, per trail — the running signal of which answer is being flown toward. */
  lit: [number, number, number];
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
  /** How close the bird must pass to a tile to light it. Generous — this is a guide, not a target. */
  TILE_REACH: 0.11,
  /** Tiles per trail. Enough to read as a route, few enough to stay uncluttered. */
  TILES_PER_PATH: 7,
} as const;

export function initialFlappy(): FlappyState {
  return { y: 0.5, vy: 0, progress: 0, lit: [0, 0, 0], chosen: null, started: false };
}

export type FlappyEvent =
  | { type: "flap" }
  | { type: "tick"; dt: number; paths: TilePath[] }
  | { type: "start" };

/** One tile on a trail. */
export type Tile = {
  /** Position along the course, 0-1. */
  at: number;
  /** Height, 0-1. */
  y: number;
};

/** The route to one answer: tiles fanning from a shared start toward that gate's height. */
export type TilePath = {
  /** Which answer this trail leads to. */
  gate: 0 | 1 | 2;
  tiles: Tile[];
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
 * Build the three trails.
 *
 * All three start together near the bird's spawn height and fan out to the centre of their own gate,
 * so the choice is visibly open at the start and visibly committed by the end. The wobble is seeded,
 * which is what makes each checkpoint a different-looking route without making any of them harder.
 */
export function pathsFor(seed: number): TilePath[] {
  const next = rng(seed);
  const gateCentres = [1 / 6, 1 / 2, 5 / 6];

  return ([0, 1, 2] as const).map((gate) => {
    // Each trail gets its own wobble, or all three would ripple in unison and read as one ribbon.
    const wobble = 0.02 + next() * 0.04;
    const phase = next() * Math.PI * 2;
    const tiles: Tile[] = [];
    for (let i = 0; i < FLAPPY_RULES.TILES_PER_PATH; i++) {
      const t = i / (FLAPPY_RULES.TILES_PER_PATH - 1);
      // Eased fan-out: together at the start, fully separated well before the gates so the last
      // stretch is a clear run at one answer rather than a scramble between two.
      const spread = t * t * (3 - 2 * t);
      const y = 0.5 + (gateCentres[gate] - 0.5) * spread + Math.sin(phase + t * 5) * wobble * (1 - spread);
      tiles.push({ at: 0.1 + t * 0.72, y: Math.max(0.08, Math.min(0.92, y)) });
    }
    return { gate, tiles };
  });
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

      // Light any tile just flown past. Purely feedback: nothing here moves the bird or ends
      // anything, which is what makes the trails a guide rather than an obstacle.
      const lit: [number, number, number] = [...prev.lit];
      for (const path of event.paths) {
        for (const tile of path.tiles) {
          const crossing = prev.progress < tile.at && progress >= tile.at;
          if (crossing && Math.abs(y - tile.y) <= FLAPPY_RULES.TILE_REACH) lit[path.gate] += 1;
        }
      }

      // At the end of the course the bird's height picks the gate: thirds, top to bottom.
      const chosen = progress >= 1 ? ((y < 1 / 3 ? 0 : y < 2 / 3 ? 1 : 2) as 0 | 1 | 2) : null;
      return { ...prev, y, vy, progress, lit, chosen };
    }
  }
}

/** Which gate a given height would choose. Exposed so the UI can highlight the one in reach. */
export function gateAt(y: number): 0 | 1 | 2 {
  return (y < 1 / 3 ? 0 : y < 2 / 3 ? 1 : 2) as 0 | 1 | 2;
}

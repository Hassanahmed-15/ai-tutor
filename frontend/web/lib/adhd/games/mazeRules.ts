/**
 * The checkpoint maze — walls, movement and answering, with no canvas anywhere in this file.
 *
 * Same split as every rule module here: the loop owns pixels, this owns everything that can be
 * wrong. A maze that walls off an answer would fail a learner who knew it, and that is not something
 * you can check by playing a few rounds and hoping.
 *
 * WHY A RECURSIVE BACKTRACKER. It produces a PERFECT maze — exactly one path between any two cells,
 * no loops, no sealed-off regions. That is not an aesthetic choice: it is what makes "every answer
 * is reachable" true by construction rather than by luck, and it is why the reachability test below
 * can be a proof rather than a spot check.
 */

/** Wall bits, one per side of a cell. */
export const N = 1;
export const E = 2;
export const S = 4;
export const W = 8;

export type Dir = "up" | "down" | "left" | "right";
export type Cell = { x: number; y: number };

export type Maze = {
  size: number;
  /** `walls[y][x]` is a bitmask of the sides of that cell which are solid. */
  walls: number[][];
  start: Cell;
  /** One per answer, in option order. */
  answers: [Cell, Cell, Cell];
};

export type MazeState = {
  at: Cell;
  /** Cells visited, for the breadcrumb trail. */
  trail: Cell[];
  moves: number;
  /** The answer stepped on, once one has been. */
  chosen: 0 | 1 | 2 | null;
};

export const MAZE_RULES = {
  /** Odd, so there is a true centre cell to start from. 13 matches the density of a paper maze. */
  SIZE: 13,
} as const;

const DELTA: Record<Dir, { dx: number; dy: number; wall: number; opposite: number }> = {
  up: { dx: 0, dy: -1, wall: N, opposite: S },
  down: { dx: 0, dy: 1, wall: S, opposite: N },
  left: { dx: -1, dy: 0, wall: W, opposite: E },
  right: { dx: 1, dy: 0, wall: E, opposite: W },
};

/** Mulberry32 — the same generator as the other rule modules, for the same reason: replayability. */
function rng(seed: number): () => number {
  let a = seed || 1;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Turn a beat id into a stable number, so the same checkpoint always draws the same maze. */
export function seedFrom(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * Carve a maze.
 *
 * Every cell starts fully walled and the carver knocks down walls as it goes, so the outer boundary
 * is closed for free — it is simply the set of walls no carve ever reached. The player cannot leave
 * the grid because there is nowhere to leave through, not because a bounds check says so.
 */
export function mazeFor(seed: number, size = MAZE_RULES.SIZE): Maze {
  const next = rng(seed);
  const walls = Array.from({ length: size }, () => Array.from({ length: size }, () => N | E | S | W));
  const seen = Array.from({ length: size }, () => Array.from({ length: size }, () => false));

  // Iterative, not recursive: a 13x13 is fine either way, but a stack cannot blow up on a bigger one.
  const start: Cell = { x: (size - 1) / 2 | 0, y: (size - 1) / 2 | 0 };
  const stack: Cell[] = [start];
  seen[start.y][start.x] = true;

  while (stack.length) {
    const cur = stack[stack.length - 1];
    const options = (Object.keys(DELTA) as Dir[]).filter((d) => {
      const nx = cur.x + DELTA[d].dx;
      const ny = cur.y + DELTA[d].dy;
      return nx >= 0 && ny >= 0 && nx < size && ny < size && !seen[ny][nx];
    });

    if (!options.length) {
      stack.pop();
      continue;
    }
    const dir = options[Math.floor(next() * options.length)];
    const { dx, dy, wall, opposite } = DELTA[dir];
    const nx = cur.x + dx;
    const ny = cur.y + dy;
    // Both sides come down. Leaving the neighbour's wall standing makes a one-way passage, which
    // reads as a rendering glitch and can strand a player who walks through it.
    walls[cur.y][cur.x] &= ~wall;
    walls[ny][nx] &= ~opposite;
    seen[ny][nx] = true;
    stack.push({ x: nx, y: ny });
  }

  const maze: Maze = {
    size,
    walls,
    start,
    // Placed below. Three corners, leaving the fourth clear so it never looks symmetrical.
    answers: [{ x: 0, y: 0 }, { x: size - 1, y: 0 }, { x: size - 1, y: size - 1 }],
  };
  maze.answers = placeAnswers(maze);
  return maze;
}

/** How many sides of a cell are open. */
function degree(maze: Maze, c: Cell): number {
  return (["up", "down", "left", "right"] as Dir[]).filter((d) => !blocked(maze, c, d)).length;
}

/**
 * Put each answer on the DEAD END nearest its corner, not on the corner itself.
 *
 * Found by testing, and it is the whole reason this function exists: in a perfect maze a corner can
 * sit on the through-route to somewhere else, so walking to answer A could pass across answer B's
 * cell and commit B instead. A dead end has one opening — you can enter it and leave the way you
 * came, and no route to anywhere else can cross it. That makes "stepping on an answer commits it"
 * safe rather than a trap.
 *
 * Sealing a corner down to one opening would have worked too, and would have split the maze in two:
 * a perfect maze is a tree, so removing any edge disconnects it.
 */
function placeAnswers(maze: Maze): [Cell, Cell, Cell] {
  const last = maze.size - 1;
  const corners: Cell[] = [{ x: 0, y: 0 }, { x: last, y: 0 }, { x: last, y: last }];

  const deadEnds: Cell[] = [];
  for (let y = 0; y < maze.size; y++) {
    for (let x = 0; x < maze.size; x++) {
      const cell = { x, y };
      if (x === maze.start.x && y === maze.start.y) continue;
      if (degree(maze, cell) === 1) deadEnds.push(cell);
    }
  }

  const taken = new Set<string>();
  const chosen = corners.map((corner) => {
    const near = deadEnds
      .filter((d) => !taken.has(`${d.x},${d.y}`))
      .sort((a, b) =>
        (Math.abs(a.x - corner.x) + Math.abs(a.y - corner.y)) -
        (Math.abs(b.x - corner.x) + Math.abs(b.y - corner.y)))[0];
    // A 13x13 backtracker always leaves plenty of dead ends; the corner is a last resort so this
    // can never return fewer than three answers.
    const pick = near ?? corner;
    taken.add(`${pick.x},${pick.y}`);
    return pick;
  });

  return chosen as [Cell, Cell, Cell];
}

export function initialMaze(maze: Maze): MazeState {
  return { at: { ...maze.start }, trail: [{ ...maze.start }], moves: 0, chosen: null };
}

/** Is there a wall between this cell and the neighbour in that direction? */
export function blocked(maze: Maze, at: Cell, dir: Dir): boolean {
  const { dx, dy, wall } = DELTA[dir];
  if ((maze.walls[at.y][at.x] & wall) !== 0) return true;
  // Defensive, and honestly unreachable: the carver never opens an outer wall, so the wall bit above
  // already stops anything at the edge — no mutation of this line can fail a test. Kept because a
  // future generator that punches an entrance would otherwise let the player walk off the grid.
  const nx = at.x + dx;
  const ny = at.y + dy;
  return nx < 0 || ny < 0 || nx >= maze.size || ny >= maze.size;
}

/**
 * Take one step.
 *
 * A no-op when a wall is in the way or the run is over — never a partial move, never a wrap. Landing
 * on an answer commits it: the corners are far apart and behind walls, so arriving at one is already
 * a deliberate act rather than something a stray key press can do.
 */
export function move(maze: Maze, state: MazeState, dir: Dir): MazeState {
  if (state.chosen !== null) return state;
  if (blocked(maze, state.at, dir)) return state;

  const { dx, dy } = DELTA[dir];
  const at: Cell = { x: state.at.x + dx, y: state.at.y + dy };
  const answer = maze.answers.findIndex((a) => a.x === at.x && a.y === at.y);

  return {
    at,
    trail: [...state.trail, at],
    moves: state.moves + 1,
    chosen: answer >= 0 ? (answer as 0 | 1 | 2) : null,
  };
}

/**
 * Every cell the player can actually get to, by flood fill.
 *
 * Exported for the tests, and it is the only honest way to assert that an answer is reachable: a
 * maze that walls one off would fail a learner who knew it, and no amount of playing proves the
 * absence of that.
 */
export function reachable(maze: Maze, from: Cell = maze.start): Set<string> {
  const seen = new Set<string>([`${from.x},${from.y}`]);
  const queue: Cell[] = [from];
  while (queue.length) {
    const cur = queue.shift()!;
    for (const dir of Object.keys(DELTA) as Dir[]) {
      if (blocked(maze, cur, dir)) continue;
      const nxt = { x: cur.x + DELTA[dir].dx, y: cur.y + DELTA[dir].dy };
      const key = `${nxt.x},${nxt.y}`;
      if (seen.has(key)) continue;
      seen.add(key);
      queue.push(nxt);
    }
  }
  return seen;
}

/** The arrow/WASD key names this game answers to. Shared with the component so they cannot drift. */
export function dirForKey(code: string): Dir | null {
  switch (code) {
    case "ArrowUp": case "KeyW": return "up";
    case "ArrowDown": case "KeyS": return "down";
    case "ArrowLeft": case "KeyA": return "left";
    case "ArrowRight": case "KeyD": return "right";
    default: return null;
  }
}

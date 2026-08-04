/**
 * Layout helpers — Manim's `VGroup.arrange()` for the board's 0-100 grid.
 *
 * Spacing was previously re-derived at every call site: LiveSketch's CycleScene and
 * AnimatedScene's CycleScene each compute the same ring trigonometry from scratch, and every
 * row/column template hand-rolls its own gap arithmetic. That is why two components that draw
 * "the same" cycle diagram don't actually agree on where the nodes sit.
 *
 * All coordinates are on the DrawScript 0-100 grid (LiveSketch maps that onto a 1000x560
 * viewBox), and every function keeps its result inside a safe margin so a long list degrades
 * by getting tighter rather than by running off the board.
 */

export interface Point {
  x: number;
  y: number;
}

/** Content bounds every arrangement stays inside — matches the prompt's x:8-92, y:8-92 rule. */
export const SAFE = { minX: 8, maxX: 92, minY: 8, maxY: 92 } as const;

function clampToSafe(p: Point): Point {
  return {
    x: Math.max(SAFE.minX, Math.min(SAFE.maxX, p.x)),
    y: Math.max(SAFE.minY, Math.min(SAFE.maxY, p.y)),
  };
}

export interface RowOptions {
  /** Centre of the row. */
  center?: Point;
  /** Desired gap between item centres. Shrinks automatically if the row would overflow. */
  buff?: number;
}

/**
 * Evenly spaced along a horizontal line, centred on `center` — Manim's `arrange(RIGHT)`.
 *
 * `buff` is a request, not a guarantee: if `n` items at that spacing would leave the safe
 * area the whole row is compressed to fit. A cramped row still teaches; a row whose last
 * two items are off-screen does not.
 */
export function arrangeRow(n: number, options: RowOptions = {}): Point[] {
  const { center = { x: 50, y: 50 }, buff = 20 } = options;
  if (n <= 0) return [];
  if (n === 1) return [clampToSafe(center)];
  const maxSpan = SAFE.maxX - SAFE.minX;
  const spacing = Math.min(buff, maxSpan / (n - 1));
  const start = center.x - (spacing * (n - 1)) / 2;
  return Array.from({ length: n }, (_, i) => clampToSafe({ x: start + i * spacing, y: center.y }));
}

/** Evenly spaced down a vertical line — Manim's `arrange(DOWN)`. */
export function arrangeColumn(n: number, options: RowOptions = {}): Point[] {
  const { center = { x: 50, y: 50 }, buff = 16 } = options;
  if (n <= 0) return [];
  if (n === 1) return [clampToSafe(center)];
  const maxSpan = SAFE.maxY - SAFE.minY;
  const spacing = Math.min(buff, maxSpan / (n - 1));
  const start = center.y - (spacing * (n - 1)) / 2;
  return Array.from({ length: n }, (_, i) => clampToSafe({ x: center.x, y: start + i * spacing }));
}

export interface RadialOptions {
  center?: Point;
  radius?: number;
  /** Where item 0 sits, in degrees clockwise from twelve o'clock. */
  startAngle?: number;
}

/**
 * Evenly spaced around a ring, item 0 at the top by default.
 *
 * This is the trigonometry currently written twice (AnimatedScene's CycleScene and
 * LiveSketch's CycleScene), in two coordinate systems, with two different start angles — so
 * the two renderers disagree about which node is "first". Starting at twelve o'clock and
 * going clockwise is the convention a reader expects from a cycle diagram.
 */
export function arrangeRadial(n: number, options: RadialOptions = {}): Point[] {
  const { center = { x: 50, y: 50 }, radius = 30, startAngle = 0 } = options;
  if (n <= 0) return [];
  const offset = (startAngle * Math.PI) / 180 - Math.PI / 2;
  // The board is wider than it is tall (1000x560), so an equal-radius ring in grid units
  // renders as a tall oval. Squashing y keeps it visually circular.
  const yScale = 0.62;
  return Array.from({ length: n }, (_, i) => {
    const angle = (i / n) * Math.PI * 2 + offset;
    return clampToSafe({
      x: center.x + Math.cos(angle) * radius,
      y: center.y + Math.sin(angle) * radius * yScale,
    });
  });
}

export interface GridOptions {
  center?: Point;
  columns?: number;
  buffX?: number;
  buffY?: number;
}

/** Row-major grid — Manim's `arrange_in_grid`. Columns default to a near-square layout. */
export function arrangeGrid(n: number, options: GridOptions = {}): Point[] {
  const { center = { x: 50, y: 50 }, buffX = 22, buffY = 18 } = options;
  if (n <= 0) return [];
  const columns = Math.max(1, options.columns ?? Math.ceil(Math.sqrt(n)));
  const rows = Math.ceil(n / columns);
  const spacingX = Math.min(buffX, (SAFE.maxX - SAFE.minX) / Math.max(1, columns - 1));
  const spacingY = Math.min(buffY, (SAFE.maxY - SAFE.minY) / Math.max(1, rows - 1));
  const startX = center.x - (spacingX * (columns - 1)) / 2;
  const startY = center.y - (spacingY * (rows - 1)) / 2;
  return Array.from({ length: n }, (_, i) =>
    clampToSafe({
      x: startX + (i % columns) * spacingX,
      y: startY + Math.floor(i / columns) * spacingY,
    }),
  );
}

/**
 * Picks a row or a column depending on how many items there are.
 *
 * Several templates already do this by hand (`const vertical = steps.length > 4`), each with
 * its own threshold. Four is the point past which a horizontal row of labelled cards stops
 * fitting on a 1000-wide board.
 */
export function arrangeFlow(n: number, options: RowOptions = {}): Point[] {
  return n > 4 ? arrangeColumn(n, options) : arrangeRow(n, options);
}

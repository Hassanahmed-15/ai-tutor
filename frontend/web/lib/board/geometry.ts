/**
 * WHERE THE BOARD ACTUALLY IS ON SCREEN.
 *
 * Two problems this solves, both visible in the old board:
 *
 *   1. ANNOTATIONS DRIFTED. Pen strokes were stored in screen pixels and highlights in
 *      element-relative 0..1, but the drawing itself is a 1000x560 viewBox letterboxed with
 *      `xMidYMid meet`. So a mark made beside a label moved away from that label as soon as the
 *      window changed shape — the element box and the CONTENT box are different rectangles, and
 *      only the content box follows the diagram.
 *
 *   2. OVERLAYS FLOATED IN DEAD SPACE. The corner pills anchored to the container, not the drawing,
 *      so on a tall window they sat out in the black letterbox bars, far from the board they
 *      annotate.
 *
 * `contentBox` gives the rectangle the drawing genuinely occupies. Everything — annotations,
 * labels, chips — positions against that, so it all stays glued to the diagram at any window size.
 *
 * FILL vs LETTERBOX. The board is authored at 1000x560 but now FILLS the space it is given rather
 * than letterboxing into it: `fillFrame` widens or heightens the viewBox around the same centre so
 * the drawn content keeps its scale and the extra room becomes margin. Authored content never
 * distorts (that would need a non-uniform scale, which we deliberately do not do) and there are no
 * black bars for overlays to strand themselves in.
 */

export const AUTHORED_WIDTH = 1000;
export const AUTHORED_HEIGHT = 560;

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * The viewBox to use so the authored frame FILLS a container of the given size.
 *
 * The authored 1000x560 always remains fully visible and centred; whichever axis has spare room is
 * extended symmetrically. With `meet` semantics this is equivalent to letterboxing, except the
 * slack is inside the coordinate system — so content can spill into it deliberately, and anything
 * positioned by these coordinates lands on real pixels rather than in a black bar.
 */
export function fillFrame(containerWidth: number, containerHeight: number): Rect {
  if (!(containerWidth > 0) || !(containerHeight > 0)) {
    return { x: 0, y: 0, width: AUTHORED_WIDTH, height: AUTHORED_HEIGHT };
  }
  const containerAspect = containerWidth / containerHeight;
  const authoredAspect = AUTHORED_WIDTH / AUTHORED_HEIGHT;
  if (containerAspect > authoredAspect) {
    // Wider than authored: grow the viewBox horizontally, centred.
    const width = AUTHORED_HEIGHT * containerAspect;
    return { x: (AUTHORED_WIDTH - width) / 2, y: 0, width, height: AUTHORED_HEIGHT };
  }
  const height = AUTHORED_WIDTH / containerAspect;
  return { x: 0, y: (AUTHORED_HEIGHT - height) / 2, width: AUTHORED_WIDTH, height };
}

/**
 * The on-screen rectangle the AUTHORED content occupies inside a container.
 *
 * With `fillFrame` the viewBox matches the container's aspect, so the authored 1000x560 is centred
 * with margin around it. This is the box annotations and chips must use — not the container.
 */
export function contentBox(containerWidth: number, containerHeight: number): Rect {
  if (!(containerWidth > 0) || !(containerHeight > 0)) return { x: 0, y: 0, width: 0, height: 0 };
  const scale = Math.min(containerWidth / AUTHORED_WIDTH, containerHeight / AUTHORED_HEIGHT);
  const width = AUTHORED_WIDTH * scale;
  const height = AUTHORED_HEIGHT * scale;
  return { x: (containerWidth - width) / 2, y: (containerHeight - height) / 2, width, height };
}

/** A pointer event's position, in board space (0..1 across the authored content). */
export function toBoardSpace(
  clientX: number,
  clientY: number,
  container: { left: number; top: number; width: number; height: number },
): { x: number; y: number } {
  const box = contentBox(container.width, container.height);
  if (box.width <= 0 || box.height <= 0) return { x: 0, y: 0 };
  return {
    x: (clientX - container.left - box.x) / box.width,
    y: (clientY - container.top - box.y) / box.height,
  };
}

/** Board space back to pixels within the container — for drawing the marks again after a resize. */
export function toContainerSpace(
  point: { x: number; y: number },
  containerWidth: number,
  containerHeight: number,
): { x: number; y: number } {
  const box = contentBox(containerWidth, containerHeight);
  return { x: box.x + point.x * box.width, y: box.y + point.y * box.height };
}

/**
 * THE LIVE FRAME. A sandboxed board no longer shows its authored 1000x560 letterboxed into its pane:
 * the host fits the viewBox to the drawing's ink and the pane's aspect (lib/anim/sandboxLayout.ts,
 * fitBoardToPane), so the PDF split view's near-square column is filled rather than 40% empty. The
 * authored frame then sits wherever that viewBox puts it — larger than the pane, offset, partly off
 * screen. `contentBox` above assumes the old letterbox; marks drawn with it would slide off the part
 * they were made on.
 *
 * This is the on-screen rectangle of the AUTHORED frame for a board drawn through `viewBox` into
 * `viewport` with `xMidYMid meet` (the sandbox always sets it). Board space stays what it always
 * was — 0..1 across the authored frame — so stored marks keep their meaning; only the mapping to
 * pixels follows the live viewBox.
 */
export function authoredRectIn(
  viewBox: Rect,
  viewport: Rect,
  authored: Rect = { x: 0, y: 0, width: AUTHORED_WIDTH, height: AUTHORED_HEIGHT },
): Rect {
  if (!(viewBox.width > 0) || !(viewBox.height > 0) || !(viewport.width > 0) || !(viewport.height > 0)) {
    return { x: viewport.x, y: viewport.y, width: 0, height: 0 };
  }
  const scale = Math.min(viewport.width / viewBox.width, viewport.height / viewBox.height);
  const originX = viewport.x + (viewport.width - viewBox.width * scale) / 2 - viewBox.x * scale;
  const originY = viewport.y + (viewport.height - viewBox.height * scale) / 2 - viewBox.y * scale;
  return {
    x: originX + authored.x * scale,
    y: originY + authored.y * scale,
    width: authored.width * scale,
    height: authored.height * scale,
  };
}

/** A container-relative pixel point in board space, through an explicit authored-frame rectangle. */
export function toBoardSpaceThrough(x: number, y: number, authoredRect: Rect): { x: number; y: number } {
  if (!(authoredRect.width > 0) || !(authoredRect.height > 0)) return { x: 0, y: 0 };
  return { x: (x - authoredRect.x) / authoredRect.width, y: (y - authoredRect.y) / authoredRect.height };
}

/** Is a pixel point inside a rectangle? For "is this mark on the visible board", once the board fills its pane. */
export function pointInRect(x: number, y: number, rect: Rect): boolean {
  return x >= rect.x && x <= rect.x + rect.width && y >= rect.y && y <= rect.y + rect.height;
}

/** Is this board-space point actually on the drawing? Used to ignore marks made in the margin. */
export function withinBoard(point: { x: number; y: number }): boolean {
  return point.x >= 0 && point.x <= 1 && point.y >= 0 && point.y <= 1;
}

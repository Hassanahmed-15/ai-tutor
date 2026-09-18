/**
 * Measuring the CONNECTORS on a generated board — the lines, arrows and leader strokes.
 *
 * WHY THIS EXISTS. `critiqueLayout` in lib/reactAnimationVisionCritic.ts measures `<text>` against
 * `<text>`: it catches a label printed on top of another label, and a label pushed outside the
 * frame. It has never looked at a single line, so the one failure it cannot see is a stroke drawn
 * straight through a label — which is exactly what shipped on a reinforcement-learning board, where
 * the leader line from a state node ran through the words "state = position" and left both
 * unreadable. Neither vision critic covered it either: one is scoped to "is the subject
 * recognizable", the other to textbook internal structure.
 *
 * So this is the missing measurement, and it is deliberately arithmetic rather than another model
 * call: a line crossing a rectangle is geometry, and asking a vision model to judge it would be
 * slower, dearer and less certain than computing it.
 *
 * CONSERVATIVE ON PURPOSE. A rejection here costs a regeneration, so every rule under-reports rather
 * than over-reports. Label boxes are shrunk before testing, so a leader line that correctly ENDS at
 * its label is never mistaken for one ploughing through it; curves are approximated only by points
 * that genuinely lie on them; and filled paths are skipped because they are artwork, not connectors.
 *
 * Everything is pure string and number work — no renderer, no client — so each rule is assertable.
 */

export type Box = { text: string; x: number; y: number; w: number; h: number };
export type Segment = { x1: number; y1: number; x2: number; y2: number };
/** Somewhere a connector may legitimately begin or end: a node, a box, a drawn part. */
export type Anchor = { x: number; y: number; r: number };

export const CONNECTOR_RULES = {
  /**
   * How far inside a label a stroke must reach before it counts as crossing it.
   *
   * A leader line is SUPPOSED to touch its label — that is what a leader line is. Only a stroke that
   * continues into the body of the text makes it unreadable, so the box is shrunk by this margin
   * before testing and a line stopping at the edge passes untouched.
   */
  LABEL_INSET: 6,
  /** Hairlines are underlines and rules, not connectors, and may legitimately sit against text. */
  MIN_SEGMENT_LENGTH: 18,
  /** How close an endpoint must come to a label or a shape to count as attached to something. */
  ENDPOINT_TOLERANCE: 26,
  /**
   * Biggest a filled shape can be and still be an arrowhead rather than artwork.
   *
   * Filled paths are skipped as drawing, which is right for a leaf or an organ and wrong for the
   * solid triangle on the end of an arrow: measured on a generated state diagram, the stroke stopped
   * short of the label while its HEAD sat squarely on the word "next state". The arrow still
   * collided with the text; only the part that collided was filled.
   */
  ARROWHEAD_MAX_SPAN: 34,
} as const;

function toNumber(value: string | undefined): number | null {
  if (value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function attr(attrs: string, name: string): number | null {
  return toNumber(new RegExp(`\\b${name}\\s*=\\s*"([-\\d.eE+]+)"`).exec(attrs)?.[1]);
}

/** Consecutive coordinate pairs as segments, skipping anything too short to be a connector. */
function pointsToSegments(points: Array<[number, number]>): Segment[] {
  const segments: Segment[] = [];
  for (let i = 1; i < points.length; i += 1) {
    const [x1, y1] = points[i - 1];
    const [x2, y2] = points[i];
    if (Math.hypot(x2 - x1, y2 - y1) >= CONNECTOR_RULES.MIN_SEGMENT_LENGTH) {
      segments.push({ x1, y1, x2, y2 });
    }
  }
  return segments;
}

/**
 * The on-curve points of a path's data.
 *
 * CONTROL POINTS ARE DISCARDED. A cubic's handles routinely sit far from the curve they bend, so
 * treating them as vertices would invent geometry the board never draws and reject a board for a
 * crossing that is not there. Taking only the endpoint of each command gives a coarse polyline that
 * always follows the real stroke — less precise, and wrong in the safe direction.
 */
export function pathOnCurvePoints(d: string): Array<[number, number]> {
  const points: Array<[number, number]> = [];
  const commands = d.match(/[MmLlHhVvCcSsQqTtAaZz][^MmLlHhVvCcSsQqTtAaZz]*/g) ?? [];
  let cx = 0;
  let cy = 0;

  for (const command of commands) {
    const type = command[0];
    const upper = type.toUpperCase();
    if (upper === "Z") continue;
    const relative = type !== upper;
    const nums = (command.slice(1).match(/-?[\d.]+(?:[eE][-+]?\d+)?/g) ?? [])
      .map(Number)
      .filter(Number.isFinite);
    if (nums.length === 0) continue;

    if (upper === "H") {
      const last = nums[nums.length - 1];
      cx = relative ? cx + last : last;
      points.push([cx, cy]);
      continue;
    }
    if (upper === "V") {
      const last = nums[nums.length - 1];
      cy = relative ? cy + last : last;
      points.push([cx, cy]);
      continue;
    }
    if (nums.length < 2) continue;
    // Every remaining command ends at its final coordinate pair, whatever precedes it.
    const ex = nums[nums.length - 2];
    const ey = nums[nums.length - 1];
    cx = relative ? cx + ex : ex;
    cy = relative ? cy + ey : ey;
    points.push([cx, cy]);
  }

  return points;
}

/** Every connector stroke on the board, as straight segments. */
export function parseConnectors(svg: string): Segment[] {
  const segments: Segment[] = [];

  for (const match of svg.matchAll(/<line\b([^>]*)>/g)) {
    const a = match[1];
    const x1 = attr(a, "x1");
    const y1 = attr(a, "y1");
    const x2 = attr(a, "x2");
    const y2 = attr(a, "y2");
    if (x1 === null || y1 === null || x2 === null || y2 === null) continue;
    if (Math.hypot(x2 - x1, y2 - y1) >= CONNECTOR_RULES.MIN_SEGMENT_LENGTH) {
      segments.push({ x1, y1, x2, y2 });
    }
  }

  for (const match of svg.matchAll(/<polyline\b([^>]*)>/g)) {
    const raw = /\bpoints\s*=\s*"([^"]*)"/.exec(match[1])?.[1];
    if (!raw) continue;
    const nums = (raw.match(/-?[\d.]+/g) ?? []).map(Number);
    const points: Array<[number, number]> = [];
    for (let i = 0; i + 1 < nums.length; i += 2) points.push([nums[i], nums[i + 1]]);
    segments.push(...pointsToSegments(points));
  }

  for (const match of svg.matchAll(/<path\b([^>]*)>/g)) {
    const attrs = match[1];
    const d = /\bd\s*=\s*"([^"]*)"/.exec(attrs)?.[1];
    if (!d) continue;
    /*
     * A FILLED path is artwork, not a connector.
     *
     * Rejecting one for sitting under a caption would throw away solid drawing the board is supposed
     * to contain — and arrowheads are filled triangles, so treating them as strokes would flag every
     * arrow that correctly points at its label.
     */
    const fill = /\bfill\s*=\s*"([^"]*)"/.exec(attrs)?.[1];
    if (fill && fill !== "none" && fill !== "transparent") continue;
    segments.push(...pointsToSegments(pathOnCurvePoints(d)));
  }

  return segments;
}

/** Circles, ellipses and rects — the things a connector may legitimately attach to. */
export function parseAnchors(svg: string): Anchor[] {
  const anchors: Anchor[] = [];

  for (const match of svg.matchAll(/<(?:circle|ellipse)\b([^>]*)>/g)) {
    const a = match[1];
    const cx = attr(a, "cx");
    const cy = attr(a, "cy");
    const r = attr(a, "r") ?? Math.max(attr(a, "rx") ?? 0, attr(a, "ry") ?? 0);
    if (cx === null || cy === null || !r) continue;
    anchors.push({ x: cx, y: cy, r });
  }

  for (const match of svg.matchAll(/<rect\b([^>]*)>/g)) {
    const a = match[1];
    const x = attr(a, "x");
    const y = attr(a, "y");
    const w = attr(a, "width");
    const h = attr(a, "height");
    if (x === null || y === null || w === null || h === null) continue;
    anchors.push({ x: x + w / 2, y: y + h / 2, r: Math.max(w, h) / 2 });
  }

  return anchors;
}

/**
 * The centres of arrowhead-sized filled shapes.
 *
 * Bounded by span so a filled ORGAN is never mistaken for an arrowhead: anything larger is artwork
 * and is left alone, which keeps the filled-path exemption doing the job it exists for.
 */
export function parseArrowheads(svg: string): Array<{ x: number; y: number }> {
  const heads: Array<{ x: number; y: number }> = [];

  const collect = (nums: number[]) => {
    const xs: number[] = [];
    const ys: number[] = [];
    for (let i = 0; i + 1 < nums.length; i += 2) {
      xs.push(nums[i]);
      ys.push(nums[i + 1]);
    }
    if (xs.length < 3) return;
    const w = Math.max(...xs) - Math.min(...xs);
    const h = Math.max(...ys) - Math.min(...ys);
    if (w > CONNECTOR_RULES.ARROWHEAD_MAX_SPAN || h > CONNECTOR_RULES.ARROWHEAD_MAX_SPAN) return;
    heads.push({ x: (Math.max(...xs) + Math.min(...xs)) / 2, y: (Math.max(...ys) + Math.min(...ys)) / 2 });
  };

  for (const match of svg.matchAll(/<polygon\b([^>]*)>/g)) {
    const raw = /\bpoints\s*=\s*"([^"]*)"/.exec(match[1])?.[1];
    if (raw) collect((raw.match(/-?[\d.]+/g) ?? []).map(Number));
  }

  for (const match of svg.matchAll(/<path\b([^>]*)>/g)) {
    const attrs = match[1];
    const fill = /\bfill\s*=\s*"([^"]*)"/.exec(attrs)?.[1];
    if (!fill || fill === "none" || fill === "transparent") continue;
    const d = /\bd\s*=\s*"([^"]*)"/.exec(attrs)?.[1];
    if (!d) continue;
    collect(pathOnCurvePoints(d).flat());
  }

  return heads;
}

/**
 * An arrowhead printed on top of a label.
 *
 * Separate from the stroke check because the stroke may legitimately stop short while the head
 * continues onto the word — which is exactly how a generated state diagram put a solid triangle
 * across "next state" while every line-based check passed.
 */
export function arrowheadOnLabelIssue(
  heads: Array<{ x: number; y: number }>,
  boxes: Box[],
): string | null {
  for (const head of heads) {
    for (const box of boxes) {
      if (pointInBox(head.x, head.y, shrink(box, CONNECTOR_RULES.LABEL_INSET))) {
        return (
          `an arrowhead is printed on top of the label "${box.text.slice(0, 32)}" ` +
          `(the head sits at ${Math.round(head.x)},${Math.round(head.y)}, inside that label's box ` +
          `x ${Math.round(box.x)}..${Math.round(box.x + box.w)}, y ${Math.round(box.y)}..${Math.round(box.y + box.h)}), ` +
          `so the arrow obscures the word it is pointing at. Stop the arrow short of the text, ` +
          `or move the label out from under the arrowhead`
        );
      }
    }
  }
  return null;
}

function shrink(box: Box, pad: number): Box {
  const w = Math.max(1, box.w - pad * 2);
  const h = Math.max(1, box.h - pad * 2);
  return { ...box, x: box.x + (box.w - w) / 2, y: box.y + (box.h - h) / 2, w, h };
}

function pointInBox(x: number, y: number, box: Box): boolean {
  return x >= box.x && x <= box.x + box.w && y >= box.y && y <= box.y + box.h;
}

function segmentsIntersect(a: Segment, b: Segment): boolean {
  const side = (px: number, py: number, qx: number, qy: number, rx: number, ry: number) =>
    (qx - px) * (ry - py) - (qy - py) * (rx - px);
  const d1 = side(a.x1, a.y1, a.x2, a.y2, b.x1, b.y1);
  const d2 = side(a.x1, a.y1, a.x2, a.y2, b.x2, b.y2);
  const d3 = side(b.x1, b.y1, b.x2, b.y2, a.x1, a.y1);
  const d4 = side(b.x1, b.y1, b.x2, b.y2, a.x2, a.y2);
  return d1 > 0 !== d2 > 0 && d3 > 0 !== d4 > 0;
}

/** True when the stroke reaches into the body of the label rather than stopping at its edge. */
export function segmentCrossesBox(segment: Segment, box: Box): boolean {
  const core = shrink(box, CONNECTOR_RULES.LABEL_INSET);
  if (pointInBox(segment.x1, segment.y1, core) || pointInBox(segment.x2, segment.y2, core)) return true;
  const edges: Segment[] = [
    { x1: core.x, y1: core.y, x2: core.x + core.w, y2: core.y },
    { x1: core.x + core.w, y1: core.y, x2: core.x + core.w, y2: core.y + core.h },
    { x1: core.x + core.w, y1: core.y + core.h, x2: core.x, y2: core.y + core.h },
    { x1: core.x, y1: core.y + core.h, x2: core.x, y2: core.y },
  ];
  return edges.some((edge) => segmentsIntersect(segment, edge));
}

/**
 * The first connector drawn through a label, described so the retry can act on it.
 *
 * Positional and specific, matching the phrasing the existing layout issues use: "labels are wrong"
 * tells a model nothing, while naming the label and the coordinates tells it what to move.
 */
export function connectorCrossingIssue(segments: Segment[], boxes: Box[]): string | null {
  for (const segment of segments) {
    for (const box of boxes) {
      if (segmentCrossesBox(segment, box)) {
        return (
          `a connector line runs straight through the label "${box.text.slice(0, 32)}" ` +
          `(the stroke goes from ${Math.round(segment.x1)},${Math.round(segment.y1)} to ` +
          `${Math.round(segment.x2)},${Math.round(segment.y2)}, and that label occupies ` +
          `x ${Math.round(box.x)}..${Math.round(box.x + box.w)}, y ${Math.round(box.y)}..${Math.round(box.y + box.h)}), ` +
          `so the words and the line overprint and neither can be read. Route the line around the text, ` +
          `or move the label clear of it`
        );
      }
    }
  }
  return null;
}

function attached(x: number, y: number, boxes: Box[], anchors: Anchor[]): boolean {
  const pad = CONNECTOR_RULES.ENDPOINT_TOLERANCE;
  const nearLabel = boxes.some((box) =>
    pointInBox(x, y, { ...box, x: box.x - pad, y: box.y - pad, w: box.w + pad * 2, h: box.h + pad * 2 }),
  );
  if (nearLabel) return true;
  return anchors.some((anchor) => Math.hypot(x - anchor.x, y - anchor.y) <= anchor.r + pad);
}

/**
 * The first connector with an end in empty space.
 *
 * An arrow is a claim that two things are related. One that starts or stops in blank space makes no
 * claim, and on the board that prompted this check those strokes read as decoration the student was
 * left trying to interpret.
 */
export function danglingConnectorIssue(
  segments: Segment[],
  boxes: Box[],
  anchors: Anchor[],
): string | null {
  // Nothing to attach TO means nothing can fairly be called unattached.
  if (boxes.length === 0 && anchors.length === 0) return null;

  for (const segment of segments) {
    const startOk = attached(segment.x1, segment.y1, boxes, anchors);
    const endOk = attached(segment.x2, segment.y2, boxes, anchors);
    if (startOk && endOk) continue;
    const looseX = startOk ? segment.x2 : segment.x1;
    const looseY = startOk ? segment.y2 : segment.y1;
    return (
      `a connector ends in empty space at ${Math.round(looseX)},${Math.round(looseY)} ` +
      `(the full stroke runs ${Math.round(segment.x1)},${Math.round(segment.y1)} to ` +
      `${Math.round(segment.x2)},${Math.round(segment.y2)}), touching no label and no shape. ` +
      `Every arrow must join two named things and its direction must state the relation between them — ` +
      `delete this stroke, or attach it to what it is meant to connect`
    );
  }
  return null;
}

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
 * CONSERVATIVE ON PURPOSE. A rejection here costs a refine round, so every rule under-reports rather
 * than over-reports. Label boxes are shrunk before testing, so a leader line that correctly ENDS at
 * its label is never mistaken for one ploughing through it; curves are approximated only by points
 * that genuinely lie on them; and filled shapes are artwork, not connectors.
 *
 * THE DANGLING-CONNECTOR CHECK WAS BROKEN TWICE, AND BOTH HALVES HAD TO BE FIXED TOGETHER.
 *   1. The prompt contract drew a frame rect around the whole board, and every rect was an anchor
 *      whose "radius" was half its longer side — so the frame swallowed every point on the board,
 *      and an arrow ending in blank paper (the "CO2 + water" arrow pointing at the border) passed.
 *   2. Under that, the check tested both ends of EVERY segment of EVERY unfilled path — the
 *      intermediate vertices of leaf outlines, veins and cell walls. Measured with the frame
 *      removed: a correct leaf outline was reported as "a connector ends in empty space … delete
 *      this stroke". Dropping the frame anchor alone would have told the refiner to delete the
 *      drawing on most physical boards.
 * So the frame stops being an anchor only because, in the same change, strokes are CLASSIFIED (a
 * connector is a leader or an arrow; an outline is drawing), only a connector's two real ends are
 * tested, and every drawn part is measured by its real edge (a rect by box distance, an ellipse by
 * its equation, a filled or closed shape by its bounds, catalogue artwork by its box) rather than by
 * a circle drawn around its centre.
 *
 * THE FRAME IS READ IN THE COORDINATES THE STUDENT SEES. Boards place parts inside
 * `<g transform="translate(…) scale(…)">` groups, and <Asset/> artwork arrives in its own
 * coordinate system under a transform; the old string scan read those numbers as if they were board
 * coordinates, so a leader pointing correctly at a translated part measured as pointing at nothing.
 * The walker below composes every transform on the way down, skips what is never drawn directly
 * (<defs>, <marker>, gradients, clip paths) and what is hidden at the finished frame.
 *
 * Everything is pure string and number work — no renderer, no client — so each rule is assertable.
 */

export type Box = { text: string; x: number; y: number; w: number; h: number };
export type Segment = { x1: number; y1: number; x2: number; y2: number };
/** Somewhere a connector may legitimately begin or end (legacy centre-and-radius form). */
export type Anchor = { x: number; y: number; r: number };
export type Point = [number, number];
/** A 2-D affine transform [a, b, c, d, e, f], exactly SVG's matrix(a b c d e f). */
export type Matrix = [number, number, number, number, number, number];

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
  /**
   * How close a connector's TAIL must come to a label or a drawn part to count as attached.
   *
   * 30, not the old 26, because parts are now measured by their real edges: the old anchor was a
   * circle of half the part's longer side, which let a tail sit 50 px under a wide box. Measured on a
   * real pipeline board, a curved arrow leaving 28 px under the box it starts from reads as attached
   * to it, and must not be sent back.
   */
  ENDPOINT_TOLERANCE: 30,
  /**
   * How close an arrow's HEAD (or a leader's dot) must come to the part or label it names.
   *
   * Tighter than the tail on purpose. The contract ends a head 4-6 short of its part and puts a
   * leader's dot inside it; a head 25 px out in blank paper points at nothing a student can name,
   * which is exactly how the reported boards failed.
   */
  HEAD_TOLERANCE: 20,
  /**
   * Biggest a filled shape can be and still be an arrowhead rather than artwork.
   *
   * Filled paths are skipped as drawing, which is right for a leaf or an organ and wrong for the
   * solid triangle on the end of an arrow: measured on a generated state diagram, the stroke stopped
   * short of the label while its HEAD sat squarely on the word "next state". The arrow still
   * collided with the text; only the part that collided was filled. The same span separates a
   * connector from a mark: a stroke no longer than this is a tick, a hatch or a hand-drawn
   * chevron head, never a claim that two things are related.
   */
  ARROWHEAD_MAX_SPAN: 34,
  /** Largest radius of a leader's DOT — the prompt draws them at 4. Bigger circles are parts. */
  DOT_MAX_RADIUS: 6,
  /**
   * A rect covering at least this share of the board is a frame or a paper background, not a part.
   * Anything drawn is "near" a frame, so as an anchor it made every connector look attached.
   */
  FRAME_COVERAGE: 0.5,
  /** Any other closed shape this large in BOTH directions is a border or a backdrop. */
  BACKDROP_SPAN: 0.85,
  /** Points taken along each curve command (on the curve, never its control handles). */
  CURVE_SAMPLES: 8,
  /** Shortest straight stroke that can be a coordinate AXIS rather than a relation arrow. */
  AXIS_MIN_LENGTH: 120,
} as const;

const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];
const DEFAULT_VIEWBOX = { x: 0, y: 0, w: 1000, h: 560 };

/* ── transforms ──────────────────────────────────────────────────────────── */

function multiply(m: Matrix, n: Matrix): Matrix {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}

function applyMatrix(m: Matrix, x: number, y: number): Point {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

function isIdentity(m: Matrix): boolean {
  return m[0] === 1 && m[1] === 0 && m[2] === 0 && m[3] === 1 && m[4] === 0 && m[5] === 0;
}

/**
 * An SVG `transform` attribute, or a CSS `transform` from a style, as one matrix. Null when any
 * part is unreadable (a percentage, a 3-D function) — the caller then keeps the parent's frame
 * rather than guessing, which at worst leaves this element where the old string scan put it.
 */
export function parseTransform(value: string | null | undefined): Matrix | null {
  if (!value || value.trim() === "" || value.trim() === "none") return IDENTITY;
  const fn = /([a-zA-Z]+)\s*\(([^)]*)\)/g;
  let matrix: Matrix = IDENTITY;
  let consumed = 0;
  let hit: RegExpExecArray | null;
  while ((hit = fn.exec(value))) {
    if (value.slice(consumed, hit.index).replace(/[\s,]/g, "") !== "") return null;
    consumed = hit.index + hit[0].length;
    const name = hit[1].toLowerCase();
    const args: number[] = [];
    for (const raw of hit[2].split(/[\s,]+/).filter(Boolean)) {
      const m = /^([-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)(px|deg|rad|turn)?$/.exec(raw.trim());
      if (!m) return null;
      const n = Number(m[1]);
      args.push(m[2] === "rad" ? (n * 180) / Math.PI : m[2] === "turn" ? n * 360 : n);
    }
    const rad = (deg: number) => (deg * Math.PI) / 180;
    let local: Matrix;
    switch (name) {
      case "matrix":
        if (args.length !== 6) return null;
        local = args as Matrix;
        break;
      case "translate":
        local = [1, 0, 0, 1, args[0] ?? 0, args[1] ?? 0];
        break;
      case "translatex":
        local = [1, 0, 0, 1, args[0] ?? 0, 0];
        break;
      case "translatey":
        local = [1, 0, 0, 1, 0, args[0] ?? 0];
        break;
      case "scale":
        local = [args[0] ?? 1, 0, 0, args[1] ?? args[0] ?? 1, 0, 0];
        break;
      case "scalex":
        local = [args[0] ?? 1, 0, 0, 1, 0, 0];
        break;
      case "scaley":
        local = [1, 0, 0, args[0] ?? 1, 0, 0];
        break;
      case "rotate": {
        const a = rad(args[0] ?? 0);
        const r: Matrix = [Math.cos(a), Math.sin(a), -Math.sin(a), Math.cos(a), 0, 0];
        const [cx, cy] = [args[1] ?? 0, args[2] ?? 0];
        local = cx || cy ? multiply(multiply([1, 0, 0, 1, cx, cy], r), [1, 0, 0, 1, -cx, -cy]) : r;
        break;
      }
      case "skewx":
        local = [1, 0, Math.tan(rad(args[0] ?? 0)), 1, 0, 0];
        break;
      case "skewy":
        local = [1, Math.tan(rad(args[0] ?? 0)), 0, 1, 0, 0];
        break;
      default:
        return null;
    }
    matrix = multiply(matrix, local);
  }
  if (value.slice(consumed).replace(/[\s,]/g, "") !== "") return null;
  return matrix;
}

/* ── path data ───────────────────────────────────────────────────────────── */

/** One continuous run of a path: from a moveto to the next moveto (or the end). */
export type Subpath = {
  /** The on-curve points: the start and the end of every command. Never a control handle. */
  points: Point[];
  /** Points ON the stroke, including along curves — what bounds and crossings are measured on. */
  samples: Point[];
  closed: boolean;
  curved: boolean;
};

const ARITY: Record<string, number> = { M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, A: 7, Z: 0 };

/**
 * A path's data as subpaths of on-curve points and on-stroke samples.
 *
 * CONTROL POINTS ARE NEVER GEOMETRY. A cubic's handles routinely sit far from the curve they bend,
 * so treating them as vertices would invent geometry the board never draws. Curves are instead
 * SAMPLED at points that genuinely lie on them, so a bulging leaf outline has its real height (its
 * on-curve points alone can all lie on one line) and a curved arrow is tested where it actually runs.
 *
 * SUBPATHS STAY SEPARATE. "M a C … b M c C … d" is two strokes; joining b to c invented a segment
 * across the drawing — on the prompt's own worked example that phantom segment was the "connector
 * ending in empty space". Malformed data degrades to whatever parsed; this never throws.
 */
export function pathSubpaths(d: string): Subpath[] {
  const subpaths: Subpath[] = [];
  const number = /[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/y;
  const n = d.length;
  let i = 0;
  const skipSeparators = () => {
    while (i < n && (d[i] === " " || d[i] === "," || d[i] === "\n" || d[i] === "\t" || d[i] === "\r")) i += 1;
  };
  const readNumber = (): number | null => {
    skipSeparators();
    number.lastIndex = i;
    const hit = number.exec(d);
    if (!hit) return null;
    i += hit[0].length;
    return Number(hit[0]);
  };
  const readFlag = (): number | null => {
    skipSeparators();
    if (d[i] === "0" || d[i] === "1") return Number(d[i++]);
    return null;
  };

  let cx = 0;
  let cy = 0;
  let startX = 0;
  let startY = 0;
  let current: Subpath | null = null;
  let command: string | null = null;
  let lastCubic: Point | null = null;
  let lastQuad: Point | null = null;

  const begin = (x: number, y: number) => {
    current = { points: [[x, y]], samples: [[x, y]], closed: false, curved: false };
    subpaths.push(current);
    startX = x;
    startY = y;
  };
  const ensure = () => {
    if (!current || current.closed) begin(cx, cy);
    return current as unknown as Subpath;
  };
  const lineTo = (x: number, y: number) => {
    const sub = ensure();
    sub.points.push([x, y]);
    sub.samples.push([x, y]);
    cx = x;
    cy = y;
  };
  const curveTo = (x: number, y: number, at: (t: number) => Point) => {
    const sub = ensure();
    sub.curved = true;
    for (let k = 1; k < CONNECTOR_RULES.CURVE_SAMPLES; k += 1) sub.samples.push(at(k / CONNECTOR_RULES.CURVE_SAMPLES));
    sub.samples.push([x, y]);
    sub.points.push([x, y]);
    cx = x;
    cy = y;
  };

  while (true) {
    skipSeparators();
    if (i >= n) break;
    const ch = d[i];
    if (/[A-Za-z]/.test(ch)) {
      i += 1;
      const upper = ch.toUpperCase();
      if (!(upper in ARITY)) {
        command = null;
        continue;
      }
      command = ch;
      if (upper === "Z") {
        if (current) {
          (current as Subpath).closed = true;
          cx = startX;
          cy = startY;
        }
        lastCubic = null;
        lastQuad = null;
        command = null;
        continue;
      }
    } else if (command === null) {
      // Numbers with no command to belong to: skip one character so this can never loop.
      i += 1;
      continue;
    }

    const cmd = command as string;
    const upper = cmd.toUpperCase();
    const relative = cmd !== upper;
    const args: number[] = [];
    const before = i;
    for (let k = 0; k < ARITY[upper]; k += 1) {
      const value = upper === "A" && (k === 3 || k === 4) ? readFlag() : readNumber();
      if (value === null) break;
      args.push(value);
    }
    if (args.length < ARITY[upper]) {
      // A truncated command draws nothing; drop it and resynchronise on the next letter.
      if (i === before) i += 1;
      command = null;
      continue;
    }
    const ox = relative ? cx : 0;
    const oy = relative ? cy : 0;

    switch (upper) {
      case "M":
        begin(ox + args[0], oy + args[1]);
        cx = ox + args[0];
        cy = oy + args[1];
        // Coordinates after a moveto are implicit linetos.
        command = relative ? "l" : "L";
        lastCubic = null;
        lastQuad = null;
        continue;
      case "L":
        lineTo(ox + args[0], oy + args[1]);
        break;
      case "H":
        lineTo(relative ? cx + args[0] : args[0], cy);
        break;
      case "V":
        lineTo(cx, relative ? cy + args[0] : args[0]);
        break;
      case "C":
      case "S": {
        const p0: Point = [cx, cy];
        const p1: Point =
          upper === "C"
            ? [ox + args[0], oy + args[1]]
            : lastCubic
              ? [2 * cx - lastCubic[0], 2 * cy - lastCubic[1]]
              : [cx, cy];
        const off = upper === "C" ? 2 : 0;
        const p2: Point = [ox + args[off], oy + args[off + 1]];
        const p3: Point = [ox + args[off + 2], oy + args[off + 3]];
        curveTo(p3[0], p3[1], (t) => {
          const u = 1 - t;
          return [
            u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0],
            u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1],
          ];
        });
        lastCubic = p2;
        lastQuad = null;
        continue;
      }
      case "Q":
      case "T": {
        const p0: Point = [cx, cy];
        const p1: Point =
          upper === "Q"
            ? [ox + args[0], oy + args[1]]
            : lastQuad
              ? [2 * cx - lastQuad[0], 2 * cy - lastQuad[1]]
              : [cx, cy];
        const off = upper === "Q" ? 2 : 0;
        const p2: Point = [ox + args[off], oy + args[off + 1]];
        curveTo(p2[0], p2[1], (t) => {
          const u = 1 - t;
          return [u * u * p0[0] + 2 * u * t * p1[0] + t * t * p2[0], u * u * p0[1] + 2 * u * t * p1[1] + t * t * p2[1]];
        });
        lastQuad = p1;
        lastCubic = null;
        continue;
      }
      case "A": {
        const [x0, y0] = [cx, cy];
        const x = ox + args[5];
        const y = oy + args[6];
        const along = arcPoints(x0, y0, args[0], args[1], args[2], args[3], args[4], x, y);
        curveTo(x, y, (t) => along(t));
        break;
      }
    }
    lastCubic = null;
    lastQuad = null;
  }

  return subpaths;
}

/**
 * A point along an SVG elliptical arc, from its endpoint form (the spec's own conversion to centre
 * form, SVG 1.1 implementation notes F.6.5). Degenerate radii draw a straight line, as SVG does.
 */
function arcPoints(
  x1: number,
  y1: number,
  rxIn: number,
  ryIn: number,
  rotationDeg: number,
  largeArc: number,
  sweep: number,
  x2: number,
  y2: number,
): (t: number) => Point {
  let rx = Math.abs(rxIn);
  let ry = Math.abs(ryIn);
  if (rx === 0 || ry === 0 || (x1 === x2 && y1 === y2)) return (t) => [x1 + (x2 - x1) * t, y1 + (y2 - y1) * t];
  const phi = (rotationDeg * Math.PI) / 180;
  const cos = Math.cos(phi);
  const sin = Math.sin(phi);
  const dx = (x1 - x2) / 2;
  const dy = (y1 - y2) / 2;
  const x1p = cos * dx + sin * dy;
  const y1p = -sin * dx + cos * dy;
  const lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (lambda > 1) {
    rx *= Math.sqrt(lambda);
    ry *= Math.sqrt(lambda);
  }
  const numerator = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p;
  const denominator = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
  let coef = denominator === 0 ? 0 : Math.sqrt(Math.max(0, numerator / denominator));
  if (largeArc === sweep) coef = -coef;
  const cxp = (coef * rx * y1p) / ry;
  const cyp = (-coef * ry * x1p) / rx;
  const centreX = cos * cxp - sin * cyp + (x1 + x2) / 2;
  const centreY = sin * cxp + cos * cyp + (y1 + y2) / 2;
  const angle = (ux: number, uy: number, vx: number, vy: number) => Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
  const theta1 = angle(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
  let dtheta = angle((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
  if (!sweep && dtheta > 0) dtheta -= 2 * Math.PI;
  else if (sweep && dtheta < 0) dtheta += 2 * Math.PI;
  return (t) => {
    const a = theta1 + dtheta * t;
    return [cos * rx * Math.cos(a) - sin * ry * Math.sin(a) + centreX, sin * rx * Math.cos(a) + cos * ry * Math.sin(a) + centreY];
  };
}

/**
 * The on-curve points of a path's data, every subpath in order.
 *
 * CONTROL POINTS ARE DISCARDED. A cubic's handles routinely sit far from the curve they bend, so
 * treating them as vertices would invent geometry the board never draws and reject a board for a
 * crossing that is not there.
 */
export function pathOnCurvePoints(d: string): Array<[number, number]> {
  return pathSubpaths(d).flatMap((sub) => sub.points);
}

/* ── the walker ──────────────────────────────────────────────────────────── */

/** A drawn part a connector may attach to, measured by its real edge. */
export type Part =
  | { shape: "box"; x: number; y: number; w: number; h: number; from: string; step: number | null; element: number }
  | { shape: "ellipse"; cx: number; cy: number; rx: number; ry: number; from: string; step: number | null; element: number };

/** One continuous stroke on the board, in board coordinates. */
export type StrokePiece = {
  from: string;
  /** Index of the element it came from — the subpaths of one path share it. */
  element: number;
  /** How many subpaths that element drew. */
  subpaths: number;
  points: Point[];
  samples: Point[];
  closed: boolean;
  curved: boolean;
  stroked: boolean;
  /** Filled, and the fill has area: artwork, never a connector. */
  filledArea: boolean;
  markerStart: boolean;
  markerEnd: boolean;
  /** The nearest enclosing timeline step (data-teach-order / data-teach-kind), if any. */
  step: number | null;
  stepKind: string | null;
};

/** A small filled shape — the solid head of an arrow when one ends beside it. */
export type Arrowhead = { x: number; y: number; vertices: Point[]; step: number | null; element: number };

export type BoardGeometry = {
  viewBox: { x: number; y: number; w: number; h: number };
  pieces: StrokePiece[];
  parts: Part[];
  arrowheads: Arrowhead[];
  /** Every visible <text> element's markup with the transform it is drawn under. */
  texts: Array<{ markup: string; ctm: Matrix }>;
};

type Frame = {
  tag: string;
  ctm: Matrix;
  fill: string | null;
  stroke: string | null;
  fillOpacity: number;
  strokeOpacity: number;
  strokeWidth: number;
  markerStart: boolean;
  markerEnd: boolean;
  opacity: number;
  hidden: boolean;
  /** Inside something that is never drawn in place (defs, a marker, a gradient) or inside artwork. */
  skip: boolean;
  step: number | null;
  stepKind: string | null;
};

/** Containers whose children are templates or paint servers, never drawn where they sit. */
const NOT_DRAWN_IN_PLACE = new Set([
  "defs", "marker", "clippath", "mask", "pattern", "symbol", "lineargradient", "radialgradient", "filter",
  "title", "desc", "metadata", "style", "script", "foreignobject",
]);

function parseAttributes(raw: string): Map<string, string> {
  const attrs = new Map<string, string>();
  const re = /([^\s=\/"']+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  let hit: RegExpExecArray | null;
  while ((hit = re.exec(raw))) attrs.set(hit[1].toLowerCase(), decodeEntities(hit[2] ?? hit[3] ?? ""));
  return attrs;
}

function decodeEntities(text: string): string {
  if (!text.includes("&")) return text;
  return text
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function parseStyle(style: string | undefined): Map<string, string> {
  const out = new Map<string, string>();
  if (!style) return out;
  for (const declaration of style.split(";")) {
    const colon = declaration.indexOf(":");
    if (colon < 0) continue;
    out.set(declaration.slice(0, colon).trim().toLowerCase(), declaration.slice(colon + 1).trim());
  }
  return out;
}

function numberOr(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const parsed = parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function isNonePaint(paint: string | null): boolean {
  return paint === null || paint === "none" || paint === "transparent" || /^rgba\([^)]*,\s*0(?:\.0*)?\s*\)$/.test(paint);
}

function numberAttr(attrs: Map<string, string>, name: string, fallback = 0): number {
  return numberOr(attrs.get(name), fallback);
}

function pointsAttr(raw: string | undefined): Point[] {
  const nums = (raw ?? "").match(/[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g)?.map(Number) ?? [];
  const points: Point[] = [];
  for (let i = 0; i + 1 < nums.length; i += 2) points.push([nums[i], nums[i + 1]]);
  return points;
}

function bounds(points: Point[]): { x: number; y: number; w: number; h: number } {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of points) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return points.length ? { x: minX, y: minY, w: maxX - minX, h: maxY - minY } : { x: 0, y: 0, w: 0, h: 0 };
}

function polygonArea(points: Point[]): number {
  let area = 0;
  for (let i = 0; i < points.length; i += 1) {
    const [x1, y1] = points[i];
    const [x2, y2] = points[(i + 1) % points.length];
    area += x1 * y2 - x2 * y1;
  }
  return Math.abs(area) / 2;
}

/** The viewport transform of a nested <svg> (default preserveAspectRatio: xMidYMid meet). */
function nestedViewport(attrs: Map<string, string>): Matrix {
  const x = numberAttr(attrs, "x");
  const y = numberAttr(attrs, "y");
  const box = attrs.get("viewbox")?.trim().split(/[\s,]+/).map(Number);
  const width = numberOr(attrs.get("width"), NaN);
  const height = numberOr(attrs.get("height"), NaN);
  if (!box || box.length !== 4 || !box.every(Number.isFinite) || box[2] <= 0 || box[3] <= 0 || !(width > 0) || !(height > 0)) {
    return [1, 0, 0, 1, x, y];
  }
  const preserve = attrs.get("preserveaspectratio") ?? "";
  if (/\bnone\b/.test(preserve)) {
    const sx = width / box[2];
    const sy = height / box[3];
    return [sx, 0, 0, sy, x - box[0] * sx, y - box[1] * sy];
  }
  const s = Math.min(width / box[2], height / box[3]);
  return [s, 0, 0, s, x + (width - box[2] * s) / 2 - box[0] * s, y + (height - box[3] * s) / 2 - box[1] * s];
}

/**
 * The finished frame's drawable geometry, in board coordinates: every stroke, every part a
 * connector may attach to, every small filled shape that may be an arrowhead, and every visible
 * text with the transform it is drawn under. Pure; never throws.
 */
export function readBoardGeometry(svg: string): BoardGeometry {
  const geometry: BoardGeometry = { viewBox: { ...DEFAULT_VIEWBOX }, pieces: [], parts: [], arrowheads: [], texts: [] };
  const tag = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<([/]?)([A-Za-z][\w:.-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g;
  const root: Frame = {
    tag: "#root",
    ctm: IDENTITY,
    fill: null,
    stroke: null,
    fillOpacity: 1,
    strokeOpacity: 1,
    strokeWidth: 1,
    markerStart: false,
    markerEnd: false,
    opacity: 1,
    hidden: false,
    skip: false,
    step: null,
    stepKind: null,
  };
  const stack: Frame[] = [root];
  let sawRoot = false;
  let elementIndex = 0;

  let hit: RegExpExecArray | null;
  while ((hit = tag.exec(svg))) {
    if (hit[2] === undefined) continue; // a comment or CDATA
    const name = hit[2].toLowerCase();
    if (hit[1] === "/") {
      // Pop to the matching open tag; a stray close tag that matches nothing is ignored.
      const at = stack.map((f) => f.tag).lastIndexOf(name);
      if (at > 0) stack.length = at;
      continue;
    }
    const rawAttrs = hit[3];
    const selfClosing = /\/\s*$/.test(rawAttrs);
    const attrs = parseAttributes(rawAttrs);
    const style = parseStyle(attrs.get("style"));
    const read = (property: string) => style.get(property) ?? attrs.get(property);
    const parent = stack[stack.length - 1];
    const index = (elementIndex += 1);

    let ctm = parent.ctm;
    if (name === "svg") {
      if (!sawRoot) {
        sawRoot = true;
        const box = attrs.get("viewbox")?.trim().split(/[\s,]+/).map(Number);
        if (box && box.length === 4 && box.every(Number.isFinite) && box[2] > 0 && box[3] > 0) {
          geometry.viewBox = { x: box[0], y: box[1], w: box[2], h: box[3] };
        }
      } else {
        ctm = multiply(ctm, nestedViewport(attrs));
      }
    }
    // A CSS transform in a style replaces the attribute, as it does in the browser.
    const cssTransform = style.get("transform");
    const own = parseTransform(cssTransform ?? attrs.get("transform"));
    if (own && !isIdentity(own)) {
      let local = own;
      const origin = cssTransform ? style.get("transform-origin") : undefined;
      if (origin) {
        const [ox, oy] = origin.split(/\s+/).map((part) => (/^[-+]?[\d.]+(px)?$/.test(part) ? parseFloat(part) : NaN));
        if (Number.isFinite(ox) && Number.isFinite(oy)) local = multiply(multiply([1, 0, 0, 1, ox, oy], own), [1, 0, 0, 1, -ox, -oy]);
      }
      ctm = multiply(ctm, local);
    }

    const markerShorthand = read("marker");
    const markerOf = (prop: string, inherited: boolean) => {
      const value = read(prop) ?? markerShorthand;
      return value === undefined ? inherited : !isNonePaint(value.trim());
    };
    const ownOpacity = numberOr(read("opacity"), 1);
    const display = read("display");
    const visibility = read("visibility");
    const kind = attrs.get("data-teach-kind") ?? null;
    const opensStep = kind !== null || attrs.has("data-teach-order");
    const frame: Frame = {
      tag: name,
      ctm,
      fill: read("fill")?.trim() ?? parent.fill,
      stroke: read("stroke")?.trim() ?? parent.stroke,
      fillOpacity: read("fill-opacity") !== undefined ? numberOr(read("fill-opacity"), 1) : parent.fillOpacity,
      strokeOpacity: read("stroke-opacity") !== undefined ? numberOr(read("stroke-opacity"), 1) : parent.strokeOpacity,
      strokeWidth: read("stroke-width") !== undefined ? numberOr(read("stroke-width"), 1) : parent.strokeWidth,
      markerStart: markerOf("marker-start", parent.markerStart),
      markerEnd: markerOf("marker-end", parent.markerEnd),
      opacity: parent.opacity * (Number.isFinite(ownOpacity) ? ownOpacity : 1),
      hidden: parent.hidden || display === "none" || visibility === "hidden" || visibility === "collapse",
      skip: parent.skip || NOT_DRAWN_IN_PLACE.has(name),
      step: opensStep ? index : parent.step,
      stepKind: kind !== null ? kind.toLowerCase() : parent.stepKind,
    };
    const drawn = !frame.skip && !frame.hidden && frame.opacity > 0.02;

    /*
     * CATALOGUE ARTWORK is one part, known by its box. Its inner paths are in the artwork's own
     * coordinate system and are drawing — never connectors, never separate anchors — so the whole
     * subtree is skipped and the box <Asset/> reports (lib/assetCatalogue.ts) stands in for it.
     */
    const assetBox = attrs.get("data-asset-box")?.trim().split(/[\s,]+/).map(Number);
    if (assetBox && assetBox.length === 4 && assetBox.every(Number.isFinite)) {
      if (drawn) {
        const [x, y, w, h] = assetBox;
        const corners = [applyMatrix(parent.ctm, x, y), applyMatrix(parent.ctm, x + w, y), applyMatrix(parent.ctm, x, y + h), applyMatrix(parent.ctm, x + w, y + h)];
        geometry.parts.push({ shape: "box", ...bounds(corners), from: "asset", step: frame.step, element: index });
      }
      frame.skip = true;
    }

    if (name === "text") {
      // A text's words are measured by the caller; this records where they sit and skips past them.
      const close = svg.indexOf("</text>", tag.lastIndex);
      const end = selfClosing ? tag.lastIndex : close < 0 ? svg.length : close + "</text>".length;
      if (drawn) geometry.texts.push({ markup: svg.slice(hit.index, end), ctm });
      tag.lastIndex = end;
      continue;
    }

    if (drawn && !(assetBox && assetBox.length === 4)) collectShape(geometry, name, attrs, frame, index);

    if (!selfClosing) stack.push(frame);
  }

  dropBackdrops(geometry);
  return geometry;
}

function collectShape(geometry: BoardGeometry, name: string, attrs: Map<string, string>, frame: Frame, element: number) {
  const ctm = frame.ctm;
  const stroked = !isNonePaint(frame.stroke) && frame.strokeOpacity > 0.02 && frame.strokeWidth > 0;
  // SVG's initial fill is black: a shape with no fill anywhere up its tree IS filled.
  const filled = frame.fill === null ? true : !isNonePaint(frame.fill) && frame.fillOpacity > 0.02;
  const toBoard = (points: Point[]) => (isIdentity(ctm) ? points : points.map(([x, y]) => applyMatrix(ctm, x, y)));
  const box = (x: number, y: number, w: number, h: number) =>
    bounds(toBoard([[x, y], [x + w, y], [x, y + h], [x + w, y + h]]));

  switch (name) {
    case "rect":
    case "image": {
      const w = numberAttr(attrs, "width");
      const h = numberAttr(attrs, "height");
      if (w <= 0 || h <= 0 || (name === "rect" && !filled && !stroked)) return;
      geometry.parts.push({ shape: "box", ...box(numberAttr(attrs, "x"), numberAttr(attrs, "y"), w, h), from: name, step: frame.step, element });
      return;
    }
    case "circle":
    case "ellipse": {
      const cx = numberAttr(attrs, "cx");
      const cy = numberAttr(attrs, "cy");
      const rx = name === "circle" ? numberAttr(attrs, "r") : numberOr(attrs.get("rx"), numberAttr(attrs, "ry"));
      const ry = name === "circle" ? numberAttr(attrs, "r") : numberOr(attrs.get("ry"), rx);
      if (rx <= 0 || ry <= 0 || (!filled && !stroked)) return;
      if (ctm[1] === 0 && ctm[2] === 0) {
        const [x, y] = applyMatrix(ctm, cx, cy);
        geometry.parts.push({ shape: "ellipse", cx: x, cy: y, rx: rx * Math.abs(ctm[0]), ry: ry * Math.abs(ctm[3]), from: name, step: frame.step, element });
      } else {
        const ring: Point[] = [];
        for (let k = 0; k < 16; k += 1) ring.push([cx + rx * Math.cos((k * Math.PI) / 8), cy + ry * Math.sin((k * Math.PI) / 8)]);
        geometry.parts.push({ shape: "box", ...bounds(toBoard(ring)), from: name, step: frame.step, element });
      }
      return;
    }
    case "line":
    case "polyline":
    case "polygon":
    case "path": {
      let subpaths: Subpath[];
      if (name === "line") {
        const a: Point = [numberAttr(attrs, "x1"), numberAttr(attrs, "y1")];
        const b: Point = [numberAttr(attrs, "x2"), numberAttr(attrs, "y2")];
        subpaths = [{ points: [a, b], samples: [a, b], closed: false, curved: false }];
      } else if (name === "path") {
        subpaths = pathSubpaths(attrs.get("d") ?? "");
      } else {
        const points = pointsAttr(attrs.get("points"));
        subpaths = points.length ? [{ points, samples: [...points], closed: name === "polygon", curved: false }] : [];
      }
      for (const sub of subpaths) {
        const points = toBoard(sub.points);
        const samples = toBoard(sub.samples);
        if (points.length === 0) continue;
        const [fx, fy] = points[0];
        const [lx, ly] = points[points.length - 1];
        const closed = sub.closed || (points.length > 2 && Math.hypot(lx - fx, ly - fy) < 0.5);
        // A line has no inside to fill; a straight polyline's fill has no area either.
        const filledArea = name !== "line" && filled && (sub.curved || polygonArea(points) > 1);
        if (!stroked && !filledArea) continue;
        const piece: StrokePiece = {
          from: name,
          element,
          subpaths: subpaths.length,
          points,
          samples,
          closed,
          curved: sub.curved,
          stroked,
          filledArea,
          markerStart: frame.markerStart,
          markerEnd: frame.markerEnd,
          step: frame.step,
          stepKind: frame.stepKind,
        };
        geometry.pieces.push(piece);
        const extent = bounds(samples);
        if (filledArea && points.length >= 3 && Math.max(extent.w, extent.h) <= CONNECTOR_RULES.ARROWHEAD_MAX_SPAN) {
          geometry.arrowheads.push({ x: extent.x + extent.w / 2, y: extent.y + extent.h / 2, vertices: points, step: frame.step, element });
        }
        // A filled shape or a closed outline is a part, measured by its bounds.
        if (filledArea || closed) {
          geometry.parts.push({ shape: "box", ...extent, from: name, step: frame.step, element });
        }
      }
      return;
    }
  }
}

/**
 * Frames and backdrops are not parts.
 *
 * A rect covering half the board is the frame the old contract drew at x=40,y=24,w=920,h=512, or the
 * paper painted behind everything. Every point on the board is "near" it, so as an anchor it made
 * every connector look attached — the "CO2 + water" arrow pointing at the border passed that way.
 * Other closed shapes are dropped only when they span nearly the whole board in both directions,
 * because a large leaf or cell drawn as the subject is exactly what leaders point into.
 */
function dropBackdrops(geometry: BoardGeometry) {
  const area = geometry.viewBox.w * geometry.viewBox.h;
  geometry.parts = geometry.parts.filter((part) => {
    if (part.shape !== "box" || part.from === "asset" || part.from === "image") return true;
    if (part.from === "rect") return part.w * part.h < CONNECTOR_RULES.FRAME_COVERAGE * area;
    return !(part.w >= CONNECTOR_RULES.BACKDROP_SPAN * geometry.viewBox.w && part.h >= CONNECTOR_RULES.BACKDROP_SPAN * geometry.viewBox.h);
  });
}

/* ── classification ──────────────────────────────────────────────────────── */

function pieceLength(points: Point[]): number {
  let length = 0;
  for (let i = 1; i < points.length; i += 1) length += Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
  return length;
}

function spanOf(points: Point[]): number {
  const b = bounds(points);
  return Math.hypot(b.w, b.h);
}

/** One end of a connector, and what it has to reach. */
export type ConnectorEnd = {
  x: number;
  y: number;
  /** "head": an arrowhead ends here; "dot": a leader's dot; "tail": a plain end. */
  kind: "head" | "dot" | "tail";
  /** The parts that are this connector's own apparatus (its dot, its head), never its anchor. */
  own: number[];
};

export type Connector = Segment & {
  role: "arrow" | "leader" | "line";
  start: ConnectorEnd;
  end: ConnectorEnd;
  /** The stroke it came from, so it never counts as its own anchor. */
  piece: StrokePiece;
};

const CONNECTOR_STEP_KINDS = new Set(["label", "arrow"]);

function sameStep(a: number | null, b: number | null): boolean {
  return a === b;
}

/**
 * Which strokes are CONNECTORS — the only strokes whose ends make a claim.
 *
 * A connector is a stroke with an arrowhead (a marker, a small filled head, or a hand-drawn chevron
 * at an end), or any open stroke inside a `label` or `arrow` step of the timeline. On a board with no
 * timeline kinds, it is a <line>, or an open single-run path or polyline of at most three on-curve
 * points. Everything else — outlines, veins, fissures, axes, rays, hatching — is DRAWING, whose
 * vertices are where the shape bends, not where a claim begins; testing them is how a correct leaf
 * outline was told to delete itself. A stroke spanning no more than an arrowhead is a mark.
 */
export function classifyConnectors(geometry: BoardGeometry): Connector[] {
  const marks: StrokePiece[] = [];
  const candidates: StrokePiece[] = [];
  for (const piece of geometry.pieces) {
    if (!piece.stroked || piece.filledArea || piece.closed || piece.points.length < 2) continue;
    if (spanOf(piece.samples) <= CONNECTOR_RULES.ARROWHEAD_MAX_SPAN) marks.push(piece);
    else candidates.push(piece);
  }
  /*
   * Hand-drawn heads: short strokes touching a stroke's end — a three-point chevron whose middle is
   * the tip, or two separate barbs drawn from the tip ("M590 445 l-12 -8 M590 445 l-4 -14", as a
   * generated BST board drew one). Either way some point of the mark sits on the end.
   */
  const chevrons = marks;

  const connectors: Connector[] = [];
  for (const piece of candidates) {
    const first = piece.points[0];
    const last = piece.points[piece.points.length - 1];
    const before = (at: "start" | "end"): Point =>
      at === "start" ? piece.samples[Math.min(1, piece.samples.length - 1)] : piece.samples[Math.max(0, piece.samples.length - 2)];

    const endAt = (at: "start" | "end"): ConnectorEnd => {
      const [x, y] = at === "start" ? first : last;
      const own: number[] = [];
      // An arrowhead defined as a marker sits exactly on the end (refX at the tip).
      let kind: ConnectorEnd["kind"] = (at === "start" ? piece.markerStart : piece.markerEnd) ? "head" : "tail";
      let tip: Point = [x, y];
      if (kind === "tail") {
        const head = geometry.arrowheads.find((h) => {
          if (!sameStep(h.step, piece.step)) return false;
          const b = bounds(h.vertices);
          return x >= b.x - 8 && x <= b.x + b.w + 8 && y >= b.y - 8 && y <= b.y + b.h + 8;
        });
        if (head) {
          kind = "head";
          own.push(head.element);
          // The tip is the head's vertex furthest along the stroke's direction of travel.
          const [px, py] = before(at);
          const [dx, dy] = [x - px, y - py];
          tip = head.vertices.reduce((best, v) => ((v[0] - x) * dx + (v[1] - y) * dy > (best[0] - x) * dx + (best[1] - y) * dy ? v : best), [x, y] as Point);
        } else {
          const chevron = chevrons.find(
            (c) => c !== piece && sameStep(c.step, piece.step) && c.points.some(([cx, cy]) => Math.hypot(cx - x, cy - y) <= 6),
          );
          if (chevron) {
            kind = "head";
            own.push(chevron.element);
          }
        }
      }
      if (kind === "tail") {
        const dot = geometry.parts.find(
          (part) =>
            part.shape === "ellipse" &&
            Math.max(part.rx, part.ry) <= CONNECTOR_RULES.DOT_MAX_RADIUS &&
            sameStep(part.step, piece.step) &&
            Math.hypot(part.cx - x, part.cy - y) <= Math.max(part.rx, part.ry) + 3,
        );
        if (dot) {
          kind = "dot";
          own.push(dot.element);
        }
      }
      return { x: tip[0], y: tip[1], kind, own };
    };

    const start = endAt("start");
    const end = endAt("end");
    const headed = start.kind === "head" || end.kind === "head";
    let role: Connector["role"] | null = null;
    if (headed) role = "arrow";
    else if (piece.stepKind && CONNECTOR_STEP_KINDS.has(piece.stepKind)) role = piece.stepKind === "label" || start.kind === "dot" || end.kind === "dot" ? "leader" : "line";
    else if (piece.stepKind) role = null;
    else if (piece.from === "line") role = start.kind === "dot" || end.kind === "dot" ? "leader" : "line";
    else if (piece.subpaths === 1 && piece.points.length <= 3) role = start.kind === "dot" || end.kind === "dot" ? "leader" : "line";
    if (!role) continue;
    if (role === "arrow" && isCoordinateAxis(piece, start, end, geometry.pieces)) continue;
    connectors.push({ x1: first[0], y1: first[1], x2: last[0], y2: last[1], role, start, end, piece });
  }
  return connectors;
}

/** "h" or "v" for a long straight horizontal or vertical stroke, else null. */
function axisDirection(piece: StrokePiece): "h" | "v" | null {
  if (piece.curved || piece.points.length !== 2) return null;
  const [[x1, y1], [x2, y2]] = piece.points;
  if (Math.hypot(x2 - x1, y2 - y1) < CONNECTOR_RULES.AXIS_MIN_LENGTH) return null;
  if (Math.abs(y2 - y1) <= 3) return "h";
  if (Math.abs(x2 - x1) <= 3) return "v";
  return null;
}

/**
 * A graph's AXIS carries an arrowhead that states a direction, not a relation — it points at no part
 * because there is none to point at. Measured on a real Simpson's-rule board, the x-axis head was
 * the one "arrow pointing at nothing" on an otherwise correct graph. An axis is a long straight
 * horizontal or vertical headed stroke that either has heads at both ends (a number line) or
 * starts where a perpendicular straight stroke also starts or ends (the origin of a pair of axes).
 */
function isCoordinateAxis(piece: StrokePiece, start: ConnectorEnd, end: ConnectorEnd, pieces: StrokePiece[]): boolean {
  const direction = axisDirection(piece);
  if (!direction) return false;
  if (start.kind === "head" && end.kind === "head") return true;
  const origin = start.kind === "head" ? piece.points[1] : piece.points[0];
  return pieces.some((other) => {
    if (other === piece || !other.stroked) return false;
    const otherDirection = axisDirection(other);
    if (!otherDirection || otherDirection === direction) return false;
    return other.points.some(([x, y]) => Math.hypot(x - origin[0], y - origin[1]) <= 16);
  });
}

/* ── distances ───────────────────────────────────────────────────────────── */

function boxDistance(x: number, y: number, b: { x: number; y: number; w: number; h: number }): number {
  const dx = Math.max(b.x - x, 0, x - (b.x + b.w));
  const dy = Math.max(b.y - y, 0, y - (b.y + b.h));
  return Math.hypot(dx, dy);
}

/** Distance from a point to an ellipse's edge (zero inside), measured along the ray from its centre. */
function ellipseDistance(x: number, y: number, e: { cx: number; cy: number; rx: number; ry: number }): number {
  const dx = x - e.cx;
  const dy = y - e.cy;
  const k = Math.hypot(dx / e.rx, dy / e.ry);
  if (k <= 1) return 0;
  return Math.hypot(dx, dy) * (1 - 1 / k);
}

function segmentDistance(x: number, y: number, a: Point, b: Point): number {
  const [ax, ay] = a;
  const [bx, by] = b;
  const lengthSq = (bx - ax) ** 2 + (by - ay) ** 2;
  const t = lengthSq === 0 ? 0 : Math.max(0, Math.min(1, ((x - ax) * (bx - ax) + (y - ay) * (by - ay)) / lengthSq));
  return Math.hypot(x - (ax + t * (bx - ax)), y - (ay + t * (by - ay)));
}

function polylineDistance(x: number, y: number, points: Point[]): number {
  if (points.length === 1) return Math.hypot(x - points[0][0], y - points[0][1]);
  let best = Infinity;
  for (let i = 1; i < points.length; i += 1) best = Math.min(best, segmentDistance(x, y, points[i - 1], points[i]));
  return best;
}

function partDistance(x: number, y: number, part: Part): number {
  return part.shape === "box" ? boxDistance(x, y, part) : ellipseDistance(x, y, part);
}

/**
 * How far this end is from the nearest thing it could legitimately be attached to: a label, a drawn
 * part (by its real edge), or any other stroke on the board (a leader may point at a curve on a
 * graph, an axis, another arrow). Never its own dot, its own head, or itself.
 */
function nearestAttachment(end: ConnectorEnd, connector: Connector, geometry: BoardGeometry, boxes: Box[]): number {
  let best = Infinity;
  for (const box of boxes) best = Math.min(best, boxDistance(end.x, end.y, box));
  const self = connector.piece.element;
  for (const part of geometry.parts) {
    if (part.element === self || end.own.includes(part.element)) continue;
    best = Math.min(best, partDistance(end.x, end.y, part));
  }
  for (const piece of geometry.pieces) {
    if (piece.element === self || end.own.includes(piece.element) || !piece.stroked) continue;
    if (piece.filledArea || piece.closed) continue; // already a part, by its bounds
    best = Math.min(best, polylineDistance(end.x, end.y, piece.samples));
  }
  return best;
}

/** Distance from an end to the nearest drawn PART or stroke — labels deliberately not counted. */
function nearestDrawing(end: ConnectorEnd, connector: Connector, geometry: BoardGeometry): number {
  return nearestAttachment(end, connector, geometry, []);
}

/**
 * A LABELLED VECTOR: an arrow that leaves a drawn part and carries its own words beside its body —
 * a force on a ball, oxygen leaving a leaf, light reflected off a mirror. Its head points into open
 * space BY DESIGN: the relation it states is "this part pushes / releases / emits in this direction",
 * and the words name it. Telling the refiner to "move the head onto a part, or delete the arrow"
 * would delete correct physics.
 *
 * Narrow on purpose: the TAIL must sit on a drawn part (an arrow that merely starts at its own label,
 * like the "CO2 + water" arrow pointing at the border, is not a vector), and a label must lie beside
 * the arrow's middle-to-head run, where the contract puts an arrow's words.
 */
function isLabelledVector(connector: Connector, tail: ConnectorEnd, geometry: BoardGeometry, boxes: Box[]): boolean {
  if (nearestDrawing(tail, connector, geometry) > CONNECTOR_RULES.ENDPOINT_TOLERANCE) return false;
  const run = tail === connector.start ? connector.piece.samples : [...connector.piece.samples].reverse();
  const total = pieceLength(run);
  // Walk the stroke in short steps: a straight arrow has no samples between its two ends.
  let travelled = 0;
  for (let i = 1; i < run.length; i += 1) {
    const [ax, ay] = run[i - 1];
    const [bx, by] = run[i];
    const length = Math.hypot(bx - ax, by - ay);
    const steps = Math.max(1, Math.ceil(length / 6));
    for (let k = 1; k <= steps; k += 1) {
      if (travelled + (length * k) / steps < total * 0.3) continue;
      const [x, y] = [ax + ((bx - ax) * k) / steps, ay + ((by - ay) * k) / steps];
      if (boxes.some((box) => boxDistance(x, y, box) <= 16)) return true;
    }
    travelled += length;
  }
  return false;
}

/* ── the checks ──────────────────────────────────────────────────────────── */

/**
 * Connectors whose ends touch nothing, described so the refiner can act on them — at most one per
 * kind: an arrow whose HEAD points at nothing (the worse fault, first), then a leader or line with an
 * end in empty space.
 */
export function connectorEndIssues(geometry: BoardGeometry, boxes: Box[]): string[] {
  // Nothing to attach TO means nothing can fairly be called unattached.
  const anything = boxes.length > 0 || geometry.parts.length > 0;
  if (!anything) return [];
  const connectors = classifyConnectors(geometry);
  let headIssue: string | null = null;
  let endIssue: string | null = null;

  for (const connector of connectors) {
    for (const end of [connector.start, connector.end]) {
      const tolerance = end.kind === "tail" ? CONNECTOR_RULES.ENDPOINT_TOLERANCE : CONNECTOR_RULES.HEAD_TOLERANCE;
      const distance = nearestAttachment(end, connector, geometry, boxes);
      if (distance <= tolerance) continue;
      const other = end === connector.start ? connector.end : connector.start;
      if (end.kind === "head" && other.kind === "tail" && isLabelledVector(connector, other, geometry, boxes)) continue;
      const run = `(the full stroke runs ${Math.round(connector.x1)},${Math.round(connector.y1)} to ${Math.round(connector.x2)},${Math.round(connector.y2)})`;
      const nearest = Number.isFinite(distance) ? `the nearest label or drawn part is ${Math.round(distance)} px away` : "nothing is drawn near it";
      if (end.kind === "head" && !headIssue) {
        headIssue =
          `an arrow's head points at nothing: it ends at ${Math.round(end.x)},${Math.round(end.y)} ${run}, and ${nearest}. ` +
          `An arrowhead must end 4-6 px short of the named part it acts on, pointing into it — never at blank paper or the board edge. ` +
          `Move the head onto that part, or delete the arrow`;
      } else if (end.kind === "dot" && !endIssue) {
        endIssue =
          `a label's leader dot sits in empty space at ${Math.round(end.x)},${Math.round(end.y)} ${run}, and ${nearest}, ` +
          `so the label names nothing the student can see. The dot must sit inside the drawn part the label names — move the dot onto that part`;
      } else if (end.kind === "tail" && !endIssue) {
        endIssue =
          `a connector ends in empty space at ${Math.round(end.x)},${Math.round(end.y)} ${run}, touching no label and no shape. ` +
          `Every arrow must join two named things and its direction must state the relation between them — ` +
          `delete this stroke, or attach it to what it is meant to connect`;
      }
    }
    if (headIssue && endIssue) break;
  }
  return [headIssue, endIssue].filter((issue): issue is string => issue !== null);
}

/**
 * Every visible stroke that is not filled artwork, as straight segments along what it really draws —
 * the geometry a label must not be printed across. Strokes shorter than a hairline are skipped.
 */
export function strokeSegments(geometry: BoardGeometry): Segment[] {
  const segments: Segment[] = [];
  for (const piece of geometry.pieces) {
    if (!piece.stroked || piece.filledArea) continue;
    const run = piece.closed ? [...piece.samples, piece.samples[0]] : piece.samples;
    if (pieceLength(run) < CONNECTOR_RULES.MIN_SEGMENT_LENGTH) continue;
    for (let i = 1; i < run.length; i += 1) {
      const [x1, y1] = run[i - 1];
      const [x2, y2] = run[i];
      if (x1 !== x2 || y1 !== y2) segments.push({ x1, y1, x2, y2 });
    }
  }
  return segments;
}

/**
 * The written lines' boxes in BOARD coordinates.
 *
 * `measure` is the caller's text measurement (the critic measures with the board font's real glyph
 * widths); it is handed each <text> element's own markup, and the boxes it returns are carried
 * through the transforms that element is drawn under — so a label inside a translated group, or a
 * y-axis title rotated by -90, is tested where the student actually sees it. An `ink` band
 * ({y, h}: the line's own vertical ink, which the critic's text-on-text check reads) is moved with
 * the box; any other fields the measurement returns are carried through unchanged.
 */
export function textBoxesInBoardSpace<T extends Box>(geometry: BoardGeometry, measure: (markup: string) => T[]): T[] {
  const out: T[] = [];
  const moved = (ctm: Matrix, x: number, y: number, w: number, h: number) =>
    bounds([applyMatrix(ctm, x, y), applyMatrix(ctm, x + w, y), applyMatrix(ctm, x, y + h), applyMatrix(ctm, x + w, y + h)]);
  for (const text of geometry.texts) {
    for (const box of measure(text.markup)) {
      if (isIdentity(text.ctm)) {
        out.push(box);
        continue;
      }
      const placed = { ...box, ...moved(text.ctm, box.x, box.y, box.w, box.h) };
      const ink = (box as { ink?: unknown }).ink as { y?: unknown; h?: unknown } | undefined;
      if (ink && typeof ink.y === "number" && typeof ink.h === "number") {
        const band = moved(text.ctm, box.x, ink.y, box.w, ink.h);
        (placed as { ink?: unknown }).ink = { ...ink, y: band.y, h: band.h };
      }
      out.push(placed);
    }
  }
  return out;
}

/* ── the legacy string-level entry points (kept for their callers and tests) ── */

/** Every visible stroke on the board, as straight segments (see strokeSegments). */
export function parseConnectors(svg: string): Segment[] {
  return strokeSegments(readBoardGeometry(svg));
}

/** Circles, ellipses and rects as centre-and-radius anchors; frames and backdrops excluded. */
export function parseAnchors(svg: string): Anchor[] {
  return readBoardGeometry(svg)
    .parts.filter((part) => part.from === "rect" || part.from === "circle" || part.from === "ellipse")
    .map((part) =>
      part.shape === "ellipse"
        ? { x: part.cx, y: part.cy, r: Math.max(part.rx, part.ry) }
        : { x: part.x + part.w / 2, y: part.y + part.h / 2, r: Math.max(part.w, part.h) / 2 },
    );
}

/**
 * The centres of arrowhead-sized filled shapes.
 *
 * Bounded by span so a filled ORGAN is never mistaken for an arrowhead: anything larger is artwork
 * and is left alone, which keeps the filled-path exemption doing the job it exists for. Marker
 * templates in <defs> are not on the board and are not read.
 */
export function parseArrowheads(svg: string): Array<{ x: number; y: number }> {
  return readBoardGeometry(svg).arrowheads.map(({ x, y }) => ({ x, y }));
}

/**
 * The first connector with an end in empty space, for callers holding plain segments and
 * centre-and-radius anchors: each segment is treated as a connector with two plain ends.
 *
 * An arrow is a claim that two things are related. One that starts or stops in blank space makes no
 * claim, and on the board that prompted this check those strokes read as decoration the student was
 * left trying to interpret.
 */
export function danglingConnectorIssue(segments: Segment[], boxes: Box[], anchors: Anchor[]): string | null {
  const geometry: BoardGeometry = {
    viewBox: { ...DEFAULT_VIEWBOX },
    pieces: segments.map((s, i) => ({
      from: "line",
      element: -1 - i,
      subpaths: 1,
      points: [[s.x1, s.y1], [s.x2, s.y2]],
      samples: [[s.x1, s.y1], [s.x2, s.y2]],
      closed: false,
      curved: false,
      stroked: true,
      filledArea: false,
      markerStart: false,
      markerEnd: false,
      step: null,
      stepKind: null,
    })),
    parts: anchors.map((a, i) => ({ shape: "ellipse", cx: a.x, cy: a.y, rx: a.r, ry: a.r, from: "anchor", step: null, element: 1_000_000 + i })),
    arrowheads: [],
    texts: [],
  };
  // Segments here are connectors by the caller's say-so, whatever their length.
  const connectors: Connector[] = geometry.pieces.map((piece) => ({
    x1: piece.points[0][0],
    y1: piece.points[0][1],
    x2: piece.points[1][0],
    y2: piece.points[1][1],
    role: "line",
    start: { x: piece.points[0][0], y: piece.points[0][1], kind: "tail", own: [] },
    end: { x: piece.points[1][0], y: piece.points[1][1], kind: "tail", own: [] },
    piece,
  }));
  if (boxes.length === 0 && anchors.length === 0) return null;
  for (const connector of connectors) {
    for (const end of [connector.start, connector.end]) {
      if (nearestAttachment(end, connector, { ...geometry, pieces: [] }, boxes) <= CONNECTOR_RULES.ENDPOINT_TOLERANCE) continue;
      return (
        `a connector ends in empty space at ${Math.round(end.x)},${Math.round(end.y)} ` +
        `(the full stroke runs ${Math.round(connector.x1)},${Math.round(connector.y1)} to ` +
        `${Math.round(connector.x2)},${Math.round(connector.y2)}), touching no label and no shape. ` +
        `Every arrow must join two named things and its direction must state the relation between them — ` +
        `delete this stroke, or attach it to what it is meant to connect`
      );
    }
  }
  return null;
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
 * The first stroke drawn through a label, described so the retry can act on it.
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

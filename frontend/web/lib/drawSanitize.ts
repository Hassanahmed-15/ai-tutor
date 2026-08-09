import type { Beat, CheckpointSpec, SlideKind } from "./lessonContent";
import type { DrawScript } from "@/components/sketch/LiveSketch";
import { validateManimSceneSpec } from "./manimSceneSpec";
import { validateStructureSpec } from "./structureSpec";
import { validatePlotSpec } from "./plotSpec";
import { validateEquationSpec } from "./equationSpec";

/**
 * Defensive validation for LLM-generated DrawScript lectures — never trust raw model
 * output. Clamps coordinates to the 0–100 grid, validates op kinds, maps named
 * colors to the marker hex palette, drops malformed ops, and drops beats that end up with
 * no usable content. Mirrors the spirit of lib/lectureSanitize.ts (same instinct, the
 * DrawScript schema instead of the template schema).
 */

const VALID_SLIDE_KINDS: SlideKind[] = ["intro", "definition", "checkpoint", "compare", "recap"];

// When the dynamic chalk-blackboard pipeline is off, the sanitizer keeps the legacy behavior:
// blackboard beats are synthesized by makeWrittenBoard() templates instead of emitting a
// `chalkBoard` placeholder (which would otherwise never get filled → an "unavailable" card).
// Server-only env; the client mirror is NEXT_PUBLIC_BLACKBOARD_GEN_ENABLED in LessonPlayer.
const BLACKBOARD_GEN_ENABLED = process.env.BLACKBOARD_GEN_ENABLED === "1";

/** Named colors the prompt allows -> the marker palette LiveSketch strokes with. */
const COLOR_MAP: Record<string, string> = {
  amber: "#d97706",
  green: "#15803d",
  blue: "#2563eb",
  slate: "#1e293b",
  rose: "#be123c",
  violet: "#7c3aed",
};

function str(v: unknown, fallback = ""): string {
  return typeof v === "string" && v.trim() ? v.trim() : fallback;
}
function strArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.trim().length > 0) : [];
}

/** Clamp a coordinate/size into the visible grid. Returns null for non-finite input. */
function coord(v: unknown, fallback?: number): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  if (!Number.isFinite(n)) return fallback ?? null;
  return Math.max(0, Math.min(100, n));
}
/** Clamp generated positions away from the edges; sizes still use coord(). */
function pos(v: unknown, fallback?: number): number | null {
  const n = coord(v, fallback);
  if (n === null) return null;
  return Math.max(8, Math.min(92, n));
}
/** 0..1 timeline fraction. */
function frac(v: unknown, fallback: number): number {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(1, n));
}
function color(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  return COLOR_MAP[v.trim().toLowerCase()] ?? undefined;
}
function size(v: unknown): "sm" | "md" | "lg" | undefined {
  return v === "sm" || v === "md" || v === "lg" ? v : undefined;
}

type DrawOp = DrawScript["ops"][number];
type MotionOp = Extract<DrawOp, { kind: "motion" }>;
type SceneOp = Extract<DrawOp, { kind: "scene" }>;
export type ReactAnimationOp = Extract<DrawOp, { kind: "reactAnimation" }>;
export type ChalkBoardOp = Extract<DrawOp, { kind: "chalkBoard" }>;
type ImageOp = Extract<DrawOp, { kind: "image" }> & { assetId?: string; providedAssetId?: string };
type DrawRepairContext = {
  title?: string;
  script?: string;
  slideKind?: SlideKind;
  index?: number;
  points?: string[];
  compareLeft?: { label: string; points: string[] };
  compareRight?: { label: string; points: string[] };
};

function motionKind(v: unknown): MotionOp["motion"] {
  return v === "beam" || v === "orbit" || v === "collapse" || v === "pulse" || v === "reveal" || v === "flow" ? v : "flow";
}
function sceneKind(v: unknown): SceneOp["scene"] {
  return v === "spotlight" || v === "compare" || v === "cycle" || v === "system" || v === "timeline" || v === "graph" || v === "process" ? v : "process";
}

/** Generated-topic boards now use the image as the whole live whiteboard backdrop. The
 *  marker/animation layer writes on top; dimensions from older right-panel prompts are
 *  ignored by the renderer, but the sanitized default is full-board for new/fallback ops. */
const IMAGE_DEFAULT_W = 100;
const IMAGE_DEFAULT_H = 100;
const IMAGE_DEFAULT_X = 50;
const IMAGE_DEFAULT_Y = 50;

/** True if a point sits inside (or very near) an image's bounding box. Kept for legacy
 *  panel layouts; generated boards now treat the first image as the whole live backdrop. */
function overlapsImage(x: number, y: number, img: { x: number; y: number; w: number; h: number }): boolean {
  const pad = 4; // small buffer so text doesn't hug the image edge either
  return (
    x > img.x - img.w / 2 - pad &&
    x < img.x + img.w / 2 + pad &&
    y > img.y - img.h / 2 - pad &&
    y < img.y + img.h / 2 + pad
  );
}

/** Validates one draw op, returning a clean op or null to drop it. Static "shape"/
 *  "circleHighlight"/"underline" ops are not part of the grammar (per explicit user feedback
 *  that motionless abstract shapes read as generic clip-art clutter) — only "image", "callout",
 *  "label", "arrow", "note", "motion", and "scene" survive. Legacy "morph" is converted into a semantic flow
 *  motion so old cached output still animates without drawing random tokens. */
function sanitizeOp(raw: unknown, imageBox?: { x: number; y: number; w: number; h: number }): DrawOp | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const rawKind = typeof o.kind === "string" ? o.kind.trim() : "";
  const at = frac(o.at, 0.1);
  const c = color(o.color);

  switch (rawKind) {
    case "label": {
      const text = str(o.text);
      let x = pos(o.x);
      let y = pos(o.y);
      if (!text || x === null || y === null) return null;
      if (imageBox && overlapsImage(x, y, imageBox)) {
        // Push the label out to the nearest margin rather than dropping it.
        x = x < imageBox.x ? Math.max(8, imageBox.x - imageBox.w / 2 - 8) : Math.min(92, imageBox.x + imageBox.w / 2 + 8);
        y = Math.max(10, Math.min(90, y));
      }
      return { kind: "label", text: text.slice(0, 40), x, y, size: size(o.size), color: c, at };
    }
    case "callout": {
      const text = str(o.text);
      const x = pos(o.x ?? o.targetX);
      const y = pos(o.y ?? o.targetY);
      const labelX = pos(o.labelX ?? o.lx, x !== null ? (x < 50 ? x + 18 : x - 18) : undefined);
      const labelY = pos(o.labelY ?? o.ly, y !== null ? y - 12 : undefined);
      if (!text || x === null || y === null) return null;
      return { kind: "callout", text: text.slice(0, 34), x, y, labelX: labelX ?? undefined, labelY: labelY ?? undefined, color: c, at };
    }
    case "note": {
      const text = str(o.text);
      const x = pos(o.x);
      let y = pos(o.y);
      if (!text || x === null || y === null) return null;
      if (imageBox && overlapsImage(x, y, imageBox)) {
        // Notes belong in the top/bottom margin — snap to whichever is closer.
        y = y < imageBox.y ? Math.max(10, imageBox.y - imageBox.h / 2 - 8) : Math.min(90, imageBox.y + imageBox.h / 2 + 8);
      }
      return { kind: "note", text: text.slice(0, 100), x, y, color: c, at };
    }
    case "arrow": {
      const x1 = pos(o.x1);
      const y1 = pos(o.y1);
      const x2 = pos(o.x2);
      const y2 = pos(o.y2);
      if (x1 === null || y1 === null || x2 === null || y2 === null) return null;
      return { kind: "arrow", x1, y1, x2, y2, curved: o.curved === true, color: c, at };
    }
    case "image": {
      // `prompt` is required (written by the text model, filled before client delivery).
      // `src` may be absent at sanitize time and is populated by fillImageOps after generation.
      const prompt = str(o.prompt);
      if (!prompt) return null;
      const x = pos(o.x) ?? IMAGE_DEFAULT_X;
      const y = pos(o.y) ?? IMAGE_DEFAULT_Y;
      const op: Record<string, unknown> = { kind: "image", prompt, x, y, at };
      const assetId = str(o.assetId ?? o.providedAssetId);
      if (assetId) op.assetId = assetId.slice(0, 120);
      op.w = coord(o.w) ?? IMAGE_DEFAULT_W;
      op.h = coord(o.h) ?? IMAGE_DEFAULT_H;
      if (typeof o.src === "string" && o.src) op.src = o.src;
      return op as DrawOp;
    }
    case "motion": {
      const motion = motionKind(o.motion);
      const startedAt = frac(o.at, 0.22);
      const endAt = frac(o.endAt ?? o.morphAt, Math.min(0.95, startedAt + 0.32));
      if (endAt <= startedAt) return null;
      const op: MotionOp = {
        kind: "motion",
        motion,
        color: c,
        text: str(o.text).slice(0, 18) || undefined,
        at: startedAt,
        endAt,
      };
      if (motion === "orbit" || motion === "pulse" || motion === "reveal") {
        op.cx = pos(o.cx ?? o.x ?? o.x1, 50) ?? 50;
        op.cy = pos(o.cy ?? o.y ?? o.y1, 50) ?? 50;
        op.r = coord(o.r, 14) ?? 14;
      } else {
        op.x1 = pos(o.x1 ?? o.x, 18) ?? 18;
        op.y1 = pos(o.y1 ?? o.y, 50) ?? 50;
        op.x2 = pos(o.x2 ?? o.toX, 72) ?? 72;
        op.y2 = pos(o.y2 ?? o.toY, 50) ?? 50;
      }
      return op;
    }
    case "scene": {
      const scene = sceneKind(o.scene ?? o.mode ?? o.type);
      const items = strArray(o.items).map((item) => shorten(item, 32)).filter(Boolean).slice(0, 5);
      const title = shorten(str(o.title), 48);
      if (!title && items.length === 0) return null;
      const startedAt = frac(o.at, 0.18);
      const endAt = frac(o.endAt, Math.min(0.95, startedAt + 0.62));
      const op: SceneOp = {
        kind: "scene",
        scene,
        title: title || undefined,
        items: items.length ? items : undefined,
        left: shorten(str(o.left), 22) || undefined,
        right: shorten(str(o.right), 22) || undefined,
        color: c,
        at: startedAt,
      };
      if (endAt > startedAt) op.endAt = endAt;
      return op;
    }
    case "morph": {
      // Legacy repair: old prompts emitted moving shape tokens. Convert the travel path into
      // a semantic flow animation and discard the token shape completely.
      let x = pos(o.x);
      let y = pos(o.y);
      let toX = pos(o.toX);
      let toY = pos(o.toY);
      if (x === null || y === null || toX === null || toY === null) return null;
      const morphAt = frac(o.morphAt, at + 0.2);
      if (morphAt <= at) return null; // travel must move forward in time — never coerce a glitch
      if (imageBox) {
        // Legacy panel repair only.
        if (overlapsImage(x, y, imageBox)) {
          x = x < imageBox.x ? Math.max(8, imageBox.x - imageBox.w / 2 - 8) : Math.min(92, imageBox.x + imageBox.w / 2 + 8);
          y = Math.max(10, Math.min(90, y));
        }
        if (overlapsImage(toX, toY, imageBox)) {
          toX = toX < imageBox.x ? Math.max(8, imageBox.x - imageBox.w / 2 - 8) : Math.min(92, imageBox.x + imageBox.w / 2 + 8);
          toY = Math.max(10, Math.min(90, toY));
        }
      }
      return {
        kind: "motion",
        motion: "flow",
        text: str(o.toText, str(o.text)).slice(0, 18) || undefined,
        x1: x,
        y1: y,
        x2: toX,
        y2: toY,
        color: color(o.toColor) ?? c,
        at,
        endAt: morphAt,
      };
    }
    case "plotBoard":
    case "equationBoard": {
      // Same two-step shape as structureScene below: keep the brief, keep a `spec` only once it
      // validates, and preserve an explicit failure so the player can say so rather than showing a
      // blank board. Both validators guarantee renderability — Vega-Lite compiles the chart spec,
      // KaTeX compiles every TeX line — so a `spec` that survives here is one the board can draw.
      const isPlot = rawKind === "plotBoard";
      const briefKey = isPlot ? "plotBrief" : "equationBrief";
      const brief = str(o[briefKey]);
      if (!brief) return null;
      const op: Record<string, unknown> = {
        kind: rawKind,
        [briefKey]: brief.slice(0, 240),
        at: 0,
        endAt: 1,
      };
      const spec = isPlot ? validatePlotSpec(o.spec) : validateEquationSpec(o.spec);
      if (spec) op.spec = spec;
      if (o.status === "failed") {
        op.status = "failed";
        const error = str(o.error);
        if (error) op.error = error.slice(0, 200);
      }
      return op as unknown as DrawOp;
    }
    case "structureScene": {
      // TYPE F. Mirrors manimScene exactly: keep the brief, keep a `spec` only once it validates,
      // and preserve an explicit failure so the player can say so rather than showing a blank board.
      const structureBrief = str(o.structureBrief);
      if (!structureBrief) return null;
      const op: Record<string, unknown> = {
        kind: "structureScene",
        structureBrief: structureBrief.slice(0, 240),
        at: 0,
        endAt: 1,
      };
      const spec = validateStructureSpec(o.spec);
      if (spec) op.spec = spec;
      if (o.status === "failed") {
        op.status = "failed";
        const error = str(o.error);
        if (error) op.error = error.slice(0, 200);
      }
      return op as DrawOp;
    }
    case "manimScene": {
      // The diagram board (TYPE D). `spec` is filled by a second call and validated by
      // validateManimSceneSpec — an unvalidated spec never reaches the renderer, and an op
      // whose brief is missing is not worth keeping.
      const sceneBrief = str(o.sceneBrief);
      if (!sceneBrief) return null;
      const op: Record<string, unknown> = { kind: "manimScene", sceneBrief: sceneBrief.slice(0, 240), at: 0, endAt: 1 };
      const spec = validateManimSceneSpec(o.spec);
      if (spec) op.spec = spec;
      if (o.status === "failed") {
        op.status = "failed";
        const error = str(o.error);
        if (error) op.error = error.slice(0, 200);
      }
      return op as DrawOp;
    }
    default:
      // "shape" / "circleHighlight" / "underline" / anything else: static decoration, not
      // part of the grammar. Drop silently — the board still renders fine without them.
      return null;
  }
}

/** Valid chalk shape kinds a generated blackboard diagram may use (all render in LiveSketch's
 *  pathFor/CompoundShapeRenderer). */
const CHALK_SHAPES: ReadonlySet<string> = new Set([
  "circle", "rect", "hexagon", "line", "chain", "leaf", "sun", "droplet", "stove",
]);

/** Sanitizes ONE op for a generated chalk blackboard. Unlike the top-level sanitizeOp, this
 *  PERMITS `shape` ops (for real hand-drawn diagrams) — kept scoped here so shapes never leak
 *  into image/animation beats, which still go through sanitizeOp where `shape` is dropped.
 *  Reuses the same clamps (pos/coord/frac/color) as sanitizeOp for label/note/arrow. */
function sanitizeChalkOp(raw: unknown): DrawOp | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const rawKind = typeof o.kind === "string" ? o.kind.trim() : "";
  const at = frac(o.at, 0.1);
  const c = color(o.color);

  switch (rawKind) {
    case "label": {
      const text = str(o.text);
      const x = pos(o.x);
      const y = pos(o.y);
      if (!text || x === null || y === null) return null;
      return { kind: "label", text: text.slice(0, 44), x, y, size: size(o.size), color: c, at };
    }
    case "note": {
      const text = str(o.text);
      const x = pos(o.x);
      const y = pos(o.y);
      if (!text || x === null || y === null) return null;
      return { kind: "note", text: text.slice(0, 120), x, y, color: c, at };
    }
    case "arrow": {
      const x1 = pos(o.x1);
      const y1 = pos(o.y1);
      const x2 = pos(o.x2);
      const y2 = pos(o.y2);
      if (x1 === null || y1 === null || x2 === null || y2 === null) return null;
      return { kind: "arrow", x1, y1, x2, y2, curved: o.curved === true, color: c, at };
    }
    case "shape": {
      const shape = typeof o.shape === "string" ? o.shape.trim() : "";
      if (!CHALK_SHAPES.has(shape)) return null;
      const x = pos(o.x);
      const y = pos(o.y);
      if (x === null || y === null) return null;
      const op: Record<string, unknown> = { kind: "shape", shape, x, y, color: c, at };
      const w = coord(o.w);
      const h = coord(o.h);
      if (w !== null) op.w = w;
      if (h !== null) op.h = h;
      // Points for line/chain polylines — clamp each to the grid; drop malformed.
      if (Array.isArray(o.points)) {
        const pts = o.points
          .map((p) => {
            if (!p || typeof p !== "object") return null;
            const pr = p as Record<string, unknown>;
            const px = pos(pr.x);
            const py = pos(pr.y);
            return px === null || py === null ? null : { x: px, y: py };
          })
          .filter((p): p is { x: number; y: number } => p !== null)
          .slice(0, 24);
        if (pts.length >= 2) op.points = pts;
      }
      return op as DrawOp;
    }
    default:
      return null;
  }
}

/** Sanitizes a full set of generated chalk-board ops. Clamps `at` into 0..1 and sorts by `at`
 *  so the reveal order is stable. */
export function sanitizeChalkBoardOps(rawOps: unknown): DrawOp[] {
  if (!Array.isArray(rawOps)) return [];
  return rawOps
    .map((op) => sanitizeChalkOp(op))
    .filter((op): op is DrawOp => op !== null)
    // Blackboards are TEXT ONLY — drop any diagram geometry (shapes/arrows) so the weak,
    // box-like auto-diagrams can never render. Only labels and notes survive.
    .filter((op) => op.kind === "label" || op.kind === "note")
    .sort((a, b) => a.at - b.at);
}

export type BlackboardDiagnostics = { issue: string | null; labelCount: number; noteCount: number; diagramCount: number; opCount: number };

/** Quality bar for a generated chalk board — deliberately NOT the animation density validator
 *  (a blackboard is legitimately text-heavy). The board is TEXT ONLY: checks it has a heading +
 *  real content rows and that the text is clean (no fragments/dupes/overlap). No diagram required
 *  — diagram geometry is stripped in sanitizeChalkBoardOps. Called by blackboardGen. */
export function getBlackboardDiagnostics(ops: DrawOp[]): BlackboardDiagnostics {
  const labels = ops.filter((op) => op.kind === "label");
  const notes = ops.filter((op) => op.kind === "note");
  // diagramCount is always 0 now (shapes/arrows stripped) — kept in the shape for callers/logging.
  const base = { labelCount: labels.length, noteCount: notes.length, diagramCount: 0, opCount: ops.length };

  const textRows = labels.length + notes.length;
  if (textRows < 4) return { ...base, issue: "too sparse; a blackboard needs a heading plus several content rows" };
  if (ops.length > 24) return { ...base, issue: "too crowded; keep it to a heading and ~4-6 clean rows" };
  if (labels.length < 3) return { ...base, issue: "needs a heading label plus a term/symbol label per content row (3+ labels)" };
  if (notes.length < 1) return { ...base, issue: "needs at least one explanatory note giving real context beyond the labels" };
  if (blackboardTextOverlaps(ops)) return { ...base, issue: "two or more text rows overlap; stack rows top-to-bottom with >= 9 grid units of vertical gap and no two at the same y" };
  if (!blackboardTextIsClean(ops)) return { ...base, issue: "text has fragments, duplicates, or over-long lines; write complete self-contained chalk phrases" };
  return { ...base, issue: null };
}

/** Detects overlapping text on the board. Text ops are LEFT-anchored: `x` is where the text
 *  starts and it extends rightward by its rendered width. Two ops on the same visual row collide
 *  when one's [x, x+width] span reaches into the other's. We also flag a single label so wide it
 *  runs off the right edge (x+width > 92) — that "Price Interactio…" clipping is a form of overlap
 *  with the frame. Catches the "blackboard texts overlap" failure so the generator retries. */
function blackboardTextOverlaps(ops: DrawOp[]): boolean {
  type TextOp = Extract<DrawOp, { kind: "label" | "note" }>;
  const textOps = ops.filter((op): op is TextOp => op.kind === "label" || op.kind === "note");

  // Per-character grid width, font-size aware. Big headings render much wider per glyph than a
  // small note, so a flat estimate under-counts labels and misses exactly the collisions seen.
  const charW = (op: TextOp): number => {
    if (op.kind === "note") return 0.95;
    const size = "size" in op ? op.size : "md";
    return size === "lg" ? 2.0 : size === "sm" ? 0.95 : 1.35; // md default
  };
  // Rendered width in grid units (left edge = x, right edge = x + width). Text wraps in the
  // renderer past ~ the frame, but for collision purposes the un-wrapped run is the worst case.
  const width = (op: TextOp): number => op.text.trim().length * charW(op);
  // Row height each op occupies vertically (bigger text needs more vertical clearance).
  const rowH = (op: TextOp): number => (op.kind === "label" && "size" in op && op.size === "lg" ? 12 : 8);

  for (let i = 0; i < textOps.length; i++) {
    const a = textOps[i];
    // A label/note whose right edge runs past the frame margin is effectively overlapping the edge
    // (and will visually collide with whatever is placed to its right). Flag it.
    if (a.x + width(a) > 92) return true;
    for (let j = i + 1; j < textOps.length; j++) {
      const b = textOps[j];
      const dy = Math.abs(a.y - b.y);
      // TWO OPS ON (NEARLY) THE SAME ROW is banned outright — this board is a single left column,
      // one line per op. The most common overlap (a label and its note placed side-by-side on the
      // same y, then colliding because the label is longer than the model estimated) is caught here
      // regardless of x/width guesswork: if two text ops are within ~5 units of the same y, FAIL.
      if (dy < 5) return true;
      if (dy >= Math.max(rowH(a), rowH(b)) / 2 + 3) continue; // otherwise clearly separate rows
      // Near rows: also verify the horizontal spans don't intersect (with a small gap).
      const aL = a.x, aR = a.x + width(a);
      const bL = b.x, bR = b.x + width(b);
      if (aL < bR + 2 && bL < aR + 2) return true;
    }
  }
  return false;
}

// Generated React animation code never gets a free pass just because it's sandboxed client-side
// (defense in depth): reject obviously hostile/escape-attempting source before it's ever stored
// or shipped to a browser, and cap size so transpile cost + iframe payload stay bounded.
const REACT_ANIMATION_CODE_MIN_BYTES = 1600;
// 48KB: strong code models (gpt-5.x) write genuinely rich full-board scenes that legitimately
// run 25-40KB. The sandbox renders arbitrary SVG fine, so the only reason to cap at all is to
// bound transpile cost and reject runaway output — 48KB is generous headroom for a real scene
// while still catching pathological cases. (Was 24KB, calibrated for gpt-4o's smaller output.)
const REACT_ANIMATION_CODE_MAX_BYTES = 48 * 1024;
const REACT_ANIMATION_BANNED_PATTERNS: RegExp[] = [
  /\bfetch\s*\(/, /\bXMLHttpRequest\b/, /\bimport\s*\(/, /\brequire\s*\(/,
  /\bdocument\s*\./, /\bwindow\s*\./, /\bnavigator\s*\./, /\blocation\s*(?:\.|=|\[)/,
  /\bFunction\s*\(/, /\beval\s*\(/, /<script/i,
  /\blocalStorage\b/, /\bsessionStorage\b/, /\bindexedDB\b/, /\bWebSocket\b/,
];
const REACT_ANIMATION_EXPORT_PATTERN = /export\s+default\s+function\s+Animation\s*\(\s*\{\s*progress\s*\}\s*\)/;

export type ReactAnimationCodeDiagnostics = {
  issue: string | null;
  /** Only the HARD safety/structural failures (empty, too large, wrong export signature, banned
   *  browser APIs, no full-board SVG) — never the soft quality/density ones. `issue` is
   *  `safetyIssue ?? <quality issue>`, so a candidate that fails only on quality has this null. */
  safetyIssue: string | null;
  byteLength: number;
  groupCount: number;
  primitiveTagCount: number;
  primitiveScore: number;
  objectPrimitiveScore: number;
  silhouetteCount: number;
  lineLikeCount: number;
  textCount: number;
  directlyTimedTextCount: number;
  distinctPrimitiveTypes: number;
  progressRefs: number;
  progressDriveScore: number;
  repeaters: number;
  darkFillCount: number;
  brightFillCount: number;
  timelineStepCount: number;
  timelineSentenceCount: number;
  distinctTimelineSentences: number;
  boardPlanPresent: boolean;
  visualSpecPresent: boolean;
  tagCounts: Record<string, number>;
};

/** True if a hex color (#rgb or #rrggbb) is so dark it vanishes into the near-black board
 *  background (#020617) — perceived luma below a low threshold. Used to catch the "everything
 *  drawn in dark-navy so it looks unfilled/monochrome" failure. */
function isNearBackgroundDark(hex: string): boolean {
  let h = hex.replace("#", "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  if (h.length !== 6) return false;
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  if ([r, g, b].some((v) => Number.isNaN(v))) return false;
  // Rec. 601 luma. #020617≈6, #0f172a≈22, #1e293b≈40, #334155≈52. Treat <= 55 as too dark to
  // read as a real filled part on the near-black board.
  const luma = 0.299 * r + 0.587 * g + 0.114 * b;
  return luma <= 55;
}

export function getReactAnimationCodeDiagnostics(
  rawCode: string,
  opts: { abstract?: boolean } = {},
): ReactAnimationCodeDiagnostics {
  const code = rawCode.trim();
  // Abstract/conceptual topics (algorithms, data structures, math) are correctly drawn AS diagrams
  // — a timeline, array/table, tree, graph, number line. The physical-only quality gates below
  // (silhouette, object-vs-line ratio, "real scene objects") would wrongly reject exactly those, so
  // in abstract mode we skip them and keep only the safety + teaching-timeline + basic-richness gates.
  const abstract = opts.abstract === true;
  const base = {
    byteLength: new TextEncoder().encode(code).length,
    groupCount: 0,
    primitiveTagCount: 0,
    primitiveScore: 0,
    objectPrimitiveScore: 0,
    silhouetteCount: 0,
    lineLikeCount: 0,
    textCount: 0,
    directlyTimedTextCount: 0,
    distinctPrimitiveTypes: 0,
    progressRefs: 0,
    progressDriveScore: 0,
    repeaters: 0,
    darkFillCount: 0,
    brightFillCount: 0,
    timelineStepCount: 0,
    timelineSentenceCount: 0,
    distinctTimelineSentences: 0,
    boardPlanPresent: false,
    visualSpecPresent: false,
    tagCounts: {},
    safetyIssue: null as string | null,
  };
  // Hard safety/structural gate — these ALSO set safetyIssue, so callers that only want to reject
  // genuinely unsafe/unrenderable code (ACCEPT_BEST) can gate on safetyIssue alone.
  if (!code) return { ...base, issue: "empty animation source", safetyIssue: "empty animation source" };

  const byteLength = base.byteLength;
  if (byteLength > REACT_ANIMATION_CODE_MAX_BYTES) {
    const m = "too large; keep the scene focused and under 48KB";
    return { ...base, issue: m, safetyIssue: m };
  }
  if (!REACT_ANIMATION_EXPORT_PATTERN.test(code)) {
    const m = "missing exact export signature: export default function Animation({ progress })";
    return { ...base, issue: m, safetyIssue: m };
  }
  const banned = REACT_ANIMATION_BANNED_PATTERNS.find((re) => re.test(code));
  if (banned) {
    const m = "uses a banned browser/API pattern; keep it pure SVG/CSS/React";
    return { ...base, issue: m, safetyIssue: m };
  }
  if (!/<\s*svg\b/i.test(code) || !/\bviewBox\s*=/.test(code)) {
    const m = "must render a full-board SVG with a viewBox";
    return { ...base, issue: m, safetyIssue: m };
  }

  const primitiveTags = [...code.matchAll(/<\s*(path|circle|rect|ellipse|polygon|polyline|line|text)\b/gi)].map((match) =>
    match[1].toLowerCase()
  );
  const tagCounts = primitiveTags.reduce<Record<string, number>>((counts, tag) => {
    counts[tag] = (counts[tag] ?? 0) + 1;
    return counts;
  }, {});
  const groupCount = (code.match(/<\s*g\b/gi) ?? []).length;
  // NOTE: repeaters (Array.from/.map calls) intentionally no longer add a flat score bonus.
  // A per-call bonus regardless of array length rewarded wrapping ANY tiny repeated cluster in
  // a .map() as a cheap way to inflate the score — the direct cause of scenes where every
  // sub-component got its own decorative dot-cluster just to pad primitiveScore/objectPrimitiveScore.
  // Real richness must come from the actual primitive tag count the code renders.
  const repeaters = (code.match(/Array\.from|\bmap\s*\(/g) ?? []).length;
  const primitiveScore = primitiveTags.length;
  const distinctPrimitiveTypes = new Set(primitiveTags);
  const objectPrimitiveScore =
    (tagCounts.path ?? 0) +
    (tagCounts.rect ?? 0) +
    (tagCounts.circle ?? 0) +
    (tagCounts.ellipse ?? 0) +
    (tagCounts.polygon ?? 0);
  const lineLikeCount = (tagCounts.line ?? 0) + (tagCounts.polyline ?? 0);
  const silhouetteCount = (tagCounts.path ?? 0) + (tagCounts.polygon ?? 0) + (tagCounts.ellipse ?? 0);
  const textCount = tagCounts.text ?? 0;
  const directlyTimedTextCount = [...code.matchAll(/<text\b([^>]*)>/gi)].filter((match) =>
    /data-teach-order\s*=/.test(match[1]) &&
    /data-teach-kind\s*=/.test(match[1]) &&
    /data-teach-weight\s*=/.test(match[1]) &&
    /data-teach-sentence\s*=/.test(match[1])
  ).length;
  const progressRefs = (code.match(/\bprogress\b/g) ?? []).length;
  const progressDerivedVars = [
    ...code.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*[^;\n]*\bprogress\b[^;\n]*/g),
  ].map((match) => match[1]);
  // Keep in sync with the helper names injected into the sandbox (lib/anim/sandboxRuntime.ts)
  // and named in the prompts. A generated component that eases with `smooth`/`lagged` instead
  // of hand-rolling `clamp01((progress-a)/b)` is doing MORE progress-driven work, not less —
  // if these names are missing here it scores as static and gets rejected for low motion.
  const phaseLikeVars = [
    ...code.matchAll(
      /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*[^;\n]*(?:clamp|lerp|phase|progress|smooth|lagged|rushInto|rushFrom|thereAndBack)[^;\n]*/gi,
    ),
  ].map((match) => match[1]);
  const motionVars = Array.from(new Set([...progressDerivedVars, ...phaseLikeVars])).filter(
    (name) => name !== "progress"
  );
  const motionVarRefs = motionVars.reduce((sum, name) => {
    const refs = code.match(new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "g")) ?? [];
    return sum + Math.max(0, refs.length - 1);
  }, 0);
  const interpolationRefs = (
    code.match(/\b(?:lerp|clamp01|clamp|phase|smooth|lagged|rushInto|rushFrom|thereAndBack|thereAndBackWithPause)\s*\(/gi) ?? []
  ).length;
  const animatedBindingRefs = (
    code.match(/\b(?:transform|opacity|cx|cy|x|y|d|points|width|height|r|rx|ry|strokeDashoffset|offset)\s*[=:]/g) ?? []
  ).length;
  const progressDriveScore = progressRefs + motionVarRefs + interpolationRefs + Math.min(animatedBindingRefs, 12);

  // Color audit: count literal hex fills that are near-background-dark vs bright/visible. A scene
  // whose fills are overwhelmingly dark-navy reads as unfilled/monochrome on the #020617 board —
  // the "not filled with colours" failure. Only literal fill="#..." are counted (dynamic
  // fill={var} can't be judged statically and is ignored).
  const fillHexes = [...code.matchAll(/fill\s*=\s*"(#[0-9a-fA-F]{3,6})"/g)].map((m) => m[1].toLowerCase());
  const darkFillCount = fillHexes.filter(isNearBackgroundDark).length;
  const brightFillCount = fillHexes.length - darkFillCount;
  const timelineStepCount = (code.match(/data-teach-order\s*=/g) ?? []).length;
  const timelineKindCount = (code.match(/data-teach-kind\s*=/g) ?? []).length;
  const timelineWeightCount = (code.match(/data-teach-weight\s*=/g) ?? []).length;
  const timelineSentenceCount = (code.match(/data-teach-sentence\s*=/g) ?? []).length;
  const timelineSentenceValues = [...code.matchAll(/data-teach-sentence\s*=\s*(?:["'](\d+)["']|\{\s*(\d+)\s*\})/g)]
    .map((match) => Number(match[1] ?? match[2]))
    .filter(Number.isFinite);
  const distinctTimelineSentences = new Set(timelineSentenceValues).size;
  const boardPlanPresent = /\bconst\s+boardPlan\s*=/.test(code) && /reservedRegions/.test(code) && /readingPath/.test(code);
  const visualSpecPresent =
    /\bconst\s+visualSpec\s*=/.test(code) &&
    /recognitionCues/.test(code) &&
    /requiredParts/.test(code) &&
    /forbiddenShortcuts/.test(code);

  const metrics = {
    // Past the hard safety gate above, so any issue from here on is quality/density only.
    safetyIssue: null as string | null,
    byteLength,
    groupCount,
    primitiveTagCount: primitiveTags.length,
    primitiveScore,
    objectPrimitiveScore,
    silhouetteCount,
    lineLikeCount,
    textCount,
    directlyTimedTextCount,
    distinctPrimitiveTypes: distinctPrimitiveTypes.size,
    progressRefs,
    progressDriveScore,
    repeaters,
    darkFillCount,
    brightFillCount,
    timelineStepCount,
    timelineSentenceCount,
    distinctTimelineSentences,
    boardPlanPresent,
    visualSpecPresent,
    tagCounts,
  };
  if (!boardPlanPresent) {
    return { ...metrics, issue: "missing the required boardPlan with composition, readingPath, and reservedRegions" };
  }
  if (timelineStepCount < 8 || timelineKindCount < timelineStepCount || timelineWeightCount < timelineStepCount || timelineSentenceCount < timelineStepCount) {
    return { ...metrics, issue: "missing a complete sentence-synchronized teacher timeline; add at least 8 ordered steps and give every step data-teach-order, data-teach-kind, data-teach-weight, and data-teach-sentence" };
  }
  if (timelineSentenceValues.length < timelineStepCount || distinctTimelineSentences < 3) {
    return { ...metrics, issue: "the teacher timeline is front-loaded; use literal data-teach-sentence values and distribute the board actions across at least three different spoken sentences" };
  }
  if (textCount > 0 && directlyTimedTextCount < textCount) {
    return { ...metrics, issue: "every SVG text element must carry its own complete teaching timeline attributes directly on the text node so marker tracking uses the exact text bounds" };
  }
  if (groupCount < (abstract ? 3 : 5)) {
    return { ...metrics, issue: abstract
      ? "too flat; organize the diagram into at least three meaningful groups (title, the structure itself, and its labels/annotations)"
      : "too flat; organize the whiteboard into at least five meaningful groups (frame/title, notes, subject silhouette, mechanism/details, result)" };
  }
  // Thresholds deliberately lowered AGAIN (were 18/12, originally 34/24): the higher bars forced
  // the model to pack scenes with parts/agents just to clear the number, producing busy, hard-to-
  // follow animations. A simple, legible scene that clearly teaches ONE mechanism is the goal —
  // these lower floors still reject a bare line-diagram/single-icon output while letting a clean
  // minimal scene pass. Simplicity is the target; the floor only guards against emptiness.
  const minPrimitiveScore = abstract ? 10 : 14;
  if (byteLength < REACT_ANIMATION_CODE_MIN_BYTES && primitiveScore < minPrimitiveScore) {
    return { ...metrics, issue: abstract
      ? "too sparse; draw the concept's full structure (all cells/nodes/intervals) with labels"
      : "too sparse; build a clear scene with a main subject, its parts, and a moving agent" };
  }
  if (primitiveScore < minPrimitiveScore) {
    return { ...metrics, issue: abstract
      ? "too few drawn elements; show the concept's full structure (array cells, tree nodes, graph edges, timeline bars) with labels"
      : "too few drawn elements; show the topic's main object plus a moving agent and a result" };
  }
  // Physical-scene gates — skipped for abstract concept diagrams (which legitimately ARE mostly
  // rects/lines/text and have no "silhouette").
  if (!abstract) {
    if (objectPrimitiveScore < 8) {
      return { ...metrics, issue: "too few actual scene objects; draw the mechanism's body, a couple of parts, and the result" };
    }
    if (silhouetteCount < 1) {
      return { ...metrics, issue: "needs real object silhouettes or cutaway shapes, not only rectangles/circles/lines" };
    }
    if (lineLikeCount >= objectPrimitiveScore / 2) {
      return { ...metrics, issue: "too line-diagram-like; the mechanism must be a full scene, not mostly wires/arrows" };
    }
    if (textCount > 0 && textCount >= objectPrimitiveScore / 2) {
      return { ...metrics, issue: "too text-heavy; labels must support the visual, not carry the animation" };
    }
  }
  if (distinctPrimitiveTypes.size < (abstract ? 3 : 4)) {
    return { ...metrics, issue: "too visually flat; use at least three or four SVG primitive types" };
  }
  if (!primitiveTags.includes("text")) {
    return { ...metrics, issue: "needs short JSX/SVG labels so the visual teaches without becoming a slide" };
  }

  if (progressDriveScore < 8) {
    return { ...metrics, issue: "motion is not driven enough by progress; add setup, transformation, and result phases" };
  }
  if (!/(lerp|clamp|phase|transform|opacity|translate|scale|rotate)/i.test(code)) {
    return { ...metrics, issue: "missing explicit interpolation or transform/opacity changes" };
  }
  // Color audit: reject scenes whose literal fills are overwhelmingly dark-navy (invisible on the
  // #020617 board) — this is the "not filled with colours / looks monochrome and empty" failure.
  // Require a real count of bright fills AND that dark fills don't dominate. Only enforced when
  // there are enough literal fills to judge (dynamic fill={var} colors are not counted).
  const totalLiteralFills = darkFillCount + brightFillCount;
  // Reject when: too few bright fills to look colorful at all, OR dark fills are a large fraction
  // (>=40%) of the total — either way the scene reads as dark/washed-out. (A scene with 20 dark
  // + 21 bright fills still looks half-invisible, so a simple dark>bright test is too lenient.)
  if (totalLiteralFills >= 6 && brightFillCount < 4) {
    return {
      ...metrics,
      issue:
        "too monochrome for a premium paper board — give the main scientific parts at least four meaningful mid-tone fills while keeping dark ink for labels and outlines",
    };
  }

  return { ...metrics, issue: null };
}

export function getReactAnimationCodeIssue(rawCode: string, opts: { abstract?: boolean } = {}): string | null {
  return getReactAnimationCodeDiagnostics(rawCode, opts).issue;
}

/** Validates a `reactAnimation` op's `code` field. Returns the op unchanged if the code passes,
 *  or the op with `code` stripped if it fails any check. Deliberately does NOT touch
 *  `teachingPoint` because it is safe plain data regardless of what happened to `code`. Exported
 *  so reactAnimationGen.ts can run the exact same checks at generation time, before code is even
 *  stored on the beat. */
export function sanitizeReactAnimationOp(
  op: ReactAnimationOp,
  opts: { requireQuality?: boolean; abstract?: boolean } = {},
): ReactAnimationOp {
  const code = typeof op.code === "string" ? op.code.trim() : "";
  if (!code) return { ...op, code: undefined };
  // Default: enforce the full quality floor (the normal accept path). When requireQuality is false
  // (ACCEPT_BEST fallback), gate ONLY on hard safety/structural failures — a runnable, safe, but
  // sub-floor animation is still worth rendering instead of showing the "unavailable" card. The
  // abstract flag relaxes the physical-only quality gates (see getReactAnimationCodeDiagnostics).
  const diagnostics = getReactAnimationCodeDiagnostics(code, { abstract: opts.abstract });
  const issue = opts.requireQuality === false ? diagnostics.safetyIssue : diagnostics.issue;
  if (issue) return { ...op, code: undefined, status: "failed", error: issue };
  return { ...op, code, status: "ready", error: undefined };
}

/** Shapes GsapSketch can both draw AND interpolate. `sun`/`stove` are compound multi-path shapes
 *  it cannot morph, so a board using one is not a morph board. Mirrors GSAP_SHAPES in
 *  lib/animationRouting.ts — the two must stay in step, or a beat kept as a morph board here would
 *  route somewhere that cannot render it. */
const MORPH_BOARD_SHAPES: ReadonlySet<string> = new Set(["circle", "rect", "hexagon", "line", "chain", "leaf", "droplet"]);
/** Ops a morph board may contain. All are in GSAP_KINDS (animationRouting), so a beat passing this
 *  check also satisfies isGsapWorthy once it carries its morph. `indicate`/`circumscribe`/`flash`
 *  are included because emphasis is most of what makes these boards look alive — the reference
 *  board that reads well ends on a circumscribe around the result. */
const MORPH_BOARD_KINDS: ReadonlySet<string> = new Set([
  "shape",
  "morph",
  "label",
  "note",
  "arrow",
  "indicate",
  "circumscribe",
  "flash",
]);

type MorphOpOut = Extract<DrawOp, { kind: "morph" }>;
type ShapeOpOut = Extract<DrawOp, { kind: "shape" }>;

/**
 * TYPE E — the live GSAP morph board.
 *
 * Returns the beat's ops kept in GsapSketch's own vocabulary, or null if this beat is not a morph
 * board (in which case the caller falls through to the normal grammar, unchanged).
 *
 * This exists as a whole-beat match rather than as a relaxation of sanitizeOp because that grammar
 * deliberately drops `shape` as static decoration and rewrites `morph` into a legacy motion:flow
 * travel. Both rules are right for every other board, and loosening them would change every
 * lecture. Matching the entire beat keeps the blast radius to exactly the beats the model built as
 * morph boards; everything else sanitizes byte-identically.
 *
 * The ops here ARE the finished artwork — unlike reactAnimation/chalkBoard/manimScene, no later
 * fill step authors anything, because GsapSketch derives the MorphSVG path from shape/toX/toY.
 */
function sanitizeMorphBoardOps(opsRaw: unknown[]): DrawOp[] | null {
  if (opsRaw.length === 0) return null;
  const raws: Record<string, unknown>[] = [];
  for (const op of opsRaw) {
    if (!op || typeof op !== "object") return null;
    raws.push(op as Record<string, unknown>);
  }
  if (!raws.every((op) => MORPH_BOARD_KINDS.has(str(op.kind)))) return null;
  // A board with no morph is just static ink — it has nothing GSAP renders better than LiveSketch.
  if (!raws.some((op) => str(op.kind) === "morph")) return null;
  if (
    !raws.every((op) => {
      const kind = str(op.kind);
      return kind !== "shape" && kind !== "morph" ? true : MORPH_BOARD_SHAPES.has(str(op.shape));
    })
  ) {
    return null;
  }

  const ops: DrawOp[] = [];
  for (const op of raws) {
    const kind = str(op.kind);
    if (kind === "indicate" || kind === "circumscribe" || kind === "flash") {
      // sanitizeOp drops these (they are not part of the general board grammar), so they are built
      // here. Emphasis is what stops a morph board reading as a diagram that merely appeared.
      const ex = pos(op.x);
      const ey = pos(op.y);
      if (ex === null || ey === null) return null;
      const eAt = frac(op.at, 0.1);
      ops.push({
        kind,
        x: ex,
        y: ey,
        w: pos(op.w) ?? undefined,
        h: pos(op.h) ?? undefined,
        color: color(op.color),
        at: eAt,
        endAt: frac(op.endAt, Math.min(1, eAt + 0.12)),
      } as DrawOp);
      continue;
    }
    if (kind !== "shape" && kind !== "morph") {
      // label/note/arrow already have correct, tested handling — reuse it rather than restate it.
      const sane = sanitizeOp(op);
      if (!sane) return null;
      ops.push(sane);
      continue;
    }
    const x = pos(op.x);
    const y = pos(op.y);
    if (x === null || y === null) return null;
    const at = frac(op.at, 0.1);
    const shape = str(op.shape) as ShapeOpOut["shape"];
    const w = pos(op.w) ?? undefined;
    const h = pos(op.h) ?? undefined;
    const c = color(op.color);
    if (kind === "shape") {
      ops.push({ kind: "shape", shape, x, y, w, h, color: c, at } as ShapeOpOut);
      continue;
    }
    const toX = pos(op.toX);
    const toY = pos(op.toY);
    if (toX === null || toY === null) return null;
    const morphAt = frac(op.morphAt, Math.min(0.98, at + 0.2));
    if (morphAt <= at) return null; // the transformation must move forward in time
    ops.push({
      kind: "morph",
      shape,
      x,
      y,
      w,
      h,
      toX,
      toY,
      text: str(op.text) || undefined,
      toText: str(op.toText) || undefined,
      color: c,
      toColor: color(op.toColor) ?? c,
      at,
      morphAt,
    } as MorphOpOut);
  }
  // A board has to SAY something. A morph with no text and no label beside it renders as an
  // unlabelled grey box that changes shape and teaches nothing — observed on real generated beats,
  // and worse than the LiveSketch board it displaces. Requiring visible words means such a beat
  // falls back to the ordinary grammar instead of shipping an empty animation.
  const saysSomething = ops.some(
    (op) =>
      op.kind === "label" ||
      op.kind === "note" ||
      (op.kind === "morph" && (Boolean(op.text) || Boolean(op.toText)))
  );
  return ops.length > 0 && saysSomething ? ops : null;
}

/** Validates a DrawScript; returns undefined if it has too few usable ops. The image op (if
 *  any) is sanitized FIRST so its bounding box can be used to push labels/notes out of its
 *  footprint — the marker writes in the margins, never over the picture. */
export function sanitizeDraw(raw: unknown, context?: DrawRepairContext): DrawScript | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const o = raw as Record<string, unknown>;
  const opsRaw = Array.isArray(o.ops) ? o.ops : [];

  // The model sometimes ignores the "emit ONE reactAnimation op" instruction for TYPE C beats
  // and falls back to the old scene+motion grammar it also still knows from the DrawOp type
  // list (worked example bias). Code-level guarantee, independent of prompt compliance: if a
  // beat's raw ops are a pure animation-led board (scene+motion present, no image, no dense
  // written-blackboard content) and it did NOT already emit a reactAnimation op, synthesize one
  // — teachingPoint from the scene's own title/items. This is what actually makes TYPE C route
  // through the new pipeline even when the model's JSON output alone wouldn't have.
  let reactAnimationRaw = opsRaw.find(
    (op) => op && typeof op === "object" && (op as Record<string, unknown>).kind === "reactAnimation"
  );
  if (!reactAnimationRaw && context?.index !== 0) {
    const hasImage = opsRaw.some((op) => op && typeof op === "object" && (op as Record<string, unknown>).kind === "image");
    const sceneRaw = opsRaw.find((op) => op && typeof op === "object" && (op as Record<string, unknown>).kind === "scene") as
      | Record<string, unknown>
      | undefined;
    const hasMotion = opsRaw.some((op) => op && typeof op === "object" && (op as Record<string, unknown>).kind === "motion");
    const symbolLabelCount = opsRaw.filter(
      (op) =>
        op && typeof op === "object" && (op as Record<string, unknown>).kind === "label" &&
        typeof (op as Record<string, unknown>).text === "string" &&
        /[↑↓→←=+×∴≈′]/.test((op as Record<string, unknown>).text as string)
    ).length;
    // A "pure animation-led" beat: has a scene (the TYPE C anchor), no image, and isn't also a
    // dense written blackboard (which legitimately uses labels/arrows on its own, unrelated grammar).
    if (sceneRaw && hasMotion && !hasImage && symbolLabelCount < 3) {
      const items = strArray(sceneRaw.items);
      const title = str(sceneRaw.title);
      const teachingPoint = [title, ...items].filter(Boolean).join(" — ").slice(0, 180) || str(context?.title);
      reactAnimationRaw = {
        kind: "reactAnimation",
        teachingPoint,
      };
    }
  }
  if (reactAnimationRaw && context?.index !== 0) {
    const r = reactAnimationRaw as Record<string, unknown>;
    const teachingPoint = str(r.teachingPoint) || str(context?.title) || undefined;
    const rawOp: ReactAnimationOp = {
      kind: "reactAnimation",
      teachingPoint,
      code: typeof r.code === "string" ? r.code : undefined,
      // Allow-listed deliberately. This rebuilds the op field by field, so anything not named here
      // is silently dropped — the exact way ops have gone missing between generation and the player
      // before. Normally this pass runs before the fill that sets assetIds, but any route that
      // re-sanitises a filled script would otherwise strip a board's artwork and leave <Asset/>
      // rendering nothing.
      assetIds: Array.isArray(r.assetIds)
        ? r.assetIds.filter((id): id is string => typeof id === "string" && /^[a-z0-9-]+$/.test(id)).slice(0, 8)
        : undefined,
      status: r.status === "ready" || r.status === "failed" ? r.status : undefined,
      error: typeof r.error === "string" ? r.error.slice(0, 180) : undefined,
      at: 0,
      endAt: 1,
    };
    const op = sanitizeReactAnimationOp(rawOp);
    // Keep placeholders even before code exists; streaming fills `code` later. If generation
    // fails, LessonPlayer shows an explicit unavailable board instead of a substitute sketch.
    if (op.code || op.teachingPoint) {
      return { caption: str(o.caption), durationMs: typeof o.durationMs === "number" ? o.durationMs : undefined, ops: [op] };
    }
  }

  // MORPH BOARD short-circuit (TYPE E). Runs BEFORE the blackboard coercion below, which would
  // otherwise claim a morph board that happens to carry three notes and rewrite it into chalk.
  const morphBoardOps = sanitizeMorphBoardOps(opsRaw);
  if (morphBoardOps) {
    return {
      caption: str(o.caption),
      durationMs: typeof o.durationMs === "number" ? o.durationMs : undefined,
      ops: morphBoardOps,
    };
  }

  // BLACKBOARD short-circuit (mirrors reactAnimation): a blackboard beat carries a single
  // `chalkBoard` placeholder whose real ops are authored later by fillBlackboardOps. If the model
  // emitted the placeholder directly, keep it. If it instead fell back to the old label/arrow/note
  // blackboard grammar (worked-example bias), COERCE that into a `chalkBoard` placeholder with a
  // derived boardBrief — this is what routes legacy blackboard output through the new pipeline.
  // Intro beats (index 0) are never blackboards.
  let chalkBoardRaw = opsRaw.find(
    (op) => op && typeof op === "object" && (op as Record<string, unknown>).kind === "chalkBoard"
  ) as Record<string, unknown> | undefined;
  if (!chalkBoardRaw && BLACKBOARD_GEN_ENABLED && context?.index !== 0) {
    const hasImage = opsRaw.some((op) => op && typeof op === "object" && (op as Record<string, unknown>).kind === "image");
    const hasSceneOrMotion = opsRaw.some(
      (op) => op && typeof op === "object" && ((op as Record<string, unknown>).kind === "scene" || (op as Record<string, unknown>).kind === "motion")
    );
    const symbolLabelCount = opsRaw.filter(
      (op) =>
        op && typeof op === "object" && (op as Record<string, unknown>).kind === "label" &&
        typeof (op as Record<string, unknown>).text === "string" &&
        /[↑↓→←=+×∴≈′]/.test((op as Record<string, unknown>).text as string)
    ).length;
    const arrowCount = opsRaw.filter((op) => op && typeof op === "object" && (op as Record<string, unknown>).kind === "arrow").length;
    const noteCount = opsRaw.filter((op) => op && typeof op === "object" && (op as Record<string, unknown>).kind === "note").length;
    // Legacy written-blackboard shape: symbol labels + arrows (or label + several notes), no image/scene/motion.
    const looksLikeBlackboard = !hasImage && !hasSceneOrMotion && ((symbolLabelCount >= 3 && arrowCount >= 2) || noteCount >= 3);
    if (looksLikeBlackboard) {
      const briefFromLabels = opsRaw
        .filter((op) => op && typeof op === "object" && (op as Record<string, unknown>).kind === "label")
        .map((op) => str((op as Record<string, unknown>).text))
        .filter(Boolean)
        .slice(0, 4)
        .join("; ");
      chalkBoardRaw = { kind: "chalkBoard", boardBrief: briefFromLabels || str(context?.title) };
    }
  }
  if (chalkBoardRaw && context?.index !== 0) {
    const r = chalkBoardRaw;
    const rawBrief = str(r.boardBrief) || str(context?.title) || firstSentence(str(context?.script), "Key idea");
    if (!BLACKBOARD_GEN_ENABLED) {
      // Flag off: never emit an unfillable placeholder. Fall back to the legacy template board so
      // the app is fully usable without the generation step.
      return makeWrittenBoard(
        str(context?.title) || rawBrief.slice(0, 60),
        str(context?.script),
        typeof o.durationMs === "number" ? o.durationMs : 28000
      );
    }
    const rawOps = Array.isArray(r.ops) ? sanitizeChalkBoardOps(r.ops) : undefined;
    const chalkOp: ChalkBoardOp = {
      kind: "chalkBoard",
      boardBrief: rawBrief.slice(0, 240) || undefined,
      ops: rawOps && rawOps.length ? rawOps : undefined,
      status: r.status === "ready" || r.status === "failed" ? (r.status as "ready" | "failed") : undefined,
      error: typeof r.error === "string" ? r.error.slice(0, 180) : undefined,
      at: 0,
      endAt: 1,
    };
    return { caption: str(o.caption), durationMs: typeof o.durationMs === "number" ? o.durationMs : undefined, ops: [chalkOp] };
  }

  const imageRaw = opsRaw.find((op) => op && typeof op === "object" && (op as Record<string, unknown>).kind === "image");
  const sanitizedImage = imageRaw ? (sanitizeOp(imageRaw) as Extract<DrawOp, { kind: "image" }> | null) : null;
  // The image is a backdrop now, not a panel to avoid. Let labels, arrows, and motion live
  // anywhere on the board; LiveSketch gives text a dark stroke so it remains readable.
  const imageBox = undefined;

  const rest = opsRaw.filter((op) => op !== imageRaw).map((op) => sanitizeOp(op, imageBox)).filter((op): op is DrawOp => op !== null);
  const fullBoardImage = sanitizedImage ? forceFullBoardImage(sanitizedImage) : null;

  // OPENING BEAT ENFORCEMENT (index 0): the first beat is always a calm, slow introduction —
  // one real image of the topic, a short title label, and at most two notes. No scene, no
  // motion, no callouts pointing at fine detail. The model frequently ignores this and adds
  // a scene/spotlight/motion anyway; strip them unconditionally here as a code guarantee.
  // The intro's only job is to orient the student to the big picture before going into detail.
  if (context?.index === 0) {
    const introImage = fullBoardImage;
    const introRest = rest.filter((op) => op.kind === "note" || op.kind === "label");
    const introOps = introImage ? [introImage, ...introRest.slice(0, 3)] : introRest.slice(0, 4);
    const introDuration = typeof o.durationMs === "number" && o.durationMs >= 9000 && o.durationMs <= 60000 ? o.durationMs : 46000;
    if (introOps.length < 1) return undefined;
    return { caption: str(o.caption), durationMs: introDuration, ops: introOps };
  }

  // Anti-decoration backstop: if the model gave us a full-board image AND scene/motion ops,
  // that is the "generate a picture then animate over it for no reason" failure mode the new
  // prompt explicitly forbids. Strip the image and let the animation run on the clean board —
  // the animation-led board is the intentional choice and needs its canvas clear. This is a
  // code-level guarantee, independent of prompt compliance, applying only when the model mixes
  // both despite the explicit either/or rule. (Callout-only boards with an image are fine —
  // those are image-led and should keep their image; the filter below only fires when scene/
  // motion are also present, confirming the model intended animation-led treatment.)
  const hasSceneOrMotion = rest.some((op) => op.kind === "scene" || op.kind === "motion");
  const imageForBoard = hasSceneOrMotion ? null : fullBoardImage;

  // Blackboard-vs-graph disambiguation. A "graph" scene renders its OWN opaque axes/curves panel
  // over the board's center. If the model ALSO wrote a dense set of symbolic relationship labels
  // + arrows (a written blackboard — e.g. "Demand ↑" → "Shortage" → "Price ↑"), those get buried
  // under the graph panel and collide with its built-in tags. The model mixed two treatments that
  // are meant to be separate. Resolve it by intent: if the writing IS a blackboard (several labels
  // carrying relationship symbols ↑↓→ plus connecting arrows), DROP the graph scene and keep the
  // clean chalkboard writing — that writing is the real teaching content. A code-level guarantee,
  // independent of prompt compliance.
  const graphSceneOp = rest.find((op) => op.kind === "scene" && op.scene === "graph");
  const symbolLabels = rest.filter((op) => op.kind === "label" && /[↑↓→←=+×∴≈′]/.test(op.text));
  const arrowCount = rest.filter((op) => op.kind === "arrow").length;
  const isWrittenBlackboard = symbolLabels.length >= 3 && arrowCount >= 2;
  const deGraphed =
    graphSceneOp && isWrittenBlackboard
      ? rest.filter((op) => !(op.kind === "scene" || op.kind === "motion"))
      : rest;

  const animatedOps = ensureLiveMotion(imageForBoard ? [imageForBoard, ...deGraphed] : deGraphed, context);
  const withRelationships = ensureImageRelationships(animatedOps, context);
  // A "scene" op renders on its own opaque backing panel covering the board's center
  // (x:14-86, y:15-92 on the 0-100 grid — matches LiveSketch.tsx's SceneRenderer panel).
  // Any "callout" pinned to the photo inside that region would render UNDER the scene panel
  // and be invisible, wasted work. Drop those rather than ship an invisible callout — this is
  // a code-level guarantee, independent of whether the model followed the prompt's guidance
  // to keep photo callouts and scene panels on separate beats.
  const sceneOp = withRelationships.find((op) => op.kind === "scene");
  const hasScene = !!sceneOp;
  // A "motion" op's text label can land directly on top of a scene's own item tag when the
  // model reuses the same word for both (e.g. a "timeline" scene already has a "core collapse"
  // tag, and a motion op also labels itself "core collapse") — two overlapping copies of the
  // same word, illegible. Drop the motion op's text (keep the animation, lose the duplicate
  // label) rather than ship a literal duplicate, independent of prompt compliance.
  const sceneWords = sceneOp
    ? new Set(
        [sceneOp.title, sceneOp.left, sceneOp.right, ...(sceneOp.items ?? [])]
          .filter((s): s is string => typeof s === "string")
          .map((s) => s.trim().toLowerCase())
      )
    : null;
  // A "graph" scene draws its OWN axis + curve tags (price, quantity, Supply, Demand,
  // Equilibrium) at fixed positions. When the model ALSO emits label ops with those same words,
  // the two collide into an illegible overlap (e.g. "Demand" printed on top of "Supply"). Drop
  // the model's redundant labels for words the graph already renders, keeping only its NEW
  // annotations — the whole point of a shift beat (e.g. "D → D′", "New Equilibrium", "income ↑",
  // "S → S′"). This is a code-level guarantee, independent of prompt compliance.
  const GRAPH_BUILTIN_WORDS = new Set(["supply", "demand", "equilibrium", "price", "quantity"]);
  const isGraphScene = sceneOp?.kind === "scene" && sceneOp.scene === "graph";
  const hasBottomNote = isGraphScene && withRelationships.some((op) => op.kind === "note" && op.y >= 80);
  const ops = (
    hasScene
      ? withRelationships.filter((op) => !(op.kind === "callout" && op.x >= 14 && op.x <= 86 && op.y >= 15 && op.y <= 92))
      : withRelationships
  )
    .filter((op) => {
      if (isGraphScene && op.kind === "label" && GRAPH_BUILTIN_WORDS.has(op.text.trim().toLowerCase())) {
        // Keep only NEW annotations (D→D′, income↑, New Equilibrium); drop bare words the graph
        // already draws (Supply/Demand/Equilibrium/Price/Quantity) so they don't collide.
        return false;
      }
      // A graph scene draws its own centered title in the top band. A model note there crowds it.
      // If there's already a bottom caption, drop the top note; otherwise it's moved down below.
      if (isGraphScene && op.kind === "note" && op.y < 20 && hasBottomNote) {
        return false;
      }
      return true;
    })
    .map((op) => {
      if (op.kind === "motion" && op.text && sceneWords?.has(op.text.trim().toLowerCase())) {
        return { ...op, text: undefined };
      }
      // Relocate a lone top note (no bottom caption exists) to the bottom caption slot.
      if (isGraphScene && op.kind === "note" && op.y < 20) {
        return { ...op, y: 90 };
      }
      return op;
    });
  // Motion deduplication: remove redundant motion ops that add no new teaching value.
  // Two motion ops with the same kind AND traveling in the same directional quadrant are
  // wasteful (e.g. two "flow" ops both going left→right). Keep the first; drop the second.
  // Also enforce the max-2-motion-ops-per-beat rule from the prompt.
  const motionKindDir = (op: DrawOp): string => {
    if (op.kind !== "motion") return "";
    const dx = (op.x2 ?? op.cx ?? 50) - (op.x1 ?? op.cx ?? 50);
    const dy = (op.y2 ?? op.cy ?? 50) - (op.y1 ?? op.cy ?? 50);
    const hDir = dx >= 0 ? "R" : "L";
    const vDir = dy >= 0 ? "D" : "U";
    return `${op.motion}-${hDir}${vDir}`;
  };
  const seenMotionDirs = new Set<string>();
  let motionCount = 0;
  const dedupedOps = ops.filter((op) => {
    if (op.kind !== "motion") return true;
    motionCount++;
    if (motionCount > 3) return false; // hard cap: a little more life, still readable (dedup below keeps each distinct)
    const dir = motionKindDir(op);
    if (seenMotionDirs.has(dir)) return false; // duplicate direction+kind = wasteful
    seenMotionDirs.add(dir);
    return true;
  });

  if (dedupedOps.length < 2) return undefined;

  // Heading injection: if this looks like a written blackboard (labels + arrows, no image/scene)
  // but has no title label in the top band (y < 16), inject one so the top quarter is never blank.
  // The model frequently skips the heading and starts content at y:28+, leaving a large empty gap.
  // Inline the blackboard detection here (can't call isWrittenBlackboard — defined later in file).
  const hasTopHeading = dedupedOps.some((op) => op.kind === "label" && op.y < 16);
  const looksLikeBlackboard = !dedupedOps.some((op) => op.kind === "image" || op.kind === "scene")
    && dedupedOps.some((op) => op.kind === "label")
    && dedupedOps.some((op) => op.kind === "arrow");
  const finalOps: DrawOp[] = hasTopHeading || !looksLikeBlackboard ? dedupedOps : [
    { kind: "label", text: boardTitle(str(o.caption, context?.title ?? "")), x: 50, y: 8, size: "md" as const, color: COLOR_MAP.amber, at: 0.03 },
    { kind: "arrow", x1: 20, y1: 14, x2: 80, y2: 14, color: COLOR_MAP.amber, at: 0.06 },
    ...dedupedOps,
  ];

  // Spatial diagram injection for sparse blackboards: when a written blackboard has content
  // stopping before the bottom third, append a hand-drawn chalk diagram (shared with
  // makeWrittenBoard via buildChalkDiagram). Large centered supply/demand chart for
  // equilibrium topics; small bottom-right corner sketch otherwise.
  let enrichedOps = finalOps;
  if (looksLikeBlackboard) {
    const maxY = finalOps.reduce((m, op) => {
      const y = op.kind === "label" || op.kind === "note" ? op.y : op.kind === "arrow" ? Math.max(op.y1 ?? 0, op.y2 ?? 0) : 0;
      return Math.max(m, y);
    }, 0);
    const combined = ((context?.title ?? "") + " " + (context?.script ?? "")).toLowerCase();
    const wantsLargeDiagram = /\bsupply\b/.test(combined) && /\bdemand\b/.test(combined)
      && /\b(curve|supply|demand|slope|equilibrium)\b/.test(combined);
    // Large diagram needs the lower half clear (content must stop by ~y:50); the corner sketch
    // only needs the bottom-right free (content stops by ~y:82).
    if (wantsLargeDiagram && maxY < 52) {
      enrichedOps = [...finalOps, ...buildChalkDiagram(combined, { x0: 34, y0: 52, x1: 86, y1: 88 }, 0.62)];
    } else if (maxY < 82) {
      enrichedOps = [...finalOps, ...buildChalkDiagram(combined, { x0: 60, y0: 66, x1: 88, y1: 91 }, 0.72)];
    }
  }

  // Slower pacing per repeated feedback that boards advance too fast to read. Continuous
  // semantic motion fills the middle of the timeline, while the longer default gives each
  // op more dwell time.
  const durationMs = typeof o.durationMs === "number" && o.durationMs >= 9000 && o.durationMs <= 60000 ? o.durationMs : 48000;
  return { caption: str(o.caption), durationMs, ops: enrichedOps };
}

function forceFullBoardImage(op: ImageOp): ImageOp {
  return { ...op, x: IMAGE_DEFAULT_X, y: IMAGE_DEFAULT_Y, w: IMAGE_DEFAULT_W, h: IMAGE_DEFAULT_H, at: Math.min(op.at, 0.05) };
}

function sanitizeCheckpoint(raw: unknown): CheckpointSpec | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const o = raw as Record<string, unknown>;
  const prompt = str(o.prompt);
  if (!prompt) return undefined;
  const acceptableKeywords = Array.isArray(o.acceptableKeywords)
    ? o.acceptableKeywords
        .map((set) => (Array.isArray(set) ? set.filter((k): k is string => typeof k === "string" && k.trim().length > 0).map((k) => k.toLowerCase()) : []))
        .filter((set) => set.length > 0)
    : [];
  if (acceptableKeywords.length === 0) return undefined;
  return {
    prompt,
    acceptableKeywords,
    correctFeedback: str(o.correctFeedback, "That's right."),
    hintFeedback: str(o.hintFeedback, "Not quite — think it through again."),
    revealAnswer: str(o.revealAnswer, prompt),
  };
}

export function sanitizeBeat(raw: unknown, index: number): Beat | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;

  const script = str(o.script);
  if (!script) return null;

  let slideKind: SlideKind = VALID_SLIDE_KINDS.includes(o.slideKind as SlideKind) ? (o.slideKind as SlideKind) : "intro";
  const title = str(o.title, `Beat ${index + 1}`);

  const beat: Beat = {
    id: str(o.id, `beat-${index}`),
    title,
    teacherMove: str(o.teacherMove, "I keep teaching."),
    stepLabel: str(o.stepLabel, `${index + 1}`),
    slideKind,
    points: strArray(o.points).slice(0, 4),
    script,
    sourceBlockIds: strArray(o.sourceBlockIds).slice(0, 80),
  };

  if (slideKind === "definition") {
    beat.definitionTerm = str(o.definitionTerm, title);
    // definitionMeaning is used by the slide-stage text display but is optional — image-led and
    // animation-led beats legitimately omit it since they teach via the board, not a text slide.
    beat.definitionMeaning = str(o.definitionMeaning, "");
  }

  if (slideKind === "compare") {
    const sideOf = (r: unknown) => {
      if (!r || typeof r !== "object") return null;
      const rr = r as Record<string, unknown>;
      const label = str(rr.label);
      const points = strArray(rr.points);
      if (!label || points.length === 0) return null;
      return { label, points: points.slice(0, 4) };
    };
    const left = sideOf(o.compareLeft);
    const right = sideOf(o.compareRight);
    if (left && right) {
      beat.compareLeft = left;
      beat.compareRight = right;
    } else {
      // Models often mark a beat as "compare" just because the script contrasts two ideas,
      // without providing the extra compareLeft/compareRight metadata needed by SlideStage.
      // Keep the beat and render it as a normal teaching beat instead of dropping it and
      // collapsing the whole lecture to five survivors.
      slideKind = "intro";
      beat.slideKind = "intro";
    }
  }

  if (slideKind === "checkpoint") {
    const checkpoint = sanitizeCheckpoint(o.checkpoint);
    if (!checkpoint) return null;
    beat.checkpoint = checkpoint;
  } else {
    const draw = sanitizeDraw(o.draw, {
      title,
      script,
      slideKind,
      index,
      points: beat.points,
      compareLeft: beat.compareLeft,
      compareRight: beat.compareRight,
    });
    // A non-checkpoint beat must have a real generated image, not just floating labels. The
    // model sometimes returns a board with no image (or one that later fails generation) —
    // when that happens, synthesize a contextual image-placeholder board instead of leaving
    // the whiteboard text-only.
    //
    // Defensive layer (belt-and-suspenders on top of sanitizeDraw's own chalkBoard coercion at
    // ~706-739): the model doesn't ALWAYS emit the chalkBoard placeholder or a shape that clears
    // isWrittenBlackboard's bar — confirmed via live testing this is real generation variance,
    // not a deterministic bug, but when it happens the OLD path here fell through to
    // fallbackExplanationDraw()'s legacy makeWrittenBoard() template synthesizer, which produces
    // generic/truncated/repeated-looking content (fixed footer line, keyword-derived rows) that
    // reads as broken. If the raw draw still shows ANY sign the model was attempting a written
    // board (labels/notes/arrows present, no image/scene/motion) but narrowly missed the
    // isWrittenBlackboard bar, route it through the SAME dynamic chalkBoard+fillBlackboardOps
    // pipeline used everywhere else, instead of the legacy synthesizer — only a draw with no
    // blackboard-shaped content at all should ever reach fallbackExplanationDraw now.
    const rawDrawOps: DrawOp[] = draw?.ops ?? [];
    if (hasUsefulExplanationVisual(draw)) {
      beat.draw = draw;
    } else if (BLACKBOARD_GEN_ENABLED && draw !== undefined && looksLikeAttemptedBlackboard(rawDrawOps)) {
      const briefFromLabels = rawDrawOps
        .filter((op): op is Extract<DrawOp, { kind: "label" }> => op.kind === "label")
        .map((op) => op.text)
        .filter(Boolean)
        .slice(0, 4)
        .join("; ");
      const boardBrief = (briefFromLabels || title || firstSentence(script, "")).slice(0, 240) || title;
      const drawMeta: DrawScript = draw;
      beat.draw = { caption: drawMeta.caption, durationMs: drawMeta.durationMs, ops: [{ kind: "chalkBoard", boardBrief, at: 0, endAt: 1 }] };
    } else {
      beat.draw = fallbackExplanationDraw(title, script);
    }
    // Backstop for image compliance: the prompt requires one "image" op per non-checkpoint,
    // non-animation-led beat, but the model sometimes drops it anyway. Rather than discard an
    // otherwise-good board, inject a contextual image-op placeholder so it gets a real generated
    // image once fillImageOps runs.
    // EXCEPTION: animation-led boards (those with a "scene" or "motion" op but no "image")
    // intentionally have no image — the animation IS the teaching on a clean dark canvas.
    // Do not inject a photo backdrop into those; it would break the composition the model chose.
    if (
      beat.draw &&
      !beat.draw.ops.some(
        (op) =>
          op.kind === "image" || op.kind === "reactAnimation" || op.kind === "chalkBoard" ||
          // A TYPE D diagram and a TYPE E morph board are both intentionally image-less. Injecting a
          // photo backdrop under a morph board is doubly damaging: the later paper-layout pass sees
          // the image FIRST and re-lays the beat out as an image board, discarding the shape/morph
          // ops that were the whole animation.
          op.kind === "manimScene" || op.kind === "morph" || op.kind === "structureScene" || op.kind === "plotBoard" || op.kind === "equationBoard"
      )
    ) {
      const hasAnimation = beat.draw.ops.some((op) => op.kind === "scene" || op.kind === "motion");
      // A written blackboard is also intentionally image-less (a teacher writing on a clean
      // board) — don't force a photo backdrop under it.
      if (!hasAnimation && !isWrittenBlackboard(beat.draw.ops)) {
        beat.draw = { ...beat.draw, ops: [...beat.draw.ops, fallbackImagePlaceholder(title, script)] };
      }
    }
  }

  return beat;
}

/** Synthesizes an "image" op placeholder (no src yet) for a beat the model forgot to give
 *  one to. Placed center-stage; fillImageOps generates the actual picture from this prompt. */
function fallbackImagePlaceholder(title: string, script: string): Extract<DrawOp, { kind: "image" }> {
  // Describe people/objects/actions only — no text-bearing surfaces. imagePrompt() also runs
  // stripTextInvitingPhrases() over this at generation time as a second line of defense.
  const prompt = `A wide, cinematic photograph of ONE specific real-world scene that demonstrates: ${title}. Context: ${script.slice(0, 200)}. Choose a single named subject caught mid-action (a specific person, animal, or object — never a generic crowd or montage), with 2-3 distinctive physical details in frame. No signs, no labels, no printed text of any kind; leave all wording to the live overlay.`;
  return { kind: "image", prompt, x: IMAGE_DEFAULT_X, y: IMAGE_DEFAULT_Y, w: IMAGE_DEFAULT_W, h: IMAGE_DEFAULT_H, at: 0.05 };
}

function hasLiveAnimation(ops: DrawOp[]) {
  return ops.some((op) => op.kind === "motion" || op.kind === "morph" || op.kind === "scene");
}
function hasScene(ops: DrawOp[]) {
  return ops.some((op) => op.kind === "scene");
}
function hasMotionOp(ops: DrawOp[]) {
  return ops.some((op) => op.kind === "motion" || op.kind === "morph");
}
function hasCallout(ops: DrawOp[]) {
  return ops.some((op) => op.kind === "callout");
}

/** A written blackboard: either (a) symbolic relationship labels (↑↓→) connected by arrows,
 *  or (b) a term+note two-column board (makeWrittenBoard output). Both are intentional clean-board
 *  treatments — no image, no scene/motion should be injected on top of either. */
function isWrittenBlackboard(ops: DrawOp[]): boolean {
  if (ops.some((op) => op.kind === "image")) return false;
  if (ops.some((op) => op.kind === "scene")) return false;
  // Pattern A: symbolic labels (↑↓→ etc.) + arrows = AI-authored law/derivation board
  const symbolLabels = ops.filter((op) => op.kind === "label" && /[↑↓→←=+×∴≈′]/.test(op.text));
  const arrows = ops.filter((op) => op.kind === "arrow").length;
  if (symbolLabels.length >= 3 && arrows >= 2) return true;
  // Pattern B: header label + multiple notes = makeWrittenBoard two-column output
  const notes = ops.filter((op) => op.kind === "note").length;
  const labels = ops.filter((op) => op.kind === "label").length;
  return labels >= 1 && notes >= 3;
}

/** Much looser than isWrittenBlackboard — true if the raw ops show ANY sign the model was
 *  attempting a written board (some labels/notes/arrows, no image/scene/motion), even if it
 *  narrowly misses isWrittenBlackboard's stricter shape bar. Used only to decide "route to the
 *  dynamic chalkBoard pipeline" vs. "this beat has no blackboard content at all" — the dynamic
 *  pipeline authors real content from the boardBrief regardless of how thin the raw signal was,
 *  so a loose trigger here is safe (unlike isWrittenBlackboard, which gates whether to KEEP the
 *  model's raw ops as-is and must stay strict). */
function looksLikeAttemptedBlackboard(ops: DrawOp[]): boolean {
  if (ops.some((op) => op.kind === "image" || op.kind === "scene" || op.kind === "motion" || op.kind === "reactAnimation" || op.kind === "chalkBoard" || op.kind === "manimScene" || op.kind === "morph" || op.kind === "structureScene" || op.kind === "plotBoard" || op.kind === "equationBoard")) return false;
  const labels = ops.filter((op) => op.kind === "label").length;
  const notes = ops.filter((op) => op.kind === "note").length;
  const arrows = ops.filter((op) => op.kind === "arrow").length;
  return labels + notes + arrows >= 2;
}

function blackboardTextIsClean(ops: DrawOp[]): boolean {
  // "label" ops are legitimately short terms/section headings/axis tags on a real chalk board
  // (e.g. "Demand", "Price", "Equilibrium") — the fragment/duplicate checks below are calibrated
  // for "note" (and legacy "callout") body text, which must be complete sentences. Applying the
  // same bar to short label headings rejected genuinely good boards (a term label reused once as
  // a heading and once as an axis tag is normal, not a duplication bug).
  const noteTexts = ops
    .filter((op): op is Extract<DrawOp, { kind: "note" | "callout" }> => op.kind === "note" || op.kind === "callout")
    .map((op) => op.text.trim())
    .filter((text) => !isTinyDiagramToken(text))
    .filter(Boolean);
  const labelTexts = ops
    .filter((op): op is Extract<DrawOp, { kind: "label" }> => op.kind === "label")
    .map((op) => op.text.trim())
    .filter((text) => !isTinyDiagramToken(text))
    .filter(Boolean);

  if (noteTexts.length + labelTexts.length < 5) return false;

  const seen = new Set<string>();
  let duplicateCount = 0;
  let badCount = 0;
  for (const text of noteTexts) {
    const key = text.toLowerCase().replace(/^[•·\-\s]+/, "").replace(/\s+/g, " ");
    if (seen.has(key)) duplicateCount++;
    seen.add(key);
    if (looksLikeFragment(text)) badCount++;
    if (text.length > 78) badCount++;
  }
  // Labels: only flag genuine dangling fragments (trailing/leading connectors, "..."), not
  // single-word terms — a term/heading label is ALWAYS short by design. Allow label repeats
  // entirely (a heading and an axis tag sharing a word is normal chalk-board practice).
  for (const text of labelTexts) {
    if (/\.\.\.$/.test(text) || /^(and|but|because|which|where|when|while|that|this)\b/i.test(text) || /\b(and|or|because|which)$/i.test(text)) {
      badCount++;
    }
  }

  return badCount === 0 && duplicateCount <= 1;
}

function isTinyDiagramToken(text: string): boolean {
  return /^(P|Q|S|D|P\*|Q\*|D′|S′|[?•▲]|[↑↓↗↘←→⇄])$/.test(text.trim());
}

function ensureLiveMotion(ops: DrawOp[], context?: DrawRepairContext): DrawOp[] {
  if (ops.length === 0) return ops;
  // A written blackboard is a deliberate clean-board treatment — leave it exactly as authored.
  if (isWrittenBlackboard(ops)) return ops;
  // Image-led boards (have an image + callouts but no scene/motion) are intentionally
  // animation-free — the image is the teaching surface, explained via callouts. Do not
  // inject a scene/motion layer; that would violate the composition the model chose and
  // re-create the exact "photo with random animation on top" failure mode this redesign fixes.
  const hasImage = ops.some((op) => op.kind === "image");
  const hasCallouts = hasCallout(ops);
  if (hasImage && (hasCallouts || !hasLiveAnimation(ops))) {
    // Only inject animation if the board looks like it truly needs it (no callouts pointing
    // at the image, and also no scene/motion already present) — i.e. a board with just a
    // bare image and labels/notes but nothing pointing at it specifically. Even then, only
    // inject a scene if context suggests it (not on opening/intro beats which are meant to
    // be static). A board with callouts is image-led and correct as-is.
    if (hasCallouts) return ops;
    if (!hasLiveAnimation(ops) && !shouldHaveScene(context)) return ops;
  }
  if (!hasLiveAnimation(ops) && shouldHaveScene(context)) {
    const scene = fallbackScene(context);
    return [...ops, scene, ...fallbackMotions(scene, context)];
  }
  if (!hasScene(ops) && !hasImage && shouldHaveScene(context)) {
    // Animation-led board with motion but no scene — add the scene.
    const scene = fallbackScene(context);
    return hasMotionOp(ops) ? [...ops, scene] : [...ops, scene, ...fallbackMotions(scene, context)];
  }
  return ops;
}

function fallbackScene(context?: DrawRepairContext): SceneOp {
  const scene = pickSceneKind(context);
  const items = contextualItems(context, scene);
  const title = fallbackSceneTitle(context, scene, items);
  const compare = compareSides(context, items);
  return {
    kind: "scene",
    scene,
    title,
    items,
    left: compare.left,
    right: compare.right,
    color: colorForScene(scene, context),
    at: scene === "spotlight" ? 0.16 : 0.2,
    endAt: 0.9,
  };
}

function fallbackMotions(scene: SceneOp, context?: DrawRepairContext): MotionOp[] {
  const items = scene.items?.length ? scene.items : contextualItems(context, scene.scene);
  const first = items[0] ?? "cause";
  const second = items[1] ?? "response";
  const third = items[2] ?? "outcome";
  if (scene.scene === "graph" || isPhotosynthesisText(contextText(context))) {
    return [];
  }
  if (scene.scene === "compare") {
    // 3 distinct motions: left side flows in (→), right side flows in (←), then the
    // meeting point pulses. Each differs in kind or direction — no wasted repeat.
    return [
      { kind: "motion", motion: "flow", text: first, x1: 24, y1: 38, x2: 46, y2: 50, color: COLOR_MAP.blue, at: 0.30, endAt: 0.56 },
      { kind: "motion", motion: "flow", text: second, x1: 76, y1: 38, x2: 54, y2: 50, color: COLOR_MAP.rose, at: 0.46, endAt: 0.72 },
      { kind: "motion", motion: "pulse", text: third, cx: 50, cy: 52, r: 12, color: COLOR_MAP.amber, at: 0.72, endAt: 0.92 },
    ];
  }
  if (scene.scene === "cycle") {
    return [
      { kind: "motion", motion: "orbit", text: first, cx: 50, cy: 54, r: 21, color: COLOR_MAP.green, at: 0.3, endAt: 0.86 },
      { kind: "motion", motion: "pulse", text: second, cx: 50, cy: 54, r: 13, color: COLOR_MAP.blue, at: 0.62, endAt: 0.92 },
    ];
  }
  if (scene.scene === "spotlight") {
    return [
      { kind: "motion", motion: "reveal", text: first, cx: 50, cy: 50, r: 18, color: COLOR_MAP.amber, at: 0.3, endAt: 0.68 },
      { kind: "motion", motion: "pulse", text: second, cx: 60, cy: 52, r: 12, color: COLOR_MAP.green, at: 0.62, endAt: 0.9 },
    ];
  }
  if (scene.scene === "system") {
    // 3 distinct motions: input flows in, passes through, then the output endpoint pulses.
    return [
      { kind: "motion", motion: "flow", text: first, x1: 20, y1: 50, x2: 48, y2: 50, color: COLOR_MAP.blue, at: 0.30, endAt: 0.58 },
      { kind: "motion", motion: "flow", text: second, x1: 52, y1: 50, x2: 82, y2: 50, color: COLOR_MAP.green, at: 0.52, endAt: 0.80 },
      { kind: "motion", motion: "pulse", text: third, cx: 82, cy: 50, r: 12, color: COLOR_MAP.amber, at: 0.80, endAt: 0.94 },
    ];
  }
  // default (process/timeline/graph): flow → beam → pulse, three distinct kinds.
  return [
    { kind: "motion", motion: "flow", text: first, x1: 18, y1: 56, x2: 45, y2: 46, color: COLOR_MAP.blue, at: 0.28, endAt: 0.54 },
    { kind: "motion", motion: "beam", text: second, x1: 45, y1: 46, x2: 72, y2: 56, color: COLOR_MAP.violet, at: 0.52, endAt: 0.78 },
    { kind: "motion", motion: "pulse", text: third, cx: 74, cy: 56, r: 12, color: COLOR_MAP.green, at: 0.78, endAt: 0.94 },
  ];
}

function pickSceneKind(context?: DrawRepairContext): SceneOp["scene"] {
  const text = contextText(context);
  if (/\b(equilibrium|supply|demand|supply curve|demand curve|market price|price floor|price ceiling)\b/i.test(text)) return "graph";
  if (isPhotosynthesisText(text)) return "process";
  if (context?.compareLeft || context?.compareRight || /\b(vs|versus|compare|contrast|opposite|difference|supply and demand|demand and supply)\b/i.test(text)) return "compare";
  if (/\b(cycle|loop|repeats|feedback|orbit|circulation|recycles)\b/i.test(text)) return "cycle";
  if (/\b(timeline|history|over time|first|then|next|stages?|sequence|phase|evolution|before|after)\b/i.test(text)) return "timeline";
  if (/\b(system|network|market|ecosystem|chain|connect|connected|interact|cause|effect|depends)\b/i.test(text)) return "system";
  if (context?.slideKind === "definition" || /\b(define|definition|means|term|vocabulary|inside|where|what is)\b/i.test(text)) return "spotlight";
  const order = ["spotlight", "process", "system", "timeline", "compare", "cycle", "graph"] as const;
  return order[(context?.index ?? 0) % order.length];
}

function shouldHaveScene(context?: DrawRepairContext) {
  if (!context) return false;
  if (context.slideKind === "definition" || context.slideKind === "compare" || context.slideKind === "recap") return true;
  const text = contextText(context);
  if (/\b(process|mechanism|market|system|cause|effect|compare|contrast|cycle|timeline|sequence|steps?|definition|means|supply|demand|equilibrium|gravity|collapse|flow|chain)\b/i.test(text)) return true;
  return (context.index ?? 0) % 3 === 0;
}

function contextualItems(context: DrawRepairContext | undefined, scene: SceneOp["scene"]): string[] {
  const special = specialItems(context);
  if (special.length) return special;
  if (context?.compareLeft || context?.compareRight) {
    const items = [
      context.compareLeft?.label,
      ...(context.compareLeft?.points ?? []),
      context.compareRight?.label,
      ...(context.compareRight?.points ?? []),
    ].filter((item): item is string => Boolean(item));
    return uniqueShort(items, 5);
  }
  const fromPoints = uniqueShort(context?.points ?? [], 5);
  if (fromPoints.length >= 2) return fromPoints;
  const words = keywordItems(contextText(context));
  if (words.length >= 2) return words.slice(0, scene === "compare" ? 4 : 5);
  const title = shorten(context?.title ?? "concept", 26);
  if (scene === "compare") return uniqueShort([title, "other side", "shared result"], 4);
  if (scene === "spotlight") return uniqueShort([title, "key detail", "why it matters"], 3);
  if (scene === "system") return uniqueShort([title, "cause", "response", "outcome"], 4);
  if (scene === "graph") return uniqueShort(["supply", "demand", "equilibrium"], 3);
  return uniqueShort([title, "main step", "outcome"], 3);
}

function specialItems(context?: DrawRepairContext): string[] {
  const text = contextText(context);
  if (/\bsupply\b/i.test(text) && /\bdemand\b/i.test(text)) {
    return ["supply", "demand", "equilibrium", "market balance"];
  }
  if (/\bblack hole|event horizon|massive star|gravity\b/i.test(text)) {
    return ["massive star", "gravity wins", "core collapses", "event horizon"];
  }
  if (/\bphotosynthesis|chloroplast|glucose|sunlight\b/i.test(text)) {
    return ["sunlight", "chloroplast", "atom rearrangement", "glucose", "oxygen"];
  }
  return [];
}

function fallbackSceneTitle(context: DrawRepairContext | undefined, scene: SceneOp["scene"], items: string[]) {
  const title = shorten(context?.title ?? "", 42);
  if (scene === "compare") {
    const sides = compareSides(context, items);
    return sides.left && sides.right ? `${sides.left} vs ${sides.right}` : title || `${items[0]} vs ${items[1] ?? "other side"}`;
  }
  if (scene === "spotlight") return title || `${items[0]} up close`;
  if (scene === "cycle") return title || `${items[0]} cycle`;
  if (scene === "timeline") return title || `${items[0]} over time`;
  if (scene === "graph") return title || `${items[0]} meets ${items[1] ?? "demand"}`;
  if (scene === "system") return title || `How ${items[0]} connects`;
  return title || items.slice(0, 3).join(" -> ");
}

function compareSides(context: DrawRepairContext | undefined, items: string[]) {
  const text = contextText(context);
  if (/\bsupply\b/i.test(text) && /\bdemand\b/i.test(text)) return { left: "Supply", right: "Demand" };
  return {
    left: context?.compareLeft?.label ?? items[0] ?? "first side",
    right: context?.compareRight?.label ?? items[1] ?? "other side",
  };
}

function colorForScene(scene: SceneOp["scene"], context?: DrawRepairContext) {
  const text = contextText(context);
  if (/\bblack hole|gravity|collapse|danger|scarce|shortage\b/i.test(text)) return COLOR_MAP.rose;
  if (/\bwater|ocean|air|gas|flow\b/i.test(text)) return COLOR_MAP.blue;
  if (/\bsun|energy|price|heat|light\b/i.test(text)) return COLOR_MAP.amber;
  if (scene === "graph") return COLOR_MAP.amber;
  if (scene === "compare") return COLOR_MAP.violet;
  if (scene === "system") return COLOR_MAP.blue;
  return COLOR_MAP.green;
}

function isPhotosynthesisText(text: string): boolean {
  return /\b(photosynthesis|chlorophyll|chloroplast|glucose|sunlight|light absorption|absorbs? light|red and blue|wavelength|thylakoid|light reactions?)\b/i.test(text);
}

function ensureImageRelationships(ops: DrawOp[], context?: DrawRepairContext): DrawOp[] {
  if (!ops.some((op) => op.kind === "image") || hasCallout(ops)) return ops;
  return [...ops, ...fallbackCallouts(context)];
}

function fallbackCallouts(context?: DrawRepairContext): DrawOp[] {
  const text = contextText(context);
  if (/\bsupply\b/i.test(text) && /\bdemand\b/i.test(text)) {
    return [
      { kind: "callout", text: "sellers", x: 24, y: 58, labelX: 18, labelY: 34, color: COLOR_MAP.blue, at: 0.18 },
      { kind: "callout", text: "buyers", x: 78, y: 58, labelX: 84, labelY: 34, color: COLOR_MAP.rose, at: 0.24 },
      { kind: "callout", text: "equilibrium", x: 51, y: 50, labelX: 64, labelY: 62, color: COLOR_MAP.amber, at: 0.52 },
    ];
  }
  if (/\bblack hole|event horizon|massive star|gravity|collapse\b/i.test(text)) {
    return [
      { kind: "callout", text: "stellar core", x: 50, y: 52, labelX: 24, labelY: 34, color: COLOR_MAP.amber, at: 0.18 },
      { kind: "callout", text: "gravity pulls", x: 50, y: 52, labelX: 78, labelY: 36, color: COLOR_MAP.rose, at: 0.3 },
      { kind: "callout", text: "outer layers", x: 72, y: 42, labelX: 82, labelY: 66, color: COLOR_MAP.blue, at: 0.44 },
    ];
  }
  const items = contextualItems(context, pickSceneKind(context));
  return [
    { kind: "callout", text: items[0] ?? "key area", x: 34, y: 48, labelX: 18, labelY: 28, color: COLOR_MAP.green, at: 0.2 },
    { kind: "callout", text: items[1] ?? "change point", x: 62, y: 48, labelX: 78, labelY: 30, color: COLOR_MAP.violet, at: 0.36 },
  ];
}

type ImageTeachingProfile = {
  prompt: string;
  callouts: Extract<DrawOp, { kind: "callout" }>[];
};

function makeImageCalloutBoard(title: string, script: string, durationMs = 26000, technical = false): DrawScript {
  const profile = technical ? technicalImageTeachingProfile(title, script) : imageTeachingProfile(title, script);
  return {
    caption: title,
    durationMs,
    ops: [
      { kind: "image", prompt: profile.prompt, x: IMAGE_DEFAULT_X, y: IMAGE_DEFAULT_Y, w: IMAGE_DEFAULT_W, h: IMAGE_DEFAULT_H, at: 0.04 },
      ...profile.callouts,
    ],
  };
}

function technicalImageTeachingProfile(title: string, script: string): ImageTeachingProfile {
  const text = `${title} ${script}`.toLowerCase();
  const C = COLOR_MAP;

  if (isPhotosynthesisText(text)) {
    return {
      prompt: `A wide photorealistic technical biology demonstration for "${title}": a leaf cross-section slide under a microscope, a desk lamp shining onto a fresh green leaf, clear cuvettes of chlorophyll extract, and tiny oxygen bubbles rising from an aquatic plant in a glass beaker. Clean lab bench, no readable text, labels, numbers, logos, screens, or signage.`,
      callouts: [
        { kind: "callout", text: "leaf sample", x: 24, y: 56, labelX: 18, labelY: 26, color: C.green, at: 0.18 },
        { kind: "callout", text: "light source", x: 45, y: 28, labelX: 48, labelY: 16, color: C.amber, at: 0.32 },
        { kind: "callout", text: "chlorophyll extract", x: 62, y: 58, labelX: 78, labelY: 34, color: C.blue, at: 0.48 },
        { kind: "callout", text: "oxygen bubbles", x: 78, y: 70, labelX: 70, labelY: 84, color: C.violet, at: 0.64 },
      ],
    };
  }

  if (/\bdemand|buyer|consumer|choice|substitute|complement|preference\b/.test(text)) {
    return {
      prompt: `A wide photorealistic consumer-choice study scene for "${title}": an overhead view of a shopper basket beside two similar product options, a hand comparing one item against another, a paired complementary item nearby, and several identical units left on a shelf. No readable text, brand names, labels, price tags, numbers, logos, screens, or signage.`,
      callouts: [
        { kind: "callout", text: "chosen item", x: 36, y: 56, labelX: 20, labelY: 28, color: C.green, at: 0.18 },
        { kind: "callout", text: "substitute nearby", x: 66, y: 46, labelX: 78, labelY: 24, color: C.rose, at: 0.32 },
        { kind: "callout", text: "paired good", x: 54, y: 75, labelX: 36, labelY: 84, color: C.blue, at: 0.48 },
        { kind: "callout", text: "remaining stock", x: 82, y: 62, labelX: 80, labelY: 78, color: C.amber, at: 0.64 },
      ],
    };
  }

  if (/\bsupply|producer|seller|cost|input|output|factory|production|inventory\b/.test(text)) {
    return {
      prompt: `A wide photorealistic technical operations scene for "${title}": a small food production line with an ingredient scale, trays moving out of an oven, cooling racks filling up, stacked packing crates, and a worker checking available inventory by hand. No readable text, labels, price tags, numbers, logos, screens, or signage.`,
      callouts: [
        { kind: "callout", text: "input materials", x: 18, y: 62, labelX: 18, labelY: 28, color: C.rose, at: 0.18 },
        { kind: "callout", text: "oven capacity", x: 44, y: 38, labelX: 46, labelY: 18, color: C.amber, at: 0.32 },
        { kind: "callout", text: "finished output", x: 66, y: 66, labelX: 78, labelY: 38, color: C.green, at: 0.48 },
        { kind: "callout", text: "packed inventory", x: 83, y: 58, labelX: 78, labelY: 84, color: C.blue, at: 0.64 },
      ],
    };
  }

  if (/\b(force|motion|acceleration|velocity|gravity|energy|friction|wave|electric|magnet|newton)\b/.test(text)) {
    return {
      prompt: `A wide photorealistic technical physics setup for "${title}": a dynamics cart on a metal track, pulley string with hanging masses, motion sensor, spring scale, and a hand releasing the cart. No readable text, labels, numbers, logos, screens, or signage.`,
      callouts: [
        { kind: "callout", text: "cart mass", x: 34, y: 58, labelX: 20, labelY: 28, color: C.blue, at: 0.18 },
        { kind: "callout", text: "pulling weight", x: 68, y: 45, labelX: 80, labelY: 24, color: C.rose, at: 0.32 },
        { kind: "callout", text: "track direction", x: 52, y: 70, labelX: 42, labelY: 84, color: C.green, at: 0.48 },
        { kind: "callout", text: "sensor view", x: 82, y: 60, labelX: 78, labelY: 82, color: C.amber, at: 0.64 },
      ],
    };
  }

  if (/\b(chemistry|reaction|reactant|product|molecule|atom|bond|acid|base|solution|catalyst)\b/.test(text)) {
    return {
      prompt: `A wide photorealistic technical chemistry setup for "${title}": clear reaction vessels, dropper adding liquid, molecular model pieces arranged beside the glassware, a safe heating plate, and two visibly different before-and-after samples. No readable text, labels, numbers, logos, screens, or signage.`,
      callouts: [
        { kind: "callout", text: "reactant vessel", x: 28, y: 56, labelX: 18, labelY: 26, color: C.blue, at: 0.18 },
        { kind: "callout", text: "energy source", x: 52, y: 42, labelX: 52, labelY: 18, color: C.amber, at: 0.32 },
        { kind: "callout", text: "bond model", x: 66, y: 64, labelX: 80, labelY: 42, color: C.violet, at: 0.48 },
        { kind: "callout", text: "product sample", x: 82, y: 72, labelX: 70, labelY: 84, color: C.green, at: 0.64 },
      ],
    };
  }

  return imageTeachingProfile(title, script);
}

function makeAnimationBoard(title: string, script: string, durationMs = 26000): DrawScript {
  const context: DrawRepairContext = {
    title,
    script,
    slideKind: "intro",
    index: 0,
  };
  const scene = fallbackScene(context);
  const referenceMotion = [scene, ...fallbackMotions(scene, context)];
  const teachingPoint = makeAnimationTeachingPoint(title, script, scene, referenceMotion);
  if (isPhotosynthesisText(`${title} ${script}`)) {
    const photosynthesisReference: DrawOp[] = [{
      kind: "scene",
      scene: "process",
      title: boardTitle(title),
      items: ["photons", "chlorophyll", "electron jump", "ATP/NADPH", "glucose"],
      color: COLOR_MAP.amber,
      at: 0.12,
      endAt: 0.94,
    }];
    return {
      caption: title,
      durationMs,
      ops: [{
        kind: "reactAnimation",
        teachingPoint: makeAnimationTeachingPoint(title, script, photosynthesisReference[0] as SceneOp, photosynthesisReference),
        at: 0,
        endAt: 1,
      }],
    };
  }
  return {
    caption: title,
    durationMs,
    ops: [{
      kind: "reactAnimation",
      teachingPoint,
      at: 0,
      endAt: 1,
    }],
  };
}

function makeAnimationTeachingPoint(title: string, script: string, scene: SceneOp, fallback: DrawOp[]): string {
  const items = scene.items?.length ? scene.items : contextualItems({ title, script }, scene.scene);
  const motionWords = fallback
    .filter((op): op is MotionOp => op.kind === "motion")
    .map((op) => op.text)
    .filter((text): text is string => Boolean(text));
  const actors = uniqueShort([...items, ...motionWords], 5).join(", ");
  const scriptLead = shortenAtWord(script.replace(/\s+/g, " "), 170);
  return shortenAtWord(
    `${title}: show ${actors || "the key parts"} in a full-board ${scene.scene} animation where the starting state visibly changes step by step into the outcome; ground the motion in this narration: ${scriptLead}`,
    360
  );
}

function animationNeedsRepair(beat: Beat): boolean {
  if (!beat.draw) return true;
  // A reactAnimation op IS a complete, valid animation board on its own (see beatIsAnimationLed
  // above) — none of the legacy scene-kind checks below apply to it, and it must never be
  // rewritten here even when it happens to describe a supply/demand or photosynthesis topic.
  if (beat.draw.ops.some((op) => op.kind === "reactAnimation" || op.kind === "manimScene" || op.kind === "morph" || op.kind === "structureScene" || op.kind === "plotBoard" || op.kind === "equationBoard")) return false;
  const text = `${beat.title} ${beat.script}`.toLowerCase();
  const scene = beat.draw.ops.find((op): op is SceneOp => op.kind === "scene");
  if (!scene) return true;
  if (/\bsupply|demand|equilibrium|market price|supply curve|demand curve\b/.test(text)) {
    return scene.scene !== "graph";
  }
  if (isPhotosynthesisText(text)) {
    return scene.scene !== "process";
  }
  const textLabels = beat.draw.ops.filter((op) => (op.kind === "label" || op.kind === "note" || op.kind === "callout") && op.text.trim().length > 0).length;
  const motionLabels = beat.draw.ops.filter((op) => op.kind === "motion" && op.text).length;
  return textLabels > 0 || motionLabels > 2;
}

function imageBeatNeedsConcreteRepair(beat: Beat): boolean {
  const promptText = (beat.draw?.ops ?? [])
    .filter((op) => op.kind === "image")
    .map((op) => op.prompt)
    .join(" ")
    .toLowerCase();
  // A prompt describing an INTENTIONAL technical diagram (per drawPrompt.ts TYPE B's
  // mechanical/scientific branch — "cutaway diagram of a battery cell", "exploded-view technical
  // diagram of an engine") is valid content, not a bug — do not flag it for repair. Only flag the
  // OLD failure pattern this check existed to catch: a prompt that describes a flat 2D chart,
  // classroom poster, or literal graph-paper axes INSTEAD OF a real photographed/illustrated
  // scene (e.g. "a whiteboard with a demand curve drawn on it" — a photo of a drawing, not a
  // subject). A genuine diagram request names real parts/cutaway/schematic; a bad one names
  // meta-objects like whiteboard/poster/graph paper/classroom.
  if (/\b(diagram|cutaway|cross-section|cross section|schematic|exploded[- ]view|blueprint|technical illustration|labeled illustration|engineering drawing)\b/.test(promptText)) {
    return /\b(graph paper|plotted on|whiteboard|blackboard|classroom|teacher|infographic|poster|hand-drawn|drawn on a)\b/.test(promptText);
  }
  return /\b(graph paper|plotted|labeled axes|axis|axes|curve|diagram|chart|whiteboard|blackboard|classroom|teacher|infographic|poster)\b/.test(promptText);
}

function imageTeachingProfile(title: string, script: string): ImageTeachingProfile {
  const text = `${title} ${script}`.toLowerCase();
  const C = COLOR_MAP;

  if (/\bdemand\b/.test(text) && !/\bsupply\b/.test(text) && !/\bshift|income|taste|substitute|complement|preference\b/.test(text)) {
    return {
      prompt: `A wide photorealistic open-air produce market scene for an economics lecture about "${title}": a tomato stall with a clearly visible seller, several buyers reaching toward tomatoes, full crates of tomatoes, and a quieter nearby produce option. No readable text, labels, price tags, logos, or signage.`,
      callouts: [
        { kind: "callout", text: "buyers demand", x: 49, y: 39, labelX: 30, labelY: 18, color: C.rose, at: 0.18 },
        { kind: "callout", text: "seller offers", x: 23, y: 40, labelX: 18, labelY: 64, color: C.blue, at: 0.34 },
        { kind: "callout", text: "quantity bought", x: 46, y: 69, labelX: 58, labelY: 83, color: C.green, at: 0.5 },
        { kind: "callout", text: "other options", x: 78, y: 59, labelX: 84, labelY: 28, color: C.amber, at: 0.64 },
      ],
    };
  }

  if (/\bsupply\b/.test(text) && !/\bdemand\b/.test(text) && /\b(bakery|producer|seller|cost|input|output|supply)\b/.test(text)) {
    return {
      prompt: `A wide photorealistic educational scene for an economics lecture about "${title}": the back room of a small bakery before opening, with sacks of flour and ingredients, a baker pulling trays from an oven, cooling racks full of bread, and delivery crates being packed. No readable text, labels, logos, or signage.`,
      callouts: [
        { kind: "callout", text: "input costs", x: 16, y: 62, labelX: 20, labelY: 28, color: C.rose, at: 0.18 },
        { kind: "callout", text: "production capacity", x: 47, y: 34, labelX: 48, labelY: 18, color: C.blue, at: 0.32 },
        { kind: "callout", text: "output supplied", x: 68, y: 70, labelX: 78, labelY: 35, color: C.green, at: 0.48 },
        { kind: "callout", text: "ready for market", x: 86, y: 53, labelX: 84, labelY: 78, color: C.amber, at: 0.62 },
      ],
    };
  }

  if (/\bshift|income|taste|substitute|complement|preference\b/.test(text) && /\bdemand\b/.test(text)) {
    return {
      prompt: `A wide photorealistic grocery-store scene for an economics lesson about "${title}": shoppers choosing between similar snack or drink options, a friend pointing at a newly popular item, a basket containing complementary goods together, and a quieter competing shelf nearby. No readable text, brand names, labels, price tags, or signage.`,
      callouts: [
        { kind: "callout", text: "taste changes", x: 47, y: 44, labelX: 36, labelY: 18, color: C.violet, at: 0.18 },
        { kind: "callout", text: "substitute option", x: 78, y: 50, labelX: 82, labelY: 22, color: C.rose, at: 0.34 },
        { kind: "callout", text: "complements together", x: 56, y: 78, labelX: 32, labelY: 78, color: C.green, at: 0.5 },
        { kind: "callout", text: "new demand", x: 35, y: 59, labelX: 20, labelY: 42, color: C.amber, at: 0.64 },
      ],
    };
  }

  if (/\bequilibrium|balance|market dynamics|shortage|surplus\b/.test(text) || (/\bsupply\b/.test(text) && /\bdemand\b/.test(text))) {
    return {
      prompt: `A wide photorealistic open-air produce market scene for an economics lecture about "${title}": a seller at a tomato stall, buyers reaching for tomatoes, full crates, a quieter neighboring produce section, and visible movement between buyer interest and seller stock. No readable text, labels, price tags, logos, or signage.`,
      callouts: [
        { kind: "callout", text: "buyers demand", x: 49, y: 39, labelX: 30, labelY: 18, color: C.rose, at: 0.18 },
        { kind: "callout", text: "seller supplies", x: 23, y: 40, labelX: 18, labelY: 64, color: C.blue, at: 0.34 },
        { kind: "callout", text: "quantity traded", x: 46, y: 69, labelX: 58, labelY: 83, color: C.green, at: 0.5 },
        { kind: "callout", text: "balance point", x: 58, y: 45, labelX: 76, labelY: 25, color: C.amber, at: 0.64 },
      ],
    };
  }

  if (/\b(cell|dna|gene|protein|enzyme|photosynthesis|respiration|ecosystem|organism|biology|mitosis|chlorophyll|chloroplast|glucose|light absorption|wavelength|thylakoid)\b/.test(text)) {
    return {
      prompt: `A wide photorealistic biology learning scene for a lecture about "${title}": a lab bench with a microscope, plant samples, water droplets on leaves, specimen trays, and a student observing carefully. No readable text, labels, numbers, logos, or signage.`,
      callouts: [
        { kind: "callout", text: "structure", x: 34, y: 48, labelX: 20, labelY: 24, color: C.green, at: 0.18 },
        { kind: "callout", text: "input", x: 58, y: 35, labelX: 68, labelY: 18, color: C.blue, at: 0.34 },
        { kind: "callout", text: "process", x: 54, y: 63, labelX: 76, labelY: 52, color: C.violet, at: 0.5 },
        { kind: "callout", text: "output", x: 74, y: 74, labelX: 62, labelY: 84, color: C.amber, at: 0.64 },
      ],
    };
  }

  if (/\b(force|motion|acceleration|velocity|gravity|energy|friction|wave|electric|magnet|newton)\b/.test(text)) {
    return {
      prompt: `A wide photorealistic physics lab demonstration for a lecture about "${title}": a small cart on a ramp, hanging weights, motion sensors, measuring tools, and a student hand preparing the setup. No readable text, labels, numbers, logos, or signage.`,
      callouts: [
        { kind: "callout", text: "starting condition", x: 23, y: 61, labelX: 20, labelY: 26, color: C.blue, at: 0.18 },
        { kind: "callout", text: "applied force", x: 42, y: 42, labelX: 42, labelY: 18, color: C.rose, at: 0.34 },
        { kind: "callout", text: "motion response", x: 66, y: 57, labelX: 76, labelY: 28, color: C.green, at: 0.5 },
        { kind: "callout", text: "measured result", x: 80, y: 70, labelX: 76, labelY: 84, color: C.amber, at: 0.64 },
      ],
    };
  }

  if (/\b(chemistry|reaction|reactant|product|molecule|atom|bond|acid|base|solution|catalyst)\b/.test(text)) {
    return {
      prompt: `A wide photorealistic chemistry lab bench for a lecture about "${title}": clear glassware with colored liquids, molecular model pieces, a safe heating setup, droppers, and visible before-and-after samples. No readable text, labels, numbers, logos, or signage.`,
      callouts: [
        { kind: "callout", text: "reactants", x: 26, y: 57, labelX: 20, labelY: 25, color: C.blue, at: 0.18 },
        { kind: "callout", text: "energy change", x: 51, y: 43, labelX: 50, labelY: 18, color: C.amber, at: 0.34 },
        { kind: "callout", text: "new bonds", x: 63, y: 62, labelX: 78, labelY: 34, color: C.violet, at: 0.5 },
        { kind: "callout", text: "products", x: 79, y: 70, labelX: 70, labelY: 84, color: C.green, at: 0.64 },
      ],
    };
  }

  if (/\b(algebra|function|equation|geometry|calculus|derivative|integral|probability|statistics|ratio|slope|math)\b/.test(text)) {
    return {
      prompt: `A wide photorealistic hands-on math workspace for a lecture about "${title}": colored blocks, measuring tools, folded paper shapes, a calculator with blank screen glare, and objects arranged to show a relationship. No readable text, labels, numbers, formulas, logos, or signage.`,
      callouts: [
        { kind: "callout", text: "known pieces", x: 28, y: 60, labelX: 20, labelY: 26, color: C.blue, at: 0.18 },
        { kind: "callout", text: "relationship", x: 53, y: 45, labelX: 52, labelY: 18, color: C.violet, at: 0.34 },
        { kind: "callout", text: "change", x: 66, y: 66, labelX: 78, labelY: 44, color: C.rose, at: 0.5 },
        { kind: "callout", text: "result", x: 79, y: 74, labelX: 70, labelY: 84, color: C.green, at: 0.64 },
      ],
    };
  }

  if (/\b(algorithm|program|coding|code|computer|data|database|network|internet|software|binary|machine learning)\b/.test(text)) {
    return {
      prompt: `A wide photorealistic computer science workspace for a lecture about "${title}": a laptop with unreadable blurred interface, connected cables, small server hardware, sticky-note shapes with no writing, and a person tracing a process with their hand. No readable text, code, labels, numbers, logos, or signage.`,
      callouts: [
        { kind: "callout", text: "input", x: 27, y: 62, labelX: 20, labelY: 28, color: C.blue, at: 0.18 },
        { kind: "callout", text: "rule", x: 51, y: 42, labelX: 50, labelY: 18, color: C.violet, at: 0.34 },
        { kind: "callout", text: "state change", x: 62, y: 62, labelX: 78, labelY: 38, color: C.amber, at: 0.5 },
        { kind: "callout", text: "output", x: 82, y: 67, labelX: 74, labelY: 84, color: C.green, at: 0.64 },
      ],
    };
  }

  if (/\b(history|civilization|empire|revolution|government|election|war|trade route|culture|society)\b/.test(text)) {
    return {
      prompt: `A wide photorealistic museum-style learning scene for a lecture about "${title}": historical objects on a table, old maps with no readable markings, a timeline-like arrangement of artifacts, and students examining evidence. No readable text, labels, dates, logos, or signage.`,
      callouts: [
        { kind: "callout", text: "context", x: 26, y: 54, labelX: 20, labelY: 25, color: C.amber, at: 0.18 },
        { kind: "callout", text: "choice", x: 49, y: 42, labelX: 50, labelY: 18, color: C.blue, at: 0.34 },
        { kind: "callout", text: "conflict", x: 65, y: 62, labelX: 78, labelY: 38, color: C.rose, at: 0.5 },
        { kind: "callout", text: "consequence", x: 79, y: 73, labelX: 68, labelY: 84, color: C.green, at: 0.64 },
      ],
    };
  }

  if (/\b(literature|poem|novel|story|character|theme|plot|metaphor|author|essay)\b/.test(text)) {
    return {
      prompt: `A wide photorealistic literature study desk for a lecture about "${title}": an open book with pages blurred so no words are readable, index cards with no writing, a pencil, warm desk light, and objects arranged around the book to suggest story evidence. No readable text, labels, logos, or signage.`,
      callouts: [
        { kind: "callout", text: "character", x: 34, y: 52, labelX: 20, labelY: 24, color: C.blue, at: 0.18 },
        { kind: "callout", text: "conflict", x: 55, y: 42, labelX: 58, labelY: 18, color: C.rose, at: 0.34 },
        { kind: "callout", text: "evidence", x: 61, y: 66, labelX: 78, labelY: 48, color: C.amber, at: 0.5 },
        { kind: "callout", text: "theme", x: 77, y: 74, labelX: 66, labelY: 84, color: C.green, at: 0.64 },
      ],
    };
  }

  return {
    prompt: `A wide photorealistic educational scene depicting the real-world idea "${title}". Context: ${script.slice(0, 220)}. The scene must contain several distinct visible regions that can be explained with live callouts. No readable text, labels, logos, or signage.`,
    callouts: [
      { kind: "callout", text: "main example", x: 42, y: 48, labelX: 20, labelY: 26, color: C.green, at: 0.2 },
      { kind: "callout", text: "cause", x: 60, y: 45, labelX: 78, labelY: 28, color: C.blue, at: 0.36 },
      { kind: "callout", text: "effect", x: 54, y: 68, labelX: 72, labelY: 78, color: C.amber, at: 0.54 },
    ],
  };
}

function contextText(context?: DrawRepairContext) {
  return [context?.title, ...(context?.points ?? []), context?.compareLeft?.label, ...(context?.compareLeft?.points ?? []), context?.compareRight?.label, ...(context?.compareRight?.points ?? []), context?.script]
    .filter(Boolean)
    .join(" ");
}

const STOP_WORDS = new Set([
  "about", "after", "again", "almost", "also", "because", "before", "being", "between", "called", "could", "defining", "definition", "does", "each", "every", "from", "have", "here", "idea", "into", "just", "like", "look", "main", "make", "makes", "means", "more", "most", "need", "needs", "notice", "only", "other", "part", "really", "right", "same", "show", "shows", "some", "that", "their", "then", "there", "these", "thing", "this", "through", "what", "when", "where", "which", "while", "with", "your",
]);

function keywordItems(text: string) {
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 3 && !STOP_WORDS.has(word));
  const seen = new Set<string>();
  const picked: string[] = [];
  for (const word of words) {
    if (seen.has(word)) continue;
    seen.add(word);
    picked.push(word);
    if (picked.length >= 5) break;
  }
  return picked;
}

function uniqueShort(items: string[], max: number) {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
    const clean = shorten(item, 28);
    const key = clean.toLowerCase();
    if (!clean || seen.has(key)) continue;
    seen.add(key);
    out.push(clean);
    if (out.length >= max) break;
  }
  return out;
}

type SanitizeDrawLectureOptions = {
  enforceDepth?: boolean;
  minUsableBeats?: number;
};

/** Sanitizes the whole `{ beats: [...] }` payload. Throws if too few survive. */
export function sanitizeDrawLecture(raw: unknown, options: SanitizeDrawLectureOptions = {}): Beat[] {
  if (!raw || typeof raw !== "object") throw new Error("Model returned no usable lecture.");
  const beatsRaw = (raw as Record<string, unknown>).beats;
  if (!Array.isArray(beatsRaw)) throw new Error("Model returned no usable lecture.");
  const beats = beatsRaw.map((b, i) => sanitizeBeat(b, i)).filter((b): b is Beat => b !== null);
  const minUsableBeats = options.minUsableBeats ?? 9;
  if (beats.length < minUsableBeats) {
    throw new Error(`Model only returned ${beats.length} usable beats — too few for a real lecture. Try again.`);
  }

  // BLACKBOARD GUARANTEE: the first teaching beat after the intro is a clean written board.
  // Later beats are balanced by the rhythm pass below so the lecture does not become a wall
  // of chalkboards.
  function beatIsBlackboard(beat: Beat): boolean {
    if (!beat.draw) return false;
    // A `chalkBoard` op IS the blackboard — its real ops are authored later by fillBlackboardOps.
    // Treat it as a blackboard so the rhythm/quality gates below leave it alone (mirrors how a
    // `reactAnimation` op is treated as animation-led) rather than overwriting it with a template.
    if (beat.draw.ops.some((op) => op.kind === "chalkBoard")) return true;
    return isWrittenBlackboard(beat.draw.ops);
  }
  function beatIsImageLed(beat: Beat): boolean {
    if (!beat.draw) return false;
    const hasImage = beat.draw.ops.some((op) => op.kind === "image");
    const hasCallouts = beat.draw.ops.some((op) => op.kind === "callout");
    const hasAnim = beat.draw.ops.some((op) => op.kind === "scene" || op.kind === "motion");
    return hasImage && hasCallouts && !hasAnim;
  }
  function beatIsAnimationLed(beat: Beat): boolean {
    if (!beat.draw) return false;
    // A `reactAnimation` op IS the animation-led board — it's a self-contained op, not a
    // scene+motion pair. Treat it as automatically animation-led so none of the rhythm/quality
    // gates below mistake it for an empty/weak beat and overwrite it with makeAnimationBoard().
    if (beat.draw.ops.some((op) => op.kind === "reactAnimation" || op.kind === "manimScene" || op.kind === "morph" || op.kind === "structureScene" || op.kind === "plotBoard" || op.kind === "equationBoard")) return true;
    const hasImage = beat.draw.ops.some((op) => op.kind === "image");
    const hasCallouts = beat.draw.ops.some((op) => op.kind === "callout");
    const hasSceneOp = beat.draw.ops.some((op) => op.kind === "scene");
    const motionCount = beat.draw.ops.filter((op) => op.kind === "motion" || op.kind === "morph").length;
    return !hasImage && !hasCallouts && hasSceneOp && motionCount >= 1 && motionCount <= 3;
  }

  // ── BOARD-QUALITY GATES ──────────────────────────────────────────────────
  // "Trust the model more": we only overwrite a model-authored board with the sanitizer's
  // makeWrittenBoard() fallback when the model's own board is genuinely bad OR when a
  // hardcoded topicRows template exists (economics/physics/bio) that is strictly better.
  const modelBoardIsGoodBlackboard = (beat: Beat): boolean => {
    if (!beat.draw) return false;
    // A chalkBoard placeholder is a complete, valid blackboard on its own (real ops filled by
    // fillBlackboardOps) — always "good" so no forcing pass overwrites it with a template.
    if (beat.draw.ops.some((op) => op.kind === "chalkBoard")) return true;
    return beatIsBlackboard(beat) && blackboardTextIsClean(beat.draw.ops);
  };
  // Puts a `chalkBoard` placeholder on a beat that a rhythm/safety pass wants to be a blackboard.
  // Replaces the old makeWrittenBoard() template forcing — the real chalk ops are authored later
  // by fillBlackboardOps. Idempotent: leaves an existing chalkBoard beat untouched.
  const injectChalkBoard = (beat: Beat, durationMs: number) => {
    if (beat.draw?.ops.some((op) => op.kind === "chalkBoard")) return;
    if (!BLACKBOARD_GEN_ENABLED) {
      // Flag off: keep the legacy deterministic template board.
      beat.draw = makeWrittenBoard(beat.title, beat.script, durationMs, boardCtx);
      return;
    }
    const boardBrief = (`${beat.title}. ${firstSentence(beat.script, "")}`).trim().slice(0, 240) || beat.title;
    beat.draw = { caption: beat.title, durationMs, ops: [{ kind: "chalkBoard", boardBrief, at: 0, endAt: 1 }] };
  };
  const modelBoardIsGoodImage = (beat: Beat): boolean => {
    if (!beat.draw) return false;
    const hasImage = beat.draw.ops.some((op) => op.kind === "image");
    const calloutCount = beat.draw.ops.filter((op) => op.kind === "callout").length;
    const hasAnim = beat.draw.ops.some((op) => op.kind === "scene" || op.kind === "motion");
    return hasImage && calloutCount >= 2 && !hasAnim;
  };
  const modelBoardIsGoodAnimation = (beat: Beat): boolean => {
    if (!beat.draw) return false;
    if (beat.draw.ops.some((op) => op.kind === "reactAnimation" || op.kind === "manimScene" || op.kind === "morph" || op.kind === "structureScene" || op.kind === "plotBoard" || op.kind === "equationBoard")) return true;
    const hasSceneOp = beat.draw.ops.some((op) => op.kind === "scene");
    const motionCount = beat.draw.ops.filter((op) => op.kind === "motion" || op.kind === "morph").length;
    return hasSceneOp && motionCount >= 1 && motionCount <= 3;
  };
  const modelBoardIsGood = (beat: Beat): boolean =>
    modelBoardIsGoodBlackboard(beat) || modelBoardIsGoodImage(beat) || modelBoardIsGoodAnimation(beat);
  const meaningfulOpCount = (beat: Beat): number => {
    if (!beat.draw) return 0;
    // A reactAnimation op is a single self-contained board, not a set of composable primitives
    // to count individually — credit it with 4 so it clears the `>= 4` acceptability floor
    // below (modelBoardIsAcceptable) on its own, same as a real multi-op board would.
    if (beat.draw.ops.some((op) => op.kind === "reactAnimation" || op.kind === "manimScene" || op.kind === "morph" || op.kind === "structureScene" || op.kind === "plotBoard" || op.kind === "equationBoard")) return 4;
    return beat.draw.ops.filter((op) =>
      op.kind === "label" || op.kind === "note" || op.kind === "callout" ||
      op.kind === "arrow" || op.kind === "scene" || op.kind === "motion" || op.kind === "image"
    ).length;
  };
  const modelBoardIsAcceptable = (beat: Beat): boolean => {
    if (!beat.draw) return false;
    if (modelBoardIsGood(beat)) return true;
    const ops = beat.draw.ops;
    const hasImage = ops.some((op) => op.kind === "image");
    const calloutCount = ops.filter((op) => op.kind === "callout").length;
    const hasSceneOp = ops.some((op) => op.kind === "scene");
    const motionCount = ops.filter((op) => op.kind === "motion" || op.kind === "morph").length;
    const labelCount = ops.filter((op) => op.kind === "label").length;
    const noteCount = ops.filter((op) => op.kind === "note").length;
    // Looser tier: single-callout image, static labeled scene, or a light written board.
    if (hasImage && calloutCount >= 1) return true;
    if (hasSceneOp && motionCount === 0) return true;
    if (labelCount >= 1 && noteCount >= 2) return true;
    return meaningfulOpCount(beat) >= 4;
  };
  // boardScore: higher = better. Used to convert the WEAKEST boards first in the safety net.
  const boardScore = (beat: Beat): number => {
    let score = 0;
    if (modelBoardIsGood(beat)) score += 3;
    else if (modelBoardIsAcceptable(beat)) score += 1;
    return score * 100 + meaningfulOpCount(beat);
  };

  // Cross-beat synthesis state: every makeWrittenBoard call below shares it so no two
  // synthesized boards in one lecture write the same rows or the same chalk diagram. Seed it
  // with the model's own KEPT blackboards so synthesized boards don't echo those either.
  const boardCtx = newBoardContext();
  for (const beat of beats) {
    if (beat.draw && modelBoardIsGoodBlackboard(beat)) {
      registerBlackboardOps(beat.draw.ops, boardCtx.usedSyms);
    }
  }

  for (const idx of [1]) {
    const beat = beats[idx];
    if (!beat || beat.slideKind === "checkpoint") continue;
    if (modelBoardIsGoodBlackboard(beat)) continue; // already the ideal opening board
    // Keep a good non-template model board (image/animation). For topics WITH a hardcoded
    // template (economics/physics/bio), force the strong blackboard instead — it beats both
    // the model's scene and the weak keyword fallback.
    if (modelBoardIsGood(beat) && !hasTemplateRows(beat.title, beat.script)) continue;
    injectChalkBoard(beat, beat.draw?.durationMs ?? 28000);
  }

  // If a model-authored blackboard survived structurally but contains chopped phrases,
  // duplicate rows, or overlong notes, rebuild it from the beat script. This is deliberately
  // deterministic: the model teaches in `script`; our code writes the chalkboard cleanly.
  for (const beat of beats) {
    if (!beat.draw || beat.slideKind === "checkpoint") continue;
    if (beat.draw.ops.some((op) => op.kind === "chalkBoard")) continue; // already the new pipeline
    if (beatIsBlackboard(beat) && !blackboardTextIsClean(beat.draw.ops)) {
      injectChalkBoard(beat, beat.draw.durationMs ?? 28000);
    }
  }

  // TOPIC-AWARE BLACKBOARD UPGRADE: beats whose titles match known explanatory patterns
  // (laws, definitions, shifts, formulas) are better as blackboards than animations,
  // regardless of what the model generated. Convert them if they're currently animation-led
  // and topicRows() has a real template for them (non-fallback).
  const BLACKBOARD_TITLE_PATTERNS = [
    /\blaw of (demand|supply)\b/i,
    /\bshift(s)? in (demand|supply)\b/i,
    /\bequilibrium\b/i,
    /\bprice (floor|ceiling|control)\b/i,
    /\belasticity\b/i,
    /\bnewton'?s (first|second|third)? law\b/i,
    /\bphotosynthesis\b/i,
    /\bformula|equation|theorem|law\b/i,
  ];
  let blackboardCount = beats.slice(1).filter(beatIsBlackboard).length;
  for (let i = 1; i < beats.length; i++) {
    const beat = beats[i];
    if (!beat?.draw || beat.slideKind === "checkpoint") continue;
    if (beatIsBlackboard(beat)) continue; // already a blackboard
    if (i >= 3 && i <= 5) continue; // protect the explanatory image window
    // Only upgrade animation-led beats (scene/motion), not image-led beats — those have photos
    const hasAnim = beat.draw.ops.some((op) => op.kind === "scene" || op.kind === "motion");
    if (!hasAnim) continue;
    const titleMatches = BLACKBOARD_TITLE_PATTERNS.some((p) => p.test(beat.title));
    // Only upgrade when a real hardcoded template exists — otherwise a generic "…law/formula"
    // title would be converted into the weak keyword fallback board, which is worse than the
    // model's own animation.
    if (titleMatches && hasTemplateRows(beat.title, beat.script) && blackboardCount < 4) {
      injectChalkBoard(beat, beat.draw.durationMs ?? 26000);
      blackboardCount++;
    }
  }

  // IMAGE-LED GUARANTEE: after the opening blackboards, every full lecture should include
  // several concrete real-world image boards. These are not decorative photos — they carry
  // callouts that point at visible evidence in the image.
  const lastTeachingIdx = (() => {
    for (let i = beats.length - 1; i >= 1; i--) {
      if (beats[i]?.slideKind !== "checkpoint") return i;
    }
    return beats.length - 1;
  })();
  let imageLedCount = beats.slice(1).filter(beatIsImageLed).length;
  const preferredImageIdxs = [3, 4, 5, 6, 7, 8, 9].filter((i) => i < beats.length && i < lastTeachingIdx);
  const forceImageBoards = (allowReplacingBlackboard: boolean) => {
    for (const idx of preferredImageIdxs) {
      const beat = beats[idx];
      if (!beat || beat.slideKind === "checkpoint") continue;
      // A reactAnimation or chalkBoard beat is a deliberate animation-/blackboard-slot board —
      // never overwrite either with a forced image board, even on the allowReplacingBlackboard
      // pass (that pass is meant for the OLD label/arrow/note blackboard grammar, not the new
      // chalkBoard placeholder, which is never a legacy "beatIsBlackboard" match on its own).
      if (beat.draw?.ops.some((op) => op.kind === "reactAnimation" || op.kind === "chalkBoard" || op.kind === "manimScene" || op.kind === "morph" || op.kind === "structureScene" || op.kind === "plotBoard" || op.kind === "equationBoard")) continue;
      if (beatIsImageLed(beat) && imageBeatNeedsConcreteRepair(beat)) {
        beat.draw = makeImageCalloutBoard(beat.title, beat.script, beat.draw?.durationMs ?? 26000);
        continue;
      }
      if (imageLedCount >= 3) break;
      if (beatIsImageLed(beat)) continue;
      if (!allowReplacingBlackboard && beatIsBlackboard(beat)) continue;
      beat.draw = makeImageCalloutBoard(beat.title, beat.script, beat.draw?.durationMs ?? 26000);
      imageLedCount++;
    }
  };
  forceImageBoards(false);
  forceImageBoards(true);

  // CLOSING BLACKBOARD GUARANTEE: the final non-checkpoint beat should recap the logic on
  // a written board — but keep a good non-template model recap (e.g. a clean recap animation
  // for a history topic) rather than replacing it with the weak keyword fallback.
  const closingBeat = beats[lastTeachingIdx];
  if (closingBeat && closingBeat.slideKind !== "checkpoint") {
    const keep = modelBoardIsGoodBlackboard(closingBeat)
      || (modelBoardIsGood(closingBeat) && !hasTemplateRows(closingBeat.title, closingBeat.script));
    if (!keep) {
      if (BLACKBOARD_GEN_ENABLED) {
        // Recap becomes a chalkBoard placeholder too — fillBlackboardOps authors a genuine
        // one-row-per-idea synthesis from the beat script (the boardBrief nudges "recap/synthesize").
        const recapBrief = `Recap of ${closingBeat.title}: synthesize the lecture's key ideas, one row each, with a closing takeaway.`;
        closingBeat.draw = { caption: closingBeat.title, durationMs: closingBeat.draw?.durationMs ?? 26000, ops: [{ kind: "chalkBoard", boardBrief: recapBrief, at: 0, endAt: 1 }] };
      } else {
        // Synthesize a genuine recap from the legacy template builder.
        closingBeat.draw = makeRecapBoard(beats, closingBeat, boardCtx);
      }
    }
  }

  // Variety enforcement: the model sometimes reuses the SAME scene kind on many beats in a row,
  // which makes several boards look identical. For most scene kinds we convert the duplicate into
  // a written/blackboard board built from the beat's content.
  //
  // EXCEPTION — "graph": economics lectures legitimately need several graph beats (the base
  // supply/demand equilibrium, then a demand-shift, then a supply-shift). Each is a genuinely
  // DIFFERENT hand-drawn diagram — a real teaching visual — even though they share the "graph"
  // scene kind. Converting those to the written fallback throws away good model-authored diagrams
  // and replaces them with narration transcribed as bullets, which is exactly the failure the
  // user complained about. So we KEEP graph duplicates: a real drawn diagram always beats the
  // transcription fallback. We cap the count only to avoid an absurd run of them.
  const seenSceneKinds = new Set<string>();
  let graphCount = 0;
  for (const beat of beats) {
    if (!beat.draw) continue;
    if (isWrittenBlackboard(beat.draw.ops)) continue; // already a blackboard, skip
    const sceneOp = beat.draw.ops.find((op) => op.kind === "scene");
    if (!sceneOp) continue;
    const kind = sceneOp.scene;
    if (kind === "graph") {
      // Keep up to 3 graph diagrams (base + demand shift + supply shift); convert only beyond that.
      graphCount++;
      if (graphCount <= 3) continue;
      injectChalkBoard(beat, beat.draw.durationMs ?? 26000);
      continue;
    }
    if (seenSceneKinds.has(kind)) {
      // Convert this duplicate non-graph scene into a chalkBoard placeholder (authored later).
      injectChalkBoard(beat, beat.draw.durationMs ?? 26000);
    } else {
      seenSceneKinds.add(kind);
    }
  }

  // SURFACE RHYTHM GUARANTEE: avoid the "everything becomes blackboard" failure mode.
  // After the intro, the lecture alternates blackboard -> image -> blackboard -> image ...
  // We deliberately DO NOT force any animation slot here — the lecture should contain at most ONE
  // animation, chosen by the model (see prompt TYPE C). Any beat the model already made an
  // animation is left untouched by this rhythm pass (handled below); every other non-blackboard
  // slot becomes an image, never a forced animation. This keeps exactly one animation per lecture.
  const rhythm = ["blackboard", "image"] as const;
  const rhythmBeats = beats
    .map((beat, i) => ({ beat, i }))
    .filter(({ beat, i }) => i >= 1 && i < lastTeachingIdx && beat.slideKind !== "checkpoint");
  rhythmBeats.forEach(({ beat }, rhythmIndex) => {
    // Preserve a model-authored animation beat as-is (repair only if broken) — this is the single
    // allowed animation; the rhythm never overwrites it or creates new ones.
    if (beatIsAnimationLed(beat)) {
      if (animationNeedsRepair(beat)) {
        beat.draw = makeAnimationBoard(beat.title, beat.script, beat.draw?.durationMs ?? 26000);
      }
      return;
    }
    const desired = rhythm[rhythmIndex % rhythm.length];
    if (desired === "blackboard") {
      if (!modelBoardIsGoodBlackboard(beat)) {
        injectChalkBoard(beat, beat.draw?.durationMs ?? 28000);
      }
      return;
    }
    // desired === "image"
    if (!beatIsImageLed(beat) || imageBeatNeedsConcreteRepair(beat)) {
      beat.draw = makeImageCalloutBoard(beat.title, beat.script, beat.draw?.durationMs ?? 26000);
    }
  });

  // EXACTLY-ONE-ANIMATION GUARANTEE.
  // (a) If the model emitted NO animation beat, convert one middle-third teaching beat into an
  //     animation placeholder so step-2 (fillReactAnimationOps) generates the single animation.
  // (b) Keep only the FIRST animation beat; convert any extras to image boards.
  // Counts the TYPE C animation slot only — a TYPE D diagram beat is a separate slot and must not
  // satisfy this quota, or a lecture with one diagram would get no generated animation at all.
  const animationCount = beats.filter(
    (b, i) =>
      i >= 1 && i < lastTeachingIdx && b.slideKind !== "checkpoint" && beatIsAnimationLed(b) &&
      !b.draw?.ops.some((op) => op.kind === "manimScene" || op.kind === "morph" || op.kind === "structureScene" || op.kind === "plotBoard" || op.kind === "equationBoard")
  ).length;
  if (animationCount === 0) {
    // Pick a beat around the middle of the teaching range to become the animation.
    const teachingIdxs = beats
      .map((b, i) => ({ b, i }))
      .filter(({ b, i }) => i >= 1 && i < lastTeachingIdx && b.slideKind !== "checkpoint")
      .map(({ i }) => i);
    if (teachingIdxs.length > 0) {
      const target = teachingIdxs[Math.floor(teachingIdxs.length / 2)];
      const beat = beats[target];
      const teachingPoint = `${beat.title}: ${(beat.script || "").split(/(?<=[.!?])\s+/)[0] ?? beat.title}`.slice(0, 240);
      beat.draw = { caption: beat.title, durationMs: beat.draw?.durationMs ?? 26000, ops: [{ kind: "reactAnimation", teachingPoint, at: 0, endAt: 1 }] };
    }
  }
  let seenAnimation = false;
  beats.forEach((beat, i) => {
    if (i < 1 || i >= lastTeachingIdx || beat.slideKind === "checkpoint") return;
    // A TYPE D diagram beat occupies its OWN slot, not the single TYPE C animation slot. It counts
    // as animation-led everywhere else (so no pass overwrites it), but it must not compete here:
    // otherwise whichever reactAnimation beat comes first wins and the diagram beat is silently
    // converted to an image board — which is exactly why manimScene never reached the player.
    if (beat.draw?.ops.some((op) => op.kind === "manimScene" || op.kind === "morph" || op.kind === "structureScene" || op.kind === "plotBoard" || op.kind === "equationBoard")) return;
    if (!beatIsAnimationLed(beat)) return;
    if (!seenAnimation) {
      seenAnimation = true; // keep the first one
    } else {
      beat.draw = makeImageCalloutBoard(beat.title, beat.script, beat.draw?.durationMs ?? 26000);
    }
  });

  // MINIMUM-BLACKBOARD SAFETY NET: now that we trust the model (and no longer force beats 1-2),
  // a lecture could in principle come back all-animation. Guarantee at least a couple of clean
  // written boards by converting the WEAKEST non-blackboard beats first (preserving the model's
  // best work). For most topics beats 1-2 already satisfy this, so the net is a no-op.
  const MIN_BLACKBOARDS = 2;
  let goodBlackboards = beats.slice(1).filter(modelBoardIsGoodBlackboard).length;
  if (goodBlackboards < MIN_BLACKBOARDS) {
    const candidates = beats
      .map((beat, i) => ({ beat, i }))
      .filter(
        ({ beat, i }) =>
          i >= 1 &&
          beat.slideKind !== "checkpoint" &&
          !modelBoardIsGoodBlackboard(beat) &&
          // A reactAnimation beat is guaranteed-useful content for the animation pipeline. Never
          // sacrifice it to this safety net, even in the degenerate case where no candidate ever
          // satisfies modelBoardIsGoodBlackboard and the loop would burn through every beat.
          !beat.draw?.ops.some((op) => op.kind === "reactAnimation" || op.kind === "manimScene" || op.kind === "morph" || op.kind === "structureScene" || op.kind === "plotBoard" || op.kind === "equationBoard")
      )
      .sort((a, b) => boardScore(a.beat) - boardScore(b.beat)); // weakest first
    for (const { beat } of candidates) {
      if (goodBlackboards >= MIN_BLACKBOARDS) break;
      injectChalkBoard(beat, beat.draw?.durationMs ?? 26000);
      if (modelBoardIsGoodBlackboard(beat)) goodBlackboards++;
    }
  }

  // FINAL SURFACE LOCK: this runs after every upgrade/safety-net pass. Earlier passes may
  // decide a topic "deserves" a board, but the user experience still needs alternation:
  // intro -> blackboard -> image -> animation -> blackboard -> image -> animation -> recap.
  beats
    .map((beat, i) => ({ beat, i }))
    .filter(({ beat, i }) => i >= 1 && i < lastTeachingIdx && beat.slideKind !== "checkpoint")
    .reduce((imageSlot, { beat }, rhythmIndex) => {
      // PRESERVE THE SINGLE ANIMATION BEAT. `rhythm` is blackboard/image only (we allow exactly one
      // animation, chosen earlier), so without this guard the lock would convert the animation beat
      // into a board/image. Leave any reactAnimation beat untouched.
      if (beat.draw?.ops.some((op) => op.kind === "reactAnimation" || op.kind === "manimScene" || op.kind === "morph" || op.kind === "structureScene" || op.kind === "plotBoard" || op.kind === "equationBoard")) {
        return imageSlot;
      }
      const desired = rhythm[rhythmIndex % rhythm.length];
      if (desired === "blackboard") {
        if (!modelBoardIsGoodBlackboard(beat)) {
          injectChalkBoard(beat, beat.draw?.durationMs ?? 28000);
        }
        return imageSlot;
      }
      if (desired === "image") {
        // Previously forced the fallback template unconditionally for the first 2 image slots
        // (useTechnicalImage = imageSlot < 2, always truthy for those beats) — that meant the
        // model's own image prompt (now diagram-aware per drawPrompt.ts TYPE B) was NEVER used
        // for most lectures. Only fall back when the model's board is actually missing/thin or
        // imageBeatNeedsConcreteRepair flags a genuine problem (now diagram-prompt-aware too).
        if (!beatIsImageLed(beat) || imageBeatNeedsConcreteRepair(beat)) {
          beat.draw = makeImageCalloutBoard(beat.title, beat.script, beat.draw?.durationMs ?? 26000, imageSlot < 2);
        }
        return imageSlot + 1;
      }
      // A reactAnimation op is already the complete, correct animation-slot board — never
      // overwrite it with the legacy scene/motion makeAnimationBoard() synthesis.
      if (!beat.draw?.ops.some((op) => op.kind === "reactAnimation" || op.kind === "manimScene" || op.kind === "morph" || op.kind === "structureScene" || op.kind === "plotBoard" || op.kind === "equationBoard")) {
        beat.draw = makeAnimationBoard(beat.title, beat.script, beat.draw?.durationMs ?? 26000);
      }
      return imageSlot;
    }, 0);

  // Keep every teaching board available for the full, deeper narration window. Playback still
  // follows the real audio clock; this only gives the marker timeline enough temporal room and
  // does not add, remove, reorder, or visually redesign any beat.
  for (const beat of beats) {
    if (beat.slideKind === "checkpoint" || !beat.draw) continue;
    const duration = beat.draw.durationMs;
    beat.draw.durationMs = typeof duration === "number" && duration >= 42000 && duration <= 60000 ? duration : 48000;
  }

  // REACT SANDBOX CAP.
  //
  // The sandbox board is the only renderer left that asks the model for absolute coordinates, and
  // it is the one that produces the boards users complain about — three labels stacked inside one
  // circle, text running off the canvas. Measured on a real lecture it took 5 of 11 beats, and
  // three separate attempts to shrink its share through the PROMPT moved it the wrong way (a quota
  // change from "4-5" to "3-4" produced 5 instead of 3). Every stubborn behaviour today only moved
  // when it was changed in code, so this is the code change.
  //
  // Excess beats become `chalkBoard` placeholders. That is a deliberate trade: a chalk board is
  // plainer, but fillBlackboardOps authors its rows server-side and LiveSketch lays them out, so it
  // renders reliably instead of gambling on coordinates the model cannot compute.
  //
  // Beats are kept in order, so the earliest (usually the overview) stay visual. Set
  // REACT_ANIMATION_BEAT_CAP=99 to restore the old unbounded behaviour.
  const sandboxCap = Math.max(0, Math.min(12, Number(process.env.REACT_ANIMATION_BEAT_CAP ?? 2)));
  let sandboxKept = 0;
  for (const beat of beats) {
    if (!beat.draw?.ops.some((op) => op.kind === "reactAnimation")) continue;
    if (sandboxKept < sandboxCap) {
      sandboxKept++;
      continue;
    }
    injectChalkBoard(beat, beat.draw.durationMs ?? 48000);
  }

  if (options.enforceDepth !== false) {
    assertLectureDepth(beats);
  }

  return beats;
}

export function scriptWordCount(text: string): number {
  return text.match(/[A-Za-z0-9]+(?:[-'][A-Za-z0-9]+)?/g)?.length ?? 0;
}

export type LectureDepthStats = {
  totalWords: number;
  teachingWords: number;
  teachingBeatCount: number;
  avgTeachingWords: number;
  shortTeachingBeatCount: number;
};

export function lectureDepthStats(beats: Beat[]): LectureDepthStats {
  const teachingBeats = beats.filter((beat) => beat.slideKind !== "checkpoint");
  const totalWords = beats.reduce((sum, beat) => sum + scriptWordCount(beat.script), 0);
  const teachingWords = teachingBeats.reduce((sum, beat) => sum + scriptWordCount(beat.script), 0);
  const avgTeachingWords = teachingBeats.length ? teachingWords / teachingBeats.length : 0;
  const shortTeachingBeats = teachingBeats.filter((beat, index) => scriptWordCount(beat.script) < (index === 0 ? 70 : 95));
  return {
    totalWords,
    teachingWords,
    teachingBeatCount: teachingBeats.length,
    avgTeachingWords,
    shortTeachingBeatCount: shortTeachingBeats.length,
  };
}

export function assertLectureDepth(beats: Beat[]): LectureDepthStats {
  const stats = lectureDepthStats(beats);
  const maxShortBeats = Math.max(1, Math.floor(stats.teachingBeatCount * 0.15));
  // Judge depth relative to the number of surviving teaching beats. Beat count is preserved;
  // each board now earns enough narration time for a layered explanation rather than a summary.
  const minTotalWords = Math.min(1250, Math.max(900, stats.teachingBeatCount * 100));

  if (stats.totalWords < minTotalWords || stats.avgTeachingWords < 100 || stats.shortTeachingBeatCount > maxShortBeats) {
    throw new Error(
      `Model returned a shallow lecture (${stats.totalWords} spoken words, ${Math.round(stats.avgTeachingWords)} words/teaching beat). Try again with deeper scripts.`
    );
  }
  return stats;
}

/** Splits a script into clean, whole sentences (trimmed, sensible length). */
function scriptSentences(script: string): string[] {
  return script
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 12);
}

const RELATION_STOP = new Set([
  "the", "a", "an", "of", "to", "and", "or", "is", "are", "be", "in", "on", "at", "as", "it",
  "its", "this", "that", "these", "those", "with", "for", "by", "we", "our", "you", "they",
  "them", "their", "when", "where", "which", "while", "will", "can", "let", "lets", "us",
]);

/** Pulls clean single-word CONCEPT terms worth writing on a board — salient nouns/keywords,
 *  title-cased, never sentence fragments. Regex phrase-grabbing produces garbage like "To this"
 *  or "Supply and", so we use ONLY the stopword-filtered keyword list (single meaningful words)
 *  plus the beat title's core term. Reliable and never embarrassing. */
function conceptTerms(title: string, script: string, max: number): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (raw: string) => {
    const clean = raw.replace(/[^a-zA-Z0-9↑↓→=+-]/g, "").trim();
    const key = clean.toLowerCase();
    if (clean.length < 4 || seen.has(key) || RELATION_STOP.has(key)) return;
    seen.add(key);
    out.push(clean.charAt(0).toUpperCase() + clean.slice(1));
  };
  // 1. The title's core single word (drop leading articles/question words).
  const titleCore = title.replace(/^(the|a|an|how|what|why|understanding|intro(duction)? to|changes? in)\s+/i, "").trim();
  const firstWord = titleCore.split(/\s+/)[0];
  if (firstWord) push(firstWord);
  // 2. Salient single keywords from title + script (already stopword-filtered).
  for (const w of keywordItems(title + " " + script)) push(w);
  return out.slice(0, max);
}

/** Greedy word-wrap to a max character width — MUST mirror LiveSketch's wrapText() so the
 *  sanitizer's height model matches what actually renders (its notes wrap at 44 chars). */
function wrapToWidth(text: string, maxChars: number): string[] {
  const words = text.replace(/\s+/g, " ").trim().split(" ");
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    if (!line) line = w;
    else if ((line + " " + w).length <= maxChars) line += " " + w;
    else {
      lines.push(line);
      line = w;
    }
  }
  if (line) lines.push(line);
  return lines;
}

type BoardRow = { sym: string; note: string; color: string };

/**
 * Cross-beat synthesis state threaded through every makeWrittenBoard call in one lecture.
 * Without it, every template-matched beat (beats 1-2, title upgrades, closing recap, variety
 * conversions) renders the SAME topicRows() output — the exact "board repeats again and again"
 * failure. usedRowFps stores normalized row-symbol fingerprints; usedDiagrams stores chalk
 * diagram kinds so the big equilibrium chart draws once and later boards get different sketches.
 */
type BoardSynthesisContext = {
  usedSyms: Set<string>;
  usedDiagrams: Set<string>;
};

function newBoardContext(): BoardSynthesisContext {
  return { usedSyms: new Set(), usedDiagrams: new Set() };
}

function normSym(text: string): string {
  return text.toLowerCase().replace(/^[•·\-\s]+/, "").replace(/\s+/g, " ").trim();
}

/** A candidate row-set is "stale" when most of its symbol chains already appeared on an
 *  earlier board this lecture — rendering it again is exactly the repetition users notice. */
function rowsAreStale(rows: BoardRow[], used: Set<string>): boolean {
  if (!rows.length) return false;
  const hits = rows.filter((r) => used.has(normSym(r.sym))).length;
  return hits >= Math.ceil(rows.length / 2);
}

function registerRows(rows: BoardRow[], used: Set<string>): void {
  for (const r of rows) used.add(normSym(r.sym));
}

/** Seeds the context with the symbols of a MODEL-authored blackboard the sanitizer kept, so a
 *  later synthesized board never re-writes chains the model already put on screen. */
function registerBlackboardOps(ops: DrawOp[], used: Set<string>): void {
  for (const op of ops) {
    if (op.kind === "label" && op.text.length > 1) used.add(normSym(op.text));
  }
}

/**
 * True when topicRows() has a HARDCODED (non-fallback) template for this topic — i.e. the
 * synthesized blackboard would be strong, domain-specific content rather than the generic
 * keyword→clause fallback. Used by sanitizeDrawLecture to decide when it's worth overriding
 * a good model board with makeWrittenBoard(). MUST stay in sync with the branch regexes in
 * topicRows() below (economics demand/supply/equilibrium/shifts, physics Newton, bio photosynthesis).
 */
function hasTemplateRows(title: string, script: string): boolean {
  const combined = (title + " " + script).toLowerCase();
  const has = (re: RegExp) => re.test(combined);
  // Economics — demand / supply / equilibrium / shifts
  if (has(/\blaw of demand\b/) || (has(/\bdemand\b/) && has(/\bprice\b/) && !has(/\bsupply\b/))) return true;
  if (has(/\blaw of supply\b/) || (has(/\bsupply\b/) && has(/\bprice\b/) && !has(/\bdemand\b/))) return true;
  if (has(/\bequilibrium\b/) || (has(/\bsupply\b/) && has(/\bdemand\b/))) return true;
  if (has(/\bshift\b/) && (has(/\bdemand\b/) || has(/\bsupply\b/))) return true;
  // Physics — Newton / force
  if (has(/\bnewton|force|acceleration|mass\b/)) return true;
  // Biology — photosynthesis / light absorption
  if (has(/\bphotosynthesis|chlorophyll|chloroplast|glucose|light absorption|absorbs? light|red and blue|wavelength|thylakoid\b/)) return true;
  return false;
}

/**
 * Authors topic-aware cause→effect symbol rows for the blackboard.
 * sym  = chalk symbol on the LEFT  (short, uses ↑↓→ symbols)
 * note = explanation on the RIGHT  (short enough for 1-2 chalk lines, NOT narration)
 * color = chalk color for this row
 *
 * `variant` picks between two genuinely different row-sets per hardcoded template branch, so
 * two boards on the same topic in one lecture never write the same chains twice (variant 1 is
 * chosen by makeWrittenBoard when variant 0's symbols already appeared on an earlier board).
 */
function topicRows(title: string, script: string, variant: 0 | 1 = 0): BoardRow[] {
  const combined = (title + " " + script).toLowerCase();
  const titleText = title.toLowerCase();
  const C = COLOR_MAP;
  const demandTitle = /\bdemand\b/.test(titleText) && !/\bsupply\b/.test(titleText);
  const supplyTitle = /\bsupply\b/.test(titleText) && !/\bdemand\b/.test(titleText);
  const shiftTitle = /\bshift/.test(titleText);
  // Economics — demand
  if (/\blaw of demand\b/.test(titleText) || (demandTitle && !shiftTitle && /\bprice\b/.test(combined)) || (!supplyTitle && /\bdemand\b/.test(combined) && /\bprice\b/.test(combined) && !/\bsupply\b/.test(combined))) {
    return variant === 1 ? [
      { sym: "WTP ladder",       note: "buyers line up by value", color: C.amber },
      { sym: "Price ↑ → exit",  note: "low-value buyers leave first",  color: C.rose },
      { sym: "Price ↓ → entry", note: "new buyers enter the market", color: C.green },
      { sym: "Move ≠ shift",    note: "price moves along one curve", color: C.blue },
    ] : [
      { sym: "Price ↓",      note: "lower price brings buyers in", color: C.rose },
      { sym: "→ Q_d ↑",     note: "quantity demanded rises along the same curve",     color: C.rose },
      { sym: "Price ↑",      note: "higher price screens out lower-value buyers", color: C.blue },
      { sym: "→ Q_d ↓",     note: "fewer units are worth buying at that price",    color: C.blue },
    ];
  }
  // Economics — supply
  if (/\blaw of supply\b/.test(titleText) || (supplyTitle && !shiftTitle && /\bprice\b/.test(combined)) || (!demandTitle && /\bsupply\b/.test(combined) && /\bprice\b/.test(combined) && !/\bdemand\b/.test(combined))) {
    return variant === 1 ? [
      { sym: "Unit cost ↑",       note: "extra units cost more to make", color: C.rose },
      { sym: "P > cost → sell",  note: "profitable units get produced", color: C.green },
      { sym: "P < cost → stop",  note: "loss-making units stay unsold", color: C.blue },
      { sym: "Profit = signal",   note: "price guides producer effort", color: C.amber },
    ] : [
      { sym: "Price ↑",      note: "higher price rewards output", color: C.blue },
      { sym: "→ Q_s ↑",     note: "firms offer more units along the same curve",       color: C.blue },
      { sym: "Price ↓",      note: "lower price cuts the reward for producing",     color: C.rose },
      { sym: "→ Q_s ↓",     note: "less output is offered",       color: C.rose },
    ];
  }
  // Economics — equilibrium / market
  if (/\bequilibrium\b/.test(combined) || (/\bsupply\b/.test(combined) && /\bdemand\b/.test(combined))) {
    return variant === 1 ? [
      { sym: "P > P* → surplus",  note: "unsold stock pushes price down", color: C.rose },
      { sym: "P < P* → shortage", note: "scarcity pulls price upward", color: C.blue },
      { sym: "Both push → P*",    note: "pressure returns to the crossing", color: C.amber },
      { sym: "Nobody sets P*",    note: "the market discovers the price", color: C.green },
    ] : [
      { sym: "S ∩ D",        note: "buyer plans and seller plans meet here", color: C.amber },
      { sym: "P* clears",    note: "market clears when quantity plans match", color: C.amber },
      { sym: "P > P*",       note: "surplus gives sellers pressure to cut price",   color: C.rose },
      { sym: "P < P*",       note: "shortage lets sellers raise price over time",     color: C.blue },
    ];
  }
  // Economics — shifts in demand/supply
  if (/\bshift\b/.test(combined) && /\bdemand\b/.test(combined)) {
    return variant === 1 ? [
      { sym: "D → right",      note: "every price now maps to a bigger quantity", color: C.green },
      { sym: "D → left",       note: "every price now maps to a smaller quantity", color: C.rose },
      { sym: "New P*, new Q*", note: "the market finds a new crossing", color: C.amber },
      { sym: "Cause ≠ price",  note: "income and tastes shift the curve", color: C.violet },
    ] : [
      { sym: "Income ↑",     note: "normal-good demand shifts right", color: C.green },
      { sym: "Tastes →",     note: "preferences move the whole curve",      color: C.violet },
      { sym: "Substitute ↑", note: "better alternatives can pull demand away",             color: C.rose },
      { sym: "Complement ↑", note: "paired goods rise or fall together in demand",     color: C.blue },
    ];
  }
  if (/\bshift\b/.test(combined) && /\bsupply\b/.test(combined)) {
    return variant === 1 ? [
      { sym: "S → right",     note: "cheaper inputs raise supply", color: C.green },
      { sym: "S → left",      note: "higher costs cut supply", color: C.rose },
      { sym: "New crossing",  note: "equilibrium moves to a new spot", color: C.amber },
      { sym: "P = messenger", note: "price reacts after the shift", color: C.blue },
    ] : [
      { sym: "Cost ↓",       note: "supply shifts right",        color: C.green },
      { sym: "Tech ↑",       note: "better methods create more output per input",      color: C.blue },
      { sym: "Tax ↑",        note: "taxes raise cost and shift supply left",         color: C.rose },
      { sym: "Input ↑",      note: "higher input prices reduce profitable supply", color: C.violet },
    ];
  }
  // Physics — Newton / force
  if (/\bnewton|force|acceleration|mass\b/.test(combined)) {
    return variant === 1 ? [
      { sym: "a = F/m",          note: "the same force moves a lighter object faster", color: C.amber },
      { sym: "F_net = 0",        note: "balanced forces keep velocity steady", color: C.blue },
      { sym: "Action ↔ reaction", note: "every push gets an equal push straight back", color: C.green },
      { sym: "1N = kg·m/s²",     note: "one newton accelerates one kilogram", color: C.rose },
    ] : [
      { sym: "F = ma",       note: "force equals mass times acceleration",  color: C.amber },
      { sym: "F ↑",          note: "more push creates more acceleration",    color: C.blue },
      { sym: "m ↑",          note: "more mass needs more force to change motion",  color: C.rose },
      { sym: "a ↑",          note: "acceleration means velocity changes faster",   color: C.green },
    ];
  }
  // Biology — light absorption / photosynthesis
  if (/\blight absorption|absorbs? light|chlorophyll|red and blue|wavelength|thylakoid\b/.test(combined)) {
    return variant === 1 ? [
      { sym: "Red + blue",     note: "chlorophyll absorbs these wavelengths best", color: C.rose },
      { sym: "Green ↩",        note: "green light reflects back to our eyes", color: C.green },
      { sym: "e⁻ excited",     note: "absorbed light raises electron energy", color: C.amber },
      { sym: "ATP + NADPH",    note: "energy carriers power sugar building", color: C.blue },
    ] : [
      { sym: "Sunlight → leaf", note: "photons strike the leaf surface", color: C.amber },
      { sym: "Chlorophyll",     note: "pigment traps useful light energy", color: C.green },
      { sym: "Red/blue in",     note: "strongest absorption happens here", color: C.rose },
      { sym: "Energy stored",   note: "light energy starts photosynthesis", color: C.blue },
    ];
  }
  if (/\bphotosynthesis|chloroplast|glucose\b/.test(combined)) {
    return variant === 1 ? [
      { sym: "Light stage",   note: "chlorophyll captures light", color: C.amber },
      { sym: "Calvin cycle",  note: "stored energy stitches CO₂ into sugar rings", color: C.green },
      { sym: "Stomata",       note: "leaf pores let CO₂ in and O₂ back out", color: C.blue },
      { sym: "Chloroplast",   note: "the sugar factory organelle", color: C.rose },
    ] : [
      { sym: "6CO₂ + 6H₂O", note: "reactants enter the leaf from air and roots",   color: C.blue },
      { sym: "+ light →",    note: "sunlight powers bond changes",    color: C.amber },
      { sym: "C₆H₁₂O₆",    note: "glucose stores the captured energy as food",    color: C.green },
      { sym: "+ 6O₂",        note: "oxygen leaves as the useful by-product",    color: C.rose },
    ];
  }
  return scriptDerivedRows(title, script);
}

function explicitTitleRows(title: string, variant: 0 | 1 = 0): BoardRow[] | null {
  const t = title.toLowerCase();
  const C = COLOR_MAP;
  if (/\babsorption spectrum|color\b/.test(t)) {
    return variant === 1 ? [
      { sym: "Blue peak",   note: "short wavelengths are absorbed strongly", color: C.blue },
      { sym: "Red peak",    note: "red light also drives the light reactions", color: C.rose },
      { sym: "Green valley", note: "green is absorbed weakly", color: C.green },
      { sym: "Leaf color",  note: "reflected green reaches your eyes", color: C.amber },
    ] : [
      { sym: "Spectrum",    note: "absorption changes with wavelength", color: C.amber },
      { sym: "Red + blue",  note: "chlorophyll captures these colors best", color: C.rose },
      { sym: "Green ↩",     note: "green light is mostly reflected", color: C.green },
      { sym: "More absorbed", note: "more captured light means more energy", color: C.blue },
    ];
  }
  if (/\bchloroplast|thylakoid\b/.test(t)) {
    return variant === 1 ? [
      { sym: "Thylakoids",  note: "stacked membranes hold chlorophyll", color: C.green },
      { sym: "Light hits",  note: "photons arrive at the membrane", color: C.amber },
      { sym: "Carriers fill", note: "ATP and NADPH store usable energy", color: C.blue },
      { sym: "Stroma",      note: "sugar building happens nearby", color: C.rose },
    ] : [
      { sym: "Chloroplast", note: "organelle where photosynthesis runs", color: C.green },
      { sym: "Chlorophyll", note: "pigment embedded in membranes", color: C.amber },
      { sym: "Light reactions", note: "capture energy before sugar is made", color: C.blue },
      { sym: "Glucose later", note: "stored energy feeds carbon fixing", color: C.rose },
    ];
  }
  if (/\blight reactions?|energy moves?|energy flow\b/.test(t)) {
    return variant === 1 ? [
      { sym: "Photon",      note: "a packet of light reaches chlorophyll", color: C.amber },
      { sym: "e⁻ jump",     note: "the electron moves to a higher energy state", color: C.blue },
      { sym: "Chain flow",  note: "energy passes through carriers", color: C.green },
      { sym: "ATP made",    note: "the cell stores energy for the next step", color: C.rose },
    ] : [
      { sym: "Light in",    note: "absorbed light starts the reaction", color: C.amber },
      { sym: "e⁻ excited",  note: "chlorophyll electrons gain energy", color: C.blue },
      { sym: "Energy → carriers", note: "ATP and NADPH collect the energy", color: C.green },
      { sym: "Sugar step",  note: "carriers power glucose building later", color: C.rose },
    ];
  }
  if (/\bglucose|sugar|from light to sugar\b/.test(t)) {
    return variant === 1 ? [
      { sym: "ATP",         note: "supplies quick cellular energy", color: C.amber },
      { sym: "NADPH",       note: "carries high-energy electrons", color: C.blue },
      { sym: "CO₂ fixed",   note: "carbon atoms are built into sugar", color: C.green },
      { sym: "Glucose",     note: "chemical bonds store captured light", color: C.rose },
    ] : [
      { sym: "Light energy", note: "starts as absorbed photons", color: C.amber },
      { sym: "Carriers",     note: "ATP and NADPH move energy forward", color: C.blue },
      { sym: "Carbon joins", note: "CO₂ becomes part of the sugar chain", color: C.green },
      { sym: "Stored sugar", note: "glucose keeps energy in chemical bonds", color: C.rose },
    ];
  }
  if (/\blight absorption|absorbs? light|chlorophyll|red and blue|wavelength|thylakoid\b/.test(t)) {
    return variant === 1 ? [
      { sym: "Red + blue",  note: "chlorophyll absorbs these wavelengths best", color: C.rose },
      { sym: "Green ↩",     note: "green light reflects back to our eyes", color: C.green },
      { sym: "e⁻ excited",  note: "absorbed light raises electron energy", color: C.amber },
      { sym: "ATP + NADPH", note: "energy carriers power sugar building", color: C.blue },
    ] : [
      { sym: "Sunlight → leaf", note: "photons strike the leaf surface", color: C.amber },
      { sym: "Chlorophyll",     note: "pigment traps useful light energy", color: C.green },
      { sym: "Red/blue in",     note: "strongest absorption happens here", color: C.rose },
      { sym: "Energy stored",   note: "light energy starts photosynthesis", color: C.blue },
    ];
  }
  if (/\blaw of demand\b/.test(t)) {
    return variant === 1 ? [
      { sym: "WTP ladder",       note: "buyers line up by value", color: C.amber },
      { sym: "Price ↑ → exit",  note: "low-value buyers leave first", color: C.rose },
      { sym: "Price ↓ → entry", note: "new buyers enter the market", color: C.green },
      { sym: "Move ≠ shift",    note: "price moves along one curve", color: C.blue },
    ] : [
      { sym: "Price ↓",      note: "lower price brings buyers in", color: C.rose },
      { sym: "→ Q_d ↑",     note: "quantity demanded rises", color: C.rose },
      { sym: "Price ↑",      note: "higher price screens buyers", color: C.blue },
      { sym: "→ Q_d ↓",     note: "fewer units are worth buying", color: C.blue },
    ];
  }
  if (/\blaw of supply\b/.test(t)) {
    return variant === 1 ? [
      { sym: "Unit cost ↑",      note: "extra units cost more to make", color: C.rose },
      { sym: "P > cost → sell", note: "profitable units get produced", color: C.green },
      { sym: "P < cost → stop", note: "loss-making units stay unsold", color: C.blue },
      { sym: "Profit = signal", note: "price guides producer effort", color: C.amber },
    ] : [
      { sym: "Price ↑",      note: "higher price rewards output", color: C.blue },
      { sym: "→ Q_s ↑",     note: "firms offer more units", color: C.blue },
      { sym: "Price ↓",      note: "lower price cuts reward", color: C.rose },
      { sym: "→ Q_s ↓",     note: "less output is offered", color: C.rose },
    ];
  }
  if (/\bshift/.test(t) && /\bdemand\b/.test(t)) {
    return variant === 1 ? [
      { sym: "D → right",      note: "quantity rises at every price", color: C.green },
      { sym: "D → left",       note: "quantity falls at every price", color: C.rose },
      { sym: "New P*, new Q*", note: "the market finds a new crossing", color: C.amber },
      { sym: "Cause ≠ price",  note: "income and tastes shift the curve", color: C.violet },
    ] : [
      { sym: "Income ↑",     note: "normal-good demand shifts right", color: C.green },
      { sym: "Tastes →",     note: "preferences move the whole curve", color: C.violet },
      { sym: "Substitute ↑", note: "better alternatives pull demand away", color: C.rose },
      { sym: "Complement ↑", note: "paired goods move together", color: C.blue },
    ];
  }
  if (/\bshift/.test(t) && /\bsupply\b/.test(t)) {
    return variant === 1 ? [
      { sym: "S → right",     note: "cheaper inputs raise supply", color: C.green },
      { sym: "S → left",      note: "higher costs cut supply", color: C.rose },
      { sym: "New crossing",  note: "equilibrium moves to a new spot", color: C.amber },
      { sym: "P = messenger", note: "price reacts after the shift", color: C.blue },
    ] : [
      { sym: "Cost ↓",       note: "supply shifts right", color: C.green },
      { sym: "Tech ↑",       note: "more output per input", color: C.blue },
      { sym: "Tax ↑",        note: "supply shifts left", color: C.rose },
      { sym: "Input ↑",      note: "higher costs reduce supply", color: C.violet },
    ];
  }
  if (/\bsupply\b/.test(t)) {
    return variant === 1 ? [
      { sym: "Inputs",      note: "materials and labor set capacity", color: C.blue },
      { sym: "Costs ↑",     note: "higher costs reduce supply", color: C.rose },
      { sym: "Price ↑",     note: "higher reward brings more output", color: C.green },
      { sym: "S curve",     note: "shows quantity sellers offer", color: C.amber },
    ] : [
      { sym: "Flour + labor", note: "inputs decide what can be made", color: C.blue },
      { sym: "Ovens + time",  note: "capacity limits total output", color: C.violet },
      { sym: "Price signal",  note: "higher price encourages supply", color: C.green },
      { sym: "Costs rise",    note: "supply falls at each price", color: C.rose },
    ];
  }
  if (/\bdemand\b/.test(t)) {
    return variant === 1 ? [
      { sym: "Need + want", note: "buyers value the good", color: C.rose },
      { sym: "Price ↓",    note: "more buyers enter", color: C.green },
      { sym: "Price ↑",    note: "some buyers step back", color: C.blue },
      { sym: "D curve",    note: "shows quantity buyers want", color: C.amber },
    ] : [
      { sym: "Buyers",    note: "people compare price to value", color: C.rose },
      { sym: "Low price", note: "purchase feels easier to justify", color: C.green },
      { sym: "High price", note: "substitutes look more attractive", color: C.blue },
      { sym: "Q_d",       note: "quantity demanded responds", color: C.amber },
    ];
  }
  return null;
}

/**
 * Topic-agnostic row synthesis: pair each salient keyword with a SHORT, DISTINCT phrase from
 * the script that actually mentions it. This avoids the old failures — mid-sentence "..." cuts,
 * the title echoing into every note, and identical notes repeated across rows. Runs when no
 * hardcoded template matches, AND as the final dedup fallback when both template variants have
 * already been written on earlier boards (different beats have different scripts, so the rows
 * naturally diverge per beat).
 */
function scriptDerivedRows(title: string, script: string): BoardRow[] {
  const C = COLOR_MAP;
  const fallbackColors = [C.amber, C.blue, C.rose, C.green];
  const sentences = scriptSentences(script)
    .map((sentence) => cleanBoardPhrase(sentence, ""))
    .filter((sentence) => sentence.length >= 12 && !looksLikeFragment(sentence));
  const usedSyms = new Set<string>();
  const rows = sentences.slice(0, 6).flatMap((sentence, i) => {
    const sym = sentenceSymbol(title, sentence, i);
    const key = normSym(sym);
    if (usedSyms.has(key)) return [];
    usedSyms.add(key);
    const note = sentenceNote(sentence);
    return [{ sym, note, color: fallbackColors[i % fallbackColors.length] }];
  }).slice(0, 4);
  if (rows.length >= 3) return rows;

  const keywords = conceptTerms(title, script, 4);
  return keywords.slice(0, 4).map((kw, i) => ({
    sym: `• ${shortenAtWord(kw, 14)}`,
    note: sentenceNote(sentences[i] ?? kw),
    color: fallbackColors[i % fallbackColors.length],
  }));
}

function sentenceSymbol(title: string, sentence: string, index: number): string {
  const combined = `${title} ${sentence}`.toLowerCase();
  const s = sentence.toLowerCase();
  if (/\bred\b/.test(s) && /\bblue\b/.test(s)) return "Red + blue";
  if (/\bchlorophyll\b/.test(s)) return "Chlorophyll";
  if (/\bwavelength\b|\babsorb/.test(s) && /\blight\b/.test(combined)) return "Absorption";
  if (/\bgreen\b/.test(s) && /\breflect/.test(s)) return "Green ↩";
  if (/\bphotosynthesis\b/.test(s)) return "Photosynthesis";
  if (/\bsunlight\b|\bphoton/.test(s)) return "Sunlight";
  if (/\bglucose\b|\bsugar\b/.test(s)) return "Glucose";
  if (/\blower costs?\b|\bcosts? (fall|drop|decrease)\b/.test(s)) return "Costs ↓";
  if (/\bhigher costs?\b|\bcosts? (rise|increase)\b|\btax/.test(s)) return "Costs ↑";
  if (/\bprice rises?\b|\bhigher price\b|\bprice is higher\b/.test(s)) return "Price ↑";
  if (/\bprice falls?\b|\blower price\b|\bprice is lower\b/.test(s)) return "Price ↓";
  if (/\btechnology\b|\btech\b|\beasier\b/.test(s)) return "Tech ↑";
  if (/\binput\b|\bflour\b|\blabor\b|\bmaterial/.test(s)) return "Inputs";
  if (/\bcapacity\b|\boven\b|\btime\b/.test(s)) return "Capacity";
  if (/\bdemand\b/.test(s)) return "Demand";
  if (/\bsupply\b/.test(s)) return "Supply";
  if (/\bresult\b|\btherefore\b|\bso\b/.test(s)) return "Result";
  const terms = conceptTerms(title, sentence, 1);
  return terms[0] ? `• ${shortenAtWord(terms[0], 14)}` : `Step ${index + 1}`;
}

function sentenceNote(sentence: string): string {
  return shortenAtWord(
    sentence
      .replace(/^(this means|that means|notice how|watch how|remember that)\s+/i, "")
      .replace(/\s+/g, " ")
      .trim(),
    62
  );
}

function cleanBoardPhrase(raw: string, fallback: string): string {
  const clean = raw
    .replace(/\s+/g, " ")
    .replace(/^[,.;:!?–—\s]+/, "")
    .replace(/^(so|now|then|and|but|because|which|where|when|while|that|this|these|those|here|there|let'?s|we|you|the|a|an|of)\s+/i, "")
    .replace(/[.?!,;:–—\s]+$/, "")
    .trim();
  const source = clean || fallback;
  return shortenAtWord(source, 62);
}

function looksLikeFragment(text: string): boolean {
  const t = text.trim().toLowerCase();
  if (!t) return true;
  if (/\.\.\.$/.test(t)) return true;
  if (/^(and|but|because|which|where|when|while|that|this|these|those|of|to|for|with)\b/.test(t)) return true;
  if (/\b(and|or|to|of|with|because|which|when|while|so)$/i.test(t)) return true;
  const words = t.match(/[a-z0-9]+/g)?.length ?? 0;
  return words < 2 && !/[↑↓→=+*]/.test(t);
}

function shortenAtWord(text: string, max: number) {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  const clipped = clean.slice(0, max + 1);
  const lastSpace = clipped.lastIndexOf(" ");
  const minUsefulWordBreak = Math.max(4, Math.floor(max * 0.55));
  return clipped.slice(0, lastSpace >= minUsefulWordBreak ? lastSpace : max).replace(/[,.!?;:–—-]+$/, "").trim();
}

function boardTitle(title: string): string {
  const clean = title.replace(/\s+/g, " ").trim();
  const t = clean.toLowerCase();
  if (/\brecap\b/.test(t)) return "Recap";
  if (/\blight absorption|absorbs? light\b/.test(t)) return "Light Absorption";
  if (/\bchlorophyll\b/.test(t)) return "Chlorophyll";
  if (/\bphotosynthesis\b/.test(t)) return "Photosynthesis";
  if (/\blaw of demand\b/.test(t)) return "Law of Demand";
  if (/\blaw of supply\b/.test(t)) return "Law of Supply";
  if (/\bshift/.test(t) && /\bdemand\b/.test(t)) return "Demand Shift";
  if (/\bshift/.test(t) && /\bsupply\b/.test(t)) return "Supply Shift";
  if (/\bsupply\b/.test(t) && /\bbehind|stall|producer|seller|bakery|cost|output|offer\b/.test(t)) return "Supply Setup";
  if (/\bdemand\b/.test(t) && /\bbuyer|value|price|market|want\b/.test(t)) return "Demand Setup";
  return shortenAtWord(clean, 22);
}

/**
 * Builds a hand-drawn chalk diagram from label+arrow ops only (stays within blackboard
 * grammar — no scene op, so isWrittenBlackboard() keeps classifying the beat as a blackboard).
 *
 * Two modes:
 *  - LARGE equilibrium diagram (when the topic has BOTH supply and demand): a proper
 *    two-curve supply/demand chart with axes, a rising S curve, a falling D curve, and an
 *    equilibrium dot at the crossing — the chalk equivalent of LiveSketch's GraphScene.
 *    Occupies a big centered/lower region.
 *  - SMALL corner sketch (single curve, cycle, rise, or fall): mini axes + one curve, or a
 *    loop / up-arrow / down-arrow, tucked into the given region.
 *
 * `region` is the box the diagram may occupy (0-100 grid). Returns [] when the topic has no
 * spatial relationship to draw or the region is too small.
 */
function buildChalkDiagram(
  combined: string,
  region: { x0: number; y0: number; x1: number; y1: number },
  startAt: number,
  used?: Set<string>,
  forceLarge = false,
): DrawOp[] {
  const isDemand = /\bdemand\b/.test(combined);
  const isSupply = /\bsupply\b/.test(combined);
  const hasCurve =
    /\b(curve|supply|demand|slope|upward|downward)\b/.test(combined) ||
    ((isDemand || isSupply) && /\b(price|quantity|buyers?|sellers?|costs?|offered|market)\b/.test(combined));
  const hasCycle = /\b(cycle|loop|circular|feedback)\b/.test(combined);
  const hasCompare = /\b(vs\.?|versus|compare|comparison|more than|less than|bigger|smaller|trade-?off|two sides|both sides)\b/.test(combined);
  const hasBalance = /\b(equilibrium|balance|balanced|equal|offset|cancel)\b/.test(combined);
  const hasSteps = /\b(steps?|stages?|phases?|process|sequence|first|then|finally)\b/.test(combined);
  const hasFork = /\b(either|choice|choose|decision|branch|options?|alternatives?)\b/.test(combined);
  const hasRise  = /\b(rise|increase|grow|higher|surge)\b/.test(combined) && !hasCurve;
  const hasFall  = /\b(fall|decrease|decline|drop|lower)\b/.test(combined) && !hasCurve && !hasRise;

  const w = region.x1 - region.x0;
  const h = region.y1 - region.y0;
  if (w < 16 || h < 14) return [];

  const ops: DrawOp[] = [];
  const DC = COLOR_MAP.slate;
  const a = startAt;

  // Each sketch kind draws at most once per lecture (when `used` is threaded through), so
  // consecutive boards on one topic get DIFFERENT corner diagrams instead of the same one.
  const canUse = (kind: string) => !used?.has(kind);
  const take = (kind: string) => used?.add(kind);

  // ── LARGE two-curve equilibrium diagram ─────────────────────────────────
  if (isSupply && isDemand && hasCurve && (forceLarge || canUse("graph-large"))) {
    take("graph-large");
    const oy = region.y0; // origin top
    const by = region.y1; // baseline (x-axis)
    const ax = region.x0 + w * 0.14; // vertical axis x
    const rx = region.x1 - w * 0.06; // right edge of plot
    const midX = ax + (rx - ax) * 0.5;
    const midY = oy + h * 0.5;
    // Axes (draw first)
    ops.push({ kind: "arrow", x1: ax, y1: by, x2: ax, y2: oy + 1, color: DC, at: a });
    ops.push({ kind: "arrow", x1: ax, y1: by, x2: rx + 2, y2: by, color: DC, at: a + 0.02 });
    ops.push({ kind: "label", text: "P", x: ax - 3, y: oy - 1, size: "sm", color: DC, at: a + 0.03 });
    ops.push({ kind: "label", text: "Q", x: Math.min(92, rx + 4), y: Math.min(92, by + 3), size: "sm", color: DC, at: a + 0.04 });
    // Demand (falling, rose): top-left → bottom-right through the crossing
    ops.push({ kind: "arrow", x1: ax + 3, y1: oy + 3, x2: midX, y2: midY, color: COLOR_MAP.rose, at: a + 0.06 });
    ops.push({ kind: "arrow", x1: midX, y1: midY, x2: rx - 2, y2: by - 3, color: COLOR_MAP.rose, at: a + 0.09 });
    ops.push({ kind: "label", text: "D", x: rx, y: by - 4, size: "sm", color: COLOR_MAP.rose, at: a + 0.11 });
    // Supply (rising, blue): bottom-left → top-right through the crossing
    ops.push({ kind: "arrow", x1: ax + 3, y1: by - 3, x2: midX, y2: midY, color: COLOR_MAP.blue, at: a + 0.13 });
    ops.push({ kind: "arrow", x1: midX, y1: midY, x2: rx - 2, y2: oy + 3, color: COLOR_MAP.blue, at: a + 0.16 });
    ops.push({ kind: "label", text: "S", x: rx, y: oy + 4, size: "sm", color: COLOR_MAP.blue, at: a + 0.18 });
    // Equilibrium dot + guide labels
    ops.push({ kind: "label", text: "•", x: midX, y: midY, size: "md", color: COLOR_MAP.amber, at: a + 0.20 });
    ops.push({ kind: "label", text: "P*", x: ax - 4, y: midY, size: "sm", color: COLOR_MAP.amber, at: a + 0.22 });
    ops.push({ kind: "label", text: "Q*", x: midX, y: Math.min(92, by + 3), size: "sm", color: COLOR_MAP.amber, at: a + 0.24 });
    return ops;
  }

  // ── SMALL corner sketches ────────────────────────────────────────────────
  const axisX = region.x0 + w * 0.12;
  const axisY = region.y1;
  const topY = region.y0;
  const midY = region.y0 + h * 0.5;
  if (isPhotosynthesisText(combined) && canUse("photo-flow")) {
    take("photo-flow");
    const sunX = region.x0 + w * 0.16;
    const leafX = region.x0 + w * 0.52;
    const energyX = region.x0 + w * 0.84;
    ops.push({ kind: "label", text: "☼", x: sunX, y: topY + h * 0.28, size: "md", color: COLOR_MAP.amber, at: a });
    ops.push({ kind: "arrow", x1: sunX + w * 0.1, y1: topY + h * 0.32, x2: leafX - w * 0.12, y2: midY, color: COLOR_MAP.amber, at: a + 0.04 });
    ops.push({ kind: "label", text: "leaf", x: leafX, y: midY, size: "sm", color: COLOR_MAP.green, at: a + 0.08 });
    ops.push({ kind: "arrow", x1: leafX + w * 0.12, y1: midY, x2: energyX - w * 0.1, y2: topY + h * 0.32, color: COLOR_MAP.blue, at: a + 0.12 });
    ops.push({ kind: "label", text: "ATP", x: energyX, y: topY + h * 0.32, size: "sm", color: COLOR_MAP.blue, at: a + 0.16 });
    return ops;
  }
  if (hasCurve && canUse("curve")) {
    take("curve");
    ops.push({ kind: "arrow", x1: axisX, y1: axisY, x2: axisX, y2: topY + 1, color: DC, at: a });
    ops.push({ kind: "arrow", x1: axisX, y1: axisY, x2: region.x1, y2: axisY, color: DC, at: a + 0.02 });
    ops.push({ kind: "label", text: "P", x: axisX - 2, y: topY - 2, size: "sm", color: DC, at: a + 0.03 });
    ops.push({ kind: "label", text: "Q", x: Math.min(92, region.x1 + 1), y: Math.min(92, axisY + 3), size: "sm", color: DC, at: a + 0.04 });
    const rightX = region.x1 - w * 0.18;
    if (isDemand && !isSupply) {
      ops.push({ kind: "arrow", x1: axisX + 3, y1: topY + 3, x2: (axisX + rightX) / 2, y2: midY, color: COLOR_MAP.rose, at: a + 0.06 });
      ops.push({ kind: "arrow", x1: (axisX + rightX) / 2, y1: midY, x2: rightX, y2: axisY - 2, color: COLOR_MAP.rose, at: a + 0.08 });
      ops.push({ kind: "label", text: "D ↘", x: rightX + 3, y: axisY - 1, size: "sm", color: COLOR_MAP.rose, at: a + 0.10 });
    } else {
      ops.push({ kind: "arrow", x1: axisX + 3, y1: axisY - 3, x2: (axisX + rightX) / 2, y2: midY, color: COLOR_MAP.blue, at: a + 0.06 });
      ops.push({ kind: "arrow", x1: (axisX + rightX) / 2, y1: midY, x2: rightX, y2: topY + 3, color: COLOR_MAP.blue, at: a + 0.08 });
      ops.push({ kind: "label", text: "S ↗", x: rightX + 3, y: topY + 2, size: "sm", color: COLOR_MAP.blue, at: a + 0.10 });
    }
    return ops;
  }
  if (hasBalance && canUse("balance")) {
    take("balance");
    // Balance scale: tilted beam over a pivot — two forces meeting at one point.
    const cx = region.x0 + w * 0.5; const cy = midY + h * 0.1;
    ops.push({ kind: "arrow", x1: cx, y1: axisY, x2: cx, y2: cy + 2, color: DC, at: a });
    ops.push({ kind: "arrow", x1: cx - w * 0.38, y1: cy + 2.5, x2: cx + w * 0.38, y2: cy - 2.5, color: COLOR_MAP.amber, at: a + 0.04 });
    ops.push({ kind: "label", text: "▲", x: cx, y: cy + 4, size: "sm", color: DC, at: a + 0.07 });
    ops.push({ kind: "label", text: "⇄ balance", x: cx, y: Math.min(92, axisY + 3), size: "sm", color: COLOR_MAP.amber, at: a + 0.10 });
    return ops;
  }
  if (hasCompare && canUse("bars")) {
    take("bars");
    // Two chalk bars of different heights on a shared baseline — the "which is bigger" sketch.
    const leftX = region.x0 + w * 0.32;
    const rightX = region.x0 + w * 0.68;
    ops.push({ kind: "arrow", x1: region.x0 + w * 0.1, y1: axisY, x2: region.x1 - w * 0.05, y2: axisY, color: DC, at: a });
    ops.push({ kind: "arrow", x1: leftX, y1: axisY, x2: leftX, y2: topY + h * 0.45, color: COLOR_MAP.rose, at: a + 0.04 });
    ops.push({ kind: "arrow", x1: rightX, y1: axisY, x2: rightX, y2: topY + h * 0.08, color: COLOR_MAP.green, at: a + 0.08 });
    ops.push({ kind: "label", text: "less", x: leftX, y: topY + h * 0.45 - 3, size: "sm", color: COLOR_MAP.rose, at: a + 0.11 });
    ops.push({ kind: "label", text: "more", x: rightX, y: topY + h * 0.08 - 3, size: "sm", color: COLOR_MAP.green, at: a + 0.14 });
    return ops;
  }
  if (hasSteps && !hasCurve && canUse("stairs")) {
    take("stairs");
    // Staircase: alternating right/up arrows climbing the corner — "one stage at a time".
    const sw = w * 0.26; const sh = h * 0.26;
    let sx = region.x0 + w * 0.08; let sy = axisY - 2;
    for (let i = 0; i < 3; i++) {
      ops.push({ kind: "arrow", x1: sx, y1: sy, x2: sx + sw, y2: sy, color: COLOR_MAP.blue, at: a + i * 0.06 });
      ops.push({ kind: "arrow", x1: sx + sw, y1: sy, x2: sx + sw, y2: sy - sh, color: COLOR_MAP.blue, at: a + i * 0.06 + 0.03 });
      sx += sw; sy -= sh;
    }
    ops.push({ kind: "label", text: "step by step", x: region.x0 + w * 0.4, y: Math.min(92, axisY + 3), size: "sm", color: COLOR_MAP.blue, at: a + 0.2 });
    return ops;
  }
  if (hasFork && canUse("fork")) {
    take("fork");
    // Branching fork: one path splitting into two — an either/or decision point.
    const splitX = region.x0 + w * 0.45; const cy = midY;
    ops.push({ kind: "arrow", x1: region.x0 + w * 0.05, y1: cy, x2: splitX, y2: cy, color: DC, at: a });
    ops.push({ kind: "arrow", x1: splitX, y1: cy, x2: region.x1 - w * 0.08, y2: topY + h * 0.15, color: COLOR_MAP.green, at: a + 0.05 });
    ops.push({ kind: "arrow", x1: splitX, y1: cy, x2: region.x1 - w * 0.08, y2: axisY - h * 0.15, color: COLOR_MAP.rose, at: a + 0.09 });
    ops.push({ kind: "label", text: "?", x: splitX, y: cy - 4, size: "sm", color: COLOR_MAP.amber, at: a + 0.12 });
    return ops;
  }
  if (hasCycle && canUse("cycle")) {
    take("cycle");
    const cx = region.x0 + w * 0.5; const cy = midY;
    ops.push({ kind: "label", text: "cycle", x: cx, y: cy, size: "sm", color: DC, at: a });
    ops.push({ kind: "arrow", x1: cx, y1: cy - 9, x2: cx + 8, y2: cy - 4, color: DC, at: a + 0.04 });
    ops.push({ kind: "arrow", x1: cx + 8, y1: cy + 2, x2: cx + 2, y2: cy + 8, color: DC, at: a + 0.07 });
    ops.push({ kind: "arrow", x1: cx - 4, y1: cy + 8, x2: cx - 8, y2: cy + 2, color: DC, at: a + 0.10 });
    ops.push({ kind: "arrow", x1: cx - 8, y1: cy - 4, x2: cx - 2, y2: cy - 9, color: DC, at: a + 0.13 });
    return ops;
  }
  if (hasRise && canUse("rise")) {
    take("rise");
    const cx = region.x0 + w * 0.5;
    ops.push({ kind: "arrow", x1: cx, y1: axisY, x2: cx, y2: topY + 3, color: COLOR_MAP.green, at: a });
    ops.push({ kind: "label", text: "↑ rising", x: cx + 5, y: midY, size: "sm", color: COLOR_MAP.green, at: a + 0.04 });
    return ops;
  }
  if (hasFall && canUse("fall")) {
    take("fall");
    const cx = region.x0 + w * 0.5;
    ops.push({ kind: "arrow", x1: cx, y1: topY + 3, x2: cx, y2: axisY, color: COLOR_MAP.rose, at: a });
    ops.push({ kind: "label", text: "↓ falling", x: cx + 5, y: midY, size: "sm", color: COLOR_MAP.rose, at: a + 0.04 });
    return ops;
  }

  if (canUse("concept-flow")) {
    take("concept-flow");
    const leftX = region.x0 + w * 0.18;
    const midX = region.x0 + w * 0.5;
    const rightX = region.x0 + w * 0.82;
    ops.push({ kind: "label", text: "cause", x: leftX, y: midY, size: "sm", color: COLOR_MAP.blue, at: a });
    ops.push({ kind: "arrow", x1: leftX + w * 0.12, y1: midY, x2: midX - w * 0.12, y2: midY, color: COLOR_MAP.slate, at: a + 0.04 });
    ops.push({ kind: "label", text: "change", x: midX, y: midY, size: "sm", color: COLOR_MAP.amber, at: a + 0.08 });
    ops.push({ kind: "arrow", x1: midX + w * 0.14, y1: midY, x2: rightX - w * 0.14, y2: midY, color: COLOR_MAP.slate, at: a + 0.12 });
    ops.push({ kind: "label", text: "effect", x: rightX, y: midY, size: "sm", color: COLOR_MAP.green, at: a + 0.16 });
    return ops;
  }
  return ops;
}

/**
 * Synthesizes a rich explanatory blackboard.
 *
 * The board shows CAUSE→EFFECT symbolic chains on the LEFT (x:26) and short
 * explanatory notes on the RIGHT (x:70) that are NOT the narration — they add
 * additional context the teacher doesn't say aloud. A small diagram draws in
 * the lower-right when the topic is spatial.
 *
 * Layout geometry (matches LiveSketch exactly):
 *   LEFT ZONE  (x:8-44)  — symbol label at x:26 + connecting arrow below
 *   RIGHT ZONE (x:52-88) — short note at x:72, wrapped to compact chalk lines
 *   GAP        (x:44-52) — always empty, separates zones
 *   LINE_H = 5.2 grid units per rendered line
 */
function makeWrittenBoard(
  title: string,
  script: string,
  durationMs = 28000,
  ctx?: BoardSynthesisContext,
  rowsOverride?: BoardRow[],
): DrawScript {
  const combined = (title + " " + script).toLowerCase();

  // Pick rows the lecture hasn't shown yet: template variant A → variant B → this beat's own
  // script. Without the ctx (single-shot callers like fallbackWrittenDraw) behavior is unchanged.
  const explicitRows = rowsOverride ? null : explicitTitleRows(title, 0);
  let rows: BoardRow[] = rowsOverride ?? explicitRows ?? topicRows(title, script, 0);
  if (!rowsOverride && ctx && rowsAreStale(rows, ctx.usedSyms)) {
    const explicitAlt = explicitTitleRows(title, 1);
    if (explicitRows && explicitAlt) {
      rows = explicitAlt;
    } else {
      const alt = topicRows(title, script, 1);
      rows = rowsAreStale(alt, ctx.usedSyms) && !hasTemplateRows(title, script) ? scriptDerivedRows(title, script) : alt;
    }
  }

  // A supply+demand equilibrium topic gets a LARGE centered chalk diagram, so text rows must
  // stop higher to leave room. Draw it at most once per lecture — later boards on the same
  // topic get a different corner sketch instead of the same chart again.
  const wantsLargeDiagram = /\bsupply\b/.test(combined) && /\bdemand\b/.test(combined)
    && /\b(curve|supply|demand|slope|equilibrium)\b/.test(combined)
    && !ctx?.usedDiagrams.has("graph-large");
  const rowStopY = wantsLargeDiagram ? 46 : 58;

  // Richness: on boards without the large diagram, append a 5th row derived from this beat's
  // own script when a distinct one exists — template branches are fixed at 4 rows, and the
  // extra script-specific row is what ties the generic law back to today's example.
  if (!wantsLargeDiagram && rows.length === 4 && !hasTemplateRows(title, script)) {
    const extra = scriptDerivedRows(title, script).find(
      (cand) =>
        !rows.some((r) => normSym(r.sym) === normSym(cand.sym)) &&
        !rows.some((r) => r.note.toLowerCase() === cand.note.toLowerCase()) &&
        !(ctx && ctx.usedSyms.has(normSym(cand.sym))),
    );
    if (extra) rows = [...rows, extra];
  }
  if (ctx) registerRows(rows, ctx.usedSyms);

  // ── GEOMETRY ─────────────────────────────────────────────────────────────
  const TERM_X   = 26;
  const NOTE_X   = 72;
  const NOTE_CHARS = 44;
  const LINE_H   = 4.8;
  const ROW_PAD  = 4.4;
  const AT_START = 0.13;
  const AT_END   = 0.62; // leave room for footer + diagram
  const atStep   = rows.length > 1 ? (AT_END - AT_START) / rows.length : 0.15;

  const ops: DrawOp[] = [];

  // ── HEADING ───────────────────────────────────────────────────────────────
  ops.push({ kind: "label", text: boardTitle(title), x: 50, y: 8, size: "md", color: COLOR_MAP.amber, at: 0.04 });
  ops.push({ kind: "arrow", x1: 20, y1: 14, x2: 80, y2: 14, color: COLOR_MAP.amber, at: 0.08 });

  // ── ROWS ──────────────────────────────────────────────────────────────────
  let y = 22;
  for (let i = 0; i < rows.length; i++) {
    const { sym, note, color: rowColor } = rows[i];
    const rowAtBase = AT_START + i * atStep;

    // LEFT: symbol label
    ops.push({ kind: "label", text: sym, x: TERM_X, y, size: "sm", color: rowColor, at: rowAtBase });

    // Connecting arrow downward to next symbol (except last row)
    if (i < rows.length - 1) {
      ops.push({ kind: "arrow", x1: TERM_X, y1: y + 3, x2: TERM_X, y2: y + LINE_H + 1.5, color: rowColor, at: rowAtBase + 0.02 });
    }

    // RIGHT: explanatory note, pre-wrapped to NOTE_CHARS
    const noteLines = wrapToWidth(note, NOTE_CHARS).slice(0, 3);
    const noteStartY = noteLines.length > 1 ? y - ((noteLines.length - 1) * LINE_H) / 2 : y;
    noteLines.forEach((line, li) => {
      ops.push({
        kind: "note",
        text: line,
        x: NOTE_X,
        y: Math.max(18, noteStartY + li * LINE_H),
        color: COLOR_MAP.slate,
        at: rowAtBase + 0.03 + li * 0.02,
      });
    });

    y += Math.max(1, noteLines.length) * LINE_H + ROW_PAD;
    if (y > rowStopY) break;
  }

  // ── FOOTER RULE (bottom-left) ────────────────────────────────────────────
  // Skip the footer on large-diagram boards — the diagram fills the lower half instead.
  if (!wantsLargeDiagram) {
    const footer = boardFooter(title, combined);
    const footerLines = wrapToWidth(footer, 44).slice(0, 2);
    footerLines.forEach((line, i) => {
      ops.push({
        kind: "note",
        text: i === 0 ? `Rule: ${line}` : line,
        x: 30,
        y: 76 + i * 5.2,
        color: i === 0 ? COLOR_MAP.amber : COLOR_MAP.slate,
        at: 0.66 + i * 0.025,
      });
    });
  }

  // ── SPATIAL DIAGRAM ──────────────────────────────────────────────────────
  // Large centered supply/demand chart for equilibrium topics; small bottom-right corner
  // sketch otherwise. Built from label+arrow ops so the board stays a written blackboard.
  if (wantsLargeDiagram) {
    ctx?.usedDiagrams.add("graph-large");
    ops.push(...buildChalkDiagram(combined, { x0: 34, y0: 52, x1: 86, y1: 88 }, 0.5, ctx?.usedDiagrams, true));
  } else {
    const diagTop = Math.max(62, Math.min(y + 2, 70));
    const diagram = buildChalkDiagram(combined, { x0: 60, y0: diagTop, x1: 88, y1: 91 }, 0.74, ctx?.usedDiagrams);
    if (diagram.length) ops.push(...diagram);
    else ops.push(...buildChalkDiagram(combined, { x0: 60, y0: diagTop, x1: 88, y1: 91 }, 0.74));
  }

  return { caption: title, durationMs, ops };
}

/**
 * Closing-recap synthesis: one row per major idea IN LECTURE ORDER (each teaching beat's core
 * term + one clause from that beat's own script) instead of re-matching the topic template.
 * Beats 1-2 already rendered the template rows, so re-rendering them as the "recap" is exactly
 * the end-of-lecture repetition users notice. Falls back to the dedup-aware standard path when
 * the scripts don't yield at least 3 distinct rows.
 */
function makeRecapBoard(beats: Beat[], closing: Beat, ctx: BoardSynthesisContext): DrawScript {
  const palette = [COLOR_MAP.amber, COLOR_MAP.blue, COLOR_MAP.green, COLOR_MAP.rose, COLOR_MAP.violet];
  const rows: BoardRow[] = [];
  const seenSym = new Set<string>();
  const seenNote = new Set<string>();
  for (let i = 1; i < beats.length && rows.length < 5; i++) {
    const beat = beats[i];
    if (!beat || beat === closing || beat.slideKind === "checkpoint") continue;
    const core = beat.title.replace(/^(the|a|an|how|what|why|understanding|intro(duction)? to|changes? in)\s+/i, "").trim();
    const sym = `• ${boardTitle(core)}`;
    if (!core || seenSym.has(normSym(sym))) continue;
    const templateRows = explicitTitleRows(beat.title, (rows.length % 2) as 0 | 1) ?? explicitTitleRows(core, (rows.length % 2) as 0 | 1);
    const templateNote = templateRows?.find((row) => !seenNote.has(row.note.toLowerCase()))?.note;
    const clause = templateNote ?? scriptSentences(beat.script)
      .map((s) => sentenceNote(s))
      .find((c) => c.length >= 14 && !looksLikeFragment(c) && !seenNote.has(c.toLowerCase()));
    if (!clause) continue;
    seenSym.add(normSym(sym));
    seenNote.add(clause.toLowerCase());
    rows.push({ sym, note: clause, color: palette[rows.length % palette.length] });
  }
  const durationMs = closing.draw?.durationMs ?? 28000;
  if (rows.length < 3) {
    return makeWrittenBoard(closing.title, closing.script, durationMs, ctx);
  }
  return makeWrittenBoard(closing.title, closing.script, durationMs, ctx, rows);
}

function boardFooter(title: string, combined: string): string {
  const t = title.toLowerCase();
  if (/\bglucose|sugar|from light to sugar\b/.test(t)) {
    return "glucose stores captured light energy";
  }
  if (/\blight reactions?|energy moves?|chloroplast|thylakoid\b/.test(t)) {
    return "light energy moves through carriers";
  }
  if (/\bphotosynthesis\b/.test(t)) {
    return "light energy becomes chemical energy";
  }
  if (/\blight absorption|absorbs? light|chlorophyll|red and blue|wavelength\b/.test(`${t} ${combined}`)) {
    return "chlorophyll absorbs red and blue light";
  }
  if (/\bphotosynthesis|chloroplast|glucose\b/.test(`${t} ${combined}`)) {
    return "light energy becomes chemical energy";
  }
  if (/\bshift\b/.test(t) || /\bshift\b/.test(combined)) {
    return "a shift changes every price";
  }
  if (/\blaw of supply\b/.test(t) || (/\bsupply\b/.test(t) && !/\bdemand\b/.test(t))) {
    return "price moves along the supply curve";
  }
  if (/\blaw of demand\b/.test(t) || (/\bdemand\b/.test(t) && !/\bsupply\b/.test(t))) {
    return "price moves along the demand curve";
  }
  if (/\bequilibrium\b/.test(combined) || (/\bsupply\b/.test(combined) && /\bdemand\b/.test(combined))) {
    return "price moves until plans match";
  }
  if (/\bdemand\b/.test(combined) && /\bprice\b/.test(combined) && !/\bsupply\b/.test(combined)) {
    return "price moves along the demand curve";
  }
  if (/\bsupply\b/.test(combined) && /\bprice\b/.test(combined) && !/\bdemand\b/.test(combined)) {
    return "price moves along the supply curve";
  }
  return `connect each symbol back to the cause, the effect, and ${shorten(title.toLowerCase(), 24)}`;
}

/** Structural check used right after sanitizing the model's JSON, BEFORE fillImageOps has
 *  run — at this point no image has a "src" yet (generation happens later), so we only
 *  check that a real image op with a prompt exists. Using "has src" here would always be
 *  false and incorrectly discard every valid model-authored board in favor of the generic
 *  fallback before generation even gets a chance to run. */
export function hasUsefulExplanationVisual(draw: DrawScript | undefined): draw is DrawScript {
  if (!draw) return false;
  // A reactAnimation op is a complete, self-contained animation-slot board. A manimScene op is
  // the same contract for the TYPE D diagram slot — one op that IS the whole board, whose video
  // is rendered later from the sceneBrief/spec.
  if (draw.ops.some((op) => op.kind === "reactAnimation" || op.kind === "manimScene" || op.kind === "morph" || op.kind === "structureScene" || op.kind === "plotBoard" || op.kind === "equationBoard")) return true;
  // A chalkBoard op is a complete, self-contained blackboard-slot board — its real content is
  // authored later by fillBlackboardOps. Without this check, a fresh placeholder (which has no
  // label/note/arrow ops yet) fails every other check below and gets silently replaced by
  // fallbackExplanationDraw(), destroying the new dynamic-blackboard pipeline before it can run.
  if (draw.ops.some((op) => op.kind === "chalkBoard")) return true;
  // Animation-led boards (scene/motion on clean canvas) are valid explanations without an image.
  const hasAnimation = draw.ops.some((op) => op.kind === "scene" || op.kind === "motion");
  if (hasAnimation) return true;
  // A written blackboard (symbol labels + arrows, no image) is a valid clean-board explanation.
  if (isWrittenBlackboard(draw.ops)) return true;
  return draw.ops.some((op) => op.kind === "image" && !!op.prompt);
}

/** Post-fill check used by fillImageOps AFTER generation has actually run — here we require
 *  a real filled "src", since by this point generation has had its chance and a prompt with
 *  no src means that image's generation genuinely failed. */
export function hasFilledImage(draw: DrawScript | undefined): draw is DrawScript {
  if (!draw) return false;
  return draw.ops.some((op) => op.kind === "image" && !!op.src);
}

/** Last-resort post-image fallback: if every image attempt failed, keep the lesson useful
 *  by turning the beat into a dense written board instead of returning floating notes. */
export function fallbackWrittenDraw(title: string, script: string): DrawScript {
  return makeWrittenBoard(title || firstSentence(script, "Key idea"), script, 28000);
}

function firstSentence(text: string, fallback: string) {
  const sentence = text.match(/[^.!?]+[.!?]?/)?.[0]?.trim() || fallback;
  return shorten(sentence, 72);
}

function shorten(text: string, max: number) {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  const clipped = clean.slice(0, max + 1);
  const lastSpace = clipped.lastIndexOf(" ");
  return clipped.slice(0, lastSpace > 24 ? lastSpace : max).replace(/[,.!?;:–—-]+$/, "").trim();
}

/** Synthesizes a chalkboard diagram when the model's own board didn't validate. Follow-up
 *  questions should always open a teachable blackboard, not fall back to a text card. */
export function fallbackExplanationDraw(question: string, script: string): DrawScript {
  const topNote = firstSentence(script, "Here is the key idea.");
  const seed = question.trim() || topNote;
  return makeWrittenBoard(seed, script || topNote, 18000);
}

/** Sanitizes a single side-chat explanation: { script, draw }. Rendered on the same paper
 *  whiteboard surface as the main lecture (see surface default in generate-lecture/route.ts) so
 *  a mid-lecture "explain this" board doesn't pop up as a mismatched dark chalkboard. */
export function sanitizeExplanation(raw: unknown, context?: { question?: string }): { script: string; draw?: DrawScript } {
  if (!raw || typeof raw !== "object") throw new Error("No explanation returned.");
  const o = raw as Record<string, unknown>;
  const script = str(o.script);
  if (!script) throw new Error("Empty explanation.");
  const draw = sanitizeDraw(o.draw, { title: context?.question, script, slideKind: "definition", index: 1 });
  const finalDraw = hasUsefulExplanationVisual(draw) ? draw : fallbackExplanationDraw(context?.question ?? "", script);
  return { script, draw: { ...finalDraw, surface: "paper" } };
}

/**
 * TEXT-ONLY explanation sanitize (ADHD live tutor). Keeps the model's label/note ops as a clean
 * chalk-text board — never substitutes the shape/scene fallback that produces the busy diagram.
 * If the model gave too few text ops, synthesize a couple of note lines from the script so the
 * board is never empty.
 */
export function sanitizeTextExplanation(raw: unknown, context?: { question?: string }): { script: string; draw?: DrawScript } {
  if (!raw || typeof raw !== "object") throw new Error("No explanation returned.");
  const o = raw as Record<string, unknown>;
  const script = str(o.script);
  if (!script) throw new Error("Empty explanation.");

  const rawDraw = (o.draw && typeof o.draw === "object" ? (o.draw as Record<string, unknown>) : {}) as Record<string, unknown>;
  const cleaned = sanitizeChalkBoardOps(rawDraw.ops) as Array<Extract<DrawOp, { kind: "label" | "note" }>>;

  // The overlay already shows the title as a caption chip in the TOP-LEFT — so the board must NOT
  // draw its own heading up there (that caused the overlap). Drop any op the model placed in the
  // top zone (a heading), take the remaining lines as content, and re-lay them out in a clean
  // single left column that STARTS BELOW the caption chip (y>=26) with even vertical spacing.
  const contentTexts = cleaned
    .filter((op) => op.y > 18) // skip anything up in the caption-chip zone (a redundant heading)
    .map((op) => op.text.trim())
    .filter(Boolean);

  // If that left us too thin, fall back to sentences from the spoken answer.
  let lines = contentTexts;
  if (lines.length < 2) {
    lines = script.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean);
  }
  lines = lines.slice(0, 5).map((t) => t.slice(0, 42));

  const palette: Parameters<typeof color>[0][] = ["green", "blue", "amber", "rose", "violet"];
  const finalOps: DrawOp[] = lines.map((text, i) => ({
    kind: "note",
    text,
    x: 12,
    y: 26 + i * 14, // start below the caption chip; 14 units apart = no overlap
    color: color(palette[i % palette.length]),
    at: (i + 1) / (lines.length + 1),
  }));

  const caption = str(rawDraw.caption) || (context?.question ?? "Explanation");
  const draw: DrawScript = { caption: caption.slice(0, 60), durationMs: 13000, ops: finalOps };
  return { script, draw };
}

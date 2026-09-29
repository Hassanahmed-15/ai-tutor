/**
 * ILLUSTRATED BOARDS — a generated textbook illustration, taught on like a teacher at a whiteboard.
 *
 * WHY. Asked to draw a chloroplast, the board model drew a green blob with two squiggles, and put
 * its labels wherever it guessed (reported 2026-09-29, with a textbook cutaway beside it). A model
 * writing SVG cannot draw anatomy like an illustrator, and cannot see where its own parts landed.
 * So a physical subject is PICTURED by an image model (no text in the picture), its parts are
 * LOCATED on that picture by a vision model, and everything the student reads is laid out HERE,
 * deterministically.
 *
 * WHAT A BOARD CARRIES (the owner's brief, 2026-09-29, after "it just tries to label everything and
 * doesn't really write something on the board"):
 *   - KEY NOTES, 2-4, in a column beside the picture: what a teacher writes while talking. Each is
 *     revealed on the sentence that says it and written by the board's pen (sandboxMotion.ts).
 *   - LABELS only when naming parts is the point of the slide, 0-3, written ON the picture as
 *     callouts beside their parts, placed by search so no two callouts, leaders or dots collide.
 *   - A POINTING RING on a part while the sentence that names it is spoken: how a teacher points,
 *     without writing its name.
 *   - A ZOOM onto one part, for a slide that builds on a picture an earlier slide showed: the same
 *     picture, a different view and different writing, never the same board twice.
 *
 * Pure: no I/O, so it is unit-tested directly (illustratedLayout.test.ts). The server half
 * (planning, the image, the vision call, storage, lecture memory) is lib/illustratedBoard.ts.
 */

export const BOARD_W = 1000;
export const BOARD_H = 560;
/** The illustration's own aspect (gpt-image-1 at 1536x1024, stored at 1200x800). */
export const ILLUSTRATION_ASPECT = 1.5;
/** The notes column, left of the picture. */
const NOTES_X = 56;
const NOTES_RIGHT = 372;
const NOTE_FONT = 23;
const NOTE_MIN_FONT = 17;
const NOTE_STEP = 66;
const CALLOUT_FONT = 18;
const CALLOUT_H = 32;

export type LocatedPart = {
  /** The part's name as the narration says it. */
  name: string;
  /** Where the part is, as fractions of the illustration's width and height. */
  x: number;
  y: number;
  /** The 0-based sentence that first names it; resolved from the script when absent or wrong. */
  sentence?: number;
};

export type BoardNote = { text: string; sentence?: number };

/** A zoom onto one point of the picture: `scale` about the picture box's centre, then a shift. */
export type PictureView = { scale: number; tx: number; ty: number };

export type IllustratedBoardInput = {
  title: string;
  sentences: string[];
  /** Every located part: the ones to label, point at, or zoom onto. */
  parts: LocatedPart[];
  /** 2-4 key notes written beside the picture. */
  notes: BoardNote[];
  /** Names (from `parts`) to write on the picture — only when naming them is the slide's point. */
  labels: string[];
  /** A part to zoom onto (a slide building on a picture shown before), or none for the whole. */
  focus?: string | null;
  /** The illustration's background colour, so the board's paper matches it seamlessly. */
  paper: string;
  /** The stored illustration's id (32 hex), fetched by the sandbox and embedded as a data URL. */
  illustrationId: string;
  /** What the lecture remembers about this picture (lib/lecturePictures.ts), carried in the code. */
  memory?: unknown;
  /** Where the picture has ink (INK_COLS x INK_ROWS digits), so callouts go on bare paper. */
  ink?: string;
};

type Rect = { x: number; y: number; w: number; h: number };

/** The illustration's box on the board: right of the notes column, as large as the band allows. */
export function illustrationBox(): Rect {
  const w = 588;
  const h = w / ILLUSTRATION_ASPECT;
  return { x: BOARD_W - 16 - w, y: 124, w, h };
}

function stem(word: string): string {
  return word.toLowerCase().replace(/[^a-z0-9]/g, "").replace(/(ies|es|s)$/, "");
}

/**
 * The sentence that first names a part. The whole name first ("left atrium" must not resolve to a
 * sentence that only says "right atrium"), then its most specific word, then the planner's own
 * guess, then an even spread after the opening sentence.
 */
export function sentenceForPart(name: string, sentences: string[], hint: number | undefined, index: number): number {
  const words = name.split(/\s+/).map(stem).filter((w) => w.length > 1);
  const tokens = sentences.map((line) => line.split(/\s+/).map(stem));
  const full = tokens.findIndex((have) => words.every((w) => have.includes(w)));
  if (full >= 0) return full;
  const longest = [...words].sort((a, b) => b.length - a.length)[0];
  if (longest && longest.length > 5) {
    const partial = tokens.findIndex((have) => have.includes(longest));
    if (partial >= 0) return partial;
  }
  const last = Math.max(0, sentences.length - 1);
  if (typeof hint === "number" && Number.isFinite(hint)) return Math.max(0, Math.min(last, Math.round(hint)));
  return Math.min(last, 1 + index);
}

/** The sentence whose words the narration says it in, whole — or -1 when no sentence names it. */
export function sentenceNaming(name: string, sentences: string[]): number {
  const words = name.split(/\s+/).map(stem).filter((w) => w.length > 1);
  if (!words.length) return -1;
  return sentences.findIndex((line) => {
    const have = line.split(/\s+/).map(stem);
    return words.every((w) => have.includes(w));
  });
}

/** Approximate width of `text` in the board font at `size` (semibold ~0.5 em, bold ~0.53 em). */
export function textWidth(text: string, size: number, bold = false): number {
  return text.length * size * (bold ? 0.53 : 0.5);
}

/** The largest size, up to `max` and never below `min`, at which `text` fits `room` on one line. */
export function fitFont(text: string, room: number, max: number, min: number, bold = false): number {
  const fit = Math.floor(room / Math.max(1, text.length * (bold ? 0.53 : 0.5)));
  return Math.max(min, Math.min(max, fit));
}

/** Kept for callers of the earlier column layout. */
export function labelFontSize(text: string, room: number): number {
  return fitFont(text, room, 21, 15);
}

/**
 * A zoom onto `focus` (fractions of the picture): the focus moves toward the box's centre, and the
 * zoomed picture always still covers the whole box — no blank edge ever shows.
 */
export function zoomView(focus: { x: number; y: number } | null, scale = 1.6): PictureView {
  if (!focus) return { scale: 1, tx: 0, ty: 0 };
  const box = illustrationBox();
  const fx = box.x + clamp01(focus.x) * box.w;
  const fy = box.y + clamp01(focus.y) * box.h;
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  const maxX = ((scale - 1) * box.w) / 2;
  const maxY = ((scale - 1) * box.h) / 2;
  return {
    scale,
    tx: Math.max(-maxX, Math.min(maxX, -scale * (fx - cx))),
    ty: Math.max(-maxY, Math.min(maxY, -scale * (fy - cy))),
  };
}

/** Where a point of the picture (fractions) lands on the board under `view`. */
export function pointOnBoard(part: { x: number; y: number }, view: PictureView): { px: number; py: number } {
  const box = illustrationBox();
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  const x = box.x + clamp01(part.x) * box.w;
  const y = box.y + clamp01(part.y) * box.h;
  return { px: cx + view.tx + view.scale * (x - cx), py: cy + view.ty + view.scale * (y - cy) };
}

export type PlacedNote = { text: string; sentence: number; y: number; size: number };

/** The notes column: one line each, shrunk to fit, spaced evenly and centred on the picture. */
export function placeNotes(notes: BoardNote[], sentences: string[]): PlacedNote[] {
  const box = illustrationBox();
  const last = Math.max(0, sentences.length - 1);
  const kept = notes.filter((n) => n.text.trim()).slice(0, 4);
  const top = box.y + box.h / 2 - ((kept.length - 1) * NOTE_STEP) / 2 + 8;
  let floor = 0;
  return kept.map((note, i) => {
    const text = note.text.trim().replace(/\.$/, "");
    const hinted = typeof note.sentence === "number" && Number.isFinite(note.sentence) ? Math.round(note.sentence) : Math.min(last, i + 1);
    // Notes are written in reading order: none is revealed before the one above it.
    const sentence = Math.max(floor, Math.max(0, Math.min(last, hinted)));
    floor = sentence;
    return { text, sentence, y: top + i * NOTE_STEP, size: fitFont(text, NOTES_RIGHT - NOTES_X - 26, NOTE_FONT, NOTE_MIN_FONT) };
  });
}

export type PlacedCallout = {
  name: string;
  sentence: number;
  /** The part's point on the board. */
  px: number;
  py: number;
  /** The callout's pill. */
  rect: Rect;
  size: number;
  /** Where the leader leaves the pill. */
  lx: number;
  ly: number;
};

function overlaps(a: Rect, b: Rect, pad: number): boolean {
  return a.x < b.x + b.w + pad && b.x < a.x + a.w + pad && a.y < b.y + b.h + pad && b.y < a.y + a.h + pad;
}

function segmentsCross(a: [number, number, number, number], b: [number, number, number, number]): boolean {
  const d = (p: number[], q: number[], r: number[]) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  const [p1, p2, p3, p4] = [[a[0], a[1]], [a[2], a[3]], [b[0], b[1]], [b[2], b[3]]];
  return d(p3, p4, p1) * d(p3, p4, p2) < 0 && d(p1, p2, p3) * d(p1, p2, p4) < 0;
}

/** The point on a rect's edge nearest (px, py): where a leader to that point leaves the pill. */
function edgePoint(r: Rect, px: number, py: number): { lx: number; ly: number } {
  return { lx: Math.max(r.x, Math.min(r.x + r.w, px)), ly: Math.max(r.y, Math.min(r.y + r.h, py)) };
}

/**
 * Callouts ON the picture. For each label, candidate spots around its point — pushed away from the
 * picture's centre first, then turning — and the first that stays inside the picture and clear of
 * every other callout, every dot, and every other leader wins. With at most three labels this
 * finds a clean spot for each on any picture the planner can produce; a label with none is dropped
 * rather than printed over another.
 */
/**
 * WHERE THE PICTURE HAS INK: a coarse map of the illustration, INK_COLS x INK_ROWS cells, each a
 * digit 0-9 for how much of the cell is drawn (0 = bare paper). Made from the picture's pixels when
 * it is stored (lib/illustratedBoard.ts), so callouts can be written on empty paper beside a part
 * rather than over the next neuron (reported 2026-09-29).
 */
export const INK_COLS = 48;
export const INK_ROWS = 32;

/** How much of a board rect lies over drawn parts of the picture, 0-1, through the board's zoom. */
export function inkUnder(ink: string | undefined, view: PictureView, rect: Rect): number {
  if (!ink || ink.length !== INK_COLS * INK_ROWS) return 0;
  const box = illustrationBox();
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  let sum = 0;
  let n = 0;
  for (let y = rect.y + 3; y <= rect.y + rect.h - 3; y += 7) {
    for (let x = rect.x + 3; x <= rect.x + rect.w - 3; x += 7) {
      const u = ((x - cx - view.tx) / view.scale + cx - box.x) / box.w;
      const v = ((y - cy - view.ty) / view.scale + cy - box.y) / box.h;
      n += 1;
      if (u < 0 || u >= 1 || v < 0 || v >= 1) continue;
      sum += Number(ink[Math.floor(v * INK_ROWS) * INK_COLS + Math.floor(u * INK_COLS)]) / 9;
    }
  }
  return n ? sum / n : 0;
}

export function placeCallouts(
  labels: Array<{ name: string; px: number; py: number; sentence: number }>,
  /** How much of a candidate spot covers the picture's drawing (inkUnder); bare paper is preferred. */
  inkAt: (rect: Rect) => number = () => 0,
): PlacedCallout[] {
  const box = illustrationBox();
  // On the picture, or on the paper round it (the picture's paper IS the board's): anywhere right of
  // the notes column and below the title, so a part at the picture's edge still finds bare paper.
  const inner: Rect = { x: NOTES_RIGHT + 12, y: 96, w: BOARD_W - 8 - (NOTES_RIGHT + 12), h: BOARD_H - 8 - 96 };
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  const placed: PlacedCallout[] = [];
  const dots = labels.map((l) => ({ x: l.px - 12, y: l.py - 12, w: 24, h: 24 }));
  for (const label of labels) {
    const size = fitFont(label.name, 230, CALLOUT_FONT, 15, true);
    const w = textWidth(label.name, size, true) + 30;
    const h = CALLOUT_H;
    const out = Math.atan2(label.py - cy, label.px - cx || 0.001);
    let best: PlacedCallout | null = null;
    let bestCost = Infinity;
    for (const dist of [60, 74, 90, 104, 120, 136, 170, 210, 250]) {
      for (const turn of [0, 0.3, -0.3, 0.6, -0.6, 0.9, -0.9, 1.2, -1.2, 1.6, -1.6, 1.9, -1.9, 2.4, -2.4, Math.PI]) {
        const angle = out + turn;
        const ox = label.px + Math.cos(angle) * dist;
        const oy = label.py + Math.sin(angle) * dist;
        // A callout sits beside its leader's end: to its right when the leader runs right, etc.
        const rect: Rect = {
          x: Math.cos(angle) >= 0.35 ? ox : Math.cos(angle) <= -0.35 ? ox - w : ox - w / 2,
          y: Math.sin(angle) >= 0.35 ? oy : Math.sin(angle) <= -0.35 ? oy - h : oy - h / 2,
          w,
          h,
        };
        if (rect.x < inner.x || rect.y < inner.y || rect.x + rect.w > inner.x + inner.w || rect.y + rect.h > inner.y + inner.h) continue;
        if (placed.some((p) => overlaps(p.rect, rect, 10))) continue;
        if (dots.some((d, i) => labels[i] !== label && overlaps(d, rect, 4))) continue;
        const { lx, ly } = edgePoint(rect, label.px, label.py);
        if (placed.some((p) => segmentsCross([p.lx, p.ly, p.px, p.py], [lx, ly, label.px, label.py]))) continue;
        if (placed.some((p) => overlaps(p.rect, { x: Math.min(lx, label.px), y: Math.min(ly, label.py), w: Math.abs(lx - label.px) || 1, h: Math.abs(ly - label.py) || 1 }, -2) && segmentHitsRect([lx, ly, label.px, label.py], p.rect))) continue;
        // Bare paper first, then a short leader, then pointing away from the picture's centre.
        const cost = inkAt(rect) * 500 + dist + Math.abs(turn) * 18;
        if (cost < bestCost) {
          bestCost = cost;
          best = { name: label.name, sentence: label.sentence, px: label.px, py: label.py, rect, size, lx, ly };
        }
      }
    }
    if (best) placed.push(best);
  }
  return placed;
}

function segmentHitsRect(seg: [number, number, number, number], r: Rect): boolean {
  const edges: Array<[number, number, number, number]> = [
    [r.x, r.y, r.x + r.w, r.y],
    [r.x + r.w, r.y, r.x + r.w, r.y + r.h],
    [r.x + r.w, r.y + r.h, r.x, r.y + r.h],
    [r.x, r.y + r.h, r.x, r.y],
  ];
  return edges.some((e) => segmentsCross(seg, e));
}

function clamp01(n: number): number {
  return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0.5;
}

function escapeText(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/[{}]/g, "");
}

/** Matches the id the sandbox fetches; see ReactAnimationSandbox. */
export const ILLUSTRATION_ID_PATTERN = /const ILLUSTRATION_ID = "([a-f0-9]{32})";/;

export function illustrationIdOf(code: string | null | undefined): string | null {
  return typeof code === "string" ? ILLUSTRATION_ID_PATTERN.exec(code)?.[1] ?? null : null;
}

/** What the lecture remembers about a picture board, carried in its code (see lib/lecturePictures.ts). */
export const BOARD_PICTURE_PATTERN = /\/\* BOARD_PICTURE (\{[\s\S]*?\}) BOARD_PICTURE \*\//;

export function boardPictureMemoryOf(code: string | null | undefined): unknown {
  const raw = typeof code === "string" ? BOARD_PICTURE_PATTERN.exec(code)?.[1] : undefined;
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * The Motion board. It follows the Motion board contract (lib/anim/sandboxMotion.ts); the picture
 * arrives as the sandbox global BOARD_ILLUSTRATION, so the code stays a few KB however large the
 * image is.
 */
export function composeIllustratedBoard(input: IllustratedBoardInput): string {
  const box = illustrationBox();
  const f = (n: number) => n.toFixed(1);
  const paper = /^#[0-9a-f]{6}$/i.test(input.paper) ? input.paper : "#fbfaf7";
  const last = Math.max(0, input.sentences.length - 1);
  const focusPart = input.focus ? input.parts.find((p) => p.name.toLowerCase() === input.focus!.toLowerCase()) ?? null : null;
  const view = zoomView(focusPart);
  const zoomed = view.scale !== 1;
  // A zoom lands on the slide's second sentence: the student sees the whole picture they know first.
  const zoomAt = Math.min(1, last);
  const visible = (p: { px: number; py: number }) => p.px > box.x + 14 && p.px < box.x + box.w - 14 && p.py > box.y + 14 && p.py < box.y + box.h - 14;

  const notes = placeNotes(input.notes, input.sentences);
  const noteMarkup = notes.map((n, i) => `
      <motion.g initial={false} animate={reveal(${n.sentence})} transition={REVEAL}>
        <motion.circle cx="${NOTES_X + 7}" cy="${f(n.y - n.size * 0.33)}" fill="${ACCENTS[i % ACCENTS.length]}"
          initial={false} animate={{ r: sentence === ${n.sentence} ? 7 : 5 }} transition={GLIDE} />
        <text x="${NOTES_X + 24}" y="${f(n.y)}" fontSize="${n.size}" fontWeight="600" fill="#1e293b">${escapeText(n.text)}</text>
      </motion.g>`).join("");

  const wanted = new Set(input.labels.map((l) => l.toLowerCase()));
  const labelled = input.parts
    .map((part, index) => ({ part, index }))
    .filter(({ part }) => wanted.has(part.name.toLowerCase()))
    .slice(0, 3)
    .map(({ part, index }) => ({ name: part.name, sentence: sentenceForPart(part.name, input.sentences, part.sentence, index), ...pointOnBoard(part, view) }))
    // Under a zoom a label is written only after the zoom has landed, on the part as it then sits.
    .map((l) => ({ ...l, sentence: zoomed ? Math.max(l.sentence, zoomAt) : l.sentence }))
    .filter(visible);
  const callouts = placeCallouts(labelled, (rect) => inkUnder(input.ink, view, rect));
  const calloutMarkup = callouts.map((c) => `
      <motion.g initial={false} animate={reveal(${c.sentence})} transition={REVEAL}>
        <motion.path d="M${f(c.lx)} ${f(c.ly)} L${f(c.px)} ${f(c.py)}" fill="none" stroke="#0f172a" strokeWidth="1.8" strokeLinecap="round"
          initial={false} animate={draw(${c.sentence})} transition={DRAW} />
        <rect x="${f(c.rect.x)}" y="${f(c.rect.y)}" width="${f(c.rect.w)}" height="${c.rect.h}" rx="${c.rect.h / 2}" fill="#ffffff" fillOpacity="0.94" stroke="#0f172a" strokeWidth="1.4" />
        <motion.circle cx="${f(c.px)}" cy="${f(c.py)}" fill="#ffffff" stroke="#0f172a" strokeWidth="2.5"
          initial={false} animate={{ r: on(${c.sentence}) ? 5.5 : 0 }} transition={POP} />
        <text x="${f(c.rect.x + c.rect.w / 2)}" y="${f(c.rect.y + c.rect.h / 2 + c.size * 0.35)}" fontSize="${c.size}" fontWeight="700" fill="#0f172a" textAnchor="middle">${escapeText(c.name)}</text>
      </motion.g>`).join("");

  // No pulsing ring on the picture: an orange circle on every picture read as clutter (the owner,
  // 2026-09-29: "there is this orange circle in every image produced"). The label, the dot and the
  // narration point at a part; the zoom does the rest.
  const ringMarkup = "";

  const pictureAnimate = zoomed
    ? `{{ opacity: on(0) ? 1 : 0, scale: on(${zoomAt}) ? ${view.scale} : 1, x: on(${zoomAt}) ? ${f(view.tx)} : 0, y: on(${zoomAt}) ? ${f(view.ty)} : 0 }}`
    : `{{ opacity: on(0) ? 1 : 0, scale: on(0) ? 1 : 0.97 }}`;
  const names = JSON.stringify(input.parts.map((p) => p.name));
  const memory = input.memory ? `\n  /* BOARD_PICTURE ${JSON.stringify(input.memory).replace(/\*\//g, "* /")} BOARD_PICTURE */` : "";
  return `export default function Animation({ sentence, sentenceProgress }) {
  const ILLUSTRATION_ID = "${input.illustrationId}";${memory}
  const on = (k) => sentence >= k;
  const reveal = (k) => ({ opacity: on(k) ? 1 : 0, y: on(k) ? 0 : 6 });
  const draw = (k) => ({ pathLength: on(k) ? 1 : 0, opacity: on(k) ? 1 : 0 });
  const thereAndBack = (t) => Math.sin(Math.PI * Math.max(0, Math.min(1, t)));
  const REVEAL = { duration: 0.5, ease: "easeOut" };
  const DRAW = { duration: 0.9, ease: "easeInOut" };
  const POP = { type: "spring", stiffness: 260, damping: 18 };
  const GLIDE = { duration: 0.35, ease: "easeOut" };
  const picture = typeof BOARD_ILLUSTRATION === "string" ? BOARD_ILLUSTRATION : "";
  const visualSpec = { subject: ${JSON.stringify(input.title)}, recognitionCues: ["a textbook illustration"], requiredParts: ${names}, forbiddenShortcuts: [] };
  const boardPlan = { composition: "key notes left; illustration right${zoomed ? ", zoomed onto " + escapeText(focusPart!.name) : ""}", readingPath: ${JSON.stringify(notes.map((n) => n.text))}, reservedRegions: [] };
  return (
    <svg viewBox="0 0 ${BOARD_W} ${BOARD_H}" style={{ background: "${paper}" }}>
      <defs>
        <clipPath id="board-picture-frame">
          <rect x="${f(box.x)}" y="${f(box.y)}" width="${f(box.w)}" height="${f(box.h)}" rx="18" />
        </clipPath>
      </defs>
      <rect x="0" y="0" width="${BOARD_W}" height="${BOARD_H}" fill="${paper}" />
      <motion.g initial={false} animate={reveal(0)} transition={REVEAL}>
        <text x="${NOTES_X}" y="72" fontSize="${fitFont(input.title, BOARD_W - 2 * NOTES_X, 34, 24, true)}" fontWeight="800" fill="#1b2440">${escapeText(input.title)}</text>
      </motion.g>
      <g clipPath="url(#board-picture-frame)">
        <motion.g initial={false} animate=${pictureAnimate} transition={{ duration: ${zoomed ? 2.4 : 1.2}, ease: [0.45, 0, 0.2, 1] }}>
          <image href={picture} x="${f(box.x)}" y="${f(box.y)}" width="${f(box.w)}" height="${f(box.h)}" preserveAspectRatio="xMidYMid meet" style={{ imageRendering: "auto" }} />
        </motion.g>
      </g>${zoomed ? `
      <motion.rect x="${f(box.x)}" y="${f(box.y)}" width="${f(box.w)}" height="${f(box.h)}" rx="18" fill="none" stroke="#1e293b" strokeWidth="2.5"
        initial={false} animate={{ opacity: on(${zoomAt}) ? 0.28 : 0 }} transition={GLIDE} />` : ""}${noteMarkup}${ringMarkup}${calloutMarkup}
    </svg>
  );
}
`;
}

/** The notes' bullets, one colour each, as a teacher changes pens. */
const ACCENTS = ["#0ea5e9", "#f59e0b", "#10b981", "#e11d48"];

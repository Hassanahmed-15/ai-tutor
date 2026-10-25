import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createCanvas, loadImage } from "@napi-rs/canvas";

/**
 * WHERE THE PICTURE'S OWN LABEL POINTS (owner, 2026-10-25: "make sure every label is correct"). A course
 * picture writes its labels itself, each with a leader line to its part; the pointer and a note's line
 * must go where that leader ends — not where a vision model guesses the part is from a grid (it put
 * "Cortex" on a medullary pyramid). Free and exact: Tesseract finds the label's words, then the leader is
 * followed from the edge of the words as the longest straight run of dark, grey ink leaving them.
 *
 * A label with no leader (written on the part, or no line found) gives no point; the caller keeps the
 * located one.
 */

export type Box = { x: number; y: number; w: number; h: number };
export type Word = Box & { text: string; conf: number; line: string };
type Pt = { x: number; y: number };
/** The leader's end, its length, and its path from the label's edge (two points, three with an elbow). */
export type LeaderEnd = { x: number; y: number; len: number; from: Pt; path: Pt[]; box: Box };

/** Tesseract's TSV (one row a word) as words with their boxes; empty and low-confidence rows dropped. */
export function wordsFromTsv(tsv: string): Word[] {
  const words: Word[] = [];
  for (const row of tsv.split("\n").slice(1)) {
    const c = row.split("\t");
    if (c.length < 12 || c[0] !== "5") continue;
    const text = c[11].trim();
    const conf = Number(c[10]);
    if (!text || !(conf >= 30)) continue;
    words.push({ text, conf, x: Number(c[6]), y: Number(c[7]), w: Number(c[8]), h: Number(c[9]), line: `${c[2]}.${c[3]}.${c[4]}` });
  }
  return words;
}

const SMALL_DIGITS: Record<string, string> = Object.fromEntries([..."⁰¹²³⁴⁵⁶⁷⁸⁹"].map((d, i) => [d, String(i)]).concat([..."₀₁₂₃₄₅₆₇₈₉"].map((d, i) => [d, String(i)])));
const norm = (t: string) => t.toLowerCase().replace(/[’‘`]/g, "'").replace(/[⁰-⁹₀-₉¹²³]/g, (d) => SMALL_DIGITS[d] ?? d).replace(/[^a-z0-9'+-]/g, "");

function close(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  const d = editDistance(a, b);
  return d <= (Math.max(a.length, b.length) >= 6 ? 2 : 1) && d / Math.max(a.length, b.length) <= 0.34;
}

function editDistance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const keep = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = keep;
    }
  }
  return row[b.length];
}

/**
 * The box round a label's words in the picture: its words in order, along one line or wrapped onto the
 * lines below (left-aligned or centred under it). Null when the label is not found, or found twice.
 * A short word Tesseract missed ("net" of "net movement") is allowed for: the words it did read, with
 * the box widened by the missing words' letters at the width of the letters it read.
 */
export function labelBox(words: Word[], label: string): Box | null {
  const want = label.split(/\s+/).map(norm).filter(Boolean);
  if (!want.length) return null;
  const whole = wordsBox(words, want);
  if (whole !== undefined || want.length < 2) return whole ?? null;
  // The longest run of the label's words that was read, at least half its letters.
  const letters = want.join("").length;
  for (let n = want.length - 1; n >= 1; n--) {
    for (let i = 0; i + n <= want.length; i++) {
      const part = want.slice(i, i + n);
      if (part.join("").length * 2 < letters) continue;
      const box = wordsBox(words, part);
      if (!box) continue;
      const per = box.w / (part.join(" ").length || 1);
      const before = want.slice(0, i).join(" ").length + (i ? 1 : 0);
      const after = want.slice(i + n).join(" ").length + (i + n < want.length ? 1 : 0);
      return { x: Math.round(box.x - before * per), y: box.y, w: Math.round(box.w + (before + after) * per), h: box.h };
    }
  }
  return null;
}

/** The box of these words read in order; null when found more than once, undefined when not found. */
function wordsBox(words: Word[], want: string[]): Box | null | undefined {
  const found: Box[] = [];
  for (let i = 0; i < words.length; i++) {
    if (!close(norm(words[i].text), want[0])) continue;
    const got = [words[i]];
    for (let k = 1; k < want.length; k++) {
      const last = got[got.length - 1];
      const next = words.find((w) => !got.includes(w) && close(norm(w.text), want[k]) && (
        // the same line, just to the right
        (Math.abs(w.y + w.h / 2 - (last.y + last.h / 2)) < last.h * 0.6 && w.x > last.x && w.x - (last.x + last.w) < last.h * 1.6) ||
        // wrapped: the line below, starting under the label
        (w.y > last.y && w.y - (last.y + last.h) < last.h * 1.2 && w.x < got[0].x + got[0].w + last.h && w.x + w.w > got[0].x - last.h)
      ));
      if (!next) break;
      got.push(next);
    }
    if (got.length < want.length) continue;
    // Part of a longer label ("curve" in "second curve"): another word runs on along the same line.
    const first = got[0], last = got[got.length - 1];
    const runsOn = words.some((w) => !got.includes(w) && Math.abs(w.y + w.h / 2 - (first.y + first.h / 2)) < first.h * 0.6 && (
      (w.x < first.x && first.x - (w.x + w.w) < first.h * 0.9) || (w.x > last.x && w.x - (last.x + last.w) < last.h * 0.9 && Math.abs(w.y - last.y) < last.h * 0.6)));
    if (runsOn) continue;
    const x0 = Math.min(...got.map((w) => w.x)), y0 = Math.min(...got.map((w) => w.y));
    found.push({ x: x0, y: y0, w: Math.max(...got.map((w) => w.x + w.w)) - x0, h: Math.max(...got.map((w) => w.y + w.h)) - y0 });
  }
  return found.length === 1 ? found[0] : found.length ? null : undefined;
}

/** Leader ink: dark and grey (not a dark coloured fill), and not inside any word of text. Paper: light and grey. */
function inkTest(px: Uint8ClampedArray | Uint8Array, W: number, H: number, words: Box[]) {
  const text = new Uint8Array(W * H);
  for (const w of words) {
    for (let y = Math.max(0, w.y - 2); y < Math.min(H, w.y + w.h + 2); y++) text.fill(1, y * W + Math.max(0, w.x - 2), y * W + Math.min(W, w.x + w.w + 2));
  }
  const at = (x: number, y: number) => {
    const xi = Math.round(x), yi = Math.round(y);
    if (xi < 0 || yi < 0 || xi >= W || yi >= H) return null;
    const o = (yi * W + xi) * 4;
    const r = px[o], g = px[o + 1], b = px[o + 2];
    return { i: yi * W + xi, lum: 0.299 * r + 0.587 * g + 0.114 * b, sat: Math.max(r, g, b) - Math.min(r, g, b) };
  };
  return {
    ink: (x: number, y: number): boolean => {
      const p = at(x, y);
      return Boolean(p && !text[p.i] && p.lum < 125 && p.sat < 60);
    },
    paper: (x: number, y: number): boolean => {
      const p = at(x, y);
      return Boolean(p && p.lum > 200 && p.sat < 70);
    },
  };
}
type Ink = ReturnType<typeof inkTest>;

/** How far (px) from the edge of a label's words its leader may start. */
const LEADER_GAP = 22;

/**
 * The straight dark run leaving a point in one direction: where its ink starts and ends (steps), or null.
 * It ends where the ink stops (a gap of more than 8 px), or where it runs into a filled dark shape (a
 * black atom): the leader ends at that shape's edge, not on the far side of it.
 */
function run({ ink }: Ink, x: number, y: number, a: number, max: number, startGap = LEADER_GAP): { first: number; last: number; intoShape: boolean } | null {
  const dx = Math.cos(a), dy = Math.sin(a), nx = -dy, ny = dx;
  let first = -1, last = -1, gap = 0, thick = 0;
  for (let t = 0; t < max; t++) {
    const px = x + dx * t, py = y + dy * t;
    const on = ink(px, py) || ink(px + nx, py + ny) || ink(px - nx, py - ny) || ink(px + 2 * nx, py + 2 * ny) || ink(px - 2 * nx, py - 2 * ny);
    if (on) {
      if (first < 0) {
        // A leader starts at the label's edge.
        if (t > startGap) return null;
        first = t;
      }
      let across = 0;
      for (let k = -7; k <= 7; k++) if (ink(px + k * nx, py + k * ny)) across++;
      if (across >= 9) {
        // Six steps deep: a filled shape, not a line the leader crosses.
        if (++thick >= 6) return { first, last: Math.max(first, t - 5), intoShape: true };
      } else thick = 0;
      last = t;
      gap = 0;
    } else if (first >= 0 && ++gap > 8) break;
    else if (first < 0 && t > startGap) return null;
  }
  return first < 0 ? null : { first, last, intoShape: false };
}

/** Mostly empty paper round a point: a leader that stops here turns a corner (or ends in the air). */
function overPaper({ paper }: Ink, x: number, y: number): boolean {
  let n = 0, light = 0;
  for (let dy = -6; dy <= 6; dy += 2) for (let dx = -6; dx <= 6; dx += 2) { n++; if (paper(x + dx, y + dy)) light++; }
  return light / n >= 0.6;
}

/**
 * Where the label's leader line ends: the longest straight run of leader ink leaving the label's box —
 * from its right or left side (a margin label), or from above or below (a label over or under its part).
 * At least 24 px long; null when nothing leaves the label.
 */
export function leaderEnd(px: Uint8ClampedArray | Uint8Array, W: number, H: number, box: Box, words: Box[]): LeaderEnd | null {
  const ink = inkTest(px, W, H, words);
  const max = Math.round(Math.hypot(W, H) * 0.6);
  const deg = Math.PI / 180;
  const starts: Array<{ x: number; y: number; from: number; to: number }> = [];
  for (let y = box.y - 4; y <= box.y + box.h + 4; y += 3) {
    starts.push({ x: box.x + box.w + 3, y, from: -80, to: 80 });
    starts.push({ x: box.x - 3, y, from: 100, to: 260 });
  }
  for (let x = box.x - 12; x <= box.x + box.w + 12; x += 3) {
    starts.push({ x, y: box.y - 3, from: -170, to: -10 });
    starts.push({ x, y: box.y + box.h + 3, from: 10, to: 170 });
  }
  let best: (LeaderEnd & { dir: number; intoShape: boolean }) | null = null;
  for (const s of starts) {
    for (let d = s.from; d <= s.to; d += 1.5) {
      const r = run(ink, s.x, s.y, d * deg, max);
      if (!r) continue;
      const len = r.last - r.first;
      if (len < 24 || (best && len <= best.len)) continue;
      const from = { x: s.x + Math.cos(d * deg) * r.first, y: s.y + Math.sin(d * deg) * r.first };
      const end = { x: s.x + Math.cos(d * deg) * r.last, y: s.y + Math.sin(d * deg) * r.last };
      best = { ...end, len, from, path: [from, end], box, dir: d, intoShape: r.intoShape };
    }
  }
  if (!best) return null;
  // AN ELBOW: a flat (or upright) stub from the label that stops in empty paper turns a corner — the
  // leader's second leg is the longest straight run on from the corner (not back the way it came).
  const flat = Math.abs(Math.sin(best.dir * deg)) < 0.18 || Math.abs(Math.cos(best.dir * deg)) < 0.18;
  if (flat && !best.intoShape && overPaper(ink, best.x, best.y)) {
    let leg: { x: number; y: number; len: number; dir: number } | null = null;
    const legs: number[] = [];
    for (let d = 0; d < 360; d += 1.5) {
      const turn = Math.abs(((d - best.dir + 540) % 360) - 180);
      if (turn < 15 || turn > 160) continue;
      const r = run(ink, best.x, best.y, d * deg, max, 4);
      if (!r || r.last - r.first < 25) continue;
      legs.push(d);
      if (leg && r.last - r.first <= leg.len) continue;
      leg = { x: best.x + Math.cos(d * deg) * r.last, y: best.y + Math.sin(d * deg) * r.last, len: r.last - r.first, dir: d };
    }
    // Ink running on both ways from the stop is an outline the leader touches (a box's side), not a corner.
    const outline = legs.some((a) => legs.some((b) => Math.abs(((a - b + 540) % 360) - 180) > 120));
    if (leg && !outline) return { x: leg.x, y: leg.y, len: best.len + leg.len, from: best.from, path: [best.from, { x: best.x, y: best.y }, { x: leg.x, y: leg.y }], box };
  }
  return { x: best.x, y: best.y, len: best.len, from: best.from, path: best.path, box };
}

/** Tesseract's words with boxes (sparse text), or null when Tesseract is missing or fails. */
export async function tesseractWords(image: Buffer): Promise<Word[] | null> {
  const dir = await mkdtemp(path.join(tmpdir(), "aria-leader-"));
  try {
    const file = path.join(dir, "picture.png");
    await writeFile(file, image);
    const tsv = await new Promise<string | null>((resolve) => execFile("tesseract", [file, "stdout", "--psm", "11", "tsv"], { timeout: 20_000, maxBuffer: 8 << 20 }, (error, stdout) => resolve(error ? null : String(stdout))));
    return tsv === null ? null : wordsFromTsv(tsv);
  } catch {
    return null;
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

/** Each label's leader end in the picture, as 0..1 fractions; labels with no leader found are left out. */
export async function leaderPoints(image: Buffer, labels: string[]): Promise<Map<string, LeaderEnd & { fx: number; fy: number }>> {
  const out = new Map<string, LeaderEnd & { fx: number; fy: number }>();
  const words = await tesseractWords(image);
  if (!words?.length) return out;
  const img = await loadImage(image);
  const canvas = createCanvas(img.width, img.height);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0);
  const px = ctx.getImageData(0, 0, img.width, img.height).data;
  for (const label of labels) {
    const box = labelBox(words, label);
    if (!box) continue;
    const end = leaderEnd(px, img.width, img.height, box, words);
    if (end) out.set(label, { ...end, fx: end.x / img.width, fy: end.y / img.height });
  }
  return out;
}

/**
 * REPOINT A PRINTED LABEL (free): the model's leader line is painted out — each pixel across the line
 * filled from the picture just beside it — and a new one of the same ink and weight is drawn from the
 * label's edge to the part. For a label whose line ends on the wrong part.
 */
export function repointLeader(ctx: { getImageData: (x: number, y: number, w: number, h: number) => { data: Uint8ClampedArray }; putImageData: (d: never, x: number, y: number) => void; beginPath: () => void; moveTo: (x: number, y: number) => void; lineTo: (x: number, y: number) => void; stroke: () => void; arc: (x: number, y: number, r: number, a: number, b: number) => void; fill: () => void; strokeStyle: unknown; fillStyle: unknown; lineWidth: number; lineCap: unknown }, W: number, H: number, leader: LeaderEnd, to: Pt): void {
  const image = ctx.getImageData(0, 0, W, H);
  const px = image.data;
  const get = (x: number, y: number) => {
    const o = (Math.min(H - 1, Math.max(0, Math.round(y))) * W + Math.min(W - 1, Math.max(0, Math.round(x)))) * 4;
    return [px[o], px[o + 1], px[o + 2]];
  };
  // The line's own ink, to draw the new one in.
  const inkSeen: number[][] = [];
  for (let i = 1; i < leader.path.length; i++) {
    const a = leader.path[i - 1], b = leader.path[i];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const dx = (b.x - a.x) / len, dy = (b.y - a.y) / len, nx = -dy, ny = dx;
    for (let t = 0; t <= len; t += 0.5) {
      const x = a.x + dx * t, y = a.y + dy * t;
      if (t % 8 === 0) inkSeen.push(get(x, y));
      const l = get(x + nx * 5, y + ny * 5), r = get(x - nx * 5, y - ny * 5);
      for (let k = -3.5; k <= 3.5; k += 0.5) {
        const w = (k + 5) / 10;
        const o = (Math.round(y + ny * k) * W + Math.round(x + nx * k)) * 4;
        if (o < 0 || o >= px.length) continue;
        for (let c = 0; c < 3; c++) px[o + c] = Math.round(r[c] * (1 - w) + l[c] * w);
      }
    }
  }
  ctx.putImageData(image as never, 0, 0);
  const dark = inkSeen.sort((p, q) => p[0] + p[1] + p[2] - (q[0] + q[1] + q[2]))[Math.floor(inkSeen.length / 4)] ?? [30, 30, 30];
  // From the side of the label that faces the part.
  const box = leader.box;
  const start = to.x >= box.x + box.w ? { x: box.x + box.w + 6, y: box.y + box.h / 2 } : to.x <= box.x ? { x: box.x - 6, y: box.y + box.h / 2 } : { x: box.x + box.w / 2, y: to.y < box.y ? box.y - 6 : box.y + box.h + 6 };
  ctx.strokeStyle = `rgb(${dark.join(",")})`;
  ctx.fillStyle = ctx.strokeStyle;
  ctx.lineWidth = 2.5;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(start.x, start.y);
  ctx.lineTo(to.x, to.y);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(to.x, to.y, 3.5, 0, Math.PI * 2);
  ctx.fill();
}

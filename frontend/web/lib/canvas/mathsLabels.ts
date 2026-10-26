import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { printedLabelBoxes, type Box } from "./labelLeaders";
import { symbolLabel } from "./pictureTalk";

/**
 * WHERE A MATHS PICTURE'S LABELS ARE PRINTED (owner, 2026-10-26: "the board doesn't really point out in maths
 * lecture if it had to explain any particular thing in the diagram"). A maths picture (lib/canvas/mathsPicture.ts)
 * labels its figure with single italic letters ("a", "C", "m") and short expressions ("a + b", "90°"); reading
 * the whole picture as a page, Tesseract drops them as noise (5 of 32 found on a Pythagoras lecture, all of
 * them words). Here every glyph-sized mark standing apart from the drawing is found, marks side by side are
 * joined into one label, and each is read on its own. A label is kept only when exactly one mark reads as it,
 * case included ("C" a vertex, "c" a side): a pointer that ends on it ends on the picture's own printed label.
 */
export async function mathsLabelBoxes(image: Buffer, labels: string[]): Promise<Map<string, Box>> {
  const words = [...new Set(labels.filter((l) => !symbolLabel(l)))];
  const out = words.length ? await printedLabelBoxes(image, words, { inverted: true }).catch(() => new Map<string, Box>()) : new Map<string, Box>();
  // Symbols are read mark by mark; so is a word the page reading missed ("theta" beside an angle), exactly.
  const rest = [...new Set(labels.filter((l) => !out.has(l)))];
  if (rest.length) for (const [label, box] of await symbolBoxes(image, rest).catch(() => new Map<string, Box>())) out.set(label, box);
  return out;
}

/** Each symbol label's printed box, as 0..1 fractions of the picture (white ink on black). */
async function symbolBoxes(image: Buffer, labels: string[]): Promise<Map<string, Box>> {
  const out = new Map<string, Box>();
  const { found, W, H } = await readSymbols(image);
  // A letter whose capital has the same shape ("c"/"C", "x"/"X") is read in either case from its shape alone;
  // its case is its height, measured against letters whose case is certain in the same picture.
  const heights = (letters: RegExp) => found.filter((t) => t.marks === 1 && letters.test(t.text)).map((t) => t.h).sort((a, b) => a - b);
  const median = (hs: number[]) => (hs.length ? hs[Math.floor(hs.length / 2)] : undefined);
  const small = median(heights(/^[aemnr]$/));
  const tall = median(heights(/^[ABDEFGHIJKLMNPQRTY]$|^[bdfhklt]$/));
  // Only a clear answer counts: labels are not all one size (an "s" larger than the "r" beside it), and a
  // lowercase "c" taken for a vertex "C" would point at the wrong label.
  const capital = (t: { h: number }): boolean | undefined => {
    if (small && tall) {
      if (tall < small * 1.12) return undefined;
      const d = (t.h - small) / (tall - small);
      return d >= 0.65 ? true : d <= 0.35 ? false : undefined;
    }
    if (small) return t.h >= small * 1.3 ? true : t.h <= small * 1.1 ? false : undefined;
    if (tall) return t.h >= tall * 0.92 ? true : t.h <= tall * 0.78 ? false : undefined;
    return undefined;
  };
  for (const label of labels) {
    const want = squash(label);
    const hits = SAME_SHAPE.test(want)
      ? found.filter((t) => t.marks === 1 && t.text.toLowerCase() === want.toLowerCase() && capital(t) === (want === want.toUpperCase()))
      : found.filter((t) => t.text === want);
    if (hits.length !== 1) continue;
    const hit = hits[0];
    out.set(label, { x: hit.x / W, y: hit.y / H, w: hit.w / W, h: hit.h / H });
  }
  return out;
}

/** Every label-like mark in the picture and what it reads (also for QA). */
export async function readSymbols(image: Buffer): Promise<{ found: Array<Token & { text: string }>; W: number; H: number }> {
  const img = await loadImage(image);
  const W = img.width;
  const H = img.height;
  const ctx = createCanvas(W, H).getContext("2d");
  ctx.drawImage(img, 0, 0);
  const { marks, order } = inkMarks(ctx.getImageData(0, 0, W, H).data, W, H);
  const tokens = groupMarks(marks, H);
  const read = await mapLimit(tokens, 4, (t) => readToken(t, order, W));
  return { found: tokens.map((t, i) => ({ ...t, text: read[i] ?? "" })).filter((t) => t.text), W, H };
}

const SAME_SHAPE = /^[cosuvwxz]$/i;
const squash = (t: string) => t.replace(/\s+/g, "").replace(/[−–—]/g, "-").replace(/[’′`]/g, "'");

/** A connected piece of ink: its box, and where its pixels are listed in `order`. */
type Mark = Box & { n: number; from: number };
export type Token = Box & { marks: number; parts: Mark[] };

/** Every connected piece of white ink no bigger than a printed character, with its pixels. */
function inkMarks(px: Uint8ClampedArray, W: number, H: number): { marks: Mark[]; order: Int32Array } {
  const ink = new Uint8Array(W * H);
  for (let i = 0, p = 0; i < W * H; i++, p += 4) ink[i] = px[p] * 0.3 + px[p + 1] * 0.59 + px[p + 2] * 0.11 > 128 ? 1 : 0;
  const stack = new Int32Array(W * H);
  // Every ink pixel, piece by piece: a piece's pixels are order[from .. from + n).
  const order = new Int32Array(W * H);
  let filled = 0;
  const marks: Mark[] = [];
  for (let start = 0; start < W * H; start++) {
    if (!ink[start]) continue;
    ink[start] = 0;
    let top = 0;
    stack[top++] = start;
    const from = filled;
    let x0 = W, y0 = H, x1 = 0, y1 = 0;
    while (top) {
      const i = stack[--top];
      order[filled++] = i;
      const x = i % W;
      const y = (i - x) / W;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= H) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= W) continue;
          const j = yy * W + xx;
          if (ink[j]) { ink[j] = 0; stack[top++] = j; }
        }
      }
    }
    const mark = { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1, n: filled - from, from };
    // Lines and shapes of the figure are far bigger than a character; specks are dropped.
    if (mark.h <= H * 0.1 && mark.w <= W * 0.08 && mark.n >= 6) marks.push(mark);
  }
  return { marks, order };
}

/**
 * Marks that make one label: side by side on a line ("a", "+", "b"), or stacked (the two bars of "=", the dot of
 * "i", a degree sign). A group with no character-sized mark (a stray tick or dot) is no label.
 */
function groupMarks(all: Mark[], H: number): Token[] {
  // A long thin stroke is a leader line or part of the figure, never part of a label: joined to "c" it
  // stretched the label's box to the end of its leader.
  const glyphs = all.filter((m) => m.h >= H * 0.02 && m.w >= m.h * 0.3 && m.w <= m.h * 2).map((m) => m.h).sort((a, b) => a - b);
  const glyph = glyphs.length ? glyphs[Math.floor(glyphs.length / 2)] : H * 0.04;
  const marks = all.filter((m) => !(Math.max(m.w, m.h) >= glyph * 1.25 && Math.min(m.w, m.h) <= Math.max(m.w, m.h) * 0.15));
  const parent = marks.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let a = 0; a < marks.length; a++) {
    for (let b = a + 1; b < marks.length; b++) {
      const p = marks[a];
      const q = marks[b];
      const tall = Math.max(p.h, q.h);
      const gapX = Math.max(0, Math.max(p.x, q.x) - Math.min(p.x + p.w, q.x + q.w));
      const gapY = Math.max(0, Math.max(p.y, q.y) - Math.min(p.y + p.h, q.y + q.h));
      const overlapX = Math.min(p.x + p.w, q.x + q.w) - Math.max(p.x, q.x);
      const sameLine = Math.abs(p.y + p.h / 2 - (q.y + q.h / 2)) <= tall * 0.5 && gapX <= tall * 0.9;
      const stacked = overlapX >= Math.min(p.w, q.w) * 0.4 && gapY <= tall * 0.5;
      if (sameLine || stacked) parent[find(a)] = find(b);
    }
  }
  const groups = new Map<number, Mark[]>();
  marks.forEach((m, i) => groups.set(find(i), [...(groups.get(find(i)) ?? []), m]));
  const tokens: Token[] = [];
  for (const parts of groups.values()) {
    if (!parts.some((m) => m.h >= H * 0.02)) continue;
    const x = Math.min(...parts.map((m) => m.x));
    const y = Math.min(...parts.map((m) => m.y));
    const token = { x, y, w: Math.max(...parts.map((m) => m.x + m.w)) - x, h: Math.max(...parts.map((m) => m.y + m.h)) - y, marks: parts.length, parts };
    // One mark is one character: a leader line or a side grown into it ("b" with its line, read "b.") would
    // put the label's box where the letter is not.
    if (parts.length === 1 && (token.w > token.h * 1.6 || token.w < token.h * 0.15 || token.h > glyph * 1.6)) continue;
    tokens.push(token);
  }
  return tokens;
}

/** One label read from its own ink only (nothing of the figure around it), black on white, at a size Tesseract reads well. */
async function readToken(t: Token, order: Int32Array, W: number): Promise<string | null> {
  const pad = Math.round(t.h * 0.35);
  const cw = t.w + pad * 2;
  const ch = t.h + pad * 2;
  const crop = createCanvas(cw, ch);
  const cctx = crop.getContext("2d");
  const data = cctx.createImageData(cw, ch);
  data.data.fill(255);
  for (const m of t.parts) {
    for (let k = m.from; k < m.from + m.n; k++) {
      const i = order[k];
      const x = (i % W) - t.x + pad;
      const y = Math.floor(i / W) - t.y + pad;
      const o = (y * cw + x) * 4;
      data.data[o] = data.data[o + 1] = data.data[o + 2] = 0;
    }
  }
  cctx.putImageData(data, 0, 0);
  const scale = Math.min(4, Math.max(0.5, 56 / t.h));
  const border = 24;
  const canvas = createCanvas(Math.round(cw * scale) + border * 2, Math.round(ch * scale) + border * 2);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(crop, border, border, canvas.width - border * 2, canvas.height - border * 2);
  const dir = await mkdtemp(path.join(tmpdir(), "aria-mathslabel-"));
  try {
    const file = path.join(dir, "label.png");
    await writeFile(file, await canvas.encode("png"));
    const run = (psm: string) => new Promise<string>((resolve) => execFile("tesseract", [file, "stdout", "--psm", psm, "-c", `tessedit_char_whitelist=${WHITELIST}`], { timeout: 10_000 }, (error, stdout) => resolve(error ? "" : squash(String(stdout)))));
    if (t.marks !== 1) return await run("7");
    // One mark, one character. Read as a lone character it is sometimes doubled ("mM" for "m"); read as a
    // word, the one character inside that reading settles it — otherwise it is not read at all.
    const char = await run("10");
    if (char.length <= 1) return char;
    const word = await run("8");
    return word.length === 1 && char.includes(word) ? word : null;
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

const WHITELIST = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+-=°'()/.,";

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<Array<R | null>> {
  const out: Array<R | null> = new Array(items.length).fill(null);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]).catch(() => null);
    }
  }));
  return out;
}

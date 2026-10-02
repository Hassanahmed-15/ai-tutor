import type { CanvasStage } from "./types";

/**
 * THE BOARD'S SURFACE — paper (the canvas as it has always looked), chalkboard, or a classroom mix
 * of the two. Pure, so it is unit-tested (lib/anim/lessonCanvas.test.ts).
 *
 * A theme never touches generation: boards are drawn from data, so the same lecture — new or from
 * history — can be shown on either surface. Two mechanisms recolour a chalk board, neither of which
 * costs anything per camera frame (no filters, no blend modes):
 *
 *   - the lesson's own colours (a node, a token, a curve) are lightened to chalk pastels before the
 *     board is laid out — `recolour` with `chalkTint`;
 *   - the renderer's fixed colours (ink, paper, card white, faint lines, the details inside icons)
 *     are swapped by CSS scoped to the board — `chalkCss`. A CSS fill beats an SVG fill attribute.
 */

export type BoardTheme = "paper" | "chalk";
export const CANVAS_THEMES = ["paper", "chalk", "mix"] as const;
export type CanvasThemeChoice = (typeof CANVAS_THEMES)[number];

export const THEME_LABEL: Record<CanvasThemeChoice, string> = { paper: "Paper", chalk: "Chalkboard", mix: "Mix" };

/**
 * The surface one board is drawn on. "mix" is a classroom: the working — equations, graphs, a
 * process — goes on the chalkboard; pictures, comparisons and scenes are pinned-up paper.
 */
export function panelTheme(choice: CanvasThemeChoice, stage: CanvasStage): BoardTheme {
  if (choice === "mix") return stage === "equation" || stage === "graph" || stage === "flow" ? "chalk" : "paper";
  return choice;
}

/** The chalkboard's own colours. */
export const CHALK = {
  slate: "#22302a",
  card: "#2c3b34",
  chalk: "#f1eee4",
  muted: "#b9c3be",
  line: "rgba(241,238,228,0.22)",
  frame: "#6b4423",
  frameLight: "#9a6a3c",
};

function hexToHsl(hex: string): [number, number, number] | null {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const h = m[1].length === 3 ? m[1].split("").map((c) => c + c).join("") : m[1];
  const r = parseInt(h.slice(0, 2), 16) / 255;
  const g = parseInt(h.slice(2, 4), 16) / 255;
  const b = parseInt(h.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const hue = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [hue * 60, s, l];
}

function hslToHex(h: number, s: number, l: number): string {
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const c = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(c * 255).toString(16).padStart(2, "0");
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

/**
 * A colour as chalk: the same hue, lifted to a soft pastel that reads on a dark slate. Colours that
 * are already light are left alone; greys become chalk greys. Idempotent, so tinting twice is safe.
 */
export function chalkTint(color: string): string {
  const hsl = hexToHsl(color);
  if (!hsl) return color;
  const [h, s, l] = hsl;
  if (l >= 0.62) return color;
  if (s < 0.15) return hslToHex(h, s, 0.8);
  return hslToHex(h, Math.max(0.45, Math.min(0.85, s)), 0.72);
}

/** A copy of a board's data with every `color` passed through `fn` (specs and layouts alike). */
export function recolour<T>(value: T, fn: (color: string) => string): T {
  if (Array.isArray(value)) return value.map((v) => recolour(v, fn)) as T;
  if (!value || typeof value !== "object") return value;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = k === "color" && typeof v === "string" ? fn(v) : recolour(v, fn);
  }
  return out as T;
}

/** The renderer's fixed colours, and what each becomes on a chalkboard. */
const FIXED: Record<string, string> = {
  "#1f2937": CHALK.chalk, // ink: text, axes, callout lines
  "#64748b": CHALK.muted, // muted ink
  "#fbfaf6": CHALK.slate, // the paper itself, and the paper behind arrow labels
};

/**
 * Every other dark colour the renderer draws with (inside icons, graph defaults): each becomes its
 * chalk tint. Light fills inside icons stay as they are — pale chalk colouring-in.
 */
const RENDERER_COLOURS = [
  "#0284c7", "#15803d", "#16a34a", "#1d4ed8", "#1e3a8a", "#2563eb", "#334155", "#475569", "#4d7c0f",
  "#6d28d9", "#92400e", "#991b1b", "#a16207", "#be123c", "#c2410c", "#ca8a04", "#d97706", "#ea580c",
];

/** The CSS that turns a board inside `.cv-chalk` into chalk. */
export function chalkCss(): string {
  const rules: string[] = [];
  const swap = (from: string, to: string) => rules.push(`.cv-chalk [fill="${from}"]{fill:${to}}`, `.cv-chalk [stroke="${from}"]{stroke:${to}}`);
  for (const [from, to] of Object.entries(FIXED)) swap(from, to);
  for (const c of RENDERER_COLOURS) swap(c, chalkTint(c));
  rules.push(
    // White cards (callout pills, compare items) become slate cards; a photo's own border is not white.
    `.cv-chalk rect[fill="#fff"],.cv-chalk rect[fill="#ffffff"]{fill:${CHALK.card}}`,
    `.cv-chalk [stroke="#e7e2d6"]{stroke:${CHALK.line}}`,
    // The highlighter multiplies on paper; on a dark board multiply would erase it.
    `.cv-chalk .cv-swipe{mix-blend-mode:screen !important;stroke-opacity:.42}`,
  );
  return rules.join("");
}

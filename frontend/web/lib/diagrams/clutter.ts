import type { FigureDrawing, FigureShape } from "../figures/types";
import { pathSamples } from "./ink";

/**
 * WORDS THAT CANNOT BE READ. A drawn diagram of light shipped "Longer wavelength" printed across a blue
 * box, the gap and a red box, with an arrow running through "absorbed energy" (owner screenshot,
 * 2026-10-18): nothing checked where the words sat against the lines. Pure geometry over the drawing:
 * a word crossed by another shape's outline or arrow, or printed over another word, is a collision.
 * A word inside a filled box, clear of its border, is fine — that is a labelled box.
 */

type Rect = { x: number; y: number; w: number; h: number };

/** The box a text shape's words take (a sans face averages ~0.56 em per character). */
export function textRect(sh: Extract<FigureShape, { t: "text" }>): Rect {
  const w = sh.text.length * sh.size * 0.56;
  const x = sh.anchor === "middle" ? sh.x - w / 2 : sh.anchor === "end" ? sh.x - w : sh.x;
  return { x, y: sh.y - sh.size * 0.78, w, h: sh.size * 1.0 };
}

const inside = (r: Rect, x: number, y: number) => x > r.x + 1 && x < r.x + r.w - 1 && y > r.y + 1 && y < r.y + r.h - 1;
const overlap = (a: Rect, b: Rect) => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));

/** Points along every non-text outline, each with the shape it belongs to. */
function outlinePoints(shapes: FigureShape[]): Array<{ x: number; y: number; shape: number }> {
  const out: Array<{ x: number; y: number; shape: number }> = [];
  shapes.forEach((sh, shape) => {
    if (sh.t === "path") {
      const { points } = pathSamples(sh.d);
      // Dense enough that a line crossing a 14 px word leaves a point inside it.
      for (let i = 0; i < points.length; i++) {
        const [x0, y0] = points[i];
        const [x1, y1] = points[Math.min(points.length - 1, i + 1)];
        const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / 4));
        for (let k = 0; k < n; k++) out.push({ x: x0 + ((x1 - x0) * k) / n, y: y0 + ((y1 - y0) * k) / n, shape });
      }
    } else if (sh.t === "circle") {
      const n = Math.max(12, Math.ceil((2 * Math.PI * sh.r) / 4));
      for (let k = 0; k < n; k++) out.push({ x: sh.cx + sh.r * Math.cos((2 * Math.PI * k) / n), y: sh.cy + sh.r * Math.sin((2 * Math.PI * k) / n), shape });
    }
  });
  return out;
}

/** Each word that a line runs through or another word covers, described for the board writer. */
export function textCollisions(drawing: Pick<FigureDrawing, "shapes">): string[] {
  const texts = drawing.shapes.map((sh, i) => ({ sh, i })).filter((t): t is { sh: Extract<FigureShape, { t: "text" }>; i: number } => t.sh.t === "text" && t.sh.text.trim().length > 1);
  if (!texts.length) return [];
  const ink = outlinePoints(drawing.shapes);
  const issues: string[] = [];
  const rects = texts.map((t) => textRect(t.sh));
  texts.forEach((t, k) => {
    const r = rects[k];
    // Three or more outline points inside the word's box: a line runs through it, not beside it.
    const crossing = ink.filter((p) => inside(r, p.x, p.y)).length;
    if (crossing >= 3) issues.push(`"${t.sh.text}" has a line or arrow drawn through it`);
    for (let j = k + 1; j < texts.length; j++) {
      const area = overlap(r, rects[j]);
      if (area > 0.2 * Math.min(r.w * r.h, rects[j].w * rects[j].h)) issues.push(`"${t.sh.text}" is printed over "${texts[j].sh.text}"`);
    }
  });
  return [...new Set(issues)];
}

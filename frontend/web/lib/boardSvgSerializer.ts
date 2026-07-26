import type { DrawScript } from "@/components/sketch/LiveSketch";
import { stripInlineMath } from "./drawSanitize";

/**
 * Server-side approximation of how LiveSketch renders a board, as a static SVG string. Used ONLY by
 * the vision critic (lib/boardVisionCritic.ts) to rasterize a board and let a vision model judge
 * legibility/overlap/coverage — it does NOT need to be pixel-perfect, just faithful in layout
 * (text at the right grid positions, sized like the client) so overlaps/clipping are visible.
 * Grid is 0-100; the board viewBox is 1000x560, matching LiveSketch (VB_W/VB_H).
 */

const VB_W = 1000;
const VB_H = 560;

type DrawOp = DrawScript["ops"][number];

const gx = (x: number) => (x / 100) * VB_W;
const gy = (y: number) => (y / 100) * VB_H;

function anchorFor(x: number): "start" | "middle" | "end" {
  if (x <= 24) return "start";
  if (x >= 76) return "end";
  return "middle";
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// Math shown as readable plain text for the critic (KaTeX isn't available in the rasterizer).
const flat = (s: string) => stripInlineMath(String(s ?? ""));

function textEl(text: string, x: number, y: number, size: number, color: string, weight: number): string {
  const anchor = anchorFor(x);
  return `<text x="${gx(x).toFixed(1)}" y="${gy(y).toFixed(1)}" font-size="${size}" font-family="'Comic Sans MS','Trebuchet MS',sans-serif" font-weight="${weight}" fill="${color}" text-anchor="${anchor}">${esc(flat(text))}</text>`;
}

function serializeOp(op: DrawOp, paper: boolean): string {
  switch (op.kind) {
    case "chalkBoard": {
      // Unwrap the engine-filled chalk ops.
      return (op.ops ?? []).map((sub) => serializeOp(sub as DrawOp, paper)).join("");
    }
    case "label": {
      const size = op.size === "lg" ? 34 : op.size === "sm" ? 20 : 27;
      const color = op.color && op.color !== "#1e293b" ? op.color : paper ? "#374151" : "#f8fafc";
      return textEl(op.text, op.x, op.y, size, color, 700);
    }
    case "note": {
      const color = op.color && op.color !== "#1e293b" ? op.color : paper ? "#4b5563" : "#e5e7eb";
      return textEl(op.text, op.x, op.y, 18, color, 400);
    }
    case "callout": {
      const lx = op.labelX ?? op.x;
      const ly = op.labelY ?? op.y;
      const color = op.color ?? (paper ? "#0e5f76" : "#38bdf8");
      const line = `<line x1="${gx(op.x).toFixed(1)}" y1="${gy(op.y).toFixed(1)}" x2="${gx(lx).toFixed(1)}" y2="${gy(ly).toFixed(1)}" stroke="${color}" stroke-width="2" />`;
      return line + textEl(op.text, lx, ly, 20, color, 700);
    }
    case "image": {
      const iop = op as DrawOp & { src?: string; w?: number; h?: number };
      if (!iop.src) return "";
      const w = gx(op.w ?? 60);
      const h = gy(op.h ?? 50);
      const ix = gx(op.x) - w / 2;
      const iy = gy(op.y) - h / 2;
      return `<image href="${iop.src}" x="${ix.toFixed(1)}" y="${iy.toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" preserveAspectRatio="xMidYMid meet" />`;
    }
    case "arrow": {
      const color = op.color ?? (paper ? "#6b7280" : "#94a3b8");
      return `<line x1="${gx(op.x1).toFixed(1)}" y1="${gy(op.y1).toFixed(1)}" x2="${gx(op.x2).toFixed(1)}" y2="${gy(op.y2).toFixed(1)}" stroke="${color}" stroke-width="3" />`;
    }
    default:
      return "";
  }
}

/** Serialize a board DrawScript to a standalone SVG string (1000x560). */
export function boardToSvg(draw: DrawScript | undefined): string {
  if (!draw) return "";
  const paper = draw.surface !== "dark";
  const bg = paper ? "#faf9f5" : "#020617";
  const title = draw.caption ? textEl(draw.caption, 50, 7, 30, paper ? "#6b7280" : "#e5e7eb", 700) : "";
  const body = (draw.ops ?? []).map((op) => serializeOp(op, paper)).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${VB_W}" height="${VB_H}" viewBox="0 0 ${VB_W} ${VB_H}"><rect width="${VB_W}" height="${VB_H}" fill="${bg}" />${title}${body}</svg>`;
}

import { Resvg } from "@resvg/resvg-js";
import { layoutPanel, type Mark } from "../canvas/layout";
import type { CanvasBoardSpec } from "../canvas/types";
import type { FigureShape } from "../figures/types";

const W = 1000, H = 560;
const INK = "#1f2937";

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function fillOf(ink?: string): string {
  if (!ink || ink === "none") return "none";
  if (ink === "ink") return INK;
  if (ink === "paper") return "#fbfaf6";
  if (ink === "glass") return "#bfdbfe";
  if (ink === "metal") return "#94a3b8";
  if (ink === "wood") return "#b45309";
  if (ink === "muted") return "#64748b";
  return ink;
}

function shapeSvg(sh: FigureShape, ox: number, oy: number, k: number): string {
  const fill = fillOf("fill" in sh ? sh.fill : undefined);
  const stroke = fillOf("stroke" in sh ? sh.stroke : "ink");
  const width = (("width" in sh ? sh.width : 1.6) ?? 1.6) * Math.max(0.6, k);
  const op = "opacity" in sh && sh.opacity != null ? ` opacity="${sh.opacity}"` : "";
  const dash = "dash" in sh && sh.dash ? ` stroke-dasharray="${sh.dash}"` : "";
  if (sh.t === "circle") return `<circle cx="${ox + sh.cx * k}" cy="${oy + sh.cy * k}" r="${sh.r * k}" fill="${fill}" stroke="${stroke}" stroke-width="${width}"${op}${dash}/>`;
  if (sh.t === "text") return `<text x="${ox + sh.x * k}" y="${oy + sh.y * k}" font-size="${sh.size * k}" text-anchor="${sh.anchor ?? "middle"}" fill="${fill === "none" ? INK : fill}" font-family="DejaVu Sans, sans-serif"${op}>${esc(sh.text)}</text>`;
  return `<path d="${sh.d.replace(/(-?\d+\.?\d*)/g, (n) => {
    // Translate only absolute path commands that start a pair after M/L — figures already bake coordinates.
    return n;
  })}" transform="translate(${ox} ${oy}) scale(${k})" fill="${fill}" stroke="${stroke}" stroke-width="${(Number(("width" in sh ? sh.width : 1.6)) || 1.6)}"${op}${dash} fill-rule="evenodd"/>`;
}

/**
 * A timed figure shape (lib/figures/types.ts ShapeTiming) in the figure's FINISHED form, the way a
 * student sees it once Aria has said everything: hidden shapes gone, moved shapes in their new place.
 */
function finishedShapeSvg(sh: FigureShape, ox: number, oy: number, k: number): string {
  if (sh.hide) return "";
  if (!sh.move) return shapeSvg(sh, ox, oy, k);
  const { dx, dy, rotate } = sh.move;
  const moved = shapeSvg(sh, ox + dx * k, oy + dy * k, k);
  if (!rotate) return moved;
  const pts = sh.t === "path" ? [...sh.d.matchAll(/(-?\d+\.?\d*)[ ,](-?\d+\.?\d*)/g)].map((p) => ({ x: Number(p[1]), y: Number(p[2]) })) : sh.t === "circle" ? [{ x: sh.cx, y: sh.cy }] : [{ x: sh.x, y: sh.y }];
  if (!pts.length) return moved;
  const cx = ox + (dx + (Math.min(...pts.map((p) => p.x)) + Math.max(...pts.map((p) => p.x))) / 2) * k;
  const cy = oy + (dy + (Math.min(...pts.map((p) => p.y)) + Math.max(...pts.map((p) => p.y))) / 2) * k;
  return `<g transform="rotate(${rotate} ${cx} ${cy})">${moved}</g>`;
}

function markSvg(m: Mark): string {
  if (m.type === "heading") return `<text x="${m.x}" y="${m.y}" font-size="${m.size}" font-weight="700" fill="${INK}" font-family="DejaVu Sans, sans-serif">${esc(m.text)}</text>`;
  if (m.type === "note") return m.lines.map((line, i) => `<text x="${m.x}" y="${m.y + i * (m.size + 4)}" font-size="${m.size}" fill="${INK}" font-family="DejaVu Sans, sans-serif">${esc(line)}</text>`).join("");
  if (m.type === "figure") return m.drawing.shapes.map((sh) => finishedShapeSvg(sh, m.rect.x, m.rect.y, m.scale)).join("");
  if (m.type === "figure-label") {
    const d = m.leader.map((p, i) => `${i ? "L" : "M"}${p.x} ${p.y}`).join(" ");
    const lines = m.lines.map((line, i) => `<text x="${m.at.x}" y="${m.at.y + i * (m.size + 2)}" font-size="${m.size}" text-anchor="${m.side === "left" ? "end" : "start"}" fill="${INK}" font-family="DejaVu Sans, sans-serif">${esc(line)}</text>`).join("");
    return `<path d="${d}" fill="none" stroke="${INK}" stroke-width="1.2"/>${lines}`;
  }
  if (m.type === "text") return `<text x="${m.rect.x}" y="${m.rect.y + m.size}" font-size="${m.size}" fill="${m.color || INK}" font-family="DejaVu Sans, sans-serif">${esc(m.text)}</text>`;
  if (m.type === "box") return `<rect x="${m.rect.x}" y="${m.rect.y}" width="${m.rect.w}" height="${m.rect.h}" rx="8" fill="#fff" stroke="${m.color || INK}" /><text x="${m.rect.x + 8}" y="${m.rect.y + 22}" font-size="${m.size}" fill="${INK}" font-family="DejaVu Sans, sans-serif">${esc(m.label ?? "")}</text>`;
  if (m.type === "equation") {
    return m.tokens.map((t) => {
      const p = m.steps[m.steps.length - 1]?.place[t.id];
      if (!p) return "";
      return `<text x="${p.x}" y="${p.y}" font-size="${t.size}" fill="${t.color || INK}" font-family="DejaVu Sans, sans-serif">${esc(t.text)}</text>`;
    }).join("");
  }
  return "";
}

export function boardSvg(spec: CanvasBoardSpec): string {
  const layout = layoutPanel(spec);
  // Complete-board snapshot: the notes column keeps four at a time and wipes; expired
  // notes (until set) would otherwise stack on the last page.
  const body = layout.marks.filter((m) => !((m.type === "note" || m.type === "equation") && m.until !== undefined)).map(markSvg).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}"><rect width="${W}" height="${H}" rx="22" fill="#fbfaf6"/>${body}</svg>`;
}

export function boardPng(spec: CanvasBoardSpec): Buffer {
  const resvg = new Resvg(boardSvg(spec), { fitTo: { mode: "width", value: 1000 } });
  return Buffer.from(resvg.render().asPng());
}

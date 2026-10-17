import { existsSync } from "node:fs";
import { BOARD_FONT_FACES } from "../anim/boardFont";
import { appPath } from "../appPaths";
import { placeLabels } from "../figures/labels";
import type { FigureDrawing, FigureShape } from "../figures/types";

/**
 * A DIAGRAM AS THE STUDENT WILL SEE IT, AS AN IMAGE: the art scaled into the figure area and its labels
 * placed in the margins by the same label engine the board uses (lib/figures/labels.ts), in the board
 * font. The vision check (lib/diagrams/write.ts) judges this picture, so what it passes is what ships.
 */

const W = 1000, H = 600;
const INK = "#1f2937";
const FONT = BOARD_FONT_FACES[0]?.family ?? "sans-serif";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
function colour(ink?: string): string {
  if (!ink || ink === "none") return "none";
  return ({ ink: INK, paper: "#fbfaf6", glass: "#bfdbfe", metal: "#94a3b8", wood: "#b45309", muted: "#64748b" } as Record<string, string>)[ink] ?? ink;
}

function shapeSvg(sh: FigureShape): string {
  const fill = colour("fill" in sh ? sh.fill : undefined);
  const stroke = colour(sh.stroke ?? (sh.t === "text" ? "none" : "ink"));
  const common = `${sh.opacity != null ? ` opacity="${sh.opacity}"` : ""}${sh.dash ? ` stroke-dasharray="${sh.dash}"` : ""}`;
  if (sh.t === "circle") return `<circle cx="${sh.cx}" cy="${sh.cy}" r="${sh.r}" fill="${fill}" stroke="${stroke}" stroke-width="${sh.width ?? 1.6}"${common}/>`;
  if (sh.t === "text") return `<text x="${sh.x}" y="${sh.y}" font-size="${sh.size}" text-anchor="${sh.anchor ?? "middle"}" fill="${fill === "none" ? INK : fill}" font-family="${FONT}"${common}>${esc(sh.text)}</text>`;
  return `<path d="${sh.d}" fill="${fill}" stroke="${stroke}" stroke-width="${sh.width ?? 1.6}" stroke-linejoin="round" stroke-linecap="round"${common}/>`;
}

/** The SVG of a diagram with these labels (part id → the name shown). */
export function diagramSvg(drawing: FigureDrawing, labels: Array<{ id: string; name: string }> = drawing.parts.map((p) => ({ id: p.id, name: p.name }))): string {
  const named = labels.filter((l) => drawing.parts.some((p) => p.id === l.id));
  const margin = named.length ? 220 : 30;
  const k = Math.min((W - margin * 2) / drawing.w, (H - 60) / drawing.h);
  const fig = { x: (W - drawing.w * k) / 2, y: (H - drawing.h * k) / 2, w: drawing.w * k, h: drawing.h * k };
  const measure = (text: string, size: number) => text.length * size * 0.56;
  const placed = placeLabels(
    named.map((l, i) => {
      const p = drawing.parts.find((q) => q.id === l.id)!;
      return { id: l.id, text: l.name, anchor: { x: fig.x + p.anchor.x * k, y: fig.y + p.anchor.y * k }, s: i };
    }),
    fig,
    { x: 12, y: 12, w: W - 24, h: H - 24 },
    measure,
    17,
  );
  const art = `<g transform="translate(${fig.x} ${fig.y}) scale(${k})">${drawing.shapes.map(shapeSvg).join("")}</g>`;
  const marks = placed.map((m) => {
    const d = m.leader.map((p, i) => `${i ? "L" : "M"}${p.x} ${p.y}`).join(" ");
    const end = m.leader[m.leader.length - 1];
    const text = m.lines.map((line, i) => `<text x="${m.at.x}" y="${m.at.y + i * m.size * 1.25}" font-size="${m.size}" text-anchor="${m.side === "left" ? "end" : "start"}" fill="${INK}" font-family="${FONT}">${esc(line)}</text>`).join("");
    return `<path d="${d}" fill="none" stroke="${INK}" stroke-width="1.3"/>${end ? `<circle cx="${end.x}" cy="${end.y}" r="3" fill="${INK}"/>` : ""}${text}`;
  }).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}"><rect width="${W}" height="${H}" fill="#fbfaf6"/>${art}${marks}</svg>`;
}

let fontFiles: string[] | null = null;
/** The board font's files for resvg (system fonts otherwise — a Linux container may have none). */
function boardFonts(): string[] {
  if (!fontFiles) fontFiles = BOARD_FONT_FACES.map((f) => appPath("public", "fonts", f.file)).filter((f) => existsSync(f));
  return fontFiles;
}

/** The diagram as a PNG, or null when the rasteriser is unavailable. */
export async function diagramPng(drawing: FigureDrawing, labels?: Array<{ id: string; name: string }>): Promise<Buffer | null> {
  try {
    const { Resvg } = await import("@resvg/resvg-js");
    const resvg = new Resvg(diagramSvg(drawing, labels), { fitTo: { mode: "width", value: W }, font: { fontFiles: boardFonts(), loadSystemFonts: true, defaultFontFamily: FONT } });
    return Buffer.from(resvg.render().asPng());
  } catch (error) {
    console.error(`[diagram] render failed: ${(error as Error).message}`);
    return null;
  }
}

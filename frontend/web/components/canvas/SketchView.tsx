"use client";

import katex from "katex";
import { texEm, textWidth, type Mark, type Rect, type SketchPlaced } from "@/lib/canvas/layout";
import { SKETCH_TEX_MACROS } from "@/lib/canvas/sketch";
import type { SketchColor, SketchItem, SketchShape } from "@/lib/canvas/types";
import { evalExpr } from "@/lib/canvas/expr";

/**
 * A SKETCH BOARD, DRAWN (2026-10-20): the Visuals Lab's way of drawing a maths or computer-science
 * board, from a spec the board writer made live (lib/canvas/sketch.ts) and code placed
 * (layout.ts layoutSketch). Each thing mounts on its sentence; the marker (MarkerWriter) writes every
 * piece of writing as it mounts, strokes draw themselves on, and shapes slide or turn on the
 * sentence the narration describes it — the motion is the explanation.
 */

/** One colour per quantity: white and bright colours on the black board (owner, 2026-10-21). */
const INK: Record<SketchColor, string> = { ink: "#ffffff", muted: "#a3a3a3", blue: "#60a5fa", orange: "#fb923c", green: "#4ade80", pink: "#f472b6", yellow: "#facc15" };
const MONO = "ui-monospace, 'JetBrains Mono', SFMono-Regular, Menlo, Consolas, monospace";
const BOARD_FONT = "'Aria Board', Nunito, system-ui, sans-serif";
const MOVE = "transform 1100ms cubic-bezier(.65,0,.25,1), opacity 450ms ease";

/** Width of writing at size 1 (TeX by its em estimate). */
const unitWidth = (t: string) => t.split(/(\$[^$]+\$)/).reduce((w, part) => w + (/^\$[^$]+\$$/.test(part) ? texEm(part.slice(1, -1).replace(/\\(?:blue|orange|green|pink|yellow|muted)\b/g, "")) * 1.05 : textWidth(part, 1)), 0);

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const tex = (src: string) => katex.renderToString(src, { throwOnError: false, output: "html", macros: { ...SKETCH_TEX_MACROS } });
/** Writing with $…$ maths in it, as HTML. */
const writingHtml = (t: string) => t.split(/(\$[^$]+\$)/).map((part) => (/^\$[^$]+\$$/.test(part) ? tex(part.slice(1, -1)) : esc(part))).join("");

function Writing({ x, y, w, h, html, size, color = INK.ink, weight = 600, align = "left", font = BOARD_FONT }: { x: number; y: number; w: number; h: number; html: string; size: number; color?: string; weight?: number; align?: "left" | "center"; font?: string }) {
  return (
    <foreignObject x={x} y={y} width={Math.max(4, w)} height={Math.max(4, h)} overflow="visible">
      <div style={{ fontFamily: font, fontSize: size, fontWeight: weight, color, lineHeight: 1.3, textAlign: align, whiteSpace: "nowrap" }}>
        {/* The writing itself, measured by the marker (MarkerWriter writes the words, not the box). */}
        <span data-ink-content="" style={{ display: "inline-block" }} dangerouslySetInnerHTML={{ __html: html }} />
      </div>
    </foreignObject>
  );
}

const TEXT_UNIT: Partial<Record<SketchPlaced["item"]["type"], "move" | "fixed">> = { text: "move", math: "move", table: "fixed", code: "fixed", box: "fixed" };

export function SketchView({ mark, shownThrough }: { mark: Extract<Mark, { type: "sketch" }>; shownThrough: number }) {
  return (
    <g data-sketch="">
      {mark.items
        .filter((p) => p.item.s <= shownThrough)
        .map((p) => (
          // Writing and working move as one piece if they must give way; a table, code or box never moves
          // (components/canvas/TextDeconflict.tsx). Labels on shapes and graphs move one by one.
          <g key={p.item.id} data-target={p.item.id} className="cv-in" data-text-unit={TEXT_UNIT[p.item.type]}>
            <SketchItemView p={p} shownThrough={shownThrough} />
          </g>
        ))}
    </g>
  );
}

/** How many text lines tall a line of maths stands (a fraction ≈ 2.2). */
const texHeight = (src: string) => (/\\[dt]?frac/.test(src) ? 2.2 : /\\sqrt|\^/.test(src) ? 1.5 : 1.3);

/** A stacked step label's line height: up to 28, never more than 40% of its line. */
const stack = (lineH: number) => Math.min(28, lineH * 0.4);

function SketchItemView({ p, shownThrough }: { p: SketchPlaced; shownThrough: number }) {
  const { item, rect, size } = p;
  switch (item.type) {
    case "text":
      return (
        <>
          {(p.lines ?? [item.text]).map((line, i) => (
            <Writing key={i} x={rect.x} y={rect.y + i * size * 1.32} w={rect.w} h={size * 1.32} html={writingHtml(line)} size={size} color={INK[item.color ?? "ink"]} weight={item.size === "big" ? 800 : 600} />
          ))}
        </>
      );
    case "math":
      return (
        <>
          {item.lines.map((l, i) =>
            l.s <= shownThrough ? (
              <g key={i} data-target={`${item.id}-l${i + 1}`}>
                {l.label && p.labelW ? <Writing x={rect.x} y={rect.y + i * p.lineH! + (p.lineH! - 19 * 1.3) / 2} w={p.labelW - 12} h={p.lineH!} html={writingHtml(l.label)} size={19} color={INK.muted} /> : null}
                {/* Stacked: the step's label on its own line above its working, with room between them. */}
                {l.label && !p.labelW ? <Writing x={rect.x} y={rect.y + i * p.lineH! + 2} w={rect.w} h={stack(p.lineH!)} html={writingHtml(l.label)} size={Math.round(stack(p.lineH!) * 0.62)} color={INK.muted} /> : null}
                {/* Centred by its real height: a fraction stands ~2.2 lines tall, and centred as one line
                    its denominator hung into the next step's label (maths benchmark, 2026-10-21). */}
                <Writing x={rect.x + (p.labelW ?? 0)} y={rect.y + i * p.lineH! + (l.label && !p.labelW ? stack(p.lineH!) + 2 : 0) + Math.max(0, (p.lineH! - (l.label && !p.labelW ? stack(p.lineH!) + 2 : 0) - size * texHeight(l.tex)) / 2)} w={rect.w - (p.labelW ?? 0)} h={p.lineH!} html={tex(l.tex)} size={size} weight={400} />
              </g>
            ) : null,
          )}
        </>
      );
    case "shapes":
      return <Shapes p={p} shownThrough={shownThrough} />;
    case "graph":
      return <Graph p={p} shownThrough={shownThrough} />;
    case "table":
      return <Table p={p} shownThrough={shownThrough} />;
    case "box": {
      const color = INK[item.color ?? "yellow"];
      const titleH = item.title ? 22 : 0;
      return (
        <>
          <rect x={rect.x} y={rect.y} width={rect.w} height={rect.h} rx={14} fill="rgba(255,255,255,0.04)" stroke={color} strokeWidth={2.5} />
          {item.title && <Writing x={rect.x + 15} y={rect.y + 10} w={rect.w - 30} h={18} html={esc(item.title.toUpperCase())} size={13} color={INK.muted} weight={800} />}
          {(p.lines ?? [item.text]).map((line, i) => (
            <Writing key={i} x={rect.x + 15} y={rect.y + 12 + titleH + i * size * 1.38} w={rect.w - 30} h={size * 1.38} html={writingHtml(line)} size={size} />
          ))}
        </>
      );
    }
    case "code":
      return <Code p={p} shownThrough={shownThrough} />;
  }
}

/* ── shapes on a grid ──────────────────────────────────────────────────────────────────────── */

function shapeCentre(sh: SketchShape): [number, number] {
  if (sh.kind === "rect") return [sh.x! + sh.w! / 2, sh.y! + sh.h! / 2];
  if (sh.kind === "circle" || sh.kind === "label") return [sh.x!, sh.y!];
  const pts = sh.points!;
  return [pts.reduce((t, q) => t + q[0], 0) / pts.length, pts.reduce((t, q) => t + q[1], 0) / pts.length];
}

function Shapes({ p, shownThrough }: { p: SketchPlaced; shownThrough: number }) {
  const item = p.item as Extract<SketchItem, { type: "shapes" }>;
  const { rect } = p;
  const kx = rect.w / item.grid.w;
  const ky = rect.h / item.grid.h;
  const X = (x: number) => rect.x + x * kx;
  const Y = (y: number) => rect.y + y * ky;
  const labelSize = Math.max(13, Math.min(22, p.size * (rect.w / 420 + 0.4)));
  return (
    <>
      {item.showGrid && (
        <g opacity={0.5} data-no-marker="">
          {Array.from({ length: item.grid.w + 1 }, (_, i) => <path key={`gx${i}`} d={`M${X(i)} ${rect.y} V${rect.y + rect.h}`} stroke="rgba(255,255,255,0.14)" strokeWidth={1} />)}
          {Array.from({ length: item.grid.h + 1 }, (_, i) => <path key={`gy${i}`} d={`M${rect.x} ${Y(i)} H${rect.x + rect.w}`} stroke="rgba(255,255,255,0.14)" strokeWidth={1} />)}
        </g>
      )}
      {item.shapes
        .filter((sh) => sh.s <= shownThrough)
        .map((sh) => {
          const color = INK[sh.color ?? "ink"];
          const moved = Boolean(sh.move && sh.move.s <= shownThrough);
          const gone = sh.hide !== undefined && sh.hide <= shownThrough;
          const dx = moved ? sh.move!.dx * kx : 0;
          const dy = moved ? sh.move!.dy * ky : 0;
          const rot = moved ? sh.move!.rotate ?? 0 : 0;
          const body = { transformBox: "fill-box" as const, transformOrigin: "center", transform: `translate(${dx}px, ${dy}px) rotate(${rot}deg)`, transition: MOVE, opacity: gone ? 0 : 1 };
          const slide = { transform: `translate(${dx}px, ${dy}px)`, transition: MOVE, opacity: gone ? 0 : 1 };
          let d = "";
          if (sh.kind === "rect") d = `M${X(sh.x!)} ${Y(sh.y!)} H${X(sh.x! + sh.w!)} V${Y(sh.y! + sh.h!)} H${X(sh.x!)} Z`;
          else if (sh.points) d = `M${sh.points.map((q) => `${X(q[0]).toFixed(1)} ${Y(q[1]).toFixed(1)}`).join(" L")}${sh.kind === "poly" ? " Z" : ""}`;
          let [cx, cy] = shapeCentre(sh);
          // A line's or arrow's label sits BESIDE it, above its longest stretch — never written across it.
          if ((sh.kind === "line" || sh.kind === "arrow") && sh.points && sh.points.length >= 2) {
            let best = 0, bl = -1;
            for (let i = 0; i < sh.points.length - 1; i++) {
              const l = Math.hypot((sh.points[i + 1][0] - sh.points[i][0]) * kx, (sh.points[i + 1][1] - sh.points[i][1]) * ky);
              if (l > bl) { bl = l; best = i; }
            }
            const [a, b] = [sh.points[best], sh.points[best + 1]];
            const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
            let nx = -((b[1] - a[1]) * ky), ny = (b[0] - a[0]) * kx;
            const nl = Math.hypot(nx, ny) || 1;
            nx /= nl; ny /= nl;
            if (ny > 0) { nx = -nx; ny = -ny; }
            const off = labelSize * 0.95;
            cx = mx + (nx * off) / kx;
            cy = my + (ny * off) / ky;
          }
          // A label sits INSIDE its area: smaller until it fits (a long "16 square units" ran across lines).
          let fit = labelSize;
          // Layout's clear spot wins (lib/canvas/layout.ts clearSketchLabels): inside, beside or outside.
          if (sh.labelAt) {
            cx = sh.labelAt.x;
            cy = sh.labelAt.y;
            fit = sh.labelAt.size;
          } else if (sh.label && sh.kind !== "label" && sh.kind !== "line" && sh.kind !== "arrow") {
            const pts = sh.points ?? (sh.kind === "rect" ? [[sh.x!, sh.y!], [sh.x! + sh.w!, sh.y! + sh.h!]] : [[sh.x! - sh.r!, sh.y! - sh.r!], [sh.x! + sh.r!, sh.y! + sh.r!]]);
            const span = (Math.max(...pts.map((q) => q[0])) - Math.min(...pts.map((q) => q[0]))) * kx;
            const room = (sh.kind === "poly" ? 0.55 : 0.84) * span;
            fit = Math.max(11, Math.min(labelSize, room / Math.max(0.5, unitWidth(sh.label))));
          }
          let head = "";
          if (sh.kind === "arrow" && sh.points) {
            const [a, b] = sh.points.slice(-2);
            const ang = Math.atan2(Y(b[1]) - Y(a[1]), X(b[0]) - X(a[0]));
            const arm = (t: number) => `${X(b[0]) - Math.cos(ang + t) * 13} ${Y(b[1]) - Math.sin(ang + t) * 13}`;
            head = `M${arm(0.45)} L${X(b[0])} ${Y(b[1])} L${arm(-0.45)}`;
          }
          return (
            <g key={sh.id} data-target={sh.id}>
              {sh.kind !== "label" && (
                <g style={body}>
                  {sh.fill && (sh.kind === "circle" ? <circle cx={X(sh.x!)} cy={Y(sh.y!)} r={sh.r! * Math.min(kx, ky)} fill={color} fillOpacity={0.24} className="cv-in" /> : <path d={d} fill={color} fillOpacity={0.24} className="cv-in" />)}
                  {sh.kind === "circle" ? (
                    <circle cx={X(sh.x!)} cy={Y(sh.y!)} r={sh.r! * Math.min(kx, ky)} fill="none" stroke={color} strokeWidth={2.8} strokeDasharray={sh.dashed ? "7 7" : undefined} pathLength={sh.dashed ? undefined : 1} className={sh.dashed ? "cv-in" : "cv-stroke"} />
                  ) : (
                    <path d={d} fill="none" stroke={color} strokeWidth={sh.kind === "line" || sh.kind === "arrow" ? 2.6 : 2.8} strokeLinecap="round" strokeLinejoin="round" strokeDasharray={sh.dashed ? "7 7" : undefined} pathLength={sh.dashed ? undefined : 1} className={sh.dashed ? "cv-in" : "cv-stroke"} />
                  )}
                  {head && <path d={head} fill="none" stroke={color} strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round" />}
                </g>
              )}
              {sh.label && (
                <g style={slide}>
                  <Writing x={X(cx) - 120} y={Y(cy) - fit * 0.68} w={240} h={fit * 1.4} html={writingHtml(sh.label)} size={fit} color={sh.kind === "label" ? color : INK.ink} align="center" />
                </g>
              )}
            </g>
          );
        })}
    </>
  );
}

/* ── graphs ────────────────────────────────────────────────────────────────────────────────── */

function niceStep(range: number): number {
  const raw = range / 6;
  const pow = Math.pow(10, Math.floor(Math.log10(raw)));
  const m = raw / pow;
  return (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * pow;
}

function Graph({ p, shownThrough }: { p: SketchPlaced; shownThrough: number }) {
  const item = p.item as Extract<SketchItem, { type: "graph" }>;
  const pad = { l: 34, r: 14, t: 12, b: 26 };
  const r: Rect = { x: p.rect.x + pad.l, y: p.rect.y + pad.t, w: p.rect.w - pad.l - pad.r, h: p.rect.h - pad.t - pad.b };
  const [x0, x1] = item.x;
  const [y0, y1] = item.y;
  const X = (x: number) => r.x + ((x - x0) / (x1 - x0)) * r.w;
  const Y = (y: number) => r.y + r.h - ((y - y0) / (y1 - y0)) * r.h;
  const sx = niceStep(x1 - x0);
  const sy = niceStep(y1 - y0);
  const ticks = (lo: number, hi: number, step: number) => {
    const out: number[] = [];
    for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(Math.round(v * 1e6) / 1e6);
    return out;
  };
  const curvePath = (expr: string) => {
    const segs: string[][] = [];
    let cur: string[] = [];
    for (let i = 0; i <= 220; i++) {
      const x = x0 + ((x1 - x0) * i) / 220;
      const y = evalExpr(expr, { x });
      if (Number.isFinite(y) && y >= y0 - (y1 - y0) * 0.02 && y <= y1 + (y1 - y0) * 0.02) cur.push(`${X(x).toFixed(1)} ${Y(Math.max(y0, Math.min(y1, y))).toFixed(1)}`);
      else if (cur.length) { segs.push(cur); cur = []; }
    }
    if (cur.length) segs.push(cur);
    return segs.filter((sg) => sg.length > 1).map((sg) => `M${sg.join(" L")}`).join(" ");
  };
  const axisX = y0 <= 0 && y1 >= 0 ? Y(0) : r.y + r.h;
  const axisY = x0 <= 0 && x1 >= 0 ? X(0) : r.x;
  return (
    <>
      <g opacity={0.5}>
        {ticks(x0, x1, sx).map((v) => <path key={`gx${v}`} d={`M${X(v)} ${r.y} V${r.y + r.h}`} stroke="rgba(255,255,255,0.12)" strokeWidth={1} />)}
        {ticks(y0, y1, sy).map((v) => <path key={`gy${v}`} d={`M${r.x} ${Y(v)} H${r.x + r.w}`} stroke="rgba(255,255,255,0.12)" strokeWidth={1} />)}
      </g>
      <path d={`M${r.x} ${axisX} H${r.x + r.w}`} stroke={INK.muted} strokeWidth={2.2} />
      <path d={`M${axisY} ${r.y + r.h} V${r.y}`} stroke={INK.muted} strokeWidth={2.2} />
      <g fontFamily={BOARD_FONT} fontSize={13} fill={INK.muted}>
        {ticks(x0, x1, sx).filter((v) => v !== 0).map((v) => <text key={`tx${v}`} x={X(v)} y={axisX + 17} textAnchor="middle">{String(v).replace("-", "−")}</text>)}
        {ticks(y0, y1, sy).filter((v) => v !== 0).map((v) => <text key={`ty${v}`} x={axisY - 6} y={Y(v) + 4} textAnchor="end">{String(v).replace("-", "−")}</text>)}
      </g>
      {item.curves
        .filter((c) => c.s <= shownThrough)
        .map((c) => {
          const color = INK[c.color ?? "ink"];
          const shifted = Boolean(c.shift && c.shift.s <= shownThrough);
          const style = { transform: shifted ? `translate(${(c.shift!.dx / (x1 - x0)) * r.w}px, ${(-c.shift!.dy / (y1 - y0)) * r.h}px)` : "translate(0px, 0px)", transition: MOVE };
          return (
            <g key={c.id} data-target={c.id} style={style}>
              <path d={curvePath(c.expr)} fill="none" stroke={color} strokeWidth={c.dashed ? 2.8 : 3.4} strokeDasharray={c.dashed ? "9 8" : undefined} strokeLinecap="round" pathLength={c.dashed ? undefined : 1} className={c.dashed ? "cv-in" : "cv-stroke cv-slow"} opacity={c.dashed ? 0.8 : 1} />
            </g>
          );
        })}
      {(item.points ?? [])
        .filter((pt) => pt.s <= shownThrough)
        .map((pt) => {
          const color = INK[pt.color ?? "pink"];
          return (
            <g key={pt.id} data-target={pt.id} className="cv-in">
              <circle cx={X(pt.x)} cy={Y(pt.y)} r={6.5} fill={color} stroke="#000000" strokeWidth={2.5} />
              {pt.label && <Writing x={X(pt.x) + 10} y={Y(pt.y) - 30} w={160} h={24} html={writingHtml(pt.label)} size={17} color={color} />}
            </g>
          );
        })}
    </>
  );
}

/* ── tables ────────────────────────────────────────────────────────────────────────────────── */

function Table({ p, shownThrough }: { p: SketchPlaced; shownThrough: number }) {
  const item = p.item as Extract<SketchItem, { type: "table" }>;
  const { rect, size } = p;
  const rowH = size * 1.95;
  const colW = rect.w / item.headers.length;
  const rows = item.rows.filter((r) => r.s <= shownThrough);
  const line = "rgba(255,255,255,0.32)";
  return (
    <>
      <rect x={rect.x} y={rect.y} width={rect.w} height={rowH} fill="rgba(255,255,255,0.06)" />
      {item.headers.map((h, c) => (
        <Writing key={`h${c}`} x={rect.x + c * colW} y={rect.y + (rowH - size * 1.3) / 2} w={colW} h={rowH} html={writingHtml(h)} size={size} weight={800} align="center" />
      ))}
      <path d={`M${rect.x} ${rect.y + rowH} H${rect.x + rect.w}`} stroke={line} strokeWidth={2} />
      {item.headers.slice(1).map((_, c) => <path key={`v${c}`} d={`M${rect.x + (c + 1) * colW} ${rect.y + 4} V${rect.y + rowH * (rows.length + 1) - 4}`} stroke={line} strokeWidth={1.5} />)}
      {rows.map((r, i) => (
        <g key={`r${i}`} className="cv-in">
          {r.cells.map((cell, c) => (
            <Writing key={c} x={rect.x + c * colW} y={rect.y + rowH * (i + 1) + (rowH - size * 1.3) / 2} w={colW} h={rowH} html={writingHtml(cell)} size={size} align="center" font={/^[\d\s.,−+-]+$|^(true|false)$/i.test(cell) ? MONO : BOARD_FONT} />
          ))}
        </g>
      ))}
    </>
  );
}

/* ── code ──────────────────────────────────────────────────────────────────────────────────── */

const KEYWORDS = /^(def|return|if|elif|else|for|while|in|and|or|not|True|False|None|function|const|let|var|int|float|void|public|class|import|from|print|break|continue|INPUT|OUTPUT|IF|THEN|ELSE|ENDIF|WHILE|ENDWHILE|FOR|TO|NEXT|DECLARE|PROCEDURE|FUNCTION|RETURNS|RETURN|REPEAT|UNTIL)$/;
function codeHtml(line: string): string {
  return line
    .split(/(#.*$|\/\/.*$|"[^"]*"|'[^']*'|\b\d+(?:\.\d+)?\b|\b[A-Za-z_]\w*\b)/)
    .map((tok) => {
      if (!tok) return "";
      if (/^(#|\/\/)/.test(tok)) return `<span style="color:${INK.muted}">${esc(tok)}</span>`;
      if (/^["']/.test(tok)) return `<span style="color:${INK.green}">${esc(tok)}</span>`;
      if (/^\d/.test(tok)) return `<span style="color:${INK.orange}">${esc(tok)}</span>`;
      if (KEYWORDS.test(tok)) return `<span style="color:${INK.pink}">${esc(tok)}</span>`;
      return esc(tok);
    })
    .join("");
}

/**
 * The note on the running line: after the line's own code when it fits inside the listing, else
 * beside the listing, else under it — never over the code ("← factorial(5) returns 120" was written
 * across "return n * factorial(n - 1)", QA 2026-10-21).
 */
function CodeNote({ rect, line, lineText, lineH, size, note }: { rect: Rect; line: number; lineText: string; lineH: number; size: number; note: string }) {
  const noteSize = size * 0.8;
  const w = textWidth(`← ${note}`, noteSize) + 16;
  const lineY = rect.y + 13 + (line - 1) * lineH;
  const codeEnd = rect.x + 40 + lineText.length * size * 0.6 + 14;
  const at =
    codeEnd + w <= rect.x + rect.w - 6 ? { x: codeEnd, y: lineY + (lineH - noteSize * 1.3) / 2 }
    : rect.x + rect.w + 10 + w <= 994 ? { x: rect.x + rect.w + 10, y: lineY + (lineH - noteSize * 1.3) / 2 }
    : { x: rect.x + 34, y: rect.y + rect.h + 6 };
  return <Writing x={at.x} y={at.y} w={w} h={noteSize * 1.4} html={esc(`← ${note}`)} size={noteSize} color={INK.yellow} weight={700} />;
}

function Code({ p, shownThrough }: { p: SketchPlaced; shownThrough: number }) {
  const item = p.item as Extract<SketchItem, { type: "code" }>;
  const { rect, size } = p;
  const lineH = p.lineH ?? size * 1.55;
  const live = (item.steps ?? []).filter((st) => st.s <= shownThrough).at(-1);
  return (
    <>
      <rect x={rect.x} y={rect.y} width={rect.w} height={rect.h} rx={14} fill="#111111" stroke="#2a2a2a" strokeWidth={1.5} data-no-marker="" />
      {live && <rect x={rect.x + 34} y={rect.y + 13 + (live.line - 1) * lineH} width={rect.w - 44} height={lineH} rx={6} fill="rgba(250,204,21,0.16)" style={{ transition: "y 380ms ease" }} />}
      {item.lines.map((l, i) => (
        <g key={i}>
          <text x={rect.x + 24} y={rect.y + 13 + i * lineH + lineH * 0.72} fontFamily={MONO} fontSize={size * 0.8} fill={INK.muted} textAnchor="end" opacity={0.6} data-no-marker="">{i + 1}</text>
          <Writing x={rect.x + 40} y={rect.y + 13 + i * lineH + (lineH - size * 1.3) / 2} w={rect.w - 50} h={lineH} html={codeHtml(l).replace(/^( +)/, (m) => "&nbsp;".repeat(m.length))} size={size} weight={500} font={MONO} />
        </g>
      ))}
      {live && (
        <g className="cv-in" key={`arrow-${live.s}`}>
          <path d={`M${rect.x - 20} ${rect.y + 13 + (live.line - 0.5) * lineH} h14 m-6 -6 l6 6 l-6 6`} stroke={INK.yellow} strokeWidth={2.6} fill="none" strokeLinecap="round" strokeLinejoin="round" />
          {live.note && <CodeNote rect={rect} line={live.line} lineText={item.lines[live.line - 1] ?? ""} lineH={lineH} size={size} note={live.note} />}
        </g>
      )}
    </>
  );
}

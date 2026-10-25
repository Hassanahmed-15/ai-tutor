"use client";

import { createContext, useContext, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import katex from "katex";
import "katex/dist/katex.min.css";
import { evalExpr } from "@/lib/canvas/expr";
import { arcKeyframes, arrowHead, centreLine, quadPoints, roughEllipse, roughRect, taperedStroke } from "@/lib/canvas/ink";
import { fitValue, graphPoint, INK, textWidth, wrap, type Mark, type PanelLayout, type Pt, type Rect } from "@/lib/canvas/layout";
import { edgeBends, edgeCurve, edgeDetour, edgeKey } from "@/lib/canvas/structure";
import { PANEL_H, PANEL_W, type CanvasBoardSpec, type GraphStage } from "@/lib/canvas/types";
import { CHALK, type BoardTheme } from "@/lib/canvas/theme";
import { stackAt } from "@/lib/canvas/callStack";
import { SketchView } from "./SketchView";
import { SequenceView } from "./SequenceView";
import { OsGanttView, OsMappingView, OsMemoryView, OsStatesView } from "./OsDiagramView";
import type { CardStyle } from "@/lib/canvas/cardStyle";
import { cardNumbersOf } from "@/lib/canvas/cardOrder";
import { IconGlyph } from "./icons";
import { figureAssetHref } from "@/lib/figures/assetHref";
import { fitText } from "@/lib/canvas/renderFit";

/**
 * ONE PANEL OF THE LESSON CANVAS, drawn from its layout (lib/canvas/layout.ts).
 *
 * A mark exists in the DOM only once its sentence has been reached, so its entrance animation plays
 * exactly when Aria says it — the reveal is the mount. Panels already taught are rendered "settled"
 * (no entrance animations) and stay on the world, which is what lets the camera pull back over the
 * whole lesson.
 *
 * THE LOOK (2026-10-02): ink is drawn ON — pressure-tapered pen strokes revealed along their own path
 * (lib/canvas/ink.ts); frames, boxes and rings are hand-drawn; everything else springs in with the
 * same small dip-then-settle. Decoration is never added for its own sake: every effect here points at
 * the content (signalling helps learning, seductive detail hurts it). Graph curves and axes stay
 * exact — precision is their content.
 */

/** The board's own colour as drawn; on the (black) chalk board it becomes the slate (lib/canvas/theme.ts). */
export const PAPER = "#fbfaf6";
const MUTED = "#64748b";
/** Aria's own colour: her pen, her highlighter, her corrections. */
export const ARIA_INK = "#ff6b4a";

type PanelProps = {
  layout: PanelLayout;
  spec: CanvasBoardSpec;
  /** Sentences revealed so far; Infinity for a panel already taught. */
  shownThrough: number;
  /** 0-1 within the current sentence (drives a graph's trace). */
  sentenceProgress: number;
  live: boolean;
  vars: Record<string, number>;
  /** The slider values before the student's last drag — drawn as a faded "ghost" curve. */
  ghostVars?: Record<string, number>;
  focusId?: string;
  /** Where a carried element came from, in this panel's own coordinates. */
  carryFrom: Record<string, Rect>;
  reducedMotion: boolean;
  /** The surface this board is drawn on (lib/canvas/theme.ts). */
  theme?: BoardTheme;
  /** Prediction-first boards keep the answer-bearing diagram hidden until the student commits. */
  concealStage?: boolean;
  /** How text cards are drawn: today's hand-drawn outline, or the sticker redesign (paper boards only; lib/canvas/cardStyle.ts). */
  cards?: CardStyle;
  /** Cards whose close-up has been taught (lib/canvas/cardDives.ts): a sticker card shows a tick for its number. */
  doneIds?: Set<string>;
  /** The card whose close-up is playing now: drawn without its words, so the close-up sits inside it. */
  openId?: string;
  /** Aria has finished this board: sticky notes give a quick wave in teaching order (a recap, no new content). */
  recap?: boolean;
};

export function CanvasPanel({ layout, spec, shownThrough, sentenceProgress, live, vars, ghostVars, focusId, carryFrom, reducedMotion, theme = "paper", concealStage = false, cards = "classic", doneIds, openId, recap = false }: PanelProps) {
  const chalk = theme === "chalk";
  // Sticker cards are numbered in the order Aria reaches them, so the student can follow "card 2".
  // Sticky notes are paper stuck on the slate, so they stay on every board (owner, 2026-10-20).
  const cardNumbers = cards !== "classic" ? cardNumbersOf(layout) : null;
  // Sticky notes: while Aria is on one note, the others step back.
  const spot = cards === "sticky" && Boolean(focusId && cardNumbers?.has(focusId));
  // Arrows between sticky notes are drawn in pencil, to match the paper (owner: the arrows did not match).
  const pencil = cards === "sticky" && Boolean(cardNumbers?.size);
  // A note rolls off the notes column when a later note takes its slot (lib/canvas/layout.ts).
  // A rolled-off note, or a page of working wiped for the next one (lib/canvas/layout.ts), is gone.
  const visible = layout.marks.filter((m) => m.s <= shownThrough && !((m.type === "note" || m.type === "equation") && m.until !== undefined && shownThrough >= m.until) && (!concealStage || m.type === "heading" || m.type === "note"));
  const headingW = layout.targets.heading?.w ?? 200;
  return (
    <InkDrawing.Provider value={live && !reducedMotion}>
    <g className={`${live && !reducedMotion ? "cv-live" : "cv-settled"}${spot ? " cv-spot" : ""}${recap && pencil && !reducedMotion ? " cv-recap" : ""}`}>
      <g className="cv-lift">
        {/* The shadow is a picture baked once (LessonCanvas paperShadow): a live blur filter under
            every board was re-blurred on every frame of a camera flight, and the flights stuttered. */}
        <use href="#cv-shadow-img" />
        <rect x={0} y={0} width={PANEL_W} height={PANEL_H} rx={22} fill={PAPER} stroke={chalk ? "#e7e2d6" : "#cfd6de"} strokeWidth={chalk ? 2 : 3} />
        {/* Paper grain: a faint, soft texture baked once into an image pattern — no blend mode, which
            forced the whole board through an extra compositing pass per frame. */}
        {/* A whiteboard is clean: no paper grain. The slate stays for the chalk theme. */}
        {chalk ? <SlateSurface /> : null}
        <Ink points={[{ x: 48, y: 88 }, { x: 48 + (headingW + 20) * 0.5, y: 86.5 }, { x: Math.min(PANEL_W - 48, 48 + headingW + 20), y: 88.5 }]} width={4.2} color="#f59e0b" opacity={0.6} />
        {spec.visualFallback && <title>{spec.visualFallback.message}</title>}
        {visible.map((mark) => (
          <MarkView key={mark.id} mark={mark} layout={layout} spec={spec} shownThrough={shownThrough} sentenceProgress={sentenceProgress} vars={vars} ghostVars={ghostVars} focused={focusId === mark.id} focusId={focusId} carry={carryFrom[mark.id]} targetRect={layout.targets[mark.id]} reducedMotion={reducedMotion} chalk={chalk} cardLook={cards} cardNo={cardNumbers ? (cardNumbers.get(mark.id) ?? 0) : undefined} cardDone={doneIds?.has(mark.id)} cardOpen={openId === mark.id} pencil={pencil} />
        ))}
      </g>
    </g>
    </InkDrawing.Provider>
  );
}

/**
 * A STICKER CARD (owner, 2026-10-19: "very clean, very cute, an upgrade"): a soft pastel card with big
 * round corners, a coloured edge, a little drop shadow, a number chip on its corner and a title in the
 * card's own deep colour. Same rect as today's card (layout, arrows and timing untouched); a hair of
 * tilt, fixed per card, makes it feel stuck on rather than printed.
 */
function StickerCard({ mark, no, focused, done, open }: { mark: Extract<Mark, { type: "box" }>; no: number; focused: boolean; done: boolean; open: boolean }) {
  const { x, y, w, h } = mark.rect;
  const deep = shade(mark.color, 0.32);
  const fit = mark.label ? fitText(mark.label, w - 24, mark.size, Math.max(12, Math.round(mark.size * 0.72))) : null;
  const extra = fit ? (fit.lines.length - 1) * fit.size * 1.15 : 0;
  const detailSize = mark.detailSize ?? 15;
  const top = y + (mark.detail?.length ? 28 : h / 2 + 6 - extra / 2);
  const tilt = ((hashOf(mark.id) % 5) - 2) * 0.35;
  const cx = x + w / 2;
  return (
    <g className={`cv-in cv-sticker${focused ? " cv-focus" : ""}`}>
      <g transform={`rotate(${tilt} ${cx} ${y + h / 2})`}>
        <rect x={x + 1} y={y + 5} width={w} height={h} rx={20} fill={mark.color} opacity={0.16} />
        <rect x={x} y={y} width={w} height={h} rx={20} fill={tint(mark.color, 0.1)} stroke={tint(mark.color, 0.55)} strokeWidth={2.4} />
        {open ? null : <>
        <rect x={x + 10} y={y + 6} width={w - 20} height={5} rx={2.5} fill="#ffffff" opacity={0.7} />
        {fit && <FitLines fit={fit} x={cx} y={top} lead={1.15} textAnchor="middle" fontWeight={800} fill={deep} />}
        {mark.detail?.length ? <rect x={cx - 16} y={top + extra + 8} width={32} height={3.5} rx={1.75} fill={mark.color} opacity={0.35} /> : null}
        {mark.detail?.map((line, i) => (
          <text key={i} x={cx} y={top + extra + 28 + i * detailSize * 1.27} textAnchor="middle" fontSize={detailSize} fontWeight={600} fill={INK} opacity={0.82}>
            {line}
          </text>
        ))}
        {done ? (
          <g className="cv-in">
            <circle cx={x + 2} cy={y - 3} r={13} fill="#16a34a" stroke="#ffffff" strokeWidth={3} />
            <path d={`M ${x - 4} ${y - 3} l 4 4.5 l 7.5 -8`} fill="none" stroke="#ffffff" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" />
          </g>
        ) : no > 0 ? (
          <g>
            <circle cx={x + 2} cy={y - 3} r={13} fill={mark.color} stroke="#ffffff" strokeWidth={3} />
            <text x={x + 2} y={y + 2} textAnchor="middle" fontSize={13} fontWeight={800} fill="#ffffff">{no}</text>
          </g>
        ) : null}
        {focused && <rect x={x - 5} y={y - 5} width={w + 10} height={h + 10} rx={24} fill="none" stroke={ARIA_INK} strokeWidth={3} opacity={0.75} className="cv-sticker-ring" />}
        </>}
      </g>
    </g>
  );
}

type CardProps = { mark: Extract<Mark, { type: "box" }>; no: number; focused: boolean; done: boolean; open: boolean };

/** The number (or tick) beside a card, in a hand-drawn ring. */
function CardMark({ cx, cy, no, done, color, r = 13 }: { cx: number; cy: number; no: number; done: boolean; color: string; r?: number }) {
  if (done) return (
    <g className="cv-in">
      <circle cx={cx} cy={cy} r={r} fill="#16a34a" />
      <path d={`M ${cx - 6} ${cy} l 4 4.5 l 7.5 -8`} fill="none" stroke="#ffffff" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" />
    </g>
  );
  if (no <= 0) return null;
  return (
    <g>
      <circle cx={cx} cy={cy} r={r} fill={color} />
      <text x={cx} y={cy + 5} textAnchor="middle" fontSize={r + 1} fontWeight={800} fill="#ffffff">{no}</text>
    </g>
  );
}

/**
 * MARKER NOTE (prototype, 2026-10-19): no box at all — the way a teacher writes a key word on a
 * whiteboard. The title in its colour over a highlighter swipe, the caption under it in ink, a
 * numbered dot beside it. Arrows still meet the (invisible) card edge.
 */
function MarkerCard({ mark, no, focused, done, open }: CardProps) {
  const { x, y, w, h } = mark.rect;
  if (open) return null;
  const deep = shade(mark.color, 0.25);
  const size = Math.min(mark.size + 3, 24);
  const fit = mark.label ? fitText(mark.label, w - 8, size, 13) : null;
  const extra = fit ? (fit.lines.length - 1) * fit.size * 1.15 : 0;
  const detailSize = (mark.detailSize ?? 15) + 1;
  const lines = mark.detail?.length ?? 0;
  const block = (fit ? fit.size + extra : 0) + (lines ? 10 + lines * detailSize * 1.27 : 0);
  const top = y + h / 2 - block / 2 + (fit ? fit.size * 0.8 : 0);
  const cx = x + w / 2;
  const widest = fit ? Math.max(...fit.lines.map((l) => textWidth(l, fit.size))) : 0;
  const tilt = ((hashOf(mark.id) % 3) - 1) * 0.8;
  return (
    <g className={`cv-in${focused ? " cv-focus" : ""}`}>
      {fit && <rect x={cx - widest / 2 - 8} y={top - fit.size * 0.42} width={widest + 16} height={fit.size * 0.62 + extra} rx={6} fill={mark.color} opacity={focused ? 0.38 : 0.2} transform={`rotate(${tilt} ${cx} ${top})`} />}
      {fit && <FitLines fit={fit} x={cx} y={top} lead={1.15} textAnchor="middle" fontWeight={800} fill={deep} />}
      {mark.detail?.map((line, i) => (
        <text key={i} x={cx} y={top + extra + 12 + (i + 1) * detailSize * 1.2} textAnchor="middle" fontSize={detailSize} fontWeight={600} fill={INK} opacity={0.78}>{line}</text>
      ))}
      {fit && <CardMark cx={cx - widest / 2 - 26} cy={top - fit.size * 0.32} no={no} done={done} color={mark.color} r={12} />}
    </g>
  );
}

/** Words → one of the board's own icons, for an icon-led card (none when nothing fits). */
const CARD_ICON_WORDS: Array<[RegExp, string]> = [
  [/\b(sun|sunlight|light|photon)/i, "sun"], [/\b(water|h2o|rain|liquid)/i, "water"], [/\b(oxygen|o2)\b/i, "oxygen"],
  [/\b(carbon dioxide|co2|gas|air)\b/i, "gas"], [/\bchloroplast|thylakoid|stroma|grana/i, "chloroplast"], [/\b(glucose|sugar|starch|carbohydrate)/i, "sugar"],
  [/\b(energy|atp|calorie|power)/i, "energy"], [/\b(cell|nucleus|membrane|neurone|neuron)/i, "cell"], [/\b(leaf|leaves)\b/i, "leaf"],
  [/\b(plant|flower|tree|crop)/i, "plant"], [/\broot/i, "root"], [/\b(cloud|weather|climate)/i, "cloud"], [/\b(heat|fire|burn|combust|temperature)/i, "flame"],
  [/\b(atom|electron|proton|ion|molecule|nucle)/i, "atom"], [/\b(battery|cell voltage|circuit|current|voltage)/i, "battery"], [/\b(person|human|people|patient|student|you)\b/i, "person"],
  [/\b(earth|planet|world|global)/i, "earth"], [/\b(enzyme|process|mechanism|machine|system|stage|step)/i, "gear"], [/\b(heart|blood|pulse|artery|vein|circulat)/i, "heart"],
  [/\b(lung|breath|respir|alveol)/i, "lungs"], [/\bstomat/i, "stomata"], [/\b(animal|mammal|fish|bird|organism)/i, "animal"], [/\b(factory|industry|production|manufactur)/i, "factory"],
  [/\b(force|push|pull|newton|pressure)/i, "force"], [/\bmagnet/i, "magnet"], [/\b(idea|bulb|lamp|think)/i, "bulb"], [/\b(wave|signal|impulse|sound|frequency)/i, "wave"],
  [/\b(ice|freez|cold)/i, "ice"], [/\b(steam|vapour|vapor|evaporat|boil)/i, "steam"], [/\b(law|act|bill|book|rule|reading|parliament)/i, "book"],
];
function cardIcon(text: string): string | null {
  return CARD_ICON_WORDS.find(([re]) => re.test(text))?.[1] ?? null;
}

/**
 * ICON NODE (prototype): a round picture badge — the card's icon from its own words, or its number —
 * with the title and caption beneath, no box. Matches the board's existing icon nodes (the sun).
 */
function BadgeCard({ mark, no, focused, done, open }: CardProps) {
  const { x, y, w, h } = mark.rect;
  if (open) return null;
  const icon = cardIcon(`${mark.label ?? ""} ${(mark.detail ?? []).join(" ")}`);
  const r = Math.min(30, h * 0.3, w * 0.16);
  const fit = mark.label ? fitText(mark.label, w - 6, Math.min(mark.size, 19), 12) : null;
  const extra = fit ? (fit.lines.length - 1) * fit.size * 1.15 : 0;
  const detailSize = mark.detailSize ?? 14;
  const lines = mark.detail?.length ?? 0;
  const block = r * 2 + 10 + (fit ? fit.size + extra : 0) + (lines ? 4 + lines * detailSize * 1.25 : 0);
  const cy = y + h / 2 - block / 2 + r;
  const cx = x + w / 2;
  const titleY = cy + r + 10 + (fit ? fit.size * 0.85 : 0);
  return (
    <g className={`cv-in${focused ? " cv-focus" : ""}`}>
      <circle cx={cx} cy={cy + 3} r={r} fill={mark.color} opacity={0.18} />
      <circle cx={cx} cy={cy} r={r} fill={tint(mark.color, 0.16)} stroke={mark.color} strokeWidth={3} />
      {icon ? (
        <g transform={`translate(${cx},${cy}) scale(${(r * 1.5) / 110})`}><IconGlyph name={icon as never} color={mark.color} /></g>
      ) : (
        <text x={cx} y={cy + r * 0.36} textAnchor="middle" fontSize={r} fontWeight={800} fill={mark.color}>{no > 0 ? no : (mark.label ?? "?").charAt(0).toUpperCase()}</text>
      )}
      {icon && <CardMark cx={cx + r * 0.78} cy={cy - r * 0.78} no={no} done={done} color={mark.color} r={10} />}
      {!icon && done && <CardMark cx={cx + r * 0.78} cy={cy - r * 0.78} no={0} done color={mark.color} r={10} />}
      {fit && <FitLines fit={fit} x={cx} y={titleY} lead={1.15} textAnchor="middle" fontWeight={800} fill={INK} />}
      {mark.detail?.map((line, i) => (
        <text key={i} x={cx} y={titleY + extra + 4 + (i + 1) * detailSize * 1.25} textAnchor="middle" fontSize={detailSize} fontWeight={600} fill={MUTED}>{line}</text>
      ))}
    </g>
  );
}

const STICKY_PAPER = ["#fff3b0", "#ffd9e0", "#d6ecff", "#d9f5d6", "#ece0ff", "#ffe2c7"];

/** STICKY NOTE (prototype): a square of pastel paper, taped on, its corner folded, a little tilted. */
function StickyCard({ mark, no, focused, done, open }: CardProps) {
  const { x, y, w, h } = mark.rect;
  const paper = STICKY_PAPER[(no > 0 ? no - 1 : hashOf(mark.id)) % STICKY_PAPER.length];
  const tilt = ((hashOf(mark.id) % 5) - 2) * 0.9;
  const cx = x + w / 2;
  const fold = 16;
  const fit = mark.label ? fitText(mark.label, w - 24, mark.size, 12) : null;
  const extra = fit ? (fit.lines.length - 1) * fit.size * 1.15 : 0;
  const detailSize = mark.detailSize ?? 15;
  const top = y + (mark.detail?.length ? 30 : h / 2 + 6 - extra / 2);
  // Motion (CANVAS_CSS .cv-sticky-*): stuck on with a slap, lifted and straightened while Aria is on
  // it (the others dim), its tick pops when its close-up is done.
  return (
    <g className={`cv-sticky-note${focused ? " is-focus" : ""}${done ? " is-done" : ""}`} style={{ ["--order" as string]: Math.max(0, no - 1) }}>
      <g className="cv-sticky-slap">
      <g className="cv-sticky-body" style={{ ["--tilt" as string]: `${tilt}deg` }}>
        <path className="cv-sticky-shadow" d={`M ${x + 2} ${y + 6} h ${w} v ${h - fold} l ${-fold} ${fold} h ${-(w - fold)} z`} fill="#000000" opacity={0.08} />
        <path d={`M ${x} ${y} h ${w} v ${h - fold} l ${-fold} ${fold} h ${-(w - fold)} z`} fill={paper} />
        <path d={`M ${x + w} ${y + h - fold} l ${-fold} ${fold} v ${-fold} z`} fill="#000000" opacity={0.1} />
        <rect x={cx - 26} y={y - 9} width={52} height={18} rx={3} fill="#ffffff" opacity={0.6} transform={`rotate(${-tilt * 2} ${cx} ${y})`} />
        {open ? null : <>
          {fit && <FitLines fit={fit} x={cx} y={top} lead={1.15} textAnchor="middle" fontWeight={800} fill={INK} />}
          {mark.detail?.map((line, i) => (
            <text key={i} x={cx} y={top + extra + 24 + i * detailSize * 1.27} textAnchor="middle" fontSize={detailSize} fontWeight={600} fill={INK} opacity={0.75}>{line}</text>
          ))}
          <g className={done ? "cv-pop" : undefined}><CardMark cx={x + 2} cy={y + 2} no={no} done={done} color={shade(mark.color, 0.1)} r={11} /></g>
        </>}
      </g>
      </g>
    </g>
  );
}

/** A colour mixed toward white (t = how much of the colour is kept). */
function tint(hex: string, t: number): string {
  return mixHex(hex, "#ffffff", t);
}

/** A colour mixed toward near-black ink (t = how much ink is added). */
function shade(hex: string, t: number): string {
  return mixHex("#111827", hex, t);
}

function mixHex(a: string, b: string, t: number): string {
  const rgb = (h: string) => { const m = /^#?([0-9a-f]{6})$/i.exec(h.trim()); const n = m ? parseInt(m[1], 16) : 0x64748b; return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
  const [p, q] = [rgb(a), rgb(b)];
  return `#${p.map((v, i) => Math.round(v * t + q[i] * (1 - t)).toString(16).padStart(2, "0")).join("")}`;
}

function hashOf(text: string): number {
  let h = 0;
  for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) >>> 0;
  return h;
}

/**
 * THE SLATE (owner, 2026-10-20, from the Visuals Lab): a clean dark board with the room's light
 * falling across it and a slim wooden edge. No tray, eraser smudges or speckle over the writing:
 * every stroke stays crisp. Plain shapes and one baked gradient, nothing recomputed per frame.
 */
function SlateSurface() {
  // Pure black, a thin dark edge so the board reads against the page (owner, 2026-10-21).
  return <rect x={-1.5} y={-1.5} width={PANEL_W + 3} height={PANEL_H + 3} rx={23} fill="none" stroke={CHALK.frame} strokeWidth={3} pointerEvents="none" />;
}

/**
 * Whether ink on this board is still being written. Only the live board draws its ink on; every
 * other board's ink is finished, so it is a plain path — a mask per stroke on every board was the
 * bulk of each camera frame's cost.
 */
const InkDrawing = createContext(false);

/* ── ink primitives ───────────────────────────────────────────────────────────────────────── */

/**
 * A pen stroke: a pressure-tapered filled outline, revealed by a mask that draws along its centre
 * line — so it is written in the order the pen moves, not faded in.
 */
export function Ink({ points, width, color, opacity = 1, className, dash }: { points: Pt[]; width: number; color: string; opacity?: number; className?: string; dash?: boolean }) {
  const id = useId().replace(/:/g, "");
  const outline = useMemo(() => taperedStroke(points, width), [points, width]);
  const line = useMemo(() => centreLine(points), [points]);
  const drawing = useContext(InkDrawing);
  // The mask covers the stroke and no more: a board-sized mask per stroke cost a board-sized
  // offscreen buffer per stroke, on every frame.
  const box = useMemo(() => {
    const pad = width * 2 + 12;
    const xs = points.map((p) => p.x);
    const ys = points.map((p) => p.y);
    const x = Math.min(...xs) - pad;
    const y = Math.min(...ys) - pad;
    return { x, y, w: Math.max(...xs) + pad - x, h: Math.max(...ys) + pad - y };
  }, [points, width]);
  if (!drawing) {
    return (
      <g className={className} opacity={opacity}>
        <path d={outline} fill={color} strokeDasharray={dash ? "10 9" : undefined} />
      </g>
    );
  }
  return (
    <g className={className} opacity={opacity}>
      <mask id={`ink${id}`} maskUnits="userSpaceOnUse" x={box.x} y={box.y} width={box.w} height={box.h}>
        <path d={line} fill="none" stroke="#fff" strokeWidth={width * 2.6 + 4} strokeLinecap="round" strokeLinejoin="round" pathLength={1} className="cv-stroke" />
      </mask>
      <path d={outline} fill={color} mask={`url(#ink${id})`} strokeDasharray={dash ? "10 9" : undefined} />
    </g>
  );
}

/** A hand-drawn outline (rect, ring) drawn on along its own path. */
function Sketch({ d, color, width = 2.2, fill, className, opacity }: { d: string; color: string; width?: number; fill?: string; className?: string; opacity?: number }) {
  return <path d={d} fill={fill ?? "none"} stroke={color} strokeWidth={width} strokeLinecap="round" strokeLinejoin="round" pathLength={1} className={`cv-stroke ${className ?? ""}`} opacity={opacity} />;
}

/**
 * Board text set by lib/canvas/renderFit.ts fitText: the first baseline at `y`, each further line
 * `lead` × its size lower. One line renders exactly as a plain <text> did.
 */
function FitLines({ fit, x, y, lead = 1.15, ...rest }: { fit: { lines: string[]; size: number }; x: number; y: number; lead?: number } & Omit<React.SVGProps<SVGTextElement>, "x" | "y" | "fontSize" | "ref">) {
  return (
    <text x={x} y={y} fontSize={fit.size} {...rest}>
      {fit.lines.length === 1
        ? fit.lines[0]
        : fit.lines.map((line, i) => (
            <tspan key={i} x={x} dy={i === 0 ? 0 : fit.size * lead}>
              {line}
            </tspan>
          ))}
    </text>
  );
}

/** A carried element starts where it was on the previous board and flies into place. */
function Carry({ id, from, to, children, reducedMotion }: { id: string; from?: Rect; to?: Rect; children: React.ReactNode; reducedMotion: boolean }) {
  const ref = useRef<SVGGElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || !from || !to || reducedMotion) return;
    const k = Math.max(0.05, Math.min(from.w / Math.max(1, to.w), from.h / Math.max(1, to.h)));
    const tx = from.x + from.w / 2 - (to.x + to.w / 2) * k;
    const ty = from.y + from.h / 2 - (to.y + to.h / 2) * k;
    el.animate(
      [
        { transform: `translate(${tx}px, ${ty}px) scale(${k})`, opacity: 0.9 },
        { transform: "translate(0px, 0px) scale(1)", opacity: 1 },
      ],
      { duration: 1300, delay: 250, easing: "cubic-bezier(.65,0,.25,1)", fill: "backwards" },
    );
    // Only on arrival: a carried element flies once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <g ref={ref} data-mark={id} style={{ transformOrigin: "0 0" }}>
      {children}
    </g>
  );
}

type MarkProps = {
  mark: Mark;
  layout: PanelLayout;
  spec: CanvasBoardSpec;
  shownThrough: number;
  sentenceProgress: number;
  vars: Record<string, number>;
  ghostVars?: Record<string, number>;
  focused: boolean;
  focusId?: string;
  carry?: Rect;
  targetRect?: Rect;
  reducedMotion: boolean;
  chalk?: boolean;
  /** Set for sticker cards: this card's number (0 = unnumbered); undefined draws today's card. */
  cardNo?: number;
  cardLook?: CardStyle;
  cardDone?: boolean;
  cardOpen?: boolean;
  pencil?: boolean;
};

function MarkView(props: MarkProps) {
  const { mark, carry, targetRect, reducedMotion } = props;
  const body = renderMark(props);
  if (carry && targetRect) {
    return (
      <Carry id={mark.id} from={carry} to={targetRect} reducedMotion={reducedMotion}>
        <g data-kind={mark.type}>{body}</g>
      </Carry>
    );
  }
  return (
    <g data-mark={mark.id} data-kind={mark.type}>
      {body}
    </g>
  );
}

function renderMark({ mark, layout, spec, shownThrough, sentenceProgress, vars, ghostVars, focused, focusId, reducedMotion, chalk, cardNo, cardLook, cardDone, cardOpen, pencil }: MarkProps) {
  const focus = focused ? " cv-focus" : "";
  switch (mark.type) {
    case "heading": {
      // Never past the board's edge or under the refresher badge: smaller first, then a second line
      // above the first (the stage starts just below the heading's rule).
      const fit = fitText(mark.text, (PANEL_W - 48) - mark.x, mark.size, Math.min(mark.size, 20));
      return <FitLines fit={fit} x={mark.x} y={mark.y - (fit.lines.length - 1) * fit.size * 1.12} lead={1.12} fontWeight={800} fill={INK} className="cv-write" />;
    }
    case "note":
      return (
        <g className={`cv-in${focus}`}>
          <circle cx={mark.bullet.x} cy={mark.bullet.y} r={5} fill="#f59e0b" />
          {/* An equation note is typeset by KaTeX (owner, 2026-10-24: "each eq should be derived from katex"). */}
          {mark.tex ? (
            <g transform={`translate(${mark.x} ${mark.y})`} data-tex-note="">
              <TexTerm tex={mark.tex} size={mark.size * 1.15} w={mark.w ?? 300} color={INK} onElement={() => {}} align="left" />
            </g>
          ) : (
            <text x={mark.x} y={mark.y} fontSize={mark.size} fontWeight={600} fill={INK} className="cv-write">
              {mark.lines.map((line, i) => (
                <tspan key={i} x={mark.x} dy={i === 0 ? 0 : mark.size * 1.28}>
                  {line}
                </tspan>
              ))}
            </text>
          )}
        </g>
      );
    case "node":
      return <NodeView mark={mark} vars={vars} focused={focused} shownThrough={shownThrough} />;
    case "arrow":
      if (pencil) return <PencilArrow mark={mark} vars={vars} focused={focused} reducedMotion={reducedMotion} chalk={Boolean(chalk)} />;
      return <ArrowView mark={mark} vars={vars} focused={focused} reducedMotion={reducedMotion} />;
    case "picture":
      return (
        <g className="cv-in">
          {/* On a chalkboard a picture is a photo taped to the board: a white border and two strips of tape. */}
          {chalk && (
            <>
              <rect x={mark.rect.x - 12} y={mark.rect.y - 12} width={mark.rect.w + 24} height={mark.rect.h + 24} rx={6} fill="#f8f6f0" />
              <rect x={mark.rect.x + 18} y={mark.rect.y - 26} width={92} height={28} fill="#efe3bf" opacity={0.82} transform={`rotate(-9 ${mark.rect.x + 64} ${mark.rect.y - 12})`} />
              <rect x={mark.rect.x + mark.rect.w - 110} y={mark.rect.y - 26} width={92} height={28} fill="#efe3bf" opacity={0.82} transform={`rotate(8 ${mark.rect.x + mark.rect.w - 64} ${mark.rect.y - 12})`} />
            </>
          )}
          <clipPath id={`clip-${mark.id}`}>
            <rect x={mark.rect.x} y={mark.rect.y} width={mark.rect.w} height={mark.rect.h} rx={16} />
          </clipPath>
          <rect x={mark.rect.x} y={mark.rect.y} width={mark.rect.w} height={mark.rect.h} rx={16} fill={mark.paper ?? "#f5f3ee"} />
          {mark.src ? (
            <image href={mark.src} x={mark.rect.x} y={mark.rect.y} width={mark.rect.w} height={mark.rect.h} preserveAspectRatio="xMidYMid slice" clipPath={`url(#clip-${mark.id})`} />
          ) : (
            <text x={mark.rect.x + mark.rect.w / 2} y={mark.rect.y + mark.rect.h / 2} textAnchor="middle" fontSize={18} fill={MUTED}>
              {mark.subject.slice(0, 60)}
            </text>
          )}
          <rect x={mark.rect.x} y={mark.rect.y} width={mark.rect.w} height={mark.rect.h} rx={16} fill="none" stroke="#e7e2d6" strokeWidth={2} />
        </g>
      );
    case "part":
      // A part is invisible until the pen or a label points at it — the picture carries it.
      return focused ? (
        <g className="cv-in">
          <circle cx={mark.cx} cy={mark.cy} r={9} fill={ARIA_INK} stroke="#fff" strokeWidth={3} />
        </g>
      ) : null;
    case "callout": {
      const end = { x: mark.box.x + mark.box.w / 2, y: mark.box.y + mark.box.h / 2 };
      const mid = { x: (mark.anchor.x + end.x) / 2 + (end.y - mark.anchor.y) * 0.08, y: (mark.anchor.y + end.y) / 2 - (end.x - mark.anchor.x) * 0.08 };
      return (
        <g className={focus.trim() || undefined}>
          <Ink points={quadPoints(mark.anchor, mid, end, 14)} width={3.2} color={INK} />
          <circle cx={mark.anchor.x} cy={mark.anchor.y} r={5.5} fill={INK} stroke="#fff" strokeWidth={2} className="cv-in" />
          <g className="cv-in cv-late">
            <rect x={mark.box.x} y={mark.box.y} width={mark.box.w} height={mark.box.h} rx={mark.box.h / 2} fill="#fff" />
            <Sketch d={roughRect(`co-${mark.id}`, mark.box.x, mark.box.y, mark.box.w, mark.box.h, mark.box.h / 2)} color={INK} width={2} />
            {(() => {
              const fit = fitText(mark.text, mark.box.w - 14, mark.size, Math.max(11, Math.round(mark.size * 0.75)));
              return <FitLines fit={fit} x={mark.box.x + mark.box.w / 2} y={mark.box.y + mark.box.h / 2 + fit.size * 0.36 - ((fit.lines.length - 1) * fit.size * 1.15) / 2} lead={1.15} textAnchor="middle" fontWeight={700} fill={INK} />;
            })()}
          </g>
        </g>
      );
    }
    case "equation":
      return <EquationView mark={mark} stage={layout.stage} shownThrough={shownThrough} focusId={focusId} reducedMotion={reducedMotion} />;
    case "graph":
      return <GraphView mark={mark} stage={layout.stage} shownThrough={shownThrough} sentenceProgress={sentenceProgress} vars={vars} ghostVars={ghostVars} focusId={focusId} />;
    case "column":
      return (
        <g className="cv-in">
          <rect x={mark.rect.x} y={mark.rect.y} width={mark.rect.w} height={mark.rect.h} rx={20} fill={mark.color} opacity={0.07} />
          <Sketch d={roughRect(`col-${mark.id}`, mark.rect.x, mark.rect.y, mark.rect.w, mark.rect.h, 20)} color={mark.color} width={2.2} opacity={0.65} />
          {mark.icon && (
            <g transform={`translate(${mark.rect.x + 40},${mark.rect.y + 40}) scale(0.42)`}>
              <IconGlyph name={mark.icon} color={mark.color} />
            </g>
          )}
          {(() => {
            // The title fits its column: smaller first, then two lines — never past the column's edge
            // ("Makkah's protected sanctuary" ran off the board, audit 2026-10-17). Two lines start at
            // 17 px, and set smaller still when the second would run past the edge.
            const x = mark.rect.x + (mark.icon ? 74 : 22);
            const room = mark.rect.x + mark.rect.w - 16 - x;
            const { lines, size } = fitText(mark.title, room, 23, 13, 2, 17, 17);
            return lines.map((line, i) => (
              <text key={i} x={x} y={mark.rect.y + (lines.length > 1 ? 38 : 48) + i * size * 1.15} fontSize={size} fontWeight={800} fill={mark.color}>
                {line}
              </text>
            ));
          })()}
        </g>
      );
    case "item":
      return (
        <g className={`cv-in${focus}`}>
          <rect x={mark.rect.x} y={mark.rect.y} width={mark.rect.w} height={mark.rect.h} rx={12} fill="#fff" opacity={0.95} />
          <Sketch d={roughRect(`it-${mark.id}`, mark.rect.x, mark.rect.y, mark.rect.w, mark.rect.h, 12)} color={mark.color} width={1.8} />
          <text x={mark.rect.x + 16} y={mark.rect.y + 11 + mark.size} fontSize={mark.size} fontWeight={600} fill={INK}>
            {mark.text.split("\n").map((line, i) => (
              <tspan key={i} x={mark.rect.x + 16} dy={i === 0 ? 0 : mark.size * 1.3}>
                {line}
              </tspan>
            ))}
          </text>
        </g>
      );
    case "link": {
      const c1 = { x: mark.p0.x + 40, y: mark.p0.y };
      const pts = quadPoints(mark.p0, { x: (c1.x + mark.p1.x - 40) / 2, y: (mark.p0.y + mark.p1.y) / 2 }, mark.p1, 12);
      return <Ink points={pts} width={2.6} color={MUTED} opacity={0.75} dash />;
    }
    case "box":
      if (!mark.icon && cardNo !== undefined && cardLook === "marker") return <MarkerCard mark={mark} no={cardNo} focused={focused} done={Boolean(cardDone)} open={Boolean(cardOpen)} />;
      if (!mark.icon && cardNo !== undefined && cardLook === "badge") return <BadgeCard mark={mark} no={cardNo} focused={focused} done={Boolean(cardDone)} open={Boolean(cardOpen)} />;
      if (!mark.icon && cardNo !== undefined && cardLook === "sticky") return <StickyCard mark={mark} no={cardNo} focused={focused} done={Boolean(cardDone)} open={Boolean(cardOpen)} />;
      if (!mark.icon && cardNo !== undefined) return <StickerCard mark={mark} no={cardNo} focused={focused} done={Boolean(cardDone)} open={Boolean(cardOpen)} />;
      if (!mark.icon) {
        // A card: a hand-drawn outline, its title, and its content lines. A title wider than the card
        // is set smaller, then on two lines (the detail moves down for the second), never past the edge.
        const fit = mark.label ? fitText(mark.label, mark.rect.w - 16, mark.size, Math.max(12, Math.round(mark.size * 0.72))) : null;
        const extra = fit ? (fit.lines.length - 1) * fit.size * 1.15 : 0;
        const top = mark.rect.y + (mark.detail?.length ? 26 : mark.rect.h / 2 + 6 - extra / 2);
        return (
          <g className={`cv-in${focus}`}>
            <rect x={mark.rect.x} y={mark.rect.y} width={mark.rect.w} height={mark.rect.h} rx={14} fill={mark.color} fillOpacity={0.08} />
            <Sketch d={roughRect(`box-${mark.id}`, mark.rect.x, mark.rect.y, mark.rect.w, mark.rect.h, 14)} color={mark.color} width={2.2} opacity={0.75} />
            {fit && <FitLines fit={fit} x={mark.rect.x + mark.rect.w / 2} y={top} lead={1.15} textAnchor="middle" fontWeight={800} fill={INK} />}
            {mark.detail?.map((line, i) => (
              <text key={i} x={mark.rect.x + mark.rect.w / 2} y={top + extra + 22 + i * (mark.detailSize ?? 15) * 1.27} textAnchor="middle" fontSize={mark.detailSize ?? 15} fontWeight={600} fill={INK} opacity={0.85}>
                {line}
              </text>
            ))}
          </g>
        );
      }
      return (
        <g className={`cv-in${focus}`}>
          <circle cx={mark.rect.x + mark.rect.w / 2} cy={mark.rect.y + mark.rect.h / 2 - (mark.label ? 18 : 0)} r={Math.min(34, mark.rect.w * 0.16, mark.rect.h * 0.22)} fill={mark.color} fillOpacity={0.14} stroke={mark.color} strokeWidth={3} />
          {mark.icon && (
            <g transform={`translate(${mark.rect.x + mark.rect.w / 2},${mark.rect.y + mark.rect.h / 2 - 18}) scale(${Math.min(mark.rect.w, mark.rect.h) / 220})`}>
              <IconGlyph name={mark.icon} color={mark.color} />
            </g>
          )}
          {mark.label && <FitLines fit={fitText(mark.label, mark.rect.w - 12, mark.size, Math.max(12, Math.round(mark.size * 0.72)))} x={mark.rect.x + mark.rect.w / 2} y={mark.rect.y + mark.rect.h / 2 + 42} lead={1.15} textAnchor="middle" fontWeight={700} fill={INK} />}
        </g>
      );
    case "figure":
      return <FigureView mark={mark} chalk={Boolean(chalk)} focusId={focusId} shownThrough={shownThrough} />;
    case "figure-label":
      return <FigureLabelView mark={mark} chalk={Boolean(chalk)} shownThrough={shownThrough} focused={focusId === mark.part} />;
    case "free-body":
      return <FreeBodyView mark={mark} shownThrough={shownThrough} focusId={focusId} chalk={Boolean(chalk)} />;
    case "electrolytic-cell":
      return <ElectrolyticCellView mark={mark} shownThrough={shownThrough} focusId={focusId} reducedMotion={reducedMotion} chalk={Boolean(chalk)} />;
    case "text": {
      // Set smaller, then on two lines centred in its box, when it is wider than the box.
      const fit = fitText(mark.text, mark.rect.w, mark.size, Math.max(12, Math.round(mark.size * 0.72)));
      return <FitLines fit={fit} x={mark.rect.x + mark.rect.w / 2} y={mark.rect.y + mark.rect.h / 2 + fit.size * 0.35 - ((fit.lines.length - 1) * fit.size * 1.15) / 2} lead={1.15} textAnchor="middle" fontWeight={700} fill={mark.color} className={`cv-write${focus}`} />;
    }
    case "code":
      return <CodeView mark={mark} shownThrough={shownThrough} focusId={focusId} />;
    case "trace":
      return <TraceView mark={mark} shownThrough={shownThrough} />;
    case "structure":
      return <StructureView mark={mark} shownThrough={shownThrough} focusId={focusId} reducedMotion={reducedMotion} />;
    case "stack":
      return <CallStackView mark={mark} shownThrough={shownThrough} />;
    case "sketch":
      return <SketchView mark={mark} shownThrough={shownThrough} />;
    case "sequence":
      return <SequenceView mark={mark} shownThrough={shownThrough} focusId={focusId} />;
    case "os-states":
      return <OsStatesView mark={mark} shownThrough={shownThrough} focusId={focusId} />;
    case "os-memory":
      return <OsMemoryView mark={mark} shownThrough={shownThrough} focusId={focusId} />;
    case "os-gantt":
      return <OsGanttView mark={mark} shownThrough={shownThrough} focusId={focusId} />;
    case "os-mapping":
      return <OsMappingView mark={mark} shownThrough={shownThrough} focusId={focusId} />;
    case "state":
      return <StateView mark={mark} shownThrough={shownThrough} />;
    case "output":
      return (
        <g className={`cv-in${focus}`}>
          <rect x={mark.rect.x} y={mark.rect.y} width={mark.rect.w} height={mark.rect.h} rx={12} fill="#0f172a" />
          <text x={mark.rect.x + 14} y={mark.rect.y + 22} fontSize={11} fontWeight={800} letterSpacing={1.2} fill="#64748b">OUTPUT</text>
          {mark.text.split("\n").map((line, i) => (
            <text key={i} x={mark.rect.x + 14} y={mark.rect.y + 44 + i * 22} fontSize={mark.size} fontFamily={MONO_FONT} fill="#a7f3d0" className="cv-write">
              {line}
            </text>
          ))}
        </g>
      );
    case "molecule":
      return <MoleculeView mark={mark} rotation={vars.rotation ?? 0} />;
    case "atom-map":
      return <AtomMapView mark={mark} />;
  }
}

/** A real apparatus drawing for the common generated/fallback scene of an electrolytic cell. */
/** Figure colours by meaning, for paper and for the chalkboard. */
function figureInk(ink: string | undefined, chalk: boolean): string {
  if (!ink || ink === "none") return "none";
  if (/^(#|rgb|hsl)/.test(ink)) return ink;
  const paper: Record<string, string> = { ink: INK, glass: "rgba(186,230,253,0.28)", metal: "#9ca3af", wood: "#a8a29e", muted: MUTED, paper: "#ffffff" };
  const slate: Record<string, string> = { ink: "#f1eee4", glass: "rgba(241,238,228,0.10)", metal: "#94a3b8", wood: "#78716c", muted: "#b9c3be", paper: "#e8e4d8" };
  return (chalk ? slate : paper)[ink] ?? INK;
}

/** A code-drawn textbook figure (lib/figures): its shapes, scaled into place; the focused part is drawn bolder. */
function FigureView({ mark, chalk, focusId, shownThrough = Infinity }: { mark: Extract<Mark, { type: "figure" }>; chalk: boolean; focusId?: string; shownThrough?: number }) {
  const { rect, scale, drawing } = mark;
  if (mark.asset) return <LibraryFigureView mark={mark} chalk={chalk} />;
  // A timed shape follows the sentence that reveals its part; an untimed part counts as revealed.
  const reached = (part: string) => (mark.timing?.[part] ?? 0) <= shownThrough;
  return (
    <g className="cv-in" role="img" data-figure="" aria-label={`Figure with parts: ${drawing.parts.map((p) => p.name).join(", ")}`}>
      <g transform={`translate(${rect.x},${rect.y}) scale(${scale})`}>
        {drawing.shapes.map((sh, i) => {
          if (sh.show && !(Array.isArray(sh.show) ? sh.show : [sh.show]).every(reached)) return null;
          const focused = Boolean(sh.part && sh.part === focusId);
          // A focused part keeps its own colour (a coral curve contradicted its blue legend on the black
          // board, QA 2026-10-21): it is drawn thicker, with a glow of that colour.
          const stroke = figureInk(sh.stroke ?? "none", chalk);
          const common = { fill: figureInk(sh.fill ?? "none", chalk), stroke, strokeWidth: (sh.width ?? 1) * (focused ? 1.8 : 1), strokeDasharray: sh.dash, opacity: sh.opacity, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, ...(focused && stroke !== "none" ? { filter: `drop-shadow(0 0 5px ${stroke})` } : {}) };
          const moved = sh.move && reached(sh.move.on);
          const gone = Boolean(sh.hide && reached(sh.hide));
          const timed = sh.show || sh.hide || sh.move;
          const style = timed
            ? {
                transformBox: "fill-box" as const,
                transformOrigin: "center",
                transform: moved ? `translate(${sh.move!.dx}px, ${sh.move!.dy}px) rotate(${sh.move!.rotate ?? 0}deg)` : "translate(0px, 0px) rotate(0deg)",
                transition: `transform 1100ms cubic-bezier(.65,0,.25,1) ${sh.move?.delay ?? 0}ms, opacity 450ms ease`,
                opacity: gone ? 0 : undefined,
              }
            : undefined;
          const body =
            sh.t === "path" ? <path key={i} d={sh.d} {...common} style={style} />
            : sh.t === "circle" ? <circle key={i} cx={sh.cx} cy={sh.cy} r={sh.r} {...common} style={style} />
            : (
              <text key={i} x={sh.x} y={sh.y} fontSize={sh.size} textAnchor={sh.anchor ?? "start"} fill={figureInk(sh.fill ?? "ink", chalk)} fontWeight={600} style={style}>
                {sh.text}
              </text>
            );
          // A shape that appears on its sentence springs in like everything else Aria writes.
          return sh.show ? <g key={i} className="cv-in">{body}</g> : body;
        })}
      </g>
      {drawing.credit && (
        <text x={rect.x + rect.w} y={rect.y + rect.h + 16} textAnchor="end" fontSize={11} fill={chalk ? "#b9c3be" : MUTED}>
          {drawing.credit}
        </text>
      )}
    </g>
  );
}

/**
 * A real textbook diagram from the library (lib/figures/library.ts): the art as an image, its own
 * words already taken off so the board's labels are the only ones. On the chalkboard it sits on a
 * paper card — the diagram's colours were drawn for white. The credit is required by its licence.
 */
function LibraryFigureView({ mark, chalk }: { mark: Extract<Mark, { type: "figure" }>; chalk: boolean }) {
  const { rect, drawing } = mark;
  return (
    <g className="cv-in" role="img" aria-label={`Diagram with parts: ${drawing.parts.map((p) => p.name).join(", ")}`}>
      {chalk && <rect x={rect.x - 6} y={rect.y - 6} width={rect.w + 12} height={rect.h + 12} rx={10} fill="#f6f3ea" opacity={0.96} />}
      <image href={figureAssetHref(mark.asset!)} x={rect.x} y={rect.y} width={rect.w} height={rect.h} preserveAspectRatio="xMidYMid meet" />
      {drawing.credit && (
        <text x={rect.x + rect.w} y={rect.y + rect.h + 16} textAnchor="end" fontSize={10.5} fill={chalk ? "#b9c3be" : MUTED}>
          {drawing.credit}
        </text>
      )}
    </g>
  );
}

/**
 * A textbook label: its words in the margin column, a leader drawn out from the words, and a dot on
 * the part. The label being spoken is full strength; earlier ones step back (signalling).
 */
function FigureLabelView({ mark, chalk, shownThrough, focused }: { mark: Extract<Mark, { type: "figure-label" }>; chalk: boolean; shownThrough: number; focused: boolean }) {
  const ink = chalk ? "#f1eee4" : INK;
  const earlier = Number.isFinite(shownThrough) && mark.s < shownThrough && !focused;
  const end = mark.leader[mark.leader.length - 1];
  const d = mark.leader.map((p, i) => `${i ? "L" : "M"}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ");
  return (
    <g className="cv-in" opacity={earlier ? 0.62 : 1}>
      <path d={d} fill="none" stroke={chalk ? "#000000" : "#ffffff"} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" opacity={0.45} />
      <path d={d} fill="none" stroke={ink} strokeWidth={focused ? 2.6 : 1.8} strokeLinecap="round" strokeLinejoin="round" className="cv-stroke" pathLength={1} />
      <circle cx={end.x} cy={end.y} r={focused ? 5.5 : 4.2} fill={ink} stroke={chalk ? "#000000" : "#ffffff"} strokeWidth={1.5} />
      {mark.lines.map((line, i) => (
        <text key={i} x={mark.at.x} y={mark.at.y + i * mark.size * 1.25} textAnchor={mark.side === "left" ? "end" : "start"} fontSize={mark.size} fontWeight={focused ? 800 : 700} fill={ink}>
          {line}
        </text>
      ))}
    </g>
  );
}

/** A free-body diagram (lib/canvas/layout.ts freeBodyParts): the object, then one arrow per force as it is named. */
function FreeBodyView({ mark, shownThrough, focusId, chalk }: { mark: Extract<Mark, { type: "free-body" }>; shownThrough: number; focusId?: string; chalk: boolean }) {
  const { body, bodyRect: r, forces } = mark;
  const palette = chalk ? ["#fda4af", "#93c5fd", "#86efac", "#fcd34d", "#c4b5fd", "#67e8f9"] : ["#be123c", "#2563eb", "#15803d", "#b45309", "#7c3aed", "#0e7490"];
  return (
    <g role="img" aria-label={`Free-body diagram of ${body.label ?? body.id}`}>
      {body.s <= shownThrough && (
        <g className={`cv-in${focusId === body.id ? " cv-focus" : ""}`}>
          <rect x={r.x} y={r.y} width={r.w} height={r.h} rx={12} fill={chalk ? "rgba(255,255,255,0.06)" : "#f8f5ee"} stroke={INK} strokeWidth={3.5} />
          <text x={r.x + r.w / 2} y={r.y + r.h / 2 + 7} textAnchor="middle" fontSize={19} fontWeight={800} fill={INK}>{body.label ?? body.id}</text>
        </g>
      )}
      {forces.filter((f) => f.item.s <= shownThrough).map((f, i) => {
        const color = f.item.color ?? palette[i % palette.length];
        const dx = Math.sign(f.end.x - f.start.x), dy = Math.sign(f.end.y - f.start.y);
        // Arrowhead: a filled triangle at the tip, pointing along the force.
        const head = `M${f.end.x + dx * 4} ${f.end.y + dy * 4} L${f.end.x - dx * 16 - dy * 9} ${f.end.y - dy * 16 - dx * 9} L${f.end.x - dx * 16 + dy * 9} ${f.end.y - dy * 16 + dx * 9} Z`;
        const horizontal = dx !== 0;
        const lx = horizontal ? f.end.x + dx * 14 : f.end.x + 14;
        const ly = horizontal ? f.end.y - 12 : f.end.y + (dy < 0 ? -10 : 24);
        return (
          <g key={f.item.id} className={`cv-in${focusId === f.item.id ? " cv-focus" : ""}`}>
            <line x1={f.start.x} y1={f.start.y} x2={f.end.x - dx * 14} y2={f.end.y - dy * 14} stroke={color} strokeWidth={6} strokeLinecap="round" className="cv-stroke" pathLength={1} />
            <path d={head} fill={color} />
            <text x={lx} y={ly} textAnchor={horizontal ? (dx < 0 ? "end" : "start") : "start"} fontSize={17} fontWeight={800} fill={color}>{f.item.label ?? f.item.id}</text>
          </g>
        );
      })}
    </g>
  );
}

function ElectrolyticCellView({ mark, shownThrough, focusId, reducedMotion, chalk }: {
  mark: Extract<Mark, { type: "electrolytic-cell" }>;
  shownThrough: number;
  focusId?: string;
  reducedMotion: boolean;
  chalk: boolean;
}) {
  const { rect, parts } = mark;
  const beaker = { x: rect.x + rect.w * 0.22, y: rect.y + rect.h * 0.25, w: rect.w * 0.56, h: rect.h * 0.68 };
  const supply = { x: rect.x + rect.w * 0.37, y: rect.y + 8, w: rect.w * 0.26, h: 68 };
  const anodeX = beaker.x + beaker.w * 0.25;
  const cathodeX = beaker.x + beaker.w * 0.75;
  const electrodeTop = beaker.y + 48;
  const electrodeBottom = beaker.y + beaker.h - 30;
  const liquidY = beaker.y + beaker.h * 0.48;
  const visible = (s: number) => s <= shownThrough;
  const anodeColor = chalk ? "#fda4af" : "#be123c";
  const cathodeColor = chalk ? "#93c5fd" : "#2563eb";
  const electrolyteColor = chalk ? "#67e8f9" : "#0e7490";
  const wireVisible = visible(parts.power.s) && visible(parts.anode.s) && visible(parts.cathode.s);
  const allVisible = wireVisible && visible(parts.electrolyte.s);
  const label = (value: string | undefined, fallback: string) => value?.trim() || fallback;
  return (
    <g className="cv-in" role="img" aria-label="Labelled electrolytic cell apparatus">
      {visible(parts.power.s) && (
        <g className={focusId === parts.power.id ? "cv-focus" : undefined}>
          <rect x={supply.x} y={supply.y} width={supply.w} height={supply.h} rx={10} fill="none" stroke={INK} strokeWidth={3} />
          <line x1={supply.x + supply.w * 0.44} y1={supply.y + 18} x2={supply.x + supply.w * 0.44} y2={supply.y + 51} stroke={INK} strokeWidth={3} />
          <line x1={supply.x + supply.w * 0.56} y1={supply.y + 12} x2={supply.x + supply.w * 0.56} y2={supply.y + 57} stroke={INK} strokeWidth={6} />
          <text x={supply.x + 19} y={supply.y + 24} textAnchor="middle" fontSize={22} fontWeight={900} fill={anodeColor}>+</text>
          <text x={supply.x + supply.w - 19} y={supply.y + 23} textAnchor="middle" fontSize={26} fontWeight={900} fill={cathodeColor}>−</text>
          <text x={supply.x + supply.w / 2} y={supply.y - 9} textAnchor="middle" fontSize={17} fontWeight={800} fill={INK}>{label(parts.power.label, "power supply")}</text>
        </g>
      )}
      {wireVisible && (
        <g fill="none" stroke={INK} strokeWidth={4} strokeLinecap="round" strokeLinejoin="round">
          <path d={`M${supply.x + 19} ${supply.y + supply.h / 2} H${anodeX} V${electrodeTop}`} />
          <path d={`M${supply.x + supply.w - 19} ${supply.y + supply.h / 2} H${cathodeX} V${electrodeTop}`} />
        </g>
      )}
      <path d={`M${beaker.x} ${beaker.y} V${beaker.y + beaker.h - 18} Q${beaker.x} ${beaker.y + beaker.h} ${beaker.x + 18} ${beaker.y + beaker.h} H${beaker.x + beaker.w - 18} Q${beaker.x + beaker.w} ${beaker.y + beaker.h} ${beaker.x + beaker.w} ${beaker.y + beaker.h - 18} V${beaker.y}`} fill="none" stroke={INK} strokeWidth={5} strokeLinecap="round" />
      {visible(parts.electrolyte.s) && (
        <g className={focusId === parts.electrolyte.id ? "cv-focus" : undefined}>
          <path d={`M${beaker.x + 4} ${liquidY} H${beaker.x + beaker.w - 4} V${beaker.y + beaker.h - 20} Q${beaker.x + beaker.w - 4} ${beaker.y + beaker.h - 4} ${beaker.x + beaker.w - 20} ${beaker.y + beaker.h - 4} H${beaker.x + 20} Q${beaker.x + 4} ${beaker.y + beaker.h - 4} ${beaker.x + 4} ${beaker.y + beaker.h - 20} Z`} fill="#38bdf8" fillOpacity={0.18} />
          <path d={`M${beaker.x + 6} ${liquidY} Q${beaker.x + beaker.w * 0.25} ${liquidY - 5} ${beaker.x + beaker.w * 0.5} ${liquidY} T${beaker.x + beaker.w - 6} ${liquidY}`} fill="none" stroke={electrolyteColor} strokeWidth={3} />
          <text x={beaker.x + 30} y={liquidY + 34} textAnchor="start" fontSize={18} fontWeight={800} fill={electrolyteColor}>{label(parts.electrolyte.label, "electrolyte")}</text>
        </g>
      )}
      {visible(parts.anode.s) && (
        <g className={focusId === parts.anode.id ? "cv-focus" : undefined}>
          <rect x={anodeX - 13} y={electrodeTop} width={26} height={electrodeBottom - electrodeTop} rx={5} fill={anodeColor} fillOpacity={0.23} stroke={anodeColor} strokeWidth={3} />
          <text x={anodeX - 34} y={electrodeTop + 22} textAnchor="end" fontSize={18} fontWeight={850} fill={anodeColor}>{label(parts.anode.label, "anode")} (+)</text>
          <line x1={anodeX - 28} y1={electrodeTop + 27} x2={anodeX - 4} y2={electrodeTop + 37} stroke={anodeColor} strokeWidth={2.5} />
        </g>
      )}
      {visible(parts.cathode.s) && (
        <g className={focusId === parts.cathode.id ? "cv-focus" : undefined}>
          <rect x={cathodeX - 13} y={electrodeTop} width={26} height={electrodeBottom - electrodeTop} rx={5} fill={cathodeColor} fillOpacity={0.20} stroke={cathodeColor} strokeWidth={3} />
          <text x={cathodeX + 34} y={electrodeTop + 22} textAnchor="start" fontSize={18} fontWeight={850} fill={cathodeColor}>{label(parts.cathode.label, "cathode")} (−)</text>
          <line x1={cathodeX + 28} y1={electrodeTop + 27} x2={cathodeX + 4} y2={electrodeTop + 37} stroke={cathodeColor} strokeWidth={2.5} />
        </g>
      )}
      {allVisible && (
        <g aria-label="Positive ions move to the cathode; negative ions move to the anode">
          <IonPath fromX={beaker.x + beaker.w * 0.48} toX={cathodeX - 18} y={liquidY + 74} charge="+" color={cathodeColor} animate={!reducedMotion} />
          <IonPath fromX={beaker.x + beaker.w * 0.52} toX={anodeX + 18} y={liquidY + 118} charge="−" color={anodeColor} animate={!reducedMotion} />
        </g>
      )}
    </g>
  );
}

/* ── data structures: the tree, list or array itself, changing as the code runs ───────────── */

const DS_LOOK: Record<string, { fill: string; stroke: string }> = {
  none: { fill: "#ffffff", stroke: "#0f766e" },
  visit: { fill: "#dbeafe", stroke: "#2563eb" },
  compare: { fill: "#fef3c7", stroke: "#d97706" },
  found: { fill: "#bbf7d0", stroke: "#15803d" },
  done: { fill: "#e5e7eb", stroke: "#64748b" },
  remove: { fill: "#fee2e2", stroke: "#be123c" },
};
/** The two sets of a two-colouring (op "group"), with the legend's names. */
const SET_LOOK: Array<{ fill: string; stroke: string; name: string }> = [
  { fill: "#bfdbfe", stroke: "#1d4ed8", name: "Set A" },
  { fill: "#fed7aa", stroke: "#c2410c", name: "Set B" },
];
// "same set!" at 13px bold: its width, for placing the label and the plate behind it.
const CONFLICT_LABEL_W = 68;
const EDGE_LOOK: Record<string, { color: string; width: number }> = {
  tree: { color: "#0f766e", width: 6 },
  conflict: { color: "#dc2626", width: 5.5 },
};
const POINTER_INK = "#7c3aed";
const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

/**
 * One frame per step (lib/canvas/structure.ts). When the narration reaches a new step, every node
 * glides from where it was to where it now sits, a link that is new inks itself in, a removed node is
 * crossed out and fades, and a changed value flashes — so the student watches the line of code that
 * was just read do its work on the structure.
 */
function StructureView({ mark, shownThrough, focusId, reducedMotion }: { mark: Extract<Mark, { type: "structure" }>; shownThrough: number; focusId?: string; reducedMotion: boolean }) {
  const index = mark.frames.reduce((best, f, i) => (f.s <= shownThrough ? i : best), 0);
  const [glide, setGlide] = useState({ from: index, to: index, t: 1 });
  useEffect(() => {
    if (index === glide.to || reducedMotion) return;
    const from = glide.to;
    let raf = 0;
    const t0 = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - t0) / 750);
      setGlide({ from, to: index, t });
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // Runs only when the step changes; `glide.to` is where the last glide ended.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, reducedMotion]);
  // Reduced motion: the step as it is now, without moving.
  const shown = reducedMotion ? { from: index, to: index, t: 1 } : glide;

  const { layout } = mark;
  const before = layout.frames[shown.from] ?? layout.frames[0];
  const after = layout.frames[shown.to] ?? layout.frames[0];
  const frame = mark.frames[shown.to] ?? mark.frames[0];
  const gone = (mark.frames[shown.from]?.nodes ?? []).filter((n) => !frame.nodes.some((m) => m.id === n.id));
  const e = easeInOut(shown.t);
  const lerp = (a: Pt | undefined, b: Pt | undefined): Pt | undefined => (a && b ? { x: a.x + (b.x - a.x) * e, y: a.y + (b.y - a.y) * e } : b ?? a);
  const at = (id: string) => lerp(before.place[id], after.place[id]);
  const caption = mark.captions.filter((c) => c.s <= shownThrough).at(-1);

  const nodeShape = (id: string, p: Pt, look: { fill: string; stroke: string }) => {
    if (layout.shape === "circle") return <path d={roughEllipse(`ds-${id}`, p.x, p.y, layout.r, layout.r)} fill={look.fill} stroke={look.stroke} strokeWidth={2.6} />;
    const x = p.x - layout.w / 2;
    const y = p.y - layout.h / 2;
    return (
      <g>
        <path d={roughRect(`ds-${id}`, x, y, layout.w, layout.h, layout.shape === "box" ? 8 : 4)} fill={look.fill} stroke={look.stroke} strokeWidth={2.4} />
        {/* A linked-list node: its value, and the box its next pointer leaves from. */}
        {layout.shape === "box" && <line x1={x + layout.w * 0.68} y1={y + 4} x2={x + layout.w * 0.68} y2={y + layout.h - 4} stroke={look.stroke} strokeWidth={1.6} opacity={0.7} />}
      </g>
    );
  };
  const valueX = (p: Pt) => (layout.shape === "box" ? p.x - layout.w * 0.16 : p.x);

  // A link that is new on this step draws itself in. A list's link leaves from a dot in its node's
  // "next" box (lib/canvas/structure.ts edgeCurve), so list links are drawn over the nodes; a tree's
  // and a graph's run between circles and sit under them.
  const box = layout.shape === "box";
  // Edges sharing two nodes bend apart (lib/canvas/structure.ts edgeBends); a lone edge stays straight —
  // unless its line would run through another node, when it bends around it (edgeDetour).
  const bends = mark.kind === "graph" ? edgeBends(frame.edges) : frame.edges.map(() => 0);
  const routeOf = (edge: (typeof frame.edges)[number], ei: number) => {
    const a = at(edge.from);
    const b = at(edge.to);
    if (!a || !b) return null;
    const curve = edgeCurve(layout, a, b);
    // The normal of the pair's own direction (lower id → higher id), so A→B and B→A bend to opposite sides.
    const [lo, hi] = edge.from < edge.to ? [a, b] : [b, a];
    const len = Math.hypot(hi.x - lo.x, hi.y - lo.y) || 1;
    const normal = { x: -(hi.y - lo.y) / len, y: (hi.x - lo.x) / len };
    const others = mark.kind === "graph" && layout.shape === "circle" ? frame.nodes.filter((m) => m.id !== edge.from && m.id !== edge.to).map((m) => at(m.id)).filter((p): p is Pt => Boolean(p)) : [];
    const offset = bends[ei] * 2 + edgeDetour(lo, hi, others, layout.r);
    return { p0: curve.p0, p1: curve.p1, c: { x: curve.c.x + normal.x * offset, y: curve.c.y + normal.y * offset }, normal, side: Math.sign(offset) || 0 };
  };
  const links = frame.edges.map((edge, ei) => {
    const route = routeOf(edge, ei);
    if (!route) return null;
    const { p0, p1, c, normal } = route;
    const points = quadPoints(p0, c, p1, 14);
    const bulge = bezier(p0, c, p1, 0.5);
    const side = route.side;
    const labelAt = side ? { x: bulge.x + normal.x * side * 16, y: bulge.y + normal.y * side * 16 + 5 } : { x: c.x, y: c.y - 8 };
    // A BFS tree edge drawn bold; a conflict (both ends in one set) drawn red, with its reason.
    const marked = frame.edgeMarks?.[edgeKey(mark.kind, mark.directed ? "directed" : undefined, edge.from, edge.to)];
    const edgeLook = marked ? EDGE_LOOK[marked] : null;
    return (
      <g key={`${edge.from}>${edge.to}>${ei}`}>
        <Ink points={points} width={edgeLook?.width ?? 3.6} color={edgeLook?.color ?? INK} opacity={edgeLook ? 1 : 0.85} />
        {box && <circle cx={p0.x} cy={p0.y} r={4.2} fill={INK} />}
        {mark.directed && <g className="cv-in cv-late">{arrowHead(p1, bezier(p0, c, p1, 0.82), 12, 3.4).map((d, i) => <path key={i} d={d} fill={INK} opacity={0.85} />)}</g>}
        {edge.label && <text x={labelAt.x} y={labelAt.y} textAnchor="middle" fontSize={14} fontWeight={700} fill={MUTED}>{edge.label}</text>}
      </g>
    );
  });

  /*
   * "same set!" beside each conflict edge, drawn after every edge so none crosses it, on whichever side
   * of its edge is farther from the nodes and the other edges' middles (2026-10-23: it sat on its own
   * edge, then under the next one).
   */
  const conflictLabels = frame.edges.flatMap((edge, ei) => {
    if (frame.edgeMarks?.[edgeKey(mark.kind, mark.directed ? "directed" : undefined, edge.from, edge.to)] !== "conflict") return [];
    // Beside the edge as it is drawn, bent or straight.
    const route = routeOf(edge, ei);
    if (!route) return [];
    const { p0, c, p1 } = route;
    const len = Math.hypot(p1.x - p0.x, p1.y - p0.y) || 1;
    const n = { x: -(p1.y - p0.y) / len, y: (p1.x - p0.x) / len };
    // Every candidate spot (either side, a little along the edge) is scored by how far its label box sits from
    // the nodes and from every other edge's whole line, so the label never lands on a neighbouring edge.
    const nodes = frame.nodes.map((m) => at(m.id)).filter((p): p is Pt => Boolean(p));
    const segs = frame.edges.filter((e) => e !== edge).map((e) => [at(e.from), at(e.to)] as const).filter((s): s is readonly [Pt, Pt] => Boolean(s[0] && s[1]));
    const toSeg = (p: Pt, [u, v]: readonly [Pt, Pt]) => {
      const L = (v.x - u.x) ** 2 + (v.y - u.y) ** 2 || 1;
      const t = Math.max(0, Math.min(1, ((p.x - u.x) * (v.x - u.x) + (p.y - u.y) * (v.y - u.y)) / L));
      return Math.hypot(p.x - (u.x + t * (v.x - u.x)), p.y - (u.y + t * (v.y - u.y)));
    };
    const labelW = CONFLICT_LABEL_W;
    const labelBox = (x: number, y: number, anchor: string) => {
      const left = anchor === "start" ? x : anchor === "end" ? x - labelW : x - labelW / 2;
      return [0, 0.5, 1].flatMap((f) => [{ x: left + f * labelW, y: y - 9 }, { x: left + f * labelW, y: y + 1 }]);
    };
    const room = (pts: Pt[]) => Math.min(...pts.flatMap((p) => [
      ...nodes.map((o) => Math.hypot(o.x - p.x, o.y - p.y) - layout.size * 0.8),
      ...segs.map((s) => toSeg(p, s)),
    ]), Infinity);
    const candidates = [0.5, 0.35, 0.65].flatMap((t) => {
      const mid = { x: (1 - t) ** 2 * p0.x + 2 * (1 - t) * t * c.x + t * t * p1.x, y: (1 - t) ** 2 * p0.y + 2 * (1 - t) * t * c.y + t * t * p1.y };
      return [1, -1].flatMap((side) => [16, 28, 40].map((off) => {
        const dx = n.x * side;
        const anchor = Math.abs(dx) > 0.6 ? (dx > 0 ? "start" : "end") : "middle";
        const x = mid.x + n.x * side * off;
        const y = mid.y + n.y * side * off + 4;
        return { x, y, anchor, score: room(labelBox(x, y, anchor)) - off * 0.05 };
      }));
    });
    const best = candidates.reduce((a, b) => (b.score > a.score ? b : a));
    return [{ key: `${edge.from}>${edge.to}`, x: best.x, y: best.y, anchor: best.anchor }];
  });

  return (
    <g>
      {!box && links}
      {frame.nodes.map((n) => {
        const p = at(n.id);
        if (!p) return null;
        const state = frame.marks[n.id] ?? "none";
        // A node in a set is filled in its set's colour; a mark (visiting, comparing) shows as its outline.
        const set = frame.groups?.[n.id];
        const look = set !== undefined
          ? { fill: SET_LOOK[set].fill, stroke: state !== "none" ? (DS_LOOK[state] ?? DS_LOOK.none).stroke : SET_LOOK[set].stroke }
          : DS_LOOK[state] ?? DS_LOOK.none;
        const lit = focusId === `ds-${n.id}`;
        const changed = shown.t >= 1 && frame.changed.includes(n.id);
        return (
          <g key={n.id} className={lit ? "cv-focus" : undefined}>
            <g className={before.place[n.id] ? undefined : "cv-in"}>
              {nodeShape(n.id, p, look)}
              {/* A list node that points at nothing: its "next" box struck through — null, as it is taught. */}
              {box && !frame.edges.some((ed) => ed.from === n.id) && (
                <Ink points={[{ x: p.x + layout.w * 0.18 + 6, y: p.y + layout.h / 2 - 6 }, { x: p.x + layout.w / 2 - 6, y: p.y - layout.h / 2 + 6 }]} width={2.8} color="#475569" />
              )}
              {changed && <circle key={`flash-${shown.to}`} cx={p.x} cy={p.y} r={Math.max(layout.w, layout.h) * 0.62} fill="#fbbf24" fillOpacity={0.25} className="cv-in" />}
              {/* Ruled out: crossed under its value, lighter, so the number stays readable (QA 2026-10-21). */}
              {state === "remove" && (
                <g className="cv-in" opacity={0.55}>
                  <Ink points={[{ x: p.x - layout.w * 0.55, y: p.y - layout.h * 0.55 }, { x: p.x + layout.w * 0.55, y: p.y + layout.h * 0.55 }]} width={4} color="#be123c" />
                  <Ink points={[{ x: p.x + layout.w * 0.55, y: p.y - layout.h * 0.55 }, { x: p.x - layout.w * 0.55, y: p.y + layout.h * 0.55 }]} width={4} color="#be123c" />
                </g>
              )}
              <text key={`v-${n.value}`} x={valueX(p)} y={p.y + layout.size * 0.36} textAnchor="middle" fontSize={layout.size} fontWeight={800} fill="#0f172a" className={changed ? "cv-in" : undefined}>
                {n.value}
              </text>
            </g>
          </g>
        );
      })}
      {box && links}
      {conflictLabels.map((l) => (
        <g key={`conflict-${l.key}`} className="cv-in">
          <rect x={(l.anchor === "start" ? l.x : l.anchor === "end" ? l.x - CONFLICT_LABEL_W : l.x - CONFLICT_LABEL_W / 2) - 3} y={l.y - 11} width={CONFLICT_LABEL_W + 6} height={15} rx={4} data-plate="" />
          <text x={l.x} y={l.y} textAnchor={l.anchor as "start" | "end" | "middle"} fontSize={13} fontWeight={800} fill={EDGE_LOOK.conflict.color}>same set!</text>
        </g>
      ))}
      {/* Removed on this step: crossed out where it was, fading as the rest settles. */}
      {shown.t < 1 && gone.map((n) => {
        const p = before.place[n.id];
        if (!p) return null;
        return (
          <g key={`gone-${n.id}`} opacity={1 - e}>
            {nodeShape(n.id, p, DS_LOOK.remove)}
            <text x={valueX(p)} y={p.y + layout.size * 0.36} textAnchor="middle" fontSize={layout.size} fontWeight={800} fill="#be123c">{n.value}</text>
          </g>
        );
      })}
      {after.indices.map((ix) => (
        <text key={`ix-${ix.text}`} x={ix.at.x} y={ix.at.y} textAnchor="middle" fontSize={13} fontFamily={MONO_FONT} fill={MUTED}>{ix.text}</text>
      ))}
      {/* Pointers (root, curr, i, mid…): a name tag with an arrow at the node, gliding with it. */}
      {after.pointers.map((ptr) => {
        const was = before.pointers.find((q) => q.name === ptr.name);
        const tag = lerp(was?.at, ptr.at)!;
        const tip = lerp(was?.tip, ptr.tip)!;
        const w = Math.max(30, ptr.name.length * 8.6 + 14);
        return (
          <g key={`ptr-${ptr.name}`} className={was ? undefined : "cv-in"}>
            <rect x={tag.x - w / 2} y={tag.y - 13} width={w} height={22} rx={11} fill={POINTER_INK} />
            <text x={tag.x} y={tag.y + 3} textAnchor="middle" fontSize={13} fontWeight={800} fill="#ffffff" fontFamily={MONO_FONT}>{ptr.name}</text>
            {/* Several tags on one node stack up; only the nearest draws the arrow, so none crosses a tag. */}
            {ptr.arrow && (
              <>
                <line x1={tag.x} y1={tag.y + (tip.y > tag.y ? 9 : -13)} x2={tip.x} y2={tip.y} stroke={POINTER_INK} strokeWidth={2.4} strokeLinecap="round" />
                {arrowHead(tip, { x: tag.x, y: tag.y }, 9, 2.6).map((d, i) => <path key={i} d={d} fill={POINTER_INK} />)}
              </>
            )}
          </g>
        );
      })}
      {/* A list's null slot (null ← A ← B), with the tags of the pointers that hold None under it. */}
      {layout.nullMark && (
        <g className="cv-in">
          <rect x={layout.nullMark.x - layout.w * 0.42} y={layout.nullMark.y - layout.h * 0.38} width={layout.w * 0.84} height={layout.h * 0.76} rx={8} fill="none" stroke="#94a3b8" strokeWidth={1.8} strokeDasharray="5 4" />
          <text x={layout.nullMark.x} y={layout.nullMark.y + 5} textAnchor="middle" fontSize={15} fontWeight={800} fontFamily={MONO_FONT} fill="#94a3b8">null</text>
        </g>
      )}
      {layout.nullMark && (after.nulls ?? []).map((nl) => {
        const was = before.nulls?.find((q) => q.name === nl.name);
        const tag = lerp(was?.at, nl.at)!;
        const w = Math.max(30, nl.name.length * 8.6 + 14);
        return (
          <g key={`null-${nl.name}`} className={was ? undefined : "cv-in"}>
            <rect x={tag.x - w / 2} y={tag.y - 13} width={w} height={22} rx={11} fill={POINTER_INK} />
            <text x={tag.x} y={tag.y + 3} textAnchor="middle" fontSize={13} fontWeight={800} fill="#ffffff" fontFamily={MONO_FONT}>{nl.name}</text>
            {nl.arrow && nl.tip && (
              <>
                <line x1={tag.x} y1={tag.y - 13} x2={nl.tip.x} y2={nl.tip.y} stroke={POINTER_INK} strokeWidth={2.4} strokeLinecap="round" />
                {arrowHead(nl.tip, { x: tag.x, y: tag.y }, 9, 2.6).map((d, i) => <path key={i} d={d} fill={POINTER_INK} />)}
              </>
            )}
          </g>
        );
      })}
      {/* Elsewhere (a tree, a graph), a pointer holding null is a tag reading "name → null". */}
      {!layout.nullMark && (after.nulls ?? []).map((nl) => {
        const w = Math.max(30, nl.name.length * 8.6 + 14);
        return (
          <g key={`null-${nl.name}`} className="cv-in">
            <rect x={nl.at.x - w / 2} y={nl.at.y - 13} width={w} height={22} rx={11} fill={POINTER_INK} />
            <text x={nl.at.x} y={nl.at.y + 3} textAnchor="middle" fontSize={13} fontWeight={800} fill="#ffffff" fontFamily={MONO_FONT}>{nl.name}</text>
            <line x1={nl.at.x + w / 2 + 3} y1={nl.at.y - 2} x2={nl.at.x + w / 2 + 20} y2={nl.at.y - 2} stroke={POINTER_INK} strokeWidth={2.4} strokeLinecap="round" />
            {arrowHead({ x: nl.at.x + w / 2 + 22, y: nl.at.y - 2 }, { x: nl.at.x, y: nl.at.y - 2 }, 8, 2.4).map((d, i) => <path key={i} d={d} fill={POINTER_INK} />)}
            <text x={nl.at.x + w / 2 + 28} y={nl.at.y + 3} fontSize={14} fontWeight={800} fontFamily={MONO_FONT} fill="#475569">null</text>
          </g>
        );
      })}
      {/* The two sets' legend, once a node has been put in one. */}
      {Object.keys(frame.groups ?? {}).length > 0 && (
        <g className="cv-in">
          {SET_LOOK.map((look, k) => (
            <g key={look.name}>
              <circle cx={mark.rect.x + 12 + k * 92} cy={mark.rect.y + 10} r={8} fill={look.fill} stroke={look.stroke} strokeWidth={2.2} />
              <text x={mark.rect.x + 26 + k * 92} y={mark.rect.y + 15} fontSize={14} fontWeight={800} fill={look.stroke}>{look.name}</text>
            </g>
          ))}
        </g>
      )}
      {caption && (
        <text key={caption.s} x={mark.rect.x + mark.rect.w / 2} y={mark.captionY} textAnchor="middle" fontSize={20} fontWeight={600} fill={MUTED} className="cv-in">
          {caption.text}
        </text>
      )}
    </g>
  );
}

function IonPath({ fromX, toX, y, charge, color, animate }: { fromX: number; toX: number; y: number; charge: string; color: string; animate: boolean }) {
  const end = toX > fromX ? toX - 8 : toX + 8;
  const direction = Math.sign(toX - fromX) || 1;
  return (
    <g>
      <line x1={fromX} y1={y} x2={end} y2={y} stroke={color} strokeWidth={2.5} strokeDasharray="7 7" opacity={0.72} />
      <path d={`M${end} ${y} l${-direction * 10} -6 v12 Z`} fill={color} />
      <g>
        <circle cx={fromX} cy={y} r={12} fill="#fff" stroke={color} strokeWidth={3} />
        <text x={fromX} y={y + 5} textAnchor="middle" fontSize={16} fontWeight={900} fill={color}>{charge}</text>
        {animate && <animateTransform attributeName="transform" type="translate" values={`0 0; ${end - fromX} 0; 0 0`} dur="3.2s" repeatCount="indefinite" />}
      </g>
    </g>
  );
}

const ELEMENT_COLOR: Record<string, string> = { C: "#334155", H: "#e2e8f0", O: "#dc2626", N: "#2563eb", P: "#f97316", S: "#eab308", F: "#16a34a", Cl: "#16a34a" };

function MoleculeView({ mark, rotation }: { mark: Extract<Mark, { type: "molecule" }>; rotation: number }) {
  const angle = (rotation * Math.PI) / 180;
  const scale = Math.min(mark.rect.w, mark.rect.h) * 0.3;
  const cx = mark.rect.x + mark.rect.w / 2;
  const cy = mark.rect.y + mark.rect.h * 0.46;
  const points = new Map(mark.molecule.atoms.map((atom) => {
    const rx = atom.x * Math.cos(angle) - atom.z * Math.sin(angle);
    const rz = atom.x * Math.sin(angle) + atom.z * Math.cos(angle);
    return [atom.id, { x: cx + rx * scale, y: cy + (atom.y * 0.82 - rz * 0.18) * scale, z: rz }];
  }));
  return <g className="cv-in"><rect x={mark.rect.x} y={mark.rect.y} width={mark.rect.w} height={mark.rect.h} rx={18} fill="#fff" opacity={0.64} stroke="#cbd5e1" />
    {mark.molecule.bonds.map((bond, index) => { const a = points.get(bond.from); const b = points.get(bond.to); if (!a || !b) return null; if (bond.style === "wedge") return <path key={index} d={`M${a.x} ${a.y} L${b.x - 8} ${b.y + 7} L${b.x + 8} ${b.y - 7} Z`} fill="#475569" opacity={0.82} />; const offsets = bond.order === 1 ? [0] : bond.order === 2 ? [-4, 4] : [-6, 0, 6]; return <g key={index}>{offsets.map((offset) => <line key={offset} x1={a.x} y1={a.y + offset} x2={b.x} y2={b.y + offset} stroke="#475569" strokeWidth={3} strokeDasharray={bond.style === "dash" ? "5 8" : undefined} strokeLinecap="round" />)}</g>; })}
    {[...mark.molecule.atoms].sort((a, b) => (points.get(a.id)?.z ?? 0) - (points.get(b.id)?.z ?? 0)).map((atom) => { const p = points.get(atom.id)!; const r = 20 + Math.max(-4, Math.min(5, p.z * 4)); return <g key={atom.id}><circle cx={p.x} cy={p.y} r={r} fill={atom.color ?? ELEMENT_COLOR[atom.element] ?? "#8b5cf6"} stroke="#fff" strokeWidth={3} /><text x={p.x} y={p.y + 6} textAnchor="middle" fontSize={17} fontWeight={900} fill={atom.element === "H" ? "#334155" : "#fff"}>{atom.element}</text>{Array.from({ length: atom.lonePairs ?? 0 }, (_, i) => <g key={i} transform={`rotate(${i * 90} ${p.x} ${p.y})`}><circle cx={p.x - 4} cy={p.y - r - 9} r={2.5} fill="#334155" /><circle cx={p.x + 4} cy={p.y - r - 9} r={2.5} fill="#334155" /></g>)}</g>; })}
    <text x={cx} y={mark.rect.y + mark.rect.h - 48} textAnchor="middle" fontSize={22} fontWeight={850} fill={INK}>{mark.molecule.label}</text><text x={cx} y={mark.rect.y + mark.rect.h - 22} textAnchor="middle" fontSize={16} fontWeight={700} fill={MUTED}>{[mark.molecule.geometry, mark.molecule.bondAngle].filter(Boolean).join(" · ")}</text>
  </g>;
}

/**
 * One balanced reaction: reactant cards, an arrow, product cards, energy in its own lane. Cards are
 * sized from the terms on BOTH sides together, with "+" between terms; when they do not fit in one
 * row, reactants sit above products with the arrow between. Each card's formula is set at the size
 * that fits it. (Sized per side, the two sides overlapped in the middle and the titles ran into
 * each other — audit 2026-10-17.)
 */
function AtomMapView({ mark }: { mark: Extract<Mark, { type: "atom-map" }> }) {
  const { reactants, products } = mark.stage;
  const R = mark.rect;
  const plusW = 26;
  const arrowW = 96;
  const n = reactants.length + products.length;
  const oneRowW = (R.w - arrowW - plusW * Math.max(0, n - 2)) / Math.max(1, n);
  const twoRows = oneRowW < 118;
  const groupW = twoRows ? Math.min(176, (R.w - plusW * (Math.max(reactants.length, products.length) - 1)) / Math.max(reactants.length, products.length)) : Math.min(176, oneRowW);
  const cardH = 116;
  const rowW = (count: number) => count * groupW + Math.max(0, count - 1) * plusW;
  const card = (group: typeof reactants[number], x: number, y: number) => {
    const fit = Math.min(17, Math.floor((groupW - 16) / Math.max(1, textWidth(group.label, 1))));
    const size = Math.max(12, fit);
    const lines = fit >= 12 ? [group.label] : wrap(group.label, 12, groupW - 14, 2);
    const r = Math.min(18, (groupW - 16) / (2.6 * Math.max(1, group.atoms.length)));
    const step = (groupW - 2 * (r + 10)) / Math.max(1, group.atoms.length - 1);
    return (
      <g key={group.id} className="cv-in">
        <rect x={x} y={y} width={groupW} height={cardH} rx={16} fill="#fff" stroke="#cbd5e1" strokeWidth={2} />
        {lines.map((line, k) => <text key={k} x={x + groupW / 2} y={y + (lines.length > 1 ? 20 + k * 14 : 27)} textAnchor="middle" fontSize={lines.length > 1 ? 12 : size} fontWeight={850} fill={INK}>{line}</text>)}
        {group.atoms.map((atom, k) => {
          const cx = group.atoms.length === 1 ? x + groupW / 2 : x + r + 10 + k * step;
          return (
            <g key={atom.element} transform={`translate(${cx},${y + 69})`}>
              <circle r={r} fill={ELEMENT_COLOR[atom.element] ?? "#8b5cf6"} stroke="#fff" strokeWidth={2} />
              <text y={r * 0.3} textAnchor="middle" fontSize={Math.min(14, r * 0.8)} fontWeight={900} fill={atom.element === "H" ? "#334155" : "#fff"}>{atom.element}</text>
              <text y={r + 19} textAnchor="middle" fontSize={13} fontWeight={800} fill={MUTED}>×{atom.count}</text>
            </g>
          );
        })}
      </g>
    );
  };
  const row = (groups: typeof reactants, x0: number, y: number) => groups.map((g, i) => {
    const x = x0 + i * (groupW + plusW);
    return (
      <g key={g.id}>
        {card(g, x, y)}
        {i < groups.length - 1 && <text x={x + groupW + plusW / 2} y={y + cardH / 2 + 8} textAnchor="middle" fontSize={24} fontWeight={800} fill={MUTED}>+</text>}
      </g>
    );
  });
  const top = R.y + 72;
  let body: React.ReactNode;
  if (twoRows) {
    const y2 = top + cardH + 46;
    const midX = R.x + R.w / 2;
    body = (
      <g>
        {row(reactants, R.x + (R.w - rowW(reactants.length)) / 2, top)}
        <path d={`M${midX} ${top + cardH + 8}V${y2 - 10}`} stroke="#475569" strokeWidth={4} />
        <path d={`M${midX} ${y2 - 6}l-8 -14h16z`} fill="#475569" />
        {row(products, R.x + (R.w - rowW(products.length)) / 2, y2)}
      </g>
    );
  } else {
    const leftW = rowW(reactants.length);
    const total = leftW + arrowW + rowW(products.length);
    const x0 = R.x + (R.w - total) / 2;
    const ax = x0 + leftW + 14;
    body = (
      <g>
        {row(reactants, x0, top)}
        <path d={`M${ax} ${top + cardH / 2}H${ax + arrowW - 28}`} stroke="#475569" strokeWidth={4} />
        <path d={`M${ax + arrowW - 28} ${top + cardH / 2}l-14 -8v16z`} fill="#475569" />
        {row(products, x0 + leftW + arrowW, top)}
      </g>
    );
  }
  const energyY = twoRows ? top + 2 * cardH + 66 : R.y + 250;
  return (
    <g>
      <text x={R.x + R.w / 2} y={R.y + 52} textAnchor="middle" fontSize={14} fontWeight={900} fill={MUTED}>MATTER · atoms conserved</text>
      {body}
      {mark.stage.energy && (
        <g>
          <rect x={R.x + 20} y={energyY} width={R.w - 40} height={twoRows ? 64 : 82} rx={18} fill="#fef3c7" stroke="#f59e0b" strokeWidth={2} />
          <text x={R.x + 40} y={energyY + (twoRows ? 24 : 30)} fontSize={14} fontWeight={900} fill="#92400e">ENERGY · separate lane</text>
          <text x={R.x + 40} y={energyY + (twoRows ? 50 : 60)} fontSize={18} fontWeight={750} fill="#92400e">{mark.stage.energy.input} → {mark.stage.energy.output}</text>
        </g>
      )}
    </g>
  );
}

/* ── code: a listing walked through, line by line ─────────────────────────────────────────── */

const MONO_FONT = "ui-monospace, 'JetBrains Mono', SFMono-Regular, Menlo, Consolas, monospace";
const CODE_KEYWORDS = new Set(("and as break case catch class const continue def do elif else except false finally for from function if import in int is lambda let not null or pass print public range return static switch this throw true try var void while with yield None True False fn struct mut match").split(" "));

/** Light syntax colouring: enough to read structure (keywords, strings, numbers, calls, comments). */
function codeTokens(line: string): Array<{ text: string; color: string; italic?: boolean }> {
  const out: Array<{ text: string; color: string; italic?: boolean }> = [];
  const re = /(#.*$|\/\/.*$)|("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')|(\b\d+(?:\.\d+)?\b)|([A-Za-z_][A-Za-z0-9_]*)(?=\s*\()|([A-Za-z_][A-Za-z0-9_]*)|(\s+)|([^\sA-Za-z0-9_"'#]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line))) {
    if (m[1]) out.push({ text: m[1], color: "#7f8aa8", italic: true });
    else if (m[2]) out.push({ text: m[2], color: "#c3e88d" });
    else if (m[3]) out.push({ text: m[3], color: "#f78c6c" });
    else if (m[4]) out.push({ text: m[4], color: CODE_KEYWORDS.has(m[4]) ? "#c792ea" : "#82aaff" });
    else if (m[5]) out.push({ text: m[5], color: CODE_KEYWORDS.has(m[5]) ? "#c792ea" : "#e6e9f0" });
    else if (m[6]) out.push({ text: m[6], color: "#e6e9f0" });
    else out.push({ text: m[7], color: "#89ddff" });
  }
  return out;
}

const GROUP_COLOURS = ["#0f766e", "#7c3aed", "#c2410c", "#2563eb"];

function CodeView({ mark, shownThrough, focusId }: { mark: Extract<Mark, { type: "code" }>; shownThrough: number; focusId?: string }) {
  const { rect, size, lineH, gutter } = mark;
  // The step being explained: the latest one whose sentence has come. A finished board rests on its last.
  const reached = mark.steps.filter((st) => st.s <= shownThrough);
  const step = reached.at(-1);
  const lit = new Set(step?.lines ?? []);
  const top = rect.y + 14;
  const baseline = (i: number) => top + i * lineH + lineH * 0.7;
  const textX = rect.x + gutter + 14;
  const first = step ? Math.min(...step.lines) : 0;
  // BUILD-UP: the code writes itself as Aria reaches each line (Code Hike's scrollycoding); a finished
  // board shows it whole. "all" shows the listing from the start.
  const upTo = (steps: typeof reached) => Math.max(0, ...steps.flatMap((st) => st.lines));
  // Before its first line is reached the card is empty: the whole listing stood on the board while Aria
  // was still introducing it (owner, 2026-10-22: "it writes everything on the board before it even speaks").
  const shown = mark.reveal === "all" || shownThrough === Infinity ? mark.lines.length : !step ? 0 : upTo(reached);
  const before = mark.reveal === "all" ? mark.lines.length : upTo(reached.slice(0, -1));
  const textOf = (i: number) => {
    const edit = mark.edits.find((e) => e.line === i + 1);
    return edit && shownThrough < edit.s ? edit.from : mark.lines[i];
  };
  const lineEnd = first ? textX + textOf(first - 1).length * 0.6 * size : 0;
  // The code stays on its card: a line still too long at the smallest size is cut at the card's edge,
  // never drawn into the structure or the variables beside it (owner, 2026-10-23).
  const clipId = `code-clip-${useId().replace(/:/g, "")}`;
  return (
    <g>
      <defs>
        <clipPath id={clipId}>
          <rect x={rect.x} y={rect.y} width={rect.w - 6} height={rect.h} />
        </clipPath>
      </defs>
      <rect x={rect.x} y={rect.y} width={rect.w} height={rect.h} rx={14} fill="#1e2030" />
      <rect x={rect.x} y={rect.y} width={gutter} height={rect.h} rx={14} fill="#191a29" />
      <rect x={rect.x + gutter - 14} y={rect.y} width={14} height={rect.h} fill="#191a29" />
      {/* The lines being talked about, lit; the pointer glides between steps. */}
      {[...lit].filter((n) => n <= shown).map((n) => (
        // fillOpacity, not opacity: the cv-in reveal animates opacity to 1 and would make the band solid.
        <rect key={`lit-${n}`} x={rect.x + gutter} y={top + (n - 1) * lineH} width={rect.w - gutter - 6} height={lineH} fill="#fbbf24" fillOpacity={0.16} className="cv-in" />
      ))}
      {/* A line that has just been fixed glows green once. */}
      {mark.edits.filter((e) => step && e.s === step.s && e.line <= shown).map((e) => (
        <rect key={`fix-${e.line}`} x={rect.x + gutter} y={top + (e.line - 1) * lineH} width={rect.w - gutter - 6} height={lineH} fill="#22c55e" fillOpacity={0.2} className="cv-in" />
      ))}
      {step && first <= shown && (
        <g style={{ transform: `translate(${rect.x + gutter - 15}px, ${top + (first - 1) * lineH + lineH / 2}px)`, transition: "transform 450ms cubic-bezier(.65,0,.25,1)" }}>
          <path d="M-5 -6 L5 0 L-5 6 Z" fill="#fbbf24" />
        </g>
      )}
      {mark.lines.slice(0, shown).map((_, i) => {
        const edit = mark.edits.find((e) => e.line === i + 1);
        const fixedNow = edit && shownThrough >= edit.s;
        return (
          <g key={i} className="cv-in" clipPath={`url(#${clipId})`} style={{ animationDelay: `${Math.max(0, i - before) * 60}ms` }}>
            <text x={rect.x + gutter - 22} y={baseline(i)} textAnchor="end" fontSize={size * 0.78} fontFamily={MONO_FONT} fill={lit.has(i + 1) ? "#e6e9f0" : "#4b5068"}>
              {i + 1}
            </text>
            {/* The bug lifts away as its fix writes itself in (Shiki Magic Move's idea, for one line). */}
            {fixedNow && (
              <text key={`old-${edit.s}`} x={textX} y={baseline(i)} fontSize={size} fontFamily={MONO_FONT} xmlSpace="preserve" style={{ whiteSpace: "pre" }} fill="#f87171" textDecoration="line-through" className="cv-morph-out">
                {edit.from}
              </text>
            )}
            <text key={fixedNow ? `new-${edit.s}` : "line"} x={textX} y={baseline(i)} fontSize={size} fontFamily={MONO_FONT} xmlSpace="preserve" style={{ whiteSpace: "pre" }} className={`${fixedNow ? "cv-write" : ""}${focusId === `line-${i + 1}` ? " cv-focus" : ""}`}>
              {codeTokens(textOf(i)).map((t, k) => (
                <tspan key={k} fill={t.color} fontStyle={t.italic ? "italic" : undefined}>
                  {t.text}
                </tspan>
              ))}
            </text>
          </g>
        );
      })}
      {/* SUBGOAL LABELS: what each chunk of lines is FOR (Margulieux) — a bracket and its name. */}
      {mark.groups.filter((g) => g.s <= shownThrough && g.to <= shown).map((g, i) => {
        const y1 = top + (g.from - 1) * lineH + 5;
        const y2 = top + g.to * lineH - 5;
        const colour = GROUP_COLOURS[i % GROUP_COLOURS.length];
        return (
          <g key={`g-${g.from}`} className="cv-in">
            <path d={`M${g.x} ${y1} h7 V${y2} h-7`} fill="none" stroke={colour} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />
            <text x={g.x + 15} y={(y1 + y2) / 2 + 5} fontSize={13.5} fontWeight={800} fill={colour}>
              {g.label}
            </text>
          </g>
        );
      })}
      {step?.note && first <= shown && (() => {
        // Beside the line it explains when it fits (the layout widens the card for it); otherwise on
        // its own pill in the card's corner, never printed over code.
        const noteSize = Math.max(12, size * 0.78);
        const noteW = (step.note.length + 2) * noteSize * 0.56;
        const fits = lineEnd + 18 + noteW < rect.x + rect.w - 8;
        const x = fits ? lineEnd + 18 : rect.x + rect.w - noteW - 18;
        const y = fits ? baseline(first - 1) : rect.y - 12;
        return (
          <g key={`note-${step.s}`} className="cv-in">
            {!fits && <rect x={x - 8} y={y - noteSize - 2} width={noteW + 16} height={noteSize + 12} rx={(noteSize + 12) / 2} fill="#1e2030" />}
            <text x={x} y={y} fontSize={noteSize} fontWeight={700} fill="#fbbf24">
              {fits ? "← " : `line ${first}: `}{step.note}
            </text>
          </g>
        );
      })()}
    </g>
  );
}

/**
 * THE VARIABLES PANEL — what the program's variables hold right now, the way a debugger (or Python
 * Tutor) shows it: it follows the execution pointer, and a value that just changed flashes.
 */
function StateView({ mark, shownThrough }: { mark: Extract<Mark, { type: "state" }>; shownThrough: number }) {
  if (mark.pencil) return <PencilStateView mark={mark} shownThrough={shownThrough} />;
  const { rect } = mark;
  const withState = mark.steps.filter((st) => st.state && st.s <= shownThrough);
  const now = withState.at(-1)?.state ?? [];
  const before = withState.at(-2)?.state ?? [];
  const names = [...new Set(mark.steps.flatMap((st) => (st.state ?? []).map((v) => v.name)))];
  return (
    <g className="cv-in">
      <rect x={rect.x} y={rect.y} width={rect.w} height={rect.h} rx={12} fill="#fff" stroke="#e7e2d6" strokeWidth={2} />
      <text x={rect.x + 14} y={rect.y + 22} fontSize={11} fontWeight={800} letterSpacing={1.2} fill="#64748b">VARIABLES</text>
      {names.map((name, i) => {
        const v = now.find((x) => x.name === name);
        const changed = v && before.find((x) => x.name === name)?.value !== v.value;
        const y = rect.y + 44 + i * 26;
        return (
          <g key={name}>
            {changed && <rect key={`flash-${v.value}`} x={rect.x + 8} y={y - 16} width={rect.w - 16} height={22} rx={6} fill="#fbbf24" fillOpacity={0.22} className="cv-in" />}
            <text x={rect.x + 16} y={y} fontSize={15} fontFamily={MONO_FONT} fill="#64748b">{name}</text>
            <text x={rect.x + rect.w - 16} y={y} textAnchor="end" fontSize={15} fontWeight={700} fontFamily={MONO_FONT} fill={v ? "#1f2937" : "#cbd5e1"} key={`v-${v?.value ?? "none"}`} className="cv-in">
              {v ? v.value : "—"}
            </text>
          </g>
        );
      })}
    </g>
  );
}

/**
 * THE VARIABLES AS A TEACHER DRAWS THEM (owner, 2026-10-22: pencil sketches alongside the code): each
 * variable a pencil-drawn memory box beside its name, holding what it holds now; the values it held
 * before stay beside it, crossed out, so the student sees the whole history of the run — the way a
 * program is traced by hand on a board. The newest value is written in Aria's colour.
 */
function PencilStateView({ mark, shownThrough }: { mark: Extract<Mark, { type: "state" }>; shownThrough: number }) {
  const { rect } = mark;
  const shown = mark.steps.filter((st) => st.state && st.s <= shownThrough);
  // Only the variables that exist by now: a box for one the code creates later is a spoiler.
  const names = [...new Set(shown.flatMap((st) => (st.state ?? []).map((v) => v.name)))];
  const last = shown.at(-1);
  const rowH = Math.min(46, (rect.h - 34) / Math.max(1, names.length));
  // Names are set in the code font: measured as monospace (0.6 em a character), with a gap.
  const nameW = Math.min(rect.w * 0.36, Math.max(...names.map((n) => n.length * 16 * 0.6)) + 18);
  // A name too long for its column ("candidate_length") is set smaller to fit, never over its value box (CS test, 2026-10-23).
  const nameSize = (n: string) => Math.max(10, Math.min(16, Math.floor((nameW - 12) / Math.max(1, n.length * 0.6))));
  // Values are written in the code font, so they are measured as monospace too: the proportional
  // measure was ~20% short and a colours dictionary ran off the board (owner, 2026-10-23).
  const boxW = Math.min(rect.w * 0.3, Math.max(64, ...mark.steps.flatMap((st) => (st.state ?? []).map((v) => monoWidth(v.value, 17) + 22))));
  return (
    <g className="cv-in" data-mark="state">
      <text x={rect.x} y={rect.y + 16} fontSize={15} fontWeight={700} fill="#64748b">variables</text>
      {names.map((name, i) => {
        const values: string[] = [];
        for (const st of shown) {
          const v = st.state!.find((x) => x.name === name)?.value;
          if (v !== undefined && values.at(-1) !== v) values.push(v);
        }
        const now = values.at(-1);
        // Lit in Aria's colour on the sentence that changed it.
        const before = shown.slice(0, -1).reverse().find((st) => st.state!.some((x) => x.name === name))?.state!.find((x) => x.name === name)?.value;
        const justChanged = now !== undefined && last?.s === shownThrough && last.state!.some((x) => x.name === name) && before !== now;
        const y = rect.y + 30 + i * rowH;
        const h = rowH - 10;
        const bx = rect.x + nameW;
        let ox = bx + boxW + 14;
        // A list, queue, stack or set is drawn as its cells in pencil — BFS's queue as boxes that fill and
        // empty (CS round, 2026-10-22) — with its front or top marked; the history is in the cells.
        const items = now !== undefined ? listItems(now) : null;
        if (items) {
          // Cells at full size, else compact; a set too long for either is written as text that fits.
          const room = rect.x + rect.w - bx;
          const full = items.map((it) => Math.max(34, monoWidth(it, 16) + 18));
          const compact = items.map((it) => Math.max(24, monoWidth(it, 13) + 10));
          const cellW = full.reduce((a, b) => a + b, 0) <= room ? full : compact;
          const cellFont = cellW === full ? 16 : 13;
          const total = cellW.reduce((a, b) => a + b, 0);
          if (total > room) {
            // Too long for cells: written as text that FITS — on one line if it can at 11 px or more,
            // else on two lines broken after a comma — never past the board's edge.
            const { lines, size } = fitValue(now!, room, h);
            return (
              <g key={name}>
                <text x={rect.x} y={y + h * 0.68} fontSize={nameSize(name)} fontFamily={MONO_FONT} fill={INK}>{name}</text>
                <text key={`v-${now}`} x={bx} y={lines.length > 1 ? y + size : y + h * 0.68} fontSize={size} fontWeight={700} fontFamily={MONO_FONT} fill={justChanged ? ARIA_INK : INK} className="cv-in">
                  {lines.map((l, k) => <tspan key={k} x={bx} dy={k === 0 ? 0 : size * 1.15}>{l}</tspan>)}
                </text>
              </g>
            );
          }
          {
            let cx = bx;
            const end = /stack/i.test(name) ? "top" : /queue/i.test(name) ? "front" : "";
            return (
              <g key={name}>
                <text x={rect.x} y={y + h * 0.68} fontSize={nameSize(name)} fontFamily={MONO_FONT} fill={INK}>{name}</text>
                {items.length === 0 && <text x={bx + 4} y={y + h * 0.68} fontSize={15} fill="#94a3b8">empty</text>}
                {items.map((it, k) => {
                  const x = cx;
                  cx += cellW[k];
                  return (
                    <g key={`${k}-${it}`} className="cv-in">
                      <Sketch d={roughRect(`cell-${mark.id}-${name}-${k}`, x, y, cellW[k], h, 4)} color={INK} width={2} />
                      <text x={x + cellW[k] / 2} y={y + h * 0.7} textAnchor="middle" fontSize={cellFont} fontWeight={700} fontFamily={MONO_FONT} fill={justChanged && k === items.length - 1 ? ARIA_INK : INK}>{it}</text>
                    </g>
                  );
                })}
                {/* Under its cell only where nothing is below it (the last row, or rows tall enough): it sat on the next row's name. */}
                {end && items.length > 0 && (i === names.length - 1 || rowH >= 60) && <text x={end === "front" ? bx + cellW[0] / 2 : cx - cellW[items.length - 1] / 2} y={y + h + 13} textAnchor="middle" fontSize={12} fill="#94a3b8">{end}</text>}
              </g>
            );
          }
        }
        return (
          <g key={name}>
            <text x={rect.x} y={y + h * 0.68} fontSize={nameSize(name)} fontFamily={MONO_FONT} fill={INK}>{name}</text>
            <Sketch d={roughRect(`var-${mark.id}-${name}`, bx, y, boxW, h, 6)} color={INK} width={2} />
            {now !== undefined && (() => {
              // A long value shrinks to fit its box — and past 10 px it breaks onto two lines — never
              // spilling over its name or its history.
              const { lines, size } = fitValue(now, boxW - 12, h, 17);
              return (
                <text key={`v-${now}`} x={bx + boxW / 2} y={lines.length > 1 ? y + size : y + h * 0.7} textAnchor="middle" fontSize={size} fontWeight={700} fontFamily={MONO_FONT} fill={justChanged ? ARIA_INK : INK} className="cv-in">
                  {lines.map((l, k) => <tspan key={k} x={bx + boxW / 2} dy={k === 0 ? 0 : size * 1.15}>{l}</tspan>)}
                </text>
              );
            })()}
            {/* Oldest first, as a teacher crosses them out: 3̶ 2̶ 1̶. */}
            {values.slice(-4, -1).map((old, k) => {
              const w = textWidth(old, 14) + 4;
              const x = ox;
              ox += w + 12;
              if (x + w > rect.x + rect.w) return null;
              return (
                <g key={`old-${k}-${old}`} className="cv-in" opacity={0.6}>
                  <text x={x} y={y + h * 0.7} fontSize={14} fontFamily={MONO_FONT} fill={INK}>{old}</text>
                  <Sketch d={`M${x - 2} ${y + h * 0.48} L${x + w + 1} ${y + h * 0.4}`} color={INK} width={1.6} />
                </g>
              );
            })}
          </g>
        );
      })}
    </g>
  );
}

/** Width of text in the code font (monospace: 0.6 em a character). */
function monoWidth(text: string, size: number): number {
  return text.length * size * 0.6;
}

/** The items of a list, tuple or set value ("[B, C]", "{A, B}", "[]"), or null when it is not one. */
function listItems(value: string): string[] | null {
  const m = /^\s*[[{(]\s*(.*?)\s*[\]})]\s*$/.exec(value);
  if (!m) return null;
  return m[1] ? m[1].split(/\s*,\s*/).filter((x) => x !== "") : [];
}

/**
 * THE CALL STACK (2026-10-20, from the Visuals Lab): one box per call of a recursive function, in the
 * order they were made, newest at the bottom. The running call's box is lit; a call that has returned
 * stays, dimmed and crossed out, with what it gave back — the student keeps the whole history.
 */
function CallStackView({ mark, shownThrough }: { mark: Extract<Mark, { type: "stack" }>; shownThrough: number }) {
  const { rect } = mark;
  const frames = stackAt(mark.view, shownThrough);
  if (!frames.length) return null;
  return (
    <g className="cv-in" data-mark="stack">
      <text x={rect.x + 4} y={rect.y + 16} fontSize={15} fontWeight={700} fill="#64748b">call stack</text>
      {frames.map((f, i) => {
        const b = mark.boxes[f.id];
        const next = frames[i + 1] ? mark.boxes[frames[i + 1].id] : undefined;
        return (
          <g key={f.id} className="cv-in" data-target={f.id}>
            {next && <path d={`M${b.x + 28} ${b.y + b.h + 3} V ${next.y - 4} M${b.x + 22} ${next.y - 10} L${b.x + 28} ${next.y - 3} L${b.x + 34} ${next.y - 10}`} fill="none" stroke="#64748b" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />}
            <g opacity={f.done ? 0.5 : 1} style={{ transition: "opacity 400ms ease" }}>
              {/* Pencil frames, as a teacher draws the stack (owner, 2026-10-22); the running call in Aria's colour. */}
              <Sketch d={roughRect(`frame-${f.id}`, b.x, b.y, b.w, b.h, 10)} color={f.top ? ARIA_INK : INK} width={f.top ? 2.6 : 2} />
              <text x={b.x + 12} y={b.y + Math.min(25, b.h * 0.42)} fontSize={15} fontWeight={800} fontFamily={MONO_FONT} fill="#1f2937">{f.call}</text>
              {f.value && (
                <text key={`v-${f.value}`} x={b.x + 12} y={b.y + b.h - Math.max(10, b.h * 0.2)} fontSize={14} fontFamily={MONO_FONT} fill="#1f2937" className="cv-in">
                  {f.value}
                </text>
              )}
              {f.done && <path d={`M${b.x + 10} ${b.y + b.h - 8} L${b.x + b.w - 10} ${b.y + 8}`} stroke="#64748b" strokeWidth={2.5} strokeLinecap="round" className="cv-in" />}
            </g>
          </g>
        );
      })}
    </g>
  );
}

/** What the variables hold as the code runs: a row appears on its sentence; the newest is lit. */
function TraceView({ mark, shownThrough }: { mark: Extract<Mark, { type: "trace" }>; shownThrough: number }) {
  const { rect } = mark;
  const rowH = 24;
  const colW = (rect.w - 16) / mark.vars.length;
  const shown = mark.rows.filter((r) => r.s <= shownThrough);
  return (
    <g className="cv-in">
      <rect x={rect.x} y={rect.y} width={rect.w} height={rect.h} rx={12} fill="#fff" stroke="#e7e2d6" strokeWidth={2} />
      {mark.vars.map((v, k) => (
        <text key={v} x={rect.x + 8 + colW * k + colW / 2} y={rect.y + 26} textAnchor="middle" fontSize={14} fontWeight={800} fontFamily={MONO_FONT} fill="#1f2937">
          {v}
        </text>
      ))}
      <line x1={rect.x + 10} y1={rect.y + 34} x2={rect.x + rect.w - 10} y2={rect.y + 34} stroke="#e7e2d6" strokeWidth={1.5} />
      {shown.map((row, i) => (
        <g key={i} className="cv-in">
          {i === shown.length - 1 && <rect x={rect.x + 6} y={rect.y + 36 + i * rowH} width={rect.w - 12} height={rowH - 2} rx={5} fill="#fbbf24" fillOpacity={0.2} />}
          {row.values.map((value, k) => (
            <text key={k} x={rect.x + 8 + colW * k + colW / 2} y={rect.y + 53 + i * rowH} textAnchor="middle" fontSize={mark.size} fontFamily={MONO_FONT} fill="#1f2937">
              {value}
            </text>
          ))}
        </g>
      ))}
    </g>
  );
}

/* ── nodes (with morphs) and arrows (with flowing particles) ──────────────────────────────── */

function NodeView({ mark, vars, focused, shownThrough }: { mark: Extract<Mark, { type: "node" }>; vars: Record<string, number>; focused: boolean; shownThrough: number }) {
  const glow = mark.glow ? Math.max(0, Math.min(1, evalExpr(mark.glow, vars, 1))) : null;
  // A change of state that IS the concept (ice → water): from its sentence, the node becomes the new thing.
  const morphed = Boolean(mark.becomes && shownThrough >= mark.becomes.s);
  const icon = morphed ? mark.becomes?.icon ?? mark.icon : mark.icon;
  const label = morphed ? mark.becomes?.label ?? mark.label : mark.label;
  const iconScale = (mark.r * 1.45) / 100;
  return (
    <g className={`cv-in${focused ? " cv-focus" : ""}`}>
      {glow !== null && <circle cx={mark.cx} cy={mark.cy} r={mark.r * 1.55} fill="url(#cv-glow)" opacity={glow} style={{ transition: "opacity 300ms" }} />}
      <circle cx={mark.cx} cy={mark.cy} r={mark.r} fill={mark.color} fillOpacity={0.1} />
      <Sketch d={roughEllipse(`n-${mark.id}`, mark.cx, mark.cy, mark.r, mark.r)} color={mark.color} width={2.3} />
      {morphed && mark.becomes && (
        <>
          {/* The old form squashes away while the new one grows out of it, with a ring of change. */}
          {/* Position and animation live on separate layers: a CSS transform would replace the SVG one. */}
          {mark.icon && (
            <g transform={`translate(${mark.cx},${mark.cy})`}>
              <g className="cv-morph-out">
                <g transform={`scale(${iconScale})`}>
                  <IconGlyph name={mark.icon} color={mark.color} />
                </g>
              </g>
            </g>
          )}
          <circle cx={mark.cx} cy={mark.cy} r={mark.r} fill="none" stroke={ARIA_INK} strokeWidth={3} className="cv-morph-ring" />
        </>
      )}
      <g transform={`translate(${mark.cx},${mark.cy})`}>
        <g key={morphed ? "after" : "before"} className={morphed ? "cv-morph-in" : undefined}>
          {icon ? (
            <g transform={`scale(${iconScale})`} opacity={glow === null ? 1 : 0.45 + glow * 0.55} style={{ transition: "opacity 300ms" }}>
              <IconGlyph name={icon} color={mark.color} />
            </g>
          ) : (
            <circle r={mark.r * 0.45} fill={mark.color} opacity={0.8} />
          )}
        </g>
      </g>
      {label && (
        <text key={`l-${morphed}`} x={mark.cx} y={mark.labelY} textAnchor="middle" fontSize={mark.labelSize} fontWeight={800} fill={INK} className={morphed ? "cv-in" : undefined}>
          {label}
        </text>
      )}
      {/* The sub-line keeps to about its node's width (smaller, then two lines): a long one ran into
          the next node's name. */}
      {mark.sub && !morphed && <FitLines fit={fitText(mark.sub, Math.max(textWidth(label, mark.labelSize), mark.r * 2 + 60), 15, 12)} x={mark.cx} y={mark.labelY + 20} lead={1.15} textAnchor="middle" fontWeight={600} fill={MUTED} />}
    </g>
  );
}

const bezier = (p0: Pt, c: Pt, p1: Pt, t: number): Pt => ({
  x: (1 - t) * (1 - t) * p0.x + 2 * (1 - t) * t * c.x + t * t * p1.x,
  y: (1 - t) * (1 - t) * p0.y + 2 * (1 - t) * t * c.y + t * t * p1.y,
});

function ArrowView({ mark, vars, focused, reducedMotion }: { mark: Extract<Mark, { type: "arrow" }>; vars: Record<string, number>; focused: boolean; reducedMotion: boolean }) {
  const { p0, c, p1 } = mark;
  const points = useMemo(() => quadPoints(p0, c, p1, 22), [p0, c, p1]);
  const heads = useMemo(() => arrowHead(p1, bezier(p0, c, p1, 0.86), 15, 4.4), [p0, c, p1]);
  const rate = mark.rate ? Math.max(0, Math.min(1, evalExpr(mark.rate, vars, 1))) : 1;
  return (
    <g className={focused ? "cv-focus" : undefined} data-arrow="">
      <Ink points={points} width={5} color={mark.color} />
      <g className="cv-in cv-late">
        {heads.map((d, i) => <path key={i} d={d} fill={mark.color} />)}
      </g>
      {mark.flow && !reducedMotion && <FlowParticles p0={p0} c={c} p1={p1} color={mark.color} rate={rate} />}
      {mark.label && (
        <g className="cv-in cv-late">
          <rect x={mark.labelAt.x - textWidth(mark.label, 14) / 2 - 8} y={mark.labelAt.y - 15} width={textWidth(mark.label, 14) + 16} height={22} rx={11} fill={PAPER} opacity={0.92} />
          <text x={mark.labelAt.x} y={mark.labelAt.y + 1} textAnchor="middle" fontSize={14} fontWeight={700} fill={mark.color}>
            {mark.label}
          </text>
        </g>
      )}
    </g>
  );
}

const PENCIL = "#57534e";
const PENCIL_ON_SLATE = "#d6d1c4";

/**
 * A PENCIL ARROW between sticky notes: a thin hand-drawn graphite line, an open arrowhead and a pencil
 * label — what a teacher would draw between notes stuck on a board. Same path, label and timing as
 * the ink arrow; only the look changes. Particles stay only where they carry a slider's rate.
 */
function PencilArrow({ mark, vars, focused, reducedMotion, chalk = false }: { mark: Extract<Mark, { type: "arrow" }>; vars: Record<string, number>; focused: boolean; reducedMotion: boolean; chalk?: boolean }) {
  const { p0, c, p1 } = mark;
  const points = useMemo(() => quadPoints(p0, c, p1, 22), [p0, c, p1]);
  const head = useMemo(() => {
    const from = bezier(p0, c, p1, 0.88);
    const a = Math.atan2(p1.y - from.y, p1.x - from.x);
    const arm = (t: number) => `${p1.x - Math.cos(a + t) * 13},${p1.y - Math.sin(a + t) * 13}`;
    return `M ${arm(0.5)} L ${p1.x},${p1.y} L ${arm(-0.5)}`;
  }, [p0, c, p1]);
  const rate = mark.rate ? Math.max(0, Math.min(1, evalExpr(mark.rate, vars, 1))) : 1;
  // On the slate the "pencil" is a stick of chalk: graphite would vanish on the dark board.
  const ink = focused ? ARIA_INK : chalk ? PENCIL_ON_SLATE : PENCIL;
  return (
    <g data-arrow="">
      <Ink points={points} width={2.6} color={ink} opacity={0.8} />
      <path d={head} fill="none" stroke={ink} strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round" opacity={0.85} className="cv-in cv-late" />
      {mark.flow && mark.rate && !reducedMotion && <FlowParticles p0={p0} c={c} p1={p1} color={mark.color} rate={rate} />}
      {mark.label && (
        <g className="cv-in cv-late">
          <rect x={mark.labelAt.x - textWidth(mark.label, 14) / 2 - 6} y={mark.labelAt.y - 14} width={textWidth(mark.label, 14) + 12} height={20} rx={4} fill={PAPER} opacity={0.9} />
          <text x={mark.labelAt.x} y={mark.labelAt.y + 1} textAnchor="middle" fontSize={14} fontWeight={600} fontStyle="italic" fill={ink}>
            {mark.label}
          </text>
        </g>
      )}
    </g>
  );
}

const MAX_PARTICLES = 6;
const TRAIL = [0, 0.018, 0.036];

/**
 * Glowing particles with comet trails travelling along an arrow — matter or energy moving. Their
 * SPEED and their NUMBER both follow the rate (a try-it slider's value), so the picture shows how
 * much is flowing, not just that something does. Positions are set per frame, off React.
 */
function FlowParticles({ p0, c, p1, color, rate }: { p0: Pt; c: Pt; p1: Pt; color: string; rate: number }) {
  const gid = useId().replace(/:/g, "");
  const refs = useRef<Array<SVGGElement | null>>([]);
  const rateRef = useRef(rate);
  useEffect(() => {
    rateRef.current = rate;
  }, [rate]);
  useEffect(() => {
    let raf = 0;
    let phase = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const r = rateRef.current;
      const count = r <= 0.02 ? 0 : Math.round(2 + r * (MAX_PARTICLES - 2));
      phase = (phase + dt * (0.1 + r * 0.55)) % 1;
      refs.current.forEach((g, i) => {
        if (!g) return;
        if (i >= count) {
          g.setAttribute("opacity", "0");
          return;
        }
        const t = (phase + i / count) % 1;
        g.setAttribute("opacity", String(Math.sin(Math.PI * t) * (0.45 + r * 0.55)));
        Array.from(g.children).forEach((dot, k) => {
          const lag = TRAIL[Math.min(TRAIL.length - 1, Math.max(0, k - 1))];
          const p = bezier(p0, c, p1, Math.max(0, t - lag));
          dot.setAttribute("cx", p.x.toFixed(1));
          dot.setAttribute("cy", p.y.toFixed(1));
        });
      });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [p0, c, p1]);
  return (
    <g pointerEvents="none">
      <defs>
        <radialGradient id={`pg${gid}`}>
          <stop offset="0%" stopColor={color} stopOpacity={0.55} />
          <stop offset="100%" stopColor={color} stopOpacity={0} />
        </radialGradient>
      </defs>
      {Array.from({ length: MAX_PARTICLES }, (_, i) => (
        <g key={i} ref={(el) => { refs.current[i] = el; }} opacity={0}>
          <circle r={13} fill={`url(#pg${gid})`} />
          <circle r={5.5} fill={color} stroke="#fff" strokeWidth={1.5} />
          <circle r={3.6} fill={color} opacity={0.55} />
          <circle r={2.4} fill={color} opacity={0.3} />
        </g>
      ))}
    </g>
  );
}

/* ── equation: terms glide on arcs, and flash colour when they cross ──────────────────────── */

function EquationView({ mark, stage, shownThrough, focusId, reducedMotion }: { mark: Extract<Mark, { type: "equation" }>; stage: Rect; shownThrough: number; focusId?: string; reducedMotion: boolean }) {
  const stepIndex = Math.max(0, mark.steps.reduce((best, step, i) => (step.s <= shownThrough ? i : best), 0));
  const step = mark.steps[stepIndex];
  // A token absent from this step keeps the spot it last had (so it fades where it was), or waits
  // where it will first appear.
  const placeOf = (id: string, at = stepIndex): Pt | undefined => {
    for (let i = at; i >= 0; i--) if (mark.steps[i].place[id]) return mark.steps[i].place[id];
    return mark.steps.find((st) => st.place[id])?.place[id];
  };
  const groups = useRef<Record<string, SVGGElement | null>>({});
  const texts = useRef<Record<string, Element | null>>({});
  const previousStep = useRef(stepIndex);
  /*
   * When the step changes, every term that moved glides there along an arc (3Blue1Brown's
   * TransformMatchingTex with path_arc), lifting higher the further it travels. A term that crosses
   * the arrow or "=" — the side of the equation it is on changes — flashes Aria's colour mid-flight.
   */
  useLayoutEffect(() => {
    const before = previousStep.current;
    previousStep.current = stepIndex;
    if (before === stepIndex || reducedMotion) return;
    const pivot = mark.tokens.find((t) => /[→=⇌]/.test(t.text));
    const pivotX = (i: number) => (pivot ? placeOf(pivot.id, i)?.x ?? null : null);
    for (const t of mark.tokens) {
      const from = placeOf(t.id, before);
      const to = step.place[t.id];
      const el = groups.current[t.id];
      if (!from || !to || !el || Math.hypot(to.x - from.x, to.y - from.y) < 4) continue;
      const frames = arcKeyframes(from, to).map((p) => ({ transform: `translate(${p.x}px, ${p.y}px)` }));
      el.animate(frames, { duration: 1150, easing: "cubic-bezier(.65,0,.25,1)" });
      const pa = pivotX(before);
      const pb = pivotX(stepIndex);
      const crossed = pa !== null && pb !== null && Math.sign(from.x - pa) !== Math.sign(to.x - pb);
      const text = texts.current[t.id];
      // A typeset term is HTML (its colour is CSS "color"); a plain one is SVG text ("fill").
      const paint = text instanceof SVGElement ? "fill" : "color";
      if (crossed && text) text.animate([{ [paint]: t.color }, { [paint]: ARIA_INK, offset: 0.45 }, { [paint]: ARIA_INK, offset: 0.65 }, { [paint]: t.color }], { duration: 1150, easing: "ease-in-out" });
    }
    // Runs only when the step changes; the positions it reads are derived from the same layout.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stepIndex]);
  return (
    <g>
      {mark.tokens.map((t) => {
        const at = placeOf(t.id);
        if (!at) return null;
        // A term is put on the board on the step that first writes it — not waiting unseen from the
        // start, where the marker wrote it across empty board (playback QA, 2026-10-21).
        const first = mark.steps.findIndex((st) => st.place[t.id]);
        if (first < 0 || stepIndex < first) return null;
        const shown = Boolean(step.place[t.id]);
        const lit = step.highlight.includes(t.id) || focusId === t.id;
        // A fraction or root stands taller than a line of text: its highlight and underline follow it.
        const tall = /\\[dt]?frac|\\sqrt/.test(t.tex ?? "");
        const top = -t.size * (tall ? 1.45 : 0.95);
        const under = t.size * (tall ? 0.95 : 0.24);
        return (
          // A leaving term is gone (0.2 s) before a returning one fades in: the two used to cross-fade in
          // the same spot — "four triangle areas" over "(a + b)²" for half a second (playback QA).
          <g key={t.id} data-target={t.id} ref={(el) => { groups.current[t.id] = el; }} className={first > 0 && stepIndex === first ? "cv-eq-new" : undefined} style={{ transform: `translate(${at.x}px, ${at.y}px)`, transition: shown ? "opacity 420ms ease-out 240ms" : "opacity 200ms ease-in", opacity: shown ? 1 : 0 }}>
            {lit && (
              <g className="cv-in">
                <path d={roughRect(`hl-${t.id}-${stepIndex}`, -7, top, t.w + 14, under - top + t.size * 0.12, 10)} fill={t.color} fillOpacity={0.14} stroke={t.color} strokeOpacity={0.35} strokeWidth={1.5} />
              </g>
            )}
            {t.tex ? (
              <TexTerm tex={t.tex} size={t.size} w={t.w} color={t.color} onElement={(el) => { texts.current[t.id] = el; }} />
            ) : (
              <text ref={(el) => { texts.current[t.id] = el; }} x={0} y={0} fontSize={t.size} fontWeight={800} fill={t.color} className="cv-in">
                {t.text}
              </text>
            )}
            {lit && <Ink points={[{ x: 0, y: under }, { x: t.w / 2, y: under + t.size * 0.04 }, { x: t.w, y: under - t.size * 0.02 }]} width={4} color={t.color} />}
          </g>
        );
      })}
      {step.caption && (() => {
        // The caption keeps within the stage (a 64-character one at 21 px ran ~110 px past it): smaller,
        // then two lines, lifted when the second would leave the board.
        const half = Math.min(mark.center - stage.x, stage.x + stage.w - mark.center);
        const fit = fitText(step.caption, half > 120 ? half * 2 : stage.w, 21, 16);
        const lift = Math.max(0, mark.captionY + (fit.lines.length - 1) * fit.size * 1.18 - (PANEL_H - 14));
        return <FitLines key={stepIndex} fit={fit} x={mark.center} y={mark.captionY - lift} lead={1.18} textAnchor="middle" fontWeight={600} fill={MUTED} className="cv-in" />;
      })()}
    </g>
  );
}

/**
 * ONE TERM, TYPESET BY KATEX (owner's direction, 2026-10-16), on the board's own coordinates: its
 * baseline sits where a written term's would. The layout gave it a slot from an estimate of its width
 * (lib/canvas/layout.ts texEm); once typeset — and again once KaTeX's fonts arrive — it is measured
 * and, when wider than its slot, scaled down to fit, so terms never run into each other. Never below
 * 60% of its size, though: past that it stays readable and stands a little wider than its slot. Its
 * box grows to what it holds — a foreignObject's content past its box is clipped by Safari, whatever
 * its overflow says, and a tall fraction outgrew the fixed one.
 */
function TexTerm({ tex, size, w, color, onElement, align = "center" }: { tex: string; size: number; w: number; color: string; onElement: (el: HTMLDivElement | null) => void; /** A note starts at its bullet; a term centres on its slot. */ align?: "center" | "left" }) {
  const html = useMemo(() => katex.renderToString(tex, { throwOnError: false, displayMode: false }), [tex]);
  // The transform goes on a wrapper React owns and never styles: KaTeX's own root is replaced
  // whenever React writes the typeset HTML again, and would lose it.
  const wrap = useRef<HTMLSpanElement>(null);
  const box = useRef<SVGForeignObjectElement>(null);
  const tall = /\\[dt]?frac|\\sqrt|\^/.test(tex);
  const h = size * (tall ? 2.3 : 1.7);
  const top = -size * (tall ? 1.45 : 1.15);
  useLayoutEffect(() => {
    const inner = wrap.current;
    const fo = box.current;
    if (!inner) return;
    const fit = (): boolean => {
      // Inside a foreignObject, CSS pixels ARE board units, whatever the camera's zoom.
      inner.style.transform = "";
      // An inline box ignores a transform (and reports no height of its own).
      inner.style.display = "inline-block";
      const actual = inner.offsetWidth;
      if (!actual) return false;
      // Overlap is worse than small type (owner, 2026-10-17: "a lot of overlap in text"): a term shrinks
      // to its slot down to 45%; the layout's width estimate is also wider for words (lib/canvas/layout.ts).
      const scale = actual > w ? Math.max(0.45, w / actual) : 1;
      const shown = actual * scale;
      // Wider than its slot even at the floor: the box widens about its centre to hold it.
      const left = align === "left" ? 0 : Math.min(0, (w - shown) / 2 - 4);
      const width = Math.max(4, w, shown + 8);
      const height = Math.max(h, inner.offsetHeight + 8);
      if (fo) {
        fo.setAttribute("x", left.toFixed(1));
        fo.setAttribute("width", width.toFixed(1));
        // Grown about the same centre, so the term's baseline stays where the layout put it.
        fo.setAttribute("y", (top + h / 2 - height / 2).toFixed(1));
        fo.setAttribute("height", height.toFixed(1));
      }
      inner.style.transformOrigin = "0 50%";
      inner.style.transform = `translateX(${(align === "left" ? 0 : (w - shown) / 2 - left).toFixed(1)}px) scale(${scale.toFixed(3)})`;
      return true;
    };
    // A board is often mounted before it is laid out (its width reads 0), and a ResizeObserver
    // never reports inside a foreignObject: try each frame until it has a width (about 2 s at
    // most), then once more when KaTeX's fonts arrive, which changes the width.
    let raf = 0;
    let tries = 0;
    let alive = true;
    const attempt = () => {
      if (alive && !fit() && tries++ < 120) raf = requestAnimationFrame(attempt);
    };
    attempt();
    void document.fonts?.ready.then(() => alive && fit());
    return () => {
      alive = false;
      cancelAnimationFrame(raf);
    };
  }, [html, w, h, top, align]);
  return (
    <foreignObject ref={box} x={0} y={top} width={Math.max(4, w)} height={h} overflow="visible" className="cv-in">
      <div ref={onElement} style={{ display: "flex", alignItems: "center", height: "100%", whiteSpace: "nowrap", color, fontSize: size * 0.84, lineHeight: 1 }}>
        <span ref={wrap} dangerouslySetInnerHTML={{ __html: html }} />
      </div>
    </foreignObject>
  );
}

/* ── graph: exact, live, with a ghost of the last setting ─────────────────────────────────── */

function niceTicks(min: number, max: number, count = 5): number[] {
  const span = max - min;
  const raw = span / count;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => span / s <= count + 0.5) ?? raw;
  const out: number[] = [];
  for (let v = Math.ceil(min / step) * step; v <= max + 1e-9; v += step) out.push(Math.round(v * 1e6) / 1e6);
  return out;
}

function curvePath(plot: Rect, spec: GraphStage, expr: string, vars: Record<string, number>): string {
  let d = "";
  let pen = false;
  for (let i = 0; i <= 160; i++) {
    const x = spec.x.min + ((spec.x.max - spec.x.min) * i) / 160;
    const y = evalExpr(expr, { ...vars, x });
    if (!Number.isFinite(y)) {
      pen = false;
      continue;
    }
    const p = graphPoint(plot, spec, x, y);
    d += `${pen ? "L" : "M"}${p.x.toFixed(1)} ${p.y.toFixed(1)} `;
    pen = true;
  }
  return d;
}

/** The key for crowded curves: in whichever corner of the plot the curves leave most empty. */
function GraphLegend({ plot, spec, vars, shownThrough, stacked }: { plot: Rect; spec: GraphStage; vars: Record<string, number>; shownThrough: number; stacked: boolean }) {
  const shown = spec.curves.filter((c) => c.s <= shownThrough && c.label);
  if (stacked || !shown.length) return null;
  const ends = shown.map((c) => graphPoint(plot, spec, spec.x.max, evalExpr(c.expr, { ...vars, x: spec.x.max }, spec.y.min)).y).sort((a, b) => a - b);
  if (!(shown.length >= 3 || ends.some((y, k) => k > 0 && Math.abs(y - ends[k - 1]) < 26))) return null;
  const w = Math.max(...shown.map((c) => textWidth(c.label!, 14))) + 52;
  const h = shown.length * 22 + 12;
  const corners = [
    { x: plot.x + 10, y: plot.y + 6 }, { x: plot.x + plot.w - w - 10, y: plot.y + 6 },
    { x: plot.x + 10, y: plot.y + plot.h - h - 8 }, { x: plot.x + plot.w - w - 10, y: plot.y + plot.h - h - 8 },
  ];
  const samples = spec.curves.flatMap((c) => Array.from({ length: 60 }, (_, i) => { const x = spec.x.min + ((spec.x.max - spec.x.min) * i) / 59; return graphPoint(plot, spec, x, evalExpr(c.expr, { ...vars, x }, NaN)); }));
  const hits = (b: { x: number; y: number }) => samples.filter((p) => p.x > b.x - 6 && p.x < b.x + w + 6 && p.y > b.y - 6 && p.y < b.y + h + 6).length;
  const at = corners.reduce((best, c) => (hits(c) < hits(best) ? c : best), corners[0]);
  return (
    <g className="cv-in cv-late">
      <rect x={at.x} y={at.y} width={w} height={h} rx={10} fill={PAPER} opacity={0.92} />
      {shown.map((c, i) => {
        const color = c.color ?? ["#15803d", "#2563eb", "#d97706"][spec.curves.indexOf(c) % 3];
        const y = at.y + 17 + i * 22;
        return (
          <g key={c.id}>
            <line x1={at.x + 10} y1={y - 4} x2={at.x + 34} y2={y - 4} stroke={color} strokeWidth={4} strokeLinecap="round" />
            <text x={at.x + 42} y={y} fontSize={14} fontWeight={800} fill={color}>{c.label}</text>
          </g>
        );
      })}
    </g>
  );
}

function GraphView({ mark, stage, shownThrough, sentenceProgress, vars, ghostVars, focusId }: { mark: Extract<Mark, { type: "graph" }>; stage: Rect; shownThrough: number; sentenceProgress: number; vars: Record<string, number>; ghostVars?: Record<string, number>; focusId?: string }) {
  const { plot, spec, stacked } = mark;
  const xTicks = useMemo(() => niceTicks(spec.x.min, spec.x.max), [spec.x.min, spec.x.max]);
  const yTicks = useMemo(() => niceTicks(spec.y.min, spec.y.max, stacked ? 2 : 5), [spec.y.min, spec.y.max, stacked]);
  const showX = !stacked || stacked.showX;
  const px = (x: number) => graphPoint(plot, spec, x, spec.y.min).x;
  const py = (y: number) => graphPoint(plot, spec, spec.x.min, y).y;
  const traceActive = spec.trace && spec.trace.s === shownThrough;
  const traceCurve = spec.trace ? spec.curves.find((c) => c.id === spec.trace!.curve) : undefined;
  const ghostDiffers = ghostVars && Object.keys(ghostVars).some((k) => ghostVars[k] !== vars[k]);
  // The axis names keep to the stage: the y name, turned on its side, to the plot's height (a long
  // one ran ~100 px past it), smaller first and then on two lines (audit 2026-10-17).
  const xName = fitText(spec.x.label, plot.w + 60, 17, 12);
  const yName = fitText(spec.y.label, plot.h, 17, 13);
  const stageRight = stage.x + stage.w;
  return (
    <g className="cv-in">
      {/* Dot (components/avatar/BoardAvatar.tsx) keeps off the plot: she must not sit on the points. */}
      <rect data-figure="" x={plot.x} y={plot.y} width={plot.w} height={plot.h} fill="none" pointerEvents="none" />
      {/* A shape graph (spec.qualitative) shows the curve's form, not values: no tick numbers. */}
      {!spec.qualitative && yTicks.map((v) => (
        <g key={`y${v}`}>
          <line x1={plot.x} y1={py(v)} x2={plot.x + plot.w} y2={py(v)} stroke="#e7e2d6" strokeWidth={1} />
          <text x={plot.x - 10} y={py(v) + 5} textAnchor="end" fontSize={13} fill={MUTED} fontWeight={600}>
            {v}
          </text>
        </g>
      ))}
      {showX && !spec.qualitative && xTicks.map((v) => (
        <text key={`x${v}`} x={px(v)} y={plot.y + plot.h + 22} textAnchor="middle" fontSize={13} fill={MUTED} fontWeight={600}>
          {v}
        </text>
      ))}
      <line x1={plot.x} y1={plot.y + plot.h} x2={plot.x + plot.w + 8} y2={plot.y + plot.h} stroke={INK} strokeWidth={2.5} />
      <line x1={plot.x} y1={plot.y + plot.h} x2={plot.x} y2={plot.y - 8} stroke={INK} strokeWidth={2.5} />
      {showX && <FitLines fit={xName} x={plot.x + plot.w / 2} y={plot.y + plot.h + 50} lead={1.12} textAnchor="middle" fontWeight={700} fill={INK} />}
      {stacked ? (
        // A stacked panel is too short for a rotated label: its quantity is written across its top.
        <text x={plot.x + 12} y={plot.y + 4} fontSize={15} fontWeight={800} fill={spec.curves[0]?.color ?? ["#15803d", "#2563eb", "#d97706"][0]}>
          {stacked.title}
        </text>
      ) : (
        // A second line stands to the LEFT of the first's place, so it never reaches the tick numbers.
        <FitLines fit={yName} x={0} y={0} lead={1.12} transform={`translate(${plot.x - 50 - (yName.lines.length - 1) * yName.size * 1.12},${plot.y + plot.h / 2}) rotate(-90)`} textAnchor="middle" fontWeight={700} fill={INK} />
      )}
      {(spec.guides ?? []).filter((g) => g.s <= shownThrough).map((g, gi, shownGuides) => {
        // Centred on its line, but slid back inside the stage when the line is near an edge.
        const fit = g.label ? fitText(g.label, stage.w - 8, 15, 12) : null;
        const half = fit ? Math.max(...fit.lines.map((l) => textWidth(l, fit.size))) / 2 : 0;
        const x = Math.max(stage.x + half + 4, Math.min(stageRight - half - 4, px(g.x)));
        // Two guide names that would meet ("Optimum" and "Denaturation" printed as one) are stacked:
        // the later one a line higher.
        const lift = shownGuides.slice(0, gi).some((o) => Math.abs(px(o.x) - px(g.x)) < half + 70) ? 20 : 0;
        return (
          <g key={g.id} className={`cv-in${focusId === g.id ? " cv-focus" : ""}`}>
            <line x1={px(g.x)} y1={plot.y} x2={px(g.x)} y2={plot.y + plot.h} stroke="#94a3b8" strokeWidth={2} strokeDasharray="7 6" />
            {fit && <FitLines fit={fit} x={x} y={plot.y - 12 - lift - (fit.lines.length - 1) * fit.size * 1.12} lead={1.12} textAnchor="middle" fontWeight={700} fill={MUTED} />}
          </g>
        );
      })}
      {/* The ghost: where the curve was before the student's last drag, so the change is visible. */}
      {ghostDiffers && spec.curves.filter((c) => c.s <= shownThrough).map((c, i) => (
        <path key={`ghost-${c.id}`} d={curvePath(plot, spec, c.expr, ghostVars!)} stroke={c.color ?? ["#15803d", "#2563eb", "#d97706"][i % 3]} strokeWidth={3} strokeDasharray="6 7" fill="none" opacity={0.3} />
      ))}
      {(() => {
        // Curve names sit at their curves' ends; ends that meet would print one name over another, so
        // the names are spaced at least a line apart, each staying as close to its own curve as it can.
        const shown = spec.curves.filter((c) => c.s <= shownThrough);
        const ends = shown.map((c) => graphPoint(plot, spec, spec.x.max, evalExpr(c.expr, { ...vars, x: spec.x.max }, spec.y.min)));
        const order = shown.map((_, i) => i).filter((i) => shown[i].label).sort((a, b) => ends[a].y - ends[b].y);
        const labelY: Record<number, number> = {};
        let last = -Infinity;
        for (const i of order) {
          labelY[i] = Math.max(ends[i].y - 12, last + 18, plot.y + 4);
          last = labelY[i];
        }
        // Crowded names (three or more, or ends within a line of each other) go into a key instead of
        // being stacked over the curves (audit 2026-10-17: "Graph A: strong" over "Graph B: weak").
        const useLegend = order.length >= 3 || order.some((i, k) => k > 0 && Math.abs(ends[i].y - ends[order[k - 1]].y) < 26);
        return shown.map((c, i) => ({ c, i, end: ends[i], y: labelY[i], legend: useLegend }));
      })().map(({ c, i, end, y, legend }) => {
        const color = c.color ?? ["#15803d", "#2563eb", "#d97706"][i % 3];
        const d = curvePath(plot, spec, c.expr, vars);
        return (
          <g key={c.id} className={focusId === c.id ? "cv-focus" : undefined}>
            <path d={d} stroke={color} strokeWidth={4} fill="none" strokeLinecap="round" strokeLinejoin="round" className="cv-stroke cv-slow" pathLength={1} />
            {c.label && !stacked && !legend && (
              <text x={Math.min(end.x, plot.x + plot.w - 4)} y={y ?? end.y - 12} textAnchor="end" fontSize={15} fontWeight={800} fill={color} className="cv-in cv-late">
                {c.label}
              </text>
            )}
          </g>
        );
      })}
      <GraphLegend plot={plot} spec={spec} vars={vars} shownThrough={shownThrough} stacked={Boolean(stacked)} />
      {traceActive && traceCurve && (() => {
        const x = spec.x.min + (spec.x.max - spec.x.min) * Math.min(1, sentenceProgress * 1.15);
        const p = graphPoint(plot, spec, x, evalExpr(traceCurve.expr, { ...vars, x }, spec.y.min));
        return <circle cx={p.x} cy={p.y} r={9} fill={ARIA_INK} stroke="#fff" strokeWidth={3} />;
      })()}
      {ghostDiffers && (spec.markers ?? []).filter((m) => m.s <= shownThrough).map((m) => {
        const curve = spec.curves.find((c) => c.id === m.curve);
        if (!curve) return null;
        const x = Math.max(spec.x.min, Math.min(spec.x.max, evalExpr(m.x, ghostVars!, spec.x.min)));
        const p = graphPoint(plot, spec, x, evalExpr(curve.expr, { ...ghostVars!, x }, spec.y.min));
        return <circle key={`gm-${m.id}`} cx={p.x} cy={p.y} r={8} fill="none" stroke={ARIA_INK} strokeWidth={2} strokeDasharray="3 3" opacity={0.5} />;
      })}
      {(spec.markers ?? []).filter((m) => m.s <= shownThrough).map((m) => {
        const curve = spec.curves.find((c) => c.id === m.curve);
        if (!curve) return null;
        const x = Math.max(spec.x.min, Math.min(spec.x.max, evalExpr(m.x, vars, spec.x.min)));
        const y = evalExpr(curve.expr, { ...vars, x }, spec.y.min);
        const p = graphPoint(plot, spec, x, y);
        // Its name to the upper right of the point — flipped to the left, or below, when it would leave
        // the stage there; smaller, then two lines, when neither side has the room.
        const label = (() => {
          if (!m.label) return null;
          const rightRoom = stageRight - (p.x + 14) - 4;
          const leftRoom = p.x - 14 - stage.x - 4;
          const left = textWidth(m.label, 15) > rightRoom && leftRoom > rightRoom;
          const fit = fitText(m.label, left ? leftRoom : rightRoom, 15, 12);
          const below = p.y - 14 - fit.lines.length * fit.size * 1.12 < stage.y;
          return { fit, left, y: below ? 30 : -14 - (fit.lines.length - 1) * fit.size * 1.12 };
        })();
        return (
          <g key={m.id} className={focusId === m.id ? "cv-focus" : undefined} style={{ transform: `translate(${p.x}px, ${p.y}px)`, transition: "transform 260ms cubic-bezier(.2,.9,.3,1.25)" }}>
            <line x1={0} y1={0} x2={0} y2={plot.y + plot.h - p.y} stroke={ARIA_INK} strokeWidth={1.5} strokeDasharray="4 4" opacity={0.6} />
            <circle r={11} fill={ARIA_INK} stroke="#fff" strokeWidth={3} className="cv-in" />
            {label && <FitLines fit={label.fit} x={label.left ? -14 : 14} y={label.y} lead={1.12} textAnchor={label.left ? "end" : undefined} fontWeight={800} fill="#c2410c" />}
          </g>
        );
      })}
    </g>
  );
}

/** Where the pointer should aim for a graph marker right now (markers move with the sliders). */
export function markerPoint(layout: PanelLayout, id: string, vars: Record<string, number>): Pt | null {
  const graphs = layout.marks.filter((m): m is Extract<Mark, { type: "graph" }> => m.type === "graph");
  const graph = graphs.find((g) => g.spec.markers?.some((m) => m.id === id)) ?? graphs[0];
  const marker = graph?.spec.markers?.find((m) => m.id === id);
  const curve = marker && graph?.spec.curves.find((c) => c.id === marker.curve);
  if (!graph || !marker || !curve) return null;
  const x = Math.max(graph.spec.x.min, Math.min(graph.spec.x.max, evalExpr(marker.x, vars, graph.spec.x.min)));
  return graphPoint(graph.plot, graph.spec, x, evalExpr(curve.expr, { ...vars, x }, graph.spec.y.min));
}

/*
 * ONE MOTION LANGUAGE ("pen-first"). Things are either drawn on along their path, or spring in with a
 * small dip-then-settle (a 6% undershoot, a 2% overshoot, 480 ms). Nothing bounces twice, nothing
 * loops for decoration. The camera itself never bounces (lib/canvas/camera.ts).
 */
export const CANVAS_CSS = `
.cv-live .cv-in { animation: cv-in 480ms cubic-bezier(.2,.8,.2,1) both; transform-box: fill-box; transform-origin: center; }
/* Paused by the student: every stroke and fade on the board holds where it is until Play. */
.cv-paused, .cv-paused * { animation-play-state: paused !important; }
.cv-live .cv-late { animation-delay: 520ms; }
.cv-live .cv-write { animation: cv-write 900ms steps(24, end) both; }
/* A free label's halo (TextDeconflict): board colour behind its letters, so a line passing behind stops short. */
text[data-halo] { paint-order: stroke fill; stroke: ${PAPER}; stroke-width: 4.5px; stroke-linejoin: round; }
.cv-chalk text[data-halo] { stroke: #000000; }
/* A plate in the board colour behind a short label, for spots no edge leaves free (a "same set!" inside a triangle). */
rect[data-plate] { fill: ${PAPER}; }
.cv-chalk rect[data-plate] { fill: #000000; }
/* A typeset equation note takes the board's ink: chalk recolours by fill attributes, which KaTeX has none of. */
.cv-chalk [data-tex-note] .katex { color: #f1eee4; }
.cv-chalk foreignObject[data-halo] [data-ink-content], .cv-chalk foreignObject[data-halo] .katex { text-shadow: 0 0 2px #000, 0 0 4px #000, 0 0 7px #000; }
.cv-live .cv-stroke { stroke-dasharray: 1; animation: cv-stroke 850ms cubic-bezier(.45,0,.25,1) both; }
.cv-live .cv-slow { animation-duration: 1800ms; }
.cv-live .cv-eq-new { animation: cv-eq-in 420ms ease-out 240ms both; }
.cv-marked .cv-eq-new { animation: none; }
@keyframes cv-eq-in { from { opacity: 0; } to { opacity: 1; } }
.cv-live .cv-morph-out { animation: cv-morph-out 600ms cubic-bezier(.5,0,.75,0) both; transform-box: fill-box; transform-origin: center; }
.cv-live .cv-morph-in { animation: cv-morph-in 700ms cubic-bezier(.2,.9,.3,1.3) 380ms both; transform-box: fill-box; transform-origin: center; }
.cv-live .cv-morph-ring { animation: cv-morph-ring 900ms ease-out 300ms both; transform-box: fill-box; transform-origin: center; }
.cv-settled .cv-morph-out, .cv-settled .cv-morph-ring { display: none; }
.cv-focus { filter: drop-shadow(0 0 10px rgba(255,107,74,.5)); }
@keyframes cv-in { 0% { opacity: 0; transform: translateY(6px) scale(.94); } 60% { opacity: 1; transform: scale(1.02); } 100% { opacity: 1; transform: none; } }
@keyframes cv-write { from { clip-path: inset(0 100% 0 0); } to { clip-path: inset(0 0 0 0); } }
@keyframes cv-stroke { from { stroke-dashoffset: 1; } to { stroke-dashoffset: 0; } }
@keyframes cv-morph-out { 0% { opacity: 1; transform: none; } 100% { opacity: 0; transform: scale(1.25, .15); } }
@keyframes cv-morph-in { 0% { opacity: 0; transform: scale(.2, 1.4); } 70% { opacity: 1; transform: scale(1.08); } 100% { opacity: 1; transform: none; } }
@keyframes cv-morph-ring { 0% { opacity: .9; transform: scale(.9); } 100% { opacity: 0; transform: scale(1.6); } }
@keyframes cv-ring { from { stroke-dashoffset: 1; } to { stroke-dashoffset: 0; } }
@keyframes cv-swipe { from { stroke-dashoffset: 1; } to { stroke-dashoffset: 0; } }
@keyframes cv-tap { 0% { transform: scale(.4); opacity: .9; } 100% { transform: scale(2.4); opacity: 0; } }
.cv-tap { transform-box: fill-box; transform-origin: center; animation: cv-tap 900ms ease-out 2; }
.cv-ring { stroke-dasharray: 1; animation: cv-ring 700ms cubic-bezier(.45,0,.25,1) both; }
.cv-swipe { stroke-dasharray: 1; animation: cv-swipe 420ms cubic-bezier(.3,0,.2,1) both; }
@keyframes cv-outline { from { opacity: 0; } to { opacity: 1; } }
.cv-outline { animation: cv-outline 260ms ease-out both; }
@keyframes cv-hotspot { 0% { transform: scale(.8); opacity: .95; } 100% { transform: scale(2.3); opacity: 0; } }
.cv-hotspot { transform-box: fill-box; transform-origin: center; animation: cv-hotspot 1600ms ease-out infinite; }
.cv-sticky-body { transform: rotate(var(--tilt, 0deg)); transform-box: fill-box; transform-origin: 50% 40%; transition: transform 320ms cubic-bezier(.05,.7,.1,1); }
.cv-sticky-shadow { transform-box: fill-box; transition: transform 320ms cubic-bezier(.05,.7,.1,1), opacity 300ms ease; }
.cv-sticky-note { transition: opacity 360ms ease; }
.cv-sticky-note.is-focus .cv-sticky-body { transform: translateY(-6px) rotate(0deg) scale(1.05); }
.cv-sticky-note.is-focus .cv-sticky-shadow { transform: translate(5px, 12px); opacity: .16; }
.cv-spot .cv-sticky-note:not(.is-focus) { opacity: .5; }
.cv-live .cv-sticky-slap { animation: cv-slap 400ms cubic-bezier(.05,.7,.1,1) both; transform-box: fill-box; transform-origin: 50% 0%; }
@keyframes cv-slap { 0% { opacity: 0; transform: translateY(-14px) rotate(-4deg) scale(1.1); } 60% { opacity: 1; transform: translateY(1px) scale(1.02, .97); } 100% { opacity: 1; transform: none; } }
.cv-recap .cv-sticky-note { animation: cv-recap 560ms cubic-bezier(.05,.7,.1,1) calc(var(--order, 0) * 170ms + 250ms) both; transform-box: fill-box; transform-origin: 50% 60%; }
@keyframes cv-recap { 0% { transform: none; } 40% { transform: translateY(-7px) scale(1.05); } 100% { transform: none; } }
.cv-pop { transform-box: fill-box; transform-origin: center; animation: cv-pop 460ms cubic-bezier(.34,1.8,.64,1) both; }
@keyframes cv-pop { 0% { transform: scale(0); } 100% { transform: scale(1); } }
@media (prefers-reduced-motion: reduce) { .cv-live .cv-sticky-slap, .cv-pop, .cv-recap .cv-sticky-note { animation: none !important; } .cv-sticky-body, .cv-sticky-shadow, .cv-sticky-note { transition: none !important; } }
@media (prefers-reduced-motion: reduce) { .cv-live .cv-in, .cv-live .cv-write, .cv-live .cv-stroke, .cv-live .cv-morph-in, .cv-ring, .cv-swipe, .cv-tap, .cv-outline, .cv-hotspot { animation: none !important; } .cv-morph-out, .cv-morph-ring { display: none; } }
`;

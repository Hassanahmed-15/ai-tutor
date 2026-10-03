"use client";

import { createContext, useContext, useEffect, useId, useLayoutEffect, useMemo, useRef } from "react";
import { evalExpr } from "@/lib/canvas/expr";
import { arcKeyframes, arrowHead, centreLine, quadPoints, roughEllipse, roughRect, taperedStroke } from "@/lib/canvas/ink";
import { graphPoint, INK, type Mark, type PanelLayout, type Pt, type Rect } from "@/lib/canvas/layout";
import { PANEL_H, PANEL_W, type CanvasBoardSpec, type GraphStage } from "@/lib/canvas/types";
import { CHALK, type BoardTheme } from "@/lib/canvas/theme";
import { IconGlyph } from "./icons";

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
};

export function CanvasPanel({ layout, spec, shownThrough, sentenceProgress, live, vars, ghostVars, focusId, carryFrom, reducedMotion, theme = "paper" }: PanelProps) {
  const chalk = theme === "chalk";
  const visible = layout.marks.filter((m) => m.s <= shownThrough);
  const headingW = layout.targets.heading?.w ?? 200;
  return (
    <InkDrawing.Provider value={live && !reducedMotion}>
    <g className={live && !reducedMotion ? "cv-live" : "cv-settled"}>
      <g className="cv-lift">
        {/* The shadow is a picture baked once (LessonCanvas paperShadow): a live blur filter under
            every board was re-blurred on every frame of a camera flight, and the flights stuttered. */}
        <use href="#cv-shadow-img" />
        <rect x={0} y={0} width={PANEL_W} height={PANEL_H} rx={22} fill={PAPER} stroke="#e7e2d6" strokeWidth={2} />
        {/* Paper grain: a faint, soft texture baked once into an image pattern — no blend mode, which
            forced the whole board through an extra compositing pass per frame. */}
        {chalk ? <ChalkSurface /> : <rect x={0} y={0} width={PANEL_W} height={PANEL_H} rx={22} fill="url(#cv-grain)" pointerEvents="none" />}
        <Ink points={[{ x: 48, y: 88 }, { x: 48 + (headingW + 20) * 0.5, y: 86.5 }, { x: Math.min(PANEL_W - 48, 48 + headingW + 20), y: 88.5 }]} width={4.2} color="#f59e0b" opacity={0.6} />
        {/* A refresher of something the lesson builds on (lib/knowledge): labelled, so the student
            knows why it is here and that the topic proper comes next. */}
        {spec.refresher && (
          <g pointerEvents="none">
            <rect x={PANEL_W - 214} y={22} width={186} height={34} rx={17} fill="#7c3aed" opacity={0.92} />
            <text x={PANEL_W - 121} y={44.5} textAnchor="middle" fontSize={15} fontWeight={800} fill="#ffffff">↺ Quick refresher</text>
          </g>
        )}
        {visible.map((mark) => (
          <MarkView key={mark.id} mark={mark} layout={layout} spec={spec} shownThrough={shownThrough} sentenceProgress={sentenceProgress} vars={vars} ghostVars={ghostVars} focused={focusId === mark.id} focusId={focusId} carry={carryFrom[mark.id]} targetRect={layout.targets[mark.id]} reducedMotion={reducedMotion} chalk={chalk} />
        ))}
        {/* Chalk never lays down solid: a fine speckle of the slate over the writing breaks every
            stroke up the way chalk skips over a board — one rectangle, not a filter per stroke. */}
        {chalk && <ChalkSpeckle layout={layout} />}
      </g>
    </g>
    </InkDrawing.Provider>
  );
}

/**
 * A chalkboard's surface over the slate: the light from the room falling across it, old eraser
 * smudges, a wooden frame and the chalk tray along the bottom. All baked or plain shapes — nothing
 * here is recomputed on a camera frame.
 */
function ChalkSurface() {
  return (
    <>
      <rect x={0} y={0} width={PANEL_W} height={PANEL_H} rx={22} fill="url(#cv-slate-light)" pointerEvents="none" />
      <rect x={0} y={0} width={PANEL_W} height={PANEL_H} rx={22} fill="url(#cv-dust)" pointerEvents="none" />
      <rect x={-7} y={-7} width={PANEL_W + 14} height={PANEL_H + 14} rx={27} fill="none" stroke={CHALK.frame} strokeWidth={14} />
      <rect x={-1} y={-1} width={PANEL_W + 2} height={PANEL_H + 2} rx={22} fill="none" stroke={CHALK.frameLight} strokeWidth={2} opacity={0.7} />
      <rect x={-14} y={PANEL_H + 6} width={PANEL_W + 28} height={16} rx={4} fill={CHALK.frame} />
      <rect x={-14} y={PANEL_H + 6} width={PANEL_W + 28} height={4} rx={2} fill={CHALK.frameLight} opacity={0.8} />
      <rect x={PANEL_W - 230} y={PANEL_H - 2} width={58} height={11} rx={5} fill="#f6f3ea" />
      <rect x={PANEL_W - 160} y={PANEL_H - 1} width={40} height={10} rx={5} fill="#f6d77a" />
      <rect x={110} y={PANEL_H - 4} width={96} height={13} rx={3} fill="#3b2a1d" />
      <rect x={110} y={PANEL_H - 4} width={96} height={5} rx={2} fill="#cfcac0" />
    </>
  );
}

/** The speckle over chalk writing — everywhere but a taped-up photo, which is paper, not chalk. */
function ChalkSpeckle({ layout }: { layout: PanelLayout }) {
  const id = useId().replace(/:/g, "");
  const photos = layout.marks.filter((m): m is Extract<Mark, { type: "picture" }> => m.type === "picture");
  if (!photos.length) return <rect x={0} y={0} width={PANEL_W} height={PANEL_H} rx={22} fill="url(#cv-speckle)" pointerEvents="none" />;
  // A clip with holes (even-odd) is plain geometry — no offscreen mask.
  const holes = photos.map((p) => `M${p.rect.x - 12} ${p.rect.y - 26} h${p.rect.w + 24} v${p.rect.h + 38} h${-(p.rect.w + 24)} Z`).join(" ");
  return (
    <>
      <clipPath id={`spk${id}`}>
        <path d={`M0 0 H${PANEL_W} V${PANEL_H} H0 Z ${holes}`} clipRule="evenodd" />
      </clipPath>
      <rect x={0} y={0} width={PANEL_W} height={PANEL_H} rx={22} fill="url(#cv-speckle)" pointerEvents="none" clipPath={`url(#spk${id})`} />
    </>
  );
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

/** A carried element starts where it was on the previous board and flies into place. */
function Carry({ from, to, children, reducedMotion }: { from?: Rect; to?: Rect; children: React.ReactNode; reducedMotion: boolean }) {
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
    <g ref={ref} style={{ transformOrigin: "0 0" }}>
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
};

function MarkView(props: MarkProps) {
  const { mark, carry, targetRect, reducedMotion } = props;
  const body = renderMark(props);
  if (carry && targetRect) {
    return (
      <Carry from={carry} to={targetRect} reducedMotion={reducedMotion}>
        {body}
      </Carry>
    );
  }
  return <g data-mark={mark.id}>{body}</g>;
}

function renderMark({ mark, shownThrough, sentenceProgress, vars, ghostVars, focused, focusId, reducedMotion, chalk }: MarkProps) {
  const focus = focused ? " cv-focus" : "";
  switch (mark.type) {
    case "heading":
      return (
        <text x={mark.x} y={mark.y} fontSize={mark.size} fontWeight={800} fill={INK} className="cv-write">
          {mark.text}
        </text>
      );
    case "note":
      return (
        <g className={`cv-in${focus}`}>
          <circle cx={mark.bullet.x} cy={mark.bullet.y} r={5} fill="#f59e0b" />
          <text x={mark.x} y={mark.y} fontSize={mark.size} fontWeight={600} fill={INK} className="cv-write">
            {mark.lines.map((line, i) => (
              <tspan key={i} x={mark.x} dy={i === 0 ? 0 : mark.size * 1.28}>
                {line}
              </tspan>
            ))}
          </text>
        </g>
      );
    case "node":
      return <NodeView mark={mark} vars={vars} focused={focused} shownThrough={shownThrough} />;
    case "arrow":
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
            <text x={mark.box.x + mark.box.w / 2} y={mark.box.y + mark.box.h / 2 + mark.size * 0.36} textAnchor="middle" fontSize={mark.size} fontWeight={700} fill={INK}>
              {mark.text}
            </text>
          </g>
        </g>
      );
    }
    case "equation":
      return <EquationView mark={mark} shownThrough={shownThrough} focusId={focusId} reducedMotion={reducedMotion} />;
    case "graph":
      return <GraphView mark={mark} shownThrough={shownThrough} sentenceProgress={sentenceProgress} vars={vars} ghostVars={ghostVars} focusId={focusId} />;
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
          <text x={mark.rect.x + (mark.icon ? 74 : 22)} y={mark.rect.y + 48} fontSize={23} fontWeight={800} fill={mark.color}>
            {mark.title}
          </text>
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
      return (
        <g className={`cv-in${focus}`}>
          <rect x={mark.rect.x} y={mark.rect.y} width={mark.rect.w} height={mark.rect.h} rx={16} fill={mark.color} fillOpacity={0.1} />
          <Sketch d={roughRect(`bx-${mark.id}`, mark.rect.x, mark.rect.y, mark.rect.w, mark.rect.h, 16)} color={mark.color} width={2.2} />
          {mark.icon && (
            <g transform={`translate(${mark.rect.x + mark.rect.w / 2},${mark.rect.y + mark.rect.h / 2 - 12}) scale(${Math.min(mark.rect.w, mark.rect.h) / 180})`}>
              <IconGlyph name={mark.icon} color={mark.color} />
            </g>
          )}
          {mark.label && (
            <text x={mark.rect.x + mark.rect.w / 2} y={mark.icon ? mark.rect.y + mark.rect.h - 14 : mark.rect.y + mark.rect.h / 2 + mark.size * 0.35} textAnchor="middle" fontSize={mark.size} fontWeight={700} fill={INK}>
              {mark.label}
            </text>
          )}
        </g>
      );
    case "text":
      return (
        <text x={mark.rect.x + mark.rect.w / 2} y={mark.rect.y + mark.rect.h / 2 + mark.size * 0.35} textAnchor="middle" fontSize={mark.size} fontWeight={700} fill={mark.color} className={`cv-write${focus}`}>
          {mark.text}
        </text>
      );
    case "code":
      return <CodeView mark={mark} shownThrough={shownThrough} focusId={focusId} />;
    case "trace":
      return <TraceView mark={mark} shownThrough={shownThrough} />;
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
  }
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
  const last = mark.steps.at(-1);
  const lit = new Set(step?.lines ?? []);
  const top = rect.y + 14;
  const baseline = (i: number) => top + i * lineH + lineH * 0.7;
  const textX = rect.x + gutter + 14;
  const first = step ? Math.min(...step.lines) : 0;
  // BUILD-UP: the code writes itself as Aria reaches each line (Code Hike's scrollycoding); the last
  // step, or a finished board, shows it whole. "all" shows the listing from the start.
  const upTo = (steps: typeof reached) => Math.max(0, ...steps.flatMap((st) => st.lines));
  const shown = mark.reveal === "all" || !step || step === last || shownThrough === Infinity ? mark.lines.length : upTo(reached);
  const before = mark.reveal === "all" ? mark.lines.length : upTo(reached.slice(0, -1));
  const textOf = (i: number) => {
    const edit = mark.edits.find((e) => e.line === i + 1);
    return edit && shownThrough < edit.s ? edit.from : mark.lines[i];
  };
  const lineEnd = first ? textX + textOf(first - 1).length * 0.6 * size : 0;
  return (
    <g>
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
          <g key={i} className="cv-in" style={{ animationDelay: `${Math.max(0, i - before) * 60}ms` }}>
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
      {mark.sub && !morphed && (
        <text x={mark.cx} y={mark.labelY + 20} textAnchor="middle" fontSize={15} fontWeight={600} fill={MUTED}>
          {mark.sub}
        </text>
      )}
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
    <g className={focused ? "cv-focus" : undefined}>
      <Ink points={points} width={5} color={mark.color} />
      <g className="cv-in cv-late">
        {heads.map((d, i) => <path key={i} d={d} fill={mark.color} />)}
      </g>
      {mark.flow && !reducedMotion && <FlowParticles p0={p0} c={c} p1={p1} color={mark.color} rate={rate} />}
      {mark.label && (
        <g className="cv-in cv-late">
          <rect x={mark.labelAt.x - (mark.label.length * 7.4) / 2 - 8} y={mark.labelAt.y - 15} width={mark.label.length * 7.4 + 16} height={22} rx={11} fill={PAPER} opacity={0.92} />
          <text x={mark.labelAt.x} y={mark.labelAt.y + 1} textAnchor="middle" fontSize={14} fontWeight={700} fill={mark.color}>
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

function EquationView({ mark, shownThrough, focusId, reducedMotion }: { mark: Extract<Mark, { type: "equation" }>; shownThrough: number; focusId?: string; reducedMotion: boolean }) {
  const stepIndex = Math.max(0, mark.steps.reduce((best, step, i) => (step.s <= shownThrough ? i : best), 0));
  const step = mark.steps[stepIndex];
  // A token absent from this step keeps the spot it last had (so it fades where it was), or waits
  // where it will first appear.
  const placeOf = (id: string, at = stepIndex): Pt | undefined => {
    for (let i = at; i >= 0; i--) if (mark.steps[i].place[id]) return mark.steps[i].place[id];
    return mark.steps.find((st) => st.place[id])?.place[id];
  };
  const groups = useRef<Record<string, SVGGElement | null>>({});
  const texts = useRef<Record<string, SVGTextElement | null>>({});
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
      if (crossed && text) text.animate([{ fill: t.color }, { fill: ARIA_INK, offset: 0.45 }, { fill: ARIA_INK, offset: 0.65 }, { fill: t.color }], { duration: 1150, easing: "ease-in-out" });
    }
    // Runs only when the step changes; the positions it reads are derived from the same layout.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stepIndex]);
  return (
    <g>
      {mark.tokens.map((t) => {
        const at = placeOf(t.id);
        if (!at) return null;
        const shown = Boolean(step.place[t.id]);
        const lit = step.highlight.includes(t.id) || focusId === t.id;
        return (
          <g key={t.id} ref={(el) => { groups.current[t.id] = el; }} style={{ transform: `translate(${at.x}px, ${at.y}px)`, transition: "opacity 600ms", opacity: shown ? 1 : 0 }}>
            {lit && (
              <g className="cv-in">
                <path d={roughRect(`hl-${t.id}-${stepIndex}`, -7, -t.size * 0.95, t.w + 14, t.size * 1.3, 10)} fill={t.color} fillOpacity={0.14} stroke={t.color} strokeOpacity={0.35} strokeWidth={1.5} />
              </g>
            )}
            <text ref={(el) => { texts.current[t.id] = el; }} x={0} y={0} fontSize={t.size} fontWeight={800} fill={t.color} className="cv-in">
              {t.text}
            </text>
            {lit && <Ink points={[{ x: 0, y: t.size * 0.24 }, { x: t.w / 2, y: t.size * 0.28 }, { x: t.w, y: t.size * 0.22 }]} width={4} color={t.color} />}
          </g>
        );
      })}
      {step.caption && (
        <text key={stepIndex} x={mark.center} y={mark.captionY} textAnchor="middle" fontSize={21} fontWeight={600} fill={MUTED} className="cv-in">
          {step.caption}
        </text>
      )}
    </g>
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

function GraphView({ mark, shownThrough, sentenceProgress, vars, ghostVars, focusId }: { mark: Extract<Mark, { type: "graph" }>; shownThrough: number; sentenceProgress: number; vars: Record<string, number>; ghostVars?: Record<string, number>; focusId?: string }) {
  const { plot, spec } = mark;
  const xTicks = useMemo(() => niceTicks(spec.x.min, spec.x.max), [spec.x.min, spec.x.max]);
  const yTicks = useMemo(() => niceTicks(spec.y.min, spec.y.max), [spec.y.min, spec.y.max]);
  const px = (x: number) => graphPoint(plot, spec, x, spec.y.min).x;
  const py = (y: number) => graphPoint(plot, spec, spec.x.min, y).y;
  const traceActive = spec.trace && spec.trace.s === shownThrough;
  const traceCurve = spec.trace ? spec.curves.find((c) => c.id === spec.trace!.curve) : undefined;
  const ghostDiffers = ghostVars && Object.keys(ghostVars).some((k) => ghostVars[k] !== vars[k]);
  return (
    <g className="cv-in">
      {yTicks.map((v) => (
        <g key={`y${v}`}>
          <line x1={plot.x} y1={py(v)} x2={plot.x + plot.w} y2={py(v)} stroke="#e7e2d6" strokeWidth={1} />
          <text x={plot.x - 10} y={py(v) + 5} textAnchor="end" fontSize={13} fill={MUTED} fontWeight={600}>
            {v}
          </text>
        </g>
      ))}
      {xTicks.map((v) => (
        <text key={`x${v}`} x={px(v)} y={plot.y + plot.h + 22} textAnchor="middle" fontSize={13} fill={MUTED} fontWeight={600}>
          {v}
        </text>
      ))}
      <line x1={plot.x} y1={plot.y + plot.h} x2={plot.x + plot.w + 8} y2={plot.y + plot.h} stroke={INK} strokeWidth={2.5} />
      <line x1={plot.x} y1={plot.y + plot.h} x2={plot.x} y2={plot.y - 8} stroke={INK} strokeWidth={2.5} />
      <text x={plot.x + plot.w / 2} y={plot.y + plot.h + 50} textAnchor="middle" fontSize={17} fontWeight={700} fill={INK}>
        {spec.x.label}
      </text>
      <text transform={`translate(${plot.x - 50},${plot.y + plot.h / 2}) rotate(-90)`} textAnchor="middle" fontSize={17} fontWeight={700} fill={INK}>
        {spec.y.label}
      </text>
      {(spec.guides ?? []).filter((g) => g.s <= shownThrough).map((g) => (
        <g key={g.id} className={`cv-in${focusId === g.id ? " cv-focus" : ""}`}>
          <line x1={px(g.x)} y1={plot.y} x2={px(g.x)} y2={plot.y + plot.h} stroke="#94a3b8" strokeWidth={2} strokeDasharray="7 6" />
          <text x={px(g.x)} y={plot.y - 12} textAnchor="middle" fontSize={15} fontWeight={700} fill={MUTED}>
            {g.label}
          </text>
        </g>
      ))}
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
        return shown.map((c, i) => ({ c, i, end: ends[i], y: labelY[i] }));
      })().map(({ c, i, end, y }) => {
        const color = c.color ?? ["#15803d", "#2563eb", "#d97706"][i % 3];
        const d = curvePath(plot, spec, c.expr, vars);
        return (
          <g key={c.id} className={focusId === c.id ? "cv-focus" : undefined}>
            <path d={d} stroke={color} strokeWidth={4} fill="none" strokeLinecap="round" strokeLinejoin="round" className="cv-stroke cv-slow" pathLength={1} />
            {c.label && (
              <text x={Math.min(end.x, plot.x + plot.w - 4)} y={y ?? end.y - 12} textAnchor="end" fontSize={15} fontWeight={800} fill={color} className="cv-in cv-late">
                {c.label}
              </text>
            )}
          </g>
        );
      })}
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
        return (
          <g key={m.id} className={focusId === m.id ? "cv-focus" : undefined} style={{ transform: `translate(${p.x}px, ${p.y}px)`, transition: "transform 260ms cubic-bezier(.2,.9,.3,1.25)" }}>
            <line x1={0} y1={0} x2={0} y2={plot.y + plot.h - p.y} stroke={ARIA_INK} strokeWidth={1.5} strokeDasharray="4 4" opacity={0.6} />
            <circle r={11} fill={ARIA_INK} stroke="#fff" strokeWidth={3} className="cv-in" />
            {m.label && (
              <text x={14} y={-14} fontSize={15} fontWeight={800} fill="#c2410c">
                {m.label}
              </text>
            )}
          </g>
        );
      })}
    </g>
  );
}

/** Where the pointer should aim for a graph marker right now (markers move with the sliders). */
export function markerPoint(layout: PanelLayout, id: string, vars: Record<string, number>): Pt | null {
  const graph = layout.marks.find((m) => m.type === "graph") as Extract<Mark, { type: "graph" }> | undefined;
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
.cv-live .cv-late { animation-delay: 520ms; }
.cv-live .cv-write { animation: cv-write 900ms steps(24, end) both; }
.cv-live .cv-stroke { stroke-dasharray: 1; animation: cv-stroke 850ms cubic-bezier(.45,0,.25,1) both; }
.cv-live .cv-slow { animation-duration: 1800ms; }
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
@keyframes cv-hotspot { 0% { transform: scale(.8); opacity: .95; } 100% { transform: scale(2.3); opacity: 0; } }
.cv-hotspot { transform-box: fill-box; transform-origin: center; animation: cv-hotspot 1600ms ease-out infinite; }
@media (prefers-reduced-motion: reduce) { .cv-live .cv-in, .cv-live .cv-write, .cv-live .cv-stroke, .cv-live .cv-morph-in, .cv-ring, .cv-swipe, .cv-tap, .cv-hotspot { animation: none !important; } .cv-morph-out, .cv-morph-ring { display: none; } }
`;

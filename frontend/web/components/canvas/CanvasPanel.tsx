"use client";

import { useEffect, useMemo, useRef } from "react";
import { evalExpr } from "@/lib/canvas/expr";
import { graphPoint, INK, type Mark, type PanelLayout, type Pt, type Rect } from "@/lib/canvas/layout";
import { PANEL_H, PANEL_W, type CanvasBoardSpec, type GraphStage } from "@/lib/canvas/types";
import { IconGlyph } from "./icons";

/**
 * ONE PANEL OF THE LESSON CANVAS, drawn from its layout (lib/canvas/layout.ts).
 *
 * A mark exists in the DOM only once its sentence has been reached, so its entrance animation plays
 * exactly when Aria says it — the reveal is the mount. Panels already taught are rendered "settled"
 * (no entrance animations) and stay on the world, which is what lets the camera pull back over the
 * whole lesson.
 */

export const PAPER = "#fbfaf6";
const MUTED = "#64748b";

type PanelProps = {
  layout: PanelLayout;
  spec: CanvasBoardSpec;
  /** Sentences revealed so far; Infinity for a panel already taught. */
  shownThrough: number;
  /** 0-1 within the current sentence (drives a graph's trace). */
  sentenceProgress: number;
  live: boolean;
  vars: Record<string, number>;
  focusId?: string;
  /** Where a carried element came from, in this panel's own coordinates. */
  carryFrom: Record<string, Rect>;
  reducedMotion: boolean;
};

export function CanvasPanel({ layout, spec, shownThrough, sentenceProgress, live, vars, focusId, carryFrom, reducedMotion }: PanelProps) {
  const visible = layout.marks.filter((m) => m.s <= shownThrough);
  return (
    <g className={live && !reducedMotion ? "cv-live" : "cv-settled"}>
      <rect x={-10} y={-10} width={PANEL_W + 20} height={PANEL_H + 20} rx={28} fill="#000" opacity={0.28} filter="url(#cv-shadow)" />
      <rect x={0} y={0} width={PANEL_W} height={PANEL_H} rx={22} fill={PAPER} stroke="#e7e2d6" strokeWidth={2} />
      <line x1={48} y1={88} x2={Math.min(PANEL_W - 48, 48 + (layout.targets.heading?.w ?? 200) + 20)} y2={88} stroke="#f59e0b" strokeWidth={3} strokeLinecap="round" opacity={0.55} className="cv-stroke" pathLength={1} />
      {visible.map((mark) => (
        <MarkView key={mark.id} mark={mark} layout={layout} spec={spec} shownThrough={shownThrough} sentenceProgress={sentenceProgress} vars={vars} focused={focusId === mark.id} focusId={focusId} carry={carryFrom[mark.id]} targetRect={layout.targets[mark.id]} reducedMotion={reducedMotion} />
      ))}
    </g>
  );
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
      { duration: 1500, delay: 250, easing: "cubic-bezier(.65,0,.25,1)", fill: "backwards" },
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
  focused: boolean;
  focusId?: string;
  carry?: Rect;
  targetRect?: Rect;
  reducedMotion: boolean;
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

function renderMark({ mark, shownThrough, sentenceProgress, vars, focused, focusId }: MarkProps) {
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
      return <NodeView mark={mark} vars={vars} focused={focused} />;
    case "arrow":
      return <ArrowView mark={mark} vars={vars} focused={focused} />;
    case "picture":
      return (
        <g className="cv-in">
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
          <circle cx={mark.cx} cy={mark.cy} r={9} fill="#f43f5e" stroke="#fff" strokeWidth={3} />
        </g>
      ) : null;
    case "callout":
      return (
        <g className={`cv-in${focus}`}>
          <line x1={mark.anchor.x} y1={mark.anchor.y} x2={mark.box.x + mark.box.w / 2} y2={mark.box.y + mark.box.h / 2} stroke={INK} strokeWidth={2} className="cv-stroke" pathLength={1} />
          <circle cx={mark.anchor.x} cy={mark.anchor.y} r={5.5} fill={INK} stroke="#fff" strokeWidth={2} />
          <rect x={mark.box.x} y={mark.box.y} width={mark.box.w} height={mark.box.h} rx={mark.box.h / 2} fill="#fff" stroke={INK} strokeWidth={2} />
          <text x={mark.box.x + mark.box.w / 2} y={mark.box.y + mark.box.h / 2 + mark.size * 0.36} textAnchor="middle" fontSize={mark.size} fontWeight={700} fill={INK}>
            {mark.text}
          </text>
        </g>
      );
    case "equation":
      return <EquationView mark={mark} shownThrough={shownThrough} focusId={focusId} />;
    case "graph":
      return <GraphView mark={mark} shownThrough={shownThrough} sentenceProgress={sentenceProgress} vars={vars} focusId={focusId} />;
    case "column":
      return (
        <g className="cv-in">
          <rect x={mark.rect.x} y={mark.rect.y} width={mark.rect.w} height={mark.rect.h} rx={20} fill={mark.color} opacity={0.07} />
          <rect x={mark.rect.x} y={mark.rect.y} width={mark.rect.w} height={mark.rect.h} rx={20} fill="none" stroke={mark.color} strokeWidth={2} opacity={0.5} />
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
          <rect x={mark.rect.x} y={mark.rect.y} width={mark.rect.w} height={mark.rect.h} rx={12} fill="#fff" stroke={mark.color} strokeWidth={1.5} opacity={0.95} />
          <text x={mark.rect.x + 16} y={mark.rect.y + 11 + mark.size} fontSize={mark.size} fontWeight={600} fill={INK}>
            {mark.text.split("\n").map((line, i) => (
              <tspan key={i} x={mark.rect.x + 16} dy={i === 0 ? 0 : mark.size * 1.3}>
                {line}
              </tspan>
            ))}
          </text>
        </g>
      );
    case "link":
      return (
        <path d={`M${mark.p0.x} ${mark.p0.y} C ${mark.p0.x + 40} ${mark.p0.y}, ${mark.p1.x - 40} ${mark.p1.y}, ${mark.p1.x} ${mark.p1.y}`} stroke={MUTED} strokeWidth={2} strokeDasharray="6 6" fill="none" className="cv-in" />
      );
    case "box":
      return (
        <g className={`cv-in${focus}`}>
          <rect x={mark.rect.x} y={mark.rect.y} width={mark.rect.w} height={mark.rect.h} rx={16} fill={mark.color} fillOpacity={0.1} stroke={mark.color} strokeWidth={2} />
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
  }
}

/* ── nodes and arrows ─────────────────────────────────────────────────────────────────────── */

function NodeView({ mark, vars, focused }: { mark: Extract<Mark, { type: "node" }>; vars: Record<string, number>; focused: boolean }) {
  const glow = mark.glow ? Math.max(0, Math.min(1, evalExpr(mark.glow, vars, 1))) : null;
  return (
    <g className={`cv-in${focused ? " cv-focus" : ""}`}>
      {glow !== null && <circle cx={mark.cx} cy={mark.cy} r={mark.r * 1.55} fill={`url(#cv-glow)`} opacity={glow} style={{ transition: "opacity 300ms" }} />}
      <circle cx={mark.cx} cy={mark.cy} r={mark.r} fill={mark.color} fillOpacity={0.1} stroke={mark.color} strokeWidth={2.5} />
      {mark.icon ? (
        <g transform={`translate(${mark.cx},${mark.cy}) scale(${(mark.r * 1.45) / 100})`} opacity={glow === null ? 1 : 0.45 + glow * 0.55} style={{ transition: "opacity 300ms" }}>
          <IconGlyph name={mark.icon} color={mark.color} />
        </g>
      ) : (
        <circle cx={mark.cx} cy={mark.cy} r={mark.r * 0.45} fill={mark.color} opacity={0.8} />
      )}
      {mark.label && (
        <text x={mark.cx} y={mark.labelY} textAnchor="middle" fontSize={mark.labelSize} fontWeight={800} fill={INK}>
          {mark.label}
        </text>
      )}
      {mark.sub && (
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

function ArrowView({ mark, vars, focused }: { mark: Extract<Mark, { type: "arrow" }>; vars: Record<string, number>; focused: boolean }) {
  const { p0, c, p1 } = mark;
  const dx = p1.x - c.x;
  const dy = p1.y - c.y;
  const d = Math.hypot(dx, dy) || 1;
  const ux = dx / d;
  const uy = dy / d;
  const head = `M${p1.x} ${p1.y} L${p1.x - ux * 14 - uy * 8} ${p1.y - uy * 14 + ux * 8} L${p1.x - ux * 14 + uy * 8} ${p1.y - uy * 14 - ux * 8} Z`;
  const rate = mark.rate ? Math.max(0, Math.min(1, evalExpr(mark.rate, vars, 1))) : 1;
  return (
    <g className={focused ? "cv-focus" : undefined}>
      <path d={`M${p0.x} ${p0.y} Q ${c.x} ${c.y} ${p1.x} ${p1.y}`} stroke={mark.color} strokeWidth={3.5} fill="none" strokeLinecap="round" className="cv-stroke" pathLength={1} />
      <path d={head} fill={mark.color} className="cv-in cv-late" />
      {mark.flow && <FlowParticles p0={p0} c={c} p1={p1} color={mark.color} rate={rate} />}
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

/** Dots travelling along an arrow: matter or energy moving. Positions are set per frame, off React. */
function FlowParticles({ p0, c, p1, color, rate }: { p0: Pt; c: Pt; p1: Pt; color: string; rate: number }) {
  const refs = useRef<Array<SVGCircleElement | null>>([]);
  const rateRef = useRef(rate);
  useEffect(() => {
    rateRef.current = rate;
  }, [rate]);
  useEffect(() => {
    if (typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    let raf = 0;
    let phase = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const r = rateRef.current;
      phase = (phase + dt * (0.12 + r * 0.55)) % 1;
      refs.current.forEach((el, i) => {
        if (!el) return;
        const t = (phase + i / refs.current.length) % 1;
        const p = bezier(p0, c, p1, t);
        el.setAttribute("cx", String(p.x));
        el.setAttribute("cy", String(p.y));
        el.setAttribute("opacity", String(r <= 0.02 ? 0 : Math.sin(Math.PI * t) * (0.35 + r * 0.65)));
      });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [p0, c, p1]);
  return (
    <g>
      {[0, 1, 2, 3].map((i) => (
        <circle key={i} ref={(el) => { refs.current[i] = el; }} r={5.5} fill={color} stroke="#fff" strokeWidth={1.5} opacity={0} />
      ))}
    </g>
  );
}

/* ── equation ─────────────────────────────────────────────────────────────────────────────── */

function EquationView({ mark, shownThrough, focusId }: { mark: Extract<Mark, { type: "equation" }>; shownThrough: number; focusId?: string }) {
  const stepIndex = Math.max(0, mark.steps.reduce((best, step, i) => (step.s <= shownThrough ? i : best), 0));
  const step = mark.steps[stepIndex];
  // A token absent from this step keeps the spot it last had (so it fades where it was), or waits
  // where it will first appear.
  const placeOf = (id: string): Pt | undefined => {
    for (let i = stepIndex; i >= 0; i--) if (mark.steps[i].place[id]) return mark.steps[i].place[id];
    return mark.steps.find((st) => st.place[id])?.place[id];
  };
  return (
    <g>
      {mark.tokens.map((t) => {
        const at = placeOf(t.id);
        if (!at) return null;
        const shown = Boolean(step.place[t.id]);
        const lit = step.highlight.includes(t.id) || focusId === t.id;
        return (
          <g key={t.id} style={{ transform: `translate(${at.x}px, ${at.y}px)`, transition: "transform 1100ms cubic-bezier(.65,0,.25,1), opacity 600ms", opacity: shown ? 1 : 0 }}>
            {lit && (
              <g className="cv-in">
                <rect x={-6} y={-t.size * 0.95} width={t.w + 12} height={t.size * 1.28} rx={10} fill={t.color} fillOpacity={0.14} />
              </g>
            )}
            <text x={0} y={0} fontSize={t.size} fontWeight={800} fill={t.color} className="cv-in">
              {t.text}
            </text>
            {lit && <line x1={0} y1={t.size * 0.22} x2={t.w} y2={t.size * 0.22} stroke={t.color} strokeWidth={3} strokeLinecap="round" className="cv-stroke" pathLength={1} />}
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

/* ── graph ────────────────────────────────────────────────────────────────────────────────── */

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

function GraphView({ mark, shownThrough, sentenceProgress, vars, focusId }: { mark: Extract<Mark, { type: "graph" }>; shownThrough: number; sentenceProgress: number; vars: Record<string, number>; focusId?: string }) {
  const { plot, spec } = mark;
  const xTicks = useMemo(() => niceTicks(spec.x.min, spec.x.max), [spec.x.min, spec.x.max]);
  const yTicks = useMemo(() => niceTicks(spec.y.min, spec.y.max), [spec.y.min, spec.y.max]);
  const px = (x: number) => graphPoint(plot, spec, x, spec.y.min).x;
  const py = (y: number) => graphPoint(plot, spec, spec.x.min, y).y;
  const traceActive = spec.trace && spec.trace.s === shownThrough;
  const traceCurve = spec.trace ? spec.curves.find((c) => c.id === spec.trace!.curve) : undefined;
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
      {spec.curves.filter((c) => c.s <= shownThrough).map((c, i) => {
        const color = c.color ?? ["#15803d", "#2563eb", "#d97706"][i % 3];
        const d = curvePath(plot, spec, c.expr, vars);
        const endX = spec.x.max;
        const end = graphPoint(plot, spec, endX, evalExpr(c.expr, { ...vars, x: endX }, spec.y.min));
        return (
          <g key={c.id} className={focusId === c.id ? "cv-focus" : undefined}>
            <path d={d} stroke={color} strokeWidth={4} fill="none" strokeLinecap="round" strokeLinejoin="round" className="cv-stroke cv-slow" pathLength={1} />
            {c.label && (
              <text x={Math.min(end.x, plot.x + plot.w - 4)} y={end.y - 12} textAnchor="end" fontSize={15} fontWeight={800} fill={color} className="cv-in cv-late">
                {c.label}
              </text>
            )}
          </g>
        );
      })}
      {traceActive && traceCurve && (() => {
        const x = spec.x.min + (spec.x.max - spec.x.min) * Math.min(1, sentenceProgress * 1.15);
        const p = graphPoint(plot, spec, x, evalExpr(traceCurve.expr, { ...vars, x }, spec.y.min));
        return <circle cx={p.x} cy={p.y} r={9} fill="#f43f5e" stroke="#fff" strokeWidth={3} />;
      })()}
      {(spec.markers ?? []).filter((m) => m.s <= shownThrough).map((m) => {
        const curve = spec.curves.find((c) => c.id === m.curve);
        if (!curve) return null;
        const x = Math.max(spec.x.min, Math.min(spec.x.max, evalExpr(m.x, vars, spec.x.min)));
        const y = evalExpr(curve.expr, { ...vars, x }, spec.y.min);
        const p = graphPoint(plot, spec, x, y);
        return (
          <g key={m.id} className={focusId === m.id ? "cv-focus" : undefined} style={{ transform: `translate(${p.x}px, ${p.y}px)`, transition: "transform 180ms ease-out" }}>
            <line x1={0} y1={0} x2={0} y2={plot.y + plot.h - p.y} stroke="#f43f5e" strokeWidth={1.5} strokeDasharray="4 4" opacity={0.6} />
            <circle r={11} fill="#f43f5e" stroke="#fff" strokeWidth={3} className="cv-in" />
            {m.label && (
              <text x={14} y={-14} fontSize={15} fontWeight={800} fill="#be123c">
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

export const CANVAS_CSS = `
.cv-live .cv-in { animation: cv-in 650ms cubic-bezier(.2,.8,.2,1) both; transform-box: fill-box; transform-origin: center; }
.cv-live .cv-late { animation-delay: 550ms; }
.cv-live .cv-write { animation: cv-write 900ms steps(24, end) both; }
.cv-live .cv-stroke { stroke-dasharray: 1; animation: cv-stroke 900ms cubic-bezier(.4,0,.2,1) both; }
.cv-live .cv-slow { animation-duration: 1800ms; }
.cv-focus { filter: drop-shadow(0 0 10px rgba(244,63,94,.55)); }
.cv-focus text, .cv-focus circle { transition: filter 300ms; }
@keyframes cv-in { from { opacity: 0; transform: translateY(8px) scale(.94); } to { opacity: 1; transform: none; } }
@keyframes cv-write { from { clip-path: inset(0 100% 0 0); } to { clip-path: inset(0 0 0 0); } }
@keyframes cv-stroke { from { stroke-dashoffset: 1; } to { stroke-dashoffset: 0; } }
@keyframes cv-ring { from { stroke-dashoffset: 1; } to { stroke-dashoffset: 0; } }
@keyframes cv-tap { 0% { transform: scale(.4); opacity: .9; } 100% { transform: scale(2.4); opacity: 0; } }
.cv-tap { transform-box: fill-box; transform-origin: center; animation: cv-tap 900ms ease-out 2; }
.cv-ring { stroke-dasharray: 1; animation: cv-ring 800ms cubic-bezier(.4,0,.2,1) both; }
@keyframes cv-hotspot { 0% { transform: scale(.8); opacity: .95; } 100% { transform: scale(2.3); opacity: 0; } }
.cv-hotspot { transform-box: fill-box; transform-origin: center; animation: cv-hotspot 1600ms ease-out infinite; }
@media (prefers-reduced-motion: reduce) { .cv-live .cv-in, .cv-live .cv-write, .cv-live .cv-stroke, .cv-ring, .cv-tap, .cv-hotspot { animation: none !important; } }
`;

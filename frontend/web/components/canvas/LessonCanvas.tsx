"use client";

import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Compass, Crosshair, Eraser, Loader2, PenLine, Play, Sparkles, Volume2, VolumeX } from "lucide-react";
import { fitView, flightMs, unionRects, viewAt, type View } from "@/lib/canvas/camera";
import { evalExpr } from "@/lib/canvas/expr";
import { layoutPanel, placePanels, toWorld, type Mark, type PanelLayout, type PanelPlacement, type Pt, type Rect } from "@/lib/canvas/layout";
import { PANEL_H, PANEL_W, type CanvasBoardSpec, type CanvasCue, type TryItInteraction } from "@/lib/canvas/types";
import { activeCues } from "@/lib/canvas/cues";
import { CANVAS_THEMES, CHALK, chalkCss, chalkTint, panelTheme, recolour, type BoardTheme, type CanvasThemeChoice } from "@/lib/canvas/theme";
import { BOARD_FONT_FACES, BOARD_FONT_FAMILY, BOARD_FONT_STACK } from "@/lib/anim/boardFont";
import { useReducedMotion } from "@/lib/anim/useReducedMotion";
import { ARIA_INK, CANVAS_CSS, CanvasPanel, Ink, markerPoint } from "./CanvasPanel";
import { quadPoints, roughEllipse } from "@/lib/canvas/ink";
import { playScratch, playTick, playWhoosh, setSoundEnabled, soundEnabled } from "./sound";
import { Confetti } from "./Confetti";

/**
 * THE LESSON CANVAS — every board of the lecture on one world, taught by a camera and a pen.
 *
 * What the old board could not do, and this one does:
 *   - ONE CANVAS. Boards stay where they were drawn; the camera flies between them, and a board that
 *     looks inside something sits inside it, so "zoom into the chloroplast" is a zoom.
 *   - ARIA'S PEN. A visible pointer glides to what she is talking about and taps, circles or
 *     underlines it, while the element itself lifts — signalling, driven by the spec's cues.
 *   - CONTINUITY. An element carried from the previous board flies across instead of being redrawn;
 *     an equation's tokens move to their new places instead of being rewritten.
 *   - TRY IT. Sliders drive the board live (curves, markers, glows, flowing particles), and Aria
 *     reacts to what the student did.
 *   - DRAW IT. The student draws on the board and Aria checks it, drawing her corrections in place.
 *   - THE WHOLE LESSON. At the end the camera pulls back over every board; the student can fly
 *     back to any of them.
 */

export type CanvasPanelInput = { key: string; spec: CanvasBoardSpec };

type DrawingCheck = {
  correct: boolean;
  feedback: string;
  marks: Array<{ kind: "arrow"; from: string; to: string; label?: string } | { kind: "circle"; target: string; label?: string }>;
};

type Props = {
  panels: CanvasPanelInput[];
  /** The panel being taught, or -1 when the current beat has no board (a checkpoint). */
  currentIndex: number;
  sentence: number;
  sentenceProgress: number;
  /** The current board's narration has finished. */
  finished: boolean;
  /** The player is holding this board for the student (Try it / Draw it). */
  waitingForStudent: boolean;
  topic: string;
  onSpeak: (text: string) => void;
  onTellAria: (note: string) => void;
  onContinue: () => void;
  /** The lecture is playing. Paused, the student may explore: picture hotspots appear. */
  playing?: boolean;
  /** This lecture through the student's knowledge graph (GET /api/knowledge/lecture): marks the boards. */
  knowledge?: CanvasKnowledge | null;
  /** A Predict-it answer or a drawing check — evidence of what the student knows. First try only. */
  onTaskResult?: (kind: "quiz" | "drawing", correct: boolean, options?: number) => void;
  /** The student tapped "from <earlier lecture>" on a concept. */
  onOpenEarlier?: (from: EarlierBoard) => void;
};

export type EarlierBoard = { lectureId: string; sequence: number; beatId: string; title: string; topic: string };
export type CanvasKnowledge = {
  beats: Array<{ sequence: number; concepts: string[]; elements: Record<string, string> }>;
  concepts: Record<string, { label: string; status: "known" | "shaky" | "new"; mastery: number | null; from?: EarlierBoard; gaps?: Array<{ key: string; label: string; mastery: number | null }> }>;
};

/** Aria's coral: her pen, her highlighter, her corrections — one colour that always means "Aria". */
const ARIA = ARIA_INK;
const STUDENT = "#2563eb";

export function LessonCanvas({ panels, currentIndex, sentence, sentenceProgress, finished, waitingForStudent, topic, onSpeak, onTellAria, onContinue, playing = true, knowledge, onTaskResult, onOpenEarlier }: Props) {
  const reducedMotion = useReducedMotion();
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [aspect, setAspect] = useState(16 / 9);
  const [mode, setMode] = useState<"follow" | "free" | "overview">("follow");

  /**
   * THE BOARD IS MADE OF THE APP'S MATERIAL: paper when the app is light, chalk when it is dark
   * (app/globals.css; Settings → Appearance). A choice stored by an earlier build's Paper/Chalk/Mix
   * pill still wins for that browser; the pill itself is gone from the lesson, so a student is never
   * asked to style a board mid-lesson.
   */
  const [themeChoice, setThemeChoice] = useState<CanvasThemeChoice>(DEFAULT_THEME);
  useEffect(() => {
    const apply = () => setThemeChoice(storedTheme());
    const t = window.setTimeout(apply, 0);
    const observer = new MutationObserver(apply);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => {
      window.clearTimeout(t);
      observer.disconnect();
    };
  }, []);
  const themes = useMemo((): BoardTheme[] => panels.map((p) => panelTheme(themeChoice, p.spec.stage.kind)), [panels, themeChoice]);
  // A chalk board's own colours are lifted to chalk pastels before it is laid out (theme.ts).
  const specs = useMemo(() => panels.map((p, i) => (themes[i] === "chalk" ? recolour(p.spec, chalkTint) : p.spec)), [panels, themes]);
  const layouts = useMemo(() => specs.map((spec, i) => (themes[i] === "chalk" ? recolour(layoutPanel(spec), chalkTint) : layoutPanel(spec))), [specs, themes]);
  const placements = useMemo(
    () => placePanels(panels.map((p, i) => ({ key: p.key, inside: p.spec.inside, layout: layouts[i] }))),
    [panels, layouts],
  );
  const shownIndex = currentIndex >= 0 ? currentIndex : Math.max(0, panels.length - 1);
  const current = panels[shownIndex];
  const currentLayout = layouts[shownIndex];
  const currentPlace = current ? placements[current.key] : undefined;

  /* ── try-it variables, drawings, corrections ──────────────────────────────────────────── */

  // What the student has set; every other variable sits at its slider's starting value.
  const [varOverrides, setVars] = useState<Record<string, Record<string, number>>>({});
  const vars = useMemo(() => {
    const out = initialVars(panels);
    for (const [key, values] of Object.entries(varOverrides)) out[key] = { ...(out[key] ?? {}), ...values };
    return out;
  }, [panels, varOverrides]);
  const [strokes, setStrokes] = useState<Record<string, Pt[][]>>({});
  const [corrections, setCorrections] = useState<Record<string, DrawingCheck>>({});
  const [reactionPoint, setReactionPoint] = useState<{ key: string; target: string; at: number } | null>(null);
  /** Slider values before the student's last drag, per board: the graph draws them as a ghost. */
  const [ghostVars, setGhostVars] = useState<Record<string, Record<string, number>>>({});
  /** The three sounds are OFF unless the student turns them on (remembered per browser). */
  const [soundOn, setSoundOn] = useState(false);
  useEffect(() => {
    const t = window.setTimeout(() => setSoundOn(soundEnabled()), 0);
    return () => window.clearTimeout(t);
  }, []);
  /** Bumped on a correct answer — the only thing that earns confetti. */
  const [celebration, setCelebration] = useState(0);
  useEffect(() => {
    if (!celebration) return;
    const t = window.setTimeout(() => setCelebration(0), 1700);
    return () => window.clearTimeout(t);
  }, [celebration]);
  /** Paper grain, baked ONCE into a small image (a live turbulence filter would re-render every camera frame). */
  const [grainUrl, setGrainUrl] = useState<string | null>(null);
  const [shadowUrl, setShadowUrl] = useState<string | null>(null);
  const [dustUrl, setDustUrl] = useState<string | null>(null);
  const [speckleUrl, setSpeckleUrl] = useState<string | null>(null);
  useEffect(() => {
    const t = window.setTimeout(() => {
      setGrainUrl(paperGrain());
      setShadowUrl(paperShadow());
      setDustUrl(chalkDust());
      setSpeckleUrl(chalkSpeckle());
    }, 0);
    return () => window.clearTimeout(t);
  }, []);


  const interaction = current?.spec.interaction;
  const taskOpen = Boolean(interaction) && currentIndex >= 0 && (finished || waitingForStudent);
  const drawing = taskOpen && interaction?.kind === "draw";

  /* ── the pen: which cue is live ───────────────────────────────────────────────────────── */

  const cueState = useMemo(() => activeCues(current?.spec.cues ?? [], sentence, sentenceProgress, finished || currentIndex < 0), [current, sentence, sentenceProgress, finished, currentIndex]);
  const penCue = reactionPoint && current && reactionPoint.key === current.key ? ({ s: sentence, action: "point", target: reactionPoint.target } as CanvasCue) : cueState.visit ? undefined : cueState.pen;
  const focusId = penCue?.target;
  /** Picture hotspots: out while the student can explore — paused, finished, or moving the camera. */
  const exploring = !playing || finished || currentIndex < 0 || mode !== "follow";
  // A tick when Aria's pen taps, a pencil scratch when a sentence puts new ink on the board. Both are
  // silent unless the student switched sound on (sound.ts), and each is throttled.
  const penKey = penCue && current ? `${current.key}|${penCue.s}|${penCue.action}|${penCue.target}` : "";
  useEffect(() => {
    if (penKey.includes("|point|")) playTick();
  }, [penKey]);
  const inkKey = current && currentIndex >= 0 && !finished ? `${current.key}|${sentence}` : "";
  useEffect(() => {
    if (inkKey && currentLayout?.marks.some((m) => m.s === sentence)) playScratch();
    // Keyed on the board and sentence only: the scratch marks new ink, not re-renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inkKey]);

  /* ── the knowledge graph on the boards ────────────────────────────────────────────────── */

  /** Tasks already reported as evidence: only a first try says what the student knew. */
  const reported = useRef(new Set<string>());
  /** Per board: element id → concept, and the first board each concept appears on in this lecture. */
  const boardConcepts = useMemo(() => {
    const byBoard = panels.map((_, i) => knowledge?.beats.find((b) => b.sequence === i));
    const firstBoard: Record<string, number> = {};
    byBoard.forEach((b, i) => {
      for (const key of Object.values(b?.elements ?? {})) if (firstBoard[key] === undefined) firstBoard[key] = i;
    });
    return { byBoard, firstBoard };
  }, [panels, knowledge]);
  /** After a wrong prediction: the prerequisite this board's ideas build on that the student is shaky on. */
  const quizHint = useMemo(() => {
    const keys = boardConcepts.byBoard[shownIndex]?.concepts ?? [];
    for (const key of keys) {
      const gap = knowledge?.concepts[key]?.gaps?.[0];
      if (gap) return `This builds on ${gap.label} — ask Aria for a quick refresher.`;
    }
    return undefined;
  }, [boardConcepts, knowledge, shownIndex]);

  /* ── the camera ───────────────────────────────────────────────────────────────────────── */

  const worldRects = useMemo(() => panels.map((p) => toWorld({ x: 0, y: 0, w: PANEL_W, h: PANEL_H }, placements[p.key])), [panels, placements]);
  const overviewView = useMemo(() => fitView(unionRects(worldRects.slice(0, shownIndex + 1)), aspect, 0.05), [worldRects, shownIndex, aspect]);

  const visitIndex = cueState.visit ? panels.findIndex((p) => p.key === cueState.visit) : -1;
  const followView = useMemo((): View => {
    if (!current || !currentPlace) return overviewView;
    if (current.spec.overview && finished) return overviewView;
    // The recap's tour: while a sentence recalls an earlier board, the camera is back on it.
    if (visitIndex >= 0 && visitIndex < shownIndex) return fitView(worldRects[visitIndex], aspect, 0.06);
    const zoomTarget = cueState.zoom ? currentLayout.targets[cueState.zoom] : undefined;
    // Zooming onto something that already fills most of the board only crops it.
    if (zoomTarget && zoomTarget.w * zoomTarget.h < PANEL_W * PANEL_H * 0.28 && !taskOpen) {
      const t = zoomTarget;
      // Never closer than about half the board: a zoom shows a detail in its context, not a texture.
      const w = Math.max(t.w, PANEL_W * 0.55);
      const h = Math.max(t.h, PANEL_H * 0.55);
      const x = Math.max(0, Math.min(PANEL_W - w, t.x + t.w / 2 - w / 2));
      const y = Math.max(0, Math.min(PANEL_H - h, t.y + t.h / 2 - h / 2));
      return fitView(toWorld({ x, y, w, h }, currentPlace), aspect, 0.06);
    }
    // A task card sits to the right of the board: the camera slides the board left to make room.
    const room = taskOpen ? PANEL_W * 0.52 : 0;
    return fitView(toWorld({ x: 0, y: 0, w: PANEL_W + room, h: PANEL_H }, currentPlace), aspect, 0.035);
  }, [current, currentPlace, currentLayout, cueState.zoom, finished, overviewView, aspect, taskOpen, visitIndex, shownIndex, worldRects]);

  const viewRef = useRef<View>(followView);
  const flightRef = useRef(0);
  /*
   * The camera writes the viewBox itself, every frame, and React never does: a viewBox rendered by
   * React jumped to the destination for a frame whenever the board changed, before the flight
   * started from where the camera really was. The dot grid behind the boards is a CSS background
   * moved with it — as an SVG pattern it was thousands of tiny circles redrawn every frame.
   */
  const applyView = useCallback((v: View) => {
    viewRef.current = v;
    svgRef.current?.setAttribute("viewBox", `${v.x} ${v.y} ${v.w} ${v.h}`);
    const el = containerRef.current;
    if (el && v.w > 0) {
      const scale = el.clientWidth / v.w;
      const cell = DOT_CELL * scale;
      el.style.backgroundSize = `${cell}px ${cell}px`;
      el.style.backgroundPosition = `${-v.x * scale}px ${-v.y * scale}px`;
    }
  }, []);
  useLayoutEffect(() => {
    applyView(viewRef.current);
  }, [applyView]);
  const flyTo = useCallback(
    (target: View) => {
      cancelAnimationFrame(flightRef.current);
      const from = viewRef.current;
      if (reducedMotion) return applyView(target);
      // Keep the aspect of the target; a resize mid-flight is corrected by the next flight.
      const start = performance.now();
      const duration = flightMs(from, target);
      if (duration > 1100) playWhoosh();
      const fromFitted = fitView(from, target.w / target.h, 0);
      const step = (now: number) => {
        const t = Math.min(1, (now - start) / duration);
        applyView(viewAt(fromFitted, target, t));
        if (t < 1) flightRef.current = requestAnimationFrame(step);
      };
      flightRef.current = requestAnimationFrame(step);
    },
    [applyView, reducedMotion],
  );

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) setAspect(r.width / r.height);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const followKey = `${Math.round(followView.x)}:${Math.round(followView.y)}:${Math.round(followView.w)}`;
  useEffect(() => {
    if (mode === "follow") flyTo(followView);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [followKey, mode]);
  useEffect(() => {
    if (mode === "overview") flyTo(overviewView);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, overviewView.x, overviewView.w]);
  // A new board always brings the camera back to Aria (adjusted during render, not in an effect).
  const [modeBoard, setModeBoard] = useState(currentIndex);
  if (modeBoard !== currentIndex) {
    setModeBoard(currentIndex);
    setMode("follow");
    setReactionPoint(null);
  }
  useEffect(() => () => cancelAnimationFrame(flightRef.current), []);

  /* ── free exploring: drag to pan, wheel to zoom ───────────────────────────────────────── */

  const drag = useRef<{ x: number; y: number; view: View } | null>(null);
  const toWorldPoint = (clientX: number, clientY: number): Pt | null => {
    const el = containerRef.current;
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const v = viewRef.current;
    return { x: v.x + ((clientX - r.left) / r.width) * v.w, y: v.y + ((clientY - r.top) / r.height) * v.h };
  };
  const onWheel = (e: React.WheelEvent) => {
    if (drawing) return;
    const p = toWorldPoint(e.clientX, e.clientY);
    if (!p) return;
    cancelAnimationFrame(flightRef.current);
    const k = Math.exp(Math.max(-0.4, Math.min(0.4, e.deltaY * 0.0015)));
    const v = viewRef.current;
    const w = Math.max(120, Math.min(20000, v.w * k));
    const h = w / (v.w / v.h);
    applyView({ x: p.x - ((p.x - v.x) / v.w) * w, y: p.y - ((p.y - v.y) / v.h) * h, w, h });
    setMode("free");
  };

  /* ── student drawing ──────────────────────────────────────────────────────────────────── */

  const [liveStroke, setLiveStroke] = useState<Pt[] | null>(null);
  const toPanelPoint = (clientX: number, clientY: number): Pt | null => {
    const w = toWorldPoint(clientX, clientY);
    if (!w || !currentPlace) return null;
    return { x: (w.x - currentPlace.x) / currentPlace.scale, y: (w.y - currentPlace.y) / currentPlace.scale };
  };
  const onPointerDown = (e: React.PointerEvent) => {
    (e.target as Element).setPointerCapture?.(e.pointerId);
    if (drawing) {
      const p = toPanelPoint(e.clientX, e.clientY);
      if (p) setLiveStroke([p]);
      return;
    }
    drag.current = { x: e.clientX, y: e.clientY, view: viewRef.current };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (drawing && liveStroke) {
      const p = toPanelPoint(e.clientX, e.clientY);
      if (p) setLiveStroke((stroke) => (stroke ? [...stroke, p] : [p]));
      return;
    }
    if (!drag.current || !containerRef.current) return;
    const r = containerRef.current.getBoundingClientRect();
    const dx = e.clientX - drag.current.x;
    const dy = e.clientY - drag.current.y;
    if (Math.hypot(dx, dy) < 4 && mode !== "free") return;
    cancelAnimationFrame(flightRef.current);
    const v = drag.current.view;
    applyView({ ...v, x: v.x - (dx / r.width) * v.w, y: v.y - (dy / r.height) * v.h });
    if (mode !== "free") setMode("free");
  };
  const onPointerUp = (e: React.PointerEvent) => {
    if (drawing && liveStroke && current) {
      const stroke = liveStroke;
      setLiveStroke(null);
      if (stroke.length > 1) setStrokes((prev) => ({ ...prev, [current.key]: [...(prev[current.key] ?? []), stroke] }));
      return;
    }
    // A click (no drag) on a board in the overview flies to it.
    if (drag.current && Math.hypot(e.clientX - drag.current.x, e.clientY - drag.current.y) < 4 && mode !== "follow") {
      const p = toWorldPoint(e.clientX, e.clientY);
      const hit = p ? [...worldRects.keys()].reverse().find((i) => i <= shownIndex && p.x >= worldRects[i].x && p.x <= worldRects[i].x + worldRects[i].w && p.y >= worldRects[i].y && p.y <= worldRects[i].y + worldRects[i].h) : undefined;
      if (hit !== undefined) {
        setMode("free");
        flyTo(fitView(worldRects[hit], aspect, 0.035));
      }
    }
    drag.current = null;
  };

  const [checking, setChecking] = useState(false);
  const checkDrawing = async () => {
    if (!current || interaction?.kind !== "draw") return;
    setChecking(true);
    try {
      const { image, elements } = await schematic(currentLayout, strokes[current.key] ?? []);
      const res = await fetch("/api/canvas-lecture/check-drawing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image, elements, prompt: interaction.prompt, expect: interaction.expect, topic }),
      });
      const check = (await res.json()) as DrawingCheck;
      if (!res.ok || typeof check.feedback !== "string") throw new Error("check failed");
      setCorrections((prev) => ({ ...prev, [current.key]: check }));
      if (!reported.current.has(`draw:${current.key}`)) {
        reported.current.add(`draw:${current.key}`);
        onTaskResult?.("drawing", check.correct);
      }
      if (check.correct) setCelebration(Date.now());
      if (check.feedback) onSpeak(check.feedback);
      onTellAria(`The student was asked to "${interaction.prompt}" and drew on the board. Your check: ${check.correct ? "correct" : "not yet right"} — ${check.feedback}`);
    } catch {
      onSpeak("I couldn't check that drawing just now. Try once more?");
    } finally {
      setChecking(false);
    }
  };

  /* ── try it: reactions ────────────────────────────────────────────────────────────────── */

  const lastReaction = useRef<Record<string, number>>({});
  const react = (panelKey: string, task: TryItInteraction, values: Record<string, number>) => {
    const i = task.reactions.findIndex((r) => evalExpr(r.when, values, 0) !== 0);
    if (i < 0 || lastReaction.current[panelKey] === i) return;
    lastReaction.current[panelKey] = i;
    onSpeak(task.reactions[i].say);
    const settings = task.controls.map((c) => `${c.label} = ${values[c.var]}${c.unit ? ` ${c.unit}` : ""}`).join(", ");
    onTellAria(`On the "Try it" board the student set ${settings}. You told them: "${task.reactions[i].say}"`);
    const layout = layouts[panels.findIndex((p) => p.key === panelKey)];
    const marker = layout?.marks.find((m) => m.type === "graph") as Extract<Mark, { type: "graph" }> | undefined;
    const target = marker?.spec.markers?.[0]?.id ?? layout?.marks.find((m) => m.type === "node" && (m as Extract<Mark, { type: "node" }>).glow)?.id;
    if (target) setReactionPoint({ key: panelKey, target, at: Date.now() });
  };
  useEffect(() => {
    if (!reactionPoint) return;
    const t = setTimeout(() => setReactionPoint(null), 3200);
    return () => clearTimeout(t);
  }, [reactionPoint]);

  /* ── render ───────────────────────────────────────────────────────────────────────────── */

  const carryFrom = useMemo(() => {
    const out: Record<string, Record<string, Rect>> = {};
    panels.forEach((p, i) => {
      out[p.key] = {};
      const prev = panels[i - 1];
      if (!prev || !p.spec.carry?.length) return;
      const here = placements[p.key];
      for (const id of p.spec.carry) {
        const src = layouts[i - 1].targets[id];
        if (!src) continue;
        const w = toWorld(src, placements[prev.key]);
        out[p.key][id] = { x: (w.x - here.x) / here.scale, y: (w.y - here.y) / here.scale, w: w.w / here.scale, h: w.h / here.scale };
      }
    });
    return out;
  }, [panels, layouts, placements]);

  const fontCss = BOARD_FONT_FACES.map((f) => `@font-face{font-family:"${BOARD_FONT_FAMILY}";src:url("${f.url}") format("truetype");font-weight:${f.weight};font-display:swap;}`).join("");
  const showOverviewBadges = mode === "overview" || (current?.spec.overview && finished);
  const rackFocus = mode === "follow" && currentIndex >= 0 && !showOverviewBadges && visitIndex < 0;

  return (
    <div
      ref={containerRef}
      className="relative h-full w-full select-none overflow-hidden bg-[#0b0f14]"
      style={{ touchAction: "none", cursor: drawing ? "crosshair" : mode === "follow" ? "default" : "grab", backgroundImage: "radial-gradient(circle at 2px 2px, #1f2a37 1.4px, transparent 1.8px)" }}
      onWheel={onWheel}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      aria-label="Lesson canvas"
    >
      <style>{fontCss + CANVAS_CSS + CHALK_CSS}</style>
      <svg ref={svgRef} className="absolute inset-0 h-full w-full" preserveAspectRatio="xMidYMid meet" style={{ fontFamily: BOARD_FONT_STACK }}>
        <defs>
          {shadowUrl && <image id="cv-shadow-img" href={shadowUrl} x={-SHADOW_PAD} y={-SHADOW_PAD + 10} width={PANEL_W + SHADOW_PAD * 2} height={PANEL_H + SHADOW_PAD * 2} preserveAspectRatio="none" />}
          {grainUrl && (
            <pattern id="cv-grain" width={220} height={220} patternUnits="userSpaceOnUse">
              <image href={grainUrl} width={220} height={220} />
            </pattern>
          )}
          {/* The chalkboard: room light across the slate, old eraser smudges, and the speckle that
              breaks chalk strokes up — all baked once (see chalkDust / chalkSpeckle). */}
          <radialGradient id="cv-slate-light" cx="45%" cy="30%" r="75%">
            <stop offset="0%" stopColor="#ffffff" stopOpacity={0.07} />
            <stop offset="100%" stopColor="#000000" stopOpacity={0.12} />
          </radialGradient>
          {dustUrl && (
            <pattern id="cv-dust" width={600} height={350} patternUnits="userSpaceOnUse">
              <image href={dustUrl} width={600} height={350} />
            </pattern>
          )}
          {speckleUrl && (
            <pattern id="cv-speckle" width={160} height={160} patternUnits="userSpaceOnUse">
              <image href={speckleUrl} width={160} height={160} />
            </pattern>
          )}
          <radialGradient id="cv-glow">
            <stop offset="0%" stopColor="#fbbf24" stopOpacity={0.85} />
            <stop offset="100%" stopColor="#fbbf24" stopOpacity={0} />
          </radialGradient>
        </defs>
        {panels.slice(0, shownIndex + 1).map((panel, i) => {
          const at = placements[panel.key];
          const live = i === shownIndex && currentIndex >= 0;
          return (
            <g
              key={panel.key}
              data-panel={panel.key}
              className={themes[i] === "chalk" ? "cv-chalk" : undefined}
              data-live={live ? "true" : undefined}
              transform={`translate(${at.x},${at.y}) scale(${at.scale})`}
            >
              <MemoPanel
                layout={layouts[i]}
                spec={specs[i]}
                theme={themes[i]}
                shownThrough={live && !finished ? sentence : Infinity}
                sentenceProgress={live ? sentenceProgress : 0}
                live={live}
                vars={vars[panel.key] ?? EMPTY}
                ghostVars={ghostVars[panel.key]}
                focusId={live ? focusId : reactionPoint?.key === panel.key ? reactionPoint.target : undefined}
                carryFrom={carryFrom[panel.key] ?? EMPTY_RECTS}
                reducedMotion={reducedMotion}
              />
              <Corrections layout={layouts[i]} check={corrections[panel.key]} />
              <Strokes strokes={strokes[panel.key] ?? []} live={live && drawing ? liveStroke : null} />
              {knowledge && (
                <KnowledgeMarks
                  layout={layouts[i]}
                  elements={boardConcepts.byBoard[i]?.elements}
                  concepts={knowledge.concepts}
                  boardIndex={i}
                  firstBoard={boardConcepts.firstBoard}
                  shownThrough={live && !finished ? sentence : Infinity}
                  onOpenEarlier={onOpenEarlier}
                />
              )}
              {live && penCue && <Pen cue={penCue} layout={layouts[i]} vars={vars[panel.key] ?? EMPTY} />}
              {!live && reactionPoint?.key === panel.key && <Pen cue={{ s: 0, action: "point", target: reactionPoint.target }} layout={layouts[i]} vars={vars[panel.key] ?? EMPTY} />}
              {(live ? exploring : mode !== "follow") && (
                <Hotspots
                  layout={layouts[i]}
                  spec={panel.spec}
                  onTap={(part) => {
                    setReactionPoint({ key: panel.key, target: part.id, at: Date.now() });
                    onSpeak(part.say);
                    onTellAria(`The student tapped "${part.name}" on the picture of board "${panel.spec.heading}". You told them: "${part.say}"`);
                  }}
                />
              )}
              {/* RACK FOCUS: while the camera is with Aria, every other board steps back — under a veil
                  of the background colour, which looks the same as fading the board but is one
                  rectangle to draw, where an opacity on the whole board was a second full render of it. */}
              <rect x={-2} y={-2} width={PANEL_W + 4} height={PANEL_H + 4} rx={23} fill="#0b0f14" pointerEvents="none" style={{ opacity: rackFocus && !live && visitIndex !== i ? 0.62 : 0, transition: "opacity 700ms ease" }} />
              {visitIndex === i && <rect x={-14} y={-14} width={PANEL_W + 28} height={PANEL_H + 28} rx={32} fill="none" stroke="#f59e0b" strokeWidth={6} opacity={0.85} className="cv-live" />}
              {showOverviewBadges && !panel.spec.inside && (
                <g transform="translate(-26,-26)">
                  <circle r={40} fill="#f59e0b" stroke="#0b0f14" strokeWidth={6} />
                  <text y={14} textAnchor="middle" fontSize={40} fontWeight={800} fill="#0b0f14">
                    {i + 1}
                  </text>
                </g>
              )}
            </g>
          );
        })}
      </svg>
      {celebration > 0 && <Confetti key={celebration} seed={celebration} />}

      {/* Camera controls: see the whole lesson, or go back to following Aria. */}
      <div className="absolute right-3 top-3 z-10 flex gap-2" onPointerDown={(e) => e.stopPropagation()}>
        <button
          onClick={() => {
            const next = !soundOn;
            setSoundEnabled(next);
            setSoundOn(next);
            if (next) playTick();
          }}
          aria-pressed={soundOn}
          title={soundOn ? "Board sounds on" : "Board sounds off"}
          className="flex items-center gap-1.5 rounded-full border border-white/15 bg-black/60 px-2.5 py-1.5 text-xs font-bold text-white/85 backdrop-blur hover:bg-black/80"
        >
          {soundOn ? <Volume2 size={13} /> : <VolumeX size={13} />}
          <span className="sr-only">{soundOn ? "Turn board sounds off" : "Turn board sounds on"}</span>
        </button>
        {mode !== "follow" && (
          <button onClick={() => setMode("follow")} className="flex items-center gap-1.5 rounded-full border border-white/15 bg-black/60 px-3 py-1.5 text-xs font-bold text-white/85 backdrop-blur hover:bg-black/80">
            <Crosshair size={13} /> Follow Aria
          </button>
        )}
        {mode !== "overview" && (
          <button onClick={() => setMode("overview")} className="flex items-center gap-1.5 rounded-full border border-white/15 bg-black/60 px-3 py-1.5 text-xs font-bold text-white/85 backdrop-blur hover:bg-black/80">
            <Compass size={13} /> Whole lesson
          </button>
        )}
      </div>
      {mode === "overview" && (
        <p className="pointer-events-none absolute bottom-3 left-1/2 z-10 -translate-x-1/2 rounded-full bg-black/60 px-3 py-1.5 text-xs font-semibold text-white/75 backdrop-blur">
          Click any board to fly to it · drag to move · scroll to zoom
        </p>
      )}

      {taskOpen && interaction?.kind === "try" && current && (
        <TryItCard
          task={interaction}
          values={vars[current.key] ?? {}}
          onChange={(v) => setVars((prev) => ({ ...prev, [current.key]: { ...(prev[current.key] ?? {}), ...v } }))}
          onGrab={() => setGhostVars((prev) => ({ ...prev, [current.key]: { ...(vars[current.key] ?? {}) } }))}
          onRelease={(v) => react(current.key, interaction, { ...(vars[current.key] ?? {}), ...v })}
          onContinue={() => {
            const values = vars[current.key] ?? {};
            onTellAria(`The student finished trying the sliders (${interaction.controls.map((c) => `${c.label} = ${values[c.var]}`).join(", ")}) and continued the lesson.`);
            onContinue();
          }}
        />
      )}
      {taskOpen && interaction?.kind === "quiz" && current && (
        <QuizCard
          key={current.key}
          question={interaction.question}
          options={interaction.options}
          hint={quizHint}
          onAnswer={(i) => {
            const o = interaction.options[i];
            if (!reported.current.has(`quiz:${current.key}`)) {
              reported.current.add(`quiz:${current.key}`);
              onTaskResult?.("quiz", o.correct, interaction.options.length);
            }
            if (o.correct) setCelebration(Date.now());
            onSpeak(o.feedback);
            onTellAria(`Asked "${interaction.question}", the student chose "${o.text}" (${o.correct ? "correct" : "not correct"}). You told them: "${o.feedback}"`);
          }}
          onContinue={onContinue}
        />
      )}
      {exploring && !taskOpen && current?.spec.stage.kind === "illustration" && current.spec.stage.parts.some((p) => p.say) && (
        <p className="pointer-events-none absolute left-1/2 top-3 z-10 -translate-x-1/2 rounded-full bg-black/65 px-3 py-1.5 text-xs font-semibold text-white/85 backdrop-blur">
          Tap the glowing parts of the picture to explore them
        </p>
      )}
      <MiniMap
        themes={themes}
        panels={panels}
        worldRects={worldRects}
        shownIndex={shownIndex}
        visitIndex={visitIndex}
        onPick={(i) => {
          setMode("free");
          flyTo(fitView(worldRects[i], aspect, 0.035));
        }}
      />
      {taskOpen && interaction?.kind === "draw" && current && (
        <DrawCard
          prompt={interaction.prompt}
          hasInk={(strokes[current.key]?.length ?? 0) > 0}
          checking={checking}
          check={corrections[current.key]}
          onClear={() => {
            setStrokes((prev) => ({ ...prev, [current.key]: [] }));
            setCorrections((prev) => {
              const next = { ...prev };
              delete next[current.key];
              return next;
            });
          }}
          onCheck={checkDrawing}
          onContinue={onContinue}
        />
      )}
    </div>
  );
}

const EMPTY: Record<string, number> = {};
const EMPTY_RECTS: Record<string, Rect> = {};
const MemoPanel = memo(CanvasPanel);

function initialVars(panels: CanvasPanelInput[]): Record<string, Record<string, number>> {
  const out: Record<string, Record<string, number>> = {};
  for (const p of panels) {
    if (p.spec.interaction?.kind === "try") out[p.key] = Object.fromEntries(p.spec.interaction.controls.map((c) => [c.var, c.value]));
  }
  return out;
}

/* ── Aria's pen ───────────────────────────────────────────────────────────────────────────── */

function Pen({ cue, layout, vars }: { cue: CanvasCue; layout: PanelLayout; vars: Record<string, number> }) {
  const rect = cue.target ? layout.targets[cue.target] : undefined;
  const marker = cue.target ? markerPoint(layout, cue.target, vars) : null;
  if (!rect && !marker) return null;
  const r = marker ? { x: marker.x - 16, y: marker.y - 16, w: 32, h: 32 } : rect!;
  const cx = r.x + r.w / 2;
  const cy = r.y + r.h / 2;
  // The pen rests just OFF the element's lower-right, pointing in, so it never covers what it shows.
  const tip: Pt =
    cue.action === "circle" ? { x: cx + (r.w / 2 + 16) * 0.72, y: cy + (r.h / 2 + 14) * 0.72 }
    : cue.action === "underline" ? { x: r.x + r.w + 8, y: r.y + r.h * 0.62 }
    : { x: r.x + r.w * 0.82, y: r.y + r.h * 0.86 };
  const key = `${cue.s}-${cue.action}-${cue.target}`;
  return (
    <g pointerEvents="none">
      {cue.action === "circle" && (
        // A hand-drawn ring, gone round twice, the way a teacher circles something on a board.
        <path key={`c${key}`} d={roughEllipse(`ring-${key}`, cx, cy, r.w / 2 + 16, r.h / 2 + 14)} fill="none" stroke={ARIA} strokeWidth={3.6} strokeLinecap="round" className="cv-ring" pathLength={1} opacity={0.92} />
      )}
      {cue.action === "underline" && (() => {
        // THE HIGHLIGHTER SWIPE (Vox): a translucent marker band across each line of the words,
        // multiply-blended so the text stays crisp, landing with the pen and the element's own glow.
        // A note's box includes its bullet, so the band starts after it.
        const lines = Math.max(1, Math.min(3, Math.round(r.h / 30)));
        const lineH = r.h / lines;
        const x0 = r.x + (cue.target && layout.marks.find((m) => m.id === cue.target)?.type === "note" ? 24 : 0);
        return Array.from({ length: lines }, (_, k) => {
          const y = r.y + lineH * (k + 0.6);
          return (
            <path
              key={`u${key}-${k}`}
              d={`M${x0} ${y} Q ${(x0 + r.x + r.w) / 2} ${y - 2} ${r.x + r.w} ${y + 1}`}
              fill="none"
              stroke={ARIA}
              strokeOpacity={0.3}
              strokeWidth={Math.min(24, lineH * 0.62)}
              strokeLinecap="round"
              className="cv-swipe"
              pathLength={1}
              style={{ mixBlendMode: "multiply", animationDelay: `${k * 220}ms` }}
            />
          );
        });
      })()}
      {cue.action === "point" && <circle key={`p${key}`} cx={tip.x} cy={tip.y} r={14} fill="none" stroke={ARIA} strokeWidth={3} className="cv-tap" />}
      <g style={{ transform: `translate(${tip.x}px, ${tip.y}px)`, transition: "transform 650ms cubic-bezier(.65,0,.25,1)" }}>
        <circle r={26} fill={ARIA} opacity={0.14} />
        <g transform="rotate(140)">
          <path d="M0 0 L -6 -14 L -6 -52 L 6 -52 L 6 -14 Z" fill="#fff" stroke={ARIA} strokeWidth={2.5} strokeLinejoin="round" />
          <path d="M0 0 L -6 -14 L 6 -14 Z" fill={ARIA} />
          <rect x={-6} y={-60} width={12} height={9} rx={2} fill={ARIA} />
        </g>
        <circle r={4.5} fill={ARIA} />
      </g>
    </g>
  );
}

/* ── the student's ink and Aria's corrections ─────────────────────────────────────────────── */

function Strokes({ strokes, live }: { strokes: Pt[][]; live: Pt[] | null }) {
  const all = live ? [...strokes, live] : strokes;
  return (
    <g pointerEvents="none">
      {all.map((s, i) => (
        <polyline key={i} points={s.map((p) => `${p.x},${p.y}`).join(" ")} fill="none" stroke={STUDENT} strokeWidth={5} strokeLinecap="round" strokeLinejoin="round" opacity={0.9} />
      ))}
    </g>
  );
}

function Corrections({ layout, check }: { layout: PanelLayout; check?: DrawingCheck }) {
  if (!check) return null;
  const centre = (id: string) => {
    const t = layout.targets[id];
    return t ? { x: t.x + t.w / 2, y: t.y + t.h / 2, r: Math.min(t.w, t.h) / 2 } : null;
  };
  return (
    <g className="cv-live" pointerEvents="none">
      {check.marks.map((m, i) => {
        if (m.kind === "circle") {
          const t = layout.targets[m.target];
          if (!t) return null;
          return (
            <g key={i}>
              <path d={roughEllipse(`fix-${i}-${m.target}`, t.x + t.w / 2, t.y + t.h / 2, t.w / 2 + 18, t.h / 2 + 16)} fill="none" stroke={ARIA} strokeWidth={3.6} strokeLinecap="round" className="cv-ring" pathLength={1} style={{ animationDelay: `${i * 450}ms` }} />
              {m.label && <text x={t.x + t.w / 2} y={t.y - 24} textAnchor="middle" fontSize={17} fontWeight={800} fill={ARIA}>{m.label}</text>}
            </g>
          );
        }
        const a = centre(m.from);
        const b = centre(m.to);
        if (!a || !b) return null;
        const d = Math.hypot(b.x - a.x, b.y - a.y) || 1;
        const ux = (b.x - a.x) / d;
        const uy = (b.y - a.y) / d;
        const p0 = { x: a.x + ux * (a.r + 8), y: a.y + uy * (a.r + 8) };
        const p1 = { x: b.x - ux * (b.r + 12), y: b.y - uy * (b.r + 12) };
        const c = { x: (p0.x + p1.x) / 2 - uy * 30, y: (p0.y + p1.y) / 2 + ux * 30 };
        const hx = p1.x - c.x;
        const hy = p1.y - c.y;
        const hd = Math.hypot(hx, hy) || 1;
        const [vx, vy] = [hx / hd, hy / hd];
        return (
          // Aria's correction in her own ink: a pen stroke drawn on, then its arrowhead.
          <g key={i}>
            <Ink points={quadPoints(p0, c, p1, 20)} width={5.4} color={ARIA} />
            <path d={`M${p1.x} ${p1.y} L${p1.x - vx * 16 - vy * 9} ${p1.y - vy * 16 + vx * 9} L${p1.x - vx * 16 + vy * 9} ${p1.y - vy * 16 - vx * 9} Z`} fill={ARIA} className="cv-in cv-late" />
            {m.label && <text x={c.x} y={c.y - 10} textAnchor="middle" fontSize={16} fontWeight={800} fill={ARIA}>{m.label}</text>}
          </g>
        );
      })}
    </g>
  );
}

/**
 * What the checker sees: the board as named boxes (and its picture), the student's ink in red. A
 * schematic rather than a screenshot, because it names every element — which is what lets the
 * checker answer with element ids instead of guessed coordinates.
 */
async function schematic(layout: PanelLayout, strokes: Pt[][]): Promise<{ image: string; elements: Array<{ id: string; label: string; x: number; y: number; w: number; h: number }> }> {
  const canvas = document.createElement("canvas");
  canvas.width = PANEL_W;
  canvas.height = PANEL_H;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, PANEL_W, PANEL_H);
  const picture = layout.marks.find((m) => m.type === "picture") as Extract<Mark, { type: "picture" }> | undefined;
  if (picture?.src) {
    await new Promise<void>((resolve) => {
      const img = new Image();
      img.onload = () => {
        ctx.globalAlpha = 0.55;
        ctx.drawImage(img, picture.rect.x, picture.rect.y, picture.rect.w, picture.rect.h);
        ctx.globalAlpha = 1;
        resolve();
      };
      img.onerror = () => resolve();
      img.src = picture.src!;
    });
  }
  const elements: Array<{ id: string; label: string; x: number; y: number; w: number; h: number }> = [];
  const labelOf = (m: Mark): string | null => {
    switch (m.type) {
      case "node": return m.label;
      case "item": return m.text.replace(/\n/g, " ");
      case "part": return m.name;
      case "box": return m.label ?? m.id;
      case "text": return m.text;
      case "column": return m.title;
      default: return null;
    }
  };
  ctx.font = "600 15px sans-serif";
  for (const m of layout.marks) {
    const label = labelOf(m);
    const t = layout.targets[m.id];
    if (!label || !t) continue;
    elements.push({ id: m.id, label, x: t.x, y: t.y, w: t.w, h: t.h });
    if (m.type === "column") continue;
    ctx.strokeStyle = "#9ca3af";
    ctx.lineWidth = 2;
    ctx.strokeRect(t.x, t.y, t.w, t.h);
    ctx.fillStyle = "#374151";
    ctx.fillText(label, t.x + 4, t.y + 16);
  }
  const eq = layout.marks.find((m) => m.type === "equation") as Extract<Mark, { type: "equation" }> | undefined;
  if (eq) {
    for (const tok of eq.tokens) {
      const t = layout.targets[tok.id];
      if (!t) continue;
      elements.push({ id: tok.id, label: tok.text, x: t.x, y: t.y, w: t.w, h: t.h });
      ctx.fillStyle = "#374151";
      ctx.fillText(tok.text, t.x + 4, t.y + t.h - 6);
    }
  }
  ctx.strokeStyle = "#ef4444";
  ctx.lineWidth = 6;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (const s of strokes) {
    ctx.beginPath();
    s.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    ctx.stroke();
  }
  return { image: canvas.toDataURL("image/jpeg", 0.85), elements };
}

/* ── the task cards ───────────────────────────────────────────────────────────────────────── */

function TryItCard({ task, values, onChange, onGrab, onRelease, onContinue }: { task: TryItInteraction; values: Record<string, number>; onChange: (v: Record<string, number>) => void; onGrab: () => void; onRelease: (v: Record<string, number>) => void; onContinue: () => void }) {
  return (
    <div className="absolute right-4 top-1/2 z-20 w-[min(340px,calc(100%-2rem))] -translate-y-1/2 rounded-2xl border border-amber-300/25 bg-[#11100f]/92 p-4 text-white shadow-2xl backdrop-blur" onPointerDown={(e) => e.stopPropagation()} onWheel={(e) => e.stopPropagation()}>
      <p className="flex items-center gap-1.5 text-[0.68rem] font-black uppercase tracking-[0.18em] text-amber-300/90">
        <Sparkles size={12} /> Try it yourself
      </p>
      <p className="mt-1.5 text-sm font-semibold leading-snug text-white/90">{task.prompt}</p>
      {task.controls.map((c) => {
        const v = values[c.var] ?? c.value;
        return (
          <label key={c.var} className="mt-3 block">
            <span className="flex justify-between text-xs font-bold text-white/70">
              <span>{c.label}</span>
              <span className="tabular-nums text-amber-200">
                {Math.round(v * 100) / 100}
                {c.unit ? ` ${c.unit}` : ""}
              </span>
            </span>
            <input
              type="range"
              min={c.min}
              max={c.max}
              step={c.step ?? (c.max - c.min) / 100}
              value={v}
              onChange={(e) => onChange({ [c.var]: Number(e.target.value) })}
              onPointerDown={onGrab}
              onKeyDown={(e) => { if (!e.repeat) onGrab(); }}
              onPointerUp={(e) => onRelease({ [c.var]: Number((e.target as HTMLInputElement).value) })}
              onKeyUp={(e) => onRelease({ [c.var]: Number((e.target as HTMLInputElement).value) })}
              className="mt-1.5 w-full accent-amber-400"
            />
          </label>
        );
      })}
      {(task.readouts ?? []).map((r) => (
        <p key={r.label} className="mt-2 flex justify-between rounded-lg bg-white/[0.06] px-2.5 py-1.5 text-xs font-bold text-white/75">
          <span>{r.label}</span>
          <span className="tabular-nums text-white">
            <SpringNumber value={Math.round(evalExpr(r.expr, values, 0) * 10) / 10} />
            {r.unit ? ` ${r.unit}` : ""}
          </span>
        </p>
      ))}
      <button onClick={onContinue} className="mt-3.5 flex w-full items-center justify-center gap-1.5 rounded-xl bg-amber-400 px-3 py-2 text-sm font-black text-black hover:bg-amber-300">
        <Play size={14} /> Continue the lesson
      </button>
    </div>
  );
}

function DrawCard({ prompt, hasInk, checking, check, onClear, onCheck, onContinue }: { prompt: string; hasInk: boolean; checking: boolean; check?: DrawingCheck; onClear: () => void; onCheck: () => void; onContinue: () => void }) {
  return (
    <div className="absolute right-4 top-1/2 z-20 w-[min(340px,calc(100%-2rem))] -translate-y-1/2 rounded-2xl border border-sky-300/25 bg-[#0e1116]/92 p-4 text-white shadow-2xl backdrop-blur" onPointerDown={(e) => e.stopPropagation()} onWheel={(e) => e.stopPropagation()}>
      <p className="flex items-center gap-1.5 text-[0.68rem] font-black uppercase tracking-[0.18em] text-sky-300/90">
        <PenLine size={12} /> Your turn to draw
      </p>
      <p className="mt-1.5 text-sm font-semibold leading-snug text-white/90">{prompt}</p>
      {!hasInk && !check && <p className="mt-2 text-xs text-white/50">Draw straight on the board with your mouse, finger or pen.</p>}
      {check && (
        <p className={`mt-2.5 rounded-lg px-2.5 py-2 text-xs font-semibold leading-relaxed ${check.correct ? "bg-emerald-400/15 text-emerald-100" : "bg-rose-400/15 text-rose-100"}`}>
          {check.feedback}
        </p>
      )}
      <div className="mt-3.5 flex gap-2">
        <button onClick={onClear} disabled={!hasInk || checking} className="flex items-center gap-1 rounded-xl border border-white/15 px-3 py-2 text-xs font-bold text-white/75 hover:bg-white/10 disabled:opacity-40">
          <Eraser size={13} /> Clear
        </button>
        <button onClick={onCheck} disabled={!hasInk || checking} className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-sky-400 px-3 py-2 text-sm font-black text-black hover:bg-sky-300 disabled:opacity-40">
          {checking ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />} {checking ? "Aria is looking…" : "Check my drawing"}
        </button>
      </div>
      <button onClick={onContinue} className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-xl border border-white/15 px-3 py-2 text-xs font-bold text-white/80 hover:bg-white/10">
        <Play size={13} /> {check ? "Continue the lesson" : "Skip and continue"}
      </button>
    </div>
  );
}

/* ── exploring: picture hotspots, the quiz, the mini-map ─────────────────────────────────── */

function Hotspots({ layout, spec, onTap }: { layout: PanelLayout; spec: CanvasBoardSpec; onTap: (part: { id: string; name: string; say: string }) => void }) {
  if (spec.stage.kind !== "illustration") return null;
  const parts = spec.stage.parts.filter((p) => p.say);
  return (
    <g>
      {parts.map((p, i) => {
        const mark = layout.marks.find((m) => m.type === "part" && m.id === p.id) as Extract<Mark, { type: "part" }> | undefined;
        if (!mark) return null;
        return (
          <g
            key={p.id}
            role="button"
            aria-label={`Explore ${p.name}`}
            style={{ cursor: "pointer" }}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              onTap({ id: p.id, name: p.name, say: p.say! });
            }}
          >
            <circle cx={mark.cx} cy={mark.cy} r={22} fill="#fff" opacity={0.001} />
            <circle cx={mark.cx} cy={mark.cy} r={12} fill="none" stroke="#f59e0b" strokeWidth={3} className="cv-hotspot" style={{ animationDelay: `${i * 180}ms` }} />
            <circle cx={mark.cx} cy={mark.cy} r={6} fill="#f59e0b" stroke="#fff" strokeWidth={2} />
          </g>
        );
      })}
    </g>
  );
}

function QuizCard({ question, options, onAnswer, onContinue, hint }: { question: string; options: Array<{ text: string; correct: boolean; feedback: string }>; onAnswer: (i: number) => void; onContinue: () => void; hint?: string }) {
  const [picked, setPicked] = useState<number[]>([]);
  const last = picked[picked.length - 1];
  const solved = picked.some((i) => options[i].correct);
  return (
    <div className="absolute right-4 top-1/2 z-20 w-[min(340px,calc(100%-2rem))] -translate-y-1/2 rounded-2xl border border-violet-300/25 bg-[#100e16]/92 p-4 text-white shadow-2xl backdrop-blur" onPointerDown={(e) => e.stopPropagation()} onWheel={(e) => e.stopPropagation()}>
      <p className="flex items-center gap-1.5 text-[0.68rem] font-black uppercase tracking-[0.18em] text-violet-300/90">
        <Sparkles size={12} /> Predict it
      </p>
      <p className="mt-1.5 text-sm font-semibold leading-snug text-white/90">{question}</p>
      <div className="mt-3 space-y-2">
        {options.map((o, i) => {
          const chosen = picked.includes(i);
          return (
            <button
              key={i}
              disabled={solved}
              onClick={() => {
                setPicked((p) => (p.includes(i) ? p : [...p, i]));
                onAnswer(i);
              }}
              className={`w-full rounded-xl border px-3 py-2 text-left text-sm font-semibold transition ${
                chosen ? (o.correct ? "border-emerald-300/60 bg-emerald-400/15 text-emerald-50" : "border-rose-300/50 bg-rose-400/10 text-rose-100/80 line-through decoration-rose-300/60") : "border-white/12 bg-white/[0.04] text-white/85 hover:border-violet-300/50 hover:bg-white/[0.08]"
              } disabled:cursor-default`}
            >
              {o.text}
            </button>
          );
        })}
      </div>
      {last !== undefined && (
        <p className={`mt-2.5 rounded-lg px-2.5 py-2 text-xs font-semibold leading-relaxed ${options[last].correct ? "bg-emerald-400/15 text-emerald-100" : "bg-rose-400/15 text-rose-100"}`}>{options[last].feedback}</p>
      )}
      {/* A wrong prediction often comes from a gap underneath it: the knowledge graph names it. */}
      {last !== undefined && !options[last].correct && hint && (
        <p className="mt-2 rounded-lg border border-amber-300/25 bg-amber-300/10 px-2.5 py-1.5 text-[11px] font-semibold leading-relaxed text-amber-100">{hint}</p>
      )}
      <button onClick={onContinue} disabled={!picked.length} className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-xl bg-violet-400 px-3 py-2 text-sm font-black text-black hover:bg-violet-300 disabled:opacity-40">
        <Play size={14} /> {solved ? "Continue the lesson" : picked.length ? "Continue anyway" : "Choose an answer"}
      </button>
    </div>
  );
}

/** The whole lesson in the corner: every board so far, where Aria is, and a click to fly anywhere. */
/**
 * THE KNOWLEDGE GRAPH, ON THE BOARD. Beside each drawn element that stands for a concept: a small
 * check when the student already knew it before this lecture, "new" the first time a concept they
 * have never met appears, and "from <lecture>" when they learned it in an earlier lecture — tap it
 * to see that board again. Each mark appears with its element, never before.
 */
function KnowledgeMarks({ layout, elements, concepts, boardIndex, firstBoard, shownThrough, onOpenEarlier }: {
  layout: PanelLayout;
  elements?: Record<string, string>;
  concepts: CanvasKnowledge["concepts"];
  boardIndex: number;
  firstBoard: Record<string, number>;
  shownThrough: number;
  onOpenEarlier?: (from: EarlierBoard) => void;
}) {
  if (!elements) return null;
  const marked = new Set<string>();
  let newTags = 0;
  return (
    <g>
      {Object.entries(elements).map(([elementId, key]) => {
        const c = concepts[key];
        let mark = layout.marks.find((m) => m.id === elementId) ?? layout.marks.find((m) => m.type === "equation" && m.tokens.some((tk) => tk.id === elementId));
        let t: Rect | undefined = layout.targets[elementId];
        // A part of a picture is a point; its mark goes on its written label, and an unlabelled
        // part is not marked at all (a tag floating on a picture says nothing).
        if (mark?.type === "part") {
          const label = layout.marks.find((m) => m.type === "callout" && m.partId === elementId);
          if (!label || label.type !== "callout") return null;
          mark = label;
          t = label.box;
        }
        if (!c || !t || !mark || mark.s > shownThrough || marked.has(key)) return null;
        // Two "new" tags a board at most: more is clutter, not information.
        if (c.status === "new" && (firstBoard[key] !== boardIndex || newTags >= 2)) return null;
        if (c.status === "new") newTags += 1;
        marked.add(key);
        const x = t.x + t.w - 4;
        const y = t.y + 4;
        if (c.status === "known") {
          const chip = c.from && onOpenEarlier && firstBoard[key] === boardIndex;
          return (
            <g key={elementId} className="cv-in">
              <circle cx={x} cy={y} r={12} fill="#16a34a" stroke="#fff" strokeWidth={2.5} />
              <path d={`M${x - 5} ${y} l3.5 3.5 l6.5 -7`} fill="none" stroke="#fff" strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round" />
              <title>{`You already know ${c.label}`}</title>
              {chip && <EarlierChip x={t.x + t.w / 2} y={t.y + t.h + 14} from={c.from!} onOpen={onOpenEarlier!} />}
            </g>
          );
        }
        if (c.status === "shaky" && c.from && onOpenEarlier && firstBoard[key] === boardIndex) {
          return (
            <g key={elementId} className="cv-in">
              <EarlierChip x={t.x + t.w / 2} y={t.y + t.h + 14} from={c.from} onOpen={onOpenEarlier} />
            </g>
          );
        }
        if (c.status === "new" && firstBoard[key] === boardIndex) {
          return (
            <g key={elementId} className="cv-in" pointerEvents="none">
              <rect x={x - 22} y={y - 11} width={44} height={22} rx={11} fill="#f59e0b" />
              <text x={x} y={y + 5} textAnchor="middle" fontSize={12.5} fontWeight={800} fill="#1c1206">NEW</text>
              <title>{`New to you: ${c.label}`}</title>
            </g>
          );
        }
        return null;
      })}
    </g>
  );
}

/** "↩ from <lecture>": the board where the student learned this, one tap away. */
function EarlierChip({ x, y, from, onOpen }: { x: number; y: number; from: EarlierBoard; onOpen: (from: EarlierBoard) => void }) {
  const text = `↩ from ${from.topic.length > 26 ? `${from.topic.slice(0, 25)}…` : from.topic}`;
  const w = Math.max(90, text.length * 7.4 + 22);
  return (
    <g
      role="button"
      tabIndex={0}
      aria-label={`See where you learned this, in ${from.topic}`}
      style={{ cursor: "pointer" }}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        onOpen(from);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") onOpen(from);
      }}
    >
      <rect x={x - w / 2} y={y - 12} width={w} height={24} rx={12} fill="#1e293b" opacity={0.92} />
      <text x={x} y={y + 4.5} textAnchor="middle" fontSize={12.5} fontWeight={700} fill="#e2e8f0">{text}</text>
    </g>
  );
}

function MiniMap({ panels, themes, worldRects, shownIndex, visitIndex, onPick }: { panels: CanvasPanelInput[]; themes: BoardTheme[]; worldRects: Rect[]; shownIndex: number; visitIndex: number; onPick: (i: number) => void }) {
  const top = panels.map((p, i) => ({ p, i })).filter(({ p }) => !p.spec.inside);
  if (top.length < 2) return null;
  const all = unionRects(top.map(({ i }) => worldRects[i]));
  const W = 132;
  const H = Math.max(60, Math.min(120, (W * all.h) / all.w));
  const k = Math.min((W - 12) / all.w, (H - 12) / all.h);
  return (
    <div className="absolute bottom-3 left-3 z-10 rounded-xl border border-white/10 bg-black/45 p-1 opacity-80 backdrop-blur transition-opacity hover:opacity-100" onPointerDown={(e) => e.stopPropagation()} onWheel={(e) => e.stopPropagation()}>
      <svg width={W} height={H} aria-label="Lesson map">
        {top.map(({ p, i }) => {
          const r = worldRects[i];
          const shown = i <= shownIndex;
          const here = i === shownIndex || (panels[shownIndex]?.spec.inside && panels.findIndex((q) => q.key === panels[shownIndex].spec.inside!.beat) === i);
          return (
            <g key={p.key} style={{ cursor: shown ? "pointer" : "default" }} onClick={() => shown && onPick(i)}>
              <rect x={6 + (r.x - all.x) * k} y={6 + (r.y - all.y) * k} width={r.w * k} height={r.h * k} rx={3} fill={shown ? (themes[i] === "chalk" ? CHALK.card : "#fbfaf6") : "#1f2937"} opacity={shown ? 0.9 : 0.5} stroke={here ? "#f59e0b" : visitIndex === i ? "#fbbf24" : "transparent"} strokeWidth={2.5} />
              {shown && (
                <text x={6 + (r.x - all.x + r.w / 2) * k} y={6 + (r.y - all.y + r.h / 2) * k + 4} textAnchor="middle" fontSize={11} fontWeight={800} fill={themes[i] === "chalk" ? CHALK.chalk : "#1f2937"}>
                  {i + 1}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

/** Fine, warm paper grain as a small tiling image — generated once on the client. */
function paperGrain(): string | null {
  try {
    // Noise drawn at half size and smoothed up: a per-pixel speckle shimmered as the camera scaled it.
    const size = 220;
    const small = document.createElement("canvas");
    small.width = size / 2;
    small.height = size / 2;
    const sctx = small.getContext("2d");
    if (!sctx) return null;
    const img = sctx.createImageData(size / 2, size / 2);
    for (let i = 0; i < img.data.length; i += 4) {
      const v = 120 + Math.random() * 60;
      img.data[i] = v;
      img.data[i + 1] = v * 0.97;
      img.data[i + 2] = v * 0.9;
      img.data[i + 3] = 4 + Math.random() * 10;
    }
    sctx.putImageData(img, 0, 0);
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(small, 0, 0, size, size);
    return canvas.toDataURL("image/png");
  } catch {
    return null;
  }
}

const SHADOW_PAD = 40;

/** A board's soft drop shadow, blurred once into a small picture and stretched under every board. */
function paperShadow(): string | null {
  try {
    const k = 0.25;
    const w = Math.round((PANEL_W + SHADOW_PAD * 2) * k);
    const h = Math.round((PANEL_H + SHADOW_PAD * 2) * k);
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.filter = `blur(${14 * k}px)`;
    ctx.fillStyle = "rgba(0,0,0,0.42)";
    ctx.beginPath();
    ctx.roundRect(SHADOW_PAD * k, SHADOW_PAD * k, PANEL_W * k, PANEL_H * k, 24 * k);
    ctx.fill();
    return canvas.toDataURL("image/png");
  } catch {
    return null;
  }
}

const CHALK_CSS = chalkCss();
const THEME_KEY = "aria.canvas.theme";
/** A classroom: the working on the chalkboard, pictures pinned up on paper. */
const DEFAULT_THEME: CanvasThemeChoice = "mix";
const THEME_SWATCH: Record<CanvasThemeChoice, string> = {
  paper: "#fbfaf6",
  chalk: CHALK.slate,
  mix: `linear-gradient(135deg, #fbfaf6 50%, ${CHALK.slate} 50%)`,
};

/** A choice this browser stored, else the app's material: chalk on a dark app, paper on a light one. */
function storedTheme(): CanvasThemeChoice {
  const fromApp = (): CanvasThemeChoice => (document.documentElement.dataset.theme === "dark" ? "chalk" : "paper");
  try {
    const v = localStorage.getItem(THEME_KEY);
    return (CANVAS_THEMES as readonly string[]).includes(v ?? "") ? (v as CanvasThemeChoice) : fromApp();
  } catch {
    return fromApp();
  }
}


/** Old eraser smudges on a chalkboard: soft, wide, barely-there swirls of white. */
function chalkDust(): string | null {
  try {
    const w = 300;
    const h = 175;
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.filter = "blur(6px)";
    for (let i = 0; i < 7; i++) {
      const x = Math.random() * w;
      const y = Math.random() * h;
      const r = 30 + Math.random() * 60;
      const from = Math.random() * Math.PI;
      const to = from + Math.PI * (0.6 + Math.random() * 0.8);
      ctx.strokeStyle = `rgba(255,255,255,${0.025 + Math.random() * 0.035})`;
      ctx.lineWidth = 14 + Math.random() * 18;
      // Drawn again one tile over in every direction, so the pattern repeats without a seam.
      for (const dx of [-w, 0, w]) {
        for (const dy of [-h, 0, h]) {
          ctx.beginPath();
          ctx.arc(x + dx, y + dy, r, from, to);
          ctx.stroke();
        }
      }
    }
    return canvas.toDataURL("image/png");
  } catch {
    return null;
  }
}

/** Tiny flecks of the slate's colour, laid over chalk writing so each stroke skips like chalk. */
function chalkSpeckle(): string | null {
  try {
    const size = 160;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    for (let i = 0; i < 900; i++) {
      ctx.fillStyle = `rgba(34,48,42,${0.25 + Math.random() * 0.45})`;
      const r = 0.4 + Math.random() * 1.1;
      ctx.beginPath();
      ctx.arc(Math.random() * size, Math.random() * size, r, 0, Math.PI * 2);
      ctx.fill();
    }
    return canvas.toDataURL("image/png");
  } catch {
    return null;
  }
}

/** The background dot grid's spacing, in world units. */
const DOT_CELL = 48;

/** A number that springs to its new value (a short ease-out-back count) instead of jumping. */
function SpringNumber({ value }: { value: number }) {
  const [shown, setShown] = useState(value);
  const from = useRef(value);
  useEffect(() => {
    const start = performance.now();
    const a = from.current;
    let raf = 0;
    const ease = (t: number) => 1 + 2.2 * Math.pow(t - 1, 3) + 1.2 * Math.pow(t - 1, 2);
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / 380);
      const v = a + (value - a) * ease(t);
      setShown(Math.round(v * 10) / 10);
      if (t < 1) raf = requestAnimationFrame(step);
      else from.current = value;
    };
    raf = requestAnimationFrame(step);
    return () => {
      cancelAnimationFrame(raf);
      from.current = value;
    };
  }, [value]);
  return <>{shown}</>;
}

export type { PanelPlacement };

"use client";

import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Compass, Crosshair, Eraser, Loader2, PenLine, Play, Sparkles, Volume2, VolumeX, X } from "lucide-react";
import { directFocus, directInk, fitView, flightMs, unionRects, viewAt, type Shot, type View } from "@/lib/canvas/camera";
import { evalExpr } from "@/lib/canvas/expr";
import { layoutPanel, placePanels, toWorld, type Mark, type PanelLayout, type PanelPlacement, type Pt, type Rect } from "@/lib/canvas/layout";
import { isLabLookTopic } from "@/lib/canvas/subjectLook";
import { MarkerWriter, type HeardSentence } from "./MarkerWriter";
import { isCourseBoard } from "@/lib/canvas/lessonSubject";
import { TextDeconflict } from "./TextDeconflict";
import { PANEL_H, PANEL_W, type CanvasBoardSpec, type CanvasCue, type QuizInteraction, type TryItInteraction } from "@/lib/canvas/types";
import { activeCues, targetVisible } from "@/lib/canvas/cues";
import { setPointTarget } from "@/lib/avatar/pointTarget";
import { CHALK, chalkCss, chalkTint, panelTheme, recolour, type BoardTheme } from "@/lib/canvas/theme";
import { BOARD_FONT_FACES, BOARD_FONT_FAMILY, BOARD_FONT_STACK, COURSE_FONT_FACE, COURSE_FONT_FAMILY, COURSE_FONT_RANGE } from "@/lib/anim/boardFont";
import { useReducedMotion } from "@/lib/anim/useReducedMotion";
import { ARIA_INK, CANVAS_CSS, CanvasPanel, Ink, markerPoint } from "./CanvasPanel";
import { quadPoints } from "@/lib/canvas/ink";
import { cardSideView } from "@/lib/canvas/renderFit";
import { playScratch, playTick, playWhoosh, setSoundEnabled, soundEnabled } from "./sound";
import { Confetti } from "./Confetti";
import { preferredCardStyle, type CardStyle } from "@/lib/canvas/cardStyle";

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
  /** Says a line in Aria's voice; `onEnd` runs once it has been said. */
  onSpeak: (text: string, onEnd?: () => void) => void;
  onTellAria: (note: string) => void;
  onContinue: () => void;
  /** The lecture is playing. Paused, the student may explore: picture hotspots appear. */
  playing?: boolean;
  /** The lecture's playback speed (lib/playbackPrefs.ts): the marker writes at the voice's pace. */
  speed?: number;
  /** Her voice on the live board (the lecture player): the marker writes each sentence while she says it. */
  voiceHeard?: HeardSentence | null;
  /** This lecture through the student's knowledge graph (GET /api/knowledge/lecture): marks the boards. */
  knowledge?: CanvasKnowledge | null;
  /** A Predict-it answer or a drawing check — evidence of what the student knows. First try only. */
  onTaskResult?: (kind: "quiz" | "drawing", correct: boolean, options?: number) => void;
  /** The student tapped "from <earlier lecture>" on a concept. */
  onOpenEarlier?: (from: EarlierBoard) => void;
  /** The lecture was watched to the end: every board is reachable in the whole-lesson view. */
  completed?: boolean;
  /** The board's task was already answered at its prediction: it does not reopen at the end. */
  taskDone?: boolean;
  /**
   * The standard lecture's question-card flow (owner's direction, 2026-10-16): Aria asks the question,
   * an X skips it, a right answer is congratulated (no explanation) and the lecture goes on by itself,
   * a wrong one is explained and the right option shown. Off: the card as other profiles have it.
   */
  checkFlow?: boolean;
  /**
   * A maths/CS "predict before the reveal" card (lib/canvas/predictCard.ts), open while the player
   * holds the board just before the sentence that gives the answer. Other subjects never get one.
   */
  predictCard?: QuizInteraction;
};

export type EarlierBoard = { lectureId: string; sequence: number; beatId: string; title: string; topic: string };
export type CanvasKnowledge = {
  beats: Array<{ sequence: number; concepts: string[]; elements: Record<string, string> }>;
  concepts: Record<string, { label: string; status: "known" | "shaky" | "new"; mastery: number | null; from?: EarlierBoard; gaps?: Array<{ key: string; label: string; mastery: number | null }> }>;
};

/** Aria's coral: her pen, her highlighter, her corrections — one colour that always means "Aria". */
const ARIA = ARIA_INK;
const STUDENT = "#2563eb";

export function LessonCanvas({ panels, currentIndex, sentence, sentenceProgress, finished, waitingForStudent, topic, onSpeak, onTellAria, onContinue, playing = true, speed = 1, voiceHeard, onTaskResult, completed = false, taskDone = false, checkFlow = false, predictCard }: Props) {
  const reducedMotion = useReducedMotion();
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [aspect, setAspect] = useState(16 / 9);
  /** The canvas's size on screen (px): a task card's column is measured in pixels, not board units. */
  const [boxSize, setBoxSize] = useState({ w: 0, h: 0 });
  const [mode, setMode] = useState<"follow" | "free" | "overview">("follow");
  const [biologyExplore, setBiologyExplore] = useState(false);
  const [moleculeRotation, setMoleculeRotation] = useState(0);

  /**
   * THE BOARD IS ONE SLATE for every lecture and every subject (owner, 2026-10-20, from the Visuals
   * Lab: "replace my chalkboard completely for every topic… only the board"). It replaces the
   * paper / chalk / mix choice: no picker, nothing stored. The colours are the chalk palette
   * (theme.ts), the surface is the lab's clean slate (CanvasPanel SlateSurface).
   */
  // Owner, 2026-10-21 (later): a pure black board, #000000, with white and colourful writing.
  const themeChoice = "chalk" as const;
  // Text card design (lib/canvas/cardStyle.ts): read after mount, so the server render always matches.
  const [cardStyle, setCardStyle] = useState<CardStyle>("sticky");
  /**
   * MATHS AND COMPUTER SCIENCE ARE TAUGHT THE VISUALS LAB'S WAY (owner, 2026-10-20: "you haven't
   * really replaced maths and computer science, I don't see the marker"): the marker writes every
   * word, term and line as Aria says it (MarkerWriter), and cards are drawn in chalk on the slate, not
   * stuck-on paper notes. Every other subject keeps its sticky notes and plays exactly as before.
   */
  // A course lesson's boards carry its subject (lib/canvas/lessonSubject.ts); a typed lesson's boards the
  // subject it was asked to be (lib/canvas/subjectDomain.ts); otherwise the look is read from the lecture
  // itself (its topic and its boards' headings), never the typed words alone. A sketch board is drawn by
  // the marker whatever the subject.
  // PICTURES ARE FETCHED BEFORE THEIR BOARD COMES UP (owner, 2026-10-26: "images load too late"): every
  // board's picture is requested the moment that board arrives — the boards ahead included — so the
  // browser already has it when the board is shown, instead of starting the download then.
  useEffect(() => {
    for (const panel of panels) for (const src of pictureSources(panel.spec)) fetchAhead(src);
  }, [panels]);
  const labLook = useMemo(() => {
    if (panels.some((p) => p.spec.stage.kind === "sketch")) return true;
    const subject = panels.find((p) => p.spec.subject)?.spec.subject;
    if (subject) return subject !== "other";
    const asked = panels.find((p) => p.spec.subjectDomain)?.spec.subjectDomain;
    return asked ? asked !== "none" : isLabLookTopic([topic, ...panels.map((p) => p.spec.heading)].join(" "));
  }, [topic, panels]);
  useEffect(() => {
    const t = window.setTimeout(() => setCardStyle(labLook ? "classic" : preferredCardStyle()), 0);
    return () => window.clearTimeout(t);
  }, [labLook]);
  const themes = useMemo((): BoardTheme[] => panels.map((p) => panelTheme(themeChoice, p.spec.stage.kind)), [panels, themeChoice]);
  // A chalk board's own colours are lifted to chalk pastels before it is laid out (theme.ts).
  const specs = useMemo(() => panels.map((p, i) => (themes[i] === "chalk" ? recolour(p.spec, chalkTint) : p.spec)), [panels, themes]);
  const layouts = useMemo(() => specs.map((spec, i) => (themes[i] === "chalk" ? recolour(layoutPanel(spec), chalkTint) : layoutPanel(spec))), [specs, themes]);
  const placements = useMemo(
    // A maths/CS lecture keeps its boards side by side: no dive inside an earlier board (calm camera).
    // Maths/CS boards never dive inside an earlier one: the earlier board's labels stood huge and faint
    // around the new one, read as writing behind writing (maths benchmark, 2026-10-21).
    () => placePanels(panels.map((p, i) => ({ key: p.key, inside: labLook ? undefined : p.spec.inside, layout: layouts[i] }))),
    [panels, layouts, labLook],
  );
  const shownIndex = currentIndex >= 0 ? currentIndex : Math.max(0, panels.length - 1);
  // The furthest board the student has reached (every board once the lecture is complete). The
  // world, the whole-lesson view and the map show boards up to HERE, not just up to the current
  // one: going back to board 2 to review must not make boards 3 and 4 vanish (audit 2026-10-15).
  const [furthest, setFurthest] = useState(shownIndex);
  if (shownIndex > furthest) setFurthest(shownIndex);
  const reachedIndex = completed ? Math.max(0, panels.length - 1) : Math.max(furthest, shownIndex);
  // Cards whose close-up Aria has finished (lib/canvas/cardDives.ts): a sticker card shows a tick.
  const divedCards = useMemo(() => {
    const out: Record<string, Set<string>> = {};
    panels.forEach((p, j) => {
      const inside = p.spec.inside;
      if (inside && (j < shownIndex || (completed && j <= reachedIndex))) (out[inside.beat] ??= new Set()).add(inside.id);
    });
    return out;
  }, [panels, shownIndex, reachedIndex, completed]);
  // The card Aria is inside right now: drawn empty, so the close-up sits inside its colour, not over its words.
  const openCard = panels[shownIndex]?.spec.inside;
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
  useEffect(() => {
    const t = window.setTimeout(() => {
      setGrainUrl(paperGrain());
      setShadowUrl(paperShadow());
    }, 0);
    return () => window.clearTimeout(t);
  }, []);


  // No "Predict it" (owner's direction, 2026-10-16): a quiz in a lesson saved before is never shown
  // or waited for — the board plays straight through. Try and draw tasks are unchanged.
  // An old mid-board "Predict it" quiz is never shown (owner, 2026-10-16). A verified "Check it" card
  // (lib/canvas/checkCard.ts) opens when Aria finishes the board, with the board's other tasks.
  // A maths/CS prediction card, while the board is held before its reveal, stands in for the board's task.
  const predicting = Boolean(predictCard && current && currentIndex >= 0);
  const interaction = predicting ? predictCard : current?.spec.interaction?.kind === "quiz" && !current.spec.interaction.check ? undefined : current?.spec.interaction;
  const taskOpen = Boolean(interaction) && currentIndex >= 0 && (predicting || waitingForStudent || (finished && !taskDone));
  /** One card per board, and the prediction its own: answering it never marks the end-of-board card done. */
  const cardKey = current ? `${current.key}${predicting ? ":predict" : ""}` : "";
  const drawing = taskOpen && interaction?.kind === "draw";
  // A "tap the board" card: the student answers on the board, the asked parts' names hidden as "?"
  // until they have answered (owner, 2026-10-18: "tap the board").
  const [tapPick, setTapPick] = useState<{ key: string; index: number; at: number } | null>(null);
  const [cardAnswered, setCardAnswered] = useState<Record<string, boolean>>({});
  const tapCard = taskOpen && checkFlow && interaction?.kind === "quiz" && interaction.mode === "tap" && current ? interaction : undefined;
  const tapHidden = useMemo(() => (tapCard && current && !cardAnswered[cardKey] ? new Set(tapCard.options.map((o) => o.target).filter((t): t is string => Boolean(t))) : null), [tapCard, current, cardAnswered, cardKey]);
  // An "order the steps" card: the board's arrows would show the answer, so they are taken off until
  // the student has answered — then they draw back in.
  const orderOpen = Boolean(taskOpen && checkFlow && interaction?.kind === "quiz" && interaction.mode === "order" && current && !cardAnswered[cardKey]);

  /* ── the pen: which cue is live ───────────────────────────────────────────────────────── */

  const cueState = useMemo(() => activeCues(current?.spec.cues ?? [], sentence, sentenceProgress, finished || currentIndex < 0, (target, at) => targetVisible(current?.spec, target, at)), [current, sentence, sentenceProgress, finished, currentIndex]);
  const penCue = reactionPoint && current && reactionPoint.key === current.key ? ({ s: sentence, action: "point", target: reactionPoint.target } as CanvasCue) : cueState.visit ? undefined : cueState.pen;
  const focusId = penCue?.target;
  /** Picture hotspots: out while the student can explore — paused, finished, or moving the camera. */
  const exploring = !playing || finished || currentIndex < 0 || mode !== "follow";
  // PAUSED BY THE STUDENT (not waiting at the end of a board, not finished): the pen, the camera and
  // the board's own short animations all hold still until Play (owner, 2026-10-23).
  const paused = !playing && !finished && !waitingForStudent && currentIndex >= 0;
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

  /* ── the camera ───────────────────────────────────────────────────────────────────────── */

  const worldRects = useMemo(() => panels.map((p) => toWorld({ x: 0, y: 0, w: PANEL_W, h: PANEL_H }, placements[p.key])), [panels, placements]);
  const overviewView = useMemo(() => fitView(unionRects(worldRects.slice(0, reachedIndex + 1)), aspect, 0.05), [worldRects, reachedIndex, aspect]);

  const visitIndex = cueState.visit ? panels.findIndex((p) => p.key === cueState.visit) : -1;

  /*
   * THE CAMERA DIRECTOR (maths/CS, lib/canvas/camera.ts): the marker says where it is about to draw,
   * and the shot holds, moves in, or moves at once when the pen or Aria's pointing would be off screen.
   * A shot belongs to its board: a new board opens wide, and only zooms after holding a while.
   */
  const [director, setDirector] = useState<Shot & { board: string }>({ shot: null, changedAt: 0, board: "" });
  const directorRef = useRef(director);
  const boardKey = current?.key ?? "";
  const boardStartRef = useRef({ key: "", at: 0 });
  useEffect(() => {
    boardStartRef.current = { key: boardKey, at: performance.now() };
  }, [boardKey]);
  const directingRef = useRef(false);
  useEffect(() => {
    directingRef.current = labLook && !taskOpen && !finished;
  }, [labLook, taskOpen, finished]);
  const stateFor = useCallback((): Shot => {
    const d = directorRef.current;
    return d.board === boardStartRef.current.key ? d : { shot: null, changedAt: boardStartRef.current.at };
  }, []);
  const applyShot = useCallback((next: Shot, was: Shot) => {
    if (next === was) return false;
    const d = { ...next, board: boardStartRef.current.key };
    directorRef.current = d;
    setDirector(d);
    return true;
  }, []);
  /** MarkerWriter: about to draw `box`; answers how long the pen should wait for the camera. */
  /** Where the camera is and how the board sits, for timing a move (set below, read by the director). */
  const camRef = useRef<{ view: () => View; place?: PanelPlacement; aspect: number }>({ view: () => ({ x: 0, y: 0, w: 1, h: 1 }), aspect: 1 });
  const onInkRegion = useCallback((box: Rect | null, ms: number, drawing: boolean) => {
    if (!directingRef.current) return 0;
    const was = stateFor();
    const next = directInk(was, box, performance.now(), { w: PANEL_W, h: PANEL_H }, undefined, drawing, ms);
    const qa = window as unknown as { __qaMarker?: boolean; __dirLog?: unknown[] };
    if (qa.__qaMarker) (qa.__dirLog ??= []).push({ t: Math.round(performance.now()), box: box && [box.x, box.y, box.w, box.h].map(Math.round), ms: Math.round(ms), drawing, was: was.shot && [was.shot.x, was.shot.w].map(Math.round), next: next.shot && [next.shot.x, next.shot.w].map(Math.round) });
    if (!applyShot(next, was)) return 0;
    // The pen waits for the whole flight: a flat 1.3 s left it writing off screen while the camera
    // was still pulling out of a close-up (maths benchmark, 2026-10-21).
    const { view, place, aspect } = camRef.current;
    if (!place) return 1300;
    const target = next.shot ? fitView(toWorld(next.shot, place), aspect, 0.03) : fitView(toWorld({ x: 0, y: 0, w: PANEL_W, h: PANEL_H }, place), aspect, 0.035);
    return flightMs(view(), target) + 150;
  }, [stateFor, applyShot]);
  // What Aria points at must be in the shot.
  const focusBox = focusId ? currentLayout?.targets[focusId] : undefined;
  const focusKey = focusBox ? `${boardKey}|${focusId}|${Math.round(focusBox.x)},${Math.round(focusBox.y)}` : "";
  useEffect(() => {
    if (!focusKey || !directingRef.current || !focusBox) return;
    const was = stateFor();
    applyShot(directFocus(was, focusBox, performance.now()), was);
    // Keyed on the target only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusKey]);
  const directorShot = director.board === boardKey ? director.shot : null;
  useEffect(() => {
    const qa = window as unknown as { __qaMarker?: boolean; __director?: unknown };
    if (qa.__qaMarker) qa.__director = { ...director, boardKey, place: currentPlace, directing: directingRef.current };
  }, [director, boardKey, currentPlace]);

  const followView = useMemo((): View => {
    if (!current || !currentPlace) return overviewView;
    if (current.spec.overview && finished) return overviewView;
    // The recap's tour: while a sentence recalls an earlier board, the camera is back on it.
    if (visitIndex >= 0 && visitIndex < shownIndex) return fitView(worldRects[visitIndex], aspect, 0.06);
    // Maths/CS: the director's shot (above) is the camera; the writer's own zoom cues are not used.
    const zoomTarget = cueState.zoom && !labLook ? currentLayout.targets[cueState.zoom] : undefined;
    // Zooming onto something that already fills most of the board only crops it.
    const zoomLimit = 0.28;
    const nearest = 0.55;
    if (zoomTarget && zoomTarget.w * zoomTarget.h < PANEL_W * PANEL_H * zoomLimit && !taskOpen) {
      const t = zoomTarget;
      // Never closer than about half the board: a zoom shows a detail in its context, not a texture.
      const w = Math.max(t.w, PANEL_W * nearest);
      const h = Math.max(t.h, PANEL_H * nearest);
      const x = Math.max(0, Math.min(PANEL_W - w, t.x + t.w / 2 - w / 2));
      const y = Math.max(0, Math.min(PANEL_H - h, t.y + t.h / 2 - h / 2));
      return fitView(toWorld({ x, y, w, h }, currentPlace), aspect, 0.06);
    }
    if (labLook && !taskOpen && !finished && directorShot) return fitView(toWorld(directorShot, currentPlace), aspect, 0.03);
    // Sticky notes (lib/canvas/cardStyle.ts): the camera leans gently toward the note Aria is on —
    // most of the board stays in view, so the note is in its context and nobody feels the motion.
    const note = cardStyle === "sticky" && focusId && !taskOpen ? currentLayout.marks.find((m) => m.type === "box" && !m.icon && m.id === focusId) : undefined;
    if (note) {
      const t = (note as { rect: Rect }).rect;
      const w = PANEL_W * 0.9;
      const h = PANEL_H * 0.9;
      const x = Math.max(0, Math.min(PANEL_W - w, PANEL_W / 2 + (t.x + t.w / 2 - PANEL_W / 2) * 0.35 - w / 2));
      const y = Math.max(0, Math.min(PANEL_H - h, PANEL_H / 2 + (t.y + t.h / 2 - PANEL_H / 2) * 0.35 - h / 2));
      return fitView(toWorld({ x, y, w, h }, currentPlace), aspect, 0.03);
    }
    // A task card sits to the right of the board: the camera slides the board left to make room —
    // the board as large as the space left of the card's column allows. A fixed half-board of room
    // shrank it to ~60% with the next board's giant text showing under it (audit 2026-10-17).
    const beside = taskOpen ? cardSideView(toWorld({ x: 0, y: 0, w: PANEL_W, h: PANEL_H }, currentPlace), boxSize, CARD_COLUMN_PX) : null;
    if (beside) return beside;
    const room = taskOpen ? PANEL_W * 0.52 : 0;
    return fitView(toWorld({ x: 0, y: 0, w: PANEL_W + room, h: PANEL_H }, currentPlace), aspect, 0.035);
  }, [current, currentPlace, currentLayout, cueState.zoom, finished, overviewView, aspect, boxSize, taskOpen, visitIndex, shownIndex, worldRects, cardStyle, focusId, labLook, directorShot]);

  const viewRef = useRef<View>(followView);
  useEffect(() => {
    camRef.current = { view: () => viewRef.current, place: currentPlace, aspect };
  }, [currentPlace, aspect]);
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
      if (r.width > 0 && r.height > 0) {
        setAspect(r.width / r.height);
        setBoxSize((was) => (Math.abs(was.w - r.width) < 1 && Math.abs(was.h - r.height) < 1 ? was : { w: r.width, h: r.height }));
      }
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const followKey = `${Math.round(followView.x)}:${Math.round(followView.y)}:${Math.round(followView.w)}`;
  useEffect(() => {
    const qa = window as unknown as { __qaMarker?: boolean; __camera?: unknown };
    if (qa.__qaMarker) qa.__camera = { followView, mode, taskOpen, finished };
  }, [followView, mode, taskOpen, finished]);
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
    setBiologyExplore(false);
    setMoleculeRotation(0);
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
      const hit = p ? [...worldRects.keys()].reverse().find((i) => i <= reachedIndex && p.x >= worldRects[i].x && p.x <= worldRects[i].x + worldRects[i].w && p.y >= worldRects[i].y && p.y <= worldRects[i].y + worldRects[i].h) : undefined;
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
    const graphs = (layout?.marks ?? []).filter((m): m is Extract<Mark, { type: "graph" }> => m.type === "graph");
    const target = graphs.flatMap((g) => g.spec.markers ?? [])[0]?.id ?? layout?.marks.find((m) => m.type === "node" && (m as Extract<Mark, { type: "node" }>).glow)?.id;
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

  const fontCss = BOARD_FONT_FACES.map((f) => `@font-face{font-family:"${BOARD_FONT_FAMILY}";src:url("${f.url}") format("truetype");font-weight:${f.weight};font-display:swap;}`).join("")
    // A course board's neat hand (lib/anim/boardFont.ts), one file for every weight.
    + `@font-face{font-family:"${COURSE_FONT_FAMILY}";src:url("${COURSE_FONT_FACE.url}") format("truetype");font-weight:${COURSE_FONT_FACE.weight};unicode-range:${COURSE_FONT_RANGE};font-display:swap;}`;
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
      <svg ref={svgRef} className={`absolute inset-0 h-full w-full transition-opacity ${mode === "overview" ? "opacity-0" : "opacity-100"}`} preserveAspectRatio="xMidYMid meet" style={{ fontFamily: BOARD_FONT_STACK }}>
        <defs>
          {shadowUrl && <image id="cv-shadow-img" href={shadowUrl} x={-SHADOW_PAD} y={-SHADOW_PAD + 10} width={PANEL_W + SHADOW_PAD * 2} height={PANEL_H + SHADOW_PAD * 2} preserveAspectRatio="none" />}
          {grainUrl && (
            <pattern id="cv-grain" width={220} height={220} patternUnits="userSpaceOnUse">
              <image href={grainUrl} width={220} height={220} />
            </pattern>
          )}
          {/* The slate: room light falling across it (CanvasPanel SlateSurface). */}
          <radialGradient id="cv-slate-light" cx="45%" cy="30%" r="75%">
            <stop offset="0%" stopColor="#ffffff" stopOpacity={0.07} />
            <stop offset="100%" stopColor="#000000" stopOpacity={0.12} />
          </radialGradient>
          <radialGradient id="cv-glow">
            <stop offset="0%" stopColor="#fbbf24" stopOpacity={0.85} />
            <stop offset="100%" stopColor="#fbbf24" stopOpacity={0} />
          </radialGradient>
        </defs>
        {panels.slice(0, reachedIndex + 1).map((panel, i) => {
          const at = placements[panel.key];
          const live = i === shownIndex && currentIndex >= 0;
          return (
            <g
              key={panel.key}
              data-panel={panel.key}
              // cv-marked: the marker writes this board, so new equation terms skip their own fade-in.
              className={[themes[i] === "chalk" ? "cv-chalk" : "", labLook ? "cv-marked" : "", live && paused ? "cv-paused" : ""].filter(Boolean).join(" ") || undefined}
              data-live={live ? "true" : undefined}
              transform={`translate(${at.x},${at.y}) scale(${at.scale})`}
            >
              <MemoPanel
                layout={(tapHidden || orderOpen) && panel.key === current?.key ? quizLayout(layouts[i], tapHidden ?? new Set(), orderOpen, orderOpen && interaction?.kind === "quiz" ? (interaction.steps ?? []).map((st) => st.text) : []) : layouts[i]}
                spec={specs[i]}
                theme={themes[i]}
                cards={cardStyle}
                doneIds={divedCards[panel.key]}
                openId={openCard?.beat === panel.key ? openCard.id : undefined}
                recap={live && finished}
                shownThrough={live && !finished ? sentence : Infinity}
                sentenceProgress={live ? sentenceProgress : 0}
                live={live}
                vars={panel.spec.stage.kind === "molecule" ? { ...(vars[panel.key] ?? EMPTY), rotation: moleculeRotation } : vars[panel.key] ?? EMPTY}
                ghostVars={ghostVars[panel.key]}
                focusId={live ? focusId : reactionPoint?.key === panel.key ? reactionPoint.target : undefined}
                carryFrom={carryFrom[panel.key] ?? EMPTY_RECTS}
                reducedMotion={reducedMotion}
              />
              {live && (labLook || isCourseBoard(panel.spec)) && <MarkerWriter key={panel.key} onRegion={onInkRegion} finished={finished} speed={speed} playing={playing || finished} sentence={sentence} heard={voiceHeard} />}
              {/* No writing on writing, on every board (owner, 2026-10-21: the most important fix). */}
              {live && <TextDeconflict key={`tx-${panel.key}`} />}
              <Corrections layout={layouts[i]} check={corrections[panel.key]} />
              <Strokes strokes={strokes[panel.key] ?? []} live={live && drawing ? liveStroke : null} />
              {live && penCue && <Pen cue={penCue} layout={layouts[i]} vars={vars[panel.key] ?? EMPTY} />}
              {!live && reactionPoint?.key === panel.key && <Pen cue={{ s: 0, action: "point", target: reactionPoint.target }} layout={layouts[i]} vars={vars[panel.key] ?? EMPTY} />}
              {/* The explore layer's rings stay off a board while its tap card is open: they sat over the
                  tap rings and caught the student's tap (water-cycle test, 2026-10-18). */}
              {!(tapCard && panel.key === current?.key) && (biologyExplore || (live ? exploring : mode !== "follow")) && (
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
              {tapCard && tapHidden && panel.key === current?.key && (
                <TapTargets layout={layouts[i]} targets={tapCard.options.map((o) => o.target ?? "")} onTap={(index) => setTapPick({ key: panel.key, index, at: Date.now() })} />
              )}
              {/* RACK FOCUS: while the camera is with Aria, every other board steps back — under a veil
                  of the background colour, which looks the same as fading the board but is one
                  rectangle to draw, where an opacity on the whole board was a second full render of it.
                  While a task card is open the others go fully dark: a neighbour's big writing showed
                  around the board and under the card (audit 2026-10-17). A board drawn inside this
                  one keeps the usual veil, so it never blacks out part of the board being answered. */}
              <rect x={-2} y={-2} width={PANEL_W + 4} height={PANEL_H + 4} rx={23} fill="#0b0f14" pointerEvents="none" style={{ opacity: rackFocus && !live && visitIndex !== i ? (taskOpen && panel.spec.inside?.beat !== current?.key ? 1 : 0.62) : 0, transition: "opacity 700ms ease" }} />
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
      {mode === "overview" && (
        <div
          className="absolute inset-0 z-[5] overflow-y-auto bg-[#0b0f14]/95 px-4 pb-16 pt-16 backdrop-blur-sm"
          onPointerDown={(event) => event.stopPropagation()}
          aria-label="Whole lesson board map"
        >
          <div className="mx-auto grid w-full max-w-6xl grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {panels.slice(0, reachedIndex + 1).map((panel, i) => (
              <button
                key={panel.key}
                type="button"
                className="group min-h-32 rounded-2xl border border-white/15 bg-white/[0.06] p-4 text-left text-white shadow-lg transition hover:border-amber-400/70 hover:bg-white/[0.1] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-400"
                onClick={() => {
                  setMode("free");
                  flyTo(fitView(worldRects[i], aspect, 0.035));
                }}
                aria-label={`Open board ${i + 1}: ${panel.spec.heading}`}
              >
                <span className="mb-3 inline-flex h-8 w-8 items-center justify-center rounded-full bg-amber-400 text-sm font-black text-black">{i + 1}</span>
                <span className="block text-base font-bold leading-snug">{panel.spec.heading}</span>
                <span className="mt-2 block text-xs font-semibold uppercase tracking-[0.14em] text-white/50">{panel.spec.stage.kind}</span>
                {panel.spec.notes.length > 0 && <span className="mt-3 block text-sm leading-relaxed text-white/70">{panel.spec.notes.map((note) => note.text).join(" · ")}</span>}
              </button>
            ))}
          </div>
        </div>
      )}
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
      {current?.spec.stage.kind === "illustration" && current.spec.stage.parts.some((part) => part.say) && (
        <button type="button" onClick={() => setBiologyExplore((value) => !value)} aria-pressed={biologyExplore} className="absolute left-3 top-3 z-10 rounded-full border border-white/15 bg-black/65 px-3 py-1.5 text-xs font-bold text-white/90 backdrop-blur hover:bg-black/80" onPointerDown={(event) => event.stopPropagation()}>
          {biologyExplore ? "Hide interactive layer" : "Explore parts & misconceptions"}
        </button>
      )}
      {current?.spec.stage.kind === "molecule" && (
        <label className="absolute left-3 top-3 z-10 flex items-center gap-2 rounded-full border border-white/15 bg-black/65 px-3 py-1.5 text-xs font-bold text-white/90 backdrop-blur" onPointerDown={(event) => event.stopPropagation()}>
          Rotate model
          <input aria-label="Rotate molecular model" type="range" min={-180} max={180} step={5} value={moleculeRotation} onChange={(event) => setMoleculeRotation(Number(event.target.value))} className="w-28 accent-amber-400" />
        </label>
      )}
      {mode === "overview" && (
        <p className="pointer-events-none absolute bottom-3 left-1/2 z-10 -translate-x-1/2 rounded-full bg-black/60 px-3 py-1.5 text-xs font-semibold text-white/75 backdrop-blur">
          Choose a board to open it at a readable size
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
      {taskOpen && interaction?.kind === "quiz" && current && !checkFlow && (
        <CheckCard
          key={cardKey}
          question={interaction.question}
          options={interaction.options}
          onAnswer={(i) => {
            const o = interaction.options[i];
            if (!reported.current.has(`quiz:${cardKey}`)) {
              reported.current.add(`quiz:${cardKey}`);
              onTaskResult?.("quiz", o.correct, interaction.options.length);
            }
            if (o.correct) setCelebration(Date.now());
            onSpeak(o.feedback);
            onTellAria(`Asked "${interaction.question}", the student chose "${o.text}" (${o.correct ? "correct" : "not correct"}). You told them: "${o.feedback}"`);
          }}
          onContinue={onContinue}
        />
      )}
      {taskOpen && interaction?.kind === "quiz" && current && checkFlow && (
        <QuestionCard
          key={cardKey}
          question={interaction.question}
          options={interaction.options}
          mode={interaction.mode ?? "choice"}
          steps={interaction.steps}
          loop={interaction.loop}
          tapped={tapPick?.key === current.key ? tapPick : null}
          onHint={interaction.hint ? () => {
            if (interaction.hint!.target && onBoardNow(layouts[currentIndex], interaction.hint!.target)) setReactionPoint({ key: current.key, target: interaction.hint!.target, at: Date.now() });
            onSpeak(interaction.hint!.text);
            onTellAria(`The student asked for a hint on "${interaction.question}". You said: "${interaction.hint!.text}"`);
          } : undefined}
          onReplay={interaction.replay ? () => {
            if (interaction.replay!.target && onBoardNow(layouts[currentIndex], interaction.replay!.target)) setReactionPoint({ key: current.key, target: interaction.replay!.target, at: Date.now() });
            onSpeak(interaction.replay!.text);
          } : undefined}
          onAsk={() => onSpeak(interaction.question)}
          onAnswer={(i, done) => {
            setCardAnswered((prev) => ({ ...prev, [cardKey]: true }));
            const o = interaction.options[i];
            if (!reported.current.has(`quiz:${cardKey}`)) {
              reported.current.add(`quiz:${cardKey}`);
              onTaskResult?.("quiz", o.correct, interaction.options.length);
            }
            if (o.correct) {
              setCelebration(Date.now());
              const praise = PRAISE[Math.floor(Math.random() * PRAISE.length)];
              onSpeak(praise, done);
              onTellAria(`Asked "${interaction.question}", the student chose "${o.text}", which is correct. You congratulated them.`);
              return praise;
            }
            // A wrong tap: the pen goes to the right part, its name back on the board.
            const rightTarget = interaction.options.find((x) => x.correct)?.target;
            if (interaction.mode === "tap" && rightTarget) setReactionPoint({ key: current.key, target: rightTarget, at: Date.now() });
            onSpeak(o.feedback);
            onTellAria(`Asked "${interaction.question}", the student chose "${o.text}" (not correct). You told them: "${o.feedback}" The right answer is "${interaction.options.find((x) => x.correct)?.text ?? ""}".`);
            return o.feedback;
          }}
          onSkip={() => onTellAria(`Asked "${interaction.question}", the student skipped the question.`)}
          onContinue={onContinue}
        />
      )}
      {(exploring || biologyExplore) && !taskOpen && current?.spec.stage.kind === "illustration" && current.spec.stage.parts.some((p) => p.say) && (
        <p className="pointer-events-none absolute left-1/2 top-3 z-10 -translate-x-1/2 rounded-full bg-black/65 px-3 py-1.5 text-xs font-semibold text-white/85 backdrop-blur">
          Tap the glowing parts of the picture to explore them
        </p>
      )}
      <MiniMap
        themes={themes}
        panels={panels}
        worldRects={worldRects}
        shownIndex={shownIndex}
        reachedIndex={reachedIndex}
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

/** Every stored picture a board shows (a picture board's, one beside working, a figure's), by its URL. */
function pictureSources(spec: CanvasPanelInput["spec"]): string[] {
  return [...new Set(JSON.stringify(spec).match(/\/api\/canvas-lecture\/image\/[A-Za-z0-9_.-]+/g) ?? [])];
}

/** Pictures already asked for (kept, so a download in flight is not dropped). */
const fetchedAhead = new Map<string, HTMLImageElement>();
function fetchAhead(src: string): void {
  if (typeof window === "undefined" || fetchedAhead.has(src)) return;
  const img = new Image();
  img.decoding = "async";
  // A failed download is forgotten, so the next board update asks for it again.
  img.onerror = () => {
    if (fetchedAhead.get(src) === img) fetchedAhead.delete(src);
  };
  img.src = src;
  fetchedAhead.set(src, img);
}

const EMPTY: Record<string, number> = {};
/** A task card's column at the canvas's right (px): its width (320), its right margin, and a gap. */
const CARD_COLUMN_PX = 320 + 16 + 12;
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

function Pen({ cue: given, layout, vars }: { cue: CanvasCue; layout: PanelLayout; vars: Record<string, number> }) {
  // Nothing coral is drawn any more (owner, 2026-10-21): the cue still names what Aria is talking
  // about, so Dot (components/avatar/BoardAvatar.tsx) can fly beside it and the camera can lean in.
  const cue: CanvasCue = given.action === "circle" ? { ...given, action: "point" } : given;
  const rect = cue.target ? layout.targets[cue.target] : undefined;
  const marker = cue.target ? markerPoint(layout, cue.target, vars) : null;
  const key = `${cue.s}-${cue.action}-${cue.target}`;
  const targetRef = useRef<SVGRectElement>(null);
  const shown = Boolean(rect || marker);
  useEffect(() => {
    const el = targetRef.current;
    if (!el || !shown) return;
    setPointTarget({ el, action: cue.action === "underline" ? "underline" : "point", key });
    return () => setPointTarget(null);
  }, [key, cue.action, shown]);
  if (!rect && !marker) return null;
  const r = marker ? { x: marker.x - 16, y: marker.y - 16, w: 32, h: 32 } : rect!;
  return (
    <g pointerEvents="none">
      <rect ref={targetRef} x={r.x - 8} y={r.y - 6} width={r.w + 16} height={r.h + 12} fill="none" stroke="none" />
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
        // No rings round answers either (owner, 2026-10-17); the arrows and the pen still show the link.
        if (m.kind === "circle") return null;
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
    <div data-card="" className="absolute right-4 top-1/2 z-20 max-h-[calc(100%-2rem)] w-[min(320px,calc(100%-2rem))] -translate-y-1/2 overflow-y-auto rounded-2xl border border-amber-300/25 bg-[#11100f]/92 p-4 text-white shadow-2xl backdrop-blur" onPointerDown={(e) => e.stopPropagation()} onWheel={(e) => e.stopPropagation()}>
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
    <div data-card="" className="absolute right-4 top-1/2 z-20 max-h-[calc(100%-2rem)] w-[min(320px,calc(100%-2rem))] -translate-y-1/2 overflow-y-auto rounded-2xl border border-sky-300/25 bg-[#0e1116]/92 p-4 text-white shadow-2xl backdrop-blur" onPointerDown={(e) => e.stopPropagation()} onWheel={(e) => e.stopPropagation()}>
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

/**
 * Is this element on the finished board? A note that rolled off the notes column is not: a hint
 * pointed at one drew the pen's highlight round empty paper (PDF test, 2026-10-18).
 */
function onBoardNow(layout: PanelLayout | undefined, target: string): boolean {
  if (!layout?.targets[target]) return false;
  const note = layout.marks.find((m) => m.type === "note" && m.id === target) as Extract<Mark, { type: "note" }> | undefined;
  // A line of working on a wiped page is not on the finished board either.
  const wiped = layout.marks.some((m) => m.type === "equation" && m.until !== undefined && m.tokens.some((t) => t.id === target));
  return !(note && note.until !== undefined) && !wiped;
}

/** The board with the asked parts' names shown as "?" — a label quiz — while a tap card is open. */
const quizLayouts = new WeakMap<PanelLayout, Map<string, PanelLayout>>();
function quizLayout(layout: PanelLayout, hidden: Set<string>, noArrows = false, steps: string[] = []): PanelLayout {
  const key = `${[...hidden].sort().join("|")}${noArrows ? "|-arrows" : ""}|${steps.join("/")}`;
  // A note that names two or more of the steps gives their order away ("Collecting duct → ureter →
  // bladder" beside the kidney order card, 2026-10-18): off the board until the student has answered.
  const lower = steps.map((st) => st.toLowerCase());
  const givesOrder = (lines: string[]) => lower.filter((st) => lines.join(" ").toLowerCase().includes(st)).length >= 2;
  const cached = quizLayouts.get(layout)?.get(key);
  if (cached) return cached;
  const marks = layout.marks
    .filter((m) => !(noArrows && m.type === "arrow") && !(m.type === "note" && lower.length && givesOrder(m.lines)))
    .map((m) => (m.type === "figure-label" && hidden.has(m.part) ? { ...m, lines: ["?"] } : m.type === "part" && hidden.has(m.id) ? { ...m, name: "?" } : m.type === "callout" && hidden.has(m.partId) ? { ...m, text: "?" } : m));
  const out = { ...layout, marks };
  quizLayouts.set(layout, (quizLayouts.get(layout) ?? new Map()).set(key, out));
  return out;
}

/** The parts a tap card asks about, as glowing rings the student taps to answer. */
function TapTargets({ layout, targets, onTap }: { layout: PanelLayout; targets: string[]; onTap: (index: number) => void }) {
  return (
    <g>
      {targets.map((id, i) => {
        const part = layout.marks.find((m) => m.type === "part" && m.id === id) as Extract<Mark, { type: "part" }> | undefined;
        const r = layout.targets[id];
        const c = part ? { x: part.cx, y: part.cy } : r ? { x: r.x + r.w / 2, y: r.y + r.h / 2 } : null;
        if (!c) return null;
        return (
          <g key={id} role="button" aria-label={`Answer: part ${i + 1}`} style={{ cursor: "pointer" }} onPointerDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); onTap(i); }}>
            <circle cx={c.x} cy={c.y} r={30} fill="#fff" opacity={0.001} />
            <circle cx={c.x} cy={c.y} r={16} fill="none" stroke="#8b5cf6" strokeWidth={3.5} className="cv-hotspot" style={{ animationDelay: `${i * 160}ms` }} />
            <circle cx={c.x} cy={c.y} r={7} fill="#8b5cf6" stroke="#fff" strokeWidth={2.5} />
          </g>
        );
      })}
    </g>
  );
}

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


/** The end-of-board "Check it" card: one verified question, Aria's feedback on each choice. */
function CheckCard({ question, options, onAnswer, onContinue }: { question: string; options: Array<{ text: string; correct: boolean; feedback: string }>; onAnswer: (i: number) => void; onContinue: () => void }) {
  const [picked, setPicked] = useState<number[]>([]);
  const last = picked[picked.length - 1];
  const solved = picked.some((i) => options[i].correct);
  return (
    // Anchored near the top and scrolled inside, as the question card is: centred with no height limit,
    // a long stem with four long options and the feedback ran off the canvas, which clips (audit
    // 2026-10-17). Kept clear of the bottom-right corner, where Aria stands.
    <div data-card="" className="absolute right-4 top-[9%] z-20 max-h-[calc(100%-9%-9.5rem)] w-[min(320px,calc(100%-2rem))] overflow-y-auto rounded-2xl border border-violet-300/25 bg-[#100e16]/92 p-4 text-white shadow-2xl backdrop-blur" onPointerDown={(e) => e.stopPropagation()} onWheel={(e) => e.stopPropagation()}>
      <p className="flex items-center gap-1.5 text-[0.68rem] font-black uppercase tracking-[0.18em] text-violet-300/90">
        <Sparkles size={12} /> Check it
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
      <button onClick={onContinue} disabled={!picked.length} className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-xl bg-violet-400 px-3 py-2 text-sm font-black text-black hover:bg-violet-300 disabled:opacity-40">
        <Play size={14} /> {solved ? "Continue the lesson" : picked.length ? "Continue anyway" : "Choose an answer"}
      </button>
    </div>
  );
}

/** What Aria says to a right answer: praise only, no explanation (owner's direction, 2026-10-16). */
const PRAISE = ["That's right — well done!", "Correct — nice work!", "Exactly right. Great job!", "Yes, that's it — well done!"];

/**
 * The standard lecture's question card. Aria asks the question as it opens and the lecture waits.
 * - The X skips it at any moment, and the lecture goes on.
 * - A right answer: green, praise only, and the lecture goes on by itself once the praise is said
 *   (or after a few seconds, whichever comes first).
 * - A wrong answer: struck through, with why it is wrong; the right option is then shown, without
 *   an explanation of its own, and the student continues.
 */
function QuestionCard({ question, options, mode = "choice", steps, loop, tapped, onHint, onReplay, onAsk, onAnswer, onSkip, onContinue }: {
  question: string;
  options: Array<{ text: string; correct: boolean; feedback: string }>;
  mode?: "choice" | "tap" | "order";
  steps?: Array<{ id: string; text: string }>;
  loop?: boolean;
  /** A part tapped on the board (tap cards): its option index, and when. */
  tapped?: { index: number; at: number } | null;
  onHint?: () => void;
  onReplay?: () => void;
  onAsk: () => void;
  /** Speaks the response and returns the line to show; `done` is called when a right answer's praise ends. */
  onAnswer: (i: number, done: () => void) => string;
  onSkip: () => void;
  onContinue: () => void;
}) {
  const [picked, setPicked] = useState<number | null>(null);
  const [line, setLine] = useState("");
  const finished = useRef(false);
  const asked = useRef(false);
  const timer = useRef<number | undefined>(undefined);
  // Asked once as the card opens (a re-render must not ask again).
  useEffect(() => {
    if (asked.current) return;
    asked.current = true;
    onAsk();
  }, [onAsk]);
  useEffect(() => {
    const pending = timer;
    return () => window.clearTimeout(pending.current);
  }, []);
  const finish = useCallback(() => {
    if (finished.current) return;
    finished.current = true;
    window.clearTimeout(timer.current);
    onContinue();
  }, [onContinue]);
  const answered = picked !== null;
  const right = answered && options[picked].correct;
  const answer = useCallback((i: number) => {
    if (picked !== null) return;
    setPicked(i);
    setLine(onAnswer(i, finish));
    if (options[i].correct) timer.current = window.setTimeout(finish, 5_000);
  }, [picked, onAnswer, finish, options]);
  // A tap on the board answers a tap card.
  useEffect(() => {
    if (mode === "tap" && tapped) answer(tapped.index);
  }, [mode, tapped, answer]);
  // An order card: the steps shuffled (never already in order), placed one tap at a time.
  const shuffled = useMemo(() => {
    const idx = (steps ?? []).map((_, i) => i);
    const out = idx.map((i) => idx[(i * 2 + 1) % idx.length]);
    const unique = new Set(out).size === idx.length ? out : [...idx].reverse();
    return unique.every((v, k) => v === k) ? [...idx].reverse() : unique;
  }, [steps]);
  const [sequence, setSequence] = useState<number[]>([]);
  const place = (i: number) => {
    if (answered || sequence.includes(i) || !steps) return;
    const next = [...sequence, i];
    setSequence(next);
    if (next.length === steps.length) {
      const n = steps.length;
      // A loop is in order from any step; a chain only from its first.
      const inOrder = next.every((v, k) => v === (loop ? (next[0] + k) % n : k));
      answer(inOrder ? options.findIndex((o) => o.correct) : options.findIndex((o) => !o.correct));
    }
  };
  return (
    // Anchored near the top and kept clear of the bottom-right corner, where Aria stands: an answered
    // card is tall, and centred it ran under her.
    <div data-card="" className="absolute right-4 top-[9%] z-20 max-h-[calc(100%-9%-9.5rem)] w-[min(320px,calc(100%-2rem))] overflow-y-auto rounded-2xl border border-violet-300/25 bg-[#100e16]/92 p-4 text-white shadow-2xl backdrop-blur" onPointerDown={(e) => e.stopPropagation()} onWheel={(e) => e.stopPropagation()}>
      <div className="flex items-start justify-between gap-2">
        <p className="flex items-center gap-1.5 text-[0.68rem] font-black uppercase tracking-[0.18em] text-violet-300/90">
          <Sparkles size={12} /> Quick question
        </p>
        <button
          type="button"
          aria-label="Close question"
          title="Skip and continue the lesson"
          onClick={() => {
            if (!answered) onSkip();
            finish();
          }}
          className="-mr-1.5 -mt-1.5 rounded-full p-1.5 text-white/45 transition hover:bg-white/10 hover:text-white"
        >
          <X size={15} />
        </button>
      </div>
      <p className="mt-1.5 text-sm font-semibold leading-snug text-white/90">{question}</p>
      {mode === "tap" && !answered && (
        <p className="mt-2 flex items-center gap-1.5 rounded-lg bg-violet-400/15 px-2.5 py-2 text-xs font-bold text-violet-100">👆 Tap your answer on the board</p>
      )}
      {mode === "order" && steps && (
        <div className="mt-3 space-y-2">
          <div className="flex flex-wrap gap-1.5">
            {shuffled.map((i) => (
              <button key={steps[i].id} disabled={answered || sequence.includes(i)} onClick={() => place(i)} className="rounded-full border border-violet-300/40 bg-white/[0.05] px-3 py-1.5 text-xs font-bold text-white/90 transition hover:border-violet-300/80 hover:bg-violet-400/15 disabled:opacity-25">
                {steps[i].text}
              </button>
            ))}
          </div>
          <ol className="space-y-1.5">
            {steps.map((_, k) => {
              const placed = sequence[k];
              const good = answered && placed !== undefined && placed === (loop ? (sequence[0] + k) % steps.length : k);
              return (
                <li key={k} className={`flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-xs font-semibold ${placed === undefined ? "border-dashed border-white/15 text-white/35" : answered ? (good ? "border-emerald-300/50 bg-emerald-400/10 text-emerald-50" : "border-rose-300/50 bg-rose-400/10 text-rose-100") : "border-violet-300/40 bg-violet-400/10 text-white/90"}`}>
                  <span className="grid size-5 shrink-0 place-items-center rounded-full bg-white/10 text-[0.65rem] font-black">{k + 1}</span>
                  {placed === undefined ? "…" : steps[placed].text}
                </li>
              );
            })}
          </ol>
          {!answered && sequence.length > 0 && (
            <button onClick={() => setSequence((q) => q.slice(0, -1))} className="text-xs font-bold text-white/55 hover:text-white">↶ Undo</button>
          )}
        </div>
      )}
      {!answered && (onHint || onReplay) && (
        <div className="mt-3 flex gap-2">
          {onHint && <button onClick={onHint} className="flex-1 rounded-xl border border-amber-300/40 bg-amber-300/10 px-2.5 py-1.5 text-xs font-bold text-amber-100 hover:bg-amber-300/20">💡 Hint</button>}
          {onReplay && <button onClick={onReplay} className="flex-1 rounded-xl border border-white/15 bg-white/[0.04] px-2.5 py-1.5 text-xs font-bold text-white/80 hover:bg-white/[0.08]">↺ Show me again</button>}
        </div>
      )}
      <div className="mt-3 space-y-2">
        {(mode === "choice" || (mode === "tap" && answered)) && options.map((o, i) => {
          const chosen = picked === i;
          const shownRight = answered && o.correct;
          // Once answered, only their pick and the right answer stay: the card fits beside Aria.
          if (answered && !chosen && !o.correct) return null;
          return (
            <button
              key={i}
              disabled={answered}
              onClick={() => answer(i)}
              className={`flex w-full items-center justify-between gap-2 rounded-xl border px-3 py-2 text-left text-sm font-semibold transition ${
                shownRight
                  ? "border-emerald-300/60 bg-emerald-400/15 text-emerald-50"
                  : chosen
                    ? "border-rose-300/50 bg-rose-400/10 text-rose-100/80 line-through decoration-rose-300/60"
                    : answered
                      ? "border-white/8 bg-white/[0.02] text-white/45"
                      : "border-white/12 bg-white/[0.04] text-white/85 hover:border-violet-300/50 hover:bg-white/[0.08]"
              } disabled:cursor-default`}
            >
              <span>{o.text}</span>
              {shownRight && !chosen && <span className="shrink-0 text-[0.62rem] font-black uppercase tracking-wider text-emerald-300">Right answer</span>}
            </button>
          );
        })}
      </div>
      {answered && (
        <p className={`mt-2.5 rounded-lg px-2.5 py-2 text-xs font-semibold leading-relaxed ${right ? "bg-emerald-400/15 text-emerald-100" : "bg-rose-400/15 text-rose-100"}`}>{line}</p>
      )}
      {answered && !right && onReplay && (
        <button onClick={onReplay} className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-xl border border-white/15 bg-white/[0.04] px-3 py-1.5 text-xs font-bold text-white/85 hover:bg-white/[0.08]">↺ Show me where this was taught</button>
      )}
      {answered && !right && (
        <button onClick={finish} className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-xl bg-violet-400 px-3 py-2 text-sm font-black text-black hover:bg-violet-300">
          <Play size={14} /> Continue the lesson
        </button>
      )}
    </div>
  );
}

/** The whole lesson in the corner: every board so far, where Aria is, and a click to fly anywhere. */
function MiniMap({ panels, themes, worldRects, shownIndex, reachedIndex, visitIndex, onPick }: { panels: CanvasPanelInput[]; themes: BoardTheme[]; worldRects: Rect[]; shownIndex: number; reachedIndex: number; visitIndex: number; onPick: (i: number) => void }) {
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
          const shown = i <= reachedIndex;
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

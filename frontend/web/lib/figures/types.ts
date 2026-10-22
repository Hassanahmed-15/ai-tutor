/**
 * TEXTBOOK FIGURES, DRAWN BY CODE. A figure is a pure description — shapes plus the named parts a
 * label can point at, each with an EXACT anchor — built by a component from parameters the model
 * chooses (lib/figures/registry.ts). The model decides what to show; code decides where everything
 * is, so a label can never point at the wrong place (an AI picture's parts were guessed, and a guess
 * lands on the right part about half the time — research 2026-10-16).
 *
 * Coordinates are the figure's own (0..w, 0..h); the board scales the figure to fit.
 */
export type Pt = { x: number; y: number };

/** Colours by meaning, so one figure reads on paper and on the chalkboard (CanvasPanel maps them). */
export type Ink = "ink" | "glass" | "metal" | "wood" | "muted" | "paper" | `#${string}`;

type Style = { part?: string; fill?: Ink | "none"; stroke?: Ink | "none"; width?: number; dash?: string; opacity?: number } & ShapeTiming;

/**
 * A SHAPE THAT CHANGES WITH THE NARRATION (opt-in, 2026-10-20, from the Visuals Lab: "the motion is
 * the maths"). Times are part ids: a shape follows the sentence on which the board reveals that part
 * (FigureStage.parts[].s). A part the board never times counts as revealed from the start, so the
 * figure always ends in its finished form. Figures without these fields draw exactly as before.
 *   show — drawn from that part's sentence (every listed part, when several);
 *   hide — fades away on that part's sentence;
 *   move — slides by (dx, dy) in figure units, optionally turning by `rotate` degrees about its own
 *          centre, on that part's sentence; `delay` (ms) staggers several moves on one sentence.
 */
export type ShapeTiming = {
  show?: string | string[];
  hide?: string;
  move?: { on: string; dx: number; dy: number; rotate?: number; delay?: number };
};
export type FigureShape =
  | ({ t: "path"; d: string } & Style)
  | ({ t: "circle"; cx: number; cy: number; r: number } & Style)
  | ({ t: "text"; x: number; y: number; text: string; size: number; anchor?: "start" | "middle" | "end" } & Style);

export type FigurePart = {
  id: string;
  /** The default label ("Burette"); a board may name it more specifically ("Burette (hydrochloric acid)"). */
  name: string;
  /** Where the leader line ends: a point inside the part. */
  anchor: Pt;
};

export type FigureDrawing = { w: number; h: number; shapes: FigureShape[]; parts: FigurePart[]; credit?: string };

export type FigureParams = Record<string, string | number | boolean>;

export type FigureComponent = {
  name: string;
  /** What it draws, for the board writer. */
  title: string;
  /** The parameters it takes, described for the board writer (all optional; sensible defaults). */
  params: string;
  /** Words that mean a board needs this figure. */
  match: RegExp;
  /** The labelable parts, for the board writer (ids are fixed by the component). */
  parts: Array<{ id: string; name: string }>;
  build(params: FigureParams): FigureDrawing;
  /**
   * The figure's own cards already say what each part is (a timeline's events, a cause map's boxes):
   * no margin labels are drawn — they would repeat the cards and take the figure's room. Its parts are
   * still pen targets, revealed on their sentences.
   */
  selfLabelled?: boolean;
  /**
   * A figure whose shapes move with the narration (ShapeTiming) times its own steps from what Aria
   * says, in teaching order: part id → sentence index. The board writer often leaves a step part
   * ("step-slide") untimed or puts every part on sentence 0, and the figure would then appear
   * already finished (live Pythagoras lecture, 2026-10-20). Parts it cannot place are left alone.
   */
  timeFromScript?: (sentences: string[], params: FigureParams) => Record<string, number>;
};

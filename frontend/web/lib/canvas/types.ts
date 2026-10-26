/**
 * THE LESSON CANVAS — one board spec per beat, drawn by hand-built renderers on a single world.
 *
 * The model never writes code or coordinates here. It picks ONE stage (what kind of picture this
 * board is) and fills that stage's slots with content: node names, equation tokens, curve formulas,
 * picture parts. lib/canvas/layout.ts turns that into positioned marks deterministically, so every
 * mark has known bounds — which is what lets the pointer, the camera and the morphs target it.
 *
 * Every board is a PANEL on one shared world (1000 x 560 board units, like every other board). The
 * camera flies from panel to panel; a panel can sit INSIDE an element of an earlier panel, so
 * "inside the leaf is the chloroplast" is a zoom rather than a new slide.
 */

export const PANEL_W = 1000;
export const PANEL_H = 560;

/** Built-in icons (components/canvas/icons.tsx). A node names one; anything else draws a plain disc. */
export const CANVAS_ICONS = [
  "sun", "water", "gas", "leaf", "chloroplast", "sugar", "oxygen", "energy", "cell", "plant",
  "root", "cloud", "flame", "atom", "battery", "person", "earth", "gear", "heart", "lungs",
  "stomata", "animal", "factory", "book", "airplane", "wing", "force", "magnet", "bulb", "wave", "car", "ice", "steam",
] as const;
export type CanvasIcon = (typeof CANVAS_ICONS)[number];

export const CANVAS_STAGES = ["illustration", "flow", "equation", "graph", "compare", "scene", "code", "molecule", "atom-map", "figure", "structure", "exam", "diagram", "sketch"] as const;
export type CanvasStage = (typeof CANVAS_STAGES)[number];

/** A written key note in the notes column, revealed on the sentence that says it. */
export type CanvasNote = { id: string; text: string; s: number };

export type FlowNode = {
  id: string;
  label: string;
  sub?: string;
  icon?: CanvasIcon;
  color?: string;
  /** Where it sits in an inputs → core → outputs arrangement. Ignored by chain and cycle. */
  role?: "input" | "core" | "output";
  s: number;
  /** 0-1 expression over the try-it variables: how strongly the node glows (e.g. the sun's brightness). */
  glow?: string;
  /** A change of STATE that is the concept itself (ice → water): on sentence `s` this element morphs into the new icon/label. */
  becomes?: Becomes;
};

export type Becomes = { icon?: CanvasIcon; label?: string; s: number };

export type FlowArrow = {
  id: string;
  from: string;
  to: string;
  label?: string;
  s: number;
  /** Particles travel along the arrow — matter or energy moving, not just a relation. */
  flow?: boolean;
  /** 0-1 expression over the try-it variables: how fast the particles travel. */
  rate?: string;
  color?: string;
};

export type FlowStage = {
  kind: "flow";
  arrangement: "inputs-core-outputs" | "chain" | "cycle";
  nodes: FlowNode[];
  arrows: FlowArrow[];
};

export type PicturePart = {
  id: string;
  name: string;
  s: number;
  /** One sentence Aria says when the student taps this part while exploring the picture. */
  say?: string;
  /** Where the part is on the picture, as fractions of its width and height. Filled by the server. */
  x?: number;
  y?: number;
};

export type IllustrationStage = {
  kind: "illustration";
  /** One sentence describing the picture, in its canonical textbook view. No text in the picture. */
  subject: string;
  parts: PicturePart[];
  /** Part ids to write ON the picture as callouts (0-3). */
  labels: string[];
  /** Filled by the server: the stored picture's URL and its paper colour. */
  src?: string;
  paper?: string;
  /**
   * A course lesson's picture drawn WITH its labels by gpt-image-2 (lib/canvas/coursePicture.ts): the
   * labels written in the picture (no callouts are drawn over it), and what the picture shows, in words,
   * for the voice tutor and the board's description.
   */
  labelsInPicture?: string[];
  description?: string;
  /** Drawn by gpt-image-2 for a course lesson: shown as drawn after its one check and redraw. */
  coursePicture?: boolean;
  /**
   * Drawn in the board's own colours, white on black (a typed-prompt or PDF maths lecture's figure,
   * lib/canvas/mathsPicture.ts): put straight on the board — no paper, frame or tape — and not traced by the pencil.
   */
  onBoard?: boolean;
};

/**
 * A textbook figure drawn by code (lib/figures): a component, its parameters, and the parts to label
 * — each named as the board needs ("Burette (hydrochloric acid)") and revealed on its sentence.
 * Every part's position comes from the component, so labels are exact.
 */
export type FigureStage = {
  kind: "figure";
  /** A registered code-drawn component (lib/figures/registry.ts), or "library" for a real textbook diagram. */
  component: string;
  params: Record<string, string | number | boolean>;
  parts: Array<{ id: string; name: string; s: number; say?: string }>;
  /**
   * component "library": an openly-licensed textbook diagram (lib/figures/library.ts), its own words
   * taken off and each part an exact anchor in its w×h space. Filled by the server from the library
   * index (never trusted from the model); the board draws it from /api/figures/asset/<id>.
   */
  asset?: { id: string; w: number; h: number; credit: string; parts: Array<{ id: string; name: string; anchor: { x: number; y: number } }> };
  /** component "drawn": a diagram the board writer described and lib/figures/drawn.ts checked. */
  drawing?: import("../figures/types").FigureDrawing;
};

/**
 * A textbook vector diagram from the general scene grammar (lib/diagrams). Code draws every
 * primitive, so labels and counts are exact; the model only fills in the spec.
 */
export type DiagramStage = {
  kind: "diagram";
  spec: import("../diagrams/spec").DiagramSpec;
  parts: Array<{ id: string; name: string; s: number; say?: string }>;
  drawing?: import("../figures/types").FigureDrawing;
};

export type EquationToken = {
  id: string;
  /** The term as plain text ("x/3", "(5a − 2a)"): the chat's description and the drawing snapshot read it. */
  text: string;
  /**
   * The term in LaTeX ("\frac{x}{3}", "(5a - 2a)"), typeset by KaTeX on the board (owner's
   * direction, 2026-10-16: "all such equations shall be rendered through KaTeX"). Checked to compile.
   */
  tex?: string;
  color?: string;
  /** Written small ABOVE this token (a condition over the reaction arrow: "light", "Δ"). */
  on?: string;
};
export type EquationStep = {
  s: number;
  /** The token ids in reading order for this step. Tokens not listed are hidden in this step. */
  order: string[];
  /** Token ids drawn in emphasis during this step. */
  highlight?: string[];
  /** A short caption under the equation for this step. */
  caption?: string;
};
export type EquationStage = {
  kind: "equation";
  tokens: EquationToken[];
  steps: EquationStep[];
  /**
   * WORKING BESIDE ITS FIGURE (owner, 2026-10-22: "no graphs or drawings … while showing the working"):
   * the code-drawn figure the working is about, drawn on the left while the lines are written on the
   * right (lib/canvas/layout.ts). Only a registered component.
   */
  figure?: FigureStage;
  /** A course lesson's working beside a gpt-image-2 picture instead of a code figure (owner, 2026-10-24). */
  picture?: IllustrationStage;
};

export type GraphCurve = { id: string; expr: string; label?: string; color?: string; s: number };
export type GraphMarker = {
  id: string;
  /** x position, an expression over the try-it variables (e.g. "light"). */
  x: string;
  /** The curve the marker rides on. */
  curve: string;
  label?: string;
  s: number;
};
export type GraphGuide = { id: string; x: number; label: string; s: number };
export type GraphStage = {
  kind: "graph";
  /**
   * A SHAPE GRAPH: the curve's form (rise, peak, fall) with no numbered ticks — for a curve Aria
   * describes without numbers. Its coordinates only draw the shape; the student sees axis names and
   * named points (owner, 2026-10-18: "named points, no ticks").
   */
  qualitative?: boolean;
  x: { label: string; min: number; max: number };
  y: { label: string; min: number; max: number };
  curves: GraphCurve[];
  markers?: GraphMarker[];
  guides?: GraphGuide[];
  /** A dot traces this curve from left to right over the sentence it is revealed on. */
  trace?: { curve: string; s: number };
};

export type CompareItem = { id: string; text: string; s: number };
export type CompareStage = {
  kind: "compare";
  left: { id: string; title: string; icon?: CanvasIcon; color?: string; items: CompareItem[] };
  right: { id: string; title: string; icon?: CanvasIcon; color?: string; items: CompareItem[] };
  /** Pairs of item ids that mirror each other, joined by a link. */
  links?: Array<{ from: string; to: string }>;
};

export type SceneItem = {
  id: string;
  kind: "icon" | "box" | "text";
  icon?: CanvasIcon;
  label?: string;
  /** A box's one or two lines of content under its title ("+ random sample: representative"). */
  detail?: string;
  /** Grid cell on a 6 x 4 stage grid, column A-F then row 1-4, e.g. "B2". */
  cell: string;
  /** Cells covered, "2x1" = two wide, one tall. */
  span?: string;
  color?: string;
  s: number;
  becomes?: Becomes;
};
export type SceneStage = {
  kind: "scene";
  items: SceneItem[];
  arrows: FlowArrow[];
};

export type MoleculeAtom = {
  id: string;
  element: string;
  /** Deterministic model-space coordinates, each clamped to -1..1. */
  x: number;
  y: number;
  z: number;
  lonePairs?: number;
  color?: string;
};
export type MoleculeBond = { from: string; to: string; order: 1 | 2 | 3; style?: "line" | "wedge" | "dash" };
export type MoleculeStage = {
  kind: "molecule";
  molecules: Array<{
    id: string;
    label: string;
    geometry: string;
    bondAngle?: string;
    atoms: MoleculeAtom[];
    bonds: MoleculeBond[];
    s: number;
  }>;
};

export type AtomMapGroup = { id: string; label: string; atoms: Array<{ element: string; count: number }>; s: number };
export type AtomMapStage = {
  kind: "atom-map";
  reactants: AtomMapGroup[];
  products: AtomMapGroup[];
  /** Energy is deliberately rendered on a separate lane from conserved matter. */
  energy?: { input: string; output: string; s: number };
};

/**
 * A PROGRAM, WALKED THROUGH. The listing is shown whole; each step lights the lines Aria is talking
 * about while an execution pointer moves to them, so the narration and the code advance together.
 * A trace shows what the variables hold as it runs; the output is what it prints.
 */
/**
 * ONE CALL ON THE CALL STACK (2026-10-20, from the Visuals Lab): a recursive function's calls drawn as
 * one box each, newest at the bottom, finished ones crossed out. `value` is what the call is doing or
 * gives back: "n = 4 · waits for 4 × ?" then "returns 24". A step's `stack` lists the calls still
 * running after its lines, first call first (lib/canvas/validate.ts checks one push or pop at a time).
 */
export type StackFrame = { call: string; value?: string };

export type CodeStage = {
  kind: "code";
  language: string;
  /** The listing, one string per line, indentation kept — its FINAL form. */
  lines: string[];
  /**
   * On sentence `s`, lines (1-based) are lit and the pointer sits on the first; `note` is said beside
   * it; `state` is what the variables hold once those lines have run (the Variables panel).
   */
  steps: Array<{ s: number; lines: number[]; note?: string; state?: Array<{ name: string; value: string }>; ops?: DsOp[]; stack?: StackFrame[] }>;
  /**
   * A DATA STRUCTURE beside the code (2026-10-15): the tree, list or array the program works on, in
   * its starting form; each step's `ops` are what those lines just did to it, so the structure changes
   * as Aria walks the code (lib/canvas/structure.ts).
   */
  structure?: DsStart;
  /** "build" (default): the code writes itself as Aria reaches each line. "all": shown whole at once. */
  reveal?: "build" | "all";
  /** Subgoal labels: chunks of lines named by what they do ("set up", "check", "update"). */
  groups?: Array<{ from: number; to: number; label: string; s: number }>;
  /** A line that reads `from` until sentence `s`, then turns into its final text — a bug becoming its fix. */
  edits?: Array<{ s: number; line: number; from: string }>;
  trace?: { vars: string[]; rows: Array<{ s: number; values: string[] }> };
  output?: { s: number; text: string };
};

/**
 * AN EXAM QUESTION ANSWERED FOR FULL MARKS: the question as the paper sets it with its marks, the
 * command word picked out, each marking point ticked as Aria says it, and the mistake that loses
 * marks. Built from the lesson's mark scheme by code (lib/canvas/examBoard.ts), never invented.
 */
export type ExamStage = {
  kind: "exam";
  commandWord: string;
  question: string;
  marks: number;
  /** One per mark, in mark-scheme wording, each revealed on the sentence that says it. */
  points: Array<{ id: string; text: string; s: number }>;
  lostMarks?: { id: string; text: string; s: number };
  /** "levels": the rows are level bands of an essay mark scheme, not one mark each. */
  scheme?: "points" | "levels";
};

/**
 * A DATA STRUCTURE drawn as itself — a tree of nodes and edges, a linked list, an array, a stack, a
 * queue, a graph (owner's direction, 2026-10-15: "DSA should be taught with the tree on the board,
 * and with code how the change occurs on the tree"). The model writes the starting structure and,
 * per step, small operations; lib/canvas/structure.ts applies them, checks the result is still a
 * valid structure (a BST stays ordered) and lays every frame out.
 */
export type DsKind = "tree" | "list" | "array" | "stack" | "queue" | "graph";
export type DsMark = "visit" | "compare" | "found" | "remove" | "done" | "none";
export type DsNode = { id: string; value: string };
export type DsEdge = { from: string; to: string; side?: "left" | "right"; label?: string };
export type DsPointer = { name: string; to: string | null };
export type DsStart = {
  kind: DsKind;
  /** What rules the structure keeps: a binary search tree stays ordered, a heap keeps its order. */
  variant?: "bst" | "avl" | "heap" | "binary" | "directed";
  nodes: DsNode[];
  edges: DsEdge[];
  pointers?: DsPointer[];
};
export type DsOp =
  | { op: "add"; id: string; value: string; parent?: string; side?: "left" | "right"; at?: number }
  | { op: "remove"; id: string }
  | { op: "link"; from: string; to: string; side?: "left" | "right"; label?: string }
  | { op: "unlink"; from: string; to: string }
  | { op: "set"; id: string; value: string }
  | { op: "swap"; a: string; b: string }
  | { op: "point"; name: string; to: string | null }
  | { op: "mark"; id: string; as: DsMark };

/** A board that is the structure alone: what a BST is, how a queue is arranged, a traversal's order. */
export type StructureStage = {
  kind: "structure";
  structure: DsStart;
  /** `state`: what the algorithm keeps beside the structure (the queue, the visited set) after that step, drawn in pencil. */
  steps: Array<{ s: number; ops?: DsOp[]; note?: string; state?: Array<{ name: string; value: string }> }>;
};

export type StageSpec = FlowStage | IllustrationStage | EquationStage | GraphStage | CompareStage | SceneStage | CodeStage | MoleculeStage | AtomMapStage | FigureStage | StructureStage | ExamStage | DiagramStage | SketchStage;

/**
 * A SKETCH BOARD (owner, 2026-10-20: "why can't I get these visuals generated live"): a maths or
 * computer-science board written the Visuals Lab's way, live for any topic. The model says WHAT goes
 * on the board and on which sentence — lines of writing, worked maths, shapes on a small grid that can
 * appear, move and turn, a graph whose curve can slide, a table, a box, code — and code decides where
 * everything goes (lib/canvas/layout.ts layoutSketch) and the marker writes it (MarkerWriter).
 * Colours are names, one per quantity, so the same thing is the same colour everywhere.
 */
export type SketchColor = "ink" | "muted" | "blue" | "orange" | "green" | "pink" | "yellow";
export type SketchCol = "left" | "right" | "full";
export type SketchShape = {
  id: string;
  kind: "rect" | "poly" | "circle" | "line" | "arrow" | "label";
  s: number;
  /** Grid points for poly, line and arrow. */
  points?: Array<[number, number]>;
  /** rect: corner x, y and size w, h; circle: centre x, y and radius r; label: where it is written. */
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  r?: number;
  color?: SketchColor;
  fill?: boolean;
  dashed?: boolean;
  /** Written at the shape's centre (or at x, y for a label). */
  label?: string;
  /** On sentence s the shape slides by (dx, dy) grid units, turning `rotate` degrees about its centre. */
  move?: { s: number; dx: number; dy: number; rotate?: number };
  /** The sentence on which it fades away (a gap that is filled, a step that is replaced). */
  hide?: number;
  /**
   * Set by layout, never by the writer: where its label is written (grid units, the label's centre)
   * and how big (px) — inside the shape, beside a line, or outside a shape too small to hold it.
   */
  labelAt?: { x: number; y: number; size: number };
};
/** Where an item sits on the board, on a 12 × 8 grid (x, y = top-left; w, h = size). Code keeps items apart. */
export type SketchAt = { x: number; y: number; w: number; h: number };
type SketchBase = { id: string; s: number; col?: SketchCol; at?: SketchAt };
export type SketchItem =
  | (SketchBase & { type: "text"; text: string; size?: "big" | "normal" | "small"; color?: SketchColor })
  | (SketchBase & { type: "math"; lines: Array<{ s: number; tex: string; label?: string }>; size?: "big" | "normal" })
  | (SketchBase & { type: "shapes"; grid: { w: number; h: number }; shapes: SketchShape[]; showGrid?: boolean })
  | (SketchBase & {
      type: "graph";
      x: [number, number];
      y: [number, number];
      curves: Array<{ id: string; expr: string; color?: SketchColor; s: number; dashed?: boolean; label?: string; shift?: { s: number; dx: number; dy: number } }>;
      points?: Array<{ id: string; x: number; y: number; label?: string; color?: SketchColor; s: number }>;
    })
  | (SketchBase & { type: "table"; headers: string[]; rows: Array<{ s: number; cells: string[] }> })
  | (SketchBase & { type: "box"; title?: string; text: string; color?: SketchColor })
  | (SketchBase & { type: "code"; language: string; lines: string[]; steps?: Array<{ s: number; line: number; note?: string }> });
export type SketchStage = { kind: "sketch"; items: SketchItem[] };

/** What the pointer (Aria's pen) or the camera does on a sentence. */
export type CanvasCue = {
  s: number;
  /** 0-1, how far into the sentence. */
  at?: number;
  /** "visit" flies the camera back to an EARLIER board for this sentence (the recap's tour). */
  action: "point" | "circle" | "underline" | "zoom" | "unzoom" | "visit";
  target?: string;
  /** For "visit": the beat id of the earlier board. */
  beat?: string;
};

export type TryItControl = { var: string; label: string; min: number; max: number; step?: number; value: number; unit?: string };
export type TryItReaction = { when: string; say: string };
export type TryItInteraction = {
  kind: "try";
  prompt: string;
  controls: TryItControl[];
  /** Checked in order after the student lets go of a slider; the first new match is spoken. */
  reactions: TryItReaction[];
  /** Live numbers shown under the sliders, e.g. { label: "Oxygen made", expr: "rate(light)", unit: "bubbles/min" }. */
  readouts?: Array<{ label: string; expr: string; unit?: string }>;
};
export type DrawInteraction = {
  kind: "draw";
  prompt: string;
  /** What a correct drawing shows, for the checker. */
  expect: string;
};
/**
 * A question with an answer the student commits to before being told — a prediction ("what happens
 * if…?") or a check. Every option carries its own feedback, so a wrong answer is explained, not
 * just marked.
 */
export type QuizInteraction = {
  kind: "quiz";
  question: string;
  /**
   * HOW THE STUDENT ANSWERS (owner, 2026-10-18: "more interactive"): "choice" taps an option on the
   * card; "tap" taps the part on the board itself (each option's `target`), its label hidden as "?"
   * until answered; "order" puts the board's steps in order (`steps`, right order first to last).
   */
  mode?: "choice" | "tap" | "order";
  options: Array<{ text: string; correct: boolean; feedback: string; target?: string }>;
  steps?: Array<{ id: string; text: string }>;
  /** The steps go round a loop (a cycle): any starting step is right if the order round is. */
  loop?: boolean;
  /** A nudge, not the answer: Aria says `text` while the pen points at `target` on the board. */
  hint?: { text: string; target?: string };
  /** "Show me again": the sentence that taught the answer, said again with the pen on `target`. */
  replay?: { text: string; target?: string };
  /**
   * A "Check it" card (lib/canvas/checkCard.ts): written after the board, verified independently,
   * shown when Aria finishes the board. Cards without it are the old mid-board "Predict it" ones,
   * which are never shown.
   */
  check?: boolean;
};
export type CanvasInteraction = TryItInteraction | DrawInteraction | QuizInteraction;

export type CanvasBoardSpec = {
  v: 1;
  /** The course lesson's subject (lib/canvas/lessonSubject.ts), so the player never guesses it; absent elsewhere. */
  subject?: import("./lessonSubject").LessonSubject;
  heading: string;
  notes: CanvasNote[];
  stage: StageSpec;
  cues: CanvasCue[];
  /** Ids of elements that fly in from the previous panel, where an element with the same id sits. */
  carry?: string[];
  /** This panel sits inside element `id` of the earlier panel for beat `beat`. */
  inside?: { beat: string; id: string };
  interaction?: CanvasInteraction;
  /** Frame the whole lesson when this board finishes — the recap's zoom-out. */
  overview?: boolean;
  /** A short refresher of a prerequisite, before the topic proper (lib/knowledge). */
  refresher?: boolean;
  /** A planned rich visual could not be produced, so the student sees a simpler grounded diagram. */
  visualFallback?: {
    from: "illustration";
    reason: "budget" | "generation" | "validation" | "storage";
    message: string;
  };
};

/** The draw op a canvas beat carries (Beat.draw.ops). */
export type CanvasBoardOp = {
  kind: "canvasBoard";
  spec: CanvasBoardSpec;
  at: 0;
  endAt: 1;
};

/** One board of a canvas lecture as the plan writes it, before its spec is written. */
export type CanvasPlanBeat = {
  id: string;
  /** A course lesson's board (set by the visual policy): its pictures are drawn by gpt-image-2 (lib/canvas/courseFigures.ts). */
  course?: boolean;
  /** A course lesson's subject, decided once from its course (lib/canvas/lessonSubject.ts); absent elsewhere. */
  subject?: import("./lessonSubject").LessonSubject;
  /** A course working board with a gpt-image-2 picture beside its lines, where a code figure stood (lib/canvas/courseFigures.ts). */
  pictureBeside?: boolean;
  /**
   * A typed-prompt or PDF maths lecture's board that needs a drawing no code figure fits: drawn by
   * gpt-image-2 white on black (lib/canvas/mathsPicture.ts, owner 2026-10-25). Never set in a course lesson.
   * On a working board: the picture goes beside the working.
   */
  mathsPicture?: boolean;
  /**
   * A code-figure or sketch board of a typed-prompt or PDF maths lecture: rejected ONCE for its drawing,
   * it is drawn the second time by gpt-image-2 and shown (owner, 2026-10-26: "if it's rejected one time I
   * want it to display the second time"). Never set in a course lesson.
   */
  mathsPictureFallback?: boolean;
  /** That second drawing: the gpt-image-2 picture is shown as drawn — no check refuses it, no redraw. */
  mathsPictureAsDrawn?: boolean;
  /** A course board with nothing to see: Aria's notes written as she speaks, no picture (lib/canvas/fallback.ts). */
  written?: boolean;
  title: string;
  script: string;
  stage: CanvasStage;
  brief: string;
  objects: string[];
  inside: { beat: string; object: string } | null;
  carry: string[];
  interaction: "try" | "draw" | "quiz" | null;
  /** Phase 4: sentence positions for the teach → predict → reveal → transfer rhythm. */
  teachingCycle?: { teach: number; predict: number; reveal: number; transfer: number };
  overview: boolean;
  /** A close-up inside one card of the board before it (lib/canvas/cardDives.ts): no check card stops a dive. */
  dive?: boolean;
  /** A short board refreshing a prerequisite the student is shaky on, before the topic proper. */
  refresher?: boolean;  /** How to pitch the board for this student (lib/teachingPolicy.ts policyForBoards), set after planning. */
  audience?: string;
  /** A "figure" board: the code-drawn component it uses (lib/figures/registry.ts), or "library", chosen by the visual policy. */
  figure?: string;
  /**
   * The diagram the PLANNER chose for this board from the catalogue (lib/canvas/prompts.ts), before
   * the script was written around it. The visual policy honours it when it fits the board's words.
   */
  plannedFigure?: string;
  /**
   * The KIND of visual the planner says this board needs (lib/canvas/prompts.ts), whatever the subject:
   * a thing (a checked picture), a quantity (a graph), math, a sequence (a flow), a comparison (a
   * table) or a concept (notes). The visual policy follows it last (owner, 2026-10-17: routing by
   * word lists never generalised).
   */
  visualType?: "thing" | "diagram" | "quantity" | "math" | "sequence" | "comparison" | "concept";
  /**
   * What Aria writes on the board as she speaks (owner, 2026-10-17: "whatever Aria speaks, at least
   * 60–80% should appear on the board"): the planner's short phrase for a sentence, shown on exactly
   * that sentence in the notes column.
   */
  boardNotes?: Array<{ s: number; text: string }>;
  /** Diagrams the board review rejected for this board: no rule may demand them again on a rebuild. */
  rejectedFigures?: string[];
  /** figure "library": the textbook diagram chosen for this board (lib/figures/library.ts) — its parts are what the board may label. */
  figureAsset?: { id: string; w: number; h: number; credit: string; parts: Array<{ id: string; name: string; anchor: { x: number; y: number } }> };
  /** Curriculum Phase 3: deterministic visual obligations attached after the model plan. */
  requiredVisual?: { stages: string[]; mustShow: string[] };
  /**
   * A lesson taught from the student's PDF (reference mode): the pages this board teaches from and,
   * for a code board, which of the document's listings it shows and which of its printed lines
   * (lib/canvas/documentContext.ts). Absent on a typed-prompt lesson.
   */
  source?: { pages: number[]; listing?: number; lines?: [number, number]; blocks?: string[] };
  /**
   * Strict-mode PDF and video lessons (lib/canvas/sourceLessons.ts): for each sentence of the
   * script, the source block it is about — the PDF panel boxes that passage while it is spoken.
   */
  sentenceBlocks?: string[];
};

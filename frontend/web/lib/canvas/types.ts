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

export const CANVAS_STAGES = ["illustration", "flow", "equation", "graph", "compare", "scene"] as const;
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
};

export type EquationToken = {
  id: string;
  text: string;
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

export type StageSpec = FlowStage | IllustrationStage | EquationStage | GraphStage | CompareStage | SceneStage;

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
  options: Array<{ text: string; correct: boolean; feedback: string }>;
};
export type CanvasInteraction = TryItInteraction | DrawInteraction | QuizInteraction;

export type CanvasBoardSpec = {
  v: 1;
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
  title: string;
  script: string;
  stage: CanvasStage;
  brief: string;
  objects: string[];
  inside: { beat: string; object: string } | null;
  carry: string[];
  interaction: "try" | "draw" | "quiz" | null;
  overview: boolean;
};

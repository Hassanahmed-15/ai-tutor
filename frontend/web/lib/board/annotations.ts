/**
 * WHAT THE STUDENT DREW, KEPT.
 *
 * Annotations used to have a lifetime of one beat: `useEffect(() => setHighlightStrokes([]), [beat.id])`
 * wiped every highlight the moment the lecture advanced, pen ink was destroyed when the tool closed,
 * neither survived to the PDF export, and there was no undo — one wrong stroke meant clear-all. A
 * student who annotated a diagram and then let the lecture continue lost the work silently.
 *
 * Marks now belong to the CONCEPT they were drawn on. Leave a board and come back and your marks
 * are where you left them, which is what a notebook does and what the "persist per concept" choice
 * asks for.
 *
 * COORDINATES ARE NORMALISED TO THE BOARD'S CONTENT BOX, not to the element and not to screen
 * pixels. The old pen canvas stored raw screen coordinates, so a mark made in one window size
 * landed somewhere else relative to the diagram after a resize; the old highlighter normalised to
 * the element box, which drifts as soon as the aspect ratio changes. `lib/board/geometry.ts` maps
 * between the two, and everything here is in board space: 0..1 across the actual drawing.
 *
 * Pure and serialisable — no canvas, no DOM — so it can be tested, undone, and written to the
 * export without a browser.
 */

export type AnnotationKind = "pen" | "highlight";

export interface AnnotationPoint {
  /** 0..1 across the board's content box. */
  x: number;
  y: number;
}

export interface AnnotationStroke {
  id: string;
  kind: AnnotationKind;
  color: string;
  /** Board-space width, scaled by the renderer to the current size. */
  width: number;
  points: AnnotationPoint[];
  /** Any board text the stroke passed over, so Aria can be asked about it by name. */
  coveredText?: string;
}

/** Every concept's marks, keyed by beat id. */
export type AnnotationsByBoard = Record<string, AnnotationStroke[]>;

export interface AnnotationState {
  boards: AnnotationsByBoard;
  /** Undo history, newest last. Bounded — see MAX_HISTORY. */
  past: Array<{ boardId: string; boards: AnnotationsByBoard }>;
  future: Array<{ boardId: string; boards: AnnotationsByBoard }>;
}

/**
 * Deep enough to cover a page of annotation, shallow enough that the state stays small. Each entry
 * is a shallow copy of the board map, so the cost is one array per undo step, not one canvas.
 */
const MAX_HISTORY = 50;

export const EMPTY_ANNOTATIONS: AnnotationState = { boards: {}, past: [], future: [] };

export function strokesFor(state: AnnotationState, boardId: string): AnnotationStroke[] {
  return state.boards[boardId] ?? [];
}

export function hasMarks(state: AnnotationState, boardId: string): boolean {
  return strokesFor(state, boardId).length > 0;
}

function remember(state: AnnotationState, boardId: string): Pick<AnnotationState, "past" | "future"> {
  const past = [...state.past, { boardId, boards: state.boards }].slice(-MAX_HISTORY);
  // Any new edit abandons the redo branch — the standard undo contract, and the one users expect.
  return { past, future: [] };
}

export function addStroke(state: AnnotationState, boardId: string, stroke: AnnotationStroke): AnnotationState {
  const boards = { ...state.boards, [boardId]: [...strokesFor(state, boardId), stroke] };
  return { boards, ...remember(state, boardId) };
}

/**
 * The eraser. Removes whole strokes the eraser passed over rather than punching transparent holes
 * in a bitmap — that is what makes undo meaningful and what lets the export reproduce the marks.
 */
export function eraseAt(
  state: AnnotationState,
  boardId: string,
  at: AnnotationPoint,
  radius: number,
): AnnotationState {
  const current = strokesFor(state, boardId);
  const survivors = current.filter((stroke) => !strokeTouches(stroke, at, radius));
  if (survivors.length === current.length) return state; // nothing erased: do not spend an undo step
  return { boards: { ...state.boards, [boardId]: survivors }, ...remember(state, boardId) };
}

export function clearBoard(state: AnnotationState, boardId: string): AnnotationState {
  if (!hasMarks(state, boardId)) return state;
  return { boards: { ...state.boards, [boardId]: [] }, ...remember(state, boardId) };
}

export function undo(state: AnnotationState): AnnotationState {
  const previous = state.past[state.past.length - 1];
  if (!previous) return state;
  return {
    boards: previous.boards,
    past: state.past.slice(0, -1),
    future: [{ boardId: previous.boardId, boards: state.boards }, ...state.future].slice(0, MAX_HISTORY),
  };
}

export function redo(state: AnnotationState): AnnotationState {
  const [next, ...rest] = state.future;
  if (!next) return state;
  return {
    boards: next.boards,
    past: [...state.past, { boardId: next.boardId, boards: state.boards }].slice(-MAX_HISTORY),
    future: rest,
  };
}

export function canUndo(state: AnnotationState): boolean {
  return state.past.length > 0;
}

export function canRedo(state: AnnotationState): boolean {
  return state.future.length > 0;
}

/** Everything the student marked, for the PDF export — which never received annotations before. */
export function annotationSummary(state: AnnotationState): Array<{ boardId: string; strokes: number; text: string }> {
  return Object.entries(state.boards)
    .filter(([, strokes]) => strokes.length > 0)
    .map(([boardId, strokes]) => ({
      boardId,
      strokes: strokes.length,
      text: [...new Set(strokes.map((s) => s.coveredText ?? "").filter(Boolean))].join(" · "),
    }));
}

function strokeTouches(stroke: AnnotationStroke, at: AnnotationPoint, radius: number): boolean {
  const r2 = radius * radius;
  for (const point of stroke.points) {
    const dx = point.x - at.x;
    const dy = point.y - at.y;
    if (dx * dx + dy * dy <= r2) return true;
  }
  return false;
}

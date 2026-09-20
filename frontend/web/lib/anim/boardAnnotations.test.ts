/**
 * The student's own marks, and where they land.
 *
 * Both halves fix observed losses: annotations were wiped on every beat change and never saved, and
 * their coordinates drifted away from the diagram whenever the window changed shape, because they
 * were stored against the element box rather than the drawing inside it.
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  addStroke,
  annotationSummary,
  canRedo,
  canUndo,
  clearBoard,
  EMPTY_ANNOTATIONS,
  eraseAt,
  hasMarks,
  redo,
  strokesFor,
  undo,
  type AnnotationStroke,
} from "../board/annotations";
import {
  AUTHORED_HEIGHT,
  AUTHORED_WIDTH,
  contentBox,
  fillFrame,
  toBoardSpace,
  toContainerSpace,
  withinBoard,
} from "../board/geometry";

const stroke = (id: string, points: Array<[number, number]>, kind: "pen" | "highlight" = "pen"): AnnotationStroke => ({
  id,
  kind,
  color: "#f59e0b",
  width: 0.004,
  points: points.map(([x, y]) => ({ x, y })),
});

// --- Persistence ---------------------------------------------------------------------------

test("THE LOSS: marks belong to their concept and survive moving away and back", () => {
  // Previously: setHighlightStrokes([]) on every beat.id change, silently.
  let state = addStroke(EMPTY_ANNOTATIONS, "beat-1", stroke("a", [[0.2, 0.2]]));
  state = addStroke(state, "beat-2", stroke("b", [[0.6, 0.6]]));
  assert.equal(strokesFor(state, "beat-1").length, 1, "beat 1's marks must survive beat 2 being drawn on");
  assert.equal(strokesFor(state, "beat-2").length, 1);
  assert.equal(strokesFor(state, "beat-3").length, 0, "an unmarked board is simply empty");
});

test("undo brings back a stroke, and redo takes it away again", () => {
  // Previously there was no undo at all — one wrong stroke meant clear-all.
  let state = addStroke(EMPTY_ANNOTATIONS, "b", stroke("a", [[0.1, 0.1]]));
  state = addStroke(state, "b", stroke("second", [[0.5, 0.5]]));
  assert.equal(strokesFor(state, "b").length, 2);

  state = undo(state);
  assert.equal(strokesFor(state, "b").length, 1, "undo removes the last stroke");
  assert.equal(canRedo(state), true);

  state = redo(state);
  assert.equal(strokesFor(state, "b").length, 2, "redo puts it back");
});

test("a new stroke abandons the redo branch", () => {
  let state = addStroke(EMPTY_ANNOTATIONS, "b", stroke("a", [[0.1, 0.1]]));
  state = undo(state);
  state = addStroke(state, "b", stroke("different", [[0.9, 0.9]]));
  assert.equal(canRedo(state), false, "redoing into an abandoned branch would resurrect deleted work");
});

test("undo on an untouched board is a no-op, not a crash", () => {
  assert.equal(canUndo(EMPTY_ANNOTATIONS), false);
  assert.deepEqual(undo(EMPTY_ANNOTATIONS), EMPTY_ANNOTATIONS);
  assert.deepEqual(redo(EMPTY_ANNOTATIONS), EMPTY_ANNOTATIONS);
});

test("the eraser removes whole strokes, so erasing is undoable", () => {
  // A bitmap eraser punches transparent holes, which cannot be undone or exported.
  let state = addStroke(EMPTY_ANNOTATIONS, "b", stroke("near", [[0.5, 0.5]]));
  state = addStroke(state, "b", stroke("far", [[0.9, 0.9]]));
  state = eraseAt(state, "b", { x: 0.51, y: 0.51 }, 0.05);
  assert.deepEqual(strokesFor(state, "b").map((s) => s.id), ["far"]);
  state = undo(state);
  assert.equal(strokesFor(state, "b").length, 2, "an erase must be undoable");
});

test("erasing empty space does not consume an undo step", () => {
  const state = addStroke(EMPTY_ANNOTATIONS, "b", stroke("a", [[0.1, 0.1]]));
  const after = eraseAt(state, "b", { x: 0.9, y: 0.9 }, 0.02);
  assert.equal(after, state, "a no-op erase must not push history");
});

test("clearing one board leaves every other board alone", () => {
  let state = addStroke(EMPTY_ANNOTATIONS, "b1", stroke("a", [[0.1, 0.1]]));
  state = addStroke(state, "b2", stroke("b", [[0.2, 0.2]]));
  state = clearBoard(state, "b1");
  assert.equal(hasMarks(state, "b1"), false);
  assert.equal(hasMarks(state, "b2"), true);
  assert.equal(strokesFor(undo(state), "b1").length, 1, "clear is undoable");
});

test("the export can see what was marked, which it never could before", () => {
  let state = addStroke(EMPTY_ANNOTATIONS, "b1", { ...stroke("a", [[0.1, 0.1]], "highlight"), coveredText: "gradient descent" });
  state = addStroke(state, "b2", stroke("b", [[0.2, 0.2]]));
  const summary = annotationSummary(state);
  assert.equal(summary.length, 2);
  assert.equal(summary.find((s) => s.boardId === "b1")?.text, "gradient descent");
});

// --- Geometry ------------------------------------------------------------------------------

test("THE DRIFT: a mark stays on the same part of the diagram when the window changes shape", () => {
  // Stored against the element box, a mark beside a label moved away from that label on resize.
  const wide = { left: 0, top: 0, width: 1600, height: 600 };
  const point = toBoardSpace(800, 300, wide); // dead centre of a wide window
  assert.ok(Math.abs(point.x - 0.5) < 1e-9 && Math.abs(point.y - 0.5) < 1e-9);

  // The same board-space point, drawn into a tall window, must still be centred on the content.
  const back = toContainerSpace(point, 900, 1200);
  const box = contentBox(900, 1200);
  assert.ok(Math.abs(back.x - (box.x + box.width / 2)) < 1e-9);
  assert.ok(Math.abs(back.y - (box.y + box.height / 2)) < 1e-9);
});

test("round-tripping a mark through any container size is lossless", () => {
  for (const [w, h] of [[1600, 900], [1280, 1024], [800, 1400], [2560, 1080]]) {
    const original = { x: 0.23, y: 0.77 };
    const px = toContainerSpace(original, w, h);
    const back = toBoardSpace(px.x, px.y, { left: 0, top: 0, width: w, height: h });
    assert.ok(Math.abs(back.x - original.x) < 1e-9 && Math.abs(back.y - original.y) < 1e-9, `${w}x${h}`);
  }
});

test("the content box is centred and keeps the authored aspect at any window shape", () => {
  for (const [w, h] of [[1600, 900], [1000, 1000], [600, 1200]]) {
    const box = contentBox(w, h);
    assert.ok(Math.abs(box.width / box.height - AUTHORED_WIDTH / AUTHORED_HEIGHT) < 1e-6, `aspect at ${w}x${h}`);
    assert.ok(Math.abs((box.x * 2 + box.width) - w) < 1e-6, "horizontally centred");
    assert.ok(Math.abs((box.y * 2 + box.height) - h) < 1e-6, "vertically centred");
    assert.ok(box.width <= w + 1e-6 && box.height <= h + 1e-6, "never overflows the container");
  }
});

test("the viewBox fills the container, so nothing strands in a letterbox bar", () => {
  const wide = fillFrame(1600, 600);
  assert.ok(Math.abs(wide.width / wide.height - 1600 / 600) < 1e-6, "viewBox matches the container aspect");
  assert.ok(wide.width >= AUTHORED_WIDTH - 1e-6, "authored width stays fully visible");
  assert.ok(Math.abs(wide.x * 2 + wide.width - AUTHORED_WIDTH) < 1e-6, "extra room is symmetric");

  const tall = fillFrame(600, 1200);
  assert.ok(tall.height >= AUTHORED_HEIGHT - 1e-6, "authored height stays fully visible");
});

test("a zero-sized container degrades to the authored frame rather than dividing by zero", () => {
  assert.deepEqual(fillFrame(0, 0), { x: 0, y: 0, width: AUTHORED_WIDTH, height: AUTHORED_HEIGHT });
  assert.deepEqual(contentBox(0, 0), { x: 0, y: 0, width: 0, height: 0 });
});

test("marks made in the margin beside the board are rejected", () => {
  assert.equal(withinBoard({ x: 0.5, y: 0.5 }), true);
  assert.equal(withinBoard({ x: -0.02, y: 0.5 }), false, "left of the drawing");
  assert.equal(withinBoard({ x: 0.5, y: 1.4 }), false, "below the drawing");
});

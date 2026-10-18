import { test } from "node:test";
import assert from "node:assert/strict";
import { drawnFigure } from "../figures/drawn";
import { validateCanvasSpec } from "../canvas/validate";
import { layoutPanel, type Mark } from "../canvas/layout";
import { applyLessonVisualPolicy } from "../canvas/visualPolicy";
import type { CanvasPlanBeat } from "../canvas/types";

export const LEAF = {
  w: 600, h: 400,
  shapes: [
    { t: "curve", closed: true, points: [[80, 200], [200, 90], [380, 80], [520, 190], [380, 310], [200, 310]], fill: "green", part: "blade" },
    { t: "line", x1: 40, y1: 205, x2: 520, y2: 192, width: 3, part: "midrib" },
    { t: "line", x1: 40, y1: 205, x2: 85, y2: 202, width: 4, part: "petiole" },
    { t: "line", x1: 220, y1: 200, x2: 300, y2: 120, width: 1.5, part: "vein" },
    { t: "line", x1: 330, y1: 196, x2: 410, y2: 120, width: 1.5, part: "vein" },
    { t: "line", x1: 230, y1: 200, x2: 300, y2: 280, width: 1.5, part: "vein" },
  ],
  parts: [
    { id: "blade", name: "Leaf blade (lamina)", anchor: { x: 420, y: 250 } },
    { id: "midrib", name: "Midrib", anchor: { x: 450, y: 194 } },
    { id: "petiole", name: "Petiole (leaf stalk)", anchor: { x: 60, y: 204 } },
    { id: "vein", name: "Vein", anchor: { x: 270, y: 150 } },
  ],
};

test("a described diagram becomes an ordinary figure whose labels land on its parts", () => {
  const { drawing, issues } = drawnFigure(LEAF);
  assert.deepEqual(issues, []);
  assert.equal(drawing!.parts.length, 4);
  const spec = validateCanvasSpec({ heading: "A leaf", notes: [], cues: [{ s: 1, action: "point", target: "midrib" }], stage: { kind: "figure", component: "drawn", drawing: LEAF, parts: [{ id: "blade", s: 0 }, { id: "midrib", s: 1 }, { id: "petiole", s: 2 }, { id: "vein", s: 3 }] } }, 5)!;
  assert.equal(spec.stage.kind, "figure");
  const marks = layoutPanel(spec).marks;
  const fig = marks.find((m) => m.type === "figure") as Extract<Mark, { type: "figure" }>;
  for (const l of marks.filter((m): m is Extract<Mark, { type: "figure-label" }> => m.type === "figure-label")) {
    const a = fig.drawing.parts.find((p) => p.id === l.part)!.anchor;
    const end = l.leader[l.leader.length - 1];
    assert.ok(Math.abs(end.x - (fig.rect.x + a.x * fig.scale)) < 0.01, `${l.part} lands on its anchor`);
  }
});

test("the checks: an anchor off its part, a name written into the art (removed), unsafe path data", () => {
  const off = { ...LEAF, parts: LEAF.parts.map((p) => (p.id === "petiole" ? { ...p, anchor: { x: 500, y: 380 } } : p)) };
  assert.match(drawnFigure(off).issues.join(" "), /petiole.*not on its own shapes/);
  const baked = { ...LEAF, shapes: [...LEAF.shapes, { t: "text", x: 300, y: 60, text: "Midrib" }] };
  // A name written into the art is removed (the label engine writes it), not a reason to fail the drawing.
  const repaired = drawnFigure(baked);
  assert.ok(repaired.drawing && !repaired.drawing.shapes.some((sh) => sh.t === "text" && sh.text === "Midrib"));
  const unsafe = { ...LEAF, shapes: [...LEAF.shapes, { t: "path", d: "M0 0 L10 10\"/><script>alert(1)</script>" }] };
  assert.match(drawnFigure(unsafe).issues.join(" "), /path data/);
});

test("a life-science topic without a component or library diagram is never a vector or scene-grammar diagram", () => {
  // (A leaf and a root hair cell now have components; a skeleton has none.)
  const beat = (id: string, title: string, stage: CanvasPlanBeat["stage"]): CanvasPlanBeat => ({ id, title, script: `${title}. Predict: what happens next? It changes.`, stage, brief: title, objects: [], inside: null, carry: [], interaction: "quiz", overview: false });
  const out = applyLessonVisualPolicy([
    beat("b1", "The structure of a skeleton: the skull, ribs and pelvis", "illustration"),
    beat("b2", "Compare inflation and deflation", "compare"),
  ], { mode: "course", aiPictures: false });
  // Life science is never the coordinate vector diagram (owner, 2026-10-17): with pictures off it is a plain board.
  assert.notEqual(out.beats[0].figure, "drawn");
  assert.notEqual(out.beats[0].stage, "diagram");
  assert.equal(out.beats[1].stage, "compare", "abstract boards keep their native board");
  const strict = applyLessonVisualPolicy([beat("b1", "The structure of a leaf: the midrib and veins", "illustration")], { mode: "strict", aiPictures: false });
  assert.notEqual(strict.beats[0].stage, "diagram", "strict mode never invents a diagram");
});

test("a drawn 'diagram' of empty boxes is sent to a flow board", () => {
  const boxes = { w: 600, h: 300, shapes: [0, 1, 2, 3, 4].map((i) => ({ t: "rect", x: 20 + i * 110, y: 100, w: 90, h: 60, part: `p${i}` })), parts: [0, 1, 2, 3, 4].map((i) => ({ id: `p${i}`, name: `Part ${i}`, anchor: { x: 65 + i * 110, y: 130 } })) };
  assert.ok(drawnFigure(boxes).issues.some((i) => i.startsWith("BOX DIAGRAM")));
  // A real structure (a curved outline) is not.
  const organic = { ...boxes, shapes: [...boxes.shapes, { t: "curve", points: [[20, 50], [300, 10], [580, 50]], part: "p0" }] };
  assert.ok(!drawnFigure(organic).issues.some((i) => i.startsWith("BOX DIAGRAM")));
});

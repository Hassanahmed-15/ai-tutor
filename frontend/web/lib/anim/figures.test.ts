import { test } from "node:test";
import assert from "node:assert/strict";
import { FIGURE_COMPONENTS } from "../figures/registry";
import { leadersCross } from "../figures/labels";
import { layoutPanel, type Mark } from "../canvas/layout";
import { validateCanvasSpec } from "../canvas/validate";
import { fallbackSpec } from "../canvas/fallback";

const board = (parts: Array<{ id: string; name?: string; s?: number }>, params: Record<string, unknown> = {}) =>
  validateCanvasSpec({ heading: "Setting up a titration", notes: ["pipette = fixed volume"], cues: [{ s: 1, action: "point", target: "burette" }], stage: { kind: "figure", component: "titration", params, parts } }, 6);

test("every component's parts have anchors inside the drawing, and its declared parts are the drawn parts", () => {
  for (const c of FIGURE_COMPONENTS) {
    const d = c.build({});
    // A figure draws only parts it declares; some parts exist only for some params (a shaded region, a third set).
    const declared = new Set(c.parts.map((p) => p.id));
    assert.ok(d.parts.every((p) => declared.has(p.id)) && d.parts.length >= 2, c.name);
    for (const p of d.parts) assert.ok(p.anchor.x >= 0 && p.anchor.x <= d.w && p.anchor.y >= 0 && p.anchor.y <= d.h, `${c.name}.${p.id} anchor is inside`);
    for (const sh of d.shapes) if (sh.part) assert.ok(d.parts.some((p) => p.id === sh.part), `${c.name} shape names unknown part ${sh.part}`);
  }
});

test("a figure board validates, keeps only the component's parts, and every label lands on its part's exact anchor", () => {
  const spec = board([{ id: "burette", name: "Burette (hydrochloric acid)", s: 0 }, { id: "tap", s: 1 }, { id: "conical-flask", s: 2 }, { id: "white-tile", s: 3 }, { id: "made-up", s: 3 }, { id: "clamp", s: 4 }, { id: "jet", s: 4 }]);
  assert.ok(spec && spec.stage.kind === "figure");
  if (spec?.stage.kind !== "figure") return;
  assert.ok(!spec.stage.parts.some((p) => p.id === "made-up"), "unknown parts are dropped");
  assert.equal(spec.cues.length, 1, "a cue may point at a part");
  const layout = layoutPanel(spec);
  const fig = layout.marks.find((m) => m.type === "figure") as Extract<Mark, { type: "figure" }>;
  const labels = layout.marks.filter((m): m is Extract<Mark, { type: "figure-label" }> => m.type === "figure-label");
  assert.equal(labels.length, spec.stage.parts.length);
  for (const l of labels) {
    const part = fig.drawing.parts.find((p) => p.id === l.part)!;
    const end = l.leader[l.leader.length - 1];
    assert.ok(Math.abs(end.x - (fig.rect.x + part.anchor.x * fig.scale)) < 0.01 && Math.abs(end.y - (fig.rect.y + part.anchor.y * fig.scale)) < 0.01, `${l.part} leader ends on its anchor`);
    assert.ok(layout.targets[l.part], `${l.part} is a pen target`);
  }
  // Textbook rules: no two leaders cross; no two labels overlap; every label is outside the figure.
  for (let i = 0; i < labels.length; i++) for (let j = i + 1; j < labels.length; j++) assert.ok(!leadersCross(labels[i].leader, labels[j].leader), `${labels[i].part} × ${labels[j].part}`);
  for (const l of labels) assert.ok(l.side === "left" ? l.at.x <= fig.rect.x : l.at.x >= fig.rect.x + fig.rect.w, `${l.part} sits in a margin`);
});

test("the figure follows the chemistry it is given: end-point colour, contents, a falling drop", () => {
  const titration = FIGURE_COMPONENTS.find((c) => c.name === "titration")!;
  const d = titration.build({ titrant: "hydrochloric acid", analyte: "NaOH + phenolphthalein", flaskColour: "colourless", drop: true });
  assert.equal(d.parts.find((p) => p.id === "titrant")!.name, "hydrochloric acid");
  assert.ok(d.shapes.some((s) => s.part === "analyte" && s.fill === "#e6f2f8"), "colourless at the end-point");
  assert.ok(d.shapes.some((s) => s.t === "circle" && s.part === "jet"), "a drop leaves the jet");
});

test("a failed figure board still draws the figure, labelled across the narration", () => {
  const spec = fallbackSpec({ id: "b1", title: "Setting up the titration", script: "One. Two. Three. Four.", stage: "figure", figure: "titration", brief: "", objects: [], inside: null, carry: [], interaction: null, overview: false });
  assert.equal(spec.stage.kind, "figure");
  assert.ok(spec.stage.kind === "figure" && spec.stage.parts.length >= 3);
});

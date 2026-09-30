import test from "node:test";
import assert from "node:assert/strict";
import { compileExpr, evalExpr, exprUsesOnly } from "../canvas/expr";
import { validateCanvasSpec, validateInteraction } from "../canvas/validate";
import { layoutPanel, placePanels, toWorld, type Rect } from "../canvas/layout";
import { fitView, flightMs, viewAt } from "../canvas/camera";
import { activeCues } from "../canvas/cues";
import { describeCanvasSpec } from "../canvas/describe";
import { PANEL_H, PANEL_W, type CanvasBoardSpec } from "../canvas/types";

/* ── the expression language ──────────────────────────────────────────────────────────────── */

test("expressions evaluate maths, comparisons and functions without eval", () => {
  assert.equal(evalExpr("40 * x / (25 + x)", { x: 25 }), 20);
  assert.equal(evalExpr("2 ^ 3 ^ 2", {}), 512);
  assert.equal(evalExpr("-x + 3", { x: 1 }), 2);
  assert.equal(evalExpr("light > 70 && co2 < 30", { light: 80, co2: 10 }), 1);
  assert.equal(evalExpr("light < 20 ? 0 : 1", { light: 5 }), 0);
  assert.equal(evalExpr("clamp(x, 0, 1)", { x: 4 }), 1);
  assert.ok(Math.abs(evalExpr("100 * (1 - exp(-x / 25))", { x: 25 }) - 63.2) < 0.1);
});

test("anything that is not an expression is refused, never executed", () => {
  for (const bad of ["alert(1)", "x => x", "constructor.constructor('x')()", "x;y", "[1,2]", "", "1 +"]) {
    assert.equal(compileExpr(bad), null, bad);
  }
  assert.ok(Number.isNaN(evalExpr("unknownVar * 2", {})));
  assert.equal(evalExpr("unknownVar * 2", {}, 7), 7);
});

test("an expression may only read the board's own variables", () => {
  assert.ok(exprUsesOnly("light / 100", ["light"]));
  assert.ok(!exprUsesOnly("light * temp", ["light"]));
  assert.ok(exprUsesOnly("pi * 2", []), "constants are not variables");
});

/* ── validation ───────────────────────────────────────────────────────────────────────────── */

const flowRaw = {
  heading: "The Tiny Green Factory",
  notes: [{ id: "n1", text: "light → chemical energy.", s: 0 }, { text: "glucose stores energy", s: 9 }],
  stage: {
    kind: "flow",
    arrangement: "inputs-core-outputs",
    nodes: [
      { id: "Light", label: "Light", icon: "sun", role: "input", s: 0, glow: "light / 100" },
      { id: "water", label: "Water", icon: "water", role: "input", s: 1 },
      { id: "chloroplast", label: "Chloroplast", icon: "chloroplast", role: "core", s: 0 },
      { id: "glucose", label: "Glucose", icon: "not-an-icon", role: "output", s: 2 },
    ],
    arrows: [
      { from: "light", to: "chloroplast", s: 0, flow: true, rate: "light / 100" },
      { from: "water", to: "nowhere", s: 1 },
      { from: "chloroplast", to: "glucose", label: "stored energy", s: 2, rate: "hack()" },
    ],
  },
  cues: [
    { s: 1, at: 0.3, action: "point", target: "water" },
    { s: 2, action: "circle", target: "missing-id" },
    { s: 3, action: "wave", target: "glucose" },
  ],
  interaction: {
    kind: "try",
    prompt: "Turn the light up and down.",
    controls: [{ var: "light", label: "Light", min: 0, max: 100, value: 150 }],
    reactions: [{ when: "light < 20", say: ["Dim.", "Very dim."] }, { when: "temp > 3", say: "Refused: unknown variable." }],
  },
};

test("a flow board is cleaned: ids slugged, sentences clamped, unknown things dropped", () => {
  const spec = validateCanvasSpec(flowRaw, 4)!;
  assert.ok(spec);
  assert.equal(spec.stage.kind, "flow");
  if (spec.stage.kind !== "flow") return;
  assert.deepEqual(spec.stage.nodes.map((n) => n.id), ["light", "water", "chloroplast", "glucose"]);
  assert.equal(spec.stage.nodes[3].icon, undefined, "unknown icons become a plain disc");
  assert.equal(spec.notes[0].text, "light → chemical energy", "a note loses its full stop");
  assert.equal(spec.notes[1].s, 3, "a sentence past the narration is clamped to its last sentence");
  assert.equal(spec.stage.arrows.length, 2, "an arrow to a node that does not exist is dropped");
  assert.equal(spec.stage.arrows[1].rate, undefined, "an expression that does not parse is dropped");
  assert.deepEqual(spec.cues.map((c) => c.target), ["water"], "cues at missing ids or with unknown actions are dropped");
  assert.equal(spec.interaction?.kind, "try");
  if (spec.interaction?.kind !== "try") return;
  assert.equal(spec.interaction.controls[0].value, 100, "a starting value is clamped into the slider's range");
  assert.equal(spec.interaction.reactions.length, 1, "a reaction reading an unknown variable is dropped");
  assert.equal(spec.interaction.reactions[0].say, "Dim. Very dim.", "sentences given as a list are joined");
});

test("a graph curve written in the slider's variable is re-read as a function of x", () => {
  const spec = validateCanvasSpec({
    heading: "Light and rate",
    notes: [],
    stage: { kind: "graph", x: { label: "Light", min: 0, max: 100 }, y: { label: "Rate", min: 0, max: 100 }, curves: [{ id: "rate", expr: "100 * (1 - exp(-light / 25))", s: 0 }], markers: [{ id: "dot", x: "light", curve: "rate", s: 1 }] },
    cues: [],
    interaction: { kind: "try", prompt: "Slide it.", controls: [{ var: "light", label: "Light", min: 0, max: 100, value: 30 }], reactions: [{ when: "light > 50", say: "Bright." }, { when: "light <= 50", say: "Dim." }] },
  }, 3)!;
  assert.equal(spec.stage.kind, "graph");
  if (spec.stage.kind !== "graph") return;
  assert.equal(spec.stage.curves[0].expr, "100 * (1 - exp(-x / 25))");
  assert.equal(spec.stage.markers?.[0].x, "light", "the marker still follows the slider");
});

test("a board missing what its stage needs is refused", () => {
  assert.equal(validateCanvasSpec({ heading: "x", notes: [], stage: { kind: "flow", nodes: [{ label: "only one" }], arrows: [] }, cues: [] }, 3), null);
  assert.equal(validateCanvasSpec({ heading: "", notes: [], stage: { kind: "scene", items: [{ cell: "A1", label: "a" }] }, cues: [] }, 3), null);
  assert.equal(validateCanvasSpec({ heading: "x", notes: [], stage: { kind: "hologram" }, cues: [] }, 3), null);
  assert.equal(validateInteraction({ kind: "draw", prompt: "Draw it" }), undefined, "a drawing task needs to say what correct looks like");
});

test("an equation token written over the arrow must name a real token", () => {
  const spec = validateCanvasSpec({
    heading: "The recipe",
    notes: [],
    stage: { kind: "equation", tokens: [{ id: "co2", text: "6CO₂" }, { id: "arrow", text: "→" }, { id: "glucose", text: "C₆H₁₂O₆" }, { id: "light", text: "light", on: "arrow" }, { id: "heat", text: "heat", on: "nothing" }], steps: [{ s: 0, order: ["co2", "arrow", "glucose", "light", "heat"] }] },
    cues: [],
  }, 2)!;
  if (spec.stage.kind !== "equation") return assert.fail("equation expected");
  assert.equal(spec.stage.tokens.find((t) => t.id === "light")?.on, "arrow");
  assert.equal(spec.stage.tokens.find((t) => t.id === "heat")?.on, undefined);
});

/* ── layout ───────────────────────────────────────────────────────────────────────────────── */

const inside = (r: Rect) => r.x >= -1 && r.y >= -1 && r.x + r.w <= PANEL_W + 1 && r.y + r.h <= PANEL_H + 1;

test("every laid-out element stays on its panel, and nodes never overlap", () => {
  const spec = validateCanvasSpec(flowRaw, 4)!;
  const layout = layoutPanel(spec);
  for (const [id, rect] of Object.entries(layout.targets)) assert.ok(inside(rect), `${id} leaves the panel: ${JSON.stringify(rect)}`);
  const nodes = layout.marks.filter((m) => m.type === "node");
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i] as { cx: number; cy: number; r: number };
      const b = nodes[j] as { cx: number; cy: number; r: number };
      assert.ok(Math.hypot(a.cx - b.cx, a.cy - b.cy) > a.r + b.r, "two nodes overlap");
    }
  }
});

test("a hosted token sits above its host, and the row is centred without it", () => {
  const spec = validateCanvasSpec({
    heading: "Recipe",
    notes: [{ text: "a note", s: 0 }],
    stage: { kind: "equation", tokens: [{ id: "a", text: "6CO₂" }, { id: "arrow", text: "→" }, { id: "b", text: "C₆H₁₂O₆" }, { id: "light", text: "light", on: "arrow" }], steps: [{ s: 0, order: ["a", "arrow", "b", "light"] }] },
    cues: [],
  }, 2)!;
  const layout = layoutPanel(spec);
  const arrow = layout.targets.arrow;
  const light = layout.targets.light;
  assert.ok(light.y + light.h <= arrow.y + 8, "the condition is written above the arrow");
  assert.ok(Math.abs(light.x + light.w / 2 - (arrow.x + arrow.w / 2)) < 2, "and centred over it");
});

test("a panel inside an element of an earlier panel is scaled into that element", () => {
  const parent = validateCanvasSpec(flowRaw, 4)!;
  const child = { ...validateCanvasSpec(flowRaw, 4)!, inside: { beat: "b1", id: "chloroplast" } } as CanvasBoardSpec;
  const layouts = [layoutPanel(parent), layoutPanel(child), layoutPanel(parent)];
  const at = placePanels([
    { key: "b1", layout: layouts[0] },
    { key: "b2", inside: child.inside, layout: layouts[1] },
    { key: "b3", layout: layouts[2] },
  ]);
  assert.ok(at.b2.scale < 0.3, "the close-up is small on the world");
  const host = toWorld(layouts[0].targets.chloroplast, at.b1);
  const box = toWorld({ x: 0, y: 0, w: PANEL_W, h: PANEL_H }, at.b2);
  assert.ok(Math.abs(box.x + box.w / 2 - (host.x + host.w / 2)) < 1 && Math.abs(box.y + box.h / 2 - (host.y + host.h / 2)) < 1, "centred on the element");
  assert.equal(at.b3.x, 1260, "an inside panel does not take a place on the world's row");
});

/* ── camera and cues ──────────────────────────────────────────────────────────────────────── */

test("a view fits the viewport's aspect, and a flight starts and ends where it should", () => {
  const v = fitView({ x: 0, y: 0, w: 1000, h: 560 }, 2, 0);
  assert.equal(v.w / v.h, 2);
  const a = fitView({ x: 0, y: 0, w: 1000, h: 560 }, 16 / 9);
  const b = fitView({ x: 2520, y: 820, w: 1000, h: 560 }, 16 / 9);
  const start = viewAt(a, b, 0);
  assert.ok(Math.abs(start.x - a.x) < 1e-6 && Math.abs(start.w - a.w) < 1e-6);
  const end = viewAt(a, b, 1);
  assert.ok(Math.abs(end.x - b.x) < 1e-6 && Math.abs(end.w - b.w) < 1e-6);
  assert.ok(viewAt(a, b, 0.5).w > a.w, "a long flight pulls back mid-way");
  assert.ok(flightMs(a, b) > flightMs(a, a) && flightMs(a, b) <= 2800);
});

test("the pen follows the latest cue and lifts; a zoom lets go after the next sentence", () => {
  const cues = [
    { s: 0, at: 0.2, action: "zoom" as const, target: "x" },
    { s: 0, at: 0.5, action: "point" as const, target: "a" },
    { s: 2, at: 0.3, action: "circle" as const, target: "b" },
  ];
  assert.equal(activeCues(cues, 0, 0.1, false).pen, undefined, "nothing before the first cue");
  assert.equal(activeCues(cues, 0, 0.6, false).pen?.target, "a");
  assert.equal(activeCues(cues, 0, 0.6, false).zoom, "x");
  assert.equal(activeCues(cues, 1, 0.5, false).zoom, "x", "the zoom holds through the next sentence");
  assert.equal(activeCues(cues, 2, 0.1, false).zoom, undefined, "then the camera pulls back by itself");
  assert.equal(activeCues(cues, 2, 0.1, false).pen, undefined, "the pen lifts after the sentence following its cue");
  assert.equal(activeCues(cues, 2, 0.4, false).pen?.action, "circle");
  assert.deepEqual(activeCues(cues, 2, 0.4, true), {}, "a finished board has no pen");
});

test("Aria can be told what a canvas board shows and what the student can do on it", () => {
  const text = describeCanvasSpec(validateCanvasSpec(flowRaw, 4)!);
  assert.match(text, /Chloroplast/);
  assert.match(text, /Light → Chloroplast/);
  assert.match(text, /Try-it controls the student can move: Light \(0–100\)/);
});

/* ── predict questions, the recap tour, one colour per concept ────────────────────────────── */

import { recapTour, unifyConceptColours } from "../canvas/lessonPasses";

test("a predict question needs exactly one right answer, and every option explains itself", () => {
  const ok = validateInteraction({ kind: "quiz", question: "What happens next?", options: [{ text: "A", correct: true, feedback: "Yes, because…" }, { text: "B", correct: false, feedback: "Tempting, but…" }, { text: "C", correct: false, feedback: "No — …" }] });
  assert.equal(ok?.kind, "quiz");
  assert.equal(validateInteraction({ kind: "quiz", question: "?", options: [{ text: "A", correct: true, feedback: "x" }, { text: "B", correct: true, feedback: "y" }] }), undefined, "two right answers");
  assert.equal(validateInteraction({ kind: "quiz", question: "?", options: [{ text: "A", correct: true }, { text: "B", correct: false, feedback: "y" }] }), undefined, "an option with no feedback");
});

test("a visit cue names a board, and the camera leaves it when the sentence ends", () => {
  const spec = validateCanvasSpec({ heading: "Recap", notes: [], stage: { kind: "scene", items: [{ cell: "A1", label: "a" }] }, cues: [{ s: 1, action: "visit", beat: "b2" }, { s: 2, action: "visit" }] }, 4)!;
  assert.deepEqual(spec.cues.map((c) => [c.action, c.beat]), [["visit", "b2"]], "a visit without a board is dropped");
  assert.equal(activeCues(spec.cues, 1, 0.5, false).visit, "b2");
  assert.equal(activeCues(spec.cues, 2, 0.5, false).visit, undefined);
});

test("with no tour written, each recap sentence visits the earlier board it recalls, in order", () => {
  const board = (id: string, title: string, objects: string[]) => ({ id, title, objects, brief: "", script: "" });
  const earlier = [board("b1", "Inside a Leaf", ["chloroplast"]), board("b2", "The Chemical Recipe", ["glucose"]), board("b3", "Light Has a Limit", ["light"])];
  const recap = { ...board("b4", "Recap", []), script: "Let us walk back over it all. The leaf holds chloroplasts where it happens. Glucose is written in the chemical recipe. More light helps until another limit takes over. That is photosynthesis." };
  assert.deepEqual(recapTour(recap, earlier).map((c) => [c.s, c.beat]), [[1, "b1"], [2, "b2"], [3, "b3"]], "an opening sentence that names no board visits none");
});

test("the same concept is drawn in the same colour on every board", () => {
  const flow = validateCanvasSpec(flowRaw, 4)!;
  const eq = validateCanvasSpec({ heading: "Recipe", notes: [], stage: { kind: "equation", tokens: [{ id: "water", text: "6H₂O", color: "#ff0000" }, { id: "arrow", text: "→" }, { id: "glucose", text: "C₆H₁₂O₆" }], steps: [{ s: 0, order: ["water", "arrow", "glucose"] }] }, cues: [] }, 2)!;
  if (flow.stage.kind !== "flow" || eq.stage.kind !== "equation") return assert.fail();
  flow.stage.nodes.find((n) => n.id === "water")!.color = "#2563eb";
  unifyConceptColours([flow, eq]);
  if (flow.stage.kind !== "flow" || eq.stage.kind !== "equation") return assert.fail();
  assert.equal(eq.stage.tokens.find((t) => t.id === "water")?.color, "#2563eb", "the first board's colour wins");
  const glucoseNode = flow.stage.nodes.find((n) => n.id === "glucose")!.color;
  assert.ok(glucoseNode && glucoseNode === eq.stage.tokens.find((t) => t.id === "glucose")?.color, "an uncoloured shared concept gets one colour");
  assert.equal(eq.stage.tokens.find((t) => t.id === "arrow")?.color, undefined, "operators are never recoloured");
});

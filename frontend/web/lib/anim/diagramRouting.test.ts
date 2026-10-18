import test from "node:test";
import assert from "node:assert/strict";
import { applyLessonVisualPolicy, photographic } from "../canvas/visualPolicy";
import type { CanvasPlanBeat, CanvasStage } from "../canvas/types";
import { compileDiagram, fitCompiledDiagram, isCompiledDiagram } from "../diagrams/grammar";
import { diagramIssues } from "../diagrams/grammarCheck";
import { drawableText } from "../diagrams/glyphs";
import { cropToInk, partInkDistance, translatePath } from "../diagrams/ink";
import { checkDiagram } from "../diagrams/check";
import { acceptDiagram } from "../diagrams/write";
import { parseDiagramSpec } from "../diagrams/spec";
import { compileDiagram as compileScene } from "../diagrams/render";
import { takeFigureCutItems } from "../figures/cuts";
import type { FigureDrawing } from "../figures/types";
import { diagramLabelLayout } from "../diagrams/grammarRender";
import { GRAMMAR_FIXTURES, SAVED_GRAMMAR_DIAGRAMS } from "../diagrams/grammarFixtures";
import { FIXTURES } from "../diagrams/fixtures";
import { inkIndex, nearOtherInk, textGap } from "../diagrams/ink";

const beat = (id: string, title: string, stage: CanvasStage, script: string, extra: Partial<CanvasPlanBeat> = {}): CanvasPlanBeat => ({
  id, title, brief: title, script, stage, objects: [], inside: null, carry: [], interaction: "quiz", overview: false, ...extra,
});

/* ── routing ── */

test("momentum boards are drawn by the vector grammar (bodies and velocity arrows), not left as tables", () => {
  const plan = [
    beat("b1", "Add momentum before impact", "compare", "A direct impact is a collision in which two bodies move along the same straight line. A 2.0 kg trolley moves right at 3.0 m s^-1 and a 1.0 kg trolley moves left at 1.0 m s^-1, so the total momentum before impact is 5.0 kg m s^-1."),
    beat("b2", "Coalescence on impact", "compare", "When bodies coalesce on impact they stick together. Use m1u1 + m2u2 = (m1 + m2)v. A 3.0 kg trolley moves right at 2.0 m s^-1 and a 1.0 kg trolley moves left at 1.0 m s^-1; the combined trolleys move at 1.25 m s^-1."),
    beat("b3", "Exam practice", "exam", "Trolley A has mass 1.2 kg and they coalesce on impact."),
  ];
  const out = applyLessonVisualPolicy(plan, { mode: "course", aiPictures: true });
  assert.deepEqual(out.beats.map((b) => `${b.stage}:${b.figure ?? ""}`), ["figure:drawn", "figure:drawn", "exam:"]);
  // Strict source lessons never get one.
  const strict = applyLessonVisualPolicy(plan, { mode: "strict" });
  assert.deepEqual(strict.beats.map((b) => b.stage), ["compare", "compare", "exam"]);
});

test("a circle-theorems lesson draws the circle on every theorem board, never a bare triangle or an icon flow", () => {
  const plan = [
    beat("b1", "Equal chords mirror each other", "compare", "Equal chords AB and CD in a circle with centre O are the same distance from the centre. OM and ON are perpendicular to the chords, so M and N are midpoints.", { plannedFigure: "circleTheorem" }),
    // Its proof says "triangle" more often than "chord": the circle still wins.
    beat("b2", "The centre bisects a chord", "compare", "The perpendicular from the centre O to a chord AB bisects the chord. Triangles OMA and OMB are congruent right-angled triangles: OA = OB as radii of the circle, OM is common. In each right-angled triangle Pythagoras gives AM = MB = 7 cm.", { requiredVisual: { stages: ["compare"], mustShow: [] } }),
    beat("b3", "Two tangents from one point", "compare", "The two tangents from an external point P to a circle with centre O are equal: PA = PB, and each radius meets its tangent at 90 degrees."),
  ];
  const out = applyLessonVisualPolicy(plan, { mode: "course", aiPictures: true });
  // The exact code-drawn circle theorem (one construction per board) wherever it fits.
  assert.deepEqual(out.beats.map((b) => `${b.stage}:${b.figure}`), ["figure:circleTheorem", "figure:circleTheorem", "figure:circleTheorem"]);
});

test("maps and sections an earlier pass sent to the scene grammar go to the vector grammar first; essays and exams never", () => {
  const plan = [
    beat("b1", "World ocean currents", "scene", "A world map of the Gulf Stream and the Canary Current."),
    beat("b2", "To what extent did trade routes shape empires?", "compare", "Evaluate the argument that trade routes across a map of the Indian Ocean shaped empires."),
    beat("b3", "Exam practice", "exam", "Describe the ocean currents on the map."),
  ];
  const out = applyLessonVisualPolicy(plan, { mode: "course", aiPictures: true });
  assert.equal(out.beats[0].stage, "figure");
  assert.equal(out.beats[0].figure, "drawn");
  assert.notEqual(out.beats[1].figure, "drawn");
  assert.equal(out.beats[2].stage, "exam");
});

test("the picture the policy guarantees is one the last pass keeps (one 'photographic' predicate)", () => {
  const plan = [
    beat("b1", "A coral reef habitat", "scene", "A coral reef habitat in situ, with fish and corals as they appear in the sea."),
    beat("b2", "Why reefs matter", "compare", "Reefs protect coastlines and support fisheries."),
  ];
  const out = applyLessonVisualPolicy(plan, { mode: "course", aiPictures: true });
  const pictured = out.beats.find((b) => b.stage === "illustration");
  assert.ok(pictured, "a picture is guaranteed");
  assert.equal(photographic(pictured!), true);
});

/* ── the vector grammar: geometry and collisions ── */

test("geometry: the foot of the perpendicular from the centre is the chord's midpoint, and tangents touch", () => {
  const c = compileDiagram({ w: 600, h: 420, elements: [{ t: "geometry", circle: { cx: 300, cy: 210, r: 170 },
    points: [{ id: "O", centre: true }, { id: "A", deg: 215 }, { id: "B", deg: 325 }, { id: "M", foot: ["O", "A", "B"], part: "m" }, { id: "P", x: 590, y: 60 }, { id: "T", tangentFrom: "P" }],
    segments: [{ from: "A", to: "B", part: "chord" }, { from: "O", to: "M", part: "om" }, { from: "P", to: "T", part: "t" }], rightAngles: [["O", "M", "B"]] }],
    parts: [{ id: "chord", name: "Chord AB" }, { id: "om", name: "OM perpendicular to AB" }, { id: "m", name: "Midpoint M" }, { id: "t", name: "Tangent" }] });
  assert.ok(c.drawing, c.issues.join("; "));
  const m = c.drawing!.parts.find((p) => p.id === "m")!.anchor;
  const a = [300 + 170 * Math.cos((215 * Math.PI) / 180), 210 - 170 * Math.sin((215 * Math.PI) / 180)];
  const b = [300 + 170 * Math.cos((325 * Math.PI) / 180), 210 - 170 * Math.sin((325 * Math.PI) / 180)];
  assert.ok(Math.abs(m.x - (a[0] + b[0]) / 2) < 0.2 && Math.abs(m.y - (a[1] + b[1]) / 2) < 0.2, "M is the midpoint of AB");
  // Every part's label dot is on its own ink.
  for (const p of c.drawing!.parts) assert.ok(partInkDistance(c.drawing!, p.id, p.anchor.x, p.anchor.y) < 4, `${p.id} anchor on its ink`);
  // Two named things never share one dot (the chord's dot is not M's).
  assert.deepEqual(diagramIssues(c, { narration: "" }), []);
});

test("collision: arrows point the way their signed velocity says, at rest has none, numbers are checked", () => {
  const raw = { w: 640, h: 400, elements: [{ t: "collision", x: 20, y: 20, w: 600, h: 360, positive: "right",
    before: [{ name: "A", mass: "2.0 kg", v: "3.0", part: "a", vPart: "ua" }, { name: "B", mass: "1.0 kg", v: "-1.0", part: "b", vPart: "ub" }],
    after: [{ name: "A + B", mass: "3.0 kg", v: "v", part: "ab", vPart: "v" }] }],
    parts: [{ id: "a", name: "Trolley A" }, { id: "b", name: "Trolley B" }, { id: "ua", name: "u1" }, { id: "ub", name: "u2" }, { id: "ab", name: "Combined" }, { id: "v", name: "Common velocity" }] };
  const c = compileDiagram(raw);
  assert.ok(c.drawing, c.issues.join("; "));
  const head = (part: string) => c.drawing!.shapes.find((s) => s.t === "path" && s.part === part && s.d.endsWith("Z") && s.stroke === "none") as { d: string };
  const line = (part: string) => c.drawing!.shapes.find((s) => s.t === "path" && s.part === part && !s.d.endsWith("Z")) as { d: string };
  const tipX = (part: string) => Number(head(part).d.match(/L(-?[\d.]+)/)![1]);
  const mid = (part: string) => { const n = line(part).d.match(/-?[\d.]+/g)!.map(Number); return (n[0] + n[2]) / 2; };
  assert.ok(tipX("ua") > mid("ua"), "+3.0 points right");
  assert.ok(tipX("ub") < mid("ub"), "-1.0 points left");
  assert.ok(c.drawing!.shapes.some((s) => s.t === "text" && s.text === "3.0 m/s"), "the writer's digits, without the sign");
  assert.deepEqual(diagramIssues(c, { narration: "A 2.0 kg trolley at 3.0 m/s meets a 1.0 kg trolley moving left at 1.0 m/s; together 3.0 kg." }), []);
  assert.match(diagramIssues(c, { narration: "A 2.0 kg trolley meets a 1.0 kg trolley." }).join(" "), /writes 3/);
});

/* ── label accuracy in the vector grammar ── */

test("an element's part is labelled where code drew it; a free shape's anchor must be on its ink", () => {
  const cells = compileDiagram({ w: 640, h: 400, elements: [{ t: "circulation", x: 55, y: 75, w: 530, h: 255, stops: [{ label: "30°N", flow: "sink" }, { label: "0°", flow: "rise", part: "itcz" }, { label: "30°S", flow: "sink" }], cells: [{ part: "h1" }, { part: "h2" }] }],
    parts: [{ id: "h1", name: "Northern Hadley cell", anchor: { x: 600, y: 390 } }, { id: "h2", name: "Southern Hadley cell", anchor: { x: 10, y: 10 } }, { id: "itcz", name: "ITCZ", anchor: { x: 5, y: 5 } }] });
  assert.ok(cells.drawing, cells.issues.join("; "));
  // Cell names are written inside their loops, in the cells' order — no margin labels or leaders.
  const words = cells.drawing!.shapes.filter((s) => s.t === "text" && (s.part === "h1" || s.part === "h2")) as Array<{ x: number; part: string }>;
  assert.ok(words.length >= 2 && Math.max(...words.filter((t) => t.part === "h1").map((t) => t.x)) < Math.min(...words.filter((t) => t.part === "h2").map((t) => t.x)));
  assert.deepEqual(cells.drawing!.parts.map((p) => p.id), ["itcz"]);
  // Only cell names: sent back for one part a label should point at.
  assert.match(compileDiagram({ w: 640, h: 400, elements: [{ t: "circulation", x: 55, y: 75, w: 530, h: 255, stops: [{ flow: "sink" }, { flow: "rise" }], cells: [{ part: "h1" }] }], parts: [{ id: "h1", name: "Hadley cell" }] }).issues.join(" "), /at least one other part/);
  const free = (anchor: { x: number; y: number }) => compileDiagram({ w: 400, h: 300, elements: [{ t: "rect", x: 20, y: 20, w: 100, h: 80, part: "a" }, { t: "rect", x: 200, y: 20, w: 100, h: 80, fill: "blue", part: "b" }, { t: "line", x1: 20, y1: 200, x2: 300, y2: 200 }], parts: [{ id: "a", name: "Box A", anchor }, { id: "b", name: "Box B" }] });
  assert.ok(free({ x: 70, y: 20 }).drawing, "on the outline");
  assert.ok(free({ x: 70, y: 60 }).drawing, "inside the closed outline");
  assert.match(free({ x: 160, y: 60 }).issues.join(" "), /not on its own lines/);
});

test("circulation stops must be listed in the order they are drawn", () => {
  const c = compileDiagram({ w: 600, h: 300, elements: [{ t: "circulation", x: 20, y: 20, w: 560, h: 200, stops: [{ label: "90°S", flow: "sink", at: 1 }, { label: "60°S", flow: "rise", at: 0.5 }, { label: "30°S", flow: "sink", at: 0 }] }], parts: [{ id: "x", name: "X" }] });
  assert.match(c.issues.join(" "), /left to right/);
});

test("part names are never cut mid-word: a long one goes back to the writer", () => {
  const c = compileDiagram({ w: 400, h: 300, elements: [{ t: "rect", x: 20, y: 20, w: 100, h: 80, fill: "blue", part: "a" }, { t: "rect", x: 200, y: 20, w: 100, h: 80, fill: "red", part: "b" }], parts: [{ id: "a", name: "The perpendicular bisector of the chord AB" }, { id: "b", name: "B" }] });
  assert.match(c.issues.join(" "), /at most 34/);
});

/* ── glyphs and fit ── */

test("symbols the board font cannot draw are written as words", () => {
  assert.equal(drawableText("OM ⟂ AB"), "OM perpendicular to AB");
  assert.equal(drawableText("∠ABC = 40°"), "angle ABC = 40°");
  assert.equal(drawableText("ΔABC ≅ ΔDEF"), "ΔABC congruent to ΔDEF");
  assert.equal(drawableText("v = 2.5 m s⁻¹"), "v = 2.5 m/s");
  assert.equal(drawableText("uₙ = 3n + 1"), "u_n = 3n + 1");
  assert.equal(drawableText("aₙ₊₁"), "a_(n+1)");
  assert.equal(drawableText("H₂O and v₁"), "H₂O and v₁", "digit subscripts are in the font");
  assert.equal(drawableText("x ⩽ 4, y ⩾ 2"), "x ≤ 4, y ≥ 2");
  const c = compileDiagram({ w: 400, h: 300, elements: [{ t: "rect", x: 20, y: 20, w: 100, h: 80, fill: "blue", part: "a" }, { t: "text", x: 300, y: 150, text: "OA ⊥ PA" }, { t: "rect", x: 200, y: 20, w: 100, h: 80, fill: "red", part: "b" }], parts: [{ id: "a", name: "OM ⟂ AB" }, { id: "b", name: "B" }] });
  assert.ok(c.drawing, c.issues.join("; "));
  assert.equal(c.drawing!.parts[0].name, "OM perpendicular to AB");
  assert.ok(!c.drawing!.shapes.some((s) => s.t === "text" && /[⊥⟂]/.test(s.text)));
});

test("a diagram drawn in part of its canvas is cropped to its art, and stays trusted", () => {
  const c = compileDiagram({ w: 800, h: 600, elements: [{ t: "rect", x: 100, y: 100, w: 200, h: 150, fill: "blue", part: "a" }, { t: "circle", cx: 450, cy: 175, r: 60, fill: "red", part: "b" }, { t: "line", x1: 100, y1: 300, x2: 510, y2: 300 }], parts: [{ id: "a", name: "A" }, { id: "b", name: "B" }] });
  assert.ok(c.drawing, c.issues.join("; "));
  const fitted = fitCompiledDiagram(c.drawing!);
  assert.ok(fitted.w < 500 && fitted.h < 400, `${fitted.w}×${fitted.h}`);
  assert.ok(isCompiledDiagram(fitted));
  for (const p of fitted.parts) assert.ok(partInkDistance(fitted, p.id, p.anchor.x, p.anchor.y, true) < 1, "anchors move with the art");
  // Relative path commands are left alone; absolute ones and a leading "m" move.
  assert.equal(translatePath("M10 10 h20 v5 L5 5 Z", 3, 4), "M13 14 h20 v5 L8 9 Z");
  assert.equal(translatePath("m10 10 l5 5", 1, 1), "m11 11 l5 5");
  // Art that already fills its canvas is not changed.
  const full = { w: 100, h: 100, shapes: [{ t: "path" as const, d: "M0 0 L100 100" }], parts: [] };
  assert.equal(cropToInk(full), full);
});

/* ── the scene grammar's labels ── */

test("scene grammar: a long label is recorded for the rewrite pass, not silently cut; accept keeps the words whole", () => {
  takeFigureCutItems();
  const spec = parseDiagramSpec({ w: 400, h: 300, elements: [{ t: "region", id: "foil", shape: "rect", x: 100, y: 40, w: 10, h: 200, part: "Gold foil" }, { t: "label", id: "l1", text: "The thin gold foil that the alpha particles strike", at: { id: "foil" } }] })!;
  const checked = checkDiagram(spec, "Alpha particles strike a thin gold foil.");
  const label = checked.spec.elements.find((e) => e.t === "label") as { text: string };
  assert.ok(label.text.length <= 34 && !/\s\S{1,2}$/.test(label.text));
  assert.ok(takeFigureCutItems().some((c) => c.text.startsWith("The thin gold foil")), "the cut is recorded");
  const accepted = acceptDiagram({ stage: { kind: "diagram", spec: { w: 400, h: 300, elements: [{ t: "region", id: "foil", shape: "rect", x: 100, y: 40, w: 10, h: 200, part: "Gold foil" }, { t: "label", id: "l1", text: "The thin gold foil that the alpha particles strike", at: { id: "foil" } }] }, parts: [{ id: "foil", name: "Gold foil" }] } }, "Alpha particles strike a thin gold foil.");
  assert.ok(accepted!.spec.elements.some((e) => e.t === "label" && e.text.startsWith("The thin gold foil that the alpha")), "the writer's words stay whole for the rewrite pass");
});

test("scene grammar: a free label next to the wrong thing is re-pointed at the thing it names", () => {
  const spec = parseDiagramSpec({ w: 500, h: 300, elements: [
    { t: "region", id: "nucleus", shape: "ellipse", cx: 100, cy: 150, rx: 40, ry: 40, part: "Nucleus" },
    { t: "region", id: "membrane", shape: "rect", x: 300, y: 100, w: 120, h: 100, part: "Cell membrane" },
    { t: "label", id: "l1", text: "Nucleus", at: { x: 300, y: 150 } },
  ] })!;
  const checked = checkDiagram(spec, "The nucleus holds DNA; the membrane surrounds the cell.");
  const label = checked.spec.elements.find((e) => e.t === "label") as { at: unknown };
  assert.deepEqual(label.at, { id: "nucleus" });
});

test("scene grammar: on-diagram words move beside their point, never far from it, and a margin label's point never moves", () => {
  const spec = parseDiagramSpec({ w: 500, h: 300, elements: [
    { t: "region", id: "r", shape: "rect", x: 100, y: 100, w: 200, h: 100 },
    { t: "label", id: "a", text: "Left ventricle", at: { x: 200, y: 150 }, leader: false },
    { t: "label", id: "b", text: "Right ventricle", at: { x: 200, y: 150 }, leader: false },
    { t: "label", id: "c", text: "Septum", at: { x: 200, y: 150 } },
  ] })!;
  const checked = checkDiagram(spec, "");
  const [a, b, c] = ["a", "b", "c"].map((id) => checked.spec.elements.find((e) => e.id === id) as { at: { x: number; y: number }; leader?: boolean });
  assert.deepEqual(c.at, { x: 200, y: 150 }, "a margin label's dot stays on its target");
  assert.notDeepEqual(a.at, b.at);
  assert.ok(Math.abs(b.at.y - 150) <= 24 || b.leader === true);
});

test("scene grammar: a required part the diagram does not name is a retry reason", () => {
  const spec = parseDiagramSpec({ w: 400, h: 300, elements: [{ t: "region", id: "trachea", shape: "rect", x: 100, y: 40, w: 60, h: 200, part: "Trachea" }] })!;
  const checked = checkDiagram(spec, "Air passes down the trachea; cilia line it.", ["Cilia"]);
  assert.match(checked.factIssues.join(" "), /requires "Cilia"/);
  assert.deepEqual(checkDiagram(spec, "Air passes down the trachea.", ["Trachea"]).factIssues, []);
});

test("scene grammar drawings are cropped to their art too", () => {
  const d = compileScene(parseDiagramSpec({ w: 800, h: 600, elements: [{ t: "region", id: "a", shape: "rect", x: 50, y: 50, w: 150, h: 100, part: "A" }] })!);
  assert.ok(d.w < 800 && d.h < 600);
});

/* ── every compiled diagram: label dots clear of words, leaders clear of other parts ── */

test("every fixture and saved diagram: no label dot on a word, no leader along another part's ink", () => {
  const drawings: Array<[string, FigureDrawing]> = [];
  for (const [name, c] of Object.entries({ ...SAVED_GRAMMAR_DIAGRAMS, ...GRAMMAR_FIXTURES })) {
    const compiled = compileDiagram(c.raw);
    if (compiled.drawing) drawings.push([name, fitCompiledDiagram(compiled.drawing)]);
  }
  for (const fix of FIXTURES) drawings.push([`scene-${fix.id}`, compileScene(checkDiagram(fix.spec, fix.script).spec)]);
  assert.ok(drawings.length >= 22, `${drawings.length} diagrams compiled`);
  const problems: string[] = [];
  for (const [name, drawing] of drawings) {
    const index = inkIndex(drawing.shapes);
    const { fig, k, placed } = diagramLabelLayout(drawing);
    const toArt = (p: { x: number; y: number }) => ({ x: (p.x - fig.x) / k, y: (p.y - fig.y) / k });
    for (const label of placed) {
      const dot = toArt(label.leader[label.leader.length - 1]);
      const gap = textGap(index, dot.x, dot.y) * k;
      if (gap < 4) problems.push(`${name}: the "${label.lines.join(" ")}" dot is ${gap.toFixed(1)} px from a word`);
      // The longest stretch the leader runs ALONG other ink (crossing a line costs only a few px).
      let over = 0, run = 0;
      for (let i = 0; i + 1 < label.leader.length; i++) {
        const [a, b] = [label.leader[i], label.leader[i + 1]];
        const len = Math.hypot(b.x - a.x, b.y - a.y);
        // The last 6 px reach the dot: they may touch what surrounds it.
        const stop = i + 2 === label.leader.length ? Math.max(0, len - 6) : len;
        for (let t = 0; t < stop; t += 1) {
          const q = toArt({ x: a.x + ((b.x - a.x) * t) / (len || 1), y: a.y + ((b.y - a.y) * t) / (len || 1) });
          if (nearOtherInk(index, label.id, q.x, q.y, 2 / k)) { run += 1; over = Math.max(over, run); } else run = 0;
        }
      }
      if (over > 12) problems.push(`${name}: the "${label.lines.join(" ")}" leader runs ${over} px along other parts' ink`);
    }
  }
  assert.deepEqual(problems, []);
});

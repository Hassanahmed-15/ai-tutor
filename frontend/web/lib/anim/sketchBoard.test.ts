import test from "node:test";
import assert from "node:assert/strict";
import { validateCanvasSpec } from "../canvas/validate";
import { layoutPanel, type Mark } from "../canvas/layout";
import { SKETCH_FIXTURES } from "../canvas/mathsVisualFixtures";
import { canvasSentences } from "../canvas/plan";

const overlap = (a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }) => a.x < b.x + b.w - 1 && b.x < a.x + a.w - 1 && a.y < b.y + b.h - 1 && b.y < a.y + a.h - 1;

test("every sketch fixture validates, lays out inside the board, and no two items overlap", () => {
  for (const f of SKETCH_FIXTURES) {
    const spec = validateCanvasSpec(f.raw, canvasSentences(f.script).length);
    assert.ok(spec && spec.stage.kind === "sketch", f.id);
    const laid = layoutPanel(spec);
    const sketch = laid.marks.find((m): m is Extract<Mark, { type: "sketch" }> => m.type === "sketch")!;
    // A short written point joins the notes under the heading (2026-10-23), unless a note already says it.
    const asNotes = new Set(laid.marks.filter((m) => m.type === "note").map((m) => m.id));
    const written = spec.stage.items.filter((it) => it.type === "text" && it.text.length <= 60 && spec.stage.kind === "sketch" && spec.stage.items.some((d) => d.type !== "text"));
    for (const it of spec.stage.items) assert.ok(sketch.items.some((p) => p.item.id === it.id) || asNotes.has(it.id) || written.includes(it), `${f.id}.${it.id}: placed, or written under the heading`);
    assert.equal(sketch.items.length + written.length, spec.stage.items.length, `${f.id}: every item placed`);
    for (const p of sketch.items) {
      assert.ok(p.rect.x >= sketch.rect.x - 1 && p.rect.x + p.rect.w <= sketch.rect.x + sketch.rect.w + 1, `${f.id}.${p.item.id} inside horizontally`);
      assert.ok(p.rect.y >= sketch.rect.y - 1 && p.rect.y + p.rect.h <= sketch.rect.y + sketch.rect.h + 1, `${f.id}.${p.item.id} inside vertically`);
    }
    for (let i = 0; i < sketch.items.length; i++) for (let j = i + 1; j < sketch.items.length; j++) assert.ok(!overlap(sketch.items[i].rect, sketch.items[j].rect), `${f.id}: ${sketch.items[i].item.id} × ${sketch.items[j].item.id}`);
  }
});

test("a shape told where to go after a quarter turn lands exactly there", () => {
  const spec = validateCanvasSpec({ heading: "Area", notes: [], cues: [], stage: { kind: "sketch", items: [{ id: "a", type: "shapes", s: 0, grid: { w: 10, h: 10 }, shapes: [{ id: "strip", kind: "rect", x: 7.5, y: 1, w: 1.5, h: 5, s: 0, move: { s: 1, to: { x: 1, y: 6 }, rotate: 90 } }] }] } }, 3)!;
  const sh = (spec.stage as { items: Array<{ shapes: Array<{ move?: { dx: number; dy: number } }> }> }).items[0].shapes[0];
  // Centre (8.25, 3.5) → a 5 × 1.5 box at (1, 6), centre (3.5, 6.75).
  assert.ok(Math.abs(sh.move!.dx - -4.75) < 1e-9 && Math.abs(sh.move!.dy - 3.25) < 1e-9, JSON.stringify(sh.move));
});

test("junk is dropped, not drawn: bad formulas, curves in other variables, shapes outside the grid are clamped", () => {
  const spec = validateCanvasSpec({ heading: "Junk", notes: [], cues: [], stage: { kind: "sketch", items: [
    { id: "m", type: "math", s: 0, lines: [{ s: 0, tex: "\\frac{1}{" }, { s: 1, tex: "x^2 + \\blue{y}" }] },
    { id: "g", type: "graph", s: 0, x: [-2, 2], y: [-2, 2], curves: [{ id: "c", expr: "a*x", s: 0 }, { id: "d", expr: "x^2", s: 1 }] },
    { id: "sh", type: "shapes", s: 0, grid: { w: 5, h: 5 }, shapes: [{ id: "r", kind: "rect", x: 9, y: 9, w: 3, h: 3, s: 0 }] },
  ] } }, 3)!;
  const items = (spec.stage as { items: Array<Record<string, unknown>> }).items;
  assert.equal((items[0].lines as unknown[]).length, 1, "the broken formula is dropped, the coloured one kept");
  assert.deepEqual((items[1].curves as Array<{ id: string }>).map((c) => c.id), ["d"]);
  const r = (items[2].shapes as Array<{ x: number; w: number }>)[0];
  assert.ok(r.x + r.w <= 5);
});

test("a square ON a triangle's edge is built exactly, outward, and the drawing is fitted into its grid", () => {
  const spec = validateCanvasSpec({ heading: "Squares", notes: [], cues: [], stage: { kind: "sketch", items: [{ id: "t", type: "shapes", s: 0, grid: { w: 12, h: 12 }, shapes: [
    { id: "tri", kind: "poly", points: [[4, 4], [4, 7], [8, 7]], s: 0 },
    { id: "sq-a", kind: "square-on", points: [[4, 4], [4, 7]], away: [8, 7], label: "9", s: 0 },
    { id: "sq-b", kind: "square-on", points: [[4, 7], [8, 7]], away: [4, 4], label: "16", s: 0 },
    { id: "sq-c", kind: "square-on", points: [[8, 7], [4, 4]], away: [4, 7], label: "25", s: 0 },
    { id: "ra", kind: "right-angle", points: [[4, 4], [4, 7], [8, 7]], s: 0 },
  ] }] } }, 2)!;
  const shapes = (spec.stage as { items: Array<{ shapes: Array<{ id: string; kind: string; points?: Array<[number, number]>; color?: string }> }> }).items[0].shapes;
  const side = (pts: Array<[number, number]>, i: number) => Math.hypot(pts[(i + 1) % 4][0] - pts[i][0], pts[(i + 1) % 4][1] - pts[i][1]);
  const tri = shapes.find((s) => s.id === "tri")!.points!;
  const unit = Math.hypot(tri[1][0] - tri[0][0], tri[1][1] - tri[0][1]) / 3;
  for (const [id, len] of [["sq-a", 3], ["sq-b", 4], ["sq-c", 5]] as const) {
    const q = shapes.find((s) => s.id === id)!.points!;
    for (let i = 0; i < 4; i++) assert.ok(Math.abs(side(q, i) - len * unit) < 1e-6, `${id} side ${i}`);
  }
  for (const s of shapes) for (const [x, y] of s.points ?? []) assert.ok(x >= 0 && x <= 12 && y >= 0 && y <= 12, `${s.id} inside the grid`);
  assert.deepEqual(shapes.filter((s) => s.id.startsWith("sq")).map((s) => s.color), ["blue", "orange", "green"], "each labelled area its own colour");
  assert.equal(shapes.find((s) => s.id === "ra")!.kind, "line");
});

test("sketch maths is number-checked and graph points must lie on their curves", async () => {
  const { auditBoardForRelease } = await import("../canvas/releaseAudit");
  const { texToPlain } = await import("../canvas/sketch");
  assert.equal(texToPlain("\\blue{7}^2 + 24^{2} = 49 + 576 = 625"), "7² + 24² = 49 + 576 = 625");
  const beat = { id: "b1", title: "T", script: "One. Two.", stage: "sketch", brief: "", objects: [], inside: null, carry: [], interaction: null, overview: false } as never;
  const bad = validateCanvasSpec({ heading: "Check", notes: [], cues: [], stage: { kind: "sketch", items: [
    { id: "m", type: "math", s: 0, lines: [{ s: 0, tex: "15^2 = 15" }] },
    { id: "g", type: "graph", s: 0, x: [-5, 5], y: [-5, 10], curves: [{ id: "c", expr: "x^2 - 4", s: 0 }], points: [{ id: "v", x: 0, y: -3, s: 0 }] },
  ] } }, 2)!;
  const gates = auditBoardForRelease(bad, beat).map((f) => f.gate);
  assert.ok(gates.includes("numbers"), "15² = 15 is caught");
  assert.ok(gates.includes("graph"), "(0, −3) is not on y = x² − 4");
  const good = validateCanvasSpec({ heading: "Check", notes: [], cues: [], stage: { kind: "sketch", items: [
    { id: "m", type: "math", s: 0, lines: [{ s: 0, tex: "15^2 = 225" }] },
    { id: "g", type: "graph", s: 0, x: [-5, 5], y: [-5, 10], curves: [{ id: "c", expr: "x^2 - 4", s: 0 }], points: [{ id: "v", x: 0, y: -4, s: 0 }] },
  ] } }, 2)!;
  const ok = auditBoardForRelease(good, beat).map((f) => f.gate);
  assert.ok(!ok.includes("numbers") && !ok.includes("graph"), ok.join(","));
});

test("a free label written on a line is moved to a clear spot nearby", () => {
  const spec = validateCanvasSpec({ heading: "Gate", notes: [], cues: [], stage: { kind: "sketch", items: [{ id: "g", type: "shapes", s: 0, col: "full", grid: { w: 12, h: 6 }, shapes: [
    { id: "body", kind: "poly", points: [[3, 1], [7, 1], [9, 3], [7, 5], [3, 5]], s: 0 },
    { id: "in", kind: "line", points: [[0, 3], [3, 3]], s: 0 },
    { id: "lab", kind: "label", x: 3, y: 3, label: "OR gate", s: 0 },
  ] }] } }, 1)!;
  const sketch = layoutPanel(spec).marks.find((m): m is Extract<Mark, { type: "sketch" }> => m.type === "sketch")!;
  const lab = (sketch.items[0].item as { shapes: Array<{ id: string; labelAt?: { x: number; y: number } }> }).shapes.find((s) => s.id === "lab")!;
  assert.ok(lab.labelAt && (lab.labelAt.x !== 3 || lab.labelAt.y !== 3), "the label moved off the corner where two lines meet");
});

test("a label too big for its shape is written outside it, clear of every line and label", () => {
  const spec = validateCanvasSpec({ heading: "Routes", notes: [], cues: [], stage: { kind: "sketch", items: [{ id: "g", type: "shapes", s: 0, col: "full", grid: { w: 12, h: 8 }, shapes: [
    { id: "a", kind: "circle", x: 7.4, y: 5.4, r: 0.48, label: "areas", s: 0 },
    { id: "b", kind: "circle", x: 9.2, y: 5.4, r: 0.48, label: "advanced methods", s: 0 },
    { id: "ab", kind: "arrow", points: [[7.9, 5.4], [8.7, 5.4]], s: 0 },
    { id: "big", kind: "rect", x: 1, y: 1, w: 4, h: 3, label: "x²", s: 0 },
  ] }] } }, 1)!;
  const sketch = layoutPanel(spec).marks.find((m): m is Extract<Mark, { type: "sketch" }> => m.type === "sketch")!;
  const shapes = (sketch.items[0].item as { shapes: Array<{ id: string; x?: number; y?: number; r?: number; labelAt?: { x: number; y: number; size: number } }> }).shapes;
  const get = (id: string) => shapes.find((s) => s.id === id)!;
  assert.deepEqual([get("big").labelAt!.x, get("big").labelAt!.y], [3, 2.5], "a label that fits stays at its shape's centre");
  const out = get("b");
  assert.ok(Math.hypot(out.labelAt!.x - out.x!, out.labelAt!.y - out.y!) > out.r!, "too big for its circle: written outside it");
  assert.ok(out.labelAt!.size >= 13, "at a readable size");
});

test("an overfull sketch is scaled to fit the board, and words in maths are set as words", () => {
  const big = (id: string, col: string) => ({ id, type: "shapes", s: 0, col, grid: { w: 12, h: 12 }, shapes: [{ id: `${id}-a`, kind: "rect", x: 1, y: 1, w: 4, h: 4, s: 0 }] });
  const spec = validateCanvasSpec({ heading: "Many", notes: [], cues: [], stage: { kind: "sketch", items: [big("a", "left"), big("b", "right"), big("c", "full"), { id: "t", type: "text", s: 0, col: "full", text: "Positive: same direction; negative: reverse direction" }, { id: "m", type: "math", s: 0, col: "full", lines: [{ s: 0, tex: "1101\\ 0110 \\to first digit second digit" }] }] } }, 2)!;
  const sketch = layoutPanel(spec).marks.find((m): m is Extract<Mark, { type: "sketch" }> => m.type === "sketch")!;
  for (const p of sketch.items) assert.ok(p.rect.y + p.rect.h <= sketch.rect.y + sketch.rect.h + 1, `${p.item.id} is on the board`);
  const math = (spec.stage as { items: Array<{ type: string; lines?: Array<{ tex: string }> }> }).items.find((i) => i.type === "math")!;
  assert.match(math.lines![0].tex, /\\text\{first digit second digit\}/);
});
